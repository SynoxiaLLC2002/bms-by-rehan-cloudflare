/** scripts/vanilla.ts, compiled and minified at build (astro.config.mjs), inlined by pages/[...path].astro. */
declare module "virtual:bms-vanilla" {
  const code: string;
  export default code;
}

/** Tailwind classes a page can gain after load, per island (astro.config.mjs), kept by lib/twTrim.ts. */
declare module "virtual:bms-tw-safelist" {
  const safelist: { always: string[]; vanilla: string[]; islands: Record<string, string[]>; all: string[] };
  export default safelist;
}
