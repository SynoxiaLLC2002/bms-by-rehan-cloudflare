// One address for the whole site: Astro renders the homepage, pages and posts;
// everything else — the admin, the API, stylesheets, uploads, feeds, sitemaps,
// search and archives — is the BMS Worker's, reached over the BMS service
// binding (wrangler.jsonc) with the visitor's request unchanged.
import { defineMiddleware } from "astro:middleware";
import { env, waitUntil } from "cloudflare:workers";
import { edgeCacheVersion } from "@/lib/edgeCache";
import { hasSessionCookie } from "@/lib/lscache";

const BMS_PATHS = /^\/(?:admin|api|_next|site|uploads|fonts|og|plugins|preview|search|feed|author|category|tag|\.well-known)(?:\/|$)|\.(?:xml|txt|ico|webmanifest)$/;

// Files whose address never changes its content. They live in R2 in one region and
// a Worker's response is never cached by Cloudflare by itself, so without this every
// visitor far from that region waited a full ocean crossing for each one, every time.
const STATIC_FILES = /^\/(?:uploads|fonts|icons)\/|^\/favicon\.ico$/;
const FILE_TTL = 31_536_000;

async function cachedFile(request: Request): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  // /favicon.ico keeps one address whatever the icon is: kept per build and for a
  // day, so a changed icon reaches tabs and Google without anyone purging.
  const fixed = new URL(request.url).pathname === "/favicon.ico";
  const key = fixed ? `${request.url}?__b=${BUILD}` : request.url;
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await toBms(request);
  if (res.status !== 200) return res;
  const out = new Response(res.body, res);
  out.headers.delete("set-cookie");
  out.headers.delete("vary");
  out.headers.set("Cache-Control", fixed ? "public, max-age=86400" : `public, max-age=${FILE_TTL}, immutable`);
  waitUntil(cache.put(key, out.clone()));
  return out;
}

// robots.txt, the sitemaps, the feed and llms.txt: what crawlers read first. They were built fresh on
// every request (a Worker's response is never cached by Cloudflare by itself), so while the database
// was busy they hung, and a crawler that cannot read robots.txt slows down or stops. Kept per site
// version (a save refreshes them), and the last good copy answers if a fresh one fails or is slow.
const CRAWL_FILES = /^\/(?:robots\.txt|llms\.txt|feed\.xml|main-sitemap\.xsl|[a-z0-9_-]*sitemap[a-z0-9_-]*\.xml)$/;
const CRAWL_TTL = 3600, CRAWL_KEEP = 604_800, CRAWL_WAIT = 8000;
async function cachedCrawlFile(request: Request, url: URL): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const last = `${url.origin}${url.pathname}?__last`;
  let version = "";
  try { version = await siteVersion(url.origin); } catch { /* no version: the last good copy still answers */ }
  const key = `${url.origin}${url.pathname}?__v=${version}`;
  if (version) { const hit = await cache.match(key); if (hit) return hit; }
  const fresh = await Promise.race([
    toBms(request).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), CRAWL_WAIT)),
  ]);
  if (!fresh || fresh.status >= 500) {
    const kept = await cache.match(last);
    if (kept) return kept;
    return fresh ?? new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "60" } });
  }
  if (fresh.status !== 200) return fresh; // redirects and 404s pass through, not kept
  const out = new Response(fresh.body, fresh);
  out.headers.delete("set-cookie");
  out.headers.set("Cache-Control", `public, max-age=${CRAWL_TTL}`);
  if (version) waitUntil(cache.put(key, out.clone()));
  const keep = out.clone();
  keep.headers.set("Cache-Control", `public, max-age=${CRAWL_KEEP}`);
  waitUntil(cache.put(last, keep));
  return out;
}

export function toBms(request: Request): Promise<Response> {
  return (env as unknown as { BMS: { fetch: (r: Request) => Promise<Response> } }).BMS.fetch(request);
}

