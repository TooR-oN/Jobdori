# 사이트 집중 모니터링 개발 계획서

**문서 버전**: v1.0
**작성일**: 2026-02-06
**관련 설계서**: `docs/site-focused-monitoring-design.md`

---

## 1. 개발 범위 요약

사이트 집중 모니터링 기능을 6개 Phase로 나누어 개발한다.

| Phase | 내용 | 예상 소요 |
|-------|------|---------|
| Phase 1 | DB 스키마 & 마이그레이션 | 0.5일 |
| Phase 2 | 백엔드 - 대상 식별 로직 (scan) | 1일 |
| Phase 3 | 백엔드 - 심층 검색 실행 로직 (execute) | 1.5일 |
| Phase 4 | 백엔드 - API 라우트 연결 | 0.5일 |
| Phase 5 | 프론트엔드 - UI 구현 | 1.5일 |
| Phase 6 | 통합 테스트 & 배포 | 1일 |
| **합계** | | **6일** |

---

## 2. Phase 1: DB 스키마 & 마이그레이션

### 2.1 작업 목록

| # | 작업 | 파일 |
|---|------|------|
| 1-1 | `deep_monitoring_targets` 테이블 생성 DDL 작성 | `backend/src/lib/db.ts` |
| 1-2 | `detection_results`에 `source`, `deep_target_id` 컬럼 추가 | `backend/src/lib/db.ts` |
| 1-3 | `sessions`에 `deep_monitoring_*` 컬럼 추가 | `backend/src/lib/db.ts` |
| 1-4 | `initializeDatabase()` 함수에 마이그레이션 코드 추가 | `backend/src/lib/db.ts` |

### 2.2 변경 내용 상세

**`backend/src/lib/db.ts` - initializeDatabase() 추가 내용:**

```typescript
// deep_monitoring_targets 테이블
await sql`
  CREATE TABLE IF NOT EXISTS deep_monitoring_targets (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    url_count INTEGER NOT NULL,
    base_keyword VARCHAR(500) NOT NULL,
    deep_query VARCHAR(500) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    results_count INTEGER DEFAULT 0,
    new_urls_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    executed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(session_id, title, domain)
  )
`

await sql`
  CREATE INDEX IF NOT EXISTS idx_deep_monitoring_session
  ON deep_monitoring_targets(session_id, status)
`

// detection_results에 source 컬럼 추가
await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'detection_results' AND column_name = 'source'
    ) THEN
      ALTER TABLE detection_results ADD COLUMN source VARCHAR(20) DEFAULT 'regular';
    END IF;
  END $$
`

await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'detection_results' AND column_name = 'deep_target_id'
    ) THEN
      ALTER TABLE detection_results ADD COLUMN deep_target_id INTEGER;
    END IF;
  END $$
`

// sessions에 deep_monitoring 컬럼 추가
await sql`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'sessions' AND column_name = 'deep_monitoring_executed'
    ) THEN
      ALTER TABLE sessions ADD COLUMN deep_monitoring_executed BOOLEAN DEFAULT false;
      ALTER TABLE sessions ADD COLUMN deep_monitoring_targets_count INTEGER DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN deep_monitoring_new_urls INTEGER DEFAULT 0;
    END IF;
  END $$
`
```

### 2.3 완료 기준
- [x] `npm run db:migrate` 또는 앱 시작 시 테이블이 정상 생성됨
- [x] 기존 데이터에 영향 없음 (DEFAULT 값으로 하위 호환)

---

## 3. Phase 2: 백엔드 - 대상 식별 로직 (scan)

### 3.1 작업 목록

| # | 작업 | 파일 |
|---|------|------|
| 2-1 | `DeepMonitoringTarget` 등 타입 정의 추가 | `backend/scripts/types/index.ts` |
| 2-2 | DB CRUD 함수 추가 | `backend/src/lib/db.ts` |
| 2-3 | `scanDeepMonitoringTargets()` 함수 구현 | `backend/scripts/deep-monitoring.ts` |

