'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout';
import { domainAnalysisApi } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ============================================
// 타입 정의
// ============================================

interface DomainResult {
  rank: number;
  domain: string;
  threat_score: number | null;
  global_rank: number | null;
  country: string | null;
  country_rank: number | null;
  category: string | null;
  category_rank: number | null;
  total_visits: number | null;
  avg_visit_duration: string | null;
  visits_change_mom: number | null;
  rank_change_mom: number | null;
  total_backlinks: number | null;
  referring_domains: number | null;
  top_organic_keywords: string[] | null;
  top_referring_domains: string[] | null;
  top_anchors: string[] | null;
  branded_traffic_ratio: number | null;
  size_score: number | null;
  growth_score: number | null;
  influence_score: number | null;
  recommendation: string | null;
}

interface ReportData {
  id: number;
  analysis_month: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_domains: number | null;
  report_blob_url: string | null;
  report_markdown: string | null;
  created_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface MonthItem {
  month: string;
  status: string;
}

// ============================================
// 유틸리티 함수
// ============================================

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y}년 ${parseInt(m)}월`;
}

function formatVisits(num: number | null): string {
  if (num === null || num === undefined) return '-';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + 'K';
  return num.toLocaleString();
}

function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return '-';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + 'K';
  return num.toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ============================================
// 컴포넌트
// ============================================

export default function DomainAnalysisPage() {
  // 상태
  const [selectedMonth, setSelectedMonth] = useState(getPreviousMonth());
  const [months, setMonths] = useState<MonthItem[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [activeTab, setActiveTab] = useState<'table' | 'report'>('table');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailDomain, setDetailDomain] = useState<DomainResult | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // ============================================
  // 데이터 로딩
  // ============================================

  const loadMonths = useCallback(async () => {
    try {
      const res = await domainAnalysisApi.getMonths();
      if (res.success && res.months) {
        setMonths(res.months);
      }
    } catch (err) {
      console.error('Failed to load months:', err);
    }
  }, []);

  const loadResult = useCallback(async (month: string) => {
    setIsLoading(true);
    setError(null);
    setReport(null);
    setResults([]);

    try {
      const res = await domainAnalysisApi.getResult(month);
      if (res.success && res.data) {
        setReport(res.data.report);
        setResults(res.data.results || []);

        // running 상태이면 폴링 시작
        if (res.data.report.status === 'running') {
          startPolling(month);
        }
      }
      // data가 null이면 해당 월 데이터 없음 → 기본 빈 상태
    } catch (err) {
      console.error('Failed to load result:', err);
      setError('데이터를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ============================================
  // 폴링 (분석 진행 상태 확인)
  // ============================================

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((month: string) => {
    stopPolling();
    setIsRunning(true);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await domainAnalysisApi.getStatus(month);
        if (!res.success || !res.data) return;

        const { status, manus_status } = res.data;

        if (status === 'completed') {
          stopPolling();
          setIsRunning(false);
          loadResult(month);
          loadMonths();
        } else if (status === 'failed') {
          stopPolling();
          setIsRunning(false);
          setReport(prev => prev ? { ...prev, status: 'failed', error_message: res.data.error_message } : null);
        } else if (manus_status === 'completed') {
          // Manus 완료 → process-result 호출
          try {
            const processRes = await domainAnalysisApi.processResult(month);
            if (processRes.success) {
              stopPolling();
              setIsRunning(false);
              loadResult(month);
              loadMonths();
            } else {
              // process-result가 실패 응답을 반환한 경우
              console.error('Process-result failed:', processRes.error);
              stopPolling();
              setIsRunning(false);
              setReport(prev => prev ? { ...prev, status: 'failed', error_message: processRes.error || '결과 처리 중 오류가 발생했습니다.' } : null);
            }
          } catch (processErr: any) {
            // process-result API 호출 자체 실패 (타임아웃 등)
            const errData = processErr?.response?.data;
            if (errData?.error) {
              console.error('Process-result error:', errData.error);
              stopPolling();
              setIsRunning(false);
              setReport(prev => prev ? { ...prev, status: 'failed', error_message: errData.error } : null);
            }
            // errData 없으면 다음 폴링에서 재시도 (일시적 네트워크 오류 등)
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 10_000); // 10초 간격
  }, [stopPolling, loadResult, loadMonths]);

  // ============================================
  // 액션 핸들러
  // ============================================

  const handleRun = async () => {
    if (isRunning) return;

    const confirmMsg = report?.status === 'completed'
      ? '이미 완료된 분석이 있습니다. 재분석을 실행하시겠습니까?'
      : '분석을 시작하시겠습니까? (Manus 크레딧이 소비됩니다)';

    if (!confirm(confirmMsg)) return;

    setError(null);

    try {
      // 완료된 분석이 있으면 먼저 rerun으로 상태 리셋
      if (report?.status === 'completed') {
        await domainAnalysisApi.rerun(selectedMonth);
      }

      const res = await domainAnalysisApi.run(selectedMonth);
      if (res.success) {
        setReport({
          id: res.data.report_id,
          analysis_month: res.data.analysis_month,
          status: 'running',
          total_domains: res.data.total_domains,
          report_blob_url: null,
          report_markdown: null,
          created_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
        });
        setResults([]);
        startPolling(selectedMonth);
        loadMonths();
      } else {
        setError(res.error || '분석 실행에 실패했습니다.');
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || '분석 실행에 실패했습니다.';
      setError(msg);
    }
  };

  const handleDownload = () => {
    const markdown = report?.report_markdown;
    if (!markdown) return;

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `domain-analysis-${selectedMonth}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============================================
  // 초기 로딩
  // ============================================

  useEffect(() => {
    loadMonths();
    loadResult(selectedMonth);
    return () => stopPolling();
  }, []);

  useEffect(() => {
    stopPolling();
    loadResult(selectedMonth);
  }, [selectedMonth]);

  // ============================================
  // 요약 통계 계산
  // ============================================

  const summaryStats = (() => {
    if (results.length === 0) return null;
    const highRisk = results.filter(r => r.threat_score !== null && r.threat_score >= 70).length;
    const avgThreat = results.reduce((sum, r) => sum + (r.threat_score || 0), 0) / results.length;
    return {
      totalDomains: results.length,
      highRisk,
      avgThreat: avgThreat.toFixed(1),
      completedAt: report?.completed_at,
    };
  })();

  // ============================================
  // 상태 뱃지 렌더
  // ============================================

  const statusBadge = () => {
    if (!report) return null;
    const map: Record<string, { bg: string; dot: string; text: string; label: string }> = {
      completed: { bg: 'bg-green-100', dot: 'bg-green-500', text: 'text-green-700', label: '완료' },
      running: { bg: 'bg-blue-100', dot: 'bg-blue-500', text: 'text-blue-700', label: '분석 중' },
      failed: { bg: 'bg-red-100', dot: 'bg-red-500', text: 'text-red-700', label: '실패' },
      pending: { bg: 'bg-yellow-100', dot: 'bg-yellow-500', text: 'text-yellow-700', label: '대기' },
    };
    const s = map[report.status] || map.pending;
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`}></span>
        {s.label}
      </span>
    );
  };

  // ============================================
  // 월 선택 옵션 생성
  // ============================================

  const monthOptions = (() => {
    const set = new Set<string>();
    set.add(getCurrentMonth());
    months.forEach(m => set.add(m.month));

    // 최근 6개월 추가
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    return Array.from(set).sort().reverse();
  })();

  // ============================================
  // 권고사항 뱃지 색상
  // ============================================

  const recBadgeColor = (rec: string | null) => {
    if (!rec) return 'bg-gray-100 text-gray-600';
    if (rec.includes('즉시')) return 'bg-red-100 text-red-700';
    if (rec.includes('법적')) return 'bg-orange-100 text-orange-700';
    if (rec.includes('긴급')) return 'bg-yellow-100 text-yellow-700';
    if (rec.includes('DMCA')) return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-600';
  };

  // ============================================
  // 렌더링
  // ============================================

  return (
    <MainLayout pageTitle="월간 불법 도메인 분석">
      {/* 페이지 헤더 */}
      <p className="text-sm text-gray-500 -mt-2 mb-1">
        Manus AI를 활용한 해적사이트 트래픽 분석 리포트
      </p>
      <p className="text-sm text-gray-500 mb-4">
        (매월 12일 이후 모니터링 파이프라인 실행됨. SimilarWeb 월간 트래픽 데이터는 익월 10일까지 갱신)
      </p>

      {/* 컨트롤 바 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600">분석 월:</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[160px]"
            >
              {monthOptions.map(m => (
                <option key={m} value={m}>{formatMonthLabel(m)}</option>
              ))}
            </select>
            {statusBadge()}
            <span className="text-xs text-gray-400">수동 분석 시 선택한 달의 데이터로 분석이 진행됩니다</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className={`px-4 py-2 rounded-lg transition text-sm font-medium flex items-center gap-2 ${
                isRunning
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {report?.status === 'completed' ? '재분석 실행' : '분석 실행'}
            </button>
            {report?.status === 'completed' && report.report_markdown && (
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                보고서 다운로드
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 에러 메시지 (실행 실패 등) */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          {(() => {
            const stepMatch = error.match(/^\[([^\]]+)\]/)
            const stepLabel = stepMatch ? stepMatch[1] : null
            const msgBody = stepMatch ? error.slice(stepMatch[0].length).trim() : error
            return (
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div>
                  {stepLabel && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-red-200 text-red-800 mr-2">
                      {stepLabel}
                    </span>
                  )}
                  <span className="text-sm text-red-700">{msgBody}</span>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* 로딩 */}
      {isLoading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12">
          <div className="flex items-center justify-center text-gray-400">
            <p>로딩 중...</p>
          </div>
        </div>
      )}

      {/* 데이터 없음 (분석 실행 전) */}
      {!isLoading && !report && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12">
          <div className="text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <h3 className="text-lg font-semibold text-gray-600 mb-2">아직 분석 결과가 없습니다</h3>
            <p className="text-sm text-gray-400 mb-4">해당 월의 도메인 분석을 실행해주세요.</p>
            <p className="text-xs text-gray-400 mb-6">
              매월 12일 이후 자동 분석이 실행됩니다 (SimilarWeb 월간 데이터 익월 10일 갱신 기준).
            </p>
            <button
              onClick={handleRun}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
            >
              분석 시작
            </button>
          </div>
        </div>
      )}

      {/* 실행 중 */}
      {!isLoading && report?.status === 'running' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12">
          <div className="text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-gray-200"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Manus AI가 분석 중입니다</h3>
            <p className="text-sm text-gray-400 mb-3">
              {report.total_domains || 50}개 불법 도메인의 트래픽 데이터를 수집하고 위협도를 분석합니다.
            </p>
            <p className="text-xs text-gray-400">예상 소요시간: 5~10분</p>
            <div className="mt-6 max-w-md mx-auto">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 실패 */}
      {!isLoading && report?.status === 'failed' && (
        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-red-700 mb-2">분석 실패</h3>
          </div>

          {/* 에러 상세 박스 */}
          {report.error_message && (
            <div className="max-w-2xl mx-auto mb-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                {/* 실패 단계 표시 */}
                {(() => {
                  const stepMatch = report.error_message.match(/^\[([^\]]+)\]/)
                  const stepLabel = stepMatch ? stepMatch[1] : null
                  const msgBody = stepMatch ? report.error_message.slice(stepMatch[0].length).trim() : report.error_message
                  return (
                    <>
                      {stepLabel && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-200 text-red-800">
                            실패 단계
                          </span>
                          <span className="text-sm font-mono font-semibold text-red-700">{stepLabel}</span>
                        </div>
                      )}
                      <p className="text-sm text-red-700 leading-relaxed">{msgBody}</p>
                    </>
                  )
                })()}
              </div>

              {/* 유지보수 안내 */}
              <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500 font-medium mb-1.5">유지보수 참고</p>
                <ul className="text-xs text-gray-400 space-y-0.5 list-disc list-inside">
                  {report.error_message.includes('1/5') || report.error_message.includes('1/6') ? (
                    <>
                      <li>Manus API KEY가 올바른지 확인하세요 (환경변수: MANUS_API_KEY)</li>
                      <li>Manus API (api.manus.ai) 서버 상태를 확인하세요</li>
                    </>
                  ) : report.error_message.includes('2/5') || report.error_message.includes('2/6') ? (
                    <>
                      <li>Manus 콘솔에서 해당 Task의 출력을 직접 확인하세요</li>
                      <li>프롬프트 형식이 변경되었는지 확인하세요</li>
                    </>
                  ) : report.error_message.includes('3/5') || report.error_message.includes('3/6') ? (
                    <>
                      <li>domain_analysis_results 테이블 스키마를 확인하세요</li>
                      <li>DB 연결 상태를 확인하세요 (환경변수: DATABASE_URL)</li>
                    </>
                  ) : report.error_message.includes('4/5') || report.error_message.includes('4/6') ? (
                    <>
                      <li>Vercel Blob 토큰이 유효한지 확인하세요 (환경변수: BLOB_READ_WRITE_TOKEN)</li>
                      <li>Blob 업로드 실패는 보고서 마크다운이 DB에 백업됩니다</li>
                    </>
                  ) : report.error_message.includes('5/5') || report.error_message.includes('5/6') || report.error_message.includes('6/6') ? (
                    <>
                      <li>domain_analysis_reports 테이블 스키마를 확인하세요</li>
                      <li>DB 연결 상태를 확인하세요</li>
                    </>
                  ) : (
                    <>
                      <li>서버 로그에서 상세 에러를 확인하세요 (Vercel Function Logs)</li>
                      <li>환경변수 (MANUS_API_KEY, DATABASE_URL)를 확인하세요</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          )}

          {!report.error_message && (
            <p className="text-sm text-gray-500 mb-6 text-center">
              Manus Task가 오류를 반환했습니다. 재시도해주세요.
            </p>
          )}

          <div className="text-center">
            <button
              onClick={handleRun}
              className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
            >
              재분석 실행
            </button>
          </div>
        </div>
      )}

      {/* 완료 - 메인 뷰 */}
      {!isLoading && report?.status === 'completed' && (
        <>
          {/* 요약 카드 (컴팩트) */}
          {summaryStats && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-3">
                <div className="w-7 h-7 bg-blue-50 rounded-md flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900 leading-tight">
                    {summaryStats.totalDomains}<span className="text-xs font-normal text-gray-400 ml-1">개</span>
                  </p>
                  <p className="text-[10px] text-gray-400">분석 도메인</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-3">
                <div className="w-7 h-7 bg-red-50 rounded-md flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-red-600 leading-tight">
                    {summaryStats.highRisk}<span className="text-[10px] font-normal text-gray-400 ml-1">&gt;= 70점</span>
                  </p>
                  <p className="text-[10px] text-gray-400">고위험 사이트</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-3">
                <div className="w-7 h-7 bg-orange-50 rounded-md flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-orange-600 leading-tight">
                    {summaryStats.avgThreat}<span className="text-[10px] font-normal text-gray-400 ml-1">/ 100</span>
                  </p>
                  <p className="text-[10px] text-gray-400">평균 위협 점수</p>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-3 py-2 flex items-center gap-3">
                <div className="w-7 h-7 bg-green-50 rounded-md flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 leading-tight">{formatDate(summaryStats.completedAt ?? null)}</p>
                  <p className="text-[10px] text-gray-400">분석 완료 {formatTime(summaryStats.completedAt ?? null)}</p>
                </div>
              </div>
            </div>
          )}

          {/* 탭 네비게이션 */}
          <div className="bg-white rounded-t-xl shadow-sm border border-gray-100 border-b-0">
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('table')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition ${
                  activeTab === 'table'
                    ? 'border-blue-600 text-blue-600 font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                우선순위 목록
              </button>
              <button
                onClick={() => setActiveTab('report')}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition ${
                  activeTab === 'report'
                    ? 'border-blue-600 text-blue-600 font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                분석 보고서
              </button>
            </div>
          </div>

          {/* 탭 콘텐츠: 테이블 */}
          {activeTab === 'table' && (
            <div className="bg-white rounded-b-xl shadow-sm border border-gray-100 border-t-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-12">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[180px]">도메인</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-[140px]">위협 점수</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">월간 방문</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">MoM 변화</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">글로벌 순위</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">국가</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">백링크</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">참조 도메인</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[200px]">주요 키워드</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[120px]">권고사항</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((d, idx) => {
                      const ts = d.threat_score || 0;
                      const threatColor = ts >= 70 ? 'bg-red-500' : ts >= 40 ? 'bg-yellow-500' : 'bg-green-500';
                      const threatTextColor = ts >= 70 ? 'text-red-600' : ts >= 40 ? 'text-yellow-600' : 'text-green-600';
                      const mom = d.visits_change_mom;
                      const momColor = mom !== null && mom > 0 ? 'text-red-600' : mom !== null && mom < 0 ? 'text-green-600' : 'text-gray-500';
                      const momIcon = mom !== null && mom > 0 ? '\u25B2' : mom !== null && mom < 0 ? '\u25BC' : '';

                      return (
                        <tr
                          key={d.domain || idx}
                          className="hover:bg-blue-50/50 transition cursor-pointer"
                          onClick={() => setDetailDomain(d)}
                        >
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                              d.rank <= 3 ? 'bg-red-100 text-red-700' : d.rank <= 10 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                            }`}>{d.rank}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-900 text-sm">{d.domain}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div className={`h-2 rounded-full transition-all ${threatColor}`} style={{ width: `${ts}%` }}></div>
                                </div>
                              </div>
                              <span className={`text-sm font-bold ${threatTextColor} w-10 text-right`}>{d.threat_score ?? '-'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-medium text-gray-900">{formatVisits(d.total_visits)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-sm font-medium ${momColor}`}>
                              {mom !== null ? `${momIcon} ${Math.abs(mom).toFixed(1)}%` : '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm text-gray-700">{d.global_rank ? `#${d.global_rank.toLocaleString()}` : '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            {d.country ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{d.country}</span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm text-gray-700">{formatNumber(d.total_backlinks)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm text-gray-700">{d.referring_domains ? d.referring_domains.toLocaleString() : '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(d.top_organic_keywords || []).slice(0, 3).map((k, ki) => (
                                <span key={ki} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs truncate max-w-[80px]" title={k}>{k}</span>
                              ))}
                              {d.top_organic_keywords && d.top_organic_keywords.length > 3 && (
                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">+{d.top_organic_keywords.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {d.recommendation && (
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${recBadgeColor(d.recommendation)}`}>
                                {d.recommendation}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 푸터 정보 */}
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-sm text-gray-500">
                <span>총 {results.length}개 사이트</span>
                <span>데이터 기준: {formatMonthLabel(selectedMonth)} (SimilarWeb + Semrush)</span>
              </div>

              {/* 컬럼 범례 */}
              <div className="px-5 py-4 border-t border-gray-100 bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block"></span>
                      SimilarWeb 데이터
                    </p>
                    <div className="space-y-0.5 pl-3">
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">위협 점수</span> — 규모(40) + 성장(40) + 영향력(20)으로 산출된 종합 위험도 (0~100)</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">월간 방문</span> — SimilarWeb 기준 최근 1개월 총 방문 횟수 추정치</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">MoM 변화</span> — 전월 대비 방문 수 변화율 (%). 양수=증가, 음수=감소</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">글로벌 순위</span> — SimilarWeb 전 세계 웹사이트 트래픽 순위</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">국가</span> — 해당 사이트의 주요 트래픽 유입 국가 (ISO 코드)</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
                      Semrush 데이터
                    </p>
                    <div className="space-y-0.5 pl-3">
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">백링크</span> — 외부에서 이 사이트로 연결되는 총 링크 수. 많을수록 검색 노출이 높음</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">참조 도메인</span> — 백링크를 제공하는 고유 도메인 수. DMCA 대응 범위 판단에 활용</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">주요 키워드</span> — 검색 유입이 가장 많은 상위 5개 오가닉 키워드. 디인덱싱 대응에 활용</p>
                      <p className="text-[10px] text-gray-400"><span className="text-gray-500 font-medium">권고사항</span> — 위협 점수 및 성장 추이 기반 대응 우선순위 (즉시 법적조치 / DMCA 강화 / 모니터링)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 탭 콘텐츠: 보고서 */}
          {activeTab === 'report' && (
            <div className="bg-white rounded-b-xl shadow-sm border border-gray-100 border-t-0 p-6">
              {report.report_markdown ? (
                <div className="max-w-4xl mx-auto prose prose-sm prose-slate prose-headings:text-slate-800 prose-a:text-blue-600 prose-table:text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {report.report_markdown
                      .replace(/\|\s*\*?\*?작성\*?\*?\s*[:：]\s*.*?Manus.*?\n?/gi, '')
                      .replace(/\*?\*?작성\*?\*?\s*[:：]\s*.*?Manus.*?\n?/gi, '')
                    }
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <p>보고서 마크다운이 없습니다.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 도메인 상세 모달 */}
      {detailDomain && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setDetailDomain(null); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">{detailDomain.domain}</h2>
              <button onClick={() => setDetailDomain(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* 위협 점수 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-600">종합 위협 점수</span>
                  <span className={`text-2xl font-bold ${
                    (detailDomain.threat_score || 0) >= 70 ? 'text-red-600' : (detailDomain.threat_score || 0) >= 40 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {detailDomain.threat_score ?? '-'} / 100
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-1">규모 점수</p>
                    <p className="text-lg font-bold text-blue-600">{detailDomain.size_score ?? '-'} <span className="text-xs text-gray-400">/ 40</span></p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-1">성장 점수</p>
                    <p className="text-lg font-bold text-green-600">{detailDomain.growth_score ?? '-'} <span className="text-xs text-gray-400">/ 40</span></p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-1">영향력 점수</p>
                    <p className="text-lg font-bold text-purple-600">{detailDomain.influence_score ?? '-'} <span className="text-xs text-gray-400">/ 20</span></p>
                  </div>
                </div>
              </div>

              {/* SimilarWeb 트래픽 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block"></span>
                  트래픽 데이터 (SimilarWeb)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">글로벌 순위</span>
                    <span className="text-sm font-medium">{detailDomain.global_rank ? `#${detailDomain.global_rank.toLocaleString()}` : '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">국가 순위 ({detailDomain.country || '-'})</span>
                    <span className="text-sm font-medium">{detailDomain.country_rank ? `#${detailDomain.country_rank.toLocaleString()}` : '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">월간 방문</span>
                    <span className="text-sm font-medium text-blue-600">{detailDomain.total_visits ? detailDomain.total_visits.toLocaleString() : '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">평균 방문시간</span>
                    <span className="text-sm font-medium">{detailDomain.avg_visit_duration || '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">방문 변화 (MoM)</span>
                    <span className={`text-sm font-medium ${
                      detailDomain.visits_change_mom !== null && detailDomain.visits_change_mom > 0 ? 'text-red-600' :
                      detailDomain.visits_change_mom !== null && detailDomain.visits_change_mom < 0 ? 'text-green-600' : ''
                    }`}>
                      {detailDomain.visits_change_mom !== null ? `${detailDomain.visits_change_mom > 0 ? '+' : ''}${detailDomain.visits_change_mom}%` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">순위 변화 (MoM)</span>
                    <span className="text-sm font-medium">
                      {detailDomain.rank_change_mom !== null ? (detailDomain.rank_change_mom > 0 ? `+${detailDomain.rank_change_mom}` : detailDomain.rank_change_mom.toString()) : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">카테고리</span>
                    <span className="text-sm font-medium">{detailDomain.category || '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">카테고리 순위</span>
                    <span className="text-sm font-medium">{detailDomain.category_rank ? `#${detailDomain.category_rank}` : '-'}</span>
                  </div>
                </div>
              </div>

              {/* Semrush SEO */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
                  SEO 데이터 (Semrush)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">총 백링크</span>
                    <span className="text-sm font-medium">{detailDomain.total_backlinks ? detailDomain.total_backlinks.toLocaleString() : '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">참조 도메인</span>
                    <span className="text-sm font-medium">{detailDomain.referring_domains ? detailDomain.referring_domains.toLocaleString() : '-'}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100 col-span-2">
                    <span className="text-sm text-gray-500">브랜드 트래픽 비율</span>
                    <span className="text-sm font-medium">{detailDomain.branded_traffic_ratio !== null ? `${detailDomain.branded_traffic_ratio}%` : '-'}</span>
                  </div>
                </div>
                {detailDomain.top_organic_keywords && detailDomain.top_organic_keywords.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-2">상위 오가닉 키워드:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailDomain.top_organic_keywords.map((k, i) => (
                        <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {detailDomain.top_referring_domains && detailDomain.top_referring_domains.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-2">주요 참조 도메인:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailDomain.top_referring_domains.map((d, i) => (
                        <span key={i} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">{d}</span>
                      ))}
                    </div>
                  </div>
                )}
                {detailDomain.top_anchors && detailDomain.top_anchors.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-2">주요 앵커 텍스트:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailDomain.top_anchors.map((a, i) => (
                        <span key={i} className="px-2 py-1 bg-purple-50 text-purple-600 rounded text-xs">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 권고사항 */}
              {detailDomain.recommendation && (
                <div className={`rounded-lg p-4 ${
                  (detailDomain.threat_score || 0) >= 70 ? 'bg-red-50 border border-red-200' :
                  (detailDomain.threat_score || 0) >= 40 ? 'bg-yellow-50 border border-yellow-200' :
                  'bg-green-50 border border-green-200'
                }`}>
                  <h3 className={`text-sm font-semibold mb-2 ${
                    (detailDomain.threat_score || 0) >= 70 ? 'text-red-700' :
                    (detailDomain.threat_score || 0) >= 40 ? 'text-yellow-700' :
                    'text-green-700'
                  }`}>권고사항</h3>
                  <p className={`text-sm ${
                    (detailDomain.threat_score || 0) >= 70 ? 'text-red-600' :
                    (detailDomain.threat_score || 0) >= 40 ? 'text-yellow-600' :
                    'text-green-600'
                  }`}>{detailDomain.recommendation}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
