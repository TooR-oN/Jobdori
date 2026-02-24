// ============================================
// Jobdori - Hono Application for Vercel
// Vercel Serverless + Neon DB + Vercel Blob
// ============================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { neon } from '@neondatabase/serverless'
import * as XLSX from 'xlsx'
import bcrypt from 'bcryptjs'

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
// 대시보드 캐싱 (5분 TTL)
// ============================================

interface CacheEntry {
  data: any
  expiresAt: number
}

const dashboardCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5분

function getCachedDashboard(month: string): any | null {
  const entry = dashboardCache.get(month)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    dashboardCache.delete(month)
    return null
  }
  return entry.data
}

function setCachedDashboard(month: string, data: any): void {
  dashboardCache.set(month, {
    data,
    expiresAt: Date.now() + CACHE_TTL
  })
}

function invalidateDashboardCache(month?: string): void {
  if (month) {
    dashboardCache.delete(month)
  } else {
    dashboardCache.clear()
  }
}

// DB 마이그레이션 - page1_illegal_count 컬럼 추가
let dbMigrationDone = false
async function ensureDbMigration() {
  if (dbMigrationDone) return
  try {
    const db = getDatabase()
    // manta_rankings 테이블에 page1_illegal_count 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'manta_rankings' AND column_name = 'page1_illegal_count'
        ) THEN
          ALTER TABLE manta_rankings ADD COLUMN page1_illegal_count INTEGER DEFAULT 0;
        END IF;
      END $$
    `
    // manta_ranking_history 테이블에도 추가
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'manta_ranking_history' AND column_name = 'page1_illegal_count'
        ) THEN
          ALTER TABLE manta_ranking_history ADD COLUMN page1_illegal_count INTEGER DEFAULT 0;
        END IF;
      END $$
    `
    // pending_reviews 테이블에 domain UNIQUE 제약조건 추가
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'pending_reviews_domain_unique'
        ) THEN
          ALTER TABLE pending_reviews ADD CONSTRAINT pending_reviews_domain_unique UNIQUE (domain);
        END IF;
      END $$
    `
    
    // report_tracking 테이블 생성 (없으면)
    await db`
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
    
    // report_tracking 인덱스 생성
    await db`
      CREATE INDEX IF NOT EXISTS idx_report_tracking_session 
      ON report_tracking(session_id, report_status)
    `
    
    // report_uploads 테이블 생성 (없으면)
    await db`
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
    
    // report_reasons 테이블 생성 (없으면)
    await db`
      CREATE TABLE IF NOT EXISTS report_reasons (
        id SERIAL PRIMARY KEY,
        reason_text VARCHAR(255) UNIQUE NOT NULL,
        usage_count INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    // report_tracking 테이블에 title 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'report_tracking' AND column_name = 'title'
        ) THEN
          ALTER TABLE report_tracking ADD COLUMN title TEXT;
        END IF;
      END $$
    `
    
    // title 컬럼에 인덱스 추가
    await db`
      CREATE INDEX IF NOT EXISTS idx_report_tracking_title 
      ON report_tracking(title)
    `
    
    // titles 테이블에 manta_url 컬럼 추가 (없으면)
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'titles' AND column_name = 'manta_url'
        ) THEN
          ALTER TABLE titles ADD COLUMN manta_url TEXT;
        END IF;
      END $$
    `
    
    // excluded_urls 테이블 생성 (신고 제외 URL 관리)
    await db`
      CREATE TABLE IF NOT EXISTS excluded_urls (
        id SERIAL PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    
    // deep_monitoring_targets 테이블 생성 (집중 모니터링)
    await db`
      CREATE TABLE IF NOT EXISTS deep_monitoring_targets (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(50) NOT NULL,
        title TEXT NOT NULL,
        domain VARCHAR(255) NOT NULL,
        url_count INTEGER DEFAULT 0,
        base_keyword TEXT,
        deep_query TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        results_count INTEGER DEFAULT 0,
        new_urls_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        executed_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        UNIQUE(session_id, title, domain)
      )
    `
    await db`
      CREATE INDEX IF NOT EXISTS idx_deep_monitoring_session
      ON deep_monitoring_targets(session_id)
    `

    // detection_results에 source, deep_target_id 컬럼 추가 (없으면)
    try {
      await db`ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'regular'`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: detection_results.source error:', e.message)
    }
    try {
      await db`ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS deep_target_id INTEGER`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: detection_results.deep_target_id error:', e.message)
    }

    // sessions에 deep_monitoring 관련 컬럼 추가 (없으면)
    try {
      await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deep_monitoring_executed BOOLEAN DEFAULT false`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sessions.deep_monitoring_executed error:', e.message)
    }
    try {
      await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deep_monitoring_targets_count INTEGER DEFAULT 0`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sessions.deep_monitoring_targets_count error:', e.message)
    }
    try {
      await db`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deep_monitoring_new_urls INTEGER DEFAULT 0`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sessions.deep_monitoring_new_urls error:', e.message)
    }

    // domain_analysis_reports 테이블 생성 (월간 불법 도메인 분석 리포트)
    await db`
      CREATE TABLE IF NOT EXISTS domain_analysis_reports (
        id SERIAL PRIMARY KEY,
        analysis_month VARCHAR(7) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        manus_task_id VARCHAR(100),
        total_domains INTEGER DEFAULT 0,
        report_blob_url TEXT,
        report_markdown TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        error_message TEXT,
        UNIQUE(analysis_month)
      )
    `

    // domain_analysis_results 테이블 생성 (도메인별 상세 트래픽 데이터)
    // Semrush 제거됨 — size_score + growth_score + type_score 체계로 변경
    await db`
      CREATE TABLE IF NOT EXISTS domain_analysis_results (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES domain_analysis_reports(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL,
        domain VARCHAR(255) NOT NULL,
        threat_score DECIMAL(5,1) DEFAULT 0,
        global_rank INTEGER,
        total_visits BIGINT,
        unique_visitors BIGINT,
        bounce_rate DECIMAL(5,4),
        discovered INTEGER DEFAULT 0,
        visits_change_mom DECIMAL(7,1),
        rank_change_mom INTEGER,
        size_score DECIMAL(5,1),
        growth_score DECIMAL(5,1),
        type_score DECIMAL(5,1) DEFAULT 0,
        site_type VARCHAR(30),
        traffic_analysis VARCHAR(50),
        traffic_analysis_detail TEXT,
        recommendation TEXT,
        recommendation_detail TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(report_id, domain)
      )
    `
    await db`
      CREATE INDEX IF NOT EXISTS idx_domain_analysis_results_report
      ON domain_analysis_results(report_id, rank)
    `

    // sites 테이블에 site_type 컬럼 추가 (사이트 분류: scanlation_group, aggregator, clone, blog, unclassified)
    try {
      await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_type VARCHAR(30) DEFAULT 'unclassified'`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sites.site_type error:', e.message)
    }

    // sites 테이블에 site_status, new_url 컬럼 추가 (불법 사이트 현황: active, closed, changed)
    try {
      await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_status VARCHAR(20) DEFAULT 'active'`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sites.site_status error:', e.message)
    }
    try {
      await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS new_url TEXT`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sites.new_url error:', e.message)
    }

    // domain_analysis_results에 site_type, type_score 컬럼 추가
    try {
      await db`ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS site_type VARCHAR(30)`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: domain_analysis_results.site_type error:', e.message)
    }
    try {
      await db`ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS type_score DECIMAL(5,1) DEFAULT 0`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: domain_analysis_results.type_score error:', e.message)
    }

    // Semrush 컬럼 제거 (더 이상 사용하지 않음)
    try {
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS total_backlinks`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS referring_domains`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS top_organic_keywords`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS top_referring_domains`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS top_anchors`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS branded_traffic_ratio`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS influence_score`
    } catch (e: any) {
      console.error('Migration: Semrush column removal error:', e.message)
    }

    // Country 컬럼 제거 (SimilarWeb 스킬에서 country 관련 API 제외)
    try {
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS country`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS country_rank`
    } catch (e: any) {
      console.error('Migration: Country column removal error:', e.message)
    }

    // 공식 SimilarWeb 스킬 미지원 컬럼 제거 (Option B)
    try {
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS avg_visit_duration`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS pages_per_visit`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS page_views`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS category`
      await db`ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS category_rank`
    } catch (e: any) {
      console.error('Migration: Unsupported SimilarWeb column removal error:', e.message)
    }

    // (신규 트래픽 메트릭 컬럼은 이제 CREATE TABLE에 포함됨 — 별도 마이그레이션 불필요)

    // 트래픽 분석 + 권고 상세 컬럼 추가
    try {
      await db`ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS traffic_analysis VARCHAR(50)`
      await db`ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS traffic_analysis_detail TEXT`
      await db`ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS recommendation_detail TEXT`
    } catch (e: any) {
      console.error('Migration: traffic_analysis/recommendation_detail columns error:', e.message)
    }

    // 발견 수 컬럼 추가 (도메인별 불법 URL 탐지 건수)
    try {
      await db`ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS discovered INTEGER DEFAULT 0`
    } catch (e: any) {
      console.error('Migration: discovered column error:', e.message)
    }

    // visits_change_mom DECIMAL 오버플로우 방지 (5,1 → 7,1)
    try {
      await db`ALTER TABLE domain_analysis_results ALTER COLUMN visits_change_mom TYPE DECIMAL(7,1)`
    } catch (e: any) {
      if (!e.message?.includes('already')) console.error('Migration: visits_change_mom type change error:', e.message)
    }

    // sites 테이블에 distribution_channel 컬럼 추가 (유통 경로)
    try {
      await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS distribution_channel VARCHAR(50) DEFAULT '웹'`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sites.distribution_channel error:', e.message)
    }

    // site_notes 테이블 생성 (활동 이력 — 메모 + 유통 경로 변경 기록)
    await db`
      CREATE TABLE IF NOT EXISTS site_notes (
        id SERIAL PRIMARY KEY,
        domain VARCHAR(500) NOT NULL,
        note_type VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    try {
      await db`CREATE INDEX IF NOT EXISTS idx_site_notes_domain ON site_notes(domain)`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: idx_site_notes_domain error:', e.message)
    }

    // distribution_channels 테이블 생성 (사용자 추가 가능한 유통 경로 옵션)
    await db`
      CREATE TABLE IF NOT EXISTS distribution_channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    // 기본 유통 경로 초기 데이터 삽입
    const defaultChannels = ['웹', 'APK', '텔레그램', '디스코드']
    for (const ch of defaultChannels) {
      try {
        await db`INSERT INTO distribution_channels (name, is_default) VALUES (${ch}, true) ON CONFLICT (name) DO NOTHING`
      } catch (e: any) {
        // 중복 무시
      }
    }

    // sites 테이블에 language 컬럼 추가 (사이트 언어)
    try {
      await db`ALTER TABLE sites ADD COLUMN IF NOT EXISTS language VARCHAR(50) DEFAULT 'unset'`
    } catch (e: any) {
      if (!e.message?.includes('already exists')) console.error('Migration: sites.language error:', e.message)
    }

    // site_languages 테이블 생성 (사용자 추가 가능한 언어 옵션)
    await db`
      CREATE TABLE IF NOT EXISTS site_languages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `
    // 기본 언어 초기 데이터 삽입
    const defaultLanguages = ['다국어', '영어', '스페인어', '포르투갈어', '러시아어', '아랍어', '태국어', '인도네시아어', '중국어']
    for (const lang of defaultLanguages) {
      try {
        await db`INSERT INTO site_languages (name, is_default) VALUES (${lang}, true) ON CONFLICT (name) DO NOTHING`
      } catch (e: any) {
        // 중복 무시
      }
    }

    // manta_rankings / manta_ranking_history 테이블에 top30_illegal_count 컬럼 추가
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'manta_rankings' AND column_name = 'top30_illegal_count'
        ) THEN
          ALTER TABLE manta_rankings ADD COLUMN top30_illegal_count INTEGER DEFAULT 0;
          UPDATE manta_rankings SET top30_illegal_count = COALESCE(page1_illegal_count, 0);
        END IF;
      END $$
    `
    await db`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'manta_ranking_history' AND column_name = 'top30_illegal_count'
        ) THEN
          ALTER TABLE manta_ranking_history ADD COLUMN top30_illegal_count INTEGER DEFAULT 0;
          UPDATE manta_ranking_history SET top30_illegal_count = COALESCE(page1_illegal_count, 0);
        END IF;
      END $$
    `

    // system_settings 테이블 생성 (관리자 설정용)
    await db`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `
    // 기본값: 모니터링 작품 수 제한 20개
    await db`
      INSERT INTO system_settings (key, value) VALUES ('max_monitoring_titles', '20')
      ON CONFLICT (key) DO NOTHING
    `

    // 기본값: 모니터링 키워드 접미사 (빈 문자열 = 작품명만 검색)
    await db`
      INSERT INTO system_settings (key, value) VALUES ('monitoring_keyword_suffixes', '["", "manga", "chapter"]')
      ON CONFLICT (key) DO NOTHING
    `

    // keyword_history 테이블 생성 (삭제된 키워드 히스토리)
    await db`
      CREATE TABLE IF NOT EXISTS keyword_history (
        id SERIAL PRIMARY KEY,
        suffix VARCHAR(200) NOT NULL,
        deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_permanent_deleted BOOLEAN DEFAULT false
      )
    `

    dbMigrationDone = true
    console.log('✅ DB migration completed (including report_tracking, deep_monitoring, domain_analysis, site_notes, site_languages, top30_illegal_count, system_settings, keyword_history tables)')
  } catch (error) {
    console.error('DB migration error:', error)
  }
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
// Auth Setup - ID/PW 기반 인증
// ============================================

// 환경변수 관리자 인증 (비상용 백도어 - DB 장애 시 사용)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || ''
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || ''

// 세션 시크릿 (토큰 서명용)
const SECRET_KEY = process.env.SESSION_SECRET || 'jobdori-secret-key-2026'

// 사용자 역할 타입 (admin: 관리자, user: 일반 사용자)
type UserRole = 'admin' | 'user'

// 토큰 페이로드 타입
interface TokenPayload {
  exp: number
  username: string
  role: UserRole
}

// bcrypt 해시 비교 (정적 import 사용)
async function comparePassword(password: string, hash: string): Promise<boolean> {
  try {
    if (!hash || !hash.startsWith('$2')) return false
    return bcrypt.compareSync(password, hash)
  } catch {
    return false
  }
}

// HMAC-SHA256으로 토큰 서명 생성
async function createSignedToken(payload: TokenPayload): Promise<string> {
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

// 서명된 토큰 검증 및 페이로드 반환
async function verifySignedToken(token: string): Promise<TokenPayload | null> {
  try {
    const [dataB64, signatureB64] = token.split('.')
    if (!dataB64 || !signatureB64) return null
    
    const data = atob(dataB64)
    const payload: TokenPayload = JSON.parse(data)
    
    // 만료 시간 확인
    if (payload.exp && Date.now() > payload.exp) return null
    
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
    return isValid ? payload : null
  } catch {
    return null
  }
}

// 레거시 호환: boolean 반환 버전
async function verifySignedTokenBool(token: string): Promise<boolean> {
  return (await verifySignedToken(token)) !== null
}

// 환경변수 관리자 인증 (비상용 백도어 - DB 장애 시 사용)
async function authenticateSuperAdmin(username: string, password: string): Promise<boolean> {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) return false
  if (username !== ADMIN_USERNAME) return false
  return await comparePassword(password, ADMIN_PASSWORD_HASH)
}

// 일반 사용자 인증 (DB 기반)
async function authenticateUser(username: string, password: string): Promise<{ success: boolean; role: UserRole } | null> {
  try {
    const users = await query`
      SELECT id, username, password_hash, role, is_active 
      FROM users 
      WHERE username = ${username} AND is_active = true
    `
    if (users.length === 0) return null
    
    const user = users[0]
    const isValid = await comparePassword(password, user.password_hash)
    if (!isValid) return null
    
    return { success: true, role: user.role as UserRole }
  } catch {
    return null
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

async function updatePendingReviewAiResult(id: number, judgment: string, reason: string): Promise<boolean> {
  await query`
    UPDATE pending_reviews 
    SET llm_judgment = ${judgment}, llm_reason = ${reason}
    WHERE id = ${id}
  `
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

// detection_results의 final_status 업데이트 (도메인 기반)
async function updateDetectionResultsByDomain(domain: string, newStatus: 'illegal' | 'legal'): Promise<number> {
  const result = await query`
    UPDATE detection_results 
    SET final_status = ${newStatus}, reviewed_at = NOW()
    WHERE LOWER(domain) = ${domain.toLowerCase()} AND final_status = 'pending'
    RETURNING id
  `
  return result.length
}

async function getCurrentTitles(): Promise<any[]> {
  return query`SELECT id, name, is_current, created_at, manta_url, unofficial_titles FROM titles WHERE is_current = true ORDER BY created_at DESC`
}

async function getHistoryTitles(): Promise<any[]> {
  return query`SELECT id, name, is_current, created_at, manta_url, unofficial_titles FROM titles WHERE is_current = false ORDER BY created_at DESC`
}

/**
 * 작품명 정규화 - 특수문자 통일 (중복 방지용)
 * 예: 곡선 따옴표 ' → 직선 따옴표 '
 */
function normalizeTitle(name: string): string {
  return name
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // 곡선 작은따옴표 → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // 곡선 큰따옴표 → "
    .replace(/\u2014/g, '-')  // em dash → -
    .replace(/\u2013/g, '-')  // en dash → -
    .replace(/\s+/g, ' ')     // 연속 공백 → 단일 공백
    .trim()
}

async function addTitle(name: string, mantaUrl?: string): Promise<any> {
  // 입력값 정규화
  const normalizedName = normalizeTitle(name)
  
  // 기존 작품 중복 체크 (정규화된 이름으로 비교)
  const existing = await query`
    SELECT id, name, is_current FROM titles
  `
  
  // 정규화된 이름으로 기존 작품 찾기
  const duplicateEntry = existing.find((t: any) => 
    normalizeTitle(t.name) === normalizedName
  )
  
  if (duplicateEntry) {
    // 기존 작품이 있으면 해당 작품의 is_current를 true로 업데이트
    const rows = await query`
      UPDATE titles 
      SET is_current = true, 
          manta_url = COALESCE(${mantaUrl || null}, manta_url)
      WHERE id = ${duplicateEntry.id}
      RETURNING *
    `
    console.log(`📌 기존 작품 복원: "${duplicateEntry.name}" (ID: ${duplicateEntry.id})`)
    return { ...rows[0], restored: true, originalName: duplicateEntry.name }
  }
  
  // 새 작품 추가
  const rows = await query`
    INSERT INTO titles (name, is_current, manta_url)
    VALUES (${normalizedName}, true, ${mantaUrl || null})
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

// ============================================
// Monthly Stats (detection_results 기반 - 실시간 집계)
// ============================================

async function getMonthlyStats(): Promise<any[]> {
  // 완료된 세션의 월 목록 조회
  const monthsResult = await query`
    SELECT DISTINCT SUBSTRING(id, 1, 7) as month 
    FROM sessions 
    WHERE status = 'completed' 
    ORDER BY month DESC
  `
  
  const stats: any[] = []
  for (const row of monthsResult) {
    const monthStats = await getMonthlyStatsByMonth(row.month)
    if (monthStats) {
      stats.push(monthStats)
    }
  }
  return stats
}

async function getMonthlyStatsByMonth(month: string): Promise<any | null> {
  // 단일 CTE 쿼리로 모든 데이터 조회 (5개 쿼리 → 1개 쿼리)
  const monthPattern = month + '%'
  
  const result = await query`
    WITH session_data AS (
      SELECT 
        COUNT(*) as sessions_count,
        MAX(completed_at) as last_updated
      FROM sessions 
      WHERE id LIKE ${monthPattern} AND status = 'completed'
    ),
    stats_data AS (
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE final_status = 'illegal') as illegal,
        COUNT(*) FILTER (WHERE final_status = 'legal') as legal,
        COUNT(*) FILTER (WHERE final_status = 'pending') as pending
      FROM detection_results
      WHERE session_id LIKE ${monthPattern}
    ),
    top_contents AS (
      SELECT title as name, COUNT(*) as count
      FROM report_tracking
      WHERE session_id LIKE ${monthPattern} AND report_status != '미신고' AND title IS NOT NULL
      GROUP BY title
      ORDER BY count DESC
      LIMIT 10
    ),
    top_domains AS (
      SELECT domain, COUNT(*) as count
      FROM report_tracking
      WHERE session_id LIKE ${monthPattern} AND report_status != '미신고'
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    )
    SELECT 
      (SELECT sessions_count FROM session_data) as sessions_count,
      (SELECT last_updated FROM session_data) as last_updated,
      (SELECT total FROM stats_data) as total,
      (SELECT illegal FROM stats_data) as illegal,
      (SELECT legal FROM stats_data) as legal,
      (SELECT pending FROM stats_data) as pending,
      (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM top_contents) as top_contents,
      (SELECT COALESCE(json_agg(json_build_object('domain', domain, 'count', count)), '[]'::json) FROM top_domains) as top_domains
  `
  
  const data = result[0]
  const sessionsCount = parseInt(data?.sessions_count) || 0
  
  if (sessionsCount === 0) {
    return null
  }
  
  return {
    id: 0,
    month,
    sessions_count: sessionsCount,
    total: parseInt(data?.total) || 0,
    illegal: parseInt(data?.illegal) || 0,
    legal: parseInt(data?.legal) || 0,
    pending: parseInt(data?.pending) || 0,
    top_contents: data?.top_contents || [],
    top_illegal_sites: data?.top_domains || [],
    last_updated: data?.last_updated || new Date().toISOString()
  }
}

// ============================================
// Report Tracking Functions (신고결과 추적)
// ============================================

// 신고 추적 항목 생성 (불법 URL 등록)
async function createReportTracking(item: {
  session_id: string
  url: string
  domain: string
  title?: string
  report_status?: string
  report_id?: string
  reason?: string
}): Promise<any> {
  const rows = await query`
    INSERT INTO report_tracking (session_id, url, domain, title, report_status, report_id, reason)
    VALUES (${item.session_id}, ${item.url}, ${item.domain}, ${item.title || null}, ${item.report_status || '미신고'}, 
            ${item.report_id || null}, ${item.reason || null})
    ON CONFLICT (session_id, url) DO UPDATE SET
      report_status = COALESCE(EXCLUDED.report_status, report_tracking.report_status),
      title = COALESCE(EXCLUDED.title, report_tracking.title),
      updated_at = NOW()
    RETURNING *
  `
  return rows[0]
}

// 회차별 신고 추적 목록 조회
async function getReportTrackingBySession(
  sessionId: string,
  filter?: string,
  page: number = 1,
  limit: number = 50,
  search?: string
): Promise<{ items: any[], total: number }> {
  const offset = (page - 1) * limit
  const searchPattern = search ? `%${search.toLowerCase()}%` : null
  
  let rows: any[]
  let countResult: any[]
  
  if (filter && filter !== '전체' && searchPattern) {
    // 상태 필터 + 검색어
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId} 
        AND report_status = ${filter}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId} 
        AND report_status = ${filter}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
    `
  } else if (filter && filter !== '전체') {
    // 상태 필터만
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
    `
  } else if (searchPattern) {
    // 검색어만
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId}
        AND (LOWER(url) LIKE ${searchPattern} OR LOWER(domain) LIKE ${searchPattern})
    `
  } else {
    // 필터 없음
    rows = await query`
      SELECT * FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    countResult = await query`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${sessionId}
    `
  }
  
  return {
    items: rows,
    total: parseInt(countResult[0]?.count || '0')
  }
}

// 회차별 신고 통계 조회
async function getReportTrackingStatsBySession(sessionId: string): Promise<{
  total: number
  차단: number
  '대기 중': number
  색인없음: number
  거부: number
  미신고: number
}> {
  const rows = await query`
    SELECT report_status, COUNT(*) as count 
    FROM report_tracking 
    WHERE session_id = ${sessionId}
    GROUP BY report_status
  `
  
  const stats = {
    total: 0,
    '차단': 0,
    '대기 중': 0,
    '색인없음': 0,
    '거부': 0,
    '미신고': 0
  }
  
  for (const row of rows) {
    const status = row.report_status as keyof typeof stats
    const count = parseInt(row.count)
    if (status in stats) {
      (stats as any)[status] = count
    }
    stats.total += count
  }
  
  return stats
}

// 신고 추적 상태 업데이트
async function updateReportTrackingStatus(
  id: number,
  status: string,
  reportId?: string
): Promise<any | null> {
  const rows = await query`
    UPDATE report_tracking SET
      report_status = ${status},
      report_id = COALESCE(${reportId || null}, report_id),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] || null
}

// 신고 추적 사유 업데이트
async function updateReportTrackingReason(id: number, reason: string): Promise<any | null> {
  const rows = await query`
    UPDATE report_tracking SET
      reason = ${reason},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  return rows[0] || null
}

// URL 매칭으로 상태 일괄 업데이트 (HTML 업로드 시)
async function bulkUpdateReportTrackingByUrls(
  sessionId: string,
  urls: string[],
  status: string,
  reportId: string
): Promise<number> {
  if (urls.length === 0) return 0
  
  const result = await query`
    UPDATE report_tracking SET
      report_status = ${status},
      report_id = ${reportId},
      updated_at = NOW()
    WHERE session_id = ${sessionId} AND url = ANY(${urls})
    RETURNING id
  `
  return result.length
}

// 회차별 URL 목록 조회 (복사용)
async function getReportTrackingUrls(sessionId: string, filter?: string): Promise<string[]> {
  let rows: any[]
  
  if (filter && filter !== '전체') {
    rows = await query`
      SELECT url FROM report_tracking 
      WHERE session_id = ${sessionId} AND report_status = ${filter}
      ORDER BY updated_at DESC
    `
  } else {
    rows = await query`
      SELECT url FROM report_tracking 
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC
    `
  }
  
  return rows.map(r => r.url)
}

// 업로드 이력 조회
async function getReportUploadsBySession(sessionId: string): Promise<any[]> {
  return query`
    SELECT * FROM report_uploads 
    WHERE session_id = ${sessionId}
    ORDER BY uploaded_at DESC
  `
}

// 업로드 이력 생성
async function createReportUpload(upload: {
  session_id: string
  report_id: string
  file_name?: string
  matched_count?: number
  total_urls_in_html?: number
}): Promise<any> {
  const rows = await query`
    INSERT INTO report_uploads (session_id, report_id, file_name, matched_count, total_urls_in_html)
    VALUES (${upload.session_id}, ${upload.report_id}, ${upload.file_name || null}, 
            ${upload.matched_count || 0}, ${upload.total_urls_in_html || 0})
    RETURNING *
  `
  return rows[0]
}

// 업로드 이력 신고 ID 수정
async function updateReportUploadId(uploadId: number, newReportId: string): Promise<any> {
  const rows = await query`
    UPDATE report_uploads 
    SET report_id = ${newReportId}
    WHERE id = ${uploadId}
    RETURNING *
  `
  return rows[0]
}

// 사유 목록 조회 (사용 빈도순)
async function getReportReasons(): Promise<any[]> {
  return query`
    SELECT * FROM report_reasons 
    ORDER BY usage_count DESC, created_at ASC
  `
}

// 사유 추가 또는 사용 횟수 증가
async function addOrUpdateReportReason(reasonText: string): Promise<any> {
  const rows = await query`
    INSERT INTO report_reasons (reason_text, usage_count)
    VALUES (${reasonText}, 1)
    ON CONFLICT (reason_text) DO UPDATE SET
      usage_count = report_reasons.usage_count + 1
    RETURNING *
  `
  return rows[0]
}

