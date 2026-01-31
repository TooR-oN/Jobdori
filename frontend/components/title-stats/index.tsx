// ============================================
// 작품별 통계 탭 메인 컴포넌트
// ============================================

'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TitleStatsTable } from './title-stats-table'
import { TitleRankChart } from './title-rank-chart'
import { Button } from '@/components/ui/button'
import { PieChart, Calendar, RefreshCw } from 'lucide-react'
import { useTitleStats } from '@/hooks/use-api'

export function TitleStatsTab() {
  const [selectedTitle, setSelectedTitle] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const { data, isLoading, refetch } = useTitleStats(startDate, endDate)

  const handleSearch = () => {
    refetch()
  }

  const handleReset = () => {
    setStartDate('')
    setEndDate('')
    setSelectedTitle('')
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-indigo-600" />
              작품별 신고/차단 통계
            </CardTitle>
            <div className="flex items-center gap-4">
              {/* 기간 필터 */}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-500">기간:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-gray-400">~</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <Button onClick={handleSearch} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                조회
              </Button>
              <Button onClick={handleReset} variant="outline" size="sm">
                초기화
              </Button>
              <Button onClick={() => refetch()} variant="ghost" size="sm">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <TitleStatsTable
            stats={data?.stats || []}
            isLoading={isLoading}
            selectedTitle={selectedTitle}
            onSelectTitle={setSelectedTitle}
          />
        </CardContent>
      </Card>

      {/* Manta 검색 순위 변화 그래프 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5 text-purple-600" />
            Manta 검색 순위 변화
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TitleRankChart 
            selectedTitle={selectedTitle} 
            onSelectTitle={setSelectedTitle}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export { TitleStatsTab as TitleStatsPage }
