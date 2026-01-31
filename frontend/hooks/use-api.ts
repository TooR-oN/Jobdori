// ============================================
// Jobdori TanStack Query Hooks
// 서버 상태 동기화 및 캐싱
// ============================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '@/lib/api'

// ============================================
// Query Keys
// ============================================

export const queryKeys = {
  dashboard: (month?: string) => ['dashboard', month] as const,
  dashboardMonths: ['dashboard', 'months'] as const,
  sessions: (page: number, limit: number) => ['sessions', page, limit] as const,
  session: (id: string) => ['session', id] as const,
  sessionResults: (id: string, options: Record<string, unknown>) =>
    ['session', id, 'results', options] as const,
  pendingReviews: (page: number, limit: number, judgment?: string) =>
    ['pending', page, limit, judgment] as const,
  sites: (type: 'illegal' | 'legal', page: number, limit: number, search?: string) =>
    ['sites', type, page, limit, search] as const,
  titles: ['titles'] as const,
}

// ============================================
// Dashboard Hooks
// ============================================

export function useDashboardMonths() {
  return useQuery({
    queryKey: queryKeys.dashboardMonths,
    queryFn: api.getDashboardMonths,
    staleTime: 5 * 60 * 1000, // 5분
  })
}

export function useDashboard(month?: string) {
  return useQuery({
    queryKey: queryKeys.dashboard(month),
    queryFn: () => api.getDashboard(month),
    staleTime: 1 * 60 * 1000, // 1분
  })
}

// ============================================
// Sessions Hooks
// ============================================

export function useSessions(page = 1, limit = 20) {
  return useQuery({
    queryKey: queryKeys.sessions(page, limit),
    queryFn: () => api.getSessions(page, limit),
    staleTime: 30 * 1000, // 30초
  })
}

export function useSession(id: string) {
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSessionById(id),
    enabled: !!id,
  })
}

export function useSessionResults(
  id: string,
  options: {
    page?: number
    limit?: number
    status?: string
    title?: string
  } = {}
) {
  return useQuery({
    queryKey: queryKeys.sessionResults(id, options),
    queryFn: () => api.getSessionResults(id, options),
    enabled: !!id,
    staleTime: 30 * 1000,
  })
}

// ============================================
// Pending Reviews Hooks
// ============================================

export function usePendingReviews(page = 1, limit = 20, judgment?: string) {
  return useQuery({
    queryKey: queryKeys.pendingReviews(page, limit, judgment),
    queryFn: () => api.getPendingReviews(page, limit, judgment),
    staleTime: 10 * 1000, // 10초
  })
}

export function useReviewItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, action }: { id: string | number; action: 'approve' | 'reject' }) =>
      api.reviewItem(id, action),
    onSuccess: () => {
      // 승인/반려 후 관련 쿼리 무효화
      queryClient.invalidateQueries({ queryKey: ['pending'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}

// 일괄 처리 훅
export function useReviewBulk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ ids, action }: { ids: (string | number)[]; action: 'approve' | 'reject' }) =>
      api.reviewBulk(ids, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}

// ============================================
// Sites Hooks
// ============================================

export function useSites(
  type: 'illegal' | 'legal',
  page = 1,
  limit = 50,
  search?: string
) {
  return useQuery({
    queryKey: queryKeys.sites(type, page, limit, search),
    queryFn: () => api.getSites(type, page, limit, search),
    staleTime: 1 * 60 * 1000, // 1분
  })
}

export function useAddSite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ domain, type }: { domain: string; type: 'illegal' | 'legal' }) =>
      api.addSite(domain, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}

export function useRemoveSite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ domain, type }: { domain: string; type: 'illegal' | 'legal' }) =>
      api.removeSite(domain, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}

// ============================================
// Titles Hooks
// ============================================

export function useTitles() {
  return useQuery({
    queryKey: queryKeys.titles,
    queryFn: api.getTitles,
    staleTime: 5 * 60 * 1000, // 5분
  })
}

export function useAddTitle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (title: string) => api.addTitle(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.titles })
    },
  })
}

export function useRemoveTitle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (title: string) => api.removeTitle(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.titles })
    },
  })
}

export function useRestoreTitle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (title: string) => api.restoreTitle(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.titles })
    },
  })
}

// ============================================
// Excluded URLs Hooks (신고 제외 URL)
// ============================================

export const excludedUrlsKey = ['excluded-urls'] as const

export function useExcludedUrls() {
  return useQuery({
    queryKey: excludedUrlsKey,
    queryFn: api.getExcludedUrls,
    staleTime: 1 * 60 * 1000,
  })
}

