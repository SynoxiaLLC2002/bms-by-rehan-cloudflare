// Plugins: tools uploaded as a zip and placed with a shortcode.
//
// A plugin is a folder of HTML, CSS and JavaScript that runs in the visitor's
// browser — a calculator, a converter, a checker. It is installed from a zip
// in Admin → Plugins, lives in the site's R2 bucket (see R2_PREFIX), and is placed in
// content with `[slug]` (in a paragraph or an HTML block) or the Plugin
// block. No rebuild, no upload of the site: the same experience as a
// WordPress plugin, for the kind of plugin that does not need a server.
//
// How one is rendered, and why:
//
//   • Its HTML is written into the page on the server, inside a declarative
//     shadow root. The markup is therefore in the response — search engines
//     and readers without JavaScript see it — and its CSS cannot leak into
//     the theme or be broken by the theme.
//   • Its script is loaded once per page as a module (browsers deduplicate a
//     module by URL) and registers a mount function with a tiny runtime,
//     which calls it for every instance on the page with the element and a
//     context: settings, shortcode attributes, the site's language.
//   • Everything a plugin needs from the site is passed in; nothing is
//     reached for. That is what keeps a plugin working across versions.
//
// Plugin code is trusted the way an administrator's HTML block is trusted:
// only administrators can install one, and it runs with the page. The file
// rules below stop a zip from writing outside its folder or shipping
// anything that is not a static asset.

import path from "node:path";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plugins } from "@/lib/db/schema";
import { sanitizeSvg } from "@/lib/sanitizeSvg";
import { mediaBucket } from "@/lib/media";
import { bumpEdgeCache } from "@/lib/edgeCache";

// Cloudflare has no disk: a plugin's files live in the site's R2 bucket under
// `_plugins/<slug>/<dir>/`, where <dir> is a fresh folder per install. R2 has
// no rename, so an upgrade writes the new folder in full, points the database
// row at it (manifest.dir), and only then deletes the old one — an error
// partway leaves the working version in place. `_plugins/` is never served as
// an upload (cf-worker keyOf, lib/media uploadKey); app/plugins/[slug]/[...file]
// serves the files.
const R2_PREFIX = "_plugins/";
const DIR = /^[a-z0-9-]{1,40}$/;
/** R2 folder of a plugin's current files, ending in "/". */
function filesPrefix(slug: string, dir: unknown): string {
  return `${R2_PREFIX}${slug}/${typeof dir === "string" && DIR.test(dir) ? `${dir}/` : ""}`;
}

export const PLUGIN_FILE_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Deletes every R2 object under a prefix. */
async function deletePrefix(prefix: string): Promise<void> {
  const bucket = mediaBucket();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export const MAX_ZIP_BYTES = 5 * 1024 * 1024;
/** What a plugin may expand to on disk — see installPluginZip. */
export const MAX_UNPACKED_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".woff2", ".woff", ".ico"]);
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * A filename a plugin's manifest may point at, or null.
 *
 * `entry.html`, `entry.css` and `entry.js` are read from disk with
 * `path.join(pluginDir, name)`, so they decide which file the server opens.
 * They arrived from `plugin.json` unchecked, and only `entry.html` was looked
 * at during install — and then only to confirm the zip contained something by
 * that name. `entry.css` and `entry.js` were never examined at all, so
 *
 *     { "slug": "x", "name": "x", "entry": { "css": "../../.env" } }
 *
 * installed cleanly, and every page carrying that plugin's shortcode then
 * embedded the app's environment file — DATABASE_URL, AUTH_SECRET, SMTP_PASS —
 * inside a <style> tag, in public HTML.
 *
 * Plugins are admin-installed, but that is the whole point of the boundary:
 * installing somebody else's plugin must not hand them the database password.
 *
 * Accepts a plain relative path inside the plugin folder, with an extension the
 * installer would have allowed. No leading slash, no `..`, no backslash (a
 * separator on Windows), no dotfiles.
 */
function safeEntryPath(name: unknown, allowed: readonly string[]): string | null {
  if (typeof name !== "string") return null;
  const v = name.trim();
  if (!v || v.length > 200) return null;
  if (v.startsWith("/") || v.startsWith(".") || v.includes("..") || v.includes("\\") || v.includes("//")) return null;
  if (path.isAbsolute(v)) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(v) || v.includes("/.")) return null;
  return allowed.includes(path.extname(v).toLowerCase()) ? v : null;
}

