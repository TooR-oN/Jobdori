# Frontend Center Reference Document

**작성일**: 2026-02-01  
**작성자**: 개발 센터 리더  
**목적**: Frontend Center 히스토리 및 참조 문서

---

## 1. 프로젝트 개요

### 1.1 기술 스택
- **Framework**: Next.js 14.2.35 (App Router)
- **UI Library**: React 18.3.1
- **State Management**: TanStack Query (React Query) 5.62.16
- **Styling**: Tailwind CSS 3.4.17
- **Charts**: Recharts 2.15.0
- **Icons**: Lucide React 0.469.0
- **API**: Hono (hono/vercel adapter)

### 1.2 프로젝트 구조
```
frontend/
├── app/
│   ├── (main)/           # 메인 레이아웃 그룹
│   │   ├── dashboard/    # 대시보드
│   │   ├── sessions/     # 모니터링 세션
│   │   ├── pending/      # 승인 대기
│   │   ├── sites/        # 사이트 목록
│   │   ├── titles/       # 작품 관리
│   │   ├── title-stats/  # 작품별 통계
│   │   └── report-tracking/ # 신고결과 추적
│   ├── api/
│   │   └── [[...route]]/route.ts  # Hono API (catch-all)
│   ├── login/            # 로그인 페이지
│   └── layout.tsx        # 루트 레이아웃
├── components/
│   ├── dashboard/        # 대시보드 컴포넌트
│   ├── layout/           # 레이아웃 컴포넌트
│   ├── pending/          # 승인 대기 컴포넌트
│   ├── report-tracking/  # 신고 추적 컴포넌트
│   ├── sessions/         # 세션 컴포넌트
│   ├── sites/            # 사이트 관리 컴포넌트
│   ├── title-stats/      # 통계 컴포넌트
│   └── ui/               # 공용 UI 컴포넌트
├── hooks/
│   └── use-api.ts        # TanStack Query 훅
├── lib/
│   ├── api.ts            # API 클라이언트
│   └── utils.ts          # 유틸리티 함수
├── types/
│   └── index.ts          # TypeScript 타입 정의
├── middleware.ts         # Next.js 인증 미들웨어
├── next.config.js        # Next.js 설정
└── vercel.json           # Vercel 배포 설정
```

---

## 2. 주요 개발 이력

### 2.1 Phase 11: 프론트엔드 분리 (2026-01-31)
- **PR #3**: HTML 렌더링 제거 - CTO STEP 4 프론트엔드 분리
- **커밋 fdc5c18**: Next.js 프론트엔드 Vercel 배포 설정

### 2.2 API 라우팅 수정 (2026-01-31)
- **PR #4**: API 라우팅 수정 - Next.js App Router 형식 전환
- **PR #5**: Vercel 빌드 설정 수정 - rootDirectory 사용

### 2.3 인증 흐름 구현 (2026-01-31)
- **커밋 b606c22**: 인증 미들웨어 및 로그인 리다이렉트 구현
- `middleware.ts` 신규 생성
- `next.config.js` 리다이렉트 수정 (/ → /login)

### 2.4 Phase 5-10: 대규모 개선 (2026-01-31)
- **PR #2**: 프론트엔드 대규모 개선
- UI/UX 개선, 사이드바 재배치
- 신고결과 추적 탭 API 연동
- RIDI 브랜딩 적용

---

## 3. 주요 컴포넌트 참조

### 3.1 대시보드 (`/dashboard`)
- **파일**: `components/dashboard/index.tsx`
- **훅**: `useDashboard(month)`, `useDashboardMonths()`
- **기능**: 월별 통계, Top 5 차트, Manta 순위

### 3.2 세션 관리 (`/sessions`, `/sessions/[id]`)
- **파일**: `components/sessions/sessions-list.tsx`
- **훅**: `useSessions()`, `useSession(id)`, `useSessionResults(id)`
- **기능**: 모니터링 세션 목록, 세션 상세, 탐지 결과

### 3.3 사이트 목록 (`/sites`)
- **파일**: `components/sites/sites-list.tsx`
- **훅**: `useSites(type)`, `useAddSite()`, `useRemoveSite()`
- **기능**: 불법/합법 사이트 관리, 신고 제외 URL

### 3.4 작품 관리 (`/titles`)
- **훅**: `useTitles()`, `useAddTitle()`, `useRemoveTitle()`
- **기능**: 모니터링 대상 작품 관리

### 3.5 작품별 통계 (`/title-stats`)
- **파일**: `components/title-stats/index.tsx`
- **훅**: `useTitleStats(startDate, endDate)`
- **기능**: 기간별 작품 통계, Manta 순위 변화 차트

