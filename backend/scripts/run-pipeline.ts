import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import {
  SearchResult,
  ClassifiedResult,
  LLMJudgedResult,
  FinalResult,
  Config,
} from './types/index.js';
import { runSearch } from './search.js';
import { runClassify } from './classify.js';
import { runLLMJudge } from './llm-judge.js';
import {
  loadConfig,
  saveJson,
  getTimestamp,
  getCurrentISOTime,
} from './utils.js';
import {
  buildAnalysisPrompt,
  createAnalysisTask,
  DomainAnalysisResult,
  DomainWithType,
} from './domain-analysis.js';

/**
 * DB에서 사이트 목록 로드
 */
async function loadSitesFromDb(type: 'illegal' | 'legal'): Promise<Set<string>> {
  const sql = getDb();
  const rows = await sql`SELECT domain FROM sites WHERE type = ${type}`;
  return new Set(rows.map((r: any) => r.domain.toLowerCase()));
}

// ============================================
// Slack 알림 함수
// ============================================

async function sendSlackNotification(stats: {
  timestamp: string;
  total: number;
  illegal: number;
  legal: number;
  pending: number;
  duration: string;
}) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  
  if (!slackToken || !channelId) {
    console.log('⚠️ Slack 설정이 없어 알림을 건너뜁니다.');
    return;
  }
  
  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  });
  const timeStr = now.toLocaleTimeString('ko-KR', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  
  const message = {
    channel: channelId,
    text: `🚨 Jobdori 모니터링 완료`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 Jobdori 모니터링 완료',
          emoji: true
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📅 일시*\n${dateStr} ${timeStr}`
          },
          {
            type: 'mrkdwn',
            text: `*⏱️ 소요시간*\n${stats.duration}초`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📊 전체*\n${stats.total}개`
          },
          {
            type: 'mrkdwn',
            text: `*🔴 불법*\n${stats.illegal}개`
          },
          {
            type: 'mrkdwn',
            text: `*🟢 합법*\n${stats.legal}개`
          },
          {
            type: 'mrkdwn',
            text: `*🟡 대기*\n${stats.pending}개`
          }
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🔗 <https://jobdori.vercel.app|대시보드 바로가기>'
        }
      }
    ]
  };
  
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log('✅ Slack 알림 전송 완료');
    } else {
      console.error('❌ Slack 알림 실패:', result.error);
    }
  } catch (error) {
    console.error('❌ Slack 알림 오류:', error);
  }
}

// ============================================
// Database Functions
// ============================================

function getDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return neon(dbUrl);
}

// ============================================
// 최종 결과 생성 (FinalResult)
// ============================================

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

// ============================================
// detection_results 테이블에 결과 저장
// ============================================

async function saveDetectionResultsToDb(sessionId: string, finalResults: FinalResult[]) {
  const sql = getDb();

  console.log(`📋 Saving ${finalResults.length} results to detection_results...`);

  // 배열 준비 (snippet 포함)
  const sessionIds: string[] = [];
  const titles: string[] = [];
  const urls: string[] = [];
  const domains: string[] = [];
  const searchQueries: string[] = [];
  const pages: number[] = [];
  const ranks: number[] = [];
  const initialStatuses: string[] = [];
  const llmJudgments: (string | null)[] = [];
  const llmReasons: (string | null)[] = [];
  const finalStatuses: string[] = [];
  const reviewedAts: (string | null)[] = [];
  const snippets: (string | null)[] = [];

  for (const r of finalResults) {
    sessionIds.push(sessionId);
    titles.push(r.title);
    urls.push(r.url);
    domains.push(r.domain);
    searchQueries.push(r.search_query);
    pages.push(r.page);
    ranks.push(r.rank);
    initialStatuses.push(r.status);
    llmJudgments.push(r.llm_judgment || null);
    llmReasons.push(r.llm_reason || null);
    finalStatuses.push(r.final_status);
    reviewedAts.push(r.reviewed_at || null);
    snippets.push(r.snippet || null);
  }

  // UNNEST를 사용한 배치 INSERT (snippet 포함)
  try {
    await sql`
      INSERT INTO detection_results (
        session_id, title, url, domain, 
        search_query, page, rank,
        initial_status, llm_judgment, llm_reason, final_status,
        reviewed_at, snippet
      )
      SELECT * FROM UNNEST(
        ${sessionIds}::text[],
        ${titles}::text[],
        ${urls}::text[],
        ${domains}::text[],
        ${searchQueries}::text[],
        ${pages}::int[],
        ${ranks}::int[],
        ${initialStatuses}::text[],
        ${llmJudgments}::text[],
        ${llmReasons}::text[],
        ${finalStatuses}::text[],
        ${reviewedAts}::timestamptz[],
        ${snippets}::text[]
      )
      ON CONFLICT (session_id, url) DO NOTHING
    `;
    console.log(`✅ detection_results: ${finalResults.length} inserted`);
    return finalResults.length;
  } catch (error) {
    console.error('❌ detection_results INSERT failed:', error);
    return 0;
  }
}

