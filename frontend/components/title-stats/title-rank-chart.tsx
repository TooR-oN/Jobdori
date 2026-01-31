// ============================================
// 작품별 Manta 순위 변화 차트
// ============================================

'use client'

import { useState } from 'react'
import { useTitlesWithManta, useTitleRankHistory } from '@/hooks/use-api'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Search, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TitleRankChartProps {
  selectedTitle: string
  onSelectTitle: (title: string) => void
}

export function TitleRankChart({ selectedTitle, onSelectTitle }: TitleRankChartProps) {
  const [searchInput, setSearchInput] = useState('')
  const { data: titlesData, isLoading: isLoadingTitles } = useTitlesWithManta()
  const { data: historyData, isLoading: isLoadingHistory } = useTitleRankHistory(selectedTitle)

  // 작품 목록 (검색 필터링)
  const currentTitles = titlesData?.current || []
  const filteredTitles = searchInput 
    ? currentTitles.filter(t => t.name.toLowerCase().includes(searchInput.toLowerCase()))
    : currentTitles

  // 차트 데이터 변환
  const chartData = (historyData?.history || []).map(item => ({
    date: new Date(item.recordedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
    rank: item.rank,
    domain: item.firstRankDomain,
  })).reverse() // 날짜순 정렬

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* 좌측: 작품 목록 */}
      <div className="col-span-4 border-r pr-4">
        <h4 className="font-medium text-gray-700 mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          작품 목록
        </h4>
        
        {/* 검색 */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="작품 검색..."
            className="w-full rounded-md border border-gray-300 pl-10 pr-4 py-2 text-sm focus:border-purple-500 focus:outline-none"
          />
        </div>

        {/* 목록 */}
        {isLoadingTitles ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filteredTitles.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            {searchInput ? '검색 결과 없음' : '등록된 작품이 없습니다.'}
          </p>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {filteredTitles.map((item, index) => {
              const titleName = item.name
              const isSelected = selectedTitle === titleName
              
              return (
                <button
                  key={index}
                  onClick={() => onSelectTitle(titleName)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                    isSelected 
                      ? 'bg-purple-100 text-purple-700 font-medium' 
                      : 'hover:bg-gray-100 text-gray-700'
                  )}
                >
                  {titleName}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 우측: 순위 변화 그래프 */}
      <div className="col-span-8">
        {!selectedTitle ? (
          <EmptyState
            type="no-data"
            title="작품을 선택하세요"
            description="좌측에서 작품을 선택하면 Manta 검색 순위 변화를 확인할 수 있습니다."
          />
        ) : isLoadingHistory ? (
          <div className="h-80 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">로딩 중...</p>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <EmptyState
            type="no-data"
            title="순위 데이터 없음"
            description={`"${selectedTitle}"의 순위 히스토리가 없습니다.`}
          />
        ) : (
          <div>
            <h4 className="font-medium text-gray-700 mb-4">
              &quot;{selectedTitle}&quot; 순위 변화
            </h4>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    reversed 
                    domain={[1, 'dataMax']}
                    tick={{ fontSize: 12 }}
                    label={{ value: '순위', angle: -90, position: 'insideLeft', fontSize: 12 }}
                  />
                  <Tooltip 
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload
                        return (
                          <div className="bg-white border rounded-md shadow-lg p-3 text-sm">
                            <p className="font-medium">{label}</p>
                            <p className="text-purple-600">
                              순위: {data.rank ? `${data.rank}위` : '순위 외'}
                            </p>
                            {data.domain && (
                              <p className="text-gray-500 text-xs">
                                1위: {data.domain}
                              </p>
                            )}
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="rank" 
                    name="순위"
                    stroke="#7c3aed" 
                    strokeWidth={2}
                    dot={{ fill: '#7c3aed', strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            
            {/* 순위 요약 */}
            {chartData.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">최고 순위</p>
                  <p className="text-lg font-bold text-green-600">
                    {Math.min(...chartData.filter(d => d.rank).map(d => d.rank!))}위
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">최저 순위</p>
                  <p className="text-lg font-bold text-red-600">
                    {Math.max(...chartData.filter(d => d.rank).map(d => d.rank!))}위
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">현재 순위</p>
                  <p className="text-lg font-bold text-purple-600">
                    {chartData[chartData.length - 1]?.rank 
                      ? `${chartData[chartData.length - 1].rank}위` 
                      : '-'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
