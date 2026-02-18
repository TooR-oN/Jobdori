import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import * as fs from 'fs'
import * as path from 'path'

// ============================================
// 타입 정의
// ============================================

interface PendingReviewItem {
  id: string
  domain: string
  urls: string[]
  titles: string[]
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain'
  llm_reason: string
  created_at: string
}

interface ReviewAction {
  id: string
  action: 'approve' | 'reject' | 'hold'
}

// ============================================
// 파일 경로 (로컬 개발용)
// ============================================

const DATA_DIR = path.join(process.cwd(), 'data')
const PENDING_FILE = path.join(DATA_DIR, 'pending-review.json')
const ILLEGAL_SITES_FILE = path.join(DATA_DIR, 'illegal-sites.txt')
const LEGAL_SITES_FILE = path.join(DATA_DIR, 'legal-sites.txt')

// ============================================
// 유틸리티 함수
// ============================================

function loadPendingReviews(): PendingReviewItem[] {
  try {
    if (fs.existsSync(PENDING_FILE)) {
      const content = fs.readFileSync(PENDING_FILE, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Failed to load pending reviews:', error)
  }
  return []
}

function savePendingReviews(items: PendingReviewItem[]): void {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(items, null, 2), 'utf-8')
}

function addToSiteList(filePath: string, domain: string): void {
  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.includes(domain)) {
    const newContent = content.trimEnd() + '\n' + domain + '\n'
    fs.writeFileSync(filePath, newContent, 'utf-8')
  }
}

// ============================================
// Hono App
// ============================================

const app = new Hono()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 서빙
app.use('/static/*', serveStatic({ root: './public' }))

// ============================================
// API 엔드포인트
// ============================================

// 승인 대기 목록 조회
app.get('/api/pending', (c) => {
  const items = loadPendingReviews()
  return c.json({
    success: true,
    count: items.length,
    items,
  })
})

// 단일 항목 조회
app.get('/api/pending/:id', (c) => {
  const id = c.req.param('id')
  const items = loadPendingReviews()
  const item = items.find(i => i.id === id)
  
  if (!item) {
    return c.json({ success: false, error: 'Item not found' }, 404)
  }
  
  return c.json({ success: true, item })
})

// 승인/거절/보류 처리
app.post('/api/review', async (c) => {
  try {
    const body = await c.req.json<ReviewAction>()
    const { id, action } = body
    
    if (!id || !action) {
      return c.json({ success: false, error: 'Missing id or action' }, 400)
    }
    
    const items = loadPendingReviews()
    const itemIndex = items.findIndex(i => i.id === id)
    
    if (itemIndex === -1) {
      return c.json({ success: false, error: 'Item not found' }, 404)
    }
    
    const item = items[itemIndex]
    
    if (action === 'approve') {
      // 불법 사이트 리스트에 추가
      addToSiteList(ILLEGAL_SITES_FILE, item.domain)
      // 대기 목록에서 제거
      items.splice(itemIndex, 1)
      savePendingReviews(items)
      
      return c.json({
        success: true,
        message: `${item.domain}이(가) 불법 사이트 리스트에 추가되었습니다.`,
        action: 'approved',
        domain: item.domain,
      })
    } else if (action === 'reject') {
      // 합법 사이트 리스트에 추가
      addToSiteList(LEGAL_SITES_FILE, item.domain)
      // 대기 목록에서 제거
      items.splice(itemIndex, 1)
      savePendingReviews(items)
      
      return c.json({
        success: true,
        message: `${item.domain}이(가) 합법 사이트 리스트에 추가되었습니다.`,
        action: 'rejected',
        domain: item.domain,
      })
    } else if (action === 'hold') {
      // 보류 - 목록에 유지
      return c.json({
        success: true,
        message: `${item.domain}이(가) 보류되었습니다.`,
        action: 'held',
        domain: item.domain,
      })
    } else {
      return c.json({ success: false, error: 'Invalid action' }, 400)
    }
  } catch (error) {
    console.error('Review error:', error)
    return c.json({ success: false, error: 'Internal server error' }, 500)
  }
})

// 통계 조회
app.get('/api/stats', (c) => {
  const items = loadPendingReviews()
  
  const stats = {
    total: items.length,
    likely_illegal: items.filter(i => i.llm_judgment === 'likely_illegal').length,
    likely_legal: items.filter(i => i.llm_judgment === 'likely_legal').length,
    uncertain: items.filter(i => i.llm_judgment === 'uncertain').length,
  }
  
  return c.json({ success: true, stats })
})

// 불법/합법 사이트 리스트 조회
app.get('/api/sites/:type', (c) => {
  const type = c.req.param('type')
  const filePath = type === 'illegal' ? ILLEGAL_SITES_FILE : LEGAL_SITES_FILE
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const sites = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
    
    return c.json({
      success: true,
      type,
      count: sites.length,
      sites,
    })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to load sites' }, 500)
  }
})

