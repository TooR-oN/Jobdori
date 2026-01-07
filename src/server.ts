import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as fs from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'

// ============================================
// 타입 정의
// ============================================

interface PendingReviewItem {
  id: string
  domain: string
  urls: string[]
  titles: string[]
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain'
  llm_reason: string
  created_at: string
  session_id?: string
}

interface ReviewAction {
  id: string
  action: 'approve' | 'reject' | 'hold'
}

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

interface MonitoringSession {
  id: string
  created_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'error'
  titles_count: number
  keywords_count: number
  total_searches: number
  results_summary: {
    total: number
    illegal: number
    legal: number
    pending: number
  }
  files: {
    search_results: string
    classified_results: string
    llm_judged_results: string
    final_results: string
    excel_report: string
  }
}

interface SessionsData {
  sessions: MonitoringSession[]
  last_updated: string
}

// ============================================
// 파일 경로
// ============================================

const DATA_DIR = path.join(process.cwd(), 'data')
const OUTPUT_DIR = path.join(process.cwd(), 'output')
const PENDING_FILE = path.join(DATA_DIR, 'pending-review.json')
const ILLEGAL_SITES_FILE = path.join(DATA_DIR, 'illegal-sites.txt')
const LEGAL_SITES_FILE = path.join(DATA_DIR, 'legal-sites.txt')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

// ============================================
// 유틸리티 함수
// ============================================

function loadPendingReviews(): PendingReviewItem[] {
  try {
    if (fs.existsSync(PENDING_FILE)) {
      const content = fs.readFileSync(PENDING_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Failed to load pending reviews:', error)
  }
  return []
}

function savePendingReviews(items: PendingReviewItem[]): void {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(items, null, 2), 'utf-8')
}

function addToSiteList(filePath: string, domain: string): void {
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes(domain)) {
    const newContent = content.trimEnd() + '\n' + domain + '\n'
    fs.writeFileSync(filePath, newContent, 'utf-8')
  }
}

function loadSessions(): SessionsData {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const content = fs.readFileSync(SESSIONS_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Failed to load sessions:', error)
  }
  return { sessions: [], last_updated: new Date().toISOString() }
}

function saveSessions(data: SessionsData): void {
  data.last_updated = new Date().toISOString()
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

function loadFinalResults(filePath: string): FinalResult[] {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Failed to load final results:', error)
  }
  return []
}

function saveFinalResults(filePath: string, results: FinalResult[]): void {
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), 'utf-8')
}

/**
 * Excel 파일 업데이트 (실시간 반영)
 */
function updateExcelReport(excelPath: string, results: FinalResult[]): void {
  try {
    // 컬럼 순서 정의
    const columns = [
      'title', 'domain', 'url', 'search_query', 'page', 'rank',
      'status', 'llm_judgment', 'llm_reason', 'final_status', 'reviewed_at'
    ]

    // 워크시트 데이터 생성
    const wsData = [columns]
    for (const result of results) {
      wsData.push(columns.map(col => (result as any)[col] ?? ''))
    }

    // 새 워크북 생성
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // 컬럼 너비 설정
    ws['!cols'] = [
      { wch: 25 }, // title
      { wch: 30 }, // domain
      { wch: 50 }, // url
      { wch: 35 }, // search_query
      { wch: 6 },  // page
      { wch: 6 },  // rank
      { wch: 10 }, // status
      { wch: 15 }, // llm_judgment
      { wch: 50 }, // llm_reason
      { wch: 12 }, // final_status
      { wch: 22 }, // reviewed_at
    ]

    XLSX.utils.book_append_sheet(wb, ws, '전체 결과')

    // 불법 사이트 시트
    const illegalResults = results.filter(r => r.final_status === 'illegal')
    if (illegalResults.length > 0) {
      const illegalData = [columns]
      for (const result of illegalResults) {
        illegalData.push(columns.map(col => (result as any)[col] ?? ''))
      }
      const illegalWs = XLSX.utils.aoa_to_sheet(illegalData)
      illegalWs['!cols'] = ws['!cols']
      XLSX.utils.book_append_sheet(wb, illegalWs, '불법 사이트')
    }

    // 합법 사이트 시트
    const legalResults = results.filter(r => r.final_status === 'legal')
    if (legalResults.length > 0) {
      const legalData = [columns]
      for (const result of legalResults) {
        legalData.push(columns.map(col => (result as any)[col] ?? ''))
      }
      const legalWs = XLSX.utils.aoa_to_sheet(legalData)
      legalWs['!cols'] = ws['!cols']
      XLSX.utils.book_append_sheet(wb, legalWs, '합법 사이트')
    }

    // 승인 대기 시트
    const pendingResults = results.filter(r => r.final_status === 'pending')
    if (pendingResults.length > 0) {
      const pendingData = [columns]
      for (const result of pendingResults) {
        pendingData.push(columns.map(col => (result as any)[col] ?? ''))
      }
      const pendingWs = XLSX.utils.aoa_to_sheet(pendingData)
      pendingWs['!cols'] = ws['!cols']
      XLSX.utils.book_append_sheet(wb, pendingWs, '승인 대기')
    }

    // 파일 저장
    XLSX.writeFile(wb, excelPath)
    console.log(`📊 Excel 업데이트됨: ${excelPath}`)
  } catch (error) {
    console.error('Excel 업데이트 실패:', error)
  }
}

