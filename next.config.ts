import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E tests build into a separate folder so they can run while `next dev` is up.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Every page reads per-profile data from SQLite, so the request-time model is simpler here.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
