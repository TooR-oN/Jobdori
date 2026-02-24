import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { Config, FinalResult, REPORT_COLUMNS, TitleSearchConfig } from './types/index.js';

// ============================================
// DB 연결
// ============================================

let dbInstance: ReturnType<typeof neon> | null = null;

function getDb() {
  if (!dbInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    dbInstance = neon(process.env.DATABASE_URL);
  }
  return dbInstance;
}

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
 * 작품 제목 로드 - DB 우선, 폴백으로 파일 사용
 * GitHub Actions에서 사용 - DB의 is_current=true 작품을 실시간으로 로드
 * 비공식 타이틀(별칭)도 함께 로드하여 검색 범위 확장
 */
export async function loadTitlesFromDb(): Promise<TitleSearchConfig[]> {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT name, unofficial_titles 
      FROM titles 
      WHERE is_current = true 
      ORDER BY name
    `;
    
    const titles: TitleSearchConfig[] = rows.map((r: any) => ({
      official: r.name,
      searchTerms: [
        r.name,
        ...(r.unofficial_titles || [])
      ].filter(Boolean)  // 빈 값 제거
    }));
    
    // 통계 출력
    const totalSearchTerms = titles.reduce((sum, t) => sum + t.searchTerms.length, 0);
    const titlesWithAliases = titles.filter(t => t.searchTerms.length > 1).length;
    
    console.log(`📖 DB에서 작품 ${titles.length}개 로드됨`);
    console.log(`   - 비공식 타이틀 보유: ${titlesWithAliases}개 작품`);
    console.log(`   - 총 검색어 수: ${totalSearchTerms}개`);
    
    return titles;
  } catch (error) {
    console.warn('⚠️ DB 로드 실패, 파일로 폴백:', error);
    // 폴백: 파일에서 로드 (비공식 타이틀 없이)
    return loadTitlesFromFile('data/titles.xlsx');
  }
}

/**
 * 작품 제목 로드 (파일 기반 - 폴백용)
 * 비공식 타이틀 없이 공식 타이틀만 반환
 */
export function loadTitlesFromFile(filePath: string): TitleSearchConfig[] {
  // titles.json 파일 경로
  const jsonPath = path.join(process.cwd(), 'data', 'titles.json');
  
  // titles.json이 있으면 우선 사용
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(content);
      if (data.current && Array.isArray(data.current) && data.current.length > 0) {
        console.log(`📖 titles.json에서 작품 ${data.current.length}개 로드됨 (파일 폴백)`);
        // TitleSearchConfig 형식으로 변환 (비공식 타이틀 없이)
        return data.current.map((name: string) => ({
          official: name,
          searchTerms: [name]
        }));
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
  console.log(`📖 titles.xlsx에서 작품 ${titles.length}개 로드됨 (파일 폴백)`);
  // TitleSearchConfig 형식으로 변환 (비공식 타이틀 없이)
  return titles.map(name => ({
    official: name,
    searchTerms: [name]
  }));
}

/**
 * 하위 호환성을 위한 기존 함수 (deprecated - loadTitlesFromDb 사용 권장)
 */
export function loadTitles(filePath: string): TitleSearchConfig[] {
  return loadTitlesFromFile(filePath);
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
 * 키워드 파일 로드 (빈 줄 = 작품명만 검색)
 * DB 우선 로드: system_settings에서 monitoring_keyword_suffixes 조회
 * DB 로드 실패 시 파일 폴백
 */
export async function loadKeywords(filePath: string): Promise<string[]> {
  // 1순위: DB에서 키워드 접미사 로드
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT value FROM system_settings WHERE key = 'monitoring_keyword_suffixes'
    ` as any[];
    if (rows.length > 0) {
      const suffixes: string[] = JSON.parse((rows[0] as any).value);
      if (Array.isArray(suffixes) && suffixes.length > 0) {
        console.log(`📖 DB에서 키워드 ${suffixes.length}개 로드됨: ${suffixes.map(s => s || '[작품명만]').join(', ')}`);
        return suffixes;
      }
    }
  } catch (error) {
    console.warn('⚠️ DB 키워드 로드 실패, 파일로 폴백:', error);
  }

  // 2순위: 파일 폴백 (기존 로직)
  console.log('📖 파일에서 키워드 로드 중 (DB 폴백)...');
  return loadKeywordsFromFile(filePath);
}

/**
 * 키워드 파일에서 직접 로드 (폴백용)
 */
export function loadKeywordsFromFile(filePath: string): string[] {
  const absolutePath = path.join(process.cwd(), filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const lines = content.split('\n');
  const keywords: string[] = [];
  let hasEmptyKeyword = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    // 주석은 건너뛰기
    if (trimmed.startsWith('#')) continue;
    // 빈 줄은 빈 문자열로 추가 (작품명만 검색, 한 번만)
    if (trimmed === '') {
      if (!hasEmptyKeyword) {
        keywords.push('');
        hasEmptyKeyword = true;
      }
    } else {
      keywords.push(trimmed);
    }
  }
  
  return keywords;
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
