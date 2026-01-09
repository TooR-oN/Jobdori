import { Hono } from 'hono'
import { handle } from '@hono/node-server/vercel'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { neon } from '@neondatabase/serverless'
import { put, list, head } from '@vercel/blob'
import * as XLSX from 'xlsx'

// ============================================
// Database Setup
// ============================================

function getDb() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(dbUrl)
}

// Lazy initialization - only connect when needed
let _sql: ReturnType<typeof neon> | null = null
function getSql() {
  if (!_sql) {
    _sql = getDb()
  }
  return _sql
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
// Auth Setup
// ============================================

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'ridilegal'

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function generateSessionToken(): string {
  return generateRandomString(64)
}

const sessions = new Map<string, { createdAt: number }>()

function isValidSession(token: string): boolean {
  const session = sessions.get(token)
  if (!session) return false
  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  if (now - session.createdAt > oneDay) {
    sessions.delete(token)
    return false
  }
  return true
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
  const sql = getSql()
  const rows = await sql`SELECT * FROM sessions ORDER BY created_at DESC`
  return rows as any[]
}

async function getSessionById(id: string): Promise<any | null> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM sessions WHERE id = ${id}` as any[]
  return rows[0] || null
}

async function getPendingReviews(): Promise<any[]> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM pending_reviews ORDER BY created_at DESC`
  return rows as any[]
}

async function getPendingReviewById(id: number): Promise<any | null> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM pending_reviews WHERE id = ${id}` as any[]
  return rows[0] || null
}

async function deletePendingReview(id: number) {
  const sql = getSql()
  await sql`DELETE FROM pending_reviews WHERE id = ${id}`
  return true
}

async function getSitesByType(type: 'illegal' | 'legal'): Promise<any[]> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM sites WHERE type = ${type} ORDER BY domain`
  return rows as any[]
}

async function addSite(domain: string, type: 'illegal' | 'legal'): Promise<any> {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO sites (domain, type)
    VALUES (${domain.toLowerCase()}, ${type})
    ON CONFLICT (domain, type) DO NOTHING
    RETURNING *
  ` as any[]
  return rows[0]
}

async function removeSite(domain: string, type: 'illegal' | 'legal') {
  const sql = getSql()
  await sql`DELETE FROM sites WHERE domain = ${domain.toLowerCase()} AND type = ${type}`
  return true
}

async function getCurrentTitles(): Promise<any[]> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM titles WHERE is_current = true ORDER BY created_at DESC`
  return rows as any[]
}

async function getHistoryTitles(): Promise<any[]> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM titles WHERE is_current = false ORDER BY created_at DESC`
  return rows as any[]
}

async function addTitle(name: string): Promise<any> {
  const sql = getSql()
  const rows = await sql`
    INSERT INTO titles (name, is_current)
    VALUES (${name}, true)
    ON CONFLICT (name) DO UPDATE SET is_current = true
    RETURNING *
  ` as any[]
  return rows[0]
}

async function removeTitle(name: string) {
  const sql = getSql()
  await sql`UPDATE titles SET is_current = false WHERE name = ${name}`
  return true
}

async function getMonthlyStats(): Promise<any[]> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM monthly_stats ORDER BY month DESC`
  return rows as any[]
}