### 3.2 핵심 알고리즘: scanDeepMonitoringTargets()

```typescript
async function scanDeepMonitoringTargets(
  sessionId: string,
  threshold: number = 5
): Promise<DeepMonitoringTarget[]> {

  // Step 1: 해당 세션의 모든 detection_results 조회
  const results = await sql`
    SELECT title, domain, url, search_query
    FROM detection_results
    WHERE session_id = ${sessionId}
  `;

  // Step 2: 불법 확정 도메인 목록 조회
  const illegalDomains = await getAllSiteDomains('illegal');

  // Step 3: 작품 x 도메인별 고유 URL 집계
  // Map<title, Map<domain, { urls: Set<string>, keywordStats: Map<keyword, Set<url>> }>>
  const titleDomainMap = new Map();

  for (const r of results) {
    // 작품별 -> 도메인별 -> URL 수집 + 키워드별 URL 수집
    if (!titleDomainMap.has(r.title)) {
      titleDomainMap.set(r.title, new Map());
    }
    const domainMap = titleDomainMap.get(r.title);
    if (!domainMap.has(r.domain)) {
      domainMap.set(r.domain, { urls: new Set(), keywordStats: new Map() });
    }
    const entry = domainMap.get(r.domain);
    entry.urls.add(r.url);

    // 키워드 조합별 URL 추적
    if (!entry.keywordStats.has(r.search_query)) {
      entry.keywordStats.set(r.search_query, new Set());
    }
    entry.keywordStats.get(r.search_query).add(r.url);
  }

  // Step 4: 임계치 이상 & 불법 도메인 필터링
  const targets: DeepMonitoringTarget[] = [];

  for (const [title, domainMap] of titleDomainMap) {
    for (const [domain, data] of domainMap) {
      const urlCount = data.urls.size;

      // 불법 확정 도메인이고 URL 수가 임계치 이상인 경우
      if (urlCount >= threshold && illegalDomains.has(domain.toLowerCase())) {

        // 최다 URL 키워드 조합 찾기
        let maxKeyword = '';
        let maxCount = 0;
        const keywordBreakdown = [];

        for (const [keyword, urlSet] of data.keywordStats) {
          keywordBreakdown.push({ keyword, urls: urlSet.size });
          if (urlSet.size > maxCount) {
            maxCount = urlSet.size;
            maxKeyword = keyword;
          }
        }

        targets.push({
          session_id: sessionId,
          title,
          domain,
          url_count: urlCount,
          base_keyword: maxKeyword,
          deep_query: `${maxKeyword} site:${domain}`,
          status: 'pending',
          results_count: 0,
          new_urls_count: 0,
          keyword_breakdown: keywordBreakdown.sort((a, b) => b.urls - a.urls),
        });
      }
    }
  }

  // Step 5: DB에 대상 저장 (기존 대상은 업데이트)
  await deleteDeepMonitoringTargetsBySession(sessionId);
  for (const target of targets) {
    const saved = await createDeepMonitoringTarget(target);
    target.id = saved.id;
  }

  return targets.sort((a, b) => b.url_count - a.url_count);
}
```

### 3.3 DB 함수 구현 (db.ts에 추가)

```typescript
// 세션별 심층 모니터링 대상 조회
export async function getDeepMonitoringTargets(sessionId: string) {
  const rows = await sql`
    SELECT * FROM deep_monitoring_targets
    WHERE session_id = ${sessionId}
    ORDER BY url_count DESC
  `;
  return rows;
}

// 대상 생성
export async function createDeepMonitoringTarget(target: any) {
  const rows = await sql`
    INSERT INTO deep_monitoring_targets
      (session_id, title, domain, url_count, base_keyword, deep_query, status)
    VALUES (${target.session_id}, ${target.title}, ${target.domain},
            ${target.url_count}, ${target.base_keyword}, ${target.deep_query},
            ${target.status || 'pending'})
    ON CONFLICT (session_id, title, domain) DO UPDATE SET
      url_count = EXCLUDED.url_count,
      base_keyword = EXCLUDED.base_keyword,
      deep_query = EXCLUDED.deep_query,
      status = 'pending'
    RETURNING *
  `;
  return rows[0];
}

// 대상 상태 업데이트
export async function updateDeepMonitoringTarget(id: number, updates: any) {
  const rows = await sql`
    UPDATE deep_monitoring_targets SET
      status = COALESCE(${updates.status || null}, status),
      results_count = COALESCE(${updates.results_count ?? null}, results_count),
      new_urls_count = COALESCE(${updates.new_urls_count ?? null}, new_urls_count),
      executed_at = COALESCE(${updates.executed_at || null}, executed_at),
      completed_at = COALESCE(${updates.completed_at || null}, completed_at)
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0];
}

