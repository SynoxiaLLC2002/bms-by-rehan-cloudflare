import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// shortcut: no incremental cache yet (spike); add the R2 cache when pages are cached for real.
export default defineCloudflareConfig({});
