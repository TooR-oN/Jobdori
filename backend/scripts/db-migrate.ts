// ============================================
// Database Migration Script
// 기존 JSON/TXT 파일 → Neon PostgreSQL
// ============================================

import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import * as db from '../src/lib/db.js'

const DATA_DIR = './data'
const OUTPUT_DIR = './output'

interface OldSession {
  id: string
  created_at: string
  completed_at: string
  status: string
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
    excel_report?: string
  }
}

interface OldPendingReview {
  id: string
  domain: string
  urls: string[]
  titles: string[]
  llm_judgment: string
  llm_reason: string
  created_at: string
  session_id?: string
}

interface OldMonthlyStats {
  month: string
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
    first_rank_domain: string
  }>
  top_illegal_sites: Array<{
    domain: string
    count: number
  }>
  last_updated: string
}

// 파일 읽기 헬퍼
function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    console.log(`❌ 파일 읽기 실패: ${filePath}`)
    return null
  }
}

function readTextFile(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
  } catch (error) {
    console.log(`❌ 파일 읽기 실패: ${filePath}`)
    return []
  }
}

async function migrateDatabase() {
  console.log('🚀 데이터베이스 마이그레이션 시작...\n')

  // 1. 데이터베이스 초기화 (테이블 생성)
  console.log('📦 1. 테이블 생성...')
  await db.initializeDatabase()
  console.log('✅ 테이블 생성 완료\n')

  // 2. Titles 마이그레이션
  console.log('📖 2. 작품 목록 마이그레이션...')
  const titlesData = readJsonFile<{ current: string[], history: string[] }>(
    path.join(DATA_DIR, 'titles.json')
  )
  if (titlesData) {
    for (const title of titlesData.current) {
      await db.addTitle(title)
      console.log(`  ✓ ${title}`)
    }
    for (const title of titlesData.history) {
      await db.addTitle(title)
      await db.removeTitle(title) // history로 이동
      console.log(`  ✓ ${title} (history)`)
    }
    console.log(`✅ 작품 ${titlesData.current.length + titlesData.history.length}개 마이그레이션 완료\n`)
  }

  // 3. Sites 마이그레이션
  console.log('🌐 3. 사이트 목록 마이그레이션...')
  
  const illegalSites = readTextFile(path.join(DATA_DIR, 'illegal-sites.txt'))
  for (const domain of illegalSites) {
    await db.addSite(domain, 'illegal')
  }
  console.log(`  ✓ 불법 사이트 ${illegalSites.length}개`)
  
  const legalSites = readTextFile(path.join(DATA_DIR, 'legal-sites.txt'))
  for (const domain of legalSites) {
    await db.addSite(domain, 'legal')
  }
  console.log(`  ✓ 합법 사이트 ${legalSites.length}개`)
  console.log(`✅ 사이트 목록 마이그레이션 완료\n`)

  // 4. Sessions 마이그레이션
  console.log('📊 4. 세션 목록 마이그레이션...')
  const sessionsData = readJsonFile<{ sessions: OldSession[] }>(
    path.join(DATA_DIR, 'sessions.json')
  )
  if (sessionsData) {
    for (const session of sessionsData.sessions) {
      await db.createSession({
        id: session.id,
        status: session.status as any,
        titles_count: session.titles_count,
        keywords_count: session.keywords_count,
        total_searches: session.total_searches,
        file_final_results: session.files?.final_results || null
      })
      
      await db.updateSession(session.id, {
        completed_at: session.completed_at,
        status: session.status as any,
        results_total: session.results_summary.total,
        results_illegal: session.results_summary.illegal,
        results_legal: session.results_summary.legal,
        results_pending: session.results_summary.pending
      })
      console.log(`  ✓ ${session.id}`)
    }
    console.log(`✅ 세션 ${sessionsData.sessions.length}개 마이그레이션 완료\n`)
  }

  // 5. Monthly Stats 마이그레이션
  console.log('📈 5. 월별 통계 마이그레이션...')
  const monthlyData = readJsonFile<{ months: OldMonthlyStats[] }>(
    path.join(DATA_DIR, 'monthly-stats.json')
  )
  if (monthlyData) {
    for (const month of monthlyData.months) {
      await db.upsertMonthlyStats({
        month: month.month,
        sessions_count: month.sessions_count,
        total: month.total_stats.total,
        illegal: month.total_stats.illegal,
        legal: month.total_stats.legal,
        pending: month.total_stats.pending,
        top_contents: month.top_contents,
        top_illegal_sites: month.top_illegal_sites
      })
      console.log(`  ✓ ${month.month}`)
    }
    console.log(`✅ 월별 통계 ${monthlyData.months.length}개 마이그레이션 완료\n`)
  }

  // 6. Pending Reviews 마이그레이션
  console.log('⏳ 6. 승인 대기 목록 마이그레이션...')
  const pendingData = readJsonFile<OldPendingReview[]>(
    path.join(DATA_DIR, 'pending-review.json')
  )
  if (pendingData && Array.isArray(pendingData)) {
    for (const item of pendingData) {
      await db.createPendingReview({
        domain: item.domain,
        urls: item.urls,
        titles: item.titles,
        llm_judgment: item.llm_judgment as any,
        llm_reason: item.llm_reason,
        session_id: item.session_id || null
      })
    }
    console.log(`✅ 승인 대기 ${pendingData.length}개 마이그레이션 완료\n`)
  }

  console.log('🎉 데이터베이스 마이그레이션 완료!')
}

// 실행
migrateDatabase().catch(console.error)
