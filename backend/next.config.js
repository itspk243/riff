/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Serve the static landing page (public/index.html) at the root path.
    // Without this, Next.js routing returns 404 at / because there's no pages/index.tsx.
    return [
      { source: '/', destination: '/index.html' },
    ];
  },
  async headers() {
    return [
      {
        // Allow extension to call API endpoints from chrome-extension://
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
