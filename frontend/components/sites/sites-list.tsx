// ============================================
// 사이트 목록 컴포넌트 (3분할 레이아웃)
// ============================================

'use client'

import { useState } from 'react'
import { 
  useSites, 
  useAddSite, 
  useRemoveSite,
  useExcludedUrls, 
  useAddExcludedUrl, 
  useRemoveExcludedUrl 
} from '@/hooks/use-api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { 
  Search, 
  Globe, 
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Plus,
  X
} from 'lucide-react'

export function SitesList() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 불법 사이트 */}
      <IllegalSitesSection />
      
      {/* 합법 사이트 */}
      <LegalSitesSection />
      
      {/* 신고 제외 URL */}
      <ExcludedUrlsSection />
    </div>
  )
}

// ============================================
// 불법 사이트 섹션
// ============================================
function IllegalSitesSection() {
  const { showToast } = useToast()
  const [newDomain, setNewDomain] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  const { data, isLoading, refetch } = useSites('illegal', 1, 1000)
  const addMutation = useAddSite()
  const removeMutation = useRemoveSite()

  const sites = data?.sites || []
  const filteredSites = searchQuery 
    ? sites.filter(site => site.toLowerCase().includes(searchQuery.toLowerCase()))
    : sites

  const handleAdd = async () => {
    if (!newDomain.trim()) return
    
    // 도메인 형식 정리 (http://, https:// 제거)
    let domain = newDomain.trim()
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    
    try {
      await addMutation.mutateAsync({ domain, type: 'illegal' })
      setNewDomain('')
      showToast('불법 사이트가 추가되었습니다', 'success')
      refetch()
    } catch (err) {
      showToast('추가에 실패했습니다', 'error')
    }
  }

  const handleRemove = async (domain: string) => {
    if (!confirm(`"${domain}"을 불법 사이트 목록에서 삭제하시겠습니까?`)) return
    
    try {
      await removeMutation.mutateAsync({ domain, type: 'illegal' })
      showToast('삭제되었습니다', 'success')
      refetch()
    } catch (err) {
      showToast('삭제에 실패했습니다', 'error')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="h-5 w-5 text-red-500" />
        <h3 className="font-semibold text-red-600">불법 사이트 ({sites.length}개)</h3>
      </div>

      {/* 도메인 추가 입력 */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="불법 사이트 도메인 입력..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        <Button 
          onClick={handleAdd}
          disabled={addMutation.isPending || !newDomain.trim()}
          size="sm"
          className="bg-red-500 hover:bg-red-600 text-white px-3"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* 검색 */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="검색..."
          className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white">
        {isLoading ? (
          <SitesListSkeleton />
        ) : filteredSites.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            {searchQuery ? '검색 결과가 없습니다' : '등록된 사이트가 없습니다'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredSites.map((domain, index) => (
              <li 
                key={index} 
                className="flex items-center justify-between px-3 py-2 hover:bg-red-50 group"
              >
                <a
                  href={`https://${domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-gray-700 hover:text-red-600 truncate flex-1"
                  title={domain}
                >
                  <Globe className="h-4 w-4 text-red-400 flex-shrink-0" />
                  <span className="truncate">{domain}</span>
                </a>
                <button
                  onClick={() => handleRemove(domain)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"
                  title="삭제"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ============================================
// 합법 사이트 섹션
// ============================================
function LegalSitesSection() {
  const { showToast } = useToast()
  const [newDomain, setNewDomain] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  const { data, isLoading, refetch } = useSites('legal', 1, 1000)
  const addMutation = useAddSite()
  const removeMutation = useRemoveSite()

  const sites = data?.sites || []
  const filteredSites = searchQuery 
    ? sites.filter(site => site.toLowerCase().includes(searchQuery.toLowerCase()))
    : sites

  const handleAdd = async () => {
    if (!newDomain.trim()) return
    
    let domain = newDomain.trim()
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    
    try {
      await addMutation.mutateAsync({ domain, type: 'legal' })
      setNewDomain('')
      showToast('합법 사이트가 추가되었습니다', 'success')
      refetch()
    } catch (err) {
      showToast('추가에 실패했습니다', 'error')
    }
  }

  const handleRemove = async (domain: string) => {
    if (!confirm(`"${domain}"을 합법 사이트 목록에서 삭제하시겠습니까?`)) return
    
    try {
      await removeMutation.mutateAsync({ domain, type: 'legal' })
      showToast('삭제되었습니다', 'success')
      refetch()
    } catch (err) {
      showToast('삭제에 실패했습니다', 'error')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="h-5 w-5 text-green-500" />
        <h3 className="font-semibold text-green-600">합법 사이트 ({sites.length}개)</h3>
      </div>

      {/* 도메인 추가 입력 */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="합법 사이트 도메인 입력..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <Button 
          onClick={handleAdd}
          disabled={addMutation.isPending || !newDomain.trim()}
          size="sm"
          className="bg-green-500 hover:bg-green-600 text-white px-3"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* 검색 */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="검색..."
          className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white">
        {isLoading ? (
          <SitesListSkeleton />
        ) : filteredSites.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            {searchQuery ? '검색 결과가 없습니다' : '등록된 사이트가 없습니다'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredSites.map((domain, index) => (
              <li 
                key={index} 
                className="flex items-center justify-between px-3 py-2 hover:bg-green-50 group"
              >
                <a
                  href={`https://${domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-gray-700 hover:text-green-600 truncate flex-1"
                  title={domain}
                >
                  <Globe className="h-4 w-4 text-green-400 flex-shrink-0" />
                  <span className="truncate">{domain}</span>
                </a>
                <button
                  onClick={() => handleRemove(domain)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"
                  title="삭제"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ============================================
// 신고 제외 URL 섹션
// ============================================
function ExcludedUrlsSection() {
  const { showToast } = useToast()
  const [newUrl, setNewUrl] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  const { data, isLoading, refetch } = useExcludedUrls()
  const addMutation = useAddExcludedUrl()
  const removeMutation = useRemoveExcludedUrl()

  const urls = data?.urls || []
  const filteredUrls = searchQuery 
    ? urls.filter(item => item.url.toLowerCase().includes(searchQuery.toLowerCase()))
    : urls

  const handleAdd = async () => {
    if (!newUrl.trim()) return
    
    // URL 형식 검증
    if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
      showToast('URL은 http:// 또는 https://로 시작해야 합니다', 'error')
      return
    }
    
    try {
      await addMutation.mutateAsync(newUrl.trim())
      setNewUrl('')
      showToast('신고 제외 URL이 추가되었습니다', 'success')
      refetch()
    } catch (err) {
      showToast('추가에 실패했습니다', 'error')
    }
  }

  const handleRemove = async (id: number, url: string) => {
    if (!confirm(`이 URL을 신고 제외 목록에서 삭제하시겠습니까?\n${url}`)) return
    
    try {
      await removeMutation.mutateAsync(id)
      showToast('삭제되었습니다', 'success')
      refetch()
    } catch (err) {
      showToast('삭제에 실패했습니다', 'error')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-4">
        <ShieldOff className="h-5 w-5 text-orange-500" />
        <h3 className="font-semibold text-orange-600">신고 제외 URL ({urls.length}개)</h3>
      </div>

      {/* URL 추가 입력 */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="신고 제외할 전체 URL 입력 (https://...)"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        <Button 
          onClick={handleAdd}
          disabled={addMutation.isPending || !newUrl.trim()}
          size="sm"
          className="bg-orange-500 hover:bg-orange-600 text-white px-3"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* 안내 문구 */}
      <div className="text-xs text-orange-600 bg-orange-50 rounded px-2 py-1 mb-3">
        ℹ️ 불법 사이트지만 신고해도 처리되지 않는 URL (예: 메인 페이지)
      </div>

      {/* 검색 */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="검색..."
          className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-white">
        {isLoading ? (
          <SitesListSkeleton />
        ) : filteredUrls.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            {searchQuery ? '검색 결과가 없습니다' : '등록된 URL이 없습니다'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredUrls.map((item) => (
              <li 
                key={item.id} 
                className="flex items-center justify-between px-3 py-2 hover:bg-orange-50 group"
              >
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 truncate flex-1"
                  title={item.url}
                >
                  <ExternalLink className="h-4 w-4 text-orange-400 flex-shrink-0" />
                  <span className="truncate">{item.url}</span>
                </a>
                <button
                  onClick={() => handleRemove(item.id, item.url)}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1"
                  title="삭제"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ============================================
// 스켈레톤 로딩
// ============================================
function SitesListSkeleton() {
  return (
    <div className="p-2 space-y-2">
      {[...Array(10)].map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}
