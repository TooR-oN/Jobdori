# 사이트 집중 모니터링 기능 설계서

**문서 버전**: v1.0
**작성일**: 2026-02-06
**기능명**: 사이트 집중 모니터링 (Site-Focused Deep Monitoring)

---

## 1. 기능 개요

### 1.1 목적
정기 모니터링(평일 아침 자동 실행) 완료 후, 특정 불법 사이트에서 다수의 URL이 탐지된 경우를 식별하여 Google Dork 형식의 심층 검색(`site:도메인`)을 추가로 수행함으로써 해당 사이트에 대한 모니터링 범위를 확장한다.

### 1.2 핵심 규칙
1. **작품명 기준 처리**: 공식 타이틀과 비공식 타이틀을 구분하지 않고 작품 단위로 결과를 병합한다.
   - 예: `Merry Her Obsession`(공식) + `Merry Psycho`(비공식) = 하나의 작품으로 합산
2. **키워드 조합별 모니터링**: 각 검색어(작품명 변형 x 키워드)별로 3페이지씩 모니터링한다.
3. **사이트별 URL 합산 + 중복 제거**: 동일 작품의 모든 키워드 조합 결과에서 사이트별 URL을 합산하고 중복을 제거한다.
4. **임계치 판정**: 합산된 URL 수가 **5개 이상**인 **불법 확정 도메인**이 심층 모니터링 대상이 된다.
5. **심층 검색**: 해당 도메인에 대해 최다 URL을 가진 키워드 조합 + `site:도메인` 형식으로 추가 검색한다.
6. **결과 통합**: 심층 검색 결과를 원본 세션에 병합하고 중복을 제거한다.

### 1.3 실행 방식
- **수동 트리거**: 정기 모니터링 완료 후, 사용자가 프론트엔드에서 수동으로 실행한다.
- **2단계 실행**:
  1. "사이트 집중 모니터링 대상 검색" 버튼 -> 임계치 이상인 대상 목록 표시
  2. "사이트 집중 모니터링 시작" 버튼 -> 선택된 대상에 대해 심층 검색 실행

---

## 2. 데이터 흐름 상세

### 2.1 대상 식별 흐름

```
[정기 모니터링 완료된 세션]
       |
       v
[Step 1] detection_results에서 해당 세션의 모든 결과 조회
       |
       v
[Step 2] 작품 단위로 그룹화 (공식 타이틀 기준, 비공식 포함)
       |
       v
[Step 3] 작품 x 도메인별 URL 합산 (중복 URL 제거)
       |
       v
[Step 4] 도메인이 sites 테이블에서 type='illegal'인지 확인
       |
       v
[Step 5] 불법 확정 도메인 중 URL 수 >= 5인 항목 필터링
       |
       v
[Step 6] 각 대상에 대해 최다 URL을 가진 키워드 조합 식별
       |
       v
[대상 목록 반환]
  - 작품명
  - 도메인
  - 합산 URL 수
  - 기반 키워드 조합 (예: "Merry Psycho manga")
  - 심층 검색 쿼리 (예: "Merry Psycho manga site:mangadex.net")
```

### 2.2 심층 검색 흐름

```
[대상 목록에서 사용자가 선택/전체 선택]
       |
       v
[Step 1] 각 대상에 대해 Google Dork 쿼리 생성
         쿼리 = "{기반 키워드 조합} site:{도메인}"
       |
       v
[Step 2] Serper.dev API로 3페이지 검색 (기존 search.ts 로직 재사용)
       |
       v
[Step 3] 검색 결과를 기존 파이프라인으로 처리
         - 1차 판별 (classify)
         - 2차 판별 (llm-judge) - 해당 도메인은 이미 illegal이므로 대부분 skip
         - 최종 결과 생성
       |
       v
[Step 4] 결과를 원본 세션에 병합
         - detection_results에 INSERT (ON CONFLICT DO NOTHING으로 중복 방지)
         - report_tracking에 불법 URL 등록
         - 세션 통계 업데이트
       |
       v
[Step 5] Vercel Blob의 final-results.json 업데이트
       |
       v
[완료 - 프론트엔드 갱신]
```