// ============================================
// 승인 대기 항목 DB 저장
// ============================================

async function savePendingReviewsToDb(results: LLMJudgedResult[], sessionId: string) {
  const sql = getDb();
  
  // 도메인별로 그룹화
  const domainGroups = new Map<string, LLMJudgedResult[]>();
  
  for (const result of results) {
    if (result.status === 'unknown') {
      const domain = result.domain.toLowerCase();
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain)!.push(result);
    }
  }

  let savedCount = 0;
  
  for (const [domain, items] of Array.from(domainGroups.entries())) {
    const firstItem = items[0];
    const urls = Array.from(new Set(items.map(item => item.url)));
    const titles = Array.from(new Set(items.map(item => item.title)));

    try {
      await sql`
        INSERT INTO pending_reviews (domain, urls, titles, llm_judgment, llm_reason, session_id)
        VALUES (${domain}, ${JSON.stringify(urls)}, ${JSON.stringify(titles)}, 
                ${firstItem.llm_judgment}, ${firstItem.llm_reason || ''}, ${sessionId})
        ON CONFLICT (domain) DO UPDATE SET
          urls = EXCLUDED.urls,
          titles = EXCLUDED.titles,
          llm_judgment = EXCLUDED.llm_judgment,
          llm_reason = EXCLUDED.llm_reason,
          session_id = EXCLUDED.session_id
      `;
      savedCount++;
    } catch (error) {
      console.error(`Failed to save pending review for ${domain}:`, error);
    }
  }
  
  return savedCount;
}

// ============================================
// 불법 URL을 신고결과 추적 테이블에 등록
// ============================================

