import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
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