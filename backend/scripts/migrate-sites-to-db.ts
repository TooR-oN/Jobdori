import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

/**
 * 텍스트 파일에서 사이트 목록 로드
 */
function loadSiteListFromFile(filePath: string): string[] {
  const absolutePath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`⚠️ 파일이 없습니다: ${absolutePath}`);
    return [];
  }
  
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim().toLowerCase())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * 사이트 목록을 DB에 마이그레이션
 */
async function migrateSitesToDb() {
  console.log('🚀 사이트 목록 DB 마이그레이션 시작\n');
  
  // 텍스트 파일에서 로드
  const illegalSites = loadSiteListFromFile('data/illegal-sites.txt');
  const legalSites = loadSiteListFromFile('data/legal-sites.txt');
  
  console.log(`📋 불법 사이트 파일: ${illegalSites.length}개`);
  console.log(`📋 합법 사이트 파일: ${legalSites.length}개\n`);
  
  // 현재 DB에 있는 사이트 조회
  const existingIllegal = await sql`SELECT domain FROM sites WHERE type = 'illegal'`;
  const existingLegal = await sql`SELECT domain FROM sites WHERE type = 'legal'`;
  
  const existingIllegalSet = new Set(existingIllegal.map((r: any) => r.domain.toLowerCase()));
  const existingLegalSet = new Set(existingLegal.map((r: any) => r.domain.toLowerCase()));
  
  console.log(`📊 DB 불법 사이트: ${existingIllegalSet.size}개`);
  console.log(`📊 DB 합법 사이트: ${existingLegalSet.size}개\n`);
  
  // 불법 사이트 마이그레이션
  let illegalAdded = 0;
  let illegalSkipped = 0;
  
  for (const domain of illegalSites) {
    if (existingIllegalSet.has(domain)) {
      illegalSkipped++;
      continue;
    }
    
    try {
      await sql`
        INSERT INTO sites (domain, type)
        VALUES (${domain}, 'illegal')
        ON CONFLICT (domain, type) DO NOTHING
      `;
      illegalAdded++;
      console.log(`✅ 불법 추가: ${domain}`);
    } catch (error) {
      console.error(`❌ 불법 추가 실패: ${domain}`, error);
    }
  }
  
  // 합법 사이트 마이그레이션
  let legalAdded = 0;
  let legalSkipped = 0;
  
  for (const domain of legalSites) {
    if (existingLegalSet.has(domain)) {
      legalSkipped++;
      continue;
    }
    
    try {
      await sql`
        INSERT INTO sites (domain, type)
        VALUES (${domain}, 'legal')
        ON CONFLICT (domain, type) DO NOTHING
      `;
      legalAdded++;
      console.log(`✅ 합법 추가: ${domain}`);
    } catch (error) {
      console.error(`❌ 합법 추가 실패: ${domain}`, error);
    }
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('📊 마이그레이션 결과');
  console.log('═'.repeat(50));
  console.log(`불법 사이트: ${illegalAdded}개 추가, ${illegalSkipped}개 이미 존재`);
  console.log(`합법 사이트: ${legalAdded}개 추가, ${legalSkipped}개 이미 존재`);
  
  // 최종 DB 현황
  const finalIllegal = await sql`SELECT COUNT(*) as count FROM sites WHERE type = 'illegal'`;
  const finalLegal = await sql`SELECT COUNT(*) as count FROM sites WHERE type = 'legal'`;
  
  console.log('\n📊 최종 DB 현황');
  console.log(`불법 사이트: ${finalIllegal[0].count}개`);
  console.log(`합법 사이트: ${finalLegal[0].count}개`);
}

migrateSitesToDb()
  .then(() => {
    console.log('\n✅ 마이그레이션 완료!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  });
