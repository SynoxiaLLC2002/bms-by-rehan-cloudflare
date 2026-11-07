import { NextResponse } from "next/server";
import path from "node:path";
import { FONT_TYPES, fontKey } from "@/lib/localFonts";
import { mediaBucket } from "@/lib/media";
import { fileCacheHeaders } from "@/lib/lscache";

/**
 * Serves font files from the site's R2 bucket (lib/localFonts): /fonts/g/<hash>.woff2
 * for Google copies, /fonts/custom/<name> for uploads. From R2 on every
 * request rather than `public/`, because the files arrive while the server
 * runs. Cached for a year — the Google names are content hashes and an
 * uploaded font is replaced under a new name, so nothing served here changes.
 * The browser lifetime is the Speed → Browser cache setting.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const { file } = await params;
  if (!Array.isArray(file) || file.length !== 2 || !["g", "custom"].includes(file[0])) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const name = file[1];
  const ext = path.extname(name).toLowerCase();
  const type = FONT_TYPES[ext];
  if (!type || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const obj = await mediaBucket().get(fontKey(`${file[0]}/${name}`));
    if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(obj.body, {
      headers: {
        "Content-Type": type,
        ...(await fileCacheHeaders("fonts")),
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