### 2.3 대상 식별 예시

```
작품: Merry Her Obsession (비공식: Merry Psycho)

검색 결과:
  "Merry Her Obsession manga" -> mangadex.net: 2개 URL
  "Merry Her Obsession chapter" -> mangadex.net: 1개 URL
  "Merry Psycho manga"         -> mangadex.net: 4개 URL
  "Merry Psycho chapter"       -> mangadex.net: 2개 URL

작품 단위 합산 (중복 제거 후):
  mangadex.net: 5개 고유 URL (임계치 5 달성)

mangadex.net이 sites 테이블에서 illegal인지 확인:
  -> illegal 확정

최다 URL 키워드 조합: "Merry Psycho manga" (4개)

심층 검색 쿼리: "Merry Psycho manga site:mangadex.net"
  -> 3페이지 추가 모니터링 실행
```

---

## 3. 데이터베이스 스키마 변경

### 3.1 신규 테이블: `deep_monitoring_targets`

심층 모니터링 대상 및 실행 이력을 저장한다.

```sql
CREATE TABLE IF NOT EXISTS deep_monitoring_targets (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) NOT NULL,           -- 원본 세션 ID
  title VARCHAR(500) NOT NULL,               -- 공식 작품명
  domain VARCHAR(255) NOT NULL,              -- 대상 도메인
  url_count INTEGER NOT NULL,                -- 합산 URL 수 (중복 제거 후)
  base_keyword VARCHAR(500) NOT NULL,        -- 기반 키워드 조합 (예: "Merry Psycho manga")
  deep_query VARCHAR(500) NOT NULL,          -- 심층 검색 쿼리 (예: "Merry Psycho manga site:mangadex.net")
  status VARCHAR(20) DEFAULT 'pending',      -- pending | running | completed | failed
  results_count INTEGER DEFAULT 0,           -- 심층 검색으로 수집된 결과 수
  new_urls_count INTEGER DEFAULT 0,          -- 신규 URL 수 (기존 중복 제외)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  executed_at TIMESTAMP WITH TIME ZONE,      -- 심층 검색 실행 시각
  completed_at TIMESTAMP WITH TIME ZONE,     -- 완료 시각
  UNIQUE(session_id, title, domain)          -- 동일 세션/작품/도메인 중복 방지
);

CREATE INDEX IF NOT EXISTS idx_deep_monitoring_session
  ON deep_monitoring_targets(session_id, status);
```

### 3.2 detection_results 테이블 변경 (컬럼 추가)

```sql
-- 심층 모니터링 출처 식별 컬럼 추가
ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'regular';
-- source: 'regular' (정기 모니터링) | 'deep' (심층 모니터링)

ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS deep_target_id INTEGER REFERENCES deep_monitoring_targets(id);
-- deep_target_id: 심층 모니터링 대상 ID (심층 결과일 때만 설정)
```

### 3.3 sessions 테이블 변경 (컬럼 추가)

```sql
-- 심층 모니터링 실행 여부 및 통계 컬럼 추가
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS deep_monitoring_executed BOOLEAN DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS deep_monitoring_targets_count INTEGER DEFAULT 0;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS deep_monitoring_new_urls INTEGER DEFAULT 0;
```

---

## 4. API 설계

### 4.1 대상 식별 API

**`POST /api/sessions/:id/deep-monitoring/scan`**

지정된 세션의 모니터링 결과를 분석하여 심층 모니터링 대상을 식별한다.

