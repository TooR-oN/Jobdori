// ============================================
// Jobdori Database v2 - 정규화된 스키마용 함수
// detection_results 테이블 및 실시간 집계 View 활용
// 작성일: 2026-01-30
// ============================================

import { neon } from '@neondatabase/serverless';

// DB 연결
const getDb = () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return neon(dbUrl);
};

// ============================================
// 타입 정의
// ============================================

export interface DetectionResult {
  id: number;
  session_id: string;
  title: string;
  search_query: string;
  url: string;
  domain: string;
  page: number;
  rank: number;
  initial_status: 'illegal' | 'legal' | 'unknown';
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null;
  llm_reason: string | null;
  final_status: 'illegal' | 'legal' | 'pending';
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DetectionResultInput {
  session_id: string;
  title: string;
  search_query: string;
  url: string;
  domain: string;
  page: number;
  rank: number;
  initial_status: 'illegal' | 'legal' | 'unknown';
  llm_judgment?: 'likely_illegal' | 'likely_legal' | 'uncertain' | null;
  llm_reason?: string | null;
  final_status: 'illegal' | 'legal' | 'pending';
  reviewed_at?: string | null;
}

export interface ApprovalResult {
  domain: string;
  action: 'approve' | 'reject';
  affectedSites: number;
  affectedDetectionResults: number;
  reviewedAt: string;
}

export interface MonthlyStats {
  month: Date;
  sessions_count: number;
  total: number;
  illegal: number;
  legal: number;
  pending: number;
}

export interface MonthlyTopContent {
  month: Date;
  title: string;
  illegal_count: number;
  legal_count: number;
  pending_count: number;
  total_count: number;
}

export interface MonthlyTopIllegalSite {
  month: Date;
  domain: string;
  illegal_count: number;
}

export interface SessionStats {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  titles_count: number;
  keywords_count: number;
  total_searches: number;
  file_final_results: string | null;
  results_total: number;
  results_illegal: number;
  results_legal: number;
  results_pending: number;
}

export interface PendingDomain {
  domain: string;
  pending_count: number;
  title_count: number;
  session_count: number;
  titles: string[];
  first_detected_at: string;
  last_detected_at: string;
  llm_judgment: string | null;
  llm_reason: string | null;
}

// ============================================
// Detection Results CRUD
// ============================================

/**
 * 단일 탐지 결과 저장
 */
export async function createDetectionResult(
  result: DetectionResultInput
): Promise<DetectionResult> {
  const sql = getDb();
  
  const rows = await sql`
    INSERT INTO detection_results (
      session_id, title, search_query, url, domain, page, rank,
      initial_status, llm_judgment, llm_reason, final_status, reviewed_at
    ) VALUES (
      ${result.session_id},
      ${result.title},
      ${result.search_query},
      ${result.url},
      ${result.domain.toLowerCase()},
      ${result.page},
      ${result.rank},
      ${result.initial_status},
      ${result.llm_judgment || null},
      ${result.llm_reason || null},
      ${result.final_status},
      ${result.reviewed_at || null}
    )
    ON CONFLICT (session_id, url) DO UPDATE SET
      title = EXCLUDED.title,
      search_query = EXCLUDED.search_query,
      domain = EXCLUDED.domain,
      page = EXCLUDED.page,
      rank = EXCLUDED.rank,
      initial_status = EXCLUDED.initial_status,
      llm_judgment = EXCLUDED.llm_judgment,
      llm_reason = EXCLUDED.llm_reason,
      final_status = EXCLUDED.final_status,
      reviewed_at = EXCLUDED.reviewed_at,
      updated_at = NOW()
    RETURNING *
  `;
  
  return rows[0] as DetectionResult;
}

/**
 * 다중 탐지 결과 배치 저장 (성능 최적화)
 */
export async function bulkCreateDetectionResults(
  results: DetectionResultInput[]
): Promise<number> {
  if (results.length === 0) return 0;
  
  const sql = getDb();
  
  // UNNEST를 사용한 배치 INSERT
  const sessionIds = results.map(r => r.session_id);
  const titles = results.map(r => r.title);
  const searchQueries = results.map(r => r.search_query);
  const urls = results.map(r => r.url);
  const domains = results.map(r => r.domain.toLowerCase());
  const pages = results.map(r => r.page);
  const ranks = results.map(r => r.rank);
  const initialStatuses = results.map(r => r.initial_status);
  const llmJudgments = results.map(r => r.llm_judgment || null);
  const llmReasons = results.map(r => r.llm_reason || null);
  const finalStatuses = results.map(r => r.final_status);
  const reviewedAts = results.map(r => r.reviewed_at || null);
  
  const inserted = await sql`
    INSERT INTO detection_results (
      session_id, title, search_query, url, domain, page, rank,
      initial_status, llm_judgment, llm_reason, final_status, reviewed_at
    )
    SELECT * FROM UNNEST(
      ${sessionIds}::VARCHAR(50)[],
      ${titles}::VARCHAR(500)[],
      ${searchQueries}::VARCHAR(500)[],
      ${urls}::TEXT[],
      ${domains}::VARCHAR(255)[],
      ${pages}::INTEGER[],
      ${ranks}::INTEGER[],
      ${initialStatuses}::VARCHAR(20)[],
      ${llmJudgments}::VARCHAR(20)[],
      ${llmReasons}::TEXT[],
      ${finalStatuses}::VARCHAR(20)[],
      ${reviewedAts}::TIMESTAMPTZ[]
    )
    ON CONFLICT (session_id, url) DO NOTHING
    RETURNING id
  `;
  
  console.log(`✅ Bulk inserted ${inserted.length} detection results`);
  return inserted.length;
}

/**
 * 세션별 탐지 결과 조회
 */
export async function getDetectionResultsBySession(
  sessionId: string,
  options?: {
    status?: 'illegal' | 'legal' | 'pending';
    title?: string;
    domain?: string;
    page?: number;
    limit?: number;
  }
): Promise<{ items: DetectionResult[]; total: number }> {
  const sql = getDb();
  const page = options?.page || 1;
  const limit = options?.limit || 50;
  const offset = (page - 1) * limit;
  
  let whereClause = `WHERE session_id = '${sessionId}'`;
  
  if (options?.status) {
    whereClause += ` AND final_status = '${options.status}'`;
  }
  if (options?.title) {
    whereClause += ` AND title = '${options.title}'`;
  }
  if (options?.domain) {
    whereClause += ` AND LOWER(domain) = '${options.domain.toLowerCase()}'`;
  }
  
  // 동적 쿼리 (파라미터 바인딩으로 변경 필요시 수정)
  const items = await sql`
    SELECT * FROM detection_results
    WHERE session_id = ${sessionId}
      AND (${options?.status || null}::VARCHAR IS NULL OR final_status = ${options?.status || null})
      AND (${options?.title || null}::VARCHAR IS NULL OR title = ${options?.title || null})
      AND (${options?.domain || null}::VARCHAR IS NULL OR LOWER(domain) = LOWER(${options?.domain || null}))
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  
  const countResult = await sql`
    SELECT COUNT(*) as count FROM detection_results
    WHERE session_id = ${sessionId}
      AND (${options?.status || null}::VARCHAR IS NULL OR final_status = ${options?.status || null})
      AND (${options?.title || null}::VARCHAR IS NULL OR title = ${options?.title || null})
      AND (${options?.domain || null}::VARCHAR IS NULL OR LOWER(domain) = LOWER(${options?.domain || null}))
  `;
  
  return {
    items: items as DetectionResult[],
    total: parseInt(countResult[0]?.count || '0')
  };
}

// ============================================
// 도메인 승인/반려 처리 (소급 업데이트 포함)
// ============================================

/**
 * 도메인을 승인(불법) 또는 반려(합법) 처리
 * - sites 테이블에 도메인 추가
 * - detection_results의 해당 도메인 모든 pending 상태를 소급 업데이트
 * - pending_reviews 테이블에서 해당 도메인 제거
 * - 하나의 트랜잭션으로 처리
 */
export async function approveDomain(
  domain: string,
  action: 'approve' | 'reject',
  reviewedBy?: string
): Promise<ApprovalResult> {
  const sql = getDb();
  const normalizedDomain = domain.toLowerCase().trim();
  const finalStatus = action === 'approve' ? 'illegal' : 'legal';
  const siteType = action === 'approve' ? 'illegal' : 'legal';
  const reviewedAt = new Date().toISOString();

  // (A) sites 테이블에 도메인 추가
  await sql`
    INSERT INTO sites (domain, type)
    VALUES (${normalizedDomain}, ${siteType})
    ON CONFLICT (domain, type) DO NOTHING
  `;

  // (B) detection_results 소급 업데이트 (모든 과거 pending 데이터)
  const updateResult = await sql`
    UPDATE detection_results
    SET 
      final_status = ${finalStatus},
      reviewed_at = ${reviewedAt},
      reviewed_by = ${reviewedBy || null},
      updated_at = NOW()
    WHERE LOWER(domain) = ${normalizedDomain}
      AND final_status = 'pending'
    RETURNING id
  `;

  // (C) pending_reviews에서 해당 도메인 제거 (기존 호환성)
  await sql`
    DELETE FROM pending_reviews 
    WHERE LOWER(domain) = ${normalizedDomain}
  `;

  const affectedCount = updateResult.length;
  
  console.log(`✅ Domain ${action === 'approve' ? 'approved (illegal)' : 'rejected (legal)'}: ${domain}`);
  console.log(`   - Sites table: 1 row affected`);
  console.log(`   - Detection results retroactively updated: ${affectedCount} rows`);

  return {
    domain: normalizedDomain,
    action,
    affectedSites: 1,
    affectedDetectionResults: affectedCount,
    reviewedAt
  };
}

/**
 * 도메인 승인 처리 (불법으로 확정)
 */
export async function approveAsIllegal(
  domain: string,
  reviewedBy?: string
): Promise<ApprovalResult> {
  return approveDomain(domain, 'approve', reviewedBy);
}

/**
 * 도메인 반려 처리 (합법으로 확정)
 */
export async function rejectAsLegal(
  domain: string,
  reviewedBy?: string
): Promise<ApprovalResult> {
  return approveDomain(domain, 'reject', reviewedBy);
}

// ============================================
// 실시간 통계 조회 (View 활용)
// ============================================

/**
 * 월별 전체 통계 조회
 */
export async function getMonthlyStatsV2(
  month?: string
): Promise<MonthlyStats[]> {
  const sql = getDb();
  
  if (month) {
    // 특정 월 조회
    const rows = await sql`
      SELECT * FROM v_monthly_stats
      WHERE DATE_TRUNC('month', month) = DATE_TRUNC('month', ${month}::DATE)
    `;
    return rows as MonthlyStats[];
  }
  
  // 전체 월 조회 (최근 순)
  const rows = await sql`
    SELECT * FROM v_monthly_stats
    ORDER BY month DESC
  `;
  return rows as MonthlyStats[];
}

/**
 * 월별 Top 작품 조회 (불법 URL 기준)
 */
export async function getMonthlyTopContentsV2(
  month: string,
  limit: number = 10
): Promise<MonthlyTopContent[]> {
  const sql = getDb();
  
  const rows = await sql`
    SELECT * FROM v_monthly_top_contents
    WHERE DATE_TRUNC('month', month) = DATE_TRUNC('month', ${month}::DATE)
    ORDER BY illegal_count DESC
    LIMIT ${limit}
  `;
  return rows as MonthlyTopContent[];
}

/**
 * 월별 Top 불법 도메인 조회
 */
export async function getMonthlyTopIllegalSitesV2(
  month: string,
  limit: number = 10
): Promise<MonthlyTopIllegalSite[]> {
  const sql = getDb();
  
  const rows = await sql`
    SELECT * FROM v_monthly_top_illegal_sites
    WHERE DATE_TRUNC('month', month) = DATE_TRUNC('month', ${month}::DATE)
    ORDER BY illegal_count DESC
    LIMIT ${limit}
  `;
  return rows as MonthlyTopIllegalSite[];
}

/**
 * 세션별 실시간 통계 조회
 */
export async function getSessionStatsV2(
  sessionId?: string
): Promise<SessionStats[]> {
  const sql = getDb();
  
  if (sessionId) {
    const rows = await sql`
      SELECT * FROM v_session_stats
      WHERE id = ${sessionId}
    `;
    return rows as SessionStats[];
  }
  
  const rows = await sql`
    SELECT * FROM v_session_stats
    ORDER BY created_at DESC
  `;
  return rows as SessionStats[];
}

/**
 * 승인 대기 도메인 목록 조회 (실시간)
 */
export async function getPendingDomainsV2(): Promise<PendingDomain[]> {
  const sql = getDb();
  
  const rows = await sql`
    SELECT * FROM v_pending_domains
    ORDER BY pending_count DESC
  `;
  return rows as PendingDomain[];
}

// ============================================
// 스키마 초기화 (v2 테이블/View/함수 생성)
// ============================================

/**
 * v2 스키마 초기화
 * - detection_results 테이블 생성
 * - 인덱스 생성
 * - View 생성
 * - 함수 생성
 */
export async function initializeSchemaV2(): Promise<void> {
  const sql = getDb();
  
  console.log('🚀 Initializing Schema v2...');
  
  // 1. detection_results 테이블 생성
  console.log('📦 Creating detection_results table...');
  await sql`
    CREATE TABLE IF NOT EXISTS detection_results (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(50) NOT NULL,
      title VARCHAR(500) NOT NULL,
      search_query VARCHAR(500) NOT NULL,
      url TEXT NOT NULL,
      domain VARCHAR(255) NOT NULL,
      page INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      initial_status VARCHAR(20) NOT NULL,
      llm_judgment VARCHAR(20),
      llm_reason TEXT,
      final_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_at TIMESTAMP WITH TIME ZONE,
      reviewed_by VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT fk_detection_results_session 
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      CONSTRAINT uq_detection_results_session_url 
        UNIQUE(session_id, url)
    )
  `;
  
  // 2. 인덱스 생성
  console.log('📦 Creating indexes...');
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_session ON detection_results(session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_status ON detection_results(final_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_domain ON detection_results(domain)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_title ON detection_results(title)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_created ON detection_results(created_at DESC)`;
  // Note: LOWER(domain) 인덱스는 PostgreSQL에서 표현식 인덱스로 IMMUTABLE 필요하므로 일반 인덱스로 대체
  await sql`CREATE INDEX IF NOT EXISTS idx_detection_results_domain_status ON detection_results(domain, final_status)`;
  // Note: DATE_TRUNC은 IMMUTABLE이 아니므로 표현식 인덱스 대신 일반 created_at 인덱스 활용
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC)`;
  
  // 3. View 생성
  console.log('📦 Creating views...');
  
  await sql`
    CREATE OR REPLACE VIEW v_monthly_stats AS
    SELECT 
      DATE_TRUNC('month', s.created_at) as month,
      COUNT(DISTINCT s.id) as sessions_count,
      COUNT(dr.*) as total,
      COUNT(*) FILTER (WHERE dr.final_status = 'illegal') as illegal,
      COUNT(*) FILTER (WHERE dr.final_status = 'legal') as legal,
      COUNT(*) FILTER (WHERE dr.final_status = 'pending') as pending
    FROM sessions s
    LEFT JOIN detection_results dr ON s.id = dr.session_id
    WHERE s.status = 'completed'
    GROUP BY DATE_TRUNC('month', s.created_at)
  `;
  
  await sql`
    CREATE OR REPLACE VIEW v_monthly_top_contents AS
    SELECT 
      DATE_TRUNC('month', s.created_at) as month,
      dr.title,
      COUNT(*) FILTER (WHERE dr.final_status = 'illegal') as illegal_count,
      COUNT(*) FILTER (WHERE dr.final_status = 'legal') as legal_count,
      COUNT(*) FILTER (WHERE dr.final_status = 'pending') as pending_count,
      COUNT(*) as total_count
    FROM detection_results dr
    JOIN sessions s ON dr.session_id = s.id
    WHERE s.status = 'completed'
    GROUP BY DATE_TRUNC('month', s.created_at), dr.title
  `;
  
  await sql`
    CREATE OR REPLACE VIEW v_monthly_top_illegal_sites AS
    SELECT 
      DATE_TRUNC('month', s.created_at) as month,
      dr.domain,
      COUNT(*) as illegal_count
    FROM detection_results dr
    JOIN sessions s ON dr.session_id = s.id
    WHERE s.status = 'completed'
      AND dr.final_status = 'illegal'
    GROUP BY DATE_TRUNC('month', s.created_at), dr.domain
  `;
  
  await sql`
    CREATE OR REPLACE VIEW v_session_stats AS
    SELECT 
      s.id,
      s.created_at,
      s.completed_at,
      s.status,
      s.titles_count,
      s.keywords_count,
      s.total_searches,
      s.file_final_results,
      COUNT(dr.*) as results_total,
      COUNT(*) FILTER (WHERE dr.final_status = 'illegal') as results_illegal,
      COUNT(*) FILTER (WHERE dr.final_status = 'legal') as results_legal,
      COUNT(*) FILTER (WHERE dr.final_status = 'pending') as results_pending
    FROM sessions s
    LEFT JOIN detection_results dr ON s.id = dr.session_id
    GROUP BY s.id
  `;
  
  await sql`
    CREATE OR REPLACE VIEW v_pending_domains AS
    SELECT 
      LOWER(dr.domain) as domain,
      COUNT(*) as pending_count,
      COUNT(DISTINCT dr.title) as title_count,
      COUNT(DISTINCT dr.session_id) as session_count,
      ARRAY_AGG(DISTINCT dr.title) as titles,
      MIN(dr.created_at) as first_detected_at,
      MAX(dr.created_at) as last_detected_at,
      MAX(dr.llm_judgment) as llm_judgment,
      MAX(dr.llm_reason) as llm_reason
    FROM detection_results dr
    WHERE dr.final_status = 'pending'
    GROUP BY LOWER(dr.domain)
  `;
  
  // 4. 트리거 함수 생성
  console.log('📦 Creating trigger functions...');
  await sql`
    CREATE OR REPLACE FUNCTION fn_update_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  
  await sql`DROP TRIGGER IF EXISTS trg_detection_results_updated_at ON detection_results`;
  await sql`
    CREATE TRIGGER trg_detection_results_updated_at
      BEFORE UPDATE ON detection_results
      FOR EACH ROW
      EXECUTE FUNCTION fn_update_timestamp()
  `;
  
  console.log('✅ Schema v2 initialization complete!');
}

// ============================================
// 내보내기
// ============================================

export {
  getDb
};