// ============================================
// 메인 페이지 (승인 UI)
// ============================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>웹툰 불법사이트 모니터링 - 승인 대기</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    .judgment-likely_illegal { background-color: #fee2e2; border-color: #ef4444; }
    .judgment-likely_legal { background-color: #dcfce7; border-color: #22c55e; }
    .judgment-uncertain { background-color: #fef3c7; border-color: #f59e0b; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="container mx-auto px-4 py-8 max-w-6xl">
    <!-- 헤더 -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-shield-alt text-blue-600 mr-2"></i>
            웹툰 불법사이트 모니터링
          </h1>
          <p class="text-gray-600 mt-1">승인 대기 목록</p>
        </div>
        <button onclick="loadPendingItems()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition">
          <i class="fas fa-sync-alt mr-2"></i>새로고침
        </button>
      </div>
    </div>

    <!-- 통계 -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-lg shadow-md p-4 text-center">
        <div class="text-3xl font-bold text-gray-800" id="stat-total">0</div>
        <div class="text-gray-600">전체</div>
      </div>
      <div class="bg-red-50 rounded-lg shadow-md p-4 text-center border-l-4 border-red-500">
        <div class="text-3xl font-bold text-red-600" id="stat-illegal">0</div>
        <div class="text-gray-600">불법 추정</div>
      </div>
      <div class="bg-green-50 rounded-lg shadow-md p-4 text-center border-l-4 border-green-500">
        <div class="text-3xl font-bold text-green-600" id="stat-legal">0</div>
        <div class="text-gray-600">합법 추정</div>
      </div>
      <div class="bg-yellow-50 rounded-lg shadow-md p-4 text-center border-l-4 border-yellow-500">
        <div class="text-3xl font-bold text-yellow-600" id="stat-uncertain">0</div>
        <div class="text-gray-600">불확실</div>
      </div>
    </div>

    <!-- 승인 대기 목록 -->
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-lg font-semibold text-gray-800 mb-4">
        <i class="fas fa-list mr-2"></i>승인 대기 목록
      </h2>
      
      <div id="pending-list" class="space-y-4">
        <div class="text-center text-gray-500 py-8">
          <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
          <p>로딩 중...</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    // API 호출 함수
    async function fetchAPI(url, options = {}) {
      try {
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json' },
          ...options,
        });
        return await response.json();
      } catch (error) {
        console.error('API Error:', error);
        return { success: false, error: error.message };
      }
    }

    // 통계 로드
    async function loadStats() {
      const data = await fetchAPI('/api/stats');
      if (data.success) {
        document.getElementById('stat-total').textContent = data.stats.total;
        document.getElementById('stat-illegal').textContent = data.stats.likely_illegal;
        document.getElementById('stat-legal').textContent = data.stats.likely_legal;
        document.getElementById('stat-uncertain').textContent = data.stats.uncertain;
      }
    }

    // 승인 대기 목록 로드
    async function loadPendingItems() {
      const listEl = document.getElementById('pending-list');
      listEl.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>로딩 중...</p></div>';
      
      const data = await fetchAPI('/api/pending');
      
      if (!data.success || data.items.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 py-8"><i class="fas fa-check-circle text-4xl mb-2 text-green-500"></i><p>승인 대기 중인 항목이 없습니다.</p></div>';
        loadStats();
        return;
      }

      listEl.innerHTML = data.items.map((item, index) => \`
        <div class="border-2 rounded-lg p-4 judgment-\${item.llm_judgment}" id="item-\${item.id}">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-lg font-semibold text-gray-800">#\${index + 1}</span>
                <span class="text-xl font-bold text-blue-600">\${item.domain}</span>
                <span class="px-2 py-1 rounded text-xs font-medium \${
                  item.llm_judgment === 'likely_illegal' ? 'bg-red-500 text-white' :
                  item.llm_judgment === 'likely_legal' ? 'bg-green-500 text-white' :
                  'bg-yellow-500 text-white'
                }">
                  \${item.llm_judgment === 'likely_illegal' ? '불법 추정' :
                    item.llm_judgment === 'likely_legal' ? '합법 추정' : '불확실'}
                </span>
              </div>
              
              <div class="text-sm text-gray-600 mb-2">
                <i class="fas fa-link mr-1"></i>
                관련 URL: \${item.urls.length}개
              </div>
              
              <div class="text-sm text-gray-600 mb-2">
                <i class="fas fa-book mr-1"></i>
                관련 작품: \${item.titles.join(', ')}
              </div>
              
              <div class="bg-gray-100 rounded p-3 text-sm">
                <i class="fas fa-robot mr-1 text-purple-500"></i>
                <strong>LLM 판단 근거:</strong> \${item.llm_reason || '없음'}
              </div>
              
              <div class="mt-2 text-xs text-gray-400">
                생성: \${new Date(item.created_at).toLocaleString('ko-KR')}
              </div>
            </div>
            
            <div class="flex flex-col gap-2 ml-4">
              <button onclick="handleReview('\${item.id}', 'approve')" 
                      class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition flex items-center">
                <i class="fas fa-check mr-2"></i>승인 (불법)
              </button>
              <button onclick="handleReview('\${item.id}', 'reject')" 
                      class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition flex items-center">
                <i class="fas fa-times mr-2"></i>거절 (합법)
              </button>
              <button onclick="handleReview('\${item.id}', 'hold')" 
                      class="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg transition flex items-center">
                <i class="fas fa-pause mr-2"></i>보류
              </button>
            </div>
          </div>
        </div>
      \`).join('');

      loadStats();
    }

    // 승인/거절/보류 처리
    async function handleReview(id, action) {
      const actionText = action === 'approve' ? '승인(불법 등록)' : 
                        action === 'reject' ? '거절(합법 등록)' : '보류';
      
      if (!confirm(\`이 도메인을 \${actionText} 처리하시겠습니까?\`)) {
        return;
      }

      const data = await fetchAPI('/api/review', {
        method: 'POST',
        body: JSON.stringify({ id, action }),
      });

      if (data.success) {
        alert(data.message);
        loadPendingItems();
      } else {
        alert('오류: ' + (data.error || '처리 실패'));
      }
    }

    // 초기 로드
    loadPendingItems();
  </script>
</body>
</html>
  `)
})

export default app
