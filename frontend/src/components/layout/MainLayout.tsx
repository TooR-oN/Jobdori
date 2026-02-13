'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';
import AuthGuard from './AuthGuard';
import MobileMenu from './MobileMenu';
import { Bars3Icon, BellIcon } from '@heroicons/react/24/outline';
import { notificationApi } from '@/lib/api';

interface MainLayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  requireAdmin?: boolean;
}

export default function MainLayout({ children, pageTitle, requireAdmin = false }: MainLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [showNotification, setShowNotification] = useState(false);
  const [isRead, setIsRead] = useState(false);
  const router = useRouter();

  // 미분류 도메인 수 조회
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await notificationApi.getUnclassifiedCount();
        if (res.success) {
          setUnclassifiedCount(res.count);
        }
      } catch (err) {
        // 실패 시 무시
      }
    };
    fetchCount();

    // sessionStorage에서 읽음 상태 복원
    if (typeof window !== 'undefined') {
      const read = sessionStorage.getItem('notification_domain_classify_read');
      if (read === 'true') setIsRead(true);
    }
  }, []);

  const handleNotificationClick = () => {
    setShowNotification(!showNotification);
  };

  const handleNotificationItemClick = () => {
    setShowNotification(false);
    setIsRead(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('notification_domain_classify_read', 'true');
    }
    router.push('/stats/domain');
  };

  return (
    <AuthGuard requireAdmin={requireAdmin}>
      <div className="min-h-screen bg-[#f8fcff]">
        {/* 데스크톱 사이드바 */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* 모바일 메뉴 */}
        <MobileMenu isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />

        {/* 메인 콘텐츠 영역 */}
        <div className="md:ml-64">
          {/* 헤더 */}
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6">
            {/* 모바일 햄버거 버튼 */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-gray-100"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <Bars3Icon className="w-6 h-6 text-gray-600" />
            </button>

            {/* 페이지 제목 */}
            <h1 className="text-xl font-bold text-gray-800">{pageTitle}</h1>

            {/* 우측 영역: 알림 아이콘 */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={handleNotificationClick}
                  className="relative p-2 rounded-lg hover:bg-gray-100 transition"
                  title="알림"
                >
                  <BellIcon className="w-5 h-5 text-gray-500" />
                  {unclassifiedCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full">
                      {unclassifiedCount > 9 ? '9+' : unclassifiedCount}
                    </span>
                  )}
                </button>

                {/* 알림 드롭다운 */}
                {showNotification && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h3 className="text-sm font-semibold text-gray-700">알림</h3>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {unclassifiedCount > 0 ? (
                        <button
                          onClick={handleNotificationItemClick}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 transition flex items-start gap-3"
                        >
                          {!isRead && (
                            <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></span>
                          )}
                          {isRead && <span className="mt-1.5 w-2 h-2 flex-shrink-0"></span>}
                          <div>
                            <p className="text-sm text-gray-700">
                              <span className="font-semibold text-red-600">{unclassifiedCount}개</span> 불법 도메인의 사이트 분류가 필요합니다.
                            </p>
                            <p className="text-xs text-gray-400 mt-1">도메인별 통계 페이지에서 분류를 설정하세요.</p>
                          </div>
                        </button>
                      ) : (
                        <div className="px-4 py-6 text-center text-sm text-gray-400">
                          새로운 알림이 없습니다.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* 모바일 공간 맞추기 */}
              <div className="w-2 md:hidden" />
            </div>
          </header>

          {/* 페이지 콘텐츠 */}
          <main className="p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
