/**
 * 사이트 집중 모니터링 (Deep Monitoring)
 * 
 * 세션의 detection_results를 분석하여:
 * 1. 작품×도메인별 고유 URL 합산 (비공식→공식 타이틀 병합)
 * 2. 승인 대기에서 최종 불법인 도메인만 필터
 * 3. 임계치(≥5 URL)에 도달한 도메인 선별
 * 4. 최다 URL 키워드 조합으로 site: 쿼리 생성
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import {
  DeepMonitoringTarget,
  DeepTargetResult,
  KeywordBreakdown,
  SearchResult,
  ClassifiedResult,
  LLMJudgedResult,
  FinalResult,
  Config,
} from './types/index.js';
import { executeSearch } from './search.js';
import { classifyResults } from './classify.js';
import { runLLMJudge } from './llm-judge.js';
import { loadConfig, getCurrentISOTime } from './utils.js';

// ============================================
// 상수
// ============================================

/** 집중 모니터링 대상 선정 기준: 도메인별 최소 고유 URL 수 */
const MIN_URL_THRESHOLD = 5;

// ============================================
// DB 연결
// ============================================

let dbInstance: ReturnType<typeof neon> | null = null;

function getDb() {
  if (!dbInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    dbInstance = neon(process.env.DATABASE_URL);
  }
  return dbInstance;
}

// ============================================
// 타입 정의 (내부용)
// ============================================

/** detection_results 행 (쿼리 결과) */
interface DetectionRow {
  title: string;
  domain: string;
  url: string;
  search_query: string;
  final_status: string;
  initial_status: string;
  llm_judgment: string | null;
}

/** 도메인 분석 중간 결과 */
interface DomainAnalysis {
  title: string;       // 공식 작품명
  domain: string;
  uniqueUrls: Set<string>;
  keywordBreakdown: Map<string, Set<string>>; // search_query → 고유 URL set
}

// ============================================
// 핵심 알고리즘: 대상 식별
// ============================================

/**
 * 세션의 detection_results를 분석하여 집중 모니터링 대상 식별
 * 
 * 흐름:
 * 1. DB에서 작품별 비공식 타이틀 맵핑 로드
 * 2. 세션의 detection_results 전체 조회
 * 3. 승인 대기에서 최종 불법 판정 도메인 필터 (sites 테이블의 illegal 도메인)
 * 4. 작품×도메인별 고유 URL 합산 (비공식→공식 타이틀 병합)
 * 5. 임계치(≥5) 도달 도메인 선별
 * 6. 최다 URL 키워드 조합으로 site: 쿼리 생성
 */
export async function scanDeepMonitoringTargets(
  sessionId: string
): Promise<DeepMonitoringTarget[]> {
  const sql = getDb();

  console.log(`\n🔍 [집중 모니터링] 대상 검색 시작 - 세션: ${sessionId}`);

  // ---- Step 1: 작품별 비공식 타이틀 맵핑 로드 ----
  const titleMappings = await loadTitleMappings(sql);
  console.log(`📖 작품 맵핑 로드: ${titleMappings.size}개 작품`);

  // ---- Step 2: 세션의 detection_results 전체 조회 ----
  const detectionRows = await sql`
    SELECT title, domain, url, search_query, final_status, initial_status, llm_judgment
    FROM detection_results
    WHERE session_id = ${sessionId}
  ` as DetectionRow[];

  console.log(`📊 detection_results: ${detectionRows.length}건 로드`);

  if (detectionRows.length === 0) {
    console.log('⚠️ 세션에 detection_results가 없습니다.');
    return [];
  }

  // ---- Step 3: 불법 도메인 목록 로드 (승인 대기에서 최종 불법) ----
  const illegalDomains = await loadIllegalDomains(sql);
  console.log(`🚫 불법 도메인 목록: ${illegalDomains.size}개`);

  // ---- Step 4: 작품×도메인별 고유 URL 합산 ----
  const domainAnalysisMap = buildDomainAnalysis(
    detectionRows,
    titleMappings,
    illegalDomains
  );

  console.log(`📋 분석된 작품×도메인 조합: ${domainAnalysisMap.size}개`);

  // ---- Step 5: 임계치(≥5) 도달 도메인 선별 + 쿼리 생성 ----
  const targets = buildTargets(sessionId, domainAnalysisMap);

  console.log(`\n✅ [집중 모니터링] 대상 ${targets.length}건 식별 완료`);
  for (const t of targets) {
    console.log(`   🎯 ${t.title} × ${t.domain}: ${t.url_count}개 URL → "${t.deep_query}"`);
  }

  return targets;
}