async function getMonthlyStatsByMonth(month: string): Promise<any | null> {
  const sql = getSql()
  const rows = await sql`SELECT * FROM monthly_stats WHERE month = ${month}` as any[]
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

// ============================================
// Hono App
// ============================================

const app = new Hono()

app.use('/api/*', cors())

// Auth Routes
app.get('/login', (c) => {
  const sessionToken = getCookie(c, 'session_token')
  if (sessionToken && isValidSession(sessionToken)) {
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
</head>
<body class="bg-gradient-to-br from-blue-500 to-purple-600 min-h-screen flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-2xl font-bold text-gray-800">Jobdori</h1>
      <p class="text-gray-500 mt-2">웹툰 불법사이트 모니터링</p>
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
      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg">
        로그인
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
      const token = generateSessionToken()
      sessions.set(token, { createdAt: Date.now() })
      setCookie(c, 'session_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
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
  const sessionToken = getCookie(c, 'session_token')
  if (sessionToken) sessions.delete(sessionToken)
  deleteCookie(c, 'session_token', { path: '/' })
  return c.json({ success: true })
})

// Auth Middleware
app.use('*', async (c, next) => {
  const path = c.req.path
  const publicPaths = ['/login', '/api/auth/login', '/api/auth/status']
  if (publicPaths.some(p => path.startsWith(p))) return next()
  
  const sessionToken = getCookie(c, 'session_token')
  if (!sessionToken || !isValidSession(sessionToken)) {
    if (path.startsWith('/api/')) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401)
    }
    return c.redirect('/login')
  }
  return next()
})

// API Routes
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

app.get('/api/sessions', async (c) => {
  try {
    const sessionsList = await getSessions()
    return c.json({
      success: true,
      count: sessionsList.length,
      sessions: sessionsList.map((s: any) => ({
        id: s.id,
        created_at: s.created_at,
        status: s.status,
        results_summary: {
          total: s.results_total,
          illegal: s.results_illegal,
          legal: s.results_legal,
          pending: s.results_pending
        }
      }))
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
    return c.json({ success: true, session })
  } catch {
    return c.json({ success: false, error: 'Failed to load session' }, 500)
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
    let stats: any = null
    
    if (month) {
      stats = await getMonthlyStatsByMonth(month)
    } else {
      const allStats = await getMonthlyStats()
      stats = allStats[0] || null
    }
    
    if (!stats) {
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      return c.json({
        success: true,
        month: currentMonth,
        sessions_count: 0,
        top_contents: [],
        top_illegal_sites: [],
        total_stats: { total: 0, illegal: 0, legal: 0, pending: 0 }
      })
    }
    
    return c.json({
      success: true,
      month: stats.month,
      sessions_count: stats.sessions_count,
      top_contents: stats.top_contents,
      top_illegal_sites: stats.top_illegal_sites,
      total_stats: {
        total: stats.total,
        illegal: stats.illegal,
        legal: stats.legal,
        pending: stats.pending
      }
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load dashboard' }, 500)
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

// Main Page
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jobdori - 웹툰 불법사이트 모니터링</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .tab-active { border-bottom: 3px solid #3b82f6; color: #3b82f6; font-weight: 600; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="container mx-auto px-4 py-8 max-w-7xl">
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">Jobdori</h1>
          <p class="text-gray-600 mt-1">웹툰 불법사이트 모니터링 시스템</p>
        </div>
        <button onclick="handleLogout()" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg">
          로그아웃
        </button>
      </div>
    </div>

    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="flex border-b">
        <button id="tab-dashboard" onclick="switchTab('dashboard')" class="px-6 py-4 text-gray-600 hover:text-blue-600 tab-active">대시보드</button>
        <button id="tab-pending" onclick="switchTab('pending')" class="px-6 py-4 text-gray-600 hover:text-blue-600">승인 대기 <span id="pending-badge" class="ml-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">0</span></button>
        <button id="tab-sessions" onclick="switchTab('sessions')" class="px-6 py-4 text-gray-600 hover:text-blue-600">모니터링 회차</button>
        <button id="tab-sites" onclick="switchTab('sites')" class="px-6 py-4 text-gray-600 hover:text-blue-600">사이트 목록</button>
      </div>
    </div>

    <div id="content-dashboard" class="tab-content">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4">월간 모니터링 현황</h2>
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
      </div>
    </div>

    <div id="content-pending" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4">승인 대기 목록</h2>
        <div id="pending-list">로딩 중...</div>
      </div>
    </div>

    <div id="content-sessions" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4">모니터링 회차</h2>
        <div id="sessions-list">로딩 중...</div>
      </div>
    </div>

    <div id="content-sites" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4">사이트 목록</h2>
        <div class="grid grid-cols-2 gap-6">
          <div>
            <h3 class="font-bold text-red-600 mb-3">불법 사이트 (<span id="illegal-count">0</span>개)</h3>
            <div id="illegal-sites-list" class="max-h-96 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold text-green-600 mb-3">합법 사이트 (<span id="legal-count">0</span>개)</h3>
            <div id="legal-sites-list" class="max-h-96 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentTab = 'dashboard';
    
    async function fetchAPI(url) {
      const response = await fetch(url);
      if (response.status === 401) { window.location.href = '/login'; return null; }
      return await response.json();
    }
    
    async function handleLogout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
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
      const data = await fetchAPI('/api/dashboard');
      if (data?.success) {
        document.getElementById('dash-total').textContent = data.total_stats?.total || 0;
        document.getElementById('dash-illegal').textContent = data.total_stats?.illegal || 0;
        document.getElementById('dash-legal').textContent = data.total_stats?.legal || 0;
        document.getElementById('dash-sessions').textContent = data.sessions_count || 0;
      }
    }
    
    async function loadPending() {
      const data = await fetchAPI('/api/pending');
      if (data?.success) {
        document.getElementById('pending-badge').textContent = data.count;
        document.getElementById('pending-list').innerHTML = data.items.length === 0 
          ? '<div class="text-gray-500 text-center py-8">승인 대기 항목이 없습니다.</div>'
          : data.items.map(item => '<div class="border rounded-lg p-4 mb-3"><div class="font-bold">' + item.domain + '</div><div class="text-sm text-gray-600">' + (item.llm_reason || '') + '</div></div>').join('');
      }
    }
    
    async function loadSessions() {
      const data = await fetchAPI('/api/sessions');
      if (data?.success) {
        document.getElementById('sessions-list').innerHTML = data.sessions.length === 0
          ? '<div class="text-gray-500 text-center py-8">모니터링 기록이 없습니다.</div>'
          : data.sessions.map(s => '<div class="border rounded-lg p-4 mb-3"><div class="font-bold">' + s.id + '</div><div class="text-sm">전체: ' + s.results_summary.total + ' | 불법: ' + s.results_summary.illegal + ' | 합법: ' + s.results_summary.legal + '</div></div>').join('');
      }
    }
    
    async function loadSites() {
      const illegalData = await fetchAPI('/api/sites/illegal');
      const legalData = await fetchAPI('/api/sites/legal');
      
      if (illegalData?.success) {
        document.getElementById('illegal-count').textContent = illegalData.count;
        document.getElementById('illegal-sites-list').innerHTML = illegalData.sites.map(s => '<div class="py-1 border-b text-sm">' + s + '</div>').join('') || '목록 없음';
      }
      if (legalData?.success) {
        document.getElementById('legal-count').textContent = legalData.count;
        document.getElementById('legal-sites-list').innerHTML = legalData.sites.map(s => '<div class="py-1 border-b text-sm">' + s + '</div>').join('') || '목록 없음';
      }
    }
    
    loadDashboard();
    loadPending();
  </script>
</body>
</html>
  `)
})

export default handle(app)
