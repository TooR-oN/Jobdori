// ============================================
// Manta 검색 순위 그리드 컴포넌트 (참고 이미지 스타일)
// ============================================

'use client'

import { useState } from 'react'
import { useMantaRankings } from '@/hooks/use-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { 
  Search, 
  Filter, 
  TrendingUp, 
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS_PER_PAGE = 12

export function MantaRankings() {
  const { data, isLoading, error, refetch } = useMantaRankings()
  const [page, setPage] = useState(1)
  const [filterUnranked, setFilterUnranked] = useState(false)

  if (error) {
    return (
      <Card className="bg-white">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
                <Search className="h-4 w-4 text-blue-600" />
              </div>
              Manta 검색 순위
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <p>데이터 로드 실패</p>
            <Button onClick={() => refetch()} variant="outline" size="sm" className="mt-2">
              다시 시도
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const allRankings = data?.rankings || []
  const rankings = filterUnranked 
    ? allRankings.filter((r: any) => !r.mantaRank || r.mantaRank <= 0)
    : allRankings
  
  const totalPages = Math.ceil(rankings.length / ITEMS_PER_PAGE)
  const paginatedRankings = rankings.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  )

  // 현재 날짜를 포맷
  const statusDate = new Date().toISOString().split('T')[0].replace(/-/g, '-') + ' ' + 
    new Date().toTimeString().slice(0, 5)

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
                <Search className="h-4 w-4 text-blue-600" />
              </div>
              Manta 검색 순위
            </CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              기준일: {statusDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                setFilterUnranked(!filterUnranked)
                setPage(1)
              }}
              className={cn(filterUnranked && 'bg-gray-100')}
            >
              <Filter className="h-4 w-4 mr-1" />
              필터
            </Button>
            <Button onClick={() => refetch()} variant="ghost" size="sm">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <MantaRankingsSkeleton />
        ) : paginatedRankings.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <TrendingUp className="h-12 w-12 mx-auto mb-2 text-gray-300" />
            <p>등록된 순위 데이터가 없습니다.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedRankings.map((item: any, index: number) => (
                <MantaRankingCard key={index} item={item} />
              ))}
            </div>
            
            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  {((page - 1) * ITEMS_PER_PAGE) + 1} / {rankings.length}개 표시 중
                </span>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// 개별 순위 카드
function MantaRankingCard({ item }: { item: {
  title: string
  mantaRank: number | null
  firstRankDomain: string | null
  searchQuery: string | null
  page1IllegalCount: number
}}) {
  const hasRank = item.mantaRank !== null && item.mantaRank > 0
  const page = hasRank && item.mantaRank ? Math.ceil(item.mantaRank / 10) : null
  const rankInPage = hasRank && item.mantaRank ? ((item.mantaRank - 1) % 10) + 1 : null
  const rankDisplay = hasRank ? `P${page}-${rankInPage}` : '순위 외'
  
  // 불법 URL 비율 표시
  const illegalRatio = `불법 ${item.page1IllegalCount}/10`
  
  // 불법 URL 수 기준 색상 (높으면 빨간색)
  const isHighIllegal = item.page1IllegalCount >= 5
  const illegalColorClass = isHighIllegal 
    ? 'text-red-600' 
    : 'text-gray-500'

  return (
    <div className={cn(
      'rounded-xl border bg-white p-4 transition-all hover:shadow-md',
      isHighIllegal ? 'border-red-200' : 'border-gray-200'
    )}>
      {/* 작품명 */}
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1 truncate" title={item.title}>
        {item.title}
      </div>
      
      {/* 순위 표시 (크게) */}
      <div className={cn(
        'text-3xl font-bold mb-3',
        hasRank ? 'text-gray-900' : 'text-gray-400'
      )}>
        {rankDisplay}
      </div>

      {/* 하단 정보 */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 truncate max-w-[60%]" title={item.firstRankDomain || ''}>
          {item.firstRankDomain || '-'}
        </span>
        <span className={cn('font-medium', illegalColorClass)}>
          {illegalRatio}
        </span>
      </div>
    </div>
  )
}

// 스켈레톤 로딩
function MantaRankingsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
          <Skeleton className="h-3 w-2/3 mb-2" />
          <Skeleton className="h-8 w-20 mb-3" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}
