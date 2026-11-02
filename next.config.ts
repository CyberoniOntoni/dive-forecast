import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // A site photo is shrunk in the browser to at most 1.5 MB (lib/site-photos.ts MAX_PHOTO_BYTES); room for the form.
    serverActions: { bodySizeLimit: "2mb" },
  },
  async redirects() {
    // The scoreboard was first published at /leaderboard; old links keep working.
    return [{ source: "/leaderboard", destination: "/scoreboard", statusCode: 301 }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;