// Shrinks an uploaded image before it is stored.
//
// Nothing resized uploads before: a 5 MB, 4,000-pixel phone photo went into
// the media library exactly as it arrived. Bloggers upload phone photos. This
// is where most of a site's page weight comes from, and the only place it can
// be fixed once for good.
//
// What happens: JPEG, PNG and WebP are resized so the longer side is at most
// Speed → Media → "Largest image size" (else MEDIA_MAX_PX, else 2000) and
// re-encoded as WebP. GIF and AVIF are left alone: GIFs may be animated, and
// AVIF is already smaller than WebP. Anything that cannot be read is stored as
// uploaded; a photo we could not shrink is still a photo.
//
// On Cloudflare the work is done by the Images binding (`IMAGES` in
// wrangler.jsonc) instead of sharp, which cannot run in a Worker. Re-encoding
// drops the photo's metadata — the GPS position a phone writes into EXIF
// included — and applies its EXIF orientation, as sharp's `.rotate()` did.

import { extname } from "node:path";
import { imagesBinding, type ImagesBinding } from "@/lib/media";

export interface OptimizedUpload {
  buffer: Buffer;
  /** Filename with the extension the encoded bytes actually have. */
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  /** True when the bytes are not the original upload. */
  changed: boolean;
  /** A ~16px blurred preview as a data URI, for a placeholder while loading. */
  blur?: string;
}

const MAX_PX = Math.max(400, Number(process.env.MEDIA_MAX_PX ?? 2000) || 2000);

/** The saved Speed setting when it is a sane size, else the environment's. */
export function maxPxFrom(setting: string | undefined): number {
  const n = parseInt(setting ?? "", 10);
  return Number.isFinite(n) && n >= 400 && n <= 8000 ? n : MAX_PX;
}
const QUALITY = Math.min(100, Math.max(40, Number(process.env.MEDIA_WEBP_QUALITY ?? 82) || 82));
const ENABLED = process.env.MEDIA_OPTIMIZE !== "off";
const CONVERTIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

const stream = (b: Buffer) => new Blob([new Uint8Array(b)]).stream();

async function encode(images: ImagesBinding, source: Buffer, maxPx: number, format: string, quality: number): Promise<Buffer> {
  const out = await images
    .input(stream(source))
    .transform({ width: maxPx, height: maxPx, fit: "scale-down" })
    .output({ format, quality });
  return Buffer.from(await out.response().arrayBuffer());
}

async function sizeOf(images: ImagesBinding, bytes: Buffer): Promise<{ width: number; height: number } | null> {
  const info = await images.info(stream(bytes)).catch(() => null);
  return info && "width" in info && info.width && info.height ? { width: info.width, height: info.height } : null;
}

/**
 * The placeholder: the image at 16 pixels, lightly blurred, as WebP. About
 * 300–500 bytes — small enough to live in the HTML for every image on a page.
 */
async function makeBlur(images: ImagesBinding, source: Buffer): Promise<string | undefined> {
  try {
    const out = await images.input(stream(source)).transform({ width: 16, height: 16, fit: "scale-down", blur: 1 }).output({ format: "image/webp", quality: 40 });
    const bytes = Buffer.from(await out.response().arrayBuffer());
    return `data:image/webp;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function optimizeUpload(
  original: Buffer,
  filename: string,
  mimeType: string,
  maxPx: number = MAX_PX
): Promise<OptimizedUpload> {
  const untouched: OptimizedUpload = { buffer: original, filename, mimeType, width: null, height: null, changed: false };
  if (!ENABLED || !CONVERTIBLE.has(mimeType)) return untouched;
  const images = imagesBinding();
  if (!images) return untouched;

  try {
    const webp = await encode(images, original, maxPx, "image/webp", QUALITY);
    const blur = await makeBlur(images, original);

    // A WebP bigger than the original is not an optimisation (tiny PNG icons,
    // already-tight WebPs): keep the format, but still re-encode, so EXIF and
    // its GPS position never reach the public file.
    if (webp.length >= original.length && mimeType !== "image/webp") {
      const same = await encode(images, original, maxPx, mimeType, QUALITY);
      const size = await sizeOf(images, same);
      return { buffer: same, filename, mimeType, width: size?.width ?? null, height: size?.height ?? null, changed: true, blur };
    }

    const size = await sizeOf(images, webp);
    const base = filename.slice(0, filename.length - extname(filename).length) || "image";
    return { buffer: webp, filename: `${base}.webp`, mimeType: "image/webp", width: size?.width ?? null, height: size?.height ?? null, changed: true, blur };
  } catch (err) {
    console.warn("[media] could not optimise", filename, err);
    return untouched;
  }
}

export interface ShrunkFile {
  buffer: Buffer;
  width: number | null;
  height: number | null;
  /** True when `buffer` is new bytes to write over the file. */
  changed: boolean;
  blur?: string;
}

/**
 * The same shrink for a file already in the media library (Speed → Media →
 * "Re-optimise existing images"). The format is kept: the file's URL is
 * already written into posts, menus and settings.
 */
export async function shrinkExisting(original: Buffer, mimeType: string, maxPx: number = MAX_PX): Promise<ShrunkFile> {
  const untouched: ShrunkFile = { buffer: original, width: null, height: null, changed: false };
  if (!CONVERTIBLE.has(mimeType)) return untouched;
  const images = imagesBinding();
  if (!images) return untouched;
  try {
    const size = await sizeOf(images, original);
    if (!size) return untouched;
    const blur = await makeBlur(images, original);
    if (Math.max(size.width, size.height) <= maxPx) return { ...untouched, ...size, blur };
    const out = await encode(images, original, maxPx, mimeType, QUALITY);
    if (out.length >= original.length) return { ...untouched, ...size, blur };
    const newSize = await sizeOf(images, out);
    return { buffer: out, width: newSize?.width ?? null, height: newSize?.height ?? null, changed: true, blur };
  } catch {
    return untouched;
  }
}
