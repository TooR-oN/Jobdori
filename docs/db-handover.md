# Jobdori Database Handover Document

> **DB**: Neon PostgreSQL (Serverless)
> **Connection**: `DATABASE_URL` 환경변수 (Neon connection string)
> **Last Updated**: 2026-02-20

---

## 1. 전체 테이블 요약

| # | 테이블명 | 설명 | 주요 용도 |
|---|---------|------|----------|
| 1 | `sessions` | 모니터링 세션 | 불법 사이트 탐지 실행 단위 |
| 2 | `detection_results` | 탐지 결과 | URL별 불법/합법 판정 결과 |
| 3 | `sites` | 사이트 목록 | 불법/합법 도메인 관리 |
| 4 | `titles` | 작품 목록 | 모니터링 대상 작품 (만타 작품) |
| 5 | `pending_reviews` | 승인 대기 | LLM 판정 후 관리자 검토 대기 |
| 6 | `monthly_stats` | 월별 통계 | 대시보드용 월간 집계 |
| 7 | `manta_rankings` | 만타 순위 (현재) | 작품별 검색엔진 순위 스냅샷 |
| 8 | `manta_ranking_history` | 만타 순위 히스토리 | 순위 변동 추적 |
| 9 | `report_tracking` | 신고 추적 | URL별 DMCA 신고 상태 |
| 10 | `report_uploads` | 신고 업로드 이력 | 구글 신고 결과 CSV 업로드 기록 |
| 11 | `report_reasons` | 신고 사유 | 거부 사유 드롭다운 옵션 |
| 12 | `deep_monitoring_targets` | 집중 모니터링 대상 | 특정 도메인 심층 탐지 |
| 13 | `excluded_urls` | 신고 제외 URL | 신고 대상에서 제외할 URL |
| 14 | `domain_analysis_reports` | 월간 도메인 분석 리포트 | 트래픽 분석 실행 메타데이터 |
| 15 | `domain_analysis_results` | 월간 도메인 분석 결과 | **도메인별 트래픽/위협 점수/권고사항** |
| 16 | `site_notes` | 활동 이력 | 사이트별 메모/변경 기록 |
| 17 | `distribution_channels` | 유통 경로 | 사이트 유통 경로 옵션 (웹, APK 등) |
| 18 | `site_languages` | 사이트 언어 | 사이트 언어 옵션 (영어, 스페인어 등) |
| 19 | `users` | 사용자 | 로그인/권한 관리 |

---

## 2. 테이블별 상세 스키마

### 2.1 sessions (모니터링 세션)

파이프라인(`run-pipeline.ts`) 실행 시 1건씩 생성. 세션 ID는 ISO timestamp 형식 (`2026-02-20T09:00:00`).

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | VARCHAR(50) PK | - | 세션 ID (ISO timestamp) |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |
| `completed_at` | TIMESTAMPTZ | NULL | 완료 시각 |
| `status` | VARCHAR(20) | 'running' | running / completed / failed |
| `titles_count` | INTEGER | 0 | 모니터링 대상 작품 수 |
| `keywords_count` | INTEGER | 0 | 검색 키워드 수 |
| `total_searches` | INTEGER | 0 | 총 검색 횟수 |
| `results_total` | INTEGER | 0 | 전체 탐지 결과 수 |
| `results_illegal` | INTEGER | 0 | 불법 판정 수 |
| `results_legal` | INTEGER | 0 | 합법 판정 수 |
| `results_pending` | INTEGER | 0 | 보류 판정 수 |
| `file_final_results` | VARCHAR(500) | NULL | Vercel Blob 결과 파일 URL |
| `deep_monitoring_executed` | BOOLEAN | false | 집중 모니터링 실행 여부 |
| `deep_monitoring_targets_count` | INTEGER | 0 | 집중 모니터링 대상 수 |
| `deep_monitoring_new_urls` | INTEGER | 0 | 집중 모니터링 신규 URL 수 |

**인덱스**: `idx_sessions_created_at` (created_at DESC), `idx_sessions_status` (status)

---

### 2.2 detection_results (탐지 결과)

모니터링 파이프라인에서 URL 단위로 기록되는 핵심 데이터. 통계/리포트의 원천 데이터.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `session_id` | VARCHAR(50) NOT NULL | - | sessions.id 참조 |
| `title` | TEXT | - | 모니터링 작품명 |
| `search_query` | TEXT | - | 실제 검색 쿼리 |
| `url` | TEXT NOT NULL | - | 탐지된 URL |
| `domain` | VARCHAR(255) | - | URL에서 추출한 도메인 |
| `page` | INTEGER | - | 검색 결과 페이지 번호 |
| `rank` | INTEGER | - | 해당 페이지 내 순위 |
| `initial_status` | VARCHAR(20) | - | 초기 판정 (illegal/legal/unknown) |
| `llm_judgment` | VARCHAR(20) | NULL | LLM 판정 (likely_illegal/likely_legal/uncertain) |
| `llm_reason` | TEXT | NULL | LLM 판정 근거 |
| `final_status` | VARCHAR(20) | - | **최종 판정** (illegal/legal/pending) |
| `reviewed_at` | TIMESTAMPTZ | NULL | 관리자 검토 시각 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |
| `snippet` | TEXT | NULL | 검색 결과 스니펫 |
| `source` | VARCHAR(20) | 'regular' | 출처 (regular/deep) |
| `deep_target_id` | INTEGER | NULL | deep_monitoring_targets.id 참조 |

**UNIQUE**: (session_id, url)
**핵심 쿼리**: `WHERE final_status = 'illegal'`로 불법 판정된 URL만 추출

---

### 2.3 sites (사이트 목록) ★

불법/합법 도메인 마스터 테이블. 다른 서비스에서 **불법 사이트 도메인 목록**을 가져올 때 이 테이블 사용.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `domain` | VARCHAR(255) NOT NULL | - | 도메인명 (소문자) |
| `type` | VARCHAR(10) NOT NULL | - | **'illegal'** 또는 **'legal'** |
| `site_type` | VARCHAR(30) | 'unclassified' | 사이트 분류 (아래 참조) |
| `site_status` | VARCHAR(20) | 'active' | 운영 상태 (아래 참조) |
| `new_url` | TEXT | NULL | 주소 변경 시 새 URL |
| `distribution_channel` | VARCHAR(50) | '웹' | 유통 경로 (웹/APK/텔레그램/디스코드) |
| `language` | VARCHAR(50) | 'unset' | 사이트 언어 |
| `created_at` | TIMESTAMPTZ | NOW() | 등록 시각 |

**UNIQUE**: (domain, type)
**CHECK**: type IN ('illegal', 'legal')

**site_type 값 목록** (type_score):
| 값 | 설명 | type_score |
|----|------|-----------|
| `scanlation_group` | 스캔레이션 그룹 (번역·스캔 직접 수행) | 35 |
| `aggregator` | 애그리게이터 (여러 소스 수집) | 20 |
| `clone` | 클론 사이트 (타 사이트 미러) | 10 |
| `blog` | 블로그형 | 5 |
| `unclassified` | 미분류 | 0 |

