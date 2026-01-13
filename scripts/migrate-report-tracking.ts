// ============================================
// Report Tracking 테이블 마이그레이션 스크립트
// ============================================

import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL || '')

async function migrateReportTracking() {
  console.log('🚀 신고결과 추적 테이블 마이그레이션 시작...\n')

  // 1. report_tracking 테이블 (URL별 신고 상태)
  console.log('📦 1. report_tracking 테이블 생성...')
  await sql`
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
  console.log('✅ report_tracking 테이블 생성 완료')

  // 2. report_tracking 인덱스
  console.log('📦 2. report_tracking 인덱스 생성...')
  await sql`
    CREATE INDEX IF NOT EXISTS idx_report_tracking_session 
    ON report_tracking(session_id, report_status)
  `
  console.log('✅ report_tracking 인덱스 생성 완료')

  // 3. report_uploads 테이블 (HTML 업로드 이력)
  console.log('📦 3. report_uploads 테이블 생성...')
  await sql`
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
  console.log('✅ report_uploads 테이블 생성 완료')

  // 4. report_reasons 테이블 (사유 드롭다운 옵션)
  console.log('📦 4. report_reasons 테이블 생성...')
  await sql`
    CREATE TABLE IF NOT EXISTS report_reasons (
      id SERIAL PRIMARY KEY,
      reason_text VARCHAR(255) UNIQUE NOT NULL,
      usage_count INTEGER DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `
  console.log('✅ report_reasons 테이블 생성 완료')

  // 5. 기본 사유 옵션 추가
  console.log('📦 5. 기본 사유 옵션 추가...')
  await sql`
    INSERT INTO report_reasons (reason_text, usage_count) VALUES
      ('저작권 미확인', 100),
      ('검토 필요', 99),
      ('중복 신고', 98),
      ('URL 오류', 97)
    ON CONFLICT (reason_text) DO NOTHING
  `
  console.log('✅ 기본 사유 옵션 추가 완료')

  // 6. 테이블 확인
  console.log('\n📊 생성된 테이블 확인...')
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('report_tracking', 'report_uploads', 'report_reasons')
    ORDER BY table_name
  `
  console.log('생성된 테이블:', tables.map(t => t.table_name).join(', '))

  console.log('\n🎉 신고결과 추적 테이블 마이그레이션 완료!')
}

migrateReportTracking().catch(console.error)
