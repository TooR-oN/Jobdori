# DMCA 신고서 자동 생성 기능 개발 계획서

> **버전**: v1.0  
> **작성일**: 2026-02-10  
> **관련 설계서**: docs/dmca-report-generator-design.md  
> **총 예상 소요**: 2일 (Phase 1~4)

---

## Phase 1: 백엔드 API 구현 (0.5일)

### 작업 1-1: DMCA 신고서 생성 함수 구현

**파일**: `backend/api/index.ts`  
**삽입 위치**: deep-monitoring/status 라우트 뒤, Dashboard 섹션 앞 (약 2558행 부근)

**구현 내용**:

#### (A) 헬퍼 함수: `generateDmcaReport(sessionId: string)`

```typescript
// ============================================
// DMCA Report Generator
// ============================================

const DMCA_DESCRIPTION_TEMPLATE = (titleName: string) =>
  `${titleName} is a webtoon(comic, manga, etc.) owned and copyrighted by RIDI Corporation.\nThe whole webtoon is infringed on the pirate sites.`;

async function generateDmcaReport(sessionId: string) {
  // 1. 세션 존재 확인
  const session = await getSessionById(sessionId)
  if (!session) throw new Error('Session not found')

  // 2. excluded_urls 조회
  const excludedRows = await query`SELECT url FROM excluded_urls`
  const excludedUrls = new Set(excludedRows.map((r: any) => r.url))

  // 3. report_tracking에서 전체 URL 조회
  const allItems = await query`
    SELECT id, url, domain, title, report_status, reason
    FROM report_tracking
    WHERE session_id = ${sessionId}
    ORDER BY title ASC, domain ASC, url ASC
  `

  // 4. titles + manta_url 조회
  const titlesRows = await query`
    SELECT name, manta_url FROM titles WHERE is_current = true
  `
  const titleMantaMap = new Map<string, string | null>()
  for (const t of titlesRows) {
    titleMantaMap.set(t.name, t.manta_url || null)
  }

  // 5. 필터링
  const excluded = { already_blocked: 0, not_indexed: 0, duplicate_rejected: 0, main_page: 0, excluded_url: 0 }
  const includedItems: typeof allItems = []

  for (const item of allItems) {
    // 제외: excluded_urls
    if (excludedUrls.has(item.url)) { excluded.excluded_url++; continue }
    // 제외: 차단
    if (item.report_status === '차단') { excluded.already_blocked++; continue }
    // 제외: 색인없음
    if (item.report_status === '색인없음') { excluded.not_indexed++; continue }
    // 제외: 중복 거부
    if (item.report_status === '거부' && item.reason?.toLowerCase().includes('중복')) {
      excluded.duplicate_rejected++; continue
    }
    // 제외: 웹사이트 메인 페이지
    if (item.reason === '웹사이트 메인 페이지') { excluded.main_page++; continue }
    
    includedItems.push(item)
  }

  // 6. 작품별 그룹핑
  const workMap = new Map<string, { urls: string[], manta_url: string | null }>()
  for (const item of includedItems) {
    const title = item.title || '(작품명 없음)'
    if (!workMap.has(title)) {
      workMap.set(title, {
        urls: [],
        manta_url: titleMantaMap.get(title) || null
      })
    }
    workMap.get(title)!.urls.push(item.url)
  }

  // 7. works 배열 생성 (작품명 알파벳순)
  const works = Array.from(workMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, data]) => ({
      title,
      manta_url: data.manta_url,
      description: DMCA_DESCRIPTION_TEMPLATE(title),
      urls: data.urls.sort(),
      url_count: data.urls.length
    }))

  // 8. 텍스트 생성 (구글 폼용)
  const fullTextParts: string[] = []
  works.forEach((work, idx) => {
    fullTextParts.push(`=== 작품 ${idx + 1}: ${work.title} ===`)
    fullTextParts.push('')
    fullTextParts.push('[저작물 설명]')
    fullTextParts.push(work.description)
    fullTextParts.push('')
    fullTextParts.push('[공인된 저작물 URL]')
    fullTextParts.push(work.manta_url || '(등록된 URL 없음)')
    fullTextParts.push('')
    fullTextParts.push(`[침해 URL 목록] (${work.url_count}개)`)
    fullTextParts.push(work.urls.join('\n'))
    fullTextParts.push('')
    fullTextParts.push('========================================')
    fullTextParts.push('')
  })

  // 9. TCRP 텍스트 생성
  const tcrpParts: string[] = []
  works.forEach((work) => {
    const descLines = work.description.split('\n')
    descLines.forEach(line => tcrpParts.push(`# ${line}`))
    tcrpParts.push(`# ${work.manta_url || '(등록된 URL 없음)'}`)
    work.urls.forEach(url => tcrpParts.push(url))
    tcrpParts.push('')
  })

  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    summary: {
      total_titles: works.length,
      total_urls: allItems.length,
      excluded_urls: Object.values(excluded).reduce((a, b) => a + b, 0),
      included_urls: includedItems.length
    },
    excluded_reasons: excluded,
    works,
    full_text: fullTextParts.join('\n').trim(),
    tcrp_text: tcrpParts.join('\n').trim()
  }
}
```

#### (B) API 라우트: `POST /api/sessions/:id/dmca-report/generate`

```typescript
app.post('/api/sessions/:id/dmca-report/generate', async (c) => {
  try {
    await ensureDbMigration()
    const sessionId = c.req.param('id')
    const report = await generateDmcaReport(sessionId)

    if (report.works.length === 0) {
      return c.json({
        success: true,
        report: {
          ...report,
          message: '신고 대상 URL이 없습니다.'
        }
      })
    }

    return c.json({ success: true, report })
  } catch (error: any) {
    console.error('DMCA report generation error:', error)
    if (error.message === 'Session not found') {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    return c.json({ success: false, error: error.message || '신고서 생성 실패' }, 500)
  }
})
```

**완료 기준**:
- `POST /api/sessions/:id/dmca-report/generate` 호출 시 JSON 응답 정상 반환
- 필터링 로직: excluded_urls, 차단, 색인없음, 중복 거부, 웹사이트 메인 페이지 제외 확인
- works 배열에 작품별 description, manta_url, urls 포함
- full_text, tcrp_text 텍스트 정상 생성
- 대상 URL 없을 때 빈 works + message 반환

---

## Phase 2: 프론트엔드 API 모듈 추가 (0.5시간)

### 작업 2-1: dmcaReportApi 추가

**파일**: `frontend/src/lib/api.ts`  
**삽입 위치**: `deepMonitoringApi` 객체 뒤 (376행 `};` 뒤)

**구현 내용**:

```typescript
export const dmcaReportApi = {
  generate: async (sessionId: string) => {
    const res = await api.post(`/api/sessions/${sessionId}/dmca-report/generate`);
    return res.data;
  },
};
```

**완료 기준**:
- `dmcaReportApi.generate(sessionId)` 호출 가능
- 기존 API 모듈과 동일한 패턴으로 구현

---

## Phase 3: 프론트엔드 UI 구현 (1일)

### 작업 3-1: import 추가 및 상태 변수 선언

**파일**: `frontend/src/app/sessions/[id]/page.tsx`

**(A) import 수정** (6행):
- `dmcaReportApi` 추가 import
- `DocumentTextIcon` heroicons 추가

**(B) 상태 변수 추가** (약 96행 부근, `pollingRef` 뒤):
```typescript
// === DMCA Report 상태 ===
const [dmcaModalOpen, setDmcaModalOpen] = useState(false);
const [dmcaLoading, setDmcaLoading] = useState(false);
const [dmcaReport, setDmcaReport] = useState<any>(null);
const [dmcaError, setDmcaError] = useState<string | null>(null);
const [dmcaCopyStates, setDmcaCopyStates] = useState<Record<string, boolean>>({});
const [dmcaExpandedWorks, setDmcaExpandedWorks] = useState<Set<number>>(new Set([0]));
```

### 작업 3-2: 이벤트 핸들러 함수 추가

**삽입 위치**: `handleCopyMantaUrl` 함수 뒤 (약 468행 뒤)

```typescript
// === DMCA Report 핸들러 ===
const handleGenerateDmcaReport = async () => {
  setDmcaLoading(true);
  setDmcaError(null);
  setDmcaReport(null);
  setDmcaModalOpen(true);
  try {
    const res = await dmcaReportApi.generate(sessionId);
    if (res.success) {
      setDmcaReport(res.report);
      // 첫 번째 작품 자동 확장
      setDmcaExpandedWorks(new Set([0]));
    } else {
      setDmcaError(res.error || '신고서 생성에 실패했습니다.');
    }
  } catch (err: any) {
    setDmcaError('신고서 생성 중 오류가 발생했습니다.');
  } finally {
    setDmcaLoading(false);
  }
};

