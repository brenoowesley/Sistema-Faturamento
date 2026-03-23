import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },
  serverExternalPackages: ['canvas'],
  turbopack: {}
};

export default nextConfig;