/**
 * 도메인에 해당하는 모든 결과의 상태를 업데이트
 */
function updateResultsForDomain(
  domain: string,
  newStatus: 'illegal' | 'legal',
  sessions: MonitoringSession[]
): void {
  const reviewedAt = new Date().toISOString()

  for (const session of sessions) {
    const finalResultsPath = path.join(process.cwd(), session.files.final_results)
    const excelPath = path.join(process.cwd(), session.files.excel_report)

    if (!fs.existsSync(finalResultsPath)) continue

    let results = loadFinalResults(finalResultsPath)
    let updated = false

    // 해당 도메인의 모든 결과 업데이트
    results = results.map(result => {
      if (result.domain.toLowerCase() === domain.toLowerCase() && result.final_status === 'pending') {
        updated = true
        return {
          ...result,
          final_status: newStatus,
          reviewed_at: reviewedAt,
        }
      }
      return result
    })

    if (updated) {
      // JSON 파일 업데이트
      saveFinalResults(finalResultsPath, results)
      console.log(`📝 JSON 업데이트됨: ${finalResultsPath}`)

      // 세션 요약 업데이트
      session.results_summary = {
        total: results.length,
        illegal: results.filter(r => r.final_status === 'illegal').length,
        legal: results.filter(r => r.final_status === 'legal').length,
        pending: results.filter(r => r.final_status === 'pending').length,
      }

      // Excel 파일 업데이트
      if (fs.existsSync(excelPath)) {
        updateExcelReport(excelPath, results)
      }
    }
  }
}

/**
 * output 폴더에서 세션 정보 자동 스캔
 */
function scanAndUpdateSessions(): SessionsData {
  const sessionsData = loadSessions()
  const existingIds = new Set(sessionsData.sessions.map(s => s.id))

  // output 폴더 스캔
  if (!fs.existsSync(OUTPUT_DIR)) {
    return sessionsData
  }

  const files = fs.readdirSync(OUTPUT_DIR)
  
  // 타임스탬프별로 그룹화
  const timestampPattern = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/
  const timestampGroups = new Map<string, string[]>()

  for (const file of files) {
    const match = file.match(timestampPattern)
    if (match) {
      const timestamp = match[0]
      if (!timestampGroups.has(timestamp)) {
        timestampGroups.set(timestamp, [])
      }
      timestampGroups.get(timestamp)!.push(file)
    }
  }

  // 각 타임스탬프에 대해 세션 생성
  for (const [timestamp, groupFiles] of timestampGroups) {
    if (existingIds.has(timestamp)) continue

    const searchFile = groupFiles.find(f => f.startsWith('1_search'))
    const classifiedFile = groupFiles.find(f => f.startsWith('2_classified'))
    const llmFile = groupFiles.find(f => f.startsWith('3_llm'))
    const finalFile = groupFiles.find(f => f.startsWith('4_final'))
    const excelFile = groupFiles.find(f => f.startsWith('report_') && f.endsWith('.xlsx'))

    // 최소한 final 결과와 Excel이 있어야 세션으로 인정
    if (!finalFile || !excelFile) continue

    // final 결과 파일에서 통계 추출
    const finalResultsPath = path.join(OUTPUT_DIR, finalFile)
    const results = loadFinalResults(finalResultsPath)

    if (results.length === 0) continue

    const session: MonitoringSession = {
      id: timestamp,
      created_at: timestamp.replace('T', ' ').replace(/-/g, ':'),
      completed_at: timestamp.replace('T', ' ').replace(/-/g, ':'),
      status: 'completed',
      titles_count: new Set(results.map(r => r.title)).size,
      keywords_count: 3, // 기본값
      total_searches: new Set(results.map(r => r.search_query)).size,
      results_summary: {
        total: results.length,
        illegal: results.filter(r => r.final_status === 'illegal').length,
        legal: results.filter(r => r.final_status === 'legal').length,
        pending: results.filter(r => r.final_status === 'pending').length,
      },
      files: {
        search_results: searchFile ? `output/${searchFile}` : '',
        classified_results: classifiedFile ? `output/${classifiedFile}` : '',
        llm_judged_results: llmFile ? `output/${llmFile}` : '',
        final_results: `output/${finalFile}`,
        excel_report: `output/${excelFile}`,
      },
    }

    sessionsData.sessions.push(session)
  }

  // 시간순 정렬 (최신순)
  sessionsData.sessions.sort((a, b) => b.id.localeCompare(a.id))

  saveSessions(sessionsData)
  return sessionsData
}

