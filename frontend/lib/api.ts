// ============================================
// Jobdori API Client
// Backend Hono API 호출용 Fetch Wrapper
// ============================================

import type {
  DashboardResponse,
  PaginatedResponse,
  Session,
  PendingReview,
  DetectionResult,
  ReviewResponse,
  SitesResponse,
  TitlesResponse,
} from '@/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ''

// ============================================
// Generic API Fetch Wrapper
// ============================================

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include', // 쿠키 포함 (인증용)
      ...options,
    })

    if (response.status === 401) {
      // 인증 실패 시 로그인 페이지로 리다이렉트
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      return { success: false, error: 'Unauthorized' }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    console.error('API Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================
// Dashboard API
// ============================================

export async function getDashboardMonths(): Promise<{
  success: boolean
  months: string[]
  current_month: string
}> {
  const res = await fetchAPI<{ success: boolean; months: string[]; current_month: string }>(
    '/api/dashboard/months'
  )
  return res.data || { success: false, months: [], current_month: '' }
}

export async function getDashboard(month?: string): Promise<DashboardResponse> {
  const query = month ? `?month=${month}` : ''
  const res = await fetchAPI<DashboardResponse>(`/api/dashboard${query}`)
  return (
    res.data || {
      success: false,
      month: '',
      sessions_count: 0,
      top_contents: [],
      top_illegal_sites: [],
      total_stats: { total: 0, illegal: 0, legal: 0, pending: 0 },
    }
  )
}

// ============================================
// Sessions API
// ============================================

export async function getSessions(
  page = 1,
  limit = 20
): Promise<PaginatedResponse<Session> & { sessions?: Session[] }> {
  const res = await fetchAPI<PaginatedResponse<Session> & { sessions?: Session[] }>(
    `/api/sessions?page=${page}&limit=${limit}`
  )
  return (
    res.data || {
      success: false,
      count: 0,
      items: [],
      sessions: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    }
  )
}

export async function getSessionById(id: string): Promise<{ success: boolean; session?: Session }> {
  const res = await fetchAPI<{ success: boolean; session: Session }>(`/api/sessions/${id}`)
  return res.data || { success: false }
}

export async function getSessionResults(
  id: string,
  options: {
    page?: number
    limit?: number
    status?: string
    title?: string
  } = {}
): Promise<PaginatedResponse<DetectionResult> & { available_titles?: string[] }> {
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.limit) params.set('limit', String(options.limit))
  if (options.status && options.status !== 'all') params.set('status', options.status)
  if (options.title && options.title !== 'all') params.set('title', options.title)

  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetchAPI<PaginatedResponse<DetectionResult> & { available_titles?: string[] }>(
    `/api/sessions/${id}/results${query}`
  )
  return (
    res.data || {
      success: false,
      count: 0,
      items: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      available_titles: [],
    }
  )
}

// ============================================
// Pending Reviews API
// ============================================

export async function getPendingReviews(
  page = 1,
  limit = 20,
  judgment?: string
): Promise<PaginatedResponse<PendingReview>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (judgment) params.set('judgment', judgment)

  const res = await fetchAPI<PaginatedResponse<PendingReview>>(`/api/pending?${params.toString()}`)
  return (
    res.data || {
      success: false,
      count: 0,
      items: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    }
  )
}

export async function reviewItem(
  id: string | number,
  action: 'approve' | 'reject'
): Promise<ReviewResponse> {
  const res = await fetchAPI<ReviewResponse>('/api/review', {
    method: 'POST',
    body: JSON.stringify({ id: String(id), action }),
  })
  return res.data || { success: false, action }
}

// 일괄 처리 API
export async function reviewBulk(
  ids: (string | number)[],
  action: 'approve' | 'reject'
): Promise<{ success: boolean; processed?: number; failed?: number }> {
  const res = await fetchAPI<{ success: boolean; processed: number; failed: number }>('/api/review/bulk', {
    method: 'POST',
    body: JSON.stringify({ ids: ids.map(id => String(id)), action }),
  })
  return res.data || { success: false }
}

// ============================================
// Sites API
// ============================================

export async function getSites(
  type: 'illegal' | 'legal',
  page = 1,
  limit = 50,
  search?: string
): Promise<SitesResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (search) params.set('search', search)

  const res = await fetchAPI<SitesResponse>(`/api/sites/${type}?${params.toString()}`)
  return (
    res.data || {
      success: false,
      type,
      count: 0,
      sites: [],
    }
  )
}

