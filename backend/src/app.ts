// ============================================
// Jobdori - Hono Application
// Vercel Serverless + Neon DB + Vercel Blob
// ============================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
// Web Crypto API 대신 간단한 랜덤 문자열 생성
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const randomValues = new Uint8Array(length)
  globalThis.crypto.getRandomValues(randomValues)
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length]
  }
  return result
}
import * as XLSX from 'xlsx'

// DB & Blob imports
import * as db from './lib/db.js'
import * as blob from './lib/blob.js'

// ============================================
// 타입 정의
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
// 인증 설정
// ============================================

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'ridilegal'

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
// Excel 생성 함수
// ============================================

function generateExcelFromResults(results: FinalResult[]): Buffer {
  const columns = [
    'title', 'domain', 'url', 'search_query', 'page', 'rank',
    'status', 'llm_judgment', 'llm_reason', 'final_status', 'reviewed_at'
  ]

  const wb = XLSX.utils.book_new()

  // 전체 결과 시트
  const allData = [columns, ...results.map(r => columns.map(col => (r as any)[col] ?? ''))]
  const allWs = XLSX.utils.aoa_to_sheet(allData)
  XLSX.utils.book_append_sheet(wb, allWs, '전체 결과')

  // 불법 사이트 시트
  const illegalResults = results.filter(r => r.final_status === 'illegal')
  if (illegalResults.length > 0) {
    const illegalData = [columns, ...illegalResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const illegalWs = XLSX.utils.aoa_to_sheet(illegalData)
    XLSX.utils.book_append_sheet(wb, illegalWs, '불법 사이트')
  }

  // 합법 사이트 시트
  const legalResults = results.filter(r => r.final_status === 'legal')
  if (legalResults.length > 0) {
    const legalData = [columns, ...legalResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const legalWs = XLSX.utils.aoa_to_sheet(legalData)
    XLSX.utils.book_append_sheet(wb, legalWs, '합법 사이트')
  }

  // 승인 대기 시트
  const pendingResults = results.filter(r => r.final_status === 'pending')
  if (pendingResults.length > 0) {
    const pendingData = [columns, ...pendingResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const pendingWs = XLSX.utils.aoa_to_sheet(pendingData)
    XLSX.utils.book_append_sheet(wb, pendingWs, '승인 대기')
  }

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

// ============================================
// Hono App
// ============================================

const app = new Hono()

// CORS 설정
app.use('/api/*', cors())

// ============================================
// 인증 API
// ============================================

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
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-blue-500 to-purple-600 min-h-screen flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
    <div class="text-center mb-8">
      <div class="bg-blue-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
        <i class="fas fa-shield-alt text-blue-600 text-3xl"></i>
      </div>
      <h1 class="text-2xl font-bold text-gray-800">Jobdori</h1>
      <p class="text-gray-500 mt-2">웹툰 불법사이트 모니터링</p>
    </div>
    
    <form id="login-form" onsubmit="handleLogin(event)">
      <div class="mb-6">
        <label class="block text-gray-700 text-sm font-medium mb-2">
          <i class="fas fa-lock mr-2"></i>비밀번호
        </label>
        <input type="password" id="password" 
               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
               placeholder="비밀번호를 입력하세요" required autofocus>
      </div>
      
      <div id="error-message" class="hidden mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
        <i class="fas fa-exclamation-circle mr-2"></i>
        <span>비밀번호가 올바르지 않습니다.</span>
      </div>
      
      <button type="submit" id="login-btn"
              class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition">
        <i class="fas fa-sign-in-alt mr-2"></i>로그인
      </button>
    </form>
  </div>
  
  <script>
    async function handleLogin(event) {
      event.preventDefault();
      const password = document.getElementById('password').value;
      const errorMessage = document.getElementById('error-message');
      const loginBtn = document.getElementById('login-btn');
      
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>확인 중...';
      errorMessage.classList.add('hidden');
      
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await response.json();
        if (data.success) {
          window.location.href = '/';
        } else {
          errorMessage.classList.remove('hidden');
          document.getElementById('password').value = '';
          document.getElementById('password').focus();
        }
      } catch (error) {
        errorMessage.classList.remove('hidden');
      } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i>로그인';
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
  } catch (error) {
    return c.json({ success: false, error: '요청 처리 중 오류가 발생했습니다.' }, 500)
  }
})

app.post('/api/auth/logout', (c) => {
  const sessionToken = getCookie(c, 'session_token')
  if (sessionToken) {
    sessions.delete(sessionToken)
  }
  deleteCookie(c, 'session_token', { path: '/' })
  return c.json({ success: true })
})

app.get('/api/auth/status', (c) => {
  const sessionToken = getCookie(c, 'session_token')
  const isAuthenticated = sessionToken && isValidSession(sessionToken)
  return c.json({ authenticated: isAuthenticated })
})

// ============================================
// 인증 미들웨어
// ============================================

app.use('*', async (c, next) => {
  const path = c.req.path
  const publicPaths = ['/login', '/api/auth/login', '/api/auth/status']
  if (publicPaths.some(p => path.startsWith(p))) {
    return next()
  }
  
  const sessionToken = getCookie(c, 'session_token')
  if (!sessionToken || !isValidSession(sessionToken)) {
    if (path.startsWith('/api/')) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401)
    }
    return c.redirect('/login')
  }
  
  return next()
})