export function useAddExcludedUrl() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (url: string) => api.addExcludedUrl(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: excludedUrlsKey })
    },
  })
}

export function useRemoveExcludedUrl() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => api.removeExcludedUrl(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: excludedUrlsKey })
    },
  })
}

// ============================================
// Manta Rankings Hooks
// ============================================

export const mantaRankingsKey = ['manta-rankings'] as const

export function useMantaRankings() {
  return useQuery({
    queryKey: mantaRankingsKey,
    queryFn: api.getMantaRankings,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTitleRankHistory(title: string) {
  return useQuery({
    queryKey: ['title-rank-history', title] as const,
    queryFn: () => api.getTitleRankHistory(title),
    enabled: !!title,
    staleTime: 5 * 60 * 1000,
  })
}

// ============================================
// Title Stats Hooks (작품별 통계)
// ============================================

export function useTitleStats(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['title-stats', startDate, endDate] as const,
    queryFn: () => api.getTitleStats(startDate, endDate),
    staleTime: 5 * 60 * 1000,
  })
}

// ============================================
// Titles with Manta URL Hooks
// ============================================

export function useTitlesWithManta() {
  return useQuery({
    queryKey: ['titles-with-manta'] as const,
    queryFn: api.getTitlesWithManta,
    staleTime: 5 * 60 * 1000,
  })
}

export function useAddTitleWithManta() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ title, mantaUrl }: { title: string; mantaUrl?: string }) =>
      api.addTitleWithManta(title, mantaUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.titles })
      queryClient.invalidateQueries({ queryKey: ['titles-with-manta'] })
    },
  })
}

// ============================================
// Report Tracking Hooks (신고결과 추적)
// ============================================

export const reportTrackingKeys = {
  sessions: ['report-tracking', 'sessions'] as const,
  reasons: ['report-tracking', 'reasons'] as const,
  data: (sessionId: string, options?: Record<string, unknown>) =>
    ['report-tracking', sessionId, options] as const,
  stats: (sessionId: string) => ['report-tracking', sessionId, 'stats'] as const,
  uploads: (sessionId: string) => ['report-tracking', sessionId, 'uploads'] as const,
  urls: (sessionId: string, status?: string) =>
    ['report-tracking', sessionId, 'urls', status] as const,
}

// 신고 추적 세션 목록
export function useReportTrackingSessions() {
  return useQuery({
    queryKey: reportTrackingKeys.sessions,
    queryFn: api.getReportTrackingSessions,
    staleTime: 1 * 60 * 1000,
  })
}

// 신고 사유 목록
export function useReportReasons() {
  return useQuery({
    queryKey: reportTrackingKeys.reasons,
    queryFn: api.getReportReasons,
    staleTime: 10 * 60 * 1000,
  })
}

// 세션별 신고 추적 데이터
export function useReportTrackingData(
  sessionId: string,
  options: {
    page?: number
    limit?: number
    status?: string
    title?: string
  } = {}
) {
  return useQuery({
    queryKey: reportTrackingKeys.data(sessionId, options),
    queryFn: () => api.getReportTrackingData(sessionId, options),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  })
}

// 세션별 통계
export function useReportTrackingStats(sessionId: string) {
  return useQuery({
    queryKey: reportTrackingKeys.stats(sessionId),
    queryFn: () => api.getReportTrackingStats(sessionId),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  })
}

// 업로드 목록
export function useReportTrackingUploads(sessionId: string) {
  return useQuery({
    queryKey: reportTrackingKeys.uploads(sessionId),
    queryFn: () => api.getReportTrackingUploads(sessionId),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  })
}

// 신고 상태 변경
export function useUpdateReportStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'pending' | 'reported' | 'blocked' | 'rejected' }) =>
      api.updateReportStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-tracking'] })
    },
  })
}

// 신고 사유 변경
export function useUpdateReportReason() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.updateReportReason(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-tracking'] })
    },
  })
}

// 신고 ID 변경
export function useUpdateReportId() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reportId }: { id: number; reportId: string }) =>
      api.updateReportId(id, reportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-tracking'] })
    },
  })
}

// URL 추가
export function useAddReportTrackingUrl() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ sessionId, url, title }: { sessionId: string; url: string; title?: string }) =>
      api.addReportTrackingUrl(sessionId, url, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-tracking'] })
    },
  })
}

// 파일 업로드
export function useUploadReportTrackingFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ sessionId, file }: { sessionId: string; file: File }) =>
      api.uploadReportTrackingFile(sessionId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-tracking'] })
    },
  })
}

// AI 일괄 검토
export function useAiReviewPending() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.aiReviewPending,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending'] })
    },
  })
}
