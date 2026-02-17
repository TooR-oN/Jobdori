import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { SearchResult, ClassifiedResult, Config } from './types/index.js';
import {
  loadConfig,
  saveJson,
  loadJson,
  getTimestamp,
} from './utils.js';

// DB 연결
const getDb = () => neon(process.env.DATABASE_URL!);

/**
 * DB에서 사이트 목록 로드
 */
async function loadSitesFromDb(type: 'illegal' | 'legal'): Promise<Set<string>> {
  const sql = getDb();
  const rows = await sql`SELECT domain FROM sites WHERE type = ${type}`;
  return new Set(rows.map((r: any) => r.domain.toLowerCase()));
}

// ============================================
// 1차 판별 (리스트 대조)
// ============================================

/**
 * 도메인이 리스트에 있는지 확인 - 정확 매칭만
 */
function exactDomainMatch(domain: string, list: Set<string>): boolean {
  return list.has(domain);
}

/**
 * 도메인이 리스트에 있는지 확인 - 서브도메인 포함
 * (예: kr.pinterest.com → pinterest.com 매칭)
 */
function subdomainDomainMatch(domain: string, list: Set<string>): boolean {
  if (list.has(domain)) return true;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (list.has(parentDomain)) return true;
  }
  return false;
}

/**
 * 검색 결과를 불법/합법 리스트와 대조하여 분류
 */
export function classifyResults(
  searchResults: SearchResult[],
  illegalSites: Set<string>,
  legalSites: Set<string>
): ClassifiedResult[] {
  console.log('🔍 1차 판별 시작 (리스트 대조)\n');

  const classifiedResults: ClassifiedResult[] = [];
  
  let illegalCount = 0;
  let legalCount = 0;
  let unknownCount = 0;

  for (const result of searchResults) {
    const domain = result.domain.toLowerCase();
    
    let status: 'illegal' | 'legal' | 'unknown';

    if (exactDomainMatch(domain, illegalSites)) {
      status = 'illegal';
      illegalCount++;
    } else if (subdomainDomainMatch(domain, legalSites)) {
      status = 'legal';
      legalCount++;
    } else {
      status = 'unknown';
      unknownCount++;
    }

    classifiedResults.push({
      ...result,
      status,
    });
  }

  console.log('📊 1차 판별 결과:');
  console.log(`   🔴 불법 (illegal): ${illegalCount}개`);
  console.log(`   🟢 합법 (legal): ${legalCount}개`);
  console.log(`   🟡 미분류 (unknown): ${unknownCount}개`);
  console.log('');

  return classifiedResults;
}

/**
 * 미분류(unknown) 도메인 목록 추출 (중복 제거)
 */
export function getUnknownDomains(results: ClassifiedResult[]): string[] {
  const unknownDomains = new Set<string>();
  
  for (const result of results) {
    if (result.status === 'unknown') {
      unknownDomains.add(result.domain);
    }
  }

  return Array.from(unknownDomains);
}

/**
 * 도메인별 결과 그룹화
 */
export function groupByDomain(results: ClassifiedResult[]): Map<string, ClassifiedResult[]> {
  const grouped = new Map<string, ClassifiedResult[]>();

  for (const result of results) {
    const domain = result.domain;
    if (!grouped.has(domain)) {
      grouped.set(domain, []);
    }
    grouped.get(domain)!.push(result);
  }

  return grouped;
}

// ============================================
// 메인 분류 함수
// ============================================

export async function runClassify(searchResults?: SearchResult[]): Promise<ClassifiedResult[]> {
  console.log('🚀 1차 판별 모듈 시작\n');

  // DB에서 불법/합법 사이트 리스트 로드
  console.log('📋 DB에서 사이트 목록 로드 중...');
  const illegalSites = await loadSitesFromDb('illegal');
  const legalSites = await loadSitesFromDb('legal');

  console.log(`📋 불법 사이트 리스트 (DB): ${illegalSites.size}개`);
  console.log(`📋 합법 사이트 리스트 (DB): ${legalSites.size}개\n`);

  // 검색 결과 로드 (파라미터로 전달되지 않은 경우)
  let results: SearchResult[];
  if (searchResults) {
    results = searchResults;
  } else {
    // 가장 최근 검색 결과 파일 로드 (테스트용)
    const testResults: SearchResult[] = [
      { title: 'Solo Leveling', domain: 'reddit.com', url: 'https://reddit.com/r/sololeveling', search_query: 'Solo Leveling manga', page: 1, rank: 1 },
      { title: 'Solo Leveling', domain: 'mangafreak.net', url: 'https://mangafreak.net/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 2 },
      { title: 'Solo Leveling', domain: 'tappytoon.com', url: 'https://tappytoon.com/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 3 },
      { title: 'Solo Leveling', domain: 'w17.sololevelinganime.com', url: 'https://w17.sololevelinganime.com', search_query: 'Solo Leveling manga', page: 1, rank: 4 },
      { title: 'Solo Leveling', domain: 'wikipedia.org', url: 'https://en.wikipedia.org/wiki/Solo_Leveling', search_query: 'Solo Leveling manga', page: 1, rank: 5 },
    ];
    results = testResults;
    console.log('⚠️ 테스트 데이터 사용 중\n');
  }

  console.log(`📊 검색 결과 수: ${results.length}개\n`);

  // 분류 실행
  const classifiedResults = classifyResults(results, illegalSites, legalSites);

  // 미분류 도메인 목록
  const unknownDomains = getUnknownDomains(classifiedResults);
  console.log(`🟡 미분류 도메인 (${unknownDomains.length}개):`);
  for (const domain of unknownDomains) {
    console.log(`   - ${domain}`);
  }

  return classifiedResults;
}

// ============================================
// 직접 실행 시
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runClassify()
    .then(results => {
      const timestamp = getTimestamp();
      saveJson(results, `output/classified-results-${timestamp}.json`);
    })
    .catch(console.error);
}