**site_status 값 목록**:
| 값 | 설명 |
|----|------|
| `active` | 운영 중 |
| `closed` | 폐쇄됨 |
| `changed` | 주소 변경 (new_url에 새 주소) |

**language 값 목록** (기본 옵션):
`unset`(미설정), `다국어`, `영어`, `스페인어`, `포르투갈어`, `러시아어`, `아랍어`, `태국어`, `인도네시아어`, `중국어`
(사용자가 추가 가능)

---

### 2.4 titles (작품 목록)

만타(Manta)의 모니터링 대상 작품.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `name` | VARCHAR(500) UNIQUE | - | 작품명 (영문) |
| `is_current` | BOOLEAN | true | 현재 모니터링 대상 여부 |
| `manta_url` | TEXT | NULL | 만타 공식 URL |
| `unofficial_titles` | JSONB | NULL | 비공식 타이틀 목록 (배열) |
| `created_at` | TIMESTAMPTZ | NOW() | 등록 시각 |

---

### 2.5 pending_reviews (승인 대기)

LLM이 `uncertain`으로 판정한 도메인에 대해 관리자 검토를 요청하는 큐.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `domain` | VARCHAR(255) NOT NULL | - | 검토 대상 도메인 |
| `urls` | JSONB | '[]' | 해당 도메인의 URL 목록 |
| `titles` | JSONB | '[]' | 관련 작품명 목록 |
| `llm_judgment` | VARCHAR(20) | NULL | LLM 판정 |
| `llm_reason` | TEXT | NULL | LLM 판정 근거 |
| `session_id` | VARCHAR(50) | NULL | 세션 ID |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |

**UNIQUE**: (domain) — `pending_reviews_domain_unique`

---

### 2.6 monthly_stats (월별 통계)

대시보드 표시용 월간 집계 데이터. `detection_results`에서 실시간 집계하여 캐싱.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `month` | VARCHAR(7) UNIQUE | - | 'YYYY-MM' 형식 |
| `sessions_count` | INTEGER | 0 | 해당 월 세션 수 |
| `total` | INTEGER | 0 | 전체 탐지 결과 수 |
| `illegal` | INTEGER | 0 | 불법 판정 수 |
| `legal` | INTEGER | 0 | 합법 판정 수 |
| `pending` | INTEGER | 0 | 보류 판정 수 |
| `top_contents` | JSONB | '[]' | 가장 많이 탐지된 작품 TOP |
| `top_illegal_sites` | JSONB | '[]' | 가장 많이 탐지된 불법 사이트 TOP |
| `last_updated` | TIMESTAMPTZ | NOW() | 최종 갱신 시각 |

---

### 2.7 manta_rankings (만타 순위 - 현재)

작품별 검색엔진(Google) 순위 최신 스냅샷. 파이프라인 실행 시 갱신.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `title` | VARCHAR(500) PK | - | 작품명 |
| `manta_rank` | INTEGER | NULL | manta.net의 Google 검색 순위 (NULL=순위권 외) |
| `first_rank_domain` | VARCHAR(255) | NULL | 1위 도메인 |
| `search_query` | VARCHAR(500) | NULL | 검색어 |
| `session_id` | VARCHAR(50) | NULL | 최근 세션 ID |
| `page1_illegal_count` | INTEGER | 0 | 1페이지 내 불법 사이트 수 |
| `updated_at` | TIMESTAMPTZ | NOW() | 갱신 시각 |

---

### 2.8 manta_ranking_history (만타 순위 히스토리)

순위 변동 추적용 히스토리. 파이프라인 실행마다 1건씩 INSERT.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `title` | VARCHAR(500) NOT NULL | - | 작품명 |
| `manta_rank` | INTEGER | NULL | 해당 시점 manta.net 순위 |
| `first_rank_domain` | VARCHAR(255) | NULL | 해당 시점 1위 도메인 |
| `session_id` | VARCHAR(50) | NULL | 세션 ID |
| `page1_illegal_count` | INTEGER | 0 | 1페이지 불법 사이트 수 |
| `recorded_at` | TIMESTAMPTZ | NOW() | 기록 시각 |

**인덱스**: `idx_manta_ranking_history_title` (title, recorded_at DESC)

---

### 2.9 report_tracking (신고 추적) ★

DMCA 신고 URL별 상태 추적. 모니터링 세션과 연계.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `session_id` | VARCHAR(50) NOT NULL | - | sessions.id 참조 |
| `url` | TEXT NOT NULL | - | 신고 대상 URL |
| `domain` | VARCHAR(255) NOT NULL | - | 도메인 |
| `title` | TEXT | NULL | 관련 작품명 |
| `report_status` | VARCHAR(20) | '미신고' | **신고 상태** (아래 참조) |
| `report_id` | VARCHAR(50) | NULL | 구글 신고 ID |
| `reason` | TEXT | NULL | 거부 사유 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |
| `updated_at` | TIMESTAMPTZ | NOW() | 최종 수정 시각 |

**UNIQUE**: (session_id, url)
**인덱스**: `idx_report_tracking_session` (session_id, report_status), `idx_report_tracking_title` (title)

**report_status 값 목록**:
| 값 | 설명 |
|----|------|
| `미신고` | 아직 신고하지 않음 |
| `대기 중` | 신고 후 구글 검토 대기 |
| `차단` | 구글에서 차단 완료 |
| `거부` | 구글에서 신고 거부 |
| `색인없음` | 이미 검색 색인에서 제거됨 |

---

### 2.10 report_uploads (신고 업로드 이력)

구글 신고 결과 CSV 파일 업로드 이력.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `session_id` | VARCHAR(50) NOT NULL | - | sessions.id 참조 |
| `report_id` | VARCHAR(50) NOT NULL | - | 구글 신고 ID |
| `file_name` | VARCHAR(255) | NULL | 업로드 파일명 |
| `matched_count` | INTEGER | 0 | 매칭된 URL 수 |
| `total_urls_in_html` | INTEGER | 0 | 파일 내 전체 URL 수 |
| `uploaded_at` | TIMESTAMPTZ | NOW() | 업로드 시각 |

---

### 2.11 report_reasons (신고 사유)

거부 사유 드롭다운 옵션. 사용자가 추가 가능.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `reason_text` | VARCHAR(255) UNIQUE | - | 사유 텍스트 |
| `usage_count` | INTEGER | 1 | 사용 횟수 (정렬용) |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |

**기본 사유**: '저작권 미확인', '검토 필요', '중복 신고', 'URL 오류'

---

### 2.12 deep_monitoring_targets (집중 모니터링 대상)

특정 도메인에 대한 심층 검색 (site:도메인 검색어).

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `session_id` | VARCHAR(50) NOT NULL | - | sessions.id 참조 |
| `title` | TEXT NOT NULL | - | 작품명 |
| `domain` | VARCHAR(255) NOT NULL | - | 대상 도메인 |
| `url_count` | INTEGER | 0 | 기존 발견 URL 수 |
| `base_keyword` | TEXT | - | 기본 검색 키워드 |
| `deep_query` | TEXT | - | 심층 검색 쿼리 (site:도메인 키워드) |
| `status` | VARCHAR(20) | 'pending' | pending/running/completed/failed |
| `results_count` | INTEGER | 0 | 심층 검색 결과 수 |
| `new_urls_count` | INTEGER | 0 | 신규 발견 URL 수 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |
| `executed_at` | TIMESTAMPTZ | NULL | 실행 시작 시각 |
| `completed_at` | TIMESTAMPTZ | NULL | 완료 시각 |