// 세션별 대상 전체 삭제
export async function deleteDeepMonitoringTargetsBySession(sessionId: string) {
  await sql`
    DELETE FROM deep_monitoring_targets WHERE session_id = ${sessionId}
  `;
}
```

### 3.4 완료 기준
- [x] 세션 ID를 입력하면 임계치 이상의 불법 도메인 대상 목록이 반환됨
- [x] 키워드 조합별 상세 내역이 포함됨
- [x] 최다 URL 키워드 조합이 올바르게 선택됨
- [x] DB에 대상이 정상 저장됨

---

## 4. Phase 3: 백엔드 - 심층 검색 실행 로직 (execute)

### 4.1 작업 목록

| # | 작업 | 파일 |
|---|------|------|
| 3-1 | `executeDeepMonitoring()` 메인 함수 구현 | `backend/scripts/deep-monitoring.ts` |
| 3-2 | `executeDeepSearchForTarget()` 단일 대상 검색 | `backend/scripts/deep-monitoring.ts` |
| 3-3 | `mergeDeepResultsToSession()` 결과 병합 | `backend/scripts/deep-monitoring.ts` |
| 3-4 | 기존 classify, llm-judge 모듈 재사용 연동 | `backend/scripts/deep-monitoring.ts` |
| 3-5 | 세션 통계 갱신 및 Blob 업데이트 로직 | `backend/scripts/deep-monitoring.ts` |

### 4.2 실행 로직 상세

```typescript
async function executeDeepMonitoring(
  sessionId: string,
  targetIds?: number[]
): Promise<DeepMonitoringResult> {

  // Step 1: 대상 목록 로드
  let targets = await getDeepMonitoringTargets(sessionId);
  if (targetIds && targetIds.length > 0) {
    targets = targets.filter(t => targetIds.includes(t.id));
  }

  const config = loadConfig();
  const illegalSites = await loadSitesFromDb('illegal');
  const legalSites = await loadSitesFromDb('legal');

  // 기존 세션의 URL Set 로드 (중복 체크용)
  const existingUrls = await getExistingUrlsForSession(sessionId);

  const allResults: DeepTargetResult[] = [];

  // Step 2: 각 대상에 대해 심층 검색 실행
  for (const target of targets) {
    // 상태 업데이트: running
    await updateDeepMonitoringTarget(target.id, {
      status: 'running',
      executed_at: new Date().toISOString()
    });

    try {
      // 2-1: Serper.dev API로 검색 (기존 searchWithSerper 재사용)
      const searchResults = await executeDeepSearchForTarget(target, config);

      // 2-2: 1차 판별 (classify - 기존 모듈 재사용)
      const classifiedResults = await runClassify(searchResults);

      // 2-3: 2차 판별 (llm-judge)
      // 대상 도메인은 이미 illegal이므로 해당 도메인 결과는 skip 가능
      const llmJudgedResults = await runLLMJudge(classifiedResults, sessionId);

      // 2-4: 최종 결과 생성
      const finalResults = createFinalResults(llmJudgedResults);

      // 2-5: 중복 URL 필터링 (기존 세션에 이미 있는 URL 제외)
      const newResults = finalResults.filter(r => !existingUrls.has(r.url));

      // 2-6: detection_results에 INSERT (source='deep')
      const mergeResult = await mergeDeepResultsToSession(
        sessionId, target.id, newResults
      );

      // 2-7: 불법 URL을 report_tracking에 등록
      const illegalNewResults = newResults.filter(r => r.final_status === 'illegal');
      for (const r of illegalNewResults) {
        await createReportTracking({
          session_id: sessionId,
          url: r.url,
          domain: r.domain,
          title: r.title,
          report_status: '미신고'
        });
      }

      // 2-8: 대상 상태 업데이트: completed
      await updateDeepMonitoringTarget(target.id, {
        status: 'completed',
        results_count: finalResults.length,
        new_urls_count: newResults.length,
        completed_at: new Date().toISOString()
      });

      // 새 URL을 기존 Set에 추가 (다음 대상에서 중복 방지)
      newResults.forEach(r => existingUrls.add(r.url));

      allResults.push({
        target_id: target.id,
        title: target.title,
        domain: target.domain,
        deep_query: target.deep_query,
        results_count: finalResults.length,
        new_urls_count: newResults.length,
        illegal_count: newResults.filter(r => r.final_status === 'illegal').length,
        legal_count: newResults.filter(r => r.final_status === 'legal').length,
        pending_count: newResults.filter(r => r.final_status === 'pending').length,
      });

      // 검색 간 딜레이
      await sleep(getRandomDelay(config.search.delayBetweenSearches.min,
                                  config.search.delayBetweenSearches.max));

    } catch (error) {
      await updateDeepMonitoringTarget(target.id, { status: 'failed' });
      console.error(`Deep monitoring failed for ${target.domain}:`, error);
    }
  }

  // Step 3: 세션 통계 갱신
  await refreshSessionStats(sessionId);

  // Step 4: Vercel Blob 업데이트 (전체 final-results 재생성)
  await updateBlobFinalResults(sessionId);

  // Step 5: 세션에 심층 모니터링 메타 업데이트
  const totalNewUrls = allResults.reduce((sum, r) => sum + r.new_urls_count, 0);
  await sql`
    UPDATE sessions SET
      deep_monitoring_executed = true,
      deep_monitoring_targets_count = ${targets.length},
      deep_monitoring_new_urls = ${totalNewUrls}
    WHERE id = ${sessionId}
  `;

  return {
    session_id: sessionId,
    executed_targets: allResults.length,
    total_new_results: allResults.reduce((s, r) => s + r.results_count, 0),
    total_new_urls: totalNewUrls,
    results_per_target: allResults,
  };
}
```

### 4.3 보조 함수

```typescript
// 세션의 기존 URL Set 로드
async function getExistingUrlsForSession(sessionId: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT url FROM detection_results WHERE session_id = ${sessionId}
  `;
  return new Set(rows.map(r => r.url));
}

// 세션 통계 갱신 (detection_results 기반 재집계)
async function refreshSessionStats(sessionId: string) {
  await sql`
    UPDATE sessions SET
      results_total = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId}),
      results_illegal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'illegal'),
      results_legal = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'legal'),
      results_pending = (SELECT COUNT(*) FROM detection_results WHERE session_id = ${sessionId} AND final_status = 'pending')
    WHERE id = ${sessionId}
  `;
}

// Blob의 final-results.json 업데이트
async function updateBlobFinalResults(sessionId: string) {
  const allResults = await sql`
    SELECT * FROM detection_results WHERE session_id = ${sessionId}
  `;
  // Blob에 재업로드
  const blob = await put(
    `results/${sessionId}/final-results.json`,
    JSON.stringify(allResults, null, 2),
    { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN }
  );
  await sql`
    UPDATE sessions SET file_final_results = ${blob.url} WHERE id = ${sessionId}
  `;
}
```

