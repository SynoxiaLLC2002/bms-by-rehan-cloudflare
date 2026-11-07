// The public site of BMS on Cloudflare, rendered by Astro from BMS's own
// components and database code (../src). The admin stays in Next (../).
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

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

export default defineConfig({
  output: "server",
  // First paint waits for no stylesheet request (PageSpeed: render-blocking).
  build: { inlineStylesheets: "always" },
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [vanillaScript()],
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
