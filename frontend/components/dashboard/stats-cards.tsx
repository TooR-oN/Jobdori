// ============================================
// 대시보드 통계 카드 (간소화 버전)
// ============================================

'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/utils'
import { 
  Eye, 
  AlertTriangle, 
  Shield, 
  TrendingUp
} from 'lucide-react'

interface StatsCardsProps {
  total: number
  illegal: number
  legal: number
  sessionsCount: number
  isLoading?: boolean
}

export function StatsCards({ 
  total, 
  illegal, 
  legal, 
  sessionsCount, 
  isLoading
}: StatsCardsProps) {
  // 보호율 계산 (차단된 불법 URL / 전체 불법 URL)
  const protectionRate = total > 0 ? ((legal / total) * 100).toFixed(1) : '0.0'

  const stats = [
    {
      label: '발견',
      value: total,
      icon: Eye,
      iconBgColor: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      label: '신고',
      value: illegal,
      icon: AlertTriangle,
      iconBgColor: 'bg-red-100',
      iconColor: 'text-red-600',
    },
    {
      label: '차단',
      value: legal,
      icon: Shield,
      iconBgColor: 'bg-green-100',
      iconColor: 'text-green-600',
    },
    {
      label: '차단율',
      value: protectionRate,
      isPercentage: true,
      icon: TrendingUp,
      iconBgColor: 'bg-purple-100',
      iconColor: 'text-purple-600',
    },
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-white">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <Skeleton className="h-3 w-16 mb-3" />
                  <Skeleton className="h-8 w-20" />
                </div>
                <Skeleton className="h-10 w-10 rounded-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map((stat) => {
        const Icon = stat.icon
        
        return (
          <Card key={stat.label} className="bg-white hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  {/* 라벨 */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-500">
                      {stat.label}
                    </span>
                  </div>
                  
                  {/* 값 */}
                  <span className="text-3xl font-bold text-gray-900">
                    {stat.isPercentage 
                      ? `${stat.value}%` 
                      : formatNumber(stat.value as number)
                    }
                  </span>
                </div>
                
                {/* 아이콘 */}
                <div className={`p-2.5 rounded-full ${stat.iconBgColor}`}>
                  <Icon className={`h-5 w-5 ${stat.iconColor}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
