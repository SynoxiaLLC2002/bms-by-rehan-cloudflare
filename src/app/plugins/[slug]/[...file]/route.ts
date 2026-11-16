import { NextResponse } from "next/server";
import path from "node:path";
import { mediaBucket } from "@/lib/media";
import { PLUGIN_FILE_TYPES, pluginFileKey } from "@/lib/plugins";

/**
 * Serves an installed plugin's files: /plugins/<slug>/<file>, read from the
 * site's R2 bucket (lib/plugins.ts says where). Paths are confined to the
 * plugin's folder; anything that tries to leave it is a 404, not a traversal.
 */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; file: string[] }> }) {
  const { slug, file } = await params;
  if (!Array.isArray(file) || file.length === 0) return notFound();
  const rel = file.join("/");
  if (rel.includes("..") || rel.startsWith("/") || rel.startsWith(".") || rel.includes("/.") || rel.includes("\\")) return notFound();
  const type = PLUGIN_FILE_TYPES[path.extname(rel).toLowerCase()];
  if (!type) return notFound();

  const key = await pluginFileKey(slug, rel);
  const obj = key ? await mediaBucket().get(key).catch(() => null) : null;
  if (!obj) return notFound();
  return new NextResponse(obj.body, {
    headers: {
      "Content-Type": type,
      // Scripts are versioned by ?v= on their URL, so a day is safe.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
