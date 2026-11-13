import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  serverExternalPackages: ['ably'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      // Lecteur PDF : le numéro de version est dans l'adresse, ces fichiers ne changent jamais.
      // Gardés en cache sur le téléphone, ils ne se téléchargent qu'une fois.
      {
        source: '/pdfjs/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/pdfjs/:version/:file(.*\\.mjs)',
        headers: [{ key: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
      },
      {
        source: '/pdfjs/:version/wasm/:file(.*\\.wasm)',
        headers: [{ key: 'Content-Type', value: 'application/wasm' }],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
