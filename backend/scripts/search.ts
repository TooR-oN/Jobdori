import 'dotenv/config';
import { SearchResult, Config, TitleSearchConfig } from './types/index.js';
import {
  getRandomDelay,
  sleep,
  extractDomain,
  loadConfig,
  loadTitlesFromDb,
  loadKeywords,
  saveJson,
  getTimestamp,
} from './utils.js';

// ============================================
// Serper.dev API 설정
// ============================================

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_API_URL = 'https://google.serper.dev/search';

interface SerperResult {
  title: string;
  link: string;
  snippet?: string;
  position: number;
}

interface SerperResponse {
  organic: SerperResult[];
  searchParameters: {
    q: string;
    gl: string;
    hl: string;
    num: number;
    page: number;
  };
}

// ============================================
// Serper.dev API 검색
// ============================================

/**
 * Serper.dev API를 통한 구글 검색
 */
async function searchWithSerper(
  query: string,
  page: number = 1,
  num: number = 10
): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }

  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      gl: 'us',
      hl: 'en',
      num: num,
      page: page,
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper API 오류: ${response.status} ${response.statusText}`);
  }

  const data: SerperResponse = await response.json();
  return data.organic || [];
}

/**
 * 단일 검색 쿼리 실행 (페이지 1-3)
 */
export async function executeSearch(
  query: string,
  titleName: string,
  config: Config
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let globalRank = 1;

  console.log(`  🔍 검색 중: "${query}"`);

  for (let pageNum = 1; pageNum <= config.search.maxPages; pageNum++) {
    try {
      // Serper API 호출
      const pageResults = await searchWithSerper(query, pageNum, config.search.resultsPerPage);

      console.log(`    📄 페이지 ${pageNum}: ${pageResults.length}개 결과`);

      // 결과 저장 (스니펫 포함)
      for (const item of pageResults) {
        if (globalRank > config.search.maxResults) break;

        results.push({
          title: titleName,
          domain: extractDomain(item.link),
          url: item.link,
          search_query: query,
          page: pageNum,
          rank: globalRank,
          snippet: item.snippet || undefined,  // 스니펫 저장 (LLM 판별용)
        });
        globalRank++;
      }

      // 최대 결과 수 도달 시 중단
      if (globalRank > config.search.maxResults) break;

      // 다음 페이지가 있으면 딜레이
      if (pageNum < config.search.maxPages && pageResults.length > 0) {
        const delay = getRandomDelay(
          config.search.delayBetweenPages.min,
          config.search.delayBetweenPages.max
        );
        console.log(`    ⏳ 페이지 간 딜레이: ${(delay / 1000).toFixed(1)}초`);
        await sleep(delay);
      }
    } catch (error) {
      console.error(`    ❌ 페이지 ${pageNum} 검색 실패:`, error);
      continue;
    }
  }

  return results;
}

// ============================================
// 메인 검색 함수
// ============================================

export async function runSearch(): Promise<SearchResult[]> {
  console.log('🚀 구글 검색 모듈 시작 (Serper.dev API)\n');

  // API 키 확인
  if (!SERPER_API_KEY) {
    console.error('❌ SERPER_API_KEY가 설정되지 않았습니다.');
    console.error('   .env 파일에 SERPER_API_KEY를 설정해주세요.');
    process.exit(1);
  }

  // 설정 로드
  const config = loadConfig();

  // 작품 제목 로드 (DB 기반 - 실시간 반영, 비공식 타이틀 포함)
  const titleConfigs: TitleSearchConfig[] = await loadTitlesFromDb();
  console.log(`📚 작품 수: ${titleConfigs.length}개`);
  
  // 비공식 타이틀 통계 출력
  const titlesWithAliases = titleConfigs.filter(t => t.searchTerms.length > 1).length;
  const totalSearchTerms = titleConfigs.reduce((sum, t) => sum + t.searchTerms.length, 0);
  if (titlesWithAliases > 0) {
    console.log(`🔖 비공식 타이틀 보유 작품: ${titlesWithAliases}개`);
    console.log(`🔍 총 검색어 수: ${totalSearchTerms}개 (공식 + 비공식)`);
  }

  // 키워드 로드 (빈 문자열도 포함 - 작품명만 검색)
  const rawKeywords = loadKeywords(config.paths.keywordsFile);
  // 빈 줄을 빈 문자열로 처리 (작품명만 검색)
  const keywords = rawKeywords.length > 0 ? rawKeywords : [''];
  const keywordDisplay = keywords.map(k => k || '[작품명만]').join(', ');
  console.log(`🏷️  키워드: ${keywordDisplay}`);

  const totalSearches = totalSearchTerms * keywords.length;
  console.log(`🔢 총 검색 횟수: ${totalSearches}회`);
  console.log(`📊 예상 API 호출: ${totalSearches * config.search.maxPages}회\n`);

  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>(); // URL 중복 제거용
  let searchCount = 0;

  for (const titleConfig of titleConfigs) {
    const officialTitle = titleConfig.official;
    const hasAliases = titleConfig.searchTerms.length > 1;
    
    console.log(`\n📖 작품: ${officialTitle}${hasAliases ? ` (+ ${titleConfig.searchTerms.length - 1}개 비공식 타이틀)` : ''}`);

    // 모든 검색어 (공식 + 비공식) 순회
    for (const searchTerm of titleConfig.searchTerms) {
      const isAlias = searchTerm !== officialTitle;
      
      for (const keyword of keywords) {
        searchCount++;
        // 키워드가 빈 문자열이면 작품명만 검색
        const query = keyword ? `${searchTerm} ${keyword}` : searchTerm;

        console.log(`\n[${searchCount}/${totalSearches}]${isAlias ? ` (비공식: ${searchTerm})` : ''}`);

        // 검색 실행 (결과의 title은 항상 공식 타이틀로 통일)
        const results = await executeSearch(query, officialTitle, config);
        
        // URL 중복 제거 후 추가
        let addedCount = 0;
        for (const result of results) {
          if (!seenUrls.has(result.url)) {
            seenUrls.add(result.url);
            allResults.push(result);
            addedCount++;
          }
        }

        console.log(`    ✅ 수집 완료: ${results.length}개 결과 (신규: ${addedCount}개, 중복 제외: ${results.length - addedCount}개)`);

        // 다음 검색 전 딜레이 (마지막 검색 제외)
        if (searchCount < totalSearches) {
          const delay = getRandomDelay(
            config.search.delayBetweenSearches.min,
            config.search.delayBetweenSearches.max
          );
          console.log(`    ⏳ 검색 간 딜레이: ${(delay / 1000).toFixed(1)}초`);
          await sleep(delay);
        }
      }
    }
  }

  console.log(`\n\n✅ 검색 완료!`);
  console.log(`📊 총 수집 결과: ${allResults.length}개 (중복 URL 제거됨)`);

  return allResults;
}

// ============================================
// 직접 실행 시
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runSearch()
    .then(results => {
      const timestamp = getTimestamp();
      saveJson(results, `output/search-results-${timestamp}.json`);
    })
    .catch(console.error);
}
