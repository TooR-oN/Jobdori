'use client'

import { cn } from '@/lib/utils'
import { BarChart3, Clock, History, Globe, PieChart } from 'lucide-react'

export type TabType = 'dashboard' | 'pending' | 'sessions' | 'sites' | 'title-stats'

interface NavigationProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  pendingCount?: number
  sessionsCount?: number
}

const tabs: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: '대시보드', icon: BarChart3 },
  { id: 'pending', label: '승인 대기', icon: Clock },
  { id: 'sessions', label: '모니터링 회차', icon: History },
  { id: 'sites', label: '사이트 목록', icon: Globe },
  { id: 'title-stats', label: '작품별 통계', icon: PieChart },
]

export function Navigation({ activeTab, onTabChange, pendingCount = 0, sessionsCount = 0 }: NavigationProps) {
  return (
    <nav className="bg-white rounded-lg shadow-md mb-6">
      <div className="flex border-b">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const count = tab.id === 'pending' ? pendingCount : tab.id === 'sessions' ? sessionsCount : null

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'px-6 py-4 text-gray-600 hover:text-blue-600 flex items-center gap-2 transition-colors',
                activeTab === tab.id && 'border-b-3 border-blue-600 text-blue-600 font-semibold'
              )}
              style={activeTab === tab.id ? { borderBottom: '3px solid #2563eb' } : {}}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {count !== null && count > 0 && (
                <span
                  className={cn(
                    'ml-1 px-2 py-0.5 text-xs rounded-full text-white',
                    tab.id === 'pending' ? 'bg-red-500' : 'bg-blue-500'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
