// ============================================
// Jobdori - Hono Application for Vercel
// Vercel Serverless + Neon DB + Vercel Blob
// ============================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { handle } from 'hono/vercel'
import { neon } from '@neondatabase/serverless'
import * as XLSX from 'xlsx'

// ============================================
// Database Setup
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any = null

function getDatabase(): any {
  if (!sql) {
    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    sql = neon(dbUrl)
  }
  return sql
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function query(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
  const db = getDatabase()
  const result = await db(strings, ...values)
  return result as any[]
}

// DB 마이그레이션 - page1_illegal_count 컬럼 추가
let dbMigrationDone = false
async function ensureDbMigration() {
  if (dbMigrationDone) return
  try {
    const db = getDatabase()
    // manta_rankings 테이블에 page1_illegal_count 컬럼 추가 (없으면)
    await db`
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
    // manta_ranking_history 테이블에도 추가
    await db`
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
    // pending_reviews 테이블에 domain UNIQUE 제약조건 추가
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'pending_reviews_domain_unique'
        ) THEN
          ALTER TABLE pending_reviews ADD CONSTRAINT pending_reviews_domain_unique UNIQUE (domain);
        END IF;
      END $$
    `
    
    // report_tracking 테이블 생성 (없으면)
    await db`
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
    
    // report_tracking 인덱스 생성
    await db`
      CREATE INDEX IF NOT EXISTS idx_report_tracking_session 
      ON report_tracking(session_id, report_status)
    `
    
    // report_uploads 테이블 생성 (없으면)
    await db`
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
    
    // report_reasons 테이블 생성 (없으면)
    await db`
      CREATE TABLE IF NOT EXISTS report_reasons (
        id SERIAL PRIMARY KEY,
        reason_text VARCHAR(255) UNIQUE NOT NULL,
        usage_count INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    // report_tracking 테이블에 title 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_tracking' AND column_name = 'title'
        ) THEN
          ALTER TABLE report_tracking ADD COLUMN title TEXT;
        END IF;
      END $$
    `
    
    // title 컬럼에 인덱스 추가
    await db`
      CREATE INDEX IF NOT EXISTS idx_report_tracking_title 
      ON report_tracking(title)
    `
    
    // titles 테이블에 manta_url 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'titles' AND column_name = 'manta_url'
        ) THEN
          ALTER TABLE titles ADD COLUMN manta_url TEXT;
        END IF;
      END $$
    `
    
    // excluded_urls 테이블 생성 (신고 제외 URL 관리)
    await db`
      CREATE TABLE IF NOT EXISTS excluded_urls (
        id SERIAL PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    dbMigrationDone = true
    console.log('✅ DB migration completed (including report_tracking tables)')
  } catch (error) {
    console.error('DB migration error:', error)
  }
}

// ============================================
// Types
// ============================================

interface FinalResult {
  title: string
  domain: string
  url: string
  search_query: string
  page: number
  rank: number
  status: 'illegal' | 'legal' | 'unknown'
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null
  llm_reason: string | null
  final_status: 'illegal' | 'legal' | 'pending'
  reviewed_at: string | null
}

// ============================================
// Auth Setup - Signed Cookie (Stateless)
// ============================================

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'ridilegal'
// SECRET_KEY는 환경변수로 설정하거나 자동 생성 (프로덕션에서는 환경변수 권장)
const SECRET_KEY = process.env.SESSION_SECRET || 'jobdori-secret-key-2026'

// HMAC-SHA256으로 토큰 서명 생성
async function createSignedToken(payload: { exp: number }): Promise<string> {
  const data = JSON.stringify(payload)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  const signatureB64 = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signature))))
  const dataB64 = btoa(data)
  return `${dataB64}.${signatureB64}`
}

// 서명된 토큰 검증
async function verifySignedToken(token: string): Promise<boolean> {
  try {
    const [dataB64, signatureB64] = token.split('.')
    if (!dataB64 || !signatureB64) return false
    
    const data = atob(dataB64)
    const payload = JSON.parse(data)
    
    // 만료 시간 확인
    if (payload.exp && Date.now() > payload.exp) return false
    
    // 서명 검증
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    
    const signatureBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))
    const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(data))
    return isValid
  } catch {
    return false
  }
}

// ============================================
// Excel Generation
// ============================================

function generateExcelFromResults(results: FinalResult[]): Buffer {
  const columns = [
    'title', 'domain', 'url', 'search_query', 'page', 'rank',
    'status', 'llm_judgment', 'llm_reason', 'final_status', 'reviewed_at'
  ]

  const wb = XLSX.utils.book_new()
  const allData = [columns, ...results.map(r => columns.map(col => (r as any)[col] ?? ''))]
  const allWs = XLSX.utils.aoa_to_sheet(allData)
  XLSX.utils.book_append_sheet(wb, allWs, '전체 결과')

  const illegalResults = results.filter(r => r.final_status === 'illegal')
  if (illegalResults.length > 0) {
    const illegalData = [columns, ...illegalResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const illegalWs = XLSX.utils.aoa_to_sheet(illegalData)
    XLSX.utils.book_append_sheet(wb, illegalWs, '불법 사이트')
  }

  const legalResults = results.filter(r => r.final_status === 'legal')
  if (legalResults.length > 0) {
    const legalData = [columns, ...legalResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const legalWs = XLSX.utils.aoa_to_sheet(legalData)
    XLSX.utils.book_append_sheet(wb, legalWs, '합법 사이트')
  }

  const pendingResults = results.filter(r => r.final_status === 'pending')
  if (pendingResults.length > 0) {
    const pendingData = [columns, ...pendingResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const pendingWs = XLSX.utils.aoa_to_sheet(pendingData)
    XLSX.utils.book_append_sheet(wb, pendingWs, '승인 대기')
  }

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

// ============================================
// DB Functions
// ============================================

async function getSessions(): Promise<any[]> {
  return query`SELECT * FROM sessions ORDER BY created_at DESC`
}

async function getSessionById(id: string): Promise<any | null> {
  const rows = await query`SELECT * FROM sessions WHERE id = ${id}`
  return rows[0] || null
}

async function getPendingReviews(): Promise<any[]> {
  return query`SELECT * FROM pending_reviews ORDER BY created_at DESC`
}

async function getPendingReviewById(id: number): Promise<any | null> {
  const rows = await query`SELECT * FROM pending_reviews WHERE id = ${id}`
  return rows[0] || null
}

async function deletePendingReview(id: number): Promise<boolean> {
  await query`DELETE FROM pending_reviews WHERE id = ${id}`
  return true
}

async function updatePendingReviewAiResult(id: number, judgment: string, reason: string): Promise<boolean> {
  await query`
    UPDATE pending_reviews 
    SET llm_judgment = ${judgment}, llm_reason = ${reason}
    WHERE id = ${id}
  `
  return true
}

async function getSitesByType(type: 'illegal' | 'legal'): Promise<any[]> {
  return query`SELECT * FROM sites WHERE type = ${type} ORDER BY domain`
}

async function addSite(domain: string, type: 'illegal' | 'legal'): Promise<any> {
  const rows = await query`
    INSERT INTO sites (domain, type)
    VALUES (${domain.toLowerCase()}, ${type})
    ON CONFLICT (domain, type) DO NOTHING
    RETURNING *
  `
  return rows[0]
}

async function removeSite(domain: string, type: 'illegal' | 'legal'): Promise<boolean> {
  await query`DELETE FROM sites WHERE domain = ${domain.toLowerCase()} AND type = ${type}`
  return true
}

async function getCurrentTitles(): Promise<any[]> {
  return query`SELECT * FROM titles WHERE is_current = true ORDER BY created_at DESC`
}

async function getHistoryTitles(): Promise<any[]> {
  return query`SELECT * FROM titles WHERE is_current = false ORDER BY created_at DESC`
}

async function addTitle(name: string, mantaUrl?: string): Promise<any> {
  const rows = await query`
    INSERT INTO titles (name, is_current, manta_url)
    VALUES (${name}, true, ${mantaUrl || null})
    ON CONFLICT (name) DO UPDATE SET is_current = true, manta_url = COALESCE(${mantaUrl || null}, titles.manta_url)
    RETURNING *
  `
  return rows[0]
}

async function removeTitle(name: string): Promise<boolean> {
  await query`UPDATE titles SET is_current = false WHERE name = ${name}`
  return true
}

async function restoreTitle(name: string): Promise<boolean> {
  await query`UPDATE titles SET is_current = true WHERE name = ${name}`
  return true
}

async function getMonthlyStats(): Promise<any[]> {
  return query`SELECT * FROM monthly_stats ORDER BY month DESC`
}

async function getMonthlyStatsByMonth(month: string): Promise<any | null> {
  const rows = await query`SELECT * FROM monthly_stats WHERE month = ${month}`
  return rows[0] || null
}

// ============================================
// Report Tracking Functions (신고결과 추적)
// ============================================

// 신고 추적 항목 생성 (불법 URL 등록)
async function createReportTracking(item: {
  session_id: string
  url: string
  domain: string
  title?: string
  report_status?: string
  report_id?: string
  reason?: string
}): Promise<any> {
  const rows = await query`
    INSERT INTO report_tracking (session_id, url, domain, title, report_status, report_id, reason)
    VALUES (${item.session_id}, ${item.url}, ${item.domain}, ${item.title || null}, ${item.report_status || '미신고'}, 
            ${item.report_id || null}, ${item.reason || null})
    ON CONFLICT (session_id, url) DO UPDATE SET
      report_status = COALESCE(EXCLUDED.report_status, report_tracking.report_status),
      title = COALESCE(EXCLUDED.title, report_tracking.title),
      updated_at = NOW()
    RETURNING *
  `
  return rows[0]
}

// 회차별 신고 추적 목록 조회
async function getReportTrackingBySession(
  sessionId: string,
  filter?: string,
  page: number = 1,
  limit: number = 50,
  search?: string
): Promise<{ items: any[], total: number }> {
  const offset = (page - 1) * limit
  const searchPattern = search ? `%${search.toLowerCase()}%` : null
  
  let rows: any[]
  let countResult: any[]
  
  if (filter && filter !== '전체' && searchPattern) {
    // 상태 필터 + 검색어
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId} 
        AND report_status = ${filter}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId} 
        AND report_status = ${filter}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
    `
  } else if (filter && filter !== '전체') {
    // 상태 필터만
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
    `
  } else if (searchPattern) {
    // 검색어만
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
    `
  } else {
    // 필터 없음
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
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
async function getReportTrackingStatsBySession(sessionId: string): Promise<{
  total: number
  차단: number
  '대기 중': number
  색인없음: number
  거부: number
  미신고: number
}> {
  const rows = await query`
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
      (stats as any)[status] = count
    }
    stats.total += count
  }
  
  return stats
}

// 신고 추적 상태 업데이트
async function updateReportTrackingStatus(
  id: number,
  status: string,
  reportId?: string
): Promise<any | null> {
  const rows = await query`
    UPDATE report_tracking SET
      report_status = ${status},
      report_id = COALESCE(${reportId || null}, report_id),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] || null
}

// 신고 추적 사유 업데이트
async function updateReportTrackingReason(id: number, reason: string): Promise<any | null> {
  const rows = await query`
    UPDATE report_tracking SET
      reason = ${reason},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] || null
}

// URL 매칭으로 상태 일괄 업데이트 (HTML 업로드 시)
async function bulkUpdateReportTrackingByUrls(
  sessionId: string,
  urls: string[],
  status: string,
  reportId: string
): Promise<number> {
  if (urls.length === 0) return 0
  
  const result = await query`
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
async function getReportTrackingUrls(sessionId: string, filter?: string): Promise<string[]> {
  let rows: any[]
  
  if (filter && filter !== '전체') {
    rows = await query`
      SELECT url FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
      ORDER BY updated_at DESC
    `
  } else {
    rows = await query`
      SELECT url FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
    `
  }
  
  return rows.map(r => r.url)
}

// 업로드 이력 조회
async function getReportUploadsBySession(sessionId: string): Promise<any[]> {
  return query`
    SELECT * FROM report_uploads 
    WHERE session_id = ${sessionId}
    ORDER BY uploaded_at DESC
  `
}

// 업로드 이력 생성
async function createReportUpload(upload: {
  session_id: string
  report_id: string
  file_name?: string
  matched_count?: number
  total_urls_in_html?: number
}): Promise<any> {
  const rows = await query`
    INSERT INTO report_uploads (session_id, report_id, file_name, matched_count, total_urls_in_html)
    VALUES (${upload.session_id}, ${upload.report_id}, ${upload.file_name || null}, 
            ${upload.matched_count || 0}, ${upload.total_urls_in_html || 0})
    RETURNING *
  `
  return rows[0]
}

// 업로드 이력 신고 ID 수정
async function updateReportUploadId(uploadId: number, newReportId: string): Promise<any> {
  const rows = await query`
    UPDATE report_uploads 
    SET report_id = ${newReportId}
    WHERE id = ${uploadId}
    RETURNING *
  `
  return rows[0]
}

// 사유 목록 조회 (사용 빈도순)
async function getReportReasons(): Promise<any[]> {
  return query`
    SELECT * FROM report_reasons 
    ORDER BY usage_count DESC, created_at ASC
  `
}

// 사유 추가 또는 사용 횟수 증가
async function addOrUpdateReportReason(reasonText: string): Promise<any> {
  const rows = await query`
    INSERT INTO report_reasons (reason_text, usage_count)
    VALUES (${reasonText}, 1)
    ON CONFLICT (reason_text) DO UPDATE SET
      usage_count = report_reasons.usage_count + 1
    RETURNING *
  `
  return rows[0]
}

// 도메인으로 세션 내 모든 URL을 report_tracking에 등록 (title 포함)
async function registerIllegalUrlsToReportTracking(
  sessionId: string,
  domain: string,
  urls: { url: string, title?: string }[]
): Promise<number> {
  // 신고 제외 URL 목록 조회
  const excludedRows = await query`SELECT url FROM excluded_urls`
  const excludedUrls = new Set(excludedRows.map((r: any) => r.url))
  
  let registered = 0
  for (const item of urls) {
    try {
      // 신고 제외 URL인지 확인 (정확히 일치)
      const isExcluded = excludedUrls.has(item.url)
      
      await createReportTracking({
        session_id: sessionId,
        url: item.url,
        domain,
        title: item.title,
        report_status: '미신고',
        reason: isExcluded ? '웹사이트 메인 페이지' : undefined
      })
      registered++
    } catch {
      // 중복 등 오류 무시
    }
  }
  return registered
}

// ============================================
// Blob Functions
// ============================================

async function downloadResults(blobUrl: string): Promise<FinalResult[]> {
  try {
    const response = await fetch(blobUrl)
    if (!response.ok) return []
    return await response.json()
  } catch {
    return []
  }
}

// 사이트 목록을 기반으로 final_status 재계산
async function recalculateFinalStatus(results: FinalResult[]): Promise<FinalResult[]> {
  const illegalSites = await getSitesByType('illegal')
  const legalSites = await getSitesByType('legal')
  const illegalDomains = new Set(illegalSites.map((s: any) => s.domain.toLowerCase()))
  const legalDomains = new Set(legalSites.map((s: any) => s.domain.toLowerCase()))
  
  return results.map(r => {
    const domain = r.domain.toLowerCase()
    let newFinalStatus: 'illegal' | 'legal' | 'pending' = r.final_status
    
    // 사이트 목록 기반으로 재계산
    if (illegalDomains.has(domain)) {
      newFinalStatus = 'illegal'
    } else if (legalDomains.has(domain)) {
      newFinalStatus = 'legal'
    } else if (r.llm_judgment === 'likely_illegal') {
      newFinalStatus = 'pending' // 아직 검토되지 않은 경우 pending
    } else if (r.llm_judgment === 'likely_legal') {
      newFinalStatus = 'legal'
    } else {
      newFinalStatus = 'pending'
    }
    
    return { ...r, final_status: newFinalStatus }
  })
}

// ============================================
// Hono App
// ============================================

const app = new Hono()

app.use('/api/*', cors())

// ============================================
// Auth Routes
// ============================================

// NOTE: /login HTML route removed - Now served by Next.js frontend

app.post('/api/auth/login', async (c) => {
  try {
    const { password } = await c.req.json()
    if (password === ACCESS_PASSWORD) {
      // 24시간 후 만료
      const exp = Date.now() + 24 * 60 * 60 * 1000
      const token = await createSignedToken({ exp })
      setCookie(c, 'session_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: 60 * 60 * 24,
        path: '/'
      })
      return c.json({ success: true })
    }
    return c.json({ success: false, error: '비밀번호가 올바르지 않습니다.' }, 401)
  } catch {
    return c.json({ success: false, error: '요청 처리 중 오류가 발생했습니다.' }, 500)
  }
})

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, 'session_token', { path: '/' })
  return c.json({ success: true })
})