const handleDmcaCopy = async (key: string, text: string) => {
  await navigator.clipboard.writeText(text);
  setDmcaCopyStates(prev => ({ ...prev, [key]: true }));
  setTimeout(() => setDmcaCopyStates(prev => ({ ...prev, [key]: false })), 2000);
};

const handleDmcaCopyAll = async () => {
  if (dmcaReport?.full_text) {
    await handleDmcaCopy('all', dmcaReport.full_text);
  }
};

const handleDmcaDownloadTxt = () => {
  if (!dmcaReport?.full_text) return;
  const blob = new Blob([dmcaReport.full_text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = `DMCA_Report_${sessionId}_${date}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

const toggleDmcaWorkExpand = (idx: number) => {
  setDmcaExpandedWorks(prev => {
    const next = new Set(prev);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    return next;
  });
};
```

### 작업 3-3: DMCA 신고서 생성 버튼 추가

**삽입 위치**: 상단 액션 바, Excel 다운로드 버튼 앞 (약 547행)

```tsx
{/* DMCA 신고서 생성 버튼 */}
<button
  onClick={handleGenerateDmcaReport}
  className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
>
  <DocumentTextIcon className="w-4 h-4" />
  <span>DMCA 신고서 생성</span>
</button>
```

### 작업 3-4: DMCA 신고서 모달 컴포넌트

**삽입 위치**: JSX의 `</MainLayout>` 직전 (파일 최하단 부근)

모달 구조:
```
┌──────────────────────────────────────────────┐
│ DMCA 신고서 - {sessionId}                  [X] │
│ 작품 {N}개 · URL {M}개                        │
├──────────────────────────────────────────────┤
│ [전체 복사] [TXT 다운로드]                      │
├──────────────────────────────────────────────┤
│                                              │
│ ▼ 작품 1: {title} ({count}개 URL)             │
│ ┌──────────────────────────────────────────┐ │
│ │ [저작물 설명]                      [복사] │ │
│ │ {title} is a webtoon(comic, manga,      │ │
│ │ etc.) owned and copyrighted by RIDI...  │ │
│ ├──────────────────────────────────────────┤ │
│ │ [공인된 저작물 URL]                [복사] │ │
│ │ https://manta.net/en/series/...          │ │
│ ├──────────────────────────────────────────┤ │
│ │ [침해 URL 목록]                    [복사] │ │
│ │ https://example.com/manga/...           │ │
│ │ https://another.com/read/...            │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ▶ 작품 2: {title} ({count}개 URL)             │
│ ▶ 작품 3: {title} ({count}개 URL)             │
│                                              │
├──────────────────────────────────────────────┤
│ 제외된 URL: {N}개                              │
│ 차단: {n} · 색인없음: {n} · 중복거부: {n}       │
│ 메인페이지: {n} · 제외URL: {n}                  │
└──────────────────────────────────────────────┘
```

**모달 구현 핵심**:
- **오버레이**: 반투명 배경, 클릭 시 닫기
- **크기**: `max-w-4xl`, `max-h-[90vh]`, 내부 스크롤
- **로딩 상태**: 스피너 표시
- **에러 상태**: 에러 메시지 + 닫기 버튼
- **빈 결과**: "신고 대상 URL이 없습니다" 메시지
- **작품별 아코디언**: 첫 번째 작품만 기본 확장
- **복사 버튼**: 블록별 개별 복사 + 전체 복사
- **TXT 다운로드**: Blob 생성 → 클라이언트 다운로드 (서버 추가 요청 없음)

**완료 기준**:
- 버튼 클릭 → 모달 열림 → 로딩 → 결과 표시
- 작품별 아코디언 열기/닫기
- [저작물 설명], [공인된 저작물 URL], [침해 URL 목록] 각각 복사 가능
- [전체 복사] 클릭 시 full_text 클립보드 복사
- [TXT 다운로드] 클릭 시 .txt 파일 다운로드
- 복사 성공 시 버튼 텍스트 "복사됨 ✓" (2초 후 복원)
- 모달 닫기 (X 버튼, 오버레이 클릭, ESC 키)
- 제외 요약 표시

---

## Phase 4: 통합 테스트 및 배포 (0.5일)

### 작업 4-1: 로컬 통합 테스트

**테스트 시나리오**:

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 1 | 세션에 불법 URL 50개, excluded 5개 | 45개 URL이 작품별로 그룹핑되어 표시 |
| 2 | 모든 URL이 차단/색인없음 상태 | "신고 대상 URL이 없습니다" 메시지 |
| 3 | 거부 URL 중 reason='기존 요청과 중복된 요청' | 해당 URL 제외됨 |
| 4 | 거부 URL 중 reason='문제의 콘텐츠를 찾을 수 없음' | 해당 URL **포함**됨 (재신고 대상) |
| 5 | manta_url이 없는 작품 | 공인된 저작물 URL이 "(등록된 URL 없음)"으로 표시 |
| 6 | title이 null인 report_tracking 항목 | "(작품명 없음)" 그룹에 포함 |
| 7 | 대기 중 상태 URL | 신고서에 포함됨 |
| 8 | 미신고 + reason='웹사이트 메인 페이지' | 제외됨 |
| 9 | 작품별 [복사] 버튼 클릭 | 해당 블록만 클립보드 복사 |
| 10 | [전체 복사] 클릭 | full_text 전체 복사 |
| 11 | [TXT 다운로드] 클릭 | .txt 파일 다운로드 |
| 12 | 존재하지 않는 세션 ID | 404 에러 표시 |

### 작업 4-2: 빌드 확인

```bash
cd frontend && npm run build   # 프론트엔드 빌드 오류 없는지 확인
cd backend && npx tsc --noEmit # 타입 체크 (가능 시)
```

### 작업 4-3: PR 및 배포

1. `genspark_ai_developer` 브랜치에서 커밋
2. `origin/main`과 동기화 (fetch + rebase)
3. 커밋 스쿼시 → 단일 커밋
4. PR 생성: `genspark_ai_developer` → `main`
5. Vercel 자동 배포 확인
6. 프로덕션 환경에서 기능 테스트

**완료 기준**:
- 12개 테스트 시나리오 통과
- 빌드 오류 없음
- PR 생성 완료

---

## 파일 변경 맵

| 파일 | 작업 | Phase |
|------|------|-------|
| `backend/api/index.ts` | `generateDmcaReport()` 함수 + `POST /api/sessions/:id/dmca-report/generate` 라우트 추가 | 1 |
| `frontend/src/lib/api.ts` | `dmcaReportApi` 객체 추가 | 2 |
| `frontend/src/app/sessions/[id]/page.tsx` | import 수정, 상태 변수/핸들러 추가, 버튼 + 모달 UI 구현 | 3 |

### 신규 파일: 없음
### DB 스키마 변경: 없음
### 환경변수 변경: 없음

---

## 리스크 및 대응

| 리스크 | 확률 | 대응 |
|--------|------|------|
| report_tracking에 title이 null인 항목 | 중 | "(작품명 없음)" 그룹으로 처리 |
| manta_url 미등록 작품 존재 | 중 | 공란으로 표시, UI에서 명시 |
| 대량 URL (500+) 시 모달 렌더링 지연 | 낮 | URL 목록은 텍스트 블록으로 표시 (개별 DOM 최소화) |
| Vercel 30초 타임아웃 | 매우 낮 | DB 읽기 전용, 외부 API 없음 (1~3초 예상) |

---

## 타임라인 요약

| Phase | 내용 | 소요 |
|-------|------|------|
| 1 | 백엔드 API (함수 + 라우트) | 0.5일 |
| 2 | 프론트엔드 API 모듈 | 0.5시간 |
| 3 | 프론트엔드 UI (버튼 + 모달) | 1일 |
| 4 | 통합 테스트 + 배포 | 0.5일 |
| **합계** | | **2일** |
