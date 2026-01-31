// ============================================
// 작품별 신고/차단 통계 테이블
// ============================================

'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { TitleStatsItem } from '@/lib/api'

interface TitleStatsTableProps {
  stats: TitleStatsItem[]
  isLoading: boolean
  selectedTitle: string
  onSelectTitle: (title: string) => void
}

export function TitleStatsTable({ 
  stats, 
  isLoading, 
  selectedTitle,
  onSelectTitle 
}: TitleStatsTableProps) {
  if (isLoading) {
    return <TitleStatsTableSkeleton />
  }

  if (stats.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        조회된 통계가 없습니다.
      </div>
    )
  }

  // 합계 계산
  const totals = stats.reduce(
    (acc, item) => ({
      detected: acc.detected + item.detected,
      reported: acc.reported + item.reported,
      blocked: acc.blocked + item.blocked,
    }),
    { detected: 0, reported: 0, blocked: 0 }
  )
  const totalBlockRate = totals.reported > 0 
    ? ((totals.blocked / totals.reported) * 100).toFixed(1) + '%' 
    : '-'

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-700">작품명</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">발견</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">신고</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">차단</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">차단율</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((item, index) => {
            const isSelected = selectedTitle === item.title
            const blockRateNum = parseFloat(item.blockRate || '0')
            
            return (
              <tr
                key={index}
                onClick={() => onSelectTitle(item.title)}
                className={cn(
                  'border-b cursor-pointer transition-colors',
                  isSelected 
                    ? 'bg-indigo-50 hover:bg-indigo-100' 
                    : 'hover:bg-gray-50'
                )}
              >
                <td className="px-4 py-3 font-medium">
                  <span className={cn(isSelected && 'text-indigo-700')}>
                    {item.title}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {item.detected.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-blue-600 cursor-pointer hover:underline">
                    {item.reported.toLocaleString()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-green-600">
                    {item.blocked.toLocaleString()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={cn(
                    'font-medium',
                    blockRateNum >= 100 ? 'text-green-600' :
                    blockRateNum >= 90 ? 'text-blue-600' :
                    blockRateNum >= 80 ? 'text-yellow-600' : 'text-red-600'
                  )}>
                    {item.blockRate}
                  </span>
                </td>
              </tr>
            )
          })}
          
          {/* 합계 행 */}
          <tr className="bg-gray-100 font-semibold">
            <td className="px-4 py-3">합계</td>
            <td className="px-4 py-3 text-right">{totals.detected.toLocaleString()}</td>
            <td className="px-4 py-3 text-right text-blue-600">{totals.reported.toLocaleString()}</td>
            <td className="px-4 py-3 text-right text-green-600">{totals.blocked.toLocaleString()}</td>
            <td className="px-4 py-3 text-right">{totalBlockRate}</td>
          </tr>
        </tbody>
      </table>

      {/* 안내 문구 */}
      <p className="text-xs text-gray-500 mt-3">
        💡 발견: 모니터링으로 수집된 불법 URL 수 | 신고: 발견 - 미신고 | 차단: 구글에서 처리된 URL 수
      </p>
    </div>
  )
}

function TitleStatsTableSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex gap-4 border-b pb-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  )
}
