import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ClassifiedResult, LLMJudgedResult, Config } from './types/index.js';
import {
  loadConfig,
  loadTextFile,
  saveJson,
  getTimestamp,
  sleep,
} from './utils.js';
import { getUnknownDomains, groupByDomain } from './classify.js';

// 도메인별 스니펫 정보 타입
interface DomainInfo {
  domain: string;
  snippets: string[];  // 해당 도메인의 모든 스니펫
  urls: string[];      // 해당 도메인의 URL들
  titles: string[];    // 관련 작품명들
}

// ============================================
// Gemini API 설정
// ============================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

interface LLMJudgment {
  domain: string;
  judgment: 'likely_illegal' | 'likely_legal' | 'uncertain';
  reason: string;
}

// ============================================
// 프롬프트 생성
// ============================================

/**
 * 불법 사이트 판별 프롬프트 생성 (스니펫 포함)
 */
function createJudgmentPrompt(domainInfos: DomainInfo[], criteria: string): string {
  // 도메인 정보를 포맷팅 (스니펫 포함)
  const domainList = domainInfos.map((info, i) => {
    let entry = `${i + 1}. 도메인: ${info.domain}`;
    
    // 스니펫이 있으면 추가 (최대 3개까지만)
    if (info.snippets.length > 0) {
      const snippetTexts = info.snippets.slice(0, 3).map(s => `   - "${s}"`).join('\n');
      entry += `\n   스니펫:\n${snippetTexts}`;
    }
    
    return entry;
  }).join('\n\n');

  return `당신은 웹툰/만화 불법 유통 사이트를 판별하는 전문가입니다.

아래 판별 기준을 참고하여 각 도메인이 불법 사이트인지 판단해주세요.
**스니펫 정보**를 활용하여 더 정확한 판단을 내려주세요.

## 판별 기준
${criteria}

## 판별할 도메인 목록 (스니펫 포함)
${domainList}

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.

\`\`\`json
[
  {
    "domain": "도메인명",
    "judgment": "likely_illegal" | "likely_legal" | "uncertain",
    "reason": "판단 근거 (한국어로 간단히, 스니펫 내용 참고)"
  }
]
\`\`\`

## 판단 기준
- likely_illegal: 불법 사이트로 강하게 의심됨
  - 스니펫에 "무료", "free", "read online", "스캔", "번역본" 등 표현
  - 도메인명에 manga, manhwa, comic, scan, read 등 포함
- likely_legal: 합법 사이트로 판단됨 (공식 플랫폼, 뉴스, 쇼핑몰, SNS 등)
- uncertain: 스니펫과 도메인 정보로도 판단하기 어려움

각 도메인에 대해 판단해주세요.`;
}

/**
 * JSON 응답 파싱
 */
function parseJudgmentResponse(response: string): LLMJudgment[] {
  try {
    // JSON 블록 추출
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    
    // JSON 파싱
    const parsed = JSON.parse(jsonStr.trim());
    
    // 유효성 검증
    if (!Array.isArray(parsed)) {
      throw new Error('응답이 배열 형식이 아닙니다.');
    }
    
    return parsed.map(item => ({
      domain: item.domain,
      judgment: item.judgment as 'likely_illegal' | 'likely_legal' | 'uncertain',
      reason: item.reason,
    }));
  } catch (error) {
    console.error('❌ JSON 파싱 실패:', error);
    console.error('원본 응답:', response);
    return [];
  }
}

// ============================================
// Gemini API 호출
// ============================================

/**
 * Gemini API를 통한 도메인 판별 (스니펫 포함)
 */
async function judgeDomainsWithGemini(
  domainInfos: DomainInfo[],
  criteria: string,
  config: Config
): Promise<LLMJudgment[]> {
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY가 설정되지 않았습니다.');
    console.error('   .env 파일에 GEMINI_API_KEY를 설정해주세요.');
    // API 키 없으면 모두 uncertain으로 반환
    return domainInfos.map(info => ({
      domain: info.domain,
      judgment: 'uncertain' as const,
      reason: 'API 키가 설정되지 않아 판별 불가',
    }));
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: config.llm.model });

  const prompt = createJudgmentPrompt(domainInfos, criteria);

  try {
    console.log(`  🤖 Gemini API 호출 중... (${domainInfos.length}개 도메인, 스니펫 포함)`);
    
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    const judgments = parseJudgmentResponse(response);
    
    console.log(`  ✅ 판별 완료: ${judgments.length}개`);
    
    return judgments;
  } catch (error) {
    console.error('❌ Gemini API 호출 실패:', error);
    // 오류 시 모두 uncertain으로 반환
    return domainInfos.map(info => ({
      domain: info.domain,
      judgment: 'uncertain' as const,
      reason: 'API 호출 실패',
    }));
  }
}

// ============================================
// 배치 처리
// ============================================

/**
 * 도메인을 배치로 나누어 처리 (스니펫 포함, API 호출 최적화)
 */
async function judgeDomainsBatch(
  domainInfos: DomainInfo[],
  criteria: string,
  config: Config,
  batchSize: number = 10
): Promise<Map<string, LLMJudgment>> {
  const judgmentMap = new Map<string, LLMJudgment>();
  
  // 배치로 나누기
  const batches: DomainInfo[][] = [];
  for (let i = 0; i < domainInfos.length; i += batchSize) {
    batches.push(domainInfos.slice(i, i + batchSize));
  }

  console.log(`\n📦 총 ${batches.length}개 배치로 처리 (배치당 최대 ${batchSize}개, 스니펫 포함)\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[배치 ${i + 1}/${batches.length}]`);
    
    const judgments = await judgeDomainsWithGemini(batch, criteria, config);
    
    for (const judgment of judgments) {
      judgmentMap.set(judgment.domain.toLowerCase(), judgment);
    }

    // 배치 간 딜레이 (마지막 배치 제외)
    if (i < batches.length - 1) {
      console.log('  ⏳ 배치 간 딜레이: 2초');
      await sleep(2000);
    }
  }

  return judgmentMap;
}