/** The manifest's entry block, with every filename checked. */
function safeEntry(raw: unknown): PluginManifest["entry"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const e = raw as Record<string, unknown>;
  const html = safeEntryPath(e.html, [".html"]);
  const css = safeEntryPath(e.css, [".css"]);
  const js = safeEntryPath(e.js, [".js", ".mjs"]);
  if (!html && !css && !js) return undefined;
  return { ...(html ? { html } : {}), ...(css ? { css } : {}), ...(js ? { js } : {}) };
}

export type SettingType = "text" | "number" | "select" | "toggle" | "color" | "textarea";

export interface PluginSetting {
  key: string;
  label: string;
  type: SettingType;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface PluginManifest {
  slug: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Files, relative to the plugin folder. Defaults: index.html, style.css, script.js. */
  entry?: { html?: string; css?: string; js?: string };
  /** Shortcode attributes the plugin understands, for the editor's hint. */
  attributes?: { name: string; label?: string; default?: string }[];
  settings?: PluginSetting[];
  /** A CSS min-height for the container while the script boots, e.g. "320px". */
  minHeight?: string;
  /** Set by the installer, never read from plugin.json: the R2 folder of this install. */
  dir?: string;
}

export interface InstalledPlugin {
  slug: string;
  name: string;
  version: string;
  description: string | null;
  enabled: boolean;
  manifest: PluginManifest;
  settings: Record<string, unknown>;
}

export function manifestFrom(raw: unknown): PluginManifest | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "plugin.json must be a JSON object." };
  const m = raw as Record<string, unknown>;
  const slug = String(m.slug ?? "").trim().toLowerCase();
  if (!SLUG.test(slug)) return { error: 'plugin.json needs a "slug": lowercase letters, digits and dashes, e.g. "bmi-calculator".' };
  const name = String(m.name ?? "").trim();
  if (!name) return { error: 'plugin.json needs a "name".' };
  const version = String(m.version ?? "1.0.0").trim() || "1.0.0";
  const settings: PluginSetting[] = Array.isArray(m.settings)
    ? (m.settings as unknown[])
        .map((s) => (typeof s === "object" && s ? (s as Record<string, unknown>) : null))
        .filter((s): s is Record<string, unknown> => !!s && typeof s.key === "string" && /^[a-zA-Z_][\w-]{0,40}$/.test(s.key as string))
        .map((s) => ({
          key: s.key as string,
          label: String(s.label ?? s.key),
          type: (["text", "number", "select", "toggle", "color", "textarea"].includes(String(s.type)) ? String(s.type) : "text") as SettingType,
          default: s.default as string | number | boolean | undefined,
          options: Array.isArray(s.options) ? (s.options as { value: string; label: string }[]).filter((o) => o && typeof o.value === "string") : undefined,
          help: typeof s.help === "string" ? s.help : undefined,
        }))
    : [];
  return {
    slug,
    name,
    version,
    description: typeof m.description === "string" ? m.description.slice(0, 500) : undefined,
    author: typeof m.author === "string" ? m.author.slice(0, 120) : undefined,
    homepage: typeof m.homepage === "string" && /^https?:\/\//.test(m.homepage) ? m.homepage : undefined,
    entry: safeEntry(m.entry),
    attributes: Array.isArray(m.attributes) ? (m.attributes as PluginManifest["attributes"]) : undefined,
    settings,
    minHeight: typeof m.minHeight === "string" && /^[\d.]+(px|rem|em|vh)$/.test(m.minHeight) ? m.minHeight : undefined,
  };
}

/**
 * Installs (or upgrades) a plugin from zip bytes. Returns the manifest.
 *
 * The zip may have everything at its root or inside one top-level folder —
 * both are what people produce. Every path is checked against the rules
 * above before a byte is written, so a zip cannot escape its own folder.
 */