// ============================================
// 보조 함수
// ============================================

/**
 * DB에서 작품별 비공식 타이틀 역맵핑 로드
 * 결과: 모든 이름(공식+비공식, 소문자) → 공식 타이틀
 */
async function loadTitleMappings(
  sql: ReturnType<typeof neon>
): Promise<Map<string, string>> {
  const rows = await sql`
    SELECT name, unofficial_titles
    FROM titles
    WHERE is_current = true
  ` as any[];

  // 역방향 맵: 모든 이름(소문자) → 공식명
  const reverseMap = new Map<string, string>();

  for (const row of rows) {
    const official = row.name as string;
    const unofficials = (row.unofficial_titles as string[] | null) || [];
    const allNames = [official, ...unofficials];

    // 역방향 맵핑: 모든 이름 → 공식명
    for (const name of allNames) {
      reverseMap.set(name.toLowerCase(), official);
    }
  }

  return reverseMap;
}

/**
 * 이름으로 공식 타이틀을 찾는 함수 (대소문자 무시)
 */
function resolveOfficialTitle(
  title: string,
  reverseLookup: Map<string, string>
): string {
  return reverseLookup.get(title.toLowerCase()) || title;
}

/**
 * 불법 도메인 목록 로드 (sites 테이블에서 type='illegal')
 */
async function loadIllegalDomains(
  sql: ReturnType<typeof neon>
): Promise<Set<string>> {
  const rows = await sql`SELECT domain FROM sites WHERE type = 'illegal'` as any[];
  return new Set(rows.map((r: any) => (r.domain as string).toLowerCase()));
}

/**
 * detection_results를 작품×도메인별로 분석
 * - 비공식 타이틀 → 공식 타이틀로 병합
 * - 불법 도메인만 필터
 * - search_query별 고유 URL 집계
 */
function buildDomainAnalysis(
  rows: DetectionRow[],
  titleReverseLookup: Map<string, string>,
  illegalDomains: Set<string>,
): Map<string, DomainAnalysis> {
  const analysisMap = new Map<string, DomainAnalysis>();

  for (const row of rows) {
    const domain = row.domain.toLowerCase();

    // 불법 도메인만 대상 (sites 테이블에 등록된 illegal 도메인)
    if (!illegalDomains.has(domain)) {
      continue;
    }

    // 비공식 타이틀 → 공식 타이틀로 변환
    const officialTitle = resolveOfficialTitle(row.title, titleReverseLookup);

    // 작품×도메인 키 생성
    const key = `${officialTitle}|||${domain}`;

    if (!analysisMap.has(key)) {
      analysisMap.set(key, {
        title: officialTitle,
        domain,
        uniqueUrls: new Set<string>(),
        keywordBreakdown: new Map<string, Set<string>>(),
      });
    }

    const analysis = analysisMap.get(key)!;

    // 고유 URL 추가
    analysis.uniqueUrls.add(row.url);

    // 키워드별 URL 집계
    const query = row.search_query;
    if (!analysis.keywordBreakdown.has(query)) {
      analysis.keywordBreakdown.set(query, new Set<string>());
    }
    analysis.keywordBreakdown.get(query)!.add(row.url);
  }

  return analysisMap;
}

/**
 * 임계치를 넘는 대상만 선별하고 심층 검색 쿼리 생성
 */