// ============================================
// 결과 병합
// ============================================

/**
 * LLM 판별 결과를 분류 결과에 병합
 */
function mergeJudgments(
  classifiedResults: ClassifiedResult[],
  judgmentMap: Map<string, LLMJudgment>
): LLMJudgedResult[] {
  return classifiedResults.map(result => {
    const judgment = judgmentMap.get(result.domain.toLowerCase());
    
    return {
      ...result,
      llm_judgment: result.status === 'unknown' && judgment
        ? judgment.judgment
        : null,
      llm_reason: result.status === 'unknown' && judgment
        ? judgment.reason
        : null,
    };
  });
}

// ============================================
// 메인 함수
// ============================================

export async function runLLMJudge(classifiedResults?: ClassifiedResult[]): Promise<LLMJudgedResult[]> {
  console.log('🚀 2차 판별 모듈 시작 (Gemini LLM)\n');

  // 설정 로드
  const config = loadConfig();

  // 판별 기준 로드
  const criteriaLines = loadTextFile(config.paths.criteriaFile);
  const criteria = criteriaLines.join('\n');
  console.log(`📋 판별 기준 로드 완료\n`);

  // 테스트 데이터 (classifiedResults가 없는 경우)
  if (!classifiedResults) {
    const testResults: ClassifiedResult[] = [
      { title: 'Solo Leveling', domain: 'reddit.com', url: 'https://reddit.com/r/sololeveling', search_query: 'Solo Leveling manga', page: 1, rank: 1, status: 'legal' },
      { title: 'Solo Leveling', domain: 'mangafreak.net', url: 'https://mangafreak.net/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 2, status: 'illegal' },
      { title: 'Solo Leveling', domain: 'w17.sololevelinganime.com', url: 'https://w17.sololevelinganime.com', search_query: 'Solo Leveling manga', page: 1, rank: 3, status: 'unknown' },
      { title: 'Solo Leveling', domain: 'mangareader.to', url: 'https://mangareader.to/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 4, status: 'unknown' },
      { title: 'Solo Leveling', domain: 'readmanhwa.com', url: 'https://readmanhwa.com/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 5, status: 'unknown' },
    ];
    classifiedResults = testResults;
    console.log('⚠️ 테스트 데이터 사용 중\n');
  }

  // 미분류 도메인 추출 (중복 제거)
  const unknownDomains = getUnknownDomains(classifiedResults);
  
  console.log(`📊 전체 결과: ${classifiedResults.length}개`);
  console.log(`🟡 미분류 도메인: ${unknownDomains.length}개\n`);

  if (unknownDomains.length === 0) {
    console.log('✅ 미분류 도메인이 없습니다. LLM 판별을 건너뜁니다.\n');
    return classifiedResults.map(r => ({
      ...r,
      llm_judgment: null,
      llm_reason: null,
    }));
  }

  // 도메인별 스니펫 정보 수집
  const domainInfoMap = new Map<string, DomainInfo>();
  
  for (const result of classifiedResults) {
    if (result.status === 'unknown') {
      const domainLower = result.domain.toLowerCase();
      
      if (!domainInfoMap.has(domainLower)) {
        domainInfoMap.set(domainLower, {
          domain: result.domain,
          snippets: [],
          urls: [],
          titles: [],
        });
      }
      
      const info = domainInfoMap.get(domainLower)!;
      
      // 스니펫 추가 (중복 제거, 없으면 건너뛰기)
      if (result.snippet && !info.snippets.includes(result.snippet)) {
        info.snippets.push(result.snippet);
      }
      
      // URL 추가 (중복 제거)
      if (!info.urls.includes(result.url)) {
        info.urls.push(result.url);
      }
      
      // 작품명 추가 (중복 제거)
      if (!info.titles.includes(result.title)) {
        info.titles.push(result.title);
      }
    }
  }
  
  const domainInfos = Array.from(domainInfoMap.values());
  
  console.log('🟡 판별할 도메인 (스니펫 포함):');
  for (const info of domainInfos) {
    const snippetCount = info.snippets.length;
    console.log(`   - ${info.domain} (${snippetCount}개 스니펫)`);
  }

  // LLM 판별 실행 (스니펫 포함)
  const judgmentMap = await judgeDomainsBatch(domainInfos, criteria, config);

  // 결과 병합
  const judgedResults = mergeJudgments(classifiedResults, judgmentMap);

  // 통계 출력
  const likelyIllegal = judgedResults.filter(r => r.llm_judgment === 'likely_illegal').length;
  const likelyLegal = judgedResults.filter(r => r.llm_judgment === 'likely_legal').length;
  const uncertain = judgedResults.filter(r => r.llm_judgment === 'uncertain').length;

  console.log('\n📊 LLM 판별 결과:');
  console.log(`   🔴 불법 추정 (likely_illegal): ${likelyIllegal}개`);
  console.log(`   🟢 합법 추정 (likely_legal): ${likelyLegal}개`);
  console.log(`   🟡 불확실 (uncertain): ${uncertain}개`);

  return judgedResults;
}

// ============================================
// 직접 실행 시
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runLLMJudge()
    .then(results => {
      const timestamp = getTimestamp();
      saveJson(results, `output/llm-judged-results-${timestamp}.json`);
    })
    .catch(console.error);
}
