// ============================================
// Neon PostgreSQL Database Utilities
// ============================================

import { neon } from '@neondatabase/serverless'

// DB 연결 (환경변수에서 CONNECTION STRING 가져옴)
const sql = neon(process.env.DATABASE_URL || '')

// ============================================
// 타입 정의
// ============================================

export interface Session {
  id: string
  created_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'error'
  titles_count: number
  keywords_count: number
  total_searches: number
  results_total: number
  results_illegal: number
  results_legal: number
  results_pending: number
  file_final_results: string | null
}

export interface MonthlyStats {
  id: number
  month: string
  sessions_count: number
  total: number
  illegal: number
  legal: number
  pending: number
  top_contents: any[]
  top_illegal_sites: any[]
  last_updated: string
}

export interface Site {
  id: number
  domain: string
  type: 'illegal' | 'legal'
  created_at: string
}

export interface Title {
  id: number
  name: string
  is_current: boolean
  created_at: string
}

export interface PendingReview {
  id: number
  domain: string
  urls: string[]
  titles: string[]
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain'
  llm_reason: string
  session_id: string | null
  created_at: string
}

// 신고결과 추적 관련 타입
export interface ReportTracking {
  id: number
  session_id: string
  url: string
  domain: string
  report_status: '차단' | '대기 중' | '색인없음' | '거부' | '미신고'
  report_id: string | null
  reason: string | null
  created_at: string
  updated_at: string
}

export interface ReportUpload {
  id: number
  session_id: string
  report_id: string
  file_name: string | null
  matched_count: number
  total_urls_in_html: number
  uploaded_at: string
}

export interface ReportReason {
  id: number
  reason_text: string
  usage_count: number
  created_at: string
}

// ============================================
// Sessions
// ============================================

export async function getSessions(): Promise<Session[]> {
  const rows = await sql`
    SELECT * FROM sessions 
    ORDER BY created_at DESC
  `
  return rows as Session[]
}

