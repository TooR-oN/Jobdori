# 도메인별 신고/차단 통계 + 월간 불법 도메인 분석 개발 계획서

**문서 버전**: v1.0
**작성일**: 2026-02-12
**관련 설계서**: `docs/domain-stats-and-monthly-analysis-design.md`

---

## 1. 개발 범위 요약

| Phase | 내용 | 예상 소요 |
|-------|------|---------|
| Phase 1 | 사이드바 메뉴 구조 변경 | 0.3일 |
| Phase 2 | 도메인별 신고/차단 통계 (백엔드 API + 프론트엔드) | 1일 |
| Phase 3 | 월간 도메인 분석 DB 스키마 | 0.5일 |
| Phase 4 | 월간 도메인 분석 백엔드 (Manus 연동 + API) | 2일 |
| Phase 5 | 월간 도메인 분석 프론트엔드 UI | 1.5일 |
| Phase 6 | 자동 실행 로직 + 통합 테스트 | 1일 |
| **합계** | | **6.3일** |

---

## 2. Phase 1: 사이드바 메뉴 구조 변경 (0.3일)

### 수정 파일

| 파일 | 변경 |
|------|------|
| `frontend/src/components/layout/Sidebar.tsx` | 메뉴명 + 메뉴 항목 변경 |
| `frontend/src/components/layout/MobileMenu.tsx` | 동일 변경 반영 |

### 변경 내용

```typescript
// Sidebar.tsx - mainMenuItems 수정

// 변경 전:
{ 
  name: '작품별 통계', 
  href: '/stats', 
  icon: ChartPieIcon,
  children: [
    { name: '신고/차단 통계', href: '/stats', icon: ChartPieIcon },
    { name: 'Manta 순위 변화', href: '/stats/manta-rankings', icon: LineChartIcon },
  ]
},

// 변경 후:
{ 
  name: '통계', 
  href: '/stats', 
  icon: ChartPieIcon,
  children: [
    { name: '작품별 신고/차단 통계', href: '/stats', icon: ChartPieIcon },
    { name: '도메인별 신고/차단 통계', href: '/stats/domain', icon: GlobeAltIcon },
    { name: 'Manta 순위 변화', href: '/stats/manta-rankings', icon: LineChartIcon },
  ]
},

// 신규 최상위 메뉴 추가 (사이트 목록 아래):
{ name: '월간 불법 도메인 분석', href: '/domain-analysis', icon: MagnifyingGlassIcon },
```

---

## 3. Phase 2: 도메인별 신고/차단 통계 (1일)

### Step 2-1. 백엔드 API 추가
**파일**: `backend/api/index.ts`

```typescript
// GET /api/stats/by-domain
app.get('/api/stats/by-domain', async (c) => {
  // 기존 /api/stats/by-title과 동일한 구조
  // GROUP BY domain으로 변경
  // 날짜 필터 지원 (start_date, end_date)
})
```

### Step 2-2. 프론트엔드 API 클라이언트 추가
**파일**: `frontend/src/lib/api.ts`

```typescript
export const statsApi = {
  byTitle: async (...) => { ... },  // 기존
  byDomain: async (startDate?: string, endDate?: string) => {
    const res = await api.get('/api/stats/by-domain', { 
      params: { start_date: startDate, end_date: endDate } 
    });
    return res.data;
  },
};
```

### Step 2-3. 프론트엔드 페이지 생성
**파일**: `frontend/src/app/stats/domain/page.tsx` (신규)

- 기존 `stats/page.tsx`를 복사하여 수정
- 상단 요약 카드 제거
- `title` → `domain`으로 변경
- 날짜 필터 기본값: 당월 (접속일 기준 YYYY-MM-01 ~ 오늘)
- `statsApi.byDomain()` 사용

### Phase 2 완료 기준
- `/stats/domain` 접속 시 도메인별 통계 테이블이 정상 표시
- 날짜 필터가 당월 기본값으로 설정됨
- 정렬이 모든 컬럼에서 정상 동작

---

## 4. Phase 3: 월간 도메인 분석 DB 스키마 (0.5일)

### Step 3-1. 테이블 생성
**파일**: `backend/api/index.ts` - `ensureDbMigration()` 함수에 추가