export async function installPluginZip(bytes: Uint8Array): Promise<PluginManifest> {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error(`The zip is larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB.`);
  const zip = await JSZip.loadAsync(bytes);

  // Find plugin.json — at the root, or one folder down.
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  let prefix = "";
  let manifestName: string | undefined = names.find((n) => n === "plugin.json");
  if (!manifestName) {
    const nested = names.find((n) => /^[^/]+\/plugin\.json$/.test(n));
    if (nested) {
      manifestName = nested;
      prefix = nested.slice(0, nested.indexOf("/") + 1);
    }
  }
  if (!manifestName) throw new Error("The zip has no plugin.json.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(await zip.files[manifestName].async("string"));
  } catch {
    throw new Error("plugin.json is not valid JSON.");
  }
  const manifest = manifestFrom(parsed);
  if ("error" in manifest) throw new Error(manifest.error);

  const entryHtml = manifest.entry?.html ?? "index.html";
  if (!names.includes(prefix + entryHtml)) throw new Error(`The zip has no ${entryHtml} (the plugin's HTML).`);

  // Validate every path first; write nothing until all pass.
  const files: { rel: string; entry: JSZip.JSZipObject }[] = [];
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (!rel || rel.startsWith(".") || rel.includes("/.") || rel.includes("..") || path.isAbsolute(rel)) continue;
    if (rel.startsWith("__MACOSX")) continue;
    const ext = path.extname(rel).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new Error(`"${rel}" is not an allowed file type. Plugins may contain HTML, CSS, JS, JSON, images and fonts.`);
    files.push({ rel, entry: zip.files[n] });
  }
  if (files.length > 300) throw new Error("A plugin may contain at most 300 files.");

  // Written to a new R2 folder; the row is pointed at it only once every file
  // is there (see R2_PREFIX above), so a failed upgrade keeps the old version.
  manifest.dir = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const staging = filesPrefix(manifest.slug, manifest.dir);
  const bucket = mediaBucket();
  try {
    let unpacked = 0;
    for (const f of files) {
      let data = await f.entry.async("uint8array");
      // The zip limit bounds the download, not what it expands to; a small
      // zip of highly compressible files could otherwise fill the bucket.
      unpacked += data.length;
      if (unpacked > MAX_UNPACKED_BYTES) {
        throw new Error(`The plugin unpacks to more than ${MAX_UNPACKED_BYTES / 1024 / 1024} MB.`);
      }
      const ext = path.extname(f.rel).toLowerCase();
      if (ext === ".svg") {
        const clean = sanitizeSvg(new TextDecoder().decode(data));
        if (!clean) throw new Error(`"${f.rel}" is not a valid SVG.`);
        data = new TextEncoder().encode(clean.svg);
      }
      await bucket.put(staging + f.rel, data, { httpMetadata: { contentType: PLUGIN_FILE_TYPES[ext] ?? "application/octet-stream" } });
    }
  } catch (e) {
    await deletePrefix(staging).catch(() => undefined);
    throw e;
  }

  // Keep existing settings across an upgrade; drop keys the new manifest no longer has.
  const existing = await db.query.plugins.findFirst({ where: eq(plugins.slug, manifest.slug), columns: { settings: true, enabled: true, manifest: true } });
  let oldDir: unknown;
  try {
    oldDir = existing ? (JSON.parse(existing.manifest) as PluginManifest).dir : undefined;
  } catch {
    oldDir = undefined;
  }
  const keep: Record<string, unknown> = {};
  if (existing) {
    try {
      const old = JSON.parse(existing.settings) as Record<string, unknown>;
      for (const s of manifest.settings ?? []) if (s.key in old) keep[s.key] = old[s.key];
    } catch {
      // Unreadable old settings — start clean.
    }
  }

  await db
    .insert(plugins)
    .values({
      slug: manifest.slug,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      enabled: existing?.enabled ?? true,
      manifest: JSON.stringify(manifest),
      settings: JSON.stringify(keep),
    })
    .onConflictDoUpdate({ target: plugins.slug, set: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? null,
        manifest: JSON.stringify(manifest),
        settings: JSON.stringify(keep),
        updatedAt: new Date(),
      },
    });

  // Only a real old folder: an empty prefix here would be the whole plugin, new files included.
  if (typeof oldDir === "string" && DIR.test(oldDir) && oldDir !== manifest.dir) {
    await deletePrefix(filesPrefix(manifest.slug, oldDir)).catch(() => undefined);
  }
  invalidatePluginCache();
  return manifest;
}

export async function uninstallPlugin(slug: string): Promise<void> {
  if (!SLUG.test(slug)) return;
  await db.delete(plugins).where(eq(plugins.slug, slug));
  await deletePrefix(`${R2_PREFIX}${slug}/`);
  invalidatePluginCache();
}

// ── Reading, for rendering ────────────────────────────────────────────────────