// ============================================
// API - 승인 대기 목록
// ============================================

app.get('/api/pending', async (c) => {
  try {
    const items = await db.getPendingReviews()
    return c.json({ success: true, count: items.length, items })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load pending reviews' }, 500)
  }
})

app.get('/api/pending/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const item = await db.getPendingReviewById(id)
    if (!item) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    return c.json({ success: true, item })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load item' }, 500)
  }
})

app.post('/api/review', async (c) => {
  try {
    const { id, action } = await c.req.json()
    if (!id || !action) {
      return c.json({ success: false, error: 'Missing id or action' }, 400)
    }
    
    const item = await db.getPendingReviewById(parseInt(id))
    if (!item) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    if (action === 'approve') {
      await db.addSite(item.domain, 'illegal')
      await db.deletePendingReview(parseInt(id))
    } else if (action === 'reject') {
      await db.addSite(item.domain, 'legal')
      await db.deletePendingReview(parseInt(id))
    }
    // hold는 아무것도 하지 않음
    
    return c.json({ success: true, action })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to process review' }, 500)
  }
})

// ============================================
// API - 사이트 목록
// ============================================

app.get('/api/sites/:type', async (c) => {
  try {
    const type = c.req.param('type') as 'illegal' | 'legal'
    if (type !== 'illegal' && type !== 'legal') {
      return c.json({ success: false, error: 'Invalid type' }, 400)
    }
    const sites = await db.getSitesByType(type)
    return c.json({ 
      success: true, 
      type, 
      count: sites.length, 
      sites: sites.map(s => s.domain) 
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load sites' }, 500)
  }
})

app.post('/api/sites/:type', async (c) => {
  try {
    const type = c.req.param('type') as 'illegal' | 'legal'
    const { domain } = await c.req.json()
    if (!domain) {
      return c.json({ success: false, error: 'Missing domain' }, 400)
    }
    await db.addSite(domain, type)
    return c.json({ success: true, domain, type })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to add site' }, 500)
  }
})

app.delete('/api/sites/:type/:domain', async (c) => {
  try {
    const type = c.req.param('type') as 'illegal' | 'legal'
    const domain = c.req.param('domain')
    await db.removeSite(domain, type)
    return c.json({ success: true, domain, type })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to remove site' }, 500)
  }
})

// ============================================
// API - 작품 목록
// ============================================

app.get('/api/titles', async (c) => {
  try {
    const current = await db.getCurrentTitles()
    const history = await db.getHistoryTitles()
    return c.json({
      success: true,
      current: current.map(t => t.name),
      history: history.map(t => t.name)
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

app.post('/api/titles', async (c) => {
  try {
    const { title } = await c.req.json()
    if (!title) {
      return c.json({ success: false, error: 'Missing title' }, 400)
    }
    await db.addTitle(title)
    return c.json({ success: true, title })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to add title' }, 500)
  }
})

app.delete('/api/titles/:title', async (c) => {
  try {
    const title = decodeURIComponent(c.req.param('title'))
    await db.removeTitle(title)
    return c.json({ success: true, title })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to remove title' }, 500)
  }
})

app.post('/api/titles/restore', async (c) => {
  try {
    const { title } = await c.req.json()
    await db.restoreTitle(title)
    return c.json({ success: true, title })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to restore title' }, 500)
  }
})

// ============================================
// API - 세션
// ============================================

app.get('/api/sessions', async (c) => {
  try {
    const sessionsList = await db.getSessions()
    return c.json({
      success: true,
      count: sessionsList.length,
      sessions: sessionsList.map(s => ({
        id: s.id,
        created_at: s.created_at,
        completed_at: s.completed_at,
        status: s.status,
        titles_count: s.titles_count,
        keywords_count: s.keywords_count,
        total_searches: s.total_searches,
        results_summary: {
          total: s.results_total,
          illegal: s.results_illegal,
          legal: s.results_legal,
          pending: s.results_pending
        },
        deep_monitoring_executed: s.deep_monitoring_executed || false,
        deep_monitoring_targets_count: s.deep_monitoring_targets_count || 0,
        deep_monitoring_new_urls: s.deep_monitoring_new_urls || 0
      }))
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load sessions' }, 500)
  }
})

app.get('/api/sessions/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const session = await db.getSessionById(id)
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
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
        },
        deep_monitoring_executed: session.deep_monitoring_executed || false,
        deep_monitoring_targets_count: session.deep_monitoring_targets_count || 0,
        deep_monitoring_new_urls: session.deep_monitoring_new_urls || 0
      }
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load session' }, 500)
  }
})

app.get('/api/sessions/:id/results', async (c) => {
  try {
    const id = c.req.param('id')
    const session = await db.getSessionById(id)
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    // Blob에서 결과 파일 가져오기
    let results: FinalResult[] = []
    if (session.file_final_results) {
      // file_final_results가 Blob URL인 경우
      if (session.file_final_results.startsWith('http')) {
        results = await blob.downloadResults(session.file_final_results)
      } else {
        // 아직 마이그레이션되지 않은 경우 빈 배열 반환
        results = []
      }
    }
    
    // 필터링
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
    
    // 고유 타이틀 목록
    const availableTitles = [...new Set(results.map(r => r.title))].sort()
    
    return c.json({
      success: true,
      results: paginatedResults,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      available_titles: availableTitles
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load results' }, 500)
  }
})

app.get('/api/sessions/:id/download', async (c) => {
  try {
    const id = c.req.param('id')
    const session = await db.getSessionById(id)
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    let results: FinalResult[] = []
    if (session.file_final_results && session.file_final_results.startsWith('http')) {
      results = await blob.downloadResults(session.file_final_results)
    }
    
    if (results.length === 0) {
      return c.json({ success: false, error: 'No results found' }, 404)
    }
    
    const excelBuffer = generateExcelFromResults(results)
    const fileName = `report_${id}.xlsx`
    
    return new Response(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to generate report' }, 500)
  }
})

// ============================================
// API - 사이트 집중 모니터링 (Deep Monitoring)
// ============================================

// 대상 검색 (scan)
app.post('/api/sessions/:id/deep-monitoring/scan', async (c) => {
  try {
    const sessionId = c.req.param('id')
    
    // 세션 존재 & 완료 여부 확인
    const session = await db.getSessionById(sessionId)
    if (!session) {
      return c.json({ success: false, error: '세션을 찾을 수 없습니다.' }, 404)
    }
    if (session.status !== 'completed') {
      return c.json({ success: false, error: '완료된 세션에서만 집중 모니터링 대상을 검색할 수 있습니다.' }, 400)
    }

    // deep-monitoring 모듈 동적 import (scripts 디렉토리)
    const deepMon = await import('../scripts/deep-monitoring.js')
    const result = await deepMon.scanAndSaveTargets(sessionId)

    return c.json({
      success: true,
      ...result
    })
  } catch (error: any) {
    console.error('Deep monitoring scan error:', error)
    return c.json({ success: false, error: error.message || '대상 검색 실패' }, 500)
  }
})

// 심층 검색 실행 (execute)
app.post('/api/sessions/:id/deep-monitoring/execute', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const targetIds: number[] | undefined = body.target_ids

    // 세션 확인
    const session = await db.getSessionById(sessionId)
    if (!session) {
      return c.json({ success: false, error: '세션을 찾을 수 없습니다.' }, 404)
    }
    if (session.status !== 'completed') {
      return c.json({ success: false, error: '완료된 세션에서만 집중 모니터링을 실행할 수 있습니다.' }, 400)
    }

    const deepMon = await import('../scripts/deep-monitoring.js')

    // 이미 실행 중인지 확인
    const progress = deepMon.getDeepMonitoringProgress()
    if (progress && progress.is_running) {
      return c.json({ success: false, error: '이미 집중 모니터링이 실행 중입니다.' }, 409)
    }

    // 비동기 실행 (응답은 즉시 반환, 백그라운드에서 실행)
    deepMon.executeDeepMonitoring(sessionId, targetIds)
      .then((result: any) => {
        console.log(`✅ [집중 모니터링] 완료: ${result.total_new_urls}개 신규 URL`)
      })
      .catch((err: any) => {
        console.error('❌ [집중 모니터링] 실패:', err)
      })

    return c.json({
      success: true,
      message: '집중 모니터링이 시작되었습니다.',
      session_id: sessionId,
      target_ids: targetIds || 'all pending'
    })
  } catch (error: any) {
    console.error('Deep monitoring execute error:', error)
    return c.json({ success: false, error: error.message || '실행 실패' }, 500)
  }
})

// 대상 목록 조회
app.get('/api/sessions/:id/deep-monitoring/targets', async (c) => {
  try {
    const sessionId = c.req.param('id')
    const targets = await db.getDeepMonitoringTargets(sessionId)

    return c.json({
      success: true,
      count: targets.length,
      targets
    })
  } catch (error: any) {
    console.error('Deep monitoring targets error:', error)
    return c.json({ success: false, error: error.message || '대상 목록 조회 실패' }, 500)
  }
})

// 실행 상태 조회 (폴링용)
app.get('/api/sessions/:id/deep-monitoring/status', async (c) => {
  try {
    const sessionId = c.req.param('id')
    
    const deepMon = await import('../scripts/deep-monitoring.js')
    const progress = deepMon.getDeepMonitoringProgress()

    if (progress && progress.is_running && progress.session_id === sessionId) {
      return c.json({
        success: true,
        is_running: true,
        progress: {
          total_targets: progress.total_targets,
          completed_targets: progress.completed_targets,
          current_target: progress.current_target,
          results_so_far: progress.results_so_far
        }
      })
    }

    // 실행 중이 아니면 DB에서 대상 상태 조회
    const targets = await db.getDeepMonitoringTargets(sessionId)
    const completedCount = targets.filter(t => t.status === 'completed').length
    const failedCount = targets.filter(t => t.status === 'failed').length
    const pendingCount = targets.filter(t => t.status === 'pending').length

    return c.json({
      success: true,
      is_running: false,
      summary: {
        total: targets.length,
        completed: completedCount,
        failed: failedCount,
        pending: pendingCount
      },
      targets
    })
  } catch (error: any) {
    console.error('Deep monitoring status error:', error)
    return c.json({ success: false, error: error.message || '상태 조회 실패' }, 500)
  }
})

// ============================================
// API - 대시보드
// ============================================

app.get('/api/dashboard/months', async (c) => {
  try {
    const stats = await db.getMonthlyStats()
    const months = stats.map(s => s.month)
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return c.json({
      success: true,
      months,
      current_month: currentMonth
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load months' }, 500)
  }
})

app.get('/api/dashboard', async (c) => {
  try {
    const month = c.req.query('month')
    let stats: db.MonthlyStats | null = null
    
    if (month) {
      stats = await db.getMonthlyStatsByMonth(month)
    } else {
      const allStats = await db.getMonthlyStats()
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
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load dashboard' }, 500)
  }
})

// ============================================
// API - 통계
// ============================================

app.get('/api/stats', async (c) => {
  try {
    const pending = await db.getPendingReviews()
    const illegalSites = await db.getSitesByType('illegal')
    const legalSites = await db.getSitesByType('legal')
    
    return c.json({
      success: true,
      stats: {
        pending_count: pending.length,
        illegal_sites_count: illegalSites.length,
        legal_sites_count: legalSites.length
      }
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load stats' }, 500)
  }
})

// ============================================
// 메인 페이지 (UI)
// ============================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jobdori - 웹툰 불법사이트 모니터링</title>
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
        <div>
          <h1 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-shield-alt text-blue-600 mr-2"></i>
            Jobdori
          </h1>
          <p class="text-gray-600 mt-1">웹툰 불법사이트 모니터링 시스템</p>
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

    <!-- 탭 컨텐츠 -->
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
            <h3 class="font-bold mb-3">불법 URL 많은 작품 Top 5</h3>
            <div id="top-contents" class="space-y-2">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold mb-3">상위 불법 도메인 Top 5</h3>
            <div id="top-domains" class="space-y-2">로딩 중...</div>
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
            <h3 class="font-bold text-red-600 mb-3">
              <i class="fas fa-ban mr-2"></i>불법 사이트 (<span id="illegal-count">0</span>개)
            </h3>
            <div id="illegal-sites-list" class="max-h-96 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold text-green-600 mb-3">
              <i class="fas fa-check mr-2"></i>합법 사이트 (<span id="legal-count">0</span>개)
            </h3>
            <div id="legal-sites-list" class="max-h-96 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 작품 변경 모달 -->
  <div id="titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
      <div class="bg-purple-500 text-white px-6 py-4 flex justify-between items-center">
        <h2 class="text-xl font-bold"><i class="fas fa-list-alt mr-2"></i>모니터링 대상 작품 관리</h2>
        <button onclick="closeTitlesModal()" class="text-white hover:text-gray-200">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-6">
        <div class="flex gap-2 mb-4">
          <input type="text" id="new-title-input" placeholder="새 작품명 입력..." 
                 class="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                 onkeypress="if(event.key==='Enter') addNewTitle()">
          <button onclick="addNewTitle()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
            <i class="fas fa-plus"></i> 추가
          </button>
        </div>
        <h3 class="font-bold mb-2">현재 모니터링 대상 (<span id="titles-count">0</span>개)</h3>
        <div id="current-titles-list" class="max-h-64 overflow-y-auto border rounded p-3">로딩 중...</div>
      </div>
    </div>
  </div>

  <script>
    let currentTab = 'dashboard';
    
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
      // 월 목록 로드
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
          topContents.map((c, i) => '<div class="flex justify-between p-2 bg-gray-50 rounded"><span>' + (i+1) + '. ' + c.title + '</span><span class="text-red-600">' + c.illegal_count + '개</span></div>').join('') :
          '<div class="text-gray-500">데이터 없음</div>';
          
        const topDomains = data.top_illegal_sites || [];
        document.getElementById('top-domains').innerHTML = topDomains.length ?
          topDomains.map((d, i) => '<div class="flex justify-between p-2 bg-gray-50 rounded"><span>' + (i+1) + '. ' + d.domain + '</span><span class="text-red-600">' + d.count + '개</span></div>').join('') :
          '<div class="text-gray-500">데이터 없음</div>';
      }
    }
    
    async function loadPending() {
      const data = await fetchAPI('/api/pending');
      if (data.success) {
        document.getElementById('pending-badge').textContent = data.count;
        if (data.items.length === 0) {
          document.getElementById('pending-list').innerHTML = '<div class="text-gray-500 text-center py-8">승인 대기 항목이 없습니다.</div>';
          return;
        }
        document.getElementById('pending-list').innerHTML = data.items.map(item => 
          '<div class="border rounded-lg p-4 mb-3">' +
            '<div class="flex justify-between items-start">' +
              '<div><span class="font-bold">' + item.domain + '</span>' +
              '<span class="ml-2 text-sm px-2 py-1 rounded ' + 
                (item.llm_judgment === 'likely_illegal' ? 'bg-red-100 text-red-700' : 
                 item.llm_judgment === 'likely_legal' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700') + '">' +
                item.llm_judgment + '</span></div>' +
              '<div class="flex gap-2">' +
                '<button onclick="reviewItem(' + item.id + ', \\'approve\\')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm">불법</button>' +
                '<button onclick="reviewItem(' + item.id + ', \\'reject\\')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm">합법</button>' +
              '</div>' +
            '</div>' +
            '<div class="text-sm text-gray-600 mt-2">' + (item.llm_reason || '') + '</div>' +
          '</div>'
        ).join('');
      }
    }
    
    async function reviewItem(id, action) {
      const data = await fetchAPI('/api/review', {
        method: 'POST',
        body: JSON.stringify({ id: String(id), action })
      });
      if (data.success) loadPending();
    }
    
    async function loadSessions() {
      const data = await fetchAPI('/api/sessions');
      if (data.success) {
        document.getElementById('sessions-badge').textContent = data.count;
        if (data.sessions.length === 0) {
          document.getElementById('sessions-list').innerHTML = '<div class="text-gray-500 text-center py-8">모니터링 기록이 없습니다.</div>';
          return;
        }
        document.getElementById('sessions-list').innerHTML = data.sessions.map(s =>
          '<div class="border rounded-lg p-4 mb-3 cursor-pointer hover:bg-gray-50" onclick="viewSession(\\'' + s.id + '\\')">' +
            '<div class="flex justify-between">' +
              '<span class="font-bold">' + s.id + '</span>' +
              '<span class="text-sm text-gray-500">' + new Date(s.created_at).toLocaleString('ko-KR') + '</span>' +
            '</div>' +
            '<div class="flex gap-4 mt-2 text-sm">' +
              '<span>전체: ' + s.results_summary.total + '</span>' +
              '<span class="text-red-600">불법: ' + s.results_summary.illegal + '</span>' +
              '<span class="text-green-600">합법: ' + s.results_summary.legal + '</span>' +
            '</div>' +
          '</div>'
        ).join('');
      }
    }
    
    async function viewSession(id) {
      window.open('/api/sessions/' + id + '/download', '_blank');
    }
    
    async function loadSites() {
      const illegalData = await fetchAPI('/api/sites/illegal');
      const legalData = await fetchAPI('/api/sites/legal');
      
      if (illegalData.success) {
        document.getElementById('illegal-count').textContent = illegalData.count;
        document.getElementById('illegal-sites-list').innerHTML = illegalData.sites.map(s =>
          '<div class="flex justify-between items-center py-1 border-b">' +
            '<span class="text-sm">' + s + '</span>' +
          '</div>'
        ).join('') || '<div class="text-gray-500">목록 없음</div>';
      }
      
      if (legalData.success) {
        document.getElementById('legal-count').textContent = legalData.count;
        document.getElementById('legal-sites-list').innerHTML = legalData.sites.map(s =>
          '<div class="flex justify-between items-center py-1 border-b">' +
            '<span class="text-sm">' + s + '</span>' +
          '</div>'
        ).join('') || '<div class="text-gray-500">목록 없음</div>';
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
        document.getElementById('current-titles-list').innerHTML = data.current.map(t =>
          '<div class="flex justify-between items-center py-2 border-b">' +
            '<span>' + t + '</span>' +
            '<button onclick="removeTitle(\\'' + t.replace(/'/g, "\\\\'") + '\\')" class="text-red-500 hover:text-red-700"><i class="fas fa-times"></i></button>' +
          '</div>'
        ).join('') || '<div class="text-gray-500">목록 없음</div>';
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