async function registerIllegalUrlsToReportTracking(sessionId: string, finalResults: FinalResult[]) {
  const sql = getDb();
  const illegalResults = finalResults.filter(r => r.final_status === 'illegal');
  
  console.log(`📋 Registering ${illegalResults.length} illegal URLs to report_tracking...`);
  
  // 신고 제외 URL 목록 조회
  const excludedRows = await sql`SELECT url FROM excluded_urls`;
  const excludedUrls = new Set(excludedRows.map((r: any) => r.url));
  console.log(`📋 Excluded URLs: ${excludedUrls.size}개`);
  
  // 이전 세션에서 중복 거부된 URL 목록 조회 (벌크)
  const urlList = illegalResults.map(r => r.url);
  const duplicateRejectedRows = urlList.length > 0
    ? await sql`
        SELECT DISTINCT url FROM report_tracking
        WHERE url = ANY(${urlList})
          AND session_id != ${sessionId}
          AND report_status = '거부'
          AND reason ILIKE '%중복%'
      `
    : [];
  const duplicateRejectedUrls = new Set((duplicateRejectedRows as any[]).map((r: any) => r.url));
  console.log(`📋 Duplicate rejected URLs from previous sessions: ${duplicateRejectedUrls.size}개`);
  
  let registered = 0;
  let skipped = 0;
  let excludedCount = 0;
  let duplicateCount = 0;
  
  for (const result of illegalResults) {
    try {
      // 신고 제외 URL인지 확인 (정확히 일치)
      const isExcluded = excludedUrls.has(result.url);
      // 이전 세션에서 중복 거부된 URL인지 확인
      const isDuplicateRejected = duplicateRejectedUrls.has(result.url);
      
      let reason: string | null = null;
      if (isExcluded) {
        reason = '웹사이트 메인 페이지';
        excludedCount++;
      } else if (isDuplicateRejected) {
        reason = '기존 요청과 중복된 요청';
        duplicateCount++;
      }
      
      if (reason) {
        await sql`
          INSERT INTO report_tracking (session_id, url, domain, title, report_status, reason)
          VALUES (${sessionId}, ${result.url}, ${result.domain}, ${result.title}, '미신고', ${reason})
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
    } catch (error) {
      // 중복 등 오류 무시
      skipped++;
    }
  }
  
  console.log(`✅ Report tracking: ${registered} registered, ${skipped} skipped, ${excludedCount} auto-excluded, ${duplicateCount} duplicate-rejected`);
  return registered;
}

// ============================================
// 월별 통계 업데이트
// ============================================

async function updateMonthlyStats(finalResults: FinalResult[]) {
  const sql = getDb();
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  
  const illegal = finalResults.filter(r => r.final_status === 'illegal').length;
  const legal = finalResults.filter(r => r.final_status === 'legal').length;
  const pending = finalResults.filter(r => r.final_status === 'pending').length;
  const total = finalResults.length;
  
  // 작품별 통계
  const titleCounts = new Map<string, number>();
  for (const r of finalResults.filter(r => r.final_status === 'illegal')) {
    titleCounts.set(r.title, (titleCounts.get(r.title) || 0) + 1);
  }
  const topContents = Array.from(titleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  
  // 불법 사이트 통계
  const siteCounts = new Map<string, number>();
  for (const r of finalResults.filter(r => r.final_status === 'illegal')) {
    siteCounts.set(r.domain, (siteCounts.get(r.domain) || 0) + 1);
  }
  const topIllegalSites = Array.from(siteCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));
  
  await sql`
    INSERT INTO monthly_stats (month, sessions_count, total, illegal, legal, pending, top_contents, top_illegal_sites)
    VALUES (${month}, 1, ${total}, ${illegal}, ${legal}, ${pending}, 
            ${JSON.stringify(topContents)}::jsonb, ${JSON.stringify(topIllegalSites)}::jsonb)
    ON CONFLICT (month) DO UPDATE SET
      sessions_count = monthly_stats.sessions_count + 1,
      total = monthly_stats.total + EXCLUDED.total,
      illegal = monthly_stats.illegal + EXCLUDED.illegal,
      legal = monthly_stats.legal + EXCLUDED.legal,
      pending = monthly_stats.pending + EXCLUDED.pending,
      top_contents = EXCLUDED.top_contents,
      top_illegal_sites = EXCLUDED.top_illegal_sites,
      last_updated = NOW()
  `;
}

// ============================================
// Manta 순위 업데이트
// ============================================

async function updateMantaRankings(searchResults: SearchResult[], sessionId: string, illegalDomains: Set<string>) {
  const sql = getDb();
  
  // 작품별로 "[작품명]만" 검색한 결과에서 manta.net 순위 및 불법 URL 수 계산
  // page1IllegalCount: 1페이지(1~10위) 불법 URL 수 (대시보드용)
  // top30IllegalCount: 30위 내 전체 불법 URL 수 (Manta 순위 변화 차트용)
  const titleRankings = new Map<string, { 
    mantaRank: number | null; 
    firstDomain: string; 
    query: string;
    page1IllegalCount: number;
    top30IllegalCount: number;
  }>();
  
  for (const result of searchResults) {
    // search_query가 title과 같은 경우 = 작품명만 검색
    if (result.search_query === result.title) {
      const title = result.title;
      
      if (!titleRankings.has(title)) {
        titleRankings.set(title, { mantaRank: null, firstDomain: '', query: result.search_query, page1IllegalCount: 0, top30IllegalCount: 0 });
      }
      
      const ranking = titleRankings.get(title)!;
      
      // 불법 사이트 URL 수 계산
      if (illegalDomains.has(result.domain.toLowerCase())) {
        // 1페이지(1~10위) 불법 URL (대시보드용)
        if (result.rank <= 10) {
          ranking.page1IllegalCount++;
        }
        // 30위 내 전체 불법 URL (Manta 순위 변화 차트용)
        if (result.rank <= 30) {
          ranking.top30IllegalCount++;
        }
      }
      
      // 1위 도메인 기록
      if (result.rank === 1) {
        ranking.firstDomain = result.domain;
      }
      
      // manta.net 순위 찾기
      if (result.domain.includes('manta.net')) {
        if (ranking.mantaRank === null || result.rank < ranking.mantaRank) {
          ranking.mantaRank = result.rank;
        }
      }
    }
  }
  
  // DB에 저장
  let savedCount = 0;
  for (const [title, ranking] of Array.from(titleRankings.entries())) {
    try {
      // 현재 순위 업데이트 (page1_illegal_count + top30_illegal_count 포함)
      await sql`
        INSERT INTO manta_rankings (title, manta_rank, first_rank_domain, search_query, session_id, page1_illegal_count, top30_illegal_count, updated_at)
        VALUES (${title}, ${ranking.mantaRank}, ${ranking.firstDomain}, ${ranking.query}, ${sessionId}, ${ranking.page1IllegalCount}, ${ranking.top30IllegalCount}, NOW())
        ON CONFLICT (title) DO UPDATE SET
          manta_rank = EXCLUDED.manta_rank,
          first_rank_domain = EXCLUDED.first_rank_domain,
          search_query = EXCLUDED.search_query,
          session_id = EXCLUDED.session_id,
          page1_illegal_count = EXCLUDED.page1_illegal_count,
          top30_illegal_count = EXCLUDED.top30_illegal_count,
          updated_at = NOW()
      `;
      
      // 히스토리에도 저장
      await sql`
        INSERT INTO manta_ranking_history (title, manta_rank, first_rank_domain, session_id, page1_illegal_count, top30_illegal_count, recorded_at)
        VALUES (${title}, ${ranking.mantaRank}, ${ranking.firstDomain}, ${sessionId}, ${ranking.page1IllegalCount}, ${ranking.top30IllegalCount}, NOW())
      `;
      
      savedCount++;
    } catch (error) {
      console.error(`Failed to save manta ranking for ${title}:`, error);
    }
  }
  
  console.log(`✅ Manta 순위 ${savedCount}개 작품 업데이트 완료 (히스토리 저장 포함)`);
  
  // 모니터링 종료 작품 정리: manta_rankings에서 현재 모니터링 대상이 아닌 작품 삭제
  // (manta_ranking_history는 유지하여 과거 데이터 조회 가능)
  try {
    const deleteResult = await sql`
      DELETE FROM manta_rankings 
      WHERE title NOT IN (
        SELECT name FROM titles WHERE is_current = true
      )
      RETURNING title
    `;
    
    if (deleteResult.length > 0) {
      console.log(`🗑️ 모니터링 종료 작품 ${deleteResult.length}개 정리됨:`);
      deleteResult.forEach((r: any) => console.log(`   - ${r.title}`));
    }
  } catch (error) {
    console.error('모니터링 종료 작품 정리 중 오류:', error);
  }
  
  return savedCount;
}

// ============================================
// 메인 파이프라인
// ============================================
// 월간 도메인 분석 자동 실행 (매월 12일 이후)
// ============================================

async function runMonthlyDomainAnalysisIfNeeded(sql: any) {
  const today = new Date();
  const dayOfMonth = today.getDate();

  // 매월 12일 이전이면 스킵
  if (dayOfMonth < 12) {
    console.log(`\n📊 월간 도메인 분석: 매월 12일 이후 자동 실행 (현재 ${dayOfMonth}일 → 스킵)`);
    return;
  }

  // 분석 대상 = 전월 (예: 3월 12일 실행 → 2월 분석)
  const targetDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const targetMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
  console.log(`\n📊 월간 도메인 분석: ${targetMonth} 자동 실행 확인...`);

  try {
    // 이미 해당 월 분석이 실행/완료되었는지 확인
    const existingReports: any[] = await sql`
      SELECT id, status FROM domain_analysis_reports WHERE analysis_month = ${targetMonth}
    `;

    if (existingReports.length > 0) {
      const report = existingReports[0];
      if (report.status === 'completed') {
        console.log(`✅ ${targetMonth} 분석이 이미 완료되어 있습니다. (report_id: ${report.id})`);
        return;
      }
      if (report.status === 'running') {
        console.log(`⏳ ${targetMonth} 분석이 이미 실행 중입니다. (report_id: ${report.id})`);
        return;
      }
      // failed 상태면 재시도
      console.log(`⚠️ ${targetMonth} 이전 분석이 실패(failed)했습니다. 재시도합니다.`);
    }

    // 상위 50개 불법 도메인 조회 (분석 대상 월 기준)
    let topDomains: any[] = await sql`
      SELECT domain, COUNT(*) as discovered
      FROM detection_results
      WHERE final_status = 'illegal'
        AND domain IS NOT NULL AND domain != ''
        AND SUBSTRING(session_id, 1, 7) = ${targetMonth}
      GROUP BY domain
      ORDER BY discovered DESC
      LIMIT 50
    `;

    // 해당 월 데이터가 없으면 전체 기간으로 fallback
    if (topDomains.length === 0) {
      console.log(`⚠️ ${targetMonth} 기간 데이터 없음 — 전체 기간으로 fallback`);
      topDomains = await sql`
        SELECT domain, COUNT(*) as discovered
        FROM detection_results
        WHERE final_status = 'illegal'
          AND domain IS NOT NULL AND domain != ''
        GROUP BY domain
        ORDER BY discovered DESC
        LIMIT 50
      `;
    }

    if (topDomains.length === 0) {
      console.log(`⚠️ 분석할 불법 도메인이 없습니다. 월간 분석을 건너뜁니다.`);
      return;
    }

    const domainList = topDomains.map((d: any) => d.domain);
    console.log(`📋 분석 대상 도메인: ${domainList.length}개`);

    // 각 도메인의 site_type 조회
    const TYPE_SCORE_MAP: Record<string, number> = {
      'scanlation_group': 35,
      'aggregator': 20,
      'clone': 10,
      'blog': 5,
      'unclassified': 0,
    };

    const siteTypes: any[] = await sql`
      SELECT LOWER(domain) as domain, COALESCE(site_type, 'unclassified') as site_type
      FROM sites
      WHERE type = 'illegal' AND LOWER(domain) = ANY(${domainList.map((d: string) => d.toLowerCase())})
    `;
    const siteTypeMap: Record<string, string> = {};
    for (const st of siteTypes) {
      siteTypeMap[st.domain] = st.site_type;
    }
    const domainWithTypes: DomainWithType[] = domainList.map((d: string) => {
      const siteType = siteTypeMap[d.toLowerCase()] || 'unclassified';
      const typeScore = TYPE_SCORE_MAP[siteType] || 0;
      const disc = topDomains.find((td: any) => td.domain === d);
      const discovered = disc ? parseInt(disc.discovered) || 0 : 0;
      return { domain: d, site_type: siteType, type_score: typeScore, discovered };
    });

    // 전전월 데이터 조회 (전월 분석 결과 = 비교 기준)
    const prevDate = new Date(targetDate.getFullYear(), targetDate.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const prevReport: any[] = await sql`
      SELECT id FROM domain_analysis_reports
      WHERE analysis_month = ${prevMonth} AND status = 'completed'
    `;

    let previousData: DomainAnalysisResult[] | null = null;
    if (prevReport.length > 0) {
      const prevResults: any[] = await sql`
        SELECT * FROM domain_analysis_results WHERE report_id = ${prevReport[0].id} ORDER BY rank
      `;
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
        }));
        console.log(`📋 전월(${prevMonth}) 데이터: ${previousData!.length}건`);
      }
    }

    // 프롬프트 생성 + Manus Task 생성
    const prompt = buildAnalysisPrompt(domainWithTypes, previousData, targetMonth);
    console.log(`📋 Manus 프롬프트 생성 완료 (${prompt.length}자), Task 생성 중...`);

    const task = await createAnalysisTask(prompt);
    if (!task) {
      console.error(`❌ Manus Task 생성 실패 — MANUS_API_KEY를 확인하세요.`);
      return;
    }
    console.log(`✅ Manus Task 생성 완료: ${task.task_id}`);

    // DB에 리포트 레코드 저장
    if (existingReports.length > 0) {
      await sql`
        UPDATE domain_analysis_reports SET
          status = 'running',
          manus_task_id = ${task.task_id},
          total_domains = ${domainList.length},
          error_message = NULL,
          created_at = NOW()
        WHERE analysis_month = ${targetMonth}
      `;
    } else {
      await sql`
        INSERT INTO domain_analysis_reports (analysis_month, status, manus_task_id, total_domains)
        VALUES (${targetMonth}, 'running', ${task.task_id}, ${domainList.length})
      `;
    }

    console.log(`✅ 월간 도메인 분석 시작됨 (${targetMonth}, ${domainList.length}개 도메인)`);
    console.log(`   Manus Task ID: ${task.task_id}`);
    console.log(`   결과는 Manus 완료 후 대시보드에서 자동 처리됩니다.`);

  } catch (error) {
    console.error(`❌ 월간 도메인 분석 자동 실행 오류:`, error);
    // 파이프라인 자체는 이미 성공했으므로, 도메인 분석 오류는 경고만 출력
  }
}

// ============================================

async function runPipeline() {
  const startTime = Date.now();
  const timestamp = getTimestamp();
  
  console.log('═'.repeat(60));
  console.log('🚀 Jobdori 모니터링 파이프라인 시작 (GitHub Actions)');
  console.log('═'.repeat(60));
  console.log(`⏰ 시작 시간: ${new Date().toLocaleString('ko-KR')}`);
  console.log(`📍 세션 ID: ${timestamp}`);
  console.log('');

  const config = loadConfig();
  const sql = getDb();

  try {
    // ==========================================
    // Step 1: 세션 생성
    // ==========================================
    console.log('\n📌 세션 생성...');
    await sql`
      INSERT INTO sessions (id, status, titles_count, keywords_count, total_searches)
      VALUES (${timestamp}, 'running', 0, 0, 0)
    `;

    // ==========================================
    // Step 2: 구글 검색
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 1: 구글 검색 (Serper.dev API)');
    console.log('─'.repeat(60));
    
    const searchRun = await runSearch();
    const searchResults = searchRun.results;
    const keywordsCount = searchRun.keywordsCount;
    saveJson(searchResults, `output/1_search-results-${timestamp}.json`);
    
    console.log(`\n✅ Step 1 완료: ${searchResults.length}개 결과 수집`);

    // ==========================================
    // Step 3: 1차 판별 (리스트 대조)
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 2: 1차 판별 (리스트 대조)');
    console.log('─'.repeat(60));
    
    const classifiedResults = await runClassify(searchResults);
    saveJson(classifiedResults, `output/2_classified-results-${timestamp}.json`);
    
    const unknownCount = classifiedResults.filter(r => r.status === 'unknown').length;
    console.log(`\n✅ Step 2 완료: ${unknownCount}개 미분류 도메인`);

    // ==========================================
    // Step 4: 2차 판별 (LLM)
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 3: 2차 판별 (Manus API)');
    console.log('─'.repeat(60));
    
    const llmJudgedResults = await runLLMJudge(classifiedResults, timestamp);
    saveJson(llmJudgedResults, `output/3_llm-judged-results-${timestamp}.json`);
    
    console.log(`\n✅ Step 3 완료`);

    // ==========================================
    // Step 5: 최종 결과 생성
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 4: 최종 결과 처리');
    console.log('─'.repeat(60));
    
    const finalResults = createFinalResults(llmJudgedResults);
    saveJson(finalResults, `output/4_final-results-${timestamp}.json`);

    // ==========================================
    // Step 6: Vercel Blob 업로드
    // ==========================================
    console.log('\n📌 Vercel Blob 업로드...');
    
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) {
      throw new Error('BLOB_READ_WRITE_TOKEN is required');
    }
    
    const finalResultsJson = JSON.stringify(finalResults, null, 2);
    const blob = await put(
      `results/${timestamp}/final-results.json`,
      finalResultsJson,
      { access: 'public', token: blobToken }
    );
    
    console.log(`✅ Blob 업로드 완료: ${blob.url}`);

    // ==========================================
    // Step 7: DB 업데이트
    // ==========================================
    console.log('\n📌 DB 업데이트...');
    
    // detection_results 테이블에 모든 결과 저장 (대시보드 통계용)
    const detectionResultsCount = await saveDetectionResultsToDb(timestamp, finalResults);
    console.log(`✅ detection_results ${detectionResultsCount}개 저장`);
    
    // 승인 대기 항목 저장
    const pendingCount = await savePendingReviewsToDb(llmJudgedResults, timestamp);
    console.log(`✅ 승인 대기 ${pendingCount}개 저장`);
    
    // 불법 URL을 신고결과 추적 테이블에 등록
    const reportTrackingCount = await registerIllegalUrlsToReportTracking(timestamp, finalResults);
    console.log(`✅ 신고결과 추적 ${reportTrackingCount}개 등록`);
    
    // 월별 통계 업데이트
    await updateMonthlyStats(finalResults);
    console.log('✅ 월별 통계 업데이트 완료');
    
    // Manta 순위 업데이트 (1페이지 내 불법 URL 수 계산을 위해 불법 사이트 목록 필요)
    const illegalSites = await loadSitesFromDb('illegal');
    await updateMantaRankings(searchResults, timestamp, illegalSites);
    
    // 세션 완료 업데이트
    const illegal = finalResults.filter(r => r.final_status === 'illegal').length;
    const legal = finalResults.filter(r => r.final_status === 'legal').length;
    const pending = finalResults.filter(r => r.final_status === 'pending').length;
    
    await sql`
      UPDATE sessions SET
        status = 'completed',
        completed_at = NOW(),
        titles_count = ${new Set(searchResults.map(r => r.title)).size},
        keywords_count = ${keywordsCount},
        total_searches = ${new Set(searchResults.map(r => r.search_query)).size},
        results_total = ${finalResults.length},
        results_illegal = ${illegal},
        results_legal = ${legal},
        results_pending = ${pending},
        file_final_results = ${blob.url}
      WHERE id = ${timestamp}
    `;
    console.log('✅ 세션 정보 업데이트 완료');

    // ==========================================
    // 완료 요약
    // ==========================================
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(60));
    console.log('🎉 파이프라인 완료!');
    console.log('═'.repeat(60));
    console.log(`⏱️  소요 시간: ${duration}초`);
    console.log('');
    console.log('📊 결과 요약:');
    console.log(`   - 총 검색 결과: ${searchResults.length}개`);
    console.log(`   - 불법 판정: ${illegal}개`);
    console.log(`   - 합법 판정: ${legal}개`);
    console.log(`   - 승인 대기: ${pending}개`);
    console.log('');
    console.log(`📁 Blob URL: ${blob.url}`);
    console.log('═'.repeat(60));

    // ==========================================
    // Slack 알림 전송
    // ==========================================
    await sendSlackNotification({
      timestamp,
      total: finalResults.length,
      illegal,
      legal,
      pending,
      duration
    });

    // ==========================================
    // 월간 불법 도메인 트래픽 분석 자동 실행
    // 매월 12일 이후 파이프라인 실행 시 자동 트리거
    // ==========================================
    await runMonthlyDomainAnalysisIfNeeded(sql);

    return { success: true, timestamp, blobUrl: blob.url };

  } catch (error) {
    console.error('\n' + '═'.repeat(60));
    console.error('❌ 파이프라인 실행 중 오류 발생!');
    console.error('═'.repeat(60));
    console.error(error);
    
    // 세션 실패 상태로 업데이트
    try {
      await sql`UPDATE sessions SET status = 'failed' WHERE id = ${timestamp}`;
    } catch {}
    
    return { success: false, error };
  }
}

// ============================================
// 직접 실행
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline()
    .then(result => {
      if (!result.success) {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runPipeline };
