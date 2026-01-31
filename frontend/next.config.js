/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: output: 'standalone' 제거
  // - standalone은 Docker/자체호스팅 전용 설정
  // - Vercel 배포 시 불필요하며 API Routes가 Vercel Functions로 변환되지 않는 문제 발생
  // - Vercel은 자체적으로 최적화된 빌드 수행
  
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
        destination: '/login',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
