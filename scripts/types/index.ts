// ============================================
// 공용 타입 정의
// ============================================

/**
 * 검색 결과 (1단계)
 */
export interface SearchResult {
  title: string;           // 작품명
  domain: string;          // 메인 도메인
  url: string;             // 전체 URL
  search_query: string;    // 검색어
  page: number;            // 검색 결과 페이지 (1-3)
  rank: number;            // 전체 순위 (1-50)
}

/**
 * 1차 판별 결과 (2단계)
 */
export interface ClassifiedResult extends SearchResult {
  status: 'illegal' | 'legal' | 'unknown';  // 1차 판별 결과
}

/**
 * LLM 판별 결과 (3단계)
 */
export interface LLMJudgedResult extends ClassifiedResult {
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null;
  llm_reason: string | null;
}

/**
 * 최종 결과 (4단계)
 */
export interface FinalResult extends LLMJudgedResult {
  final_status: 'illegal' | 'legal' | 'pending';
  reviewed_at: string | null;
}

/**
 * 승인 대기 항목
 */
export interface PendingReviewItem {
  domain: string;
  urls: string[];
  titles: string[];
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain';
  llm_reason: string;
  created_at: string;
}

/**
 * 설정 파일 구조
 */
export interface Config {
  search: {
    delayBetweenSearches: { min: number; max: number };
    delayBetweenPages: { min: number; max: number };
    maxPages: number;
    resultsPerPage: number;
    maxResults: number;
  };
  llm: {
    model: string;
    maxTokens: number;
  };
  paths: {
    titlesFile: string;
    illegalSitesFile: string;
    legalSitesFile: string;
    criteriaFile: string;
    keywordsFile: string;
    pendingReviewFile: string;
    outputDir: string;
  };
}

/**
 * Excel 리포트 컬럼 순서
 */
export const REPORT_COLUMNS = [
  'title',
  'domain', 
  'url',
  'search_query',
  'page',
  'rank',
  'status',
  'llm_judgment',
  'llm_reason',
  'final_status',
  'reviewed_at'
] as const;