export async function addSite(
  domain: string,
  type: 'illegal' | 'legal'
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/sites/${type}`, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  })
  return res.data || { success: false }
}

export async function removeSite(
  domain: string,
  type: 'illegal' | 'legal'
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/sites/${type}/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  })
  return res.data || { success: false }
}

// ============================================
// Titles API
// ============================================

export async function getTitles(): Promise<TitlesResponse> {
  const res = await fetchAPI<TitlesResponse>('/api/titles')
  return res.data || { success: false, current: [], history: [] }
}

export async function addTitle(title: string): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>('/api/titles', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
  return res.data || { success: false }
}

export async function removeTitle(title: string): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/titles/${encodeURIComponent(title)}`, {
    method: 'DELETE',
  })
  return res.data || { success: false }
}

export async function restoreTitle(title: string): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>('/api/titles/restore', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
  return res.data || { success: false }
}

// ============================================
// Auth API
// ============================================

export async function login(password: string): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  return res.data || { success: false }
}

export async function logout(): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>('/api/auth/logout', {
    method: 'POST',
  })
  return res.data || { success: false }
}

export async function checkAuthStatus(): Promise<{ authenticated: boolean }> {
  const res = await fetchAPI<{ authenticated: boolean }>('/api/auth/status')
  return res.data || { authenticated: false }
}

// ============================================
// Excluded URLs API (신고 제외 URL)
// ============================================

export interface ExcludedUrl {
  id: number
  url: string
  created_at: string
}

export async function getExcludedUrls(): Promise<{ success: boolean; urls: ExcludedUrl[] }> {
  const res = await fetchAPI<{ success: boolean; urls: ExcludedUrl[] }>('/api/excluded-urls')
  return res.data || { success: false, urls: [] }
}

export async function addExcludedUrl(url: string): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>('/api/excluded-urls', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
  return res.data || { success: false }
}

export async function removeExcludedUrl(id: number): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/excluded-urls/${id}`, {
    method: 'DELETE',
  })
  return res.data || { success: false }
}

// ============================================
// Manta Rankings API
// ============================================

export interface MantaRanking {
  title: string
  mantaRank: number | null
  firstRankDomain: string | null
  searchQuery: string | null
  page1IllegalCount: number
}

export async function getMantaRankings(): Promise<{ success: boolean; rankings: MantaRanking[] }> {
  const res = await fetchAPI<{ success: boolean; rankings: MantaRanking[] }>('/api/manta-rankings')
  return res.data || { success: false, rankings: [] }
}

export interface RankHistoryItem {
  rank: number | null
  firstRankDomain: string | null
  sessionId: string
  recordedAt: string
}

export async function getTitleRankHistory(title: string): Promise<{ success: boolean; history: RankHistoryItem[] }> {
  const res = await fetchAPI<{ success: boolean; history: RankHistoryItem[] }>(
    `/api/title-rank-history/${encodeURIComponent(title)}`
  )
  return res.data || { success: false, history: [] }
}

// ============================================
// Title Stats API (작품별 통계)
// ============================================

export interface TitleStatsItem {
  title: string
  detected: number
  reported: number
  blocked: number
  blockRate: string
}

export async function getTitleStats(
  startDate?: string,
  endDate?: string
): Promise<{ success: boolean; stats: TitleStatsItem[] }> {
  const params = new URLSearchParams()
  if (startDate) params.set('start', startDate)
  if (endDate) params.set('end', endDate)
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetchAPI<{ success: boolean; stats: TitleStatsItem[] }>(`/api/title-stats${query}`)
  return res.data || { success: false, stats: [] }
}

// ============================================
// Titles API (Manta URL 포함)
// ============================================

export interface TitleWithManta {
  name: string
  manta_url: string | null
}

export async function getTitlesWithManta(): Promise<{ 
  success: boolean
  current: TitleWithManta[]
  history: TitleWithManta[]
}> {
  const res = await fetchAPI<{ success: boolean; current: TitleWithManta[]; history: TitleWithManta[] }>('/api/titles')
  return res.data || { success: false, current: [], history: [] }
}

export async function addTitleWithManta(title: string, mantaUrl?: string): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>('/api/titles', {
    method: 'POST',
    body: JSON.stringify({ title, manta_url: mantaUrl }),
  })
  return res.data || { success: false }
}

// ============================================
// Report Tracking API (신고결과 추적)
// ============================================

export interface ReportTrackingSession {
  id: string
  created_at: string
  total_count: number
  reported_count: number
  blocked_count: number
  pending_count: number
}

export interface ReportTrackingItem {
  id: number
  session_id: string
  title: string
  domain: string
  url: string
  search_query: string
  page: number
  rank: number
  report_status: 'pending' | 'reported' | 'blocked' | 'rejected'
  report_reason: string | null
  report_id: string | null
  reported_at: string | null
  blocked_at: string | null
  created_at: string
}

export interface ReportTrackingStats {
  total: number
  reported: number
  blocked: number
  pending: number
  rejected: number
}

export interface ReportTrackingUpload {
  id: number
  session_id: string
  filename: string
  status: 'pending' | 'processed' | 'failed'
  processed_count: number
  created_at: string
}

// 신고 추적 세션 목록
export async function getReportTrackingSessions(): Promise<{
  success: boolean
  sessions: ReportTrackingSession[]
}> {
  const res = await fetchAPI<{ success: boolean; sessions: ReportTrackingSession[] }>(
    '/api/report-tracking/sessions'
  )
  return res.data || { success: false, sessions: [] }
}

// 신고 사유 목록
export async function getReportReasons(): Promise<{
  success: boolean
  reasons: string[]
}> {
  const res = await fetchAPI<{ success: boolean; reasons: string[] }>(
    '/api/report-tracking/reasons'
  )
  return res.data || { success: false, reasons: [] }
}

// 세션별 신고 추적 데이터
export async function getReportTrackingData(
  sessionId: string,
  options: {
    page?: number
    limit?: number
    status?: string
    title?: string
  } = {}
): Promise<{
  success: boolean
  items: ReportTrackingItem[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  available_titles?: string[]
}> {
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.limit) params.set('limit', String(options.limit))
  if (options.status && options.status !== 'all') params.set('status', options.status)
  if (options.title && options.title !== 'all') params.set('title', options.title)

  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetchAPI<{
    success: boolean
    items: ReportTrackingItem[]
    pagination: { page: number; limit: number; total: number; totalPages: number }
    available_titles?: string[]
  }>(`/api/report-tracking/${sessionId}${query}`)

  return res.data || {
    success: false,
    items: [],
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    available_titles: [],
  }
}

// 세션별 통계
export async function getReportTrackingStats(sessionId: string): Promise<{
  success: boolean
  stats: ReportTrackingStats
}> {
  const res = await fetchAPI<{ success: boolean; stats: ReportTrackingStats }>(
    `/api/report-tracking/${sessionId}/stats`
  )
  return res.data || {
    success: false,
    stats: { total: 0, reported: 0, blocked: 0, pending: 0, rejected: 0 },
  }
}

// 신고 상태 변경
export async function updateReportStatus(
  id: number,
  status: 'pending' | 'reported' | 'blocked' | 'rejected'
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/report-tracking/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
  return res.data || { success: false }
}

// 신고 사유 변경
export async function updateReportReason(
  id: number,
  reason: string
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/report-tracking/${id}/reason`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  })
  return res.data || { success: false }
}

