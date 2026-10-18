import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@emberready/domain", "@emberready/data"],
};

export default nextConfig;
