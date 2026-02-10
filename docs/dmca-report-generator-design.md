# DMCA 신고서 자동 생성 기능 설계서

> **버전**: v1.0  
> **작성일**: 2026-02-10  
> **관련 프로젝트**: Jobdori (TooR-oN/Jobdori)  
> **관련 문서**: docs/site-focused-monitoring-design.md

---

## 1. 기능 개요

### 1.1 목적
모니터링 세션에서 탐지된 불법 URL을 기반으로 **구글 DMCA 신고 폼에 바로 복사-붙여넣기 가능한 신고서를 작품별로 자동 생성**한다. 현재 수동으로 진행하는 URL 정리 및 신고서 작성 시간을 대폭 절감(약 90%)하는 것이 목표이다.

### 1.2 핵심 흐름
```
세션 상세 페이지 → [DMCA 신고서 생성] 버튼 클릭
→ 서버: report_tracking에서 불법 URL 수집
→ 제외 조건 필터링 (excluded_urls, 이미 처리된 상태, 중복 거부)
→ 작품별(title) 그룹핑
→ 구글 DMCA 폼 포맷으로 텍스트 생성
→ 프론트: 모달로 결과 표시 (작품별 복사 + 전체 복사 + TXT 다운로드)
```

### 1.3 대상 사용자
- admin, superadmin 역할의 사용자
- 하루 1건, 최대 20작품의 신고서 생성

---

## 2. URL 수집 및 필터링 규칙

### 2.1 데이터 소스
- **테이블**: `report_tracking`
- **조건**: `session_id = :sessionId`
- **참조 테이블**: `titles` (manta_url 조회), `excluded_urls` (제외 URL)

### 2.2 신고서에 포함되는 URL (Include)
| 조건 | 설명 |
|------|------|
| `report_status = '미신고'` AND `reason IS NULL` | 미신고이며 사유가 없는 URL |
| `report_status = '미신고'` AND `reason NOT ILIKE '%웹사이트 메인 페이지%'` | 미신고이지만 자동 제외 사유가 아닌 URL |
| `report_status = '거부'` AND `reason NOT ILIKE '%중복%'` | 거부되었지만 중복이 아닌 사유 (재신고 대상) |
| `report_status = '대기 중'` | 신고 후 대기 중인 URL (재확인용으로 포함) |

### 2.3 신고서에서 제외되는 URL (Exclude)
| 조건 | 설명 |
|------|------|
| `url IN (SELECT url FROM excluded_urls)` | 신고 제외 URL 목록에 등록된 URL |
| `report_status = '차단'` | 이미 차단 완료된 URL |
| `report_status = '색인없음'` | 색인에서 제거된 URL |
| `report_status = '거부'` AND `reason ILIKE '%중복%'` | 중복 요청 사유로 거부된 URL |
| `report_status = '미신고'` AND `reason = '웹사이트 메인 페이지'` | 자동 제외된 웹사이트 메인 페이지 |

### 2.4 중복 거부 키워드 매칭 규칙
```sql
-- 제외 조건: 거부 + 중복 키워드 포함
WHERE report_status = '거부' AND reason ILIKE '%중복%'
```

**매칭 근거**:
- 현재 사용 사유: `기존 요청과 중복된 요청` (드롭다운 고정 선택)
- `ILIKE '%중복%'`으로 매칭 시: ✅ 정확 매칭
- 다른 사유(`문제의 콘텐츠를 찾을 수 없음`, `모니터링 대상 작품 아님`, `웹사이트 메인 페이지`, `플랫폼에 신고 예정`)와 충돌 없음
- 향후 `중복` 키워드가 포함된 변형 입력에도 자동 대응

### 2.5 최종 SQL 쿼리 (의사 코드)
```sql
SELECT rt.url, rt.domain, rt.title, rt.report_status, rt.reason
FROM report_tracking rt
WHERE rt.session_id = :sessionId
  -- 제외: excluded_urls
  AND rt.url NOT IN (SELECT url FROM excluded_urls)
  -- 제외: 차단, 색인없음
  AND rt.report_status NOT IN ('차단', '색인없음')
  -- 제외: 중복 거부
  AND NOT (rt.report_status = '거부' AND rt.reason ILIKE '%중복%')
  -- 제외: 웹사이트 메인 페이지
  AND NOT (rt.reason = '웹사이트 메인 페이지')
ORDER BY rt.title ASC, rt.domain ASC, rt.url ASC
```

---

## 3. 출력 포맷

### 3.1 구글 DMCA 폼 포맷 (작품당 3개 블록)

