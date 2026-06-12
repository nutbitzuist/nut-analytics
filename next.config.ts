import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["better-sqlite3", "geoip-lite"],
  // Recommended for smaller, optimized Docker images (official Next.js pattern)
  output: "standalone",
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      // Basic CSP — allows the app's own assets and Recharts (inline styles are limited).
      // If you see breakage after deploy, you can relax specific directives.
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';",
      },
    ];

    return [
      {
        source: "/js/script.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
      // Apply security headers to the dashboard UI surfaces
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