**UNIQUE**: (session_id, title, domain)
**인덱스**: `idx_deep_monitoring_session` (session_id)

---

### 2.13 excluded_urls (신고 제외 URL)

신고 대상에서 영구 제외할 URL 목록.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `url` | TEXT UNIQUE NOT NULL | - | 제외 URL |
| `created_at` | TIMESTAMPTZ | NOW() | 등록 시각 |

---

### 2.14 domain_analysis_reports (월간 도메인 분석 리포트) ★

월 단위 실행 메타데이터. Manus AI 에이전트가 SimilarWeb API로 트래픽 분석 후 결과를 저장.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 리포트 ID |
| `analysis_month` | VARCHAR(7) UNIQUE | - | 분석 대상 월 ('YYYY-MM') |
| `status` | VARCHAR(20) | 'pending' | pending/running/completed/failed |
| `manus_task_id` | VARCHAR(100) | NULL | Manus AI 태스크 ID |
| `total_domains` | INTEGER | 0 | 분석 대상 도메인 수 |
| `report_blob_url` | TEXT | NULL | Vercel Blob에 저장된 리포트 URL |
| `report_markdown` | TEXT | NULL | 마크다운 형식 리포트 본문 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |
| `completed_at` | TIMESTAMPTZ | NULL | 완료 시각 |
| `error_message` | TEXT | NULL | 실패 시 에러 메시지 |

---

### 2.15 domain_analysis_results (월간 도메인 분석 결과) ★★★

**가장 중요한 데이터 테이블**. 도메인별 트래픽 지표, 위협 점수, AI 권고사항을 저장.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `report_id` | INTEGER NOT NULL | - | domain_analysis_reports.id FK (CASCADE) |
| `rank` | INTEGER NOT NULL | - | 위협 순위 (1위 = 가장 위험) |
| `domain` | VARCHAR(255) NOT NULL | - | 불법 사이트 도메인 |
| `threat_score` | DECIMAL(5,1) | 0 | **종합 위협 점수** (0~100, 아래 설명) |
| `global_rank` | INTEGER | NULL | SimilarWeb 글로벌 순위 |
| `total_visits` | BIGINT | NULL | 월간 총 방문수 |
| `unique_visitors` | BIGINT | NULL | 월간 순방문자 수 |
| `bounce_rate` | DECIMAL(5,4) | NULL | 이탈률 (0.0~1.0) |
| `discovered` | INTEGER | 0 | Jobdori 탐지 URL 수 |
| `visits_change_mom` | DECIMAL(7,1) | NULL | 전월 대비 방문 변동률 (%) |
| `rank_change_mom` | INTEGER | NULL | 전월 대비 순위 변동 |
| `size_score` | DECIMAL(5,1) | NULL | **규모 점수** (0~35, 아래 설명) |
| `growth_score` | DECIMAL(5,1) | NULL | **성장 점수** (0~30, 아래 설명) |
| `type_score` | DECIMAL(5,1) | 0 | **유형 점수** (0~35, sites.site_type 기반) |
| `site_type` | VARCHAR(30) | NULL | 사이트 분류 (sites.site_type과 동일) |
| `traffic_analysis` | VARCHAR(50) | NULL | **트래픽 분석 요약** (아래 설명) |
| `traffic_analysis_detail` | TEXT | NULL | 트래픽 분석 상세 설명 |
| `recommendation` | TEXT | NULL | **★ 권고사항** (아래 상세 설명) |
| `recommendation_detail` | TEXT | NULL | **★ 권고사항 상세** (아래 상세 설명) |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |

**UNIQUE**: (report_id, domain)
**인덱스**: `idx_domain_analysis_results_report` (report_id, rank)
**FK**: report_id → domain_analysis_reports(id) ON DELETE CASCADE

---

### 2.16 site_notes (활동 이력)

사이트별 관리 이력 (메모, 유통 경로 변경 등).

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `domain` | VARCHAR(500) NOT NULL | - | 도메인 |
| `note_type` | VARCHAR(20) NOT NULL | - | 'memo' 또는 'channel_change' |
| `content` | TEXT NOT NULL | - | 내용 (메모 텍스트 또는 "웹 → APK") |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |

**인덱스**: `idx_site_notes_domain` (domain)

---

### 2.17 distribution_channels (유통 경로)

사이트 유통 경로 드롭다운 옵션.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `name` | VARCHAR(100) UNIQUE | - | 경로명 |
| `is_default` | BOOLEAN | false | 기본 옵션 여부 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |

**기본 데이터**: '웹', 'APK', '텔레그램', '디스코드'

---

### 2.18 site_languages (사이트 언어)

사이트 언어 드롭다운 옵션.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `name` | VARCHAR(100) UNIQUE | - | 언어명 |
| `is_default` | BOOLEAN | false | 기본 옵션 여부 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |

**기본 데이터**: '다국어', '영어', '스페인어', '포르투갈어', '러시아어', '아랍어', '태국어', '인도네시아어', '중국어'

---

### 2.19 users (사용자)

로그인 및 권한 관리.

| 칼럼 | 타입 | Default | 설명 |
|------|------|---------|------|
| `id` | SERIAL PK | auto | 고유 ID |
| `username` | VARCHAR(100) UNIQUE | - | 로그인 ID |
| `password_hash` | TEXT NOT NULL | - | bcrypt 해시 |
| `role` | VARCHAR(20) | 'user' | 'admin' 또는 'user' |
| `is_active` | BOOLEAN | true | 활성 상태 |
| `created_at` | TIMESTAMPTZ | NOW() | 생성 시각 |
| `updated_at` | TIMESTAMPTZ | NOW() | 수정 시각 |

---

## 3. 테이블 관계도 (ERD 요약)

```
sessions (PK: id)
  ├── detection_results.session_id
  ├── report_tracking.session_id
  ├── report_uploads.session_id
  ├── deep_monitoring_targets.session_id
  ├── manta_rankings.session_id
  └── manta_ranking_history.session_id

sites (PK: id, UNIQUE: domain+type)
  ├── detection_results.domain (논리적 참조)
  ├── report_tracking.domain (논리적 참조)
  ├── domain_analysis_results.domain (논리적 참조)
  └── site_notes.domain (논리적 참조)

titles (PK: id)
  ├── detection_results.title (논리적 참조)
  └── manta_rankings.title (논리적 참조)

domain_analysis_reports (PK: id)
  └── domain_analysis_results.report_id (FK, CASCADE)
```

> **참고**: 대부분의 관계는 논리적 참조 (FK 제약조건 없음). `domain_analysis_results → domain_analysis_reports`만 실제 FK (ON DELETE CASCADE).

---

## 4. 월간 도메인 분석 — 상세 설명 ★★★

### 4.1 분석 흐름

