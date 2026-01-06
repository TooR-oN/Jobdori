import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  SearchResult,
  ClassifiedResult,
  LLMJudgedResult,
  FinalResult,
  PendingReviewItem,
  Config,
} from './types/index.js';
import { runSearch } from './search.js';
import { runClassify, getUnknownDomains, groupByDomain } from './classify.js';
import { runLLMJudge } from './llm-judge.js';
import {
  loadConfig,
  saveJson,
  loadJson,
  getTimestamp,
  getCurrentISOTime,
  generateExcelReport,
} from './utils.js';

// ============================================
// 승인 대기 목록 생성
// ============================================

/**
 * LLM 판별 결과에서 승인 대기 목록 생성
 */
function createPendingReviewList(results: LLMJudgedResult[]): PendingReviewItem[] {
  // 도메인별로 그룹화
  const domainGroups = new Map<string, LLMJudgedResult[]>();
  
  for (const result of results) {
    // LLM 판별이 필요한 항목만 (status가 unknown이고 llm_judgment가 있는 경우)
    if (result.status === 'unknown' && result.llm_judgment) {
      const domain = result.domain.toLowerCase();
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain)!.push(result);
    }
  }

  // 승인 대기 항목 생성
  const pendingItems: PendingReviewItem[] = [];
  let id = 1;

  for (const [domain, items] of domainGroups) {
    // 해당 도메인의 첫 번째 항목에서 LLM 판단 정보 가져오기
    const firstItem = items[0];
    
    // URL 목록 (중복 제거)
    const urls = [...new Set(items.map(item => item.url))];
    
    // 관련 작품 목록 (중복 제거)
    const titles = [...new Set(items.map(item => item.title))];

    pendingItems.push({
      id: String(id++),
      domain,
      urls,
      titles,
      llm_judgment: firstItem.llm_judgment!,
      llm_reason: firstItem.llm_reason || '',
      created_at: getCurrentISOTime(),
    });
  }

  return pendingItems;
}

/**
 * 최종 결과 생성 (FinalResult)
 */
function createFinalResults(results: LLMJudgedResult[]): FinalResult[] {
  return results.map(result => {
    let final_status: 'illegal' | 'legal' | 'pending';

    if (result.status === 'illegal') {
      final_status = 'illegal';
    } else if (result.status === 'legal') {
      final_status = 'legal';
    } else {
      // unknown 상태인 경우 LLM 판단에 따라 pending
      final_status = 'pending';
    }

    return {
      ...result,
      final_status,
      reviewed_at: result.status !== 'unknown' ? getCurrentISOTime() : null,
    };
  });
}

// ============================================
// 메인 파이프라인
// ============================================

