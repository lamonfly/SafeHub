import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 5 MB JSON vendor list: load with Node at runtime instead of bundling it.
  serverExternalPackages: ["oui-data"],
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