1. **도메인 수집**: `detection_results`에서 `final_status = 'illegal'`인 도메인을 해당 월 기준으로 집계
2. **Manus AI 호출**: SimilarWeb API를 통해 각 도메인의 트래픽 데이터 수집
3. **점수 산정**: 규모(size_score) + 성장(growth_score) + 유형(type_score) = 위협(threat_score)
4. **AI 분석**: 트래픽 패턴 분석 및 **권고사항** 생성
5. **결과 저장**: `domain_analysis_reports` + `domain_analysis_results`에 저장

### 4.2 위협 점수 체계 (threat_score)

```
threat_score = size_score + growth_score + type_score
```

| 점수 구분 | 범위 | 산정 기준 |
|----------|------|----------|
| **size_score** | 0~35 | SimilarWeb `total_visits` + `global_rank` 기반. 방문자가 많고 순위가 높을수록 고점 |
| **growth_score** | 0~30 | `visits_change_mom` 기반. 전월 대비 트래픽 증가율이 클수록 고점 |
| **type_score** | 0~35 | `sites.site_type` 기반 (아래 고정값) |

**type_score 고정값**:
| site_type | type_score | 근거 |
|-----------|-----------|------|
| scanlation_group | 35 | 직접 번역·스캔 → 저작권 침해 핵심 행위자 |
| aggregator | 20 | 여러 소스 수집 → 접근성 극대화 |
| clone | 10 | 기존 사이트 복제 → 차단 후 빠르게 부활 |
| blog | 5 | 블로그형 → 규모 작으나 접근 용이 |
| unclassified | 0 | 미분류 |

### 4.3 트래픽 분석 필드 (traffic_analysis)

`traffic_analysis`는 짧은 요약 라벨 (VARCHAR 50):
- 예: "급성장", "안정 대형", "신규 진입", "소규모", "감소세" 등

`traffic_analysis_detail`은 상세 설명 (TEXT):
- 예: "전월 대비 45% 성장. 글로벌 순위 12,300위. 월간 방문 250만..."

### 4.4 권고사항 필드 (recommendation / recommendation_detail) ★★★

**`recommendation`** (TEXT) — Manus AI가 생성하는 **조치 권고** 요약.

대표적인 권고사항 값:
| recommendation | 의미 |
|---------------|------|
| `Urgent Block` | 즉시 차단 권고 (대규모 + 급성장) |
| `Priority Block` | 우선 차단 권고 (대규모 또는 고위험 유형) |
| `Block` | 일반 차단 권고 |
| `Monitor` | 모니터링 유지 (규모 작거나 감소 추세) |
| `Low Priority` | 낮은 우선순위 (소규모, 트래픽 미미) |
| `No Data` | SimilarWeb 데이터 없음 (신규/소규모) |

**`recommendation_detail`** (TEXT) — 권고의 근거와 구체적 조치 방안.

예시:
```
"이 도메인은 월간 250만 방문, 전월 대비 45% 급증. Scanlation Group으로
직접 번역·스캔을 수행하며 글로벌 순위 12,300위. 즉시 DMCA 차단 신고와
함께 CDN(Cloudflare) 어뷰즈 리포트를 병행할 것을 권고."
```

### 4.5 데이터 조회 예시

```sql
-- 특정 월의 전체 분석 결과 (위협 순위순)
SELECT 
  r.rank, r.domain, r.threat_score,
  r.total_visits, r.unique_visitors, r.bounce_rate,
  r.visits_change_mom, r.global_rank,
  r.size_score, r.growth_score, r.type_score,
  r.site_type, r.traffic_analysis, r.traffic_analysis_detail,
  r.recommendation, r.recommendation_detail,
  r.discovered
FROM domain_analysis_results r
JOIN domain_analysis_reports rp ON r.report_id = rp.id
WHERE rp.analysis_month = '2026-01'
  AND rp.status = 'completed'
ORDER BY r.rank;
```

```sql
-- 즉시 차단 권고 도메인만 조회
SELECT domain, threat_score, recommendation, recommendation_detail,
       total_visits, visits_change_mom, site_type
FROM domain_analysis_results r
JOIN domain_analysis_reports rp ON r.report_id = rp.id
WHERE rp.analysis_month = '2026-01'
  AND rp.status = 'completed'
  AND r.recommendation IN ('Urgent Block', 'Priority Block')
ORDER BY r.threat_score DESC;
```

```sql
-- 전체 불법 사이트 도메인 + 현재 상태 + 언어 + 유통경로
SELECT domain, site_type, site_status, language, distribution_channel, new_url
FROM sites
WHERE type = 'illegal'
ORDER BY domain;
```

```sql
-- 도메인별 신고 통계 (전체 기간)
SELECT 
  domain,
  COUNT(*) as total_urls,
  COUNT(*) FILTER (WHERE report_status = '차단') as blocked,
  COUNT(*) FILTER (WHERE report_status = '대기 중') as pending,
  COUNT(*) FILTER (WHERE report_status = '미신고') as unreported
FROM report_tracking
GROUP BY domain
ORDER BY total_urls DESC;
```

---

## 5. 외부 서비스 연동 가이드

### 5.1 연결 정보

```
DATABASE_URL=postgres://user:password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Neon PostgreSQL은 표준 PostgreSQL 프로토콜을 지원. `pg`, `@neondatabase/serverless`, Prisma, Drizzle 등 모든 PostgreSQL 클라이언트 사용 가능.

### 5.2 핵심 데이터 접근

| 목적 | 테이블 | 필터 |
|------|--------|------|
| 불법 도메인 목록 | `sites` | `WHERE type = 'illegal'` |
| 도메인 상태/분류 | `sites` | `site_type`, `site_status`, `language` |
| 특정 월 트래픽 분석 | `domain_analysis_results` + `domain_analysis_reports` | `WHERE analysis_month = 'YYYY-MM'` |
| **권고사항** | `domain_analysis_results` | `recommendation`, `recommendation_detail` |
| 도메인별 탐지 URL | `detection_results` | `WHERE final_status = 'illegal' AND domain = ?` |
| 신고 현황 | `report_tracking` | `report_status` |
| 모니터링 대상 작품 | `titles` | `WHERE is_current = true` |

### 5.3 주의사항

1. **읽기 전용 접근 권장**: 외부 서비스에서는 SELECT만 수행. INSERT/UPDATE/DELETE는 Jobdori API를 통해 수행.
2. **Neon Serverless**: 커넥션 풀링 주의. `@neondatabase/serverless` 또는 connection pooling endpoint 사용 권장.
3. **타임존**: 모든 TIMESTAMP 칼럼은 `WITH TIME ZONE` (UTC 저장). 한국 시간은 +9시간.
4. **도메인 대소문자**: 모든 도메인은 소문자로 저장. 조회 시 `LOWER()` 적용 권장.
5. **마이그레이션**: 테이블 스키마는 `backend/api/index.ts`의 `ensureDbMigration()` 함수와 `backend/src/lib/db.ts`의 `initializeDatabase()` 함수에서 자동 실행. 별도 마이그레이션 도구 없음.

---

## 6. 환경변수 전체 목록

Jobdori가 사용하는 환경변수 목록 (`.env` 파일 또는 Vercel 환경변수).

### 6.1 필수 (Required)

| 환경변수 | 용도 | 예시 |
|---------|------|------|
| `DATABASE_URL` | Neon PostgreSQL 연결 문자열 | `postgres://user:pw@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require` |

