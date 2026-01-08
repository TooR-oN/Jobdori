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
const TITLES_FILE = path.join(DATA_DIR, 'titles.json')
const MONTHLY_STATS_FILE = path.join(DATA_DIR, 'monthly-stats.json')

// 모니터링 진행 상태 (메모리)
let monitoringStatus = {
  isRunning: false,
  currentStep: '',
  progress: 0,
  total: 0,
  message: '',
  startedAt: null as string | null,
}

// 작품 목록 타입
interface TitlesData {
  current: string[]
  history: string[]
  last_updated: string
}

// 월별 통계 타입
interface MonthlyStatsEntry {
  month: string // YYYY-MM 형식
  sessions_count: number
  total_stats: {
    total: number
    illegal: number
    legal: number
    pending: number
  }
  top_contents: Array<{
    title: string
    illegal_count: number
    manta_rank_diff: number | null
    first_rank_domain: string | null
  }>
  top_illegal_sites: Array<{
    domain: string
    count: number
  }>
  last_updated: string
}

interface MonthlyStatsData {
  months: MonthlyStatsEntry[]
  last_updated: string
}

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

// 작품 목록 로드
function loadTitles(): TitlesData {
  try {
    if (fs.existsSync(TITLES_FILE)) {
      const content = fs.readFileSync(TITLES_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Failed to load titles:', error)
  }
  return { current: [], history: [], last_updated: new Date().toISOString() }
}

// 작품 목록 저장
function saveTitles(data: TitlesData): void {
  data.last_updated = new Date().toISOString()
  fs.writeFileSync(TITLES_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

function saveSessions(data: SessionsData): void {
  data.last_updated = new Date().toISOString()
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

// 월별 통계 로드
function loadMonthlyStats(): MonthlyStatsData {
  try {
    if (fs.existsSync(MONTHLY_STATS_FILE)) {
      const content = fs.readFileSync(MONTHLY_STATS_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Failed to load monthly stats:', error)
  }
  return { months: [], last_updated: new Date().toISOString() }
}

// 월별 통계 저장
function saveMonthlyStats(data: MonthlyStatsData): void {
  data.last_updated = new Date().toISOString()
  fs.writeFileSync(MONTHLY_STATS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

// 특정 월의 통계 계산 및 저장
function updateMonthlyStats(targetMonth?: string): MonthlyStatsEntry | null {
  const sessionsData = scanAndUpdateSessions()
  
  // 대상 월 결정 (기본: 현재 월)
  const now = new Date()
  const month = targetMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [year, monthNum] = month.split('-').map(Number)
  
  // 해당 월의 세션만 필터링
  const monthlySessions = sessionsData.sessions.filter(session => {
    const sessionDate = new Date(session.created_at)
    return sessionDate.getFullYear() === year && sessionDate.getMonth() === monthNum - 1
  })
  
  if (monthlySessions.length === 0) {
    return null
  }
  
  // 모든 월간 세션의 결과 합산
  const allResults: FinalResult[] = []
  for (const session of monthlySessions) {
    const finalResultsPath = path.join(process.cwd(), session.files.final_results)
    if (fs.existsSync(finalResultsPath)) {
      const results = loadFinalResults(finalResultsPath)
      allResults.push(...results)
    }
  }
  
  // URL 중복 제거
  const uniqueResults = allResults.filter((result, index, arr) => 
    arr.findIndex(r => r.url === result.url) === index
  )
  
  // 작품별 통계 계산
  const titleStats = new Map<string, { 
    illegalCount: number, 
    mantaRankDiff: number | null,
    firstRankDomain: string | null 
  }>()
  
  for (const result of uniqueResults) {
    if (!titleStats.has(result.title)) {
      titleStats.set(result.title, { illegalCount: 0, mantaRankDiff: null, firstRankDomain: null })
    }
    
    const stats = titleStats.get(result.title)!
    
    if (result.final_status === 'illegal') {
      stats.illegalCount++
    }
    
    // 작품명만 검색 결과에서 순위 계산
    if (result.search_query === result.title && result.page === 1) {
      if (result.rank === 1) {
        stats.firstRankDomain = result.domain
      }
      if (result.domain === 'manta.net') {
        stats.mantaRankDiff = result.rank - 1
      }
    }
  }
  
  // Top 5 콘텐츠
  const topContents = Array.from(titleStats.entries())
    .map(([title, stats]) => ({
      title,
      illegal_count: stats.illegalCount,
      manta_rank_diff: stats.mantaRankDiff,
      first_rank_domain: stats.firstRankDomain
    }))
    .sort((a, b) => b.illegal_count - a.illegal_count)
    .slice(0, 5)
  
  // 상위 불법 사이트 Top 5
  const domainCounts = new Map<string, number>()
  for (const result of uniqueResults) {
    if (result.final_status === 'illegal') {
      const count = domainCounts.get(result.domain) || 0
      domainCounts.set(result.domain, count + 1)
    }
  }
  
  const topIllegalSites = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  
  // 통계 엔트리 생성
  const statsEntry: MonthlyStatsEntry = {
    month,
    sessions_count: monthlySessions.length,
    total_stats: {
      total: uniqueResults.length,
      illegal: uniqueResults.filter(r => r.final_status === 'illegal').length,
      legal: uniqueResults.filter(r => r.final_status === 'legal').length,
      pending: uniqueResults.filter(r => r.final_status === 'pending').length
    },
    top_contents: topContents,
    top_illegal_sites: topIllegalSites,
    last_updated: new Date().toISOString()
  }
  
  // 기존 데이터 로드 및 업데이트
  const monthlyData = loadMonthlyStats()
  const existingIndex = monthlyData.months.findIndex(m => m.month === month)
  
  if (existingIndex >= 0) {
    monthlyData.months[existingIndex] = statsEntry
  } else {
    monthlyData.months.push(statsEntry)
    // 월 기준 정렬 (최신순)
    monthlyData.months.sort((a, b) => b.month.localeCompare(a.month))
  }
  
  saveMonthlyStats(monthlyData)
  console.log(`📊 월별 통계 업데이트: ${month}`)
  
  return statsEntry
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
 * JSON 결과에서 Excel Buffer 생성 (다운로드용 실시간 변환)
 */
function generateExcelFromResults(results: FinalResult[]): Buffer {
  const columns = [
    'title', 'domain', 'url', 'search_query', 'page', 'rank',
    'status', 'llm_judgment', 'llm_reason', 'final_status', 'reviewed_at'
  ]

  const colWidths = [
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

  // 새 워크북 생성
  const wb = XLSX.utils.book_new()

  // 전체 결과 시트
  const allData = [columns, ...results.map(r => columns.map(col => (r as any)[col] ?? ''))]
  const allWs = XLSX.utils.aoa_to_sheet(allData)
  allWs['!cols'] = colWidths
  XLSX.utils.book_append_sheet(wb, allWs, '전체 결과')

  // 불법 사이트 시트
  const illegalResults = results.filter(r => r.final_status === 'illegal')
  if (illegalResults.length > 0) {
    const illegalData = [columns, ...illegalResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const illegalWs = XLSX.utils.aoa_to_sheet(illegalData)
    illegalWs['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, illegalWs, '불법 사이트')
  }

  // 합법 사이트 시트
  const legalResults = results.filter(r => r.final_status === 'legal')
  if (legalResults.length > 0) {
    const legalData = [columns, ...legalResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const legalWs = XLSX.utils.aoa_to_sheet(legalData)
    legalWs['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, legalWs, '합법 사이트')
  }

  // 승인 대기 시트
  const pendingResults = results.filter(r => r.final_status === 'pending')
  if (pendingResults.length > 0) {
    const pendingData = [columns, ...pendingResults.map(r => columns.map(col => (r as any)[col] ?? ''))]
    const pendingWs = XLSX.utils.aoa_to_sheet(pendingData)
    pendingWs['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, pendingWs, '승인 대기')
  }

  // Buffer로 반환
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

/**
 * Excel 파일 업데이트 (실시간 반영) - 더 이상 사용하지 않음
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

// 사이트 추가
app.post('/api/sites/:type', async (c) => {
  const type = c.req.param('type')
  const filePath = type === 'illegal' ? ILLEGAL_SITES_FILE : LEGAL_SITES_FILE
  
  try {
    const { domain } = await c.req.json<{ domain: string }>()
    
    if (!domain || !domain.trim()) {
      return c.json({ success: false, error: '도메인을 입력해주세요.' }, 400)
    }
    
    const trimmedDomain = domain.trim().toLowerCase()
    
    // 현재 목록 읽기
    const content = fs.readFileSync(filePath, 'utf-8')
    const sites = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
    
    // 이미 있는지 확인
    if (sites.includes(trimmedDomain)) {
      return c.json({ success: false, error: '이미 등록된 도메인입니다.' }, 400)
    }
    
    // 추가
    const newContent = content.trimEnd() + '\n' + trimmedDomain + '\n'
    fs.writeFileSync(filePath, newContent, 'utf-8')
    
    console.log(`➕ ${type} 사이트 추가: ${trimmedDomain}`)
    
    return c.json({
      success: true,
      message: `'${trimmedDomain}'이(가) ${type === 'illegal' ? '불법' : '합법'} 사이트 목록에 추가되었습니다.`,
      domain: trimmedDomain
    })
  } catch (error) {
    return c.json({ success: false, error: '사이트 추가 실패' }, 500)
  }
})

// 사이트 삭제
app.delete('/api/sites/:type/:domain', (c) => {
  const type = c.req.param('type')
  const domain = decodeURIComponent(c.req.param('domain')).toLowerCase()
  const filePath = type === 'illegal' ? ILLEGAL_SITES_FILE : LEGAL_SITES_FILE
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    
    // 해당 도메인 제거
    const newLines = lines.filter(line => {
      const trimmed = line.trim().toLowerCase()
      return trimmed !== domain
    })
    
    if (lines.length === newLines.length) {
      return c.json({ success: false, error: '목록에 없는 도메인입니다.' }, 404)
    }
    
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8')
    
    console.log(`➖ ${type} 사이트 삭제: ${domain}`)
    
    return c.json({
      success: true,
      message: `'${domain}'이(가) ${type === 'illegal' ? '불법' : '합법'} 사이트 목록에서 삭제되었습니다.`,
      domain
    })
  } catch (error) {
    return c.json({ success: false, error: '사이트 삭제 실패' }, 500)
  }
})

// ============================================
// API 엔드포인트 - 작품 관리
// ============================================

// 작품 목록 조회
app.get('/api/titles', (c) => {
  const titles = loadTitles()
  return c.json({
    success: true,
    current: titles.current,
    history: titles.history,
    current_count: titles.current.length,
    history_count: titles.history.length,
    last_updated: titles.last_updated,
  })
})

// 현재 목록에 작품 추가
app.post('/api/titles/current', async (c) => {
  try {
    const { title } = await c.req.json<{ title: string }>()
    
    if (!title || !title.trim()) {
      return c.json({ success: false, error: '작품명을 입력해주세요.' }, 400)
    }
    
    const trimmedTitle = title.trim()
    const titles = loadTitles()
    
    // 이미 현재 목록에 있는지 확인
    if (titles.current.includes(trimmedTitle)) {
      return c.json({ success: false, error: '이미 현재 목록에 있는 작품입니다.' }, 400)
    }
    
    // 현재 목록에 추가
    titles.current.push(trimmedTitle)
    
    // 히스토리에서 제거 (있다면)
    titles.history = titles.history.filter(t => t !== trimmedTitle)
    
    saveTitles(titles)
    
    console.log(`➕ 작품 추가: ${trimmedTitle}`)
    
    return c.json({
      success: true,
      message: `'${trimmedTitle}'이(가) 현재 목록에 추가되었습니다.`,
      current: titles.current,
      history: titles.history,
    })
  } catch (error) {
    return c.json({ success: false, error: '작품 추가 실패' }, 500)
  }
})

// 현재 목록에서 작품 제거 (히스토리로 이동)
app.delete('/api/titles/current/:title', (c) => {
  const title = decodeURIComponent(c.req.param('title'))
  const titles = loadTitles()
  
  const index = titles.current.indexOf(title)
  if (index === -1) {
    return c.json({ success: false, error: '현재 목록에 없는 작품입니다.' }, 404)
  }
  
  // 현재 목록에서 제거
  titles.current.splice(index, 1)
  
  // 히스토리에 추가 (중복 방지)
  if (!titles.history.includes(title)) {
    titles.history.unshift(title) // 맨 앞에 추가
  }
  
  saveTitles(titles)
  
  console.log(`➖ 작품 제거: ${title} → 히스토리로 이동`)
  
  return c.json({
    success: true,
    message: `'${title}'이(가) 현재 목록에서 제거되었습니다.`,
    current: titles.current,
    history: titles.history,
  })
})

// 히스토리에서 현재 목록으로 복원
app.post('/api/titles/restore', async (c) => {
  try {
    const { title } = await c.req.json<{ title: string }>()
    const titles = loadTitles()
    
    const index = titles.history.indexOf(title)
    if (index === -1) {
      return c.json({ success: false, error: '히스토리에 없는 작품입니다.' }, 404)
    }
    
    // 이미 현재 목록에 있는지 확인
    if (titles.current.includes(title)) {
      return c.json({ success: false, error: '이미 현재 목록에 있는 작품입니다.' }, 400)
    }
    
    // 히스토리에서 제거
    titles.history.splice(index, 1)
    
    // 현재 목록에 추가
    titles.current.push(title)
    
    saveTitles(titles)
    
    console.log(`🔄 작품 복원: ${title} → 현재 목록으로 이동`)
    
    return c.json({
      success: true,
      message: `'${title}'이(가) 현재 목록으로 복원되었습니다.`,
      current: titles.current,
      history: titles.history,
    })
  } catch (error) {
    return c.json({ success: false, error: '작품 복원 실패' }, 500)
  }
})

// ============================================
// API 엔드포인트 - 모니터링 실행
// ============================================

// 모니터링 상태 조회
app.get('/api/monitoring/status', (c) => {
  return c.json({
    success: true,
    ...monitoringStatus,
  })
})

// 모니터링 시작
app.post('/api/monitoring/start', async (c) => {
  if (monitoringStatus.isRunning) {
    return c.json({ success: false, error: '이미 모니터링이 실행 중입니다.' }, 400)
  }
  
  const titles = loadTitles()
  if (titles.current.length === 0) {
    return c.json({ success: false, error: '모니터링할 작품이 없습니다.' }, 400)
  }
  
  // 모니터링 상태 초기화
  monitoringStatus = {
    isRunning: true,
    currentStep: '준비 중...',
    progress: 0,
    total: 0,
    message: '모니터링을 시작합니다.',
    startedAt: new Date().toISOString(),
  }
  
  // 백그라운드에서 파이프라인 실행
  runMonitoringPipeline().catch(error => {
    console.error('모니터링 오류:', error)
    monitoringStatus = {
      isRunning: false,
      currentStep: '오류',
      progress: 0,
      total: 0,
      message: `오류 발생: ${error.message}`,
      startedAt: null,
    }
  })
  
  return c.json({
    success: true,
    message: '모니터링이 시작되었습니다.',
    titles_count: titles.current.length,
  })
})

// 모니터링 파이프라인 실행 함수
async function runMonitoringPipeline() {
  const { spawn } = await import('child_process')
  
  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/run-all.ts'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    
    child.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      console.log(output)
      
      // 진행 상황 파싱
      if (output.includes('Step 1:')) {
        monitoringStatus.currentStep = '1단계: 검색 중'
        monitoringStatus.message = '구글 검색 진행 중...'
      } else if (output.includes('Step 2:')) {
        monitoringStatus.currentStep = '2단계: 1차 판별'
        monitoringStatus.message = '불법/합법 사이트 대조 중...'
        monitoringStatus.progress = 25
      } else if (output.includes('Step 3:')) {
        monitoringStatus.currentStep = '3단계: 2차 판별'
        monitoringStatus.message = 'LLM 분석 중...'
        monitoringStatus.progress = 50
      } else if (output.includes('Step 4:')) {
        monitoringStatus.currentStep = '4단계: 대기 목록'
        monitoringStatus.message = '승인 대기 목록 생성 중...'
        monitoringStatus.progress = 75
      } else if (output.includes('Step 5:')) {
        monitoringStatus.currentStep = '5단계: 리포트'
        monitoringStatus.message = 'Excel 리포트 생성 중...'
        monitoringStatus.progress = 90
      } else if (output.includes('검색 완료')) {
        // "검색 완료: 590개 결과" 같은 메시지 파싱
        const match = output.match(/검색 완료[:\s]*(\d+)/)
        if (match) {
          monitoringStatus.total = parseInt(match[1])
        }
      } else if (output.includes('파이프라인 완료')) {
        monitoringStatus.progress = 100
        monitoringStatus.currentStep = '완료'
        monitoringStatus.message = '모니터링이 완료되었습니다!'
      }
    })
    
    child.stderr?.on('data', (data: Buffer) => {
      console.error('Pipeline error:', data.toString())
    })
    
    child.on('close', (code) => {
      if (code === 0) {
        // 월별 통계 업데이트
        try {
          updateMonthlyStats()
          console.log('📊 월별 통계 자동 업데이트 완료')
        } catch (err) {
          console.error('월별 통계 업데이트 실패:', err)
        }
        
        monitoringStatus = {
          isRunning: false,
          currentStep: '완료',
          progress: 100,
          total: monitoringStatus.total,
          message: '모니터링이 완료되었습니다!',
          startedAt: null,
        }
        resolve()
      } else {
        monitoringStatus.isRunning = false
        monitoringStatus.currentStep = '오류'
        monitoringStatus.message = `파이프라인 종료 코드: ${code}`
        reject(new Error(`Pipeline exited with code ${code}`))
      }
    })
    
    child.on('error', (error) => {
      monitoringStatus.isRunning = false
      reject(error)
    })
  })
}

// ============================================
// API 엔드포인트 - 대시보드
// ============================================

// 사용 가능한 월 목록 조회
app.get('/api/dashboard/months', (c) => {
  const monthlyData = loadMonthlyStats()
  const sessionsData = scanAndUpdateSessions()
  
  // 세션에서 월 목록 추출
  const sessionMonths = new Set<string>()
  for (const session of sessionsData.sessions) {
    const date = new Date(session.created_at)
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    sessionMonths.add(month)
  }
  
  // 저장된 월 + 세션 월 합치기
  const allMonths = new Set([
    ...monthlyData.months.map(m => m.month),
    ...sessionMonths
  ])
  
  // 정렬 (최신순)
  const sortedMonths = Array.from(allMonths).sort((a, b) => b.localeCompare(a))
  
  return c.json({
    success: true,
    months: sortedMonths,
    current_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  })
})

// 대시보드 데이터 (월간 통계) - 월 선택 지원
app.get('/api/dashboard', (c) => {
  const selectedMonth = c.req.query('month') // YYYY-MM 형식
  
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const targetMonth = selectedMonth || currentMonth
  
  // 저장된 통계 확인
  const monthlyData = loadMonthlyStats()
  const savedStats = monthlyData.months.find(m => m.month === targetMonth)
  
  // 저장된 데이터가 있고, 현재 월이 아니면 저장된 데이터 반환
  if (savedStats && targetMonth !== currentMonth) {
    return c.json({
      success: true,
      ...savedStats,
      available_months: monthlyData.months.map(m => m.month)
    })
  }
  
  // 현재 월이거나 저장된 데이터가 없으면 실시간 계산
  const [year, monthNum] = targetMonth.split('-').map(Number)
  const sessionsData = scanAndUpdateSessions()
  
  const monthlySessions = sessionsData.sessions.filter(session => {
    const sessionDate = new Date(session.created_at)
    return sessionDate.getFullYear() === year && sessionDate.getMonth() === monthNum - 1
  })
  
  if (monthlySessions.length === 0) {
    return c.json({
      success: true,
      month: targetMonth,
      sessions_count: 0,
      top_contents: [],
      top_illegal_sites: [],
      total_stats: { total: 0, illegal: 0, legal: 0, pending: 0 },
      available_months: monthlyData.months.map(m => m.month)
    })
  }
  
  // 모든 월간 세션의 결과 합산
  const allResults: FinalResult[] = []
  for (const session of monthlySessions) {
    const finalResultsPath = path.join(process.cwd(), session.files.final_results)
    if (fs.existsSync(finalResultsPath)) {
      const results = loadFinalResults(finalResultsPath)
      allResults.push(...results)
    }
  }
  
  // URL 중복 제거
  const uniqueResults = allResults.filter((result, index, arr) => 
    arr.findIndex(r => r.url === result.url) === index
  )
  
  // 작품별 불법 URL 개수 및 manta.net 순위 차이 계산
  const titleStats = new Map<string, { 
    illegalCount: number, 
    mantaRankDiff: number | null,
    firstRankDomain: string | null 
  }>()
  
  for (const result of uniqueResults) {
    if (!titleStats.has(result.title)) {
      titleStats.set(result.title, { illegalCount: 0, mantaRankDiff: null, firstRankDomain: null })
    }
    
    const stats = titleStats.get(result.title)!
    
    if (result.final_status === 'illegal') {
      stats.illegalCount++
    }
    
    if (result.search_query === result.title && result.page === 1) {
      if (result.rank === 1) {
        stats.firstRankDomain = result.domain
      }
      if (result.domain === 'manta.net') {
        stats.mantaRankDiff = result.rank - 1
      }
    }
  }
  
  // Top 5 콘텐츠
  const topContents = Array.from(titleStats.entries())
    .map(([title, stats]) => ({
      title,
      illegal_count: stats.illegalCount,
      manta_rank_diff: stats.mantaRankDiff,
      first_rank_domain: stats.firstRankDomain
    }))
    .sort((a, b) => b.illegal_count - a.illegal_count)
    .slice(0, 5)
  
  // 상위 불법 사이트 Top 5
  const domainCounts = new Map<string, number>()
  for (const result of uniqueResults) {
    if (result.final_status === 'illegal') {
      const count = domainCounts.get(result.domain) || 0
      domainCounts.set(result.domain, count + 1)
    }
  }
  
  const topIllegalSites = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  
  // 전체 통계
  const totalStats = {
    total: uniqueResults.length,
    illegal: uniqueResults.filter(r => r.final_status === 'illegal').length,
    legal: uniqueResults.filter(r => r.final_status === 'legal').length,
    pending: uniqueResults.filter(r => r.final_status === 'pending').length
  }
  
  return c.json({
    success: true,
    month: targetMonth,
    sessions_count: monthlySessions.length,
    top_contents: topContents,
    top_illegal_sites: topIllegalSites,
    total_stats: totalStats,
    available_months: monthlyData.months.map(m => m.month)
  })
})

// 월별 통계 수동 업데이트 (관리용)
app.post('/api/dashboard/update', async (c) => {
  try {
    const { month } = await c.req.json<{ month?: string }>()
    const result = updateMonthlyStats(month)
    
    if (result) {
      return c.json({
        success: true,
        message: `${result.month} 통계가 업데이트되었습니다.`,
        stats: result
      })
    } else {
      return c.json({
        success: false,
        error: '해당 월에 데이터가 없습니다.'
      }, 404)
    }
  } catch (error) {
    return c.json({
      success: false,
      error: '통계 업데이트 실패'
    }, 500)
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
  const titleFilter = c.req.query('title') // 작품명 필터 (새로 추가)
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
  
  // 작품명으로 고유 목록 추출 (필터 드롭다운용) - 중복 제거 전
  const allTitles = [...new Set(results.map(r => r.title))].sort()
  
  // URL 중복 제거 (첫 번째 결과만 유지)
  const seenUrls = new Set<string>()
  results = results.filter(r => {
    if (seenUrls.has(r.url)) {
      return false
    }
    seenUrls.add(r.url)
    return true
  })
  
  // 상태 필터 적용
  if (filter && filter !== 'all') {
    results = results.filter(r => r.final_status === filter)
  }
  
  // 작품명 필터 적용 (새로 추가)
  if (titleFilter && titleFilter !== 'all') {
    results = results.filter(r => r.title === titleFilter)
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
    title_filter: titleFilter || 'all',
    available_titles: allTitles, // 사용 가능한 작품명 목록 반환
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
    results: paginatedResults,
  })
})

// 필터된 전체 URL 목록 반환 (URL 복사용)
app.get('/api/sessions/:id/urls', (c) => {
  const id = c.req.param('id')
  const filter = c.req.query('filter') // 'all', 'illegal', 'legal', 'pending'
  const titleFilter = c.req.query('title') // 작품명 필터
  
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
  
  // 상태 필터 적용
  if (filter && filter !== 'all') {
    results = results.filter(r => r.final_status === filter)
  }
  
  // 작품명 필터 적용
  if (titleFilter && titleFilter !== 'all') {
    results = results.filter(r => r.title === titleFilter)
  }
  
  // URL만 추출 (중복 제거)
  const urls = [...new Set(results.map(r => r.url))]
  
  console.log(`📋 URL 목록 요청: 세션=${id}, 필터=${filter || 'all'}, 작품=${titleFilter || 'all'}, 결과=${urls.length}개`)
  
  return c.json({
    success: true,
    session_id: id,
    filter: filter || 'all',
    title_filter: titleFilter || 'all',
    total: urls.length,
    urls,
  })
})

// Excel 파일 다운로드 (JSON에서 실시간 변환)
app.get('/api/sessions/:id/download', (c) => {
  const id = c.req.param('id')
  const sessionsData = scanAndUpdateSessions()
  const session = sessionsData.sessions.find(s => s.id === id)
  
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }
  
  // JSON 파일에서 최신 데이터 읽기
  const finalResultsPath = path.join(process.cwd(), session.files.final_results)
  
  if (!fs.existsSync(finalResultsPath)) {
    return c.json({ success: false, error: 'Results file not found' }, 404)
  }
  
  const results = loadFinalResults(finalResultsPath)
  
  // 실시간으로 Excel 생성
  const excelBuffer = generateExcelFromResults(results)
  const fileName = `report_${id}.xlsx`
  
  console.log(`📊 Excel 실시간 생성: ${fileName} (${results.length}개 결과)`)
  
  return new Response(excelBuffer, {
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
        <div class="flex gap-3">
          <!-- 모니터링 시작 버튼 -->
          <div class="relative">
            <button onclick="startMonitoring()" id="btn-monitoring" 
                    class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition flex items-center">
              <i class="fas fa-play mr-2"></i>모니터링 시작
            </button>
            <!-- 진행률 표시 (모니터링 중일 때만 표시) -->
            <div id="monitoring-progress" class="hidden absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg p-3 min-w-[250px] z-50">
              <div class="text-sm font-medium text-gray-700 mb-2" id="progress-step">준비 중...</div>
              <div class="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div id="progress-bar" class="bg-green-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
              <div class="text-xs text-gray-500" id="progress-message">모니터링을 시작합니다.</div>
            </div>
          </div>
          <!-- 작품 변경 버튼 -->
          <button onclick="openTitlesModal()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg transition">
            <i class="fas fa-list-alt mr-2"></i>작품 변경
          </button>
        </div>
      </div>
    </div>

    <!-- 작품 변경 모달 -->
    <div id="titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden">
        <!-- 모달 헤더 -->
        <div class="bg-purple-500 text-white px-6 py-4 flex justify-between items-center">
          <h2 class="text-xl font-bold"><i class="fas fa-list-alt mr-2"></i>모니터링 대상 작품 관리</h2>
          <button onclick="closeTitlesModal()" class="text-white hover:text-gray-200">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <!-- 모달 내용 -->
        <div class="p-6 grid grid-cols-2 gap-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <!-- 좌측: 현재 모니터링 대상 -->
          <div>
            <h3 class="text-lg font-semibold text-gray-800 mb-3">
              <i class="fas fa-check-circle text-green-500 mr-2"></i>현재 모니터링 대상
              <span id="current-count" class="text-sm text-gray-500 font-normal">(0개)</span>
            </h3>
            <div id="current-titles-list" class="space-y-2 max-h-[400px] overflow-y-auto border rounded-lg p-3 bg-gray-50">
              <!-- 동적으로 채워짐 -->
            </div>
          </div>
          <!-- 우측: 작품 추가 -->
          <div>
            <h3 class="text-lg font-semibold text-gray-800 mb-3">
              <i class="fas fa-plus-circle text-blue-500 mr-2"></i>작품 추가
            </h3>
            <!-- 새 작품 입력 -->
            <div class="flex gap-2 mb-4">
              <input type="text" id="new-title-input" placeholder="새 작품명 입력..." 
                     class="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                     onkeypress="if(event.key==='Enter') addNewTitle()">
              <button onclick="addNewTitle()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            <!-- 과거 추가 내역 -->
            <h4 class="text-sm font-medium text-gray-600 mb-2">
              <i class="fas fa-history mr-1"></i>과거 추가 내역
              <span id="history-count" class="text-gray-400">(0개)</span>
            </h4>
            <div id="history-titles-list" class="space-y-2 max-h-[320px] overflow-y-auto border rounded-lg p-3 bg-gray-50">
              <!-- 동적으로 채워짐 -->
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 탭 네비게이션 -->
    <div class="bg-white rounded-lg shadow-md mb-6">
      <div class="flex border-b">
        <button onclick="switchTab('dashboard')" id="tab-dashboard" 
                class="px-6 py-4 text-gray-600 hover:text-blue-600 transition tab-active">
          <i class="fas fa-chart-line mr-2"></i>대시보드
        </button>
        <button onclick="switchTab('pending')" id="tab-pending" 
                class="px-6 py-4 text-gray-600 hover:text-blue-600 transition">
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
            <div class="flex gap-2 items-center flex-wrap">
              <!-- 작품명 필터 (신규 추가) -->
              <div class="flex items-center gap-1">
                <label class="text-sm text-gray-600"><i class="fas fa-book mr-1"></i>작품:</label>
                <select id="title-filter" onchange="onTitleFilterChange()" 
                        class="border rounded-lg px-3 py-2 min-w-[200px]">
                  <option value="all">전체 작품</option>
                </select>
              </div>
              <!-- 상태 필터 -->
              <div class="flex items-center gap-1">
                <label class="text-sm text-gray-600"><i class="fas fa-filter mr-1"></i>상태:</label>
                <select id="result-filter" onchange="loadSessionResults()" 
                        class="border rounded-lg px-3 py-2">
                  <option value="all">전체</option>
                  <option value="illegal">불법</option>
                  <option value="legal">합법</option>
                  <option value="pending">승인대기</option>
                </select>
              </div>
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
            <table class="w-full text-sm table-fixed">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-3 py-2 text-left" style="width: 45px;">#</th>
                  <th class="px-3 py-2 text-left" style="width: 140px;">작품명</th>
                  <th class="px-3 py-2 text-left" style="width: 300px;">URL</th>
                  <th class="px-3 py-2 text-left" style="width: 60px;">상태</th>
                  <th class="px-3 py-2 text-left" style="width: 60px;">LLM</th>
                  <th class="px-3 py-2 text-left" style="width: 130px;">검토일시</th>
                </tr>
              </thead>
              <tbody id="results-table">
              </tbody>
            </table>
          </div>

          <!-- 페이지네이션 + URL 복사 버튼 -->
          <div class="flex justify-between items-center mt-4">
            <div class="text-sm text-gray-500">
              <span id="filter-info"></span>
            </div>
            <div id="pagination" class="flex justify-center gap-2">
            </div>
            <button onclick="copyAllUrls()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg transition text-sm">
              <i class="fas fa-copy mr-2"></i>URL 복사하기
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 대시보드 탭 -->
    <div id="content-dashboard" class="tab-content">
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-semibold text-gray-800">
            <i class="fas fa-chart-pie mr-2"></i>월간 모니터링 현황
          </h2>
          <div class="flex items-center gap-2">
            <label class="text-sm text-gray-600"><i class="fas fa-calendar-alt mr-1"></i>월 선택:</label>
            <select id="month-selector" onchange="onMonthChange()" 
                    class="border rounded-lg px-3 py-2 min-w-[150px]">
              <option value="">로딩 중...</option>
            </select>
          </div>
        </div>
        
        <!-- 월간 요약 통계 -->
        <div class="grid grid-cols-4 gap-4 mb-6">
          <div class="bg-gray-50 rounded-lg p-4 text-center">
            <div class="text-3xl font-bold text-gray-800" id="dash-total">0</div>
            <div class="text-sm text-gray-600">전체 URL</div>
          </div>
          <div class="bg-red-50 rounded-lg p-4 text-center border-l-4 border-red-500">
            <div class="text-3xl font-bold text-red-600" id="dash-illegal">0</div>
            <div class="text-sm text-gray-600">불법 URL</div>
          </div>
          <div class="bg-green-50 rounded-lg p-4 text-center border-l-4 border-green-500">
            <div class="text-3xl font-bold text-green-600" id="dash-legal">0</div>
            <div class="text-sm text-gray-600">합법 URL</div>
          </div>
          <div class="bg-blue-50 rounded-lg p-4 text-center border-l-4 border-blue-500">
            <div class="text-3xl font-bold text-blue-600" id="dash-sessions">0</div>
            <div class="text-sm text-gray-600">모니터링 횟수</div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-6">
          <!-- Top 5 콘텐츠 (불법 URL 개수) -->
          <div class="border rounded-lg p-4">
            <h3 class="text-md font-semibold text-red-600 mb-3">
              <i class="fas fa-exclamation-triangle mr-2"></i>불법 URL 많은 작품 Top 5
            </h3>
            <table class="w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-2 py-2 text-left">#</th>
                  <th class="px-2 py-2 text-left">작품명</th>
                  <th class="px-2 py-2 text-center">불법 URL</th>
                  <th class="px-2 py-2 text-center" title="작품명 검색 1위 vs manta.net 순위 차이">순위 차이</th>
                </tr>
              </thead>
              <tbody id="top-contents-table">
                <tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>
              </tbody>
            </table>
            <div class="text-xs text-gray-400 mt-2">
              💡 순위 차이: 작품명만 검색 시 1페이지에서 1위와 manta.net의 순위 차이
            </div>
          </div>

          <!-- Top 5 불법 도메인 -->
          <div class="border rounded-lg p-4">
            <h3 class="text-md font-semibold text-gray-700 mb-3">
              <i class="fas fa-globe mr-2"></i>상위 불법 도메인 Top 5
            </h3>
            <table class="w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-2 py-2 text-left">#</th>
                  <th class="px-2 py-2 text-left">도메인</th>
                  <th class="px-2 py-2 text-center">검출 횟수</th>
                </tr>
              </thead>
              <tbody id="top-domains-table">
                <tr><td colspan="3" class="text-center py-4 text-gray-500">데이터 없음</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- 사이트 목록 탭 -->
    <div id="content-sites" class="tab-content hidden">
      <div class="grid grid-cols-2 gap-6">
        <!-- 불법 사이트 목록 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-red-600">
              <i class="fas fa-ban mr-2"></i>불법 사이트 목록
              <span id="illegal-sites-count" class="text-sm text-gray-500 font-normal">(0개)</span>
            </h2>
            <button onclick="openSiteModal('illegal')" class="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded">
              <i class="fas fa-edit mr-1"></i>편집
            </button>
          </div>
          <div id="illegal-sites-list" class="max-h-96 overflow-y-auto space-y-1 text-sm">
          </div>
        </div>

        <!-- 합법 사이트 목록 -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-semibold text-green-600">
              <i class="fas fa-check-circle mr-2"></i>합법 사이트 목록
              <span id="legal-sites-count" class="text-sm text-gray-500 font-normal">(0개)</span>
            </h2>
            <button onclick="openSiteModal('legal')" class="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded">
              <i class="fas fa-edit mr-1"></i>편집
            </button>
          </div>
          <div id="legal-sites-list" class="max-h-96 overflow-y-auto space-y-1 text-sm">
          </div>
        </div>
      </div>
    </div>

    <!-- 사이트 편집 모달 -->
    <div id="site-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden">
        <div id="site-modal-header" class="px-6 py-4 flex justify-between items-center">
          <h2 class="text-xl font-bold"><i class="fas fa-edit mr-2"></i>사이트 목록 편집</h2>
          <button onclick="closeSiteModal()" class="text-white hover:text-gray-200">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="p-6">
          <!-- 새 사이트 추가 -->
          <div class="flex gap-2 mb-4">
            <input type="text" id="new-site-input" placeholder="새 도메인 입력 (ex: example.com)" 
                   class="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                   onkeypress="if(event.key==='Enter') addNewSite()">
            <button onclick="addNewSite()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
              <i class="fas fa-plus"></i>
            </button>
          </div>
          <!-- 사이트 목록 -->
          <div class="text-sm text-gray-600 mb-2">
            <i class="fas fa-list mr-1"></i>현재 목록 <span id="site-modal-count">(0개)</span>
          </div>
          <div id="site-modal-list" class="max-h-[400px] overflow-y-auto space-y-2 border rounded-lg p-3 bg-gray-50">
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // 현재 탭
    let currentTab = 'dashboard';
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
      } else if (tab === 'dashboard') {
        loadDashboard();
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
      } else if (currentTab === 'dashboard') {
        loadDashboard();
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

    // 현재 작품명 필터 값
    let currentTitleFilter = 'all';
    let availableTitles = [];

    function openSessionDetail(sessionId) {
      currentSessionId = sessionId;
      currentPage = 1;
      currentTitleFilter = 'all';
      document.getElementById('detail-session-id').textContent = sessionId;
      document.getElementById('session-detail').classList.remove('hidden');
      document.getElementById('result-filter').value = 'all';
      document.getElementById('title-filter').value = 'all';
      loadSessionResults(true); // 첫 로드 시 작품명 목록도 갱신
    }

    function closeSessionDetail() {
      currentSessionId = null;
      document.getElementById('session-detail').classList.add('hidden');
    }

    function onTitleFilterChange() {
      currentTitleFilter = document.getElementById('title-filter').value;
      currentPage = 1; // 필터 변경 시 페이지 초기화
      loadSessionResults(false); // 작품명 목록은 갱신하지 않음
    }

    async function loadSessionResults(updateTitleFilter = false) {
      if (!currentSessionId) return;

      const filter = document.getElementById('result-filter').value;
      const titleFilter = document.getElementById('title-filter').value;
      const tableEl = document.getElementById('results-table');
      tableEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</td></tr>';

      const data = await fetchAPI(\`/api/sessions/\${currentSessionId}/results?filter=\${filter}&title=\${encodeURIComponent(titleFilter)}&page=\${currentPage}&limit=50\`);
      
      if (!data.success) {
        tableEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-red-500">데이터 로드 실패</td></tr>';
        return;
      }

      // 작품명 드롭다운 업데이트 (첫 로드 또는 명시적 요청 시에만)
      if (updateTitleFilter && data.available_titles) {
        availableTitles = data.available_titles;
        const titleSelect = document.getElementById('title-filter');
        titleSelect.innerHTML = '<option value="all">전체 작품 (' + availableTitles.length + '개)</option>' +
          availableTitles.map(title => \`<option value="\${title}">\${title}</option>\`).join('');
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
          <td class="px-3 py-2 text-center text-xs">\${(currentPage - 1) * 50 + index + 1}</td>
          <td class="px-3 py-2 text-xs" title="\${result.title}">\${result.title.length > 15 ? result.title.substring(0, 15) + '...' : result.title}</td>
          <td class="px-3 py-2">
            <a href="\${result.url}" target="_blank" class="text-blue-500 hover:underline text-xs block truncate" 
               title="\${result.url}" style="max-width: 280px;">
              \${result.url}
            </a>
            <div class="text-xs text-gray-400">[\${result.domain}]</div>
          </td>
          <td class="px-3 py-2 text-center">
            <span class="px-1.5 py-0.5 rounded text-xs text-white status-\${result.final_status}">
              \${result.final_status === 'illegal' ? '불법' : 
                result.final_status === 'legal' ? '합법' : '대기'}
            </span>
          </td>
          <td class="px-3 py-2 text-xs text-gray-600 text-center">
            \${result.llm_judgment ? (
              result.llm_judgment === 'likely_illegal' ? '🔴' :
              result.llm_judgment === 'likely_legal' ? '🟢' : '🟡'
            ) : '-'}
          </td>
          <td class="px-3 py-2 text-xs text-gray-500">
            \${result.reviewed_at ? new Date(result.reviewed_at).toLocaleDateString('ko-KR') : '-'}
          </td>
        </tr>
      \`).join('');

      // 필터 정보 업데이트
      const titleText = titleFilter === 'all' ? '전체 작품' : titleFilter;
      const statusText = filter === 'all' ? '전체' : (filter === 'illegal' ? '불법' : filter === 'legal' ? '합법' : '대기');
      document.getElementById('filter-info').innerHTML = \`<i class="fas fa-filter mr-1"></i> \${titleText} / \${statusText} - 총 <strong>\${data.pagination.total}</strong>개\`;

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

    // URL 복사하기 (필터 조건에 맞는 전체 URL)
    async function copyAllUrls() {
      if (!currentSessionId) {
        alert('세션을 먼저 선택해주세요.');
        return;
      }

      const filter = document.getElementById('result-filter').value;
      const titleFilter = document.getElementById('title-filter').value;

      // 필터 정보 표시
      const titleText = titleFilter === 'all' ? '전체 작품' : titleFilter;
      const statusText = filter === 'all' ? '전체' : (filter === 'illegal' ? '불법' : filter === 'legal' ? '합법' : '대기');

      // 로딩 표시
      const btn = event.target.closest('button');
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>로딩...';
      btn.disabled = true;

      try {
        const data = await fetchAPI(\`/api/sessions/\${currentSessionId}/urls?filter=\${filter}&title=\${encodeURIComponent(titleFilter)}\`);
        
        if (!data.success) {
          alert('URL 목록을 가져오는데 실패했습니다.');
          return;
        }

        if (data.urls.length === 0) {
          alert('복사할 URL이 없습니다.');
          return;
        }

        // 클립보드에 복사 (한 줄에 하나씩)
        const urlText = data.urls.join('\\n');
        await navigator.clipboard.writeText(urlText);

        // 성공 알림
        alert(\`✅ URL \${data.urls.length}개가 클립보드에 복사되었습니다.\\n\\n📌 필터: \${titleText} / \${statusText}\`);
      } catch (error) {
        console.error('URL 복사 실패:', error);
        alert('URL 복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
      } finally {
        // 버튼 복원
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    }

    // ============================================
    // 대시보드 탭
    // ============================================

    let selectedMonth = ''; // 현재 선택된 월
    let availableMonths = []; // 사용 가능한 월 목록

    async function loadDashboard(month = null) {
      // 월 목록 로드 (첫 로드 시)
      if (availableMonths.length === 0) {
        const monthsData = await fetchAPI('/api/dashboard/months');
        if (monthsData.success) {
          availableMonths = monthsData.months;
          selectedMonth = month || monthsData.current_month;
          updateMonthSelector();
        }
      }
      
      // 대시보드 데이터 로드
      const targetMonth = month || selectedMonth;
      const data = await fetchAPI(\`/api/dashboard?month=\${targetMonth}\`);
      
      if (!data.success) {
        console.error('Dashboard load failed');
        return;
      }
      
      // 월 선택기 업데이트 (API 응답에 새로운 월이 있을 수 있음)
      if (data.available_months && data.available_months.length > 0) {
        const newMonths = data.available_months.filter(m => !availableMonths.includes(m));
        if (newMonths.length > 0) {
          availableMonths = [...new Set([...availableMonths, ...data.available_months])].sort((a, b) => b.localeCompare(a));
          updateMonthSelector();
        }
      }
      
      // 요약 통계
      document.getElementById('dash-total').textContent = data.total_stats?.total || 0;
      document.getElementById('dash-illegal').textContent = data.total_stats?.illegal || 0;
      document.getElementById('dash-legal').textContent = data.total_stats?.legal || 0;
      document.getElementById('dash-sessions').textContent = data.sessions_count || 0;
      
      // Top 5 콘텐츠
      const topContentsEl = document.getElementById('top-contents-table');
      if (data.top_contents && data.top_contents.length > 0) {
        topContentsEl.innerHTML = data.top_contents.map((item, index) => \`
          <tr class="border-b">
            <td class="px-2 py-2 text-center">\${index + 1}</td>
            <td class="px-2 py-2" title="\${item.title}">\${item.title.length > 20 ? item.title.substring(0, 20) + '...' : item.title}</td>
            <td class="px-2 py-2 text-center font-bold text-red-600">\${item.illegal_count}</td>
            <td class="px-2 py-2 text-center">
              \${item.manta_rank_diff !== null ? 
                (item.manta_rank_diff === 0 ? '<span class="text-green-600 font-bold">1위</span>' : 
                 '<span class="text-orange-600">+' + item.manta_rank_diff + '</span>') : 
                '<span class="text-gray-400">-</span>'}
            </td>
          </tr>
        \`).join('');
      } else {
        topContentsEl.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>';
      }
      
      // Top 5 불법 도메인
      const topDomainsEl = document.getElementById('top-domains-table');
      if (data.top_illegal_sites && data.top_illegal_sites.length > 0) {
        topDomainsEl.innerHTML = data.top_illegal_sites.map((item, index) => \`
          <tr class="border-b">
            <td class="px-2 py-2 text-center">\${index + 1}</td>
            <td class="px-2 py-2">
              <span class="text-red-600">\${item.domain}</span>
            </td>
            <td class="px-2 py-2 text-center font-bold">\${item.count}</td>
          </tr>
        \`).join('');
      } else {
        topDomainsEl.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500">데이터 없음</td></tr>';
      }
    }

    function updateMonthSelector() {
      const selector = document.getElementById('month-selector');
      const currentMonth = new Date().toISOString().slice(0, 7);
      
      // 현재 월이 목록에 없으면 추가
      if (!availableMonths.includes(currentMonth)) {
        availableMonths.unshift(currentMonth);
      }
      
      selector.innerHTML = availableMonths.map(month => {
        const [year, mon] = month.split('-');
        const label = \`\${year}년 \${parseInt(mon)}월\`;
        const isCurrent = month === currentMonth ? ' (현재)' : '';
        return \`<option value="\${month}" \${month === selectedMonth ? 'selected' : ''}>\${label}\${isCurrent}</option>\`;
      }).join('');
    }

    function onMonthChange() {
      const selector = document.getElementById('month-selector');
      selectedMonth = selector.value;
      loadDashboard(selectedMonth);
    }

    // ============================================
    // 사이트 목록 탭
    // ============================================

    let currentSiteType = 'illegal'; // 현재 편집 중인 사이트 타입

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
    // 모니터링 시작/상태 관리
    // ============================================

    let monitoringInterval = null;

    async function startMonitoring() {
      const btn = document.getElementById('btn-monitoring');
      
      // 현재 상태 확인
      const statusData = await fetchAPI('/api/monitoring/status');
      if (statusData.isRunning) {
        alert('이미 모니터링이 실행 중입니다.');
        return;
      }
      
      if (!confirm('모니터링을 시작하시겠습니까?\\n\\n작품 수에 따라 2~5분 정도 소요될 수 있습니다.')) {
        return;
      }
      
      // 모니터링 시작 요청
      const data = await fetchAPI('/api/monitoring/start', { method: 'POST' });
      
      if (!data.success) {
        alert('오류: ' + (data.error || '모니터링 시작 실패'));
        return;
      }
      
      // 버튼 상태 변경
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>진행 중...';
      btn.disabled = true;
      btn.classList.remove('bg-green-500', 'hover:bg-green-600');
      btn.classList.add('bg-gray-400', 'cursor-not-allowed');
      
      // 진행률 표시
      document.getElementById('monitoring-progress').classList.remove('hidden');
      
      // 주기적으로 상태 확인
      monitoringInterval = setInterval(checkMonitoringStatus, 1000);
    }

    async function checkMonitoringStatus() {
      const data = await fetchAPI('/api/monitoring/status');
      
      // 진행률 업데이트
      document.getElementById('progress-step').textContent = data.currentStep || '진행 중...';
      document.getElementById('progress-bar').style.width = (data.progress || 0) + '%';
      document.getElementById('progress-message').textContent = data.message || '';
      
      // 완료 또는 오류 시
      if (!data.isRunning) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        
        // 버튼 복원
        const btn = document.getElementById('btn-monitoring');
        btn.innerHTML = '<i class="fas fa-play mr-2"></i>모니터링 시작';
        btn.disabled = false;
        btn.classList.remove('bg-gray-400', 'cursor-not-allowed');
        btn.classList.add('bg-green-500', 'hover:bg-green-600');
        
        // 3초 후 진행률 숨기기
        setTimeout(() => {
          document.getElementById('monitoring-progress').classList.add('hidden');
        }, 3000);
        
        // 완료 시 데이터 새로고침
        if (data.currentStep === '완료') {
          alert('✅ 모니터링이 완료되었습니다!\\n\\n승인 대기 탭과 모니터링 회차 탭에서 결과를 확인하세요.');
          loadPendingItems();
          loadSessions();
        }
      }
    }

    // ============================================
    // 작품 변경 모달
    // ============================================

    function openTitlesModal() {
      document.getElementById('titles-modal').classList.remove('hidden');
      loadTitlesData();
    }

    function closeTitlesModal() {
      document.getElementById('titles-modal').classList.add('hidden');
    }

    async function loadTitlesData() {
      const data = await fetchAPI('/api/titles');
      
      if (!data.success) {
        alert('작품 목록을 불러오는데 실패했습니다.');
        return;
      }
      
      // 현재 목록 업데이트
      document.getElementById('current-count').textContent = \`(\${data.current.length}개)\`;
      const currentListEl = document.getElementById('current-titles-list');
      
      if (data.current.length === 0) {
        currentListEl.innerHTML = '<div class="text-gray-500 text-center py-4">모니터링 대상 작품이 없습니다.</div>';
      } else {
        currentListEl.innerHTML = data.current.map((title, index) => \`
          <div class="flex items-center justify-between bg-white rounded px-3 py-2 border">
            <span class="text-sm">
              <span class="text-gray-400 mr-2">\${index + 1}.</span>
              \${title}
            </span>
            <button onclick="removeFromCurrent('\${title.replace(/'/g, "\\\\'")}')" 
                    class="text-red-500 hover:text-red-700 px-2">
              <i class="fas fa-minus-circle"></i>
            </button>
          </div>
        \`).join('');
      }
      
      // 히스토리 업데이트
      document.getElementById('history-count').textContent = \`(\${data.history.length}개)\`;
      const historyListEl = document.getElementById('history-titles-list');
      
      if (data.history.length === 0) {
        historyListEl.innerHTML = '<div class="text-gray-500 text-center py-4">과거 추가 내역이 없습니다.</div>';
      } else {
        historyListEl.innerHTML = data.history.map(title => \`
          <div class="flex items-center justify-between bg-white rounded px-3 py-2 border">
            <span class="text-sm text-gray-600">\${title}</span>
            <button onclick="restoreFromHistory('\${title.replace(/'/g, "\\\\'")}')" 
                    class="text-green-500 hover:text-green-700 px-2">
              <i class="fas fa-plus-circle"></i>
            </button>
          </div>
        \`).join('');
      }
    }

    async function addNewTitle() {
      const input = document.getElementById('new-title-input');
      const title = input.value.trim();
      
      if (!title) {
        alert('작품명을 입력해주세요.');
        return;
      }
      
      const data = await fetchAPI('/api/titles/current', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      
      if (data.success) {
        input.value = '';
        loadTitlesData();
      } else {
        alert('오류: ' + (data.error || '추가 실패'));
      }
    }

    async function removeFromCurrent(title) {
      if (!confirm(\`'\${title}'을(를) 현재 목록에서 제거하시겠습니까?\\n\\n과거 추가 내역으로 이동됩니다.\`)) {
        return;
      }
      
      const data = await fetchAPI(\`/api/titles/current/\${encodeURIComponent(title)}\`, {
        method: 'DELETE',
      });
      
      if (data.success) {
        loadTitlesData();
      } else {
        alert('오류: ' + (data.error || '제거 실패'));
      }
    }

    async function restoreFromHistory(title) {
      const data = await fetchAPI('/api/titles/restore', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      
      if (data.success) {
        loadTitlesData();
      } else {
        alert('오류: ' + (data.error || '복원 실패'));
      }
    }

    // 모달 외부 클릭 시 닫기
    document.getElementById('titles-modal').addEventListener('click', (e) => {
      if (e.target.id === 'titles-modal') {
        closeTitlesModal();
      }
    });

    document.getElementById('site-modal').addEventListener('click', (e) => {
      if (e.target.id === 'site-modal') {
        closeSiteModal();
      }
    });

    // ============================================
    // 사이트 편집 모달
    // ============================================

    function openSiteModal(type) {
      currentSiteType = type;
      const isIllegal = type === 'illegal';
      
      // 모달 헤더 색상 변경
      const header = document.getElementById('site-modal-header');
      header.className = \`px-6 py-4 flex justify-between items-center \${isIllegal ? 'bg-red-500' : 'bg-green-500'} text-white\`;
      header.querySelector('h2').innerHTML = \`<i class="fas fa-edit mr-2"></i>\${isIllegal ? '불법' : '합법'} 사이트 목록 편집\`;
      
      document.getElementById('site-modal').classList.remove('hidden');
      loadSiteModalData();
    }

    function closeSiteModal() {
      document.getElementById('site-modal').classList.add('hidden');
      loadSites(); // 목록 새로고침
    }

    async function loadSiteModalData() {
      const data = await fetchAPI(\`/api/sites/\${currentSiteType}\`);
      
      if (!data.success) {
        alert('사이트 목록을 불러오는데 실패했습니다.');
        return;
      }
      
      document.getElementById('site-modal-count').textContent = \`(\${data.sites.length}개)\`;
      
      const listEl = document.getElementById('site-modal-list');
      const isIllegal = currentSiteType === 'illegal';
      
      if (data.sites.length === 0) {
        listEl.innerHTML = '<div class="text-gray-500 text-center py-4">등록된 사이트가 없습니다.</div>';
      } else {
        listEl.innerHTML = data.sites.map(site => \`
          <div class="flex items-center justify-between bg-white rounded px-3 py-2 border">
            <span class="text-sm \${isIllegal ? 'text-red-600' : 'text-green-600'}">
              <i class="fas \${isIllegal ? 'fa-ban' : 'fa-check'} mr-2 text-xs"></i>\${site}
            </span>
            <button onclick="removeSite('\${site}')" class="text-gray-400 hover:text-red-500 px-2">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        \`).join('');
      }
    }

    async function addNewSite() {
      const input = document.getElementById('new-site-input');
      const domain = input.value.trim().toLowerCase();
      
      if (!domain) {
        alert('도메인을 입력해주세요.');
        return;
      }
      
      const data = await fetchAPI(\`/api/sites/\${currentSiteType}\`, {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      
      if (data.success) {
        input.value = '';
        loadSiteModalData();
      } else {
        alert('오류: ' + (data.error || '추가 실패'));
      }
    }

    async function removeSite(domain) {
      if (!confirm(\`'\${domain}'을(를) 목록에서 삭제하시겠습니까?\`)) {
        return;
      }
      
      const data = await fetchAPI(\`/api/sites/\${currentSiteType}/\${encodeURIComponent(domain)}\`, {
        method: 'DELETE',
      });
      
      if (data.success) {
        loadSiteModalData();
      } else {
        alert('오류: ' + (data.error || '삭제 실패'));
      }
    }

    // ============================================
    // 초기 로드
    // ============================================

    loadDashboard();
    
    // 페이지 로드 시 모니터링 상태 확인
    (async () => {
      const status = await fetchAPI('/api/monitoring/status');
      if (status.isRunning) {
        // 이미 실행 중이면 UI 업데이트
        const btn = document.getElementById('btn-monitoring');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>진행 중...';
        btn.disabled = true;
        btn.classList.remove('bg-green-500', 'hover:bg-green-600');
        btn.classList.add('bg-gray-400', 'cursor-not-allowed');
        document.getElementById('monitoring-progress').classList.remove('hidden');
        monitoringInterval = setInterval(checkMonitoringStatus, 1000);
      }
    })();
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