구글 DMCA 폼(`reportcontent.google.com/forms/dmca_search`)의 입력 필드에 맞춰 작품별로 3개 블록을 생성한다.

#### 블록 1: 저작물 설명 (Identify and describe the copyrighted work)
```
<작품명> is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.
The whole webtoon is infringed on the pirate sites.
```
- `<작품명>`: `titles` 테이블의 `name` 필드 (공식 제목)
- 나머지 텍스트: 고정 템플릿 (2줄)

#### 블록 2: 공인된 저작물 URL (Where we can see an authorized example)
```
https://manta.net/en/series/작품-slug
```
- `titles` 테이블의 `manta_url` 필드에서 가져옴
- **manta_url이 없는 경우**: 공란 (빈 문자열)으로 표시

#### 블록 3: 침해 URL 목록 (Location of the infringing material)
```
https://example-illegal.com/manga/작품명/chapter-1
https://example-illegal.com/manga/작품명/chapter-2
https://another-site.com/read/작품명/ep-1
```
- 필터링된 URL을 **1줄에 1개씩** 나열
- URL 순서: 도메인별 → URL 알파벳순

### 3.2 전체 신고서 구조 (여러 작품)
```
=== 작품 1: A Wicked Husband ===

[저작물 설명]
A Wicked Husband is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.
The whole webtoon is infringed on the pirate sites.

[공인된 저작물 URL]
https://manta.net/en/series/a-wicked-husband?seriesId=3815

[침해 URL 목록] (12개)
https://kunmanga.com/manga/layers-of-the-night/chapter-15/
https://comix.to/title/z1ynm
...

========================================

=== 작품 2: Merry Her Obsession ===

[저작물 설명]
Merry Her Obsession is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.
The whole webtoon is infringed on the pirate sites.

[공인된 저작물 URL]
https://manta.net/en/series/merry-her-obsession?seriesId=5021

[침해 URL 목록] (8개)
https://mangadex.net/title/abc123
https://xbato.com/manga/merry-psycho
...
```

### 3.3 TXT 다운로드 포맷
- 위 전체 신고서를 그대로 `.txt` 파일로 다운로드
- 파일명: `DMCA_Report_{sessionId}_{날짜}.txt`
- 예시: `DMCA_Report_2026-02-10-1430_20260210.txt`

### 3.4 TCRP TXT 포맷 (향후 벌크 업로드 대비)
```
# A Wicked Husband is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.
# The whole webtoon is infringed on the pirate sites.
# https://manta.net/en/series/a-wicked-husband?seriesId=3815
https://kunmanga.com/manga/layers-of-the-night/chapter-15/
https://comix.to/title/z1ynm

# Merry Her Obsession is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.
# The whole webtoon is infringed on the pirate sites.
# https://manta.net/en/series/merry-her-obsession?seriesId=5021
https://mangadex.net/title/abc123
https://xbato.com/manga/merry-psycho
```
- TCRP 규격: `#`으로 시작하는 줄 = 설명/원본 URL, 그 아래 = 침해 URL
- 향후 RIDI가 TCRP에 가입하면 이 포맷으로 바로 업로드 가능

---

## 4. API 설계

### 4.1 신규 엔드포인트

#### `POST /api/sessions/:id/dmca-report/generate`

**설명**: 세션의 불법 URL을 수집하여 DMCA 신고서 데이터를 생성

**요청**:
```json
{
  "format": "google"  // "google" | "tcrp" (기본값: "google")
}
```

**응답 (성공)**:
```json
{
  "success": true,
  "report": {
    "session_id": "2026-02-10-1430",
    "generated_at": "2026-02-10T15:00:00Z",
    "format": "google",
    "summary": {
      "total_titles": 5,
      "total_urls": 47,
      "excluded_urls": 12,
      "included_urls": 35
    },
    "excluded_reasons": {
      "already_blocked": 5,
      "not_indexed": 2,
      "duplicate_rejected": 3,
      "main_page": 2
    },
    "works": [
      {
        "title": "A Wicked Husband",
        "manta_url": "https://manta.net/en/series/a-wicked-husband?seriesId=3815",
        "description": "A Wicked Husband is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.\nThe whole webtoon is infringed on the pirate sites.",
        "urls": [
          "https://kunmanga.com/manga/layers-of-the-night/chapter-15/",
          "https://comix.to/title/z1ynm"
        ],
        "url_count": 2
      }
    ],
    "full_text": "=== 작품 1: A Wicked Husband ===\n\n[저작물 설명]\nA Wicked Husband is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.\n...",
    "tcrp_text": "# A Wicked Husband is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.\n# The whole webtoon is infringed on the pirate sites.\n..."
  }
}
```

