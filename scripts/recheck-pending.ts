import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

/**
 * 승인 대기 목록을 DB sites 테이블과 대조하여 재검토
 */
async function recheckPending() {
  console.log('🔍 승인 대기 목록 재검토 시작\n');
  
  // 1. 현재 승인 대기 목록 조회
  const pendingItems = await sql`SELECT * FROM pending_reviews ORDER BY created_at DESC`;
  console.log(`📋 승인 대기 항목: ${pendingItems.length}개\n`);
  
  if (pendingItems.length === 0) {
    console.log('✅ 승인 대기 항목이 없습니다.');
    return;
  }
  
  // 2. DB에서 불법/합법 사이트 목록 조회
  const illegalSites = await sql`SELECT domain FROM sites WHERE type = 'illegal'`;
  const legalSites = await sql`SELECT domain FROM sites WHERE type = 'legal'`;
  
  const illegalSet = new Set(illegalSites.map((r: any) => r.domain.toLowerCase()));
  const legalSet = new Set(legalSites.map((r: any) => r.domain.toLowerCase()));
  
  console.log(`📊 DB 불법 사이트: ${illegalSet.size}개`);
  console.log(`📊 DB 합법 사이트: ${legalSet.size}개\n`);
  
  // 3. 각 승인 대기 항목 검토
  let illegalCount = 0;
  let legalCount = 0;
  let remainCount = 0;
  let reportTrackingRegistered = 0;
  
  for (const item of pendingItems) {
    const domain = item.domain.toLowerCase();
    
    // 서브도메인도 체크 (예: en.wikipedia.org → wikipedia.org)
    const checkDomain = (d: string, set: Set<string>): boolean => {
      if (set.has(d)) return true;
      const parts = d.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const parentDomain = parts.slice(i).join('.');
        if (set.has(parentDomain)) return true;
      }
      return false;
    };
    
    if (checkDomain(domain, illegalSet)) {
      // 불법 사이트로 이미 등록됨 → 삭제 + report_tracking 등록
      console.log(`🔴 불법 처리: ${domain}`);
      
      // report_tracking에 URL 등록
      if (item.session_id && item.urls) {
        try {
          const urls = typeof item.urls === 'string' ? JSON.parse(item.urls) : item.urls;
          const titles = item.titles ? (typeof item.titles === 'string' ? JSON.parse(item.titles) : item.titles) : [];
          
          for (let i = 0; i < urls.length; i++) {
            try {
              await sql`
                INSERT INTO report_tracking (session_id, url, domain, title, report_status)
                VALUES (${item.session_id}, ${urls[i]}, ${domain}, ${titles[i] || null}, '미신고')
                ON CONFLICT (session_id, url) DO NOTHING
              `;
              reportTrackingRegistered++;
            } catch (e) {
              // 중복 무시
            }
          }
        } catch (e) {
          console.error(`  ⚠️ URL 파싱 오류: ${e}`);
        }
      }
      
      // pending_reviews에서 삭제
      await sql`DELETE FROM pending_reviews WHERE id = ${item.id}`;
      illegalCount++;
      
    } else if (checkDomain(domain, legalSet)) {
      // 합법 사이트로 이미 등록됨 → 삭제만
      console.log(`🟢 합법 처리: ${domain}`);
      await sql`DELETE FROM pending_reviews WHERE id = ${item.id}`;
      legalCount++;
      
    } else {
      // 아직 미판단 → 유지
      remainCount++;
    }
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('📊 재검토 결과');
  console.log('═'.repeat(50));
  console.log(`🔴 불법 처리: ${illegalCount}개`);
  console.log(`🟢 합법 처리: ${legalCount}개`);
  console.log(`🟡 승인 대기 유지: ${remainCount}개`);
  console.log(`📋 신고결과 추적 등록: ${reportTrackingRegistered}개 URL`);
  
  // 최종 승인 대기 수 확인
  const finalPending = await sql`SELECT COUNT(*) as count FROM pending_reviews`;
  console.log(`\n✅ 최종 승인 대기: ${finalPending[0].count}개`);
}

recheckPending()
  .then(() => {
    console.log('\n✅ 재검토 완료!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 재검토 실패:', error);
    process.exit(1);
  });