app.get('/api/auth/status', async (c) => {
  const sessionToken = getCookie(c, 'session_token')
  if (!sessionToken) return c.json({ authenticated: false })
  const isValid = await verifySignedToken(sessionToken)
  return c.json({ authenticated: isValid })
})

// Auth Middleware
app.use('*', async (c, next) => {
  const path = c.req.path
  const publicPaths = ['/login', '/api/auth/login', '/api/auth/status']
  if (publicPaths.some(p => path.startsWith(p))) return next()
  
  const sessionToken = getCookie(c, 'session_token')
  const isValid = sessionToken ? await verifySignedToken(sessionToken) : false
  if (!isValid) {
    if (path.startsWith('/api/')) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401)
    }
    return c.redirect('/login')
  }
  return next()
})

// ============================================
// API - Pending Reviews
// ============================================

app.get('/api/pending', async (c) => {
  try {
    const items = await getPendingReviews()
    return c.json({ success: true, count: items.length, items })
  } catch {
    return c.json({ success: false, error: 'Failed to load pending reviews' }, 500)
  }
})

// AI 일괄 검토 API
app.post('/api/pending/ai-review', async (c) => {
  const errors: string[] = []
  
  try {
    // Vercel은 process.env 사용
    const apiKey = process.env.GEMINI_API_KEY || (c.env as Record<string, string>)?.GEMINI_API_KEY
    
    console.log('🔍 AI Review - API Key exists:', !!apiKey)
    console.log('🔍 AI Review - Endpoint:', LITELLM_ENDPOINT)
    console.log('🔍 AI Review - Model:', LITELLM_MODEL)
    
    if (!apiKey) {
      return c.json({ success: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, 400)
    }
    
    const items = await getPendingReviews()
    console.log('🔍 AI Review - Pending items count:', items.length)
    
    if (items.length === 0) {
      return c.json({ success: true, message: '검토할 항목이 없습니다.', processed: 0 })
    }
    
    const BATCH_SIZE = 20
    const results: { id: number; domain: string; judgment: string; reason: string }[] = []
    
    // 배치별로 처리
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE)
      const domains = batch.map((item: any) => item.domain)
      
      console.log(`🔍 AI Review - Processing batch ${i / BATCH_SIZE + 1}, domains:`, domains.slice(0, 3))
      
      // AI에게 도메인 분석 요청
      const prompt = `당신은 웹툰/만화 불법 유통 사이트를 판별하는 전문가입니다.
다음 도메인들이 불법 콘텐츠 유통 사이트인지 판단해주세요.

판단 기준:
- 불법: 웹툰, 만화, 영상 등 저작권 콘텐츠를 불법 유통하는 사이트
- 합법: 공식 서비스, 정부기관, 일반 기업, 커뮤니티 등 합법적인 사이트
- 불확실: 판단이 어려운 경우

각 도메인에 대해 반드시 다음 JSON 배열 형식으로만 응답하세요 (다른 텍스트 없이):
[
  {"domain": "example.com", "judgment": "불법", "reason": "웹툰 불법 유통 사이트"},
  {"domain": "google.com", "judgment": "합법", "reason": "검색 엔진 서비스"}
]

분석할 도메인 목록:
${domains.map((d: string, idx: number) => `${idx + 1}. ${d}`).join('\n')}`

      try {
        const response = await fetch(`${LITELLM_ENDPOINT}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: LITELLM_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
          })
        })
        
        console.log('🔍 AI Review - Response status:', response.status)
        
        if (!response.ok) {
          const errorText = await response.text()
          const errorMsg = `API 오류 (${response.status}): ${errorText.substring(0, 200)}`
          console.error('❌ AI API error:', errorMsg)
          errors.push(errorMsg)
          continue
        }
        
        const data = await response.json() as any
        const content = data.choices?.[0]?.message?.content || ''
        
        console.log('🔍 AI Review - Response content length:', content.length)
        console.log('🔍 AI Review - Response preview:', content.substring(0, 200))
        
        // JSON 추출 (```json ... ``` 또는 순수 JSON)
        let jsonStr = content
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (jsonMatch) {
          jsonStr = jsonMatch[1]
        }
        
        try {
          const aiResults = JSON.parse(jsonStr.trim())
          console.log('🔍 AI Review - Parsed results count:', aiResults.length)
          
          // 결과를 DB에 저장
          for (const result of aiResults) {
            const item = batch.find((b: any) => b.domain === result.domain)
            if (item) {
              // judgment를 DB 형식으로 변환
              let dbJudgment = 'uncertain'
              if (result.judgment === '불법') dbJudgment = 'likely_illegal'
              else if (result.judgment === '합법') dbJudgment = 'likely_legal'
              else dbJudgment = 'uncertain'
              
              await updatePendingReviewAiResult(item.id, dbJudgment, result.reason)
              results.push({
                id: item.id,
                domain: result.domain,
                judgment: result.judgment,
                reason: result.reason
              })
            }
          }
        } catch (parseError: any) {
          const errorMsg = `JSON 파싱 실패: ${parseError.message}, 응답: ${content.substring(0, 100)}`
          console.error('❌', errorMsg)
          errors.push(errorMsg)
        }
      } catch (batchError: any) {
        const errorMsg = `배치 처리 오류: ${batchError.message}`
        console.error('❌', errorMsg)
        errors.push(errorMsg)
      }
    }
    
    console.log('🔍 AI Review - Final results:', results.length, 'errors:', errors.length)
    
    return c.json({
      success: true,
      processed: results.length,
      total: items.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error: any) {
    console.error('AI review error:', error)
    return c.json({ success: false, error: `AI 검토 중 오류가 발생했습니다: ${error.message}` }, 500)
  }
})

app.post('/api/review', async (c) => {
  try {
    const { id, action } = await c.req.json()
    if (!id || !action) return c.json({ success: false, error: 'Missing id or action' }, 400)
    
    const item = await getPendingReviewById(parseInt(id))
    if (!item) return c.json({ success: false, error: 'Item not found' }, 404)
    
    if (action === 'approve') {
      await addSite(item.domain, 'illegal')
      
      // ✅ 불법 승인 시 report_tracking 테이블에 자동 등록 (title 포함)
      if (item.session_id && item.urls && Array.isArray(item.urls)) {
        // urls와 titles를 매핑하여 등록
        const urlsWithTitles = item.urls.map((url: string, idx: number) => ({
          url,
          title: item.titles && Array.isArray(item.titles) ? item.titles[idx] : null
        }))
        const registeredCount = await registerIllegalUrlsToReportTracking(
          item.session_id,
          item.domain,
          urlsWithTitles
        )
        console.log(`✅ Report tracking registered: ${registeredCount} URLs for domain ${item.domain}`)
      }
      
      await deletePendingReview(parseInt(id))
    } else if (action === 'reject') {
      await addSite(item.domain, 'legal')
      await deletePendingReview(parseInt(id))
    }
    
    return c.json({ success: true, action })
  } catch (error) {
    console.error('Review processing error:', error)
    return c.json({ success: false, error: 'Failed to process review' }, 500)
  }
})

// 일괄 처리 API
app.post('/api/review/bulk', async (c) => {
  try {
    const { ids, action } = await c.req.json()
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ success: false, error: 'Missing or empty ids array' }, 400)
    }
    if (!action || (action !== 'approve' && action !== 'reject')) {
      return c.json({ success: false, error: 'Invalid action' }, 400)
    }
    
    let processed = 0
    let failed = 0
    let totalUrlsRegistered = 0
    
    for (const id of ids) {
      try {
        const item = await getPendingReviewById(parseInt(id))
        if (!item) {
          failed++
          continue
        }
        
        if (action === 'approve') {
          await addSite(item.domain, 'illegal')
          
          // ✅ 불법 승인 시 report_tracking 테이블에 자동 등록 (title 포함)
          if (item.session_id && item.urls && Array.isArray(item.urls)) {
            const urlsWithTitles = item.urls.map((url: string, idx: number) => ({
              url,
              title: item.titles && Array.isArray(item.titles) ? item.titles[idx] : null
            }))
            const registeredCount = await registerIllegalUrlsToReportTracking(
              item.session_id,
              item.domain,
              urlsWithTitles
            )
            totalUrlsRegistered += registeredCount
          }
        } else {
          await addSite(item.domain, 'legal')
        }
        await deletePendingReview(parseInt(id))
        processed++
      } catch (error) {
        console.error(`Bulk review error for id ${id}:`, error)
        failed++
      }
    }
    
    console.log(`✅ Bulk review completed: ${processed} processed, ${failed} failed, ${totalUrlsRegistered} URLs registered`)
    return c.json({ success: true, processed, failed, action, urls_registered: totalUrlsRegistered })
  } catch (error) {
    console.error('Bulk review processing error:', error)
    return c.json({ success: false, error: 'Failed to process bulk review' }, 500)
  }
})

// ============================================
// API - Sites
// ============================================

app.get('/api/sites/:type', async (c) => {
  try {
    const type = c.req.param('type') as 'illegal' | 'legal'
    if (type !== 'illegal' && type !== 'legal') {
      return c.json({ success: false, error: 'Invalid type' }, 400)
    }
    const sites = await getSitesByType(type)
    return c.json({ success: true, type, count: sites.length, sites: sites.map((s: any) => s.domain) })
  } catch {
    return c.json({ success: false, error: 'Failed to load sites' }, 500)
  }
})

app.post('/api/sites/:type', async (c) => {
  try {
    const type = c.req.param('type') as 'illegal' | 'legal'
    const { domain } = await c.req.json()
    if (!domain) return c.json({ success: false, error: 'Missing domain' }, 400)
    await addSite(domain, type)
    return c.json({ success: true, domain, type })
  } catch {
    return c.json({ success: false, error: 'Failed to add site' }, 500)
  }
})

app.delete('/api/sites/:type/:domain', async (c) => {
  try {
    const type = c.req.param('type') as 'illegal' | 'legal'
    const domain = decodeURIComponent(c.req.param('domain'))
    await removeSite(domain, type)
    return c.json({ success: true, domain, type })
  } catch {
    return c.json({ success: false, error: 'Failed to remove site' }, 500)
  }
})

// ============================================
// API - Excluded URLs (신고 제외 URL)
// ============================================

// 신고 제외 URL 목록 조회
app.get('/api/excluded-urls', async (c) => {
  try {
    const rows = await query`
      SELECT id, url, created_at FROM excluded_urls ORDER BY created_at DESC
    `
    return c.json({ success: true, items: rows })
  } catch (error) {
    console.error('Excluded URLs list error:', error)
    return c.json({ success: false, error: 'Failed to load excluded URLs' }, 500)
  }
})

// 신고 제외 URL 추가
app.post('/api/excluded-urls', async (c) => {
  try {
    const { url } = await c.req.json()
    
    if (!url) {
      return c.json({ success: false, error: 'URL을 입력해주세요.' }, 400)
    }
    
    // URL 형식 검증
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return c.json({ success: false, error: 'http:// 또는 https://로 시작하는 URL을 입력해주세요.' }, 400)
    }
    
    const result = await query`
      INSERT INTO excluded_urls (url) VALUES (${url})
      ON CONFLICT (url) DO NOTHING
      RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: '이미 등록된 URL입니다.' }, 400)
    }
    
    return c.json({ success: true, item: result[0] })
  } catch (error) {
    console.error('Add excluded URL error:', error)
    return c.json({ success: false, error: 'Failed to add excluded URL' }, 500)
  }
})

