'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import AuthGuard from './AuthGuard';
import MobileMenu from './MobileMenu';
import { Bars3Icon } from '@heroicons/react/24/outline';

interface MainLayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  requireAdmin?: boolean;
}

export default function MainLayout({ children, pageTitle, requireAdmin = false }: MainLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

            {/* 우측 공간 (모바일에서 균형 맞추기 위해) */}
            <div className="w-10 md:hidden" />
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
