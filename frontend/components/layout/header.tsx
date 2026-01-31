// ============================================
// 상단 헤더 컴포넌트 (새 레이아웃용)
// ============================================

'use client'

import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Bell, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout } from '@/lib/api'

// 페이지별 타이틀 매핑
const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: '대시보드', subtitle: '월간 모니터링 현황을 확인합니다' },
  '/pending': { title: '승인 대기', subtitle: 'AI가 판단한 결과를 검토하고 최종 승인/반려를 결정합니다' },
  '/sessions': { title: '모니터링 회차', subtitle: '각 모니터링 실행 결과를 확인하고 상세 데이터를 다운로드할 수 있습니다' },
  '/sites': { title: '사이트 목록', subtitle: '불법/합법으로 분류된 사이트 목록을 관리합니다' },
  '/title-stats': { title: '작품별 통계', subtitle: '작품별 신고/차단 통계와 Manta 검색 순위를 확인합니다' },
  '/titles': { title: '작품 관리', subtitle: '모니터링 대상 작품을 추가, 제거, 복원할 수 있습니다' },
  '/report-tracking': { title: '신고결과 추적', subtitle: '신고 결과를 추적하고 관리합니다' },
}

export function Header() {
  const router = useRouter()
  const pathname = usePathname()

  // 세션 상세 페이지 처리
  let currentPage = pageTitles[pathname]
  if (!currentPage && pathname.startsWith('/sessions/')) {
    currentPage = { title: '모니터링 상세', subtitle: '모니터링 결과 상세 정보를 확인합니다' }
  }
  if (!currentPage) {
    currentPage = pageTitles['/dashboard']
  }

  const handleLogout = async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      await logout()
      router.push('/login')
    }
  }

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      {/* 좌측: 페이지 타이틀 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{currentPage.title}</h1>
        <p className="text-sm text-gray-500">{currentPage.subtitle}</p>
      </div>

      {/* 우측: 알림, 사용자 */}
      <div className="flex items-center gap-4">
        {/* 알림 버튼 */}
        <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <Bell className="h-5 w-5 text-gray-600" />
        </button>

        {/* 사용자 정보 */}
        <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900">Admin User</p>
            <p className="text-xs text-gray-500">RIDI SECURITY</p>
          </div>
          <div className="relative">
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 p-1 rounded-full hover:bg-gray-100 transition-colors"
              title="로그아웃"
            >
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <User className="h-5 w-5 text-white" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

// 기존 헤더 (호환성 유지용)
interface LegacyHeaderProps {
  onOpenTitlesModal?: () => void
}

export function LegacyHeader({ onOpenTitlesModal }: LegacyHeaderProps) {
  const router = useRouter()

  const handleLogout = async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      await logout()
      router.push('/login')
    }
  }

  return (
    <header className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            Jobdori
          </h1>
          <p className="text-gray-600 mt-1">웹툰 불법사이트 모니터링 시스템</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            로그아웃
          </Button>
        </div>
      </div>
    </header>
  )
}
