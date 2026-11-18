// Tailwind, trimmed to the page: the Cloudflare edition's copy of server.js's trimTailwind (Node edition).
//
// Tailwind builds one stylesheet (~27 KB) for every public page; one measured page used ~3 KB of it.
// A utility rule applies only where its class is on an element, so a rule is kept when every class of
// one of its selectors is in this page's HTML or in the safelist (classes a script or React island can
// add after load: astro.config.mjs builds it from the "use client" files and src/scripts). Over-inclusive
// on purpose: a stray word keeps a rule alive (bytes), never a missing one (a broken page).
// Pure functions, no imports: `node --experimental-strip-types src/lib/twTrim.ts --self-test` checks them.

/** Every class named in the document's class="…" attributes. */
export function classesIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) out.add(c);
  return out;
}

/** Top-level CSS rules, at-rules kept whole (brace counting; Tailwind's output has no braces in strings). */
export function cssRules(css: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { out.push(css.slice(start, i + 1)); start = i + 1; }
  }
  if (start < css.length) out.push(css.slice(start));
  return out;
}

export function trimTailwind(css: string, pageClasses: Set<string>, safelist: Set<string>): string {
  const alive = (cls: string) => pageClasses.has(cls) || safelist.has(cls);
  const keepRule = (rule: string): string => {
    const brace = rule.indexOf("{");
    if (brace < 0) return rule;
    const prelude = rule.slice(0, brace);
    if (/^\s*@/.test(prelude)) {
      // @media / @supports hold rules; @font-face, @keyframes hold declarations.
      if (!/^\s*@(media|supports|layer|container)/.test(prelude)) return rule;
      const inner = cssRules(rule.slice(brace + 1, rule.lastIndexOf("}"))).map(keepRule).filter(Boolean).join("");
      return inner ? `${prelude}{${inner}}` : "";
    }
    const live = prelude.split(",").some((sel) => {
      const classes = [...sel.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\/g, ""));
      return classes.length === 0 || classes.every(alive);
    });
    return live ? rule : "";
  };
  return cssRules(css).map(keepRule).filter(Boolean).join("");
}

if (typeof process !== "undefined" && process.argv?.includes("--self-test")) {
  const css = "*,:before{--tw-x:0}.flex{display:flex}.hidden{display:none}.md\\:flex{x:1}@media (min-width:768px){.md\\:grid{display:grid}.gap-4{gap:1rem}}@font-face{font-family:A}.a.b{c:d}.bmsx .flex{e:f}";
  const page = classesIn('<div class="flex gap-4"><p class="a">x</p></div>');
  const out = trimTailwind(css, page, new Set(["hidden"]));
  const ok = (cond: boolean, what: string) => { if (!cond) { console.error("FAIL", what, "\n", out); process.exit(1); } };
  ok(out.includes("*,:before{--tw-x:0}"), "keeps class-free rules (preflight, variables)");
  ok(out.includes(".flex{display:flex}"), "keeps a class on the page");
  ok(out.includes(".hidden{display:none}"), "keeps a safelisted class");
  ok(!out.includes("md\\:flex"), "drops a class not on the page");
  ok(out.includes("@media (min-width:768px){.gap-4{gap:1rem}}") && !out.includes("md\\:grid"), "trims inside @media and keeps the media rule");
  ok(out.includes("@font-face{font-family:A}"), "keeps @font-face whole");
  ok(!out.includes(".a.b{"), "drops a selector when one of its classes is missing");
  ok(!out.includes(".bmsx .flex"), "drops a descendant selector whose ancestor class is missing");
  console.log("twTrim self-test: ok,", css.length, "->", out.length, "bytes");
}
