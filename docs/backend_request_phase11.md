# [협조 요청] api/index.ts HTML 렌더링 코드 제거 - 프론트엔드 분리 배포

---

안녕하세요, 백엔드 센터장님.

프론트엔드 센터에서 **CTO Advisor 문서의 [STEP 4] 프론트엔드 분리** 지침에 따라 Next.js 프론트엔드를 Vercel에 배포하는 작업을 진행 중입니다.

---

## 1. 배경

CTO Advisor 문서에서 다음과 같이 지시하고 있습니다:

> **[STEP 4] 프론트엔드 분리 (The Future)**
> - 목표: 유지보수성 향상 및 렌더링 최적화
> - 배경: `src/app.ts`에 HTML이 섞여 있어(Spaghetti Code) 수정이 어렵고 렌더링이 느립니다.
> - 실행 방안:
>   - **API 서버 전환: Hono 앱은 JSON만 반환하도록 변경**
>   - **Next.js 도입: Vercel에 새로운 Next.js 프로젝트를 생성하여 UI 이관**

현재 `api/index.ts`에 **HTML UI가 인라인으로 하드코딩**되어 있어, 프론트엔드 센터에서 개발한 Next.js UI가 배포되지 않고 있습니다.

---

## 2. 현재 문제 상황

| 구분 | 현재 상태 | 문제점 |
|------|----------|--------|
| `api/index.ts` | `/` 및 `/login` 라우트에서 HTML 반환 | 구버전 UI가 계속 노출됨 |
| `frontend/` | Next.js 앱 완성 (Phase 5-10 개선사항 포함) | Vercel에 배포되지 않음 |
| `vercel.json` | 모든 요청을 `api/index.ts`로 라우팅 | Next.js가 서빙되지 않음 |

---

## 3. 백엔드 센터 요청 사항

`api/index.ts`에서 **다음 2개의 HTML 렌더링 라우트를 제거**해 주세요:

### 3-1. 로그인 페이지 HTML 제거
- **위치**: 라인 730 ~ 790 (약 60줄)
- **현재 코드**: `app.get('/login', async (c) => { return c.html(...) })`
- **변경**: 해당 라우트 전체 삭제

### 3-2. 메인 페이지 HTML 제거
- **위치**: 라인 2283 ~ 4541 (약 2,258줄)
- **현재 코드**: `app.get('/', (c) => { return c.html(...) })`
- **변경**: 해당 라우트 전체 삭제

---

## 4. 제거 후 예상 구조

```
api/index.ts 역할:
- /api/* 엔드포인트만 담당 (JSON 반환)
- HTML 렌더링 없음

frontend/ 역할:
- Next.js 앱이 모든 UI 담당
- /, /login, /dashboard, /pending 등 모든 페이지 렌더링
```

---

## 5. API 엔드포인트 영향 없음 확인

다음 API 엔드포인트들은 **그대로 유지**되어야 합니다 (변경 없음):

| 엔드포인트 | 용도 |
|-----------|------|
| `POST /api/auth/login` | 로그인 인증 |
| `POST /api/auth/logout` | 로그아웃 |
| `GET /api/auth/status` | 인증 상태 확인 |
| `GET /api/dashboard/*` | 대시보드 데이터 |
| `GET /api/sessions/*` | 세션 데이터 |
| `GET /api/pending` | 승인 대기 목록 |
| `POST /api/review/*` | 승인/반려 처리 |
| `GET/POST /api/sites/*` | 사이트 목록 관리 |
| `GET/POST /api/titles/*` | 작품 관리 |
| `GET /api/manta-rankings` | Manta 순위 |
| `GET/POST/PUT /api/report-tracking/*` | 신고결과 추적 |
| `GET /api/excluded-urls` | 신고 제외 URL |
| 기타 모든 `/api/*` 엔드포인트 | 유지 |

---

## 6. 작업 순서 제안

1. **백엔드**: `api/index.ts`에서 `/login`, `/` HTML 라우트 제거
2. **프론트엔드**: `vercel.json` 라우팅 규칙 변경
3. **공동**: Vercel 배포 및 검증

---

## 7. 참고: 제거 대상 코드 위치

```typescript
// ============================================
// ❌ 제거 대상 1: 로그인 페이지 (라인 730-790)
// ============================================
app.get('/login', async (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
...
</html>
  `)
})

// ============================================
// ❌ 제거 대상 2: 메인 페이지 (라인 2283-4541)
// ============================================
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="ko">
...
</html>
  `)
})
```

---

## 8. 예상 작업량

| 항목 | 내용 |
|------|------|
| 코드 제거 | 약 2,318줄 |
| 예상 소요 시간 | 약 15-30분 |
| 난이도 | 낮음 (단순 삭제) |

---

## 9. 완료 후 기대 효과

1. **CTO 지침 준수**: Hono API는 JSON만 반환
2. **유지보수성 향상**: UI 수정이 `frontend/` 폴더에서만 이루어짐
3. **배포 즉시 반영**: 프론트엔드 수정사항이 바로 배포에 반영됨
4. **코드 가독성**: api/index.ts가 약 2,300줄 감소 (182KB → ~140KB)

---

## 10. 커밋 메시지 제안

```
refactor(api): remove inline HTML rendering from api/index.ts

- Remove /login HTML route (lines 730-790)
- Remove / (main page) HTML route (lines 2283-4541)
- API now returns JSON only, following CTO STEP 4 guideline
- Frontend will be served by Next.js app in frontend/ directory
```

---

작업 완료 후 알려주시면, 프론트엔드 센터에서 `vercel.json` 수정 및 배포를 진행하겠습니다.

감사합니다.

**프론트엔드 센터**
