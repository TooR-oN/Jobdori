// ============================================
// 모니터링 회차 목록 컴포넌트 (개선 버전)
// ============================================

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSessions } from '@/hooks/use-api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { 
  Calendar, 
  Download,
  History
} from 'lucide-react'
import type { Session } from '@/types'

export function SessionsList() {
  const [page, setPage] = useState(1)
  const limit = 5

  const { data, isLoading, error, refetch } = useSessions(page, limit)

  if (isLoading) {
    return <SessionsListSkeleton />
  }

  if (error) {
    return (
      <EmptyState
        type="error"
        title="데이터 로드 실패"
        description="모니터링 회차 목록을 불러오는 중 오류가 발생했습니다."
        action={
          <Button onClick={() => refetch()} variant="outline">
            다시 시도
          </Button>
        }
      />
    )
  }

  const sessions = data?.items || data?.sessions || []
  const pagination = data?.pagination

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold text-gray-900">모니터링 회차</h3>
          </div>
        </CardContent>
      </Card>

      {/* 목록 */}
      {sessions.length === 0 ? (
        <EmptyState
          type="no-data"
          title="모니터링 회차 없음"
          description="아직 실행된 모니터링이 없습니다."
        />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-gray-100">
            {sessions.map((session) => (
              <SessionItem key={session.id} session={session} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* 페이지네이션 */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <span className="text-sm text-gray-500">
            {page} / {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page + 1)}
            disabled={page >= pagination.totalPages}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  )
}

// 개별 세션 아이템 - 카드 전체 클릭 가능
function SessionItem({ session }: { session: Session }) {
  // 세션 ID 또는 timestamp에서 표시용 이름 생성
  const sessionTitle = formatSessionTitle(session)
  
  // 날짜 포맷
  const formattedDate = session.created_at
    ? new Date(session.created_at).toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '-'

  const totalResults = session.total_results || 0
  const illegalCount = session.illegal_count || 0
  const legalCount = session.legal_count || 0
  const pendingCount = session.pending_count || 0

  return (
    <Link 
      href={`/sessions/${session.id}`}
      className="block hover:bg-gray-50 transition-colors"
    >
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          {/* 왼쪽: 세션 정보 */}
          <div className="flex-1 min-w-0">
            {/* 세션 타이틀 (timestamp 기반) */}
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="font-semibold text-gray-900">
                {sessionTitle}
              </span>
            </div>

            {/* 결과 통계 배지 */}
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                전체: {totalResults.toLocaleString()}
              </Badge>
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                불법: {illegalCount.toLocaleString()}
              </Badge>
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                합법: {legalCount.toLocaleString()}
              </Badge>
              <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
                대기: {pendingCount.toLocaleString()}
              </Badge>
            </div>
          </div>

          {/* 오른쪽: 날짜 + 다운로드 */}
          <div className="flex flex-col items-end gap-2">
            <span className="text-sm text-gray-500">
              {formattedDate}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                window.open(`/api/sessions/${session.id}/download`, '_blank')
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Link>
  )
}

// 세션 타이틀 포맷 함수
function formatSessionTitle(session: Session): string {
  // session.id가 timestamp 형식인 경우 (예: 2026-01-30T01-53-18)
  if (session.id && /^\d{4}-\d{2}-\d{2}T/.test(session.id)) {
    return session.id
  }
  
  // created_at에서 타이틀 생성
  if (session.created_at) {
    const date = new Date(session.created_at)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day}T${hour}-${minute}-${second}`
  }
  
  // 기본값
  return `세션 ${session.id?.slice(-6) || 'unknown'}`
}

// 스켈레톤 로딩
function SessionsListSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-32" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0 divide-y divide-gray-100">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-8 w-8" />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
