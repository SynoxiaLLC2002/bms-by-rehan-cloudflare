// The page's first-view (LCP) image, when it is a small SVG upload, as a data: URI.
//
// Even preloaded, it was its own request: on PageSpeed's slow phone it started only
// once the HTML had arrived (~540 ms "resource load delay") and took ~370 ms more,
// for 2–3 KB. Inside the page it paints with the first frame. Uploaded SVGs are
// sanitised (lib/sanitizeSvg), and an <img> never runs an SVG's scripts anyway.
import { mediaBucket, uploadKey } from "@/lib/media";

const MAX_BYTES = 8 * 1024; // past this the HTML grows more than the request costs

export async function inlineHeroSvg(href: string): Promise<string | null> {
  if (!/\.svg$/i.test(href.replace(/[?#].*$/, ""))) return null;
  const key = uploadKey(href);
  if (!key) return null;
  try {
    const obj = await mediaBucket().get(key);
    if (!obj || obj.size > MAX_BYTES) return null;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `data:image/svg+xml;base64,${btoa(bin)}`;
  } catch {
    return null; // the link stays as it was
  }
}
