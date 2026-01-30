// ============================================
// Database Migration Script v2
// 기존 데이터 → detection_results 테이블 마이그레이션
// 작성일: 2026-01-30
// ============================================

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import * as dbV2 from '../src/lib/db-v2.js';

// ============================================
// 타입 정의
// ============================================

interface FinalResult {
  title: string;
  domain: string;
  url: string;
  search_query: string;
  page: number;
  rank: number;
  status: 'illegal' | 'legal' | 'unknown';
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null;
  llm_reason: string | null;
  final_status: 'illegal' | 'legal' | 'pending';
  reviewed_at: string | null;
}

interface Session {
  id: string;
  file_final_results: string | null;
  status: string;
}

// ============================================
// 헬퍼 함수
// ============================================

function getDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return neon(dbUrl);
}

async function fetchBlobData(url: string): Promise<FinalResult[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`  ⚠️ Blob fetch failed: ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data as FinalResult[];
  } catch (error) {
    console.log(`  ⚠️ Blob fetch error: ${error}`);
    return [];
  }
}

// ============================================
// 마이그레이션 함수
// ============================================

/**
 * Phase 1: 스키마 v2 초기화 (테이블, 인덱스, View 생성)
 */
async function phase1_initializeSchema(): Promise<boolean> {
  console.log('\n' + '═'.repeat(60));
  console.log('📦 Phase 1: Schema v2 초기화');
  console.log('═'.repeat(60));
  
  try {
    await dbV2.initializeSchemaV2();
    console.log('✅ Phase 1 완료: 스키마 초기화 성공\n');
    return true;
  } catch (error) {
    console.error('❌ Phase 1 실패:', error);
    return false;
  }
}

/**
 * Phase 2: 기존 세션 데이터 마이그레이션
 * - Blob에 저장된 FinalResult 데이터를 detection_results 테이블로 이동
 */
async function phase2_migrateSessionData(): Promise<{ 
  success: boolean; 
  totalSessions: number; 
  migratedSessions: number;
  totalResults: number;
}> {
  console.log('\n' + '═'.repeat(60));
  console.log('📦 Phase 2: 기존 세션 데이터 마이그레이션');
  console.log('═'.repeat(60));
  
  const sql = getDb();
  const stats = {
    success: true,
    totalSessions: 0,
    migratedSessions: 0,
    totalResults: 0
  };
  
  try {
    // 완료된 세션 목록 조회
    const sessions = await sql`
      SELECT id, file_final_results, status 
      FROM sessions 
      WHERE status = 'completed' 
        AND file_final_results IS NOT NULL
        AND file_final_results LIKE 'http%'
      ORDER BY created_at ASC
    ` as Session[];
    
    stats.totalSessions = sessions.length;
    console.log(`📋 마이그레이션 대상 세션: ${sessions.length}개\n`);
    
    for (const session of sessions) {
      console.log(`\n🔄 세션 마이그레이션: ${session.id}`);
      
      // 이미 마이그레이션되었는지 확인
      const existingCount = await sql`
        SELECT COUNT(*) as count FROM detection_results WHERE session_id = ${session.id}
      `;
      
      if (parseInt(existingCount[0]?.count || '0') > 0) {
        console.log(`  ⏭️ 이미 마이그레이션됨 (${existingCount[0]?.count}건)`);
        stats.migratedSessions++;
        continue;
      }
      
      // Blob에서 데이터 가져오기
      if (!session.file_final_results) {
        console.log(`  ⚠️ Blob URL 없음, 건너뜀`);
        continue;
      }
      
      console.log(`  📥 Blob 데이터 로드 중...`);
      const results = await fetchBlobData(session.file_final_results);
      
      if (results.length === 0) {
        console.log(`  ⚠️ 데이터 없음, 건너뜀`);
        continue;
      }
      
      console.log(`  📊 데이터 건수: ${results.length}개`);
      
      // detection_results 형식으로 변환
      const detectionResults: dbV2.DetectionResultInput[] = results.map(r => ({
        session_id: session.id,
        title: r.title,
        search_query: r.search_query,
        url: r.url,
        domain: r.domain,
        page: r.page,
        rank: r.rank,
        initial_status: r.status,
        llm_judgment: r.llm_judgment,
        llm_reason: r.llm_reason,
        final_status: r.final_status,
        reviewed_at: r.reviewed_at
      }));
      
      // 배치 INSERT
      const inserted = await dbV2.bulkCreateDetectionResults(detectionResults);
      console.log(`  ✅ 삽입 완료: ${inserted}건`);
      
      stats.migratedSessions++;
      stats.totalResults += inserted;
    }
    
    console.log('\n' + '─'.repeat(60));
    console.log('✅ Phase 2 완료: 세션 데이터 마이그레이션 성공');
    console.log(`   - 총 세션: ${stats.totalSessions}개`);
    console.log(`   - 마이그레이션 완료: ${stats.migratedSessions}개`);
    console.log(`   - 총 결과 데이터: ${stats.totalResults}건`);
    
    return stats;
    
  } catch (error) {
    console.error('❌ Phase 2 실패:', error);
    stats.success = false;
    return stats;
  }
}

/**
 * Phase 3: 데이터 정합성 검증
 */
async function phase3_validateData(): Promise<boolean> {
  console.log('\n' + '═'.repeat(60));
  console.log('📦 Phase 3: 데이터 정합성 검증');
  console.log('═'.repeat(60));
  
  const sql = getDb();
  
  try {
    // 1. 세션별 통계 비교 (기존 vs 신규)
    console.log('\n📊 세션별 통계 비교...');
    
    const comparison = await sql`
      SELECT 
        s.id,
        s.results_total as old_total,
        s.results_illegal as old_illegal,
        s.results_legal as old_legal,
        s.results_pending as old_pending,
        COALESCE(v.results_total, 0) as new_total,
        COALESCE(v.results_illegal, 0) as new_illegal,
        COALESCE(v.results_legal, 0) as new_legal,
        COALESCE(v.results_pending, 0) as new_pending
      FROM sessions s
      LEFT JOIN v_session_stats v ON s.id = v.id
      WHERE s.status = 'completed'
      ORDER BY s.created_at DESC
      LIMIT 10
    `;
    
    console.log('\n최근 10개 세션 비교:');
    console.log('─'.repeat(80));
    console.log('Session ID            | Old Total | New Total | Match');
    console.log('─'.repeat(80));
    
    let allMatch = true;
    for (const row of comparison) {
      const match = row.old_total === row.new_total;
      if (!match) allMatch = false;
      console.log(
        `${row.id.padEnd(21)} | ${String(row.old_total).padEnd(9)} | ${String(row.new_total).padEnd(9)} | ${match ? '✅' : '❌'}`
      );
    }
    
    // 2. View 동작 확인
    console.log('\n📊 View 동작 확인...');
    
    const monthlyStats = await sql`SELECT * FROM v_monthly_stats LIMIT 3`;
    console.log(`  - v_monthly_stats: ${monthlyStats.length}개 월 데이터`);
    
    const topContents = await sql`SELECT * FROM v_monthly_top_contents LIMIT 5`;
    console.log(`  - v_monthly_top_contents: ${topContents.length}개 레코드`);
    
    const topSites = await sql`SELECT * FROM v_monthly_top_illegal_sites LIMIT 5`;
    console.log(`  - v_monthly_top_illegal_sites: ${topSites.length}개 레코드`);
    
    const pendingDomains = await sql`SELECT * FROM v_pending_domains LIMIT 5`;
    console.log(`  - v_pending_domains: ${pendingDomains.length}개 도메인`);
    
    console.log('\n' + '─'.repeat(60));
    console.log(`✅ Phase 3 완료: 데이터 정합성 검증 ${allMatch ? '통과' : '일부 불일치 (수동 확인 필요)'}`);
    
    return allMatch;
    
  } catch (error) {
    console.error('❌ Phase 3 실패:', error);
    return false;
  }
}

// ============================================
// 개별 실행 명령어
// ============================================

async function runSchemaOnly() {
  console.log('🚀 Schema v2 초기화만 실행합니다...\n');
  const success = await phase1_initializeSchema();
  return success;
}

async function runMigrationOnly() {
  console.log('🚀 데이터 마이그레이션만 실행합니다...\n');
  const stats = await phase2_migrateSessionData();
  return stats.success;
}

async function runValidationOnly() {
  console.log('🚀 데이터 정합성 검증만 실행합니다...\n');
  const success = await phase3_validateData();
  return success;
}

// ============================================
// 전체 마이그레이션 실행
// ============================================

async function runFullMigration() {
  console.log('═'.repeat(60));
  console.log('🚀 Jobdori Database Migration v2');
  console.log('   기존 데이터 → detection_results 테이블 마이그레이션');
  console.log('═'.repeat(60));
  console.log(`⏰ 시작 시간: ${new Date().toLocaleString('ko-KR')}`);
  
  const startTime = Date.now();
  
  // Phase 1: 스키마 초기화
  const phase1Success = await phase1_initializeSchema();
  if (!phase1Success) {
    console.error('\n❌ 마이그레이션 중단: Phase 1 실패');
    process.exit(1);
  }
  
  // Phase 2: 데이터 마이그레이션
  const phase2Stats = await phase2_migrateSessionData();
  if (!phase2Stats.success) {
    console.error('\n❌ 마이그레이션 중단: Phase 2 실패');
    process.exit(1);
  }
  
  // Phase 3: 검증
  const phase3Success = await phase3_validateData();
  
  // 결과 요약
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);
  
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 마이그레이션 완료!');
  console.log('═'.repeat(60));
  console.log(`⏱️  소요 시간: ${duration}초`);
  console.log('');
  console.log('📊 결과 요약:');
  console.log(`   - 스키마 초기화: ${phase1Success ? '✅ 성공' : '❌ 실패'}`);
  console.log(`   - 세션 마이그레이션: ${phase2Stats.migratedSessions}/${phase2Stats.totalSessions}개`);
  console.log(`   - 총 결과 데이터: ${phase2Stats.totalResults}건`);
  console.log(`   - 데이터 검증: ${phase3Success ? '✅ 통과' : '⚠️ 일부 불일치'}`);
  console.log('═'.repeat(60));
  
  return phase1Success && phase2Stats.success;
}

// ============================================
// CLI 실행
// ============================================

const args = process.argv.slice(2);
const command = args[0];

if (command === '--schema-only') {
  runSchemaOnly()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
} else if (command === '--migrate-only') {
  runMigrationOnly()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
} else if (command === '--validate-only') {
  runValidationOnly()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
} else {
  // 기본: 전체 마이그레이션 실행
  runFullMigration()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export {
  runFullMigration,
  runSchemaOnly,
  runMigrationOnly,
  runValidationOnly,
  phase1_initializeSchema,
  phase2_migrateSessionData,
  phase3_validateData
};
