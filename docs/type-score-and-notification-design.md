# 사이트 분류(type_score) 관리 + 알림 시스템 + UI 개선 설계서

**문서 버전**: v1.0  
**작성일**: 2026-02-13  
**전제**: Semrush 제거 및 위협점수 재설계와 함께 진행

---

## 1. 변경 배경

### 1.1 위협점수 재설계

**변경 전** (100점 만점):
```
threat_score = size_score(40) + growth_score(40) + influence_score(20)
                                                    ↑ Semrush 기반 → 제거
```

**변경 후** (100점 만점):
```
threat_score = size_score(35) + growth_score(30) + type_score(35)
               SimilarWeb 기반    SimilarWeb 기반    사용자가 DB에 입력
```

### 1.2 type_score 도입

사이트 유형(스캔레이션, 어그리게이터, 클론 등)에 따라 법적 대응 우선순위가 다르므로, 사용자가 직접 분류하고 점수를 부여한다.

| 분류 | 설명 | 점수 |
|---|---|---|
| **Scanlation Group** | 직접 번역/업로드 그룹 | 35 |
| **Aggregator** | 사용자 업로드 (ex. bato.to, mangadex.org) | 20 |
| **Clone** | 재불펌 사이트 | 10 |
| **Blog** | WordPress 등 블로그 기반 | 5 |
| **미분류 (Unclassified)** | 아직 분류되지 않은 도메인 (기본값) | 0 |

---

## 2. size_score 세부 기준 (변경)

**최대: 35점**

| 조건 | 점수 |
|---|---|
| `total_visits >= 50,000,000` (5천만) | 35 |
| `total_visits >= 30,000,000` (3천만) | 30 |
| `total_visits >= 10,000,000` (1천만) | 25 |
| `total_visits >= 5,000,000` (5백만) | 20 |
| `total_visits >= 1,000,000` (100만) | 15 |
| `total_visits >= 500,000` (50만) | 10 |
| `total_visits >= 100,000` (10만) | 5 |
| 그 외 | 0 |
| **보너스**: `global_rank <= 1,000` | +5 (최대 **35** 캡) |

## 3. growth_score 세부 기준 (변경)

**최대: 30점**

| 조건 | 점수 |
|---|---|
| `visits_change_mom >= 50%` | 30 |
| `visits_change_mom >= 35%` | 25 |
| `visits_change_mom >= 20%` | 20 |
| `visits_change_mom >= 13%` | 15 |
| `visits_change_mom >= 5%` | 10 |
| `visits_change_mom >= 0%` | 5 |
| `visits_change_mom < 0%` | 2 |
| 전월 데이터 없음 | 0 |

---

## 4. DB 변경

### 4.1 `sites` 테이블에 `site_type` 컬럼 추가

```sql
ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_type VARCHAR(30) DEFAULT 'unclassified';
```

유효 값: `'scanlation_group'`, `'aggregator'`, `'clone'`, `'blog'`, `'unclassified'`

**선택 이유**: 한 번 분류하면 영구 유지되므로 매월 재분류 불필요. sites 테이블의 `type = 'illegal'`인 도메인에 대해서만 site_type을 관리.

### 4.2 `domain_analysis_results` 테이블 변경

Semrush 컬럼 제거 + type_score 추가:

```sql
-- Semrush 컬럼 삭제
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS total_backlinks;
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS referring_domains;
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS top_organic_keywords;
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS top_referring_domains;
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS top_anchors;
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS branded_traffic_ratio;
ALTER TABLE domain_analysis_results DROP COLUMN IF EXISTS influence_score;

-- type_score 추가
ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS site_type VARCHAR(30);
ALTER TABLE domain_analysis_results ADD COLUMN IF NOT EXISTS type_score DECIMAL(5,1) DEFAULT 0;
```

### 4.3 type_score 매핑 (코드에서 관리)

```typescript
const TYPE_SCORE_MAP: Record<string, number> = {
  'scanlation_group': 35,
  'aggregator': 20,
  'clone': 10,
  'blog': 5,
  'unclassified': 0,
};
```

---

## 5. 마누스 프롬프트 변경

### 5.1 도메인 목록 전달 시 type_score 포함

현재:
```
## Target Domains
mangadex.org
bato.to
...
```

변경 후:
```
## Target Domains (with site type and type_score)
mangadex.org | aggregator | 20
bato.to | aggregator | 20
toonily.com | scanlation_group | 35
manga1001.com | clone | 10
...

## Scoring Rules
threat_score = size_score (max 35) + growth_score (max 30) + type_score (from above)
(type_score is pre-assigned by the user. Use the value provided above for each domain.)
```

### 5.2 데이터 흐름

```
[분석 실행 시]
  1. detection_results에서 상위 50개 도메인 조회
  2. sites 테이블에서 각 도메인의 site_type 조회
  3. TYPE_SCORE_MAP으로 type_score 변환
  4. 프롬프트에 도메인 + site_type + type_score 포함
  5. Manus가 size_score + growth_score 계산 후 type_score 합산
  6. 결과 파싱 시 domain_analysis_results에 site_type, type_score 저장
```

---

## 6. 알림 시스템 (프론트엔드 기반)

### 6.1 설계 방식

**DB 저장 없이 프론트엔드에서 날짜 기반으로 자동 판단**:
- 매월 1일~말일: `sites` 테이블에서 `type='illegal' AND site_type='unclassified'`인 도메인 수를 조회
- 미분류 도메인이 1개 이상이면 알림 표시

### 6.2 API 엔드포인트 (신규)

**`GET /api/notifications/unclassified-count`**