function buildTargets(
  sessionId: string,
  analysisMap: Map<string, DomainAnalysis>
): DeepMonitoringTarget[] {
  const targets: DeepMonitoringTarget[] = [];

  for (const [, analysis] of analysisMap) {
    const urlCount = analysis.uniqueUrls.size;

    // 임계치 미달 → 제외
    if (urlCount < MIN_URL_THRESHOLD) {
      continue;
    }

    // 키워드별 URL 수 내역 + 최다 키워드 찾기
    let bestKeyword = '';
    let bestKeywordUrls = 0;
    const breakdowns: KeywordBreakdown[] = [];

    for (const [keyword, urls] of analysis.keywordBreakdown) {
      const count = urls.size;
      breakdowns.push({ keyword, urls: count });

      if (count > bestKeywordUrls) {
        bestKeywordUrls = count;
        bestKeyword = keyword;
      }
    }

    // 내림차순 정렬
    breakdowns.sort((a, b) => b.urls - a.urls);

    // 심층 검색 쿼리 생성: "{최다 키워드} site:{도메인}"
    const deepQuery = `${bestKeyword} site:${analysis.domain}`;

    targets.push({
      session_id: sessionId,
      title: analysis.title,
      domain: analysis.domain,
      url_count: urlCount,
      base_keyword: bestKeyword,
      deep_query: deepQuery,
      status: 'pending',
      results_count: 0,
      new_urls_count: 0,
      keyword_breakdown: breakdowns,
    });
  }

  // URL 수 내림차순 정렬
  targets.sort((a, b) => b.url_count - a.url_count);

  return targets;
}

// ============================================
// 대상 저장 (DB)
// ============================================

/**
 * 식별된 대상을 deep_monitoring_targets 테이블에 저장
 * 기존 대상이 있으면 삭제 후 재생성 (re-scan)
 */
export async function saveDeepMonitoringTargets(
  sessionId: string,
  targets: DeepMonitoringTarget[]
): Promise<DeepMonitoringTarget[]> {
  const sql = getDb();

  console.log(`\n💾 [집중 모니터링] 대상 ${targets.length}건 DB 저장 시작`);

  // 기존 대상 삭제 (re-scan)
  await sql`DELETE FROM deep_monitoring_targets WHERE session_id = ${sessionId}`;

  const savedTargets: DeepMonitoringTarget[] = [];

  for (const target of targets) {
    const rows = await sql`
      INSERT INTO deep_monitoring_targets
        (session_id, title, domain, url_count, base_keyword, deep_query, status)
      VALUES (
        ${target.session_id}, ${target.title}, ${target.domain},
        ${target.url_count}, ${target.base_keyword}, ${target.deep_query},
        'pending'
      )
      RETURNING *
    ` as any[];
    const saved = rows[0] as DeepMonitoringTarget;
    // keyword_breakdown은 DB에 저장하지 않으므로 원본에서 복사
    (saved as any).keyword_breakdown = target.keyword_breakdown;
    savedTargets.push(saved);
  }

  console.log(`✅ [집중 모니터링] ${savedTargets.length}건 저장 완료`);
  return savedTargets;
}

// ============================================
// 통합 scan 함수 (API에서 호출)
// ============================================

/**
 * 대상 검색 + DB 저장 통합 함수
 * 프론트에서 "대상 검색 실행" 버튼 클릭 시 호출
 */
export async function scanAndSaveTargets(
  sessionId: string
): Promise<{
  targets: DeepMonitoringTarget[];
  summary: {
    total_targets: number;
    total_estimated_api_calls: number;
    domains: string[];
  };
}> {
  // 1. 대상 식별
  const targets = await scanDeepMonitoringTargets(sessionId);

  if (targets.length === 0) {
    return {
      targets: [],
      summary: {
        total_targets: 0,
        total_estimated_api_calls: 0,
        domains: [],
      },
    };
  }

  // 2. DB 저장
  const savedTargets = await saveDeepMonitoringTargets(sessionId, targets);

  // 3. 요약 생성
  const summary = {
    total_targets: savedTargets.length,
    total_estimated_api_calls: savedTargets.length * 3, // 대상당 3페이지
    domains: savedTargets.map(t => t.domain),
  };

  return { targets: savedTargets, summary };
}

// ============================================
// Phase 3: 심층 검색 실행 로직
// ============================================

/**
 * 진행 상태 콜백 타입 (API 폴링용)
 */
export interface DeepMonitoringProgress {
  is_running: boolean;
  session_id: string | null;
  total_targets: number;
  completed_targets: number;
  current_target: string | null;
  results_so_far: DeepTargetResult[];
}

/** 모듈 레벨 실행 상태 (동시 실행 방지) */
let _currentProgress: DeepMonitoringProgress | null = null;

export function getDeepMonitoringProgress(): DeepMonitoringProgress | null {
  return _currentProgress;
}

/**
 * 단일 대상에 대해 심층 검색 실행
 * search.ts의 executeSearch()를 재사용
 */
