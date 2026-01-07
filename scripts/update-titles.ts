import * as XLSX from 'xlsx';
import * as path from 'path';

// 새로운 작품 제목 리스트
const titles = [
  'Under the Oak Tree',
  'The Duke\'s Fluffy Secret',
  'Degenerate',
  'A Wicked Husband',
  'Devoured: The Serpent and the Pomegranate',
  'My Master Doesn\'t Bite!',
  'Don\'t Tell My Brother!',
  'Guilty Office',
  'How About a Cosmic Horror?',
  'Predatory Marriage',
  'The Beast Within',
  'From Sandbox to Bed',
  'Dangerous',
  'Prison Love',
  'Betrayal of Dignity',
  'F My Ex',
  'Tempest Night',
  'High Society',
  'Her Merry Obsession',
  'Violet Romance'
];

// 워크북 생성
const workbook = XLSX.utils.book_new();
const data = [['title'], ...titles.map(title => [title])];
const worksheet = XLSX.utils.aoa_to_sheet(data);
worksheet['!cols'] = [{ wch: 50 }];
XLSX.utils.book_append_sheet(workbook, worksheet, 'Titles');

// 파일 저장
const outputPath = path.join(process.cwd(), 'data', 'titles.xlsx');
XLSX.writeFile(workbook, outputPath);

console.log(`✅ titles.xlsx 업데이트 완료!`);
console.log(`📚 총 ${titles.length}개 작품:`);
titles.forEach((t, i) => console.log(`   ${i+1}. ${t}`));