// Free hardening on every response: HTTPS only for a year (no includeSubDomains: a
// site's other subdomains are not ours to promise), no MIME sniffing, no full URLs
// leaked to other sites, and no framing of the site by other sites.
const SECURITY: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};
function secure(res: Response): Response {
  const out = new Response(res.body, res); // fetched and redirect responses have read-only headers
  for (const [k, v] of Object.entries(SECURITY)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export const onRequest = defineMiddleware(async (context, next) => secure(await route(context.url, context.request, next)));

async function route(url: URL, request: Request, next: () => Promise<Response>): Promise<Response> {
  const context = { url, request };
  const { pathname } = context.url;
  // One address per site: www.<domain> (connected by deploy.sh) moves to <domain>, and plain http to
  // https (Cloudflare's "Always Use HTTPS" may be off: an audit found every page served over http).
  if (context.url.hostname.startsWith("www.") || (context.url.protocol === "http:" && !/^(localhost|127\.)/.test(context.url.hostname))) {
    const to = new URL(context.url);
    to.hostname = to.hostname.replace(/^www\./, "");
    to.protocol = "https:";
    return Response.redirect(to.toString(), 301);
  }
  // One address per page: "/page/" moves to "/page" (the canonical already pointed there).
  if (pathname.length > 1 && pathname.endsWith("/") && !BMS_PATHS.test(pathname) && (context.request.method === "GET" || context.request.method === "HEAD")) {
    const to = new URL(context.url);
    to.pathname = pathname.replace(/\/+$/, "") || "/";
    return Response.redirect(to.toString(), 301);
  }
  if (context.request.method !== "GET" && context.request.method !== "HEAD") return toBms(context.request);
  if (STATIC_FILES.test(pathname) && context.request.method === "GET") return cachedFile(context.request);
  if (CRAWL_FILES.test(pathname) && context.request.method === "GET" && !context.url.search) return cachedCrawlFile(context.request, context.url);
  if (BMS_PATHS.test(pathname)) return toBms(context.request);
  return cachedPage(context.request, context.url, next);
}

// Rendered pages are kept twice (src/lib/edgeCache.ts):
//   Cache API  this data centre: the fastest, empty in every new location.
//   R2 _html/  one copy for the whole world, so no visitor anywhere waits for a
//              render once any visitor has opened the page.
// After a save, the saved copy is served once more while a fresh one is made
// behind the response: nobody waits, and the next visitor gets the new page.
// A logged-in editor skips all of this and always sees a fresh render.
// Not kept: query strings (endless keys), anything but a plain 200 HTML page,
// and copies from an older build (they name scripts that no longer exist).
declare const __BMS_BUILD__: string;
const BUILD = __BMS_BUILD__;
const EDGE_TTL = 86_400;
const BROWSER = "public, max-age=0, must-revalidate";
const HTML = "text/html; charset=utf-8";

// `link`: the page's preloads (pages/[...path].astro), kept with every copy so a
// cached page starts its hero image and fonts as early as a fresh one.
const page = (body: BodyInit | null, state: string, status = 200, link?: string | null) =>
  new Response(body, { status, headers: { "Content-Type": HTML, "Cache-Control": BROWSER, "X-BMS-Cache": state, ...(link ? { Link: link } : {}) } });
const forEdge = (html: string, status = 200, link?: string | null) =>
  new Response(html, { status, headers: { "Content-Type": HTML, "Cache-Control": `public, max-age=${EDGE_TTL}`, ...(link ? { Link: link } : {}) } });

// The site version, without a database trip in front of a cached page: kept per
// data centre and refreshed behind the response, so a save shows within seconds.
let held: { value: string; at: number } | null = null;
async function siteVersion(origin: string): Promise<string> {
  const now = Date.now();
  if (held && now - held.at < 5_000) return held.value;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = `${origin}/__bms_version`;
  const refresh = async () => {
    const value = await edgeCacheVersion();
    held = { value, at: Date.now() };
    await cache.put(key, new Response(JSON.stringify({ value, at: Date.now() }), { headers: { "Cache-Control": `public, max-age=${EDGE_TTL}` } }));
    return value;
  };
  const saved = await cache.match(key);
  if (!saved) return refresh();
  const { value, at } = (await saved.json()) as { value: string; at: number };
  held = { value, at: now };
  if (now - at > 10_000) waitUntil(refresh().catch(() => undefined));
  return value;
}

async function cachedPage(request: Request, url: URL, next: () => Promise<Response>): Promise<Response> {
  if (request.method !== "GET" || url.search || hasSessionCookie(request.headers.get("cookie"))) return next();
  let version: string;
  try {
    version = await siteVersion(url.origin);
  } catch {
    return next(); // version unreadable: render without keeping a copy
  }
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${url.origin}${url.pathname}?__v=${version}&__b=${BUILD}`);
  const hit = await cache.match(key);
  if (hit) return page(hit.body, "hit", hit.status, hit.headers.get("link"));

  const bucket = (env as unknown as { MEDIA: R2Bucket }).MEDIA;
  const savedKey = `_html${url.pathname}`;
  const keep = async (res: Response): Promise<string | null> => {
    const type = res.headers.get("content-type") ?? "";
    if (res.status !== 200 || !type.includes("text/html") || res.headers.has("set-cookie")) return null;
    const html = await res.text();
    const link = res.headers.get("link") ?? "";
    await Promise.all([
      cache.put(key, forEdge(html, 200, link)),
      bucket.put(savedKey, html, { httpMetadata: { contentType: HTML }, customMetadata: { version, build: BUILD, link } }),
    ]);
    return html;
  };

  const saved = await bucket.get(savedKey).catch(() => null);
  if (saved && saved.customMetadata?.build === BUILD) {
    const html = await saved.text();
    const link = saved.customMetadata.link;
    if (saved.customMetadata.version === version) {
      waitUntil(cache.put(key, forEdge(html, 200, link)));
      return page(html, "saved", 200, link);
    }
    waitUntil(next().then(async (res) => {
      // No longer a page (unpublished, deleted, redirected): stop serving the copy.
      if (res.status !== 200) await bucket.delete(savedKey);
      else await keep(res);
    }).catch(() => undefined));
    return page(html, "stale", 200, link);
  }

  const res = await next();
  // A 404 is the BMS Worker's full not-found render (redirect lookup, 404 log): seconds.
  // Keep it in this data centre only, under the site version, so publishing that
  // address (which bumps the version) shows the page at once.
  if (res.status === 404 && (res.headers.get("content-type") ?? "").includes("text/html") && !res.headers.has("set-cookie")) {
    const html = await res.text();
    waitUntil(cache.put(key, forEdge(html, 404)));
    return page(html, "miss", 404);
  }
  const copy = res.clone();
  waitUntil(keep(copy).catch(() => null));
  if (res.status !== 200) return res;
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", BROWSER);
  out.headers.set("X-BMS-Cache", "miss");
  return out;
}