// 도메인으로 세션 내 모든 URL을 report_tracking에 등록 (title 포함)
async function registerIllegalUrlsToReportTracking(
  sessionId: string,
  domain: string,
  urls: { url: string, title?: string }[]
): Promise<number> {
  // 신고 제외 URL 목록 조회
  const excludedRows = await query`SELECT url FROM excluded_urls`
  const excludedUrls = new Set(excludedRows.map((r: any) => r.url))
  
  // 이전 세션에서 중복 거부된 URL 목록 조회 (벌크)
  const urlList = urls.map(u => u.url)
  const duplicateRejectedRows = urlList.length > 0
    ? await query`
        SELECT DISTINCT url FROM report_tracking
        WHERE url = ANY(${urlList})
          AND session_id != ${sessionId}
          AND report_status = '거부'
          AND reason ILIKE '%중복%'
      `
    : []
  const duplicateRejectedUrls = new Set(duplicateRejectedRows.map((r: any) => r.url))
  
  let registered = 0
  for (const item of urls) {
    try {
      // 신고 제외 URL인지 확인 (정확히 일치)
      const isExcluded = excludedUrls.has(item.url)
      // 이전 세션에서 중복 거부된 URL인지 확인
      const isDuplicateRejected = duplicateRejectedUrls.has(item.url)
      
      let reason: string | undefined = undefined
      if (isExcluded) {
        reason = '웹사이트 메인 페이지'
      } else if (isDuplicateRejected) {
        reason = '기존 요청과 중복된 요청'
      }
      
      await createReportTracking({
        session_id: sessionId,
        url: item.url,
        domain,
        title: item.title,
        report_status: '미신고',
        reason
      })
      registered++
    } catch {
      // 중복 등 오류 무시
    }
  }
  return registered
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

// 서브도메인 포함 매칭 (예: kr.pinterest.com → pinterest.com 매칭)
function checkDomainInList(domain: string, list: Set<string>): boolean {
  if (list.has(domain)) return true
  const parts = domain.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (list.has(parts.slice(i).join('.'))) return true
  }
  return false
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
    
    // 사이트 목록 기반으로 재계산 (합법은 서브도메인 포함 매칭)
    if (illegalDomains.has(domain)) {
      newFinalStatus = 'illegal'
    } else if (checkDomainInList(domain, legalDomains)) {
      newFinalStatus = 'legal'
    } else if (r.llm_judgment === 'likely_illegal') {
      newFinalStatus = 'pending'
    } else if (r.llm_judgment === 'likely_legal') {
      newFinalStatus = 'pending'
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
  if (sessionToken && await verifySignedTokenBool(sessionToken)) {
    return c.redirect('/')
  }
  
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
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
      <div class="mb-4">
        <label class="block text-gray-700 text-sm font-medium mb-2">아이디</label>
        <input type="text" id="username" 
               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
               placeholder="아이디를 입력하세요" required autofocus autocomplete="username">
      </div>
      <div class="mb-6">
        <label class="block text-gray-700 text-sm font-medium mb-2">비밀번호</label>
        <input type="password" id="password" 
               class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
               placeholder="비밀번호를 입력하세요" required autocomplete="current-password">
      </div>
      <div id="error-message" class="hidden mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
        아이디 또는 비밀번호가 올바르지 않습니다.
      </div>
      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition">
        <i class="fas fa-sign-in-alt mr-2"></i>로그인
      </button>
    </form>
  </div>
  <script>
    async function handleLogin(event) {
      event.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.success) {
        window.location.href = '/';
      } else {
        document.getElementById('error-message').classList.remove('hidden');
        document.getElementById('error-message').textContent = data.error || '아이디 또는 비밀번호가 올바르지 않습니다.';
      }
    }
  </script>
</body>
</html>
  `)
})

app.post('/api/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json()
    
    if (!username || !password) {
      return c.json({ success: false, error: '아이디와 비밀번호를 입력하세요.' }, 400)
    }
    
    let role: UserRole = 'user'
    let authenticated = false
    
    // 1. DB 사용자 인증 시도 (우선)
    const userAuth = await authenticateUser(username, password)
    if (userAuth) {
      authenticated = true
      role = userAuth.role
    }
    
    // 2. DB 인증 실패 시 환경변수 관리자 인증 시도 (비상용 백도어)
    if (!authenticated && await authenticateSuperAdmin(username, password)) {
      authenticated = true
      role = 'admin'
    }
    
    if (authenticated) {
      // 24시간 후 만료
      const exp = Date.now() + 24 * 60 * 60 * 1000
      const token = await createSignedToken({ exp, username, role })
      setCookie(c, 'session_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: 60 * 60 * 24,
        path: '/'
      })
      return c.json({ success: true, user: { username, role } })
    }
    
    return c.json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401)
  } catch (error) {
    console.error('로그인 오류:', error)
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
  
  const payload = await verifySignedToken(sessionToken)
  if (!payload) return c.json({ authenticated: false })
  
  return c.json({ 
    authenticated: true,
    user: {
      username: payload.username,
      role: payload.role
    }
  })
})

// Auth Middleware
app.use('*', async (c, next) => {
  const path = c.req.path
  const publicPaths = ['/login', '/api/auth/login', '/api/auth/status', '/robots.txt']
  if (publicPaths.some(p => path.startsWith(p))) return next()
  
  const sessionToken = getCookie(c, 'session_token')
  const payload = sessionToken ? await verifySignedToken(sessionToken) : null
  if (!payload) {
    if (path.startsWith('/api/')) {
      return c.json({ success: false, error: '인증이 필요합니다.' }, 401)
    }
    return c.redirect('/login')
  }
  
  // 현재 사용자 정보를 컨텍스트에 저장
  c.set('user', payload)
  return next()
})

// 역할 기반 접근 제어 헬퍼
function requireRole(allowedRoles: UserRole[]) {
  return async (c: any, next: any) => {
    const user = c.get('user') as TokenPayload | undefined
    if (!user || !allowedRoles.includes(user.role)) {
      return c.json({ success: false, error: '접근 권한이 없습니다.' }, 403)
    }
    return next()
  }
}

// 관리자 역할 필수 접근 제어 (admin 역할만 접근 가능)
function requireAdmin() {
  return async (c: any, next: any) => {
    const user = c.get('user') as TokenPayload | undefined
    if (!user || user.role !== 'admin') {
      return c.json({ success: false, error: '관리자 권한이 필요합니다.' }, 403)
    }
    return next()
  }
}

// ============================================
// 봇/크롤러 차단 - robots.txt
// ============================================

app.get('/robots.txt', (c) => {
  return c.text(`User-agent: *
Disallow: /

# 모든 검색 엔진 크롤러 차단
User-agent: Googlebot
Disallow: /

User-agent: Bingbot
Disallow: /

User-agent: Yandex
Disallow: /

User-agent: Baiduspider
Disallow: /
`, 200, { 'Content-Type': 'text/plain' })
})

// ============================================
// API - 사용자 계정 관리 (Admin Only)
// ============================================

// 사용자 목록 조회 (슈퍼관리자만)
app.get('/api/users', requireRole(['admin']), async (c) => {
  try {
    const users = await query`
      SELECT id, username, role, is_active, created_at, updated_at 
      FROM users 
      ORDER BY created_at DESC
    `
    return c.json({ success: true, users })
  } catch (error) {
    console.error('사용자 목록 조회 오류:', error)
    return c.json({ success: false, error: '사용자 목록을 불러오지 못했습니다.' }, 500)
  }
})

// 사용자 생성 (슈퍼관리자만)
app.post('/api/users', requireRole(['admin']), async (c) => {
  try {
    const { username, password, role = 'user' } = await c.req.json()
    
    if (!username || !password) {
      return c.json({ success: false, error: '아이디와 비밀번호를 입력하세요.' }, 400)
    }
    
    if (username.length < 3 || username.length > 50) {
      return c.json({ success: false, error: '아이디는 3~50자여야 합니다.' }, 400)
    }
    
    if (password.length < 6) {
      return c.json({ success: false, error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
    }
    
    const validRoles: UserRole[] = ['user', 'admin']
    if (!validRoles.includes(role)) {
      return c.json({ success: false, error: '유효하지 않은 역할입니다.' }, 400)
    }
    
    // 중복 체크
    const existing = await query`SELECT id FROM users WHERE username = ${username}`
    if (existing.length > 0) {
      return c.json({ success: false, error: '이미 존재하는 아이디입니다.' }, 400)
    }
    
    // 비밀번호 해시 (정적 import 사용)
    const passwordHash = bcrypt.hashSync(password, 10)
    
    const result = await query`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (${username}, ${passwordHash}, ${role}, true)
      RETURNING id, username, role, is_active, created_at
    `
    
    return c.json({ success: true, user: result[0] })
  } catch (error) {
    console.error('사용자 생성 오류:', error)
    return c.json({ success: false, error: '사용자 생성에 실패했습니다.' }, 500)
  }
})

// 사용자 정보 수정 (슈퍼관리자만)
app.put('/api/users/:id', requireRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { role, is_active, password } = await c.req.json()
    
    // 사용자 존재 확인
    const existing = await query`SELECT id, username FROM users WHERE id = ${id}`
    if (existing.length === 0) {
      return c.json({ success: false, error: '사용자를 찾을 수 없습니다.' }, 404)
    }
    
    // 업데이트할 필드 처리 (정적 import 사용)
    if (password && password.length >= 6) {
      const passwordHash = bcrypt.hashSync(password, 10)
      await query`
        UPDATE users 
        SET password_hash = ${passwordHash}, updated_at = NOW()
        WHERE id = ${id}
      `
    }
    
    if (role !== undefined) {
      const validRoles: UserRole[] = ['user', 'admin']
      if (!validRoles.includes(role)) {
        return c.json({ success: false, error: '유효하지 않은 역할입니다.' }, 400)
      }
      await query`UPDATE users SET role = ${role}, updated_at = NOW() WHERE id = ${id}`
    }
    
    if (is_active !== undefined) {
      await query`UPDATE users SET is_active = ${is_active}, updated_at = NOW() WHERE id = ${id}`
    }
    
    const updated = await query`
      SELECT id, username, role, is_active, created_at, updated_at 
      FROM users WHERE id = ${id}
    `
    
    return c.json({ success: true, user: updated[0] })
  } catch (error) {
    console.error('사용자 수정 오류:', error)
    return c.json({ success: false, error: '사용자 정보 수정에 실패했습니다.' }, 500)
  }
})

// 사용자 삭제 (슈퍼관리자만)
app.delete('/api/users/:id', requireRole(['admin']), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    
    const existing = await query`SELECT id, username FROM users WHERE id = ${id}`
    if (existing.length === 0) {
      return c.json({ success: false, error: '사용자를 찾을 수 없습니다.' }, 404)
    }
    
    await query`DELETE FROM users WHERE id = ${id}`
    
    return c.json({ success: true, message: '사용자가 삭제되었습니다.' })
  } catch (error) {
    console.error('사용자 삭제 오류:', error)
    return c.json({ success: false, error: '사용자 삭제에 실패했습니다.' }, 500)
  }
})

// ============================================
// API - Pending Reviews (관리자 사이트 전용)
// ============================================

app.get('/api/pending', requireAdmin(), async (c) => {
  try {
    const items = await getPendingReviews()
    return c.json({ success: true, count: items.length, items })
  } catch {
    return c.json({ success: false, error: 'Failed to load pending reviews' }, 500)
  }
})

// NOTE: AI 일괄 검토 API 삭제됨 - Manus API 연동으로 대체 예정
// LLM 2차 판별은 파이프라인(llm-judge.ts)에서 처리

app.post('/api/review', requireAdmin(), async (c) => {
  try {
    const { id, action } = await c.req.json()
    if (!id || !action) return c.json({ success: false, error: 'Missing id or action' }, 400)
    
    const item = await getPendingReviewById(parseInt(id))
    if (!item) return c.json({ success: false, error: 'Item not found' }, 404)
    
    let updatedDetectionCount = 0
    
    if (action === 'approve') {
      await addSite(item.domain, 'illegal')
      
      // detection_results 업데이트 (통계에 즉시 반영)
      updatedDetectionCount = await updateDetectionResultsByDomain(item.domain, 'illegal')
      
      // ✅ 불법 승인 시 report_tracking 테이블에 자동 등록 (title 포함)
      if (item.session_id && item.urls && Array.isArray(item.urls)) {
        // detection_results에서 URL별 실제 title 조회 (인덱스 매핑 버그 수정)
        const urlTitleRows = await query`
          SELECT DISTINCT url, title FROM detection_results
          WHERE session_id = ${item.session_id} AND url = ANY(${item.urls})
        `
        const urlTitleMap = new Map(urlTitleRows.map((r: any) => [r.url, r.title]))
        
        const urlsWithTitles = item.urls.map((url: string) => ({
          url,
          title: urlTitleMap.get(url) || null
        }))
        const registeredCount = await registerIllegalUrlsToReportTracking(
          item.session_id,
          item.domain,
          urlsWithTitles
        )
        console.log(`✅ Report tracking registered: ${registeredCount} URLs for domain ${item.domain}`)
      }
      
      await deletePendingReview(parseInt(id))
    } else if (action === 'reject') {
      await addSite(item.domain, 'legal')
      
      // detection_results 업데이트 (통계에 즉시 반영)
      updatedDetectionCount = await updateDetectionResultsByDomain(item.domain, 'legal')
      
      await deletePendingReview(parseInt(id))
    }
    
    // 캐시 무효화 (모든 월의 캐시를 비움)
    invalidateDashboardCache()
    
    return c.json({ success: true, action, updated_detection_results: updatedDetectionCount })
  } catch (error) {
    console.error('Review processing error:', error)
    return c.json({ success: false, error: 'Failed to process review' }, 500)
  }
})

// 일괄 처리 API
app.post('/api/review/bulk', requireAdmin(), async (c) => {
  try {
    const { ids, action } = await c.req.json()
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ success: false, error: 'Missing or empty ids array' }, 400)
    }
    if (!action || (action !== 'approve' && action !== 'reject')) {
      return c.json({ success: false, error: 'Invalid action' }, 400)
    }
    
    let processed = 0
    let failed = 0
    let totalUrlsRegistered = 0
    let totalDetectionUpdated = 0
    
    for (const id of ids) {
      try {
        const item = await getPendingReviewById(parseInt(id))
        if (!item) {
          failed++
          continue
        }
        
        if (action === 'approve') {
          await addSite(item.domain, 'illegal')
          
          // detection_results 업데이트 (통계에 즉시 반영)
          totalDetectionUpdated += await updateDetectionResultsByDomain(item.domain, 'illegal')
          
          // ✅ 불법 승인 시 report_tracking 테이블에 자동 등록 (title 포함)
          if (item.session_id && item.urls && Array.isArray(item.urls)) {
            // detection_results에서 URL별 실제 title 조회 (인덱스 매핑 버그 수정)
            const urlTitleRows = await query`
              SELECT DISTINCT url, title FROM detection_results
              WHERE session_id = ${item.session_id} AND url = ANY(${item.urls})
            `
            const urlTitleMap = new Map(urlTitleRows.map((r: any) => [r.url, r.title]))
            
            const urlsWithTitles = item.urls.map((url: string) => ({
              url,
              title: urlTitleMap.get(url) || null
            }))
            const registeredCount = await registerIllegalUrlsToReportTracking(
              item.session_id,
              item.domain,
              urlsWithTitles
            )
            totalUrlsRegistered += registeredCount
          }
        } else {
          await addSite(item.domain, 'legal')
          
          // detection_results 업데이트 (통계에 즉시 반영)
          totalDetectionUpdated += await updateDetectionResultsByDomain(item.domain, 'legal')
        }
        await deletePendingReview(parseInt(id))
        processed++
      } catch (error) {
        console.error(`Bulk review error for id ${id}:`, error)
        failed++
      }
    }
    
    // 캐시 무효화 (모든 월의 캐시를 비움)
    invalidateDashboardCache()
    
    console.log(`✅ Bulk review completed: ${processed} processed, ${failed} failed, ${totalUrlsRegistered} URLs registered, ${totalDetectionUpdated} detection results updated`)
    return c.json({ success: true, processed, failed, action, urls_registered: totalUrlsRegistered, detection_updated: totalDetectionUpdated })
  } catch (error) {
    console.error('Bulk review processing error:', error)
    return c.json({ success: false, error: 'Failed to process bulk review' }, 500)
  }
})

// ============================================
// API - Sites
// ============================================

app.get('/api/sites/:type', requireAdmin(), async (c) => {
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

app.post('/api/sites/:type', requireAdmin(), async (c) => {
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

app.delete('/api/sites/:type/:domain', requireAdmin(), async (c) => {
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
// API - Excluded URLs (신고 제외 URL)
// ============================================

// 신고 제외 URL 목록 조회
app.get('/api/excluded-urls', requireAdmin(), async (c) => {
  try {
    const rows = await query`
      SELECT id, url, created_at FROM excluded_urls ORDER BY created_at DESC
    `
    return c.json({ success: true, items: rows })
  } catch (error) {
    console.error('Excluded URLs list error:', error)
    return c.json({ success: false, error: 'Failed to load excluded URLs' }, 500)
  }
})

// 신고 제외 URL 추가
app.post('/api/excluded-urls', requireAdmin(), async (c) => {
  try {
    const { url } = await c.req.json()
    
    if (!url) {
      return c.json({ success: false, error: 'URL을 입력해주세요.' }, 400)
    }
    
    // URL 형식 검증
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return c.json({ success: false, error: 'http:// 또는 https://로 시작하는 URL을 입력해주세요.' }, 400)
    }
    
    const result = await query`
      INSERT INTO excluded_urls (url) VALUES (${url})
      ON CONFLICT (url) DO NOTHING
      RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: '이미 등록된 URL입니다.' }, 400)
    }
    
    return c.json({ success: true, item: result[0] })
  } catch (error) {
    console.error('Add excluded URL error:', error)
    return c.json({ success: false, error: 'Failed to add excluded URL' }, 500)
  }
})

// 신고 제외 URL 삭제
app.delete('/api/excluded-urls/:id', requireAdmin(), async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    
    const result = await query`
      DELETE FROM excluded_urls WHERE id = ${id} RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: 'URL not found' }, 404)
    }
    
    return c.json({ success: true, deleted: result[0] })
  } catch (error) {
    console.error('Delete excluded URL error:', error)
    return c.json({ success: false, error: 'Failed to delete excluded URL' }, 500)
  }
})

// ============================================
// API - Titles
// ============================================

app.get('/api/titles', async (c) => {
  try {
    const current = await getCurrentTitles()
    const history = await getHistoryTitles()
    
    // 히스토리 테이블에만 존재하는 비모니터링 작품 (titles 테이블에 없거나 is_current=false인 작품 중 ranking history가 있는 것)
    const currentNames = current.map((t: any) => t.name)
    const historyNames = history.map((t: any) => t.name)
    const allTitleNames = [...currentNames, ...historyNames]
    
    let historyOnlyTitles: string[] = []
    try {
      const historyRankTitles = await query`
        SELECT DISTINCT title FROM manta_ranking_history
        WHERE title != ALL(${allTitleNames.length > 0 ? allTitleNames : ['']})
        ORDER BY title ASC
      `
      historyOnlyTitles = historyRankTitles.map((t: any) => t.title)
    } catch {
      // ignore - optional data
    }
    
    return c.json({
      success: true,
      current: current.map((t: any) => ({ 
        name: t.name, 
        manta_url: t.manta_url,
        unofficial_titles: t.unofficial_titles || []
      })),
      history: history.map((t: any) => ({ 
        name: t.name, 
        manta_url: t.manta_url,
        unofficial_titles: t.unofficial_titles || []
      })),
      historyOnlyTitles
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

app.post('/api/titles', async (c) => {
  try {
    const { title, manta_url } = await c.req.json()
    if (!title) return c.json({ success: false, error: 'Missing title' }, 400)
    
    // 모니터링 작품 수 제한 확인
    await ensureDbMigration()
    const settingsRows = await query`
      SELECT value FROM system_settings WHERE key = 'max_monitoring_titles'
    `
    const maxTitles = settingsRows.length > 0 ? parseInt(settingsRows[0].value) : 20
    
    // 현재 모니터링 중인 메인 타이틀 수 (비공식 타이틀 제외)
    const currentCountRows = await query`
      SELECT COUNT(*) as count FROM titles WHERE is_current = true
    `
    const currentCount = parseInt(currentCountRows[0]?.count || '0')
    
    // 기존 복원인 경우 제한 체크 건너뛰기 (이미 titles 테이블에 is_current=false로 존재)
    const normalizedName = normalizeTitle(title)
    const existing = await query`SELECT id, name, is_current FROM titles`
    const duplicateEntry = existing.find((t: any) => normalizeTitle(t.name) === normalizedName)
    
    // 신규 추가이거나, 복원 시 is_current=false인 경우만 제한 체크
    if (!duplicateEntry || !duplicateEntry.is_current) {
      // 복원이 아닌 신규 추가일 때만 제한 체크 (복원은 이미 카운트에 포함되지 않으므로)
      if (currentCount >= maxTitles) {
        return c.json({ 
          success: false, 
          error: `모니터링 작품 수 제한(${maxTitles}개)에 도달했습니다. 관리자 설정에서 제한을 변경하거나 기존 작품을 제외해주세요.`,
          limitReached: true,
          currentCount,
          maxTitles
        }, 400)
      }
    }
    
    const result = await addTitle(title, manta_url)
    
    // 중복 감지 시 메시지 포함
    if (result.restored) {
      return c.json({ 
        success: true, 
        title: result,
        message: `기존 작품 "${result.originalName}"이(가) 다시 활성화되었습니다.`,
        restored: true
      })
    }
    
    return c.json({ success: true, title: result })
  } catch (error) {
    console.error('작품 추가 오류:', error)
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

// 비공식 타이틀 업데이트 API
app.put('/api/titles/:title/unofficial', async (c) => {
  try {
    const title = decodeURIComponent(c.req.param('title'))
    const { unofficial_titles } = await c.req.json()
    
    if (!Array.isArray(unofficial_titles)) {
      return c.json({ success: false, error: 'unofficial_titles must be an array' }, 400)
    }
    
    // 빈 문자열 제거 및 정규화
    const cleanedTitles = unofficial_titles
      .filter((t: string) => t && t.trim())
      .map((t: string) => normalizeTitle(t.trim()))
    
    // 최대 5개로 제한 (API 호출 비용 관리)
    if (cleanedTitles.length > 5) {
      return c.json({ 
        success: false, 
        error: '비공식 타이틀은 최대 5개까지만 등록할 수 있습니다.' 
      }, 400)
    }
    
    const rows = await query`
      UPDATE titles 
      SET unofficial_titles = ${cleanedTitles}
      WHERE name = ${title}
      RETURNING *
    `
    
    if (rows.length === 0) {
      return c.json({ success: false, error: 'Title not found' }, 404)
    }
    
    console.log(`📝 비공식 타이틀 업데이트: "${title}" -> [${cleanedTitles.join(', ')}]`)
    return c.json({ 
      success: true, 
      title: rows[0],
      message: `${cleanedTitles.length}개의 비공식 타이틀이 등록되었습니다.`
    })
  } catch (error) {
    console.error('비공식 타이틀 업데이트 오류:', error)
    return c.json({ success: false, error: 'Failed to update unofficial titles' }, 500)
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
        results_summary,
        deep_monitoring_executed: s.deep_monitoring_executed || false,
        deep_monitoring_targets_count: s.deep_monitoring_targets_count || 0,
        deep_monitoring_new_urls: s.deep_monitoring_new_urls || 0
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
        },
        deep_monitoring_executed: session.deep_monitoring_executed || false,
        deep_monitoring_targets_count: session.deep_monitoring_targets_count || 0,
        deep_monitoring_new_urls: session.deep_monitoring_new_urls || 0
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
// API - 사이트 집중 모니터링 (Deep Monitoring)
// ============================================

/** 집중 모니터링 대상 선정 기준: 도메인별 최소 고유 URL 수 */
const DEEP_MONITORING_MIN_URL_THRESHOLD = 5

/**
 * 대상 검색 (scan) — 인라인 구현
 * detection_results를 분석하여 작품×도메인별로 집계 후 임계치 이상인 대상 식별
 */
app.post('/api/sessions/:id/deep-monitoring/scan', async (c) => {
  let currentStep = 'init'
  try {
    currentStep = 'migration'
    await ensureDbMigration()
    const sessionId = c.req.param('id')
    
    currentStep = 'session-check'
    const session = await getSessionById(sessionId)
    if (!session) return c.json({ success: false, error: '세션을 찾을 수 없습니다.' }, 404)
    if (session.status !== 'completed') {
      return c.json({ success: false, error: '완료된 세션에서만 집중 모니터링 대상을 검색할 수 있습니다.' }, 400)
    }

    // Step 1: 작품별 비공식 타이틀 역맵핑 로드
    currentStep = 'title-mapping'
    const titleRows = await query`SELECT name, unofficial_titles FROM titles WHERE is_current = true`
    const titleReverseMap = new Map<string, string>()
    for (const row of titleRows) {
      const official = row.name as string
      // unofficial_titles 방어적 파싱: DB 타입에 따라 string | string[] | null 가능
      let unofficials: string[] = []
      const raw = row.unofficial_titles
      if (Array.isArray(raw)) {
        unofficials = raw.filter((s: any) => typeof s === 'string')
      } else if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            unofficials = parsed.filter((s: any) => typeof s === 'string')
          }
        } catch {
          // PostgreSQL array 형태 "{val1,val2}" 처리
          if (raw.startsWith('{') && raw.endsWith('}')) {
            unofficials = raw.slice(1, -1).split(',').map((s: string) => s.replace(/^"|"$/g, '').trim()).filter(Boolean)
          }
        }
      }
      for (const name of [official, ...unofficials]) {
        titleReverseMap.set(name.toLowerCase(), official)
      }
    }
    console.log(`[Deep Scan] Step 1 완료: ${titleRows.length}개 작품, ${titleReverseMap.size}개 매핑`)

    // Step 2: 세션의 detection_results 전체 조회
    currentStep = 'detection-results'
    const detectionRows = await query`
      SELECT title, domain, url, search_query, final_status, initial_status, llm_judgment
      FROM detection_results
      WHERE session_id = ${sessionId}
    `
    console.log(`[Deep Scan] Step 2 완료: ${detectionRows.length}개 결과`)
    if (detectionRows.length === 0) {
      return c.json({ success: true, targets: [], summary: { total_targets: 0, total_estimated_api_calls: 0, domains: [] } })
    }

    // Step 3: 불법 도메인 목록 로드
    currentStep = 'illegal-domains'
    const illegalRows = await query`SELECT domain FROM sites WHERE type = 'illegal'`
    const illegalDomains = new Set(illegalRows.map((r: any) => (r.domain as string).toLowerCase()))
    console.log(`[Deep Scan] Step 3 완료: ${illegalDomains.size}개 불법 도메인`)

    // Step 4: 작품×도메인별 고유 URL 합산 (불법 도메인만)
    currentStep = 'domain-analysis'
    interface DomainAnalysisLocal {
      title: string; domain: string; uniqueUrls: Set<string>;
      keywordBreakdown: Map<string, Set<string>>;
    }
    const analysisMap = new Map<string, DomainAnalysisLocal>()

    for (const row of detectionRows) {
      const domain = (row.domain as string).toLowerCase()
      if (!illegalDomains.has(domain)) continue

      const officialTitle = titleReverseMap.get((row.title as string).toLowerCase()) || row.title as string
      const key = `${officialTitle}|||${domain}`

      if (!analysisMap.has(key)) {
        analysisMap.set(key, { title: officialTitle, domain, uniqueUrls: new Set(), keywordBreakdown: new Map() })
      }
      const analysis = analysisMap.get(key)!
      analysis.uniqueUrls.add(row.url as string)

      const sq = row.search_query as string
      if (!analysis.keywordBreakdown.has(sq)) analysis.keywordBreakdown.set(sq, new Set())
      analysis.keywordBreakdown.get(sq)!.add(row.url as string)
    }

    console.log(`[Deep Scan] Step 4 완료: ${analysisMap.size}개 작품×도메인 분석`)

    // Step 5: 임계치 필터 + 쿼리 생성
    currentStep = 'threshold-filter'
    interface TargetCandidate {
      session_id: string; title: string; domain: string; url_count: number;
      base_keyword: string; deep_query: string; keyword_breakdown: { keyword: string; urls: number }[];
    }
    const candidates: TargetCandidate[] = []

    for (const [, analysis] of analysisMap) {
      const urlCount = analysis.uniqueUrls.size
      if (urlCount < DEEP_MONITORING_MIN_URL_THRESHOLD) continue

      let bestKeyword = ''; let bestCount = 0
      const breakdowns: { keyword: string; urls: number }[] = []

      for (const [keyword, urls] of analysis.keywordBreakdown) {
        const count = urls.size
        breakdowns.push({ keyword, urls: count })
        if (count > bestCount) { bestCount = count; bestKeyword = keyword }
      }
      breakdowns.sort((a, b) => b.urls - a.urls)

      candidates.push({
        session_id: sessionId, title: analysis.title, domain: analysis.domain,
        url_count: urlCount, base_keyword: bestKeyword,
        deep_query: `${bestKeyword} site:${analysis.domain}`,
        keyword_breakdown: breakdowns,
      })
    }
    candidates.sort((a, b) => b.url_count - a.url_count)

    console.log(`[Deep Scan] Step 5 완료: ${candidates.length}개 대상 후보 (임계치 ${DEEP_MONITORING_MIN_URL_THRESHOLD} 이상)`)

    // Step 6: DB 저장 (기존 대상 삭제 후 재생성)
    currentStep = 'db-save'
    await query`DELETE FROM deep_monitoring_targets WHERE session_id = ${sessionId}`

    const savedTargets: any[] = []
    for (const t of candidates) {
      const rows = await query`
        INSERT INTO deep_monitoring_targets (session_id, title, domain, url_count, base_keyword, deep_query, status)
        VALUES (${t.session_id}, ${t.title}, ${t.domain}, ${t.url_count}, ${t.base_keyword}, ${t.deep_query}, 'pending')
        RETURNING *
      `
      const saved = rows[0]
      saved.keyword_breakdown = t.keyword_breakdown
      savedTargets.push(saved)
    }

    return c.json({
      success: true,
      targets: savedTargets,
      summary: {
        total_targets: savedTargets.length,
        total_estimated_api_calls: savedTargets.length * 3,
        domains: savedTargets.map((t: any) => t.domain),
      }
    })
  } catch (error: any) {
    console.error(`Deep monitoring scan error at step [${currentStep}]:`, error)
    return c.json({ 
      success: false, 
      error: `대상 검색 실패 (단계: ${currentStep})`, 
      detail: error.message || String(error)
    }, 500)
  }
})

// 심층 검색 실행 (execute) — Vercel Serverless에서는 제한적 지원
// ── 헬퍼: Serper.dev 검색 (대상 1건) ──
const SERPER_API_URL = 'https://google.serper.dev/search'
const DEEP_SEARCH_CONFIG = { maxPages: 3, resultsPerPage: 10, maxResults: 30, delayMin: 300, delayMax: 600 }

function deepExtractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function deepCheckDomainInList(domain: string, list: Set<string>): boolean {
  if (list.has(domain)) return true
  const parts = domain.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (list.has(parts.slice(i).join('.'))) return true
  }
  return false
}

async function deepSearchSerper(apiKey: string, searchQuery: string, page: number, num: number) {
  const res = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: searchQuery, gl: 'us', hl: 'en', num, page }),
  })
  if (!res.ok) throw new Error(`Serper API 오류: ${res.status}`)
  const data = await res.json()
  return (data.organic || []) as { title: string; link: string; snippet?: string; position: number }[]
}

// ── 헬퍼: Manus LLM 판별 ──
const MANUS_API_URL_BASE = 'https://api.manus.ai/v1/tasks'
const MANUS_PROJECT_ID = 'mhCkDAxQCwTJCdPx8KqR5s'

const ILLEGAL_CRITERIA = `## 불법 사이트 판별 기준
- 도메인명에 manga, manhwa, comic, read, scan, raw 등 포함
- 숫자나 특수문자가 많은 의심 도메인
- .to, .cc, .ws, .io 등 흔하지 않은 TLD
- free, read online, scan, raw 등 SEO 키워드
- 공식 배급사/출판사가 아닌 사이트
- 여러 작품을 무료로 제공하는 사이트`

async function deepJudgeWithManus(
  apiKey: string,
  domainInfos: { domain: string; snippets: string[] }[],
  sessionId: string
): Promise<Map<string, { judgment: string; reason: string }>> {
  const judgmentMap = new Map<string, { judgment: string; reason: string }>()

  if (domainInfos.length === 0) return judgmentMap

  const domainsData = domainInfos.map(info => ({ domain: info.domain, snippets: info.snippets.slice(0, 3) }))
  const prompt = `[Jobdori 집중 모니터링 세션: ${sessionId}]\n\n다음 ${domainInfos.length}개 도메인의 불법 유통 사이트 여부를 판별해주세요.\n\n${ILLEGAL_CRITERIA}\n\n## 판별할 도메인 목록\n\`\`\`json\n${JSON.stringify({ domains: domainsData }, null, 2)}\n\`\`\`\n\n## 중요: 응답 형식\n반드시 아래 JSON 형식으로 텍스트로 직접 출력해주세요.\n\`\`\`json\n{"results": [{"domain": "example.com", "judgment": "likely_illegal|likely_legal|uncertain", "confidence": 0.0, "reason": "판단 근거"}], "summary": {"total": 0}}\n\`\`\``

  // Vercel 30초 제한 대비: LLM 판별에 최대 15초 할당
  const LLM_TIMEOUT_MS = 15000

  try {
    // Task 생성
    const createRes = await fetch(MANUS_API_URL_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API_KEY': apiKey },
      body: JSON.stringify({ prompt, agentProfile: 'manus-1.6-lite', projectId: MANUS_PROJECT_ID, taskMode: 'agent', hideInTaskList: false }),
    })
    if (!createRes.ok) throw new Error(`Manus Task 생성 실패: ${createRes.status}`)
    const taskData = await createRes.json()
    const taskId = taskData.task_id
    console.log(`  🤖 Manus Task: ${taskId}`)

    // 폴링 (Vercel 제한 대비 최대 15초)
    await new Promise(r => setTimeout(r, 2000))
    const start = Date.now()
    while (Date.now() - start < LLM_TIMEOUT_MS) {
      const statusRes = await fetch(`${MANUS_API_URL_BASE}/${taskId}`, { headers: { 'API_KEY': apiKey } })
      if (!statusRes.ok) { await new Promise(r => setTimeout(r, 3000)); continue }
      const statusData = await statusRes.json()

      if (statusData.status === 'completed') {
        let textResult: string | null = null
        for (let i = (statusData.output || []).length - 1; i >= 0; i--) {
          const msg = statusData.output[i]
          if (msg.role === 'assistant' && msg.content) {
            for (const c of msg.content) {
              if (c.type === 'output_text' && c.text) {
                const m = c.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
                textResult = m ? m[1] : (c.text.trim().startsWith('{') ? c.text : null)
              }
              if (!textResult && c.type === 'output_file' && c.fileUrl) {
                try { const fr = await fetch(c.fileUrl); if (fr.ok) textResult = await fr.text() } catch {}
              }
            }
          }
          if (textResult) break
        }
        if (textResult) {
          try {
            let jsonStr = textResult
            const jm = textResult.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
            if (jm) jsonStr = jm[1]
            const parsed = JSON.parse(jsonStr.trim())
            const results = parsed.results || parsed
            if (Array.isArray(results)) {
              for (const r of results) {
                judgmentMap.set(r.domain.toLowerCase(), { judgment: r.judgment, reason: r.reason })
              }
            }
          } catch { console.error('  ❌ Manus 응답 파싱 실패') }
        }
        break
      }
      if (statusData.status === 'failed') { console.error('  ❌ Manus Task 실패'); break }
      await new Promise(r => setTimeout(r, 3000))
    }

    // 타임아웃 시 로그
    if (Date.now() - start >= LLM_TIMEOUT_MS) {
      console.log(`  ⏱️ Manus LLM 판별 타임아웃 (${LLM_TIMEOUT_MS / 1000}초 초과), uncertain 처리`)
    }
  } catch (error) {
    console.error('  ❌ Manus LLM 판별 오류:', error)
  }

  // 판별 못한 도메인은 uncertain 처리
  for (const info of domainInfos) {
    if (!judgmentMap.has(info.domain.toLowerCase())) {
      judgmentMap.set(info.domain.toLowerCase(), { judgment: 'uncertain', reason: '판별 실패 또는 타임아웃' })
    }
  }
  return judgmentMap
}

