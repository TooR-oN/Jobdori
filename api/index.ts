// ============================================
// Jobdori - Hono Application for Vercel
// Vercel Serverless + Neon DB + Vercel Blob
// ============================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
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
    
    // 기본 사유 옵션 추가
    await db`
      INSERT INTO report_reasons (reason_text, usage_count)
      VALUES 
        ('저작권 미확인', 100),
        ('검토 필요', 99),
        ('중복 신고', 98),
        ('URL 오류', 97)
      ON CONFLICT (reason_text) DO NOTHING
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

async function addTitle(name: string): Promise<any> {
  const rows = await query`
    INSERT INTO titles (name, is_current)
    VALUES (${name}, true)
    ON CONFLICT (name) DO UPDATE SET is_current = true
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
  report_status?: string
  report_id?: string
  reason?: string
}): Promise<any> {
  const rows = await query`
    INSERT INTO report_tracking (session_id, url, domain, report_status, report_id, reason)
    VALUES (${item.session_id}, ${item.url}, ${item.domain}, ${item.report_status || '미신고'}, 
            ${item.report_id || null}, ${item.reason || null})
    ON CONFLICT (session_id, url) DO UPDATE SET
      report_status = COALESCE(EXCLUDED.report_status, report_tracking.report_status),
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
  limit: number = 50
): Promise<{ items: any[], total: number }> {
  const offset = (page - 1) * limit
  
  let rows: any[]
  let countResult: any[]
  
  if (filter && filter !== '전체') {
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
  } else {
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

// 도메인으로 세션 내 모든 URL을 report_tracking에 등록
async function registerIllegalUrlsToReportTracking(
  sessionId: string,
  domain: string,
  urls: string[]
): Promise<number> {
  let registered = 0
  for (const url of urls) {
    try {
      await createReportTracking({
        session_id: sessionId,
        url,
        domain,
        report_status: '미신고'
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

app.get('/login', async (c) => {
  const sessionToken = getCookie(c, 'session_token')
  if (sessionToken && await verifySignedToken(sessionToken)) {
    return c.redirect('/')
  }
  
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>로그인 - Jobdori</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-blue-500 to-purple-600 min-h-screen flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
    <div class="text-center mb-8">
      <div class="flex items-center justify-center gap-3">
        <svg width="60" height="24" viewBox="0 0 60 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="20" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="#1E9EF4">RIDI</text>
        </svg>
        <h1 class="text-3xl font-bold text-gray-800">Jobdori</h1>
      </div>
      <p class="text-gray-500 mt-2">리디 저작권 침해 모니터링 시스템</p>
    </div>
    <form id="login-form" onsubmit="handleLogin(event)">
      <div class="mb-6">
        <label class="block text-gray-700 text-sm font-medium mb-2">비밀번호</label>
        <input type="password" id="password" 
               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
               placeholder="비밀번호를 입력하세요" required autofocus>
      </div>
      <div id="error-message" class="hidden mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
        비밀번호가 올바르지 않습니다.
      </div>
      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition">
        <i class="fas fa-sign-in-alt mr-2"></i>로그인
      </button>
    </form>
  </div>
  <script>
    async function handleLogin(event) {
      event.preventDefault();
      const password = document.getElementById('password').value;
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await response.json();
      if (data.success) {
        window.location.href = '/';
      } else {
        document.getElementById('error-message').classList.remove('hidden');
      }
    }
  </script>
</body>
</html>
  `)
})

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

