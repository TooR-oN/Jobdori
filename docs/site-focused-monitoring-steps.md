# 사이트 집중 모니터링 - Phase별 상세 개발 Step

**작성일**: 2026-02-06
**진입점**: 모니터링 회차 → 세션 상세 페이지 (`/sessions/[id]`)

---

## Phase 1: DB 스키마 & 타입 정의 (0.5일)

### Step 1-1. 공유 타입 정의 추가
**파일**: `backend/scripts/types/index.ts`
```
- DeepMonitoringTarget 인터페이스 추가
- DeepMonitoringResult 인터페이스 추가
- DeepTargetResult 인터페이스 추가
```

### Step 1-2. DB 테이블 생성 (initializeDatabase 확장)
**파일**: `backend/src/lib/db.ts`
```
- deep_monitoring_targets 테이블 CREATE 문 추가
  (id, session_id, title, domain, url_count, base_keyword, deep_query, status,
   results_count, new_urls_count, created_at, executed_at, completed_at)
- UNIQUE(session_id, title, domain) 제약 조건
- idx_deep_monitoring_session 인덱스
```

### Step 1-3. 기존 테이블 컬럼 추가 (마이그레이션)
**파일**: `backend/src/lib/db.ts`
```
- detection_results 테이블에 source VARCHAR(20) DEFAULT 'regular' 추가
- detection_results 테이블에 deep_target_id INTEGER 추가
- sessions 테이블에 deep_monitoring_executed BOOLEAN DEFAULT false 추가
- sessions 테이블에 deep_monitoring_targets_count INTEGER DEFAULT 0 추가
- sessions 테이블에 deep_monitoring_new_urls INTEGER DEFAULT 0 추가
- 모두 DO $$ IF NOT EXISTS $$ 패턴으로 안전하게 추가
```

### Step 1-4. DB CRUD 함수 추가
**파일**: `backend/src/lib/db.ts`
```
- getDeepMonitoringTargets(sessionId) → 대상 목록 조회
- createDeepMonitoringTarget(target) → 대상 생성 (ON CONFLICT UPSERT)
- updateDeepMonitoringTarget(id, updates) → 상태/결과 업데이트
- deleteDeepMonitoringTargetsBySession(sessionId) → 세션별 전체 삭제
```

### Phase 1 완료 기준
- 앱 시작(initializeDatabase) 시 새 테이블 및 컬럼이 정상 생성됨
- 기존 데이터에 영향 없음 (DEFAULT 값으로 하위 호환)
- CRUD 함수가 정상 동작함

---

## Phase 2: 백엔드 - 대상 식별 로직 (1일)

### Step 2-1. deep-monitoring.ts 파일 생성 및 기본 구조
**파일**: `backend/scripts/deep-monitoring.ts` (신규)
```
- dotenv/config, neon, 기존 모듈 import
- getDb() 헬퍼 함수
- DB CRUD 함수 import (db.ts에서)
```

### Step 2-2. scanDeepMonitoringTargets() 함수 구현
**파일**: `backend/scripts/deep-monitoring.ts`
```
핵심 알고리즘:
1) detection_results에서 해당 세션의 전체 결과 조회
   → SELECT title, domain, url, search_query FROM detection_results WHERE session_id = ?
2) sites 테이블에서 illegal 도메인 Set 로드
   → SELECT domain FROM sites WHERE type = 'illegal'
3) 작품(title) × 도메인(domain)별로 고유 URL 합산
   → Map<title, Map<domain, { urls: Set<url>, keywordStats: Map<search_query, Set<url>> }>>
4) 필터: url.size >= threshold && illegalDomains.has(domain)
5) 각 대상에서 최다 URL 키워드 조합 선택 → base_keyword로 설정
6) deep_query = "{base_keyword} site:{domain}" 생성
7) DB에 대상 저장 (기존 대상 삭제 후 새로 저장)
8) keyword_breakdown 포함하여 반환 (프론트에서 접이식 상세 표시용)
```

### Step 2-3. 유닛 테스트용 직접 실행 코드
**파일**: `backend/scripts/deep-monitoring.ts`
```
- import.meta.url 체크로 직접 실행 가능하도록 구성
- 테스트 세션 ID로 scan 실행 후 결과 출력
```

### Phase 2 완료 기준
- 완료된 세션 ID를 넣으면 임계치 이상인 불법 도메인 대상 목록이 반환됨
- 각 대상에 keyword_breakdown(키워드 조합별 URL 수)이 포함됨
- 최다 URL 키워드 조합이 base_keyword로 올바르게 선택됨
- deep_monitoring_targets 테이블에 대상이 저장됨

