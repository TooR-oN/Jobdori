import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  // 업데이트된 pending_reviews 통계
  const stats = await sql`
    SELECT 
      llm_judgment,
      COUNT(*) as count
    FROM pending_reviews
    GROUP BY llm_judgment
    ORDER BY count DESC
  `;
  
  console.log('=== Pending Reviews 통계 ===');
  stats.forEach(s => {
    console.log(`  ${s.llm_judgment || 'null'}: ${s.count}개`);
  });
  
  // 불법 추정 도메인 목록
  const illegal = await sql`
    SELECT domain, llm_reason
    FROM pending_reviews
    WHERE llm_judgment = 'likely_illegal'
  `;
  
  console.log('\n=== 불법 추정 도메인 ===');
  illegal.forEach(d => {
    console.log(`  - ${d.domain}: ${d.llm_reason}`);
  });
  
  // 불확실 도메인 목록
  const uncertain = await sql`
    SELECT domain, llm_reason
    FROM pending_reviews
    WHERE llm_judgment = 'uncertain'
  `;
  
  console.log('\n=== 불확실 도메인 ===');
  uncertain.forEach(d => {
    console.log(`  - ${d.domain}: ${d.llm_reason}`);
  });
}

check().catch(console.error);