// 신고 제외 URL 삭제
app.delete('/api/excluded-urls/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    
    const result = await query`
      DELETE FROM excluded_urls WHERE id = ${id} RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: 'URL not found' }, 404)
    }
    
    return c.json({ success: true, deleted: result[0] })
  } catch (error) {
    console.error('Delete excluded URL error:', error)
    return c.json({ success: false, error: 'Failed to delete excluded URL' }, 500)
  }
})

// ============================================
// API - Titles
// ============================================

app.get('/api/titles', async (c) => {
  try {
    const current = await getCurrentTitles()
    const history = await getHistoryTitles()
    return c.json({
      success: true,
      current: current.map((t: any) => ({ name: t.name, manta_url: t.manta_url })),
      history: history.map((t: any) => ({ name: t.name, manta_url: t.manta_url }))
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

app.post('/api/titles', async (c) => {
  try {
    const { title, manta_url } = await c.req.json()
    if (!title) return c.json({ success: false, error: 'Missing title' }, 400)
    const result = await addTitle(title, manta_url)
    return c.json({ success: true, title: result })
  } catch {
    return c.json({ success: false, error: 'Failed to add title' }, 500)
  }
})

app.delete('/api/titles/:title', async (c) => {
  try {
    const title = decodeURIComponent(c.req.param('title'))
    await removeTitle(title)
    return c.json({ success: true, title })
  } catch {
    return c.json({ success: false, error: 'Failed to remove title' }, 500)
  }
})

app.post('/api/titles/restore', async (c) => {
  try {
    const { title } = await c.req.json()
    await restoreTitle(title)
    return c.json({ success: true, title })
  } catch {
    return c.json({ success: false, error: 'Failed to restore title' }, 500)
  }
})

// ============================================
// API - Sessions
// ============================================

app.get('/api/sessions', async (c) => {
  try {
    const sessionsList = await getSessions()
    
    // 각 세션의 통계를 실시간으로 재계산
    const sessionsWithStats = await Promise.all(sessionsList.map(async (s: any) => {
      let results_summary = {
        total: s.results_total || 0,
        illegal: s.results_illegal || 0,
        legal: s.results_legal || 0,
        pending: s.results_pending || 0
      }
      
      // Blob에서 결과를 가져와 실시간 통계 계산
      if (s.file_final_results?.startsWith('http')) {
        try {
          const results = await downloadResults(s.file_final_results)
          const recalculated = await recalculateFinalStatus(results)
          
          // URL 중복 제거 후 통계 계산
          const seenUrls = new Set<string>()
          const uniqueResults = recalculated.filter(r => {
            if (seenUrls.has(r.url)) return false
            seenUrls.add(r.url)
            return true
          })
          
          results_summary = {
            total: uniqueResults.length,
            illegal: uniqueResults.filter(r => r.final_status === 'illegal').length,
            legal: uniqueResults.filter(r => r.final_status === 'legal').length,
            pending: uniqueResults.filter(r => r.final_status === 'pending').length
          }
        } catch {
          // Blob 로드 실패 시 DB 값 사용
        }
      }
      
      return {
        id: s.id,
        created_at: s.created_at,
        completed_at: s.completed_at,
        status: s.status,
        titles_count: s.titles_count,
        keywords_count: s.keywords_count,
        total_searches: s.total_searches,
        results_summary
      }
    }))
    
    return c.json({
      success: true,
      count: sessionsWithStats.length,
      sessions: sessionsWithStats
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load sessions' }, 500)
  }
})

app.get('/api/sessions/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const session = await getSessionById(id)
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404)
    return c.json({
      success: true,
      session: {
        id: session.id,
        created_at: session.created_at,
        completed_at: session.completed_at,
        status: session.status,
        titles_count: session.titles_count,
        keywords_count: session.keywords_count,
        total_searches: session.total_searches,
        results_summary: {
          total: session.results_total,
          illegal: session.results_illegal,
          legal: session.results_legal,
          pending: session.results_pending
        }
      }
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load session' }, 500)
  }
})

app.get('/api/sessions/:id/results', async (c) => {
  try {
    const id = c.req.param('id')
    const session = await getSessionById(id)
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404)
    
    let results: FinalResult[] = []
    if (session.file_final_results?.startsWith('http')) {
      results = await downloadResults(session.file_final_results)
    }
    
    // 사이트 목록을 기반으로 final_status 실시간 재계산
    results = await recalculateFinalStatus(results)
    
    const titleFilter = c.req.query('title') || 'all'
    const statusFilter = c.req.query('status') || 'all'
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    
    let filteredResults = results
    
    // URL 중복 제거
    const seenUrls = new Set<string>()
    filteredResults = filteredResults.filter(r => {
      if (seenUrls.has(r.url)) return false
      seenUrls.add(r.url)
      return true
    })
    
    if (titleFilter !== 'all') {
      filteredResults = filteredResults.filter(r => r.title === titleFilter)
    }
    if (statusFilter !== 'all') {
      filteredResults = filteredResults.filter(r => r.final_status === statusFilter)
    }
    
    const total = filteredResults.length
    const startIndex = (page - 1) * limit
    const paginatedResults = filteredResults.slice(startIndex, startIndex + limit)
    const availableTitles = Array.from(new Set(results.map(r => r.title))).sort()
    
    return c.json({
      success: true,
      results: paginatedResults,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      available_titles: availableTitles
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load results' }, 500)
  }
})

app.get('/api/sessions/:id/download', async (c) => {
  try {
    const id = c.req.param('id')
    const session = await getSessionById(id)
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404)
    
    let results: FinalResult[] = []
    if (session.file_final_results?.startsWith('http')) {
      results = await downloadResults(session.file_final_results)
    }
    
    // 사이트 목록을 기반으로 final_status 실시간 재계산
    results = await recalculateFinalStatus(results)
    
    if (results.length === 0) {
      return c.json({ success: false, error: 'No results found' }, 404)
    }
    
    const excelBuffer = generateExcelFromResults(results)
    
    return new Response(new Uint8Array(excelBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="report_${id}.xlsx"`,
      },
    })
  } catch {
    return c.json({ success: false, error: 'Failed to generate report' }, 500)
  }
})

