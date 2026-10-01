/** @type {import('next').NextConfig} */
// Rewrites are fixed at build time: set VHI_API_INTERNAL before `next build` (the Docker image uses http://api:8000).
const API = process.env.VHI_API_INTERNAL || "http://127.0.0.1:8000";

const nextConfig = {
  // Docker builds a self-contained server (NEXT_STANDALONE=1); local runs use `next start`.
  ...(process.env.NEXT_STANDALONE ? { output: "standalone" } : {}),
  reactStrictMode: true,
  // a second build or dev server next to the running one (e.g. NEXT_DIST_DIR=.next-dev) must not overwrite its files
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Rewrites are proxied with a 30 s timeout by default, which cuts off LLM / vision-language answers while a model is
  // still loading on the GPU (the API itself allows VHI_LLM_TIMEOUT_S, 60 s per call) and turns them into a 500.
  experimental: { proxyTimeout: 180_000 },
  // The browser talks to one origin; Next forwards API, media and live WebSocket calls to the FastAPI service
  // (upgrade requests on a rewrite are proxied too), so the whole demo works through a single port or tunnel.
  // The apps' earlier addresses (bookmarks, QR codes, printed links) open the same screen in its new place; the query
  // string is passed on.
  async redirects() {
    const to = (source, destination) => ({ source, destination, permanent: false });
    return [
      to("/owner", "/mobile"),
      to("/hq", "/oversight/hq"),
      to("/regulator", "/oversight/regulator"),
      to("/sales", "/oversight/sales"),
      to("/sales/:path*", "/oversight/sales/:path*"),
      to("/flood", "/oversight/flood"),
      to("/fleet", "/vehicles"),
      to("/fleet/vehicle/:plate", "/vehicles/:plate?tab=health"),
      to("/vision", "/lane?view=vision"),
    ];
  },
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
