import 'dotenv/config';

// ============================================
// Manus API 설정 (트래픽 분석 전용)
// ============================================

const MANUS_API_KEY = process.env.MANUS_API_KEY;
const MANUS_API_URL = 'https://api.manus.ai/v1/tasks';
const MANUS_TRAFFIC_PROJECT_ID = process.env.MANUS_TRAFFIC_PROJECT_ID || 'TvfU37uAeUph4R3YLzR2LV';

// ============================================
// 타입 정의
// ============================================

export interface DomainAnalysisResult {
  rank: number;
  site_url: string;
  threat_score: number | null;
  global_rank: number | null;
  country: string | null;
  country_rank: number | null;
  category: string | null;
  category_rank: number | null;
  total_visits: number | null;
  avg_visit_duration: string | null;
  visits_change_mom: number | null;
  rank_change_mom: number | null;
  total_backlinks: number | null;
  referring_domains: number | null;
  top_organic_keywords: string[] | null;
  top_referring_domains: string[] | null;
  top_anchors: string[] | null;
  branded_traffic_ratio: number | null;
  size_score: number | null;
  growth_score: number | null;
  influence_score: number | null;
  recommendation: string | null;
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

export interface ManusTaskStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  output?: ManusTaskMessage[];
  credit_usage?: number;
}

// ============================================
// 프롬프트 생성
// ============================================

/**
 * 월간 도메인 분석 프롬프트 생성 (간결하게 - 상세 지침은 프로젝트 Instruction에 있음)
 */
export function buildAnalysisPrompt(
  domains: string[],
  previousData: DomainAnalysisResult[] | null
): string {
  const previousSection = previousData && previousData.length > 0
    ? JSON.stringify(previousData, null, 2)
    : '첫 분석이므로 전월 데이터 없음';

  return `${domains.length}개 사이트를 분석해주세요.

## 대상 도메인
${domains.join('\n')}

## 전월 데이터
${previousSection}`;
}

// ============================================
// Manus API 호출 함수
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Manus Task 생성 (트래픽 분석 프로젝트용)
 */
export async function createAnalysisTask(prompt: string): Promise<ManusTaskResponse | null> {
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
        projectId: MANUS_TRAFFIC_PROJECT_ID,
        taskMode: 'agent',
        hideInTaskList: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Manus API 오류 (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    console.log(`✅ Manus Task 생성: ${data.task_id}`);
    return data as ManusTaskResponse;
  } catch (error) {
    console.error('❌ Manus Task 생성 실패:', error);
    return null;
  }
}

/**
 * Manus Task 상태 확인
 */
export async function getAnalysisTaskStatus(taskId: string): Promise<ManusTaskStatus | null> {
  if (!MANUS_API_KEY) return null;

  try {
    const response = await fetch(`${MANUS_API_URL}/${taskId}`, {
      method: 'GET',
      headers: { 'API_KEY': MANUS_API_KEY },
    });

    if (!response.ok) {
      console.error(`❌ Manus 상태 조회 오류 (${response.status})`);
      return null;
    }

    return await response.json() as ManusTaskStatus;
  } catch (error) {
    console.error('❌ Manus 상태 조회 실패:', error);
    return null;
  }
}

// ============================================
// Manus 응답 파싱
// ============================================

/**
 * Manus 응답에서 priority_list JSON과 report Markdown을 추출
 */