// ============================================
// Hono App
// ============================================

const app = new Hono()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 서빙
app.use('/static/*', serveStatic({ root: './public' }))

// ============================================
// API 엔드포인트 - 승인 관련
// ============================================

// 승인 대기 목록 조회
app.get('/api/pending', (c) => {
  const items = loadPendingReviews()
  return c.json({
    success: true,
    count: items.length,
    items,
  })
})

// 단일 항목 조회
app.get('/api/pending/:id', (c) => {
  const id = c.req.param('id')
  const items = loadPendingReviews()
  const item = items.find(i => i.id === id)
  
  if (!item) {
    return c.json({ success: false, error: 'Item not found' }, 404)
  }
  
  return c.json({ success: true, item })
})

// 승인/거절/보류 처리 (실시간 반영 포함)
app.post('/api/review', async (c) => {
  try {
    const body = await c.req.json<ReviewAction>()
    const { id, action } = body
    
    if (!id || !action) {
      return c.json({ success: false, error: 'Missing id or action' }, 400)
    }
    
    const items = loadPendingReviews()
    const itemIndex = items.findIndex(i => i.id === id)
    
    if (itemIndex === -1) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    const item = items[itemIndex]
    
    // 세션 데이터 로드
    const sessionsData = scanAndUpdateSessions()
    
    if (action === 'approve') {
      // 불법 사이트 리스트에 추가
      addToSiteList(ILLEGAL_SITES_FILE, item.domain)
      
      // 모든 세션의 결과 파일 업데이트 (실시간 반영)
      updateResultsForDomain(item.domain, 'illegal', sessionsData.sessions)
      
      // 세션 데이터 저장
      saveSessions(sessionsData)
      
      // 대기 목록에서 제거
      items.splice(itemIndex, 1)
      savePendingReviews(items)
      
      console.log(`✅ 승인: ${item.domain} → 불법 사이트 리스트 및 결과 파일에 반영됨`)
      
      return c.json({
        success: true,
        message: `${item.domain}이(가) 불법 사이트로 등록되었고, 모든 결과 파일에 반영되었습니다.`,
        action: 'approved',
        domain: item.domain,
      })
    } else if (action === 'reject') {
      // 합법 사이트 리스트에 추가
      addToSiteList(LEGAL_SITES_FILE, item.domain)
      
      // 모든 세션의 결과 파일 업데이트 (실시간 반영)
      updateResultsForDomain(item.domain, 'legal', sessionsData.sessions)
      
      // 세션 데이터 저장
      saveSessions(sessionsData)
      
      // 대기 목록에서 제거
      items.splice(itemIndex, 1)
      savePendingReviews(items)
      
      console.log(`❌ 거절: ${item.domain} → 합법 사이트 리스트 및 결과 파일에 반영됨`)
      
      return c.json({
        success: true,
        message: `${item.domain}이(가) 합법 사이트로 등록되었고, 모든 결과 파일에 반영되었습니다.`,
        action: 'rejected',
        domain: item.domain,
      })
    } else if (action === 'hold') {
      console.log(`⏸️ 보류: ${item.domain}`)
      
      return c.json({
        success: true,
        message: `${item.domain}이(가) 보류되었습니다.`,
        action: 'held',
        domain: item.domain,
      })
    } else {
      return c.json({ success: false, error: 'Invalid action' }, 400)
    }
  } catch (error) {
    console.error('Review error:', error)
    return c.json({ success: false, error: 'Internal server error' }, 500)
  }
})

// 통계 조회
app.get('/api/stats', (c) => {
  const items = loadPendingReviews()
  
  const stats = {
    total: items.length,
    likely_illegal: items.filter(i => i.llm_judgment === 'likely_illegal').length,
    likely_legal: items.filter(i => i.llm_judgment === 'likely_legal').length,
    uncertain: items.filter(i => i.llm_judgment === 'uncertain').length,
  }
  
  return c.json({ success: true, stats })
})

// 불법/합법 사이트 리스트 조회
app.get('/api/sites/:type', (c) => {
  const type = c.req.param('type')
  const filePath = type === 'illegal' ? ILLEGAL_SITES_FILE : LEGAL_SITES_FILE
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const sites = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
    
    return c.json({
      success: true,
      type,
      count: sites.length,
      sites,
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load sites' }, 500)
  }
})

// ============================================
// API 엔드포인트 - 세션(회차) 관련
// ============================================

// 모든 세션 목록 조회
app.get('/api/sessions', (c) => {
  const sessionsData = scanAndUpdateSessions()
  
  return c.json({
    success: true,
    count: sessionsData.sessions.length,
    sessions: sessionsData.sessions,
    last_updated: sessionsData.last_updated,
  })
})

// 특정 세션 상세 조회
app.get('/api/sessions/:id', (c) => {
  const id = c.req.param('id')
  const sessionsData = scanAndUpdateSessions()
  const session = sessionsData.sessions.find(s => s.id === id)
  
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }
  
  return c.json({ success: true, session })
})

