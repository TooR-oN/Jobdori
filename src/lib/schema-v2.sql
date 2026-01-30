-- ============================================
-- Jobdori Database Schema v2
-- 데이터베이스 정규화 및 고도화
-- 작성일: 2026-01-30
-- ============================================

-- ============================================
-- PART 1: 신규 테이블 생성
-- ============================================

-- detection_results: 모든 탐지 결과를 개별 Row로 저장
-- (단일 진실 공급원 - Single Source of Truth)
CREATE TABLE IF NOT EXISTS detection_results (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) NOT NULL,
  
  -- 검색 정보
  title VARCHAR(500) NOT NULL,
  search_query VARCHAR(500) NOT NULL,
  
  -- URL 정보
  url TEXT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  page INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  
  -- 판별 결과
  initial_status VARCHAR(20) NOT NULL,    -- 'illegal' | 'legal' | 'unknown'
  llm_judgment VARCHAR(20),               -- 'likely_illegal' | 'likely_legal' | 'uncertain'
  llm_reason TEXT,
  
  -- 최종 상태 (단일 진실 공급원)
  final_status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'illegal' | 'legal' | 'pending'
  
  -- 관리자 처리
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by VARCHAR(100),
  
  -- 메타데이터
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT fk_detection_results_session 
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT uq_detection_results_session_url 
    UNIQUE(session_id, url),
  CONSTRAINT chk_detection_results_initial_status 
    CHECK (initial_status IN ('illegal', 'legal', 'unknown')),
  CONSTRAINT chk_detection_results_final_status 
    CHECK (final_status IN ('illegal', 'legal', 'pending')),
  CONSTRAINT chk_detection_results_llm_judgment 
    CHECK (llm_judgment IS NULL OR llm_judgment IN ('likely_illegal', 'likely_legal', 'uncertain'))
);

-- 테이블 코멘트
COMMENT ON TABLE detection_results IS '모든 탐지 결과를 개별 Row로 저장하는 정규화된 테이블 (v2)';
COMMENT ON COLUMN detection_results.initial_status IS '1차 판별 결과: illegal(불법), legal(합법), unknown(미분류)';
COMMENT ON COLUMN detection_results.final_status IS '최종 상태: illegal(불법확정), legal(합법확정), pending(승인대기)';
COMMENT ON COLUMN detection_results.reviewed_at IS '관리자 승인/반려 처리 시각 (소급 업데이트 시에도 갱신됨)';

-- ============================================
-- PART 2: 인덱스 생성
-- ============================================

-- 기본 인덱스
CREATE INDEX IF NOT EXISTS idx_detection_results_session 
  ON detection_results(session_id);

CREATE INDEX IF NOT EXISTS idx_detection_results_status 
  ON detection_results(final_status);

CREATE INDEX IF NOT EXISTS idx_detection_results_domain 
  ON detection_results(domain);

CREATE INDEX IF NOT EXISTS idx_detection_results_title 
  ON detection_results(title);

CREATE INDEX IF NOT EXISTS idx_detection_results_created 
  ON detection_results(created_at DESC);

-- 도메인 + 상태 복합 인덱스 (소급 업데이트 쿼리 최적화)
-- WHERE LOWER(domain) = 'xxx' AND final_status = 'pending' 쿼리 최적화
CREATE INDEX IF NOT EXISTS idx_detection_results_domain_status 
  ON detection_results(LOWER(domain), final_status);

-- sessions 테이블에 DATE_TRUNC 인덱스 추가 (월별 통계 View 최적화)
CREATE INDEX IF NOT EXISTS idx_sessions_created_month 
  ON sessions(DATE_TRUNC('month', created_at));

-- ============================================
-- PART 3: 실시간 집계 View (DATE_TRUNC 버전)
-- ============================================

-- 월별 작품별 불법 URL 통계 (top_contents 대체)
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
GROUP BY DATE_TRUNC('month', s.created_at), dr.title;

COMMENT ON VIEW v_monthly_top_contents IS '월별 작품별 통계 (실시간 집계, monthly_stats.top_contents 대체)';

-- 월별 불법 도메인 통계 (top_illegal_sites 대체)
CREATE OR REPLACE VIEW v_monthly_top_illegal_sites AS
SELECT 
  DATE_TRUNC('month', s.created_at) as month,
  dr.domain,
  COUNT(*) as illegal_count
FROM detection_results dr
JOIN sessions s ON dr.session_id = s.id
WHERE s.status = 'completed'
  AND dr.final_status = 'illegal'
GROUP BY DATE_TRUNC('month', s.created_at), dr.domain;

COMMENT ON VIEW v_monthly_top_illegal_sites IS '월별 불법 도메인별 통계 (실시간 집계, monthly_stats.top_illegal_sites 대체)';

-- 월별 전체 통계 (monthly_stats 대체)
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
GROUP BY DATE_TRUNC('month', s.created_at);

