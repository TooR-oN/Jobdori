// ============================================
// Jobdori Type Definitions
// ============================================

// Pagination
export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  success: boolean
  count: number
  items: T[]
  pagination: Pagination
}

// Dashboard
export interface DashboardResponse {
  success: boolean
  month: string
  sessions_count: number
  top_contents: { title: string; count: number }[]
  top_illegal_sites: { domain: string; count: number }[]
  total_stats: {
    total: number
    illegal: number
    legal: number
    pending: number
  }
  source?: string
  count_type?: string
}

// Session
export interface Session {
  id: string
  created_at: string
  total_count: number
  illegal_count: number
  legal_count: number
  pending_count: number
  status: 'running' | 'completed' | 'failed'
  file_keywords?: string[]
  processed_files?: number
  // 확장 필드
  total_results?: number
  results_summary?: {
    total: number
    illegal: number
    legal: number
    pending: number
  }
}

// Detection Result
export interface DetectionResult {
  id: number
  session_id: string
  title: string
  domain: string
  url: string
  search_query: string
  page: number
  rank: number
  status: 'illegal' | 'legal' | 'pending'
  final_status?: 'illegal' | 'legal' | 'pending'
  llm_reason: string | null
  created_at: string
}

// Pending Review
export interface PendingReview {
  id: number
  domain: string
  title: string
  titles?: string[]
  urls: string[]
  judgment: 'likely_illegal' | 'likely_legal' | 'uncertain'
  llm_judgment?: 'likely_illegal' | 'likely_legal' | 'uncertain'
  llm_reason: string
  created_at: string
}

// Review Response
export interface ReviewResponse {
  success: boolean
  action: 'approve' | 'reject'
  message?: string
}

// Sites
export interface Site {
  domain: string
  added_at?: string
}

export interface SitesResponse {
  success: boolean
  type: 'illegal' | 'legal'
  count: number
  sites: string[]
  pagination?: Pagination
}

// Titles
export interface Title {
  name: string
  manta_url?: string | null
  active?: boolean
}

export interface TitlesResponse {
  success: boolean
  current: Title[]
  history: Title[]
}

// Excluded URLs
export interface ExcludedUrl {
  id: number
  url: string
  created_at: string
}

// Top Content (대시보드용)
export interface TopContent {
  title: string
  count: number
  illegal_count?: number
}

// Top Domain (대시보드용)
export interface TopDomain {
  domain: string
  count: number
}

// Top Illegal Site (대시보드용)
export interface TopIllegalSite {
  domain: string
  count: number
  illegal_count?: number
}

// Manta Rankings
export interface MantaRanking {
  title: string
  mantaRank: number | null
  firstRankDomain: string | null
  searchQuery: string | null
  page1IllegalCount: number
}

export interface RankHistoryItem {
  rank: number | null
  firstRankDomain: string | null
  sessionId: string
  recordedAt: string
}

// Title Stats
export interface TitleStatsItem {
  title: string
  detected: number
  reported: number
  blocked: number
  blockRate: string
}

// Report Tracking
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
