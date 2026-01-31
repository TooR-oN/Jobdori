'use client'

import { cn } from '@/lib/utils'
import { AlertCircle, AlertTriangle, Info, CheckCircle, FileQuestion } from 'lucide-react'

type EmptyStateType = 'empty' | 'error' | 'warning' | 'info' | 'success' | 'no-data'

interface EmptyStateProps {
  type?: EmptyStateType
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

const typeIcons = {
  empty: FileQuestion,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
  'no-data': FileQuestion,
}

const typeColors = {
  empty: 'text-gray-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
  success: 'text-green-400',
  'no-data': 'text-gray-400',
}

export function EmptyState({
  type = 'empty',
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const TypeIcon = typeIcons[type]
  const iconColor = typeColors[type]

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className
      )}
    >
      {icon ? (
        <div className="mb-4 text-gray-400">
          {icon}
        </div>
      ) : (
        <TypeIcon className={cn('mb-4 h-12 w-12', iconColor)} />
      )}
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
