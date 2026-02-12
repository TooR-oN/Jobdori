# 도메인별 신고/차단 통계 + 월간 불법 도메인 분석 설계서

**문서 버전**: v1.1
**작성일**: 2026-02-12
**기능명**: 
1. 도메인별 신고/차단 통계 (Domain Report/Block Statistics)
2. 월간 불법 도메인 분석 (Monthly Illegal Domain Analysis)

---

## 기능 1: 도메인별 신고/차단 통계

### 1.1 목적

기존 작품별 신고/차단 통계와 동일한 형태로, **불법 사이트 도메인 기준**의 통계를 제공한다.
어떤 불법 사이트에서 가장 많은 URL이 발견되고, 신고·차단이 이루어지고 있는지를 한눈에 파악한다.

### 1.2 메뉴 구조 변경

**변경 전:**
```
작품별 통계
  ├── 신고/차단 통계
  └── Manta 순위 변화
```

**변경 후:**
```
통계
  ├── 작품별 신고/차단 통계    (기존, 경로 유지: /stats)
  ├── 도메인별 신고/차단 통계  (신규: /stats/domain)
  └── Manta 순위 변화          (기존, 경로 유지: /stats/manta-rankings)
```

### 1.3 UI 설계

기존 작품별 통계 페이지(`/stats`)와 동일한 레이아웃이되, 다음 차이가 있다:

| 항목 | 작품별 통계 | 도메인별 통계 |
|------|-----------|-------------|
| **상단 요약 카드** | 있음 (총 작품, 총 발견, 총 신고, 총 차단, 평균 차단율) | **없음** |
| **날짜 필터 기본값** | 없음 (전체 기간) | **당월 기본** (접속일 기준 YYYY-MM-01 ~ YYYY-MM-DD) |
| **테이블 1열** | 순위 | 순위 |
| **테이블 2열** | 작품명 | **도메인** |
| **테이블 3열** | 발견 ↓ | 발견 ↓ |
| **테이블 4열** | 신고 | 신고 |
| **테이블 5열** | 차단 | 차단 |
| **테이블 6열** | 차단율 | 차단율 |

### 1.4 백엔드 API

**`GET /api/stats/by-domain`**

기존 `/api/stats/by-title`과 동일한 구조이되, `GROUP BY domain` 기준으로 집계한다.

**Request:**
```
GET /api/stats/by-domain?start_date=2026-02-01&end_date=2026-02-12
```

**Response:**
```json
{
  "success": true,
  "stats": [
    {
      "domain": "mangadex.net",
      "discovered": 142,
      "reported": 130,
      "blocked": 125,
      "blockRate": 96.2
    }
  ],
  "total": 45
}
```

**SQL 쿼리 (핵심):**
```sql
WITH detection_stats AS (
  SELECT domain, COUNT(*) as discovered
  FROM detection_results
  WHERE final_status = 'illegal'
    AND SUBSTRING(session_id, 1, 10) >= {startDate}
    AND SUBSTRING(session_id, 1, 10) <= {endDate}
  GROUP BY domain
),
report_stats AS (
  SELECT 
    domain,
    COUNT(*) FILTER (WHERE report_status != '미신고') as reported,
    COUNT(*) FILTER (WHERE report_status = '차단') as blocked
  FROM report_tracking
  WHERE SUBSTRING(session_id, 1, 10) >= {startDate}
    AND SUBSTRING(session_id, 1, 10) <= {endDate}
  GROUP BY domain
)
SELECT 
  d.domain,
  d.discovered,
  COALESCE(r.reported, 0) as reported,
  COALESCE(r.blocked, 0) as blocked
FROM detection_stats d
LEFT JOIN report_stats r ON LOWER(d.domain) = LOWER(r.domain)
ORDER BY d.discovered DESC
```

### 1.5 기존 기능 영향

| 컴포넌트 | 영향 |
|---------|------|
| 사이드바 (Sidebar.tsx) | 메뉴명 변경 + 하위 메뉴 추가 |
| 기존 작품별 통계 페이지 | **변경 없음** (경로 `/stats` 유지) |
| Manta 순위 변화 페이지 | **변경 없음** |
| 기타 모든 페이지 | **영향 없음** |

---

## 기능 2: 월간 불법 도메인 분석

### 2.1 목적

