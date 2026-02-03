'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export default function AuthGuard({ children, requireAdmin = false }: AuthGuardProps) {
  const router = useRouter();
  const { user, isLoading, isAuthenticated, isAdmin } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      // 인증되지 않은 경우 로그인 페이지로 리다이렉트
      if (!isAuthenticated) {
        router.replace('/login');
        return;
      }

      // admin 권한이 필요한 페이지인데 admin이 아닌 경우
      if (requireAdmin && !isAdmin) {
        router.replace('/');
        return;
      }
    }
  }, [isLoading, isAuthenticated, isAdmin, requireAdmin, router]);

  // 로딩 중일 때
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fcff]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 인증되지 않은 경우
  if (!isAuthenticated) {
    return null;
  }

  // admin 권한 필요한데 없는 경우
  if (requireAdmin && !isAdmin) {
    return null;
  }

  return <>{children}</>;
}