/**
 * 대상 1건 실행 API (프론트에서 순차 호출)
 * 흐름: Serper 검색 → 중복 제거 → 1차 판별(리스트) → 2차 판별(LLM) → DB 저장
 */
app.post('/api/sessions/:id/deep-monitoring/execute-target/:targetId', async (c) => {
  let step = 'init'
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('id')
    const targetId = parseInt(c.req.param('targetId'))

    // 대상 로드
    step = 'load-target'
    const targetRows = await query`
      SELECT * FROM deep_monitoring_targets WHERE id = ${targetId} AND session_id = ${sessionId}
    `
    if (targetRows.length === 0) return c.json({ success: false, error: '대상을 찾을 수 없습니다.' }, 404)
    const target = targetRows[0]

    // 이미 완료된 대상은 건너뛰기 (방어코드)
    if (target.status === 'completed') {
      return c.json({ success: true, skipped: true, message: '이미 완료된 대상입니다.', target_id: targetId })
    }
    if (target.status === 'running') {
      return c.json({ success: false, error: '이미 실행 중인 대상입니다.' }, 409)
    }

    // 대상 상태: running
    await query`UPDATE deep_monitoring_targets SET status = 'running', executed_at = NOW() WHERE id = ${targetId}`

    const SERPER_KEY = process.env.SERPER_API_KEY
    if (!SERPER_KEY) {
      await query`UPDATE deep_monitoring_targets SET status = 'failed', completed_at = NOW() WHERE id = ${targetId}`
      return c.json({ success: false, error: 'SERPER_API_KEY가 설정되지 않았습니다.' }, 500)
    }

    // ── Step 1: 심층 검색 (Serper) ──
    step = 'search'
    console.log(`[Deep Execute] 대상 ${targetId}: "${target.deep_query}"`)

    interface DeepSearchResult {
      title: string; domain: string; url: string; search_query: string;
      page: number; rank: number; snippet?: string; status?: string;
      llm_judgment?: string | null; llm_reason?: string | null; final_status?: string;
      reviewed_at?: string | null;
    }

    const searchResults: DeepSearchResult[] = []
    let globalRank = 1
    for (let pageNum = 1; pageNum <= DEEP_SEARCH_CONFIG.maxPages; pageNum++) {
      try {
        const pageResults = await deepSearchSerper(SERPER_KEY, target.deep_query, pageNum, DEEP_SEARCH_CONFIG.resultsPerPage)
        for (const item of pageResults) {
          if (globalRank > DEEP_SEARCH_CONFIG.maxResults) break
          searchResults.push({
            title: target.title, domain: deepExtractDomain(item.link), url: item.link,
            search_query: target.deep_query, page: pageNum, rank: globalRank, snippet: item.snippet || undefined,
          })
          globalRank++
        }
        if (globalRank > DEEP_SEARCH_CONFIG.maxResults) break
        if (pageNum < DEEP_SEARCH_CONFIG.maxPages && pageResults.length > 0) {
          await new Promise(r => setTimeout(r, DEEP_SEARCH_CONFIG.delayMin + Math.random() * (DEEP_SEARCH_CONFIG.delayMax - DEEP_SEARCH_CONFIG.delayMin)))
        }
      } catch (e) { console.error(`  페이지 ${pageNum} 검색 실패:`, e) }
    }
    console.log(`  검색 결과: ${searchResults.length}개`)

    // ── Step 2: 기존 URL 중복 제거 ──
    step = 'dedup'
    const existingUrlRows = await query`SELECT url FROM detection_results WHERE session_id = ${sessionId}`
    const existingUrls = new Set(existingUrlRows.map((r: any) => r.url))
    const newResults = searchResults.filter(r => !existingUrls.has(r.url))
    console.log(`  신규 URL: ${newResults.length}개 (중복 제외: ${searchResults.length - newResults.length}개)`)

    if (newResults.length === 0) {
      await query`UPDATE deep_monitoring_targets SET status = 'completed', results_count = ${searchResults.length}, new_urls_count = 0, completed_at = NOW() WHERE id = ${targetId}`
      return c.json({ success: true, target_id: targetId, results_count: searchResults.length, new_urls_count: 0, illegal_count: 0, legal_count: 0, pending_count: 0 })
    }

    // ── Step 3: 1차 판별 (리스트 대조) ──
    step = 'classify'
    const illegalRows = await query`SELECT domain FROM sites WHERE type = 'illegal'`
    const legalRows = await query`SELECT domain FROM sites WHERE type = 'legal'`
    const illegalSites = new Set(illegalRows.map((r: any) => (r.domain as string).toLowerCase()))
    const legalSites = new Set(legalRows.map((r: any) => (r.domain as string).toLowerCase()))

    for (const r of newResults) {
      const d = r.domain.toLowerCase()
      if (illegalSites.has(d)) r.status = 'illegal'  // 불법: 정확 매칭 (신고 정확도)
      else if (deepCheckDomainInList(d, legalSites)) r.status = 'legal'  // 합법: 서브도메인 포함
      else r.status = 'unknown'
    }

    // ── Step 4: 2차 판별 (LLM — unknown 도메인만) ──
    step = 'llm-judge'
    const unknownResults = newResults.filter(r => r.status === 'unknown')
    if (unknownResults.length > 0) {
      const MANUS_KEY = process.env.MANUS_API_KEY
      if (MANUS_KEY) {
        // 도메인별 스니펫 수집
        const domainInfoMap = new Map<string, { domain: string; snippets: string[] }>()
        for (const r of unknownResults) {
          const dl = r.domain.toLowerCase()
          if (!domainInfoMap.has(dl)) domainInfoMap.set(dl, { domain: r.domain, snippets: [] })
          if (r.snippet && !domainInfoMap.get(dl)!.snippets.includes(r.snippet)) domainInfoMap.get(dl)!.snippets.push(r.snippet)
        }
        console.log(`  LLM 판별: ${domainInfoMap.size}개 unknown 도메인`)

        const judgmentMap = await deepJudgeWithManus(MANUS_KEY, Array.from(domainInfoMap.values()), sessionId)

        for (const r of newResults) {
          if (r.status === 'unknown') {
            const j = judgmentMap.get(r.domain.toLowerCase())
            if (j) { r.llm_judgment = j.judgment; r.llm_reason = j.reason }
          }
        }
      } else {
        console.log('  ⚠️ MANUS_API_KEY 없음, unknown 도메인은 pending 처리')
        for (const r of unknownResults) { r.llm_judgment = 'uncertain'; r.llm_reason = 'API 키 미설정' }
      }
    }

    // ── Step 5: 최종 상태 결정 ──
    step = 'finalize-status'
    for (const r of newResults) {
      if (r.status === 'illegal') r.final_status = 'illegal'
      else if (r.status === 'legal') r.final_status = 'legal'
      else r.final_status = 'pending'
      r.reviewed_at = r.status !== 'unknown' ? new Date().toISOString() : null
    }

    // ── Step 6: DB 저장 ──
    step = 'db-save'
    let insertedCount = 0
    for (const r of newResults) {
      try {
        await query`
          INSERT INTO detection_results (
            session_id, title, url, domain, search_query, page, rank,
            initial_status, llm_judgment, llm_reason, final_status,
            reviewed_at, snippet, source, deep_target_id
          ) VALUES (
            ${sessionId}, ${r.title}, ${r.url}, ${r.domain}, ${r.search_query}, ${r.page}, ${r.rank},
            ${r.status}, ${r.llm_judgment || null}, ${r.llm_reason || null}, ${r.final_status},
            ${r.reviewed_at || null}, ${r.snippet || null}, 'deep', ${targetId}
          ) ON CONFLICT (session_id, url) DO NOTHING
        `
        insertedCount++
      } catch {}
    }

    // ── Step 7: 불법 URL 신고결과 추적 등록 ──
    step = 'report-tracking'
    const illegalFinalResults = newResults.filter(r => r.final_status === 'illegal')
    const excludedUrlRows = await query`SELECT url FROM excluded_urls`
    const excludedUrls = new Set(excludedUrlRows.map((r: any) => r.url))

    for (const r of illegalFinalResults) {
      try {
        const isExcluded = excludedUrls.has(r.url)
        if (isExcluded) {
          await query`INSERT INTO report_tracking (session_id, url, domain, title, report_status, reason) VALUES (${sessionId}, ${r.url}, ${r.domain}, ${r.title}, '미신고', '웹사이트 메인 페이지') ON CONFLICT (session_id, url) DO NOTHING`
        } else {
          await query`INSERT INTO report_tracking (session_id, url, domain, title, report_status) VALUES (${sessionId}, ${r.url}, ${r.domain}, ${r.title}, '미신고') ON CONFLICT (session_id, url) DO NOTHING`
        }
      } catch {}
    }

    // ── 대상 완료 ──
    const illegalCount = newResults.filter(r => r.final_status === 'illegal').length
    const legalCount = newResults.filter(r => r.final_status === 'legal').length
    const pendingCount = newResults.filter(r => r.final_status === 'pending').length

    await query`
      UPDATE deep_monitoring_targets SET
        status = 'completed', results_count = ${searchResults.length},
        new_urls_count = ${newResults.length}, completed_at = NOW()
      WHERE id = ${targetId}
    `

    console.log(`  ✅ 완료: 불법 ${illegalCount} / 합법 ${legalCount} / 대기 ${pendingCount}`)
    return c.json({
      success: true, target_id: targetId,
      results_count: searchResults.length, new_urls_count: newResults.length,
      illegal_count: illegalCount, legal_count: legalCount, pending_count: pendingCount,
    })

  } catch (error: any) {
    // 대상 상태 복구 (failed)
    try {
      const targetId = parseInt(c.req.param('targetId'))
      await query`UPDATE deep_monitoring_targets SET status = 'failed', completed_at = NOW() WHERE id = ${targetId}`
    } catch {}
    console.error(`Deep monitoring execute-target error at [${step}]:`, error)
    return c.json({ success: false, error: `실행 실패 (단계: ${step})`, detail: error.message || String(error) }, 500)
  }
})

/**
 * 전체 완료 후처리 API — 세션 통계 갱신
 */
app.post('/api/sessions/:id/deep-monitoring/finalize', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('id')

    // 대상 통계 조회
    const targets = await query`SELECT * FROM deep_monitoring_targets WHERE session_id = ${sessionId}`
    const totalTargets = targets.length
    const totalNewUrls = targets.reduce((sum: number, t: any) => sum + (parseInt(t.new_urls_count) || 0), 0)

    // 세션 deep_monitoring 컬럼 업데이트
    await query`
      UPDATE sessions SET
        deep_monitoring_executed = true,
        deep_monitoring_targets_count = ${totalTargets},
        deep_monitoring_new_urls = ${totalNewUrls}
      WHERE id = ${sessionId}
    `

    // ── Blob 병합: deep 결과를 Blob에 추가 ──
    // (results API가 Blob에서 읽으므로 반드시 필요)
    let blobMerged = false
    try {
      const session = await getSessionById(sessionId)
      if (session?.file_final_results?.startsWith('http')) {
        // 기존 Blob 결과 다운로드
        const existingResults = await downloadResults(session.file_final_results)
        const existingUrls = new Set(existingResults.map((r: any) => r.url))

        // DB에서 deep 결과 조회
        const deepResults = await query`
          SELECT title, domain, url, search_query, page, rank,
                 initial_status as status, llm_judgment, llm_reason, final_status,
                 reviewed_at, snippet
          FROM detection_results
          WHERE session_id = ${sessionId} AND source = 'deep'
        `

        // 중복 제외하고 Blob에 병합
        const newDeepResults: FinalResult[] = []
        for (const r of deepResults) {
          if (!existingUrls.has(r.url)) {
            const statusVal = (r.status === 'illegal' || r.status === 'legal') ? r.status : 'unknown' as const
            const finalVal = (r.final_status === 'illegal' || r.final_status === 'legal') ? r.final_status : 'pending' as const
            newDeepResults.push({
              title: r.title,
              domain: r.domain,
              url: r.url,
              search_query: r.search_query,
              page: r.page || 0,
              rank: r.rank || 0,
              status: statusVal,
              llm_judgment: r.llm_judgment || null,
              llm_reason: r.llm_reason || null,
              final_status: finalVal,
              reviewed_at: r.reviewed_at || null,
            })
          }
        }

        if (newDeepResults.length > 0) {
          const mergedResults = [...existingResults, ...newDeepResults]
          const { put } = await import('@vercel/blob')
          const blob = await put(
            `results/${sessionId}/final-results.json`,
            JSON.stringify(mergedResults),
            { access: 'public', addRandomSuffix: false }
          )

          // 세션 파일 URL 및 카운트 업데이트
          const illegalCount = mergedResults.filter((r: any) => r.final_status === 'illegal').length
          const legalCount = mergedResults.filter((r: any) => r.final_status === 'legal').length
          const pendingCount = mergedResults.filter((r: any) => r.final_status === 'pending').length
          await query`
            UPDATE sessions SET
              file_final_results = ${blob.url},
              results_total = ${mergedResults.length},
              results_illegal = ${illegalCount},
              results_legal = ${legalCount},
              results_pending = ${pendingCount}
            WHERE id = ${sessionId}
          `
          blobMerged = true
          console.log(`[Deep Finalize] Blob 병합: 기존 ${existingResults.length} + 신규 ${newDeepResults.length} = ${mergedResults.length}`)
        } else {
          console.log(`[Deep Finalize] Blob 병합 불필요: 신규 deep URL 0건`)

          // 그래도 세션 카운트는 재계산
          await query`
            UPDATE sessions SET
              results_total = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId}),
              results_illegal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'illegal'),
              results_legal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'legal'),
              results_pending = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'pending')
            WHERE id = ${sessionId}
          `
        }
      }
    } catch (blobError) {
      console.error('[Deep Finalize] Blob 병합 오류:', blobError)
      // Blob 실패 시에도 세션 카운트는 DB 기반으로 업데이트
      await query`
        UPDATE sessions SET
          results_total = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId}),
          results_illegal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'illegal'),
          results_legal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'legal'),
          results_pending = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'pending')
        WHERE id = ${sessionId}
      `
    }

    console.log(`[Deep Finalize] 세션 ${sessionId}: 대상 ${totalTargets}건, 신규 URL ${totalNewUrls}개, Blob 병합: ${blobMerged}`)
    return c.json({ success: true, total_targets: totalTargets, total_new_urls: totalNewUrls, blob_merged: blobMerged })
  } catch (error: any) {
    console.error('Deep monitoring finalize error:', error)
    return c.json({ success: false, error: error.message || '후처리 실패' }, 500)
  }
})

// 기존 execute API (순차 실행으로 대체됨 — 호환성 유지)
app.post('/api/sessions/:id/deep-monitoring/execute', async (c) => {
  return c.json({
    success: false,
    error: '이 API는 더 이상 사용되지 않습니다. 프론트엔드에서 execute-target API를 순차 호출하세요.'
  }, 410)
})

// 대상 목록 조회
app.get('/api/sessions/:id/deep-monitoring/targets', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('id')
    const targets = await query`
      SELECT * FROM deep_monitoring_targets
      WHERE session_id = ${sessionId}
      ORDER BY url_count DESC
    `
    return c.json({ success: true, count: targets.length, targets })
  } catch (error: any) {
    console.error('Deep monitoring targets error:', error)
    return c.json({ success: false, error: error.message || '대상 목록 조회 실패' }, 500)
  }
})

// 실행 상태 조회 (폴링용) — DB 기반
app.get('/api/sessions/:id/deep-monitoring/status', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('id')

    const targets = await query`
      SELECT * FROM deep_monitoring_targets
      WHERE session_id = ${sessionId}
      ORDER BY url_count DESC
    `

    const runningCount = targets.filter((t: any) => t.status === 'running').length
    const completedCount = targets.filter((t: any) => t.status === 'completed').length
    const failedCount = targets.filter((t: any) => t.status === 'failed').length
    const pendingCount = targets.filter((t: any) => t.status === 'pending').length

    return c.json({
      success: true,
      is_running: runningCount > 0,
      summary: { total: targets.length, completed: completedCount, failed: failedCount, pending: pendingCount },
      targets
    })
  } catch (error: any) {
    console.error('Deep monitoring status error:', error)
    return c.json({ success: false, error: error.message || '상태 조회 실패' }, 500)
  }
})

// ============================================
// API - DMCA Report Generator
// ============================================

const DMCA_DESCRIPTION_TEMPLATE = (titleName: string) =>
  `<${titleName}> is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.\nThe whole webtoon is infringed on the pirate sites.`

async function generateDmcaReport(sessionId: string) {
  // 1. 세션 존재 확인
  const session = await getSessionById(sessionId)
  if (!session) throw new Error('Session not found')

  // 2. excluded_urls 조회
  const excludedRows = await query`SELECT url FROM excluded_urls`
  const excludedUrls = new Set(excludedRows.map((r: any) => r.url))

  // 3. report_tracking에서 전체 URL 조회
  const allItems = await query`
    SELECT id, url, domain, title, report_status, reason
    FROM report_tracking
    WHERE session_id = ${sessionId}
    ORDER BY title ASC, domain ASC, url ASC
  `

  // 3-1. title이 NULL인 항목을 detection_results에서 보충 (기존 데이터 대응)
  const nullTitleItems = allItems.filter((item: any) => !item.title)
  if (nullTitleItems.length > 0) {
    const nullTitleUrls = nullTitleItems.map((item: any) => item.url)
    const titleLookupRows = await query`
      SELECT DISTINCT url, title FROM detection_results
      WHERE session_id = ${sessionId} AND url = ANY(${nullTitleUrls}) AND title IS NOT NULL
    `
    const titleLookupMap = new Map(titleLookupRows.map((r: any) => [r.url, r.title]))
    
    for (const item of allItems) {
      if (!item.title && titleLookupMap.has(item.url)) {
        item.title = titleLookupMap.get(item.url)
        // DB도 업데이트하여 다음 조회 시 정상 반영
        await query`
          UPDATE report_tracking SET title = ${item.title}, updated_at = NOW()
          WHERE id = ${item.id}
        `
      }
    }
  }

  // 4. titles + manta_url 조회
  const titlesRows = await query`
    SELECT name, manta_url FROM titles WHERE is_current = true
  `
  const titleMantaMap = new Map<string, string | null>()
  for (const t of titlesRows) {
    titleMantaMap.set(t.name, t.manta_url || null)
  }

  // 5. 필터링
  const excluded = { already_blocked: 0, not_indexed: 0, duplicate_rejected: 0, main_page: 0, excluded_url: 0, duplicate_from_previous: 0 }
  const includedItems: any[] = []

  for (const item of allItems) {
    // 제외: excluded_urls
    if (excludedUrls.has(item.url)) { excluded.excluded_url++; continue }
    // 제외: 차단
    if (item.report_status === '차단') { excluded.already_blocked++; continue }
    // 제외: 색인없음
    if (item.report_status === '색인없음') { excluded.not_indexed++; continue }
    // 제외: 중복 거부 (reason에 '중복' 키워드 포함)
    if (item.report_status === '거부' && item.reason && item.reason.includes('중복')) {
      excluded.duplicate_rejected++; continue
    }
    // 제외: 웹사이트 메인 페이지
    if (item.reason === '웹사이트 메인 페이지') { excluded.main_page++; continue }
    // 제외: 이전 세션 중복 거부 이력으로 자동 설정된 사유
    if (item.reason === '기존 요청과 중복된 요청') { excluded.duplicate_from_previous++; continue }

    includedItems.push(item)
  }

  // 6. 작품별 그룹핑
  const workMap = new Map<string, { urls: string[], manta_url: string | null }>()
  for (const item of includedItems) {
    const title = item.title || '(작품명 없음)'
    if (!workMap.has(title)) {
      workMap.set(title, {
        urls: [],
        manta_url: titleMantaMap.get(title) || null
      })
    }
    workMap.get(title)!.urls.push(item.url)
  }

  // 7. works 배열 생성 (작품명 알파벳순)
  const works = Array.from(workMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, data]) => ({
      title,
      manta_url: data.manta_url,
      description: DMCA_DESCRIPTION_TEMPLATE(title),
      urls: data.urls.sort(),
      url_count: data.urls.length
    }))

  // 8. 텍스트 생성 (구글 폼용)
  const fullTextParts: string[] = []
  works.forEach((work, idx) => {
    fullTextParts.push(`=== 작품 ${idx + 1}: ${work.title} ===`)
    fullTextParts.push('')
    fullTextParts.push('[저작물 설명]')
    fullTextParts.push(work.description)
    fullTextParts.push('')
    fullTextParts.push('[공인된 저작물 URL]')
    fullTextParts.push(work.manta_url || '(등록된 URL 없음)')
    fullTextParts.push('')
    fullTextParts.push(`[침해 URL 목록] (${work.url_count}개)`)
    fullTextParts.push(work.urls.join('\n'))
    fullTextParts.push('')
    fullTextParts.push('========================================')
    fullTextParts.push('')
  })

  // 9. TCRP 텍스트 생성
  const tcrpParts: string[] = []
  works.forEach((work) => {
    const descLines = work.description.split('\n')
    descLines.forEach(line => tcrpParts.push(`# ${line}`))
    tcrpParts.push(`# ${work.manta_url || '(등록된 URL 없음)'}`)
    work.urls.forEach(url => tcrpParts.push(url))
    tcrpParts.push('')
  })

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    summary: {
      total_titles: works.length,
      total_urls: allItems.length,
      excluded_urls: Object.values(excluded).reduce((a, b) => a + b, 0),
      included_urls: includedItems.length
    },
    excluded_reasons: excluded,
    works,
    full_text: fullTextParts.join('\n').trim(),
    tcrp_text: tcrpParts.join('\n').trim()
  }
}

app.post('/api/sessions/:id/dmca-report/generate', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('id')
    const report = await generateDmcaReport(sessionId)

    if (report.works.length === 0) {
      return c.json({
        success: true,
        report: {
          ...report,
          message: '신고 대상 URL이 없습니다.'
        }
      })
    }

    return c.json({ success: true, report })
  } catch (error: any) {
    console.error('DMCA report generation error:', error)
    if (error.message === 'Session not found') {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    return c.json({ success: false, error: error.message || '신고서 생성 실패' }, 500)
  }
})

// ============================================
// API - Dashboard
// ============================================

app.get('/api/dashboard/months', async (c) => {
  try {
    // 세션 테이블에서 직접 월 목록 추출 (YYYY-MM 형식)
    const sessionsMonths = await query`
      SELECT DISTINCT SUBSTRING(id, 1, 7) as month 
      FROM sessions 
      WHERE status = 'completed' 
      ORDER BY month DESC
    `
    const months = sessionsMonths.map((s: any) => s.month)
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
    const nocache = c.req.query('nocache') === 'true'
    const now = new Date()
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    
    // 캐시 확인 (nocache가 아닌 경우)
    if (!nocache) {
      const cached = getCachedDashboard(targetMonth)
      if (cached) {
        return c.json({ ...cached, cached: true })
      }
    }
    
    // 발견/Top5는 detection_results, 신고/차단은 report_tracking에서 조회
    const monthPattern = targetMonth + '%'
    const startDate = targetMonth + '-01'
    const endDate = targetMonth + '-31'
    
    const statsResult = await query`
      WITH session_data AS (
        SELECT 
          COUNT(*) as sessions_count,
          MAX(completed_at) as last_updated
        FROM sessions 
        WHERE id LIKE ${monthPattern} AND status = 'completed'
      ),
      -- 발견: detection_results에서 불법으로 분류된 URL 수
      detection_data AS (
        SELECT COUNT(*) as discovered
        FROM detection_results
        WHERE session_id LIKE ${monthPattern} AND final_status = 'illegal'
      ),
      -- 신고/차단: report_tracking에서 조회
      report_data AS (
        SELECT 
          COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
          COUNT(*) FILTER (WHERE report_status = '차단') as blocked
        FROM report_tracking
        WHERE session_id LIKE ${monthPattern}
      ),
      -- Top 5 작품: report_tracking 기반 (신고 건수)
      top_contents AS (
        SELECT title as name, COUNT(*) as count
        FROM report_tracking
        WHERE session_id LIKE ${monthPattern} AND report_status != '미신고' AND title IS NOT NULL
        GROUP BY title
        ORDER BY count DESC
        LIMIT 5
      ),
      -- Top 5 도메인: report_tracking 기반 (신고 건수)
      top_domains AS (
        SELECT domain, COUNT(*) as count
        FROM report_tracking
        WHERE session_id LIKE ${monthPattern} AND report_status != '미신고'
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 5
      )
      SELECT 
        (SELECT sessions_count FROM session_data) as sessions_count,
        (SELECT last_updated FROM session_data) as last_updated,
        (SELECT discovered FROM detection_data) as discovered,
        (SELECT reported FROM report_data) as reported,
        (SELECT blocked FROM report_data) as blocked,
        (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM top_contents) as top_contents,
        (SELECT COALESCE(json_agg(json_build_object('domain', domain, 'count', count)), '[]'::json) FROM top_domains) as top_domains
    `
    
    const data = statsResult[0]
    const sessionsCount = parseInt(data?.sessions_count) || 0
    const discovered = parseInt(data?.discovered) || 0
    const reported = parseInt(data?.reported) || 0
    const blocked = parseInt(data?.blocked) || 0
    const blockRate = reported > 0 ? Math.round((blocked / reported) * 100 * 10) / 10 : 0
    
    if (sessionsCount === 0 && discovered === 0) {
      const emptyResult = {
        success: true,
        month: targetMonth,
        sessions_count: 0,
        top_contents: [],
        top_illegal_sites: [],
        report_stats: { discovered: 0, reported: 0, blocked: 0, blockRate: 0 }
      }
      return c.json(emptyResult)
    }
    
    const result = {
      success: true,
      month: targetMonth,
      sessions_count: sessionsCount,
      top_contents: data?.top_contents || [],
      top_illegal_sites: data?.top_domains || [],
      report_stats: {
        discovered,
        reported,
        blocked,
        blockRate
      }
    }
    
    // 캐시 저장
    setCachedDashboard(targetMonth, result)
    
    return c.json({ ...result, cached: false })
  } catch {
    return c.json({ success: false, error: 'Failed to load dashboard' }, 500)
  }
})