**Request:**
```json
{
  "threshold": 5          // 임계치 (기본값: 5, 선택사항)
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "session_id": "2026-02-06T00-00-00",
    "threshold": 5,
    "targets": [
      {
        "id": 1,
        "title": "Merry Her Obsession",
        "domain": "mangadex.net",
        "url_count": 5,
        "base_keyword": "Merry Psycho manga",
        "deep_query": "Merry Psycho manga site:mangadex.net",
        "status": "pending",
        "keyword_breakdown": [
          { "keyword": "Merry Psycho manga", "urls": 4 },
          { "keyword": "Merry Psycho chapter", "urls": 2 },
          { "keyword": "Merry Her Obsession manga", "urls": 2 },
          { "keyword": "Merry Her Obsession chapter", "urls": 1 }
        ]
      },
      {
        "id": 2,
        "title": "Solo Leveling",
        "domain": "xbato.com",
        "url_count": 8,
        "base_keyword": "Solo Leveling manga",
        "deep_query": "Solo Leveling manga site:xbato.com",
        "status": "pending",
        "keyword_breakdown": [
          { "keyword": "Solo Leveling manga", "urls": 5 },
          { "keyword": "Solo Leveling chapter", "urls": 4 }
        ]
      }
    ],
    "total_targets": 2,
    "scan_summary": {
      "titles_analyzed": 10,
      "domains_analyzed": 45,
      "illegal_domains_checked": 15,
      "targets_found": 2
    }
  }
}
```

### 4.2 심층 모니터링 실행 API

**`POST /api/sessions/:id/deep-monitoring/execute`**

선택된 대상에 대해 심층 모니터링을 실행한다.

**Request:**
```json
{
  "target_ids": [1, 2]    // 실행할 대상 ID 배열 (비어있으면 전체)
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "session_id": "2026-02-06T00-00-00",
    "executed_targets": 2,
    "total_new_results": 24,
    "total_new_urls": 18,
    "results_per_target": [
      {
        "target_id": 1,
        "title": "Merry Her Obsession",
        "domain": "mangadex.net",
        "deep_query": "Merry Psycho manga site:mangadex.net",
        "results_count": 15,
        "new_urls_count": 12,
        "illegal_count": 12,
        "legal_count": 0,
        "pending_count": 0
      },
      {
        "target_id": 2,
        "title": "Solo Leveling",
        "domain": "xbato.com",
        "deep_query": "Solo Leveling manga site:xbato.com",
        "results_count": 9,
        "new_urls_count": 6,
        "illegal_count": 6,
        "legal_count": 0,
        "pending_count": 0
      }
    ],
    "session_updated_stats": {
      "results_total": 324,
      "results_illegal": 156,
      "results_legal": 98,
      "results_pending": 70
    }
  }
}
```

### 4.3 대상 목록 조회 API

**`GET /api/sessions/:id/deep-monitoring/targets`**

해당 세션의 심층 모니터링 대상 및 상태를 조회한다.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "session_id": "2026-02-06T00-00-00",
    "targets": [
      {
        "id": 1,
        "title": "Merry Her Obsession",
        "domain": "mangadex.net",
        "url_count": 5,
        "base_keyword": "Merry Psycho manga",
        "deep_query": "Merry Psycho manga site:mangadex.net",
        "status": "completed",
        "results_count": 15,
        "new_urls_count": 12,
        "executed_at": "2026-02-06T09:30:00Z",
        "completed_at": "2026-02-06T09:31:15Z"
      }
    ],
    "summary": {
      "total": 2,
      "pending": 0,
      "completed": 2,
      "total_new_urls": 18
    }
  }
}
```

### 4.4 실행 상태 조회 API

**`GET /api/sessions/:id/deep-monitoring/status`**

심층 모니터링 실행 중 진행 상태를 조회한다.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "is_running": true,
    "current_target": {
      "id": 1,
      "title": "Merry Her Obsession",
      "domain": "mangadex.net",
      "deep_query": "Merry Psycho manga site:mangadex.net"
    },
    "progress": {
      "completed": 1,
      "total": 2,
      "percentage": 50
    }
  }
}
```

---

## 5. 백엔드 모듈 설계

### 5.1 신규 파일: `backend/scripts/deep-monitoring.ts`

**핵심 함수:**

