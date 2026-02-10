# Jobdori 개발일지 (2026.02.10 Update)

## 1. 프로젝트 개요

**Jobdori(잡도리)** 는 RIDI(리디)의 웹툰/웹소설 콘텐츠가 불법 유통되는 사이트를 자동으로 탐지하고, 신고 결과를 추적하는 내부 모니터링 시스템입니다.

### 핵심 기능
1. **자동 불법 사이트 탐지**: 작품명 + 키워드 조합으로 Google 검색(Serper API) → 불법/합법 판별
2. **LLM 2차 판별**: 판별 불확실한 도메인은 Manus AI로 2차 분석
3. **사이트 집중 모니터링**: 특정 도메인에 대해 심층 검색 → 추가 불법 URL 수집
4. **신고 결과 추적**: 발견된 불법 URL의 신고 상태(미신고/신고완료/차단완료) 관리
5. **Manta 순위 추적**: 작품별 Google 검색 순위에서 공식 사이트(manta.net) 위치 변화 추적
6. **대시보드**: 월별 통계, Top 5 작품/도메인, 신고율/차단율 시각화

---

## 2. 기술 스택

### 모노레포 구조
```
jobdori-monorepo/
├── backend/          # Hono API 서버 (Vercel Serverless)
├── frontend/         # Next.js 14 (Vercel)
├── shared/           # 공유 TypeScript 타입
├── package.json      # Yarn/NPM Workspaces
└── docs/             # 문서
```

### 백엔드 (`@jobdori/backend`)
| 항목 | 기술 |
|------|------|
| 프레임워크 | **Hono** v4.11 (경량 TypeScript 웹 프레임워크) |
| 런타임 | **Vercel Serverless Functions** (maxDuration: 30초) |
| 데이터베이스 | **Neon PostgreSQL** (Serverless Postgres) |
| 파일 저장소 | **Vercel Blob** (검색 결과 JSON) |
| 검색 API | **Serper.dev** (Google Search API) |
| LLM 판별 | **Manus AI** (도메인 불법 여부 판별) |
| 빌드 | **Vite** + `@hono/vite-build` |
| 언어 | **TypeScript** 5.9 |
| 인증 | **bcryptjs** (비밀번호 해싱) + 세션 토큰 (서명된 쿠키) |

### 프론트엔드 (`@jobdori/frontend`)
| 항목 | 기술 |
|------|------|
| 프레임워크 | **Next.js** 14.2 (App Router) |
| UI | **React** 18 + **Tailwind CSS** 3.4 |
| 차트 | **Chart.js** 4.4 + **react-chartjs-2** |
| HTTP 클라이언트 | **Axios** |
| 상태관리 | **React Query** (TanStack Query v5) |
| 아이콘 | **Heroicons** v2 |
| 배포 | **Vercel** (Next.js 네이티브) |

### 외부 서비스
| 서비스 | 용도 | 환경변수 |
|--------|------|----------|
| Neon PostgreSQL | 메인 DB | `DATABASE_URL` |
| Vercel Blob | 검색 결과 JSON 저장 | `BLOB_READ_WRITE_TOKEN` |
| Serper.dev | Google 검색 API | `SERPER_API_KEY` |
| Manus AI | LLM 도메인 판별 | `MANUS_API_KEY` |
| Vercel | 프론트/백엔드 호스팅 | `SESSION_SECRET` |

---

## 3. 데이터베이스 스키마 (Neon PostgreSQL)

