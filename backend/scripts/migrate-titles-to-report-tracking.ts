/**
 * 기존 report_tracking 데이터에 title 컬럼 업데이트
 * 각 세션의 Blob JSON에서 URL → title 매핑을 추출하여 업데이트
 */

import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

interface FinalResult {
  title: string
  domain: string
  url: string
  final_status: string
}

async function downloadResults(blobUrl: string): Promise<FinalResult[]> {
  try {
    const response = await fetch(blobUrl)
    if (!response.ok) return []
    return await response.json()
  } catch {
    return []
  }
}

async function main() {
  console.log('🚀 Starting title migration for report_tracking...\n')
  
  // 1. 모든 세션 조회 (file_final_results가 있는 것만)
  const sessions = await sql`
    SELECT id, file_final_results 
    FROM sessions 
    WHERE status = 'completed' AND file_final_results IS NOT NULL
    ORDER BY created_at DESC
  `
  
  console.log(`📋 Found ${sessions.length} sessions with results\n`)
  
  let totalUpdated = 0
  let totalSkipped = 0
  
  for (const session of sessions) {
    const sessionId = session.id
    const blobUrl = session.file_final_results
    
    if (!blobUrl || !blobUrl.startsWith('http')) {
      console.log(`⏭️  Skipping session ${sessionId}: Invalid blob URL`)
      continue
    }
    
    console.log(`\n📥 Processing session: ${sessionId}`)
    
    // 2. Blob에서 결과 다운로드
    const results = await downloadResults(blobUrl)
    
    if (results.length === 0) {
      console.log(`   ⚠️  No results found in blob`)
      continue
    }
    
    // 3. URL → title 매핑 생성
    const urlToTitle: Record<string, string> = {}
    for (const r of results) {
      if (r.url && r.title) {
        urlToTitle[r.url] = r.title
      }
    }
    
    console.log(`   📊 Found ${Object.keys(urlToTitle).length} URL-title mappings`)
    
    // 4. report_tracking에서 해당 세션의 레코드 조회
    const trackingRecords = await sql`
      SELECT id, url, title FROM report_tracking 
      WHERE session_id = ${sessionId} AND title IS NULL
    `
    
    console.log(`   🔍 Found ${trackingRecords.length} records without title`)
    
    // 5. 각 레코드 업데이트
    let sessionUpdated = 0
    for (const record of trackingRecords) {
      const title = urlToTitle[record.url]
      if (title) {
        await sql`
          UPDATE report_tracking 
          SET title = ${title}, updated_at = NOW()
          WHERE id = ${record.id}
        `
        sessionUpdated++
      } else {
        totalSkipped++
      }
    }
    
    totalUpdated += sessionUpdated
    console.log(`   ✅ Updated ${sessionUpdated} records`)
  }
  
  console.log('\n' + '='.repeat(50))
  console.log('📊 Migration Summary')
  console.log('='.repeat(50))
  console.log(`   Total updated: ${totalUpdated}`)
  console.log(`   Total skipped (no title found): ${totalSkipped}`)
  console.log('\n✅ Migration completed!')
}

main().catch(console.error)
