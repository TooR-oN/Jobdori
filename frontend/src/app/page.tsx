'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push('/login');
      }
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin text-4xl text-blue-500 mb-4"></i>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // 임시 대시보드 (Phase 2-C-4에서 구현)
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* 헤더 */}
      <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-4 md:mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg width="60" height="24" viewBox="0 0 60 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
              <text x="0" y="20" fontFamily="Arial Black, sans-serif" fontSize="22" fontWeight="900" fill="#1E9EF4">RIDI</text>
            </svg>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-800">Jobdori</h1>
              <p className="text-gray-600 text-xs md:text-sm hidden sm:block">리디 저작권 침해 모니터링 시스템</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {user.username} ({user.role})
            </span>
            <button
              onClick={() => {/* logout */}}
              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition text-sm"
            >
              <i className="fas fa-sign-out-alt mr-2"></i>로그아웃
            </button>
          </div>
        </div>
      </div>

      {/* 임시 컨텐츠 */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold mb-4">Next.js 프론트엔드 초기화 완료</h2>
        <p className="text-gray-600 mb-4">
          Phase 2-C-1이 완료되었습니다. 다음 단계에서 각 페이지를 구현합니다.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <i className="fas fa-chart-line text-2xl text-blue-500 mb-2"></i>
            <p className="text-sm text-gray-600">대시보드</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg text-center">
            <i className="fas fa-clock text-2xl text-yellow-500 mb-2"></i>
            <p className="text-sm text-gray-600">승인 대기</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg text-center">
            <i className="fas fa-history text-2xl text-green-500 mb-2"></i>
            <p className="text-sm text-gray-600">모니터링 회차</p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg text-center">
            <i className="fas fa-list-alt text-2xl text-purple-500 mb-2"></i>
            <p className="text-sm text-gray-600">작품 관리</p>
          </div>
        </div>
      </div>
    </div>
  );
}