### 3.1 sessions (모니터링 세션)
모니터링 실행 단위. CLI 파이프라인 또는 수동 실행으로 생성.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | VARCHAR(50) PK | 세션 ID (타임스탬프 기반) |
| `created_at` | TIMESTAMPTZ | 생성 시간 |
| `completed_at` | TIMESTAMPTZ | 완료 시간 |
| `status` | VARCHAR(20) | 상태: `running`, `completed`, `error` |
| `titles_count` | INTEGER | 검색 대상 작품 수 |
| `keywords_count` | INTEGER | 검색 키워드 수 |
| `total_searches` | INTEGER | 총 검색 횟수 |
| `results_total` | INTEGER | 전체 결과 수 |
| `results_illegal` | INTEGER | 불법 판정 수 |
| `results_legal` | INTEGER | 합법 판정 수 |
| `results_pending` | INTEGER | 보류 판정 수 |
| `file_final_results` | VARCHAR(500) | Vercel Blob URL (결과 JSON) |
| `deep_monitoring_executed` | BOOLEAN | 집중 모니터링 실행 여부 |
| `deep_monitoring_targets_count` | INTEGER | 집중 모니터링 대상 수 |
| `deep_monitoring_new_urls` | INTEGER | 집중 모니터링으로 발견된 신규 URL 수 |

### 3.2 detection_results (탐지 결과)
세션별 검색 결과. 각 URL의 판별 상태를 저장.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `session_id` | VARCHAR(50) | 세션 ID (FK) |
| `title` | TEXT | 작품명 |
| `url` | TEXT | 탐지된 URL |
| `domain` | VARCHAR(255) | 도메인 |
| `search_query` | TEXT | 사용된 검색어 |
| `page` | INTEGER | 검색 결과 페이지 |
| `rank` | INTEGER | 검색 결과 순위 |
| `initial_status` | VARCHAR(20) | 1차 판별: `illegal`, `legal`, `unknown` |
| `llm_judgment` | VARCHAR(30) | LLM 판별: `likely_illegal`, `likely_legal`, `uncertain` |
| `llm_reason` | TEXT | LLM 판별 근거 |
| `final_status` | VARCHAR(20) | 최종 상태: `illegal`, `legal`, `pending` |
| `reviewed_at` | TIMESTAMPTZ | 판별 시간 |
| `snippet` | TEXT | 검색 결과 스니펫 |
| `source` | VARCHAR(20) | 출처: `regular` (기본), `deep` (집중 모니터링) |
| `deep_target_id` | INTEGER | 집중 모니터링 대상 ID (FK) |
| UNIQUE | | `(session_id, url)` |

### 3.3 titles (모니터링 작품)
모니터링 대상 작품 목록.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `name` | VARCHAR(500) UNIQUE | 공식 작품명 |
| `is_current` | BOOLEAN | 현재 모니터링 대상 여부 |
| `manta_url` | TEXT | Manta 공식 페이지 URL |
| `unofficial_titles` | JSONB/TEXT | 비공식 타이틀 배열 (최대 5개) |
| `created_at` | TIMESTAMPTZ | 등록 시간 |

### 3.4 sites (사이트 목록)
불법/합법 도메인 리스트. 1차 판별의 기준 데이터.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `domain` | VARCHAR(255) | 도메인명 |
| `type` | VARCHAR(10) | `illegal` 또는 `legal` |
| `created_at` | TIMESTAMPTZ | 등록 시간 |
| UNIQUE | | `(domain, type)` |

### 3.5 report_tracking (신고 결과 추적)
발견된 불법 URL의 신고 상태 관리.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `session_id` | VARCHAR(50) | 세션 ID |
| `url` | TEXT | 불법 URL |
| `domain` | VARCHAR(255) | 도메인 |
| `title` | TEXT | 작품명 |
| `report_status` | VARCHAR(20) | 신고 상태: `미신고`, `신고완료`, `차단완료` |
| `report_id` | VARCHAR(50) | 신고 ID (정부 시스템) |
| `reason` | TEXT | 미신고 사유 (예: '웹사이트 메인 페이지') |
| `created_at` | TIMESTAMPTZ | 등록 시간 |
| `updated_at` | TIMESTAMPTZ | 수정 시간 |
| UNIQUE | | `(session_id, url)` |

### 3.6 report_uploads (신고결과 업로드 이력)
HTML 파일 업로드로 신고 ID를 자동 매칭한 이력.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `session_id` | VARCHAR(50) | 세션 ID |
| `report_id` | VARCHAR(50) | 추출된 신고 ID |
| `file_name` | VARCHAR(255) | 업로드 파일명 |
| `matched_count` | INTEGER | 매칭된 URL 수 |
| `total_urls_in_html` | INTEGER | HTML 내 전체 URL 수 |
| `uploaded_at` | TIMESTAMPTZ | 업로드 시간 |