```typescript
// 1. 대상 식별 (scan)
export async function scanDeepMonitoringTargets(
  sessionId: string,
  threshold?: number
): Promise<DeepMonitoringTarget[]>

// 2. 심층 검색 실행 (execute)
export async function executeDeepMonitoring(
  sessionId: string,
  targetIds?: number[]
): Promise<DeepMonitoringResult>

// 3. 단일 대상 심층 검색
async function executeDeepSearchForTarget(
  target: DeepMonitoringTarget,
  config: Config,
  illegalSites: Set<string>,
  legalSites: Set<string>
): Promise<DeepSearchResult>

// 4. 결과 병합
async function mergeDeepResultsToSession(
  sessionId: string,
  targetId: number,
  results: FinalResult[]
): Promise<MergeResult>
```

### 5.2 타입 정의 추가 (scripts/types/index.ts)

```typescript
export interface DeepMonitoringTarget {
  id?: number;
  session_id: string;
  title: string;
  domain: string;
  url_count: number;
  base_keyword: string;
  deep_query: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results_count: number;
  new_urls_count: number;
  keyword_breakdown?: { keyword: string; urls: number }[];
  created_at?: string;
  executed_at?: string;
  completed_at?: string;
}

export interface DeepMonitoringResult {
  session_id: string;
  executed_targets: number;
  total_new_results: number;
  total_new_urls: number;
  results_per_target: DeepTargetResult[];
}

export interface DeepTargetResult {
  target_id: number;
  title: string;
  domain: string;
  deep_query: string;
  results_count: number;
  new_urls_count: number;
  illegal_count: number;
  legal_count: number;
  pending_count: number;
}
```

### 5.3 DB 함수 추가 (src/lib/db.ts)

```typescript
// deep_monitoring_targets CRUD
export async function getDeepMonitoringTargets(sessionId: string)
export async function createDeepMonitoringTarget(target: Partial<DeepMonitoringTarget>)
export async function updateDeepMonitoringTarget(id: number, updates: Partial<DeepMonitoringTarget>)
export async function deleteDeepMonitoringTargetsBySession(sessionId: string)

// 분석용 쿼리 (대상 식별)
export async function getSessionDomainStats(sessionId: string)
  // detection_results에서 작품 x 도메인별 고유 URL 수를 집계
```

### 5.4 API 라우트 추가 (src/app.ts)

```typescript
// 사이트 집중 모니터링 API 그룹
app.post('/api/sessions/:id/deep-monitoring/scan', ...)
app.post('/api/sessions/:id/deep-monitoring/execute', ...)
app.get('/api/sessions/:id/deep-monitoring/targets', ...)
app.get('/api/sessions/:id/deep-monitoring/status', ...)
```

---

## 6. 프론트엔드 설계

### 6.1 UI 위치 및 구조

세션 상세 페이지(`/sessions/[id]`)에 **"사이트 집중 모니터링" 패널**을 추가한다.

```
[세션 상세 페이지]
  ├── 기존: 필터 (작품 선택, 상태 필터)
  ├── 기존: 결과 테이블
  └── [신규] 사이트 집중 모니터링 패널
       ├── [1단계] "사이트 집중 모니터링 대상 검색" 버튼
       │    └── 대상 목록 테이블
       │         - 작품명 | 도메인 | 합산 URL 수 | 기반 키워드 | 심층 쿼리 | 상태 | 체크박스
       │         - 키워드 조합별 상세 (접이식)
       └── [2단계] "사이트 집중 모니터링 시작" 버튼
            └── 진행 상태 표시 (실시간)
            └── 완료 후 결과 요약
```

### 6.2 UI 상태 흐름

