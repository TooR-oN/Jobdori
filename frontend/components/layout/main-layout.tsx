// ============================================
// 메인 레이아웃 래퍼 (사이드바 + 헤더 + 컨텐츠)
// ============================================

'use client'

import { Sidebar } from './sidebar'
import { Header } from './header'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 사이드바 */}
      <Sidebar />

      {/* 메인 영역 (사이드바 너비만큼 마진) */}
      <div className="ml-56 min-h-screen flex flex-col">
        {/* 헤더 */}
        <Header />

        {/* 컨텐츠 영역 */}
        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