### 3.7 report_reasons (미신고 사유)
미신고 사유 자동완성 목록.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `reason_text` | VARCHAR(255) UNIQUE | 사유 텍스트 |
| `usage_count` | INTEGER | 사용 횟수 (자동완성 정렬용) |
| `created_at` | TIMESTAMPTZ | 등록 시간 |

### 3.8 deep_monitoring_targets (집중 모니터링 대상)
세션 내 특정 도메인에 대한 심층 검색 대상.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `session_id` | VARCHAR(50) | 세션 ID |
| `title` | TEXT | 작품명 |
| `domain` | VARCHAR(255) | 대상 도메인 |
| `url_count` | INTEGER | 기존 발견 URL 수 |
| `base_keyword` | TEXT | 기반 키워드 |
| `deep_query` | TEXT | 심층 검색 쿼리 (예: `"작품명 manga site:domain.com"`) |
| `status` | VARCHAR(20) | `pending`, `running`, `completed`, `failed` |
| `results_count` | INTEGER | 검색 결과 수 |
| `new_urls_count` | INTEGER | 신규 URL 수 |
| `executed_at` | TIMESTAMPTZ | 실행 시작 시간 |
| `completed_at` | TIMESTAMPTZ | 완료 시간 |
| UNIQUE | | `(session_id, title, domain)` |

### 3.9 excluded_urls (신고 제외 URL)
신고에서 제외할 URL 목록 (예: 메인 페이지).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `url` | TEXT UNIQUE | 제외 URL |
| `created_at` | TIMESTAMPTZ | 등록 시간 |

### 3.10 pending_reviews (승인 대기)
LLM 판별에서 `uncertain`으로 나온 도메인의 관리자 승인 대기.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `domain` | VARCHAR(255) UNIQUE | 도메인 |
| `urls` | JSONB | 관련 URL 목록 |
| `titles` | JSONB | 관련 작품 목록 |
| `llm_judgment` | VARCHAR(20) | LLM 판별 결과 |
| `llm_reason` | TEXT | LLM 판별 근거 |
| `session_id` | VARCHAR(50) | 세션 ID |
| `created_at` | TIMESTAMPTZ | 등록 시간 |

### 3.11 manta_rankings (Manta 순위)
작품별 Google 검색 순위에서 manta.net의 위치.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `title` | VARCHAR(500) UNIQUE | 작품명 |
| `manta_rank` | INTEGER | manta.net 순위 (null = 순위권 외) |
| `first_rank_domain` | VARCHAR(255) | 검색 1위 도메인 |
| `search_query` | VARCHAR(500) | 검색 쿼리 |
| `page1_illegal_count` | INTEGER | 1페이지 내 불법 사이트 수 |
| `session_id` | VARCHAR(50) | 세션 ID |
| `updated_at` | TIMESTAMPTZ | 업데이트 시간 |

### 3.12 users (사용자)
시스템 사용자 계정.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | SERIAL PK | 자동 증가 ID |
| `username` | VARCHAR(100) UNIQUE | 사용자명 |
| `password_hash` | TEXT | bcrypt 해시 |
| `role` | VARCHAR(20) | `superadmin`, `admin`, `user` |
| `is_active` | BOOLEAN | 활성 상태 |
| `created_at` | TIMESTAMPTZ | 생성 시간 |
| `updated_at` | TIMESTAMPTZ | 수정 시간 |

---

## 4. Vercel Blob (파일 저장소)

검색 결과 JSON 파일을 Blob에 저장합니다.

| 경로 패턴 | 내용 | 접근 |
|-----------|------|------|
| `results/{sessionId}/final-results.json` | 세션의 최종 검색 결과 배열 | public |

