// The Worker's front door, ahead of the Next app (.open-next/worker.js).
//
// Uploads live in R2, not on a disk, so these are answered here:
//
//   /uploads/<file>              the file, straight from the MEDIA bucket. A
//                                logo's `_sized/<name>-<w>w.webp` (lib/logoSrc)
//                                is made from the original.
//   /_next/image?url=/uploads/…  the optimiser BMS's pages already link to,
//                                resized by Cloudflare Images (IMAGES), as
//                                AVIF or WebP by the browser's Accept header.
//   /og/jpg/<name>.jpg           the share-preview JPEG (app/og/jpg on Node).
//
// Resized copies go into the Cache API under the original's ETag, and R2 is
// asked first on every request (a metadata read): a deleted or replaced upload
// stops being served at once, everywhere, with nothing to purge.
// Everything else is the Next app's.

// @ts-expect-error -- produced by `opennextjs-cloudflare build`
import handler from "./.open-next/worker.js";

interface R2Obj { body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string } }
interface Env {
  MEDIA: {
    head(key: string): Promise<{ httpEtag: string } | null>;
    get(key: string): Promise<R2Obj | null>;
  };
  IMAGES?: {
    input(s: ReadableStream): { transform(o: Record<string, unknown>): { output(o: { format: string; quality?: number }): Promise<{ response(): Response }> } };
  };
  /** "1" = never resize: every image request gets the original upload (a per-site Worker secret, `wrangler secret put NO_RESIZE`). */
  NO_RESIZE?: string;
}
interface Ctx { waitUntil(p: Promise<unknown>): void }

const YEAR = "public, max-age=31536000, immutable";
// An upload is never a document: no scripts, no frames, even for an SVG.
const SAFE = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" };
const RESIZABLE = /\.(?:jpe?g|png|webp|avif)$/i;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

