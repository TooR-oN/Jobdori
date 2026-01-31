'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface PaginationProps {
  page?: number
  currentPage?: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({
  page,
  currentPage: currentPageProp,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  // page 또는 currentPage prop 지원
  const currentPage = page ?? currentPageProp ?? 1
  if (totalPages <= 1) return null

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
        이전
      </Button>
      
      <span className="px-4 text-sm text-gray-600">
        {currentPage} / {totalPages}
      </span>
      
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        다음
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
