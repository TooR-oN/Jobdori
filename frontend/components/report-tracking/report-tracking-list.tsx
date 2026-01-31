// ============================================
// 신고결과 추적 세션 목록 컴포넌트
// ============================================

'use client'

import { useReportTrackingSessions } from '@/hooks/use-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Calendar,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'

interface ReportTrackingListProps {
  onSelectSession: (sessionId: string) => void
}

export function ReportTrackingList({ onSelectSession }: ReportTrackingListProps) {
  const { data, isLoading, error, refetch } = useReportTrackingSessions()

  if (isLoading) {
    return <ReportTrackingListSkeleton />
  }

  if (error) {
    return (
      <EmptyState
        type="error"
        title="데이터 로드 실패"
        description="신고 추적 세션 목록을 불러오는 중 오류가 발생했습니다."
        action={
          <Button onClick={() => refetch()} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            다시 시도
          </Button>
        }
      />
    )
  }

  const sessions = data?.sessions || []

  if (sessions.length === 0) {
    return (
      <EmptyState
        type="no-data"
        title="신고 추적 세션 없음"
        description="아직 신고 추적 데이터가 없습니다."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">신고 추적 세션 목록</h3>
        <Button onClick={() => refetch()} variant="ghost" size="sm">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onSelect={() => onSelectSession(session.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SessionCard({
  session,
  onSelect,
}: {
  session: {
    id: string
    created_at: string
    total_count: number
    reported_count: number
    blocked_count: number
    pending_count: number
  }
  onSelect: () => void
}) {
  const formattedDate = session.created_at
    ? new Date(session.created_at).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'

  // 세션 타이틀 포맷
  const sessionTitle = formatSessionTitle(session.id, session.created_at)

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Calendar className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <div className="font-semibold text-gray-900">{sessionTitle}</div>
              <div className="text-sm text-gray-500">{formattedDate}</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* 통계 배지 */}
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-blue-50 text-blue-600">
                <FileText className="h-3 w-3 mr-1" />
                {session.total_count}
              </Badge>
              <Badge variant="secondary" className="bg-yellow-50 text-yellow-600">
                <Clock className="h-3 w-3 mr-1" />
                {session.pending_count}
              </Badge>
              <Badge variant="secondary" className="bg-orange-50 text-orange-600">
                <XCircle className="h-3 w-3 mr-1" />
                {session.reported_count}
              </Badge>
              <Badge variant="secondary" className="bg-green-50 text-green-600">
                <CheckCircle className="h-3 w-3 mr-1" />
                {session.blocked_count}
              </Badge>
            </div>

            <ChevronRight className="h-5 w-5 text-gray-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 세션 타이틀 포맷 함수
function formatSessionTitle(sessionId: string, createdAt?: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(sessionId)) {
    return sessionId
  }

  if (createdAt) {
    const date = new Date(createdAt)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day}T${hour}-${minute}-${second}`
  }

  return `세션 ${sessionId.slice(-6)}`
}

function ReportTrackingListSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div>
                    <Skeleton className="h-5 w-40 mb-1" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