async function executeDeepSearchForTarget(
  target: DeepMonitoringTarget,
  config: Config
): Promise<SearchResult[]> {
  console.log(`\n  🎯 심층 검색: "${target.deep_query}"`);

  const results = await executeSearch(
    target.deep_query,
    target.title,  // 공식 타이틀로 결과 기록
    config
  );

  console.log(`  📊 검색 결과: ${results.length}개 URL`);
  return results;
}

/**
 * 기존 세션 URL 로드 (중복 제거용)
 */
async function loadExistingSessionUrls(
  sql: ReturnType<typeof neon>,
  sessionId: string
): Promise<Set<string>> {
  const rows = await sql`
    SELECT url FROM detection_results WHERE session_id = ${sessionId}
  ` as any[];
  return new Set(rows.map((r: any) => r.url as string));
}

/**
 * 불법/합법 사이트 목록 DB 로드
 */
async function loadSiteSets(sql: ReturnType<typeof neon>): Promise<{
  illegalSites: Set<string>;
  legalSites: Set<string>;
}> {
  const illegalRows = await sql`SELECT domain FROM sites WHERE type = 'illegal'` as any[];
  const legalRows = await sql`SELECT domain FROM sites WHERE type = 'legal'` as any[];
  return {
    illegalSites: new Set(illegalRows.map((r: any) => (r.domain as string).toLowerCase())),
    legalSites: new Set(legalRows.map((r: any) => (r.domain as string).toLowerCase())),
  };
}

/**
 * 최종 결과 생성 (run-pipeline.ts의 createFinalResults와 동일 로직)
 */
function createFinalResults(results: LLMJudgedResult[]): FinalResult[] {
  return results.map(result => {
    let final_status: 'illegal' | 'legal' | 'pending';
    if (result.status === 'illegal') {
      final_status = 'illegal';
    } else if (result.status === 'legal') {
      final_status = 'legal';
    } else {
      final_status = 'pending';
    }
    return {
      ...result,
      final_status,
      reviewed_at: result.status !== 'unknown' ? getCurrentISOTime() : null,
    };
  });
}

/**
 * 심층 검색 결과를 detection_results에 source='deep'으로 저장
 */
async function saveDeepResultsToDb(
  sql: ReturnType<typeof neon>,
  sessionId: string,
  targetId: number,
  finalResults: FinalResult[]
): Promise<number> {
  if (finalResults.length === 0) return 0;

  let inserted = 0;
  for (const r of finalResults) {
    try {
      await sql`
        INSERT INTO detection_results (
          session_id, title, url, domain,
          search_query, page, rank,
          initial_status, llm_judgment, llm_reason, final_status,
          reviewed_at, snippet, source, deep_target_id
        )
        VALUES (
          ${sessionId}, ${r.title}, ${r.url}, ${r.domain},
          ${r.search_query}, ${r.page}, ${r.rank},
          ${r.status}, ${r.llm_judgment || null}, ${r.llm_reason || null}, ${r.final_status},
          ${r.reviewed_at || null}, ${r.snippet || null}, 'deep', ${targetId}
        )
        ON CONFLICT (session_id, url) DO NOTHING
      `;
      inserted++;
    } catch (error) {
      // 중복 URL은 무시
    }
  }
  return inserted;
}

/**
 * 불법 URL을 신고결과 추적에 등록
 */
async function registerDeepIllegalUrls(
  sql: ReturnType<typeof neon>,
  sessionId: string,
  finalResults: FinalResult[]
): Promise<number> {
  const illegalResults = finalResults.filter(r => r.final_status === 'illegal');
  if (illegalResults.length === 0) return 0;

  // 신고 제외 URL 조회
  const excludedRows = await sql`SELECT url FROM excluded_urls` as any[];
  const excludedUrls = new Set(excludedRows.map((r: any) => r.url));

  let registered = 0;
  for (const result of illegalResults) {
    try {
      const isExcluded = excludedUrls.has(result.url);
      if (isExcluded) {
        await sql`
          INSERT INTO report_tracking (session_id, url, domain, title, report_status, reason)
          VALUES (${sessionId}, ${result.url}, ${result.domain}, ${result.title}, '미신고', '웹사이트 메인 페이지')
          ON CONFLICT (session_id, url) DO NOTHING
        `;
      } else {
        await sql`
          INSERT INTO report_tracking (session_id, url, domain, title, report_status)
          VALUES (${sessionId}, ${result.url}, ${result.domain}, ${result.title}, '미신고')
          ON CONFLICT (session_id, url) DO NOTHING
        `;
      }
      registered++;
    } catch {
      // 중복 무시
    }
  }
  return registered;
}