### 6.2 인증 관련

| 환경변수 | 용도 | 비고 |
|---------|------|------|
| `ADMIN_USERNAME` | 비상용 관리자 ID | DB 장애 시 환경변수 기반 로그인 |
| `ADMIN_PASSWORD_HASH` | 비상용 관리자 비밀번호 (bcrypt) | `$2b$10$...` 형식 |
| `SESSION_SECRET` | JWT 토큰 서명 시크릿 | 미설정 시 기본값 사용 |

### 6.3 외부 서비스 연동

| 환경변수 | 용도 | 비고 |
|---------|------|------|
| `MANUS_API_KEY` | Manus AI API 키 | 월간 도메인 분석 + LLM 2차 판정 |
| `MANUS_TRAFFIC_PROJECT_ID` | Manus 트래픽 분석 프로젝트 ID | 기본값: `TvfU37uAeUph4R3YLzR2LV` |
| `SERPER_API_KEY` | Serper (Google 검색) API 키 | 모니터링 파이프라인 검색 |
| `SLACK_BOT_TOKEN` | Slack 알림 봇 토큰 | 파이프라인 완료 알림 |
| `SLACK_CHANNEL_ID` | Slack 알림 채널 ID | 알림 전송 대상 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob Storage 토큰 | 결과 파일/리포트 저장 |

### 6.4 프론트엔드

| 환경변수 | 용도 | 비고 |
|---------|------|------|
| `NEXT_PUBLIC_API_URL` | 백엔드 API URL | Next.js rewrites 프록시 대상 |

---

## 7. 데이터 흐름 파이프라인

### 7.1 모니터링 파이프라인 (`run-pipeline.ts`)

```
1. titles 조회 (is_current = true)
   ↓
2. 각 작품명으로 Google 검색 (Serper API)
   ↓
3. 검색 결과 URL 수집 → sites 테이블과 대조
   - sites(type='illegal')에 있으면 → initial_status = 'illegal'
   - sites(type='legal')에 있으면 → initial_status = 'legal'
   - 없으면 → initial_status = 'unknown'
   ↓
4. unknown 도메인에 대해 Manus AI LLM 2차 판정
   - likely_illegal → final_status = 'illegal'
   - likely_legal → final_status = 'legal'
   - uncertain → final_status = 'pending' (→ pending_reviews 등록)
   ↓
5. detection_results INSERT (session_id + url UNIQUE)
   ↓
6. final_status='illegal' URL → report_tracking INSERT (status='미신고')
   - excluded_urls에 있는 URL은 제외
   ↓
7. 불법 도메인 중 URL 3개 이상 → deep_monitoring_targets 등록
   ↓
8. manta_rankings / manta_ranking_history 갱신
   ↓
9. sessions 완료 처리 (status='completed')
```

### 7.2 월간 도메인 분석 파이프라인 (`domain-analysis.ts`)

```
1. detection_results에서 해당 월 불법 도메인 TOP 50 추출
   ↓
2. 각 도메인의 site_type을 sites 테이블에서 조회
   → type_score 매핑 (TYPE_SCORE_MAP)
   ↓
3. 전월 분석 결과 조회 (domain_analysis_results, MoM 비교용)
   ↓
4. 프롬프트 생성 → Manus AI Task 생성
   - Manus가 SimilarWeb API 호출하여 트래픽 데이터 수집
   - Manus가 점수 산정 (size_score, growth_score) + 위협 점수(threat_score) 계산
   - Manus가 traffic_analysis, recommendation, recommendation_detail 생성
   ↓
5. domain_analysis_reports INSERT/UPDATE (status='running' → 'completed')
   ↓
6. 결과 JSON 파싱 (normalizeManusItem) → domain_analysis_results INSERT
   ↓
7. Markdown 보고서를 report_markdown + Vercel Blob에 저장
```

### 7.3 데이터 흐름도

```
[Google 검색]
     ↓
[detection_results] ──→ [monthly_stats] (실시간 집계)
     ↓                       ↓
     ↓               [대시보드 표시]
     ↓
[sites] ←── 불법 도메인 등록
  │  ↑
  │  └── site_type, site_status, language, distribution_channel 관리
  │
  ├──→ [domain_analysis_results] ← Manus AI + SimilarWeb
  │        │
  │        ├── threat_score (종합 위협 점수)
  │        ├── recommendation (권고사항)
  │        └── traffic_analysis (트래픽 분석)
  │
  └──→ [report_tracking] ← DMCA 신고 추적
           │
           ├── report_status (미신고/대기/차단/거부/색인없음)
           └── report_uploads (구글 신고 결과 HTML 업로드)
```

---

## 8. 월간 도메인 분석 — 권고사항(recommendation) 심층 가이드 ★★★

이 섹션은 `domain_analysis_results.recommendation` 필드에 대한 **완전한 참조 문서**입니다.

### 8.1 recommendation 값의 생성 과정

```
1. Manus AI가 SimilarWeb 트래픽 데이터 수집
2. threat_score 계산: size_score + growth_score + type_score
3. 트래픽 패턴 분석 (traffic_analysis)
4. 종합 판단하여 recommendation + recommendation_detail 생성
```

**핵심**: `recommendation` 값은 Manus AI가 자연어로 생성합니다. 고정된 ENUM이 아니라 AI가 상황에 맞게 다양한 표현을 사용할 수 있습니다. 아래는 프론트엔드에서 매핑하는 대표 패턴입니다.

### 8.2 recommendation 값 분류 체계

프론트엔드(`frontend/src/app/domain-analysis/page.tsx`)의 `recBadgeColor` 함수가 사용하는 **키워드 기반 분류**:

| 우선순위 | 키워드 포함 여부 | 뱃지 색상 | 의미 | 대응 수준 |
|---------|----------------|----------|------|----------|
| 1 (최고) | `최상위` 또는 `타겟 지정` | 빨간색 (`red`) | 최상위 위험 도메인, 타겟 지정 차단 필요 | **즉시 조치** |
| 2 | `OSINT` 또는 `조사` | 주황색 (`orange`) | OSINT 조사 필요, 운영자/인프라 추적 | **심층 조사** |
| 3 | `DMCA` 또는 `집중 강화` | 황갈색 (`amber`) | DMCA 집중 강화 신고 권고 | **적극 신고** |
| 4 | `긴급` 또는 `격상` | 노란색 (`yellow`) | 긴급 주의, 위험 등급 격상 | **긴급 대응** |
| 5 | `신규` 또는 `주시` | 라임색 (`lime`) | 신규 도메인 또는 주시 필요 | **관찰 강화** |
| 6 | `모니터링 유지` 또는 `모니터링` | 초록색 (`green`) | 현재 수준 모니터링 유지 | **현상 유지** |
| 7 | `조치 효과` 또는 `확인` | 하늘색 (`sky`) | 이전 조치의 효과 확인됨 | **효과 검증** |
| 기타 | 위 키워드 없음 | 회색 (`gray`) | 분류 불가 또는 기타 | **별도 검토** |

### 8.3 recommendation 실제 값 예시

Manus AI가 생성하는 실제 `recommendation` 값 예시:

```
- "최상위 위험 - 타겟 지정 차단"
- "OSINT 조사 및 운영자 추적 권고"
- "DMCA 집중 강화 신고"
- "긴급 주의 - 위험 등급 격상"
- "신규 도메인 주시 필요"
- "모니터링 유지"
- "조치 효과 확인 - 트래픽 감소 중"
- "Urgent Block"
- "Priority Block"
- "Block"
- "Monitor"
- "Low Priority"
- "No Data"
```

### 8.4 recommendation_detail 예시

```
"이 도메인은 월간 250만 방문, 전월 대비 45% 급증. Scanlation Group으로
직접 번역·스캔을 수행하며 글로벌 순위 12,300위. 즉시 DMCA 차단 신고와
함께 CDN(Cloudflare) 어뷰즈 리포트를 병행할 것을 권고."

"글로벌 순위 85,000위 → 72,000위로 상승. 방문자 130만 → 180만 (38% 증가).
Aggregator 유형으로 다수 Scanlation 소스를 수집해 제공. 현재 DMCA 차단률 42%.
차단 신고 빈도를 주 3회로 격상하고, 호스팅 업체(Cloudflare, DMCA.com)에
직접 어뷰즈 리포트 발송 권고."

"트래픽 데이터 없음 (SimilarWeb 미수집). 도메인 등록일 최근이거나
방문자가 극소. 향후 모니터링 리스트에서 추적 필요."
```

### 8.5 위협 점수(threat_score)와 recommendation의 관계

| threat_score 범위 | 일반적 recommendation 패턴 | 설명 |
|-------------------|--------------------------|------|
| 70~100 | `최상위`, `타겟 지정`, `Urgent Block` | 대규모 + 고위험 유형 + 급성장 |
| 50~69 | `DMCA 집중 강화`, `Priority Block` | 중~대규모 + 위험 유형 |
| 30~49 | `긴급 주시`, `Block` | 중규모 또는 급성장 |
| 10~29 | `모니터링 유지`, `Monitor` | 소규모 또는 감소 추세 |
| 0~9 | `Low Priority`, `No Data` | 미미하거나 데이터 없음 |

> **주의**: 위 범위는 일반적인 패턴이며, Manus AI가 상황(급격한 성장, 특수 유형 등)에 따라 다르게 판단할 수 있습니다.

### 8.6 불법 사이트 도메인과 권고사항의 관계

**불법 사이트 도메인 전체 흐름**:

```
[sites 테이블] (type='illegal')
  │
  ├── domain: 불법 사이트 도메인 (마스터 목록)
  ├── site_type: scanlation_group / aggregator / clone / blog / unclassified
  ├── site_status: active / closed / changed
  ├── language: 사이트 언어
  └── distribution_channel: 유통 경로 (웹/APK/텔레그램/디스코드)
         │
         ▼ (월간 분석 시 sites.site_type 참조하여 type_score 부여)
         │
[domain_analysis_results 테이블]
  │
  ├── threat_score: 종합 위협 점수 (size + growth + type)
  ├── recommendation: ★ AI 권고사항
  ├── recommendation_detail: ★ AI 권고 상세
  ├── traffic_analysis: 트래픽 분석 요약
  ├── total_visits / unique_visitors / bounce_rate: 트래픽 지표
  └── visits_change_mom / rank_change_mom: 전월 대비 변동
```

**다른 서비스에서 불법 사이트 + 권고사항 조회**:

```sql
-- 현재 활성 불법 사이트의 최신 분석 결과 + 권고사항 한번에 조회
SELECT 
  s.domain,
  s.site_type,
  s.site_status,
  s.language,
  s.distribution_channel,
  dar.threat_score,
  dar.recommendation,
  dar.recommendation_detail,
  dar.traffic_analysis,
  dar.traffic_analysis_detail,
  dar.total_visits,
  dar.unique_visitors,
  dar.visits_change_mom,
  dar.size_score,
  dar.growth_score,
  dar.type_score,
  dar.global_rank,
  dar.bounce_rate,
  dar.discovered
FROM sites s
LEFT JOIN LATERAL (
  SELECT dar.*
  FROM domain_analysis_results dar
  JOIN domain_analysis_reports rp ON dar.report_id = rp.id
  WHERE dar.domain = s.domain
    AND rp.status = 'completed'
  ORDER BY rp.analysis_month DESC
  LIMIT 1
) dar ON true
WHERE s.type = 'illegal'
  AND s.site_status = 'active'
ORDER BY dar.threat_score DESC NULLS LAST;
```

```sql
-- 최근 N개월간 특정 도메인의 권고사항 변동 추적
SELECT 
  rp.analysis_month,
  dar.threat_score,
  dar.recommendation,
  dar.recommendation_detail,
  dar.total_visits,
  dar.visits_change_mom
FROM domain_analysis_results dar
JOIN domain_analysis_reports rp ON dar.report_id = rp.id
WHERE dar.domain = 'example-pirate.com'
  AND rp.status = 'completed'
ORDER BY rp.analysis_month DESC;
```

---

## 9. 외부 서비스에서 DB 연동 코드 예시

### 9.1 Node.js (@neondatabase/serverless)

Jobdori와 동일한 방식. Serverless 환경(Vercel, Cloudflare Workers 등)에 최적.

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// 불법 사이트 목록 조회
async function getIllegalSites() {
  const sites = await sql`
    SELECT domain, site_type, site_status, language, distribution_channel
    FROM sites
    WHERE type = 'illegal' AND site_status = 'active'
    ORDER BY domain
  `;
  return sites;
}

// 최신 월간 분석 결과 + 권고사항 조회
async function getLatestAnalysis() {
  const results = await sql`
    SELECT dar.domain, dar.threat_score, dar.recommendation,
           dar.recommendation_detail, dar.total_visits, dar.site_type
    FROM domain_analysis_results dar
    JOIN domain_analysis_reports rp ON dar.report_id = rp.id
    WHERE rp.status = 'completed'
      AND rp.analysis_month = (
        SELECT MAX(analysis_month) FROM domain_analysis_reports WHERE status = 'completed'
      )
    ORDER BY dar.rank
  `;
  return results;
}
```

### 9.2 Node.js (pg - 표준 PostgreSQL)

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function getIllegalDomains() {
  const { rows } = await pool.query(
    `SELECT domain, site_type, site_status FROM sites WHERE type = 'illegal' ORDER BY domain`
  );
  return rows;
}
```

### 9.3 Python (psycopg2)

```python
import psycopg2
import os

conn = psycopg2.connect(os.environ['DATABASE_URL'], sslmode='require')
cur = conn.cursor()

# 불법 사이트 목록 + 최신 권고사항
cur.execute("""
    SELECT s.domain, s.site_type, s.site_status, s.language,
           dar.threat_score, dar.recommendation, dar.recommendation_detail
    FROM sites s
    LEFT JOIN LATERAL (
        SELECT dar.*
        FROM domain_analysis_results dar
        JOIN domain_analysis_reports rp ON dar.report_id = rp.id
        WHERE dar.domain = s.domain AND rp.status = 'completed'
        ORDER BY rp.analysis_month DESC LIMIT 1
    ) dar ON true
    WHERE s.type = 'illegal' AND s.site_status = 'active'
    ORDER BY dar.threat_score DESC NULLS LAST
""")

for row in cur.fetchall():
    print(row)

cur.close()
conn.close()
```

