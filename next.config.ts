import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep file tracing rooted on this app even if a parent folder has another lockfile.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