interface Loaded {
  plugin: InstalledPlugin;
  html: string;
  css: string;
  hasJs: boolean;
  jsFile: string;
}

let cache: { at: number; byslug: Map<string, Loaded | null> } | null = null;
// Short: each Worker isolate keeps its own copy, and only the one that saved
// is cleared. Pages themselves are cached at the edge, so renders are rare.
const CACHE_MS = 3_000;

/**
 * Enable/disable, or save settings: `{ enabled?, settings? }`. False when no
 * such plugin is installed. Used by the admin (api/plugins/[slug]) and by a
 * token with the "plugins" scope (lib/mcpServer.ts).
 */
export async function updatePlugin(slug: string, body: { enabled?: unknown; settings?: unknown }): Promise<boolean> {
  const row = await db.query.plugins.findFirst({ where: eq(plugins.slug, slug) });
  if (!row) return false;

  const set: Partial<typeof plugins.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.enabled === "boolean") set.enabled = body.enabled;
  if (body.settings && typeof body.settings === "object") {
    const given = body.settings as Record<string, unknown>;
    // Only keys the manifest declares, coerced to the declared type.
    const manifest = JSON.parse(row.manifest) as PluginManifest;
    const clean: Record<string, unknown> = {};
    for (const s of manifest.settings ?? []) {
      if (!(s.key in given)) continue;
      const v = given[s.key];
      if (s.type === "toggle") clean[s.key] = !!v;
      else if (s.type === "number") clean[s.key] = Number.isFinite(Number(v)) ? Number(v) : 0;
      else if (s.type === "select") clean[s.key] = s.options?.some((o) => o.value === String(v)) ? String(v) : (s.default ?? "");
      else clean[s.key] = String(v ?? "").slice(0, 5000);
    }
    set.settings = JSON.stringify(clean);
  }
  await db.update(plugins).set(set).where(eq(plugins.slug, slug));
  invalidatePluginCache();
  return true;
}

export function invalidatePluginCache() {
  cache = null;
  bumpEdgeCache(); // cached public pages carry the plugin's HTML (or its bare [slug])
}

function rowToPlugin(row: typeof plugins.$inferSelect): InstalledPlugin | null {
  let manifest: PluginManifest;
  let settings: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(row.manifest) as PluginManifest;
    settings = JSON.parse(row.settings || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }
  return { slug: row.slug, name: row.name, version: row.version, description: row.description, enabled: row.enabled, manifest, settings };
}

/** The R2 key of an installed plugin's file (enabled or not), or null. For app/plugins/[slug]/[...file]. */
export async function pluginFileKey(slug: string, rel: string): Promise<string | null> {
  if (!SLUG.test(slug)) return null;
  const row = await db.query.plugins.findFirst({ where: eq(plugins.slug, slug), columns: { manifest: true } });
  if (!row) return null;
  try {
    return filesPrefix(slug, (JSON.parse(row.manifest) as PluginManifest).dir) + rel;
  } catch {
    return null;
  }
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
  const rows = await db.query.plugins.findMany({ orderBy: (p, { asc }) => [asc(p.name)] });
  return rows.map(rowToPlugin).filter((p): p is InstalledPlugin => !!p);
}

/** An enabled plugin with its files read, or null. Cached briefly per process. */
export async function loadPlugin(slug: string): Promise<Loaded | null> {
  if (!SLUG.test(slug)) return null;
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_MS) cache = { at: now, byslug: new Map() };
  if (cache.byslug.has(slug)) return cache.byslug.get(slug)!;

  let loaded: Loaded | null = null;
  try {
    const row = await db.query.plugins.findFirst({ where: eq(plugins.slug, slug) });
    const plugin = row ? rowToPlugin(row) : null;
    if (plugin && plugin.enabled) {
      const dir = filesPrefix(slug, plugin.manifest.dir);
      const bucket = mediaBucket();
      // Re-checked here, not trusted from the row. `manifestFrom` guards what
      // an *install* accepts, but this manifest is JSON that was stored
      // earlier — anything installed before that guard existed, or written to
      // the table by any other means, would arrive here unexamined. This is
      // the call that actually opens a file, so this is where it has to hold.
      const e = safeEntry(plugin.manifest.entry) ?? {};
      const read = async (f: string | undefined, fallback: string) => {
        const obj = await bucket.get(dir + (f ?? fallback)).catch(() => null);
        return obj ? new TextDecoder().decode(await obj.arrayBuffer()) : "";
      };
      const jsFile = e.js ?? "script.js";
      const hasJs = !!(await bucket.head(dir + jsFile).catch(() => null));
      loaded = { plugin, html: await read(e.html, "index.html"), css: await read(e.css, "style.css"), hasJs, jsFile };
    }
  } catch {
    loaded = null;
  }
  cache.byslug.set(slug, loaded);
  return loaded;
}

