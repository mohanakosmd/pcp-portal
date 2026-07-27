import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A production build and a running `next dev` both write `.next`, and on
  // Windows the dev server's file locks make the build fail (EPERM on
  // .next/trace, then phantom "Cannot find module for page" errors). Set
  // NEXT_DIST_DIR to build into a separate folder without stopping dev:
  //   NEXT_DIST_DIR=.next-build npm run build
  // Unset everywhere else — App Hosting's cloud build still uses `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
