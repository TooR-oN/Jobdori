/**
 * 오늘 들어온 pending 도메인을 Manus API로 AI 판단 실행 (간소화 버전)
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
  console.log('=== Pending 도메인 Manus API 처리 (간소화) ===\n');
  
  // 1. pending 현황 확인
  const needsReprocess = await sql`
    SELECT id, domain, llm_judgment, llm_reason
    FROM pending_reviews
    WHERE llm_judgment = 'uncertain'
    AND (llm_reason LIKE '%API 키%' OR llm_reason LIKE '%API key%')
    ORDER BY created_at DESC
  `;
  
  console.log(`🔄 재처리 필요한 도메인: ${needsReprocess.length}개\n`);
  
  if (needsReprocess.length === 0) {
    console.log('✅ 재처리할 도메인이 없습니다.');
    return;
  }
  
  // 2. DomainInfo 형식으로 변환 (스니펫 없이)
  const domainInfos: DomainInfo[] = needsReprocess.map(row => ({
    domain: row.domain,
    snippets: [],  // 스니펫 없이 도메인만으로 판단
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
  }));
  
  console.log('도메인 예시 (처음 10개):');
  domainInfos.slice(0, 10).forEach(d => console.log(`  - ${d.domain}`));
  if (domainInfos.length > 10) console.log(`  ... 외 ${domainInfos.length - 10}개`);
  console.log('');
  
  console.log('--- Manus API 배치 처리 시작 ---\n');
  
  // 세션 ID
  const sessionId = 'manual-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
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
  
  // 불법 추정 도메인 출력
  const illegalDomains = judgedResults.filter(r => r.llm_judgment === 'likely_illegal');
  if (illegalDomains.length > 0) {
    console.log('\n🚨 불법 추정 도메인:');
    illegalDomains.forEach(d => {
      console.log(`  - ${d.domain}: ${d.llm_reason?.slice(0, 80)}`);
    });
  }
  
  // DB 업데이트
  console.log('\n--- DB 업데이트 ---\n');
  
  let updateCount = 0;
  for (const result of judgedResults) {
    const pendingItem = needsReprocess.find((p: any) => p.domain === result.domain);
    if (!pendingItem) continue;
    
    try {
      await sql`
        UPDATE pending_reviews
        SET llm_judgment = ${result.llm_judgment},
            llm_reason = ${result.llm_reason || ''}
        WHERE id = ${pendingItem.id}
      `;
      updateCount++;
    } catch (err) {
      console.error(`❌ ${result.domain} 업데이트 실패:`, err);
    }
  }
  
  console.log(`✅ 총 ${updateCount}개 레코드 업데이트 완료`);
}

main().catch(console.error);
