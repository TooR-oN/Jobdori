/**
 * Manus API 프로젝트 내 태스크 생성 테스트
 */
import 'dotenv/config';

const MANUS_API_KEY = process.env.MANUS_API_KEY;
const MANUS_PROJECT_ID = 'mhCkDAxQCwTJCdPx8KqR5s';

async function testManusProject() {
  console.log('=== Manus API 프로젝트 테스트 ===\n');
  console.log('API Key 설정:', MANUS_API_KEY ? '✅ 있음 (길이: ' + MANUS_API_KEY.length + ')' : '❌ 없음');
  console.log('Project ID:', MANUS_PROJECT_ID);
  
  if (!MANUS_API_KEY) {
    console.error('\n❌ MANUS_API_KEY가 없습니다.');
    return;
  }

  // 1. 프로젝트 정보 확인
  console.log('\n--- 프로젝트 정보 확인 ---\n');
  try {
    const projectResponse = await fetch(`https://api.manus.ai/v1/projects/${MANUS_PROJECT_ID}`, {
      method: 'GET',
      headers: {
        'API_KEY': MANUS_API_KEY,
      },
    });
    
    console.log('프로젝트 조회 응답:', projectResponse.status, projectResponse.statusText);
    if (projectResponse.ok) {
      const projectData = await projectResponse.json();
      console.log('프로젝트 데이터:', JSON.stringify(projectData, null, 2));
    } else {
      const errorText = await projectResponse.text();
      console.log('오류:', errorText);
    }
  } catch (error) {
    console.error('프로젝트 조회 실패:', error);
  }

  // 2. 테스트 태스크 생성
  console.log('\n--- 테스트 태스크 생성 ---\n');
  
  const requestBody = {
    prompt: '[Jobdori 테스트] 프로젝트 내부 생성 확인. 간단히 "확인됨"이라고만 답해주세요.',
    agentProfile: 'manus-1.6',
    projectId: MANUS_PROJECT_ID,
    taskMode: 'agent',
    hideInTaskList: false,
  };
  
  console.log('요청 본문:', JSON.stringify(requestBody, null, 2));
  
  const response = await fetch('https://api.manus.ai/v1/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API_KEY': MANUS_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  console.log('\n응답 상태:', response.status, response.statusText);
  
  const responseText = await response.text();
  console.log('응답 본문:', responseText);
  
  try {
    const data = JSON.parse(responseText);
    if (data.task_id) {
      console.log('\n✅ 태스크 생성 성공!');
      console.log('태스크 ID:', data.task_id);
      console.log('태스크 URL:', data.task_url || 'N/A');
      console.log('\n👉 이 URL로 가서 태스크가 프로젝트 안에 있는지 확인하세요.');
    }
  } catch (e) {
    console.log('JSON 파싱 실패');
  }
}

testManusProject().catch(console.error);