```sql
-- domain_analysis_reports 테이블
CREATE TABLE IF NOT EXISTS domain_analysis_reports (
  id SERIAL PRIMARY KEY,
  analysis_month VARCHAR(7) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  manus_task_id VARCHAR(100),
  total_domains INTEGER DEFAULT 0,
  report_blob_url TEXT,
  report_markdown TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  UNIQUE(analysis_month)
);

-- domain_analysis_results 테이블
CREATE TABLE IF NOT EXISTS domain_analysis_results (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES domain_analysis_reports(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  domain VARCHAR(255) NOT NULL,
  threat_score DECIMAL(5,1) DEFAULT 0,
  global_rank INTEGER,
  country_rank INTEGER,
  total_visits BIGINT,
  avg_visit_duration VARCHAR(20),
  visits_change_mom DECIMAL(5,1),
  rank_change_mom INTEGER,
  country VARCHAR(100),
  category VARCHAR(255),
  category_rank INTEGER,
  total_backlinks BIGINT,
  referring_domains INTEGER,
  top_organic_keywords TEXT,
  top_referring_domains TEXT,
  top_anchors TEXT,
  branded_traffic_ratio DECIMAL(5,1),
  size_score DECIMAL(5,1),
  growth_score DECIMAL(5,1),
  influence_score DECIMAL(5,1),
  recommendation TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(report_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_domain_analysis_results_report
  ON domain_analysis_results(report_id, rank);
```

### Phase 3 완료 기준
- 앱 시작 시 두 테이블이 정상 생성됨
- 기존 데이터에 영향 없음

---

## 5. Phase 4: 월간 도메인 분석 백엔드 (2일)

### Step 4-1. Manus 연동 모듈 생성
**파일**: `backend/scripts/domain-analysis.ts` (신규)

```typescript
// Manus 프로젝트 설정
const MANUS_TRAFFIC_PROJECT_ID = process.env.MANUS_TRAFFIC_PROJECT_ID || 'TvfU37uAeUph4R3YLzR2LV';

// 1. 상위 50개 도메인 조회
async function getTopIllegalDomains(limit: number = 50): Promise<string[]>

// 2. 전월 데이터 조회 (있는 경우)
async function getPreviousMonthData(currentMonth: string): Promise<any[] | null>

// 3. Manus 프롬프트 생성
function buildAnalysisPrompt(domains: string[], previousData: any[] | null, targetMonth: string): string

// 4. Manus Task 생성 및 대기
async function createAnalysisTask(prompt: string): Promise<string>  // taskId 반환

// 5. Manus 응답 파싱 (priority_list JSON + report Markdown)
async function parseManusResponse(taskId: string): Promise<{
  priorityList: DomainAnalysisResult[];
  reportMarkdown: string;
}>

// 6. 결과 저장 (DB + Blob)
async function saveAnalysisResults(
  reportId: number,
  priorityList: DomainAnalysisResult[],
  reportMarkdown: string
): Promise<void>

// 7. 메인 실행 함수
export async function runDomainAnalysis(month: string): Promise<void>
```

### Step 4-2. API 라우트 추가
**파일**: `backend/api/index.ts`

```typescript
// POST /api/domain-analysis/run          - 분석 실행
// GET  /api/domain-analysis/status/:month - 상태 조회
// GET  /api/domain-analysis/:month        - 결과 조회
// GET  /api/domain-analysis/months        - 월 목록 조회
// POST /api/domain-analysis/rerun         - 재실행
```

### Step 4-3. Manus Task 결과 처리 API
**파일**: `backend/api/index.ts`

```typescript
// POST /api/domain-analysis/process-result
// Manus Task 완료 후 결과 파싱/저장 (프론트에서 polling 후 트리거)
```

### Phase 4 완료 기준
- 분석 실행 API가 Manus Task를 생성하고 즉시 응답
- 상태 조회 API가 Manus Task 진행 상태를 반환
- Task 완료 후 결과 파싱 API가 JSON+Markdown을 파싱하여 DB에 저장
- 결과 조회 API가 월별 분석 데이터를 반환
- Vercel Blob에 보고서 마크다운이 업로드됨

---

## 6. Phase 5: 월간 도메인 분석 프론트엔드 (1.5일)

### Step 5-1. API 클라이언트 추가
**파일**: `frontend/src/lib/api.ts`

```typescript
export const domainAnalysisApi = {
  run: async (month?: string) => {
    const res = await api.post('/api/domain-analysis/run', { month });
    return res.data;
  },
  getStatus: async (month: string) => {
    const res = await api.get(`/api/domain-analysis/status/${month}`);
    return res.data;
  },
  getResult: async (month: string) => {
    const res = await api.get(`/api/domain-analysis/${month}`);
    return res.data;
  },
  getMonths: async () => {
    const res = await api.get('/api/domain-analysis/months');
    return res.data;
  },
  rerun: async (month: string) => {
    const res = await api.post('/api/domain-analysis/rerun', { month });
    return res.data;
  },
  processResult: async (month: string) => {
    const res = await api.post('/api/domain-analysis/process-result', { month });
    return res.data;
  },
};
```