// ============================================
// API - Dashboard
// ============================================

app.get('/api/dashboard/months', async (c) => {
  try {
    // 세션 테이블에서 직접 월 목록 추출 (YYYY-MM 형식)
    const sessionsMonths = await query`
      SELECT DISTINCT SUBSTRING(id, 1, 7) as month 
      FROM sessions 
      WHERE status = 'completed' 
      ORDER BY month DESC
    `
    const months = sessionsMonths.map((s: any) => s.month)
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return c.json({ success: true, months, current_month: currentMonth })
  } catch {
    return c.json({ success: false, error: 'Failed to load months' }, 500)
  }
})

app.get('/api/dashboard', async (c) => {
  try {
    const month = c.req.query('month')
    const now = new Date()
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    
    // 해당 월의 모든 세션 가져오기
    const sessions = await query`
      SELECT id, file_final_results, results_total, results_illegal, results_legal, results_pending
      FROM sessions 
      WHERE id LIKE ${targetMonth + '%'} AND status = 'completed' AND file_final_results IS NOT NULL
      ORDER BY created_at DESC
    `
    
    if (sessions.length === 0) {
      return c.json({
        success: true,
        month: targetMonth,
        sessions_count: 0,
        top_contents: [],
        top_illegal_sites: [],
        total_stats: { total: 0, illegal: 0, legal: 0, pending: 0 }
      })
    }
    
    // 월별 총계 계산
    let totalStats = { total: 0, illegal: 0, legal: 0, pending: 0 }
    for (const s of sessions) {
      totalStats.total += s.results_total || 0
      totalStats.illegal += s.results_illegal || 0
      totalStats.legal += s.results_legal || 0
      totalStats.pending += s.results_pending || 0
    }
    
    // 모든 세션의 결과를 가져와서 누적 계산
    const titleCounts = new Map<string, number>()
    const domainCounts = new Map<string, number>()
    
    for (const session of sessions) {
      if (!session.file_final_results) continue
      try {
        const response = await fetch(session.file_final_results)
        if (!response.ok) continue
        let results: FinalResult[] = await response.json()
        
        // 사이트 목록 기반으로 final_status 재계산
        results = await recalculateFinalStatus(results)
        
        for (const r of results) {
          if (r.final_status === 'illegal') {
            titleCounts.set(r.title, (titleCounts.get(r.title) || 0) + 1)
            domainCounts.set(r.domain, (domainCounts.get(r.domain) || 0) + 1)
          }
        }
      } catch {
        // Blob 로드 실패 시 무시
      }
    }
    
    // Top 10으로 정렬
    const topContents = Array.from(titleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))
    
    const topIllegalSites = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }))
    
    // 월별 신고/차단 통계 조회 (report_tracking 기반)
    const startDate = targetMonth + '-01'
    const endDate = targetMonth + '-31'
    const reportStats = await query`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
        COUNT(*) FILTER (WHERE report_status = '차단') as blocked
      FROM report_tracking
      WHERE created_at >= ${startDate}::date
        AND created_at < (${endDate}::date + INTERVAL '1 day')
    `
    
    const discovered = parseInt(reportStats[0]?.total) || 0
    const reported = parseInt(reportStats[0]?.reported) || 0
    const blocked = parseInt(reportStats[0]?.blocked) || 0
    const blockRate = reported > 0 ? Math.round((blocked / reported) * 100 * 10) / 10 : 0
    
    return c.json({
      success: true,
      month: targetMonth,
      sessions_count: sessions.length,
      top_contents: topContents,
      top_illegal_sites: topIllegalSites,
      total_stats: totalStats,
      report_stats: {
        discovered,
        reported,
        blocked,
        blockRate
      }
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load dashboard' }, 500)
  }
})

