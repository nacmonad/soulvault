import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source directly; Next compiles them.
  transpilePackages: ["@soulvault/protocol", "@soulvault/node"],
};

export default nextConfig;