### Step 5-2. 페이지 생성
**파일**: `frontend/src/app/domain-analysis/page.tsx` (신규)

주요 구성:
1. **상단 바**: 월 선택 드롭다운 + 분석 실행 버튼 + 보고서 보기 버튼 + 보고서 다운로드 버튼
2. **테이블**: 50개 사이트 우선순위 테이블 (모든 트래픽 데이터 포함)
3. **보고서 영역**: 마크다운 렌더링 (보고서 보기 클릭 시 표시/숨김 토글)

### Step 5-3. 마크다운 렌더링
- `react-markdown` 패키지 사용
- 보고서를 Blob URL에서 fetch 후 렌더링
- 보고서 다운로드: Blob URL로 직접 다운로드 또는 마크다운 텍스트를 .md 파일로 저장

### Step 5-4. 상태별 UI 분기
```
- 선택한 월의 데이터 없음 → "분석 실행" 버튼
- 실행 중 (polling) → 로딩 + 상태 텍스트
- 완료 → 테이블 + 보고서
- 실패 → 에러 메시지 + "재실행" 버튼
```

### Phase 5 완료 기준
- 월 선택 드롭다운이 정상 동작
- 분석 실행 시 Manus Task 상태가 폴링으로 표시됨
- 완료 후 50개 사이트 테이블이 정상 표시
- 보고서 보기 클릭 시 마크다운이 렌더링됨
- 보고서 다운로드 (.md) 정상 동작

---

## 7. Phase 6: 자동 실행 + 통합 테스트 (1일)

### Step 6-1. 자동 실행 로직
**파일**: `backend/scripts/run-pipeline.ts` 또는 `backend/scripts/monthly-domain-analysis.ts`

매일 파이프라인 실행 시:
1. 현재 날짜가 11일 이후인지 확인
2. 해당 월의 분석이 이미 존재하는지 확인
3. 조건 충족 시 자동 분석 실행

### Step 6-2. 통합 테스트

| # | 시나리오 | 검증 |
|---|---------|------|
| T-1 | 도메인별 통계 조회 (전체 기간) | 도메인별 발견/신고/차단 수 정확 |
| T-2 | 도메인별 통계 조회 (월간 필터) | 날짜 범위 필터 정상 |
| T-3 | 월간 분석 실행 | Manus Task 생성 성공 |
| T-4 | 분석 상태 폴링 | 진행 상태 정상 반환 |
| T-5 | 분석 결과 파싱 | JSON + Markdown 파싱 정확 |
| T-6 | 보고서 Blob 저장 | URL 생성 및 접근 가능 |
| T-7 | 월 목록 조회 | 드롭다운 데이터 정상 |
| T-8 | 자동 실행 조건 | 11일 이후 + 미실행 시에만 |
| T-9 | 중복 실행 방지 | 동일 월 409 반환 |
| T-10 | UI 전체 흐름 | 월 선택 → 실행 → 완료 → 조회 |

---

## 8. 파일 변경 요약

### 신규 파일

| 파일 | 설명 |
|------|------|
| `frontend/src/app/stats/domain/page.tsx` | 도메인별 신고/차단 통계 페이지 |
| `frontend/src/app/domain-analysis/page.tsx` | 월간 불법 도메인 분석 페이지 |
| `backend/scripts/domain-analysis.ts` | Manus 연동 도메인 분석 로직 |

### 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `frontend/src/components/layout/Sidebar.tsx` | 메뉴 구조 변경 |
| `frontend/src/components/layout/MobileMenu.tsx` | 메뉴 구조 변경 |
| `frontend/src/lib/api.ts` | statsApi.byDomain + domainAnalysisApi 추가 |
| `backend/api/index.ts` | 7개 API 엔드포인트 추가 + DB 마이그레이션 |
| `backend/scripts/run-pipeline.ts` | 자동 실행 트리거 추가 (선택사항) |

---

## 9. 개발 순서 (권장)

```
Phase 1 → Phase 2 → (기능 1 완료, PR 생성 가능)
     ↓
Phase 3 → Phase 4 → Phase 5 → Phase 6 → (기능 2 완료, PR 생성)
```

기능 1은 독립적이므로 먼저 완성하여 배포 가능합니다.
기능 2는 기능 1의 도메인별 통계 API를 활용하므로 기능 1 이후에 진행합니다.