/**
 * 세션의 deep_monitoring 관련 컬럼 업데이트
 */
async function updateSessionDeepMonitoring(
  sql: ReturnType<typeof neon>,
  sessionId: string,
  targetsCount: number,
  newUrls: number
): Promise<void> {
  await sql`
    UPDATE sessions SET
      deep_monitoring_executed = true,
      deep_monitoring_targets_count = ${targetsCount},
      deep_monitoring_new_urls = ${newUrls}
    WHERE id = ${sessionId}
  `;
}

/**
 * Vercel Blob의 final-results.json 업데이트 (기존 + 신규 병합)
 */
async function updateBlobFinalResults(
  sessionId: string,
  newResults: FinalResult[]
): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    console.log('⚠️ BLOB_READ_WRITE_TOKEN 없음, Blob 업데이트 건너뜀');
    return;
  }

  try {
    // 기존 Blob에서 final-results 로드
    const blobUrl = `https://blob.vercel-storage.com/results/${sessionId}/final-results.json`;
    let existingResults: FinalResult[] = [];
    try {
      const res = await fetch(blobUrl);
      if (res.ok) {
        existingResults = await res.json();
      }
    } catch {
      console.log('⚠️ 기존 Blob 로드 실패, 신규 결과만 업로드');
    }

    // URL 기준 중복 제거 병합
    const urlSet = new Set(existingResults.map(r => r.url));
    const merged = [...existingResults];
    for (const r of newResults) {
      if (!urlSet.has(r.url)) {
        merged.push(r);
        urlSet.add(r.url);
      }
    }

    // 업로드
    await put(
      `results/${sessionId}/final-results.json`,
      JSON.stringify(merged, null, 2),
      { access: 'public', token: blobToken }
    );
    console.log(`✅ Blob 업데이트 완료: ${existingResults.length} + ${newResults.length} → ${merged.length}건`);
  } catch (error) {
    console.error('⚠️ Blob 업데이트 실패:', error);
  }
}

// ============================================
// 메인 실행 함수
// ============================================

/**
 * 선택된 대상에 대해 심층 모니터링 실행
 * 
 * 흐름 (대상별):
 * 1. executeSearch(deep_query, title, config) → SearchResult[]
 * 2. 기존 세션 URL과 중복 제거
 * 3. classifyResults(searchResults, illegal, legal) → ClassifiedResult[]
 * 4. runLLMJudge(classifiedResults) → LLMJudgedResult[] (unknown 0이면 skip)
 * 5. createFinalResults() → FinalResult[]
 * 6. detection_results에 source='deep'으로 INSERT
 * 7. report_tracking에 불법 URL 등록
 * 8. 세션 통계 업데이트
 */