### Blob JSON 구조 (`FinalResult[]`)
```typescript
interface FinalResult {
  title: string          // 작품명
  domain: string         // 도메인
  url: string            // URL
  search_query: string   // 검색어
  page: number           // 검색 페이지
  rank: number           // 검색 순위
  status: 'illegal' | 'legal' | 'unknown'  // 1차 판별
  llm_judgment: string | null               // LLM 판별
  llm_reason: string | null                 // LLM 근거
  final_status: 'illegal' | 'legal' | 'pending'  // 최종 상태
  reviewed_at: string | null                // 판별 시간
}
```

> **중요**: `GET /api/sessions/:id/results` API는 **Blob에서 결과를 읽습니다**. DB(`detection_results`)가 아닌 Blob이 프론트엔드 결과 표시의 데이터 소스입니다. 집중 모니터링 결과는 finalize API에서 Blob에 병합됩니다.

---

## 5. API 엔드포인트 전체 목록

### 5.1 인증 API

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/api/auth/login` | 로그인 (username + password) | 불필요 |
| POST | `/api/auth/logout` | 로그아웃 (쿠키 삭제) | 불필요 |
| GET | `/api/auth/status` | 인증 상태 확인 | 불필요 |

### 5.2 사용자 관리 API (superadmin 전용)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/users` | 사용자 목록 |
| POST | `/api/users` | 사용자 생성 |
| PUT | `/api/users/:id` | 사용자 수정 (비밀번호/역할/활성) |
| DELETE | `/api/users/:id` | 사용자 삭제 |

### 5.3 대시보드 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/dashboard/months` | 사용 가능한 월 목록 |
| GET | `/api/dashboard` | 월간 대시보드 통계 |
| GET | `/api/dashboard/all-titles` | 전체 작품 목록 (대시보드용) |

**`GET /api/dashboard` 데이터 흐름:**
1. `month` 쿼리 파라미터로 해당 월 세션 필터링 (예: `2026-02`)
2. `sessions` 테이블에서 해당 월의 completed 세션 수, 최종 업데이트 시간 집계
3. `detection_results`에서 해당 월의 전체/불법/합법/보류 건수 집계
4. `report_tracking`에서 해당 월의 발견 건수(`discovered`), 신고 건수(`reported`), 차단 건수(`blocked`) 집계
5. Top 5 작품: `report_tracking`에서 **신고 건수 기준** 상위 5개 작품 (→ `top_contents`)
6. Top 5 불법 사이트: `report_tracking`에서 **도메인별 신고 건수 기준** 상위 5개 도메인 (→ `top_illegal_sites`)
7. Manta 순위 데이터: `manta_rankings` + `manta_ranking_history` 조회

### 5.4 작품 관리 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/titles` | 작품 목록 (현재/과거 분리) |
| POST | `/api/titles` | 작품 추가 |
| DELETE | `/api/titles/:title` | 작품 삭제 (is_current=false) |
| POST | `/api/titles/restore` | 삭제된 작품 복원 |
| PUT | `/api/titles/:title/unofficial` | 비공식 타이틀 수정 (최대 5개) |
| GET | `/api/titles/list` | 작품 이름 목록 (단순) |

### 5.5 승인 대기 API (admin 전용)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/pending` | 승인 대기 도메인 목록 |
| POST | `/api/review` | 단건 승인/거부 |
| POST | `/api/review/bulk` | 일괄 승인/거부 |

**승인 흐름:**
- `approve` → 해당 도메인을 `sites` 테이블에 `illegal`로 추가, 해당 세션의 Blob에서 `pending` → `illegal` 업데이트
- `reject` → 해당 도메인을 `sites` 테이블에 `legal`로 추가

### 5.6 사이트 목록 API (admin 전용)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/sites/:type` | 사이트 목록 (illegal/legal) |
| POST | `/api/sites/:type` | 사이트 추가 |
| DELETE | `/api/sites/:type/:domain` | 사이트 삭제 |

### 5.7 신고 제외 URL API (admin 전용)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/excluded-urls` | 제외 URL 목록 |
| POST | `/api/excluded-urls` | 제외 URL 추가 |
| DELETE | `/api/excluded-urls/:id` | 제외 URL 삭제 |