---

## Phase 3: 백엔드 - 심층 검색 실행 로직 (1.5일)

### Step 3-1. executeDeepSearchForTarget() 함수 구현
**파일**: `backend/scripts/deep-monitoring.ts`
```
- search.ts의 searchWithSerper(), executeSearch() 함수를 import하여 재사용
- 단일 대상(deep_query)에 대해 3페이지 검색 실행
- 결과의 title을 공식 타이틀(target.title)로 통일
- SearchResult[] 반환
```

### Step 3-2. executeDeepMonitoring() 메인 함수 구현
**파일**: `backend/scripts/deep-monitoring.ts`
```
1) 대상 목록 로드 (targetIds 필터 적용)
2) 기존 세션의 URL Set 로드 (중복 체크용)
   → SELECT url FROM detection_results WHERE session_id = ?
3) 각 대상에 대해 순차 실행:
   a) 상태 업데이트: 'running'
   b) executeDeepSearchForTarget()으로 검색
   c) runClassify()로 1차 판별 (classify.ts 재사용)
   d) runLLMJudge()로 2차 판별 (llm-judge.ts 재사용)
      → unknown이 0이면 LLM skip (기존 동작 그대로)
   e) createFinalResults()로 최종 결과 생성
   f) 기존 URL과 중복 제거
   g) detection_results에 INSERT (source='deep', deep_target_id 설정)
   h) 불법 URL은 report_tracking에 등록
   i) 상태 업데이트: 'completed' (results_count, new_urls_count)
   j) 검색 간 딜레이
4) 세션 통계 갱신 (detection_results 기반 재집계)
5) Vercel Blob의 final-results.json 업데이트
6) sessions 테이블에 deep_monitoring_* 컬럼 업데이트
```

### Step 3-3. 보조 함수 구현
**파일**: `backend/scripts/deep-monitoring.ts`
```
- getExistingUrlsForSession(sessionId): 기존 URL Set 로드
- refreshSessionStats(sessionId): detection_results 기반 세션 통계 재집계
- updateBlobFinalResults(sessionId): Blob 재업로드
```

### Step 3-4. search.ts에서 함수 export 확인/수정
**파일**: `backend/scripts/search.ts`
```
- searchWithSerper()와 executeSearch()가 외부에서 import 가능한지 확인
- 필요 시 export 추가 (현재 executeSearch는 모듈 내부 함수)
```

### Phase 3 완료 기준
- 심층 검색이 대상 쿼리만 실행됨 (전체 파이프라인 재실행 아님)
- 검색 → 1차 판별 → (2차 판별 skip 가능) → 최종 결과 생성 흐름이 정상 동작
- detection_results에 source='deep' 결과가 저장됨
- 중복 URL이 ON CONFLICT로 방지됨
- 세션 통계(results_total, results_illegal 등)가 올바르게 갱신됨
- Blob의 final-results.json이 심층 결과 포함하여 업데이트됨
- 불법 URL이 report_tracking에 자동 등록됨

---

## Phase 4: 백엔드 - API 라우트 연결 (0.5일)

### Step 4-1. 메모리 상태 관리 변수 추가
**파일**: `backend/src/app.ts`
```
- deepMonitoringStatus 객체 선언
  { isRunning, sessionId, currentTarget, progress: { completed, total, percentage } }
- 동시 실행 방지용
```

### Step 4-2. POST /api/sessions/:id/deep-monitoring/scan
**파일**: `backend/src/app.ts`
```
- 세션 존재 확인 & status='completed' 확인
- body에서 threshold 파싱 (기본값 5)
- scanDeepMonitoringTargets() 호출
- 대상 목록 + scan_summary 반환
```

### Step 4-3. POST /api/sessions/:id/deep-monitoring/execute
**파일**: `backend/src/app.ts`
```
- 동시 실행 체크 (isRunning이면 409 반환)
- deepMonitoringStatus를 running으로 설정
- executeDeepMonitoring()을 비동기 실행 (즉시 응답)
- 실행 중 deepMonitoringStatus.currentTarget/progress 갱신
- 완료/실패 시 상태 초기화
```

### Step 4-4. GET /api/sessions/:id/deep-monitoring/targets
**파일**: `backend/src/app.ts`
```
- db.getDeepMonitoringTargets(sessionId) 호출
- 대상 목록 + 상태별 요약 반환
```

