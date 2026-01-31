// ============================================
// 사이드바 컴포넌트 (세로 네비게이션)
// ============================================

'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { usePendingReviews, useSessions } from '@/hooks/use-api'
import { 
  BarChart3, 
  Clock, 
  History, 
  Globe, 
  PieChart,
  BookMarked,
  FileSearch
} from 'lucide-react'
import Image from 'next/image'

interface NavItem {
  id: string
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: 'pending' | 'sessions'
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: BarChart3 },
  { id: 'pending', label: '승인 대기', href: '/pending', icon: Clock, badge: 'pending' },
  { id: 'sessions', label: '모니터링 회차', href: '/sessions', icon: History, badge: 'sessions' },
  { id: 'report-tracking', label: '신고결과 추적', href: '/report-tracking', icon: FileSearch },
  { id: 'title-stats', label: '작품별 통계', href: '/title-stats', icon: PieChart },
  { id: 'sites', label: '사이트 목록', href: '/sites', icon: Globe },
  { id: 'titles', label: '작품 관리', href: '/titles', icon: BookMarked },
]

export function Sidebar() {
  const pathname = usePathname()
  
  // 배지 숫자를 위한 쿼리
  const { data: pendingData } = usePendingReviews(1, 1)
  const { data: sessionsData } = useSessions(1, 1)

  const pendingCount = pendingData?.pagination?.total || pendingData?.count || 0
  const sessionsCount = sessionsData?.pagination?.total || sessionsData?.count || 0

  const getBadgeCount = (badge?: 'pending' | 'sessions') => {
    if (badge === 'pending') return pendingCount
    if (badge === 'sessions') return sessionsCount
    return null
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/'
    }
    return pathname.startsWith(href)
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-white border-r border-gray-200 flex flex-col z-40">
      {/* 로고 영역 */}
      <div className="h-16 flex items-center px-6 border-b border-gray-100">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image 
            src="/images/ridi-logo.png" 
            alt="RIDI" 
            width={40} 
            height={40}
            className="rounded-lg"
          />
          <div className="flex flex-col">
            <span className="text-lg font-bold text-gray-900">Jobdori</span>
            <span className="text-[10px] text-gray-400 -mt-1 tracking-wider">COPYRIGHT MONITORING</span>
          </div>
        </Link>
      </div>

      {/* 네비게이션 메뉴 */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            const badgeCount = getBadgeCount(item.badge)

            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                    active
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600 -ml-[1px]'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <Icon className={cn(
                    'h-5 w-5 flex-shrink-0',
                    active ? 'text-blue-600' : 'text-gray-400'
                  )} />
                  <span className="flex-1">{item.label}</span>
                  {badgeCount !== null && badgeCount > 0 && (
                    <span className={cn(
                      'px-2 py-0.5 text-xs font-semibold rounded-full',
                      item.badge === 'pending' 
                        ? 'bg-red-100 text-red-600' 
                        : 'bg-blue-100 text-blue-600'
                    )}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>


    </aside>
  )
}
