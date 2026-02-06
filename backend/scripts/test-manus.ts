import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { judgeDomainsWithManus } from './llm-judge.js';
import type { DomainInfo } from './types/index.js';

const sql = neon(process.env.DATABASE_URL!);

async function testManusWithPendingDomains() {
  console.log('=== Manus API 테스트 시작 ===\n');
  
  // 최신 세션의 pending 도메인들 가져오기
  const pendingDomains = await sql`
    SELECT pr.domain, pr.urls, pr.titles,
           dr.snippet
    FROM pending_reviews pr
    LEFT JOIN detection_results dr ON pr.domain = dr.domain
    WHERE pr.llm_judgment = 'uncertain'
    AND pr.llm_reason LIKE '%API 키%'
    ORDER BY pr.created_at DESC
    LIMIT 5
  `;
  
  console.log(`테스트할 도메인 수: ${pendingDomains.length}\n`);
  
  if (pendingDomains.length === 0) {
    console.log('테스트할 도메인이 없습니다.');
    return;
  }
  
  // DomainInfo 형식으로 변환
  const domainInfos: DomainInfo[] = pendingDomains.map(row => ({
    domain: row.domain,
    snippets: row.snippet ? [row.snippet] : [],
    urls: Array.isArray(row.urls) ? row.urls : [],
    titles: Array.isArray(row.titles) ? row.titles : []
  }));
  
  console.log('도메인 정보:');
  domainInfos.forEach(d => {
    console.log(`  - ${d.domain}`);
    console.log(`    스니펫: ${d.snippets.length > 0 ? d.snippets[0].substring(0, 100) + '...' : '없음'}`);
    console.log(`    URL 수: ${d.urls.length}, 작품 수: ${d.titles.length}`);
  });
  
  console.log('\n--- Manus API 호출 시작 ---\n');
  
  // 테스트용 세션 ID
  const testSessionId = 'test-manus-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  // Manus API로 판별
  const judgments = await judgeDomainsWithManus(domainInfos, '', testSessionId);
  
  console.log('\n=== Manus API 판별 결과 ===\n');
  
  judgments.forEach(j => {
    const emoji = j.judgment === 'likely_illegal' ? '🚨' 
                : j.judgment === 'likely_legal' ? '✅' 
                : '❓';
    console.log(`${emoji} ${j.domain}`);
    console.log(`   판정: ${j.judgment}`);
    console.log(`   신뢰도: ${(j as any).confidence || 'N/A'}`);
    console.log(`   사유: ${j.reason}`);
    console.log('');
  });
  
  // 통계
  const stats = {
    total: judgments.length,
    likely_illegal: judgments.filter(j => j.judgment === 'likely_illegal').length,
    likely_legal: judgments.filter(j => j.judgment === 'likely_legal').length,
    uncertain: judgments.filter(j => j.judgment === 'uncertain').length
  };
  
  console.log('=== 통계 ===');
  console.log(`총 도메인: ${stats.total}`);
  console.log(`불법 추정: ${stats.likely_illegal}`);
  console.log(`합법 추정: ${stats.likely_legal}`);
  console.log(`불확실: ${stats.uncertain}`);
}

testManusWithPendingDomains().catch(console.error);
