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
  id: string;
  domain: string;
  urls: string[];
  titles: string[];
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain';
  llm_reason: string;
  created_at: string;
  session_id?: string;  // 해당 항목이 생성된 세션 ID
}

/**
 * 모니터링 세션 (회차) 정보
 */
export interface MonitoringSession {
  id: string;                    // 세션 ID (타임스탬프 기반)
  created_at: string;            // 세션 생성 시간
  completed_at: string | null;   // 세션 완료 시간
  status: 'running' | 'completed' | 'error';  // 세션 상태
  
  // 실행 설정
  titles_count: number;          // 검색한 작품 수
  keywords_count: number;        // 키워드 수
  total_searches: number;        // 총 검색 횟수
  
  // 결과 요약
  results_summary: {
    total: number;               // 총 결과 수
    illegal: number;             // 불법 판정
    legal: number;               // 합법 판정
    pending: number;             // 승인 대기
  };
  
  // 파일 경로
  files: {
    search_results: string;      // 검색 결과 JSON
    classified_results: string;  // 1차 판별 결과
    llm_judged_results: string;  // 2차 판별 결과
    final_results: string;       // 최종 결과 JSON
    excel_report?: string;       // Excel 리포트 (optional - 다운로드 시 실시간 생성)
  };
}

/**
 * 세션 목록 파일 구조
 */
export interface SessionsData {
  sessions: MonitoringSession[];
  last_updated: string;
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

/**
 * 승인 처리 결과
 */
export interface ReviewAction {
  domain: string;
  action: 'approve' | 'reject' | 'hold';
  reviewed_at: string;
  session_id?: string;
}
