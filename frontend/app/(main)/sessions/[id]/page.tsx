// ============================================
// 세션 상세 페이지 (Manta URL 표시 기능 포함)
// ============================================

'use client'

import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession, useSessionResults, useTitlesWithManta, useExcludedUrls } from '@/hooks/use-api'
import * as api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import {
  ArrowLeft,
  Calendar,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Copy,
  Link2,
  ClipboardCopy,
  Loader2,
} from 'lucide-react'
import type { DetectionResult } from '@/types'

const STATUS_OPTIONS = [
  { value: 'all', label: '전체 상태' },
  { value: 'illegal', label: '불법' },
  { value: 'legal', label: '합법' },
  { value: 'pending', label: '대기' },
]

export default function SessionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string
  const { showToast } = useToast()

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [title, setTitle] = useState('all')
  const limit = 20

  const { data: sessionData, isLoading: sessionLoading } = useSession(sessionId)
  const { data: resultsData, isLoading: resultsLoading, error } = useSessionResults(sessionId, {
    page,
    limit,
    status: status === 'all' ? undefined : status,
    title: title === 'all' ? undefined : title,
  })
  
  // Manta URL을 가져오기 위한 titles 데이터
  const { data: titlesData } = useTitlesWithManta()
  
  // 신고 제외 URL 목록
  const { data: excludedUrlsData } = useExcludedUrls()
  
  // 불법 URL 복사 로딩 상태
  const [isCopyingUrls, setIsCopyingUrls] = useState(false)

  const session = sessionData?.session
  const results = resultsData?.items || []
  const pagination = resultsData?.pagination
  const availableTitles = resultsData?.available_titles || []

  // 선택된 작품의 Manta URL 찾기
  const selectedTitleData = title !== 'all' && titlesData?.current
    ? titlesData.current.find((t: { name: string; manta_url: string | null }) => t.name === title)
    : null

  const titleOptions = [
    { value: 'all', label: '전체 작품' },
    ...availableTitles.map((t) => ({ value: t, label: t })),
  ]

  // Manta URL 복사 함수
  const handleCopyMantaUrl = async () => {
    if (!selectedTitleData?.manta_url) return
    try {
      await navigator.clipboard.writeText(selectedTitleData.manta_url)
      showToast('URL이 복사되었습니다', 'success', 2000)
    } catch (err) {
      console.error('Copy failed:', err)
      showToast('복사에 실패했습니다', 'error', 2000)
    }
  }

  // 불법 URL 일괄 복사 함수
  const handleCopyIllegalUrls = useCallback(async () => {
    if (!sessionId) return
    
    setIsCopyingUrls(true)
    try {
      // 불법 URL만 가져오기 (최대 10000개)
      const data = await api.getSessionResults(sessionId, {
        status: 'illegal',
        title: title === 'all' ? undefined : title,
        limit: 10000,
      })
      
      if (!data.items || data.items.length === 0) {
        showToast('복사할 불법 URL이 없습니다', 'warning', 2000)
        return
      }
      
      // 신고 제외 URL 필터링
      const excludedUrls = new Set(
        excludedUrlsData?.urls?.map((item) => item.url) || []
      )
      
      const filteredResults = data.items.filter(
        (r) => !excludedUrls.has(r.url)
      )
      const excludedCount = data.items.length - filteredResults.length
      
      if (filteredResults.length === 0) {
        showToast('복사할 불법 URL이 없습니다 (모두 신고 제외 대상)', 'warning', 2000)
        return
      }
      
      // 클립보드에 복사
      const urls = filteredResults.map((r) => r.url).join('\n')
      await navigator.clipboard.writeText(urls)
      
      // 결과 피드백
      let message = `불법 URL ${filteredResults.length}개가 복사되었습니다`
      if (excludedCount > 0) {
        message += ` (신고제외 ${excludedCount}개 제외)`
      }
      showToast(message, 'success', 3000)
    } catch (err) {
      console.error('Copy failed:', err)
      showToast('복사에 실패했습니다', 'error', 2000)
    } finally {
      setIsCopyingUrls(false)
    }
  }, [sessionId, title, excludedUrlsData, showToast])

  // 세션 타이틀 포맷
  const sessionTitle = formatSessionTitle(sessionId, session?.created_at)

  if (sessionLoading) {
    return <SessionDetailSkeleton />
  }

  if (!session) {
    return (
      <EmptyState
        type="error"
        title="세션을 찾을 수 없습니다"
        description="요청한 모니터링 회차를 찾을 수 없습니다."
        action={
          <Link href="/sessions">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              목록으로 돌아가기
            </Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <Link href="/sessions">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            목록으로
          </Button>
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="h-6 w-6 text-purple-600" />
              {sessionTitle}
            </h1>
            <div className="mt-1 text-sm text-gray-500">
              {session.created_at
                ? new Date(session.created_at).toLocaleString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : '-'}
            </div>
          </div>

          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleCopyIllegalUrls}
              disabled={isCopyingUrls}
              className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
            >
              {isCopyingUrls ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCopy className="mr-2 h-4 w-4" />
              )}
              불법 URL 복사
            </Button>
            <Button variant="outline" onClick={() => window.open(`/api/sessions/${sessionId}/download`, '_blank')}>
              <Download className="mr-2 h-4 w-4" />
              Excel 다운로드
            </Button>
          </div>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<FileText className="h-5 w-5 text-blue-500" />}
          label="전체"
          value={session.total_results || session.results_summary?.total || 0}
          color="blue"
        />
        <StatCard
          icon={<XCircle className="h-5 w-5 text-red-500" />}
          label="불법"
          value={session.illegal_count || session.results_summary?.illegal || 0}
          color="red"
        />
        <StatCard
          icon={<CheckCircle className="h-5 w-5 text-green-500" />}
          label="합법"
          value={session.legal_count || session.results_summary?.legal || 0}
          color="green"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-yellow-500" />}
          label="대기"
          value={session.pending_count || session.results_summary?.pending || 0}
          color="yellow"
        />
      </div>

      {/* 필터 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">필터:</span>
            </div>
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v)
                setPage(1)
              }}
              options={STATUS_OPTIONS}
              className="w-32"
            />
            <Select
              value={title}
              onChange={(v) => {
                setTitle(v)
                setPage(1)
              }}
              options={titleOptions}
              className="w-48"
            />
            <div className="ml-auto text-sm text-gray-500">
              총 {pagination?.total || 0}건
            </div>
          </div>

          {/* 선택된 작품의 Manta URL 표시 */}
          {title !== 'all' && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium text-gray-700">Manta URL:</span>
                {selectedTitleData?.manta_url ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <a
                      href={selectedTitleData.manta_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate max-w-md"
                      title={selectedTitleData.manta_url}
                    >
                      {selectedTitleData.manta_url}
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyMantaUrl}
                      className="flex-shrink-0"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      복사
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">등록된 Manta URL이 없습니다</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 결과 목록 */}
      {resultsLoading ? (
        <ResultsListSkeleton />
      ) : error ? (
        <EmptyState
          type="error"
          title="데이터 로드 실패"
          description="탐지 결과를 불러오는 중 오류가 발생했습니다."
        />
      ) : results.length === 0 ? (
        <EmptyState
          type="no-data"
          title="결과 없음"
          description="해당 조건에 맞는 탐지 결과가 없습니다."
        />
      ) : (
        <div className="space-y-3">
          {results.map((result) => (
            <ResultCard key={result.id} result={result} />
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center pt-4">
          <Pagination
            page={page}
            totalPages={pagination.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  )
}

// 세션 타이틀 포맷 함수
function formatSessionTitle(sessionId: string, createdAt?: string): string {
  // session.id가 timestamp 형식인 경우
  if (/^\d{4}-\d{2}-\d{2}T/.test(sessionId)) {
    return sessionId
  }
  
  // created_at에서 타이틀 생성
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
  
  return `모니터링 ${sessionId.slice(-6)}`
}

// 통계 카드
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: 'blue' | 'red' | 'green' | 'yellow'
}) {
  const bgColors = {
    blue: 'bg-blue-50',
    red: 'bg-red-50',
    green: 'bg-green-50',
    yellow: 'bg-yellow-50',
  }

  return (
    <Card className={bgColors[color]}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <div className="text-sm text-gray-600">{label}</div>
            <div className="text-xl font-bold">{value.toLocaleString()}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 결과 카드
function ResultCard({ result }: { result: DetectionResult }) {
  const statusStyles: Record<string, string> = {
    illegal: 'bg-red-100 text-red-800',
    legal: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
  }

  const statusLabels: Record<string, string> = {
    illegal: '불법',
    legal: '합법',
    pending: '대기',
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={statusStyles[result.final_status]}>
                {statusLabels[result.final_status]}
              </Badge>
              <span className="text-sm font-medium text-gray-700">
                {result.title}
              </span>
            </div>

            <div className="font-mono text-sm text-gray-900 mb-1 truncate">
              {result.domain}
            </div>

            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:text-blue-700 truncate block"
            >
              {result.url}
              <ExternalLink className="inline ml-1 h-3 w-3" />
            </a>

            {result.llm_reason && (
              <p className="mt-2 text-sm text-gray-500 line-clamp-2">
                {result.llm_reason}
              </p>
            )}

            <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
              <span>검색어: {result.search_query}</span>
              <span>페이지 {result.page} / 순위 {result.rank}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 스켈레톤
function SessionDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-24 mb-4" />
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-16" />
      <ResultsListSkeleton />
    </div>
  )
}

function ResultsListSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-6 w-24 mb-2" />
            <Skeleton className="h-5 w-48 mb-1" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
