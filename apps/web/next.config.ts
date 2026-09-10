import type { NextConfig } from "next";

/**
 * `transpilePackages` lets Next.js compile the source-published `@orbb/ui`
 * workspace package (TS + TSX sources) together with the app, so web and
 * mobile share one token source of truth without a separate build step.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@orbb/ui"],
};

export default nextConfig;