// 전체보기 API - 해당 월의 모든 작품별 통계
app.get('/api/dashboard/all-titles', async (c) => {
  try {
    const month = c.req.query('month')
    const now = new Date()
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    
    // 해당 월의 모든 세션 가져오기
    const sessions = await query`
      SELECT id, file_final_results
      FROM sessions 
      WHERE id LIKE ${targetMonth + '%'} AND status = 'completed' AND file_final_results IS NOT NULL
    `
    
    if (sessions.length === 0) {
      return c.json({ success: true, month: targetMonth, titles: [] })
    }
    
    // 모든 세션의 결과를 가져와서 작품별 누적 계산
    const titleCounts = new Map<string, number>()
    
    for (const session of sessions) {
      if (!session.file_final_results) continue
      try {
        const response = await fetch(session.file_final_results)
        if (!response.ok) continue
        let results: FinalResult[] = await response.json()
        
        // 사이트 목록 기반으로 final_status 재계산
        results = await recalculateFinalStatus(results)
        
        for (const r of results) {
          if (r.final_status === 'illegal') {
            titleCounts.set(r.title, (titleCounts.get(r.title) || 0) + 1)
          }
        }
      } catch {
        // Blob 로드 실패 시 무시
      }
    }
    
    // 정렬해서 반환
    const titles = Array.from(titleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
    
    return c.json({ success: true, month: targetMonth, titles })
  } catch {
    return c.json({ success: false, error: 'Failed to load all titles' }, 500)
  }
})

app.get('/api/stats', async (c) => {
  try {
    const pending = await getPendingReviews()
    const illegalSites = await getSitesByType('illegal')
    const legalSites = await getSitesByType('legal')
    
    return c.json({
      success: true,
      stats: {
        pending_count: pending.length,
        illegal_sites_count: illegalSites.length,
        legal_sites_count: legalSites.length
      }
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load stats' }, 500)
  }
})

// Manta 순위 API
app.get('/api/manta-rankings', async (c) => {
  try {
    // DB 마이그레이션 확인
    await ensureDbMigration()
    
    const rankings = await query`
      SELECT title, manta_rank, first_rank_domain, search_query, session_id, 
             COALESCE(page1_illegal_count, 0) as page1_illegal_count, updated_at 
      FROM manta_rankings 
      ORDER BY title ASC
    `
    
    // 가장 최신 업데이트 시간 찾기
    let lastUpdated = null
    if (rankings.length > 0) {
      const dates = rankings.map(r => new Date(r.updated_at).getTime())
      lastUpdated = new Date(Math.max(...dates)).toISOString()
    }
    
    return c.json({
      success: true,
      rankings: rankings.map(r => ({
        title: r.title,
        mantaRank: r.manta_rank,
        firstDomain: r.first_rank_domain,
        searchQuery: r.search_query,
        sessionId: r.session_id,
        page1IllegalCount: r.page1_illegal_count || 0
      })),
      lastUpdated
    })
  } catch (error) {
    console.error('Manta rankings error:', error)
    return c.json({ success: false, error: 'Failed to load manta rankings' }, 500)
  }
})

// 작품별 순위 히스토리 API
app.get('/api/titles/:title/ranking-history', async (c) => {
  try {
    const title = decodeURIComponent(c.req.param('title'))
    
    // 먼저 히스토리 테이블에서 조회
    let history = await query`
      SELECT manta_rank, first_rank_domain, session_id, recorded_at
      FROM manta_ranking_history
      WHERE title = ${title}
      ORDER BY recorded_at ASC
    `
    
    // 히스토리가 없으면 현재 manta_rankings에서 가져오기
    if (history.length === 0) {
      const current = await query`
        SELECT manta_rank, first_rank_domain, session_id, updated_at as recorded_at
        FROM manta_rankings
        WHERE title = ${title}
      `
      history = current
    }
    
    return c.json({
      success: true,
      title,
      history: history.map(h => ({
        rank: h.manta_rank,
        firstDomain: h.first_rank_domain,
        sessionId: h.session_id,
        recordedAt: h.recorded_at
      }))
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load ranking history' }, 500)
  }
})

// 모니터링 대상 작품 목록 API (상세보기용)
app.get('/api/titles/list', async (c) => {
  try {
    const titles = await query`
      SELECT name, manta_url FROM titles WHERE is_current = true ORDER BY name ASC
    `
    return c.json({
      success: true,
      titles: titles.map(t => t.name),
      titlesWithUrl: titles.map(t => ({ name: t.name, manta_url: t.manta_url }))
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

// ============================================
// API - Title Stats (작품별 통계)
// ============================================

// 작품별 통계 조회 API
app.get('/api/stats/by-title', async (c) => {
  try {
    await ensureDbMigration()
    
    // 기간 필터 파라미터
    const startDate = c.req.query('start_date') // YYYY-MM-DD
    const endDate = c.req.query('end_date')     // YYYY-MM-DD
    
    // report_tracking에서 작품별 통계 집계
    let stats
    if (startDate && endDate) {
      // 기간 필터 적용
      stats = await query`
        SELECT 
          title,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
          COUNT(*) FILTER (WHERE report_status = '차단') as blocked,
          COUNT(*) FILTER (WHERE report_status = '미신고') as unreported
        FROM report_tracking
        WHERE title IS NOT NULL AND title != ''
          AND created_at >= ${startDate}::date
          AND created_at < (${endDate}::date + INTERVAL '1 day')
        GROUP BY title
        ORDER BY total DESC
      `
    } else {
      // 전체 기간
      stats = await query`
        SELECT 
          title,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
          COUNT(*) FILTER (WHERE report_status = '차단') as blocked,
          COUNT(*) FILTER (WHERE report_status = '미신고') as unreported
        FROM report_tracking
        WHERE title IS NOT NULL AND title != ''
        GROUP BY title
        ORDER BY total DESC
      `
    }
    
    // 차단율 계산 및 결과 정리
    const result = stats.map((s: any) => {
      const reported = parseInt(s.reported) || 0
      const blocked = parseInt(s.blocked) || 0
      const blockRate = reported > 0 ? Math.round((blocked / reported) * 100 * 10) / 10 : 0
      
      return {
        title: s.title,
        discovered: parseInt(s.total) || 0,  // 발견
        reported: reported,                   // 신고
        blocked: blocked,                     // 차단
        blockRate: blockRate                  // 차단율
      }
    })
    
    return c.json({
      success: true,
      stats: result,
      total: result.length
    })
  } catch (error) {
    console.error('Title stats error:', error)
    return c.json({ success: false, error: 'Failed to load title stats' }, 500)
  }
})

// ============================================
// API - Report Tracking (신고결과 추적)
// ============================================

// LiteLLM + Gemini 설정
const LITELLM_ENDPOINT = 'https://litellm.iaiai.ai/v1'
const LITELLM_MODEL = 'gemini-3-pro-preview'

// HTML에서 외부 URL 추출 (정규식 기반 - Google 신고 결과 페이지 최적화)
function extractUrlsFromHtml(htmlContent: string): string[] {
  const urls: string[] = []
  
  // 방법 1: external-link 클래스를 가진 <a> 태그에서 URL 추출
  // Google Report Content 페이지 형식: <a class="external-link ...">https://example.com/...</a>
  const externalLinkRegex = /<a[^>]*class="[^"]*external-link[^"]*"[^>]*>([^<]+)<\/a>/gi
  let match
  while ((match = externalLinkRegex.exec(htmlContent)) !== null) {
    const url = match[1].trim()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      urls.push(url)
    }
  }
  
  // 방법 2: external-link 클래스가 없는 경우, 일반 정규식으로 추출
  if (urls.length === 0) {
    console.log('No external-link tags found, using regex fallback...')
    const urlRegex = /https?:\/\/[^\s"'<>\]]+/g
    const allUrls = htmlContent.match(urlRegex) || []
    
    // 필터링: Google 관련 도메인 제외
    const excludedDomains = [
      'google.com', 'googleapis.com', 'googleusercontent.com', 'gstatic.com',
      'w3.org', 'accounts.google.com', 'ogs.google.com', 'fonts.googleapis.com',
      'fonts.gstatic.com', 'ssl.gstatic.com', 'lh3.google.com'
    ]
    
    for (const url of allUrls) {
      const isExcluded = excludedDomains.some(domain => url.includes(domain))
      if (!isExcluded && !urls.includes(url)) {
        urls.push(url)
      }
    }
  }
  
  // 중복 제거 및 정리
  const uniqueUrls = [...new Set(urls)]
  console.log(`📎 Extracted ${uniqueUrls.length} unique URLs from HTML`)
  
  return uniqueUrls
}

// ⚠️ 정적 라우트는 동적 라우트(:sessionId) 앞에 배치해야 함

// 세션 목록 (신고 추적용) - 정적 라우트
app.get('/api/report-tracking/sessions', async (c) => {
  try {
    await ensureDbMigration()
    
    const sessions = await getSessions()
    console.log('📋 Total sessions:', sessions.length)
    
    // 각 세션의 신고 추적 통계 조회
    const sessionsWithStats = await Promise.all(sessions.map(async (s: any) => {
      const stats = await getReportTrackingStatsBySession(s.id)
      console.log(`📊 Session ${s.id} stats:`, stats)
      return {
        id: s.id,
        created_at: s.created_at,
        status: s.status,
        tracking_stats: stats
      }
    }))
    
    // 신고 추적 데이터가 있는 세션만 필터링
    const filteredSessions = sessionsWithStats.filter(s => s.tracking_stats.total > 0)
    console.log('✅ Filtered sessions with data:', filteredSessions.length)
    
    return c.json({
      success: true,
      sessions: filteredSessions
    })
  } catch (error) {
    console.error('Sessions list error:', error)
    return c.json({ success: false, error: 'Failed to load sessions' }, 500)
  }
})

// 사유 목록 조회 - 정적 라우트
app.get('/api/report-tracking/reasons', async (c) => {
  try {
    const reasons = await getReportReasons()
    return c.json({
      success: true,
      reasons: reasons.map((r: any) => ({
        id: r.id,
        text: r.reason_text,
        usage_count: r.usage_count
      }))
    })
  } catch (error) {
    console.error('Reasons list error:', error)
    return c.json({ success: false, error: 'Failed to load reasons' }, 500)
  }
})

// 회차별 신고 추적 목록 조회 - 동적 라우트
app.get('/api/report-tracking/:sessionId', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const status = c.req.query('status')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    const search = c.req.query('search') || ''
    
    const result = await getReportTrackingBySession(sessionId, status, page, limit, search)
    
    return c.json({
      success: true,
      session_id: sessionId,
      items: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    })
  } catch (error) {
    console.error('Report tracking list error:', error)
    return c.json({ success: false, error: 'Failed to load report tracking' }, 500)
  }
})

// 회차별 통계 조회
app.get('/api/report-tracking/:sessionId/stats', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const stats = await getReportTrackingStatsBySession(sessionId)
    
    return c.json({
      success: true,
      session_id: sessionId,
      stats
    })
  } catch (error) {
    console.error('Report tracking stats error:', error)
    return c.json({ success: false, error: 'Failed to load stats' }, 500)
  }
})

// 상태 업데이트
app.put('/api/report-tracking/:id/status', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { status, report_id } = await c.req.json()
    
    if (!status) {
      return c.json({ success: false, error: 'Missing status' }, 400)
    }
    
    const validStatuses = ['미신고', '차단', '대기 중', '색인없음', '거부']
    if (!validStatuses.includes(status)) {
      return c.json({ success: false, error: 'Invalid status' }, 400)
    }
    
    const updated = await updateReportTrackingStatus(id, status, report_id)
    if (!updated) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    return c.json({ success: true, item: updated })
  } catch (error) {
    console.error('Status update error:', error)
    return c.json({ success: false, error: 'Failed to update status' }, 500)
  }
})

// 사유 업데이트
app.put('/api/report-tracking/:id/reason', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { reason } = await c.req.json()
    
    if (!reason) {
      return c.json({ success: false, error: 'Missing reason' }, 400)
    }
    
    // 사유 목록에 추가/업데이트
    await addOrUpdateReportReason(reason)
    
    const updated = await updateReportTrackingReason(id, reason)
    if (!updated) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    return c.json({ success: true, item: updated })
  } catch (error) {
    console.error('Reason update error:', error)
    return c.json({ success: false, error: 'Failed to update reason' }, 500)
  }
})

// 신고ID만 업데이트
app.put('/api/report-tracking/:id/report-id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { report_id } = await c.req.json()
    
    const updated = await query`
      UPDATE report_tracking 
      SET report_id = ${report_id || null}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `
    
    if (!updated || updated.length === 0) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    return c.json({ success: true, item: updated[0] })
  } catch (error) {
    console.error('Report ID update error:', error)
    return c.json({ success: false, error: 'Failed to update report ID' }, 500)
  }
})