### 4.4 완료 기준
- [x] 심층 검색이 정상 실행되고 결과가 detection_results에 저장됨
- [x] source='deep' 컬럼으로 정기/심층 결과가 구분됨
- [x] 중복 URL이 방지됨
- [x] 세션 통계가 올바르게 갱신됨
- [x] Blob의 final-results.json이 업데이트됨
- [x] 불법 URL이 report_tracking에 등록됨

---

## 5. Phase 4: 백엔드 - API 라우트 연결

### 5.1 작업 목록

| # | 작업 | 파일 |
|---|------|------|
| 4-1 | scan API 라우트 연결 | `backend/src/app.ts` |
| 4-2 | execute API 라우트 연결 | `backend/src/app.ts` |
| 4-3 | targets 조회 API 라우트 연결 | `backend/src/app.ts` |
| 4-4 | status 조회 API 라우트 연결 | `backend/src/app.ts` |
| 4-5 | 메모리 상태 관리 (동시 실행 방지) | `backend/src/app.ts` |

### 5.2 구현 코드 (app.ts에 추가)

```typescript
// ============================================
// 사이트 집중 모니터링 (Deep Monitoring) API
// ============================================

// 메모리 상태 관리
let deepMonitoringStatus: {
  isRunning: boolean;
  sessionId: string | null;
  currentTarget: any | null;
  progress: { completed: number; total: number };
} = {
  isRunning: false,
  sessionId: null,
  currentTarget: null,
  progress: { completed: 0, total: 0 }
};

// POST /api/sessions/:id/deep-monitoring/scan
app.post('/api/sessions/:id/deep-monitoring/scan', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const threshold = body.threshold || 5;

  try {
    const targets = await scanDeepMonitoringTargets(sessionId, threshold);
    return c.json({
      success: true,
      data: { session_id: sessionId, threshold, targets, total_targets: targets.length }
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// POST /api/sessions/:id/deep-monitoring/execute
app.post('/api/sessions/:id/deep-monitoring/execute', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const targetIds = body.target_ids;

  if (deepMonitoringStatus.isRunning) {
    return c.json({ success: false, error: '심층 모니터링이 이미 실행 중입니다.' }, 409);
  }

  deepMonitoringStatus = {
    isRunning: true,
    sessionId,
    currentTarget: null,
    progress: { completed: 0, total: 0 }
  };

  // 비동기 실행 (즉시 응답 반환)
  executeDeepMonitoring(sessionId, targetIds)
    .then(result => {
      deepMonitoringStatus = { isRunning: false, sessionId: null, currentTarget: null, progress: { completed: 0, total: 0 } };
    })
    .catch(error => {
      deepMonitoringStatus = { isRunning: false, sessionId: null, currentTarget: null, progress: { completed: 0, total: 0 } };
    });

  return c.json({ success: true, message: '심층 모니터링을 시작합니다.' });
});

// GET /api/sessions/:id/deep-monitoring/targets
app.get('/api/sessions/:id/deep-monitoring/targets', async (c) => {
  const sessionId = c.req.param('id');
  try {
    const targets = await db.getDeepMonitoringTargets(sessionId);
    return c.json({ success: true, data: { session_id: sessionId, targets } });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// GET /api/sessions/:id/deep-monitoring/status
app.get('/api/sessions/:id/deep-monitoring/status', async (c) => {
  return c.json({
    success: true,
    data: deepMonitoringStatus
  });
});
```

