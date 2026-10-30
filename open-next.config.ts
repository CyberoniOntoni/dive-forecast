import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is rendered per request, so there is no incremental (ISR) cache to keep.
export default defineCloudflareConfig({});
