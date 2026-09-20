import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  webpack(config) {
    // These packages are optional adapters selected only by dependency code
    // paths we do not use (React Native wallets, Valkey Glide, pretty logging).
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "@valkey/valkey-glide": false,
      "pino-pretty": false,
    };
    return config;
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
