import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';
import { Config, FinalResult, REPORT_COLUMNS } from './types/index.js';

// ============================================
// 공용 유틸리티 함수
// ============================================

/**
 * 랜덤 딜레이 (ms)
 */
export function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * sleep 함수
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * URL에서 메인 도메인 추출
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 설정 파일 로드
 */
export function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'data', 'config.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
}

/**
 * 작품 제목 로드 (titles.json 우선, 없으면 titles.xlsx 사용)
 */
export function loadTitles(filePath: string): string[] {
  // titles.json 파일 경로
  const jsonPath = path.join(process.cwd(), 'data', 'titles.json');
  
  // titles.json이 있으면 우선 사용
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(content);
      if (data.current && Array.isArray(data.current) && data.current.length > 0) {
        console.log(`📖 titles.json에서 작품 ${data.current.length}개 로드됨`);
        return data.current;
      }
    } catch (error) {
      console.warn('titles.json 로드 실패, titles.xlsx로 폴백:', error);
    }
  }
  
  // titles.json이 없거나 비어있으면 titles.xlsx 사용
  const absolutePath = path.join(process.cwd(), filePath);
  const workbook = XLSX.readFile(absolutePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<{ title: string }>(worksheet);
  const titles = data.map(row => row.title).filter(Boolean);
  console.log(`📖 titles.xlsx에서 작품 ${titles.length}개 로드됨`);
  return titles;
}

/**
 * 텍스트 파일 로드 (주석 제외)
 */
export function loadTextFile(filePath: string): string[] {
  const absolutePath = path.join(process.cwd(), filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * 키워드 파일 로드
 */
export function loadKeywords(filePath: string): string[] {
  return loadTextFile(filePath);
}

/**
 * 불법/합법 사이트 리스트 로드
 */
export function loadSiteList(filePath: string): Set<string> {
  const sites = loadTextFile(filePath);
  return new Set(sites.map(site => site.toLowerCase()));
}

/**
 * JSON 파일 저장
 */
export function saveJson(data: unknown, outputPath: string): void {
  const absolutePath = path.join(process.cwd(), outputPath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`💾 저장 완료: ${absolutePath}`);
}

/**
 * JSON 파일 로드
 */
export function loadJson<T>(filePath: string): T {
  const absolutePath = path.join(process.cwd(), filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 텍스트 파일에 라인 추가
 */
export function appendToTextFile(filePath: string, lines: string[]): void {
  const absolutePath = path.join(process.cwd(), filePath);
  const existingContent = fs.readFileSync(absolutePath, 'utf-8');
  const newContent = existingContent.trimEnd() + '\n' + lines.join('\n') + '\n';
  fs.writeFileSync(absolutePath, newContent, 'utf-8');
}

/**
 * 타임스탬프 생성 (파일명용)
 */
export function getTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * 현재 시간 (ISO 형식)
 */
export function getCurrentISOTime(): string {
  return new Date().toISOString();
}

/**
 * Excel 리포트 생성
 */
export function generateExcelReport(results: FinalResult[], outputPath: string): void {
  const absolutePath = path.join(process.cwd(), outputPath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 컬럼 순서에 맞게 데이터 정렬
  const orderedData = results.map(row => {
    const orderedRow: Record<string, unknown> = {};
    for (const col of REPORT_COLUMNS) {
      orderedRow[col] = row[col] ?? null;
    }
    return orderedRow;
  });

  // 워크북 생성
  const workbook = XLSX.utils.book_new();
  
  // 전체 결과 시트
  const worksheet = XLSX.utils.json_to_sheet(orderedData);
  
  // 컬럼 너비 설정
  worksheet['!cols'] = [
    { wch: 25 },  // title
    { wch: 30 },  // domain
    { wch: 60 },  // url
    { wch: 30 },  // search_query
    { wch: 8 },   // page
    { wch: 8 },   // rank
    { wch: 10 },  // status
    { wch: 15 },  // llm_judgment
    { wch: 50 },  // llm_reason
    { wch: 12 },  // final_status
    { wch: 22 },  // reviewed_at
  ];
  
  XLSX.utils.book_append_sheet(workbook, worksheet, 'All Results');
  
  // 불법 사이트만 필터링한 시트
  const illegalResults = results.filter(r => r.final_status === 'illegal');
  if (illegalResults.length > 0) {
    const illegalSheet = XLSX.utils.json_to_sheet(
      illegalResults.map(row => {
        const orderedRow: Record<string, unknown> = {};
        for (const col of REPORT_COLUMNS) {
          orderedRow[col] = row[col] ?? null;
        }
        return orderedRow;
      })
    );
    illegalSheet['!cols'] = worksheet['!cols'];
    XLSX.utils.book_append_sheet(workbook, illegalSheet, 'Illegal Sites');
  }
  
  // 승인 대기 시트
  const pendingResults = results.filter(r => r.final_status === 'pending');
  if (pendingResults.length > 0) {
    const pendingSheet = XLSX.utils.json_to_sheet(
      pendingResults.map(row => {
        const orderedRow: Record<string, unknown> = {};
        for (const col of REPORT_COLUMNS) {
          orderedRow[col] = row[col] ?? null;
        }
        return orderedRow;
      })
    );
    pendingSheet['!cols'] = worksheet['!cols'];
    XLSX.utils.book_append_sheet(workbook, pendingSheet, 'Pending Review');
  }
  
  // 파일 저장
  XLSX.writeFile(workbook, absolutePath);
  console.log(`📊 Excel 리포트 생성: ${absolutePath}`);
}