// 특정 세션의 결과 데이터 조회
app.get('/api/sessions/:id/results', (c) => {
  const id = c.req.param('id')
  const filter = c.req.query('filter') // 'all', 'illegal', 'legal', 'pending'
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  
  const sessionsData = scanAndUpdateSessions()
  const session = sessionsData.sessions.find(s => s.id === id)
  
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }
  
  const finalResultsPath = path.join(process.cwd(), session.files.final_results)
  
  if (!fs.existsSync(finalResultsPath)) {
    return c.json({ success: false, error: 'Results file not found' }, 404)
  }
  
  let results = loadFinalResults(finalResultsPath)
  
  // 필터 적용
  if (filter && filter !== 'all') {
    results = results.filter(r => r.final_status === filter)
  }
  
  // 페이지네이션
  const total = results.length
  const startIndex = (page - 1) * limit
  const endIndex = startIndex + limit
  const paginatedResults = results.slice(startIndex, endIndex)
  
  return c.json({
    success: true,
    session_id: id,
    filter: filter || 'all',
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
    results: paginatedResults,
  })
})

// Excel 파일 다운로드
app.get('/api/sessions/:id/download', (c) => {
  const id = c.req.param('id')
  const sessionsData = scanAndUpdateSessions()
  const session = sessionsData.sessions.find(s => s.id === id)
  
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }
  
  const excelPath = path.join(process.cwd(), session.files.excel_report)
  
  if (!fs.existsSync(excelPath)) {
    return c.json({ success: false, error: 'Excel file not found' }, 404)
  }
  
  const fileBuffer = fs.readFileSync(excelPath)
  const fileName = path.basename(excelPath)
  
  return new Response(fileBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
})

