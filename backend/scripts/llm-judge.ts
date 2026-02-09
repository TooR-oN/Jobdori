import 'dotenv/config';
import { ClassifiedResult, LLMJudgedResult, Config } from './types/index.js';
import {
  loadConfig,
  loadTextFile,
  saveJson,
  getTimestamp,
  sleep,
} from './utils.js';
import { getUnknownDomains } from './classify.js';

// 도메인별 스니펫 정보 타입
interface DomainInfo {
  domain: string;
  snippets: string[];  // 해당 도메인의 모든 스니펫
  urls: string[];      // 해당 도메인의 URL들
  titles: string[];    // 관련 작품명들
}

// ============================================
// Manus API 설정
// ============================================

const MANUS_API_KEY = process.env.MANUS_API_KEY;
const MANUS_API_URL = 'https://api.manus.ai/v1/tasks';
const MANUS_PROJECT_ID = 'mhCkDAxQCwTJCdPx8KqR5s';  // Jobdori 프로젝트 ID

interface LLMJudgment {
  domain: string;
  judgment: 'likely_illegal' | 'likely_legal' | 'uncertain';
  reason: string;
}

interface ManusTaskResponse {
  task_id: string;
  task_title?: string;
  task_url?: string;
}

interface ManusMessageContent {
  type: 'output_text' | 'output_file';
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
}

interface ManusTaskMessage {
  id: string;
  status?: string;
  role: 'user' | 'assistant';
  type?: string;
  content: ManusMessageContent[];
}

interface ManusTaskStatus {
  id: string;
  object?: string;
  created_at?: number;
  updated_at?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  incomplete_details?: string;
  instructions?: string;
  model?: string;
  metadata?: {
    task_title?: string;
    task_url?: string;
  };
  output?: ManusTaskMessage[];
  locale?: string;
  credit_usage?: number;
}

// ============================================
// 프롬프트 생성
// ============================================

/**
 * 불법 사이트 판별 프롬프트 생성 (스니펫 포함)
 * NOTE: 판별 기준, 응답 형식 등은 Manus 프로젝트 Instruction에 정의되어 있음
 */
function createJudgmentPrompt(domainInfos: DomainInfo[], criteria: string, sessionId?: string, batchNum?: number): string {
  // 도메인 정보를 JSON 형식으로 포맷팅
  const domainsData = domainInfos.map(info => ({
    domain: info.domain,
    snippets: info.snippets.slice(0, 3),  // 최대 3개 스니펫
  }));

  // 세션 정보 헤더
  const sessionHeader = sessionId 
    ? `[Jobdori 모니터링 세션: ${sessionId}${batchNum ? ` - 배치 ${batchNum}` : ''}]\n\n`
    : '';

  return `${sessionHeader}다음 ${domainInfos.length}개 도메인의 불법 유통 사이트 여부를 판별해주세요.

## 추가 판별 기준 (참고용)
${criteria}

## 판별할 도메인 목록
\`\`\`json
${JSON.stringify({ domains: domainsData }, null, 2)}
\`\`\`

## 중요: 응답 형식
반드시 아래 JSON 형식으로 **텍스트로 직접 출력**해주세요. 파일로 첨부하지 마세요.

\`\`\`json
{
  "results": [
    {"domain": "example.com", "judgment": "likely_illegal|likely_legal|uncertain", "confidence": 0.0-1.0, "reason": "판단 근거"}
  ],
  "summary": {"total": N, "likely_illegal": N, "likely_legal": N, "uncertain": N}
}
\`\`\``;
}

/**
 * JSON 응답 파싱 (Manus 응답 형식)
 */
function parseJudgmentResponse(response: string): LLMJudgment[] {
  try {
    // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    // JSON 파싱
    const parsed = JSON.parse(jsonStr.trim());
    
    // results 배열 추출
    const results = parsed.results || parsed;
    
    // 유효성 검증
    if (!Array.isArray(results)) {
      throw new Error('응답이 배열 형식이 아닙니다.');
    }
    
    return results.map(item => ({
      domain: item.domain,
      judgment: item.judgment as 'likely_illegal' | 'likely_legal' | 'uncertain',
      reason: item.reason,
    }));
  } catch (error) {
    console.error('❌ JSON 파싱 실패:', error);
    console.error('원본 응답:', response.substring(0, 500));
    return [];
  }
}