async function runPipeline() {
  const startTime = Date.now();
  const timestamp = getTimestamp();
  
  console.log('═'.repeat(60));
  console.log('🚀 웹툰 불법사이트 모니터링 파이프라인 시작');
  console.log('═'.repeat(60));
  console.log(`⏰ 시작 시간: ${new Date().toLocaleString('ko-KR')}`);
  console.log('');

  // 설정 로드
  const config = loadConfig();

  try {
    // ==========================================
    // Step 1: 구글 검색
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 1: 구글 검색 (Serper.dev API)');
    console.log('─'.repeat(60));
    
    const searchResults = await runSearch();
    
    // 중간 결과 저장
    saveJson(searchResults, `output/1_search-results-${timestamp}.json`);
    
    console.log(`\n✅ Step 1 완료: ${searchResults.length}개 결과 수집`);

    // ==========================================
    // Step 2: 1차 판별 (리스트 대조)
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 2: 1차 판별 (리스트 대조)');
    console.log('─'.repeat(60));
    
    const classifiedResults = await runClassify(searchResults);
    
    // 중간 결과 저장
    saveJson(classifiedResults, `output/2_classified-results-${timestamp}.json`);
    
    const unknownCount = classifiedResults.filter(r => r.status === 'unknown').length;
    console.log(`\n✅ Step 2 완료: ${unknownCount}개 미분류 도메인`);

    // ==========================================
    // Step 3: 2차 판별 (LLM)
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 3: 2차 판별 (Gemini LLM)');
    console.log('─'.repeat(60));
    
    const llmJudgedResults = await runLLMJudge(classifiedResults);
    
    // 중간 결과 저장
    saveJson(llmJudgedResults, `output/3_llm-judged-results-${timestamp}.json`);
    
    console.log(`\n✅ Step 3 완료`);

    // ==========================================
    // Step 4: 승인 대기 목록 생성
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 4: 승인 대기 목록 생성');
    console.log('─'.repeat(60));
    
    const pendingItems = createPendingReviewList(llmJudgedResults);
    
    // 기존 승인 대기 목록 로드 및 병합
    const pendingFilePath = config.paths.pendingReviewFile;
    let existingPending: PendingReviewItem[] = [];
    try {
      existingPending = loadJson<PendingReviewItem[]>(pendingFilePath);
    } catch {
      existingPending = [];
    }
    
    // 기존 도메인은 제외하고 새로운 것만 추가
    const existingDomains = new Set(existingPending.map(p => p.domain.toLowerCase()));
    const newPendingItems = pendingItems.filter(p => !existingDomains.has(p.domain.toLowerCase()));
    
    // ID 재할당
    const maxId = existingPending.length > 0 
      ? Math.max(...existingPending.map(p => parseInt(p.id))) 
      : 0;
    newPendingItems.forEach((item, index) => {
      item.id = String(maxId + index + 1);
    });
    
    const mergedPending = [...existingPending, ...newPendingItems];
    
    // 승인 대기 목록 저장
    saveJson(mergedPending, pendingFilePath);
    
    console.log(`\n📋 기존 승인 대기: ${existingPending.length}개`);
    console.log(`📋 새로 추가: ${newPendingItems.length}개`);
    console.log(`📋 총 승인 대기: ${mergedPending.length}개`);
    console.log(`\n✅ Step 4 완료`);

    // ==========================================
    // Step 5: 최종 결과 및 Excel 리포트 생성
    // ==========================================
    console.log('\n' + '─'.repeat(60));
    console.log('📌 Step 5: Excel 리포트 생성');
    console.log('─'.repeat(60));
    
    const finalResults = createFinalResults(llmJudgedResults);
    
    // JSON 저장
    saveJson(finalResults, `output/4_final-results-${timestamp}.json`);
    
    // Excel 리포트 생성
    const excelPath = `output/report_${timestamp}.xlsx`;
    generateExcelReport(finalResults, excelPath);
    
    console.log(`\n✅ Step 5 완료`);

    // ==========================================
    // 완료 요약
    // ==========================================
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(60));
    console.log('🎉 파이프라인 완료!');
    console.log('═'.repeat(60));
    console.log(`⏱️  소요 시간: ${duration}초`);
    console.log('');
    console.log('📊 결과 요약:');
    console.log(`   - 총 검색 결과: ${searchResults.length}개`);
    console.log(`   - 불법 판정: ${finalResults.filter(r => r.final_status === 'illegal').length}개`);
    console.log(`   - 합법 판정: ${finalResults.filter(r => r.final_status === 'legal').length}개`);
    console.log(`   - 승인 대기: ${finalResults.filter(r => r.final_status === 'pending').length}개`);
    console.log('');
    console.log('📁 생성된 파일:');
    console.log(`   - output/1_search-results-${timestamp}.json`);
    console.log(`   - output/2_classified-results-${timestamp}.json`);
    console.log(`   - output/3_llm-judged-results-${timestamp}.json`);
    console.log(`   - output/4_final-results-${timestamp}.json`);
    console.log(`   - output/report_${timestamp}.xlsx`);
    console.log(`   - data/pending-review.json (업데이트됨)`);
    console.log('');
    console.log('🌐 승인 UI: http://localhost:3000');
    console.log('═'.repeat(60));

    return {
      success: true,
      searchResults,
      classifiedResults,
      llmJudgedResults,
      finalResults,
      pendingItems: mergedPending,
      timestamp,
    };

  } catch (error) {
    console.error('\n' + '═'.repeat(60));
    console.error('❌ 파이프라인 실행 중 오류 발생!');
    console.error('═'.repeat(60));
    console.error(error);
    
    return {
      success: false,
      error,
    };
  }
}

// ============================================
// 직접 실행
// ============================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline()
    .then(result => {
      if (!result.success) {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runPipeline };
