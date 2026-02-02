import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const getDb = () => neon(process.env.DATABASE_URL!);

async function deleteOldData() {
  const sql = getDb();
  const cutoffDate = '2026-01-14';
  
  console.log('🗑️ 데이터 삭제 시작');
  console.log(`📅 삭제 기준: ${cutoffDate} 이하\n`);
  
  // 1. 삭제 전 현황 확인
  console.log('📊 삭제 전 현황:');
  
  const sessionsBefore = await sql`SELECT COUNT(*) as count FROM sessions WHERE id <= ${cutoffDate}`;
  console.log(`   - sessions: ${sessionsBefore[0].count}개`);
  
  const reportTrackingBefore = await sql`SELECT COUNT(*) as count FROM report_tracking WHERE session_id <= ${cutoffDate}`;
  console.log(`   - report_tracking: ${reportTrackingBefore[0].count}개`);
  
  const reportUploadsBefore = await sql`SELECT COUNT(*) as count FROM report_uploads WHERE session_id <= ${cutoffDate}`;
  console.log(`   - report_uploads: ${reportUploadsBefore[0].count}개`);
  
  const mantaHistoryBefore = await sql`SELECT COUNT(*) as count FROM manta_ranking_history WHERE session_id <= ${cutoffDate}`;
  console.log(`   - manta_ranking_history: ${mantaHistoryBefore[0].count}개`);
  
  console.log('\n🔄 삭제 진행 중...\n');
  
  // 2. report_tracking 삭제
  const rtResult = await sql`DELETE FROM report_tracking WHERE session_id <= ${cutoffDate}`;
  console.log(`✅ report_tracking 삭제 완료`);
  
  // 3. report_uploads 삭제
  const ruResult = await sql`DELETE FROM report_uploads WHERE session_id <= ${cutoffDate}`;
  console.log(`✅ report_uploads 삭제 완료`);
  
  // 4. manta_ranking_history 삭제
  const mhResult = await sql`DELETE FROM manta_ranking_history WHERE session_id <= ${cutoffDate}`;
  console.log(`✅ manta_ranking_history 삭제 완료`);
  
  // 5. sessions 삭제
  const sessResult = await sql`DELETE FROM sessions WHERE id <= ${cutoffDate}`;
  console.log(`✅ sessions 삭제 완료`);
  
  // 6. monthly_stats에서 2026-01 데이터 삭제 (재계산 필요)
  const msResult = await sql`DELETE FROM monthly_stats WHERE month = '2026-01'`;
  console.log(`✅ monthly_stats (2026-01) 삭제 완료`);
  
  console.log('\n' + '═'.repeat(50));
  console.log('🎉 삭제 완료!');
  console.log('═'.repeat(50));
  
  // 7. 삭제 후 현황 확인
  console.log('\n📊 삭제 후 현황:');
  
  const sessionsAfter = await sql`SELECT COUNT(*) as count FROM sessions`;
  console.log(`   - sessions: ${sessionsAfter[0].count}개`);
  
  const reportTrackingAfter = await sql`SELECT COUNT(*) as count FROM report_tracking`;
  console.log(`   - report_tracking: ${reportTrackingAfter[0].count}개`);
  
  const reportUploadsAfter = await sql`SELECT COUNT(*) as count FROM report_uploads`;
  console.log(`   - report_uploads: ${reportUploadsAfter[0].count}개`);
  
  const mantaHistoryAfter = await sql`SELECT COUNT(*) as count FROM manta_ranking_history`;
  console.log(`   - manta_ranking_history: ${mantaHistoryAfter[0].count}개`);
  
  const monthlyStatsAfter = await sql`SELECT COUNT(*) as count FROM monthly_stats`;
  console.log(`   - monthly_stats: ${monthlyStatsAfter[0].count}개`);
}

deleteOldData().catch(console.error);
