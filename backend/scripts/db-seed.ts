// ============================================
// Database Seed Script
// 기존 파일 데이터를 Neon DB로 마이그레이션
// ============================================

import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import { 
  addSite, 
  addTitle, 
  createSession, 
  upsertMonthlyStats,
  createPendingReview,
  initializeDatabase 
} from '../src/lib/db.js'

const DATA_DIR = path.join(process.cwd(), 'data')

async function loadTextFile(filePath: string): Promise<string[]> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
    }
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error)
  }
  return []
}

async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error(`Failed to load ${filePath}:`, error)
  }
  return null
}

async function seed() {
  console.log('🌱 Starting database seeding...\n')
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set')
    process.exit(1)
  }
  
  try {
    // 테이블 초기화
    await initializeDatabase()
    
    // 1. 불법 사이트 목록 마이그레이션
    console.log('📥 Migrating illegal sites...')
    const illegalSites = await loadTextFile(path.join(DATA_DIR, 'illegal-sites.txt'))
    for (const domain of illegalSites) {
      await addSite(domain, 'illegal')
    }
    console.log(`   ✅ ${illegalSites.length} illegal sites migrated`)
    
    // 2. 합법 사이트 목록 마이그레이션
    console.log('📥 Migrating legal sites...')
    const legalSites = await loadTextFile(path.join(DATA_DIR, 'legal-sites.txt'))
    for (const domain of legalSites) {
      await addSite(domain, 'legal')
    }
    console.log(`   ✅ ${legalSites.length} legal sites migrated`)
    
    // 3. 작품 목록 마이그레이션
    console.log('📥 Migrating titles...')
    interface TitlesData {
      current: string[]
      history: string[]
    }
    const titlesData = await loadJsonFile<TitlesData>(path.join(DATA_DIR, 'titles.json'))
    if (titlesData) {
      for (const title of titlesData.current) {
        await addTitle(title)
      }
      console.log(`   ✅ ${titlesData.current.length} titles migrated`)
    }
    
    // 4. 세션 데이터 마이그레이션
    console.log('📥 Migrating sessions...')
    interface SessionsData {
      sessions: any[]
    }
    const sessionsData = await loadJsonFile<SessionsData>(path.join(DATA_DIR, 'sessions.json'))
    if (sessionsData?.sessions) {
      for (const session of sessionsData.sessions) {
        await createSession({
          id: session.id,
          status: session.status,
          titles_count: session.titles_count,
          keywords_count: session.keywords_count,
          total_searches: session.total_searches,
          results_total: session.results_summary?.total || 0,
          results_illegal: session.results_summary?.illegal || 0,
          results_legal: session.results_summary?.legal || 0,
          results_pending: session.results_summary?.pending || 0,
          file_final_results: session.files?.final_results || null,
        })
      }
      console.log(`   ✅ ${sessionsData.sessions.length} sessions migrated`)
    }
    
    // 5. 월별 통계 마이그레이션
    console.log('📥 Migrating monthly stats...')
    interface MonthlyStatsData {
      months: any[]
    }
    const monthlyData = await loadJsonFile<MonthlyStatsData>(path.join(DATA_DIR, 'monthly-stats.json'))
    if (monthlyData?.months) {
      for (const stats of monthlyData.months) {
        await upsertMonthlyStats({
          month: stats.month,
          sessions_count: stats.sessions_count,
          total: stats.total_stats?.total || 0,
          illegal: stats.total_stats?.illegal || 0,
          legal: stats.total_stats?.legal || 0,
          pending: stats.total_stats?.pending || 0,
          top_contents: stats.top_contents || [],
          top_illegal_sites: stats.top_illegal_sites || [],
        })
      }
      console.log(`   ✅ ${monthlyData.months.length} monthly stats migrated`)
    }
    
    // 6. 승인 대기 목록 마이그레이션
    console.log('📥 Migrating pending reviews...')
    const pendingData = await loadJsonFile<any[]>(path.join(DATA_DIR, 'pending-review.json'))
    if (pendingData) {
      for (const review of pendingData) {
        await createPendingReview({
          domain: review.domain,
          urls: review.urls,
          titles: review.titles,
          llm_judgment: review.llm_judgment,
          llm_reason: review.llm_reason,
          session_id: review.session_id,
        })
      }
      console.log(`   ✅ ${pendingData.length} pending reviews migrated`)
    }
    
    console.log('\n✅ Database seeding completed successfully!')
    
  } catch (error) {
    console.error('\n❌ Seeding failed:', error)
    process.exit(1)
  }
}

seed()
