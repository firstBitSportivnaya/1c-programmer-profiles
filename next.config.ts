import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Иначе тело больше 1 МБ обрывается до проверки «файл больше 5 МБ» и форма не получает ошибку.
    serverActions: { bodySizeLimit: 6 * 1024 * 1024 },
  },
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