COMMENT ON VIEW v_monthly_stats IS '월별 전체 통계 (실시간 집계, monthly_stats 테이블 대체)';

-- 세션별 통계 (sessions 테이블의 results_* 컬럼 대체)
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
GROUP BY s.id;

COMMENT ON VIEW v_session_stats IS '세션별 실시간 통계 (sessions.results_* 컬럼 대체)';

-- 도메인별 승인 대기 현황 (pending_reviews 테이블 보완)
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
ORDER BY pending_count DESC;

COMMENT ON VIEW v_pending_domains IS '도메인별 승인 대기 현황 (pending_reviews 테이블 보완)';

-- ============================================
-- PART 4: 도메인 승인/반려 처리 함수
-- (소급 업데이트 포함)
-- ============================================

-- 도메인 승인/반려 처리 함수 (트랜잭션 보장)
CREATE OR REPLACE FUNCTION fn_approve_domain(
  p_domain VARCHAR(255),
  p_action VARCHAR(10),           -- 'approve' (불법) | 'reject' (합법)
  p_reviewed_by VARCHAR(100) DEFAULT NULL
)
RETURNS TABLE (
  affected_sites INTEGER,
  affected_detection_results INTEGER
) AS $$
DECLARE
  v_site_type VARCHAR(10);
  v_final_status VARCHAR(20);
  v_sites_count INTEGER := 0;
  v_results_count INTEGER := 0;
  v_normalized_domain VARCHAR(255);
BEGIN
  -- 도메인 정규화
  v_normalized_domain := LOWER(TRIM(p_domain));
  
  -- 액션에 따른 상태값 설정
  IF p_action = 'approve' THEN
    v_site_type := 'illegal';
    v_final_status := 'illegal';
  ELSIF p_action = 'reject' THEN
    v_site_type := 'legal';
    v_final_status := 'legal';
  ELSE
    RAISE EXCEPTION 'Invalid action: %. Must be "approve" or "reject"', p_action;
  END IF;

  -- (A) sites 테이블에 도메인 추가
  INSERT INTO sites (domain, type)
  VALUES (v_normalized_domain, v_site_type)
  ON CONFLICT (domain, type) DO NOTHING;
  
  GET DIAGNOSTICS v_sites_count = ROW_COUNT;

  -- (B) detection_results의 해당 도메인 모든 pending → 상태 변경 (소급 업데이트)
  UPDATE detection_results
  SET 
    final_status = v_final_status,
    reviewed_at = NOW(),
    reviewed_by = p_reviewed_by,
    updated_at = NOW()
  WHERE LOWER(domain) = v_normalized_domain
    AND final_status = 'pending';
  
  GET DIAGNOSTICS v_results_count = ROW_COUNT;

  -- (C) pending_reviews 테이블에서 해당 도메인 제거 (기존 호환성)
  DELETE FROM pending_reviews 
  WHERE LOWER(domain) = v_normalized_domain;

  -- 결과 반환
  RETURN QUERY SELECT v_sites_count, v_results_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_approve_domain IS '도메인 승인/반려 처리 (소급 업데이트 포함). approve=불법확정, reject=합법확정';

-- ============================================
-- PART 5: 유틸리티 함수
-- ============================================

-- updated_at 자동 갱신 트리거 함수
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- detection_results 테이블에 트리거 적용
DROP TRIGGER IF EXISTS trg_detection_results_updated_at ON detection_results;
CREATE TRIGGER trg_detection_results_updated_at
  BEFORE UPDATE ON detection_results
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_timestamp();

-- ============================================
-- PART 6: 마이그레이션 헬퍼 함수
-- ============================================

-- 기존 Blob 데이터를 detection_results로 마이그레이션하는 함수
-- (실제 마이그레이션은 TypeScript에서 수행, 이 함수는 보조용)
CREATE OR REPLACE FUNCTION fn_bulk_insert_detection_results(
  p_data JSONB
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO detection_results (
    session_id, title, search_query, url, domain, page, rank,
    initial_status, llm_judgment, llm_reason, final_status, reviewed_at
  )
  SELECT 
    (item->>'session_id')::VARCHAR(50),
    (item->>'title')::VARCHAR(500),
    (item->>'search_query')::VARCHAR(500),
    (item->>'url')::TEXT,
    (item->>'domain')::VARCHAR(255),
    (item->>'page')::INTEGER,
    (item->>'rank')::INTEGER,
    (item->>'status')::VARCHAR(20),
    (item->>'llm_judgment')::VARCHAR(20),
    (item->>'llm_reason')::TEXT,
    (item->>'final_status')::VARCHAR(20),
    (item->>'reviewed_at')::TIMESTAMP WITH TIME ZONE
  FROM jsonb_array_elements(p_data) AS item
  ON CONFLICT (session_id, url) DO NOTHING;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_bulk_insert_detection_results IS '대량 데이터 삽입용 헬퍼 함수 (마이그레이션용)';
