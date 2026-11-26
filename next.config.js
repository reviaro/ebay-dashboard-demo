// next.config.js is evaluated before Next loads .env files for the app, so
// load them here for DEV_ALLOWED_ORIGINS below.
require('@next/env').loadEnvConfig(__dirname);

const devAllowedOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Every request passes through `src/proxy.ts`, and Next buffers a proxied
   * body only up to 10 MB by default -- silently truncating the rest. Listing
   * photos are accepted up to 20 MB (`/api/listings/assets`), so the buffer
   * must be at least that; each handler still enforces its own smaller limit.
   */
  experimental: { proxyClientMaxBodySize: '21mb' },

  /**
   * Origins allowed to request dev-server assets (`/_next/*`) and the HMR
   * WebSocket.
   *
   * Next 16 refuses these with a bare `403 Unauthorized` when the `Origin`
   * header is not on this list, and only `localhost` is permitted by default.
   * Browsing the dev server from another machine therefore renders the HTML
   * but refuses every JS chunk: React never hydrates, and the page looks alive
   * but is inert -- a login form whose button never enables. The HMR socket
   * fails the same way (`web-socket.ts` "WebSocket connection failed").
   *
   * Add the hosts you browse from to DEV_ALLOWED_ORIGINS in `.env.local`
   * (comma-separated hostnames or IPs; `*.example.com` wildcards allowed).
   * They are machine-specific, so they never belong in this file.
   *
   * DEV ONLY. `next start` ignores this, so production is unaffected.
   */
  allowedDevOrigins: ['localhost', '127.0.0.1', ...devAllowedOrigins],
};

module.exports = nextConfig;
