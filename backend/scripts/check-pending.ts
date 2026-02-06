import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // 대기 중인 도메인 확인
  const pending = await sql`
    SELECT id, domain, urls, titles, llm_judgment, llm_reason, created_at 
    FROM pending_reviews 
    ORDER BY created_at DESC 
    LIMIT 10
  `;

  console.log('📋 대기 중인 도메인:', pending.length, '개');
  for (const p of pending as any[]) {
    console.log('  -', p.domain, '(', p.llm_judgment || 'null', ')');
  }
}

main();