// Phase 3: Pagination 지원 세션 목록 조회 (DTO 적용 - file_final_results 제외)
export interface SessionListItem {
  id: string
  created_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'error'
  titles_count: number
  keywords_count: number
  total_searches: number
  results_total: number
  results_illegal: number
  results_legal: number
  results_pending: number
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export async function getSessionsPaginated(
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResult<SessionListItem>> {
  const offset = (page - 1) * limit
  
  // 총 개수 조회
  const countResult = await sql`SELECT COUNT(*) as total FROM sessions`
  const total = parseInt(countResult[0].total)
  
  // DTO: file_final_results 제외하여 경량화
  const rows = await sql`
    SELECT 
      id, created_at, completed_at, status,
      titles_count, keywords_count, total_searches,
      results_total, results_illegal, results_legal, results_pending
    FROM sessions 
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  
  return {
    items: rows as SessionListItem[],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }
}

export async function getSessionById(id: string): Promise<Session | null> {
  const rows = await sql`
    SELECT * FROM sessions WHERE id = ${id}
  `
  return rows[0] as Session || null
}

export async function createSession(session: Partial<Session>): Promise<Session> {
  const rows = await sql`
    INSERT INTO sessions (id, status, titles_count, keywords_count, total_searches, file_final_results)
    VALUES (${session.id}, ${session.status || 'running'}, ${session.titles_count || 0}, 
            ${session.keywords_count || 0}, ${session.total_searches || 0}, ${session.file_final_results || null})
    RETURNING *
  `
  return rows[0] as Session
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<Session | null> {
  const rows = await sql`
    UPDATE sessions SET
      completed_at = COALESCE(${updates.completed_at || null}, completed_at),
      status = COALESCE(${updates.status || null}, status),
      results_total = COALESCE(${updates.results_total || null}, results_total),
      results_illegal = COALESCE(${updates.results_illegal || null}, results_illegal),
      results_legal = COALESCE(${updates.results_legal || null}, results_legal),
      results_pending = COALESCE(${updates.results_pending || null}, results_pending),
      file_final_results = COALESCE(${updates.file_final_results || null}, file_final_results)
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] as Session || null
}

// ============================================
// Monthly Stats
// ============================================

export async function getMonthlyStats(): Promise<MonthlyStats[]> {
  const rows = await sql`
    SELECT * FROM monthly_stats 
    ORDER BY month DESC
  `
  return rows as MonthlyStats[]
}

export async function getMonthlyStatsByMonth(month: string): Promise<MonthlyStats | null> {
  const rows = await sql`
    SELECT * FROM monthly_stats WHERE month = ${month}
  `
  return rows[0] as MonthlyStats || null
}

export async function upsertMonthlyStats(stats: Partial<MonthlyStats>): Promise<MonthlyStats> {
  const rows = await sql`
    INSERT INTO monthly_stats (month, sessions_count, total, illegal, legal, pending, top_contents, top_illegal_sites)
    VALUES (${stats.month}, ${stats.sessions_count || 0}, ${stats.total || 0}, ${stats.illegal || 0}, 
            ${stats.legal || 0}, ${stats.pending || 0}, ${JSON.stringify(stats.top_contents || [])}, 
            ${JSON.stringify(stats.top_illegal_sites || [])})
    ON CONFLICT (month) DO UPDATE SET
      sessions_count = ${stats.sessions_count || 0},
      total = ${stats.total || 0},
      illegal = ${stats.illegal || 0},
      legal = ${stats.legal || 0},
      pending = ${stats.pending || 0},
      top_contents = ${JSON.stringify(stats.top_contents || [])},
      top_illegal_sites = ${JSON.stringify(stats.top_illegal_sites || [])},
      last_updated = NOW()
    RETURNING *
  `
  return rows[0] as MonthlyStats
}

// ============================================
// Sites (Illegal/Legal)
// ============================================

export async function getSitesByType(type: 'illegal' | 'legal'): Promise<Site[]> {
  const rows = await sql`
    SELECT * FROM sites WHERE type = ${type} ORDER BY domain
  `
  return rows as Site[]
}

// Phase 3: Pagination 지원 사이트 목록 조회
export async function getSitesByTypePaginated(
  type: 'illegal' | 'legal',
  page: number = 1,
  limit: number = 50,
  search?: string
): Promise<PaginatedResult<Site>> {
  const offset = (page - 1) * limit
  
  // 검색어가 있는 경우
  if (search && search.trim()) {
    const searchPattern = `%${search.toLowerCase()}%`
    
    const countResult = await sql`
      SELECT COUNT(*) as total FROM sites 
      WHERE type = ${type} AND LOWER(domain) LIKE ${searchPattern}
    `
    const total = parseInt(countResult[0].total)
    
    const rows = await sql`
      SELECT * FROM sites 
      WHERE type = ${type} AND LOWER(domain) LIKE ${searchPattern}
      ORDER BY domain
      LIMIT ${limit} OFFSET ${offset}
    `
    
    return {
      items: rows as Site[],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    }
  }
  
  // 검색어가 없는 경우
  const countResult = await sql`SELECT COUNT(*) as total FROM sites WHERE type = ${type}`
  const total = parseInt(countResult[0].total)
  
  const rows = await sql`
    SELECT * FROM sites 
    WHERE type = ${type}
    ORDER BY domain
    LIMIT ${limit} OFFSET ${offset}
  `
  
  return {
    items: rows as Site[],
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  }
}

export async function addSite(domain: string, type: 'illegal' | 'legal'): Promise<Site> {
  const rows = await sql`
    INSERT INTO sites (domain, type)
    VALUES (${domain.toLowerCase()}, ${type})
    ON CONFLICT (domain, type) DO NOTHING
    RETURNING *
  `
  return rows[0] as Site
}

export async function removeSite(domain: string, type: 'illegal' | 'legal'): Promise<boolean> {
  const result = await sql`
    DELETE FROM sites WHERE domain = ${domain.toLowerCase()} AND type = ${type}
  `
  return true
}

export async function getAllSiteDomains(type: 'illegal' | 'legal'): Promise<Set<string>> {
  const rows = await sql`
    SELECT domain FROM sites WHERE type = ${type}
  `
  return new Set(rows.map((r: any) => r.domain.toLowerCase()))
}

// ============================================
// Titles
// ============================================

export async function getCurrentTitles(): Promise<Title[]> {
  const rows = await sql`
    SELECT * FROM titles WHERE is_current = true ORDER BY created_at DESC
  `
  return rows as Title[]
}

export async function getHistoryTitles(): Promise<Title[]> {
  const rows = await sql`
    SELECT * FROM titles WHERE is_current = false ORDER BY created_at DESC
  `
  return rows as Title[]
}

export async function addTitle(name: string): Promise<Title> {
  const rows = await sql`
    INSERT INTO titles (name, is_current)
    VALUES (${name}, true)
    ON CONFLICT (name) DO UPDATE SET is_current = true
    RETURNING *
  `
  return rows[0] as Title
}

export async function removeTitle(name: string): Promise<boolean> {
  await sql`
    UPDATE titles SET is_current = false WHERE name = ${name}
  `
  return true
}

export async function restoreTitle(name: string): Promise<Title | null> {
  const rows = await sql`
    UPDATE titles SET is_current = true WHERE name = ${name}
    RETURNING *
  `
  return rows[0] as Title || null
}

// ============================================
// Pending Reviews
// ============================================

export async function getPendingReviews(): Promise<PendingReview[]> {
  const rows = await sql`
    SELECT * FROM pending_reviews ORDER BY created_at DESC
  `
  return rows as PendingReview[]
}

// Phase 3: Pagination 지원 승인 대기 목록 조회
export async function getPendingReviewsPaginated(
  page: number = 1,
  limit: number = 20,
  judgment?: 'likely_illegal' | 'likely_legal' | 'uncertain'
): Promise<PaginatedResult<PendingReview>> {
  const offset = (page - 1) * limit
  
  // judgment 필터가 있는 경우
  if (judgment) {
    const countResult = await sql`
      SELECT COUNT(*) as total FROM pending_reviews 
      WHERE llm_judgment = ${judgment}
    `
    const total = parseInt(countResult[0].total)
    
    const rows = await sql`
      SELECT * FROM pending_reviews 
      WHERE llm_judgment = ${judgment}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    
    return {
      items: rows as PendingReview[],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    }
  }
  
  // 필터 없는 경우
  const countResult = await sql`SELECT COUNT(*) as total FROM pending_reviews`
  const total = parseInt(countResult[0].total)
  
  const rows = await sql`
    SELECT * FROM pending_reviews 
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  
  return {
    items: rows as PendingReview[],
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  }
}

export async function getPendingReviewById(id: number): Promise<PendingReview | null> {
  const rows = await sql`
    SELECT * FROM pending_reviews WHERE id = ${id}
  `
  return rows[0] as PendingReview || null
}

export async function createPendingReview(review: Partial<PendingReview>): Promise<PendingReview> {
  const rows = await sql`
    INSERT INTO pending_reviews (domain, urls, titles, llm_judgment, llm_reason, session_id)
    VALUES (${review.domain}, ${JSON.stringify(review.urls || [])}, ${JSON.stringify(review.titles || [])},
            ${review.llm_judgment}, ${review.llm_reason || ''}, ${review.session_id || null})
    RETURNING *
  `
  return rows[0] as PendingReview
}

export async function deletePendingReview(id: number): Promise<boolean> {
  await sql`
    DELETE FROM pending_reviews WHERE id = ${id}
  `
  return true
}

export async function deletePendingReviewByDomain(domain: string): Promise<boolean> {
  await sql`
    DELETE FROM pending_reviews WHERE domain = ${domain.toLowerCase()}
  `
  return true
}

// ============================================
// Report Tracking (신고결과 추적)
// ============================================

// 회차별 신고 추적 목록 조회
export async function getReportTrackingBySession(
  sessionId: string,
  filter?: string,
  page: number = 1,
  limit: number = 50
): Promise<{ items: ReportTracking[], total: number }> {
  const offset = (page - 1) * limit
  
  let rows: ReportTracking[]
  let countResult: any[]
  
  if (filter && filter !== '전체') {
    rows = await sql`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as ReportTracking[]
    
    countResult = await sql`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
    `
  } else {
    rows = await sql`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    ` as ReportTracking[]
    
    countResult = await sql`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId}
    `
  }
  
  return {
    items: rows,
    total: parseInt(countResult[0]?.count || '0')
  }
}

// 회차별 신고 통계 조회
export async function getReportTrackingStats(sessionId: string): Promise<{
  total: number
  차단: number
  '대기 중': number
  색인없음: number
  거부: number
  미신고: number
}> {
  const rows = await sql`
    SELECT report_status, COUNT(*) as count 
    FROM report_tracking 
    WHERE session_id = ${sessionId}
    GROUP BY report_status
  `
  
  const stats = {
    total: 0,
    '차단': 0,
    '대기 중': 0,
    '색인없음': 0,
    '거부': 0,
    '미신고': 0
  }
  
  for (const row of rows) {
    const status = row.report_status as keyof typeof stats
    const count = parseInt(row.count)
    if (status in stats) {
      stats[status] = count
    }
    stats.total += count
  }
  
  return stats
}

// 신고 추적 항목 생성 (모니터링 완료 시 불법 URL 자동 등록)
export async function createReportTracking(item: Partial<ReportTracking>): Promise<ReportTracking> {
  const rows = await sql`
    INSERT INTO report_tracking (session_id, url, domain, report_status, report_id, reason)
    VALUES (${item.session_id}, ${item.url}, ${item.domain}, ${item.report_status || '미신고'}, 
            ${item.report_id || null}, ${item.reason || null})
    ON CONFLICT (session_id, url) DO UPDATE SET
      report_status = COALESCE(EXCLUDED.report_status, report_tracking.report_status),
      updated_at = NOW()
    RETURNING *
  `
  return rows[0] as ReportTracking
}

// 신고 추적 상태 업데이트
export async function updateReportTrackingStatus(
  id: number,
  status: string,
  reportId?: string
): Promise<ReportTracking | null> {
  const rows = await sql`
    UPDATE report_tracking SET
      report_status = ${status},
      report_id = COALESCE(${reportId || null}, report_id),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] as ReportTracking || null
}

// 신고 추적 사유 업데이트
export async function updateReportTrackingReason(
  id: number,
  reason: string
): Promise<ReportTracking | null> {
  const rows = await sql`
    UPDATE report_tracking SET
      reason = ${reason},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] as ReportTracking || null
}

// URL 매칭으로 상태 일괄 업데이트 (HTML 업로드 시)
export async function bulkUpdateReportTrackingByUrls(
  sessionId: string,
  urls: string[],
  status: string,
  reportId: string
): Promise<number> {
  if (urls.length === 0) return 0
  
  const result = await sql`
    UPDATE report_tracking SET
      report_status = ${status},
      report_id = ${reportId},
      updated_at = NOW()
    WHERE session_id = ${sessionId} AND url = ANY(${urls})
    RETURNING id
  `
  return result.length
}

// 회차별 URL 목록 조회 (복사용)
export async function getReportTrackingUrls(
  sessionId: string,
  filter?: string
): Promise<string[]> {
  let rows: any[]
  
  if (filter && filter !== '전체') {
    rows = await sql`
      SELECT url FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
      ORDER BY updated_at DESC
    `
  } else {
    rows = await sql`
      SELECT url FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
    `
  }
  
  return rows.map(r => r.url)
}

// ============================================
// Report Uploads (HTML 업로드 이력)
// ============================================

// 업로드 이력 조회
export async function getReportUploadsBySession(sessionId: string): Promise<ReportUpload[]> {
  const rows = await sql`
    SELECT * FROM report_uploads 
    WHERE session_id = ${sessionId}
    ORDER BY uploaded_at DESC
  `
  return rows as ReportUpload[]
}

// 업로드 이력 생성
export async function createReportUpload(upload: Partial<ReportUpload>): Promise<ReportUpload> {
  const rows = await sql`
    INSERT INTO report_uploads (session_id, report_id, file_name, matched_count, total_urls_in_html)
    VALUES (${upload.session_id}, ${upload.report_id}, ${upload.file_name || null}, 
            ${upload.matched_count || 0}, ${upload.total_urls_in_html || 0})
    RETURNING *
  `
  return rows[0] as ReportUpload
}

// ============================================
// Report Reasons (사유 드롭다운 옵션)
// ============================================

// 사유 목록 조회 (사용 빈도순)
export async function getReportReasons(): Promise<ReportReason[]> {
  const rows = await sql`
    SELECT * FROM report_reasons 
    ORDER BY usage_count DESC, created_at ASC
  `
  return rows as ReportReason[]
}

// 사유 추가 또는 사용 횟수 증가
export async function addOrUpdateReportReason(reasonText: string): Promise<ReportReason> {
  const rows = await sql`
    INSERT INTO report_reasons (reason_text, usage_count)
    VALUES (${reasonText}, 1)
    ON CONFLICT (reason_text) DO UPDATE SET
      usage_count = report_reasons.usage_count + 1
    RETURNING *
  `
  return rows[0] as ReportReason
}

// ============================================
// Database Initialization
// ============================================

export async function initializeDatabase(): Promise<void> {
  // sessions 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(50) PRIMARY KEY,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(20) DEFAULT 'running',
      titles_count INTEGER DEFAULT 0,
      keywords_count INTEGER DEFAULT 0,
      total_searches INTEGER DEFAULT 0,
      results_total INTEGER DEFAULT 0,
      results_illegal INTEGER DEFAULT 0,
      results_legal INTEGER DEFAULT 0,
      results_pending INTEGER DEFAULT 0,
      file_final_results VARCHAR(500)
    )
  `

  // monthly_stats 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS monthly_stats (
      id SERIAL PRIMARY KEY,
      month VARCHAR(7) NOT NULL UNIQUE,
      sessions_count INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      illegal INTEGER DEFAULT 0,
      legal INTEGER DEFAULT 0,
      pending INTEGER DEFAULT 0,
      top_contents JSONB DEFAULT '[]',
      top_illegal_sites JSONB DEFAULT '[]',
      last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `

  // sites 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      domain VARCHAR(255) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('illegal', 'legal')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(domain, type)
    )
  `

  // titles 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS titles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(500) NOT NULL UNIQUE,
      is_current BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `

  // pending_reviews 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS pending_reviews (
      id SERIAL PRIMARY KEY,
      domain VARCHAR(255) NOT NULL,
      urls JSONB DEFAULT '[]',
      titles JSONB DEFAULT '[]',
      llm_judgment VARCHAR(20),
      llm_reason TEXT,
      session_id VARCHAR(50),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `

  // manta_rankings 테이블 (현재 순위)
  await sql`
    CREATE TABLE IF NOT EXISTS manta_rankings (
      title VARCHAR(500) PRIMARY KEY,
      manta_rank INTEGER,
      first_rank_domain VARCHAR(255),
      search_query VARCHAR(500),
      session_id VARCHAR(50),
      page1_illegal_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  
  // page1_illegal_count 컬럼이 없으면 추가
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'manta_rankings' AND column_name = 'page1_illegal_count'
      ) THEN
        ALTER TABLE manta_rankings ADD COLUMN page1_illegal_count INTEGER DEFAULT 0;
      END IF;
    END $$
  `

  // manta_ranking_history 테이블 (순위 히스토리)
  await sql`
    CREATE TABLE IF NOT EXISTS manta_ranking_history (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      manta_rank INTEGER,
      first_rank_domain VARCHAR(255),
      session_id VARCHAR(50),
      page1_illegal_count INTEGER DEFAULT 0,
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  
  // page1_illegal_count 컬럼이 없으면 추가
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'manta_ranking_history' AND column_name = 'page1_illegal_count'
      ) THEN
        ALTER TABLE manta_ranking_history ADD COLUMN page1_illegal_count INTEGER DEFAULT 0;
      END IF;
    END $$
  `

  // 인덱스 추가 (작품별 히스토리 조회 최적화)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_manta_ranking_history_title 
    ON manta_ranking_history(title, recorded_at DESC)
  `

  // ============================================
  // 신고결과 추적 테이블
  // ============================================

  // report_tracking 테이블 (URL별 신고 상태)
  await sql`
    CREATE TABLE IF NOT EXISTS report_tracking (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(50) NOT NULL,
      url TEXT NOT NULL,
      domain VARCHAR(255) NOT NULL,
      report_status VARCHAR(20) DEFAULT '미신고',
      report_id VARCHAR(50),
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(session_id, url)
    )
  `

  // report_tracking 인덱스
  await sql`
    CREATE INDEX IF NOT EXISTS idx_report_tracking_session 
    ON report_tracking(session_id, report_status)
  `

  // report_uploads 테이블 (HTML 업로드 이력)
  await sql`
    CREATE TABLE IF NOT EXISTS report_uploads (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(50) NOT NULL,
      report_id VARCHAR(50) NOT NULL,
      file_name VARCHAR(255),
      matched_count INTEGER DEFAULT 0,
      total_urls_in_html INTEGER DEFAULT 0,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `

  // report_reasons 테이블 (사유 드롭다운 옵션)
  await sql`
    CREATE TABLE IF NOT EXISTS report_reasons (
      id SERIAL PRIMARY KEY,
      reason_text VARCHAR(255) UNIQUE NOT NULL,
      usage_count INTEGER DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `

  // 기본 사유 옵션 추가
  await sql`
    INSERT INTO report_reasons (reason_text, usage_count) VALUES
      ('저작권 미확인', 100),
      ('검토 필요', 99),
      ('중복 신고', 98),
      ('URL 오류', 97)
    ON CONFLICT (reason_text) DO NOTHING
  `

  // ============================================
  // Schema v2: detection_results 테이블 및 View
  // (데이터베이스 정규화 - 2026-01-30)
  // ============================================

  // detection_results 테이블 (모든 탐지 결과를 개별 Row로 저장)
  await sql`
    CREATE TABLE IF NOT EXISTS detection_results (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(50) NOT NULL,
      title VARCHAR(500) NOT NULL,
      search_query VARCHAR(500) NOT NULL,
      url TEXT NOT NULL,
      domain VARCHAR(255) NOT NULL,
      page INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      initial_status VARCHAR(20) NOT NULL,
      llm_judgment VARCHAR(20),
      llm_reason TEXT,
      final_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_at TIMESTAMP WITH TIME ZONE,
      reviewed_by VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT fk_detection_results_session 
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      CONSTRAINT uq_detection_results_session_url 
        UNIQUE(session_id, url)
    )
  `

  // detection_results 인덱스
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_session ON detection_results(session_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_status ON detection_results(final_status)`
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_domain ON detection_results(domain)`
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_title ON detection_results(title)`
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_created ON detection_results(created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_domain_status ON detection_results(LOWER(domain), final_status)`
  
  // sessions 테이블 DATE_TRUNC 인덱스 (월별 통계 View 최적화)
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_created_month ON sessions(DATE_TRUNC('month', created_at))`

  // 실시간 집계 View: 월별 통계
  await sql`
    CREATE OR REPLACE VIEW v_monthly_stats AS
    SELECT 
      DATE_TRUNC('month', s.created_at) as month,
      COUNT(DISTINCT s.id) as sessions_count,
      COUNT(dr.*) as total,
      COUNT(*) FILTER (WHERE dr.final_status = 'illegal') as illegal,
      COUNT(*) FILTER (WHERE dr.final_status = 'legal') as legal,
      COUNT(*) FILTER (WHERE dr.final_status = 'pending') as pending
    FROM sessions s
    LEFT JOIN detection_results dr ON s.id = dr.session_id
    WHERE s.status = 'completed'
    GROUP BY DATE_TRUNC('month', s.created_at)
  `

  // 실시간 집계 View: 월별 작품별 통계
  await sql`
    CREATE OR REPLACE VIEW v_monthly_top_contents AS
    SELECT 
      DATE_TRUNC('month', s.created_at) as month,
      dr.title,
      COUNT(*) FILTER (WHERE dr.final_status = 'illegal') as illegal_count,
      COUNT(*) FILTER (WHERE dr.final_status = 'legal') as legal_count,
      COUNT(*) FILTER (WHERE dr.final_status = 'pending') as pending_count,
      COUNT(*) as total_count
    FROM detection_results dr
    JOIN sessions s ON dr.session_id = s.id
    WHERE s.status = 'completed'
    GROUP BY DATE_TRUNC('month', s.created_at), dr.title
  `

  // 실시간 집계 View: 월별 불법 도메인 통계
  await sql`
    CREATE OR REPLACE VIEW v_monthly_top_illegal_sites AS
    SELECT 
      DATE_TRUNC('month', s.created_at) as month,
      dr.domain,
      COUNT(*) as illegal_count
    FROM detection_results dr
    JOIN sessions s ON dr.session_id = s.id
    WHERE s.status = 'completed'
      AND dr.final_status = 'illegal'
    GROUP BY DATE_TRUNC('month', s.created_at), dr.domain
  `

  // 실시간 집계 View: 세션별 통계
  await sql`
    CREATE OR REPLACE VIEW v_session_stats AS
    SELECT 
      s.id,
      s.created_at,
      s.completed_at,
      s.status,
      s.titles_count,
      s.keywords_count,
      s.total_searches,
      s.file_final_results,
      COUNT(dr.*) as results_total,
      COUNT(*) FILTER (WHERE dr.final_status = 'illegal') as results_illegal,
      COUNT(*) FILTER (WHERE dr.final_status = 'legal') as results_legal,
      COUNT(*) FILTER (WHERE dr.final_status = 'pending') as results_pending
    FROM sessions s
    LEFT JOIN detection_results dr ON s.id = dr.session_id
    GROUP BY s.id
  `

  // 실시간 집계 View: 승인 대기 도메인
  await sql`
    CREATE OR REPLACE VIEW v_pending_domains AS
    SELECT 
      LOWER(dr.domain) as domain,
      COUNT(*) as pending_count,
      COUNT(DISTINCT dr.title) as title_count,
      COUNT(DISTINCT dr.session_id) as session_count,
      ARRAY_AGG(DISTINCT dr.title) as titles,
      MIN(dr.created_at) as first_detected_at,
      MAX(dr.created_at) as last_detected_at,
      MAX(dr.llm_judgment) as llm_judgment,
      MAX(dr.llm_reason) as llm_reason
    FROM detection_results dr
    WHERE dr.final_status = 'pending'
    GROUP BY LOWER(dr.domain)
  `

  // updated_at 자동 갱신 트리거 함수
  await sql`
    CREATE OR REPLACE FUNCTION fn_update_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `

  // detection_results 테이블에 트리거 적용
  await sql`DROP TRIGGER IF EXISTS trg_detection_results_updated_at ON detection_results`
  await sql`
    CREATE TRIGGER trg_detection_results_updated_at
      BEFORE UPDATE ON detection_results
      FOR EACH ROW
      EXECUTE FUNCTION fn_update_timestamp()
  `

  console.log('✅ Database tables initialized (including Schema v2)')
}
