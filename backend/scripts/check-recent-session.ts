import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // 최근 세션 확인
  const sessions = await sql`
    SELECT id, status, results_total, results_illegal, results_legal, results_pending, created_at 
    FROM sessions 
    ORDER BY created_at DESC 
    LIMIT 5
  `;

  console.log('📋 최근 세션:');
  for (const s of sessions as any[]) {
    console.log(`  - ${s.id}: ${s.status} (불법:${s.results_illegal}, 합법:${s.results_legal}, 대기:${s.results_pending})`);
  }

  // 최근 세션의 미분류 도메인 확인
  if (sessions.length > 0) {
    const latestSession = sessions[0] as any;
    console.log('\n📊 최근 세션 상세:', latestSession.id);
    
    const pendingResults = await sql`
      SELECT DISTINCT domain, initial_status, llm_judgment, llm_reason, final_status, snippet
      FROM detection_results 
      WHERE session_id = ${latestSession.id}
      AND final_status = 'pending'
      LIMIT 20
    `;
    
    console.log('🟡 대기(pending) 상태 도메인:', pendingResults.length, '개');
    for (const r of pendingResults as any[]) {
      console.log(`  - ${r.domain}`);
      console.log(`    LLM: ${r.llm_judgment || 'null'} - ${(r.llm_reason || '').substring(0, 50)}`);
      if (r.snippet) {
        console.log(`    스니펫: ${r.snippet.substring(0, 80)}...`);
      }
    }
  }
}

main();