/** Effective settings: manifest defaults overlaid with what the admin saved. */
export function effectiveSettings(p: InstalledPlugin): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of p.manifest.settings ?? []) out[s.key] = s.default ?? (s.type === "toggle" ? false : s.type === "number" ? 0 : "");
  for (const [k, v] of Object.entries(p.settings)) if (k in out) out[k] = v;
  return out;
}

// ── Shortcodes ────────────────────────────────────────────────────────────────

export interface Shortcode {
  slug: string;
  attrs: Record<string, string>;
}

const SHORTCODE = /\[([a-z0-9][a-z0-9-]{1,62})((?:\s+[a-zA-Z_][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s\]]+))?)*)\s*\]/g;

/** Every `[slug attr="value"]` in a string, in order. */
export function findShortcodes(text: string): { match: string; index: number; code: Shortcode }[] {
  const out: { match: string; index: number; code: Shortcode }[] = [];
  for (const m of text.matchAll(SHORTCODE)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[2] ?? "").matchAll(/([a-zA-Z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?/g)) {
      attrs[a[1]] = (a[2] ?? a[3] ?? a[4] ?? "true").slice(0, 500);
    }
    out.push({ match: m[0], index: m.index ?? 0, code: { slug: m[1], attrs } });
  }
  return out;
}

/** True when the whole (trimmed) text is exactly one shortcode. */
export function soleShortcode(text: string): Shortcode | null {
  const t = text.trim();
  const found = findShortcodes(t);
  return found.length === 1 && found[0].match === t ? found[0].code : null;
}

// ── Rendering to HTML ─────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The plugin's container as an HTML string: a declarative shadow root with
 * its CSS and HTML, plus the runtime and its script (once per page — both are
 * modules, and browsers run a module URL once).
 *
 * Attributes and settings ride on the element as JSON, which is how the
 * script's mount function receives them. `lang`/`dir` come along so a tool
 * can lay itself out for an Arabic site.
 */
export function pluginContainerHtml(loaded: Loaded, code: Shortcode, ctx: { lang: string; dir: "ltr" | "rtl" }): string {
  const { plugin } = loaded;
  const settings = effectiveSettings(plugin);
  const data = esc(JSON.stringify({ settings, attrs: code.attrs, lang: ctx.lang, dir: ctx.dir, version: plugin.version }));
  const minH = plugin.manifest.minHeight ? ` style="min-height:${plugin.manifest.minHeight}"` : "";
  const base = `/plugins/${plugin.slug}/`;
  const scripts = loaded.hasJs
    ? `<script type="module" src="/bms-plugins.js"></script><script type="module" src="${base}${esc(loaded.jsFile)}?v=${encodeURIComponent(plugin.version)}"></script>`
    : "";
  return (
    `<div class="bms-plugin" data-plugin="${plugin.slug}" data-bms="${data}" data-base="${base}" lang="${esc(ctx.lang)}" dir="${ctx.dir}"${minH}>` +
    `<template shadowrootmode="open"><style>:host{display:block;contain:content}${loaded.css}</style>${loaded.html}</template>` +
    `</div>${scripts}`
  );
}

/**
 * Replaces every shortcode in raw HTML (an HTML block, an element) with its
 * plugin, leaving unknown or disabled ones as they were — an author sees the
 * literal `[thing]` and knows what to fix.
 */
export async function expandShortcodes(html: string, ctx: { lang: string; dir: "ltr" | "rtl" }): Promise<string> {
  if (!html.includes("[")) return html;
  const found = findShortcodes(html);
  if (found.length === 0) return html;
  let out = "";
  let last = 0;
  for (const f of found) {
    const loaded = await loadPlugin(f.code.slug);
    out += html.slice(last, f.index);
    out += loaded ? pluginContainerHtml(loaded, f.code, ctx) : f.match;
    last = f.index + f.match.length;
  }
  return out + html.slice(last);
}