app.post('/api/review', async (c) => {
  try {
    const { id, action } = await c.req.json()
    if (!id || !action) return c.json({ success: false, error: 'Missing id or action' }, 400)
    
    const item = await getPendingReviewById(parseInt(id))
    if (!item) return c.json({ success: false, error: 'Item not found' }, 404)
    
    if (action === 'approve') {
      await addSite(item.domain, 'illegal')
      
      // ✅ 불법 승인 시 report_tracking 테이블에 자동 등록
      if (item.session_id && item.urls && Array.isArray(item.urls)) {
        const registeredCount = await registerIllegalUrlsToReportTracking(
          item.session_id,
          item.domain,
          item.urls
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
          
          // ✅ 불법 승인 시 report_tracking 테이블에 자동 등록
          if (item.session_id && item.urls && Array.isArray(item.urls)) {
            const registeredCount = await registerIllegalUrlsToReportTracking(
              item.session_id,
              item.domain,
              item.urls
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
// API - Titles
// ============================================

app.get('/api/titles', async (c) => {
  try {
    const current = await getCurrentTitles()
    const history = await getHistoryTitles()
    return c.json({
      success: true,
      current: current.map((t: any) => t.name),
      history: history.map((t: any) => t.name)
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

app.post('/api/titles', async (c) => {
  try {
    const { title } = await c.req.json()
    if (!title) return c.json({ success: false, error: 'Missing title' }, 400)
    await addTitle(title)
    return c.json({ success: true, title })
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
    const stats = await getMonthlyStats()
    const months = stats.map((s: any) => s.month)
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
    
    return c.json({
      success: true,
      month: targetMonth,
      sessions_count: sessions.length,
      top_contents: topContents,
      top_illegal_sites: topIllegalSites,
      total_stats: totalStats
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
      SELECT name FROM titles WHERE is_current = true ORDER BY name ASC
    `
    return c.json({
      success: true,
      titles: titles.map(t => t.name)
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

// ============================================
// API - Report Tracking (신고결과 추적)
// ============================================

// LiteLLM + Gemini 설정
const LITELLM_ENDPOINT = 'https://litellm.iaiai.ai/v1'
const LITELLM_MODEL = 'gemini-2.5-pro-preview'

// Gemini를 통한 HTML에서 URL 추출
async function extractUrlsFromHtmlWithGemini(htmlContent: string): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set')
    return []
  }

  try {
    const response = await fetch(`${LITELLM_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: LITELLM_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are an HTML parsing expert. Extract all external URLs from the provided HTML content.
Rules:
1. Only extract URLs from anchor tags with class "external-link" or similar external link indicators
2. Exclude any Google-related domains (google.com, googleapis.com, googleusercontent.com, gstatic.com)
3. Exclude w3.org domains
4. Return ONLY a JSON array of unique URLs, nothing else
5. If no URLs found, return empty array []

Output format: ["https://example1.com/page", "https://example2.com/page"]`
          },
          {
            role: 'user',
            content: `Extract external URLs from this HTML:\n\n${htmlContent.substring(0, 100000)}`
          }
        ],
        temperature: 0,
        max_tokens: 4000
      })
    })

    if (!response.ok) {
      console.error('LiteLLM API error:', response.status, await response.text())
      return []
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    
    // JSON 파싱 시도
    try {
      // 마크다운 코드 블록 제거
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim()
      const urls = JSON.parse(cleanContent)
      if (Array.isArray(urls)) {
        return urls.filter((url: string) => typeof url === 'string' && url.startsWith('http'))
      }
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError)
      // 정규식으로 URL 추출 시도
      const urlMatches = content.match(/https?:\/\/[^\s"'\]]+/g) || []
      return urlMatches.filter((url: string) => 
        !url.includes('google.com') && 
        !url.includes('googleapis.com') && 
        !url.includes('w3.org')
      )
    }
    
    return []
  } catch (error) {
    console.error('Gemini URL extraction error:', error)
    return []
  }
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
    
    const result = await getReportTrackingBySession(sessionId, status, page, limit)
    
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

// HTML 업로드 및 URL 매칭
app.post('/api/report-tracking/:sessionId/upload', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const { html_content, report_id, file_name } = await c.req.json()
    
    if (!html_content || !report_id) {
      return c.json({ success: false, error: 'Missing html_content or report_id' }, 400)
    }
    
    // Gemini로 URL 추출
    console.log(`📥 Processing HTML upload for session ${sessionId}, report_id: ${report_id}`)
    const extractedUrls = await extractUrlsFromHtmlWithGemini(html_content)
    console.log(`📋 Extracted ${extractedUrls.length} URLs from HTML`)
    
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
    const items = await getReportTrackingBySession(sessionId)
    
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
// Main Page (Full UI)
// ============================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jobdori - 리디 저작권 침해 모니터링</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    .tab-active { border-bottom: 3px solid #3b82f6; color: #3b82f6; font-weight: 600; }
    .status-illegal { background-color: #ef4444; }
    .status-legal { background-color: #22c55e; }
    .status-pending { background-color: #f59e0b; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="container mx-auto px-4 py-8 max-w-7xl">
    <!-- 헤더 -->
    <div class="bg-white rounded-lg shadow-md p-4 md:p-6 mb-4 md:mb-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div class="flex items-center gap-3">
          <svg width="60" height="24" viewBox="0 0 60 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0">
            <text x="0" y="20" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="#1E9EF4">RIDI</text>
          </svg>
          <div>
            <h1 class="text-xl md:text-2xl font-bold text-gray-800">Jobdori</h1>
            <p class="text-gray-600 text-xs md:text-sm hidden sm:block">리디 저작권 침해 모니터링 시스템</p>
          </div>
        </div>
        <div class="flex gap-2 md:gap-3">
          <button onclick="openTitlesModal()" class="flex-1 md:flex-none bg-purple-500 hover:bg-purple-600 text-white px-3 md:px-4 py-2 rounded-lg transition text-sm md:text-base">
            <i class="fas fa-list-alt md:mr-2"></i><span class="hidden md:inline">작품 변경</span>
          </button>
          <button onclick="handleLogout()" class="flex-1 md:flex-none bg-gray-500 hover:bg-gray-600 text-white px-3 md:px-4 py-2 rounded-lg transition text-sm md:text-base">
            <i class="fas fa-sign-out-alt md:mr-2"></i><span class="hidden md:inline">로그아웃</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 탭 메뉴 -->
    <div class="bg-white rounded-lg shadow-md mb-4 md:mb-6">
      <div class="flex border-b overflow-x-auto">
        <button id="tab-dashboard" onclick="switchTab('dashboard')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 tab-active text-sm md:text-base">
          <i class="fas fa-chart-line md:mr-2"></i><span class="hidden md:inline">대시보드</span>
        </button>
        <button id="tab-pending" onclick="switchTab('pending')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-clock md:mr-2"></i><span class="hidden md:inline">승인 대기</span>
          <span id="pending-badge" class="ml-1 md:ml-2 bg-red-500 text-white text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full">0</span>
        </button>
        <button id="tab-sessions" onclick="switchTab('sessions')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-history md:mr-2"></i><span class="hidden md:inline">모니터링 회차</span>
        </button>
        <button id="tab-report-tracking" onclick="switchTab('report-tracking')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-file-alt md:mr-2"></i><span class="hidden md:inline">신고결과 추적</span>
        </button>
        <button id="tab-sites" onclick="switchTab('sites')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-globe md:mr-2"></i><span class="hidden md:inline">사이트 목록</span>
        </button>
        <button id="tab-title-stats" onclick="switchTab('title-stats')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-book md:mr-2"></i><span class="hidden md:inline">작품별 통계</span>
        </button>
      </div>
    </div>

    <!-- 대시보드 탭 -->
    <div id="content-dashboard" class="tab-content">
      <div class="bg-white rounded-lg shadow-md p-4 md:p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 md:mb-6">
          <h2 class="text-lg md:text-xl font-bold">월간 모니터링 현황</h2>
          <select id="month-select" onchange="loadDashboard()" class="border rounded-lg px-3 py-2 text-sm md:text-base">
            <option value="">로딩 중...</option>
          </select>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
          <div class="bg-blue-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-blue-600" id="dash-total">0</div>
            <div class="text-gray-600 text-xs md:text-base">전체 URL</div>
          </div>
          <div class="bg-red-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-red-600" id="dash-illegal">0</div>
            <div class="text-gray-600 text-xs md:text-base">불법 URL</div>
          </div>
          <div class="bg-green-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-green-600" id="dash-legal">0</div>
            <div class="text-gray-600 text-xs md:text-base">합법 URL</div>
          </div>
          <div class="bg-purple-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-purple-600" id="dash-sessions">0</div>
            <div class="text-gray-600 text-xs md:text-base">모니터링 횟수</div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div>
            <div class="flex justify-between items-center mb-3">
              <h3 class="font-bold text-sm md:text-base"><i class="fas fa-fire text-red-500 mr-2"></i>불법 URL 많은 작품 Top 5</h3>
              <button onclick="openAllTitlesModal()" class="text-xs md:text-sm text-blue-500 hover:text-blue-700">전체보기 <i class="fas fa-arrow-right"></i></button>
            </div>
            <div id="top-contents" class="space-y-2 text-sm">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold mb-3 text-sm md:text-base"><i class="fas fa-skull-crossbones text-red-500 mr-2"></i>상위 불법 도메인 Top 5</h3>
            <div id="top-domains" class="space-y-2 text-sm">로딩 중...</div>
          </div>
        </div>
      </div>
      
      <!-- Manta 검색 순위 -->
      <div class="bg-white rounded-lg shadow-md p-4 md:p-6 mt-4 md:mt-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h2 class="text-lg md:text-xl font-bold"><i class="fas fa-chart-line text-blue-500 mr-2"></i>Manta 검색 순위</h2>
          <span id="manta-updated" class="text-xs md:text-sm text-gray-500"></span>
        </div>
        <p class="text-xs md:text-sm text-gray-500 mb-4">작품명만 검색 시 manta.net 순위 (P1-1 = 페이지1, 1위)</p>
        <div id="manta-rankings" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">로딩 중...</div>
      </div>

    </div>

    <!-- 승인 대기 탭 -->
    <div id="content-pending" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-4 md:p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 class="text-lg md:text-xl font-bold"><i class="fas fa-clock text-yellow-500 mr-2"></i>승인 대기 목록</h2>
          <div id="bulk-actions" class="hidden flex flex-wrap gap-2">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" id="select-all-pending" onchange="toggleSelectAll()" class="w-4 h-4 cursor-pointer">
              <span>전체 선택</span>
            </label>
            <button onclick="bulkReview('approve')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm">
              <i class="fas fa-ban mr-1"></i>일괄 불법
            </button>
            <button onclick="bulkReview('reject')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm">
              <i class="fas fa-check mr-1"></i>일괄 합법
            </button>
          </div>
        </div>
        <div id="pending-list">로딩 중...</div>
      </div>
    </div>

    <!-- 모니터링 회차 탭 -->
    <div id="content-sessions" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6 mb-4">
        <h2 class="text-xl font-bold mb-4"><i class="fas fa-history text-blue-500 mr-2"></i>모니터링 회차</h2>
        <div id="sessions-list">로딩 중...</div>
        <div id="sessions-pagination" class="flex justify-center gap-2 mt-4"></div>
      </div>
      
      <!-- 회차 상세 (목록 아래에 표시) -->
      <div id="session-detail" class="hidden bg-white rounded-lg shadow-md p-4 md:p-6">
        <!-- 헤더 -->
        <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-4">
          <h3 class="text-base md:text-lg font-bold truncate">
            <i class="fas fa-table text-blue-500 mr-2"></i>
            <span class="hidden md:inline">세션 상세 결과: </span>
            <span id="session-detail-title"></span>
          </h3>
          <div class="flex gap-2 flex-wrap">
            <button onclick="copyAllIllegalUrls()" class="bg-red-500 hover:bg-red-600 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm">
              <i class="fas fa-copy mr-1"></i><span class="hidden sm:inline">불법 URL </span>복사
            </button>
            <button onclick="downloadSessionReport()" class="bg-green-500 hover:bg-green-600 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm">
              <i class="fas fa-download mr-1"></i><span class="hidden sm:inline">엑셀 </span>다운로드
            </button>
            <button onclick="closeSessionDetail()" class="text-gray-500 hover:text-gray-700 px-2">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>
        
        <!-- 통계 요약 바 -->
        <div id="session-stats-bar" class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-center text-xs md:text-sm"></div>
        
        <!-- 필터 -->
        <div class="flex gap-2 md:gap-4 mb-4 items-center flex-wrap">
          <select id="session-title-filter" class="border rounded px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm flex-1 md:flex-none" onchange="loadSessionResults()">
            <option value="all">모든 작품</option>
          </select>
          <select id="session-status-filter" class="border rounded px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm" onchange="loadSessionResults()">
            <option value="all">모든 상태</option>
            <option value="illegal">불법</option>
            <option value="legal">합법</option>
            <option value="pending">대기</option>
          </select>
        </div>
        
        <!-- 데스크톱 테이블 -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead class="bg-gray-100 sticky top-0">
              <tr>
                <th class="border px-3 py-2 text-left w-8">#</th>
                <th class="border px-3 py-2 text-left">작품명</th>
                <th class="border px-3 py-2 text-left">URL</th>
                <th class="border px-3 py-2 text-center w-20">상태</th>
                <th class="border px-3 py-2 text-center w-24">LLM판단</th>
                <th class="border px-3 py-2 text-center w-36">검토일시</th>
              </tr>
            </thead>
            <tbody id="session-results-desktop">
              <tr><td colspan="6" class="text-center py-4 text-gray-500">로딩 중...</td></tr>
            </tbody>
          </table>
        </div>
        <!-- 모바일 카드 뷰 -->
        <div id="session-results-mobile" class="md:hidden space-y-2">
          <div class="text-center py-4 text-gray-500">로딩 중...</div>
        </div>
        <div id="session-results-pagination" class="flex justify-center gap-2 mt-4"></div>
      </div>
    </div>

    <!-- 사이트 목록 탭 -->
    <div id="content-sites" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4"><i class="fas fa-globe text-blue-500 mr-2"></i>사이트 목록</h2>
        <div class="grid grid-cols-2 gap-6">
          <div>
            <h3 class="font-bold text-red-600 mb-3">
              <i class="fas fa-ban mr-2"></i>불법 사이트 (<span id="illegal-count">0</span>개)
            </h3>
            <div class="flex gap-2 mb-3">
              <input type="text" id="new-illegal-site" placeholder="불법 사이트 도메인 입력..." 
                     class="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                     onkeypress="if(event.key==='Enter') addNewSite('illegal')">
              <button onclick="addNewSite('illegal')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded text-sm">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            <div id="illegal-sites-list" class="max-h-80 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold text-green-600 mb-3">
              <i class="fas fa-check mr-2"></i>합법 사이트 (<span id="legal-count">0</span>개)
            </h3>
            <div class="flex gap-2 mb-3">
              <input type="text" id="new-legal-site" placeholder="합법 사이트 도메인 입력..." 
                     class="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                     onkeypress="if(event.key==='Enter') addNewSite('legal')">
              <button onclick="addNewSite('legal')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded text-sm">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            <div id="legal-sites-list" class="max-h-80 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 작품별 통계 탭 -->
    <div id="content-title-stats" class="tab-content hidden">
      <div class="flex flex-col md:flex-row gap-4">
        <!-- 좌측: 작품 목록 -->
        <div class="w-full md:w-64 lg:w-72 flex-shrink-0">
          <div class="bg-white rounded-lg shadow-md p-4 sticky top-4">
            <h3 class="font-bold text-purple-600 mb-3"><i class="fas fa-list mr-2"></i>작품 목록</h3>
            <!-- 검색 입력 -->
            <div class="relative mb-3">
              <input type="text" id="title-search-input" placeholder="작품 검색..." 
                     class="w-full border rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                     oninput="filterTitleList()">
              <i class="fas fa-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            </div>
            <!-- 작품 목록 -->
            <div id="title-stats-list" class="max-h-[60vh] overflow-y-auto space-y-1">
              <div class="text-gray-400 text-sm text-center py-4">로딩 중...</div>
            </div>
          </div>
        </div>
        
        <!-- 우측: 통계 그래프 -->
        <div class="flex-1">
          <div id="title-detail-panel" class="bg-white rounded-lg shadow-md p-4 md:p-6">
            <div id="title-stats-placeholder" class="text-center py-16 text-gray-400">
              <i class="fas fa-chart-bar text-6xl mb-4"></i>
              <p class="text-lg">좌측에서 작품을 선택하세요</p>
              <p class="text-sm mt-2">월별 불법 URL 통계와 검색 순위 변화를 확인할 수 있습니다.</p>
            </div>
            <div id="title-stats-content" class="hidden">
              <h3 class="text-lg font-bold mb-4"><i class="fas fa-chart-line text-purple-500 mr-2"></i><span id="selected-title-name"></span></h3>
              
              <!-- 검색 순위 꺾은선 그래프 -->
              <div class="bg-gray-50 rounded-lg p-4">
                <h4 class="font-semibold mb-3 text-sm"><i class="fas fa-chart-line mr-2 text-blue-500"></i>Manta 검색 순위 변화</h4>
                <p class="text-xs text-gray-500 mb-3">작품명만 검색 시 manta.net 순위 (1위가 가장 좋음)</p>
                <div class="h-72">
                  <canvas id="ranking-history-chart"></canvas>
                </div>
                <p id="ranking-chart-empty" class="hidden text-center text-gray-400 py-8">순위 데이터가 없습니다.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 신고결과 추적 탭 -->
    <div id="content-report-tracking" class="tab-content hidden">
      <div class="flex flex-col lg:flex-row gap-4">
        <!-- 좌측: 회차 선택 및 업로드 -->
        <div class="w-full lg:w-72 flex-shrink-0">
          <div class="bg-white rounded-lg shadow-md p-4 sticky top-4">
            <h3 class="font-bold text-blue-600 mb-3"><i class="fas fa-calendar-alt mr-2"></i>모니터링 회차</h3>
            <select id="report-session-select" onchange="loadReportTracking()" class="w-full border rounded-lg px-3 py-2 text-sm mb-4">
              <option value="">회차 선택...</option>
            </select>
            
            <!-- 통계 카드 -->
            <div id="report-stats" class="space-y-2 mb-4">
              <div class="grid grid-cols-2 gap-2 text-center text-xs">
                <div class="bg-gray-50 p-2 rounded">
                  <div class="font-bold text-lg" id="rt-total">0</div>
                  <div class="text-gray-500">전체</div>
                </div>
                <div class="bg-green-50 p-2 rounded">
                  <div class="font-bold text-lg text-green-600" id="rt-blocked">0</div>
                  <div class="text-gray-500">차단</div>
                </div>
                <div class="bg-yellow-50 p-2 rounded">
                  <div class="font-bold text-lg text-yellow-600" id="rt-pending">0</div>
                  <div class="text-gray-500">대기 중</div>
                </div>
                <div class="bg-purple-50 p-2 rounded">
                  <div class="font-bold text-lg text-purple-600" id="rt-unreported">0</div>
                  <div class="text-gray-500">미신고</div>
                </div>
                <div class="bg-gray-100 p-2 rounded">
                  <div class="font-bold text-lg text-gray-600" id="rt-notfound">0</div>
                  <div class="text-gray-500">색인없음</div>
                </div>
                <div class="bg-red-50 p-2 rounded">
                  <div class="font-bold text-lg text-red-600" id="rt-rejected">0</div>
                  <div class="text-gray-500">거부</div>
                </div>
              </div>
            </div>
            
            <!-- HTML 업로드 -->
            <div class="border-t pt-4">
              <h4 class="font-semibold text-sm mb-2"><i class="fas fa-upload mr-1"></i>신고 결과 업로드</h4>
              <input type="text" id="report-id-input" placeholder="신고 ID (예: 12345)" class="w-full border rounded px-3 py-2 text-sm mb-2">
              <input type="file" id="html-file-input" accept=".html,.htm" class="hidden" onchange="handleHtmlUpload()">
              <button onclick="document.getElementById('html-file-input').click()" class="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm">
                <i class="fas fa-file-upload mr-1"></i>HTML 파일 선택
              </button>
              <p class="text-xs text-gray-400 mt-2">구글 신고 결과 페이지를 업로드하면 차단된 URL을 자동 매칭합니다.</p>
            </div>
            
            <!-- 업로드 이력 -->
            <div class="border-t pt-4 mt-4">
              <h4 class="font-semibold text-sm mb-2"><i class="fas fa-history mr-1"></i>업로드 이력</h4>
              <div id="upload-history" class="max-h-32 overflow-y-auto text-xs space-y-1">
                <div class="text-gray-400 text-center py-2">이력 없음</div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 우측: URL 테이블 -->
        <div class="flex-1">
          <div class="bg-white rounded-lg shadow-md p-4">
            <!-- 필터 및 내보내기 -->
            <div class="flex flex-wrap gap-2 mb-4 justify-between items-center">
              <div class="flex gap-2">
                <select id="report-status-filter" onchange="loadReportTracking()" class="border rounded px-3 py-1 text-sm">
                  <option value="">전체 상태</option>
                  <option value="미신고">미신고</option>
                  <option value="차단">차단</option>
                  <option value="대기 중">대기 중</option>
                  <option value="색인없음">색인없음</option>
                  <option value="거부">거부</option>
                </select>
                <input type="text" id="report-url-search" placeholder="URL 검색..." class="border rounded px-3 py-1 text-sm w-40" oninput="filterReportTable()">
              </div>
              <div class="flex gap-2">
                <button onclick="copyReportUrls()" class="text-sm text-blue-500 hover:text-blue-700">
                  <i class="fas fa-copy mr-1"></i>URL 복사
                </button>
                <button onclick="exportReportCsv()" class="text-sm text-green-500 hover:text-green-700">
                  <i class="fas fa-download mr-1"></i>CSV 내보내기
                </button>
              </div>
            </div>
            
            <!-- URL 테이블 -->
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-2 text-left">URL</th>
                    <th class="px-3 py-2 text-left w-28">도메인</th>
                    <th class="px-3 py-2 text-center w-24">상태</th>
                    <th class="px-3 py-2 text-left w-20">신고ID</th>
                    <th class="px-3 py-2 text-left w-36">사유</th>
                  </tr>
                </thead>
                <tbody id="report-tracking-table">
                  <tr><td colspan="5" class="text-center py-8 text-gray-400">회차를 선택하세요</td></tr>
                </tbody>
              </table>
            </div>
            
            <!-- 페이지네이션 -->
            <div id="report-pagination" class="flex justify-center gap-2 mt-4 hidden">
              <button onclick="loadReportTracking(currentReportPage - 1)" class="px-3 py-1 border rounded text-sm" id="rt-prev-btn">이전</button>
              <span id="rt-page-info" class="px-3 py-1 text-sm">1 / 1</span>
              <button onclick="loadReportTracking(currentReportPage + 1)" class="px-3 py-1 border rounded text-sm" id="rt-next-btn">다음</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 작품 변경 모달 -->
  <div id="titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[95vh] md:max-h-[85vh] overflow-hidden">
      <div class="bg-purple-500 text-white px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <h2 class="text-base md:text-xl font-bold"><i class="fas fa-list-alt mr-2"></i><span class="hidden sm:inline">모니터링 대상 </span>작품 관리</h2>
        <button onclick="closeTitlesModal()" class="text-white hover:text-gray-200 p-1">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(95vh-120px)] md:max-h-[calc(85vh-80px)]">
        <!-- 2분할 레이아웃 (모바일에서 1열) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-4">
          <!-- 현재 모니터링 대상 -->
          <div>
            <h3 class="font-bold mb-2 md:mb-3 text-purple-600 text-sm md:text-base">
              <i class="fas fa-play-circle mr-2"></i>현재 대상 (<span id="titles-count">0</span>개)
            </h3>
            <div id="current-titles-list" class="h-48 md:h-72 overflow-y-auto border rounded p-2 md:p-3 text-sm">로딩 중...</div>
          </div>
          <!-- 이전 모니터링 대상 -->
          <div>
            <h3 class="font-bold mb-2 md:mb-3 text-gray-500 text-sm md:text-base">
              <i class="fas fa-history mr-2"></i>이전 대상 (<span id="history-titles-count">0</span>개)
            </h3>
            <div id="history-titles-list" class="h-48 md:h-72 overflow-y-auto border rounded p-2 md:p-3 text-gray-500 text-sm">로딩 중...</div>
          </div>
        </div>
        <!-- 새 작품 추가 (하단) -->
        <div class="border-t pt-3 md:pt-4">
          <div class="flex gap-2">
            <input type="text" id="new-title-input" placeholder="새 작품명..." 
                   class="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                   onkeypress="if(event.key==='Enter') addNewTitle()">
            <button onclick="addNewTitle()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 md:px-6 py-2 rounded-lg text-sm">
              <i class="fas fa-plus"></i><span class="hidden sm:inline ml-2">추가</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 전체보기 모달 (작품별 월별 통계) -->
  <div id="all-titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[95vh] md:max-h-[85vh] overflow-hidden">
      <div class="bg-red-500 text-white px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <h2 class="text-base md:text-xl font-bold"><i class="fas fa-fire mr-2"></i><span class="hidden sm:inline">불법 URL 통계 - </span><span id="all-titles-month"></span></h2>
        <button onclick="closeAllTitlesModal()" class="text-white hover:text-gray-200 p-1">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(95vh-60px)] md:max-h-[calc(85vh-80px)]">
        <div id="all-titles-list" class="space-y-2">로딩 중...</div>
      </div>
    </div>
  </div>

  <script>
    let currentTab = 'dashboard';
    let currentSessionId = null;
    let currentPage = 1;
    
    async function fetchAPI(url, options = {}) {
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',  // 쿠키 포함
          headers: { 'Content-Type': 'application/json' },
          ...options,
        });
        if (response.status === 401) {
          window.location.href = '/login';
          return { success: false };
        }
        return await response.json();
      } catch (error) {
        console.error('API Error:', error);
        return { success: false, error: error.message };
      }
    }
    
    async function handleLogout() {
      if (confirm('로그아웃 하시겠습니까?')) {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }
    }
    
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.remove('tab-active'));
      document.getElementById('tab-' + tab).classList.add('tab-active');
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.getElementById('content-' + tab).classList.remove('hidden');
      
      if (tab === 'dashboard') loadDashboard();
      else if (tab === 'pending') loadPending();
      else if (tab === 'sessions') loadSessions();
      else if (tab === 'sites') loadSites();
      else if (tab === 'title-stats') loadTitleSelectList();
      else if (tab === 'report-tracking') loadReportTrackingSessions();
    }
    
    async function loadDashboard() {
      const monthsData = await fetchAPI('/api/dashboard/months');
      if (monthsData.success) {
        const select = document.getElementById('month-select');
        select.innerHTML = monthsData.months.map(m => 
          '<option value="' + m + '"' + (m === monthsData.current_month ? ' selected' : '') + '>' + m + '</option>'
        ).join('') || '<option value="">데이터 없음</option>';
      }
      
      const month = document.getElementById('month-select').value;
      const data = await fetchAPI('/api/dashboard' + (month ? '?month=' + month : ''));
      
      if (data.success) {
        document.getElementById('dash-total').textContent = data.total_stats?.total || 0;
        document.getElementById('dash-illegal').textContent = data.total_stats?.illegal || 0;
        document.getElementById('dash-legal').textContent = data.total_stats?.legal || 0;
        document.getElementById('dash-sessions').textContent = data.sessions_count || 0;
        
        const topContents = data.top_contents || [];
        document.getElementById('top-contents').innerHTML = topContents.length ? 
          topContents.slice(0,5).map((c, i) => '<div class="flex justify-between p-2 bg-gray-50 rounded"><span>' + (i+1) + '. ' + c.name + '</span><span class="text-red-600 font-bold">' + c.count + '개</span></div>').join('') :
          '<div class="text-gray-500">데이터 없음</div>';
          
        const topDomains = data.top_illegal_sites || [];
        document.getElementById('top-domains').innerHTML = topDomains.length ?
          topDomains.slice(0,5).map((d, i) => '<div class="flex justify-between p-2 bg-gray-50 rounded"><span>' + (i+1) + '. ' + d.domain + '</span><span class="text-red-600 font-bold">' + d.count + '개</span></div>').join('') :
          '<div class="text-gray-500">데이터 없음</div>';
      }
      
      // Manta 순위 로드
      loadMantaRankings();
    }
    
    async function openAllTitlesModal() {
      const month = document.getElementById('month-select').value;
      document.getElementById('all-titles-month').textContent = month || '현재 월';
      document.getElementById('all-titles-modal').classList.remove('hidden');
      document.getElementById('all-titles-list').innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';
      
      const data = await fetchAPI('/api/dashboard/all-titles' + (month ? '?month=' + month : ''));
      
      if (data.success && data.titles.length > 0) {
        document.getElementById('all-titles-list').innerHTML = 
          '<div class="grid grid-cols-12 gap-2 p-3 bg-gray-100 rounded font-bold text-sm mb-2">' +
            '<div class="col-span-1 text-center">#</div>' +
            '<div class="col-span-8">작품명</div>' +
            '<div class="col-span-3 text-right">불법 URL</div>' +
          '</div>' +
          data.titles.map((t, i) => 
            '<div class="grid grid-cols-12 gap-2 p-3 border-b hover:bg-gray-50">' +
              '<div class="col-span-1 text-center text-gray-500">' + (i+1) + '</div>' +
              '<div class="col-span-8">' + t.name + '</div>' +
              '<div class="col-span-3 text-right text-red-600 font-bold">' + t.count + '개</div>' +
            '</div>'
          ).join('');
      } else {
        document.getElementById('all-titles-list').innerHTML = '<div class="text-gray-500 text-center py-8">데이터가 없습니다.</div>';
      }
    }
    
    function closeAllTitlesModal() {
      document.getElementById('all-titles-modal').classList.add('hidden');
    }
    
    async function loadMantaRankings() {
      const data = await fetchAPI('/api/manta-rankings');
      if (data.success) {
        // 기준 시각 표시
        if (data.lastUpdated) {
          const d = new Date(data.lastUpdated);
          const dateStr = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\\. /g, '-').replace('.', '');
          const timeStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
          document.getElementById('manta-updated').textContent = dateStr + ' ' + timeStr + ' 기준';
        }
        
        // 순위 표시
        const rankings = data.rankings || [];
        document.getElementById('manta-rankings').innerHTML = rankings.length ?
          rankings.map(r => {
            const rankText = r.mantaRank ? 'P' + Math.ceil(r.mantaRank / 10) + '-' + r.mantaRank : '순위권 외';
            const isFirst = r.mantaRank === 1;
            const page1Count = r.page1IllegalCount || 0;
            const hasHighIllegal = page1Count >= 5;
            
            // 1페이지 불법 5개 이상이면 빨간 박스
            let bgColor, textColor;
            if (hasHighIllegal) {
              bgColor = 'bg-red-100 border-red-400 border-2';
              textColor = 'text-red-700';
            } else if (isFirst) {
              bgColor = 'bg-green-100 border-green-300';
              textColor = 'text-green-700';
            } else if (r.mantaRank) {
              bgColor = 'bg-blue-50 border-blue-200';
              textColor = 'text-blue-700';
            } else {
              bgColor = 'bg-gray-100 border-gray-300';
              textColor = 'text-gray-500';
            }
            
            // 1위 도메인 + 1페이지 불법 URL 수 표시
            let extraInfo = '';
            if (r.firstDomain || page1Count > 0) {
              const firstDomainText = r.firstDomain ? '1위: ' + r.firstDomain : '';
              const illegalCountText = '<span class="' + (hasHighIllegal ? 'text-red-600 font-bold' : 'text-gray-500') + '">' +
                '불법 ' + page1Count + '개/10</span>';
              extraInfo = '<div class="text-xs text-gray-400 truncate flex justify-between items-center gap-1">' +
                (firstDomainText ? '<span class="truncate" title="' + r.firstDomain + '">' + firstDomainText + '</span>' : '<span></span>') +
                illegalCountText +
              '</div>';
            }
            
            return '<div class="border rounded p-3 ' + bgColor + '">' +
              '<div class="text-sm font-medium truncate" title="' + r.title + '">' + r.title + '</div>' +
              '<div class="text-lg font-bold ' + textColor + '">' + rankText + '</div>' +
              extraInfo +
            '</div>';
          }).join('') :
          '<div class="text-gray-500 col-span-full text-center py-4">데이터 없음 (모니터링 실행 후 표시됩니다)</div>';
      }
    }
    
    // ============================================
    // 작품별 상세보기 기능
    // ============================================
    // 작품별 통계 - 차트 및 데이터 관리
    // ============================================
    let rankingChart = null;
    let allTitlesForStats = []; // 전체 작품 목록 저장
    
    async function loadTitleSelectList() {
      const data = await fetchAPI('/api/titles/list');
      const listEl = document.getElementById('title-stats-list');
      
      if (data.success && data.titles.length > 0) {
        allTitlesForStats = data.titles;
        renderTitleStatsList(data.titles);
      } else {
        listEl.innerHTML = '<div class="text-gray-400 text-sm p-4 text-center">모니터링 대상 작품이 없습니다.</div>';
      }
    }
    
    function renderTitleStatsList(titles) {
      const listEl = document.getElementById('title-stats-list');
      listEl.innerHTML = titles.map(title =>
        '<div onclick="selectTitleForStats(\\'' + title.replace(/'/g, "\\\\'") + '\\')" ' +
        'class="title-stats-item p-3 border-b border-gray-100 hover:bg-purple-50 cursor-pointer transition" ' +
        'data-title="' + title.replace(/"/g, '&quot;') + '">' +
        '<div class="font-medium text-gray-800 truncate">' + title + '</div>' +
        '</div>'
      ).join('');
    }
    
    function filterTitleList() {
      const query = document.getElementById('title-search-input').value.toLowerCase();
      const filtered = allTitlesForStats.filter(t => t.toLowerCase().includes(query));
      renderTitleStatsList(filtered);
    }
    
    async function selectTitleForStats(title) {
      // 선택 상태 표시
      document.querySelectorAll('.title-stats-item').forEach(item => {
        item.classList.remove('bg-purple-100', 'border-l-4', 'border-l-purple-500');
      });
      const selectedItem = document.querySelector('.title-stats-item[data-title="' + title.replace(/"/g, '&quot;') + '"]');
      if (selectedItem) {
        selectedItem.classList.add('bg-purple-100', 'border-l-4', 'border-l-purple-500');
      }
      
      // placeholder 숨기고 content 표시
      document.getElementById('title-stats-placeholder').classList.add('hidden');
      document.getElementById('title-stats-content').classList.remove('hidden');
      document.getElementById('selected-title-name').textContent = title;
      
      // 순위 히스토리 차트 로드
      await loadRankingHistoryChart(title);
    }
    
    async function loadRankingHistoryChart(title) {
      const canvas = document.getElementById('ranking-history-chart');
      const emptyMsg = document.getElementById('ranking-chart-empty');
      
      // 기존 차트 제거
      if (rankingChart) {
        rankingChart.destroy();
        rankingChart = null;
      }
      
      const data = await fetchAPI('/api/titles/' + encodeURIComponent(title) + '/ranking-history');
      if (!data.success || !data.history || data.history.length === 0) {
        canvas.style.display = 'none';
        emptyMsg.classList.remove('hidden');
        return;
      }
      
      canvas.style.display = 'block';
      emptyMsg.classList.add('hidden');
      
      const labels = data.history.map(h => {
        const d = new Date(h.recordedAt);
        return (d.getMonth() + 1) + '/' + d.getDate();
      });
      const values = data.history.map(h => h.rank || null);
      
      rankingChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Manta 순위',
            data: values,
            borderColor: 'rgba(59, 130, 246, 1)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: 'rgba(59, 130, 246, 1)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.raw ? context.raw + '위' : '순위권 외';
                }
              }
            }
          },
          scales: {
            y: {
              reverse: true,
              min: 1,
              max: 30,
              ticks: {
                stepSize: 5,
                callback: function(value) { return value + '위'; }
              }
            }
          }
        }
      });
    }
    
    async function loadPending() {
      const data = await fetchAPI('/api/pending');
      if (data.success) {
        document.getElementById('pending-badge').textContent = data.count;
        
        // 일괄 처리 버튼 표시/숨김
        const bulkActions = document.getElementById('bulk-actions');
        if (data.items.length === 0) {
          document.getElementById('pending-list').innerHTML = '<div class="text-gray-500 text-center py-8"><i class="fas fa-check-circle text-4xl mb-2"></i><br>승인 대기 항목이 없습니다.</div>';
          bulkActions.classList.add('hidden');
          return;
        }
        
        bulkActions.classList.remove('hidden');
        document.getElementById('pending-list').innerHTML = data.items.map(item => 
          '<div class="border rounded-lg p-4 mb-3 hover:shadow-md transition pending-item" data-id="' + item.id + '">' +
            '<div class="flex justify-between items-start gap-3">' +
              '<div class="flex items-start gap-3 flex-1 min-w-0">' +
                '<input type="checkbox" class="pending-checkbox w-5 h-5 mt-1 cursor-pointer flex-shrink-0" data-id="' + item.id + '" onchange="updateSelectAllState()">' +
                '<div class="min-w-0">' +
                  '<div class="flex flex-wrap items-center gap-2">' +
                    '<a href="https://' + item.domain + '" target="_blank" rel="noopener noreferrer" class="font-bold text-lg text-blue-600 hover:text-blue-800 hover:underline truncate">' + item.domain + ' <i class="fas fa-external-link-alt text-xs"></i></a>' +
                    '<span class="text-sm px-2 py-1 rounded flex-shrink-0 ' + 
                      (item.llm_judgment === 'likely_illegal' ? 'bg-red-100 text-red-700' : 
                       item.llm_judgment === 'likely_legal' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700') + '">' +
                      (item.llm_judgment || 'unknown') + '</span>' +
                  '</div>' +
                  '<div class="text-sm text-gray-600 mt-1">' + (item.llm_reason || 'API 키가 설정되지 않아 판별 불가') + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="flex gap-2 flex-shrink-0">' +
                '<button onclick="reviewItem(' + item.id + ', \\'approve\\')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-ban mr-1"></i>불법</button>' +
                '<button onclick="reviewItem(' + item.id + ', \\'reject\\')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-check mr-1"></i>합법</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        ).join('');
        
        // 전체 선택 체크박스 초기화
        document.getElementById('select-all-pending').checked = false;
      }
    }
    
    function toggleSelectAll() {
      const selectAll = document.getElementById('select-all-pending').checked;
      document.querySelectorAll('.pending-checkbox').forEach(cb => {
        cb.checked = selectAll;
      });
    }
    
    function updateSelectAllState() {
      const checkboxes = document.querySelectorAll('.pending-checkbox');
      const checkedCount = document.querySelectorAll('.pending-checkbox:checked').length;
      document.getElementById('select-all-pending').checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    }
    
    function getSelectedIds() {
      const checked = document.querySelectorAll('.pending-checkbox:checked');
      return Array.from(checked).map(cb => cb.dataset.id);
    }
    
    async function bulkReview(action) {
      const ids = getSelectedIds();
      if (ids.length === 0) {
        alert('선택된 항목이 없습니다.');
        return;
      }
      
      const actionText = action === 'approve' ? '불법 사이트로' : '합법 사이트로';
      if (!confirm(ids.length + '개 도메인을 ' + actionText + ' 일괄 등록하시겠습니까?')) return;
      
      const data = await fetchAPI('/api/review/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action })
      });
      
      if (data.success) {
        showToast(data.processed + '개 도메인이 처리되었습니다.');
        loadPending();
        loadDashboard();
        loadSessions();
      } else {
        alert('일괄 처리 실패: ' + (data.error || '알 수 없는 오류'));
      }
    }
    
    async function reviewItem(id, action) {
      const actionText = action === 'approve' ? '불법 사이트로' : '합법 사이트로';
      if (!confirm(actionText + ' 등록하시겠습니까?')) return;
      
      const data = await fetchAPI('/api/review', {
        method: 'POST',
        body: JSON.stringify({ id: String(id), action })
      });
      if (data.success) {
        loadPending();
        loadSites();
      }
    }
    
    let sessionsPage = 1;
    const SESSIONS_PER_PAGE = 5;
    let allSessions = [];
    
    async function loadSessions() {
      const data = await fetchAPI('/api/sessions');
      if (data.success) {
        allSessions = data.sessions;
        if (data.sessions.length === 0) {
          document.getElementById('sessions-list').innerHTML = '<div class="text-gray-500 text-center py-8"><i class="fas fa-folder-open text-4xl mb-2"></i><br>모니터링 기록이 없습니다.</div>';
          document.getElementById('sessions-pagination').innerHTML = '';
          return;
        }
        renderSessionsPage();
      }
    }
    
    function renderSessionsPage() {
      const totalPages = Math.ceil(allSessions.length / SESSIONS_PER_PAGE);
      const startIdx = (sessionsPage - 1) * SESSIONS_PER_PAGE;
      const pageSessions = allSessions.slice(startIdx, startIdx + SESSIONS_PER_PAGE);
      
      document.getElementById('sessions-list').innerHTML = pageSessions.map(s =>
        '<div class="border rounded-lg p-4 mb-3 cursor-pointer hover:shadow-md transition ' + 
          (currentSessionId === s.id ? 'bg-blue-50 border-blue-500' : 'hover:bg-gray-50') + '" onclick="openSessionDetail(\\'' + s.id + '\\')">' +
          '<div class="flex justify-between items-center">' +
            '<span class="font-bold text-lg"><i class="fas fa-calendar-alt mr-2 text-blue-500"></i>' + s.id + '</span>' +
            '<span class="text-sm text-gray-500">' + new Date(s.created_at).toLocaleString('ko-KR') + '</span>' +
          '</div>' +
          '<div class="flex gap-4 mt-3 text-sm flex-wrap">' +
            '<span class="bg-blue-100 text-blue-700 px-3 py-1 rounded">전체: ' + s.results_summary.total + '</span>' +
            '<span class="bg-red-100 text-red-700 px-3 py-1 rounded">불법: ' + s.results_summary.illegal + '</span>' +
            '<span class="bg-green-100 text-green-700 px-3 py-1 rounded">합법: ' + s.results_summary.legal + '</span>' +
            '<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded">대기: ' + s.results_summary.pending + '</span>' +
          '</div>' +
        '</div>'
      ).join('');
      
      // 페이지네이션 렌더링
      let paginationHtml = '';
      if (totalPages > 1) {
        if (sessionsPage > 1) paginationHtml += '<button onclick="goToSessionsPage(' + (sessionsPage-1) + ')" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded">이전</button>';
        paginationHtml += '<span class="px-3 py-1 text-gray-600">' + sessionsPage + ' / ' + totalPages + '</span>';
        if (sessionsPage < totalPages) paginationHtml += '<button onclick="goToSessionsPage(' + (sessionsPage+1) + ')" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded">다음</button>';
      }
      document.getElementById('sessions-pagination').innerHTML = paginationHtml;
    }
    
    function goToSessionsPage(page) {
      sessionsPage = page;
      renderSessionsPage();
    }
    
    async function openSessionDetail(id) {
      currentSessionId = id;
      currentPage = 1;
      
      // 목록에서 선택된 항목 하이라이트
      renderSessionsPage();
      
      // 상세 영역 표시
      document.getElementById('session-detail-title').textContent = id;
      document.getElementById('session-detail').classList.remove('hidden');
      
      // 필터 초기화
      const titleSelect = document.getElementById('session-title-filter');
      titleSelect.innerHTML = '<option value="all">모든 작품</option>';
      document.getElementById('session-status-filter').value = 'all';
      
      await loadSessionResults();
      
      // 상세 영역으로 스크롤
      document.getElementById('session-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    function closeSessionDetail() {
      document.getElementById('session-detail').classList.add('hidden');
      currentSessionId = null;
      renderSessionsPage();
    }
    
    async function loadSessionResults() {
      if (!currentSessionId) return;
      
      const titleFilter = document.getElementById('session-title-filter').value;
      const statusFilter = document.getElementById('session-status-filter').value;
      
      const params = new URLSearchParams({
        page: currentPage,
        limit: 50,
        title: titleFilter,
        status: statusFilter
      });
      
      const data = await fetchAPI('/api/sessions/' + currentSessionId + '/results?' + params);
      
      if (data.success) {
        // 타이틀 필터 업데이트
        const titleSelect = document.getElementById('session-title-filter');
        if (titleSelect.options.length <= 1) {
          data.available_titles.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            titleSelect.appendChild(opt);
          });
        }
        
        // 통계 바 업데이트 (전체 결과 기준)
        const statsData = await fetchAPI('/api/sessions/' + currentSessionId + '/results?limit=10000');
        if (statsData.success) {
          const allResults = statsData.results;
          const total = allResults.length;
          const illegal = allResults.filter(r => r.final_status === 'illegal').length;
          const legal = allResults.filter(r => r.final_status === 'legal').length;
          const pending = allResults.filter(r => r.final_status === 'pending').length;
          
          document.getElementById('session-stats-bar').innerHTML = 
            '<div class="bg-blue-100 text-blue-700 py-2 rounded"><div class="text-xl font-bold">' + total + '</div><div class="text-xs">전체</div></div>' +
            '<div class="bg-red-100 text-red-700 py-2 rounded"><div class="text-xl font-bold">' + illegal + '</div><div class="text-xs">불법</div></div>' +
            '<div class="bg-green-100 text-green-700 py-2 rounded"><div class="text-xl font-bold">' + legal + '</div><div class="text-xs">합법</div></div>' +
            '<div class="bg-yellow-100 text-yellow-700 py-2 rounded"><div class="text-xl font-bold">' + pending + '</div><div class="text-xs">대기</div></div>';
        }
        
        // 결과 표시 (테이블 + 카드 형식)
        if (data.results.length === 0) {
          document.getElementById('session-results-desktop').innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">결과가 없습니다.</td></tr>';
          document.getElementById('session-results-mobile').innerHTML = '<div class="text-center py-8 text-gray-500">결과가 없습니다.</div>';
        } else {
          const startIdx = (data.pagination.page - 1) * data.pagination.limit;
          // 데스크톱 테이블
          document.getElementById('session-results-desktop').innerHTML = data.results.map((r, idx) => {
            const statusClass = r.final_status === 'illegal' ? 'bg-red-500 text-white' : 
                               r.final_status === 'legal' ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white';
            const llmClass = r.llm_judgment === 'likely_illegal' ? 'text-red-600' : 
                            r.llm_judgment === 'likely_legal' ? 'text-green-600' : 'text-gray-500';
            const rowBg = r.final_status === 'illegal' ? 'bg-red-50' : 
                         r.final_status === 'legal' ? 'bg-green-50' : 'bg-yellow-50';
            
            return '<tr class="' + rowBg + ' hover:bg-opacity-75">' +
              '<td class="border px-3 py-2 text-center text-gray-500">' + (startIdx + idx + 1) + '</td>' +
              '<td class="border px-3 py-2">' + r.title + '</td>' +
              '<td class="border px-3 py-2">' +
                '<div class="flex items-center gap-1">' +
                  '<a href="' + r.url + '" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 truncate max-w-md block" title="' + r.url + '">' + r.url + '</a>' +
                  '<button onclick="copyUrl(\\'' + r.url.replace(/'/g, "\\\\'") + '\\')" class="text-gray-400 hover:text-gray-600 flex-shrink-0" title="URL 복사"><i class="fas fa-copy"></i></button>' +
                '</div>' +
              '</td>' +
              '<td class="border px-3 py-2 text-center"><span class="px-2 py-1 rounded text-xs ' + statusClass + '">' + r.final_status + '</span></td>' +
              '<td class="border px-3 py-2 text-center ' + llmClass + '">' + (r.llm_judgment || '-') + '</td>' +
              '<td class="border px-3 py-2 text-center text-xs text-gray-500">' + (r.reviewed_at ? new Date(r.reviewed_at).toLocaleString('ko-KR') : '-') + '</td>' +
            '</tr>';
          }).join('');
          // 모바일 카드
          document.getElementById('session-results-mobile').innerHTML = data.results.map((r, idx) => {
            const statusClass = r.final_status === 'illegal' ? 'bg-red-500' : 
                               r.final_status === 'legal' ? 'bg-green-500' : 'bg-yellow-500';
            const cardBg = r.final_status === 'illegal' ? 'border-l-red-500' : 
                          r.final_status === 'legal' ? 'border-l-green-500' : 'border-l-yellow-500';
            return '<div class="bg-white border border-l-4 ' + cardBg + ' rounded p-3 shadow-sm">' +
              '<div class="flex justify-between items-start mb-1">' +
                '<span class="text-xs text-gray-500">#' + (startIdx + idx + 1) + '</span>' +
                '<span class="px-2 py-0.5 rounded text-xs text-white ' + statusClass + '">' + r.final_status + '</span>' +
              '</div>' +
              '<div class="font-medium text-sm mb-1 truncate">' + r.title + '</div>' +
              '<div class="flex items-center gap-1">' +
                '<a href="' + r.url + '" target="_blank" rel="noopener noreferrer" class="text-blue-500 text-xs truncate flex-1" title="' + r.url + '">' + r.url + '</a>' +
                '<button onclick="copyUrl(\\'' + r.url.replace(/'/g, "\\\\'") + '\\')" class="text-gray-400 p-1"><i class="fas fa-copy"></i></button>' +
              '</div>' +
            '</div>';
          }).join('');
        }
        
        // 페이지네이션
        const { page, totalPages } = data.pagination;
        let paginationHtml = '';
        if (totalPages > 1) {
          if (page > 1) paginationHtml += '<button onclick="goToPage(' + (page-1) + ')" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded">이전</button>';
          paginationHtml += '<span class="px-3 py-1">' + page + ' / ' + totalPages + '</span>';
          if (page < totalPages) paginationHtml += '<button onclick="goToPage(' + (page+1) + ')" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded">다음</button>';
        }
        document.getElementById('session-results-pagination').innerHTML = paginationHtml;
      }
    }
    
    function goToPage(page) {
      currentPage = page;
      loadSessionResults();
    }
    
    function downloadSessionReport() {
      if (currentSessionId) {
        window.open('/api/sessions/' + currentSessionId + '/download', '_blank');
      }
    }
    
    async function copyAllIllegalUrls() {
      if (!currentSessionId) return;
      
      // 현재 필터 상태 가져오기
      const titleFilter = document.getElementById('session-title-filter').value;
      
      // 불법 URL만 가져오기 (status=illegal 고정)
      let url = '/api/sessions/' + currentSessionId + '/results?status=illegal&limit=10000';
      if (titleFilter !== 'all') {
        url += '&title=' + encodeURIComponent(titleFilter);
      }
      
      const data = await fetchAPI(url);
      
      if (data.success && data.results.length > 0) {
        const urls = data.results.map(r => r.url).join('\\n');
        navigator.clipboard.writeText(urls).then(() => {
          const toast = document.createElement('div');
          toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded shadow-lg z-50';
          toast.innerHTML = '<i class="fas fa-check mr-2"></i>불법 URL ' + data.results.length + '개가 복사되었습니다';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
        }).catch(err => {
          console.error('복사 실패:', err);
          alert('복사에 실패했습니다.');
        });
      } else {
        alert('복사할 불법 URL이 없습니다.');
      }
    }
    
    function copyUrl(url) {
      navigator.clipboard.writeText(url).then(() => {
        // 성공 시 간단한 피드백
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded shadow-lg z-50';
        toast.innerHTML = '<i class="fas fa-check mr-2"></i>URL이 복사되었습니다';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      }).catch(err => {
        console.error('URL 복사 실패:', err);
        alert('URL 복사에 실패했습니다.');
      });
    }
    
    async function loadSites() {
      const illegalData = await fetchAPI('/api/sites/illegal');
      const legalData = await fetchAPI('/api/sites/legal');
      
      if (illegalData.success) {
        document.getElementById('illegal-count').textContent = illegalData.count;
        document.getElementById('illegal-sites-list').innerHTML = illegalData.sites.map(s =>
          '<div class="flex justify-between items-center py-1 border-b text-sm group">' +
            '<span>' + s + '</span>' +
            '<button onclick="removeSiteItem(\\'' + s + '\\', \\'illegal\\')" class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><i class="fas fa-times"></i></button>' +
          '</div>'
        ).join('') || '<div class="text-gray-500">목록 없음</div>';
      }
      
      if (legalData.success) {
        document.getElementById('legal-count').textContent = legalData.count;
        document.getElementById('legal-sites-list').innerHTML = legalData.sites.map(s =>
          '<div class="flex justify-between items-center py-1 border-b text-sm group">' +
            '<span>' + s + '</span>' +
            '<button onclick="removeSiteItem(\\'' + s + '\\', \\'legal\\')" class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"><i class="fas fa-times"></i></button>' +
          '</div>'
        ).join('') || '<div class="text-gray-500">목록 없음</div>';
      }
    }
    
    async function addNewSite(type) {
      const inputId = type === 'illegal' ? 'new-illegal-site' : 'new-legal-site';
      const input = document.getElementById(inputId);
      const domain = input.value.trim().toLowerCase();
      if (!domain) return;
      
      const res = await fetchAPI('/api/sites/' + type, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      
      if (res.success) {
        input.value = '';
        loadSites();
      } else {
        alert(res.error || '추가 실패');
      }
    }
    
    async function removeSiteItem(domain, type) {
      if (!confirm(domain + ' 사이트를 ' + (type === 'illegal' ? '불법' : '합법') + ' 목록에서 삭제하시겠습니까?')) return;
      
      const res = await fetchAPI('/api/sites/' + type + '/' + encodeURIComponent(domain), {
        method: 'DELETE'
      });
      
      if (res.success) {
        loadSites();
      } else {
        alert(res.error || '삭제 실패');
      }
    }
    
    function openTitlesModal() {
      document.getElementById('titles-modal').classList.remove('hidden');
      loadTitles();
    }
    
    function closeTitlesModal() {
      document.getElementById('titles-modal').classList.add('hidden');
    }
    
    async function loadTitles() {
      const data = await fetchAPI('/api/titles');
      if (data.success) {
        document.getElementById('titles-count').textContent = data.current.length;
        document.getElementById('history-titles-count').textContent = data.history.length;
        
        document.getElementById('current-titles-list').innerHTML = data.current.map(t =>
          '<div class="flex justify-between items-center py-2 border-b hover:bg-purple-50">' +
            '<span class="truncate">' + t + '</span>' +
            '<button onclick="removeTitle(\\'' + t.replace(/'/g, "\\\\'") + '\\')" class="text-red-500 hover:text-red-700 ml-2 flex-shrink-0"><i class="fas fa-times"></i></button>' +
          '</div>'
        ).join('') || '<div class="text-gray-500 text-center py-4">목록 없음</div>';
        
        document.getElementById('history-titles-list').innerHTML = data.history.map(t =>
          '<div class="flex justify-between items-center py-2 border-b hover:bg-gray-100">' +
            '<span class="truncate">' + t + '</span>' +
            '<button onclick="restoreTitle(\\'' + t.replace(/'/g, "\\\\'") + '\\')" class="text-blue-500 hover:text-blue-700 ml-2 flex-shrink-0" title="복구"><i class="fas fa-undo"></i></button>' +
          '</div>'
        ).join('') || '<div class="text-gray-400 text-center py-4">없음</div>';
      }
    }
    
    async function addNewTitle() {
      const input = document.getElementById('new-title-input');
      const title = input.value.trim();
      if (!title) return;
      
      await fetchAPI('/api/titles', {
        method: 'POST',
        body: JSON.stringify({ title })
      });
      input.value = '';
      loadTitles();
    }
    
    async function removeTitle(title) {
      if (!confirm('작품을 목록에서 제거하시겠습니까?')) return;
      await fetchAPI('/api/titles/' + encodeURIComponent(title), { method: 'DELETE' });
      loadTitles();
    }
    
    async function restoreTitle(title) {
      await fetchAPI('/api/titles/restore', {
        method: 'POST',
        body: JSON.stringify({ title })
      });
      loadTitles();
    }
    
    // ============================================
    // 신고결과 추적 함수들
    // ============================================
    
    let currentReportPage = 1;
    let currentReportSessionId = null;
    let reportTrackingData = [];
    let reasonsList = [];
    
    async function loadReportTrackingSessions() {
      const data = await fetchAPI('/api/report-tracking/sessions');
      const select = document.getElementById('report-session-select');
      
      if (data.success && data.sessions.length > 0) {
        select.innerHTML = '<option value="">회차 선택...</option>' +
          data.sessions.map(s => {
            const date = new Date(s.created_at).toLocaleDateString('ko-KR');
            const stats = s.tracking_stats;
            return '<option value="' + s.id + '">' + date + ' (' + stats.total + '개)</option>';
          }).join('');
          
        // 이전 선택 복구
        if (currentReportSessionId) {
          select.value = currentReportSessionId;
          loadReportTracking();
        }
      } else {
        select.innerHTML = '<option value="">데이터 없음</option>';
      }
      
      // 사유 목록 로드
      loadReasons();
    }
    
    async function loadReasons() {
      const data = await fetchAPI('/api/report-tracking/reasons');
      if (data.success) {
        reasonsList = data.reasons;
      }
    }
    
    async function loadReportTracking(page = 1) {
      const sessionId = document.getElementById('report-session-select').value;
      if (!sessionId) {
        document.getElementById('report-tracking-table').innerHTML = 
          '<tr><td colspan="5" class="text-center py-8 text-gray-400">회차를 선택하세요</td></tr>';
        return;
      }
      
      currentReportSessionId = sessionId;
      currentReportPage = page;
      
      const status = document.getElementById('report-status-filter').value;
      const url = '/api/report-tracking/' + sessionId + '?page=' + page + '&limit=50' + (status ? '&status=' + encodeURIComponent(status) : '');
      
      const data = await fetchAPI(url);
      
      if (data.success) {
        reportTrackingData = data.items;
        renderReportTable();
        
        // 페이지네이션
        const pagination = data.pagination;
        document.getElementById('report-pagination').classList.toggle('hidden', pagination.totalPages <= 1);
        document.getElementById('rt-page-info').textContent = pagination.page + ' / ' + pagination.totalPages;
        document.getElementById('rt-prev-btn').disabled = pagination.page <= 1;
        document.getElementById('rt-next-btn').disabled = pagination.page >= pagination.totalPages;
      }
      
      // 통계 로드
      loadReportStats(sessionId);
      
      // 업로드 이력 로드
      loadUploadHistory(sessionId);
    }
    
    async function loadReportStats(sessionId) {
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/stats');
      if (data.success) {
        const stats = data.stats;
        document.getElementById('rt-total').textContent = stats.total || 0;
        document.getElementById('rt-blocked').textContent = stats['차단'] || 0;
        document.getElementById('rt-pending').textContent = stats['대기 중'] || 0;
        document.getElementById('rt-unreported').textContent = stats['미신고'] || 0;
        document.getElementById('rt-notfound').textContent = stats['색인없음'] || 0;
        document.getElementById('rt-rejected').textContent = stats['거부'] || 0;
      }
    }
    
    async function loadUploadHistory(sessionId) {
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/uploads');
      const container = document.getElementById('upload-history');
      
      if (data.success && data.uploads.length > 0) {
        container.innerHTML = data.uploads.map(u => {
          const date = new Date(u.uploaded_at).toLocaleDateString('ko-KR');
          return '<div class="p-2 bg-gray-50 rounded">' +
            '<div class="font-semibold">#' + u.report_id + '</div>' +
            '<div class="text-gray-500">' + date + ' · 매칭: ' + u.matched_count + '/' + u.total_urls_in_html + '</div>' +
          '</div>';
        }).join('');
      } else {
        container.innerHTML = '<div class="text-gray-400 text-center py-2">이력 없음</div>';
      }
    }
    
    function renderReportTable() {
      const tbody = document.getElementById('report-tracking-table');
      const searchTerm = (document.getElementById('report-url-search').value || '').toLowerCase();
      
      let filtered = reportTrackingData;
      if (searchTerm) {
        filtered = filtered.filter(item => 
          item.url.toLowerCase().includes(searchTerm) || 
          item.domain.toLowerCase().includes(searchTerm)
        );
      }
      
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">데이터 없음</td></tr>';
        return;
      }
      
      tbody.innerHTML = filtered.map(item => {
        const statusColors = {
          '차단': 'bg-green-100 text-green-800',
          '대기 중': 'bg-yellow-100 text-yellow-800',
          '색인없음': 'bg-gray-100 text-gray-800',
          '거부': 'bg-red-100 text-red-800',
          '미신고': 'bg-purple-100 text-purple-800'
        };
        const statusClass = statusColors[item.report_status] || 'bg-gray-100';
        
        return '<tr class="border-b hover:bg-gray-50" data-id="' + item.id + '">' +
          '<td class="px-3 py-2"><a href="' + item.url + '" target="_blank" class="text-blue-600 hover:underline truncate block max-w-xs" title="' + item.url + '">' + truncateUrl(item.url) + '</a></td>' +
          '<td class="px-3 py-2 text-gray-600">' + item.domain + '</td>' +
          '<td class="px-3 py-2 text-center">' +
            '<select onchange="updateReportStatus(' + item.id + ', this.value)" class="text-xs px-2 py-1 rounded border ' + statusClass + '">' +
              '<option value="미신고"' + (item.report_status === '미신고' ? ' selected' : '') + '>미신고</option>' +
              '<option value="차단"' + (item.report_status === '차단' ? ' selected' : '') + '>차단</option>' +
              '<option value="대기 중"' + (item.report_status === '대기 중' ? ' selected' : '') + '>대기 중</option>' +
              '<option value="색인없음"' + (item.report_status === '색인없음' ? ' selected' : '') + '>색인없음</option>' +
              '<option value="거부"' + (item.report_status === '거부' ? ' selected' : '') + '>거부</option>' +
            '</select>' +
          '</td>' +
          '<td class="px-3 py-2 text-gray-500 text-xs">' + (item.report_id || '-') + '</td>' +
          '<td class="px-3 py-2">' + renderReasonSelect(item) + '</td>' +
        '</tr>';
      }).join('');
    }
    
    function truncateUrl(url) {
      if (url.length > 50) {
        return url.substring(0, 47) + '...';
      }
      return url;
    }
    
    function renderReasonSelect(item) {
      const needsReason = ['미신고', '거부'].includes(item.report_status);
      if (!needsReason) return '<span class="text-gray-400 text-xs">-</span>';
      
      const options = reasonsList.map(r => 
        '<option value="' + r.text + '"' + (item.reason === r.text ? ' selected' : '') + '>' + r.text + '</option>'
      ).join('');
      
      return '<select onchange="updateReportReason(' + item.id + ', this.value)" class="text-xs px-2 py-1 rounded border w-full">' +
        '<option value="">사유 선택...</option>' +
        options +
        '<option value="__custom__">+ 직접 입력</option>' +
      '</select>';
    }
    
    async function updateReportStatus(id, status) {
      const reportId = document.getElementById('report-id-input').value || null;
      const data = await fetchAPI('/api/report-tracking/' + id + '/status', {
        method: 'PUT',
        body: JSON.stringify({ status, report_id: reportId })
      });
      
      if (data.success) {
        // 테이블에서 해당 항목 업데이트
        const item = reportTrackingData.find(i => i.id === id);
        if (item) {
          item.report_status = status;
          if (reportId) item.report_id = reportId;
        }
        renderReportTable();
        loadReportStats(currentReportSessionId);
      } else {
        alert('상태 변경 실패: ' + (data.error || '알 수 없는 오류'));
      }
    }
    
    async function updateReportReason(id, reason) {
      if (reason === '__custom__') {
        const customReason = prompt('사유를 입력하세요:');
        if (!customReason) {
          loadReportTracking(currentReportPage);
          return;
        }
        reason = customReason;
      }
      
      const data = await fetchAPI('/api/report-tracking/' + id + '/reason', {
        method: 'PUT',
        body: JSON.stringify({ reason })
      });
      
      if (data.success) {
        const item = reportTrackingData.find(i => i.id === id);
        if (item) item.reason = reason;
        
        // 새 사유가 추가되었을 수 있으므로 목록 다시 로드
        await loadReasons();
        renderReportTable();
      } else {
        alert('사유 변경 실패: ' + (data.error || '알 수 없는 오류'));
      }
    }
    
    function filterReportTable() {
      renderReportTable();
    }
    
    async function handleHtmlUpload() {
      const fileInput = document.getElementById('html-file-input');
      const reportId = document.getElementById('report-id-input').value;
      const sessionId = currentReportSessionId;
      
      if (!fileInput.files.length) return;
      if (!sessionId) {
        alert('먼저 회차를 선택해주세요.');
        return;
      }
      if (!reportId) {
        alert('신고 ID를 입력해주세요.');
        return;
      }
      
      const file = fileInput.files[0];
      const reader = new FileReader();
      
      reader.onload = async function(e) {
        const htmlContent = e.target.result;
        
        // 로딩 표시
        const uploadBtn = document.querySelector('[onclick*="html-file-input"]');
        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>처리 중...';
        uploadBtn.disabled = true;
        
        try {
          const data = await fetchAPI('/api/report-tracking/' + sessionId + '/upload', {
            method: 'POST',
            body: JSON.stringify({
              html_content: htmlContent,
              report_id: reportId,
              file_name: file.name
            })
          });
          
          if (data.success) {
            alert('업로드 완료!\\n\\n추출된 URL: ' + data.extracted_urls + '개\\n매칭된 URL: ' + data.matched_urls + '개');
            loadReportTracking(currentReportPage);
          } else {
            alert('업로드 실패: ' + (data.error || '알 수 없는 오류'));
          }
        } catch (error) {
          alert('업로드 오류: ' + error.message);
        } finally {
          uploadBtn.innerHTML = originalText;
          uploadBtn.disabled = false;
          fileInput.value = '';
        }
      };
      
      reader.readAsText(file);
    }
    
    async function copyReportUrls() {
      const status = document.getElementById('report-status-filter').value;
      const sessionId = currentReportSessionId;
      
      if (!sessionId) {
        alert('회차를 선택해주세요.');
        return;
      }
      
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/urls' + (status ? '?status=' + encodeURIComponent(status) : ''));
      
      if (data.success && data.urls.length > 0) {
        const text = data.urls.join('\\n');
        await navigator.clipboard.writeText(text);
        alert(data.count + '개 URL이 복사되었습니다.' + (status ? ' (필터: ' + status + ')' : ''));
      } else {
        alert('복사할 URL이 없습니다.');
      }
    }
    
    function exportReportCsv() {
      const sessionId = currentReportSessionId;
      if (!sessionId) {
        alert('회차를 선택해주세요.');
        return;
      }
      window.open('/api/report-tracking/' + sessionId + '/export', '_blank');
    }
    
    // 초기 로드
    loadDashboard();
    loadPending();
    loadSessions();
  </script>
</body>
</html>
  `)
})

export default app