### 5.3 완료 기준
- [x] 4개 API 엔드포인트가 정상 응답
- [x] scan -> 대상 목록 반환
- [x] execute -> 비동기 실행 시작
- [x] targets -> 대상 상태 조회
- [x] status -> 실행 중 진행 상태 조회
- [x] 동시 실행 방지 동작

---

## 6. Phase 5: 프론트엔드 - UI 구현

### 6.1 작업 목록

| # | 작업 | 파일 |
|---|------|------|
| 5-1 | `deepMonitoringApi` 추가 | `frontend/src/lib/api.ts` |
| 5-2 | 세션 상세 페이지에 집중 모니터링 패널 추가 | `frontend/src/app/sessions/[id]/page.tsx` |
| 5-3 | 대상 목록 테이블 컴포넌트 | `frontend/src/app/sessions/[id]/page.tsx` |
| 5-4 | 진행 상태 표시 (polling) | `frontend/src/app/sessions/[id]/page.tsx` |
| 5-5 | 세션 목록에 심층 모니터링 배지 추가 | `frontend/src/app/sessions/page.tsx` |

### 6.2 API 클라이언트 (api.ts 추가)

```typescript
export const deepMonitoringApi = {
  scan: async (sessionId: string, threshold?: number) => {
    const res = await api.post(`/api/sessions/${sessionId}/deep-monitoring/scan`, { threshold });
    return res.data;
  },

  execute: async (sessionId: string, targetIds?: number[]) => {
    const res = await api.post(`/api/sessions/${sessionId}/deep-monitoring/execute`, { target_ids: targetIds });
    return res.data;
  },

  getTargets: async (sessionId: string) => {
    const res = await api.get(`/api/sessions/${sessionId}/deep-monitoring/targets`);
    return res.data;
  },

  getStatus: async (sessionId: string) => {
    const res = await api.get(`/api/sessions/${sessionId}/deep-monitoring/status`);
    return res.data;
  },
};
```

