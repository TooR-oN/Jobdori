// ============================================
// Top 5 콘텐츠 차트 (참고 이미지 스타일)
// ============================================

'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import type { TopContent } from '@/types'

interface TopContentsChartProps {
  data: TopContent[]
  isLoading?: boolean
}

export function TopContentsChart({ data, isLoading }: TopContentsChartProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
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
          key={item.title}
          className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-400 w-6">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-sm text-gray-700 font-medium">
              {item.title}
            </span>
          </div>
          <Badge 
            variant="secondary" 
            className="bg-red-50 text-red-600 hover:bg-red-100 font-semibold px-3"
          >
            {(item.illegal_count || item.count || 0).toLocaleString()}개
          </Badge>
        </div>
      ))}
    </div>
  )
}
