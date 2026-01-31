'use client'

import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

interface MonthSelectorProps {
  months: string[]
  currentMonth: string
  selectedMonth: string
  onMonthChange: (month: string) => void
  isLoading?: boolean
}

export function MonthSelector({
  months,
  currentMonth,
  selectedMonth,
  onMonthChange,
  isLoading,
}: MonthSelectorProps) {
  if (isLoading) {
    return <Skeleton className="h-9 w-32" />
  }

  const options = months.map((month) => ({
    value: month,
    label: formatMonth(month),
  }))

  return (
    <Select
      value={selectedMonth || currentMonth}
      onChange={onMonthChange}
      options={options}
      className="w-40"
    />
  )
}

function formatMonth(month: string): string {
  // "2025-01" -> "2025년 1월"
  const [year, m] = month.split('-')
  return `${year}년 ${parseInt(m)}월`
}
