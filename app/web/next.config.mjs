/** @type {import('next').NextConfig} */
// Rewrites are fixed at build time: set VHI_API_INTERNAL before `next build` (the Docker image uses http://api:8000).
const API = process.env.VHI_API_INTERNAL || "http://127.0.0.1:8000";

const nextConfig = {
  // Docker builds a self-contained server (NEXT_STANDALONE=1); local runs use `next start`.
  ...(process.env.NEXT_STANDALONE ? { output: "standalone" } : {}),
  reactStrictMode: true,
  // The browser talks to one origin; Next forwards API, media and live WebSocket calls to the FastAPI service
  // (upgrade requests on a rewrite are proxied too), so the whole demo works through a single port or tunnel.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/ws", destination: `${API}/ws` },
      { source: "/media/:path*", destination: `${API}/media/:path*` },
      { source: "/docs", destination: `${API}/docs` },
      { source: "/openapi.json", destination: `${API}/openapi.json` },
    ];
  },
};

export default nextConfig;
