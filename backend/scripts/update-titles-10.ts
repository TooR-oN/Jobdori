import XLSX from 'xlsx';
import * as path from 'path';

// 하단 10개 작품만 포함
const titles = [
  "The Beast Within",
  "From Sandbox to Bed",
  "Dangerous",
  "Prison Love",
  "Betrayal of Dignity",
  "F My Ex",
  "Tempest Night",
  "High Society",
  "Her Merry Obsession",
  "Violet Romance"
];

const filePath = path.join(process.cwd(), 'data', 'titles.xlsx');

// 워크북 생성
const wb = XLSX.utils.book_new();
const wsData = [['title'], ...titles.map(t => [t])];
const ws = XLSX.utils.aoa_to_sheet(wsData);
ws['!cols'] = [{ wch: 50 }];
XLSX.utils.book_append_sheet(wb, ws, 'Titles');

// 파일 저장
XLSX.writeFile(wb, filePath);

console.log('✅ titles.xlsx 업데이트 완료');
console.log(`📋 총 ${titles.length}개 작품:`);
titles.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