export async function executeDeepMonitoring(
  sessionId: string,
  targetIds?: number[]  // 선택된 대상 ID (없으면 해당 세션의 pending 전체)
): Promise<{
  success: boolean;
  executed_targets: number;
  total_new_results: number;
  total_new_urls: number;
  results_per_target: DeepTargetResult[];
}> {
  const sql = getDb();

  // 동시 실행 방지
  if (_currentProgress && _currentProgress.is_running) {
    throw new Error('이미 집중 모니터링이 실행 중입니다.');
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🚀 [집중 모니터링] 심층 검색 실행 시작');
  console.log('═'.repeat(60));

  // 대상 로드
  let targets: DeepMonitoringTarget[];
  if (targetIds && targetIds.length > 0) {
    // 선택된 대상만
    const allTargets = await sql`
      SELECT * FROM deep_monitoring_targets
      WHERE session_id = ${sessionId} AND id = ANY(${targetIds})
      ORDER BY url_count DESC
    ` as any[] as DeepMonitoringTarget[];
    targets = allTargets;
  } else {
    // pending 상태 전체
    const allTargets = await sql`
      SELECT * FROM deep_monitoring_targets
      WHERE session_id = ${sessionId} AND status = 'pending'
      ORDER BY url_count DESC
    ` as any[] as DeepMonitoringTarget[];
    targets = allTargets;
  }

  if (targets.length === 0) {
    console.log('⚠️ 실행할 대상이 없습니다.');
    return {
      success: true,
      executed_targets: 0,
      total_new_results: 0,
      total_new_urls: 0,
      results_per_target: [],
    };
  }

  console.log(`📋 실행 대상: ${targets.length}건`);

  // 진행 상태 초기화
  _currentProgress = {
    is_running: true,
    session_id: sessionId,
    total_targets: targets.length,
    completed_targets: 0,
    current_target: null,
    results_so_far: [],
  };

  const config = loadConfig();
  const { illegalSites, legalSites } = await loadSiteSets(sql);
  const existingUrls = await loadExistingSessionUrls(sql, sessionId);
  const resultsPerTarget: DeepTargetResult[] = [];
  let totalNewResults = 0;
  let totalNewUrls = 0;
  let allNewFinalResults: FinalResult[] = [];

  try {
    for (const target of targets) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`🎯 대상: ${target.title} × ${target.domain}`);
      console.log(`   쿼리: "${target.deep_query}"`);

      _currentProgress.current_target = `${target.title} × ${target.domain}`;

      // 대상 상태: running
      await sql`
        UPDATE deep_monitoring_targets SET status = 'running', executed_at = NOW()
        WHERE id = ${target.id}
      `;

      try {
        // ---- Step 1: 심층 검색 ----
        const searchResults = await executeDeepSearchForTarget(target, config);

        // ---- Step 2: 기존 URL 중복 제거 ----
        const newSearchResults = searchResults.filter(r => !existingUrls.has(r.url));
        console.log(`  🆕 신규 URL: ${newSearchResults.length}개 (중복 제외: ${searchResults.length - newSearchResults.length}개)`);

        if (newSearchResults.length === 0) {
          // 검색 결과는 있었지만 모두 중복
          await sql`
            UPDATE deep_monitoring_targets SET
              status = 'completed',
              results_count = ${searchResults.length},
              new_urls_count = 0,
              completed_at = NOW()
            WHERE id = ${target.id}
          `;

          resultsPerTarget.push({
            target_id: target.id!,
            title: target.title,
            domain: target.domain,
            deep_query: target.deep_query,
            results_count: searchResults.length,
            new_urls_count: 0,
            illegal_count: 0,
            legal_count: 0,
            pending_count: 0,
          });

          _currentProgress.completed_targets++;
          continue;
        }

        // 신규 URL을 기존 Set에 추가 (다음 대상과도 중복 방지)
        for (const r of newSearchResults) {
          existingUrls.add(r.url);
        }

        // ---- Step 3: 1차 판별 (리스트 대조) ----
        const classifiedResults = classifyResults(newSearchResults, illegalSites, legalSites);

        // ---- Step 4: 2차 판별 (LLM) ----
        const unknownCount = classifiedResults.filter(r => r.status === 'unknown').length;
        let llmResults: LLMJudgedResult[];

        if (unknownCount === 0) {
          console.log('  ✅ unknown 도메인 0개 → LLM 판별 건너뜀');
          llmResults = classifiedResults.map(r => ({
            ...r,
            llm_judgment: null,
            llm_reason: null,
          }));
        } else {
          console.log(`  🤖 unknown 도메인 ${unknownCount}개 → LLM 판별 실행`);
          llmResults = await runLLMJudge(classifiedResults, sessionId);
        }

        // ---- Step 5: 최종 결과 생성 ----
        const finalResults = createFinalResults(llmResults);

        // ---- Step 6: DB 저장 (source='deep') ----
        const insertedCount = await saveDeepResultsToDb(sql, sessionId, target.id!, finalResults);
        console.log(`  💾 DB 저장: ${insertedCount}건 (source='deep')`);

        // ---- Step 7: 불법 URL 신고결과 추적 등록 ----
        const reportCount = await registerDeepIllegalUrls(sql, sessionId, finalResults);
        if (reportCount > 0) {
          console.log(`  📋 신고결과 추적: ${reportCount}건 등록`);
        }

        // 통계 집계
        const illegalCount = finalResults.filter(r => r.final_status === 'illegal').length;
        const legalCount = finalResults.filter(r => r.final_status === 'legal').length;
        const pendingCount = finalResults.filter(r => r.final_status === 'pending').length;

        // 대상 완료 업데이트
        await sql`
          UPDATE deep_monitoring_targets SET
            status = 'completed',
            results_count = ${searchResults.length},
            new_urls_count = ${newSearchResults.length},
            completed_at = NOW()
          WHERE id = ${target.id}
        `;

        const targetResult: DeepTargetResult = {
          target_id: target.id!,
          title: target.title,
          domain: target.domain,
          deep_query: target.deep_query,
          results_count: searchResults.length,
          new_urls_count: newSearchResults.length,
          illegal_count: illegalCount,
          legal_count: legalCount,
          pending_count: pendingCount,
        };

        resultsPerTarget.push(targetResult);
        totalNewResults += searchResults.length;
        totalNewUrls += newSearchResults.length;
        allNewFinalResults = allNewFinalResults.concat(finalResults);

        _currentProgress.completed_targets++;
        _currentProgress.results_so_far.push(targetResult);

        console.log(`  ✅ 완료: 불법 ${illegalCount} / 합법 ${legalCount} / 대기 ${pendingCount}`);

      } catch (targetError) {
        console.error(`  ❌ 대상 실행 실패:`, targetError);
        await sql`
          UPDATE deep_monitoring_targets SET status = 'failed', completed_at = NOW()
          WHERE id = ${target.id}
        `;
        resultsPerTarget.push({
          target_id: target.id!,
          title: target.title,
          domain: target.domain,
          deep_query: target.deep_query,
          results_count: 0,
          new_urls_count: 0,
          illegal_count: 0,
          legal_count: 0,
          pending_count: 0,
        });
        _currentProgress.completed_targets++;
      }
    }

    // ---- 전체 완료 후 처리 ----

    // 세션 deep_monitoring 컬럼 업데이트
    await updateSessionDeepMonitoring(sql, sessionId, targets.length, totalNewUrls);

    // 세션 results_summary 갱신 (detection_results 기준 재계산)
    await sql`
      UPDATE sessions SET
        results_total = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId}),
        results_illegal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'illegal'),
        results_legal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'legal'),
        results_pending = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'pending')
      WHERE id = ${sessionId}
    `;

    // Blob 업데이트 (기존 결과에 심층 결과 병합)
    if (allNewFinalResults.length > 0) {
      await updateBlobFinalResults(sessionId, allNewFinalResults);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ [집중 모니터링] 전체 실행 완료');
    console.log(`   대상: ${targets.length}건 | 신규 URL: ${totalNewUrls}개`);
    console.log('═'.repeat(60));

    return {
      success: true,
      executed_targets: targets.length,
      total_new_results: totalNewResults,
      total_new_urls: totalNewUrls,
      results_per_target: resultsPerTarget,
    };

  } finally {
    // 진행 상태 초기화
    _currentProgress = null;
  }
}

