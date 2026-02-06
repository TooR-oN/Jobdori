/**
 * pending_reviews 테이블의 미처리 도메인을 Manus API로 판별하고 업데이트
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { judgeDomainsBatch, mergeJudgments } from './llm-judge.js';
import type { DomainInfo, ClassifiedResult } from './types/index.js';

const sql = neon(process.env.DATABASE_URL!);

async function processPendingWithManus() {
  console.log('=== Pending 도메인 Manus API 처리 시작 ===\n');
  
  // pending_reviews에서 미처리(uncertain + API 키 관련 이유) 도메인 가져오기
  const pendingDomains = await sql`
    SELECT pr.id, pr.domain, pr.urls, pr.titles, pr.llm_judgment, pr.llm_reason,
           dr.snippet
    FROM pending_reviews pr
    LEFT JOIN detection_results dr ON pr.domain = dr.domain
    WHERE pr.llm_judgment = 'uncertain'
    AND (pr.llm_reason LIKE '%API 키%' OR pr.llm_reason IS NULL)
    ORDER BY pr.created_at DESC
  `;
  
  console.log(`미처리 도메인 수: ${pendingDomains.length}\n`);
  
  if (pendingDomains.length === 0) {
    console.log('처리할 도메인이 없습니다.');
    return;
  }
  
  // DomainInfo 형식으로 변환
  const domainInfos: DomainInfo[] = pendingDomains.map(row => ({
    domain: row.domain,
    snippets: row.snippet ? [row.snippet] : [],
    urls: Array.isArray(row.urls) ? row.urls : [],
    titles: Array.isArray(row.titles) ? row.titles : []
  }));
  
  // ClassifiedResult 형식으로 변환 (mergeJudgments용)
  const classifiedResults: ClassifiedResult[] = pendingDomains.map(row => ({
    title: Array.isArray(row.titles) && row.titles.length > 0 ? row.titles[0] : '알 수 없음',
    domain: row.domain,
    url: Array.isArray(row.urls) && row.urls.length > 0 ? row.urls[0] : '',
    status: 'unknown' as const,
    search_query: '',
    page: 0,
    rank: 0,
    snippet: row.snippet || undefined,
  }));
  
  console.log(`도메인 정보 준비 완료\n`);
  console.log('--- Manus API 배치 처리 시작 ---\n');
  
  // 테스트용 세션 ID
  const sessionId = 'pending-reprocess-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  // Manus API로 배치 판별
  const judgmentMap = await judgeDomainsBatch(domainInfos, '', sessionId, 20);
  
  // 결과 병합
  const judgedResults = mergeJudgments(classifiedResults, judgmentMap);
  
  console.log('\n=== 판별 결과 요약 ===\n');
  
  // 통계
  const stats = {
    total: judgedResults.length,
    likely_illegal: judgedResults.filter(r => r.llm_judgment === 'likely_illegal').length,
    likely_legal: judgedResults.filter(r => r.llm_judgment === 'likely_legal').length,
    uncertain: judgedResults.filter(r => r.llm_judgment === 'uncertain').length,
  };
  
  console.log(`총 도메인: ${stats.total}`);
  console.log(`불법 추정: ${stats.likely_illegal}`);
  console.log(`합법 추정: ${stats.likely_legal}`);
  console.log(`불확실: ${stats.uncertain}`);
  
  // DB 업데이트
  console.log('\n--- DB 업데이트 시작 ---\n');
  
  let updateCount = 0;
  for (const result of judgedResults) {
    const pendingItem = pendingDomains.find(p => p.domain === result.domain);
    if (!pendingItem) continue;
    
    await sql`
      UPDATE pending_reviews
      SET llm_judgment = ${result.llm_judgment},
          llm_reason = ${result.llm_reason || ''}
      WHERE id = ${pendingItem.id}
    `;
    updateCount++;
  }
  
  console.log(`✅ ${updateCount}개 pending_reviews 레코드 업데이트 완료`);
  
  // 결과 상세 출력
  console.log('\n=== 상세 결과 ===\n');
  
  const illegalDomains = judgedResults.filter(r => r.llm_judgment === 'likely_illegal');
  const legalDomains = judgedResults.filter(r => r.llm_judgment === 'likely_legal');
  const uncertainDomains = judgedResults.filter(r => r.llm_judgment === 'uncertain');
  
  if (illegalDomains.length > 0) {
    console.log('🚨 불법 추정 도메인:');
    illegalDomains.forEach(d => {
      console.log(`  - ${d.domain}: ${d.llm_reason}`);
    });
    console.log('');
  }
  
  if (legalDomains.length > 0) {
    console.log('✅ 합법 추정 도메인 (처음 10개):');
    legalDomains.slice(0, 10).forEach(d => {
      console.log(`  - ${d.domain}: ${d.llm_reason?.slice(0, 100)}...`);
    });
    if (legalDomains.length > 10) {
      console.log(`  ... 외 ${legalDomains.length - 10}개`);
    }
    console.log('');
  }
  
  if (uncertainDomains.length > 0) {
    console.log('❓ 불확실 도메인:');
    uncertainDomains.forEach(d => {
      console.log(`  - ${d.domain}: ${d.llm_reason}`);
    });
  }
}

processPendingWithManus().catch(console.error);