// 전체보기 API - 해당 월의 모든 작품별 통계 (detection_results 기반)
app.get('/api/dashboard/all-titles', async (c) => {
  try {
    const month = c.req.query('month')
    const now = new Date()
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const monthPattern = targetMonth + '%'
    
    // detection_results에서 직접 집계 (세션별 불법 합계와 동일한 소스)
    const titles = await query`
      SELECT title as name, COUNT(*) as count
      FROM detection_results
      WHERE session_id LIKE ${monthPattern} AND final_status = 'illegal'
      GROUP BY title
      ORDER BY count DESC
    `
    
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
    // DB 마이그레이션 확인
    await ensureDbMigration()
    
    const rankings = await query`
      SELECT title, manta_rank, first_rank_domain, search_query, session_id, 
             COALESCE(page1_illegal_count, 0) as page1_illegal_count,
             COALESCE(top30_illegal_count, 0) as top30_illegal_count, updated_at 
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
        sessionId: r.session_id,
        page1IllegalCount: r.page1_illegal_count || 0,
        top30IllegalCount: r.top30_illegal_count || 0
      })),
      lastUpdated
    })
  } catch (error) {
    console.error('Manta rankings error:', error)
    return c.json({ success: false, error: 'Failed to load manta rankings' }, 500)
  }
})

// 작품별 순위 히스토리 API (page1IllegalCount 포함)
app.get('/api/titles/:title/ranking-history', async (c) => {
  try {
    const title = decodeURIComponent(c.req.param('title'))
    
    // 먼저 히스토리 테이블에서 조회
    let history = await query`
      SELECT manta_rank, first_rank_domain, session_id, COALESCE(page1_illegal_count, 0) as page1_illegal_count, COALESCE(top30_illegal_count, 0) as top30_illegal_count, recorded_at
      FROM manta_ranking_history
      WHERE title = ${title}
      ORDER BY recorded_at ASC
    `
    
    // 히스토리가 없으면 현재 manta_rankings에서 가져오기
    if (history.length === 0) {
      const current = await query`
        SELECT manta_rank, first_rank_domain, session_id, COALESCE(page1_illegal_count, 0) as page1_illegal_count, COALESCE(top30_illegal_count, 0) as top30_illegal_count, updated_at as recorded_at
        FROM manta_rankings
        WHERE title = ${title}
      `
      history = current
    }
    
    return c.json({
      success: true,
      title,
      history: history.map(h => ({
        rank: h.manta_rank,
        firstDomain: h.first_rank_domain,
        sessionId: h.session_id,
        page1IllegalCount: h.page1_illegal_count,
        top30IllegalCount: h.top30_illegal_count,
        recordedAt: h.recorded_at
      }))
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load ranking history' }, 500)
  }
})

// 모니터링 대상 작품 목록 API (상세보기용)
// 비모니터링 작품도 히스토리가 있으면 포함
app.get('/api/titles/list', async (c) => {
  try {
    const titles = await query`
      SELECT name, manta_url FROM titles WHERE is_current = true ORDER BY name ASC
    `
    
    // 히스토리 테이블에서 비모니터링 작품 중 순위 기록이 있는 작품 조회
    const historyTitles = await query`
      SELECT DISTINCT h.title as name
      FROM manta_ranking_history h
      WHERE h.title NOT IN (SELECT name FROM titles WHERE is_current = true)
      ORDER BY h.title ASC
    `
    
    return c.json({
      success: true,
      titles: titles.map(t => t.name),
      titlesWithUrl: titles.map(t => ({ name: t.name, manta_url: t.manta_url })),
      historyOnlyTitles: historyTitles.map(t => t.name)
    })
  } catch {
    return c.json({ success: false, error: 'Failed to load titles' }, 500)
  }
})

// ============================================
// API - Title Stats (작품별 통계)
// ============================================

// 작품별 통계 조회 API
// 발견: detection_results (final_status='illegal')
// 신고/차단: report_tracking
app.get('/api/stats/by-title', async (c) => {
  try {
    await ensureDbMigration()
    
    // 기간 필터 파라미터 (YYYY-MM-DD)
    const startDate = c.req.query('start_date')
    const endDate = c.req.query('end_date')
    
    let stats
    if (startDate && endDate) {
      // 기간 필터: session_id에서 날짜 추출하여 필터링
      // session_id 형식: 2026-01-15T01-27-11
      stats = await query`
        WITH detection_stats AS (
          SELECT title, COUNT(*) as discovered
          FROM detection_results
          WHERE final_status = 'illegal'
            AND SUBSTRING(session_id, 1, 10) >= ${startDate}
            AND SUBSTRING(session_id, 1, 10) <= ${endDate}
          GROUP BY title
        ),
        report_stats AS (
          SELECT 
            title,
            COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
            COUNT(*) FILTER (WHERE report_status = '차단') as blocked
          FROM report_tracking
          WHERE title IS NOT NULL AND title != ''
            AND SUBSTRING(session_id, 1, 10) >= ${startDate}
            AND SUBSTRING(session_id, 1, 10) <= ${endDate}
          GROUP BY title
        )
        SELECT 
          d.title,
          d.discovered,
          COALESCE(r.reported, 0) as reported,
          COALESCE(r.blocked, 0) as blocked
        FROM detection_stats d
        LEFT JOIN report_stats r ON d.title = r.title
        ORDER BY d.discovered DESC
      `
    } else {
      // 전체 기간
      stats = await query`
        WITH detection_stats AS (
          SELECT title, COUNT(*) as discovered
          FROM detection_results
          WHERE final_status = 'illegal'
          GROUP BY title
        ),
        report_stats AS (
          SELECT 
            title,
            COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
            COUNT(*) FILTER (WHERE report_status = '차단') as blocked
          FROM report_tracking
          WHERE title IS NOT NULL AND title != ''
          GROUP BY title
        )
        SELECT 
          d.title,
          d.discovered,
          COALESCE(r.reported, 0) as reported,
          COALESCE(r.blocked, 0) as blocked
        FROM detection_stats d
        LEFT JOIN report_stats r ON d.title = r.title
        ORDER BY d.discovered DESC
      `
    }
    
    // 차단율 계산 및 결과 정리
    const result = stats.map((s: any) => {
      const discovered = parseInt(s.discovered) || 0
      const reported = parseInt(s.reported) || 0
      const blocked = parseInt(s.blocked) || 0
      const blockRate = reported > 0 ? Math.round((blocked / reported) * 100 * 10) / 10 : 0
      
      return {
        title: s.title,
        discovered,  // 발견 (detection_results)
        reported,    // 신고 (report_tracking)
        blocked,     // 차단 (report_tracking)
        blockRate    // 차단율
      }
    })
    
    return c.json({
      success: true,
      stats: result,
      total: result.length
    })
  } catch (error) {
    console.error('Title stats error:', error)
    return c.json({ success: false, error: 'Failed to load title stats' }, 500)
  }
})

// ============================================
// API - Domain Stats (도메인별 통계)
// ============================================

// 도메인별 통계 조회 API
// 발견: detection_results (final_status='illegal')
// 신고/차단: report_tracking
app.get('/api/stats/by-domain', async (c) => {
  try {
    await ensureDbMigration()
    
    // 기간 필터 파라미터 (YYYY-MM-DD)
    const startDate = c.req.query('start_date')
    const endDate = c.req.query('end_date')
    
    let stats
    if (startDate && endDate) {
      stats = await query`
        WITH detection_stats AS (
          SELECT domain, COUNT(*) as discovered
          FROM detection_results
          WHERE final_status = 'illegal'
            AND domain IS NOT NULL AND domain != ''
            AND SUBSTRING(session_id, 1, 10) >= ${startDate}
            AND SUBSTRING(session_id, 1, 10) <= ${endDate}
          GROUP BY domain
        ),
        report_stats AS (
          SELECT 
            domain,
            COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
            COUNT(*) FILTER (WHERE report_status = '차단') as blocked
          FROM report_tracking
          WHERE domain IS NOT NULL AND domain != ''
            AND SUBSTRING(session_id, 1, 10) >= ${startDate}
            AND SUBSTRING(session_id, 1, 10) <= ${endDate}
          GROUP BY domain
        )
        SELECT 
          d.domain,
          d.discovered,
          COALESCE(r.reported, 0) as reported,
          COALESCE(r.blocked, 0) as blocked,
          COALESCE(s.site_type, 'unclassified') as site_type,
          COALESCE(s.site_status, 'active') as site_status,
          COALESCE(s.language, 'unset') as language
        FROM detection_stats d
        LEFT JOIN report_stats r ON LOWER(d.domain) = LOWER(r.domain)
        LEFT JOIN sites s ON LOWER(d.domain) = LOWER(s.domain) AND s.type = 'illegal'
        ORDER BY d.discovered DESC
      `
    } else {
      stats = await query`
        WITH detection_stats AS (
          SELECT domain, COUNT(*) as discovered
          FROM detection_results
          WHERE final_status = 'illegal'
            AND domain IS NOT NULL AND domain != ''
          GROUP BY domain
        ),
        report_stats AS (
          SELECT 
            domain,
            COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
            COUNT(*) FILTER (WHERE report_status = '차단') as blocked
          FROM report_tracking
          WHERE domain IS NOT NULL AND domain != ''
          GROUP BY domain
        )
        SELECT 
          d.domain,
          d.discovered,
          COALESCE(r.reported, 0) as reported,
          COALESCE(r.blocked, 0) as blocked,
          COALESCE(s.site_type, 'unclassified') as site_type,
          COALESCE(s.site_status, 'active') as site_status,
          COALESCE(s.language, 'unset') as language
        FROM detection_stats d
        LEFT JOIN report_stats r ON LOWER(d.domain) = LOWER(r.domain)
        LEFT JOIN sites s ON LOWER(d.domain) = LOWER(s.domain) AND s.type = 'illegal'
        ORDER BY d.discovered DESC
      `
    }
    
    // 차단율 계산 및 결과 정리
    const result = stats.map((s: any) => {
      const discovered = parseInt(s.discovered) || 0
      const reported = parseInt(s.reported) || 0
      const blocked = parseInt(s.blocked) || 0
      const blockRate = reported > 0 ? Math.round((blocked / reported) * 100 * 10) / 10 : 0
      
      return {
        domain: s.domain,
        site_type: s.site_type || 'unclassified',
        site_status: s.site_status || 'active',
        language: s.language || 'unset',
        discovered,
        reported,
        blocked,
        blockRate
      }
    })
    
    return c.json({
      success: true,
      stats: result,
      total: result.length
    })
  } catch (error) {
    console.error('Domain stats error:', error)
    return c.json({ success: false, error: 'Failed to load domain stats' }, 500)
  }
})

// ============================================
// API - 사이트 분류 (site_type) 관리
// ============================================

const TYPE_SCORE_MAP: Record<string, number> = {
  'scanlation_group': 35,
  'aggregator': 20,
  'clone': 10,
  'blog': 5,
  'unclassified': 0,
}

// 사이트 분류 업데이트
app.patch('/api/sites/classify', async (c) => {
  try {
    await ensureDbMigration()
    const { domain, site_type } = await c.req.json()
    
    if (!domain || !site_type) {
      return c.json({ success: false, error: 'domain과 site_type은 필수입니다.' }, 400)
    }
    
    const validTypes = Object.keys(TYPE_SCORE_MAP)
    if (!validTypes.includes(site_type)) {
      return c.json({ success: false, error: `유효하지 않은 site_type입니다. 가능한 값: ${validTypes.join(', ')}` }, 400)
    }
    
    const lowerDomain = domain.toLowerCase()
    
    // sites 테이블에 해당 도메인이 있는지 확인
    const existing = await query`
      SELECT id FROM sites WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
    `
    
    if (existing.length > 0) {
      // 업데이트
      await query`
        UPDATE sites SET site_type = ${site_type} WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
      `
    } else {
      // 자동 추가 (illegal 사이트로)
      await query`
        INSERT INTO sites (domain, type, site_type)
        VALUES (${lowerDomain}, 'illegal', ${site_type})
        ON CONFLICT (domain, type) DO UPDATE SET site_type = ${site_type}
      `
    }
    
    return c.json({
      success: true,
      domain: lowerDomain,
      site_type,
      type_score: TYPE_SCORE_MAP[site_type] || 0
    })
  } catch (error) {
    console.error('Site classify error:', error)
    return c.json({ success: false, error: 'Failed to classify site' }, 500)
  }
})

// 미분류 도메인 수 조회 (알림용)
app.get('/api/notifications/unclassified-count', async (c) => {
  try {
    await ensureDbMigration()
    
    // detection_results에서 illegal 도메인 중 sites 테이블에 분류가 없거나 unclassified인 도메인 수
    const result = await query`
      WITH illegal_domains AS (
        SELECT DISTINCT LOWER(domain) as domain
        FROM detection_results
        WHERE final_status = 'illegal'
          AND domain IS NOT NULL AND domain != ''
      )
      SELECT COUNT(*) as count
      FROM illegal_domains d
      LEFT JOIN sites s ON d.domain = LOWER(s.domain) AND s.type = 'illegal'
      WHERE s.site_type IS NULL OR s.site_type = 'unclassified'
    `
    
    const count = parseInt(result[0]?.count) || 0
    
    return c.json({
      success: true,
      count,
      message: count > 0 ? `${count}개 불법 도메인의 사이트 분류가 필요합니다.` : null
    })
  } catch (error) {
    console.error('Unclassified count error:', error)
    return c.json({ success: false, error: 'Failed to get unclassified count' }, 500)
  }
})

// ============================================
// API - 불법 사이트 현황 (Site Status)
// ============================================

// 불법 사이트 현황 목록 조회
app.get('/api/site-status', async (c) => {
  try {
    await ensureDbMigration()
    
    const sites = await query`
      SELECT 
        s.id, s.domain, 
        COALESCE(s.site_type, 'unclassified') as site_type,
        COALESCE(s.site_status, 'active') as site_status,
        s.new_url,
        COALESCE(s.distribution_channel, '웹') as distribution_channel,
        COALESCE(s.language, 'unset') as language,
        s.created_at
      FROM sites s
      WHERE s.type = 'illegal'
      ORDER BY 
        CASE WHEN s.site_status = 'closed' THEN 1 ELSE 0 END,
        s.domain ASC
    `
    
    // 각 사이트의 최근 활동 이력 1건씩 조회
    const allDomains = sites.map((s: any) => s.domain.toLowerCase())
    let latestNotes: any[] = []
    if (allDomains.length > 0) {
      latestNotes = await query`
        SELECT DISTINCT ON (domain) domain, id, note_type, content, created_at
        FROM site_notes
        WHERE domain = ANY(${allDomains})
        ORDER BY domain, created_at DESC
      `
    }
    const notesMap = new Map(latestNotes.map((n: any) => [n.domain, n]))
    
    return c.json({
      success: true,
      sites: sites.map((s: any) => ({
        id: s.id,
        domain: s.domain,
        site_type: s.site_type,
        site_status: s.site_status,
        new_url: s.new_url || null,
        distribution_channel: s.distribution_channel,
        language: s.language,
        latest_note: notesMap.get(s.domain.toLowerCase()) || null,
        created_at: s.created_at,
      })),
      total: sites.length,
    })
  } catch (error) {
    console.error('Site status list error:', error)
    return c.json({ success: false, error: 'Failed to load site status' }, 500)
  }
})

// 사이트 상태 업데이트 (active / closed / changed)
app.patch('/api/site-status/:domain/status', async (c) => {
  try {
    await ensureDbMigration()
    const domain = decodeURIComponent(c.req.param('domain'))
    const { site_status, new_url } = await c.req.json()
    
    const validStatuses = ['active', 'closed', 'changed']
    if (!validStatuses.includes(site_status)) {
      return c.json({ success: false, error: `유효하지 않은 상태입니다. 가능한 값: ${validStatuses.join(', ')}` }, 400)
    }
    
    // changed일 때만 new_url 필요
    const urlValue = site_status === 'changed' ? (new_url?.trim() || null) : null
    
    const lowerDomain = domain.toLowerCase()
    await query`
      UPDATE sites SET 
        site_status = ${site_status}, 
        new_url = ${urlValue}
      WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
    `
    
    return c.json({
      success: true,
      domain: lowerDomain,
      site_status,
      new_url: urlValue,
    })
  } catch (error) {
    console.error('Site status update error:', error)
    return c.json({ success: false, error: 'Failed to update site status' }, 500)
  }
})

// 사이트 분류 + 상태 일괄 업데이트 (사이트 현황 페이지에서 분류 변경)
app.patch('/api/site-status/:domain/classify', async (c) => {
  try {
    await ensureDbMigration()
    const domain = decodeURIComponent(c.req.param('domain'))
    const { site_type } = await c.req.json()
    
    const validTypes = Object.keys(TYPE_SCORE_MAP)
    if (!validTypes.includes(site_type)) {
      return c.json({ success: false, error: `유효하지 않은 site_type입니다.` }, 400)
    }
    
    const lowerDomain = domain.toLowerCase()
    
    const existing = await query`
      SELECT id FROM sites WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
    `
    
    if (existing.length > 0) {
      await query`
        UPDATE sites SET site_type = ${site_type} WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
      `
    } else {
      await query`
        INSERT INTO sites (domain, type, site_type, site_status)
        VALUES (${lowerDomain}, 'illegal', ${site_type}, 'active')
        ON CONFLICT (domain, type) DO UPDATE SET site_type = ${site_type}
      `
    }
    
    return c.json({
      success: true,
      domain: lowerDomain,
      site_type,
      type_score: TYPE_SCORE_MAP[site_type] || 0,
    })
  } catch (error) {
    console.error('Site classify (from status page) error:', error)
    return c.json({ success: false, error: 'Failed to classify site' }, 500)
  }
})

// ============================================
// API - Distribution Channels (유통 경로)
// ============================================

// 유통 경로 목록 조회
app.get('/api/distribution-channels', async (c) => {
  try {
    await ensureDbMigration()
    const channels = await query`
      SELECT id, name, is_default, created_at
      FROM distribution_channels
      ORDER BY is_default DESC, name ASC
    `
    return c.json({ success: true, channels })
  } catch (error) {
    console.error('Distribution channels list error:', error)
    return c.json({ success: false, error: 'Failed to load distribution channels' }, 500)
  }
})

// 새 유통 경로 추가 (사용자 직접 입력)
app.post('/api/distribution-channels', async (c) => {
  try {
    await ensureDbMigration()
    const { name } = await c.req.json()
    if (!name || !name.trim()) {
      return c.json({ success: false, error: '유통 경로 이름을 입력해주세요.' }, 400)
    }
    const trimmed = name.trim()
    const result = await query`
      INSERT INTO distribution_channels (name, is_default)
      VALUES (${trimmed}, false)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
    `
    if (result.length === 0) {
      // 이미 존재
      const existing = await query`SELECT * FROM distribution_channels WHERE name = ${trimmed}`
      return c.json({ success: true, channel: existing[0], message: '이미 존재하는 유통 경로입니다.' })
    }
    return c.json({ success: true, channel: result[0] })
  } catch (error) {
    console.error('Distribution channel create error:', error)
    return c.json({ success: false, error: 'Failed to create distribution channel' }, 500)
  }
})

// 사이트 유통 경로 변경 (자동 이력 기록)
app.patch('/api/site-status/:domain/channel', async (c) => {
  try {
    await ensureDbMigration()
    const domain = decodeURIComponent(c.req.param('domain'))
    const { distribution_channel } = await c.req.json()
    if (!distribution_channel || !distribution_channel.trim()) {
      return c.json({ success: false, error: '유통 경로를 입력해주세요.' }, 400)
    }
    const newChannel = distribution_channel.trim()
    const lowerDomain = domain.toLowerCase()

    // 기존 유통 경로 조회
    const existing = await query`
      SELECT COALESCE(distribution_channel, '웹') as distribution_channel
      FROM sites WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
    `
    const oldChannel = existing.length > 0 ? existing[0].distribution_channel : '웹'

    // sites 테이블 업데이트
    await query`
      UPDATE sites SET distribution_channel = ${newChannel}
      WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
    `

    // 변경 이력 자동 기록 (이전과 다른 경우에만)
    if (oldChannel !== newChannel) {
      const content = `${oldChannel} → ${newChannel}`
      await query`
        INSERT INTO site_notes (domain, note_type, content)
        VALUES (${lowerDomain}, 'channel_change', ${content})
      `
    }

    return c.json({
      success: true,
      domain: lowerDomain,
      distribution_channel: newChannel,
      previous_channel: oldChannel,
    })
  } catch (error) {
    console.error('Site channel update error:', error)
    return c.json({ success: false, error: 'Failed to update distribution channel' }, 500)
  }
})

// ============================================
// API - Site Languages (사이트 언어)
// ============================================

// 언어 옵션 목록 조회
app.get('/api/site-languages', async (c) => {
  try {
    await ensureDbMigration()
    const languages = await query`
      SELECT id, name, is_default, created_at
      FROM site_languages
      ORDER BY is_default DESC, name ASC
    `
    return c.json({ success: true, languages })
  } catch (error) {
    console.error('Site languages list error:', error)
    return c.json({ success: false, error: 'Failed to load site languages' }, 500)
  }
})

// 새 언어 추가 (사용자 직접 입력)
app.post('/api/site-languages', async (c) => {
  try {
    await ensureDbMigration()
    const { name } = await c.req.json()
    if (!name || !name.trim()) {
      return c.json({ success: false, error: '언어 이름을 입력해주세요.' }, 400)
    }
    const trimmed = name.trim()
    const result = await query`
      INSERT INTO site_languages (name, is_default)
      VALUES (${trimmed}, false)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
    `
    if (result.length === 0) {
      const existing = await query`SELECT * FROM site_languages WHERE name = ${trimmed}`
      return c.json({ success: true, language: existing[0], message: '이미 존재하는 언어입니다.' })
    }
    return c.json({ success: true, language: result[0] })
  } catch (error) {
    console.error('Site language create error:', error)
    return c.json({ success: false, error: 'Failed to create site language' }, 500)
  }
})

// 언어 삭제 (보호 언어 제외)
app.delete('/api/site-languages/:id', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    
    // 해당 언어 조회
    const langRows = await query`SELECT * FROM site_languages WHERE id = ${id}`
    if (langRows.length === 0) {
      return c.json({ success: false, error: '언어를 찾을 수 없습니다.' }, 404)
    }
    
    const lang = langRows[0]
    
    // 보호 언어 체크 (영어, 한국어, 스페인어, 다국어)
    const protectedLanguages = ['영어', '한국어', '스페인어', '다국어']
    if (protectedLanguages.includes(lang.name)) {
      return c.json({ success: false, error: `"${lang.name}"은(는) 기본 언어로 삭제할 수 없습니다.` }, 400)
    }
    
    // 해당 언어를 사용 중인 사이트 수 확인
    const usageCount = await query`
      SELECT COUNT(*) as count FROM sites WHERE language = ${lang.name}
    `
    const count = parseInt(usageCount[0]?.count || '0')
    
    // 사용 중인 사이트의 언어를 'unset'으로 변경
    if (count > 0) {
      await query`UPDATE sites SET language = 'unset' WHERE language = ${lang.name}`
    }
    
    // 언어 삭제
    await query`DELETE FROM site_languages WHERE id = ${id}`
    
    return c.json({ success: true, deleted: lang.name, affected_sites: count })
  } catch (error) {
    console.error('Site language delete error:', error)
    return c.json({ success: false, error: 'Failed to delete site language' }, 500)
  }
})

// 사이트 언어 변경
app.patch('/api/site-status/:domain/language', async (c) => {
  try {
    await ensureDbMigration()
    const domain = decodeURIComponent(c.req.param('domain'))
    const { language } = await c.req.json()
    if (!language || !language.trim()) {
      return c.json({ success: false, error: '언어를 입력해주세요.' }, 400)
    }
    const newLanguage = language.trim()
    const lowerDomain = domain.toLowerCase()

    await query`
      UPDATE sites SET language = ${newLanguage}
      WHERE LOWER(domain) = ${lowerDomain} AND type = 'illegal'
    `

    return c.json({
      success: true,
      domain: lowerDomain,
      language: newLanguage,
    })
  } catch (error) {
    console.error('Site language update error:', error)
    return c.json({ success: false, error: 'Failed to update site language' }, 500)
  }
})

// ============================================
// API - Site Notes (활동 이력)
// ============================================

// 도메인별 활동 이력 조회
app.get('/api/site-notes/:domain', async (c) => {
  try {
    await ensureDbMigration()
    const domain = decodeURIComponent(c.req.param('domain')).toLowerCase()
    const notes = await query`
      SELECT id, domain, note_type, content, created_at
      FROM site_notes
      WHERE domain = ${domain}
      ORDER BY created_at DESC
    `
    return c.json({ success: true, notes })
  } catch (error) {
    console.error('Site notes list error:', error)
    return c.json({ success: false, error: 'Failed to load site notes' }, 500)
  }
})

// 메모 추가
app.post('/api/site-notes/:domain', async (c) => {
  try {
    await ensureDbMigration()
    const domain = decodeURIComponent(c.req.param('domain')).toLowerCase()
    const { content } = await c.req.json()
    if (!content || !content.trim()) {
      return c.json({ success: false, error: '메모 내용을 입력해주세요.' }, 400)
    }
    const result = await query`
      INSERT INTO site_notes (domain, note_type, content)
      VALUES (${domain}, 'memo', ${content.trim()})
      RETURNING *
    `
    return c.json({ success: true, note: result[0] })
  } catch (error) {
    console.error('Site note create error:', error)
    return c.json({ success: false, error: 'Failed to create site note' }, 500)
  }
})

// 메모 삭제
app.delete('/api/site-notes/:id', async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    if (isNaN(id)) {
      return c.json({ success: false, error: '유효하지 않은 ID입니다.' }, 400)
    }
    await query`DELETE FROM site_notes WHERE id = ${id}`
    return c.json({ success: true })
  } catch (error) {
    console.error('Site note delete error:', error)
    return c.json({ success: false, error: 'Failed to delete site note' }, 500)
  }
})

// ============================================
// API - Report Tracking (신고결과 추적)
// ============================================

// LiteLLM + Gemini 설정
const LITELLM_ENDPOINT = 'https://litellm.iaiai.ai/v1'
const LITELLM_MODEL = 'gemini-3-pro-preview'

// ⚠️ 정적 라우트는 동적 라우트(:sessionId) 앞에 배치해야 함

// 세션 목록 (신고 추적용) - 정적 라우트
app.get('/api/report-tracking/sessions', async (c) => {
  try {
    await ensureDbMigration()
    
    const sessions = await getSessions()
    console.log('📋 Total sessions:', sessions.length)
    
    // 각 세션의 신고 추적 통계 조회
    const sessionsWithStats = await Promise.all(sessions.map(async (s: any) => {
      const stats = await getReportTrackingStatsBySession(s.id)
      console.log(`📊 Session ${s.id} stats:`, stats)
      return {
        id: s.id,
        created_at: s.created_at,
        status: s.status,
        tracking_stats: stats
      }
    }))
    
    // 신고 추적 데이터가 있는 세션만 필터링
    const filteredSessions = sessionsWithStats.filter(s => s.tracking_stats.total > 0)
    console.log('✅ Filtered sessions with data:', filteredSessions.length)
    
    return c.json({
      success: true,
      sessions: filteredSessions
    })
  } catch (error) {
    console.error('Sessions list error:', error)
    return c.json({ success: false, error: 'Failed to load sessions' }, 500)
  }
})

// 사유 목록 조회 - 정적 라우트
app.get('/api/report-tracking/reasons', async (c) => {
  try {
    const reasons = await getReportReasons()
    return c.json({
      success: true,
      reasons: reasons.map((r: any) => ({
        id: r.id,
        text: r.reason_text,
        usage_count: r.usage_count
      }))
    })
  } catch (error) {
    console.error('Reasons list error:', error)
    return c.json({ success: false, error: 'Failed to load reasons' }, 500)
  }
})

// 대기 중 URL 요약 조회 - 정적 라우트 (모달용)
app.get('/api/report-tracking/pending-summary', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.query('session_id')
    
    // session_id가 있으면 해당 세션만, 없으면 전체 세션의 대기 중 URL 조회
    let items
    if (sessionId) {
      items = await query`
        SELECT id, session_id, url, domain, title, report_status, report_id, reason, created_at, updated_at
        FROM report_tracking
        WHERE session_id = ${sessionId}
          AND report_status = '대기 중'
        ORDER BY created_at DESC
      `
    } else {
      items = await query`
        SELECT id, session_id, url, domain, title, report_status, report_id, reason, created_at, updated_at
        FROM report_tracking
        WHERE report_status = '대기 중'
        ORDER BY session_id DESC, created_at DESC
      `
    }
    
    return c.json({
      success: true,
      items: items.map((item: any) => ({
        id: item.id,
        session_id: item.session_id,
        url: item.url,
        domain: item.domain,
        title: item.title || null,
        report_status: item.report_status,
        report_id: item.report_id || null,
        reason: item.reason || null,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
      total: items.length,
    })
  } catch (error) {
    console.error('Pending summary error:', error)
    return c.json({ success: false, error: 'Failed to load pending summary' }, 500)
  }
})

// 회차별 신고 추적 목록 조회 - 동적 라우트
app.get('/api/report-tracking/:sessionId', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const status = c.req.query('status')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '50')
    const search = c.req.query('search') || ''
    
    const result = await getReportTrackingBySession(sessionId, status, page, limit, search)
    
    return c.json({
      success: true,
      session_id: sessionId,
      items: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    })
  } catch (error) {
    console.error('Report tracking list error:', error)
    return c.json({ success: false, error: 'Failed to load report tracking' }, 500)
  }
})

// 회차별 통계 조회
app.get('/api/report-tracking/:sessionId/stats', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const stats = await getReportTrackingStatsBySession(sessionId)
    
    return c.json({
      success: true,
      session_id: sessionId,
      stats
    })
  } catch (error) {
    console.error('Report tracking stats error:', error)
    return c.json({ success: false, error: 'Failed to load stats' }, 500)
  }
})

// 상태 업데이트
app.put('/api/report-tracking/:id/status', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { status, report_id } = await c.req.json()
    
    if (!status) {
      return c.json({ success: false, error: 'Missing status' }, 400)
    }
    
    const validStatuses = ['미신고', '차단', '대기 중', '색인없음', '거부']
    if (!validStatuses.includes(status)) {
      return c.json({ success: false, error: 'Invalid status' }, 400)
    }
    
    const updated = await updateReportTrackingStatus(id, status, report_id)
    if (!updated) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    return c.json({ success: true, item: updated })
  } catch (error) {
    console.error('Status update error:', error)
    return c.json({ success: false, error: 'Failed to update status' }, 500)
  }
})

// 사유 업데이트
app.put('/api/report-tracking/:id/reason', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { reason } = await c.req.json()
    
    if (!reason) {
      return c.json({ success: false, error: 'Missing reason' }, 400)
    }
    
    // 사유 목록에 추가/업데이트
    await addOrUpdateReportReason(reason)
    
    const updated = await updateReportTrackingReason(id, reason)
    if (!updated) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    return c.json({ success: true, item: updated })
  } catch (error) {
    console.error('Reason update error:', error)
    return c.json({ success: false, error: 'Failed to update reason' }, 500)
  }
})

// 신고ID만 업데이트
app.put('/api/report-tracking/:id/report-id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'))
    const { report_id } = await c.req.json()
    
    const updated = await query`
      UPDATE report_tracking 
      SET report_id = ${report_id || null}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `
    
    if (!updated || updated.length === 0) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    return c.json({ success: true, item: updated[0] })
  } catch (error) {
    console.error('Report ID update error:', error)
    return c.json({ success: false, error: 'Failed to update report ID' }, 500)
  }
})

// URL 수동 추가 (신고결과 추적 + 모니터링 회차 연동)
app.post('/api/report-tracking/:sessionId/add-url', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const { url, title } = await c.req.json()
    
    if (!url) {
      return c.json({ success: false, error: 'URL을 입력해주세요.' }, 400)
    }
    
    if (!title) {
      return c.json({ success: false, error: '작품을 선택해주세요.' }, 400)
    }
    
    // URL 유효성 검사
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return c.json({ success: false, error: 'http:// 또는 https://로 시작하는 URL을 입력해주세요.' }, 400)
    }
    
    // 도메인 추출
    let domain: string
    try {
      const urlObj = new URL(url)
      domain = urlObj.hostname.replace('www.', '')
    } catch {
      return c.json({ success: false, error: '올바른 URL 형식이 아닙니다.' }, 400)
    }
    
    // 1. report_tracking 테이블에 추가 (title 포함)
    const trackingResult = await createReportTracking({
      session_id: sessionId,
      url: url,
      domain: domain,
      title: title,
      report_status: '미신고'
    })
    
    if (!trackingResult) {
      return c.json({ success: false, error: '이미 등록된 URL입니다.' }, 400)
    }
    
    // 2. 도메인을 불법 사이트 목록에 추가 (중복 무시)
    await addSite(domain, 'illegal')
    
    // 3. 세션의 Blob 결과 파일 업데이트 (모니터링 회차 연동)
    const session = await getSessionById(sessionId)
    if (session?.file_final_results?.startsWith('http')) {
      try {
        // 기존 결과 다운로드
        const existingResults = await downloadResults(session.file_final_results)
        
        // 새 결과 추가
        const newResult: FinalResult = {
          title: title,
          domain: domain,
          url: url,
          search_query: '수동 추가',
          page: 0,
          rank: 0,
          status: 'illegal',
          llm_judgment: null,
          llm_reason: null,
          final_status: 'illegal',
          reviewed_at: new Date().toISOString()
        }
        
        existingResults.push(newResult)
        
        // Blob에 다시 업로드
        const { put } = await import('@vercel/blob')
        const blob = await put(
          `results/${sessionId}/final-results.json`,
          JSON.stringify(existingResults),
          { access: 'public', addRandomSuffix: false }
        )
        
        // 세션 업데이트
        await query`
          UPDATE sessions SET
            file_final_results = ${blob.url},
            results_total = ${existingResults.length},
            results_illegal = ${existingResults.filter(r => r.final_status === 'illegal').length}
          WHERE id = ${sessionId}
        `
        
        console.log(`✅ URL added to session ${sessionId}: ${url}`)
      } catch (blobError) {
        console.error('Blob update error:', blobError)
        // Blob 업데이트 실패해도 report_tracking에는 추가됨
      }
    }
    
    return c.json({
      success: true,
      message: 'URL이 추가되었습니다.',
      url: url,
      domain: domain
    })
  } catch (error) {
    console.error('Add URL error:', error)
    return c.json({ success: false, error: 'URL 추가 실패' }, 500)
  }
})

// HTML 업로드 및 URL 매칭
app.post('/api/report-tracking/:sessionId/upload', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const body = await c.req.json()
    
    // CSV 업로드 (신규)
    if (body.csv_rows) {
      const { csv_rows, report_id: providedReportId, file_name } = body
      
      if (!Array.isArray(csv_rows) || csv_rows.length === 0) {
        return c.json({ success: false, error: 'CSV 데이터가 비어있습니다.' }, 400)
      }
      
      const reportId = providedReportId?.trim()
      if (!reportId) {
        return c.json({ success: false, error: '신고 ID를 추출할 수 없습니다. 파일명을 확인해주세요.' }, 400)
      }
      
      console.log(`📥 Processing CSV upload for session ${sessionId}, report_id: ${reportId}, rows: ${csv_rows.length}`)
      
      // CSV 사유 매핑
      const REASON_MAP: Record<string, string> = {
        '기존의 요청과 중복된 요청입니다.': '기존과 중복된 요청',
        '문제의 콘텐츠를 찾을 수 없습니다.': '문제의 콘텐츠를 찾을 수 없음',
      }
      
      // CSV 상태 매핑
      const STATUS_MAP: Record<string, string> = {
        'approved': '차단',
        'denied': '거부',
        'pending': '대기 중',
      }
      
      // 상태별로 URL 그룹핑
      const approvedUrls: string[] = []
      const deniedItems: { url: string; reason: string }[] = []
      const pendingUrls: string[] = []
      
      for (const row of csv_rows) {
        const url = row.url?.trim()
        const status = row.status?.trim()?.toLowerCase()
        const details = row.details?.trim() || ''
        
        if (!url || !status) continue
        
        if (status === 'approved') {
          approvedUrls.push(url)
        } else if (status === 'denied') {
          const mappedReason = REASON_MAP[details] || details || '거부됨'
          deniedItems.push({ url, reason: mappedReason })
        } else if (status === 'pending') {
          pendingUrls.push(url)
        }
      }
      
      let totalMatched = 0
      
      // 1) approved → 차단
      if (approvedUrls.length > 0) {
        const matched = await bulkUpdateReportTrackingByUrls(sessionId, approvedUrls, '차단', reportId)
        totalMatched += matched
        console.log(`  ✅ approved(차단): ${matched}/${approvedUrls.length} URLs matched`)
      }
      
      // 2) pending → 대기 중
      if (pendingUrls.length > 0) {
        const matched = await bulkUpdateReportTrackingByUrls(sessionId, pendingUrls, '대기 중', reportId)
        totalMatched += matched
        console.log(`  ⏳ pending(대기 중): ${matched}/${pendingUrls.length} URLs matched`)
      }
      
      // 3) denied → 거부 + 사유 업데이트
      if (deniedItems.length > 0) {
        const deniedUrls = deniedItems.map(d => d.url)
        const matched = await bulkUpdateReportTrackingByUrls(sessionId, deniedUrls, '거부', reportId)
        totalMatched += matched
        console.log(`  ❌ denied(거부): ${matched}/${deniedItems.length} URLs matched`)
        
        // 사유 개별 업데이트 (매칭된 URL만)
        for (const item of deniedItems) {
          try {
            await query`
              UPDATE report_tracking SET reason = ${item.reason}, updated_at = NOW()
              WHERE session_id = ${sessionId} AND url = ${item.url}
            `
            // report_reasons 테이블에도 사유 등록/갱신
            await addOrUpdateReportReason(item.reason)
          } catch (e) {
            // 개별 사유 업데이트 실패는 무시
          }
        }
      }
      
      console.log(`✅ CSV upload complete: ${totalMatched} total matched`)
      
      // 업로드 이력 저장
      await createReportUpload({
        session_id: sessionId,
        report_id: reportId,
        file_name: file_name || 'uploaded.csv',
        matched_count: totalMatched,
        total_urls_in_html: csv_rows.length
      })
      
      // 상태별 처리 결과 요약
      const summary = []
      if (approvedUrls.length > 0) summary.push(`차단 ${approvedUrls.length}건`)
      if (deniedItems.length > 0) summary.push(`거부 ${deniedItems.length}건`)
      if (pendingUrls.length > 0) summary.push(`대기 중 ${pendingUrls.length}건`)
      
      return c.json({
        success: true,
        report_id: reportId,
        auto_extracted: true,
        total_rows: csv_rows.length,
        matched_urls: totalMatched,
        breakdown: {
          approved: approvedUrls.length,
          denied: deniedItems.length,
          pending: pendingUrls.length,
        },
        message: `신고 ID ${reportId} — ${summary.join(', ')} (총 ${totalMatched}개 URL 매칭됨)`
      })
    }
    
    // csv_rows가 없으면 에러
    return c.json({ success: false, error: 'CSV 데이터(csv_rows)가 필요합니다.' }, 400)
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ success: false, error: 'Failed to process upload' }, 500)
  }
})

// 업로드 이력 조회
app.get('/api/report-tracking/:sessionId/uploads', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const uploads = await getReportUploadsBySession(sessionId)
    
    return c.json({
      success: true,
      session_id: sessionId,
      uploads: uploads.map((u: any) => ({
        id: u.id,
        report_id: u.report_id,
        file_name: u.file_name,
        matched_count: u.matched_count,
        total_urls_in_html: u.total_urls_in_html,
        uploaded_at: u.uploaded_at
      }))
    })
  } catch (error) {
    console.error('Uploads list error:', error)
    return c.json({ success: false, error: 'Failed to load uploads' }, 500)
  }
})

// 업로드 이력 신고 ID 수정
app.put('/api/report-tracking/uploads/:uploadId', async (c) => {
  try {
    const uploadId = parseInt(c.req.param('uploadId'))
    const { report_id } = await c.req.json()
    
    if (!report_id) {
      return c.json({ success: false, error: '신고 ID가 필요합니다.' }, 400)
    }
    
    const updated = await updateReportUploadId(uploadId, report_id)
    
    if (!updated) {
      return c.json({ success: false, error: '업로드 이력을 찾을 수 없습니다.' }, 404)
    }
    
    return c.json({ success: true, upload: updated })
  } catch (error) {
    console.error('Update upload error:', error)
    return c.json({ success: false, error: 'Failed to update upload' }, 500)
  }
})

// URL 목록 내보내기 (복사용)
app.get('/api/report-tracking/:sessionId/urls', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const status = c.req.query('status')
    
    const urls = await getReportTrackingUrls(sessionId, status)
    
    return c.json({
      success: true,
      session_id: sessionId,
      filter: status || '전체',
      count: urls.length,
      urls
    })
  } catch (error) {
    console.error('URLs export error:', error)
    return c.json({ success: false, error: 'Failed to export URLs' }, 500)
  }
})

// CSV 내보내기
app.get('/api/report-tracking/:sessionId/export', async (c) => {
  try {
    const sessionId = c.req.param('sessionId')
    const items = await getReportTrackingBySession(sessionId)
    
    // CSV 생성
    const headers = ['URL', '도메인', '신고상태', '신고ID', '사유', '등록일', '수정일']
    const rows = items.map((item: any) => [
      item.url,
      item.domain,
      item.report_status,
      item.report_id || '',
      item.reason || '',
      item.created_at,
      item.updated_at
    ])
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map((cell: string) => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n')
    
    // BOM 추가 (Excel 한글 호환)
    const bom = '\uFEFF'
    
    return new Response(bom + csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-tracking-${sessionId}.csv"`
      }
    })
  } catch (error) {
    console.error('CSV export error:', error)
    return c.json({ success: false, error: 'Failed to export CSV' }, 500)
  }
})

