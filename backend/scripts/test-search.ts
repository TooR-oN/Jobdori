/**
 * Serper.dev API 검색 테스트
 */
import 'dotenv/config';
import { extractDomain } from './utils.js';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_API_URL = 'https://google.serper.dev/search';

async function testSearch() {
  console.log('🧪 Serper.dev API 검색 테스트\n');

  if (!SERPER_API_KEY) {
    console.error('❌ SERPER_API_KEY가 설정되지 않았습니다.');
    return;
  }

  console.log(`🔑 API 키: ${SERPER_API_KEY.substring(0, 8)}...`);

  const query = 'Solo Leveling manga';
  console.log(`🔍 테스트 검색어: "${query}"\n`);

  try {
    const response = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        gl: 'us',
        hl: 'en',
        num: 10,
      }),
    });

    if (!response.ok) {
      console.error(`❌ API 오류: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(errorText);
      return;
    }

    const data = await response.json();

    console.log(`✅ API 응답 성공!\n`);
    console.log(`📊 검색 결과: ${data.organic?.length || 0}개\n`);
    console.log('─'.repeat(60));

    if (data.organic) {
      for (const item of data.organic.slice(0, 10)) {
        const domain = extractDomain(item.link);
        console.log(`[${item.position}] ${domain}`);
        console.log(`    제목: ${item.title?.substring(0, 50)}...`);
        console.log(`    URL: ${item.link.substring(0, 60)}...`);
        console.log('');
      }
    }

    console.log('─'.repeat(60));
    console.log('\n🎉 테스트 성공!');

  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

testSearch();