// ============================================
// 직접 실행 시 (테스트용)
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2]; // 'scan' or 'execute'
  const sessionId = process.argv[3];

  if (!command || !sessionId) {
    console.error('Usage:');
    console.error('  npx tsx deep-monitoring.ts scan <session_id>');
    console.error('  npx tsx deep-monitoring.ts execute <session_id>');
    process.exit(1);
  }

  if (command === 'scan') {
    scanAndSaveTargets(sessionId)
      .then(result => {
        console.log('\n📋 결과 요약:');
        console.log(JSON.stringify(result.summary, null, 2));
        console.log('\n📋 대상 목록:');
        for (const t of result.targets) {
          console.log(`  🎯 [${t.id}] ${t.title} × ${t.domain}`);
          console.log(`     URL: ${t.url_count}개 | 쿼리: "${t.deep_query}"`);
          if (t.keyword_breakdown) {
            for (const kb of t.keyword_breakdown) {
              console.log(`     - "${kb.keyword}": ${kb.urls}개 URL`);
            }
          }
        }
      })
      .catch(err => {
        console.error('❌ 오류:', err);
        process.exit(1);
      });
  } else if (command === 'execute') {
    executeDeepMonitoring(sessionId)
      .then(result => {
        console.log('\n📋 실행 결과:');
        console.log(JSON.stringify(result, null, 2));
      })
      .catch(err => {
        console.error('❌ 오류:', err);
        process.exit(1);
      });
  } else {
    console.error(`알 수 없는 명령: ${command}`);
    process.exit(1);
  }
}
