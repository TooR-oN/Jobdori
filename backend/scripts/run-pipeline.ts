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
  
  let registered = 0;
  let skipped = 0;
  let excludedCount = 0;
  
  for (const result of illegalResults) {
    try {
      // 신고 제외 URL인지 확인 (정확히 일치)
      const isExcluded = excludedUrls.has(result.url);
      
      if (isExcluded) {
        // 신고 제외 URL: 미신고 + 웹사이트 메인 페이지 사유로 등록
        await sql`
          INSERT INTO report_tracking (session_id, url, domain, title, report_status, reason)
          VALUES (${sessionId}, ${result.url}, ${result.domain}, ${result.title}, '미신고', '웹사이트 메인 페이지')
          ON CONFLICT (session_id, url) DO NOTHING
        `;
        excludedCount++;
      } else {
        // 일반 불법 URL: 미신고로 등록
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
  
  console.log(`✅ Report tracking: ${registered} registered, ${skipped} skipped, ${excludedCount} auto-excluded`);
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
  
  // 작품별로 "[작품명]만" 검색한 결과에서 manta.net 순위 및 1페이지 불법 URL 수 계산
  const titleRankings = new Map<string, { 
    mantaRank: number | null; 
    firstDomain: string; 
    query: string;
    page1IllegalCount: number;
  }>();
  
  for (const result of searchResults) {
    // search_query가 title과 같은 경우 = 작품명만 검색
    if (result.search_query === result.title) {
      const title = result.title;
      
      if (!titleRankings.has(title)) {
        titleRankings.set(title, { mantaRank: null, firstDomain: '', query: result.search_query, page1IllegalCount: 0 });
      }
      
      const ranking = titleRankings.get(title)!;
      
      // 1페이지(1~10위) 내 불법 사이트 URL 수 계산
      if (result.rank <= 10 && illegalDomains.has(result.domain.toLowerCase())) {
        ranking.page1IllegalCount++;
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
      // 현재 순위 업데이트 (page1_illegal_count 포함)
      await sql`
        INSERT INTO manta_rankings (title, manta_rank, first_rank_domain, search_query, session_id, page1_illegal_count, updated_at)
        VALUES (${title}, ${ranking.mantaRank}, ${ranking.firstDomain}, ${ranking.query}, ${sessionId}, ${ranking.page1IllegalCount}, NOW())
        ON CONFLICT (title) DO UPDATE SET
          manta_rank = EXCLUDED.manta_rank,
          first_rank_domain = EXCLUDED.first_rank_domain,
          search_query = EXCLUDED.search_query,
          session_id = EXCLUDED.session_id,
          page1_illegal_count = EXCLUDED.page1_illegal_count,
          updated_at = NOW()
      `;
      
      // 히스토리에도 저장 (page1_illegal_count 포함)
      await sql`
        INSERT INTO manta_ranking_history (title, manta_rank, first_rank_domain, session_id, page1_illegal_count, recorded_at)
        VALUES (${title}, ${ranking.mantaRank}, ${ranking.firstDomain}, ${sessionId}, ${ranking.page1IllegalCount}, NOW())
      `;
      
      savedCount++;
    } catch (error) {
      console.error(`Failed to save manta ranking for ${title}:`, error);
    }
  }
  
  console.log(`✅ Manta 순위 ${savedCount}개 작품 업데이트 완료 (히스토리 저장 포함)`);
  return savedCount;
}

// ============================================
// 메인 파이프라인
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
    
    const searchResults = await runSearch();
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
        keywords_count = 3,
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
