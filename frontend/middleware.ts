// ============================================
// 인증 미들웨어 - Next.js Middleware
// ============================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 인증이 필요 없는 경로
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/status']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Public 경로는 통과
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }
  
  // API 경로는 API에서 자체 인증 처리
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }
  
  // 세션 토큰 확인
  const sessionToken = request.cookies.get('session_token')?.value
  
  // 토큰이 없으면 로그인 페이지로 리다이렉트
  if (!sessionToken) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|images/).*)',
  ],
}
