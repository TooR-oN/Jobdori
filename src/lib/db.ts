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

  console.log('✅ Database tables initialized')
}
