/** @type {import('next').NextConfig} */
const nextConfig = {
  // API 서버로 프록시 (CORS 우회)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