### 9.4 Python (SQLAlchemy)

```python
from sqlalchemy import create_engine, text
import os

engine = create_engine(os.environ['DATABASE_URL'])

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT domain, site_type, site_status, language, distribution_channel
        FROM sites WHERE type = 'illegal'
    """))
    for row in result:
        print(dict(row._mapping))
```

---

## 10. API 엔드포인트 참조

다른 서비스에서 DB 직접 접근 대신 **Jobdori API**를 통해 데이터에 접근할 수도 있습니다.

### 10.1 불법 사이트 관련

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/site-status` | 불법 사이트 전체 목록 (site_type, site_status, language, distribution_channel 포함) |
| PATCH | `/api/site-status/:domain/status` | 사이트 상태 변경 (active/closed/changed) |
| PATCH | `/api/site-status/:domain/language` | 사이트 언어 변경 |
| PATCH | `/api/sites/classify` | 사이트 분류 변경 (scanlation_group/aggregator/clone/blog) |
| GET | `/api/site-languages` | 언어 옵션 목록 |
| GET | `/api/distribution-channels` | 유통 경로 옵션 목록 |

### 10.2 월간 도메인 분석

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/domain-analysis/months` | 분석 가능 월 목록 |
| GET | `/api/domain-analysis/:month` | 특정 월 분석 결과 (권고사항 포함) |
| POST | `/api/domain-analysis/run` | 분석 실행 |
| GET | `/api/domain-analysis/status/:month` | 실행 상태 폴링 |
| POST | `/api/domain-analysis/process-result` | Manus 완료 후 결과 저장 |

### 10.3 통계/탐지

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/stats/by-domain` | 도메인별 탐지/신고/차단 통계 |
| GET | `/api/dashboard/months` | 대시보드용 월 목록 |
| GET | `/api/dashboard/:month` | 특정 월 대시보드 데이터 |
| GET | `/api/sessions` | 세션 목록 |
| GET | `/api/sessions/:id` | 세션 상세 |
| GET | `/api/sessions/:id/results` | 세션 탐지 결과 |

### 10.4 신고 추적

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/report-tracking/sessions` | 신고 추적 회차 목록 |
| GET | `/api/report-tracking/:sessionId` | 회차별 신고 목록 |
| GET | `/api/report-tracking/:sessionId/stats` | 회차별 신고 통계 |
| GET | `/api/report-tracking/pending-summary` | 대기 중 URL 요약 |
| PUT | `/api/report-tracking/:id/status` | 신고 상태 업데이트 |

### 10.5 작품/순위

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/titles` | 모니터링 대상 작품 목록 |
| GET | `/api/manta-rankings` | 최신 만타 순위 |
| GET | `/api/manta-rankings/:title/history` | 작품별 순위 히스토리 |

### 10.6 인증

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/auth/login` | 로그인 (JWT 토큰 발급) |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/auth/status` | 인증 상태 확인 |

> **인증 방식**: JWT 토큰 기반. `cookie`에 `auth_token`으로 저장됨. API 호출 시 쿠키 전송 필요.

---

## 11. Neon PostgreSQL 연결 시 주의사항

### 11.1 Connection Pooling

Neon은 서버리스 특성상 connection pooling이 중요합니다.

- **Serverless 환경** (Vercel, Cloudflare Workers): `@neondatabase/serverless` 사용 권장
- **Long-running 서버** (Express, Fastify): Neon pooling endpoint 사용 (`-pooler` 포함 URL)
- **Connection 문자열 구분**:
  - 직접 연결: `postgres://user:pw@ep-xxxx.us-east-2.aws.neon.tech/neondb`
  - Pooling: `postgres://user:pw@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb`

### 11.2 Cold Start

Neon의 서버리스 특성으로 첫 쿼리 시 cold start 지연(~1초)이 발생할 수 있습니다. 
Jobdori 백엔드에서는 Lazy Initialization으로 처리합니다.

### 11.3 읽기 전용 접근 설정 (권장)

외부 서비스에서 Jobdori DB에 접근할 때는 **별도의 읽기 전용 역할** 생성을 권장합니다.

```sql
-- Neon 콘솔에서 실행 (관리자)
CREATE ROLE jobdori_reader WITH LOGIN PASSWORD 'secure-password';
GRANT CONNECT ON DATABASE neondb TO jobdori_reader;
GRANT USAGE ON SCHEMA public TO jobdori_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO jobdori_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO jobdori_reader;
```

---

## 12. 부록: 전체 테이블 CREATE 문 (현재 스키마)

아래는 현재 운영 중인 **최종 스키마**를 정리한 DDL입니다. 새 환경에 DB를 복제하거나 스키마를 확인할 때 참고하세요.

