// Where uploads live on Cloudflare: the site's R2 bucket (`MEDIA` in
// wrangler.jsonc), keyed by the path after `/uploads/`, and Cloudflare Images
// (`IMAGES`) for resizing. `cf-worker.ts` serves both to visitors; this file is
// what the app's routes write and delete through.
//
// Only the Cloudflare adapter is imported, so this stays usable from the
// middleware and from Astro (its shim provides the same getCloudflareContext).

import { getCloudflareContext } from "@opennextjs/cloudflare";

// The parts of the two bindings this app calls. Declared here, not taken from
// Cloudflare's runtime types (see lib/db/d1.ts for why).
export interface R2Object {
  key: string;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2Bucket {
  head(key: string): Promise<{ key: string } | null>;
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
}
interface ImagesTransformer {
  transform(options: Record<string, unknown>): ImagesTransformer;
  output(options: { format: string; quality?: number }): Promise<{ response(): Response; contentType(): string }>;
}
export interface ImagesBinding {
  info(stream: ReadableStream): Promise<{ format: string; fileSize?: number; width?: number; height?: number }>;
  input(stream: ReadableStream): ImagesTransformer;
}

function env(): { MEDIA?: R2Bucket; IMAGES?: ImagesBinding } {
  try {
    return getCloudflareContext().env as { MEDIA?: R2Bucket; IMAGES?: ImagesBinding };
  } catch {
    return {}; // outside a request (next build)
  }
}

export function mediaBucket(): R2Bucket {
  const bucket = env().MEDIA;
  if (!bucket) throw new Error("No R2 bucket: add the MEDIA binding to wrangler.jsonc.");
  return bucket;
}

export function imagesBinding(): ImagesBinding | undefined {
  return env().IMAGES;
}

/** `/uploads/a/b.webp` → `a/b.webp`; null for anything else, or a path that tries to climb out. */
export function uploadKey(url: string): string | null {
  const m = url.replace(/[?#].*$/, "").match(/^\/uploads\/(.+)$/);
  if (!m) return null;
  let key: string;
  try {
    key = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  // `_backups/` (lib/backup) is private; no upload URL may name it.
  if (key.startsWith("_backups/") || key.startsWith("_css/") || key.startsWith("_html/") || key.startsWith("_plugins/")) return null;
  return key.split("/").some((part) => part === "" || part === "." || part === "..") ? null : key;
}

/**
 * Stores an upload under `filename`, or `name-2.ext`, `name-3.ext`… — the first
 * name not already taken, so a second `sunset.jpg` never replaces the first.
 */
export async function putUpload(filename: string, bytes: Uint8Array, contentType: string): Promise<{ url: string; filename: string }> {
  const bucket = mediaBucket();
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let name = filename;
  for (let n = 2; await bucket.head(name); n++) name = `${base}-${n}${ext}`;
  await bucket.put(name, bytes, { httpMetadata: { contentType } });
  return { url: `/uploads/${encodeURIComponent(name)}`, filename: name };
}

/** Removes an upload and the resized copies made from it (`_sized/<stem>-<w>w.webp`). */
export async function deleteUpload(url: string): Promise<void> {
  const key = uploadKey(url);
  if (!key) return;
  const bucket = mediaBucket();
  const stem = key.replace(/\.[^.]+$/, "");
  const prefix = `_sized/${stem}-`;
  const sized = await bucket.list({ prefix, limit: 100 }).catch(() => ({ objects: [] as { key: string }[] }));
  // Exactly `<stem>-<width>w.webp`: a prefix test alone also matched
  // `photo-2-120w.webp` when `photo.webp` was deleted.
  await bucket.delete([key, ...sized.objects.map((o) => o.key).filter((k) => /^\d+w\.webp$/.test(k.slice(prefix.length)))]);
}