### 5.8 세션 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/sessions` | 세션 목록 (최신순) |
| GET | `/api/sessions/:id` | 세션 상세 |
| GET | `/api/sessions/:id/results` | 세션 결과 (Blob에서 읽음, 필터/페이지네이션 지원) |
| GET | `/api/sessions/:id/download` | 세션 결과 Excel 다운로드 |

**`GET /api/sessions/:id/results` 데이터 흐름:**
1. `sessions` 테이블에서 `file_final_results` (Blob URL) 가져오기
2. **Blob에서 JSON 다운로드** → `FinalResult[]`
3. `recalculateFinalStatus()`: 현재 `sites` 테이블 기준으로 `final_status` 실시간 재계산
4. URL 중복 제거
5. 필터 적용 (작품, 상태)
6. 페이지네이션 적용 → 프론트엔드로 반환

### 5.9 사이트 집중 모니터링 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/sessions/:id/deep-monitoring/scan` | 대상 검색 (detection_results 분석) |
| POST | `/api/sessions/:id/deep-monitoring/execute-target/:targetId` | **대상 1건 실행** |
| POST | `/api/sessions/:id/deep-monitoring/finalize` | 후처리 (Blob 병합 + 통계 갱신) |
| GET | `/api/sessions/:id/deep-monitoring/targets` | 대상 목록 조회 |
| GET | `/api/sessions/:id/deep-monitoring/status` | 실행 상태 조회 |

**집중 모니터링 전체 흐름:**

```
[1. 대상 검색 (scan)]
   detection_results에서 세션의 결과를 분석
   → 작품 x 도메인 별로 집계
   → 5개 이상 URL이 발견된 조합을 대상으로 선정
   → deep_monitoring_targets에 저장
   
[2. 대상 실행 (execute-target) — 프론트에서 1건씩 순차 호출]
   Step 1: Serper 검색 (deep_query로 2페이지, 20결과)
   Step 2: 기존 URL 중복 제거
   Step 3: 1차 판별 (sites 테이블 대조 → illegal/legal/unknown)
   Step 4: 2차 판별 (Manus LLM, 15초 타임아웃)
   Step 5: 최종 상태 결정 (illegal/legal/pending)
   Step 6: DB 저장 (detection_results, source='deep')
   Step 7: 불법 URL 신고 추적 등록 (report_tracking)
   
[3. 후처리 (finalize) — 전체 완료 후 1회 호출]
   - DB의 deep 결과를 Blob에 병합
   - 세션 통계 재계산
   - file_final_results URL 업데이트
```

### 5.10 신고 결과 추적 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/report-tracking/sessions` | 신고 추적 세션 목록 |
| GET | `/api/report-tracking/reasons` | 미신고 사유 자동완성 |
| GET | `/api/report-tracking/:sessionId` | 세션별 신고 추적 데이터 (페이지네이션) |
| GET | `/api/report-tracking/:sessionId/stats` | 세션별 신고 통계 |
| PUT | `/api/report-tracking/:id/status` | 신고 상태 변경 |
| PUT | `/api/report-tracking/:id/reason` | 미신고 사유 변경 |
| PUT | `/api/report-tracking/:id/report-id` | 신고 ID 변경 |
| POST | `/api/report-tracking/:sessionId/add-url` | URL 수동 추가 (Blob에도 반영) |
| POST | `/api/report-tracking/:sessionId/upload` | HTML 업로드 (신고 ID 자동 추출) |
| GET | `/api/report-tracking/:sessionId/uploads` | 업로드 이력 |
| PUT | `/api/report-tracking/uploads/:uploadId` | 업로드 건 신고 ID 수정 |
| GET | `/api/report-tracking/:sessionId/urls` | 불법 URL 목록 (복사용) |
| GET | `/api/report-tracking/:sessionId/export` | Excel 내보내기 |

### 5.11 통계 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/stats` | 전체 통계 개요 |
| GET | `/api/stats/by-title` | 작품별 통계 상세 |
| GET | `/api/manta-rankings` | Manta 순위 현황 |
| GET | `/api/titles/:title/ranking-history` | 작품별 순위 변화 히스토리 |

---

## 6. 프론트엔드 페이지 구조

### 6.1 라우팅 구조