function keyOf(pathname: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(pathname.replace(/^\/uploads\//, ""));
  } catch {
    return null;
  }
  // `_backups/` holds the site's backups (lib/backup): account emails and all. Never public.
  if (!key || key.startsWith("_backups/") || key.startsWith("_html/")) return null;
  return !key.split("/").some((p) => p === "" || p === "." || p === "..") ? key : null;
}

/** The first of `keys` that exists in R2, with its ETag. */
async function firstExisting(env: Env, keys: string[]): Promise<{ key: string; etag: string } | null> {
  for (const key of keys) {
    const head = await env.MEDIA.head(key);
    if (head) return { key, etag: head.httpEtag };
  }
  return null;
}

/** `key` resized to `width` in `format`, made once per original version and data centre. */
async function variant(request: Request, ctx: Ctx, env: Env, src: { key: string; etag: string }, width: number, format: string, quality: number): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = `${new URL(request.url).origin}/__variant/${format}/${width}/${quality}/${encodeURIComponent(src.key)}?v=${encodeURIComponent(src.etag)}`;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const original = await env.MEDIA.get(src.key);
  if (!original) return notFound();
  let res: Response;
  const asIs = (o: R2Obj, cacheControl = YEAR) => new Response(o.body, { headers: { "Content-Type": o.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": cacheControl, ...SAFE } });
  if (!env.IMAGES || !RESIZABLE.test(src.key) || env.NO_RESIZE === "1") {
    res = asIs(original); // NO_RESIZE: the site's uploads are already small WebP; no Cloudflare Images transformations at all
  } else {
    try {
      const out = await env.IMAGES.input(original.body).transform({ width, fit: "scale-down" }).output({ format, quality });
      res = new Response(out.response().body, { headers: { "Content-Type": format, "Cache-Control": YEAR, Vary: "Accept", ...SAFE } });
    } catch (e) {
      // A refused transform (9422: the account's free transformations are used up) used to answer 500 and show a
      // broken image. Serve the original instead, cached for an hour only, so the resize is tried again later.
      console.error("[images]", src.key, String(e).slice(0, 200));
      const again = await env.MEDIA.get(src.key); // the failed transform consumed original.body
      if (!again) return notFound();
      return asIs(again, "public, max-age=3600");
    }
  }
  if (request.method === "GET") ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function serveUpload(request: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const key = keyOf(url.pathname);
  if (!key) return notFound();
  const obj = await env.MEDIA.get(key);
  if (obj) {
    return new Response(request.method === "HEAD" ? null : obj.body, {
      headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Content-Length": String(obj.size), ETag: obj.httpEtag, "Cache-Control": YEAR, ...SAFE },
    });
  }
  // A logo size (lib/logoSrc): made from the original, as WebP.
  const m = key.match(/^_sized\/(.+)-(\d{2,4})w\.webp$/);
  const width = m ? parseInt(m[2], 10) : 0;
  if (!m || width < 8 || width > 1920) return notFound();
  const src = await firstExisting(env, [".webp", ".png", ".jpg", ".jpeg"].map((ext) => `${m[1]}${ext}`));
  return src ? variant(request, ctx, env, src, width, "image/webp", 85) : notFound();
}

async function optimise(request: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const key = keyOf(url.searchParams.get("url") ?? "");
  const w = Number(url.searchParams.get("w"));
  const q = Number(url.searchParams.get("q") ?? 75);
  if (!key || !Number.isInteger(w) || w < 16 || w > 3840 || !Number.isInteger(q) || q < 1 || q > 100) {
    return new Response("Bad image request", { status: 400 });
  }
  const src = await firstExisting(env, [key]);
  if (!src) return notFound();
  const format = /image\/avif/.test(request.headers.get("Accept") ?? "") ? "image/avif" : "image/webp";
  return variant(request, ctx, env, src, w, format, q);
}

/**
 * `/og/jpg/<upload name>.jpg`: the upload as a JPEG at share size (1200 px at
 * most), for scrapers that cannot read WebP — WhatsApp, LinkedIn, email.
 */
async function shareJpeg(request: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice("/og/jpg/".length)).replace(/\.jpg$/i, "");
  } catch {
    return notFound();
  }
  if (!name || name.includes("/") || name.startsWith(".")) return notFound();
  const src = await firstExisting(env, [".webp", ".avif", ".png", ".jpg", ".jpeg"].map((ext) => `${name}${ext}`));
  return src ? variant(request, ctx, env, src, 1200, "image/jpeg", 85) : notFound();
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (request.method === "GET" || request.method === "HEAD") {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/uploads/")) return serveUpload(request, url, env, ctx);
      if (url.pathname.startsWith("/og/jpg/")) return shareJpeg(request, url, env, ctx);
      if (url.pathname === "/_next/image" && (url.searchParams.get("url") ?? "").startsWith("/uploads/")) return optimise(request, url, env, ctx);
    }
    return handler.fetch(request, env, ctx);
  },

  // Cron Trigger (wrangler.jsonc "triggers"): the job a cPanel cron line ran —
  // publish scheduled posts and refresh what they change — through the same
  // route, with the same CRON_TOKEN secret.
  // The 03:00 trigger is the daily backup (lib/backup, into R2), as the cPanel
  // cron line with BACKUP_TOKEN was.
  async scheduled(event: { cron?: string }, env: Env & { CRON_TOKEN?: string; BACKUP_TOKEN?: string }, ctx: Ctx): Promise<void> {
    const backup = event.cron === "0 3 * * *";
    const token = backup ? env.BACKUP_TOKEN : env.CRON_TOKEN;
    const path = backup ? "/api/backup" : "/api/cron/publish";
    if (!token) return console.warn(`[cron] ${backup ? "BACKUP_TOKEN" : "CRON_TOKEN"} is not set; ${path} did not run.`);
    const res: Response = await handler.fetch(new Request(`https://bms.internal${path}`, { headers: { authorization: `Bearer ${token}` } }), env, ctx);
    if (!res.ok) console.error("[cron]", path, "answered", res.status, (await res.text()).slice(0, 300));
  },
};
