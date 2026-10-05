import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async rewrites() {
    const configuredBackend = process.env.BACKEND_API_ORIGIN?.trim();
    if (process.env.VERCEL_ENV === "production" && !configuredBackend) {
      throw new Error("BACKEND_API_ORIGIN must be set for production deployments.");
    }
    const backend = configuredBackend || "http://127.0.0.1:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/uploads/:path*", destination: `${backend}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
