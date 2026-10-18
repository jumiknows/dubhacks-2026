import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@emberready/domain", "@emberready/data"],
};

export default nextConfig;