### 6.3 UI 컴포넌트 구조

```tsx
// 세션 상세 페이지 하단에 추가

{/* 사이트 집중 모니터링 패널 */}
<div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
  <h3 className="text-lg font-semibold text-gray-800 mb-4">
    🔍 사이트 집중 모니터링
  </h3>

  {/* 1단계: 대상 검색 버튼 */}
  {!isScanned && (
    <button onClick={handleScan}>
      사이트 집중 모니터링 대상 검색
    </button>
  )}

  {/* 대상 목록 테이블 */}
  {targets.length > 0 && (
    <table>
      <thead>
        <tr>
          <th>선택</th>
          <th>작품명</th>
          <th>도메인</th>
          <th>URL 수</th>
          <th>기반 키워드</th>
          <th>심층 쿼리</th>
          <th>상태</th>
        </tr>
      </thead>
      <tbody>
        {targets.map(target => (
          <tr key={target.id}>
            <td><input type="checkbox" /></td>
            <td>{target.title}</td>
            <td>{target.domain}</td>
            <td>{target.url_count}</td>
            <td>{target.base_keyword}</td>
            <td><code>{target.deep_query}</code></td>
            <td>{getStatusBadge(target.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}

  {/* 2단계: 실행 버튼 */}
  {targets.length > 0 && !isRunning && (
    <button onClick={handleExecute}>
      사이트 집중 모니터링 시작 ({selectedCount}개 대상)
    </button>
  )}

  {/* 진행 상태 */}
  {isRunning && (
    <div>
      <ProgressBar progress={progress.percentage} />
      <p>대상 {progress.completed}/{progress.total} 처리 중...</p>
    </div>
  )}

  {/* 완료 결과 */}
  {isCompleted && (
    <div>
      <p>✅ 완료: 신규 URL {totalNewUrls}개 수집</p>
    </div>
  )}
</div>
```

### 6.4 진행 상태 Polling

```typescript
// 심층 모니터링 실행 중 2초마다 상태 체크
useEffect(() => {
  if (!isRunning) return;

  const interval = setInterval(async () => {
    const status = await deepMonitoringApi.getStatus(sessionId);
    if (status.success) {
      setProgress(status.data.progress);
      setCurrentTarget(status.data.currentTarget);

      if (!status.data.is_running) {
        setIsRunning(false);
        setIsCompleted(true);
        clearInterval(interval);
        // 결과 테이블 갱신
        loadResults();
        // 대상 목록 갱신
        loadTargets();
      }
    }
  }, 2000);

  return () => clearInterval(interval);
}, [isRunning]);
```

### 6.5 세션 목록 배지

```tsx
// sessions/page.tsx - 세션 카드에 배지 추가
{session.deep_monitoring_executed && (
  <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full">
    🔍 집중 모니터링 +{session.deep_monitoring_new_urls}
  </span>
)}
```

