// Stands in for @opennextjs/cloudflare: the same bindings, read Astro's way,
// and the request's waitUntil so work started during a render (lib/cssStore
// saving a stylesheet to R2) finishes after the response is sent.
import * as workers from "cloudflare:workers";

export function getCloudflareContext() {
  const waitUntil = (workers as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  return { env: workers.env, ctx: waitUntil ? { waitUntil } : undefined, cf: undefined };
}
