import type { NextConfig } from "next";

// Static export for GitHub Pages hosting: no runtime server, no API routes.
// All data paths are client-side (wallet + RPC + subgraph) by design — see
// docs/redaction-hydration-spec.md §4. `isUiBuild` lets the workspace CI build
// (which checks @soulvault/node typechecks) run without export-only flags.
const isUiBuild = process.env.SOULVAULT_WEB_EXPORT === "1";
const basePath = isUiBuild ? "/soulvault" : "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // Workspace packages export TypeScript source directly; Next compiles them.
  transpilePackages: ["@soulvault/protocol", "@soulvault/node", "@soulvault/presidio-adapter"],
  // Workspace packages use NodeNext-style `.js` specifiers over `.ts` files
  // (see packages/protocol/src/index.ts). Webpack needs extensionAlias to map
  // those; Turbopack has no equivalent, so dev must stay on webpack
  // (`next dev --webpack`) until the packages ship compiled output.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  ...(isUiBuild && {
    output: "export" as const,
    trailingSlash: true,
    images: { unoptimized: true },
    basePath,
    assetPrefix: `${basePath}/`,
  }),
};

export default nextConfig;
