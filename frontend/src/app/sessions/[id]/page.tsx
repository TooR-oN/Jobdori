'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout';
import { sessionsApi, titlesApi, excludedUrlsApi, deepMonitoringApi } from '@/lib/api';
import { ArrowLeftIcon, ArrowDownTrayIcon, DocumentDuplicateIcon, CheckIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon, MagnifyingGlassIcon, PlayIcon } from '@heroicons/react/24/outline';

interface Result {
  title: string;
  domain: string;
  url: string;
  search_query: string;
  page: number;
  rank: number;
  status: string;
  llm_judgment: string | null;
  llm_reason: string | null;
  final_status: 'illegal' | 'legal' | 'pending';
}

interface Title {
  name: string;
  manta_url: string | null;
  unofficial_titles?: string[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Deep Monitoring 타입
interface DeepMonitoringTarget {
  id?: number;
  session_id: string;
  title: string;
  domain: string;
  url_count: number;
  base_keyword: string;
  deep_query: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results_count: number;
  new_urls_count: number;
  keyword_breakdown?: { keyword: string; urls: number }[];
  created_at?: string;
  executed_at?: string | null;
  completed_at?: string | null;
}

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  
  const [results, setResults] = useState<Result[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [availableTitles, setAvailableTitles] = useState<string[]>([]);
  const [titlesData, setTitlesData] = useState<Title[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isCopyingAll, setIsCopyingAll] = useState(false);
  
  // 필터
  const [titleFilter, setTitleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Manta URL 토글
  const [showMantaUrl, setShowMantaUrl] = useState(false);

  // === Deep Monitoring 상태 ===
  const [deepPanelOpen, setDeepPanelOpen] = useState(false);
  const [deepTargets, setDeepTargets] = useState<DeepMonitoringTarget[]>([]);
  const [deepSelectedIds, setDeepSelectedIds] = useState<Set<number>>(new Set());
  const [deepScanning, setDeepScanning] = useState(false);
  const [deepExecuting, setDeepExecuting] = useState(false);
  const [deepScanDone, setDeepScanDone] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [deepProgress, setDeepProgress] = useState<{
    total_targets: number;
    completed_targets: number;
    current_target?: string;
    results_so_far?: number;
  } | null>(null);
  const [deepSummary, setDeepSummary] = useState<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 타이틀 데이터 로드 (Manta URL 포함)
  useEffect(() => {
    const loadTitles = async () => {
      try {
        const res = await titlesApi.getList();
        if (res.success) {
          setTitlesData(res.current || []);
        }
      } catch (err) {
        console.error('Failed to load titles:', err);
      }
    };
    loadTitles();
  }, []);

  // 데이터 로드 (서버사이드 필터링)
  const loadResults = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await sessionsApi.getResults(sessionId, currentPage, titleFilter, statusFilter);
      if (res.success) {
        setResults(res.results || []);
        setPagination(res.pagination);
        setAvailableTitles(res.available_titles || []);
      } else {
        setError('결과를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load results:', err);
      setError('결과를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 필터 변경 시 페이지 1로 리셋하고 다시 로드
  useEffect(() => {
    setCurrentPage(1);
  }, [titleFilter, statusFilter]);

  useEffect(() => {
    if (sessionId) {
      loadResults();
    }
  }, [sessionId, currentPage, titleFilter, statusFilter]);

  // === Deep Monitoring: 패널 열 때 기존 대상 로드 ===
  useEffect(() => {
    if (deepPanelOpen && sessionId) {
      loadDeepTargets();
    }
  }, [deepPanelOpen, sessionId]);

  const loadDeepTargets = useCallback(async () => {
    try {
      const res = await deepMonitoringApi.getTargets(sessionId);
      if (res.success && res.targets && res.targets.length > 0) {
        setDeepTargets(res.targets);
        setDeepScanDone(true);
        // 실행 가능한 대상만 선택 (pending/failed)
        const selectableIds = new Set<number>(
          res.targets
            .filter((t: DeepMonitoringTarget) => t.id && (t.status === 'pending' || t.status === 'failed'))
            .map((t: DeepMonitoringTarget) => t.id!)
        );
        setDeepSelectedIds(selectableIds);
      }
    } catch {
      // 대상이 없으면 무시
    }
  }, [sessionId]);

  // === Deep Monitoring: 폴링 ===
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await deepMonitoringApi.getStatus(sessionId);
        if (res.success) {
          if (res.is_running) {
            setDeepProgress(res.progress || null);
          } else {
            // 실행 완료
            stopPolling();
            setDeepExecuting(false);
            setDeepProgress(null);
            setDeepSummary(res.summary || null);
            // 대상 목록 새로고침
            await loadDeepTargets();
            // 결과 테이블도 새로고침 (deep 결과가 병합됨)
            loadResults();
          }
        }
      } catch {
        // 폴링 에러는 무시
      }
    }, 2000);
  }, [sessionId, loadDeepTargets]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // 컴포넌트 언마운트 시 폴링 중지
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // === Deep Monitoring: 대상 검색 (Scan) ===
  const handleDeepScan = async () => {
    setDeepScanning(true);
    setDeepError(null);
    setDeepTargets([]);
    setDeepScanDone(false);
    setDeepSummary(null);
    
    try {
      const res = await deepMonitoringApi.scan(sessionId);
      if (res.success) {
        setDeepTargets(res.targets || []);
        setDeepScanDone(true);
        // 전체 선택
        const allIds = new Set<number>((res.targets || []).filter((t: DeepMonitoringTarget) => t.id).map((t: DeepMonitoringTarget) => t.id!));
        setDeepSelectedIds(allIds);
      } else {
        setDeepError(res.error || '대상 검색에 실패했습니다.');
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail ? ` (${err?.response?.data?.detail})` : '';
      setDeepError((err?.response?.data?.error || '대상 검색에 실패했습니다.') + detail);
    } finally {
      setDeepScanning(false);
    }
  };

  // === Deep Monitoring: 순차 실행 (Execute — 대상 1건씩) ===
  const handleDeepExecute = async () => {
    // 실행 대상: 선택된 ID 중 pending/failed 상태만
    const executableTargets = deepTargets.filter(
      t => t.id && deepSelectedIds.has(t.id) && (t.status === 'pending' || t.status === 'failed')
    );
    if (executableTargets.length === 0) {
      setDeepError('실행할 대상을 선택해주세요. (이미 완료된 대상은 건너뜁니다)');
      return;
    }

    setDeepExecuting(true);
    setDeepError(null);
    setDeepProgress({ total_targets: executableTargets.length, completed_targets: 0 });
    setDeepSummary(null);

    let completedCount = 0;
    let failedCount = 0;
    let totalNewUrls = 0;
    let totalResultsCount = 0;

    for (const target of executableTargets) {
      // 진행률 업데이트 (현재 대상 표시)
      setDeepProgress({
        total_targets: executableTargets.length,
        completed_targets: completedCount,
        current_target: `${target.title} x ${target.domain}`,
        results_so_far: totalNewUrls,
      });

      // 대상 상태를 running으로 UI 즉시 반영
      setDeepTargets(prev =>
        prev.map(t => t.id === target.id ? { ...t, status: 'running' as const } : t)
      );

      try {
        const res = await deepMonitoringApi.executeTarget(sessionId, target.id!);
        if (res.success) {
          if (res.skipped) {
            // 이미 완료된 대상 (방어코드)
            completedCount++;
          } else {
            completedCount++;
            totalNewUrls += res.new_urls_count || 0;
            totalResultsCount += res.results_count || 0;
          }
          // UI 반영: completed
          setDeepTargets(prev =>
            prev.map(t => t.id === target.id ? {
              ...t,
              status: 'completed' as const,
              results_count: res.results_count || 0,
              new_urls_count: res.new_urls_count || 0,
            } : t)
          );
        } else {
          // API 응답 실패
          failedCount++;
          setDeepTargets(prev =>
            prev.map(t => t.id === target.id ? { ...t, status: 'failed' as const } : t)
          );
          console.error(`대상 ${target.id} 실행 실패:`, res.error);
        }
      } catch (err: any) {
        // 네트워크/서버 오류
        failedCount++;
        setDeepTargets(prev =>
          prev.map(t => t.id === target.id ? { ...t, status: 'failed' as const } : t)
        );
        console.error(`대상 ${target.id} 실행 오류:`, err?.response?.data?.error || err?.message);
      }
    }

    // 전체 완료: 진행률 최종 업데이트
    setDeepProgress({
      total_targets: executableTargets.length,
      completed_targets: completedCount + failedCount,
      results_so_far: totalNewUrls,
    });

    // 후처리: 세션 통계 갱신
    try {
      await deepMonitoringApi.finalize(sessionId);
    } catch (err) {
      console.error('후처리 실패:', err);
    }

    // 최종 요약
    const alreadyCompleted = deepTargets.filter(
      t => t.status === 'completed' && !executableTargets.some(et => et.id === t.id)
    ).length;
    setDeepSummary({
      total: deepTargets.length,
      completed: completedCount + alreadyCompleted,
      failed: failedCount,
      pending: deepTargets.length - (completedCount + alreadyCompleted + failedCount),
    });

    setDeepExecuting(false);
    setDeepProgress(null);

    // 대상 목록 + 결과 테이블 새로고침
    await loadDeepTargets();
    loadResults();

    // 실패 건이 있으면 안내
    if (failedCount > 0) {
      setDeepError(`${failedCount}건의 대상이 실패했습니다. 실패한 대상을 선택하여 재실행할 수 있습니다.`);
    }
  };

  // === Deep Monitoring: 체크박스 토글 ===
  const toggleTargetSelect = (id: number) => {
    setDeepSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectableTargets = deepTargets.filter(t => (t.status === 'pending' || t.status === 'failed') && t.id);
    if (deepSelectedIds.size === selectableTargets.length) {
      setDeepSelectedIds(new Set());
    } else {
      setDeepSelectedIds(new Set(selectableTargets.map(t => t.id!)));
    }
  };

  // Deep Monitoring 상태 배지
  const getDeepStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">대기</span>;
      case 'running':
        return <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full animate-pulse">실행 중</span>;
      case 'completed':
        return <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">완료</span>;
      case 'failed':
        return <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">실패</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">{status}</span>;
    }
  };

