import type { NextConfig } from "next";

// Static export for GitHub Pages hosting: no runtime server, no API routes.
// All data paths are client-side (wallet + RPC + subgraph) by design — see
// docs/redaction-hydration-spec.md §4. `isUiBuild` lets the workspace CI build
// (which checks @soulvault/node typechecks) run without export-only flags.
const isUiBuild = process.env.SOULVAULT_WEB_EXPORT === "1";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source directly; Next compiles them.
  transpilePackages: ["@soulvault/protocol", "@soulvault/node"],
  ...(isUiBuild && {
    output: "export" as const,
    trailingSlash: true,
    images: { unoptimized: true },
    basePath: "/soulvault",
    assetPrefix: "/soulvault/",
  }),
};

export default nextConfig;
