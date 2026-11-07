// Per-page stylesheets under content-hashed names: `s-<hash>` for the trimmed
// site stylesheet, `f-<hash>` for the font faces (SiteLayout writes them; the
// page carries a <link> to /site/<name>.css).
//
// On Node, server.js inlined those links from files on disk. On Cloudflare
// there is no disk and no server.js, so each sheet is kept twice:
//   • in this isolate's memory, where the Astro page that rendered it inlines
//     it into the HTML straight away (astro/src/lib/inlineCss.ts), and
//   • in the site's R2 bucket under `_css/`, where /site/<name>.css finds it
//     for any later request, from any isolate.
// The names are content hashes, so nothing stored can ever be stale.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createHash } from "node:crypto";
import { mediaBucket } from "@/lib/media";

const NAME = /^[sf]-[a-f0-9]{8,40}$/;
const key = (name: string) => `_css/${name}.css`;
const memory = new Map<string, string>();
const MAX_IN_MEMORY = 200;

/** A content-hashed name for `css` (or for a hash already worked out). */
export function cssName(prefix: "s" | "f", css: string, hash?: string): string {
  return `${prefix}-${hash ?? createHash("sha1").update(css).digest("hex").slice(0, 16)}`;
}

/** Keeps `css` under `name`: in memory now, and in R2 once (in the background). */
export function storeCss(name: string, css: string): void {
  if (!NAME.test(name) || memory.has(name)) return;
  if (memory.size >= MAX_IN_MEMORY) memory.delete(memory.keys().next().value!);
  memory.set(name, css);
  const job = (async () => {
    const bucket = mediaBucket();
    if (await bucket.head(key(name))) return;
    await bucket.put(key(name), new TextEncoder().encode(css), { httpMetadata: { contentType: "text/css; charset=utf-8" } });
  })().catch(() => memory.delete(name)); // tried again on the next render
  try {
    (getCloudflareContext().ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined)?.waitUntil?.(job);
  } catch {
    // Outside a request: the promise simply runs.
  }
}

/** A sheet this isolate rendered, without waiting for R2. */
export function memoryCss(name: string): string | null {
  return NAME.test(name) ? memory.get(name) ?? null : null;
}

/** A stored sheet by name, from memory or R2; null when it was never written. */
export async function readStoredCss(name: string): Promise<string | null> {
  if (!NAME.test(name)) return null;
  const hit = memory.get(name);
  if (hit !== undefined) return hit;
  const obj = await mediaBucket().get(key(name)).catch(() => null);
  return obj ? new TextDecoder().decode(await obj.arrayBuffer()) : null;
}