// ============================================
// Manus API 호출
// ============================================

/**
 * Manus Task 생성
 */
async function createManusTask(prompt: string): Promise<ManusTaskResponse | null> {
  if (!MANUS_API_KEY) {
    console.error('❌ MANUS_API_KEY가 설정되지 않았습니다.');
    return null;
  }

  try {
    const response = await fetch(MANUS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API_KEY': MANUS_API_KEY,
      },
      body: JSON.stringify({
        prompt: prompt,
        agentProfile: 'manus-1.6-lite',
        projectId: MANUS_PROJECT_ID,
        taskMode: 'agent',
        hideInTaskList: false,  // 프로젝트 Task 목록에 표시
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Manus API 오류 (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    return data as ManusTaskResponse;
  } catch (error) {
    console.error('❌ Manus Task 생성 실패:', error);
    return null;
  }
}

/**
 * Manus Task 상태 확인
 */
async function getManusTaskStatus(taskId: string): Promise<ManusTaskStatus | null> {
  if (!MANUS_API_KEY) {
    return null;
  }

  try {
    const response = await fetch(`${MANUS_API_URL}/${taskId}`, {
      method: 'GET',
      headers: {
        'API_KEY': MANUS_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Manus 상태 조회 오류 (${response.status}):`, errorText);
      return null;
    }

    return await response.json() as ManusTaskStatus;
  } catch (error) {
    console.error('❌ Manus 상태 조회 실패:', error);
    return null;
  }
}

/**
 * Manus Task 완료 대기 (폴링)
 */
async function waitForManusTask(
  taskId: string,
  maxWaitMs: number = 300000,  // 5분
  pollIntervalMs: number = 5000  // 5초
): Promise<string | null> {
  const startTime = Date.now();
  let lastStatus = '';
  let retryCount = 0;
  const maxRetries = 3;

  // Task 생성 직후 약간의 딜레이 (propagation 시간)
  await sleep(2000);

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getManusTaskStatus(taskId);
    
    if (!status) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error(`❌ 상태 조회 실패 (${maxRetries}회 재시도 후 포기)`);
        return null;
      }
      console.log(`  ⚠️ 상태 조회 실패, ${retryCount}/${maxRetries} 재시도 중...`);
      await sleep(3000);  // 재시도 전 추가 대기
      continue;
    }
    retryCount = 0;  // 성공하면 카운터 리셋

    if (status.status !== lastStatus) {
      console.log(`  📊 Task 상태: ${status.status}`);
      lastStatus = status.status;
    }

    if (status.status === 'completed') {
      // 결과 추출 - output은 TaskMessage[] 배열
      const messages = status.output || [];
      let textResult: string | null = null;
      let fileUrl: string | null = null;
      
      // assistant의 마지막 메시지에서 텍스트 또는 파일 추출
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === 'assistant' && message.content) {
          for (const content of message.content) {
            if (content.type === 'output_text' && content.text) {
              // 텍스트에서 JSON 블록 추출 시도
              const jsonMatch = content.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (jsonMatch) {
                textResult = jsonMatch[1];
              } else if (content.text.trim().startsWith('{') || content.text.trim().startsWith('[')) {
                textResult = content.text;
              }
            }
            // 파일이 첨부된 경우
            if (content.type === 'output_file' && content.fileUrl && 
                (content.mimeType === 'application/json' || content.fileName?.endsWith('.json'))) {
              fileUrl = content.fileUrl;
            }
          }
        }
      }
      
      // 텍스트 결과가 있으면 반환
      if (textResult) {
        return textResult;
      }
      
      // 파일 URL이 있으면 파일 다운로드 시도
      if (fileUrl) {
        console.log('  📎 JSON 파일 첨부됨, 다운로드 시도...');
        try {
          const fileResponse = await fetch(fileUrl);
          if (fileResponse.ok) {
            return await fileResponse.text();
          }
        } catch (error) {
          console.error('  ❌ 파일 다운로드 실패:', error);
        }
      }
      
      console.log('  ⚠️ 완료되었지만 텍스트 결과 없음');
      console.log('  디버그 - output 구조:', JSON.stringify(status.output, null, 2).slice(0, 1000));
      return null;
    }

    if (status.status === 'failed') {
      console.error('❌ Task 실패:', status.error);
      return null;
    }

    await sleep(pollIntervalMs);
  }

  console.error('❌ Task 타임아웃 (5분 초과)');
  return null;
}

/**
 * Manus API를 통한 도메인 판별 (스니펫 포함)
 */
export async function judgeDomainsWithManus(
  domainInfos: DomainInfo[],
  criteria: string,
  sessionId?: string,
  batchNum?: number
): Promise<LLMJudgment[]> {
  if (!MANUS_API_KEY) {
    console.error('❌ MANUS_API_KEY가 설정되지 않았습니다.');
    console.error('   .env 파일에 MANUS_API_KEY를 설정해주세요.');
    // API 키 없으면 모두 uncertain으로 반환
    return domainInfos.map(info => ({
      domain: info.domain,
      judgment: 'uncertain' as const,
      reason: 'API 키가 설정되지 않아 판별 불가',
    }));
  }

  const prompt = createJudgmentPrompt(domainInfos, criteria, sessionId, batchNum);

  console.log(`  🤖 Manus API Task 생성 중... (${domainInfos.length}개 도메인, 스니펫 포함)`);
  
  // Task 생성
  const taskResponse = await createManusTask(prompt);
  if (!taskResponse) {
    return domainInfos.map(info => ({
      domain: info.domain,
      judgment: 'uncertain' as const,
      reason: 'Manus Task 생성 실패',
    }));
  }

  console.log(`  📝 Task 생성됨: ${taskResponse.task_id}`);
  if (taskResponse.task_url) {
    console.log(`  🔗 Task URL: ${taskResponse.task_url}`);
  }

  // Task 완료 대기
  console.log(`  ⏳ Task 완료 대기 중...`);
  const result = await waitForManusTask(taskResponse.task_id);
  
  if (!result) {
    return domainInfos.map(info => ({
      domain: info.domain,
      judgment: 'uncertain' as const,
      reason: 'Manus Task 실패 또는 타임아웃',
    }));
  }

  // 결과 파싱
  const judgments = parseJudgmentResponse(result);
  
  if (judgments.length === 0) {
    return domainInfos.map(info => ({
      domain: info.domain,
      judgment: 'uncertain' as const,
      reason: '응답 파싱 실패',
    }));
  }

  console.log(`  ✅ 판별 완료: ${judgments.length}개`);
  
  return judgments;
}

// ============================================
// 배치 처리
// ============================================

/**
 * 도메인을 배치로 나누어 처리 (스니펫 포함, API 호출 최적화)
 */
export async function judgeDomainsBatch(
  domainInfos: DomainInfo[],
  criteria: string,
  sessionId?: string,
  batchSize: number = 20  // Manus는 더 큰 배치 처리 가능
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
    
    const judgments = await judgeDomainsWithManus(batch, criteria, sessionId, i + 1);
    
    for (const judgment of judgments) {
      judgmentMap.set(judgment.domain.toLowerCase(), judgment);
    }

    // 배치 간 딜레이 (마지막 배치 제외)
    if (i < batches.length - 1) {
      console.log('  ⏳ 배치 간 딜레이: 10초');
      await sleep(10000);  // Manus는 좀 더 긴 딜레이
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
export function mergeJudgments(
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

export async function runLLMJudge(classifiedResults?: ClassifiedResult[], sessionId?: string): Promise<LLMJudgedResult[]> {
  console.log('🚀 2차 판별 모듈 시작 (Manus API)\n');

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
      { title: 'Solo Leveling', domain: 'w17.sololevelinganime.com', url: 'https://w17.sololevelinganime.com', search_query: 'Solo Leveling manga', page: 1, rank: 3, status: 'unknown', snippet: 'Read Solo Leveling Chapter 1 online for free at sololevelinganime' },
      { title: 'Solo Leveling', domain: 'mangareader.to', url: 'https://mangareader.to/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 4, status: 'unknown', snippet: 'Read Solo Leveling Manga online free at MangaReader' },
      { title: 'Solo Leveling', domain: 'readmanhwa.com', url: 'https://readmanhwa.com/solo-leveling', search_query: 'Solo Leveling manga', page: 1, rank: 5, status: 'unknown', snippet: 'Read manhwa Solo Leveling / 나 혼자만 레벨업' },
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

  // LLM 판별 실행 (Manus API, 스니펫 포함)
  const judgmentMap = await judgeDomainsBatch(domainInfos, criteria, sessionId);

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
