// Putting the uploaded files into an export or backup, and back out again.
//
// The JSON export carries the media *records* — filename, alt text, dimensions,
// which post used it — and none of the bytes. That is a backup that silently
// loses every image, which is the kind of thing that looks complete right up
// until the day it is needed.
//
// On Cloudflare the files are in the site's R2 bucket (lib/media). A Worker has
// 128 MB of memory and the zip is built in it, so the archive is capped well
// below that; R2 itself keeps the files durably, so a site past the cap loses
// nothing by exporting its content alone.

import JSZip from "jszip";
import path from "node:path";
import { sanitizeSvg } from "@/lib/sanitizeSvg";
import { mediaBucket, uploadKey } from "@/lib/media";

/** How much media one archive may carry (bytes): a Worker builds it in 128 MB of memory. */
export const MEDIA_ZIP_LIMIT = 40 * 1024 * 1024;

/** A `/uploads/...` path is a file in this site's bucket; anything absolute is already hosted. */
export function isLocalUpload(url: string): boolean {
  return url.startsWith("/uploads/");
}

export interface MediaBundleResult {
  zip: JSZip;
  included: number;
  missing: string[];
  skippedRemote: number;
  bytes: number;
}

/**
 * Adds every local upload to `uploads/` inside the archive. A file recorded in
 * the database but absent from the bucket is reported rather than throwing:
 * the rest of the archive is still worth having.
 */
export async function bundleMedia(zip: JSZip, urls: string[]): Promise<MediaBundleResult> {
  const missing: string[] = [];
  let included = 0;
  let bytes = 0;
  let skippedRemote = 0;
  const bucket = mediaBucket();

  for (const url of urls) {
    if (!isLocalUpload(url)) { skippedRemote++; continue; }
    const key = uploadKey(url);
    if (!key || key.includes("/")) { missing.push(url); continue; }
    const obj = await bucket.get(key).catch(() => null);
    if (!obj) { missing.push(url); continue; }
    bytes += obj.size;
    if (bytes > MEDIA_ZIP_LIMIT) {
      throw new Error(
        `The uploads are larger than ${Math.round(MEDIA_ZIP_LIMIT / 1024 / 1024)} MB. Export without media: on Cloudflare the files stay safe in R2.`
      );
    }
    zip.file(`uploads/${key}`, new Uint8Array(await obj.arrayBuffer()), { compression: "STORE" });
    included++;
  }

  return { zip, included, missing, skippedRemote, bytes };
}

/** The scheduled backup's name for the same thing (it streamed from disk on Node). */
export const bundleMediaStreaming = bundleMedia;

/**
 * Extensions a restored file may have — the same list the uploader accepts.
 * An archive must not be able to plant an `.html` page or a `.js` file on the
 * site's own origin, and every SVG is sanitised as an upload would be.
 */
const RESTORABLE = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".json", ".ico"]);
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };

/**
 * Writes files out of an archive back into the bucket. Never overwrites: a
 * name that already exists is that upload, already here.
 */
export async function restoreMedia(zip: JSZip): Promise<{ written: number; skipped: number }> {
  const bucket = mediaBucket();
  let written = 0;
  let skipped = 0;
  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith("uploads/"));

  for (const entry of entries) {
    const name = path.basename(entry.name);
    const ext = path.extname(name).toLowerCase();
    if (!name || name.includes("..") || name.startsWith("_") || !RESTORABLE.has(ext)) { skipped++; continue; }
    try {
      if (await bucket.head(name)) { skipped++; continue; }
      let data = new Uint8Array(await entry.async("arraybuffer"));
      if (ext === ".svg") {
        const clean = sanitizeSvg(new TextDecoder().decode(data));
        if (!clean) { skipped++; continue; }
        data = new TextEncoder().encode(clean.svg);
      }
      await bucket.put(name, data, { httpMetadata: { contentType: TYPES[ext] } });
      written++;
    } catch {
      skipped++;
    }
  }
  return { written, skipped };
}
