// ============================================
// Top 5 도메인 차트 (참고 이미지 스타일)
// ============================================

'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import type { TopIllegalSite } from '@/types'

interface TopDomainsChartProps {
  data: TopIllegalSite[]
  isLoading?: boolean
}

export function TopDomainsChart({ data, isLoading }: TopDomainsChartProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-gray-500 text-center py-12">
        데이터가 없습니다
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {data.slice(0, 5).map((item, index) => (
        <div
          key={item.domain}
          className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-400 w-6">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-sm text-gray-700 font-medium">
              {item.domain}
            </span>
          </div>
          <Badge 
            variant="secondary" 
            className="bg-gray-100 text-gray-700 hover:bg-gray-200 font-semibold px-3"
          >
            {item.count.toLocaleString()}개
          </Badge>
        </div>
      ))}
    </div>
  )
}
