// ============================================
// Jobdori 공유 타입 정의
// Backend와 Frontend에서 공통으로 사용
// ============================================

// ============================================
// API 응답 기본 타입
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// ============================================
// 인증 관련 타입
// ============================================

export type UserRole = 'superadmin' | 'admin' | 'user'

export interface User {
  id: number
  username: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AuthStatus {
  authenticated: boolean
  user?: {
    username: string
    role: UserRole
  }
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  success: boolean
  error?: string
  user?: {
    username: string
    role: UserRole
  }
}

// ============================================
// 대시보드 관련 타입
// ============================================

export interface DashboardStats {
  discovered: number
  reported: number
  blocked: number
  blockRate: number
}

export interface TopContent {
  title: string
  count: number
}

export interface TopIllegalSite {
  domain: string
  count: number
}

export interface DashboardResponse extends DashboardStats {
  top_contents: TopContent[]
  top_illegal_sites: TopIllegalSite[]
}

// ============================================
// 세션 관련 타입
// ============================================

export interface ResultsSummary {
  total: number
  illegal: number
  legal: number
  pending: number
}

export interface Session {
  id: string
  status: 'running' | 'completed' | 'error'
  created_at: string
  completed_at: string | null
  titles_count: number
  keywords_count: number
  total_searches: number
  results_summary: ResultsSummary
}

export interface SessionDetail extends Session {
  files?: {
    search_results?: string
    classified_results?: string
    llm_judged_results?: string
    final_results?: string
    excel_report?: string
  }
}

// ============================================
// 탐지 결과 타입
// ============================================

export type FinalStatus = 'illegal' | 'legal' | 'pending'
export type LLMJudgment = 'likely_illegal' | 'likely_legal' | 'uncertain' | null

export interface DetectionResult {
  id?: number
  session_id: string
  title: string
  domain: string
  url: string
  search_query: string
  page: number
  rank: number
  initial_status: string
  llm_judgment: LLMJudgment
  llm_reason: string | null
  final_status: FinalStatus
  reviewed_at: string | null
}

// ============================================
// 작품 관련 타입
// ============================================

export interface Title {
  id?: number
  name: string
  manta_url: string | null
  unofficial_titles: string[]
  is_current: boolean
  created_at?: string
}

export interface TitleWithStats extends Title {
  illegal_count?: number
  total_count?: number
}

// ============================================
// 승인 대기 관련 타입
// ============================================

export interface PendingReview {
  id: string
  domain: string
  urls: string[]
  titles: string[]
  judgment: LLMJudgment
  reason: string
  created_at: string
  session_id?: string
}

export type ReviewAction = 'approve' | 'reject' | 'hold'

export interface ReviewRequest {
  domain: string
  action: ReviewAction
  session_id?: string
}

// ============================================
// 사이트 관련 타입
// ============================================

export type SiteType = 'illegal' | 'legal'

export interface Site {
  id?: number
  domain: string
  type: SiteType
  created_at?: string
}

// ============================================
// 계정 관리 관련 타입 (관리자 전용)
// ============================================

export interface CreateUserRequest {
  username: string
  password: string
  role: UserRole
}

export interface UpdateUserRequest {
  password?: string
  role?: UserRole
  is_active?: boolean
}

// ============================================
// 페이지네이션
// ============================================

export interface PaginationParams {
  page?: number
  limit?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// ============================================
// 역할별 접근 권한
// ============================================

export const ROLE_PERMISSIONS = {
  superadmin: {
    dashboard: true,
    sessions: true,
    titles: true,
    pending: true,
    sites: true,
    users: true,
  },
  admin: {
    dashboard: true,
    sessions: true,
    titles: true,
    pending: true,
    sites: true,
    users: false,
  },
  user: {
    dashboard: true,
    sessions: true,
    titles: true,
    pending: false,
    sites: false,
    users: false,
  },
} as const

export type Permission = keyof typeof ROLE_PERMISSIONS.superadmin