| 경로 | 페이지명 | 설명 | 접근 권한 |
|------|----------|------|-----------|
| `/login` | 로그인 | 로그인 폼 | 모두 |
| `/` | 대시보드 | 월간 통계, Top 5, Manta 순위 | 모두 |
| `/titles` | 모니터링 작품 관리 | 작품 추가/삭제/비공식타이틀 | 모두 |
| `/pending` | 승인 대기 | LLM uncertain 도메인 승인/거부 | admin+ |
| `/sessions` | 모니터링 회차 | 세션 목록 | 모두 |
| `/sessions/[id]` | 세션 상세 | 결과 테이블 + 집중 모니터링 패널 | 모두 |
| `/report-tracking` | 신고 결과 추적 | 세션별 신고 상태 관리 | 모두 |
| `/stats` | 신고/차단 통계 | 작품별 통계 차트 | 모두 |
| `/stats/manta-rankings` | Manta 순위 변화 | 작품별 순위 히스토리 그래프 | 모두 |
| `/sites` | 사이트 목록 | 불법/합법 도메인 관리 | admin+ |
| `/users` | 계정 관리 | 사용자 CRUD | superadmin |

### 6.2 레이아웃 구조
```
MainLayout
├── Sidebar (좌측 네비게이션)
│   ├── 대시보드
│   ├── 모니터링 작품 관리
│   ├── 승인 대기 (admin only)
│   ├── 모니터링 회차
│   ├── 신고결과 추적
│   ├── 작품별 통계
│   │   ├── 신고/차단 통계
│   │   └── Manta 순위 변화
│   ├── 사이트 목록 (admin only)
│   └── 계정 관리 (superadmin only)
├── Header (상단 바, 사용자 정보)
├── MobileMenu (모바일 반응형)
└── AuthGuard (인증 보호 래퍼)
```

### 6.3 주요 페이지별 API 연동

#### 대시보드 (`/`)
```
페이지 로드 → GET /api/dashboard/months → 월 목록 드롭다운
월 선택 → GET /api/dashboard?month=2026-02 → 통계 카드 + Top 5 + Manta 순위
```

#### 세션 상세 (`/sessions/[id]`)
```
페이지 로드 → GET /api/sessions/:id/results (Blob 기반)
           → GET /api/titles (Manta URL 표시용)

집중 모니터링 패널 열기
  → GET /api/sessions/:id/deep-monitoring/targets (기존 대상 로드)

[대상 검색] 클릭
  → POST /api/sessions/:id/deep-monitoring/scan

[집중 모니터링 시작] 클릭
  → 대상 1건씩 순차 실행:
      POST /api/sessions/:id/deep-monitoring/execute-target/:targetId
      (UI에서 실시간 진행률 표시: 1/5 → 2/5 → ...)
  → 전체 완료 후:
      POST /api/sessions/:id/deep-monitoring/finalize (Blob 병합)
  → GET /api/sessions/:id/results (결과 새로고침 — deep 포함)
```

#### 신고 결과 추적 (`/report-tracking`)
```
세션 선택 → GET /api/report-tracking/:sessionId (페이지네이션)
          → GET /api/report-tracking/:sessionId/stats (통계)
신고 상태 변경 → PUT /api/report-tracking/:id/status
HTML 업로드 → POST /api/report-tracking/:sessionId/upload
불법 URL 복사 → GET /api/report-tracking/:sessionId/urls
```

---

## 7. 핵심 데이터 흐름 다이어그램

### 7.1 모니터링 파이프라인 (CLI 실행)
```
[CLI: npx tsx run-pipeline.ts]
  │
  ├─ 1. 작품 목록 로드 (titles 테이블 + unofficial_titles)
  ├─ 2. 키워드 로드 (data/keywords.txt)
  ├─ 3. Google 검색 (Serper API) — 작품 x 키워드 조합
  │     → search-results.json
  ├─ 4. 1차 판별 (sites 테이블 대조)
  │     → classified-results.json
  ├─ 5. LLM 판별 (Manus AI, unknown 도메인만)
  │     → llm-judged-results.json
  ├─ 6. 최종 결과 생성
  │     → final-results.json → Vercel Blob 업로드
  ├─ 7. DB 저장 (sessions, detection_results)
  ├─ 8. 신고 추적 등록 (report_tracking — 불법 URL만)
  └─ 9. Manta 순위 업데이트 (manta_rankings)
```