### 3.6 신고결과 추적 (`/report-tracking`)
- **파일**: `components/report-tracking/report-tracking-page.tsx`
- **훅**: `useReportTrackingSessions()`, `useReportTrackingData()`
- **기능**: 신고 상태 관리, 일괄 업데이트, CSV 내보내기

---

## 4. API 클라이언트 (`lib/api.ts`)

### 4.1 주요 함수
```typescript
// Dashboard
getDashboardMonths(): { months: string[], current_month: string }
getDashboard(month?: string): DashboardResponse

// Sessions
getSessions(page, limit): PaginatedResponse<Session>
getSessionById(id): Session
getSessionResults(id, options): PaginatedResponse<DetectionResult>

// Auth
login(password): { success: boolean }
logout(): { success: boolean }
checkAuthStatus(): { authenticated: boolean }

// Sites
getSites(type, page, limit): SitesResponse
addSite(domain, type): { success: boolean }
removeSite(domain, type): { success: boolean }

// Report Tracking
getReportTrackingSessions()
getReportTrackingData(sessionId, options)
updateReportStatus(id, status)
```

### 4.2 인증 처리
- `credentials: 'include'` - 쿠키 자동 포함
- 401 응답 시 `/login`으로 리다이렉트
- `session_token` 쿠키 사용

---

## 5. 알려진 이슈 및 해결 내역

### 5.1 해결된 이슈
| 이슈 | 원인 | 해결 | PR/커밋 |
|------|------|------|---------|
| API 404 | Vercel 라우팅 | Next.js App Router 형식 | PR #4 |
| 빌드 실패 | hono/vercel 누락 | handle() 어댑터 적용 | 56a9be4 |
| 빌드 실패 | @vercel/blob 누락 | 의존성 추가 | ee7122c |
| 인증 미구현 | 미들웨어 없음 | middleware.ts 생성 | b606c22 |

### 5.2 현재 이슈 (2026-02-01 기준)
| 이슈 | 증상 | 원인 | 담당 |
|------|------|------|------|
| 대시보드 0 표시 | 통계 모두 0 | current_month가 데이터 없는 월 반환 | Backend |
| 사이트 목록 에러 | Application Error | 조사 필요 | Frontend |
| 작품별 통계 | 기본 기간 없음 | 기본값 미설정 | Frontend |

---

## 6. 환경 변수

### 6.1 프론트엔드 (`.env.local`, `.env.production`)
```
NEXT_PUBLIC_API_URL=  # 빈 값 (동일 도메인)
```

### 6.2 Vercel 환경 변수 (필수)
```
DATABASE_URL=          # Neon DB 연결
ACCESS_PASSWORD=       # 로그인 비밀번호 (기본: ridilegal)
SECRET_KEY=            # 세션 토큰 암호화
GEMINI_API_KEY=        # AI 판정용 (선택)
BLOB_READ_WRITE_TOKEN= # Vercel Blob 토큰
```

---

## 7. 배포 프로세스

### 7.1 Vercel 설정
- **Root Directory**: `frontend`
- **Framework**: Next.js (자동 감지)
- **Build Command**: `npm run build`
- **Output Directory**: `.next`

### 7.2 Git Workflow
1. `main` 브랜치에서 작업
2. 커밋 후 `git push origin main`
3. Vercel 자동 배포 시작
4. 프로덕션 URL: https://jobdori.vercel.app

---

## 8. 테스트 체크리스트

### 8.1 인증 흐름
- [ ] `/` 접속 → `/login` 리다이렉트
- [ ] `ridilegal` 입력 → 로그인 성공
- [ ] 로그인 후 → `/dashboard` 이동
- [ ] 미인증 상태 → `/dashboard` 접근 시 `/login` 리다이렉트

### 8.2 주요 기능
- [ ] 대시보드 데이터 표시
- [ ] 세션 목록 로딩
- [ ] 세션 상세 페이지
- [ ] 사이트 목록 (불법/합법/제외URL)
- [ ] 작품 관리 CRUD
- [ ] 신고결과 추적

---

## 9. CTO Advisor 참조

### STEP 4: 프론트엔드 분리 (완료)
- API 서버: Hono → JSON 반환
- UI: Next.js 이관
- 상태 관리: TanStack Query

### 핵심 원칙
1. API는 JSON만 반환
2. HTML 렌더링은 Next.js 담당
3. 실시간 통계 → 동적 쿼리 사용

---

**문서 업데이트 이력**
- 2026-02-01: 초기 작성
