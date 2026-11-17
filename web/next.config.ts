import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dedicated QA output avoids the running development instance's .next lock.
  distDir: process.env.JWZZ_PAGINATION_QA === "true" ? ".next-pagination" : ".next",
};
export default nextConfig;