// URL 수동 추가 (신고결과 추적 + 모니터링 회차 연동)
app.post('/api/report-tracking/:sessionId/add-url', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const { url, title } = await c.req.json()
    
    if (!url) {
      return c.json({ success: false, error: 'URL을 입력해주세요.' }, 400)
    }
    
    if (!title) {
      return c.json({ success: false, error: '작품을 선택해주세요.' }, 400)
    }
    
    // URL 유효성 검사
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return c.json({ success: false, error: 'http:// 또는 https://로 시작하는 URL을 입력해주세요.' }, 400)
    }
    
    // 도메인 추출
    let domain: string
    try {
      const urlObj = new URL(url)
      domain = urlObj.hostname.replace('www.', '')
    } catch {
      return c.json({ success: false, error: '올바른 URL 형식이 아닙니다.' }, 400)
    }
    
    // 1. report_tracking 테이블에 추가 (title 포함)
    const trackingResult = await createReportTracking({
      session_id: sessionId,
      url: url,
      domain: domain,
      title: title,
      report_status: '미신고'
    })
    
    if (!trackingResult) {
      return c.json({ success: false, error: '이미 등록된 URL입니다.' }, 400)
    }
    
    // 2. 도메인을 불법 사이트 목록에 추가 (중복 무시)
    await addSite(domain, 'illegal')
    
    // 3. 세션의 Blob 결과 파일 업데이트 (모니터링 회차 연동)
    const session = await getSessionById(sessionId)
    if (session?.file_final_results?.startsWith('http')) {
      try {
        // 기존 결과 다운로드
        const existingResults = await downloadResults(session.file_final_results)
        
        // 새 결과 추가
        const newResult: FinalResult = {
          title: title,
          domain: domain,
          url: url,
          search_query: '수동 추가',
          page: 0,
          rank: 0,
          status: 'illegal',
          llm_judgment: null,
          llm_reason: null,
          final_status: 'illegal',
          reviewed_at: new Date().toISOString()
        }
        
        existingResults.push(newResult)
        
        // Blob에 다시 업로드
        const { put } = await import('@vercel/blob')
        const blob = await put(
          `results/${sessionId}/final-results.json`,
          JSON.stringify(existingResults),
          { access: 'public', addRandomSuffix: false }
        )
        
        // 세션 업데이트
        await query`
          UPDATE sessions SET
            file_final_results = ${blob.url},
            results_total = ${existingResults.length},
            results_illegal = ${existingResults.filter(r => r.final_status === 'illegal').length}
          WHERE id = ${sessionId}
        `
        
        console.log(`✅ URL added to session ${sessionId}: ${url}`)
      } catch (blobError) {
        console.error('Blob update error:', blobError)
        // Blob 업데이트 실패해도 report_tracking에는 추가됨
      }
    }
    
    return c.json({
      success: true,
      message: 'URL이 추가되었습니다.',
      url: url,
      domain: domain
    })
  } catch (error) {
    console.error('Add URL error:', error)
    return c.json({ success: false, error: 'URL 추가 실패' }, 500)
  }
})

