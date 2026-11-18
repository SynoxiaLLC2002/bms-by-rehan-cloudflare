// The public site of BMS on Cloudflare, rendered by Astro from BMS's own
// components and database code (../src). The admin stays in Next (../).
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const shim = (name, file) => ({ find: new RegExp(`^${name.replace(/[/.]/g, "\$&")}$`), replacement: at(`./shims/${file}`) });

// scripts/vanilla.ts as one minified string (virtual:bms-vanilla), for
// pages/[...path].astro to write into the page: the menu and the accordion then
// cost no request. esbuild comes with @opennextjs/cloudflare.
const vanillaScript = () => ({
  name: "bms-vanilla-script",
  resolveId: (id) => (id === "virtual:bms-vanilla" ? "\0virtual:bms-vanilla" : null),
  async load(id) {
    if (id !== "\0virtual:bms-vanilla") return null;
    const entry = at("./src/scripts/vanilla.ts");
    this.addWatchFile(entry);
    const out = await esbuild({ entryPoints: [entry], bundle: true, minify: true, format: "iife", target: "es2020", legalComments: "none", write: false });
    // Inside <script>: a "</script" in a string would end the element early.
    const code = out.outputFiles[0].text.trim().replace(/<\/(script)/gi, "<\\/$1");
    return `export default ${JSON.stringify(code)};`;
  },
});

// The Tailwind classes a page can gain after load (virtual:bms-tw-safelist), for src/lib/twTrim.ts to
// keep when it trims Tailwind to the page: the quoted strings of every "use client" file (the same scan
// as ../scripts/tw-safelist.mjs, which does this for server.js) plus every string in this edition's own
// scripts (vanilla.ts toggles classes with no React). Over-inclusive on purpose: a stray word costs bytes.
const SAFELIST_ROOTS = ["src/components/frontend", "src/components/shared", "src/app/(site)", "src/app/(author)", "src/lib"];
const SAFELIST_ALWAYS = ["is-open", "is-stuck", "is-shown", "hidden", "sr-only"];
function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (/\.(tsx?|css)$/.test(name)) yield p;
  }
}
const twSafelist = () => ({
  name: "bms-tw-safelist",
  resolveId: (id) => (id === "virtual:bms-tw-safelist" ? "\0virtual:bms-tw-safelist" : null),
  load(id) {
    if (id !== "\0virtual:bms-tw-safelist") return null;
    const STRING = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g;
    const TOKEN = /[!]?[a-zA-Z][\w:./[\]%()#,-]*/g;
    const out = new Set(SAFELIST_ALWAYS);
    const read = (file) => { for (const s of readFileSync(file, "utf8").matchAll(STRING)) for (const m of (s[1] ?? s[2] ?? s[3] ?? "").matchAll(TOKEN)) out.add(m[0]); };
    for (const r of SAFELIST_ROOTS) {
      let dir; try { dir = at(`../${r}`); statSync(dir); } catch { continue; }
      for (const file of walkFiles(dir)) if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(readFileSync(file, "utf8"))) read(file);
    }
    for (const file of walkFiles(at("./src/scripts"))) read(file);
    return `export default ${JSON.stringify([...out])};`;
  },
});

export default defineConfig({
  output: "server",
  // Tailwind (~27 KB) is built as a /_astro/ file and src/middleware.ts puts it into each page trimmed to
  // that page's classes (src/lib/twTrim.ts, ~3 KB): no request before first paint, and not the whole file
  // in every page ("always" pasted all 27 KB, a third of a page's HTML; audits flagged text-to-HTML).
  build: { inlineStylesheets: "never" },
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [vanillaScript(), twSafelist()],
    // Saved pages name this build's scripts; a new deploy must not serve older copies.
    define: { __BMS_BUILD__: JSON.stringify(String(Date.now())) },
    resolve: {
      alias: [
        shim("@/lib/auth", "auth.ts"),
        shim("next/link", "link.tsx"),
        shim("next/dynamic", "dynamic.tsx"),
        shim("next/image", "image.tsx"),
        shim("next/navigation", "navigation.ts"),
        shim("next/headers", "headers.ts"),
        shim("next/cache", "cache.ts"),
        shim("@opennextjs/cloudflare", "cf.ts"),
        { find: /^@\/(.*)$/, replacement: at("../src/$1") },
      ],
    },
    // Tailwind's config and the PostCSS setup live with the Next app.
    css: { postcss: at("..") },
  },
});
