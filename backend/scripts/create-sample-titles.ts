import * as XLSX from 'xlsx';
import * as path from 'path';

// 샘플 작품 제목 리스트
const sampleTitles = [
  'Solo Leveling',
  'Tower of God',
  'The Beginning After the End',
  'Omniscient Reader',
  'Eleceed',
  'Lookism',
  'True Beauty',
  'Sweet Home',
  'Noblesse',
  'UnOrdinary'
];

// 워크북 생성
const workbook = XLSX.utils.book_new();

// 데이터를 2차원 배열로 변환 (헤더 포함)
const data = [['title'], ...sampleTitles.map(title => [title])];

// 워크시트 생성
const worksheet = XLSX.utils.aoa_to_sheet(data);

// 컬럼 너비 설정
worksheet['!cols'] = [{ wch: 30 }];

// 워크북에 워크시트 추가
XLSX.utils.book_append_sheet(workbook, worksheet, 'Titles');

// 파일 저장
const outputPath = path.join(process.cwd(), 'data', 'titles.xlsx');
XLSX.writeFile(workbook, outputPath);

console.log(`샘플 titles.xlsx 파일이 생성되었습니다: ${outputPath}`);
console.log(`총 ${sampleTitles.length}개의 작품이 포함되어 있습니다.`);