  // 선택한 작품의 Manta URL 가져오기
  const getSelectedTitleMantaUrl = () => {
    if (titleFilter === 'all') return null;
    const title = titlesData.find(t => t.name === titleFilter);
    return title?.manta_url || null;
  };

  // 선택한 필터 조건의 모든 불법 URL 복사 (신고 제외 URL 필터링)
  const handleCopyAllIllegalUrls = async () => {
    setIsCopyingAll(true);
    try {
      // 서버에서 해당 조건의 모든 URL과 신고 제외 URL 목록 가져오기
      const [urlsRes, excludedRes] = await Promise.all([
        sessionsApi.getAllUrls(
          sessionId, 
          titleFilter, 
          statusFilter === 'all' ? 'illegal' : statusFilter
        ),
        excludedUrlsApi.getList()
      ]);
      
      if (urlsRes.success) {
        // 신고 제외 URL Set 생성
        const excludedUrls = new Set<string>(
          excludedRes.success ? excludedRes.items.map((item: { url: string }) => item.url) : []
        );
        
        // 불법 URL 중 신고 제외 URL을 제외하고 필터링
        const allIllegalUrls = urlsRes.results
          .filter((r: Result) => r.final_status === 'illegal')
          .map((r: Result) => r.url);
        
        const filteredUrls = allIllegalUrls.filter((url: string) => !excludedUrls.has(url));
        const excludedCount = allIllegalUrls.length - filteredUrls.length;
        
        if (filteredUrls.length === 0) {
          alert('복사할 불법 URL이 없습니다.' + (excludedCount > 0 ? ` (신고 제외 ${excludedCount}개)` : ''));
          return;
        }
        
        await navigator.clipboard.writeText(filteredUrls.join('\n'));
        setCopySuccess(true);
        
        // 제외된 URL이 있으면 알림
        if (excludedCount > 0) {
          console.log(`${filteredUrls.length}개 복사 완료 (신고 제외 ${excludedCount}개 제외됨)`);
        }
        
        setTimeout(() => setCopySuccess(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy URLs:', err);
      alert('URL 복사에 실패했습니다.');
    } finally {
      setIsCopyingAll(false);
    }
  };

  // Manta URL 복사
  const handleCopyMantaUrl = async () => {
    const mantaUrl = getSelectedTitleMantaUrl();
    if (mantaUrl) {
      await navigator.clipboard.writeText(mantaUrl);
      alert('Manta URL이 복사되었습니다.');
    }
  };

  // 상태 배지
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'illegal':
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">불법</span>;
      case 'legal':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">합법</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">대기</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">{status}</span>;
    }
  };

  // 행 배경색
  const getRowBgColor = (status: string) => {
    switch (status) {
      case 'illegal':
        return 'bg-red-50 hover:bg-red-100';
      case 'legal':
        return 'bg-green-50 hover:bg-green-100';
      case 'pending':
        return 'bg-yellow-50 hover:bg-yellow-100';
      default:
        return 'hover:bg-gray-50';
    }
  };

  // 다운로드
  const handleDownload = () => {
    window.open(`/api/sessions/${sessionId}/download`, '_blank');
  };

  // 불법 URL 개수 (서버에서 필터링된 전체 개수)
  const illegalCount = pagination?.total || 0;

  // Deep monitoring pending 대상 수
  // 실행 가능 대상: pending + failed (재실행 가능)
  const selectableTargets = deepTargets.filter(t => t.status === 'pending' || t.status === 'failed');

  return (
    <MainLayout pageTitle={`모니터링 회차: ${sessionId}`}>
      {/* 상단 네비게이션 */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button
          onClick={() => router.push('/sessions')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span>목록으로 돌아가기</span>
        </button>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAllIllegalUrls}
            disabled={isCopyingAll}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
              copySuccess 
                ? 'bg-green-600 text-white' 
                : 'bg-red-600 text-white hover:bg-red-700'
            } disabled:opacity-50`}
          >
            {isCopyingAll ? (
              <span>로딩...</span>
            ) : copySuccess ? (
              <>
                <CheckIcon className="w-4 h-4" />
                <span>복사됨!</span>
              </>
            ) : (
              <>
                <DocumentDuplicateIcon className="w-4 h-4" />
                <span>불법 URL 복사 {statusFilter === 'illegal' && pagination ? `(${pagination.total})` : ''}</span>
              </>
            )}
          </button>
          
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            <span>Excel 다운로드</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* ============================================ */}
      {/* 사이트 집중 모니터링 패널 (접이식, 상단 배치) */}
      {/* ============================================ */}
      <div className="mb-6">
        {/* 토글 버튼 - 좌측 정렬 */}
        <button
          onClick={() => setDeepPanelOpen(!deepPanelOpen)}
          className="flex items-center gap-2 w-full text-left group"
        >
          <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl shadow-sm border border-purple-200 hover:border-purple-400 transition w-full">
            <div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10h-2m0 0H9m2 0V8m0 2v2" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-gray-800">사이트 집중 모니터링</span>
              <span className="ml-2 text-xs text-gray-400">
                5개 이상 URL이 발견된 도메인에 대한 심층 검색
              </span>
            </div>
            {deepTargets.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full flex-shrink-0">
                {deepTargets.length}개 대상
              </span>
            )}
            <div className="flex-shrink-0">
              {deepPanelOpen ? (
                <ChevronUpIcon className="w-5 h-5 text-gray-400 group-hover:text-purple-600 transition" />
              ) : (
                <ChevronDownIcon className="w-5 h-5 text-gray-400 group-hover:text-purple-600 transition" />
              )}
            </div>
          </div>
        </button>

        {/* 패널 내용 */}
        {deepPanelOpen && (
          <div className="mt-2 space-y-4">
            {/* Step 1: 대상 검색 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold">1</span>
                  <h3 className="text-sm font-semibold text-gray-700">집중 모니터링 대상 검색</h3>
                  <span className="text-xs text-gray-400 ml-1">detection_results를 분석하여 대상 도메인 식별</span>
                </div>
                <button
                  onClick={handleDeepScan}
                  disabled={deepScanning || deepExecuting}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deepScanning ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>검색 중...</span>
                    </>
                  ) : (
                    <>
                      <MagnifyingGlassIcon className="w-4 h-4" />
                      <span>대상 검색</span>
                    </>
                  )}
                </button>
              </div>

              {/* 에러 메시지 */}
              {deepError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {deepError}
                </div>
              )}

              {/* 대상 목록 */}
              {deepScanDone && deepTargets.length === 0 && (
                <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500 text-center">
                  집중 모니터링 대상이 없습니다. (5개 이상 URL이 발견된 도메인이 없습니다)
                </div>
              )}

              {deepTargets.length > 0 && (
                <div>
                  {/* 전체 선택 헤더 */}
                  {selectableTargets.length > 0 && (
                    <div className="flex items-center gap-3 mb-3 pb-3 border-b border-gray-100">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={deepSelectedIds.size === selectableTargets.length && selectableTargets.length > 0}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                          disabled={deepExecuting}
                        />
                        <span className="text-sm text-gray-600">
                          전체 선택 ({deepSelectedIds.size}/{selectableTargets.length})
                        </span>
                      </label>
                    </div>
                  )}

                  {/* 대상 카드 목록 */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {deepTargets.map((target, idx) => (
                      <div
                        key={target.id || idx}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition ${
                          target.status === 'completed' 
                            ? 'border-green-200 bg-green-50'
                            : target.status === 'failed'
                            ? 'border-red-200 bg-red-50'
                            : target.status === 'running'
                            ? 'border-purple-200 bg-purple-50'
                            : deepSelectedIds.has(target.id!) 
                            ? 'border-purple-300 bg-purple-50'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        {/* 체크박스 (pending/failed 상태) */}
                        <div className="pt-0.5 flex-shrink-0">
                          {(target.status === 'pending' || target.status === 'failed') ? (
                            <input
                              type="checkbox"
                              checked={deepSelectedIds.has(target.id!)}
                              onChange={() => toggleTargetSelect(target.id!)}
                              className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                              disabled={deepExecuting}
                            />
                          ) : (
                            <div className="w-4 h-4" />
                          )}
                        </div>

                        {/* 카드 내용 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-gray-800 truncate">{target.title}</span>
                            <span className="text-xs text-gray-400">x</span>
                            <span className="text-sm font-mono text-purple-700 truncate">{target.domain}</span>
                            {getDeepStatusBadge(target.status)}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span>URL: <strong className="text-gray-700">{target.url_count}</strong>개</span>
                            <span className="text-gray-300">|</span>
                            <span className="font-mono text-purple-600 truncate" title={target.deep_query}>{target.deep_query}</span>
                          </div>
                          {/* 완료된 대상의 결과 표시 */}
                          {target.status === 'completed' && (
                            <div className="mt-1 flex items-center gap-3 text-xs">
                              <span className="text-green-700">결과: {target.results_count}건</span>
                              <span className="text-blue-700">신규 URL: {target.new_urls_count}건</span>
                            </div>
                          )}
                          {/* 키워드 상세 (접이식) */}
                          {target.keyword_breakdown && target.keyword_breakdown.length > 0 && (
                            <details className="mt-1">
                              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                                키워드 상세 ({target.keyword_breakdown.length}개)
                              </summary>
                              <div className="mt-1 pl-2 space-y-0.5">
                                {target.keyword_breakdown.map((kb, ki) => (
                                  <div key={ki} className="text-xs text-gray-500">
                                    <span className="font-mono">{kb.keyword}</span>
                                    <span className="ml-1 text-gray-400">({kb.urls} URLs)</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: 실행 */}
            {deepTargets.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold">2</span>
                    <h3 className="text-sm font-semibold text-gray-700">집중 모니터링 실행</h3>
                    {deepSelectedIds.size > 0 && !deepExecuting && (
                      <span className="text-xs text-gray-400 ml-1">
                        {deepSelectedIds.size}개 대상 선택됨
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleDeepExecute}
                    disabled={deepExecuting || deepSelectedIds.size === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deepExecuting ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>실행 중...</span>
                      </>
                    ) : deepTargets.some(t => t.status === 'failed') ? (
                      <>
                        <PlayIcon className="w-4 h-4" />
                        <span>실패 대상 재실행</span>
                      </>
                    ) : (
                      <>
                        <PlayIcon className="w-4 h-4" />
                        <span>집중 모니터링 시작</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 실행 중 프로그레스 바 */}
                {deepExecuting && deepProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        진행률: {deepProgress.completed_targets}/{deepProgress.total_targets}
                      </span>
                      {deepProgress.current_target && (
                        <span className="text-xs text-purple-600 font-mono truncate ml-2">
                          {deepProgress.current_target}
                        </span>
                      )}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div
                        className="bg-purple-600 h-2.5 rounded-full transition-all duration-500"
                        style={{
                          width: `${deepProgress.total_targets > 0 
                            ? (deepProgress.completed_targets / deepProgress.total_targets) * 100 
                            : 0}%`
                        }}
                      />
                    </div>
                    {deepProgress.results_so_far !== undefined && (
                      <p className="text-xs text-gray-500">
                        현재까지 수집: {deepProgress.results_so_far}건
                      </p>
                    )}
                  </div>
                )}

                {deepExecuting && !deepProgress && (
                  <div className="flex items-center gap-2 text-sm text-purple-600">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>심층 검색을 시작하는 중...</span>
                  </div>
                )}

                {/* 완료 요약 */}
                {!deepExecuting && deepSummary && deepSummary.completed > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-purple-50 rounded-lg text-center">
                      <div className="text-lg font-bold text-purple-700">{deepSummary.total}</div>
                      <div className="text-xs text-gray-500">전체 대상</div>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg text-center">
                      <div className="text-lg font-bold text-green-700">{deepSummary.completed}</div>
                      <div className="text-xs text-gray-500">완료</div>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg text-center">
                      <div className="text-lg font-bold text-red-700">{deepSummary.failed}</div>
                      <div className="text-xs text-gray-500">실패</div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                      <div className="text-lg font-bold text-gray-700">{deepSummary.pending}</div>
                      <div className="text-xs text-gray-500">대기</div>
                    </div>
                  </div>
                )}

                {/* 완료된 대상별 결과 테이블 */}
                {!deepExecuting && deepTargets.some(t => t.status === 'completed') && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">실행 결과 상세</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-purple-50 border-b border-purple-100">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-purple-700">작품</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-purple-700">도메인</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-purple-700">검색 결과</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-purple-700">신규 URL</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-purple-700">상태</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {deepTargets.filter(t => t.status === 'completed' || t.status === 'failed').map((target, idx) => (
                            <tr key={target.id || idx} className={target.status === 'completed' ? 'bg-green-50/50' : 'bg-red-50/50'}>
                              <td className="px-3 py-2 text-gray-800">{target.title}</td>
                              <td className="px-3 py-2 font-mono text-gray-600">{target.domain}</td>
                              <td className="px-3 py-2 text-center">{target.results_count}</td>
                              <td className="px-3 py-2 text-center font-medium text-blue-700">{target.new_urls_count}</td>
                              <td className="px-3 py-2 text-center">{getDeepStatusBadge(target.status)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      * 신규 URL은 원본 세션의 결과에 source=&quot;deep&quot;으로 병합되었습니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 필터 */}
      <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">작품 선택</label>
            <select
              value={titleFilter}
              onChange={(e) => setTitleFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">전체 작품</option>
              {availableTitles.map(title => (
                <option key={title} value={title}>{title}</option>
              ))}
            </select>
            
            {/* 선택한 작품의 Manta URL 토글 */}
            {titleFilter !== 'all' && getSelectedTitleMantaUrl() && (
              <div className="mt-2">
                <button
                  onClick={() => setShowMantaUrl(!showMantaUrl)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  Manta 공식 페이지
                  {showMantaUrl ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                </button>
                {showMantaUrl && (
                  <div className="mt-1 p-2 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <a
                        href={getSelectedTitleMantaUrl()!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline break-all flex-1"
                      >
                        {getSelectedTitleMantaUrl()}
                      </a>
                      <button
                        onClick={handleCopyMantaUrl}
                        className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                        title="URL 복사"
                      >
                        <ClipboardIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">상태 필터</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">전체 상태</option>
              <option value="illegal">불법</option>
              <option value="legal">합법</option>
              <option value="pending">대기</option>
            </select>
          </div>
          
          <div className="flex items-end">
            {pagination && (
              <div className="text-sm text-gray-600 py-2">
                총 <strong>{pagination.total.toLocaleString()}</strong>건
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>결과가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">작품</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">도메인</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">URL</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">상태</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">페이지</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">순위</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((result, idx) => (
                  <tr key={idx} className={`transition ${getRowBgColor(result.final_status)}`}>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-800">{result.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono text-gray-600">{result.domain}</span>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate block max-w-xs"
                        title={result.url}
                      >
                        {result.url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getStatusBadge(result.final_status)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-600">{result.page}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-600">{result.rank}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {pagination && pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">
              {currentPage} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={currentPage === pagination.totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
