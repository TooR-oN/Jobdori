// ============================================
// 대시보드 탭 (새 레이아웃)
// ============================================

'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDashboard, useDashboardMonths } from '@/hooks/use-api'
import { StatsCards } from './stats-cards'
import { MonthSelector } from './month-selector'
import { TopContentsChart } from './top-contents-chart'
import { TopDomainsChart } from './top-domains-chart'
import { MantaRankings } from './manta-rankings'
import { Calendar } from 'lucide-react'

export function DashboardTab() {
  const [selectedMonth, setSelectedMonth] = useState<string>('')

  const { data: monthsData, isLoading: isLoadingMonths } = useDashboardMonths()
  const { data: dashboardData, isLoading: isLoadingDashboard } = useDashboard(
    selectedMonth || monthsData?.current_month
  )

  const isLoading = isLoadingMonths || isLoadingDashboard

  return (
    <div className="space-y-6">
      {/* 상단: 월 선택 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Calendar className="h-4 w-4" />
          <span>모니터링 기간</span>
        </div>
        <MonthSelector
          months={monthsData?.months || []}
          currentMonth={monthsData?.current_month || ''}
          selectedMonth={selectedMonth}
          onMonthChange={setSelectedMonth}
          isLoading={isLoadingMonths}
        />
      </div>

      {/* 통계 카드 */}
      <StatsCards
        total={dashboardData?.total_stats?.total || 0}
        illegal={dashboardData?.total_stats?.illegal || 0}
        legal={dashboardData?.total_stats?.legal || 0}
        sessionsCount={dashboardData?.sessions_count || 0}
        isLoading={isLoading}
      />

      {/* Top 차트 영역 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              침해 작품 Top 5
              <span className="ml-auto text-xs font-normal text-blue-600 cursor-pointer hover:underline">
                전체 보기
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopContentsChart
              data={dashboardData?.top_contents || []}
              isLoading={isLoading}
            />
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              불법 도메인 Top 5
              <span className="ml-auto text-xs font-normal text-blue-600 cursor-pointer hover:underline">
                전체 보기
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopDomainsChart
              data={dashboardData?.top_illegal_sites || []}
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>

      {/* Manta 검색 순위 */}
      <MantaRankings />

      {/* 데이터 소스 표시 (디버깅용) */}
      {dashboardData?.source && (
        <div className="text-xs text-gray-400 text-right">
          데이터 소스: {dashboardData.source} | 기준: {dashboardData.count_type || 'by_url'}
        </div>
      )}
    </div>
  )
}
