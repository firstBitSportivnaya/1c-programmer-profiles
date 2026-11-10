import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) return config;
    const builtins = (
      data: { request?: string },
      callback: (error?: null, result?: string) => void,
    ) => {
      if (data.request?.startsWith("node:")) {
        callback(null, `commonjs ${data.request}`);
        return;
      }
      callback();
    };
    config.externals = Array.isArray(config.externals) ? [...config.externals, builtins] : [config.externals, builtins];
    return config;
  },
};

export default nextConfig;