### 7.2 데이터 저장소 구조
```
┌──────────────────────────────────────────┐
│           Vercel Blob Storage            │
│  results/{sessionId}/final-results.json  │
│  (프론트엔드 결과 표시의 주 데이터 소스)   │
└──────────────┬───────────────────────────┘
               │ 동기화
┌──────────────┴───────────────────────────┐
│           Neon PostgreSQL                │
│  ┌─────────────┐  ┌──────────────────┐   │
│  │  sessions    │  │ detection_results│   │
│  │  (메타데이터) │  │ (전체 결과 DB)   │   │
│  └─────────────┘  └──────────────────┘   │
│  ┌─────────────┐  ┌──────────────────┐   │
│  │  sites       │  │ report_tracking  │   │
│  │  (판별 기준) │  │ (신고 추적)      │   │
│  └─────────────┘  └──────────────────┘   │
│  ┌─────────────────────────────────────┐ │
│  │ deep_monitoring_targets             │ │
│  │ (집중 모니터링 대상 및 상태)         │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### 7.3 불법 URL 판별 흐름
```
[검색 결과 URL]
  │
  ├─ 1차: sites 테이블 대조
  │   ├─ domain ∈ illegal sites → "illegal" ✅
  │   ├─ domain ∈ legal sites   → "legal" ✅
  │   └─ 미등록 도메인          → "unknown" ❓
  │
  └─ 2차: Manus LLM 판별 (unknown만)
      ├─ likely_illegal → final_status = "pending" (관리자 확인 대기)
      ├─ likely_legal   → final_status = "pending"
      └─ uncertain      → final_status = "pending"
      
[관리자 승인] (pending_reviews 페이지)
  ├─ approve → domain을 sites(illegal)에 추가
  │            → 해당 세션 Blob에서 pending → illegal 업데이트
  └─ reject  → domain을 sites(legal)에 추가