### Step 4-5. GET /api/sessions/:id/deep-monitoring/status
**파일**: `backend/src/app.ts`
```
- deepMonitoringStatus 객체 그대로 반환
- isRunning, currentTarget, progress 포함
```

### Step 4-6. 기존 세션 API 응답에 deep_monitoring 정보 추가
**파일**: `backend/src/app.ts`
```
- GET /api/sessions: 응답에 deep_monitoring_executed, deep_monitoring_new_urls 포함
- GET /api/sessions/:id: 응답에 동일 필드 포함
```

### Phase 4 완료 기준
- 4개 API 엔드포인트가 정상 응답
- scan → 대상 목록 정상 반환
- execute → 비동기 실행 시작 + 즉시 응답
- targets → 저장된 대상 상태 조회
- status → 실시간 진행 상태 조회
- 동시 실행 시 409 Conflict 반환
- 기존 세션 목록 API에 deep_monitoring 필드 추가

---

## Phase 5: 프론트엔드 - UI 구현 (1.5일)

### Step 5-1. API 클라이언트 추가
**파일**: `frontend/src/lib/api.ts`
```
export const deepMonitoringApi = {
  scan(sessionId, threshold?)     → POST /api/sessions/:id/deep-monitoring/scan
  execute(sessionId, targetIds?)  → POST /api/sessions/:id/deep-monitoring/execute
  getTargets(sessionId)           → GET  /api/sessions/:id/deep-monitoring/targets
  getStatus(sessionId)            → GET  /api/sessions/:id/deep-monitoring/status
}
```

### Step 5-2. 세션 상세 페이지에 집중 모니터링 패널 추가
**파일**: `frontend/src/app/sessions/[id]/page.tsx`
```
기존 결과 테이블 아래에 새로운 섹션 추가:

┌─────────────────────────────────────────────────┐
│ 🔍 사이트 집중 모니터링                            │
│                                                  │
│ [사이트 집중 모니터링 대상 검색]  임계치: [5 ▼]     │
│                                                  │
│ (검색 후) 대상 목록 테이블                         │
│ ☑ 작품명 | 도메인 | URL수 | 기반키워드 | 심층쿼리  │
│ ☑ Merry.. | mangadex.. | 6 | ...chapter | site:..│
│   ├ 키워드 상세 (접이식)                          │
│   │  Merry Her Obsession chapter: 5개             │
│   │  Merry Her Obsession manga: 3개               │
│ ☑ Merry.. | xbato..    | 5 | ...manga   | site:..│
│                                                  │
│ [전체 선택/해제]  선택: 2개                        │
│ [사이트 집중 모니터링 시작]                        │
│                                                  │
│ (실행 중) 진행 상태                               │
│ ████████░░░░ 1/2 처리 중: mangadex.net...        │
│                                                  │
│ (완료 후) 결과 요약                               │
│ ✅ 완료: 신규 URL 18개 수집 (불법 18개)           │
└─────────────────────────────────────────────────┘
```

### Step 5-3. 상태 관리 (useState)
**파일**: `frontend/src/app/sessions/[id]/page.tsx`
```
- targets: DeepMonitoringTarget[]  (대상 목록)
- selectedTargetIds: Set<number>   (선택된 대상 ID)
- isScanning: boolean              (대상 검색 중)
- isExecuting: boolean             (심층 검색 실행 중)
- isCompleted: boolean             (심층 검색 완료)
- progress: { completed, total, percentage }
- currentTarget: { title, domain }
- executionResult: { total_new_urls, ... }  (완료 결과)
- expandedTargets: Set<number>     (키워드 상세 펼침 상태)
- threshold: number                (임계치, 기본 5)
```

### Step 5-4. 이벤트 핸들러 구현
**파일**: `frontend/src/app/sessions/[id]/page.tsx`
```
- handleScan(): deepMonitoringApi.scan() 호출 → targets 상태 설정
- handleExecute(): deepMonitoringApi.execute() 호출 → polling 시작
- handleToggleTarget(id): 개별 체크박스 토글
- handleToggleAll(): 전체 선택/해제
- handleToggleExpand(id): 키워드 상세 접이식 토글
```

### Step 5-5. 진행 상태 Polling (useEffect)
**파일**: `frontend/src/app/sessions/[id]/page.tsx`
```
- isExecuting이 true일 때 2초마다 deepMonitoringApi.getStatus() 호출
- progress, currentTarget 상태 갱신
- isRunning이 false가 되면:
  → isExecuting = false, isCompleted = true
  → targets 목록 재조회 (상태 업데이트 확인)
  → 기존 결과 테이블 loadResults() 재호출 (병합된 결과 반영)
```

