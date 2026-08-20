import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js dev/HMR and inline styles from Tailwind's runtime need these;
      // tighten further if that changes.
      // 'wasm-unsafe-eval' is what actually permits WebAssembly; some engines
      // accept it under 'unsafe-eval' and some do not, and CanvasKit — which
      // every design tool runs on — fails to compile without it.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // The app and the generator are the same origin now, so the browser
      // still only ever talks back here. blob: is for reading a stored design
      // back out of IndexedDB.
      "connect-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /**
   * The app itself is the Expo web build, served out of public/.
   *
   * It is a single-page build, so every route it owns is index.html resolved
   * on the client. `afterFiles` runs once real files and route handlers have
   * had their turn, so assets and /api/generate are matched first and only
   * genuine client routes fall through to the shell — without which a deep
   * link, or a refresh anywhere but the root, 404s.
   */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/:path((?!api/).*)", destination: "/index.html" },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
