import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The live route reads the manifest from disk; make sure it ships with the function.
  outputFileTracingIncludes: {
    "/api/deeper": ["./public/demo/manifest.json"],
    "/api/play/walkthrough": ["./public/demo/walkthrough.json"],
  },
};

export default nextConfig;
