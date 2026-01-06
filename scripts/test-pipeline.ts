/**
 * 파이프라인 테스트 (간소화 버전)
 * - 작품 2개
 * - 키워드 1개
 * - 딜레이 최소화
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  SearchResult,
  ClassifiedResult,
  LLMJudgedResult,
  FinalResult,
  PendingReviewItem,
} from './types/index.js';
import {
  loadConfig,
  saveJson,
  getTimestamp,
  getCurrentISOTime,
  generateExcelReport,
  extractDomain,
  loadSiteList,
} from './utils.js';

// Serper API
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_API_URL = 'https://google.serper.dev/search';

// ============================================
// 테스트용 간소화 검색
// ============================================

async function testSearch(): Promise<SearchResult[]> {
  console.log('🔍 테스트 검색 시작 (2개 작품 × 1개 키워드)...\n');
  
  const titles = ['Solo Leveling', 'Tower of God'];
  const keyword = 'manga';
  const results: SearchResult[] = [];

  for (const title of titles) {
    const query = `${title} ${keyword}`;
    console.log(`  검색: "${query}"`);

    try {
      const response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          gl: 'us',
          hl: 'en',
          num: 10,
        }),
      });

      const data = await response.json();
      
      if (data.organic) {
        for (let i = 0; i < data.organic.length; i++) {
          const item = data.organic[i];
          results.push({
            title,
            domain: extractDomain(item.link),
            url: item.link,
            search_query: query,
            page: 1,
            rank: i + 1,
          });
        }
        console.log(`    ✅ ${data.organic.length}개 결과`);
      }
    } catch (error) {
      console.error(`    ❌ 검색 실패:`, error);
    }

    // 짧은 딜레이
    await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

// ============================================
// 테스트용 1차 판별
// ============================================

function testClassify(searchResults: SearchResult[]): ClassifiedResult[] {
  console.log('\n🔍 1차 판별 (리스트 대조)...\n');
  
  const config = loadConfig();
  const illegalSites = loadSiteList(config.paths.illegalSitesFile);
  const legalSites = loadSiteList(config.paths.legalSitesFile);

  // 도메인이 리스트에 있는지 확인 (서브도메인 포함)
  function checkDomainInList(domain: string, list: Set<string>): boolean {
    // 정확히 일치
    if (list.has(domain)) return true;
    // 서브도메인 체크 (예: en.wikipedia.org → wikipedia.org)
    const parts = domain.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (list.has(parentDomain)) return true;
    }
    return false;
  }

  const results: ClassifiedResult[] = searchResults.map(result => {
    const domain = result.domain.toLowerCase();
    let status: 'illegal' | 'legal' | 'unknown';

    if (checkDomainInList(domain, illegalSites)) {
      status = 'illegal';
    } else if (checkDomainInList(domain, legalSites)) {
      status = 'legal';
    } else {
      status = 'unknown';
    }

    return { ...result, status };
  });

  const illegal = results.filter(r => r.status === 'illegal').length;
  const legal = results.filter(r => r.status === 'legal').length;
  const unknown = results.filter(r => r.status === 'unknown').length;

  console.log(`  불법: ${illegal}개, 합법: ${legal}개, 미분류: ${unknown}개`);

  return results;
}

// ============================================
// 테스트용 LLM 판별 (모의)
// ============================================

function testLLMJudge(classifiedResults: ClassifiedResult[]): LLMJudgedResult[] {
  console.log('\n🤖 2차 판별 (LLM 모의)...\n');
  
  // API 키가 없으므로 도메인 패턴으로 간단히 판별
  const results: LLMJudgedResult[] = classifiedResults.map(result => {
    let llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null = null;
    let llm_reason: string | null = null;

    if (result.status === 'unknown') {
      const domain = result.domain.toLowerCase();
      
      // 불법 키워드 패턴
      const illegalPatterns = ['manga', 'manhwa', 'manhua', 'webtoon', 'comic', 'read', 'scan', 'raw', 'free'];
      // 불법 TLD 패턴
      const suspiciousTLDs = ['.to', '.cc', '.ws', '.xyz', '.club', '.site', '.online'];
      
      const hasIllegalKeyword = illegalPatterns.some(p => domain.includes(p));
      const hasSuspiciousTLD = suspiciousTLDs.some(tld => domain.endsWith(tld));
      
      if (hasIllegalKeyword && hasSuspiciousTLD) {
        llm_judgment = 'likely_illegal';
        llm_reason = '불법 키워드 + 의심 TLD 조합';
      } else if (hasIllegalKeyword) {
        llm_judgment = 'likely_illegal';
        llm_reason = `도메인에 불법 관련 키워드 포함`;
      } else if (hasSuspiciousTLD) {
        llm_judgment = 'uncertain';
        llm_reason = '의심스러운 TLD 사용';
      } else {
        llm_judgment = 'uncertain';
        llm_reason = '도메인만으로 판단 어려움';
      }
    }

    return { ...result, llm_judgment, llm_reason };
  });

  const likelyIllegal = results.filter(r => r.llm_judgment === 'likely_illegal').length;
  const likelyLegal = results.filter(r => r.llm_judgment === 'likely_legal').length;
  const uncertain = results.filter(r => r.llm_judgment === 'uncertain').length;

  console.log(`  불법추정: ${likelyIllegal}개, 합법추정: ${likelyLegal}개, 불확실: ${uncertain}개`);

  return results;
}

// ============================================
// 테스트용 승인 대기 목록 생성
// ============================================

function createTestPendingList(results: LLMJudgedResult[]): PendingReviewItem[] {
  const domainGroups = new Map<string, LLMJudgedResult[]>();
  
  for (const result of results) {
    if (result.status === 'unknown' && result.llm_judgment) {
      const domain = result.domain.toLowerCase();
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain)!.push(result);
    }
  }

  const pendingItems: PendingReviewItem[] = [];
  let id = 1;

  for (const [domain, items] of domainGroups) {
    const firstItem = items[0];
    const urls = [...new Set(items.map(item => item.url))];
    const titles = [...new Set(items.map(item => item.title))];

    pendingItems.push({
      id: String(id++),
      domain,
      urls,
      titles,
      llm_judgment: firstItem.llm_judgment!,
      llm_reason: firstItem.llm_reason || '',
      created_at: getCurrentISOTime(),
    });
  }

  return pendingItems;
}

// ============================================
// 메인 테스트
// ============================================

async function runTest() {
  console.log('═'.repeat(50));
  console.log('🧪 파이프라인 테스트 (간소화 버전)');
  console.log('═'.repeat(50));

  if (!SERPER_API_KEY) {
    console.error('❌ SERPER_API_KEY가 설정되지 않았습니다.');
    return;
  }

  const timestamp = getTimestamp();

  // Step 1: 검색
  const searchResults = await testSearch();
  console.log(`\n📊 검색 결과: ${searchResults.length}개`);

  // Step 2: 1차 판별
  const classifiedResults = testClassify(searchResults);

  // Step 3: 2차 판별
  const llmJudgedResults = testLLMJudge(classifiedResults);

  // Step 4: 최종 결과 생성
  const finalResults: FinalResult[] = llmJudgedResults.map(r => ({
    ...r,
    final_status: r.status === 'illegal' ? 'illegal' as const : 
                  r.status === 'legal' ? 'legal' as const : 'pending' as const,
    reviewed_at: r.status !== 'unknown' ? getCurrentISOTime() : null,
  }));

  // Step 5: 승인 대기 목록 생성
  const pendingItems = createTestPendingList(llmJudgedResults);
  
  // 파일 저장
  saveJson(finalResults, `output/test-results-${timestamp}.json`);
  saveJson(pendingItems, 'data/pending-review.json');
  generateExcelReport(finalResults, `output/test-report-${timestamp}.xlsx`);

  // 결과 요약
  console.log('\n' + '═'.repeat(50));
  console.log('✅ 테스트 완료!');
  console.log('═'.repeat(50));
  console.log(`📊 결과:`);
  console.log(`   - 총 결과: ${finalResults.length}개`);
  console.log(`   - 불법: ${finalResults.filter(r => r.final_status === 'illegal').length}개`);
  console.log(`   - 합법: ${finalResults.filter(r => r.final_status === 'legal').length}개`);
  console.log(`   - 승인대기: ${finalResults.filter(r => r.final_status === 'pending').length}개`);
  console.log(`\n📋 승인 대기 도메인: ${pendingItems.length}개`);
  pendingItems.forEach(item => {
    console.log(`   - ${item.domain} (${item.llm_judgment})`);
  });
  console.log(`\n📁 생성된 파일:`);
  console.log(`   - output/test-results-${timestamp}.json`);
  console.log(`   - output/test-report-${timestamp}.xlsx`);
  console.log(`   - data/pending-review.json`);
  console.log('\n🌐 승인 UI에서 확인하세요: http://localhost:3000');
}

runTest().catch(console.error);
