// Fonts served from this site's own domain.
//
// Two sources, both kept in the site's R2 bucket (lib/media) on Cloudflare:
//
//   fonts/g/<hash>.woff2       Google Fonts files, copied the first time the
//                              stylesheet names them (lib/fontCss.ts)
//   fonts/custom/<name>.woff2  files the site owner uploaded
//
// Both are served by `app/fonts/[...file]/route.ts` with a year-long cache.
// For the visitor this removes the connection to fonts.gstatic.com — one
// fewer DNS+TLS handshake before the first text can paint — and it means a
// Google outage or block (China, some corporate networks) no longer changes
// how the site looks. WP Rocket sells the same thing as "host fonts locally".

import { createHash } from "node:crypto";
import path from "node:path";
import { mediaBucket } from "@/lib/media";

/** R2 key of a served font: `g/<name>` or `custom/<name>` → `fonts/g/<name>`. */
export const fontKey = (rel: string) => `fonts/${rel}`;
export const FONT_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".otf"]);
export const FONT_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const GSTATIC_RE = /url\((["']?)(https:\/\/fonts\.gstatic\.com\/[^)"']+)\1\)/g;
const MAX_FILE = 5 * 1024 * 1024;

function localName(url: string): string {
  const ext = path.extname(new URL(url).pathname).toLowerCase() || ".woff2";
  return `${createHash("sha1").update(url).digest("hex").slice(0, 16)}${FONT_EXTENSIONS.has(ext) ? ext : ".woff2"}`;
}

async function exists(key: string): Promise<boolean> {
  return !!(await mediaBucket().head(key).catch(() => null));
}

/** Downloads one Google font file if it is not here yet. True when it is usable. */
async function ensureLocal(url: string, name: string): Promise<boolean> {
  const key = fontKey(`g/${name}`);
  if (await exists(key)) return true;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FILE) return false;
    await mediaBucket().put(key, new Uint8Array(bytes), { httpMetadata: { contentType: FONT_TYPES[path.extname(name)] ?? "font/woff2" } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrites the `url(https://fonts.gstatic.com/…)` references in Google's CSS
 * to local copies, downloading any that are missing. A file that cannot be
 * fetched keeps its Google URL, so the worst case is the old behaviour.
 */
export async function localizeFontCss(css: string): Promise<{ css: string; local: number; remote: number }> {
  const urls = [...new Set([...css.matchAll(GSTATIC_RE)].map((m) => m[2]))];
  if (urls.length === 0) return { css, local: 0, remote: 0 };
  const names = new Map(urls.map((u) => [u, localName(u)]));
  const ok = await Promise.all(urls.map((u) => ensureLocal(u, names.get(u)!)));
  const usable = new Set(urls.filter((_, i) => ok[i]));
  const out = css.replace(GSTATIC_RE, (whole, q: string, url: string) => (usable.has(url) ? `url(/fonts/g/${names.get(url)})` : whole));
  return { css: out, local: usable.size, remote: urls.length - usable.size };
}

/** A safe file name for an uploaded font: family + weight + style. */
/**
 * The stored filename for one uploaded face.
 *
 * `fingerprint` is the content's, and it is in the name for a reason: font
 * files are served with a one-year `immutable` cache header, which tells every
 * browser and CDN never to revalidate. The name used to be derived from the
 * family, weight and style alone, so re-uploading a corrected file for the
 * same face produced the *same URL* — and returning visitors kept the old
 * font for a year while the owner saw the new one, because their own browser
 * had not cached it yet. "I replaced it and nothing changed" with no way to
 * force it.
 *
 * Different bytes now mean a different URL, which is what `immutable`
 * promises. The old file is removed by the caller when the face is replaced,
 * so this does not accumulate.
 */
export function customFontFileName(family: string, weight: string, style: string, ext: string, fingerprint?: string): string {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "font";
  const suffix = fingerprint ? `-${fingerprint}` : "";
  return `${slug}-${weight.replace(/\s+/g, "-")}${style === "italic" ? "-italic" : ""}${suffix}${ext}`;
}

/** Eight hex characters of the file's SHA-256 — enough to separate versions. */
export function fontFingerprint(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

export async function saveCustomFont(name: string, bytes: Buffer): Promise<string> {
  await mediaBucket().put(fontKey(`custom/${name}`), new Uint8Array(bytes), { httpMetadata: { contentType: FONT_TYPES[path.extname(name).toLowerCase()] ?? "font/woff2" } });
  return `/fonts/custom/${name}`;
}

export async function removeCustomFont(servedPath: string): Promise<void> {
  const rel = servedPath.replace(/^\/fonts\//, "");
  if (!rel.startsWith("custom/") || rel.includes("..")) return;
  await mediaBucket().delete(fontKey(rel)).catch(() => {});
}

