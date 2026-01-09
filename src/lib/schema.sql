-- ============================================
-- Jobdori Database Schema
-- Neon PostgreSQL
-- ============================================

-- 모니터링 세션 테이블
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(50) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'running',
  titles_count INTEGER DEFAULT 0,
  keywords_count INTEGER DEFAULT 0,
  total_searches INTEGER DEFAULT 0,
  results_total INTEGER DEFAULT 0,
  results_illegal INTEGER DEFAULT 0,
  results_legal INTEGER DEFAULT 0,
  results_pending INTEGER DEFAULT 0,
  file_final_results VARCHAR(500)
);

-- 월별 통계 테이블
CREATE TABLE IF NOT EXISTS monthly_stats (
  id SERIAL PRIMARY KEY,
  month VARCHAR(7) NOT NULL UNIQUE,
  sessions_count INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  illegal INTEGER DEFAULT 0,
  legal INTEGER DEFAULT 0,
  pending INTEGER DEFAULT 0,
  top_contents JSONB DEFAULT '[]',
  top_illegal_sites JSONB DEFAULT '[]',
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 사이트 목록 테이블 (불법/합법)
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('illegal', 'legal')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(domain, type)
);

-- 작품 목록 테이블
CREATE TABLE IF NOT EXISTS titles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL UNIQUE,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 승인 대기 항목 테이블
CREATE TABLE IF NOT EXISTS pending_reviews (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  urls JSONB DEFAULT '[]',
  titles JSONB DEFAULT '[]',
  llm_judgment VARCHAR(20),
  llm_reason TEXT,
  session_id VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_monthly_stats_month ON monthly_stats(month);
CREATE INDEX IF NOT EXISTS idx_sites_type ON sites(type);
CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_titles_is_current ON titles(is_current);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_domain ON pending_reviews(domain);