기능 1에서 집계된 도메인별 통계의 **상위 50개 도메인**에 대해, Manus AI를 통해 SimilarWeb/Semrush 트래픽 데이터를 수집하고, **위협 점수(Threat Score)**를 산출하여 **대응 우선순위**를 결정한다.

### 2.2 메뉴 구조

사이드바에 **최상위 메뉴**로 추가:

```
통계
  ├── 작품별 신고/차단 통계
  ├── 도메인별 신고/차단 통계
  └── Manta 순위 변화
월간 불법 도메인 분석           ← 신규 최상위 메뉴
  (경로: /domain-analysis)
```

### 2.3 전체 데이터 흐름

```
[Step 1] 매월 자동 or 수동 트리거
    ↓
[Step 2] 도메인별 신고/차단 통계 API에서 상위 50개 도메인 조회
    ↓
[Step 3] Manus AI Task 생성
    - 프로젝트: TvfU37uAeUph4R3YLzR2LV (Jobdori-웹툰 해적사이트 트래픽 분석)
    - 프롬프트: 50개 도메인 URL 리스트 + (있으면) 전월 데이터
    ↓
[Step 4] Manus Task 완료 대기 (폴링)
    - Manus가 SimilarWeb/Semrush에서 데이터 수집
    - 위협 점수 산출 및 우선순위 결정
    ↓
[Step 5] Manus 응답 파싱
    - priority_list (JSON): 50개 사이트 순위 + 트래픽 데이터
    - report (Markdown): 종합 분석 보고서
    ↓
[Step 6] DB 저장
    - domain_analysis_reports 테이블: 월별 분석 메타데이터
    - domain_analysis_results 테이블: 도메인별 상세 데이터
    - 보고서 마크다운: Vercel Blob에 저장 (DB에는 URL만 저장)
    ↓
[Step 7] 프론트엔드에서 월별 드롭다운으로 열람
```

### 2.4 SimilarWeb 데이터 업데이트 주기 및 자동 실행

SimilarWeb 공식 FAQ에 의하면:
> "Our monthly data is released by the **10th of the following month**."

따라서:
- **자동 실행 일자**: 매월 **11일** (10일에 데이터 업데이트 후 1일 여유)
- **데이터 준비 확인 로직**: Manus에게 태스크를 보낼 때, 프롬프트에 "최신 월간 데이터가 아직 업데이트되지 않았다면 그 사실을 명시하고, 가능한 최신 데이터를 사용하라"는 지시를 포함한다.
- **최초 실행**: 수동으로 실행 (UI에서 "분석 실행" 버튼)

### 2.5 DB 스키마

#### 신규 테이블 1: `domain_analysis_reports` (월별 분석 리포트)

```sql
CREATE TABLE IF NOT EXISTS domain_analysis_reports (
  id SERIAL PRIMARY KEY,
  analysis_month VARCHAR(7) NOT NULL,           -- '2026-02' 형식
  status VARCHAR(20) DEFAULT 'pending',         -- pending | running | completed | failed
  manus_task_id VARCHAR(100),                   -- Manus Task ID
  total_domains INTEGER DEFAULT 0,              -- 분석 대상 도메인 수
  report_blob_url TEXT,                         -- Vercel Blob에 저장된 마크다운 보고서 URL
  report_markdown TEXT,                         -- 보고서 마크다운 원본 (Blob 실패 시 백업)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,                           -- 실패 시 에러 메시지
  UNIQUE(analysis_month)                        -- 월별 1건만 허용
);
```

#### 신규 테이블 2: `domain_analysis_results` (도메인별 상세 데이터)