**응답 (대상 URL 없음)**:
```json
{
  "success": true,
  "report": {
    "session_id": "2026-02-10-1430",
    "summary": {
      "total_titles": 0,
      "total_urls": 0,
      "included_urls": 0
    },
    "works": [],
    "full_text": "",
    "message": "신고 대상 URL이 없습니다."
  }
}
```

**에러 응답**:
```json
{
  "success": false,
  "error": "Session not found"
}
```

### 4.2 인증
- 기존 인증 미들웨어 사용 (로그인 필요)
- 역할 제한 없음 (admin, user 모두 사용 가능)

---

## 5. 데이터 흐름

```
[프론트엔드]                              [백엔드 API]                           [DB]
    │                                         │                                    │
    │  ① 버튼 클릭                             │                                    │
    │─── POST /sessions/:id/dmca-report ──→  │                                    │
    │    /generate                            │                                    │
    │                                         │  ② 세션 존재 확인                    │
    │                                         │──── SELECT * FROM sessions ──────→ │
    │                                         │                                    │
    │                                         │  ③ excluded_urls 조회               │
    │                                         │──── SELECT url FROM ─────────────→ │
    │                                         │     excluded_urls                   │
    │                                         │                                    │
    │                                         │  ④ report_tracking 조회 + 필터링     │
    │                                         │──── SELECT * FROM ───────────────→ │
    │                                         │     report_tracking                │
    │                                         │     WHERE session_id = :id         │
    │                                         │     AND 필터 조건                    │
    │                                         │                                    │
    │                                         │  ⑤ titles + manta_url 조회          │
    │                                         │──── SELECT name, manta_url ──────→ │
    │                                         │     FROM titles                    │
    │                                         │     WHERE is_current = true        │
    │                                         │                                    │
    │                                         │  ⑥ 작품별 그룹핑 + 텍스트 생성        │
    │                                         │                                    │
    │  ⑦ 응답 수신                             │                                    │
    │←── report JSON ────────────────────────│                                    │
    │                                         │                                    │
    │  ⑧ 모달 표시                             │                                    │
    │  (작품별 복사/전체 복사/TXT 다운로드)       │                                    │
```

---

## 6. 프론트엔드 UI 설계

### 6.1 버튼 위치
- **페이지**: `/sessions/[id]` (세션 상세 페이지)
- **위치**: 상단 액션 바 (다운로드 버튼 옆)
- **버튼 텍스트**: `DMCA 신고서 생성`
- **아이콘**: `DocumentTextIcon` (heroicons)
- **스타일**: 주황색 계열 버튼 (기존 파란색/녹색 버튼과 구분)
- **조건**: 세션 status가 `completed`일 때만 활성화

### 6.2 모달 (DmcaReportModal)

#### 모달 헤더
```
┌─────────────────────────────────────────┐
│  DMCA 신고서 - 2026-02-10-1430          │
│  작품 5개 · URL 35개                     │
│  [전체 복사] [TXT 다운로드] [닫기]         │
└─────────────────────────────────────────┘
```

#### 모달 본문 (작품별 아코디언)
```
┌─────────────────────────────────────────┐
│ ▼ 작품 1: A Wicked Husband (12개 URL)    │
│   ┌─────────────────────────────────┐   │
│   │ [저작물 설명]              [복사] │   │
│   │ A Wicked Husband is a webtoon   │   │
│   │ (comic, manga, etc.) owned and │   │
│   │ copyrighted by RIDI Corporation│   │
│   │ The whole webtoon is infringed │   │
│   │ on the pirate sites.           │   │
│   ├─────────────────────────────────┤   │
│   │ [공인된 저작물 URL]        [복사] │   │
│   │ https://manta.net/en/series/... │   │
│   ├─────────────────────────────────┤   │
│   │ [침해 URL 목록]            [복사] │   │
│   │ https://kunmanga.com/manga/...  │   │
│   │ https://comix.to/title/z1ynm   │   │
│   │ ... (12개)                      │   │
│   └─────────────────────────────────┘   │
│                                         │
│ ▶ 작품 2: Merry Her Obsession (8개 URL) │
│ ▶ 작품 3: Solo Leveling (15개 URL)       │
└─────────────────────────────────────────┘
```

#### 모달 푸터 (제외 요약)
```
┌─────────────────────────────────────────┐
│  제외된 URL: 12개                        │
│  - 이미 차단: 5 · 색인없음: 2             │
│  - 중복 거부: 3 · 메인 페이지: 2          │
└─────────────────────────────────────────┘
```

