// After a deploy: opens every page in the sitemap once, so the first real visitor
// gets a saved copy instead of waiting for a render (astro/src/middleware.ts).
//   node deploy/warm.mjs https://example.com
const site = process.argv[2];
if (!site) process.exit(0);
const get = (u) => fetch(u, { headers: { "user-agent": "BMS-deploy-warm" } });
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

const urls = new Set([site + "/"]);
const queue = [site + "/sitemap_index.xml"];
while (queue.length) {
  const res = await get(queue.pop()).catch(() => null);
  if (!res?.ok) continue;
  for (const loc of locs(await res.text())) {
    if (loc.endsWith(".xml")) queue.push(loc);
    else urls.add(loc);
  }
}
const all = [...urls];
let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (all.length) {
    const res = await get(all.pop()).catch(() => null);
    await res?.arrayBuffer().catch(() => null);
    done++;
  }
}));
console.log(`Warmed ${done} pages.`);
