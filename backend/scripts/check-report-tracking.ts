import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function checkReportTracking() {
  console.log('=== Report Tracking 데이터 분석 ===\n');
  
  // 1. 전체 URL 수
  const totalCount = await sql`SELECT COUNT(*) as count FROM report_tracking`;
  console.log(`1. 전체 URL 수: ${totalCount[0].count}개\n`);
  
  // 2. 세션별 URL 수
  const sessionCounts = await sql`
    SELECT session_id, COUNT(*) as count
    FROM report_tracking
    GROUP BY session_id
    ORDER BY session_id DESC
    LIMIT 10
  `;
  console.log('2. 세션별 URL 수 (최근 10개):');
  sessionCounts.forEach(s => {
    console.log(`   ${s.session_id}: ${s.count}개`);
  });
  
  // 3. 가장 최근 세션의 데이터 확인
  if (sessionCounts.length > 0) {
    const latestSession = sessionCounts[0].session_id;
    console.log(`\n3. 최신 세션 (${latestSession}) 상세:`);
    
    // 상태별 분포
    const statusDist = await sql`
      SELECT report_status, COUNT(*) as count
      FROM report_tracking
      WHERE session_id = ${latestSession}
      GROUP BY report_status
    `;
    console.log('   상태별 분포:');
    statusDist.forEach(s => {
      console.log(`     ${s.report_status}: ${s.count}개`);
    });
    
    // 샘플 URL 5개
    const sampleUrls = await sql`
      SELECT id, url, domain, report_status
      FROM report_tracking
      WHERE session_id = ${latestSession}
      LIMIT 5
    `;
    console.log('\n   샘플 URL 5개:');
    sampleUrls.forEach(u => {
      console.log(`     [${u.report_status}] ${u.domain}: ${u.url.substring(0, 60)}...`);
    });
  }
  
  // 4. API 응답 시뮬레이션
  console.log('\n4. API 응답 시뮬레이션 (limit=50):');
  if (sessionCounts.length > 0) {
    const latestSession = sessionCounts[0].session_id;
    const page1 = await sql`
      SELECT * FROM report_tracking 
      WHERE session_id = ${latestSession}
      ORDER BY updated_at DESC
      LIMIT 50 OFFSET 0
    `;
    console.log(`   Page 1: ${page1.length}개 반환`);
    
    const totalForSession = await sql`
      SELECT COUNT(*) as count FROM report_tracking 
      WHERE session_id = ${latestSession}
    `;
    console.log(`   전체: ${totalForSession[0].count}개`);
    console.log(`   총 페이지: ${Math.ceil(totalForSession[0].count / 50)}페이지`);
  }
}

checkReportTracking().catch(console.error);