### 6.3 복사 기능
- **작품별 [복사]**: 해당 블록의 텍스트만 클립보드에 복사
- **[전체 복사]**: 전체 신고서 텍스트를 클립보드에 복사
- 복사 성공 시 버튼이 잠시 "복사됨 ✓"으로 변경 (2초 후 원래로)

### 6.4 TXT 다운로드
- `[TXT 다운로드]` 클릭 시 `full_text`를 `.txt` 파일로 다운로드
- 프론트엔드에서 Blob 생성 → `<a>` 태그 다운로드 (서버 추가 요청 없음)
- 파일명: `DMCA_Report_{sessionId}_{YYYYMMDD}.txt`

---

## 7. 성능 및 제약 사항

### 7.1 성능 예상
| 항목 | 예상값 | 근거 |
|------|--------|------|
| DB 쿼리 수 | 4회 | sessions 확인 + excluded_urls + report_tracking + titles |
| 처리 대상 URL | 최대 ~500개 | 세션당 report_tracking 최대 예상 |
| 응답 시간 | 1~3초 | DB 조회 + 텍스트 조합만 (외부 API 미사용) |
| Vercel 30초 제한 | 안전 | 외부 API 호출 없음 |

### 7.2 제약 사항
- 신고서 생성은 **읽기 전용** (DB에 별도 저장하지 않음)
- 모달에서 표시되는 데이터는 **실시간 생성** (캐시 없음)
- 모달을 닫으면 데이터가 사라짐 → 필요 시 TXT 다운로드로 보관
- 신고자 정보(이름/이메일 등)는 포함하지 않음 (수동 입력)

---

## 8. DB 변경 사항

### 8.1 스키마 변경: 없음
기존 테이블(`report_tracking`, `titles`, `excluded_urls`)만 **읽기(SELECT)** 하며, 신규 테이블이나 컬럼 추가가 필요하지 않다.

### 8.2 참조하는 기존 테이블
| 테이블 | 사용 필드 | 용도 |
|--------|----------|------|
| `sessions` | `id`, `status` | 세션 존재 및 완료 확인 |
| `report_tracking` | `session_id`, `url`, `domain`, `title`, `report_status`, `reason` | 불법 URL 수집 및 필터링 |
| `excluded_urls` | `url` | 신고 제외 URL 목록 |
| `titles` | `name`, `manta_url` | 작품명 및 공인 URL |

---

## 9. 파일 변경 요약

### 9.1 수정 파일
| 파일 | 변경 내용 |
|------|----------|
| `backend/api/index.ts` | `POST /api/sessions/:id/dmca-report/generate` 엔드포인트 추가 |
| `frontend/src/lib/api.ts` | `dmcaReportApi` 객체 추가 |
| `frontend/src/app/sessions/[id]/page.tsx` | DMCA 신고서 생성 버튼 + 모달 컴포넌트 추가 |

### 9.2 신규 파일: 없음
- 별도 파일 생성 없이 기존 파일에 추가하는 방식

---

## 10. 향후 확장 가능성

| 확장 기능 | 설명 | 우선순위 |
|----------|------|---------|
| TCRP TXT 다운로드 | TCRP 가입 후 벌크 업로드용 TXT 별도 다운로드 | 중기 |
| 신고서 생성 이력 저장 | 언제 어떤 세션에서 신고서를 생성했는지 기록 | 낮음 |
| 다중 세션 통합 신고서 | 여러 세션의 URL을 모아 하나의 신고서 생성 | 낮음 |
| 자동 제출 연동 | TCRP 또는 외부 서비스 API 연동 | 장기 |

---

## 11. 용어 정리

| 용어 | 설명 |
|------|------|
| DMCA | Digital Millennium Copyright Act (미국 디지털 밀레니엄 저작권법) |
| TCRP | Trusted Copyright Removal Program (구글 신뢰 저작권 제거 프로그램) |
| report_tracking | 불법 URL의 신고 상태를 추적하는 DB 테이블 |
| excluded_urls | 신고에서 제외할 URL 목록을 관리하는 DB 테이블 |
| manta_url | titles 테이블의 Manta 플랫폼 공식 작품 URL 필드 |
| 미신고 | 아직 구글에 신고하지 않은 상태 |
| 차단 | 구글에서 검색 결과에서 제거된 상태 |
| 색인없음 | 구글 검색 색인에서 이미 제거된 상태 |
| 거부 | 구글이 신고를 거부한 상태 |
| 대기 중 | 신고 후 구글 처리 대기 중인 상태 |
