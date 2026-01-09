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

  console.log('✅ Database tables initialized')
}