```

---

## 8. 환경변수 목록

| 변수명 | 용도 | 사용 위치 |
|--------|------|-----------|
| `DATABASE_URL` | Neon PostgreSQL 연결 문자열 | 백엔드 API + CLI 스크립트 |
| `SESSION_SECRET` | 세션 토큰 서명 비밀키 | 백엔드 API (인증) |
| `ADMIN_USERNAME` | 초기 관리자 계정명 | 백엔드 API (인증) |
| `ADMIN_PASSWORD_HASH` | 초기 관리자 비밀번호 해시 | 백엔드 API (인증) |
| `SERPER_API_KEY` | Google 검색 API 키 | 백엔드 API + CLI |
| `MANUS_API_KEY` | Manus AI API 키 | 백엔드 API + CLI |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 읽기/쓰기 토큰 | 백엔드 API + CLI |
| `NEXT_PUBLIC_API_URL` | 백엔드 API URL (프론트 프록시용) | 프론트엔드 (next.config.js) |

---

## 9. 배포 구조

```
GitHub: TooR-oN/Jobdori (main 브랜치)
  │
  ├─ Vercel Project 1: 백엔드 (Hono)
  │   ├─ Root Directory: backend/
  │   ├─ Framework: Other
  │   ├─ Build: vite build
  │   ├─ Output: dist/
  │   ├─ Routes: vercel.json → 모든 요청을 api/index.ts로
  │   └─ maxDuration: 30초
  │
  └─ Vercel Project 2: 프론트엔드 (Next.js)
      ├─ Root Directory: frontend/
      ├─ Framework: Next.js
      ├─ Build: next build
      └─ Rewrites: /api/* → 백엔드 Vercel URL 프록시
```

### API 요청 흐름
```
브라우저 → Vercel(프론트엔드) → Next.js Rewrite → Vercel(백엔드) → Hono → NeonDB/Blob
```

---

## 10. CLI 스크립트 (백엔드)

| 스크립트 | 명령어 | 설명 |
|----------|--------|------|
| `search.ts` | `npx tsx scripts/search.ts` | Serper API로 Google 검색 실행 |
| `classify.ts` | `npx tsx scripts/classify.ts` | 검색 결과를 illegal/legal/unknown 분류 |
| `llm-judge.ts` | `npx tsx scripts/llm-judge.ts` | Manus AI로 unknown 도메인 판별 |
| `run-pipeline.ts` | `npx tsx scripts/run-pipeline.ts` | 전체 파이프라인 실행 (검색→분류→판별→저장) |
| `deep-monitoring.ts` | `npx tsx scripts/deep-monitoring.ts` | 집중 모니터링 (scan/execute CLI) |
| `db-migrate.ts` | `npx tsx scripts/db-migrate.ts` | DB 스키마 마이그레이션 |
| `db-seed.ts` | `npx tsx scripts/db-seed.ts` | 초기 데이터 시딩 |

---

## 11. 역할별 권한 체계

| 기능 | superadmin | admin | user |
|------|:----------:|:-----:|:----:|
| 대시보드 | O | O | O |
| 모니터링 회차 | O | O | O |
| 작품 관리 | O | O | O |
| 신고 결과 추적 | O | O | O |
| 승인 대기 | O | O | X |
| 사이트 목록 | O | O | X |
| 계정 관리 | O | X | X |

---

## 12. 최근 개발 이력 (2026.02.10 기준)

### 2026.02.07 — 사이트 집중 모니터링 기능 구현 (Phase 1~5)
- 백엔드: scan, execute-target, finalize, targets, status API 5개 구현
- 프론트엔드: 세션 상세 페이지에 접이식 집중 모니터링 패널 추가
- CLI: deep-monitoring.ts (scan/execute 지원)
- DB: deep_monitoring_targets 테이블, detection_results에 source/deep_target_id 컬럼 추가

### 2026.02.09 — defensive 파싱 및 에러 추적
- unofficial_titles 방어적 파싱 (배열/JSON 문자열/PG 배열 모두 처리)
- scan API에 단계별 에러 추적 (8단계: migration → session-check → ... → db-save)
- 모든 deep monitoring 엔드포인트에 ensureDbMigration() 추가

### 2026.02.10 — 순차 실행 전환 및 버그 수정
- **집중 모니터링 순차 실행 방식으로 전환**: Vercel 30초 제한 우회
  - 프론트엔드가 대상 1건씩 순차 호출 (각 ~25초 이내)
  - 실시간 진행률 표시 (현재 대상명, 완료/전체, 신규 URL 수)
  - 실패 대상 재실행 가능 (체크박스 + 재실행 버튼)
- **Manus LLM 타임아웃**: 300초 → 15초 (Vercel 30초 제한 대비)
- **검색 설정 최적화**: 3페이지/30결과 → 2페이지/20결과
- **Blob 병합 누락 수정**: finalize API에서 DB의 deep 결과를 Blob에 병합하는 로직 추가
  - 근본 원인: results API가 Blob에서만 읽는데, deep 결과가 DB에만 있었음
- **완료 알림 추가**: 녹색 배너로 추가 발견된 불법 URL 수 표시
- **대시보드 Top 5 기준 변경**: 발견 건수 → 신고 건수 기준

---

## 13. 알려진 제약사항

1. **Vercel Serverless 30초 제한**: 모든 API 응답이 30초 이내에 완료되어야 함
   - 집중 모니터링: 대상 1건 실행이 ~25초 이내가 되도록 설계
   - LLM 판별: 15초 타임아웃, 초과 시 uncertain 처리
2. **Blob 기반 결과 조회**: 결과 테이블이 DB가 아닌 Blob에서 읽히므로, 데이터 변경 시 반드시 Blob 동기화 필요
3. **detection_results 테이블**: CLI 파이프라인에서 동적 생성 — 별도 마이그레이션 스크립트 없음
4. **Manus AI 비동기**: Task 생성 → 폴링 방식이므로 응답 시간이 불확정적
