import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { cpus: 3 },
  outputFileTracingIncludes: {
    "/api/verify": ["./contracts/afterlight/src/lib.rs", "./contracts/afterlight/Cargo.toml", "./src/scenarios/golden-turn-vectors.json"],
  },
};

export default nextConfig;