```sql
CREATE TABLE IF NOT EXISTS domain_analysis_results (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES domain_analysis_reports(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,                        -- 대응 우선순위 (1~50)
  domain VARCHAR(255) NOT NULL,                 -- 사이트 URL/도메인
  threat_score DECIMAL(5,1) DEFAULT 0,          -- 위협 점수 (0~100)
  
  -- SimilarWeb 데이터
  global_rank INTEGER,                          -- 글로벌 순위
  country_rank INTEGER,                         -- 국가별 순위
  total_visits BIGINT,                          -- 총 방문수
  avg_visit_duration VARCHAR(20),               -- 평균 방문 시간 (예: "00:03:45")
  visits_change_mom DECIMAL(5,1),               -- 방문수 전월 대비 변화율 (%)
  rank_change_mom INTEGER,                      -- 순위 전월 대비 변화
  
  -- SimilarWeb 추가 데이터
  country VARCHAR(100),                         -- 주요 트래픽 국가
  category VARCHAR(255),                        -- 사이트 카테고리
  category_rank INTEGER,                        -- 카테고리 내 순위
  
  -- Semrush 데이터
  total_backlinks BIGINT,                       -- 총 백링크 수
  referring_domains INTEGER,                    -- 참조 도메인 수
  top_organic_keywords TEXT,                     -- 상위 5개 오가닉 키워드 (JSON 배열)
  top_referring_domains TEXT,                   -- 상위 5개 참조 도메인 (JSON 배열)
  top_anchors TEXT,                             -- 상위 5개 앵커 텍스트 (JSON 배열)
  branded_traffic_ratio DECIMAL(5,1),           -- 브랜드 검색 트래픽 비율 (%)
  
  -- 위협 점수 세부
  size_score DECIMAL(5,1),                      -- 규모 점수 (40%)
  growth_score DECIMAL(5,1),                    -- 성장성 점수 (40%)
  influence_score DECIMAL(5,1),                 -- 영향력 점수 (20%)
  
  -- Manus 제언
  recommendation TEXT,                          -- AI 제언 텍스트
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(report_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_domain_analysis_results_report
  ON domain_analysis_results(report_id, rank);
```

### 2.6 보고서 저장 방식 결정

**결론: Vercel Blob에 마크다운 파일로 저장 (DB에 URL만 저장)**

| 방식 | 장점 | 단점 |
|------|------|------|
| Neon DB TEXT 컬럼 | 단일 쿼리로 조회 | 50개 사이트 상세 보고서 = 수십KB~수백KB, DB 부담 |
| **Vercel Blob** ← 채택 | DB 부담 없음, CDN 캐싱으로 빠른 로딩, 기존 인프라 재사용 | 별도 fetch 필요 |

- `report_markdown` 컬럼은 Blob 업로드 실패 시 백업용으로 유지
- 정상적인 경우 `report_blob_url`로 프론트에서 직접 fetch하여 렌더링

### 2.7 API 설계

#### 2.7.1 분석 실행 API

**`POST /api/domain-analysis/run`**

수동 또는 자동 트리거로 월간 분석을 시작한다.

**Request:**
```json
{
  "month": "2026-02"     // 대상 월 (선택, 기본값: 현재 월)
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "report_id": 1,
    "analysis_month": "2026-02",
    "status": "running",
    "manus_task_id": "task_abc123",
    "total_domains": 50
  }
}
```

**에러 (409):**
```json
{
  "success": false,
  "error": "이미 해당 월의 분석이 실행 중입니다."
}
```

#### 2.7.2 분석 상태 조회 API

**`GET /api/domain-analysis/status/:month`**

Manus Task 진행 상태를 확인한다.

**Response:**
```json
{
  "success": true,
  "data": {
    "report_id": 1,
    "analysis_month": "2026-02",
    "status": "running",
    "manus_task_id": "task_abc123",
    "manus_status": "running"
  }
}
```

#### 2.7.3 분석 결과 조회 API

**`GET /api/domain-analysis/:month`**

완료된 분석 결과를 조회한다.

**Response:**
```json
{
  "success": true,
  "data": {
    "report": {
      "id": 1,
      "analysis_month": "2026-02",
      "status": "completed",
      "total_domains": 50,
      "report_blob_url": "https://blob.vercel.com/...",
      "completed_at": "2026-02-12T10:30:00Z"
    },
    "results": [
      {
        "rank": 1,
        "domain": "mangadex.net",
        "threat_score": 95.0,
        "global_rank": 1234,
        "country_rank": 567,
        "total_visits": 45000000,
        "avg_visit_duration": "00:03:45",
        "visits_change_mom": 12.5,
        "rank_change_mom": -20,
        "total_backlinks": 150000,
        "referring_domains": 8500,
        "top_organic_keyword": "read manga online",
        "size_score": 38.0,
        "growth_score": 35.0,
        "influence_score": 18.0,
        "recommendation": "최우선 대응 대상. 트래픽 급증세이며..."
      }
    ]
  }
}
```

#### 2.7.4 사용 가능한 월 목록 조회 API

**`GET /api/domain-analysis/months`**

