import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

interface FinalResult {
  title: string;
  domain: string;
  url: string;
  search_query: string;
  page: number;
  rank: number;
  status: string;
  llm_judgment: string | null;
  llm_reason: string | null;
  final_status: string;
  reviewed_at: string | null;
}

async function recoverFebData() {
  console.log('=== 2월 데이터 복구 ===\n');

  // 1. 2월 세션 정보 가져오기
  const febSession = await sql`
    SELECT id, file_final_results 
    FROM sessions 
    WHERE id = '2026-02-02T02-00-33'
  `;
  
  const session = febSession[0];
  console.log('세션:', session.id);
  console.log('Blob URL:', session.file_final_results);
  
  // 2. Blob에서 데이터 fetch
  console.log('\n📥 Blob 데이터 로드...');
  const response = await fetch(session.file_final_results);
  const allResults: FinalResult[] = await response.json();
  console.log('원본 결과 수:', allResults.length);
  
  // 3. URL 중복 제거 (illegal 우선)
  const urlMap = new Map<string, FinalResult>();
  for (const r of allResults) {
    const existing = urlMap.get(r.url);
    if (!existing) {
      urlMap.set(r.url, r);
    } else {
      // illegal이 우선
      if (r.final_status === 'illegal' && existing.final_status !== 'illegal') {
        urlMap.set(r.url, r);
      }
    }
  }
  const finalResults = Array.from(urlMap.values());
  console.log('중복 제거 후 결과 수:', finalResults.length);
  
  // 4. 배열 준비
  const sessionIds: string[] = [];
  const titles: string[] = [];
  const urls: string[] = [];
  const domains: string[] = [];
  const searchQueries: string[] = [];
  const pages: number[] = [];
  const ranks: number[] = [];
  const statuses: string[] = [];
  const llmJudgments: (string | null)[] = [];
  const llmReasons: (string | null)[] = [];
  const finalStatuses: string[] = [];
  const reviewedAts: (string | null)[] = [];

  for (const r of finalResults) {
    sessionIds.push(session.id);
    titles.push(r.title);
    urls.push(r.url);
    domains.push(r.domain);
    searchQueries.push(r.search_query);
    pages.push(r.page);
    ranks.push(r.rank);
    statuses.push(r.status);
    llmJudgments.push(r.llm_judgment);
    llmReasons.push(r.llm_reason);
    finalStatuses.push(r.final_status);
    reviewedAts.push(r.reviewed_at);
  }

  // 기존 데이터 삭제 (재실행 시)
  console.log('\n🗑️ 기존 2월 데이터 삭제...');
  await sql`DELETE FROM detection_results WHERE session_id = ${session.id}`;
  
  // 5. UNNEST를 사용한 배치 INSERT
  console.log('\n📤 배치 INSERT (UNNEST)...');
  
  try {
    const result = await sql`
      INSERT INTO detection_results (
        session_id, title, url, domain, 
        search_query, page, rank,
        initial_status, llm_judgment, llm_reason, final_status,
        reviewed_at
      )
      SELECT * FROM UNNEST(
        ${sessionIds}::text[],
        ${titles}::text[],
        ${urls}::text[],
        ${domains}::text[],
        ${searchQueries}::text[],
        ${pages}::int[],
        ${ranks}::int[],
        ${statuses}::text[],
        ${llmJudgments}::text[],
        ${llmReasons}::text[],
        ${finalStatuses}::text[],
        ${reviewedAts}::timestamptz[]
      )
      ON CONFLICT (session_id, url) DO NOTHING
    `;
    
    console.log('✅ INSERT 완료');
  } catch (error) {
    console.error('❌ INSERT 실패:', error);
  }

  // 5. 복구 확인
  console.log('\n=== 복구 확인 ===');
  const febCount = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE final_status = 'illegal') as illegal,
      COUNT(*) FILTER (WHERE final_status = 'legal') as legal,
      COUNT(*) FILTER (WHERE final_status = 'pending') as pending
    FROM detection_results
    WHERE session_id = '2026-02-02T02-00-33'
  `;
  console.log('2월 detection_results:', febCount[0]);

  // 6. 기대값과 비교
  console.log('\n=== 검증 ===');
  const sessionData = await sql`
    SELECT results_total, results_illegal, results_legal, results_pending
    FROM sessions
    WHERE id = '2026-02-02T02-00-33'
  `;
  console.log('세션 기대값:', sessionData[0]);
}

recoverFebData().catch(console.error);
