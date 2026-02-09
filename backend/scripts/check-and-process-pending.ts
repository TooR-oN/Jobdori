/**
 * 오늘 들어온 pending 도메인을 확인하고 Manus API로 AI 판단 실행
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { judgeDomainsBatch, mergeJudgments } from './llm-judge.js';

interface DomainInfo {
  domain: string;
  snippets: string[];
  urls: string[];
  titles: string[];
}

interface ClassifiedResult {
  title: string;
  domain: string;
  url: string;
  status: 'unknown' | 'illegal' | 'legal';
  search_query: string;
  page: number;
  rank: number;
  snippet?: string;
}

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log('=== Pending 도메인 현황 확인 및 Manus API 처리 ===\n');
  
  // 1. 현재 pending 현황 확인
  const allPending = await sql`
    SELECT id, domain, llm_judgment, llm_reason, created_at::text as created_at
    FROM pending_reviews
    ORDER BY created_at DESC
  `;
  
  console.log(`📊 전체 pending_reviews: ${allPending.length}개\n`);
  
  // 판단별 분류
  const byJudgment = {
    likely_illegal: allPending.filter(p => p.llm_judgment === 'likely_illegal'),
    likely_legal: allPending.filter(p => p.llm_judgment === 'likely_legal'),
    uncertain: allPending.filter(p => p.llm_judgment === 'uncertain'),
    null: allPending.filter(p => !p.llm_judgment),
  };
  
  console.log('현재 상태:');
  console.log(`  - 불법 추정: ${byJudgment.likely_illegal.length}개`);
  console.log(`  - 합법 추정: ${byJudgment.likely_legal.length}개`);
  console.log(`  - 불확실: ${byJudgment.uncertain.length}개`);
  console.log(`  - 미판단(null): ${byJudgment.null.length}개`);
  console.log('');
  
  // API 키 관련 오류인 도메인 찾기
  const needsReprocess = allPending.filter(p => 
    p.llm_judgment === 'uncertain' && 
    (p.llm_reason?.includes('API 키') || p.llm_reason?.includes('API key'))
  );
  
  console.log(`🔄 API 키 오류로 재처리 필요: ${needsReprocess.length}개\n`);
  
  if (needsReprocess.length === 0) {
    console.log('✅ 재처리할 도메인이 없습니다.');
    
    // 불확실 도메인 상세 출력
    if (byJudgment.uncertain.length > 0) {
      console.log('\n❓ 불확실 도메인 목록:');
      byJudgment.uncertain.forEach(p => {
        console.log(`  - ${p.domain}: ${p.llm_reason?.slice(0, 60) || '이유 없음'}`);
      });
    }
    return;
  }
  
  // 2. 재처리할 도메인 정보 준비
  console.log('재처리할 도메인:');
  needsReprocess.forEach(p => {
    console.log(`  - ${p.domain}`);
  });
  console.log('');
  
  // 스니펫 정보 가져오기
  const domains = needsReprocess.map(p => p.domain);
  const snippetData = await sql`
    SELECT DISTINCT domain, snippet
    FROM detection_results
    WHERE domain = ANY(${domains})
    AND snippet IS NOT NULL
  `;
  
  const snippetMap = new Map<string, string[]>();
  snippetData.forEach((row: any) => {
    if (!snippetMap.has(row.domain)) {
      snippetMap.set(row.domain, []);
    }
    if (row.snippet) {
      snippetMap.get(row.domain)!.push(row.snippet);
    }
  });
  
  // DomainInfo 형식으로 변환
  const domainInfos: DomainInfo[] = needsReprocess.map(row => ({
    domain: row.domain,
    snippets: snippetMap.get(row.domain) || [],
    urls: [],
    titles: []
  }));
  
  // ClassifiedResult 형식으로 변환
  const classifiedResults: ClassifiedResult[] = needsReprocess.map(row => ({
    title: '알 수 없음',
    domain: row.domain,
    url: '',
    status: 'unknown' as const,
    search_query: '',
    page: 0,
    rank: 0,
    snippet: snippetMap.get(row.domain)?.[0],
  }));
  
  console.log('--- Manus API 배치 처리 시작 ---\n');
  
  // 세션 ID
  const sessionId = 'manual-reprocess-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  // Manus API로 배치 판별
  const judgmentMap = await judgeDomainsBatch(domainInfos, '', sessionId, 20);
  
  // 결과 병합
  const judgedResults = mergeJudgments(classifiedResults, judgmentMap);
  
  console.log('\n=== 판별 결과 요약 ===\n');
  
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
  console.log('\n--- DB 업데이트 ---\n');
  
  let updateCount = 0;
  for (const result of judgedResults) {
    const pendingItem = needsReprocess.find(p => p.domain === result.domain);
    if (!pendingItem) continue;
    
    await sql`
      UPDATE pending_reviews
      SET llm_judgment = ${result.llm_judgment},
          llm_reason = ${result.llm_reason || ''}
      WHERE id = ${pendingItem.id}
    `;
    updateCount++;
    console.log(`✅ ${result.domain}: ${result.llm_judgment}`);
  }
  
  console.log(`\n✅ 총 ${updateCount}개 레코드 업데이트 완료`);
}

main().catch(console.error);