// ============================================
// API - Domain Analysis (월간 불법 도메인 분석)
// ============================================

import {
  buildAnalysisPrompt,
  createAnalysisTask,
  getAnalysisTaskStatus,
  processManusResult,
  normalizeManusItem,
  type DomainAnalysisResult,
  type DomainWithType,
  type ManusTaskStatus,
} from '../scripts/domain-analysis.js'

// ============================================
// API - System Settings (관리자 설정)
// ============================================

// 설정 목록 조회
app.get('/api/settings', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const settings = await query`
      SELECT key, value, updated_at FROM system_settings ORDER BY key ASC
    `
    return c.json({ success: true, settings })
  } catch (error) {
    console.error('Settings list error:', error)
    return c.json({ success: false, error: 'Failed to load settings' }, 500)
  }
})

// 설정 값 변경 (admin only)
app.put('/api/settings/:key', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const key = c.req.param('key')
    const { value } = await c.req.json()
    
    if (value === undefined || value === null) {
      return c.json({ success: false, error: '값을 입력해주세요.' }, 400)
    }
    
    const result = await query`
      UPDATE system_settings 
      SET value = ${String(value)}, updated_at = NOW()
      WHERE key = ${key}
      RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: '설정 키를 찾을 수 없습니다.' }, 404)
    }
    
    return c.json({ success: true, setting: result[0] })
  } catch (error) {
    console.error('Settings update error:', error)
    return c.json({ success: false, error: 'Failed to update setting' }, 500)
  }
})

// ============================================
// API - Monitoring Keywords (모니터링 키워드 관리)
// ============================================

// 활성 키워드 목록 조회
app.get('/api/settings/keywords', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const rows = await query`
      SELECT value FROM system_settings WHERE key = 'monitoring_keyword_suffixes'
    `
    let suffixes: string[] = ['', 'manga', 'chapter']
    if (rows.length > 0) {
      try {
        suffixes = JSON.parse(rows[0].value)
      } catch {}
    }
    return c.json({ success: true, suffixes })
  } catch (error) {
    console.error('Keywords list error:', error)
    return c.json({ success: false, error: 'Failed to load keywords' }, 500)
  }
})

// 삭제된 키워드 히스토리 조회 (/:suffix 보다 먼저 등록)
app.get('/api/settings/keywords/history', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const history = await query`
      SELECT id, suffix, deleted_at FROM keyword_history 
      WHERE is_permanent_deleted = false 
      ORDER BY deleted_at DESC
    `
    return c.json({ success: true, history })
  } catch (error) {
    console.error('Keyword history error:', error)
    return c.json({ success: false, error: 'Failed to load keyword history' }, 500)
  }
})

// 삭제된 키워드 복원 (/:suffix 보다 먼저 등록)
app.post('/api/settings/keywords/restore', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const { id } = await c.req.json()
    
    if (!id) {
      return c.json({ success: false, error: 'ID를 입력해주세요.' }, 400)
    }
    
    // 히스토리에서 조회
    const historyRows = await query`
      SELECT suffix FROM keyword_history WHERE id = ${id} AND is_permanent_deleted = false
    `
    if (historyRows.length === 0) {
      return c.json({ success: false, error: '히스토리를 찾을 수 없습니다.' }, 404)
    }
    
    const suffix = historyRows[0].suffix
    
    // 현재 활성 목록에 추가
    const rows = await query`
      SELECT value FROM system_settings WHERE key = 'monitoring_keyword_suffixes'
    `
    let suffixes: string[] = ['', 'manga', 'chapter']
    if (rows.length > 0) {
      try { suffixes = JSON.parse(rows[0].value) } catch {}
    }
    
    // 이미 있으면 중복 추가 안 함
    if (!suffixes.includes(suffix)) {
      suffixes.push(suffix)
      await query`
        UPDATE system_settings SET value = ${JSON.stringify(suffixes)}, updated_at = NOW()
        WHERE key = 'monitoring_keyword_suffixes'
      `
    }
    
    // 히스토리에서 제거
    await query`
      DELETE FROM keyword_history WHERE id = ${id}
    `
    
    return c.json({ success: true, suffixes })
  } catch (error) {
    console.error('Keyword restore error:', error)
    return c.json({ success: false, error: 'Failed to restore keyword' }, 500)
  }
})

// 삭제된 키워드 영구 삭제 (/:suffix 보다 먼저 등록)
app.delete('/api/settings/keywords/history/:id', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const id = parseInt(c.req.param('id'))
    
    if (isNaN(id)) {
      return c.json({ success: false, error: '유효하지 않은 ID입니다.' }, 400)
    }
    
    const result = await query`
      UPDATE keyword_history SET is_permanent_deleted = true WHERE id = ${id} AND is_permanent_deleted = false
      RETURNING *
    `
    
    if (result.length === 0) {
      return c.json({ success: false, error: '히스토리를 찾을 수 없습니다.' }, 404)
    }
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Keyword permanent delete error:', error)
    return c.json({ success: false, error: 'Failed to permanently delete keyword' }, 500)
  }
})

// 키워드 추가
app.post('/api/settings/keywords', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const { suffix } = await c.req.json()
    
    if (suffix === undefined || suffix === null) {
      return c.json({ success: false, error: '키워드 접미사를 입력해주세요.' }, 400)
    }
    
    // 빈 문자열은 [작품명] 키워드를 의미 - trim 하되 빈 문자열 허용
    const trimmedSuffix = String(suffix).trim()
    
    // 현재 목록 로드
    const rows = await query`
      SELECT value FROM system_settings WHERE key = 'monitoring_keyword_suffixes'
    `
    let suffixes: string[] = ['', 'manga', 'chapter']
    if (rows.length > 0) {
      try { suffixes = JSON.parse(rows[0].value) } catch {}
    }
    
    // 중복 체크
    if (suffixes.includes(trimmedSuffix)) {
      return c.json({ success: false, error: '이미 존재하는 키워드입니다.' }, 400)
    }
    
    // 추가
    suffixes.push(trimmedSuffix)
    await query`
      UPDATE system_settings SET value = ${JSON.stringify(suffixes)}, updated_at = NOW()
      WHERE key = 'monitoring_keyword_suffixes'
    `
    
    // 히스토리에서 복원된 경우 영구삭제 처리 (히스토리에서 제거)
    await query`
      DELETE FROM keyword_history WHERE suffix = ${trimmedSuffix} AND is_permanent_deleted = false
    `
    
    return c.json({ success: true, suffixes })
  } catch (error) {
    console.error('Keyword add error:', error)
    return c.json({ success: false, error: 'Failed to add keyword' }, 500)
  }
})

// 키워드 삭제 (히스토리로 이동) - 와일드카드 라우트는 마지막에 등록
app.delete('/api/settings/keywords/:suffix', requireAdmin(), async (c) => {
  try {
    await ensureDbMigration()
    const rawSuffix = decodeURIComponent(c.req.param('suffix'))
    // __empty__ 는 빈 문자열(작품명만 검색)을 의미
    const suffix = rawSuffix === '__empty__' ? '' : rawSuffix
    
    // 현재 목록 로드
    const rows = await query`
      SELECT value FROM system_settings WHERE key = 'monitoring_keyword_suffixes'
    `
    let suffixes: string[] = ['', 'manga', 'chapter']
    if (rows.length > 0) {
      try { suffixes = JSON.parse(rows[0].value) } catch {}
    }
    
    // 존재 여부 확인
    if (!suffixes.includes(suffix)) {
      return c.json({ success: false, error: '키워드를 찾을 수 없습니다.' }, 404)
    }
    
    // 삭제
    suffixes = suffixes.filter(s => s !== suffix)
    await query`
      UPDATE system_settings SET value = ${JSON.stringify(suffixes)}, updated_at = NOW()
      WHERE key = 'monitoring_keyword_suffixes'
    `
    
    // 히스토리에 기록
    await query`
      INSERT INTO keyword_history (suffix, deleted_at, is_permanent_deleted) 
      VALUES (${suffix}, NOW(), false)
    `
    
    return c.json({ success: true, suffixes })
  } catch (error) {
    console.error('Keyword delete error:', error)
    return c.json({ success: false, error: 'Failed to delete keyword' }, 500)
  }
})

// 실행 중 상태 관리 (메모리, 중복 실행 방지)
const domainAnalysisRunning: Record<string, boolean> = {}

// POST /api/domain-analysis/run - 분석 실행
app.post('/api/domain-analysis/run', async (c) => {
  let currentStep = '[초기화]'
  let month = ''

  try {
    currentStep = '[1/6 DB 마이그레이션]'
    await ensureDbMigration()

    currentStep = '[2/6 요청 파싱]'
    const body = await c.req.json().catch(() => ({}))
    const now = new Date()
    // 기본값: 전월 (예: 2월 12일 실행 → 2026-01 분석)
    if (body.month) {
      month = body.month
    } else {
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      month = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    }
    console.log(`📋 ${currentStep} month: ${month}`)

    // 중복 실행 방지
    if (domainAnalysisRunning[month]) {
      return c.json({ success: false, error: `${currentStep} 이미 해당 월(${month})의 분석이 실행 중입니다.` }, 409)
    }

    // 기존 완료된 보고서 확인
    currentStep = '[3/6 기존 리포트 확인]'
    const existing = await query`
      SELECT id, status FROM domain_analysis_reports WHERE analysis_month = ${month}
    `
    if (existing.length > 0 && existing[0].status === 'completed') {
      return c.json({ success: false, error: `${currentStep} 해당 월(${month})의 분석이 이미 완료되었습니다. 재실행하려면 rerun API를 사용하세요.` }, 409)
    }
    if (existing.length > 0 && existing[0].status === 'running') {
      return c.json({ success: false, error: `${currentStep} 해당 월(${month})의 분석이 이미 실행 중입니다.` }, 409)
    }
    console.log(`✅ ${currentStep} 기존 리포트: ${existing.length > 0 ? `ID ${existing[0].id} (${existing[0].status})` : '없음'}`)

    // 상위 50개 불법 도메인 조회 (분석 대상 월 기준 발견 수)
    currentStep = '[4/6 불법 도메인 조회]'
    const monthPattern = month + '%'
    // closed 상태 도메인 목록 조회 (제외 대상)
    const closedSites = await query`
      SELECT LOWER(domain) as domain FROM sites
      WHERE type = 'illegal' AND site_status = 'closed'
    `
    const closedDomains = closedSites.map((s: any) => s.domain)

    let topDomains: any[]
    if (closedDomains.length > 0) {
      topDomains = await query`
        SELECT domain, COUNT(*) as discovered
        FROM detection_results
        WHERE final_status = 'illegal'
          AND domain IS NOT NULL AND domain != ''
          AND SUBSTRING(session_id, 1, 7) = ${month}
          AND LOWER(domain) != ALL(${closedDomains})
        GROUP BY domain
        ORDER BY discovered DESC
        LIMIT 50
      `
    } else {
      topDomains = await query`
        SELECT domain, COUNT(*) as discovered
        FROM detection_results
        WHERE final_status = 'illegal'
          AND domain IS NOT NULL AND domain != ''
          AND SUBSTRING(session_id, 1, 7) = ${month}
        GROUP BY domain
        ORDER BY discovered DESC
        LIMIT 50
      `
    }

    // 해당 월 데이터가 없으면 전체 기간 기준으로 fallback
    let usedFallback = false
    let finalDomains = topDomains
    if (topDomains.length === 0) {
      console.log(`⚠️ ${currentStep} ${month} 기간 데이터 없음 — 전체 기간으로 fallback`)
      if (closedDomains.length > 0) {
        finalDomains = await query`
          SELECT domain, COUNT(*) as discovered
          FROM detection_results
          WHERE final_status = 'illegal'
            AND domain IS NOT NULL AND domain != ''
            AND LOWER(domain) != ALL(${closedDomains})
          GROUP BY domain
          ORDER BY discovered DESC
          LIMIT 50
        `
      } else {
        finalDomains = await query`
          SELECT domain, COUNT(*) as discovered
          FROM detection_results
          WHERE final_status = 'illegal'
            AND domain IS NOT NULL AND domain != ''
          GROUP BY domain
          ORDER BY discovered DESC
          LIMIT 50
        `
      }
      usedFallback = true
    }

    if (finalDomains.length === 0) {
      return c.json({ success: false, error: `${currentStep} 분석할 불법 도메인이 없습니다. detection_results 테이블에 illegal 상태의 결과가 있는지 확인하세요.` }, 400)
    }
    console.log(`✅ ${currentStep} ${finalDomains.length}개 도메인 조회 완료${usedFallback ? ' (전체 기간 fallback)' : ` (${month} 기준)`}`)

    const domainList = finalDomains.map((d: any) => d.domain)

    // 각 도메인의 site_type 조회
    const siteTypes = await query`
      SELECT LOWER(domain) as domain, COALESCE(site_type, 'unclassified') as site_type
      FROM sites
      WHERE type = 'illegal' AND LOWER(domain) = ANY(${domainList.map((d: string) => d.toLowerCase())})
    `
    const siteTypeMap: Record<string, string> = {}
    for (const st of siteTypes) {
      siteTypeMap[st.domain] = st.site_type
    }
    // domainList에 type_score + discovered 정보 추가
    const discoveredMap: Record<string, number> = {}
    for (const d of finalDomains) {
      discoveredMap[d.domain.toLowerCase()] = parseInt(d.discovered) || 0
    }
    const domainWithTypes = domainList.map((d: string) => {
      const siteType = siteTypeMap[d.toLowerCase()] || 'unclassified'
      const typeScore = TYPE_SCORE_MAP[siteType] || 0
      const discovered = discoveredMap[d.toLowerCase()] || 0
      return { domain: d, site_type: siteType, type_score: typeScore, discovered }
    })

    // 전월 데이터 조회
    const [prevYear, prevMonth] = month.split('-').map(Number)
    const prevMonthStr = prevMonth === 1
      ? `${prevYear - 1}-12`
      : `${prevYear}-${String(prevMonth - 1).padStart(2, '0')}`

    const prevReport = await query`
      SELECT id FROM domain_analysis_reports 
      WHERE analysis_month = ${prevMonthStr} AND status = 'completed'
    `
    let previousData: DomainAnalysisResult[] | null = null
    if (prevReport.length > 0) {
      const prevResults = await query`
        SELECT * FROM domain_analysis_results WHERE report_id = ${prevReport[0].id} ORDER BY rank
      `
      if (prevResults.length > 0) {
        previousData = prevResults.map((r: any) => ({
          rank: r.rank,
          site_url: r.domain,
          threat_score: r.threat_score ? parseFloat(r.threat_score) : null,
          global_rank: r.global_rank,
          total_visits: r.total_visits ? parseInt(r.total_visits) : null,
          unique_visitors: r.unique_visitors ? parseInt(r.unique_visitors) : null,
          bounce_rate: r.bounce_rate ? parseFloat(r.bounce_rate) : null,
          discovered: r.discovered ? parseInt(r.discovered) : null,
          visits_change_mom: r.visits_change_mom ? parseFloat(r.visits_change_mom) : null,
          rank_change_mom: r.rank_change_mom,
          size_score: r.size_score ? parseFloat(r.size_score) : null,
          growth_score: r.growth_score ? parseFloat(r.growth_score) : null,
          type_score: r.type_score ? parseFloat(r.type_score) : null,
          site_type: r.site_type || null,
          traffic_analysis: r.traffic_analysis || null,
          traffic_analysis_detail: r.traffic_analysis_detail || null,
          recommendation: r.recommendation,
          recommendation_detail: r.recommendation_detail || null,
        }))
      }
    }
    console.log(`✅ ${currentStep} 전월(${prevMonthStr}) 데이터: ${previousData ? previousData.length + '건' : '없음'}`)

    // 프롬프트 생성
    currentStep = '[5/6 Manus Task 생성]'
    const prompt = buildAnalysisPrompt(domainWithTypes, previousData, month)
    console.log(`📋 ${currentStep} 프롬프트 생성 완료 (${prompt.length}자), Manus API 호출 중...`)

    // Manus Task 생성
    const task = await createAnalysisTask(prompt)
    if (!task) {
      return c.json({ success: false, error: `${currentStep} Manus Task 생성 실패 — MANUS_API_KEY가 설정되지 않았거나 Manus API가 응답하지 않습니다. 환경변수를 확인하세요.` }, 500)
    }
    console.log(`✅ ${currentStep} task_id: ${task.task_id}`)

    // DB에 리포트 레코드 생성/업데이트
    currentStep = '[6/6 DB 리포트 저장]'
    let reportId: number
    if (existing.length > 0) {
      // failed 상태 레코드 업데이트
      await query`
        UPDATE domain_analysis_reports SET
          status = 'running',
          manus_task_id = ${task.task_id},
          total_domains = ${domainList.length},
          error_message = NULL,
          created_at = NOW()
        WHERE analysis_month = ${month}
      `
      reportId = existing[0].id
    } else {
      const inserted = await query`
        INSERT INTO domain_analysis_reports (analysis_month, status, manus_task_id, total_domains)
        VALUES (${month}, 'running', ${task.task_id}, ${domainList.length})
        RETURNING id
      `
      reportId = inserted[0].id
    }

    domainAnalysisRunning[month] = true
    console.log(`✅ ${currentStep} report_id: ${reportId}, 분석 시작`)

    return c.json({
      success: true,
      data: {
        report_id: reportId,
        analysis_month: month,
        status: 'running',
        manus_task_id: task.task_id,
        total_domains: domainList.length,
      }
    })
  } catch (error: any) {
    const errMsg = `${currentStep} 예기치 않은 오류: ${error.message || error}`
    console.error(`❌ Domain analysis run error at ${currentStep}:`, error)
    if (month) domainAnalysisRunning[month] = false
    return c.json({ success: false, error: errMsg }, 500)
  }
})

// GET /api/domain-analysis/status/:month - 상태 조회 (폴링용)
app.get('/api/domain-analysis/status/:month', async (c) => {
  try {
    await ensureDbMigration()
    const month = c.req.param('month')

    const reports = await query`
      SELECT * FROM domain_analysis_reports WHERE analysis_month = ${month}
    `
    if (reports.length === 0) {
      return c.json({ success: true, data: null })
    }

    const report = reports[0]
    let manusStatus: string | null = null

    // running 상태이면 Manus에서 실시간 상태 확인
    if (report.status === 'running' && report.manus_task_id) {
      const taskStatus = await getAnalysisTaskStatus(report.manus_task_id)
      if (taskStatus) {
        manusStatus = taskStatus.status

        // Manus가 완료/실패 시 DB 업데이트
        if (taskStatus.status === 'completed') {
          // 결과 파싱 후 DB 저장은 process-result API에서 처리
          manusStatus = 'completed'
        } else if (taskStatus.status === 'failed') {
          await query`
            UPDATE domain_analysis_reports SET
              status = 'failed',
              error_message = ${taskStatus.error || 'Manus Task 실패'},
              completed_at = NOW()
            WHERE id = ${report.id}
          `
          domainAnalysisRunning[month] = false
        }
      }
    }

    return c.json({
      success: true,
      data: {
        report_id: report.id,
        analysis_month: report.analysis_month,
        status: report.status,
        manus_task_id: report.manus_task_id,
        manus_status: manusStatus,
        total_domains: report.total_domains,
        created_at: report.created_at,
        completed_at: report.completed_at,
        error_message: report.error_message,
      }
    })
  } catch (error: any) {
    console.error('Domain analysis status error:', error)
    return c.json({ success: false, error: `[상태 조회] 오류: ${error.message || error}` }, 500)
  }
})

// POST /api/domain-analysis/process-result - Manus 완료 후 결과 파싱/저장
app.post('/api/domain-analysis/process-result', async (c) => {
  let currentStep = '[초기화]'
  let month = ''
  let reportId: number | null = null

  try {
    await ensureDbMigration()
    currentStep = '[요청 파싱]'
    const body = await c.req.json().catch(() => ({}))
    month = body.month

    if (!month) {
      return c.json({ success: false, error: `${currentStep} month 파라미터가 필요합니다.` }, 400)
    }

    currentStep = '[DB 리포트 조회]'
    const reports = await query`
      SELECT * FROM domain_analysis_reports WHERE analysis_month = ${month}
    `
    if (reports.length === 0) {
      return c.json({ success: false, error: `${currentStep} 해당 월(${month})의 리포트가 없습니다.` }, 404)
    }

    const report = reports[0]
    reportId = report.id
    if (!report.manus_task_id) {
      return c.json({ success: false, error: `${currentStep} Manus Task ID가 없습니다. (report_id: ${report.id})` }, 400)
    }

    // Step 1: Manus Task 상태 확인
    currentStep = '[1/5 Manus 상태 조회]'
    console.log(`📋 ${currentStep} task_id: ${report.manus_task_id}`)
    const taskStatus = await getAnalysisTaskStatus(report.manus_task_id)
    if (!taskStatus) {
      const errMsg = `${currentStep} Manus API 응답 없음 (task_id: ${report.manus_task_id}). API_KEY 또는 네트워크를 확인하세요.`
      await query`UPDATE domain_analysis_reports SET status = 'failed', error_message = ${errMsg}, completed_at = NOW() WHERE id = ${report.id}`
      domainAnalysisRunning[month] = false
      return c.json({ success: false, error: errMsg }, 500)
    }
    if (taskStatus.status !== 'completed') {
      return c.json({ 
        success: false, 
        error: `${currentStep} Manus Task 미완료 (상태: ${taskStatus.status}, task_id: ${report.manus_task_id})` 
      }, 400)
    }

    // Step 2: Manus 응답 파싱
    currentStep = '[2/5 Manus 응답 파싱]'
    console.log(`📋 ${currentStep} output messages: ${taskStatus.output?.length || 0}개`)
    const { priorityList, reportMarkdown } = await processManusResult(taskStatus.output || [])

    if (priorityList.length === 0) {
      const errMsg = `${currentStep} priority_list를 파싱할 수 없습니다. Manus 출력 메시지 ${taskStatus.output?.length || 0}개를 확인했으나 유효한 JSON 배열을 찾지 못했습니다. Manus 콘솔에서 task_id: ${report.manus_task_id}의 출력을 확인하세요.`
      await query`UPDATE domain_analysis_reports SET status = 'failed', error_message = ${errMsg}, completed_at = NOW() WHERE id = ${report.id}`
      domainAnalysisRunning[month] = false
      return c.json({ success: false, error: errMsg }, 500)
    }
    console.log(`✅ ${currentStep} priority_list: ${priorityList.length}개, report: ${reportMarkdown ? reportMarkdown.length + '자' : '없음'}`)

    // Step 3: 기존 결과 삭제 + DB 저장
    currentStep = '[3/5 DB 결과 저장]'
    console.log(`📋 ${currentStep} ${priorityList.length}건 INSERT 시작`)
    await query`DELETE FROM domain_analysis_results WHERE report_id = ${report.id}`

    // 디버깅: 첫 번째 항목의 원본 키 확인 (마누스 출력 필드명 진단)
    if (priorityList.length > 0) {
      const firstRaw = priorityList[0]
      console.log(`📋 ${currentStep} 첫 항목 필드 확인: site_url=${firstRaw.site_url}, total_visits=${firstRaw.total_visits}, unique_visitors=${firstRaw.unique_visitors}, bounce_rate=${firstRaw.bounce_rate}, global_rank=${firstRaw.global_rank}`)
    }

    let savedCount = 0
    for (const rawItem of priorityList) {
      // 안전장치: normalizeManusItem 재적용 (processManusResult에서 이미 정규화되었으나 파일 다운로드 경로 대비)
      const item = normalizeManusItem(rawItem)
      try {
        await query`
          INSERT INTO domain_analysis_results (
            report_id, rank, domain, threat_score,
            global_rank, total_visits,
            unique_visitors, bounce_rate,
            discovered, visits_change_mom, rank_change_mom,
            size_score, growth_score, type_score, site_type,
            traffic_analysis, traffic_analysis_detail,
            recommendation, recommendation_detail
          ) VALUES (
            ${report.id}, ${item.rank}, ${item.site_url}, ${item.threat_score},
            ${item.global_rank}, ${item.total_visits},
            ${item.unique_visitors}, ${item.bounce_rate},
            ${item.discovered}, ${item.visits_change_mom}, ${item.rank_change_mom},
            ${item.size_score}, ${item.growth_score}, ${item.type_score}, ${item.site_type},
            ${item.traffic_analysis}, ${item.traffic_analysis_detail},
            ${item.recommendation}, ${item.recommendation_detail}
          )
        `
        savedCount++
      } catch (insertErr: any) {
        console.error(`⚠️ ${currentStep} INSERT 실패 (rank: ${item.rank}, domain: ${item.site_url}):`, insertErr.message)
        console.error(`   INSERT 값 디버그: threat_score=${item.threat_score}, total_visits=${item.total_visits}, unique_visitors=${item.unique_visitors}, bounce_rate=${item.bounce_rate}, visits_change_mom=${item.visits_change_mom}`)
        // 개별 INSERT 실패는 건너뛰고 계속 진행
      }
    }
    console.log(`✅ ${currentStep} ${savedCount}/${priorityList.length}건 저장 완료`)

    if (savedCount === 0) {
      const errMsg = `${currentStep} 모든 결과 INSERT가 실패했습니다. DB 스키마를 확인하세요.`
      await query`UPDATE domain_analysis_reports SET status = 'failed', error_message = ${errMsg}, completed_at = NOW() WHERE id = ${report.id}`
      domainAnalysisRunning[month] = false
      return c.json({ success: false, error: errMsg }, 500)
    }

    // Step 4: 보고서 마크다운 저장
    currentStep = '[4/5 보고서 저장]'
    let reportBlobUrl: string | null = null
    if (reportMarkdown) {
      try {
        const { put } = await import('@vercel/blob')
        const blob = await put(
          `domain-analysis/${month}/report.md`,
          reportMarkdown,
          { access: 'public', addRandomSuffix: false }
        )
        reportBlobUrl = blob.url
        console.log(`✅ ${currentStep} Blob 업로드: ${reportBlobUrl}`)
      } catch (blobError: any) {
        console.warn(`⚠️ ${currentStep} Blob 업로드 실패 (DB 백업으로 대체): ${blobError.message}`)
        // Blob 실패는 치명적이지 않음 — DB에 마크다운 백업 저장
      }
    } else {
      console.warn(`⚠️ ${currentStep} Manus가 보고서 마크다운을 생성하지 않았습니다.`)
    }

    // Step 5: 리포트 상태 업데이트
    currentStep = '[5/5 리포트 완료 처리]'
    await query`
      UPDATE domain_analysis_reports SET
        status = 'completed',
        report_blob_url = ${reportBlobUrl},
        report_markdown = ${reportMarkdown || null},
        completed_at = NOW(),
        error_message = NULL
      WHERE id = ${report.id}
    `

    domainAnalysisRunning[month] = false
    console.log(`✅ ${currentStep} 월간 도메인 분석 완료 (${month}, ${savedCount}건)`)

    return c.json({
      success: true,
      data: {
        report_id: report.id,
        results_count: savedCount,
        total_parsed: priorityList.length,
        has_report: !!reportMarkdown,
        report_blob_url: reportBlobUrl,
      }
    })
  } catch (error: any) {
    const errMsg = `${currentStep} 예기치 않은 오류: ${error.message || error}`
    console.error(`❌ Domain analysis process-result error at ${currentStep}:`, error)
    // DB에 에러 기록 시도
    if (month && reportId) {
      try {
        await query`UPDATE domain_analysis_reports SET status = 'failed', error_message = ${errMsg}, completed_at = NOW() WHERE id = ${reportId}`
      } catch { /* 무시 */ }
    }
    if (month) domainAnalysisRunning[month] = false
    return c.json({ success: false, error: errMsg }, 500)
  }
})

// GET /api/domain-analysis/months - 사용 가능한 월 목록
app.get('/api/domain-analysis/months', async (c) => {
  try {
    await ensureDbMigration()
    const reports = await query`
      SELECT analysis_month, status FROM domain_analysis_reports
      ORDER BY analysis_month DESC
    `
    return c.json({
      success: true,
      months: reports.map((r: any) => ({
        month: r.analysis_month,
        status: r.status,
      }))
    })
  } catch (error) {
    console.error('Domain analysis months error:', error)
    return c.json({ success: false, error: 'Failed to get months' }, 500)
  }
})

// GET /api/domain-analysis/:month - 분석 결과 조회
app.get('/api/domain-analysis/:month', async (c) => {
  try {
    await ensureDbMigration()
    const month = c.req.param('month')

    // month 형식 검증 (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: '월 형식이 올바르지 않습니다. (YYYY-MM)' }, 400)
    }

    const reports = await query`
      SELECT * FROM domain_analysis_reports WHERE analysis_month = ${month}
    `
    if (reports.length === 0) {
      return c.json({ success: true, data: null })
    }

    const report = reports[0]
    let results: any[] = []
    if (report.status === 'completed') {
      results = await query`
        SELECT * FROM domain_analysis_results 
        WHERE report_id = ${report.id} 
        ORDER BY rank ASC
      `
      // JSON 문자열 필드를 배열로 파싱
      results = results.map((r: any) => ({
        ...r,
        threat_score: r.threat_score ? parseFloat(r.threat_score) : null,
        visits_change_mom: r.visits_change_mom ? parseFloat(r.visits_change_mom) : null,
        total_visits: r.total_visits ? parseInt(r.total_visits) : null,
        unique_visitors: r.unique_visitors ? parseInt(r.unique_visitors) : null,
        bounce_rate: r.bounce_rate ? parseFloat(r.bounce_rate) : null,
        discovered: r.discovered ? parseInt(r.discovered) : null,
        size_score: r.size_score ? parseFloat(r.size_score) : null,
        growth_score: r.growth_score ? parseFloat(r.growth_score) : null,
        type_score: r.type_score ? parseFloat(r.type_score) : null,
        site_type: r.site_type || 'unclassified',
        traffic_analysis: r.traffic_analysis || null,
        traffic_analysis_detail: r.traffic_analysis_detail || null,
        recommendation_detail: r.recommendation_detail || null,
      }))
    }

    return c.json({
      success: true,
      data: {
        report: {
          id: report.id,
          analysis_month: report.analysis_month,
          status: report.status,
          total_domains: report.total_domains,
          report_blob_url: report.report_blob_url,
          report_markdown: report.report_markdown,
          created_at: report.created_at,
          completed_at: report.completed_at,
          error_message: report.error_message,
        },
        results,
      }
    })
  } catch (error) {
    console.error('Domain analysis result error:', error)
    return c.json({ success: false, error: 'Failed to get analysis result' }, 500)
  }
})

// POST /api/domain-analysis/rerun - 재실행
app.post('/api/domain-analysis/rerun', async (c) => {
  try {
    await ensureDbMigration()
    const body = await c.req.json().catch(() => ({}))
    const month = body.month

    if (!month) {
      return c.json({ success: false, error: 'month 파라미터가 필요합니다.' }, 400)
    }

    // 기존 보고서를 failed로 변경하여 재실행 가능하게
    await query`
      UPDATE domain_analysis_reports SET status = 'failed', error_message = '사용자 재실행 요청'
      WHERE analysis_month = ${month}
    `

    domainAnalysisRunning[month] = false

    // run API로 위임 (body에 month 포함)
    // 직접 같은 로직 호출 대신 클라이언트가 run을 다시 호출하도록 안내
    return c.json({
      success: true,
      message: '재실행 준비 완료. /api/domain-analysis/run을 호출하세요.',
      month,
    })
  } catch (error) {
    console.error('Domain analysis rerun error:', error)
    return c.json({ success: false, error: 'Failed to prepare rerun' }, 500)
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
  <meta name="robots" content="noindex, nofollow">
  <title>Jobdori - 리디 저작권 침해 모니터링</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    // 현재 로그인한 사용자 정보 (페이지 로드 시 API로 가져옴)
    window.currentUser = null;
  </script>
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
    <div class="bg-white rounded-lg shadow-md p-4 md:p-6 mb-4 md:mb-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div class="flex items-center gap-3">
          <svg width="60" height="24" viewBox="0 0 60 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0">
            <text x="0" y="20" font-family="Arial Black, sans-serif" font-size="22" font-weight="900" fill="#1E9EF4">RIDI</text>
          </svg>
          <div>
            <h1 class="text-xl md:text-2xl font-bold text-gray-800">Jobdori</h1>
            <p class="text-gray-600 text-xs md:text-sm hidden sm:block">리디 저작권 침해 모니터링 시스템</p>
          </div>
        </div>
        <div class="flex gap-2 md:gap-3">
          <button onclick="openTitlesModal()" class="flex-1 md:flex-none bg-purple-500 hover:bg-purple-600 text-white px-3 md:px-4 py-2 rounded-lg transition text-sm md:text-base">
            <i class="fas fa-list-alt md:mr-2"></i><span class="hidden md:inline">작품 변경</span>
          </button>
          <button onclick="openUsersModal()" class="admin-only flex-1 md:flex-none bg-green-500 hover:bg-green-600 text-white px-3 md:px-4 py-2 rounded-lg transition text-sm md:text-base">
            <i class="fas fa-users md:mr-2"></i><span class="hidden md:inline">계정 관리</span>
          </button>
          <button onclick="handleLogout()" class="flex-1 md:flex-none bg-gray-500 hover:bg-gray-600 text-white px-3 md:px-4 py-2 rounded-lg transition text-sm md:text-base">
            <i class="fas fa-sign-out-alt md:mr-2"></i><span class="hidden md:inline">로그아웃</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 탭 메뉴 -->
    <div class="bg-white rounded-lg shadow-md mb-4 md:mb-6">
      <div class="flex border-b overflow-x-auto">
        <button id="tab-dashboard" onclick="switchTab('dashboard')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 tab-active text-sm md:text-base">
          <i class="fas fa-chart-line md:mr-2"></i><span class="hidden md:inline">대시보드</span>
        </button>
        <button id="tab-pending" onclick="switchTab('pending')" class="admin-only flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-clock md:mr-2"></i><span class="hidden md:inline">승인 대기</span>
          <span id="pending-badge" class="ml-1 md:ml-2 bg-red-500 text-white text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full">0</span>
        </button>
        <button id="tab-sessions" onclick="switchTab('sessions')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-history md:mr-2"></i><span class="hidden md:inline">모니터링 회차</span>
        </button>
        <button id="tab-report-tracking" onclick="switchTab('report-tracking')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-file-alt md:mr-2"></i><span class="hidden md:inline">신고결과 추적</span>
        </button>
        <button id="tab-sites" onclick="switchTab('sites')" class="admin-only flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-globe md:mr-2"></i><span class="hidden md:inline">사이트 목록</span>
        </button>
        <button id="tab-title-stats" onclick="switchTab('title-stats')" class="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 text-gray-600 hover:text-blue-600 text-sm md:text-base">
          <i class="fas fa-book md:mr-2"></i><span class="hidden md:inline">작품별 통계</span>
        </button>
      </div>
    </div>

    <!-- 대시보드 탭 -->
    <div id="content-dashboard" class="tab-content">
      <div class="bg-white rounded-lg shadow-md p-4 md:p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 md:mb-6">
          <h2 class="text-lg md:text-xl font-bold">월간 모니터링 현황</h2>
          <select id="month-select" onchange="loadDashboardData()" class="border rounded-lg px-3 py-2 text-sm md:text-base">
            <option value="">로딩 중...</option>
          </select>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
          <div class="bg-blue-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-blue-600" id="dash-discovered">0</div>
            <div class="text-gray-600 text-xs md:text-base">발견</div>
          </div>
          <div class="bg-yellow-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-yellow-600" id="dash-reported">0</div>
            <div class="text-gray-600 text-xs md:text-base">신고</div>
          </div>
          <div class="bg-green-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-green-600" id="dash-blocked">0</div>
            <div class="text-gray-600 text-xs md:text-base">차단</div>
          </div>
          <div class="bg-purple-50 p-3 md:p-4 rounded-lg text-center">
            <div class="text-xl md:text-3xl font-bold text-purple-600" id="dash-blockrate">0%</div>
            <div class="text-gray-600 text-xs md:text-base">차단율</div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div>
            <div class="flex justify-between items-center mb-3">
              <h3 class="font-bold text-sm md:text-base"><i class="fas fa-fire text-red-500 mr-2"></i>신고 많은 작품 Top 5</h3>
              <button onclick="openAllTitlesModal()" class="text-xs md:text-sm text-blue-500 hover:text-blue-700">전체보기 <i class="fas fa-arrow-right"></i></button>
            </div>
            <div id="top-contents" class="space-y-2 text-sm">로딩 중...</div>
          </div>
          <div>
            <h3 class="font-bold mb-3 text-sm md:text-base"><i class="fas fa-skull-crossbones text-red-500 mr-2"></i>신고 많은 도메인 Top 5</h3>
            <div id="top-domains" class="space-y-2 text-sm">로딩 중...</div>
          </div>
        </div>
      </div>
      
      <!-- Manta 검색 순위 -->
      <div class="bg-white rounded-lg shadow-md p-4 md:p-6 mt-4 md:mt-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h2 class="text-lg md:text-xl font-bold"><i class="fas fa-chart-line text-blue-500 mr-2"></i>Manta 검색 순위</h2>
          <span id="manta-updated" class="text-xs md:text-sm text-gray-500"></span>
        </div>
        <p class="text-xs md:text-sm text-gray-500 mb-4">작품명만 검색 시 manta.net 순위 (P1-1 = 페이지1, 1위)</p>
        <div id="manta-rankings" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">로딩 중...</div>
      </div>

    </div>

    <!-- 승인 대기 탭 -->
    <div id="content-pending" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-4 md:p-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 class="text-lg md:text-xl font-bold"><i class="fas fa-clock text-yellow-500 mr-2"></i>승인 대기 목록</h2>
        </div>
        
        <!-- 필터 및 일괄 처리 버튼 -->
        <div id="bulk-actions" class="hidden flex flex-col sm:flex-row sm:items-center gap-3 mb-4 pb-4 border-b">
          <div class="flex flex-wrap gap-2">
            <span class="text-sm text-gray-600 mr-2">필터:</span>
            <button onclick="filterPending('all')" class="pending-filter-btn px-3 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300" data-filter="all">전체</button>
            <button onclick="filterPending('likely_illegal')" class="pending-filter-btn px-3 py-1 rounded text-sm bg-red-100 hover:bg-red-200 text-red-700" data-filter="likely_illegal">🔴 불법</button>
            <button onclick="filterPending('likely_legal')" class="pending-filter-btn px-3 py-1 rounded text-sm bg-green-100 hover:bg-green-200 text-green-700" data-filter="likely_legal">🟢 합법</button>
            <button onclick="filterPending('uncertain')" class="pending-filter-btn px-3 py-1 rounded text-sm bg-yellow-100 hover:bg-yellow-200 text-yellow-700" data-filter="uncertain">🟡 불확실</button>
          </div>
          <div class="flex flex-wrap gap-2 items-center sm:ml-auto">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" id="select-all-pending" onchange="toggleSelectAll()" class="w-4 h-4 cursor-pointer">
              <span>전체 선택</span>
            </label>
            <button onclick="bulkReview('approve')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm">
              <i class="fas fa-ban mr-1"></i>일괄 불법
            </button>
            <button onclick="bulkReview('reject')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm">
              <i class="fas fa-check mr-1"></i>일괄 합법
            </button>
          </div>
        </div>
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
      <div id="session-detail" class="hidden bg-white rounded-lg shadow-md p-4 md:p-6">
        <!-- 헤더 -->
        <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-4">
          <h3 class="text-base md:text-lg font-bold truncate">
            <i class="fas fa-table text-blue-500 mr-2"></i>
            <span class="hidden md:inline">세션 상세 결과: </span>
            <span id="session-detail-title"></span>
          </h3>
          <div class="flex gap-2 flex-wrap">
            <button onclick="copyAllIllegalUrls()" class="bg-red-500 hover:bg-red-600 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm">
              <i class="fas fa-copy mr-1"></i><span class="hidden sm:inline">불법 URL </span>복사
            </button>
            <button onclick="downloadSessionReport()" class="bg-green-500 hover:bg-green-600 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm">
              <i class="fas fa-download mr-1"></i><span class="hidden sm:inline">엑셀 </span>다운로드
            </button>
            <button onclick="closeSessionDetail()" class="text-gray-500 hover:text-gray-700 px-2">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>
        
        <!-- 통계 요약 바 -->
        <div id="session-stats-bar" class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-center text-xs md:text-sm"></div>
        
        <!-- 필터 -->
        <div class="flex gap-2 md:gap-4 mb-2 items-center flex-wrap">
          <select id="session-title-filter" class="border rounded px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm flex-1 md:flex-none" onchange="loadSessionResults(); updateSessionMantaUrl()">
            <option value="all">모든 작품</option>
          </select>
          <select id="session-status-filter" class="border rounded px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm" onchange="loadSessionResults()">
            <option value="all">모든 상태</option>
            <option value="illegal">불법</option>
            <option value="legal">합법</option>
            <option value="pending">대기</option>
          </select>
        </div>
        <!-- 선택한 작품의 Manta URL -->
        <div id="session-manta-url-container" class="mb-4 hidden">
          <div class="flex items-center gap-2 text-xs">
            <span class="text-gray-500">Manta:</span>
            <a id="session-manta-url-link" href="#" target="_blank" class="text-blue-500 hover:underline truncate max-w-[300px]"></a>
            <button onclick="copySessionMantaUrl()" class="text-gray-400 hover:text-blue-500" title="복사">
              <i class="fas fa-copy"></i>
            </button>
          </div>
        </div>
        
        <!-- 데스크톱 테이블 -->
        <div class="hidden md:block overflow-x-auto">
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
            <tbody id="session-results-desktop">
              <tr><td colspan="6" class="text-center py-4 text-gray-500">로딩 중...</td></tr>
            </tbody>
          </table>
        </div>
        <!-- 모바일 카드 뷰 -->
        <div id="session-results-mobile" class="md:hidden space-y-2">
          <div class="text-center py-4 text-gray-500">로딩 중...</div>
        </div>
        <div id="session-results-pagination" class="flex justify-center gap-2 mt-4"></div>
      </div>
    </div>

    <!-- 사이트 목록 탭 -->
    <div id="content-sites" class="tab-content hidden">
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-bold mb-4"><i class="fas fa-globe text-blue-500 mr-2"></i>사이트 목록</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div>
            <h3 class="font-bold text-orange-600 mb-3">
              <i class="fas fa-eye-slash mr-2"></i>신고 제외 URL (<span id="excluded-count">0</span>개)
            </h3>
            <div class="flex gap-2 mb-3">
              <input type="text" id="new-excluded-url" placeholder="신고 제외할 전체 URL 입력 (https://...)" 
                     class="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                     onkeypress="if(event.key==='Enter') addExcludedUrl()">
              <button onclick="addExcludedUrl()" class="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded text-sm">
                <i class="fas fa-plus"></i>
              </button>
            </div>
            <p class="text-xs text-gray-400 mb-2">
              <i class="fas fa-info-circle mr-1"></i>불법 사이트지만 신고해도 처리되지 않는 URL (예: 메인 페이지)
            </p>
            <div id="excluded-urls-list" class="max-h-72 overflow-y-auto border rounded p-3">로딩 중...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 작품별 통계 탭 -->
    <div id="content-title-stats" class="tab-content hidden">
      <div class="space-y-4">
        <!-- 상단: 작품별 신고/차단 통계 테이블 -->
        <div class="bg-white rounded-lg shadow-md p-4 md:p-6">
          <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
            <h3 class="text-lg font-bold"><i class="fas fa-table text-green-500 mr-2"></i>작품별 신고/차단 통계</h3>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm text-gray-600">기간:</span>
              <input type="date" id="stats-start-date" class="border rounded px-2 py-1 text-sm">
              <span class="text-gray-400">~</span>
              <input type="date" id="stats-end-date" class="border rounded px-2 py-1 text-sm">
              <button onclick="loadTitleStats()" class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm">
                <i class="fas fa-search mr-1"></i>조회
              </button>
              <button onclick="resetStatsDateFilter()" class="text-gray-500 hover:text-gray-700 text-sm">
                <i class="fas fa-undo mr-1"></i>전체
              </button>
            </div>
          </div>
          <div class="overflow-x-auto max-h-[40vh] overflow-y-auto">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-white">
                <tr class="bg-gray-50 border-b">
                  <th class="text-left py-2 px-3">작품명</th>
                  <th class="text-center py-2 px-3">발견</th>
                  <th class="text-center py-2 px-3">신고</th>
                  <th class="text-center py-2 px-3">차단</th>
                  <th class="text-center py-2 px-3">차단율</th>
                </tr>
              </thead>
              <tbody id="title-stats-table">
                <tr><td colspan="5" class="text-center py-8 text-gray-400">로딩 중...</td></tr>
              </tbody>
            </table>
          </div>
          <p class="text-xs text-gray-400 mt-3">
            <i class="fas fa-info-circle mr-1"></i>
            발견: 모니터링으로 수집된 불법 URL 수 | 신고: 발견 - 미신고 | 차단: 구글에서 차단된 URL 수
          </p>
        </div>
        
        <!-- 하단: Manta 검색 순위 변화 (작품목록 + 차트 통합) -->
        <div class="bg-white rounded-lg shadow-md p-4 md:p-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold"><i class="fas fa-chart-line text-blue-500 mr-2"></i>Manta 검색 순위 변화</h3>
            <button onclick="loadTitleSelectList()" class="text-blue-500 hover:text-blue-700 text-sm">
              <i class="fas fa-sync-alt mr-1"></i>새로고침
            </button>
          </div>
          
          <div class="flex flex-col md:flex-row gap-4">
            <!-- 좌측: 작품 목록 -->
            <div class="w-full md:w-56 lg:w-64 flex-shrink-0">
              <div class="border rounded-lg p-3">
                <h4 class="font-semibold text-sm text-gray-700 mb-2"><i class="fas fa-list mr-1"></i>작품 목록</h4>
                <!-- 검색 입력 -->
                <div class="relative mb-2">
                  <input type="text" id="title-search-input" placeholder="작품 검색..." 
                         class="w-full border rounded px-2 py-1.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                         oninput="filterTitleList()">
                  <i class="fas fa-search absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs"></i>
                </div>
                <!-- 작품 목록 -->
                <div id="title-stats-list" class="max-h-[35vh] overflow-y-auto space-y-0.5">
                  <div class="text-gray-400 text-sm text-center py-4">로딩 중...</div>
                </div>
              </div>
            </div>
            
            <!-- 우측: 순위 변화 차트 -->
            <div class="flex-1">
              <div id="title-stats-placeholder" class="text-center py-12 text-gray-400 border rounded-lg">
                <i class="fas fa-chart-line text-5xl mb-3"></i>
                <p class="text-base">좌측에서 작품을 선택하세요</p>
                <p class="text-sm mt-1">선택한 작품의 Manta 검색 순위 변화를 확인할 수 있습니다.</p>
              </div>
              <div id="title-stats-content" class="hidden">
                <div class="border rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="font-semibold text-sm"><i class="fas fa-chart-area mr-1 text-blue-500"></i><span id="selected-title-name"></span></h4>
                    <span class="text-xs text-gray-500">1위가 가장 좋음</span>
                  </div>
                  <div class="h-[35vh]">
                    <canvas id="ranking-history-chart"></canvas>
                  </div>
                  <p id="ranking-chart-empty" class="hidden text-center text-gray-400 py-8">순위 데이터가 없습니다.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 신고결과 추적 탭 -->
    <div id="content-report-tracking" class="tab-content hidden">
      <div class="flex flex-col lg:flex-row gap-4">
        <!-- 좌측: 회차 선택 및 업로드 -->
        <div class="w-full lg:w-72 flex-shrink-0">
          <div class="bg-white rounded-lg shadow-md p-4 sticky top-4">
            <h3 class="font-bold text-blue-600 mb-3"><i class="fas fa-calendar-alt mr-2"></i>모니터링 회차</h3>
            <select id="report-session-select" onchange="loadReportTracking()" class="w-full border rounded-lg px-3 py-2 text-sm mb-4">
              <option value="">회차 선택...</option>
            </select>
            
            <!-- 통계 카드 -->
            <div id="report-stats" class="space-y-2 mb-4">
              <div class="grid grid-cols-2 gap-2 text-center text-xs">
                <div class="bg-gray-50 p-2 rounded">
                  <div class="font-bold text-lg" id="rt-total">0</div>
                  <div class="text-gray-500">전체</div>
                </div>
                <div class="bg-green-50 p-2 rounded">
                  <div class="font-bold text-lg text-green-600" id="rt-blocked">0</div>
                  <div class="text-gray-500">차단</div>
                </div>
                <div class="bg-yellow-50 p-2 rounded">
                  <div class="font-bold text-lg text-yellow-600" id="rt-pending">0</div>
                  <div class="text-gray-500">대기 중</div>
                </div>
                <div class="bg-purple-50 p-2 rounded">
                  <div class="font-bold text-lg text-purple-600" id="rt-unreported">0</div>
                  <div class="text-gray-500">미신고</div>
                </div>
                <div class="bg-gray-100 p-2 rounded">
                  <div class="font-bold text-lg text-gray-600" id="rt-notfound">0</div>
                  <div class="text-gray-500">색인없음</div>
                </div>
                <div class="bg-red-50 p-2 rounded">
                  <div class="font-bold text-lg text-red-600" id="rt-rejected">0</div>
                  <div class="text-gray-500">거부</div>
                </div>
              </div>
            </div>
            
            <!-- URL 수동 추가 -->
            <div class="border-t pt-4">
              <h4 class="font-semibold text-sm mb-2"><i class="fas fa-plus-circle mr-1"></i>URL 수동 추가</h4>
              <select id="manual-title-select" class="w-full border rounded px-2 py-1.5 text-sm mb-2">
                <option value="">-- 작품 선택 --</option>
              </select>
              <div class="flex gap-1">
                <input type="text" id="manual-url-input" placeholder="https://..." class="flex-1 border rounded px-2 py-1.5 text-sm">
                <button onclick="addManualUrl()" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm">
                  <i class="fas fa-plus"></i>
                </button>
              </div>
              <p class="text-xs text-gray-400 mt-1">작품을 선택하고 불법 URL을 추가합니다.</p>
            </div>
            
            <!-- CSV 업로드 -->
            <div class="border-t pt-4 mt-4">
              <h4 class="font-semibold text-sm mb-2"><i class="fas fa-upload mr-1"></i>신고 결과 업로드</h4>
              <input type="text" id="report-id-input" placeholder="신고 ID (미입력시 파일명에서 자동추출)" class="w-full border rounded px-3 py-2 text-sm mb-2">
              <input type="file" id="csv-file-input" accept=".csv" class="hidden" onchange="handleCsvUpload()">
              
              <!-- 드래그앤드랍 영역 -->
              <div id="csv-drop-zone" 
                   class="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                   onclick="document.getElementById('csv-file-input').click()"
                   ondragover="handleDragOver(event)"
                   ondragleave="handleDragLeave(event)"
                   ondrop="handleFileDrop(event)">
                <i class="fas fa-cloud-upload-alt text-2xl text-gray-400 mb-2"></i>
                <p class="text-sm text-gray-500">CSV 파일을 여기에 드래그하거나</p>
                <p class="text-sm text-blue-500 font-medium">클릭하여 선택</p>
              </div>
              
              <p class="text-xs text-gray-400 mt-2">구글 신고 결과 CSV 파일(신고ID_Urls.csv)을 업로드하면 상태별로 자동 매칭합니다.</p>
            </div>
            
            <!-- 업로드 이력 -->
            <div class="border-t pt-4 mt-4">
              <h4 class="font-semibold text-sm mb-2"><i class="fas fa-history mr-1"></i>업로드 이력</h4>
              <div id="upload-history" class="max-h-32 overflow-y-auto text-xs space-y-1">
                <div class="text-gray-400 text-center py-2">이력 없음</div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 우측: URL 테이블 -->
        <div class="flex-1">
          <div class="bg-white rounded-lg shadow-md p-4">
            <!-- 필터 및 내보내기 -->
            <div class="flex flex-wrap gap-2 mb-4 justify-between items-center">
              <div class="flex gap-2">
                <select id="report-status-filter" onchange="loadReportTracking()" class="border rounded px-3 py-1 text-sm">
                  <option value="">전체 상태</option>
                  <option value="미신고">미신고</option>
                  <option value="차단">차단</option>
                  <option value="대기 중">대기 중</option>
                  <option value="색인없음">색인없음</option>
                  <option value="거부">거부</option>
                </select>
                <input type="text" id="report-url-search" placeholder="URL 검색..." class="border rounded px-3 py-1 text-sm w-40" onkeydown="if(event.key==='Enter') searchReportTracking()">
                <button onclick="searchReportTracking()" class="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm ml-1" title="검색">
                  <i class="fas fa-search"></i>
                </button>
              </div>
              <div class="flex gap-2">
                <button onclick="copyReportUrls()" class="text-sm text-blue-500 hover:text-blue-700">
                  <i class="fas fa-copy mr-1"></i>URL 복사
                </button>
                <button onclick="exportReportCsv()" class="text-sm text-green-500 hover:text-green-700">
                  <i class="fas fa-download mr-1"></i>CSV 내보내기
                </button>
              </div>
            </div>
            
            <!-- URL 테이블 -->
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-2 text-left">URL</th>
                    <th class="px-3 py-2 text-left w-28">도메인</th>
                    <th class="px-3 py-2 text-center w-24">상태</th>
                    <th class="px-3 py-2 text-left w-20">신고ID</th>
                    <th class="px-3 py-2 text-left w-36">사유</th>
                  </tr>
                </thead>
                <tbody id="report-tracking-table">
                  <tr><td colspan="5" class="text-center py-8 text-gray-400">회차를 선택하세요</td></tr>
                </tbody>
              </table>
            </div>
            
            <!-- 페이지네이션 -->
            <div id="report-pagination" class="flex justify-center gap-2 mt-4 hidden">
              <button onclick="loadReportTracking(currentReportPage - 1)" class="px-3 py-1 border rounded text-sm" id="rt-prev-btn">이전</button>
              <span id="rt-page-info" class="px-3 py-1 text-sm">1 / 1</span>
              <button onclick="loadReportTracking(currentReportPage + 1)" class="px-3 py-1 border rounded text-sm" id="rt-next-btn">다음</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 계정 관리 모달 (관리자 전용) -->
  <div id="users-modal" class="admin-only hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[95vh] md:max-h-[85vh] overflow-hidden">
      <div class="bg-green-500 text-white px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <h2 class="text-base md:text-xl font-bold"><i class="fas fa-users mr-2"></i>계정 관리</h2>
        <button onclick="closeUsersModal()" class="text-white hover:text-gray-200 p-1">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(95vh-120px)] md:max-h-[calc(85vh-80px)]">
        <!-- 사용자 목록 -->
        <div class="mb-4">
          <h3 class="font-bold mb-2 text-green-600 text-sm md:text-base">
            <i class="fas fa-list mr-2"></i>등록된 사용자 (<span id="users-count">0</span>명)
          </h3>
          <div id="users-list" class="h-48 md:h-64 overflow-y-auto border rounded p-2 md:p-3 text-sm">로딩 중...</div>
        </div>
        <!-- 새 사용자 추가 -->
        <div class="bg-gray-50 p-3 md:p-4 rounded-lg">
          <h3 class="font-bold mb-2 md:mb-3 text-sm md:text-base"><i class="fas fa-user-plus mr-2"></i>새 사용자 추가</h3>
          <div class="flex flex-col gap-2 md:gap-3">
            <input type="text" id="new-username" placeholder="아이디 (3~50자)" class="border rounded px-3 py-2 text-sm md:text-base">
            <input type="password" id="new-password" placeholder="비밀번호 (6자 이상)" class="border rounded px-3 py-2 text-sm md:text-base">
            <select id="new-role" class="border rounded px-3 py-2 text-sm md:text-base">
              <option value="user">일반 사용자 (user)</option>
              <option value="admin">관리자 (admin)</option>
            </select>
            <button onclick="addUser()" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition text-sm md:text-base">
              <i class="fas fa-plus mr-2"></i>추가
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 작품 변경 모달 -->
  <div id="titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[95vh] md:max-h-[85vh] overflow-hidden">
      <div class="bg-purple-500 text-white px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <h2 class="text-base md:text-xl font-bold"><i class="fas fa-list-alt mr-2"></i><span class="hidden sm:inline">모니터링 대상 </span>작품 관리</h2>
        <button onclick="closeTitlesModal()" class="text-white hover:text-gray-200 p-1">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(95vh-120px)] md:max-h-[calc(85vh-80px)]">
        <!-- 2분할 레이아웃 (모바일에서 1열) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-4">
          <!-- 현재 모니터링 대상 -->
          <div>
            <h3 class="font-bold mb-2 md:mb-3 text-purple-600 text-sm md:text-base">
              <i class="fas fa-play-circle mr-2"></i>현재 대상 (<span id="titles-count">0</span>개)
            </h3>
            <div id="current-titles-list" class="h-48 md:h-72 overflow-y-auto border rounded p-2 md:p-3 text-sm">로딩 중...</div>
          </div>
          <!-- 이전 모니터링 대상 -->
          <div>
            <h3 class="font-bold mb-2 md:mb-3 text-gray-500 text-sm md:text-base">
              <i class="fas fa-history mr-2"></i>이전 대상 (<span id="history-titles-count">0</span>개)
            </h3>
            <div id="history-titles-list" class="h-48 md:h-72 overflow-y-auto border rounded p-2 md:p-3 text-gray-500 text-sm">로딩 중...</div>
          </div>
        </div>
        <!-- 새 작품 추가 (하단) -->
        <div class="border-t pt-3 md:pt-4">
          <div class="flex flex-col sm:flex-row gap-2">
            <input type="text" id="new-title-input" placeholder="새 작품명..." 
                   class="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
            <input type="text" id="new-manta-url-input" placeholder="Manta URL (선택)" 
                   class="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                   onkeypress="if(event.key==='Enter') addNewTitle()">
            <button onclick="addNewTitle()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 md:px-6 py-2 rounded-lg text-sm whitespace-nowrap">
              <i class="fas fa-plus"></i><span class="hidden sm:inline ml-2">추가</span>
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-1">예: https://manta.net/en/series/작품명?seriesId=1234</p>
        </div>
      </div>
    </div>
  </div>

  <!-- 비공식 타이틀 편집 모달 -->
  <div id="unofficial-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md">
      <div class="bg-yellow-500 text-white px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <h2 class="text-base md:text-lg font-bold"><i class="fas fa-language mr-2"></i>비공식 타이틀</h2>
        <button onclick="closeUnofficialModal()" class="text-white hover:text-gray-200 p-1">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-4 md:p-6">
        <p class="text-sm text-gray-600 mb-2">
          <strong id="unofficial-modal-title" class="text-purple-600"></strong>
        </p>
        <p class="text-xs text-gray-500 mb-3">
          비공식/번역 타이틀을 한 줄에 하나씩 입력하세요. (최대 5개)<br>
          예: 한국어 제목, 일본어 제목, 팬 번역명 등
        </p>
        <textarea id="unofficial-titles-input" 
                  class="w-full border rounded-lg px-3 py-2 text-sm h-32 focus:outline-none focus:ring-2 focus:ring-yellow-500" 
                  placeholder="비공식 타이틀 (줄바꿈으로 구분)"></textarea>
        <div class="flex justify-end gap-2 mt-4">
          <button onclick="closeUnofficialModal()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100">취소</button>
          <button onclick="saveUnofficialTitles()" class="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm">
            <i class="fas fa-save mr-1"></i>저장
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 전체보기 모달 (작품별 월별 통계) -->
  <div id="all-titles-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[95vh] md:max-h-[85vh] overflow-hidden">
      <div class="bg-red-500 text-white px-4 md:px-6 py-3 md:py-4 flex justify-between items-center">
        <h2 class="text-base md:text-xl font-bold"><i class="fas fa-fire mr-2"></i><span class="hidden sm:inline">불법 URL 통계 - </span><span id="all-titles-month"></span></h2>
        <button onclick="closeAllTitlesModal()" class="text-white hover:text-gray-200 p-1">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="p-4 md:p-6 overflow-y-auto max-h-[calc(95vh-60px)] md:max-h-[calc(85vh-80px)]">
        <div id="all-titles-list" class="space-y-2">로딩 중...</div>
      </div>
    </div>
  </div>

  <script>
    let currentTab = 'dashboard';
    let currentSessionId = null;
    let currentPage = 1;
    
    // ===== 계정 관리 (관리자 전용) =====
    function openUsersModal() {
      if (!window.currentUser || window.currentUser.role !== 'admin') {
        alert('관리자 권한이 필요합니다.');
        return;
      }
      document.getElementById('users-modal').classList.remove('hidden');
      loadUsers();
    }
    
    function closeUsersModal() {
      document.getElementById('users-modal').classList.add('hidden');
    }
    
    async function loadUsers() {
      try {
        const data = await fetchAPI('/api/users');
        if (!data.success) {
          document.getElementById('users-list').innerHTML = '<div class="text-red-500">오류: ' + (data.error || '불러오기 실패') + '</div>';
          return;
        }
        const users = data.users || [];
        document.getElementById('users-count').textContent = users.length;
        
        if (users.length === 0) {
          document.getElementById('users-list').innerHTML = '<div class="text-gray-500">등록된 사용자가 없습니다.</div>';
          return;
        }
        
        document.getElementById('users-list').innerHTML = users.map(u => 
          '<div class="flex items-center justify-between p-2 bg-gray-50 rounded mb-2">' +
            '<div>' +
              '<span class="font-medium">' + u.username + '</span>' +
              '<span class="ml-2 text-xs px-2 py-1 rounded ' + (u.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600') + '">' + u.role + '</span>' +
              (u.is_active ? '' : '<span class="ml-2 text-xs px-2 py-1 rounded bg-red-100 text-red-700">비활성</span>') +
            '</div>' +
            '<div class="flex gap-2">' +
              '<button onclick="toggleUserActive(' + u.id + ', ' + !u.is_active + ')" class="text-xs px-2 py-1 rounded ' + (u.is_active ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-700' : 'bg-green-100 hover:bg-green-200 text-green-700') + '">' +
                (u.is_active ? '비활성화' : '활성화') +
              '</button>' +
              '<button onclick="deleteUser(' + u.id + ', \\'' + u.username + '\\')" class="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700">삭제</button>' +
            '</div>' +
          '</div>'
        ).join('');
      } catch (e) {
        document.getElementById('users-list').innerHTML = '<div class="text-red-500">오류: ' + e.message + '</div>';
      }
    }
    
    async function addUser() {
      const username = document.getElementById('new-username').value.trim();
      const password = document.getElementById('new-password').value;
      const role = document.getElementById('new-role').value;
      
      if (!username || !password) {
        alert('아이디와 비밀번호를 입력하세요.');
        return;
      }
      
      try {
        const data = await fetchAPI('/api/users', {
          method: 'POST',
          body: JSON.stringify({ username, password, role })
        });
        
        if (data.success) {
          showToast('사용자가 추가되었습니다.');
          document.getElementById('new-username').value = '';
          document.getElementById('new-password').value = '';
          document.getElementById('new-role').value = 'user';
          loadUsers();
        } else {
          alert('오류: ' + (data.error || '추가 실패'));
        }
      } catch (e) {
        alert('오류: ' + e.message);
      }
    }
    
    async function toggleUserActive(id, active) {
      try {
        const data = await fetchAPI('/api/users/' + id, {
          method: 'PUT',
          body: JSON.stringify({ is_active: active })
        });
        
        if (data.success) {
          showToast(active ? '사용자가 활성화되었습니다.' : '사용자가 비활성화되었습니다.');
          loadUsers();
        } else {
          alert('오류: ' + (data.error || '변경 실패'));
        }
      } catch (e) {
        alert('오류: ' + e.message);
      }
    }
    
    async function deleteUser(id, username) {
      if (!confirm('정말 "' + username + '" 사용자를 삭제하시겠습니까?')) return;
      
      try {
        const data = await fetchAPI('/api/users/' + id, {
          method: 'DELETE'
        });
        
        if (data.success) {
          showToast('사용자가 삭제되었습니다.');
          loadUsers();
        } else {
          alert('오류: ' + (data.error || '삭제 실패'));
        }
      } catch (e) {
        alert('오류: ' + e.message);
      }
    }
    
    // 토스트 메시지 표시 함수
    function showToast(message, duration = 3000) {
      // 기존 토스트 제거
      const existingToast = document.getElementById('toast-message');
      if (existingToast) existingToast.remove();
      
      // 새 토스트 생성
      const toast = document.createElement('div');
      toast.id = 'toast-message';
      toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity duration-300';
      toast.textContent = message;
      document.body.appendChild(toast);
      
      // 자동 제거
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
    
    async function fetchAPI(url, options = {}) {
      try {
        const response = await fetch(url, {
          credentials: 'same-origin',  // 쿠키 포함
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
      // 관리자 전용 탭 접근 제한 (user 역할인 경우)
      if ((!window.currentUser || window.currentUser.role !== 'admin') && (tab === 'pending' || tab === 'sites')) {
        alert('관리자 권한이 필요합니다.');
        return;
      }
      
      currentTab = tab;
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.remove('tab-active'));
      document.getElementById('tab-' + tab).classList.add('tab-active');
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.getElementById('content-' + tab).classList.remove('hidden');
      
      if (tab === 'dashboard') loadDashboard();
      else if (tab === 'pending') loadPending();
      else if (tab === 'sessions') loadSessions();
      else if (tab === 'sites') loadSites();
      else if (tab === 'title-stats') { loadTitleSelectList(); loadTitleStats(); }
      else if (tab === 'report-tracking') loadReportTrackingSessions();
    }
    
    // 월 목록 로드 여부 플래그
    let monthsLoaded = false;
    
    // 월 목록만 로드 (페이지 로드 시 1회)
    async function loadMonths() {
      if (monthsLoaded) return;
      const monthsData = await fetchAPI('/api/dashboard/months');
      if (monthsData.success) {
        const select = document.getElementById('month-select');
        // 가장 최근 데이터가 있는 월을 기본 선택 (months[0]이 최신)
        const latestMonth = monthsData.months[0] || monthsData.current_month;
        select.innerHTML = monthsData.months.map(m => 
          '<option value="' + m + '"' + (m === latestMonth ? ' selected' : '') + '>' + m + '</option>'
        ).join('') || '<option value="">데이터 없음</option>';
        monthsLoaded = true;
      }
    }
    
    // 대시보드 데이터만 로드 (월 변경 시 호출)
    async function loadDashboardData() {
      const month = document.getElementById('month-select').value;
      const data = await fetchAPI('/api/dashboard' + (month ? '?month=' + month : ''));
      
      if (data.success) {
        // 신고/차단 통계 표시
        const rs = data.report_stats || {};
        document.getElementById('dash-discovered').textContent = (rs.discovered || 0).toLocaleString();
        document.getElementById('dash-reported').textContent = (rs.reported || 0).toLocaleString();
        document.getElementById('dash-blocked').textContent = (rs.blocked || 0).toLocaleString();
        document.getElementById('dash-blockrate').textContent = (rs.blockRate || 0) + '%';
        
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
    
    // 초기 대시보드 로드 (월 목록 + 데이터)
    async function loadDashboard() {
      await loadMonths();
      await loadDashboardData();
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
            const page1Count = r.page1IllegalCount || 0;
            const hasHighIllegal = page1Count >= 5;
            
            // 1페이지 불법 5개 이상이면 빨간 박스
            let bgColor, textColor;
            if (hasHighIllegal) {
              bgColor = 'bg-red-100 border-red-400 border-2';
              textColor = 'text-red-700';
            } else if (isFirst) {
              bgColor = 'bg-green-100 border-green-300';
              textColor = 'text-green-700';
            } else if (r.mantaRank) {
              bgColor = 'bg-blue-50 border-blue-200';
              textColor = 'text-blue-700';
            } else {
              bgColor = 'bg-gray-100 border-gray-300';
              textColor = 'text-gray-500';
            }
            
            // 1위 도메인 + 1페이지 불법 URL 수 표시
            let extraInfo = '';
            if (r.firstDomain || page1Count > 0) {
              const firstDomainText = r.firstDomain ? '1위: ' + r.firstDomain : '';
              const illegalCountText = '<span class="' + (hasHighIllegal ? 'text-red-600 font-bold' : 'text-gray-500') + '">' +
                '불법 ' + page1Count + '개/10</span>';
              extraInfo = '<div class="text-xs text-gray-400 truncate flex justify-between items-center gap-1">' +
                (firstDomainText ? '<span class="truncate" title="' + r.firstDomain + '">' + firstDomainText + '</span>' : '<span></span>') +
                illegalCountText +
              '</div>';
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
    
    // ============================================
    // 작품별 상세보기 기능
    // ============================================
    // 작품별 통계 - 차트 및 데이터 관리
    // ============================================
    let rankingChart = null;
    let allTitlesForStats = []; // 전체 작품 목록 저장
    
    async function loadTitleSelectList() {
      const data = await fetchAPI('/api/titles/list');
      const listEl = document.getElementById('title-stats-list');
      
      if (data.success && data.titles.length > 0) {
        allTitlesForStats = data.titles;
        renderTitleStatsList(data.titles);
      } else {
        listEl.innerHTML = '<div class="text-gray-400 text-sm p-4 text-center">모니터링 대상 작품이 없습니다.</div>';
      }
    }
    
    function renderTitleStatsList(titles) {
      const listEl = document.getElementById('title-stats-list');
      listEl.innerHTML = titles.map(title =>
        '<div onclick="selectTitleForStats(\\'' + title.replace(/'/g, "\\\\'") + '\\')" ' +
        'class="title-stats-item px-2 py-1.5 rounded hover:bg-blue-50 cursor-pointer transition text-sm" ' +
        'data-title="' + title.replace(/"/g, '&quot;') + '">' +
        '<div class="font-medium text-gray-800 truncate">' + title + '</div>' +
        '</div>'
      ).join('');
    }
    
    async function loadTitleStats() {
      const tableEl = document.getElementById('title-stats-table');
      tableEl.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>로딩 중...</td></tr>';
      
      // 기간 필터 파라미터 가져오기
      const startDate = document.getElementById('stats-start-date').value;
      const endDate = document.getElementById('stats-end-date').value;
      
      let url = '/api/stats/by-title';
      if (startDate && endDate) {
        url += '?start_date=' + startDate + '&end_date=' + endDate;
      }
      
      const data = await fetchAPI(url);
      
      if (data.success && data.stats.length > 0) {
        // 전체 합계 계산
        const totals = data.stats.reduce((acc, s) => {
          acc.discovered += s.discovered;
          acc.reported += s.reported;
          acc.blocked += s.blocked;
          return acc;
        }, { discovered: 0, reported: 0, blocked: 0 });
        const totalBlockRate = totals.reported > 0 ? Math.round((totals.blocked / totals.reported) * 100 * 10) / 10 : 0;
        const totalBlockRateColor = totalBlockRate >= 80 ? 'text-green-600' : 
                                    totalBlockRate >= 50 ? 'text-yellow-600' : 
                                    totalBlockRate > 0 ? 'text-red-600' : 'text-gray-400';
        
        // 데이터 행 렌더링
        let html = data.stats.map(s => {
          const blockRateColor = s.blockRate >= 80 ? 'text-green-600' : 
                                 s.blockRate >= 50 ? 'text-yellow-600' : 
                                 s.blockRate > 0 ? 'text-red-600' : 'text-gray-400';
          return '<tr class="border-b hover:bg-gray-50">' +
            '<td class="py-2 px-3 font-medium">' + s.title + '</td>' +
            '<td class="py-2 px-3 text-center">' + s.discovered + '</td>' +
            '<td class="py-2 px-3 text-center text-blue-600">' + s.reported + '</td>' +
            '<td class="py-2 px-3 text-center text-green-600">' + s.blocked + '</td>' +
            '<td class="py-2 px-3 text-center ' + blockRateColor + ' font-bold">' + s.blockRate + '%</td>' +
          '</tr>';
        }).join('');
        
        // 합계 행 추가
        html += '<tr class="bg-gray-100 font-bold border-t-2 border-gray-300">' +
          '<td class="py-3 px-3">합계 (' + data.stats.length + '개 작품)</td>' +
          '<td class="py-3 px-3 text-center">' + totals.discovered.toLocaleString() + '</td>' +
          '<td class="py-3 px-3 text-center text-blue-600">' + totals.reported.toLocaleString() + '</td>' +
          '<td class="py-3 px-3 text-center text-green-600">' + totals.blocked.toLocaleString() + '</td>' +
          '<td class="py-3 px-3 text-center ' + totalBlockRateColor + '">' + totalBlockRate + '%</td>' +
        '</tr>';
        
        tableEl.innerHTML = html;
      } else {
        tableEl.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">해당 기간에 데이터가 없습니다.</td></tr>';
      }
    }
    
    function resetStatsDateFilter() {
      document.getElementById('stats-start-date').value = '';
      document.getElementById('stats-end-date').value = '';
      loadTitleStats();
    }
    
    function filterTitleList() {
      const query = document.getElementById('title-search-input').value.toLowerCase();
      const filtered = allTitlesForStats.filter(t => t.toLowerCase().includes(query));
      renderTitleStatsList(filtered);
    }
    
    async function selectTitleForStats(title) {
      // 선택 상태 표시
      document.querySelectorAll('.title-stats-item').forEach(item => {
        item.classList.remove('bg-blue-100', 'text-blue-700', 'font-semibold');
      });
      const selectedItem = document.querySelector('.title-stats-item[data-title="' + title.replace(/"/g, '&quot;') + '"]');
      if (selectedItem) {
        selectedItem.classList.add('bg-blue-100', 'text-blue-700', 'font-semibold');
      }
      
      // placeholder 숨기고 content 표시
      document.getElementById('title-stats-placeholder').classList.add('hidden');
      document.getElementById('title-stats-content').classList.remove('hidden');
      document.getElementById('selected-title-name').textContent = title;
      
      // 순위 히스토리 차트 로드
      await loadRankingHistoryChart(title);
    }
    
    async function loadRankingHistoryChart(title) {
      const canvas = document.getElementById('ranking-history-chart');
      const emptyMsg = document.getElementById('ranking-chart-empty');
      
      // 기존 차트 제거
      if (rankingChart) {
        rankingChart.destroy();
        rankingChart = null;
      }
      
      const data = await fetchAPI('/api/titles/' + encodeURIComponent(title) + '/ranking-history');
      if (!data.success || !data.history || data.history.length === 0) {
        canvas.style.display = 'none';
        emptyMsg.classList.remove('hidden');
        return;
      }
      
      canvas.style.display = 'block';
      emptyMsg.classList.add('hidden');
      
      const labels = data.history.map(h => {
        const d = new Date(h.recordedAt);
        return (d.getMonth() + 1) + '/' + d.getDate();
      });
      const values = data.history.map(h => h.rank || null);
      
      rankingChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Manta 순위',
            data: values,
            borderColor: 'rgba(59, 130, 246, 1)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: 'rgba(59, 130, 246, 1)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.raw ? context.raw + '위' : '순위권 외';
                }
              }
            }
          },
          scales: {
            y: {
              reverse: true,
              min: 1,
              max: 30,
              ticks: {
                stepSize: 5,
                callback: function(value) { return value + '위'; }
              }
            }
          }
        }
      });
    }
    
    let allPendingItems = [];
    let currentPendingFilter = 'all';
    
    async function loadPending() {
      const data = await fetchAPI('/api/pending');
      if (data.success) {
        document.getElementById('pending-badge').textContent = data.count;
        allPendingItems = data.items;
        
        // 일괄 처리 버튼 표시/숨김
        const bulkActions = document.getElementById('bulk-actions');
        if (data.items.length === 0) {
          document.getElementById('pending-list').innerHTML = '<div class="text-gray-500 text-center py-8"><i class="fas fa-check-circle text-4xl mb-2"></i><br>승인 대기 항목이 없습니다.</div>';
          bulkActions.classList.add('hidden');
          return;
        }
        
        bulkActions.classList.remove('hidden');
        renderPendingList();
      }
    }
    
    function renderPendingList() {
      // 필터 적용
      let filteredItems = allPendingItems;
      if (currentPendingFilter !== 'all') {
        filteredItems = allPendingItems.filter(item => 
          (item.llm_judgment || 'uncertain') === currentPendingFilter
        );
      }
      
      // 필터 버튼 활성화 상태 업데이트
      document.querySelectorAll('.pending-filter-btn').forEach(btn => {
        btn.classList.remove('ring-2', 'ring-offset-1', 'ring-gray-400');
        if (btn.dataset.filter === currentPendingFilter) {
          btn.classList.add('ring-2', 'ring-offset-1', 'ring-gray-400');
        }
      });
      
      if (filteredItems.length === 0) {
        document.getElementById('pending-list').innerHTML = '<div class="text-gray-500 text-center py-8"><i class="fas fa-filter text-4xl mb-2"></i><br>해당 필터에 맞는 항목이 없습니다.</div>';
        return;
      }
      
      document.getElementById('pending-list').innerHTML = filteredItems.map(item => {
        const judgmentLabel = item.llm_judgment === 'likely_illegal' ? '🔴 불법' : 
                             item.llm_judgment === 'likely_legal' ? '🟢 합법' : '🟡 불확실';
        return '<div class="border rounded-lg p-4 mb-3 hover:shadow-md transition pending-item" data-id="' + item.id + '" data-judgment="' + (item.llm_judgment || 'uncertain') + '">' +
          '<div class="flex justify-between items-start gap-3">' +
            '<div class="flex items-start gap-3 flex-1 min-w-0">' +
              '<input type="checkbox" class="pending-checkbox w-5 h-5 mt-1 cursor-pointer flex-shrink-0" data-id="' + item.id + '" onchange="updateSelectAllState()">' +
              '<div class="min-w-0">' +
                '<div class="flex flex-wrap items-center gap-2">' +
                  '<a href="https://' + item.domain + '" target="_blank" rel="noopener noreferrer" class="font-bold text-lg text-blue-600 hover:text-blue-800 hover:underline truncate">' + item.domain + ' <i class="fas fa-external-link-alt text-xs"></i></a>' +
                  '<span class="text-sm px-2 py-1 rounded flex-shrink-0 ' + 
                    (item.llm_judgment === 'likely_illegal' ? 'bg-red-100 text-red-700' : 
                     item.llm_judgment === 'likely_legal' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700') + '">' +
                    judgmentLabel + '</span>' +
                '</div>' +
                '<div class="text-sm text-gray-600 mt-1">' + (item.llm_reason || 'AI 검토가 필요합니다') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="flex gap-2 flex-shrink-0">' +
              '<button onclick="reviewItem(' + item.id + ', \\'approve\\')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-ban mr-1"></i>불법</button>' +
              '<button onclick="reviewItem(' + item.id + ', \\'reject\\')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-sm"><i class="fas fa-check mr-1"></i>합법</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      
      // 전체 선택 체크박스 초기화
      document.getElementById('select-all-pending').checked = false;
    }
    
    function filterPending(filter) {
      currentPendingFilter = filter;
      renderPendingList();
    }
    
    // NOTE: AI 일괄 검토 기능 삭제됨 - Manus API 연동으로 대체 예정
    
    function toggleSelectAll() {
      const selectAll = document.getElementById('select-all-pending').checked;
      document.querySelectorAll('.pending-checkbox').forEach(cb => {
        cb.checked = selectAll;
      });
    }
    
    function updateSelectAllState() {
      const checkboxes = document.querySelectorAll('.pending-checkbox');
      const checkedCount = document.querySelectorAll('.pending-checkbox:checked').length;
      document.getElementById('select-all-pending').checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    }
    
    function getSelectedIds() {
      const checked = document.querySelectorAll('.pending-checkbox:checked');
      return Array.from(checked).map(cb => cb.dataset.id);
    }
    
    async function bulkReview(action) {
      const ids = getSelectedIds();
      if (ids.length === 0) {
        alert('선택된 항목이 없습니다.');
        return;
      }
      
      const actionText = action === 'approve' ? '불법 사이트로' : '합법 사이트로';
      if (!confirm(ids.length + '개 도메인을 ' + actionText + ' 일괄 등록하시겠습니까?')) return;
      
      const data = await fetchAPI('/api/review/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action })
      });
      
      if (data.success) {
        showToast(data.processed + '개 도메인이 처리되었습니다.');
        loadPending();
        loadDashboard();
        loadSessions();
      } else {
        alert('일괄 처리 실패: ' + (data.error || '알 수 없는 오류'));
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
    
    // 세션 작품 Manta URL 저장용 맵
    let sessionTitleMantaUrls = {};
    
    async function updateSessionMantaUrl() {
      const titleFilter = document.getElementById('session-title-filter').value;
      const container = document.getElementById('session-manta-url-container');
      const link = document.getElementById('session-manta-url-link');
      
      if (titleFilter === 'all' || !sessionTitleMantaUrls[titleFilter]) {
        container.classList.add('hidden');
        return;
      }
      
      const url = sessionTitleMantaUrls[titleFilter];
      link.href = url;
      link.textContent = url;
      container.classList.remove('hidden');
    }
    
    function copySessionMantaUrl() {
      const link = document.getElementById('session-manta-url-link');
      if (link.href && link.href !== '#') {
        navigator.clipboard.writeText(link.href);
        alert('Manta URL이 복사되었습니다.');
      }
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
        // 타이틀 필터 업데이트 + Manta URL 로드
        const titleSelect = document.getElementById('session-title-filter');
        if (titleSelect.options.length <= 1) {
          // Manta URL 정보 로드
          const titlesData = await fetchAPI('/api/titles/list');
          if (titlesData.success && titlesData.titlesWithUrl) {
            sessionTitleMantaUrls = {};
            titlesData.titlesWithUrl.forEach(t => {
              if (t.manta_url) sessionTitleMantaUrls[t.name] = t.manta_url;
            });
          }
          
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
        
        // 결과 표시 (테이블 + 카드 형식)
        if (data.results.length === 0) {
          document.getElementById('session-results-desktop').innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">결과가 없습니다.</td></tr>';
          document.getElementById('session-results-mobile').innerHTML = '<div class="text-center py-8 text-gray-500">결과가 없습니다.</div>';
        } else {
          const startIdx = (data.pagination.page - 1) * data.pagination.limit;
          // 데스크톱 테이블
          document.getElementById('session-results-desktop').innerHTML = data.results.map((r, idx) => {
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
          // 모바일 카드
          document.getElementById('session-results-mobile').innerHTML = data.results.map((r, idx) => {
            const statusClass = r.final_status === 'illegal' ? 'bg-red-500' : 
                               r.final_status === 'legal' ? 'bg-green-500' : 'bg-yellow-500';
            const cardBg = r.final_status === 'illegal' ? 'border-l-red-500' : 
                          r.final_status === 'legal' ? 'border-l-green-500' : 'border-l-yellow-500';
            return '<div class="bg-white border border-l-4 ' + cardBg + ' rounded p-3 shadow-sm">' +
              '<div class="flex justify-between items-start mb-1">' +
                '<span class="text-xs text-gray-500">#' + (startIdx + idx + 1) + '</span>' +
                '<span class="px-2 py-0.5 rounded text-xs text-white ' + statusClass + '">' + r.final_status + '</span>' +
              '</div>' +
              '<div class="font-medium text-sm mb-1 truncate">' + r.title + '</div>' +
              '<div class="flex items-center gap-1">' +
                '<a href="' + r.url + '" target="_blank" rel="noopener noreferrer" class="text-blue-500 text-xs truncate flex-1" title="' + r.url + '">' + r.url + '</a>' +
                '<button onclick="copyUrl(\\'' + r.url.replace(/'/g, "\\\\'") + '\\')" class="text-gray-400 p-1"><i class="fas fa-copy"></i></button>' +
              '</div>' +
            '</div>';
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
        // 신고 제외 URL 목록 가져오기
        const excludedData = await fetchAPI('/api/excluded-urls');
        const excludedUrls = new Set(excludedData.success ? excludedData.items.map(item => item.url) : []);
        
        // 신고 제외 URL 필터링 (정확히 일치하는 것만 제외)
        const filteredUrls = data.results.filter(r => !excludedUrls.has(r.url));
        const excludedCount = data.results.length - filteredUrls.length;
        
        if (filteredUrls.length > 0) {
          const urls = filteredUrls.map(r => r.url).join('\\n');
          navigator.clipboard.writeText(urls).then(() => {
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded shadow-lg z-50';
            let message = '<i class="fas fa-check mr-2"></i>불법 URL ' + filteredUrls.length + '개가 복사되었습니다';
            if (excludedCount > 0) {
              message += ' <span class="text-orange-300">(신고제외 ' + excludedCount + '개 제외됨)</span>';
            }
            toast.innerHTML = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
          }).catch(err => {
            console.error('복사 실패:', err);
            alert('복사에 실패했습니다.');
          });
        } else {
          alert('복사할 불법 URL이 없습니다. (모두 신고 제외 대상)');
        }
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
      const excludedData = await fetchAPI('/api/excluded-urls');
      
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
      
      if (excludedData.success) {
        document.getElementById('excluded-count').textContent = excludedData.items.length;
        document.getElementById('excluded-urls-list').innerHTML = excludedData.items.map(item =>
          '<div class="flex justify-between items-center py-1 border-b text-sm group">' +
            '<a href="' + item.url + '" target="_blank" class="text-blue-600 hover:underline truncate max-w-[200px]" title="' + item.url + '">' + truncateUrl(item.url) + '</a>' +
            '<button onclick="removeExcludedUrl(' + item.id + ', \\'' + escapeQuotes(item.url) + '\\')" class="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity ml-2"><i class="fas fa-times"></i></button>' +
          '</div>'
        ).join('') || '<div class="text-gray-500">목록 없음</div>';
      }
    }
    
    function escapeQuotes(str) {
      return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
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
    
    async function addExcludedUrl() {
      const input = document.getElementById('new-excluded-url');
      const url = input.value.trim();
      if (!url) return;
      
      const res = await fetchAPI('/api/excluded-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      if (res.success) {
        input.value = '';
        loadSites();
      } else {
        alert(res.error || '추가 실패');
      }
    }
    
    async function removeExcludedUrl(id, url) {
      if (!confirm('이 URL을 신고 제외 목록에서 삭제하시겠습니까?\\n' + url)) return;
      
      const res = await fetchAPI('/api/excluded-urls/' + id, {
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
        
        document.getElementById('current-titles-list').innerHTML = data.current.map(t => {
          const escapedName = t.name.replace(/'/g, "\\\\'");
          const unofficialTitles = t.unofficial_titles || [];
          const unofficialHtml = unofficialTitles.length > 0 
            ? '<div class="flex flex-wrap gap-1 mt-1">' + 
                unofficialTitles.map(ut => 
                  '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800">' +
                    '<i class="fas fa-language mr-1"></i>' + ut +
                  '</span>'
                ).join('') +
              '</div>'
            : '';
          
          return '<div class="py-2 border-b hover:bg-purple-50">' +
            '<div class="flex justify-between items-center">' +
              '<span class="truncate font-medium">' + t.name + '</span>' +
              '<div class="flex items-center gap-1 flex-shrink-0">' +
                '<button onclick="openUnofficialModal(\\'' + escapedName + '\\', ' + JSON.stringify(unofficialTitles).replace(/"/g, '&quot;') + ')" class="text-yellow-600 hover:text-yellow-800 ml-2" title="비공식 타이틀 편집"><i class="fas fa-language"></i></button>' +
                '<button onclick="removeTitle(\\'' + escapedName + '\\')" class="text-red-500 hover:text-red-700 ml-1"><i class="fas fa-times"></i></button>' +
              '</div>' +
            '</div>' +
            unofficialHtml +
            (t.manta_url ? '<div class="flex items-center mt-1"><a href="' + t.manta_url + '" target="_blank" class="text-xs text-blue-500 hover:underline truncate max-w-[200px]">' + t.manta_url + '</a><button onclick="copyMantaUrl(\\'' + t.manta_url + '\\')" class="text-gray-400 hover:text-blue-500 ml-1" title="복사"><i class="fas fa-copy text-xs"></i></button></div>' : '') +
          '</div>';
        }).join('') || '<div class="text-gray-500 text-center py-4">목록 없음</div>';
        
        document.getElementById('history-titles-list').innerHTML = data.history.map(t =>
          '<div class="py-2 border-b hover:bg-gray-100">' +
            '<div class="flex justify-between items-center">' +
              '<span class="truncate">' + t.name + '</span>' +
              '<button onclick="restoreTitle(\\'' + t.name.replace(/'/g, "\\\\'") + '\\')" class="text-blue-500 hover:text-blue-700 ml-2 flex-shrink-0" title="복구"><i class="fas fa-undo"></i></button>' +
            '</div>' +
            (t.manta_url ? '<div class="text-xs text-gray-400 truncate mt-1">' + t.manta_url + '</div>' : '') +
          '</div>'
        ).join('') || '<div class="text-gray-400 text-center py-4">없음</div>';
      }
    }
    
    function copyMantaUrl(url) {
      navigator.clipboard.writeText(url);
      // 팝업 없이 조용히 복사
    }
    
    async function addNewTitle() {
      const titleInput = document.getElementById('new-title-input');
      const urlInput = document.getElementById('new-manta-url-input');
      const title = titleInput.value.trim();
      const mantaUrl = urlInput.value.trim();
      if (!title) return;
      
      await fetchAPI('/api/titles', {
        method: 'POST',
        body: JSON.stringify({ title, manta_url: mantaUrl || null })
      });
      titleInput.value = '';
      urlInput.value = '';
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
    
    // 비공식 타이틀 모달 관련
    let currentEditingTitle = null;
    
    function openUnofficialModal(title, currentUnofficials) {
      currentEditingTitle = title;
      document.getElementById('unofficial-modal-title').textContent = title;
      document.getElementById('unofficial-titles-input').value = (currentUnofficials || []).join('\\n');
      document.getElementById('unofficial-modal').classList.remove('hidden');
    }
    
    function closeUnofficialModal() {
      document.getElementById('unofficial-modal').classList.add('hidden');
      currentEditingTitle = null;
    }
    
    async function saveUnofficialTitles() {
      if (!currentEditingTitle) return;
      
      const input = document.getElementById('unofficial-titles-input').value;
      const titles = input.split('\\n').map(t => t.trim()).filter(t => t);
      
      const res = await fetchAPI('/api/titles/' + encodeURIComponent(currentEditingTitle) + '/unofficial', {
        method: 'PUT',
        body: JSON.stringify({ unofficial_titles: titles })
      });
      
      if (res.success) {
        closeUnofficialModal();
        loadTitles();
      } else {
        alert(res.error || '저장 실패');
      }
    }
    
    // ============================================
    // 신고결과 추적 함수들
    // ============================================
    
    let currentReportPage = 1;
    let currentReportSessionId = null;
    let reportTrackingData = [];
    let reasonsList = [];
    
    async function loadReportTrackingSessions() {
      const data = await fetchAPI('/api/report-tracking/sessions');
      const select = document.getElementById('report-session-select');
      
      if (data.success && data.sessions.length > 0) {
        select.innerHTML = '<option value="">회차 선택...</option>' +
          data.sessions.map(s => {
            const date = new Date(s.created_at).toLocaleDateString('ko-KR');
            const stats = s.tracking_stats;
            return '<option value="' + s.id + '">' + date + ' (' + stats.total + '개)</option>';
          }).join('');
          
        // 이전 선택 복구
        if (currentReportSessionId) {
          select.value = currentReportSessionId;
          loadReportTracking();
        }
      } else {
        select.innerHTML = '<option value="">데이터 없음</option>';
      }
      
      // 사유 목록 로드
      loadReasons();
    }
    
    async function loadReasons() {
      const data = await fetchAPI('/api/report-tracking/reasons');
      if (data.success) {
        reasonsList = data.reasons;
      }
    }
    
    async function loadTitlesForManualAdd() {
      const data = await fetchAPI('/api/titles/list');
      const select = document.getElementById('manual-title-select');
      if (data.success && select) {
        select.innerHTML = '<option value="">-- 작품 선택 --</option>' +
          data.titles.map(t => '<option value="' + t + '">' + t + '</option>').join('');
      }
    }
    
    let currentSearchTerm = '';
    
    async function loadReportTracking(page = 1) {
      const sessionId = document.getElementById('report-session-select').value;
      if (!sessionId) {
        document.getElementById('report-tracking-table').innerHTML = 
          '<tr><td colspan="5" class="text-center py-8 text-gray-400">회차를 선택하세요</td></tr>';
        return;
      }
      
      currentReportSessionId = sessionId;
      currentReportPage = page;
      
      const status = document.getElementById('report-status-filter').value;
      const searchTerm = document.getElementById('report-url-search').value.trim();
      currentSearchTerm = searchTerm;
      
      let url = '/api/report-tracking/' + sessionId + '?page=' + page + '&limit=50';
      if (status) url += '&status=' + encodeURIComponent(status);
      if (searchTerm) url += '&search=' + encodeURIComponent(searchTerm);
      
      const data = await fetchAPI(url);
      
      if (data.success) {
        reportTrackingData = data.items;
        renderReportTable();
        
        // 페이지네이션
        const pagination = data.pagination;
        document.getElementById('report-pagination').classList.toggle('hidden', pagination.totalPages <= 1);
        document.getElementById('rt-page-info').textContent = pagination.page + ' / ' + pagination.totalPages;
        document.getElementById('rt-prev-btn').disabled = pagination.page <= 1;
        document.getElementById('rt-next-btn').disabled = pagination.page >= pagination.totalPages;
        
        // 검색 결과 표시
        if (searchTerm && pagination.total > 0) {
          document.getElementById('rt-page-info').textContent = 
            pagination.page + ' / ' + pagination.totalPages + ' (검색결과: ' + pagination.total + '개)';
        }
      }
      
      // 통계 로드 (검색 중이 아닐 때만)
      if (!searchTerm) {
        loadReportStats(sessionId);
      }
      
      // 업로드 이력 로드
      loadUploadHistory(sessionId);
      
      // 수동 추가용 작품 목록 로드
      loadTitlesForManualAdd();
    }
    
    function searchReportTracking() {
      // 검색 시 첫 페이지로 이동
      loadReportTracking(1);
    }
    
    async function loadReportStats(sessionId) {
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/stats');
      if (data.success) {
        const stats = data.stats;
        document.getElementById('rt-total').textContent = stats.total || 0;
        document.getElementById('rt-blocked').textContent = stats['차단'] || 0;
        document.getElementById('rt-pending').textContent = stats['대기 중'] || 0;
        document.getElementById('rt-unreported').textContent = stats['미신고'] || 0;
        document.getElementById('rt-notfound').textContent = stats['색인없음'] || 0;
        document.getElementById('rt-rejected').textContent = stats['거부'] || 0;
      }
    }
    
    async function loadUploadHistory(sessionId) {
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/uploads');
      const container = document.getElementById('upload-history');
      
      if (data.success && data.uploads.length > 0) {
        container.innerHTML = data.uploads.map(u => {
          const date = new Date(u.uploaded_at).toLocaleDateString('ko-KR');
          return '<div class="p-2 bg-gray-50 rounded">' +
            '<div class="flex items-center justify-between">' +
              '<span class="font-semibold">#' + u.report_id + '</span>' +
              '<button onclick="editUploadReportId(' + u.id + ', \\'' + u.report_id + '\\')" class="text-blue-500 hover:text-blue-700 text-xs">' +
                '<i class="fas fa-edit"></i>' +
              '</button>' +
            '</div>' +
            '<div class="text-gray-500">' + date + ' · 매칭: ' + u.matched_count + '/' + u.total_urls_in_html + '</div>' +
          '</div>';
        }).join('');
      } else {
        container.innerHTML = '<div class="text-gray-400 text-center py-2">이력 없음</div>';
      }
    }
    
    async function editUploadReportId(uploadId, currentReportId) {
      const newReportId = prompt('신고 ID를 수정하세요:', currentReportId);
      if (newReportId && newReportId !== currentReportId) {
        const data = await fetchAPI('/api/report-tracking/uploads/' + uploadId, {
          method: 'PUT',
          body: JSON.stringify({ report_id: newReportId })
        });
        if (data.success) {
          loadUploadHistory(currentReportSessionId);
        } else {
          alert('수정 실패: ' + (data.error || '알 수 없는 오류'));
        }
      }
    }
    
    function renderReportTable() {
      const tbody = document.getElementById('report-tracking-table');
      
      if (reportTrackingData.length === 0) {
        const searchTerm = document.getElementById('report-url-search').value.trim();
        const message = searchTerm ? '검색 결과가 없습니다' : '데이터 없음';
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">' + message + '</td></tr>';
        return;
      }
      
      tbody.innerHTML = reportTrackingData.map(item => {
        const statusColors = {
          '차단': 'bg-green-100 text-green-800',
          '대기 중': 'bg-yellow-100 text-yellow-800',
          '색인없음': 'bg-gray-100 text-gray-800',
          '거부': 'bg-red-100 text-red-800',
          '미신고': 'bg-purple-100 text-purple-800'
        };
        const statusClass = statusColors[item.report_status] || 'bg-gray-100';
        
        return '<tr class="border-b hover:bg-gray-50" data-id="' + item.id + '">' +
          '<td class="px-3 py-2"><a href="' + item.url + '" target="_blank" class="text-blue-600 hover:underline truncate block max-w-xs" title="' + item.url + '">' + truncateUrl(item.url) + '</a></td>' +
          '<td class="px-3 py-2 text-gray-600">' + item.domain + '</td>' +
          '<td class="px-3 py-2 text-center">' +
            '<select onchange="updateReportStatus(' + item.id + ', this.value)" class="text-xs px-2 py-1 rounded border ' + statusClass + '">' +
              '<option value="미신고"' + (item.report_status === '미신고' ? ' selected' : '') + '>미신고</option>' +
              '<option value="차단"' + (item.report_status === '차단' ? ' selected' : '') + '>차단</option>' +
              '<option value="대기 중"' + (item.report_status === '대기 중' ? ' selected' : '') + '>대기 중</option>' +
              '<option value="색인없음"' + (item.report_status === '색인없음' ? ' selected' : '') + '>색인없음</option>' +
              '<option value="거부"' + (item.report_status === '거부' ? ' selected' : '') + '>거부</option>' +
            '</select>' +
          '</td>' +
          '<td class="px-3 py-2 text-gray-500 text-xs">' + 
            '<span class="inline-edit-reportid cursor-pointer hover:bg-gray-100 px-1 rounded" ' +
              'onclick="startEditReportId(' + item.id + ', this)" ' +
              'title="클릭하여 수정">' + 
              (item.report_id || '<span class=\\'text-gray-300\\'>-</span>') + 
            '</span>' +
          '</td>' +
          '<td class="px-3 py-2">' + renderReasonSelect(item) + '</td>' +
        '</tr>';
      }).join('');
    }
    
    function truncateUrl(url) {
      if (url.length > 50) {
        return url.substring(0, 47) + '...';
      }
      return url;
    }
    
    function renderReasonSelect(item) {
      const needsReason = ['미신고', '거부'].includes(item.report_status);
      if (!needsReason) return '<span class="text-gray-400 text-xs">-</span>';
      
      const options = reasonsList.map(r => 
        '<option value="' + r.text + '"' + (item.reason === r.text ? ' selected' : '') + '>' + r.text + '</option>'
      ).join('');
      
      return '<select onchange="updateReportReason(' + item.id + ', this.value)" class="text-xs px-2 py-1 rounded border w-full">' +
        '<option value="">사유 선택...</option>' +
        options +
        '<option value="__custom__">+ 직접 입력</option>' +
      '</select>';
    }
    
    async function updateReportStatus(id, status) {
      const reportId = document.getElementById('report-id-input').value || null;
      const data = await fetchAPI('/api/report-tracking/' + id + '/status', {
        method: 'PUT',
        body: JSON.stringify({ status, report_id: reportId })
      });
      
      if (data.success) {
        // 테이블에서 해당 항목 업데이트
        const item = reportTrackingData.find(i => i.id === id);
        if (item) {
          item.report_status = status;
          if (reportId) item.report_id = reportId;
        }
        renderReportTable();
        loadReportStats(currentReportSessionId);
      } else {
        alert('상태 변경 실패: ' + (data.error || '알 수 없는 오류'));
      }
    }
    
    async function updateReportReason(id, reason) {
      if (reason === '__custom__') {
        const customReason = prompt('사유를 입력하세요:');
        if (!customReason) {
          loadReportTracking(currentReportPage);
          return;
        }
        reason = customReason;
      }
      
      const data = await fetchAPI('/api/report-tracking/' + id + '/reason', {
        method: 'PUT',
        body: JSON.stringify({ reason })
      });
      
      if (data.success) {
        const item = reportTrackingData.find(i => i.id === id);
        if (item) item.reason = reason;
        
        // 새 사유가 추가되었을 수 있으므로 목록 다시 로드
        await loadReasons();
        renderReportTable();
      } else {
        alert('사유 변경 실패: ' + (data.error || '알 수 없는 오류'));
      }
    }
    
    function filterReportTable() {
      // 더 이상 클라이언트 필터링 사용 안 함 - 서버 검색 사용
      renderReportTable();
    }
    
    function clearReportSearch() {
      document.getElementById('report-url-search').value = '';
      currentSearchTerm = '';
      loadReportTracking(1);
    }
    
    // 신고ID 인라인 편집 함수들
    function startEditReportId(id, spanEl) {
      const item = reportTrackingData.find(i => i.id === id);
      const currentValue = item ? (item.report_id || '') : '';
      
      // 입력창으로 교체
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentValue;
      input.className = 'text-xs px-1 py-0.5 border rounded w-24 focus:outline-none focus:ring-1 focus:ring-blue-500';
      input.placeholder = '신고ID 입력';
      
      // Enter 키로 저장
      input.onkeydown = function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveInlineReportId(id, input.value, spanEl);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEditReportId(id, spanEl, currentValue);
        }
      };
      
      // 포커스 잃으면 저장
      input.onblur = function() {
        // 약간의 딜레이를 주어 다른 클릭 이벤트 처리 가능하게
        setTimeout(() => {
          if (document.activeElement !== input) {
            saveInlineReportId(id, input.value, spanEl);
          }
        }, 100);
      };
      
      spanEl.innerHTML = '';
      spanEl.appendChild(input);
      input.focus();
      input.select();
    }
    
    async function saveInlineReportId(id, newValue, spanEl) {
      const item = reportTrackingData.find(i => i.id === id);
      const oldValue = item ? (item.report_id || '') : '';
      
      // 값이 변경되지 않았으면 그냥 원래대로
      if (newValue === oldValue) {
        spanEl.innerHTML = oldValue || '<span class="text-gray-300">-</span>';
        return;
      }
      
      // 서버에 저장
      try {
        const data = await fetchAPI('/api/report-tracking/' + id + '/report-id', {
          method: 'PUT',
          body: JSON.stringify({ report_id: newValue || null })
        });
        
        if (data.success) {
          if (item) item.report_id = newValue || null;
          spanEl.innerHTML = newValue || '<span class="text-gray-300">-</span>';
        } else {
          alert('신고ID 변경 실패: ' + (data.error || '알 수 없는 오류'));
          spanEl.innerHTML = oldValue || '<span class="text-gray-300">-</span>';
        }
      } catch (error) {
        alert('신고ID 변경 실패');
        spanEl.innerHTML = oldValue || '<span class="text-gray-300">-</span>';
      }
    }
    
    function cancelEditReportId(id, spanEl, originalValue) {
      spanEl.innerHTML = originalValue || '<span class="text-gray-300">-</span>';
    }
    
    // 드래그앤드랍 관련 함수들
    function handleDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      const dropZone = document.getElementById('html-drop-zone');
      dropZone.classList.add('border-blue-500', 'bg-blue-50');
      dropZone.classList.remove('border-gray-300');
    }
    
    function handleDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      const dropZone = document.getElementById('html-drop-zone');
      dropZone.classList.remove('border-blue-500', 'bg-blue-50');
      dropZone.classList.add('border-gray-300');
    }
    
    function handleFileDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const dropZone = document.getElementById('html-drop-zone');
      dropZone.classList.remove('border-blue-500', 'bg-blue-50');
      dropZone.classList.add('border-gray-300');
      
      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      
      const file = files[0];
      
      if (!file.name.endsWith('.csv')) {
        alert('CSV 파일만 업로드할 수 있습니다.');
        return;
      }
      
      // 파일 입력에 설정하고 업로드 처리
      const fileInput = document.getElementById('csv-file-input');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      
      handleCsvUpload();
    }
    
    async function handleCsvUpload() {
      const fileInput = document.getElementById('csv-file-input');
      const reportIdInput = document.getElementById('report-id-input');
      const sessionId = currentReportSessionId;
      
      if (!fileInput.files.length) return;
      if (!sessionId) {
        alert('먼저 회차를 선택해주세요.');
        return;
      }
      
      const file = fileInput.files[0];
      const reader = new FileReader();
      
      reader.onload = async function(e) {
        const csvContent = e.target.result;
        
        // 파일명에서 신고 ID 자동 추출 (예: 9-0695000040090_Urls.csv)
        const reportIdMatch = file.name.match(/^(.+?)_Urls\\.csv$/i);
        if (reportIdMatch && reportIdMatch[1] && !reportIdInput.value) {
          reportIdInput.value = reportIdMatch[1];
        }
        
        const reportId = reportIdInput.value;
        if (!reportId) {
          alert('신고 ID를 추출할 수 없습니다. 수동으로 입력해주세요.');
          return;
        }
        
        // CSV 파싱 (파이프 구분자)
        const lines = csvContent.split('\\n').filter(l => l.trim());
        if (lines.length <= 1) {
          alert('CSV 파일에 유효한 데이터가 없습니다.');
          return;
        }
        const csvRows = lines.slice(1).map(line => {
          const parts = line.split('|');
          return { url: (parts[0]||'').trim(), status: (parts[1]||'').trim(), details: (parts[2]||'').trim() };
        }).filter(r => r.url && r.status);
        
        // 로딩 표시
        const uploadBtn = document.querySelector('[onclick*="csv-file-input"]');
        const originalText = uploadBtn ? uploadBtn.innerHTML : '';
        if (uploadBtn) { uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>처리 중...'; uploadBtn.disabled = true; }
        
        try {
          const data = await fetchAPI('/api/report-tracking/' + sessionId + '/upload', {
            method: 'POST',
            body: JSON.stringify({
              csv_rows: csvRows,
              report_id: reportId,
              file_name: file.name
            })
          });
          
          if (data.success) {
            alert('업로드 완료!\\n\\n' + data.message);
            loadReportTracking(currentReportPage);
          } else {
            alert('업로드 실패: ' + (data.error || '알 수 없는 오류'));
          }
        } catch (error) {
          alert('업로드 오류: ' + error.message);
        } finally {
          if (uploadBtn) { uploadBtn.innerHTML = originalText; uploadBtn.disabled = false; }
          fileInput.value = '';
        }
      };
      
      reader.readAsText(file);
    }
    
    async function addManualUrl() {
      const input = document.getElementById('manual-url-input');
      const titleSelect = document.getElementById('manual-title-select');
      const url = input.value.trim();
      const title = titleSelect.value;
      const sessionId = currentReportSessionId;
      
      if (!sessionId) {
        alert('먼저 회차를 선택해주세요.');
        return;
      }
      
      if (!title) {
        alert('작품을 선택해주세요.');
        return;
      }
      
      if (!url) {
        alert('URL을 입력해주세요.');
        return;
      }
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        alert('http:// 또는 https://로 시작하는 URL을 입력해주세요.');
        return;
      }
      
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/add-url', {
        method: 'POST',
        body: JSON.stringify({ url, title })
      });
      
      if (data.success) {
        alert('URL이 추가되었습니다.\\n\\n작품: ' + title + '\\n도메인: ' + data.domain);
        input.value = '';
        loadReportTracking(currentReportPage);
      } else {
        alert('URL 추가 실패: ' + (data.error || '알 수 없는 오류'));
      }
    }
    
    async function copyReportUrls() {
      const status = document.getElementById('report-status-filter').value;
      const sessionId = currentReportSessionId;
      
      if (!sessionId) {
        alert('회차를 선택해주세요.');
        return;
      }
      
      const data = await fetchAPI('/api/report-tracking/' + sessionId + '/urls' + (status ? '?status=' + encodeURIComponent(status) : ''));
      
      if (data.success && data.urls.length > 0) {
        const text = data.urls.join('\\n');
        await navigator.clipboard.writeText(text);
        alert(data.count + '개 URL이 복사되었습니다.' + (status ? ' (필터: ' + status + ')' : ''));
      } else {
        alert('복사할 URL이 없습니다.');
      }
    }
    
    function exportReportCsv() {
      const sessionId = currentReportSessionId;
      if (!sessionId) {
        alert('회차를 선택해주세요.');
        return;
      }
      window.open('/api/report-tracking/' + sessionId + '/export', '_blank');
    }
    
    // 전역 함수 등록 (onclick, onchange에서 호출되는 함수들)
    window.handleCsvUpload = handleCsvUpload;
    window.handleDragOver = handleDragOver;
    window.handleDragLeave = handleDragLeave;
    window.handleFileDrop = handleFileDrop;
    window.addManualUrl = addManualUrl;
    window.copyReportUrls = copyReportUrls;
    window.editUploadReportId = editUploadReportId;
    window.exportReportCsv = exportReportCsv;
    window.loadReportTracking = loadReportTracking;
    window.updateReportStatus = updateReportStatus;
    window.updateReportReason = updateReportReason;
    window.filterReportTable = filterReportTable;
    window.searchReportTracking = searchReportTracking;
    window.clearReportSearch = clearReportSearch;
    window.startEditReportId = startEditReportId;
    window.loadReportTrackingSessions = loadReportTrackingSessions;
    window.switchTab = switchTab;
    window.handleLogout = handleLogout;
    window.loadDashboard = loadDashboard;
    window.loadPending = loadPending;
    window.loadSessions = loadSessions;
    window.loadSessionResults = loadSessionResults;
    window.openSessionDetail = openSessionDetail;
    window.closeSessionDetail = closeSessionDetail;
    window.goToPage = goToPage;
    window.goToSessionsPage = goToSessionsPage;
    window.downloadSessionReport = downloadSessionReport;
    window.copyAllIllegalUrls = copyAllIllegalUrls;
    window.copyUrl = copyUrl;
    window.loadSites = loadSites;
    window.addNewSite = addNewSite;
    window.removeSiteItem = removeSiteItem;
    window.addExcludedUrl = addExcludedUrl;
    window.removeExcludedUrl = removeExcludedUrl;
    window.openTitlesModal = openTitlesModal;
    window.closeTitlesModal = closeTitlesModal;
    window.loadTitles = loadTitles;
    window.copyMantaUrl = copyMantaUrl;
    window.updateSessionMantaUrl = updateSessionMantaUrl;
    window.copySessionMantaUrl = copySessionMantaUrl;
    window.addNewTitle = addNewTitle;
    window.removeTitle = removeTitle;
    window.restoreTitle = restoreTitle;
    window.openUnofficialModal = openUnofficialModal;
    window.closeUnofficialModal = closeUnofficialModal;
    window.saveUnofficialTitles = saveUnofficialTitles;
    window.reviewItem = reviewItem;
    window.bulkReview = bulkReview;
    window.toggleSelectAll = toggleSelectAll;
    window.updateSelectAllState = updateSelectAllState;
    window.filterPending = filterPending;
    window.runAiReview = runAiReview;
    window.renderPendingList = renderPendingList;
    window.openAllTitlesModal = openAllTitlesModal;
    window.closeAllTitlesModal = closeAllTitlesModal;
    window.selectTitleForStats = selectTitleForStats;
    window.loadTitlesForManualAdd = loadTitlesForManualAdd;
    window.loadTitleStats = loadTitleStats;
    window.resetStatsDateFilter = resetStatsDateFilter;
    
    // 현재 사용자 정보 로드 및 UI 업데이트
    async function loadCurrentUser() {
      try {
        const data = await fetchAPI('/api/auth/status');
        if (data.authenticated && data.user) {
          window.currentUser = data.user;
          updateUIByRole();
        } else {
          window.location.href = '/login';
        }
      } catch (e) {
        console.error('사용자 정보 로드 실패:', e);
      }
    }
    
    // 역할에 따라 UI 업데이트
    function updateUIByRole() {
      const isAdmin = window.currentUser && window.currentUser.role === 'admin';
      
      // 관리자 전용 요소 표시/숨기기
      document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
      });
      
      // 관리자 전용 컨텐츠 숨기기 (user인 경우)
      if (!isAdmin) {
        const pendingContent = document.getElementById('content-pending');
        const sitesContent = document.getElementById('content-sites');
        if (pendingContent) pendingContent.style.display = 'none';
        if (sitesContent) sitesContent.style.display = 'none';
      }
    }
    
    // 초기 로드
    loadCurrentUser().then(() => {
      loadDashboard();
      if (window.currentUser && window.currentUser.role === 'admin') {
        loadPending();
      }
      loadSessions();
    });
  </script>
</body>
</html>
  `)
})

export default app
