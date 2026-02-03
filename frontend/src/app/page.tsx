'use client';

import { MainLayout } from '@/components/layout';

export default function DashboardPage() {
  return (
    <MainLayout pageTitle="대시보드">
      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">발견</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 text-xl">🔍</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">신고</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <span className="text-orange-600 text-xl">📢</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">차단</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-600 text-xl">🛡️</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">차단율</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-purple-600 text-xl">📊</span>
            </div>
          </div>
        </div>
      </div>

      {/* 임시 컨텐츠 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">월간 모니터링 현황</h3>
          <div className="flex items-center justify-center h-48 text-gray-400">
            <p>Phase 2-C-4에서 차트 구현 예정</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">최근 발견 사이트</h3>
          <div className="flex items-center justify-center h-48 text-gray-400">
            <p>Phase 2-C-4에서 테이블 구현 예정</p>
          </div>
        </div>
      </div>

      {/* 초기화 완료 메시지 */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-blue-800 mb-2">
          ✅ Phase 2-C-3 공통 레이아웃 구현 완료
        </h3>
        <p className="text-blue-700 text-sm">
          사이드바 네비게이션, 헤더, 모바일 햄버거 메뉴가 구현되었습니다.
          다음 단계(Phase 2-C-4)에서 각 페이지의 실제 기능을 구현합니다.
        </p>
      </div>
    </MainLayout>
  );
}
