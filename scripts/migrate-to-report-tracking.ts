// ============================================
// 과거 세션 불법 URL → report_tracking 마이그레이션
// ============================================

import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import * as fs from 'fs'
import * as path from 'path'

// ============================================
// Database Setup
// ============================================

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const sql = neon(DATABASE_URL)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function query(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
  return sql(strings, ...values) as Promise<any[]>
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
// Migration Functions
// ============================================

// 세션 목록 조회 (Blob URL 포함)
async function getSessions(): Promise<any[]> {
  return query`SELECT * FROM sessions ORDER BY created_at DESC`
}

// Blob에서 결과 다운로드
async function downloadResults(blobUrl: string): Promise<FinalResult[]> {
  try {
    const response = await fetch(blobUrl)
    if (!response.ok) return []
    return await response.json()
  } catch (error) {
    console.error(`Failed to download from ${blobUrl}:`, error)
    return []
  }
}

// 로컬 파일에서 결과 로드
function loadLocalResults(sessionId: string): FinalResult[] {
  const outputDir = path.join(process.cwd(), 'output')
  const filename = `4_final-results-${sessionId}.json`
  const filepath = path.join(outputDir, filename)
  
  if (fs.existsSync(filepath)) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      console.error(`Failed to load ${filepath}:`, error)
    }
  }
  return []
}

// 불법 사이트 목록 조회 (실시간 재계산용)
async function getIllegalDomains(): Promise<Set<string>> {
  const rows = await query`SELECT domain FROM sites WHERE type = 'illegal'`
  return new Set(rows.map((r: any) => r.domain.toLowerCase()))
}

// report_tracking에 등록
async function createReportTracking(tracking: {
  session_id: string
  url: string
  domain: string
  report_status?: string
}): Promise<any> {
  try {
    const rows = await query`
      INSERT INTO report_tracking (session_id, url, domain, report_status)
      VALUES (${tracking.session_id}, ${tracking.url}, ${tracking.domain.toLowerCase()}, ${tracking.report_status || '미신고'})
      ON CONFLICT (session_id, url) DO NOTHING
      RETURNING *
    `
    return rows[0]
  } catch (error) {
    // 중복 등 오류 무시
    return null
  }
}

// 기존 등록된 URL 조회
async function getExistingUrls(sessionId: string): Promise<Set<string>> {
  const rows = await query`SELECT url FROM report_tracking WHERE session_id = ${sessionId}`
  return new Set(rows.map((r: any) => r.url))
}

// ============================================
// Main Migration
// ============================================

async function migrateSessionToReportTracking() {
  console.log('🚀 과거 세션 데이터 → report_tracking 마이그레이션 시작...\n')
  
  // 1. 현재 불법 도메인 목록 가져오기
  const illegalDomains = await getIllegalDomains()
  console.log(`📋 현재 불법 도메인 수: ${illegalDomains.size}개\n`)
  
  // 2. 모든 세션 조회
  const sessions = await getSessions()
  console.log(`📂 총 세션 수: ${sessions.length}개\n`)
  
  let totalRegistered = 0
  let totalSkipped = 0
  let totalFailed = 0
  
  for (const session of sessions) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`📁 세션: ${session.id}`)
    console.log(`   생성일: ${session.created_at}`)
    console.log(`   상태: ${session.status}`)
    
    // 3. 결과 로드 (Blob URL 또는 로컬 파일)
    let results: FinalResult[] = []
    
    if (session.file_final_results?.startsWith('http')) {
      console.log(`   📥 Blob에서 로드 중...`)
      results = await downloadResults(session.file_final_results)
    }
    
    // Blob이 비어있으면 로컬 파일에서 로드 시도
    if (results.length === 0) {
      console.log(`   📥 로컬 파일에서 로드 시도...`)
      results = loadLocalResults(session.id)
    }
    
    if (results.length === 0) {
      console.log(`   ⚠️ 결과 데이터 없음 - 스킵`)
      continue
    }
    
    console.log(`   📊 총 결과 수: ${results.length}개`)
    
    // 4. 기존 등록된 URL 확인
    const existingUrls = await getExistingUrls(session.id)
    console.log(`   📌 기존 등록된 URL: ${existingUrls.size}개`)
    
    // 5. 불법 URL 필터링 (도메인이 불법 사이트 목록에 있는 것만)
    const illegalResults = results.filter(r => {
      const domain = r.domain.toLowerCase()
      return illegalDomains.has(domain)
    })
    
    console.log(`   🔴 불법 URL 수: ${illegalResults.length}개`)
    
    // URL 중복 제거
    const uniqueIllegalUrls = new Map<string, FinalResult>()
    for (const result of illegalResults) {
      if (!uniqueIllegalUrls.has(result.url)) {
        uniqueIllegalUrls.set(result.url, result)
      }
    }
    
    console.log(`   🔹 중복 제거 후: ${uniqueIllegalUrls.size}개`)
    
    let sessionRegistered = 0
    let sessionSkipped = 0
    let sessionFailed = 0
    
    for (const [url, result] of uniqueIllegalUrls) {
      // 이미 등록되어 있으면 스킵
      if (existingUrls.has(url)) {
        sessionSkipped++
        continue
      }
      
      try {
        const created = await createReportTracking({
          session_id: session.id,
          url: url,
          domain: result.domain,
          report_status: '미신고'
        })
        
        if (created) {
          sessionRegistered++
        } else {
          sessionSkipped++
        }
      } catch (error) {
        sessionFailed++
      }
    }
    
    console.log(`   ✅ 등록: ${sessionRegistered}개`)
    console.log(`   ⏭️ 스킵 (중복): ${sessionSkipped}개`)
    if (sessionFailed > 0) {
      console.log(`   ❌ 실패: ${sessionFailed}개`)
    }
    
    totalRegistered += sessionRegistered
    totalSkipped += sessionSkipped
    totalFailed += sessionFailed
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📊 마이그레이션 완료!`)
  console.log(`   ✅ 총 등록: ${totalRegistered}개`)
  console.log(`   ⏭️ 총 스킵: ${totalSkipped}개`)
  console.log(`   ❌ 총 실패: ${totalFailed}개`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}

// 실행
migrateSessionToReportTracking()
  .then(() => {
    console.log('✅ 마이그레이션 스크립트 실행 완료')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 마이그레이션 오류:', error)
    process.exit(1)
  })