// 신고 ID 변경 (인라인 수정)
export async function updateReportId(
  id: number,
  reportId: string
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/report-tracking/${id}/report-id`, {
    method: 'PUT',
    body: JSON.stringify({ report_id: reportId }),
  })
  return res.data || { success: false }
}

// URL 추가
export async function addReportTrackingUrl(
  sessionId: string,
  url: string,
  title?: string
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/report-tracking/${sessionId}/add-url`, {
    method: 'POST',
    body: JSON.stringify({ url, title }),
  })
  return res.data || { success: false }
}

// HTML 파일 업로드
export async function uploadReportTrackingFile(
  sessionId: string,
  file: File
): Promise<{ success: boolean; processed?: number }> {
  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch(`${API_BASE}/api/report-tracking/${sessionId}/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    return await response.json()
  } catch (error) {
    console.error('Upload error:', error)
    return { success: false }
  }
}

// 업로드 목록 조회
export async function getReportTrackingUploads(sessionId: string): Promise<{
  success: boolean
  uploads: ReportTrackingUpload[]
}> {
  const res = await fetchAPI<{ success: boolean; uploads: ReportTrackingUpload[] }>(
    `/api/report-tracking/${sessionId}/uploads`
  )
  return res.data || { success: false, uploads: [] }
}

// 업로드 상태 변경
export async function updateUploadStatus(
  uploadId: number,
  status: 'pending' | 'processed' | 'failed'
): Promise<{ success: boolean }> {
  const res = await fetchAPI<{ success: boolean }>(`/api/report-tracking/uploads/${uploadId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
  return res.data || { success: false }
}

// URL 목록 조회
export async function getReportTrackingUrls(
  sessionId: string,
  status?: string
): Promise<{ success: boolean; urls: string[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await fetchAPI<{ success: boolean; urls: string[] }>(
    `/api/report-tracking/${sessionId}/urls${query}`
  )
  return res.data || { success: false, urls: [] }
}

// Excel 내보내기 URL 생성
export function getReportTrackingExportUrl(sessionId: string): string {
  return `${API_BASE}/api/report-tracking/${sessionId}/export`
}

// AI 일괄 검토 API
export async function aiReviewPending(): Promise<{
  success: boolean
  processed?: number
  message?: string
}> {
  const res = await fetchAPI<{ success: boolean; processed: number; message: string }>(
    '/api/pending/ai-review',
    { method: 'POST' }
  )
  return res.data || { success: false }
}
