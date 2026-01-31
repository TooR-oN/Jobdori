// ============================================
// 신고결과 추적 상세 컴포넌트
// ============================================

'use client'

import { useState, useCallback, useRef } from 'react'
import {
  useReportTrackingData,
  useReportTrackingStats,
  useReportReasons,
  useUpdateReportStatus,
  useUpdateReportReason,
  useUpdateReportId,
  useUploadReportTrackingFile,
} from '@/hooks/use-api'
import { getReportTrackingExportUrl } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import {
  ArrowLeft,
  Download,
  Upload,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Edit2,
  Check,
  X,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReportTrackingDetailProps {
  sessionId: string
  onBack: () => void
}

const STATUS_OPTIONS = [
  { value: 'all', label: '전체 상태' },
  { value: 'pending', label: '대기' },
  { value: 'reported', label: '신고됨' },
  { value: 'blocked', label: '차단됨' },
  { value: 'rejected', label: '반려됨' },
]

const STATUS_CHANGE_OPTIONS = [
  { value: 'pending', label: '대기' },
  { value: 'reported', label: '신고됨' },
  { value: 'blocked', label: '차단됨' },
  { value: 'rejected', label: '반려됨' },
]

export function ReportTrackingDetail({ sessionId, onBack }: ReportTrackingDetailProps) {
  const { showToast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [title, setTitle] = useState('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingReportId, setEditingReportId] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const limit = 50

  const { data, isLoading, error, refetch } = useReportTrackingData(sessionId, {
    page,
    limit,
    status: status === 'all' ? undefined : status,
    title: title === 'all' ? undefined : title,
  })

  const { data: statsData } = useReportTrackingStats(sessionId)
  const { data: reasonsData } = useReportReasons()

  const updateStatus = useUpdateReportStatus()
  const updateReason = useUpdateReportReason()
  const updateReportIdMutation = useUpdateReportId()
  const uploadFile = useUploadReportTrackingFile()

  const items = data?.items || []
  const pagination = data?.pagination
  const availableTitles = data?.available_titles || []
  const stats = statsData?.stats
  const reasons = reasonsData?.reasons || []

  const titleOptions = [
    { value: 'all', label: '전체 작품' },
    ...availableTitles.map((t) => ({ value: t, label: t })),
  ]

  // 상태 변경 핸들러
  const handleStatusChange = async (id: number, newStatus: string) => {
    try {
      await updateStatus.mutateAsync({
        id,
        status: newStatus as 'pending' | 'reported' | 'blocked' | 'rejected',
      })
      showToast('상태가 변경되었습니다', 'success')
    } catch (err) {
      showToast('상태 변경에 실패했습니다', 'error')
    }
  }

  // 사유 변경 핸들러
  const handleReasonChange = async (id: number, newReason: string) => {
    try {
      await updateReason.mutateAsync({ id, reason: newReason })
      showToast('사유가 변경되었습니다', 'success')
    } catch (err) {
      showToast('사유 변경에 실패했습니다', 'error')
    }
  }

  // 신고 ID 인라인 수정
  const handleStartEditReportId = (id: number, currentReportId: string | null) => {
    setEditingId(id)
    setEditingReportId(currentReportId || '')
  }

  const handleSaveReportId = async () => {
    if (editingId === null) return

    try {
      await updateReportIdMutation.mutateAsync({
        id: editingId,
        reportId: editingReportId,
      })
      showToast('신고 ID가 저장되었습니다', 'success')
      setEditingId(null)
      setEditingReportId('')
    } catch (err) {
      showToast('신고 ID 저장에 실패했습니다', 'error')
    }
  }

  const handleCancelEditReportId = () => {
    setEditingId(null)
    setEditingReportId('')
  }

  // 파일 드래그앤드롭 핸들러
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      const htmlFile = files.find(
        (f) => f.type === 'text/html' || f.name.endsWith('.html')
      )

      if (!htmlFile) {
        showToast('HTML 파일만 업로드할 수 있습니다', 'error')
        return
      }

      try {
        const result = await uploadFile.mutateAsync({
          sessionId,
          file: htmlFile,
        })
        if (result.success) {
          showToast(`${result.processed || 0}개 URL이 처리되었습니다`, 'success')
          refetch()
        } else {
          showToast('파일 처리에 실패했습니다', 'error')
        }
      } catch (err) {
        showToast('파일 업로드에 실패했습니다', 'error')
      }
    },
    [sessionId, uploadFile, refetch, showToast]
  )

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const result = await uploadFile.mutateAsync({
        sessionId,
        file,
      })
      if (result.success) {
        showToast(`${result.processed || 0}개 URL이 처리되었습니다`, 'success')
        refetch()
      } else {
        showToast('파일 처리에 실패했습니다', 'error')
      }
    } catch (err) {
      showToast('파일 업로드에 실패했습니다', 'error')
    }

    // 파일 입력 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  if (error) {
    return (
      <EmptyState
        type="error"
        title="데이터 로드 실패"
        description="신고 추적 데이터를 불러오는 중 오류가 발생했습니다."
        action={
          <Button onClick={onBack} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            목록으로
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button onClick={onBack} variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            목록으로
          </Button>
          <h2 className="text-xl font-bold text-gray-900">신고결과 추적</h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => window.open(getReportTrackingExportUrl(sessionId), '_blank')}
            variant="outline"
            size="sm"
          >
            <Download className="mr-2 h-4 w-4" />
            Excel 내보내기
          </Button>
          <Button onClick={() => refetch()} variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            icon={<FileText className="h-5 w-5 text-blue-500" />}
            label="전체"
            value={stats.total}
            color="blue"
          />
          <StatCard
            icon={<Clock className="h-5 w-5 text-yellow-500" />}
            label="대기"
            value={stats.pending}
            color="yellow"
          />
          <StatCard
            icon={<AlertTriangle className="h-5 w-5 text-orange-500" />}
            label="신고됨"
            value={stats.reported}
            color="orange"
          />
          <StatCard
            icon={<CheckCircle className="h-5 w-5 text-green-500" />}
            label="차단됨"
            value={stats.blocked}
            color="green"
          />
          <StatCard
            icon={<XCircle className="h-5 w-5 text-red-500" />}
            label="반려됨"
            value={stats.rejected}
            color="red"
          />
        </div>
      )}

      {/* 파일 업로드 영역 (드래그앤드롭) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        )}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-600 mb-2">
          HTML 파일을 드래그하여 업로드하거나
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,text/html"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadFile.isPending}
        >
          {uploadFile.isPending ? '업로드 중...' : '파일 선택'}
        </Button>
      </div>

      {/* 필터 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-gray-700">필터:</span>
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
        </CardContent>
      </Card>

      {/* 결과 목록 */}
      {isLoading ? (
        <ReportTrackingDetailSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          type="no-data"
          title="결과 없음"
          description="해당 조건에 맞는 데이터가 없습니다."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ReportTrackingCard
              key={item.id}
              item={item}
              reasons={reasons}
              isEditing={editingId === item.id}
              editingReportId={editingReportId}
              onStatusChange={handleStatusChange}
              onReasonChange={handleReasonChange}
              onStartEditReportId={handleStartEditReportId}
              onSaveReportId={handleSaveReportId}
              onCancelEditReportId={handleCancelEditReportId}
              onEditingReportIdChange={setEditingReportId}
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
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  )
}