// HTML 업로드 및 URL 매칭
app.post('/api/report-tracking/:sessionId/upload', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const { html_content, report_id, file_name } = await c.req.json()
    
    if (!html_content || !report_id) {
      return c.json({ success: false, error: 'Missing html_content or report_id' }, 400)
    }
    
    // HTML에서 URL 추출 (정규식 기반)
    console.log(`📥 Processing HTML upload for session ${sessionId}, report_id: ${report_id}`)
    const extractedUrls = extractUrlsFromHtml(html_content)
    
    if (extractedUrls.length === 0) {
      return c.json({ 
        success: false, 
        error: 'No URLs extracted from HTML. Check if the HTML contains external links.' 
      }, 400)
    }
    
    // 세션의 URL과 매칭하여 상태 업데이트
    const matchedCount = await bulkUpdateReportTrackingByUrls(
      sessionId,
      extractedUrls,
      '차단',
      report_id
    )
    
    console.log(`✅ Matched and updated ${matchedCount} URLs`)
    
    // 업로드 이력 저장
    await createReportUpload({
      session_id: sessionId,
      report_id,
      file_name: file_name || 'uploaded.html',
      matched_count: matchedCount,
      total_urls_in_html: extractedUrls.length
    })
    
    return c.json({
      success: true,
      report_id,
      extracted_urls: extractedUrls.length,
      matched_urls: matchedCount,
      message: `${matchedCount}개 URL이 '차단' 상태로 업데이트되었습니다.`
    })
  } catch (error) {
    console.error('HTML upload error:', error)
    return c.json({ success: false, error: 'Failed to process HTML upload' }, 500)
  }
})

