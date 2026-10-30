/**
 * Headers on every response. next.config.ts sets them on pages; on Cloudflare, static assets skip Next, so
 * scripts/cf-assets.ts writes the same list into the assets' _headers file.
 * S4: nosniff, DENY, strict-origin-when-cross-origin. No CSP this wave.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];
