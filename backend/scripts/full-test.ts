/**
 * 전체 파이프라인 테스트 (20개 작품 × 3개 키워드)
 * - Serper.dev API로 검색
 * - 1차 판별 (리스트 대조)
 * - 2차 판별 (도메인 패턴 분석 - LLM 없이)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
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
  loadKeywords,
  getRandomDelay,
  sleep,
} from './utils.js';

// Serper API
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_API_URL = 'https://google.serper.dev/search';

// ============================================
// Step 1: 구글 검색
// ============================================

async function runSearch(): Promise<SearchResult[]> {
  const config = loadConfig();
  
  // 작품 제목 로드
  const titlesPath = path.join(process.cwd(), config.paths.titlesFile);
  const workbook = XLSX.readFile(titlesPath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const titlesData = XLSX.utils.sheet_to_json<{ title: string }>(worksheet);
  const titles = titlesData.map(row => row.title).filter(Boolean);
  
  // 키워드 로드
  const keywords = loadKeywords(config.paths.keywordsFile);
  
  console.log('═'.repeat(60));
  console.log('📌 Step 1: 구글 검색 (Serper.dev API)');
  console.log('═'.repeat(60));
  console.log(`📚 작품 수: ${titles.length}개`);
  console.log(`🏷️  키워드: ${keywords.join(', ')}`);
  console.log(`🔢 총 검색 횟수: ${titles.length * keywords.length}회`);
  console.log('');

  const results: SearchResult[] = [];
  let searchCount = 0;
  const totalSearches = titles.length * keywords.length;

  for (const title of titles) {
    console.log(`\n📖 작품: ${title}`);
    
    for (const keyword of keywords) {
      searchCount++;
      const query = `${title} ${keyword}`;
      
      console.log(`  [${searchCount}/${totalSearches}] 검색: "${query}"`);

      try {
        // 페이지 1-3 검색
        for (let page = 1; page <= config.search.maxPages; page++) {
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
              num: config.search.resultsPerPage,
              page: page,
            }),
          });

          const data = await response.json();
          
          if (data.organic) {
            const startRank = (page - 1) * config.search.resultsPerPage;
            for (let i = 0; i < data.organic.length; i++) {
              const item = data.organic[i];
              const rank = startRank + i + 1;
              if (rank > config.search.maxResults) break;
              
              results.push({
                title,
                domain: extractDomain(item.link),
                url: item.link,
                search_query: query,
                page,
                rank,
              });
            }
          }

          // 페이지 간 딜레이
          if (page < config.search.maxPages) {
            const delay = getRandomDelay(config.search.delayBetweenPages.min, config.search.delayBetweenPages.max);
            await sleep(delay);
          }
        }
        
        console.log(`    ✅ 완료`);
      } catch (error) {
        console.error(`    ❌ 검색 실패:`, error);
      }

      // 검색 간 딜레이
      if (searchCount < totalSearches) {
        const delay = getRandomDelay(config.search.delayBetweenSearches.min, config.search.delayBetweenSearches.max);
        console.log(`    ⏳ 딜레이: ${(delay/1000).toFixed(1)}초`);
        await sleep(delay);
      }
    }
  }

  console.log(`\n✅ 검색 완료: ${results.length}개 결과 수집`);
  return results;
}

// ============================================
// Step 2: 1차 판별
// ============================================

function checkDomainInList(domain: string, list: Set<string>): boolean {
  if (list.has(domain)) return true;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (list.has(parentDomain)) return true;
  }
  return false;
}

function runClassify(searchResults: SearchResult[]): ClassifiedResult[] {
  console.log('\n' + '═'.repeat(60));
  console.log('📌 Step 2: 1차 판별 (리스트 대조)');
  console.log('═'.repeat(60));
  
  const config = loadConfig();
  const illegalSites = loadSiteList(config.paths.illegalSitesFile);
  const legalSites = loadSiteList(config.paths.legalSitesFile);

  console.log(`📋 불법 리스트: ${illegalSites.size}개`);
  console.log(`📋 합법 리스트: ${legalSites.size}개\n`);

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

  console.log('📊 1차 판별 결과:');
  console.log(`   🔴 불법: ${illegal}개`);
  console.log(`   🟢 합법: ${legal}개`);
  console.log(`   🟡 미분류: ${unknown}개`);

  return results;
}

// ============================================
// Step 3: 2차 판별 (패턴 분석)
// ============================================

function runLLMJudge(classifiedResults: ClassifiedResult[]): LLMJudgedResult[] {
  console.log('\n' + '═'.repeat(60));
  console.log('📌 Step 3: 2차 판별 (도메인 패턴 분석)');
  console.log('═'.repeat(60));
  
  // 불법 키워드 패턴
  const illegalPatterns = [
    'manga', 'manhwa', 'manhua', 'webtoon', 'comic', 
    'read', 'scan', 'raw', 'free', 'online',
    'chapter', 'episode', 'toon', 'hentai', 'adult'
  ];
  
  // 의심 TLD
  const suspiciousTLDs = ['.to', '.cc', '.ws', '.xyz', '.club', '.site', '.online', '.me', '.tv', '.cx'];
  
  // 불법으로 판단하기 어려운 일반 도메인 패턴
  const likelyLegalPatterns = ['shop', 'store', 'news', 'blog', 'review', 'wiki', 'forum'];

  const results: LLMJudgedResult[] = classifiedResults.map(result => {
    let llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null = null;
    let llm_reason: string | null = null;

    if (result.status === 'unknown') {
      const domain = result.domain.toLowerCase();
      
      const matchedIllegalPatterns = illegalPatterns.filter(p => domain.includes(p));
      const hasSuspiciousTLD = suspiciousTLDs.some(tld => domain.endsWith(tld));
      const hasLegalPattern = likelyLegalPatterns.some(p => domain.includes(p));
      
      if (matchedIllegalPatterns.length >= 2) {
        llm_judgment = 'likely_illegal';
        llm_reason = `다수의 불법 키워드 포함: ${matchedIllegalPatterns.join(', ')}`;
      } else if (matchedIllegalPatterns.length >= 1 && hasSuspiciousTLD) {
        llm_judgment = 'likely_illegal';
        llm_reason = `불법 키워드(${matchedIllegalPatterns[0]}) + 의심 TLD`;
      } else if (matchedIllegalPatterns.length >= 1) {
        llm_judgment = 'likely_illegal';
        llm_reason = `불법 키워드 포함: ${matchedIllegalPatterns[0]}`;
      } else if (hasSuspiciousTLD && !hasLegalPattern) {
        llm_judgment = 'uncertain';
        llm_reason = '의심스러운 TLD 사용';
      } else if (hasLegalPattern) {
        llm_judgment = 'likely_legal';
        llm_reason = '합법적인 사이트 패턴';
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

  console.log('\n📊 2차 판별 결과:');
  console.log(`   🔴 불법 추정: ${likelyIllegal}개`);
  console.log(`   🟢 합법 추정: ${likelyLegal}개`);
  console.log(`   🟡 불확실: ${uncertain}개`);

  // 미분류 도메인 출력 (중복 제거)
  const unknownDomains = new Map<string, LLMJudgedResult>();
  results.filter(r => r.status === 'unknown').forEach(r => {
    if (!unknownDomains.has(r.domain)) {
      unknownDomains.set(r.domain, r);
    }
  });

  console.log(`\n🔍 미분류 도메인 (${unknownDomains.size}개):`);
  for (const [domain, result] of unknownDomains) {
    const icon = result.llm_judgment === 'likely_illegal' ? '🔴' :
                 result.llm_judgment === 'likely_legal' ? '🟢' : '🟡';
    console.log(`   ${icon} ${domain} - ${result.llm_reason}`);
  }

  return results;
}

// ============================================
// Step 4: 승인 대기 목록 생성
// ============================================

function createPendingList(results: LLMJudgedResult[]): PendingReviewItem[] {
  console.log('\n' + '═'.repeat(60));
  console.log('📌 Step 4: 승인 대기 목록 생성');
  console.log('═'.repeat(60));

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

  console.log(`\n📋 승인 대기 항목: ${pendingItems.length}개`);

  return pendingItems;
}

// ============================================
// 메인 실행
// ============================================

async function main() {
  const startTime = Date.now();
  const timestamp = getTimestamp();
  
  console.log('');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║     웹툰 불법사이트 모니터링 - 전체 테스트 실행          ║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log(`⏰ 시작: ${new Date().toLocaleString('ko-KR')}`);
  console.log('');

  if (!SERPER_API_KEY) {
    console.error('❌ SERPER_API_KEY가 설정되지 않았습니다.');
    return;
  }

  // Step 1: 검색
  const searchResults = await runSearch();
  saveJson(searchResults, `output/1_search-results-${timestamp}.json`);

  // Step 2: 1차 판별
  const classifiedResults = runClassify(searchResults);
  saveJson(classifiedResults, `output/2_classified-results-${timestamp}.json`);

  // Step 3: 2차 판별
  const llmJudgedResults = runLLMJudge(classifiedResults);
  saveJson(llmJudgedResults, `output/3_llm-judged-results-${timestamp}.json`);

  // Step 4: 승인 대기 목록
  const pendingItems = createPendingList(llmJudgedResults);
  saveJson(pendingItems, 'data/pending-review.json');

  // Step 5: 최종 결과 및 Excel
  const finalResults: FinalResult[] = llmJudgedResults.map(r => ({
    ...r,
    final_status: r.status === 'illegal' ? 'illegal' as const : 
                  r.status === 'legal' ? 'legal' as const : 'pending' as const,
    reviewed_at: r.status !== 'unknown' ? getCurrentISOTime() : null,
  }));

  saveJson(finalResults, `output/4_final-results-${timestamp}.json`);
  generateExcelReport(finalResults, `output/report_${timestamp}.xlsx`);

  // 완료 요약
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000 / 60).toFixed(1);

  console.log('\n' + '╔' + '═'.repeat(58) + '╗');
  console.log('║                    🎉 완료!                              ║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log(`⏱️  소요 시간: ${duration}분`);
  console.log('');
  console.log('📊 최종 결과:');
  console.log(`   - 총 검색 결과: ${finalResults.length}개`);
  console.log(`   - 불법 판정: ${finalResults.filter(r => r.final_status === 'illegal').length}개`);
  console.log(`   - 합법 판정: ${finalResults.filter(r => r.final_status === 'legal').length}개`);
  console.log(`   - 승인 대기: ${finalResults.filter(r => r.final_status === 'pending').length}개`);
  console.log('');
  console.log('📁 생성된 파일:');
  console.log(`   - output/report_${timestamp}.xlsx`);
  console.log(`   - data/pending-review.json`);
  console.log('');
  console.log('🌐 승인 UI: http://localhost:3000');
}

main().catch(console.error);