```sql
-- ============================================
-- Jobdori Full Schema (2026-02-20 기준)
-- ============================================

-- 1. sessions
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(50) PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'running',
  titles_count INTEGER DEFAULT 0,
  keywords_count INTEGER DEFAULT 0,
  total_searches INTEGER DEFAULT 0,
  results_total INTEGER DEFAULT 0,
  results_illegal INTEGER DEFAULT 0,
  results_legal INTEGER DEFAULT 0,
  results_pending INTEGER DEFAULT 0,
  file_final_results VARCHAR(500),
  deep_monitoring_executed BOOLEAN DEFAULT false,
  deep_monitoring_targets_count INTEGER DEFAULT 0,
  deep_monitoring_new_urls INTEGER DEFAULT 0
);

-- 2. detection_results
CREATE TABLE IF NOT EXISTS detection_results (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) NOT NULL,
  title TEXT,
  search_query TEXT,
  url TEXT NOT NULL,
  domain VARCHAR(255),
  page INTEGER,
  rank INTEGER,
  initial_status VARCHAR(20),
  llm_judgment VARCHAR(20),
  llm_reason TEXT,
  final_status VARCHAR(20),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  snippet TEXT,
  source VARCHAR(20) DEFAULT 'regular',
  deep_target_id INTEGER,
  UNIQUE(session_id, url)
);

-- 3. sites
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('illegal', 'legal')),
  site_type VARCHAR(30) DEFAULT 'unclassified',
  site_status VARCHAR(20) DEFAULT 'active',
  new_url TEXT,
  distribution_channel VARCHAR(50) DEFAULT '웹',
  language VARCHAR(50) DEFAULT 'unset',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(domain, type)
);

-- 4. titles
CREATE TABLE IF NOT EXISTS titles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL UNIQUE,
  is_current BOOLEAN DEFAULT TRUE,
  manta_url TEXT,
  unofficial_titles JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. pending_reviews
CREATE TABLE IF NOT EXISTS pending_reviews (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL UNIQUE,
  urls JSONB DEFAULT '[]',
  titles JSONB DEFAULT '[]',
  llm_judgment VARCHAR(20),
  llm_reason TEXT,
  session_id VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. monthly_stats
CREATE TABLE IF NOT EXISTS monthly_stats (
  id SERIAL PRIMARY KEY,
  month VARCHAR(7) NOT NULL UNIQUE,
  sessions_count INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  illegal INTEGER DEFAULT 0,
  legal INTEGER DEFAULT 0,
  pending INTEGER DEFAULT 0,
  top_contents JSONB DEFAULT '[]',
  top_illegal_sites JSONB DEFAULT '[]',
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 7. manta_rankings
CREATE TABLE IF NOT EXISTS manta_rankings (
  title VARCHAR(500) PRIMARY KEY,
  manta_rank INTEGER,
  first_rank_domain VARCHAR(255),
  search_query VARCHAR(500),
  session_id VARCHAR(50),
  page1_illegal_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. manta_ranking_history
CREATE TABLE IF NOT EXISTS manta_ranking_history (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  manta_rank INTEGER,
  first_rank_domain VARCHAR(255),
  session_id VARCHAR(50),
  page1_illegal_count INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. report_tracking
CREATE TABLE IF NOT EXISTS report_tracking (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) NOT NULL,
  url TEXT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  title TEXT,
  report_status VARCHAR(20) DEFAULT '미신고',
  report_id VARCHAR(50),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, url)
);

-- 10. report_uploads
CREATE TABLE IF NOT EXISTS report_uploads (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) NOT NULL,
  report_id VARCHAR(50) NOT NULL,
  file_name VARCHAR(255),
  matched_count INTEGER DEFAULT 0,
  total_urls_in_html INTEGER DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. report_reasons
CREATE TABLE IF NOT EXISTS report_reasons (
  id SERIAL PRIMARY KEY,
  reason_text VARCHAR(255) UNIQUE NOT NULL,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. deep_monitoring_targets
CREATE TABLE IF NOT EXISTS deep_monitoring_targets (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  url_count INTEGER NOT NULL,
  base_keyword TEXT NOT NULL,
  deep_query TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  results_count INTEGER DEFAULT 0,
  new_urls_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(session_id, title, domain)
);

-- 13. excluded_urls
CREATE TABLE IF NOT EXISTS excluded_urls (
  id SERIAL PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. domain_analysis_reports
CREATE TABLE IF NOT EXISTS domain_analysis_reports (
  id SERIAL PRIMARY KEY,
  analysis_month VARCHAR(7) NOT NULL UNIQUE,
  status VARCHAR(20) DEFAULT 'pending',
  manus_task_id VARCHAR(100),
  total_domains INTEGER DEFAULT 0,
  report_blob_url TEXT,
  report_markdown TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- 15. domain_analysis_results
CREATE TABLE IF NOT EXISTS domain_analysis_results (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES domain_analysis_reports(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  domain VARCHAR(255) NOT NULL,
  threat_score DECIMAL(5,1) DEFAULT 0,
  global_rank INTEGER,
  total_visits BIGINT,
  unique_visitors BIGINT,
  bounce_rate DECIMAL(5,4),
  discovered INTEGER DEFAULT 0,
  visits_change_mom DECIMAL(7,1),
  rank_change_mom INTEGER,
  size_score DECIMAL(5,1),
  growth_score DECIMAL(5,1),
  type_score DECIMAL(5,1) DEFAULT 0,
  site_type VARCHAR(30),
  traffic_analysis VARCHAR(50),
  traffic_analysis_detail TEXT,
  recommendation TEXT,
  recommendation_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, domain)
);

-- 16. site_notes
CREATE TABLE IF NOT EXISTS site_notes (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(500) NOT NULL,
  note_type VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. distribution_channels
CREATE TABLE IF NOT EXISTS distribution_channels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. site_languages
CREATE TABLE IF NOT EXISTS site_languages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 인덱스
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_monthly_stats_month ON monthly_stats(month);
CREATE INDEX IF NOT EXISTS idx_sites_type ON sites(type);
CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_titles_is_current ON titles(is_current);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_domain ON pending_reviews(domain);
CREATE INDEX IF NOT EXISTS idx_manta_rankings_title ON manta_rankings(title);
CREATE INDEX IF NOT EXISTS idx_manta_ranking_history_title ON manta_ranking_history(title, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_tracking_session ON report_tracking(session_id, report_status);
CREATE INDEX IF NOT EXISTS idx_report_tracking_title ON report_tracking(title);
CREATE INDEX IF NOT EXISTS idx_deep_monitoring_session ON deep_monitoring_targets(session_id, status);
CREATE INDEX IF NOT EXISTS idx_domain_analysis_results_report ON domain_analysis_results(report_id, rank);
CREATE INDEX IF NOT EXISTS idx_site_notes_domain ON site_notes(domain);

-- ============================================
-- 기본 데이터
-- ============================================
INSERT INTO report_reasons (reason_text, usage_count) VALUES
  ('저작권 미확인', 100), ('검토 필요', 99), ('중복 신고', 98), ('URL 오류', 97)
ON CONFLICT (reason_text) DO NOTHING;

INSERT INTO distribution_channels (name, is_default) VALUES
  ('웹', true), ('APK', true), ('텔레그램', true), ('디스코드', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO site_languages (name, is_default) VALUES
  ('다국어', true), ('영어', true), ('스페인어', true), ('포르투갈어', true),
  ('러시아어', true), ('아랍어', true), ('태국어', true), ('인도네시아어', true), ('중국어', true)
ON CONFLICT (name) DO NOTHING;
```

---

## 13. FAQ

### Q1. 다른 서비스에서 불법 도메인 목록만 간단히 가져오려면?
```sql
SELECT domain FROM sites WHERE type = 'illegal' AND site_status = 'active';
```

### Q2. 특정 도메인이 불법인지 확인하려면?
```sql
SELECT COUNT(*) > 0 AS is_illegal
FROM sites WHERE domain = LOWER('example.com') AND type = 'illegal';
```

### Q3. 가장 위험한 도메인 TOP 10을 알려면?
```sql
SELECT dar.domain, dar.threat_score, dar.recommendation, dar.total_visits
FROM domain_analysis_results dar
JOIN domain_analysis_reports rp ON dar.report_id = rp.id
WHERE rp.analysis_month = (
  SELECT MAX(analysis_month) FROM domain_analysis_reports WHERE status = 'completed'
)
ORDER BY dar.threat_score DESC
LIMIT 10;
```

### Q4. 특정 월에 신규 발견된 불법 도메인은?
```sql
SELECT DISTINCT domain 
FROM detection_results 
WHERE session_id LIKE '2026-01%' AND final_status = 'illegal'
  AND domain NOT IN (
    SELECT DISTINCT domain FROM detection_results 
    WHERE session_id < '2026-01' AND final_status = 'illegal'
  );
```

### Q5. 마이그레이션은 어떻게 관리되나요?
별도의 마이그레이션 도구(Prisma Migrate, Drizzle Kit 등)를 사용하지 않습니다.
- `backend/src/lib/db.ts`의 `initializeDatabase()`: 코어 테이블 생성
- `backend/api/index.ts`의 `ensureDbMigration()`: 추가 칼럼/테이블 마이그레이션
- 모두 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` 패턴으로 멱등성 보장

### Q6. DB 스키마를 변경하려면?
`backend/api/index.ts`의 `ensureDbMigration()` 함수에 새 마이그레이션 코드를 추가합니다. `IF NOT EXISTS` 패턴을 사용하면 기존 배포에 영향 없이 점진적으로 적용됩니다.
