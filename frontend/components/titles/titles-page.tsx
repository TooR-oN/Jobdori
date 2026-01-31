// ============================================
// 작품 관리 페이지 컴포넌트 (독립 페이지 버전)
// ============================================

'use client'

import { useState } from 'react'
import { useTitlesWithManta, useAddTitleWithManta, useRemoveTitle, useRestoreTitle } from '@/hooks/use-api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { 
  Plus, 
  X, 
  BookOpen, 
  History, 
  RotateCcw,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  Link2,
  BookMarked
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function TitlesPageContent() {
  const [newTitle, setNewTitle] = useState('')
  const [newMantaUrl, setNewMantaUrl] = useState('')
  
  const { data, isLoading, error, refetch } = useTitlesWithManta()
  const addMutation = useAddTitleWithManta()
  const removeMutation = useRemoveTitle()
  const restoreMutation = useRestoreTitle()

  const handleAddTitle = async () => {
    if (!newTitle.trim()) return
    
    try {
      await addMutation.mutateAsync({ 
        title: newTitle.trim(),
        mantaUrl: newMantaUrl.trim() || undefined
      })
      setNewTitle('')
      setNewMantaUrl('')
      refetch()
    } catch (err) {
      console.error('Failed to add title:', err)
    }
  }

  const handleRemoveTitle = async (title: string) => {
    if (!confirm(`"${title}" 작품을 모니터링 목록에서 제거하시겠습니까?`)) return
    
    try {
      await removeMutation.mutateAsync(title)
      refetch()
    } catch (err) {
      console.error('Failed to remove title:', err)
    }
  }

  const handleRestoreTitle = async (title: string) => {
    try {
      await restoreMutation.mutateAsync(title)
      refetch()
    } catch (err) {
      console.error('Failed to restore title:', err)
    }
  }

  const currentTitles = data?.current || []
  const historyTitles = data?.history || []

  return (
    <div className="space-y-6">
      {/* 새 작품 추가 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-5 w-5 text-purple-600" />
            새 작품 추가
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="작품명 입력..."
              className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              disabled={addMutation.isPending}
            />
            <input
              type="text"
              value={newMantaUrl}
              onChange={(e) => setNewMantaUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTitle()}
              placeholder="Manta URL"
              className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              disabled={addMutation.isPending}
            />
            <Button
              onClick={handleAddTitle}
              disabled={!newTitle.trim() || addMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 px-6"
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              추가
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            예: https://manta.net/en/series/작품명?seriesId=1234
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 현재 모니터링 대상 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-purple-600" />
              현재 모니터링 대상
              <span className="text-sm font-normal text-gray-500">
                ({currentTitles.length}개)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : error ? (
                <EmptyState
                  type="error"
                  title="로드 실패"
                  description="다시 시도해 주세요."
                  action={
                    <Button onClick={() => refetch()} variant="outline" size="sm">
                      다시 시도
                    </Button>
                  }
                />
              ) : currentTitles.length === 0 ? (
                <EmptyState
                  type="no-data"
                  title="등록된 작품 없음"
                  description="위에서 새 작품을 추가해 주세요."
                />
              ) : (
                currentTitles.map((item, index) => (
                  <TitleCard
                    key={index}
                    name={item.name}
                    mantaUrl={item.manta_url}
                    onRemove={() => handleRemoveTitle(item.name)}
                    isRemoving={removeMutation.isPending}
                    variant="current"
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* 이전 대상 (히스토리) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-5 w-5 text-gray-500" />
              이전 대상
              <span className="text-sm font-normal text-gray-500">
                ({historyTitles.length}개)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-y-auto space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : historyTitles.length === 0 ? (
                <EmptyState
                  type="no-data"
                  title="히스토리 없음"
                  description="제거된 작품이 여기 표시됩니다."
                />
              ) : (
                historyTitles.map((item, index) => (
                  <TitleCard
                    key={index}
                    name={item.name}
                    mantaUrl={item.manta_url}
                    onRestore={() => handleRestoreTitle(item.name)}
                    isRestoring={restoreMutation.isPending}
                    variant="history"
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// 작품 카드 컴포넌트
function TitleCard({
  name,
  mantaUrl,
  onRemove,
  onRestore,
  isRemoving,
  isRestoring,
  variant
}: {
  name: string
  mantaUrl: string | null
  onRemove?: () => void
  onRestore?: () => void
  isRemoving?: boolean
  isRestoring?: boolean
  variant: 'current' | 'history'
}) {
  const [copied, setCopied] = useState(false)

  const handleCopyUrl = async () => {
    if (!mantaUrl) return
    try {
      await navigator.clipboard.writeText(mantaUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  const isCurrent = variant === 'current'

  return (
    <div className={cn(
      'rounded-lg border bg-white p-3 hover:shadow-sm transition-shadow',
      isCurrent ? 'border-purple-200 hover:border-purple-300' : 'border-gray-200 hover:border-gray-300'
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isCurrent ? (
              <BookOpen className="h-4 w-4 text-purple-500 flex-shrink-0" />
            ) : (
              <History className="h-4 w-4 text-gray-400 flex-shrink-0" />
            )}
            <span className={cn(
              'font-medium truncate',
              isCurrent ? 'text-gray-800' : 'text-gray-500'
            )}>
              {name}
            </span>
          </div>
          
          {mantaUrl && (
            <div className="flex items-center gap-1 mt-1 ml-6">
              <Link2 className="h-3 w-3 text-blue-400 flex-shrink-0" />
              <a
                href={mantaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:text-blue-700 hover:underline truncate max-w-[250px]"
                title={mantaUrl}
              >
                {mantaUrl}
              </a>
              <button
                onClick={handleCopyUrl}
                className="text-gray-400 hover:text-gray-600 p-0.5"
                title="URL 복사"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
              <a
                href={mantaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-blue-500 p-0.5"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* 액션 버튼 */}
        {isCurrent && onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={isRemoving}
            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 h-auto"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {!isCurrent && onRestore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRestore}
            disabled={isRestoring}
            className="text-purple-500 hover:text-purple-700 hover:bg-purple-50 p-1 h-auto"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
