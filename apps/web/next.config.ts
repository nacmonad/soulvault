import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

function transformersWebEntry() {
  const candidates = [
    new URL("../../packages/presidio-adapter/node_modules/@huggingface/transformers/dist/transformers.web.js", import.meta.url),
    new URL("../../node_modules/@huggingface/transformers/dist/transformers.web.js", import.meta.url),
  ];
  for (const url of candidates) {
    const file = fileURLToPath(url);
    if (existsSync(file)) return file;
  }
  return false as const;
}

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
  // Native/ledger packages must stay out of server bundles: webpack snapshots
  // the Linux prebuilt binary paths, which then fail to resolve on macOS
  // (node-gyp-build: "No native build was found for platform=darwin").
  // Node resolves these at runtime instead.
  serverExternalPackages: [
    "@0gfoundation/0g-ts-sdk",
    "@ledgerhq/device-management-kit",
    "@ledgerhq/device-signer-kit-ethereum",
    "@ledgerhq/device-transport-kit-node-hid",
    "@ledgerhq/context-module",
    "node-hid",
  ],
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
    // Hugging Face transformers' Node entry pulls onnxruntime-node. The
    // dashboard worker is browser-only (onnxruntime-web + transformers.web).
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node": false,
      "@huggingface/transformers": transformersWebEntry(),
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
      os: false,
      child_process: false,
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
