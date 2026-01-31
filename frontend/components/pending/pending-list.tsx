// ============================================
// 승인 대기 목록 컴포넌트 (일괄 처리 기능 포함)
// ============================================

'use client'

import { useState } from 'react'
import { usePendingReviews, useReviewItem, useReviewBulk, useAiReviewPending } from '@/hooks/use-api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { CheckCircle, XCircle, ExternalLink, Clock, CheckSquare, Square, Sparkles, RefreshCw } from 'lucide-react'
import type { PendingReview } from '@/types'

const JUDGMENT_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'likely_illegal', label: '불법 추정' },
  { value: 'likely_legal', label: '합법 추정' },
  { value: 'uncertain', label: '불확실' },
]

export function PendingList() {
  const { showToast } = useToast()
  const [page, setPage] = useState(1)
  const [judgment, setJudgment] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const limit = 10

  const { data, isLoading, error, refetch } = usePendingReviews(
    page,
    limit,
    judgment === 'all' ? undefined : judgment
  )

  const reviewMutation = useReviewItem()
  const bulkMutation = useReviewBulk()
  const aiReviewMutation = useAiReviewPending()

  const items = data?.items || []
  const pagination = data?.pagination

  // 전체 선택/해제
  const handleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map(item => item.id)))
    }
  }

  // 개별 선택
  const handleSelect = (id: number) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  // 개별 처리
  const handleReview = async (id: string | number, action: 'approve' | 'reject') => {
    try {
      await reviewMutation.mutateAsync({ id: String(id), action })
      setSelectedIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(Number(id))
        return newSet
      })
      refetch()
    } catch (err) {
      console.error('Review failed:', err)
    }
  }

  // 일괄 처리
  const handleBulkReview = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return
    
    const actionText = action === 'approve' ? '불법' : '합법'
    if (!confirm(`${selectedIds.size}개 도메인을 ${actionText}으로 일괄 처리하시겠습니까?`)) {
      return
    }

    try {
      await bulkMutation.mutateAsync({ 
        ids: Array.from(selectedIds), 
        action 
      })
      setSelectedIds(new Set())
      refetch()
    } catch (err) {
      console.error('Bulk review failed:', err)
      alert('일괄 처리 중 오류가 발생했습니다.')
    }
  }

  // AI 일괄 검토
  const handleAiReview = async () => {
    if (!confirm('AI가 모든 대기 항목을 자동으로 검토합니다. 진행하시겠습니까?')) {
      return
    }

    try {
      const result = await aiReviewMutation.mutateAsync()
      if (result.success) {
        showToast(`AI 검토 완료: ${result.processed || 0}개 처리됨`, 'success')
        refetch()
      } else {
        showToast(result.message || 'AI 검토에 실패했습니다', 'error')
      }
    } catch (err) {
      console.error('AI review failed:', err)
      showToast('AI 검토 중 오류가 발생했습니다', 'error')
    }
  }

  if (isLoading) {
    return <PendingListSkeleton />
  }

  if (error) {
    return (
      <EmptyState
        type="error"
        title="데이터 로드 실패"
        description="승인 대기 목록을 불러오는 중 오류가 발생했습니다."
        action={
          <Button onClick={() => refetch()} variant="outline">
            다시 시도
          </Button>
        }
      />
    )
  }

  const isAllSelected = items.length > 0 && selectedIds.size === items.length
  const hasSelection = selectedIds.size > 0

  return (
    <div className="space-y-4">
      {/* 필터 및 일괄 처리 영역 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">판단 결과:</span>
          <Select
            value={judgment}
            onChange={(value) => {
              setJudgment(value)
              setPage(1)
              setSelectedIds(new Set())
            }}
            options={JUDGMENT_OPTIONS}
            className="w-40"
          />
          
          {/* AI 일괄 검토 버튼 */}
          <Button
            onClick={handleAiReview}
            disabled={aiReviewMutation.isPending}
            variant="outline"
            size="sm"
            className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
          >
            {aiReviewMutation.isPending ? (
              <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            AI 일괄 검토
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 전체 선택 */}
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border rounded-md hover:bg-gray-50"
          >
            {isAllSelected ? (
              <CheckSquare className="h-4 w-4 text-blue-600" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            전체 선택
          </button>

          {/* 일괄 불법 */}
          <Button
            onClick={() => handleBulkReview('approve')}
            disabled={!hasSelection || bulkMutation.isPending}
            variant="default"
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            <XCircle className="mr-1 h-4 w-4" />
            일괄 불법 {hasSelection && `(${selectedIds.size})`}
          </Button>

          {/* 일괄 합법 */}
          <Button
            onClick={() => handleBulkReview('reject')}
            disabled={!hasSelection || bulkMutation.isPending}
            variant="outline"
            size="sm"
            className="disabled:opacity-50"
          >
            <CheckCircle className="mr-1 h-4 w-4" />
            일괄 합법 {hasSelection && `(${selectedIds.size})`}
          </Button>

          <span className="text-sm text-gray-500 ml-2">
            총 {pagination?.total || 0}건
          </span>
        </div>
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <EmptyState
          type="no-data"
          title="승인 대기 항목 없음"
          description="현재 승인 대기 중인 항목이 없습니다."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <PendingItem
              key={item.id}
              item={item}
              isSelected={selectedIds.has(item.id)}
              onSelect={() => handleSelect(item.id)}
              onApprove={() => handleReview(item.id, 'approve')}
              onReject={() => handleReview(item.id, 'reject')}
              isReviewing={reviewMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center pt-4">
          <Pagination
            page={page}
            totalPages={pagination.totalPages}
            onPageChange={(newPage) => {
              setPage(newPage)
              setSelectedIds(new Set())
            }}
          />
        </div>
      )}
    </div>
  )
}

// 개별 아이템 컴포넌트
function PendingItem({
  item,
  isSelected,
  onSelect,
  onApprove,
  onReject,
  isReviewing,
}: {
  item: PendingReview
  isSelected: boolean
  onSelect: () => void
  onApprove: () => void
  onReject: () => void
  isReviewing: boolean
}) {
  const judgmentStyles: Record<string, string> = {
    likely_illegal: 'bg-red-100 text-red-800',
    likely_legal: 'bg-green-100 text-green-800',
    uncertain: 'bg-yellow-100 text-yellow-800',
  }

  const judgmentLabels: Record<string, string> = {
    likely_illegal: '불법 추정',
    likely_legal: '합법 추정',
    uncertain: '불확실',
  }

  return (
    <Card className={`transition-shadow hover:shadow-md ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* 체크박스 */}
          <button
            onClick={onSelect}
            className="flex-shrink-0 mt-1"
          >
            {isSelected ? (
              <CheckSquare className="h-5 w-5 text-blue-600" />
            ) : (
              <Square className="h-5 w-5 text-gray-400 hover:text-gray-600" />
            )}
          </button>

          {/* 왼쪽: 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={judgmentStyles[item.llm_judgment || 'uncertain']}>
                {judgmentLabels[item.llm_judgment || 'uncertain']}
              </Badge>
              {item.titles && item.titles.length > 0 && (
                <span className="text-sm font-medium text-gray-700">
                  {item.titles.slice(0, 2).join(', ')}
                  {item.titles.length > 2 && ` 외 ${item.titles.length - 2}개`}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 mb-2">
              <a
                href={`https://${item.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm font-semibold text-gray-900 hover:text-blue-600 hover:underline flex items-center gap-1"
                title={`${item.domain} 바로가기`}
              >
                {item.domain}
                <ExternalLink className="h-3 w-3 text-gray-400" />
              </a>
              {item.urls && item.urls.length > 0 && (
                <a
                  href={item.urls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              {item.urls && item.urls.length > 1 && (
                <span className="text-xs text-gray-500">
                  외 {item.urls.length - 1}개 URL
                </span>
              )}
            </div>
            
            {item.llm_reason && (
              <p className="text-sm text-gray-600 line-clamp-2">{item.llm_reason}</p>
            )}
            
            {item.created_at && (
              <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                <Clock className="h-3 w-3" />
                {new Date(item.created_at).toLocaleString('ko-KR')}
              </div>
            )}
          </div>

          {/* 오른쪽: 버튼 */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={onApprove}
              disabled={isReviewing}
              variant="default"
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <XCircle className="mr-1 h-4 w-4" />
              불법
            </Button>
            <Button
              onClick={onReject}
              disabled={isReviewing}
              variant="outline"
              size="sm"
            >
              <CheckCircle className="mr-1 h-4 w-4" />
              합법
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 스켈레톤 로딩
function PendingListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      {[...Array(5)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-start gap-4">
              <Skeleton className="h-5 w-5" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-full" />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