export function parseManusOutput(output: ManusTaskMessage[]): {
  priorityList: DomainAnalysisResult[];
  reportMarkdown: string;
  rawTexts: string[];
} {
  const rawTexts: string[] = [];
  let priorityList: DomainAnalysisResult[] = [];
  let reportMarkdown = '';

  // 모든 assistant 메시지의 텍스트를 수집
  for (const message of output) {
    if (message.role === 'assistant' && message.content) {
      for (const content of message.content) {
        if (content.type === 'output_text' && content.text) {
          rawTexts.push(content.text);
        }
      }
    }
  }

  const fullText = rawTexts.join('\n\n');

  // 1. JSON 배열 추출 (priority_list)
  // ```json [...] ``` 블록에서 배열 찾기
  const jsonMatches = fullText.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g);
  for (const match of jsonMatches) {
    const jsonStr = match[1].trim();
    if (jsonStr.startsWith('[')) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].site_url) {
          priorityList = parsed as DomainAnalysisResult[];
          console.log(`✅ priority_list 파싱 성공: ${priorityList.length}개 사이트`);
        }
      } catch (e) {
        console.warn('⚠️ JSON 배열 파싱 시도 실패, 계속 탐색...');
      }
    }
  }

  // JSON을 찾지 못한 경우 순수 배열 탐색
  if (priorityList.length === 0) {
    const arrayMatch = fullText.match(/\[\s*\{[\s\S]*?"site_url"[\s\S]*?\}\s*\]/);
    if (arrayMatch) {
      try {
        priorityList = JSON.parse(arrayMatch[0]) as DomainAnalysisResult[];
        console.log(`✅ priority_list 순수 배열 파싱 성공: ${priorityList.length}개 사이트`);
      } catch (e) {
        console.error('❌ priority_list 파싱 최종 실패');
      }
    }
  }

  // 2. Markdown 보고서 추출
  // "# 월간 해적사이트 분석 보고서" 로 시작하는 부분 찾기
  const reportMatch = fullText.match(/(#\s*월간[\s\S]*?해적사이트[\s\S]*?보고서[\s\S]*?)(?=```json|\Z)/);
  if (reportMatch) {
    reportMarkdown = reportMatch[1].trim();
    console.log(`✅ 보고서 마크다운 추출 성공 (${reportMarkdown.length}자)`);
  } else {
    // 마크다운 헤더(#)로 시작하는 가장 긴 텍스트 블록을 보고서로 간주
    for (const text of rawTexts) {
      if (text.includes('# ') && text.length > reportMarkdown.length && !text.trim().startsWith('[')) {
        reportMarkdown = text.trim();
      }
    }
    if (reportMarkdown) {
      console.log(`✅ 보고서 마크다운 대안 추출 성공 (${reportMarkdown.length}자)`);
    } else {
      console.warn('⚠️ 보고서 마크다운 추출 실패');
    }
  }

  return { priorityList, reportMarkdown, rawTexts };
}

/**
 * Manus 응답에서 파일 URL들을 추출 (JSON/MD 파일 다운로드용)
 */
export function extractFileUrls(output: ManusTaskMessage[]): {
  jsonFileUrl: string | null;
  mdFileUrl: string | null;
} {
  let jsonFileUrl: string | null = null;
  let mdFileUrl: string | null = null;

  for (const message of output) {
    if (message.role === 'assistant' && message.content) {
      for (const content of message.content) {
        if (content.type === 'output_file' && content.fileUrl) {
          if (content.mimeType === 'application/json' || content.fileName?.endsWith('.json')) {
            jsonFileUrl = content.fileUrl;
          }
          if (content.mimeType === 'text/markdown' || content.fileName?.endsWith('.md')) {
            mdFileUrl = content.fileUrl;
          }
        }
      }
    }
  }

  return { jsonFileUrl, mdFileUrl };
}

/**
 * 파일 URL에서 콘텐츠 다운로드
 */
export async function downloadFileContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.text();
    }
    console.error(`❌ 파일 다운로드 실패 (${response.status})`);
    return null;
  } catch (error) {
    console.error('❌ 파일 다운로드 오류:', error);
    return null;
  }
}

/**
 * Manus Task 결과를 종합적으로 처리 (텍스트 + 파일 모두 탐색)
 */
export async function processManusResult(output: ManusTaskMessage[]): Promise<{
  priorityList: DomainAnalysisResult[];
  reportMarkdown: string;
}> {
  // 1차: 텍스트에서 파싱
  let { priorityList, reportMarkdown } = parseManusOutput(output);

  // 2차: 파일에서 보완 (텍스트에서 못 찾은 경우)
  const { jsonFileUrl, mdFileUrl } = extractFileUrls(output);

  if (priorityList.length === 0 && jsonFileUrl) {
    console.log('📎 JSON 파일에서 priority_list 다운로드 시도...');
    const jsonContent = await downloadFileContent(jsonFileUrl);
    if (jsonContent) {
      try {
        const parsed = JSON.parse(jsonContent);
        const data = Array.isArray(parsed) ? parsed : (parsed.priority_list || parsed.results || []);
        if (data.length > 0) {
          priorityList = data as DomainAnalysisResult[];
          console.log(`✅ 파일에서 priority_list 로드: ${priorityList.length}개`);
        }
      } catch (e) {
        console.error('❌ JSON 파일 파싱 실패');
      }
    }
  }

  if (!reportMarkdown && mdFileUrl) {
    console.log('📎 MD 파일에서 보고서 다운로드 시도...');
    const mdContent = await downloadFileContent(mdFileUrl);
    if (mdContent) {
      reportMarkdown = mdContent;
      console.log(`✅ 파일에서 보고서 로드 (${reportMarkdown.length}자)`);
    }
  }

  return { priorityList, reportMarkdown };
}
