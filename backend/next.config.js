/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Serve the static landing page (public/index.html) at the root path,
    // and the static legal pages at /privacy + /terms (they live as .html
    // in /public, which Next.js does NOT auto-route without rewrites).
    return [
      { source: '/', destination: '/index.html' },
      { source: '/privacy', destination: '/privacy.html' },
      { source: '/terms', destination: '/terms.html' },
      { source: '/security', destination: '/security.html' },
      { source: '/roast', destination: '/roast.html' },
      { source: '/brand', destination: '/brand/index.html' },
      { source: '/pricing', destination: '/index.html#pricing' },
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