// 통계 카드 컴포넌트
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: 'blue' | 'yellow' | 'orange' | 'green' | 'red'
}) {
  const bgColors = {
    blue: 'bg-blue-50',
    yellow: 'bg-yellow-50',
    orange: 'bg-orange-50',
    green: 'bg-green-50',
    red: 'bg-red-50',
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

// 신고 추적 카드 컴포넌트
function ReportTrackingCard({
  item,
  reasons,
  isEditing,
  editingReportId,
  onStatusChange,
  onReasonChange,
  onStartEditReportId,
  onSaveReportId,
  onCancelEditReportId,
  onEditingReportIdChange,
}: {
  item: {
    id: number
    title: string
    domain: string
    url: string
    search_query: string
    page: number
    rank: number
    report_status: string
    report_reason: string | null
    report_id: string | null
  }
  reasons: string[]
  isEditing: boolean
  editingReportId: string
  onStatusChange: (id: number, status: string) => void
  onReasonChange: (id: number, reason: string) => void
  onStartEditReportId: (id: number, currentReportId: string | null) => void
  onSaveReportId: () => void
  onCancelEditReportId: () => void
  onEditingReportIdChange: (value: string) => void
}) {
  const statusStyles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    reported: 'bg-orange-100 text-orange-800',
    blocked: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }

  const statusLabels: Record<string, string> = {
    pending: '대기',
    reported: '신고됨',
    blocked: '차단됨',
    rejected: '반려됨',
  }

  const reasonOptions = [
    { value: '', label: '사유 선택' },
    ...reasons.map((r) => ({ value: r, label: r })),
  ]

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* 상단: 작품명, 도메인, URL */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge className={statusStyles[item.report_status]}>
                  {statusLabels[item.report_status]}
                </Badge>
                <span className="text-sm font-medium text-gray-700">
                  {item.title}
                </span>
              </div>
              <div className="font-mono text-sm text-gray-900 mb-1">
                {item.domain}
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-500 hover:text-blue-700 truncate block"
              >
                {item.url}
                <ExternalLink className="inline ml-1 h-3 w-3" />
              </a>
            </div>
          </div>

          {/* 하단: 상태 변경, 사유 변경, 신고 ID */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
            {/* 상태 변경 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">상태:</span>
              <Select
                value={item.report_status}
                onChange={(v) => onStatusChange(item.id, v)}
                options={STATUS_CHANGE_OPTIONS}
                className="w-28 text-xs"
              />
            </div>

            {/* 사유 변경 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">사유:</span>
              <Select
                value={item.report_reason || ''}
                onChange={(v) => onReasonChange(item.id, v)}
                options={reasonOptions}
                className="w-40 text-xs"
              />
            </div>

            {/* 신고 ID 인라인 수정 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">신고ID:</span>
              {isEditing ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editingReportId}
                    onChange={(e) => onEditingReportIdChange(e.target.value)}
                    className="w-24 px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="신고 ID"
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSaveReportId}
                    className="h-6 w-6 p-0"
                  >
                    <Check className="h-3 w-3 text-green-600" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCancelEditReportId}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3 text-red-600" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-700">
                    {item.report_id || '-'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onStartEditReportId(item.id, item.report_id)}
                    className="h-6 w-6 p-0"
                  >
                    <Edit2 className="h-3 w-3 text-gray-400" />
                  </Button>
                </div>
              )}
            </div>

            {/* 메타 정보 */}
            <div className="ml-auto text-xs text-gray-400">
              검색: {item.search_query} | P{item.page}-{item.rank}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ReportTrackingDetailSkeleton() {
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