### 6.6 완료 기준
- [x] 대상 검색 버튼 클릭 시 대상 목록이 정상 표시됨
- [x] 체크박스로 대상 선택/해제 가능
- [x] 실행 시작 시 진행 상태가 실시간으로 표시됨
- [x] 완료 후 결과 요약이 표시되고 기존 테이블이 갱신됨
- [x] 세션 목록에 집중 모니터링 배지가 표시됨

---

## 7. Phase 6: 통합 테스트 & 배포

### 7.1 테스트 시나리오

| # | 시나리오 | 검증 사항 |
|---|---------|---------|
| T-1 | 완료된 세션에서 대상 검색 | 불법 도메인만 대상으로 선정되는지 |
| T-2 | 임계치 변경 테스트 | threshold 파라미터에 따라 대상 수 변동 확인 |
| T-3 | 심층 검색 실행 | Serper API 호출, 판별, 결과 저장 정상 동작 |
| T-4 | URL 중복 방지 | 기존 세션에 있는 URL이 중복 삽입되지 않는지 |
| T-5 | 세션 통계 갱신 | 심층 결과 추가 후 세션 합계가 올바른지 |
| T-6 | 대시보드 반영 | 심층 결과가 월별 통계에 포함되는지 |
| T-7 | 신고 추적 연동 | 심층 불법 URL이 report_tracking에 등록되는지 |
| T-8 | 동시 실행 방지 | 중복 실행 시 409 응답 확인 |
| T-9 | 에러 처리 | API 오류 시 target status가 failed로 설정되는지 |
| T-10 | UI 전체 흐름 | 프론트엔드에서 scan -> select -> execute -> complete 흐름 |

### 7.2 배포 체크리스트

- [ ] DB 마이그레이션 실행 확인 (production)
- [ ] 환경변수 확인 (SERPER_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN)
- [ ] Vercel 배포 후 API 엔드포인트 정상 응답
- [ ] 프론트엔드 빌드 정상
- [ ] Serper API 크레딧 충분한지 확인

### 7.3 배포 순서

1. `shared/types/index.ts` 타입 업데이트 배포
2. `backend/src/lib/db.ts` DB 마이그레이션 배포 -> 자동 실행
3. `backend/scripts/deep-monitoring.ts` 신규 스크립트 배포
4. `backend/src/app.ts` API 라우트 배포
5. `frontend/src/lib/api.ts` + UI 컴포넌트 배포
6. 통합 테스트

---

## 8. 파일 변경 요약

### 8.1 신규 파일

| 파일 | 설명 |
|------|------|
| `backend/scripts/deep-monitoring.ts` | 심층 모니터링 핵심 로직 |
| `docs/site-focused-monitoring-design.md` | 설계서 |
| `docs/site-focused-monitoring-plan.md` | 개발 계획서 (본 문서) |

### 8.2 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `backend/scripts/types/index.ts` | DeepMonitoringTarget 등 타입 추가 |
| `backend/src/lib/db.ts` | 테이블 생성 + CRUD 함수 추가 |
| `backend/src/app.ts` | 4개 API 라우트 추가 |
| `frontend/src/lib/api.ts` | deepMonitoringApi 추가 |
| `frontend/src/app/sessions/[id]/page.tsx` | 집중 모니터링 패널 추가 |
| `frontend/src/app/sessions/page.tsx` | 집중 모니터링 배지 추가 |
| `shared/types/index.ts` | 공유 타입 추가 (선택사항) |
| `backend/data/config.json` | deep_monitoring 설정 추가 (선택사항) |

---

## 9. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Serper API 일일 한도 초과 | 심층 검색 실패 | 대상 수 제한 UI + 남은 크레딧 확인 기능 |
| 심층 검색 중 서버 재시작 | 중간 결과 유실 | 대상별 개별 저장으로 부분 복구 가능 |
| 대량 결과로 Blob 크기 초과 | 업로드 실패 | 결과를 detection_results DB 기반으로 변경 |
| 동시 접근 충돌 | 데이터 불일치 | 메모리 상태 기반 동시 실행 방지 |
