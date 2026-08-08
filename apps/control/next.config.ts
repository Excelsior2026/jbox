import type { NextConfig } from 'next';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Deliberately minimal. Every allowance here is a hole, so provider domains
 * (Clerk, Stripe, blob storage) get added as those integrations actually land
 * rather than pre-emptively.
 *
 * 'unsafe-eval' is development-only — Next's dev overlay needs it and
 * production must not have it.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Emits a self-contained Node server with only the dependencies it actually
  // uses, so the container image does not carry the whole monorepo's
  // node_modules. Required for running this as a long-lived process rather
  // than as per-request functions.
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ],
    }];
  },
};

export default nextConfig;