// 업로드 이력 조회
app.get('/api/report-tracking/:sessionId/uploads', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const uploads = await getReportUploadsBySession(sessionId)
    
    return c.json({
      success: true,
      session_id: sessionId,
      uploads: uploads.map((u: any) => ({
        id: u.id,
        report_id: u.report_id,
        file_name: u.file_name,
        matched_count: u.matched_count,
        total_urls_in_html: u.total_urls_in_html,
        uploaded_at: u.uploaded_at
      }))
    })
  } catch (error) {
    console.error('Uploads list error:', error)
    return c.json({ success: false, error: 'Failed to load uploads' }, 500)
  }
})

// 업로드 이력 신고 ID 수정
app.put('/api/report-tracking/uploads/:uploadId', async (c) => {
  try {
    const uploadId = parseInt(c.req.param('uploadId'))
    const { report_id } = await c.req.json()
    
    if (!report_id) {
      return c.json({ success: false, error: '신고 ID가 필요합니다.' }, 400)
    }
    
    const updated = await updateReportUploadId(uploadId, report_id)
    
    if (!updated) {
      return c.json({ success: false, error: '업로드 이력을 찾을 수 없습니다.' }, 404)
    }
    
    return c.json({ success: true, upload: updated })
  } catch (error) {
    console.error('Update upload error:', error)
    return c.json({ success: false, error: 'Failed to update upload' }, 500)
  }
})

// URL 목록 내보내기 (복사용)
app.get('/api/report-tracking/:sessionId/urls', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const status = c.req.query('status')
    
    const urls = await getReportTrackingUrls(sessionId, status)
    
    return c.json({
      success: true,
      session_id: sessionId,
      filter: status || '전체',
      count: urls.length,
      urls
    })
  } catch (error) {
    console.error('URLs export error:', error)
    return c.json({ success: false, error: 'Failed to export URLs' }, 500)
  }
})

// CSV 내보내기
app.get('/api/report-tracking/:sessionId/export', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const result = await getReportTrackingBySession(sessionId, undefined, 1, 10000)
    const items = result.items
    
    // CSV 생성
    const headers = ['URL', '도메인', '신고상태', '신고ID', '사유', '등록일', '수정일']
    const rows = items.map((item: any) => [
      item.url,
      item.domain,
      item.report_status,
      item.report_id || '',
      item.reason || '',
      item.created_at,
      item.updated_at
    ])
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map((cell: string) => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n')
    
    // BOM 추가 (Excel 한글 호환)
    const bom = '\uFEFF'
    
    return new Response(bom + csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-tracking-${sessionId}.csv"`
      }
    })
  } catch (error) {
    console.error('CSV export error:', error)
    return c.json({ success: false, error: 'Failed to export CSV' }, 500)
  }
})


// ============================================
// Main Page - Now served by Next.js frontend
// ============================================

// NOTE: / route HTML removed - Now served by Next.js frontend

// Export for Vercel Serverless
export default handle(app)
export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
export const PATCH = handle(app)
