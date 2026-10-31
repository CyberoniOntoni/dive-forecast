import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
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