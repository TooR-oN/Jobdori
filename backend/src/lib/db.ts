// ============================================
// Neon PostgreSQL Database Utilities
// ============================================

import { neon, NeonQueryFunction } from '@neondatabase/serverless'

// DB 연결 - Lazy Initialization (첫 쿼리 시점에 초기화)
let _sql: NeonQueryFunction<false, false> | null = null

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    _sql = neon(dbUrl)
    console.log('✅ Database connection initialized')
  }
  return _sql
}

// sql 템플릿 태그 함수
const sql = (strings: TemplateStringsArray, ...values: any[]) => {
  return getSql()(strings, ...values)
}

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
  // 사이트 집중 모니터링
  deep_monitoring_executed: boolean
  deep_monitoring_targets_count: number
  deep_monitoring_new_urls: number
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

// 탐지 결과 타입 (detection_results 테이블)
export interface DetectionResult {
  id: number
  session_id: string
  title: string
  search_query: string
  url: string
  domain: string
  page: number
  rank: number
  initial_status: 'illegal' | 'legal' | 'unknown'
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null
  llm_reason: string | null
  final_status: 'illegal' | 'legal' | 'pending'
  reviewed_at: string | null
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
// 대시보드 캐싱 (5분 TTL)
// ============================================

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const dashboardCache = new Map<string, CacheEntry<MonthlyStats>>()
const CACHE_TTL = 5 * 60 * 1000 // 5분

export function getCachedDashboard(month: string): MonthlyStats | null {
  const entry = dashboardCache.get(month)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    dashboardCache.delete(month)
    return null
  }
  return entry.data
}

export function setCachedDashboard(month: string, data: MonthlyStats): void {
  dashboardCache.set(month, {
    data,
    expiresAt: Date.now() + CACHE_TTL
  })
}