// ============================================
// 메인 페이지 (승인 UI + 세션 결과 조회)
// ============================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>웹툰 불법사이트 모니터링</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    .judgment-likely_illegal { background-color: #fee2e2; border-color: #ef4444; }
    .judgment-likely_legal { background-color: #dcfce7; border-color: #22c55e; }
    .judgment-uncertain { background-color: #fef3c7; border-color: #f59e0b; }
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
            웹툰 불법사이트 모니터링
          </h1>
          <p class="text-gray-600 mt-1">불법 사이트 탐지 및 승인 시스템</p>
        </div>
        <button onclick="refresh()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition">
          <i class="fas fa-sync-alt mr-2"></i>새로고침
        </button>
      </div>
    </div>

    <!-- 탭 네비게이션 -->
    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="flex border-b">
        <button onclick="switchTab('pending')" id="tab-pending" 
                class="px-6 py-4 text-gray-600 hover:text-blue-600 transition tab-active">
          <i class="fas fa-clock mr-2"></i>승인 대기
          <span id="pending-badge" class="ml-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full">0</span>
        </button>
        <button onclick="switchTab('sessions')" id="tab-sessions" 
                class="px-6 py-4 text-gray-600 hover:text-blue-600 transition">
          <i class="fas fa-history mr-2"></i>모니터링 회차
          <span id="sessions-badge" class="ml-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">0</span>
        </button>
        <button onclick="switchTab('sites')" id="tab-sites" 
                class="px-6 py-4 text-gray-600 hover:text-blue-600 transition">
          <i class="fas fa-database mr-2"></i>사이트 목록
        </button>
      </div>
    </div>

    <!-- 승인 대기 탭 -->
    <div id="content-pending" class="tab-content">
      <!-- 통계 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-lg shadow-md p-4 text-center">
          <div class="text-3xl font-bold text-gray-800" id="stat-total">0</div>
          <div class="text-gray-600">전체</div>
        </div>
        <div class="bg-red-50 rounded-lg shadow-md p-4 text-center border-l-4 border-red-500">
          <div class="text-3xl font-bold text-red-600" id="stat-illegal">0</div>
          <div class="text-gray-600">불법 추정</div>
        </div>
        <div class="bg-green-50 rounded-lg shadow-md p-4 text-center border-l-4 border-green-500">
          <div class="text-3xl font-bold text-green-600" id="stat-legal">0</div>
          <div class="text-gray-600">합법 추정</div>
        </div>
        <div class="bg-yellow-50 rounded-lg shadow-md p-4 text-center border-l-4 border-yellow-500">
          <div class="text-3xl font-bold text-yellow-600" id="stat-uncertain">0</div>
          <div class="text-gray-600">불확실</div>
        </div>
      </div>

      <!-- 승인 대기 목록 -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-lg font-semibold text-gray-800 mb-4">
          <i class="fas fa-list mr-2"></i>승인 대기 목록
        </h2>
        <div id="pending-list" class="space-y-4">
          <div class="text-center text-gray-500 py-8">
            <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
            <p>로딩 중...</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 모니터링 회차 탭 -->
    <div id="content-sessions" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-lg font-semibold text-gray-800 mb-4">
          <i class="fas fa-calendar-alt mr-2"></i>모니터링 세션 목록
        </h2>
        <div id="sessions-list" class="space-y-4">
          <div class="text-center text-gray-500 py-8">
            <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
            <p>로딩 중...</p>
          </div>
        </div>
      </div>

      <!-- 세션 상세 결과 (동적으로 표시) -->
      <div id="session-detail" class="hidden">
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-gray-800">
              <i class="fas fa-chart-bar mr-2"></i>
              세션 상세 결과: <span id="detail-session-id"></span>
            </h2>
            <div class="flex gap-2">
              <select id="result-filter" onchange="loadSessionResults()" 
                      class="border rounded-lg px-3 py-2">
                <option value="all">전체</option>
                <option value="illegal">불법</option>
                <option value="legal">합법</option>
                <option value="pending">승인대기</option>
              </select>
              <button onclick="downloadExcel()" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition">
                <i class="fas fa-download mr-2"></i>Excel 다운로드
              </button>
              <button onclick="closeSessionDetail()" class="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg transition">
                <i class="fas fa-times mr-2"></i>닫기
              </button>
            </div>
          </div>

          <!-- 세션 요약 통계 -->
          <div class="grid grid-cols-4 gap-4 mb-4">
            <div class="bg-gray-50 rounded p-3 text-center">
              <div class="text-2xl font-bold text-gray-800" id="detail-total">0</div>
              <div class="text-sm text-gray-600">전체</div>
            </div>
            <div class="bg-red-50 rounded p-3 text-center">
              <div class="text-2xl font-bold text-red-600" id="detail-illegal">0</div>
              <div class="text-sm text-gray-600">불법</div>
            </div>
            <div class="bg-green-50 rounded p-3 text-center">
              <div class="text-2xl font-bold text-green-600" id="detail-legal">0</div>
              <div class="text-sm text-gray-600">합법</div>
            </div>
            <div class="bg-yellow-50 rounded p-3 text-center">
              <div class="text-2xl font-bold text-yellow-600" id="detail-pending">0</div>
              <div class="text-sm text-gray-600">대기</div>
            </div>
          </div>

          <!-- 결과 테이블 -->
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-4 py-2 text-left">#</th>
                  <th class="px-4 py-2 text-left">작품명</th>
                  <th class="px-4 py-2 text-left">도메인</th>
                  <th class="px-4 py-2 text-left">순위</th>
                  <th class="px-4 py-2 text-left">상태</th>
                  <th class="px-4 py-2 text-left">LLM 판단</th>
                  <th class="px-4 py-2 text-left">검토일시</th>
                </tr>
              </thead>
              <tbody id="results-table">
              </tbody>
            </table>
          </div>

          <!-- 페이지네이션 -->
          <div id="pagination" class="flex justify-center gap-2 mt-4">
          </div>
        </div>
      </div>
    </div>

    <!-- 사이트 목록 탭 -->
    <div id="content-sites" class="tab-content hidden">
      <div class="grid grid-cols-2 gap-6">
        <!-- 불법 사이트 목록 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-lg font-semibold text-red-600 mb-4">
            <i class="fas fa-ban mr-2"></i>불법 사이트 목록
            <span id="illegal-sites-count" class="text-sm text-gray-500 font-normal">(0개)</span>
          </h2>
          <div id="illegal-sites-list" class="max-h-96 overflow-y-auto space-y-1 text-sm">
          </div>
        </div>

        <!-- 합법 사이트 목록 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-lg font-semibold text-green-600 mb-4">
            <i class="fas fa-check-circle mr-2"></i>합법 사이트 목록
            <span id="legal-sites-count" class="text-sm text-gray-500 font-normal">(0개)</span>
          </h2>
          <div id="legal-sites-list" class="max-h-96 overflow-y-auto space-y-1 text-sm">
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // 현재 탭
    let currentTab = 'pending';
    let currentSessionId = null;
    let currentPage = 1;

    // API 호출 함수
    async function fetchAPI(url, options = {}) {
      try {
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' },
          ...options,
        });
        return await response.json();
      } catch (error) {
        console.error('API Error:', error);
        return { success: false, error: error.message };
      }
    }

    // 탭 전환
    function switchTab(tab) {
      currentTab = tab;
      
      // 모든 탭 버튼에서 active 제거
      document.querySelectorAll('[id^="tab-"]').forEach(el => {
        el.classList.remove('tab-active');
      });
      
      // 현재 탭 버튼에 active 추가
      document.getElementById('tab-' + tab).classList.add('tab-active');
      
      // 모든 컨텐츠 숨기기
      document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
      });
      
      // 현재 탭 컨텐츠 표시
      document.getElementById('content-' + tab).classList.remove('hidden');
      
      // 탭별 데이터 로드
      if (tab === 'pending') {
        loadPendingItems();
      } else if (tab === 'sessions') {
        loadSessions();
      } else if (tab === 'sites') {
        loadSites();
      }
    }

    // 새로고침
    function refresh() {
      if (currentTab === 'pending') {
        loadPendingItems();
      } else if (currentTab === 'sessions') {
        loadSessions();
        if (currentSessionId) {
          loadSessionResults();
        }
      } else if (currentTab === 'sites') {
        loadSites();
      }
    }

    // ============================================
    // 승인 대기 탭
    // ============================================

    async function loadStats() {
      const data = await fetchAPI('/api/stats');
      if (data.success) {
        document.getElementById('stat-total').textContent = data.stats.total;
        document.getElementById('stat-illegal').textContent = data.stats.likely_illegal;
        document.getElementById('stat-legal').textContent = data.stats.likely_legal;
        document.getElementById('stat-uncertain').textContent = data.stats.uncertain;
        document.getElementById('pending-badge').textContent = data.stats.total;
      }
    }

    async function loadPendingItems() {
      const listEl = document.getElementById('pending-list');
      listEl.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>로딩 중...</p></div>';
      
      const data = await fetchAPI('/api/pending');
      
      if (!data.success || data.items.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-check-circle text-4xl mb-2 text-green-500"></i><p>승인 대기 중인 항목이 없습니다.</p></div>';
        loadStats();
        return;
      }

      listEl.innerHTML = data.items.map((item, index) => \`
        <div class="border-2 rounded-lg p-4 judgment-\${item.llm_judgment}" id="item-\${item.id}">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-lg font-semibold text-gray-800">#\${index + 1}</span>
                <span class="text-xl font-bold text-blue-600">\${item.domain}</span>
                <span class="px-2 py-1 rounded text-xs font-medium \${
                  item.llm_judgment === 'likely_illegal' ? 'bg-red-500 text-white' :
                  item.llm_judgment === 'likely_legal' ? 'bg-green-500 text-white' :
                  'bg-yellow-500 text-white'
                }">
                  \${item.llm_judgment === 'likely_illegal' ? '불법 추정' :
                    item.llm_judgment === 'likely_legal' ? '합법 추정' : '불확실'}
                </span>
              </div>
              
              <div class="text-sm text-gray-600 mb-2">
                <i class="fas fa-link mr-1"></i>
                관련 URL: \${item.urls.length}개
                <span class="ml-2 text-blue-500 cursor-pointer" onclick="toggleUrls('\${item.id}')">[보기]</span>
              </div>
              
              <div id="urls-\${item.id}" class="hidden bg-gray-50 rounded p-2 mb-2 text-xs">
                \${item.urls.slice(0, 10).map(url => \`<div class="truncate"><a href="\${url}" target="_blank" class="text-blue-500 hover:underline">\${url}</a></div>\`).join('')}
                \${item.urls.length > 10 ? \`<div class="text-gray-400">... 외 \${item.urls.length - 10}개</div>\` : ''}
              </div>
              
              <div class="text-sm text-gray-600 mb-2">
                <i class="fas fa-book mr-1"></i>
                관련 작품: \${item.titles.slice(0, 5).join(', ')}\${item.titles.length > 5 ? ' 외 ' + (item.titles.length - 5) + '개' : ''}
              </div>
              
              <div class="bg-gray-100 rounded p-3 text-sm">
                <i class="fas fa-robot mr-1 text-purple-500"></i>
                <strong>LLM 판단 근거:</strong> \${item.llm_reason || '없음'}
              </div>
              
              <div class="mt-2 text-xs text-gray-400">
                생성: \${new Date(item.created_at).toLocaleString('ko-KR')}
              </div>
            </div>
            
            <div class="flex flex-col gap-2 ml-4">
              <button onclick="handleReview('\${item.id}', 'approve')" 
                      class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition flex items-center">
                <i class="fas fa-check mr-2"></i>승인 (불법)
              </button>
              <button onclick="handleReview('\${item.id}', 'reject')" 
                      class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition flex items-center">
                <i class="fas fa-times mr-2"></i>거절 (합법)
              </button>
              <button onclick="handleReview('\${item.id}', 'hold')" 
                      class="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg transition flex items-center">
                <i class="fas fa-pause mr-2"></i>보류
              </button>
            </div>
          </div>
        </div>
      \`).join('');

      loadStats();
    }

    function toggleUrls(id) {
      const el = document.getElementById('urls-' + id);
      el.classList.toggle('hidden');
    }

    async function handleReview(id, action) {
      const actionText = action === 'approve' ? '승인(불법 등록)' : 
                        action === 'reject' ? '거절(합법 등록)' : '보류';
      
      if (!confirm(\`이 도메인을 \${actionText} 처리하시겠습니까?\\n\\n✅ 결과가 모든 세션의 파일(JSON/Excel)에 실시간으로 반영됩니다.\`)) {
        return;
      }

      const data = await fetchAPI('/api/review', {
        method: 'POST',
        body: JSON.stringify({ id, action }),
      });

      if (data.success) {
        alert(data.message);
        loadPendingItems();
      } else {
        alert('오류: ' + (data.error || '처리 실패'));
      }
    }

    // ============================================
    // 모니터링 회차 탭
    // ============================================

    async function loadSessions() {
      const listEl = document.getElementById('sessions-list');
      listEl.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>로딩 중...</p></div>';
      
      const data = await fetchAPI('/api/sessions');
      
      if (!data.success || data.sessions.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-folder-open text-4xl mb-2"></i><p>모니터링 세션이 없습니다.</p></div>';
        document.getElementById('sessions-badge').textContent = '0';
        return;
      }

      document.getElementById('sessions-badge').textContent = data.sessions.length;

      listEl.innerHTML = data.sessions.map((session, index) => \`
        <div class="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition" 
             onclick="openSessionDetail('\${session.id}')">
          <div class="flex justify-between items-center">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-lg font-semibold text-blue-600">
                  <i class="fas fa-clock mr-1"></i>
                  \${session.id}
                </span>
                <span class="px-2 py-1 rounded text-xs \${
                  session.status === 'completed' ? 'bg-green-100 text-green-700' :
                  session.status === 'running' ? 'bg-blue-100 text-blue-700' :
                  'bg-red-100 text-red-700'
                }">
                  \${session.status === 'completed' ? '완료' : 
                    session.status === 'running' ? '실행중' : '오류'}
                </span>
              </div>
              <div class="text-sm text-gray-600">
                작품 \${session.titles_count}개 × 키워드 \${session.keywords_count}개 = 검색 \${session.total_searches}회
              </div>
            </div>
            <div class="flex gap-4 text-center">
              <div>
                <div class="text-xl font-bold text-gray-800">\${session.results_summary.total}</div>
                <div class="text-xs text-gray-500">전체</div>
              </div>
              <div>
                <div class="text-xl font-bold text-red-600">\${session.results_summary.illegal}</div>
                <div class="text-xs text-gray-500">불법</div>
              </div>
              <div>
                <div class="text-xl font-bold text-green-600">\${session.results_summary.legal}</div>
                <div class="text-xs text-gray-500">합법</div>
              </div>
              <div>
                <div class="text-xl font-bold text-yellow-600">\${session.results_summary.pending}</div>
                <div class="text-xs text-gray-500">대기</div>
              </div>
            </div>
          </div>
        </div>
      \`).join('');
    }

    function openSessionDetail(sessionId) {
      currentSessionId = sessionId;
      currentPage = 1;
      document.getElementById('detail-session-id').textContent = sessionId;
      document.getElementById('session-detail').classList.remove('hidden');
      document.getElementById('result-filter').value = 'all';
      loadSessionResults();
    }

    function closeSessionDetail() {
      currentSessionId = null;
      document.getElementById('session-detail').classList.add('hidden');
    }

    async function loadSessionResults() {
      if (!currentSessionId) return;

      const filter = document.getElementById('result-filter').value;
      const tableEl = document.getElementById('results-table');
      tableEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</td></tr>';

      const data = await fetchAPI(\`/api/sessions/\${currentSessionId}/results?filter=\${filter}&page=\${currentPage}&limit=50\`);
      
      if (!data.success) {
        tableEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">데이터 로드 실패</td></tr>';
        return;
      }

      // 통계 업데이트
      const sessionData = await fetchAPI(\`/api/sessions/\${currentSessionId}\`);
      if (sessionData.success) {
        document.getElementById('detail-total').textContent = sessionData.session.results_summary.total;
        document.getElementById('detail-illegal').textContent = sessionData.session.results_summary.illegal;
        document.getElementById('detail-legal').textContent = sessionData.session.results_summary.legal;
        document.getElementById('detail-pending').textContent = sessionData.session.results_summary.pending;
      }

      if (data.results.length === 0) {
        tableEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">결과가 없습니다.</td></tr>';
        document.getElementById('pagination').innerHTML = '';
        return;
      }

      tableEl.innerHTML = data.results.map((result, index) => \`
        <tr class="border-b hover:bg-gray-50">
          <td class="px-4 py-2">\${(currentPage - 1) * 50 + index + 1}</td>
          <td class="px-4 py-2">\${result.title}</td>
          <td class="px-4 py-2">
            <a href="\${result.url}" target="_blank" class="text-blue-500 hover:underline">
              \${result.domain}
            </a>
          </td>
          <td class="px-4 py-2">P\${result.page}-#\${result.rank}</td>
          <td class="px-4 py-2">
            <span class="px-2 py-1 rounded text-xs text-white status-\${result.final_status}">
              \${result.final_status === 'illegal' ? '불법' : 
                result.final_status === 'legal' ? '합법' : '대기'}
            </span>
          </td>
          <td class="px-4 py-2 text-xs text-gray-600">
            \${result.llm_judgment ? (
              result.llm_judgment === 'likely_illegal' ? '🔴 불법추정' :
              result.llm_judgment === 'likely_legal' ? '🟢 합법추정' : '🟡 불확실'
            ) : '-'}
          </td>
          <td class="px-4 py-2 text-xs text-gray-500">
            \${result.reviewed_at ? new Date(result.reviewed_at).toLocaleString('ko-KR') : '-'}
          </td>
        </tr>
      \`).join('');

      // 페이지네이션 렌더링
      renderPagination(data.pagination);
    }

    function renderPagination(pagination) {
      const paginationEl = document.getElementById('pagination');
      
      if (pagination.total_pages <= 1) {
        paginationEl.innerHTML = '';
        return;
      }

      let html = '';
      
      // 이전 버튼
      if (currentPage > 1) {
        html += \`<button onclick="goToPage(\${currentPage - 1})" class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">이전</button>\`;
      }

      // 페이지 번호
      const startPage = Math.max(1, currentPage - 2);
      const endPage = Math.min(pagination.total_pages, currentPage + 2);

      for (let i = startPage; i <= endPage; i++) {
        html += \`<button onclick="goToPage(\${i})" class="px-3 py-1 rounded \${i === currentPage ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}">\${i}</button>\`;
      }

      // 다음 버튼
      if (currentPage < pagination.total_pages) {
        html += \`<button onclick="goToPage(\${currentPage + 1})" class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">다음</button>\`;
      }

      paginationEl.innerHTML = html;
    }

    function goToPage(page) {
      currentPage = page;
      loadSessionResults();
    }

    function downloadExcel() {
      if (!currentSessionId) return;
      window.open(\`/api/sessions/\${currentSessionId}/download\`, '_blank');
    }

    // ============================================
    // 사이트 목록 탭
    // ============================================

    async function loadSites() {
      // 불법 사이트
      const illegalData = await fetchAPI('/api/sites/illegal');
      const illegalListEl = document.getElementById('illegal-sites-list');
      document.getElementById('illegal-sites-count').textContent = \`(\${illegalData.count || 0}개)\`;
      
      if (illegalData.success && illegalData.sites.length > 0) {
        illegalListEl.innerHTML = illegalData.sites.map(site => 
          \`<div class="px-2 py-1 bg-red-50 rounded">\${site}</div>\`
        ).join('');
      } else {
        illegalListEl.innerHTML = '<div class="text-gray-500">목록이 없습니다.</div>';
      }

      // 합법 사이트
      const legalData = await fetchAPI('/api/sites/legal');
      const legalListEl = document.getElementById('legal-sites-list');
      document.getElementById('legal-sites-count').textContent = \`(\${legalData.count || 0}개)\`;
      
      if (legalData.success && legalData.sites.length > 0) {
        legalListEl.innerHTML = legalData.sites.map(site => 
          \`<div class="px-2 py-1 bg-green-50 rounded">\${site}</div>\`
        ).join('');
      } else {
        legalListEl.innerHTML = '<div class="text-gray-500">목록이 없습니다.</div>';
      }
    }

    // ============================================
    // 초기 로드
    // ============================================

    loadPendingItems();
  </script>
</body>
</html>
  `)
})

// ============================================
// 서버 시작
// ============================================

const port = 3000

console.log(`
🚀 웹툰 불법사이트 모니터링 서버 시작!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: http://localhost:${port}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 주요 기능:
   - 승인 대기 목록 관리
   - 모니터링 회차별 결과 조회
   - 실시간 결과 파일 반영
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 API 엔드포인트:
   GET  /api/pending          - 승인 대기 목록
   POST /api/review           - 승인/거절/보류 처리
   GET  /api/stats            - 통계
   GET  /api/sessions         - 세션 목록
   GET  /api/sessions/:id     - 세션 상세
   GET  /api/sessions/:id/results - 세션 결과
   GET  /api/sessions/:id/download - Excel 다운로드
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)

serve({
  fetch: app.fetch,
  port,
})
