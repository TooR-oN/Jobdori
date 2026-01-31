/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel 배포를 위한 설정
  output: 'standalone',
  
  // 이미지 최적화 설정
  images: {
    unoptimized: false,
  },
  
  // 환경 변수
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
  
  // 리다이렉트 설정
  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
