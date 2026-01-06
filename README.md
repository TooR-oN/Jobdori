# 웹툰 불법사이트 모니터링 툴

구글 검색 결과를 기반으로 웹툰/만화 불법 유통 사이트를 자동으로 모니터링하고 관리하는 도구입니다.

## 주요 기능

### ✅ 완료된 기능
1. **구글 검색 (Serper.dev API)**: 작품별 키워드 조합으로 검색, 페이지 1-3 결과 수집
2. **1차 판별 (리스트 대조)**: 사전 정의된 불법/합법 사이트 리스트와 자동 대조
3. **2차 판별 (Gemini LLM)**: 미분류 도메인에 대해 AI 기반 불법 여부 판단
4. **승인 UI (웹페이지)**: 승인/거절/보류 버튼으로 관리자 최종 확인
5. **자동 리스트 업데이트**: 승인된 도메인이 불법 사이트 리스트에 자동 추가
6. **Excel 리포트 생성**: 전체 결과를 Excel 파일로 출력

## 프로젝트 구조

```
webapp/
├── data/
│   ├── config.json           # 설정 파일
│   ├── titles.xlsx           # [입력] 작품 제목 리스트
│   ├── keywords.txt          # 검색 키워드 (manga, manhwa, chapter)
│   ├── illegal-sites.txt     # 불법 사이트 도메인 리스트
│   ├── legal-sites.txt       # 합법 사이트 도메인 리스트
│   ├── illegal-criteria.txt  # LLM 판별 지침서
│   └── pending-review.json   # 승인 대기 목록
├── scripts/
│   ├── search.ts             # Step 1: 구글 검색
│   ├── classify.ts           # Step 2: 1차 판별
│   ├── llm-judge.ts          # Step 3: 2차 판별 (LLM)
│   ├── run-all.ts            # 전체 파이프라인 실행
│   └── test-pipeline.ts      # 테스트용 간소화 파이프라인
├── src/
│   └── server.ts             # 승인 UI 웹서버
├── output/                   # 리포트 출력 폴더
├── .env                      # API 키 (gitignore됨)
└── package.json
```

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경변수 설정
`.env` 파일에 API 키 입력:
```
SERPER_API_KEY=your_serper_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### 3. 작품 리스트 준비
`data/titles.xlsx` 파일에 모니터링할 작품 제목 입력 (영문, 한 줄에 하나)

### 4. 전체 파이프라인 실행
```bash
npm run run-all
```

### 5. 승인 UI 실행
```bash
npm run dev:server
# 브라우저에서 http://localhost:3000 접속
```

## 개별 모듈 실행

```bash
# 검색만 실행
npm run search

# 1차 판별만 실행
npm run classify

# 2차 판별 (LLM)만 실행
npm run llm-judge

# 테스트 파이프라인 (간소화)
npx tsx scripts/test-pipeline.ts
```

## 실행 흐름

```
1. 구글 검색 (Serper.dev)
   └─ 작품 10개 × 키워드 3개 = 30번 검색
   └─ 검색당 최대 50개 결과 (페이지 1-3)
        ↓
2. 1차 판별 (리스트 대조)
   └─ illegal-sites.txt → status: "illegal"
   └─ legal-sites.txt → status: "legal"
   └─ 없음 → status: "unknown"
        ↓
3. 2차 판별 (Gemini LLM)
   └─ unknown 도메인만 LLM 판별
   └─ llm_judgment: "likely_illegal" / "likely_legal" / "uncertain"
        ↓
4. 승인 대기 목록 생성
   └─ data/pending-review.json 업데이트
        ↓
5. 승인 UI에서 관리자 확인
   └─ [승인] → illegal-sites.txt에 추가
   └─ [거절] → legal-sites.txt에 추가
   └─ [보류] → 다음에 재검토
        ↓
6. Excel 리포트 생성
   └─ output/report_YYYYMMDD_HHMMSS.xlsx
```

## Excel 리포트 컬럼

| 컬럼 | 설명 |
|------|------|
| title | 작품명 |
| domain | 메인 도메인 |
| url | 전체 URL |
| search_query | 검색어 |
| page | 검색 결과 페이지 (1-3) |
| rank | 순위 |
| status | 1차 판별 결과 (illegal/legal/unknown) |
| llm_judgment | LLM 판단 |
| llm_reason | LLM 판단 근거 |
| final_status | 최종 상태 (illegal/legal/pending) |
| reviewed_at | 승인 처리 일시 |

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/` | 승인 UI 메인 페이지 |
| GET | `/api/pending` | 승인 대기 목록 조회 |
| GET | `/api/stats` | 통계 조회 |
| POST | `/api/review` | 승인/거절/보류 처리 |
| GET | `/api/sites/:type` | 불법/합법 사이트 리스트 조회 |

## 설정 (data/config.json)

```json
{
  "search": {
    "delayBetweenSearches": { "min": 5000, "max": 10000 },
    "delayBetweenPages": { "min": 3000, "max": 5000 },
    "maxPages": 3,
    "resultsPerPage": 10,
    "maxResults": 50
  },
  "llm": {
    "model": "gemini-2.5-pro"
  }
}
```

## 기술 스택

- **Backend**: Hono (Node.js)
- **검색 API**: Serper.dev
- **LLM**: Google Gemini 2.5 Pro
- **Excel 처리**: SheetJS (xlsx)
- **Frontend**: Vanilla JS + TailwindCSS

## 향후 계획

- [ ] Google Sheets 연동
- [ ] 정기 자동 실행 (스케줄러)
- [ ] 실제 페이지 콘텐츠 크롤링으로 LLM 판별 정확도 향상
- [ ] 웹 배포 (Cloudflare Pages)

## 라이선스

Private - 내부 사용 전용