export function invalidateDashboardCache(month?: string): void {
  if (month) {
    dashboardCache.delete(month)
  } else {
    dashboardCache.clear()
  }
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
// Monthly Stats (detection_results 기반 - 실시간 집계)
// ============================================

export async function getMonthlyStats(): Promise<MonthlyStats[]> {
  // 완료된 세션의 월 목록 조회
  const monthsResult = await sql`
    SELECT DISTINCT SUBSTRING(id, 1, 7) as month 
    FROM sessions 
    WHERE status = 'completed' 
    ORDER BY month DESC
  `
  
  const stats: MonthlyStats[] = []
  for (const row of monthsResult) {
    const monthStats = await getMonthlyStatsByMonth(row.month)
    if (monthStats) {
      stats.push(monthStats)
    }
  }
  return stats
}

export async function getMonthlyStatsByMonth(month: string): Promise<MonthlyStats | null> {
  // 단일 CTE 쿼리로 모든 데이터 조회 (5개 쿼리 → 1개 쿼리)
  const monthPattern = month + '%'
  
  const result = await sql`
    WITH session_data AS (
      SELECT 
        COUNT(*) as sessions_count,
        MAX(completed_at) as last_updated
      FROM sessions 
      WHERE id LIKE ${monthPattern} AND status = 'completed'
    ),
    stats_data AS (
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE final_status = 'illegal') as illegal,
        COUNT(*) FILTER (WHERE final_status = 'legal') as legal,
        COUNT(*) FILTER (WHERE final_status = 'pending') as pending
      FROM detection_results
      WHERE session_id LIKE ${monthPattern}
    ),
    top_contents AS (
      SELECT title as name, COUNT(*) as count
      FROM detection_results
      WHERE session_id LIKE ${monthPattern} AND final_status = 'illegal'
      GROUP BY title
      ORDER BY count DESC
      LIMIT 10
    ),
    top_domains AS (
      SELECT domain, COUNT(*) as count
      FROM detection_results
      WHERE session_id LIKE ${monthPattern} AND final_status = 'illegal'
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    )
    SELECT 
      (SELECT sessions_count FROM session_data) as sessions_count,
      (SELECT last_updated FROM session_data) as last_updated,
      (SELECT total FROM stats_data) as total,
      (SELECT illegal FROM stats_data) as illegal,
      (SELECT legal FROM stats_data) as legal,
      (SELECT pending FROM stats_data) as pending,
      (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM top_contents) as top_contents,
      (SELECT COALESCE(json_agg(json_build_object('domain', domain, 'count', count)), '[]'::json) FROM top_domains) as top_domains
  `
  
  const data = result[0]
  const sessionsCount = parseInt(data?.sessions_count) || 0
  
  if (sessionsCount === 0) {
    return null
  }
  
  return {
    id: 0,
    month,
    sessions_count: sessionsCount,
    total: parseInt(data?.total) || 0,
    illegal: parseInt(data?.illegal) || 0,
    legal: parseInt(data?.legal) || 0,
    pending: parseInt(data?.pending) || 0,
    top_contents: data?.top_contents || [],
    top_illegal_sites: data?.top_domains || [],
    last_updated: data?.last_updated || new Date().toISOString()
  }
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
  limit: number = 50,
  search?: string
): Promise<{ items: ReportTracking[], total: number }> {
  const offset = (page - 1) * limit
  const hasSearch = search && search.trim().length > 0
  const searchPattern = hasSearch ? `%${search.trim().toLowerCase()}%` : ''
  
  let rows: ReportTracking[]
  let countResult: any[]
  
  // 검색어가 있으면 전체 데이터에서 검색 (limit 없음)
  if (hasSearch) {
    if (filter && filter !== '전체') {
      rows = await sql`
        SELECT * FROM report_tracking 
        WHERE session_id = ${sessionId} 
          AND report_status = ${filter}
          AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
        ORDER BY updated_at DESC
      ` as ReportTracking[]
      
      countResult = [{ count: rows.length }]
    } else {
      rows = await sql`
        SELECT * FROM report_tracking 
        WHERE session_id = ${sessionId}
          AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
        ORDER BY updated_at DESC
      ` as ReportTracking[]
      
      countResult = [{ count: rows.length }]
    }
  } else {
    // 검색어 없으면 페이지네이션 적용
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
// Deep Monitoring Targets (사이트 집중 모니터링)
// ============================================

export interface DeepMonitoringTarget {
  id: number
  session_id: string
  title: string
  domain: string
  url_count: number
  base_keyword: string
  deep_query: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  results_count: number
  new_urls_count: number
  created_at: string
  executed_at: string | null
  completed_at: string | null
}

// 세션별 심층 모니터링 대상 조회
export async function getDeepMonitoringTargets(sessionId: string): Promise<DeepMonitoringTarget[]> {
  const rows = await sql`
    SELECT * FROM deep_monitoring_targets
    WHERE session_id = ${sessionId}
    ORDER BY url_count DESC
  `
  return rows as DeepMonitoringTarget[]
}

// 대상 생성 (중복 시 업데이트)
export async function createDeepMonitoringTarget(target: Partial<DeepMonitoringTarget>): Promise<DeepMonitoringTarget> {
  const rows = await sql`
    INSERT INTO deep_monitoring_targets
      (session_id, title, domain, url_count, base_keyword, deep_query, status)
    VALUES (${target.session_id}, ${target.title}, ${target.domain},
            ${target.url_count}, ${target.base_keyword}, ${target.deep_query},
            ${target.status || 'pending'})
    ON CONFLICT (session_id, title, domain) DO UPDATE SET
      url_count = EXCLUDED.url_count,
      base_keyword = EXCLUDED.base_keyword,
      deep_query = EXCLUDED.deep_query,
      status = 'pending',
      results_count = 0,
      new_urls_count = 0,
      executed_at = NULL,
      completed_at = NULL
    RETURNING *
  `
  return rows[0] as DeepMonitoringTarget
}

// 대상 상태/결과 업데이트
export async function updateDeepMonitoringTarget(id: number, updates: Partial<DeepMonitoringTarget>): Promise<DeepMonitoringTarget | null> {
  const rows = await sql`
    UPDATE deep_monitoring_targets SET
      status = COALESCE(${updates.status || null}, status),
      results_count = COALESCE(${updates.results_count ?? null}, results_count),
      new_urls_count = COALESCE(${updates.new_urls_count ?? null}, new_urls_count),
      executed_at = COALESCE(${updates.executed_at || null}, executed_at),
      completed_at = COALESCE(${updates.completed_at || null}, completed_at)
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] as DeepMonitoringTarget || null
}

// 세션별 대상 전체 삭제 (re-scan 시)
export async function deleteDeepMonitoringTargetsBySession(sessionId: string): Promise<void> {
  await sql`
    DELETE FROM deep_monitoring_targets WHERE session_id = ${sessionId}
  `
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
  // 사이트 집중 모니터링 (Deep Monitoring) 테이블
  // ============================================

  // deep_monitoring_targets 테이블
  await sql`
    CREATE TABLE IF NOT EXISTS deep_monitoring_targets (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(50) NOT NULL,
      title VARCHAR(500) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      url_count INTEGER NOT NULL,
      base_keyword VARCHAR(500) NOT NULL,
      deep_query VARCHAR(500) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      results_count INTEGER DEFAULT 0,
      new_urls_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      executed_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(session_id, title, domain)
    )
  `

  await sql`
    CREATE INDEX IF NOT EXISTS idx_deep_monitoring_session
    ON deep_monitoring_targets(session_id, status)
  `

  // detection_results에 source 컬럼 추가 (regular/deep 구분)
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'detection_results' AND column_name = 'source'
      ) THEN
        ALTER TABLE detection_results ADD COLUMN source VARCHAR(20) DEFAULT 'regular';
      END IF;
    END $$
  `

  // detection_results에 deep_target_id 컬럼 추가
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'detection_results' AND column_name = 'deep_target_id'
      ) THEN
        ALTER TABLE detection_results ADD COLUMN deep_target_id INTEGER;
      END IF;
    END $$
  `

  // sessions에 deep_monitoring 관련 컬럼 추가
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'deep_monitoring_executed'
      ) THEN
        ALTER TABLE sessions ADD COLUMN deep_monitoring_executed BOOLEAN DEFAULT false;
        ALTER TABLE sessions ADD COLUMN deep_monitoring_targets_count INTEGER DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN deep_monitoring_new_urls INTEGER DEFAULT 0;
      END IF;
    END $$
  `

  console.log('✅ Database tables initialized')
}