```json
{
  "success": true,
  "count": 12,
  "message": "12개 불법 도메인의 사이트 분류가 필요합니다."
}
```

### 6.3 헤더 UI 변경

현재 헤더 (`MainLayout.tsx` line 33~47):
```
[햄버거] [페이지 제목]                    [빈 공간(모바일)]
```

변경 후:
```
[햄버거] [페이지 제목]                    [🔔 알림 아이콘] [빈 공간(모바일)]
```

- 알림 아이콘: heroicons의 `BellIcon`
- 미분류 도메인 > 0이면 아이콘 위에 빨간 배지(숫자)
- 클릭 시 아이콘 하단에 드롭다운(토스트) 표시
- 알림 항목: "N개 불법 도메인의 사이트 분류가 필요합니다" + 파란 unread 점
- 알림 클릭 → `/stats/domain` 이동 + unread 점 제거 (세션 스토리지로 관리)

### 6.4 Unread 관리

- **sessionStorage** 사용 (`notification_domain_classify_read` 키)
- 알림 클릭 시 sessionStorage에 `true` 저장 → 파란 점 제거
- 새 브라우저 세션마다 초기화 → 다시 파란 점 표시
- 미분류 도메인이 0이 되면 알림 자체가 사라짐

---

## 7. 도메인별 신고/차단 통계 UI 변경

### 7.1 "1달 전" 버튼 추가

현재 필터 영역:
```
[시작일: ____] [종료일: ____] [조회] [초기화]
```

변경 후:
```
[시작일: ____] [종료일: ____] [조회] [초기화] [1달 전]
```

**동작**: 클릭 시 직전 달 1일~말일로 자동 설정 후 조회
- 예: 2026-02-13에 클릭 → 시작일 `2026-01-01`, 종료일 `2026-01-31`

### 7.2 사이트 분류 드롭다운 컬럼 추가

현재 테이블:
```
| 순위 | 도메인 | 발견 | 신고 | 차단 | 차단율 |
```

변경 후:
```
| 순위 | 분류 | 도메인 | 발견 | 신고 | 차단 | 차단율 |
```

**분류 컬럼 동작**:
- 드롭다운 select 표시: `Scanlation Group` / `Aggregator` / `Clone` / `Blog` / `미분류`
- 선택 변경 시 즉시 API 호출 → `sites` 테이블의 `site_type` 업데이트
- 미분류 상태는 회색 텍스트로 구분

### 7.3 필요한 API 엔드포인트

**`PATCH /api/sites/classify`**

```json
// Request
{
  "domain": "mangadex.org",
  "site_type": "aggregator"
}

// Response
{
  "success": true,
  "domain": "mangadex.org",
  "site_type": "aggregator",
  "type_score": 20
}
```

**동작**:
1. `sites` 테이블에서 해당 도메인의 `site_type` 업데이트
2. 해당 도메인이 `sites` 테이블에 없으면 자동 추가 (`type='illegal'`)
3. type_score는 응답에만 포함 (DB에는 site_type만 저장, 점수는 코드에서 매핑)

### 7.4 기존 API 변경

**`GET /api/stats/by-domain`** 응답에 `site_type` 추가:

```json
{
  "success": true,
  "stats": [
    {
      "domain": "mangadex.org",
      "site_type": "aggregator",
      "discovered": 142,
      "reported": 130,
      "blocked": 125,
      "blockRate": 96.2
    }
  ],
  "total": 45
}
```

SQL 변경: `sites` 테이블과 LEFT JOIN하여 `site_type` 가져오기

---

## 8. 영향 분석

### 변경되는 파일

| 파일 | 변경 내용 |
|---|---|
| `backend/api/index.ts` | DB 마이그레이션(sites, domain_analysis_results), API 3개 추가/변경, Semrush 제거 |
| `backend/scripts/domain-analysis.ts` | buildAnalysisPrompt에 type_score 포함, DomainAnalysisResult 인터페이스 변경, Semrush 필드 제거 |
| `backend/scripts/run-pipeline.ts` | 자동 실행 시 type_score 데이터 포함 |
| `docs/manus-traffic-analysis-instruction.json` | Semrush 제거, scoring_rules 변경, type_score 추가 |
| `frontend/src/components/layout/MainLayout.tsx` | 헤더에 알림 아이콘 추가 |
| `frontend/src/components/layout/Header.tsx` | (MainLayout에 통합되어 있으므로 변경 불필요) |
| `frontend/src/app/stats/domain/page.tsx` | 분류 드롭다운 + 1달 전 버튼 추가 |
| `frontend/src/lib/api.ts` | statsApi 변경, sitesApi에 classify 추가, notificationApi 추가 |
| `frontend/src/app/domain-analysis/page.tsx` | Semrush 관련 컬럼 제거, type_score 컬럼 추가 |

### 변경되지 않는 파일

| 파일 | 이유 |
|---|---|
| Sidebar.tsx | 메뉴 구조 변경 없음 |
| 기타 모든 페이지 | 영향 없음 |

---

## 9. 구현 순서

1. **DB 마이그레이션**: sites에 site_type 추가, domain_analysis_results에서 Semrush 제거 + type_score 추가
2. **백엔드 API**: classify API, unclassified-count API, by-domain 응답 변경
3. **instruction JSON + 프롬프트**: Semrush 제거, 점수 재설계, type_score 추가
4. **프론트엔드 - 도메인별 통계 페이지**: 분류 드롭다운, 1달 전 버튼
5. **프론트엔드 - 알림 아이콘**: 헤더에 알림 추가
6. **프론트엔드 - 도메인 분석 페이지**: Semrush 컬럼 제거, type_score 반영
7. **테스트 & 커밋**
