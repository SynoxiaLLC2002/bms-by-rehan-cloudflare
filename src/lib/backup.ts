// Server-side backups: one zip in the site's R2 bucket under `_backups/` — the
// full content export plus every upload that fits (lib/exportMedia) — keeping
// the newest seven. `_backups/` is never served to visitors (cf-worker.ts).
//
// On Cloudflare the database also has D1's own point-in-time restore (Time
// Travel) and the uploads live durably in R2; this zip is the portable copy
// that imports into any BMS.
//
// Two callers: the cron route (api/backup, BACKUP_TOKEN) and the MCP tools of
// a token given the "backups" scope (lib/mcpServer.ts). Same limits for both.

import JSZip from "jszip";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { buildExport } from "@/lib/exportSite";
import { bundleMedia, isLocalUpload } from "@/lib/exportMedia";
import { mediaBucket } from "@/lib/media";
import { getSiteSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/siteUrl";

const PREFIX = "_backups/";
const BACKUP_NAME = /^backup-[0-9TZ-]+\.zip$/;

/**
 * The shortest gap between two backups, in hours (BACKUP_MIN_HOURS, default 20).
 * Only the newest seven are kept, so with no limit anyone holding the token
 * could replace every real backup in a minute.
 */
const minGapMs = () => Math.max(0, Number(process.env.BACKUP_MIN_HOURS ?? 20) || 0) * 3600_000;

/** One backup at a time per isolate. */
let running = false;

export type BackupResult =
  | { ok: true; file: string; bytes: number; counts: unknown; media: { included: number; missing: number; remote: number; skipped?: string }; removed: string[] }
  | { ok: false; status: 429; error: string; file?: string; retryAfterSeconds: number };

async function stored(): Promise<{ name: string; size: number; uploaded?: Date }[]> {
  const out: { name: string; size: number; uploaded?: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = (await mediaBucket().list({ prefix: PREFIX, cursor, limit: 1000 })) as { objects: { key: string; size: number; uploaded?: Date }[]; truncated: boolean; cursor?: string };
    for (const o of page.objects) {
      const name = o.key.slice(PREFIX.length);
      if (BACKUP_NAME.test(name)) out.push({ name, size: o.size, uploaded: o.uploaded });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Writes one backup, or says why not (one running, or the last too recent). Throws on failure. */
export async function runBackup(): Promise<BackupResult> {
  if (running) return { ok: false, status: 429, error: "A backup is already running.", retryAfterSeconds: 600 };
  running = true;
  try {
    const previous = await stored();
    const newest = previous[previous.length - 1];
    if (newest?.uploaded) {
      const age = Date.now() - new Date(newest.uploaded).getTime();
      if (age < minGapMs()) {
        const wait = Math.ceil((minGapMs() - age) / 60_000);
        return { ok: false, status: 429, error: `The last backup (${newest.name}) is recent. The next one can run in ${wait} minutes.`, file: `backups/${newest.name}`, retryAfterSeconds: wait * 60 };
      }
    }

    const settings = await getSiteSettings();
    const zip = new JSZip();
    const payload = await buildExport(settings, siteUrl(settings));
    // The name Import looks for.
    zip.file("content.json", JSON.stringify(payload, null, 2));

    const rows = await db.select({ url: media.url }).from(media);
    const local = rows.map((r) => r.url).filter(isLocalUpload);
    let bundled = { included: 0, missing: [] as string[], skippedRemote: 0 };
    let skipped: string | undefined;
    try {
      bundled = await bundleMedia(zip, local);
    } catch (e) {
      // Too much media for one Worker's memory: the content still gets backed
      // up, and the files are safe in R2 regardless.
      skipped = e instanceof Error ? e.message : String(e);
      for (const f of Object.keys(zip.files)) if (f.startsWith("uploads/")) zip.remove(f);
    }

    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `backup-${stamp}.zip`;
    await mediaBucket().put(PREFIX + filename, bytes, { httpMetadata: { contentType: "application/zip" } });

    // Keep the newest seven.
    const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 7) || 7);
    const all = await stored();
    const removed = all.slice(0, Math.max(0, all.length - keep)).map((o) => o.name);
    if (removed.length) await mediaBucket().delete(removed.map((n) => PREFIX + n));

    return {
      ok: true,
      file: `backups/${filename}`,
      bytes: bytes.byteLength,
      counts: payload.counts,
      media: { included: bundled.included, missing: bundled.missing.length, remote: bundled.skippedRemote, ...(skipped ? { skipped } : {}) },
      removed,
    };
  } finally {
    running = false;
  }
}

/** The backups kept, newest first. */
export async function listBackups(): Promise<{ file: string; bytes: number; createdAt: string }[]> {
  return (await stored())
    .reverse()
    .map((o) => ({ file: o.name, bytes: o.size, createdAt: (o.uploaded ? new Date(o.uploaded) : new Date(0)).toISOString() }));
}

/** A backup's bytes by its file name, or null. Only a plain name the site itself writes. */
export async function readBackup(file: string): Promise<Uint8Array | null> {
  const name = String(file ?? "").replace(/^backups\//, "");
  if (!BACKUP_NAME.test(name)) return null;
  const obj = await mediaBucket().get(PREFIX + name);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}