드롭다운에 표시할 월 목록을 반환한다.

**Response:**
```json
{
  "success": true,
  "months": ["2026-02", "2026-01"]
}
```

#### 2.7.5 보고서 재실행 API

**`POST /api/domain-analysis/rerun`**

실패했거나 업데이트가 필요한 경우 재실행한다.

**Request:**
```json
{
  "month": "2026-02"
}
```

### 2.8 Manus 연동 상세

#### 프롬프트 구성

```
다음 {N}개 웹툰 해적사이트의 최신 월간 데이터를 분석해주세요.

## 분석 대상 사이트
{도메인 리스트 (줄바꿈 구분)}

## 전월 데이터
{있으면 JSON 형태로 전달, 없으면 "첫 분석이므로 전월 데이터 없음"}

## 주의사항
- SimilarWeb의 최신 월간 데이터가 아직 업데이트되지 않았다면, 그 사실을 보고서에 명시하고 가능한 최신 데이터를 사용하세요.
- 반드시 프로젝트 지침에 정의된 모든 데이터 포인트를 수집하세요.
- priority_list JSON과 report Markdown 두 개의 산출물을 생성하세요.
```

#### Manus 응답 파싱

Manus의 `output` 메시지에서:
1. **JSON 파일/텍스트**: `priority_list` → `domain_analysis_results` 테이블에 저장
2. **Markdown 파일/텍스트**: `report` → Vercel Blob에 업로드, URL을 DB에 저장

기존 `llm-judge.ts`의 `waitForManusTask()`와 동일한 폴링 패턴을 재사용하되:
- **타임아웃 연장**: 50개 사이트 분석은 시간이 오래 걸릴 수 있으므로 **최대 30분** (기존 5분에서 확장)
- **Vercel Serverless 30초 제한 대응**: 
  - API에서 Task 생성만 하고 즉시 응답 반환
  - 프론트엔드에서 polling으로 상태 확인
  - Task 완료 시 별도 API로 결과 파싱/저장 트리거

### 2.9 프론트엔드 UI 설계

#### 페이지 레이아웃: `/domain-analysis`

```
┌─────────────────────────────────────────────────────────┐
│ 월간 불법 도메인 분석                                      │
│                                                          │
│ ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│ │ 2026년 2월 ▼ │  │📊 분석 실행 │  │📄 보고서 보기    │ │
│ └──────────────┘  └─────────────┘  └──────────────────┘ │
│                                    ┌──────────────────┐ │
│                                    │⬇️ 보고서 다운로드 │ │
│                                    └──────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 📋 대응 우선순위 테이블 (50개 사이트)                  │ │
│ │                                                      │ │
│ │ 순위 | 도메인 | 위협점수 | 글로벌순위 | 방문수 |      │ │
│ │      |        |         | 성장성(%) | 백링크 |       │ │
│ │      |        |         | 핵심키워드 | 제언  |       │ │
│ │ ──── | ────── | ─────── | ───────── | ──── |        │ │
│ │  1   | manga..| 95.0    | #1,234    | 45M  |        │ │
│ │  2   | xbato..| 88.0    | #2,456    | 32M  |        │ │
│ │  ... | ...    | ...     | ...       | ...  |        │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 📝 보고서 (Markdown 렌더링)                           │ │
│ │ (보고서 보기 클릭 시 펼침 또는 모달)                   │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### 상태별 UI 흐름

```
[데이터 없음] → "아직 분석이 실행되지 않았습니다" + "분석 실행" 버튼
[실행 중]     → 진행 상태 표시 (Manus Task 상태 폴링)
[완료]        → 테이블 + 보고서 보기 + 다운로드
[실패]        → 에러 메시지 + "재실행" 버튼
```

#### 테이블 컬럼 상세

| 컬럼명 | 데이터 | 정렬 |
|--------|--------|------|
| 순위 | rank (1~50) | 기본 정렬 |
| 도메인 | domain | 가능 |
| 위협 점수 | threat_score (0~100) | 가능 |
| 글로벌 순위 | global_rank (#1,234 형식) | 가능 |
| 월간 방문수 | total_visits (45M 형식) | 가능 |
| 방문자 증감 | visits_change_mom (+12.5% 형식, 양수=빨강, 음수=초록) | 가능 |
| 순위 변동 | rank_change_mom (▲20 ▼5 형식) | 가능 |
| 국가 | country | - |
| 국가 순위 | country_rank | 가능 |
| 카테고리 | category | - |
| 카테고리 순위 | category_rank | 가능 |
| 평균 체류시간 | avg_visit_duration | - |
| 백링크 | total_backlinks | 가능 |
| 참조 도메인 | referring_domains | 가능 |
| 핵심 키워드 | top_organic_keyword | - |
| 상위 참조 도메인 | top_referring_domains (JSON 배열, top 5) | - |
| 상위 앵커 텍스트 | top_anchors (JSON 배열, top 5) | - |
| 브랜드 트래픽 비율 | branded_traffic_ratio (%) | 가능 |
| 제언 | recommendation (말줄임 + hover 전체 표시) | - |

### 2.10 자동 실행 구현

#### 방안: 기존 파이프라인에 월간 분석 트리거 추가

- `backend/scripts/run-pipeline.ts`에 "매월 11일" 체크 로직 추가
- 또는 별도 스크립트 `backend/scripts/monthly-domain-analysis.ts` 생성
- 실행 조건: 해당 월의 분석이 아직 없고, 현재 날짜가 11일 이후

```typescript
// 매일 파이프라인 실행 시 체크
const today = new Date();
const dayOfMonth = today.getDate();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