```
[초기 상태]
  - "사이트 집중 모니터링 대상 검색" 버튼 활성화
  - 세션 status가 'completed'일 때만 표시

[대상 검색 완료]
  - 대상 목록 테이블 표시
  - 각 대상에 체크박스 (전체 선택/해제)
  - "사이트 집중 모니터링 시작" 버튼 활성화

[실행 중]
  - 진행 상태 바: "대상 1/2 처리 중: mangadex.net..."
  - 완료된 대상은 결과 요약 표시

[완료]
  - 전체 결과 요약 (신규 URL 수, 불법 건수 등)
  - 기존 결과 테이블 자동 갱신
  - "다시 검색" 버튼으로 초기화 가능
```

### 6.3 프론트엔드 API 클라이언트 추가 (lib/api.ts)

```typescript
export const deepMonitoringApi = {
  scan: async (sessionId: string, threshold?: number) => { ... },
  execute: async (sessionId: string, targetIds?: number[]) => { ... },
  getTargets: async (sessionId: string) => { ... },
  getStatus: async (sessionId: string) => { ... },
};
```

---

## 7. 기존 기능 영향 분석

### 7.1 영향받는 컴포넌트

| 컴포넌트 | 영향 | 변경 내용 |
|---------|------|----------|
| 세션 상세 페이지 | 직접 변경 | 집중 모니터링 패널 추가 |
| 세션 목록 페이지 | 간접 변경 | 집중 모니터링 여부 배지 표시 |
| 대시보드 | 자동 반영 | 심층 결과가 detection_results에 추가되므로 월별 통계에 자동 포함 |
| 신고결과 추적 | 자동 반영 | 심층 결과의 불법 URL이 report_tracking에 자동 등록 |
| 작품별 통계 | 자동 반영 | detection_results 기반 집계이므로 자동 포함 |

### 7.2 영향받지 않는 컴포넌트

| 컴포넌트 | 이유 |
|---------|------|
| 승인 대기 | 심층 검색 대상은 이미 illegal 확정 도메인이므로 pending 발생하지 않음 |
| 사이트 목록 | 사이트 목록 자체에 변경 없음 |
| Manta 순위 | 심층 검색은 site: 제한 검색이므로 순위에 영향 없음 |
| 정기 파이프라인 | 기존 run-pipeline.ts에 변경 없음 |

### 7.3 통계 반영 방식

- **세션 상세**: `detection_results` 테이블 쿼리 시 `source` 컬럼으로 정기/심층 결과 구분 가능
- **대시보드**: 기존 CTE 쿼리가 detection_results 전체를 집계하므로 자동 포함
- **월별 통계**: 세션 통계 업데이트 시 새로운 합계가 반영됨
- **신고결과 추적**: 불법 URL은 report_tracking에 자동 등록됨

---

## 8. 제약 사항 및 주의 사항

### 8.1 API 호출량 관리
- 심층 검색은 대상당 3페이지 = **3 API 호출** (Serper.dev)
- 대상 10개 시 추가 30 API 호출
- Serper.dev API 일일 제한에 주의

### 8.2 중복 방지
- `detection_results`의 `UNIQUE(session_id, url)` 제약으로 URL 중복 자동 방지
- `deep_monitoring_targets`의 `UNIQUE(session_id, title, domain)` 제약으로 대상 중복 방지

### 8.3 LLM 판별 최적화
- 심층 검색 대상 도메인은 이미 `illegal` 확정이므로 해당 도메인 결과는 LLM 판별 skip
- 다른 도메인 결과가 나올 수 있으므로 완전히 건너뛰지는 않음

### 8.4 동시 실행 방지
- 동일 세션에 대해 심층 모니터링이 이미 실행 중이면 추가 실행을 차단
- 메모리 기반 상태(`deepMonitoringStatus`)로 관리

---

## 9. 설정 값

| 설정 | 기본값 | 설명 |
|------|-------|------|
| `threshold` | 5 | 심층 모니터링 대상 판정 임계치 (URL 수) |
| `deep_max_pages` | 3 | 심층 검색 시 최대 페이지 수 |
| `deep_results_per_page` | 10 | 심층 검색 시 페이지당 결과 수 |

이 값들은 `data/config.json`에 추가하거나, API 호출 시 파라미터로 전달 가능하도록 설계한다.
