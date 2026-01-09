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
      await deletePendingReview(parseInt(id))
    } else if (action === 'reject') {
      await addSite(item.domain, 'legal')
      await deletePendingReview(parseInt(id))
    }
    
    return c.json({ success: true, action })
  } catch {
    return c.json({ success: false, error: 'Failed to process review' }, 500)
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
    const rankings = await query`
      SELECT title, manta_rank, first_rank_domain, search_query, session_id, updated_at 
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
        sessionId: r.session_id
      })),
      lastUpdated
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load manta rankings' }, 500)
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
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <svg width="70" height="28" viewBox="0 0 70 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <text x="0" y="23" font-family="Arial Black, sans-serif" font-size="26" font-weight="900" fill="#1E9EF4">RIDI</text>
          </svg>
          <div>
            <h1 class="text-2xl font-bold text-gray-800">Jobdori</h1>
            <p class="text-gray-600 text-sm">리디 저작권 침해 모니터링 시스템</p>
          </div>
        </div>
        <div class="flex gap-3">
          <button onclick="openTitlesModal()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg transition">
            <i class="fas fa-list-alt mr-2"></i>작품 변경
          </button>
          <button onclick="handleLogout()" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition">
            <i class="fas fa-sign-out-alt mr-2"></i>로그아웃
          </button>
        </div>
      </div>
    </div>

    <!-- 탭 메뉴 -->
    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="flex border-b">
        <button id="tab-dashboard" onclick="switchTab('dashboard')" class="px-6 py-4 text-gray-600 hover:text-blue-600 tab-active">
          <i class="fas fa-chart-line mr-2"></i>대시보드
        </button>
        <button id="tab-pending" onclick="switchTab('pending')" class="px-6 py-4 text-gray-600 hover:text-blue-600">
          <i class="fas fa-clock mr-2"></i>승인 대기
          <span id="pending-badge" class="ml-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">0</span>
        </button>
        <button id="tab-sessions" onclick="switchTab('sessions')" class="px-6 py-4 text-gray-600 hover:text-blue-600">
          <i class="fas fa-history mr-2"></i>모니터링 회차
          <span id="sessions-badge" class="ml-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">0</span>
        </button>
        <button id="tab-sites" onclick="switchTab('sites')" class="px-6 py-4 text-gray-600 hover:text-blue-600">
          <i class="fas fa-globe mr-2"></i>사이트 목록
        </button>
      </div>
    </div>

    <!-- 대시보드 탭 -->
    <div id="content-dashboard" class="tab-content">
      <div class="bg-white rounded-lg shadow-md p-6">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold">월간 모니터링 현황</h2>
          <select id="month-select" onchange="loadDashboard()" class="border rounded-lg px-3 py-2">
            <option value="">로딩 중...</option>
          </select>
        </div>
        <div class="grid grid-cols-4 gap-4 mb-6">
          <div class="bg-blue-50 p-4 rounded-lg text-center">
            <div class="text-3xl font-bold text-blue-600" id="dash-total">0</div>
            <div class="text-gray-600">전체 URL</div>
          </div>
          <div class="bg-red-50 p-4 rounded-lg text-center">
            <div class="text-3xl font-bold text-red-600" id="dash-illegal">0</div>
            <div class="text-gray-600">불법 URL</div>
          </div>
          <div class="bg-green-50 p-4 rounded-lg text-center">
            <div class="text-3xl font-bold text-green-600" id="dash-legal">0</div>
            <div class="text-gray-600">합법 URL</div>
          </div>
          <div class="bg-purple-50 p-4 rounded-lg text-center">
            <div class="text-3xl font-bold text-purple-600" id="dash-sessions">0</div>
            <div class="text-gray-600">모니터링 횟수</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-6">
          <div>
            <div class="flex justify-between items-center mb-3">
              <h3 class="font-bold"><i class="fas fa-fire text-red-500 mr-2"></i>불법 URL 많은 작품 Top 5</h3>
              <button onclick="openAllTitlesModal()" class="text-sm text-blue-500 hover:text-blue-700">전체보기 <i class="fas fa-arrow-right"></i></button>
            </div>
            <div id="top-contents" class="space-y-2">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold mb-3"><i class="fas fa-skull-crossbones text-red-500 mr-2"></i>상위 불법 도메인 Top 5</h3>
            <div id="top-domains" class="space-y-2">로딩 중...</div>
          </div>
        </div>
      </div>
      
      <!-- Manta 검색 순위 -->
      <div class="bg-white rounded-lg shadow-md p-6 mt-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold"><i class="fas fa-chart-line text-blue-500 mr-2"></i>Manta 검색 순위</h2>
          <span id="manta-updated" class="text-sm text-gray-500"></span>
        </div>
        <p class="text-sm text-gray-500 mb-4">작품명만 검색 시 manta.net 순위 (P1-1 = 페이지1, 1위)</p>
        <div id="manta-rankings" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">로딩 중...</div>
      </div>
    </div>

    <!-- 승인 대기 탭 -->
    <div id="content-pending" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4"><i class="fas fa-clock text-yellow-500 mr-2"></i>승인 대기 목록</h2>
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
      <div id="session-detail" class="hidden bg-white rounded-lg shadow-md p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-bold">
            <i class="fas fa-table text-blue-500 mr-2"></i>
            세션 상세 결과: <span id="session-detail-title"></span>
          </h3>
          <div class="flex gap-2">
            <button onclick="copyAllIllegalUrls()" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm">
              <i class="fas fa-copy mr-1"></i>불법 URL 복사
            </button>
            <button onclick="downloadSessionReport()" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm">
              <i class="fas fa-download mr-1"></i>엑셀 다운로드
            </button>
            <button onclick="closeSessionDetail()" class="text-gray-500 hover:text-gray-700 px-2">
              <i class="fas fa-times text-xl"></i> 닫기
            </button>
          </div>
        </div>
        
        <!-- 통계 요약 바 -->
        <div id="session-stats-bar" class="grid grid-cols-4 gap-2 mb-4 text-center text-sm"></div>
        
        <!-- 필터 -->
        <div class="flex gap-4 mb-4 items-center flex-wrap">
          <select id="session-title-filter" class="border rounded px-3 py-2 text-sm" onchange="loadSessionResults()">
            <option value="all">모든 작품</option>
          </select>
          <select id="session-status-filter" class="border rounded px-3 py-2 text-sm" onchange="loadSessionResults()">
            <option value="all">모든 상태</option>
            <option value="illegal">불법</option>
            <option value="legal">합법</option>
            <option value="pending">대기</option>
          </select>
        </div>
        
        <!-- 테이블 -->
        <div class="overflow-x-auto">
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
            <tbody id="session-results">
              <tr><td colspan="6" class="text-center py-4 text-gray-500">로딩 중...</td></tr>
            </tbody>
          </table>
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
  </div>

  <!-- 작품 변경 모달 -->
  <div id="titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden">
      <div class="bg-purple-500 text-white px-6 py-4 flex justify-between items-center">
        <h2 class="text-xl font-bold"><i class="fas fa-list-alt mr-2"></i>모니터링 대상 작품 관리</h2>
        <button onclick="closeTitlesModal()" class="text-white hover:text-gray-200">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-6">
        <!-- 2분할 레이아웃 -->
        <div class="grid grid-cols-2 gap-6 mb-4">
          <!-- 현재 모니터링 대상 -->
          <div>
            <h3 class="font-bold mb-3 text-purple-600">
              <i class="fas fa-play-circle mr-2"></i>현재 모니터링 대상 (<span id="titles-count">0</span>개)
            </h3>
            <div id="current-titles-list" class="h-72 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
          <!-- 이전 모니터링 대상 -->
          <div>
            <h3 class="font-bold mb-3 text-gray-500">
              <i class="fas fa-history mr-2"></i>이전 모니터링 대상 (<span id="history-titles-count">0</span>개)
            </h3>
            <div id="history-titles-list" class="h-72 overflow-y-auto border rounded p-3 text-gray-500">로딩 중...</div>
          </div>
        </div>
        <!-- 새 작품 추가 (하단) -->
        <div class="border-t pt-4">
          <div class="flex gap-2">
            <input type="text" id="new-title-input" placeholder="새 작품명 입력..." 
                   class="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                   onkeypress="if(event.key==='Enter') addNewTitle()">
            <button onclick="addNewTitle()" class="bg-purple-500 hover:bg-purple-600 text-white px-6 py-2 rounded-lg">
              <i class="fas fa-plus mr-2"></i>추가
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 전체보기 모달 (작품별 월별 통계) -->
  <div id="all-titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
      <div class="bg-red-500 text-white px-6 py-4 flex justify-between items-center">
        <h2 class="text-xl font-bold"><i class="fas fa-fire mr-2"></i>작품별 불법 URL 통계 - <span id="all-titles-month"></span></h2>
        <button onclick="closeAllTitlesModal()" class="text-white hover:text-gray-200">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-6 overflow-y-auto max-h-[calc(85vh-80px)]">
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
            const bgColor = isFirst ? 'bg-green-100 border-green-300' : (r.mantaRank ? 'bg-blue-50 border-blue-200' : 'bg-gray-100 border-gray-300');
            const textColor = isFirst ? 'text-green-700' : (r.mantaRank ? 'text-blue-700' : 'text-gray-500');
            
            let extraInfo = '';
            if (!isFirst && r.mantaRank && r.firstDomain) {
              extraInfo = '<div class="text-xs text-gray-400 truncate" title="1위: ' + r.firstDomain + '">1위: ' + r.firstDomain + '</div>';
            } else if (!r.mantaRank && r.firstDomain) {
              extraInfo = '<div class="text-xs text-gray-400 truncate" title="1위: ' + r.firstDomain + '">1위: ' + r.firstDomain + '</div>';
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
    
    async function loadPending() {
      const data = await fetchAPI('/api/pending');
      if (data.success) {
        document.getElementById('pending-badge').textContent = data.count;
        if (data.items.length === 0) {
          document.getElementById('pending-list').innerHTML = '<div class="text-gray-500 text-center py-8"><i class="fas fa-check-circle text-4xl mb-2"></i><br>승인 대기 항목이 없습니다.</div>';
          return;
        }
        document.getElementById('pending-list').innerHTML = data.items.map(item => 
          '<div class="border rounded-lg p-4 mb-3 hover:shadow-md transition">' +
            '<div class="flex justify-between items-start">' +
              '<div><a href="https://' + item.domain + '" target="_blank" rel="noopener noreferrer" class="font-bold text-lg text-blue-600 hover:text-blue-800 hover:underline">' + item.domain + ' <i class="fas fa-external-link-alt text-xs"></i></a>' +
              '<span class="ml-2 text-sm px-2 py-1 rounded ' + 
                (item.llm_judgment === 'likely_illegal' ? 'bg-red-100 text-red-700' : 
                 item.llm_judgment === 'likely_legal' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700') + '">' +
                (item.llm_judgment || 'unknown') + '</span></div>' +
              '<div class="flex gap-2">' +
                '<button onclick="reviewItem(' + item.id + ', \\'approve\\')" class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded text-sm"><i class="fas fa-ban mr-1"></i>불법</button>' +
                '<button onclick="reviewItem(' + item.id + ', \\'reject\\')" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm"><i class="fas fa-check mr-1"></i>합법</button>' +
              '</div>' +
            '</div>' +
            '<div class="text-sm text-gray-600 mt-2">' + (item.llm_reason || 'API 키가 설정되지 않아 판별 불가') + '</div>' +
          '</div>'
        ).join('');
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
        document.getElementById('sessions-badge').textContent = data.count;
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
        
        // 결과 표시 (테이블 형식)
        if (data.results.length === 0) {
          document.getElementById('session-results').innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">결과가 없습니다.</td></tr>';
        } else {
          const startIdx = (data.pagination.page - 1) * data.pagination.limit;
          document.getElementById('session-results').innerHTML = data.results.map((r, idx) => {
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