if (dayOfMonth >= 11) {
  const existingReport = await getReportByMonth(currentMonth);
  if (!existingReport) {
    console.log(`📊 ${currentMonth} 월간 도메인 분석 자동 실행`);
    await runDomainAnalysis(currentMonth);
  }
}
```

#### SimilarWeb 데이터 준비 확인 방안

Manus 프롬프트에 다음을 추가하여 Manus가 판단하도록 한다:

```
## 데이터 준비 확인
SimilarWeb에서 {target_month}월 데이터를 조회하세요.
- 만약 {target_month}월 데이터가 아직 없다면, 보고서 상단에 
  "⚠️ {target_month}월 데이터가 아직 업데이트되지 않았습니다. 
  {previous_month}월 데이터를 기준으로 분석합니다."라고 명시하세요.
- 데이터 기준월을 보고서에 반드시 명시하세요.
```

또한 Manus 응답의 priority_list JSON에 `data_month` 필드를 포함시켜, 실제 어떤 월의 데이터로 분석되었는지를 DB에 기록한다.

---

## 3. 기존 기능 영향 분석

### 3.1 영향받는 컴포넌트

| 컴포넌트 | 변경 내용 |
|---------|----------|
| Sidebar.tsx | 메뉴명 변경 ("작품별 통계" → "통계") + 하위 메뉴 추가 + "월간 불법 도메인 분석" 최상위 메뉴 추가 |
| MobileMenu.tsx | 동일한 메뉴 변경 반영 |
| api.ts (프론트) | statsApi에 byDomain 추가 + domainAnalysisApi 추가 |
| api/index.ts (백엔드) | 6개 API 엔드포인트 추가 |

### 3.2 영향받지 않는 컴포넌트

| 컴포넌트 | 이유 |
|---------|------|
| 기존 작품별 통계 페이지 | 경로/코드 변경 없음 |
| Manta 순위 변화 페이지 | 변경 없음 |
| 대시보드, 세션, 신고추적 등 | 변경 없음 |
| 정기 모니터링 파이프라인 | 변경 없음 (자동 실행 트리거만 추가) |

---

## 4. 환경 변수

| 변수 | 용도 | 비고 |
|------|------|------|
| `MANUS_API_KEY` | Manus AI API 키 | 기존 사용 중 |
| `MANUS_TRAFFIC_PROJECT_ID` | 트래픽 분석용 Manus 프로젝트 ID | 신규: `TvfU37uAeUph4R3YLzR2LV` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 토큰 | 기존 사용 중 |

---

## 5. 설정 값

| 설정 | 기본값 | 설명 |
|------|-------|------|
| 도메인 분석 대상 수 | 50 | 발견 수 기준 상위 N개 불법 도메인 |
| Manus Task 타임아웃 | 30분 | 50개 사이트 분석 최대 대기 시간 |
| 자동 실행일 | 매월 11일 | SimilarWeb 데이터 업데이트(10일까지) 이후 |
| 폴링 간격 | 15초 | Manus Task 상태 확인 주기 |