### Step 5-6. 세션 목록 페이지에 집중 모니터링 배지 추가
**파일**: `frontend/src/app/sessions/page.tsx`
```
- Session 인터페이스에 deep_monitoring_executed, deep_monitoring_new_urls 추가
- 세션 행에 조건부 배지 표시:
  {session.deep_monitoring_executed && (
    <span className="ml-2 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
      🔍 +{session.deep_monitoring_new_urls}
    </span>
  )}
```

### Step 5-7. 세션이 completed가 아닐 때 패널 비활성화
**파일**: `frontend/src/app/sessions/[id]/page.tsx`
```
- 세션 상태가 'completed'가 아닌 경우 집중 모니터링 패널을 비활성화(disable)
- 안내 문구: "정기 모니터링이 완료된 후 집중 모니터링을 실행할 수 있습니다."
```

### Step 5-8. 기존 결과 테이블에 source 구분 표시 (선택사항)
**파일**: `frontend/src/app/sessions/[id]/page.tsx`
```
- 결과 테이블에 '출처' 컬럼 또는 배지 추가 (정기 / 심층)
- source='deep'인 결과에 보라색 배지 표시
```

### Phase 5 완료 기준
- 세션 상세 페이지에서 "대상 검색" 클릭 시 대상 목록이 정상 표시됨
- 키워드 조합별 상세 내역이 접이식으로 펼쳐짐
- 체크박스로 대상 선택/해제/전체선택 가능
- "시작" 클릭 시 진행 상태가 실시간 polling으로 표시됨
- 완료 후 결과 요약 표시 + 기존 결과 테이블이 자동 갱신됨
- 세션 목록에 집중 모니터링 배지 표시됨
- 세션이 completed가 아닐 때 패널이 비활성화됨

---

## Phase 6: 통합 테스트 & 배포 (1일)

### Step 6-1. 로컬 통합 테스트
```
- DB 마이그레이션 정상 실행 확인
- scan API 호출 → 대상 식별 검증
  → detection_results에 search_query가 정확히 저장되어 있는지
  → 불법 도메인만 대상이 되는지
  → 키워드 조합별 URL 수가 올바른지
- execute API 호출 → 심층 검색 검증
  → 대상 쿼리만 Serper API 호출되는지
  → unknown 0일 때 LLM skip 되는지
  → 중복 URL이 방지되는지
  → detection_results에 source='deep' 저장되는지
  → report_tracking에 불법 URL 등록되는지
  → 세션 통계 갱신 정확한지
- 프론트엔드 전체 흐름
  → 세션 상세 진입 → 대상 검색 → 선택 → 실행 → 완료 → 결과 확인
```

### Step 6-2. 에지 케이스 테스트
```
- 대상이 0개인 경우 (임계치 미달)
- 모든 심층 결과가 기존 URL과 중복인 경우 (new_urls = 0)
- 심층 검색 중 Serper API 오류 발생 시 (target status = 'failed')
- 동시 실행 시도 시 409 반환
- 이미 심층 모니터링을 실행한 세션에서 다시 scan 시 (기존 대상 갱신)
```

### Step 6-3. 배포
```
1) PR 생성: genspark_ai_developer → main
2) Vercel 배포 후 프로덕션 DB 마이그레이션 자동 실행 확인
3) 프론트엔드 빌드 정상 확인
4) 프로덕션에서 scan API 테스트 (실제 세션 데이터)
```

---

## 파일 변경 맵 요약

```
[신규 파일]
  backend/scripts/deep-monitoring.ts  ← Phase 2, 3 (핵심 로직)

[수정 파일]
  backend/scripts/types/index.ts      ← Phase 1 (타입 3개 추가)
  backend/scripts/search.ts           ← Phase 3 (executeSearch export 추가)
  backend/src/lib/db.ts               ← Phase 1 (테이블 + CRUD 함수)
  backend/src/app.ts                  ← Phase 4 (API 4개 + 기존 API 필드 추가)
  backend/data/config.json            ← Phase 1 (deep_monitoring 설정 추가, 선택)
  frontend/src/lib/api.ts             ← Phase 5 (deepMonitoringApi 추가)
  frontend/src/app/sessions/[id]/page.tsx ← Phase 5 (패널 UI 추가)
  frontend/src/app/sessions/page.tsx  ← Phase 5 (배지 추가)
```
