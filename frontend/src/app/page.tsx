'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { dashboardApi, mantaRankingsApi } from '@/lib/api';

interface DashboardData {
  success: boolean;
  month: string;
  sessions_count: number;
  top_contents: { name: string; count: number }[];
  top_illegal_sites: { domain: string; count: number }[];
  report_stats: {
    discovered: number;
    reported: number;
    blocked: number;
    blockRate: number;
  };
}

interface MantaRanking {
  title: string;
  mantaRank: number | null;
  firstDomain: string;
  searchQuery: string;
  sessionId: string;
  page1IllegalCount: number;
}

export default function DashboardPage() {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Manta Rankings
  const [mantaRankings, setMantaRankings] = useState<MantaRanking[]>([]);
  const [isLoadingManta, setIsLoadingManta] = useState(true);
  const [mantaLastUpdated, setMantaLastUpdated] = useState<string | null>(null);

  // 월 목록 로드
  useEffect(() => {
    const loadMonths = async () => {
      try {
        const res = await dashboardApi.getMonths();
        if (res.success && res.months) {
          setMonths(res.months);
          if (res.months.length > 0) {
            setSelectedMonth(res.months[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load months:', err);
      }
    };
    loadMonths();
  }, []);

  // 대시보드 데이터 로드
  useEffect(() => {
    const loadDashboard = async () => {
      if (!selectedMonth) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const res = await dashboardApi.getData(selectedMonth);
        if (res.success) {
          setData(res);
        } else {
          setError('데이터를 불러오는데 실패했습니다.');
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err);
        setError('데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    loadDashboard();
  }, [selectedMonth]);

  // Manta Rankings 로드
  useEffect(() => {
    const loadMantaRankings = async () => {
      setIsLoadingManta(true);
      try {
        const res = await mantaRankingsApi.getAll();
        if (res.success && res.rankings) {
          setMantaRankings(res.rankings);
          if (res.lastUpdated) {
            setMantaLastUpdated(res.lastUpdated);
          }
        }
      } catch (err) {
        console.error('Failed to load manta rankings:', err);
      } finally {
        setIsLoadingManta(false);
      }
    };
    loadMantaRankings();
  }, []);

  // 숫자 포맷팅
  const formatNumber = (num: number) => {
    return num.toLocaleString('ko-KR');
  };

  // 월 포맷팅 (2025-01 -> 2025년 1월)
  const formatMonth = (month: string) => {
    const [year, m] = month.split('-');
    return `${year}년 ${parseInt(m)}월`;
  };

  // 날짜 포맷팅
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 순위 카드 배경색 (1위=초록, 2~5위=노랑계열, 10위 이상=빨강, 없음=회색)
  const getRankCardStyle = (rank: number | null) => {
    if (rank === null) return 'bg-gray-50 border-gray-200';
    if (rank === 1) return 'bg-green-50 border-green-200';
    if (rank <= 5) return 'bg-green-50 border-green-200';
    if (rank <= 10) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  // 순위 텍스트 색상
  const getRankTextColor = (rank: number | null) => {
    if (rank === null) return 'text-gray-400';
    if (rank === 1) return 'text-green-600';
    if (rank <= 5) return 'text-green-600';
    if (rank <= 10) return 'text-yellow-600';
    return 'text-red-600';
  };

  // 순위 표시 형식 (P1-1 = 페이지1, 1위)
  const formatRankDisplay = (rank: number | null) => {
    if (rank === null) return '순위권 외';
    return `P1-${rank}`;
  };

  return (
    <MainLayout pageTitle="대시보드">
      {/* 월 선택 드롭다운 */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">조회 기간</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
          {isLoading && (
            <span className="text-sm text-gray-500">로딩 중...</span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* 발견 */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">발견</p>
              <p className="text-2xl font-bold text-gray-800">
                {isLoading ? '-' : formatNumber(data?.report_stats.discovered || 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 text-xl">🔍</span>
            </div>
          </div>
        </div>

        {/* 신고 */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">신고</p>
              <p className="text-2xl font-bold text-gray-800">
                {isLoading ? '-' : formatNumber(data?.report_stats.reported || 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <span className="text-orange-600 text-xl">📢</span>
            </div>
          </div>
        </div>

        {/* 차단 */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">차단</p>
              <p className="text-2xl font-bold text-gray-800">
                {isLoading ? '-' : formatNumber(data?.report_stats.blocked || 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-600 text-xl">🛡️</span>
            </div>
          </div>
        </div>

        {/* 차단율 */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">차단율</p>
              <p className="text-2xl font-bold text-gray-800">
                {isLoading ? '-' : `${data?.report_stats.blockRate || 0}%`}
              </p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-purple-600 text-xl">📊</span>
            </div>
          </div>
        </div>
      </div>

      {/* 테이블 영역 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top 5 작품 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">Top 5 작품</h3>
            <p className="text-sm text-gray-500">불법 URL 발견 건수 기준</p>
          </div>
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : !data?.top_contents || data.top_contents.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <p>데이터가 없습니다</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-500 border-b border-gray-100">
                    <th className="pb-3 font-medium">순위</th>
                    <th className="pb-3 font-medium">작품명</th>
                    <th className="pb-3 font-medium text-right">발견 건수</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_contents.map((item, index) => (
                    <tr key={item.name} className="border-b border-gray-50 last:border-0">
                      <td className="py-3">
                        <span className={`
                          inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
                          ${index === 0 ? 'bg-yellow-100 text-yellow-700' : ''}
                          ${index === 1 ? 'bg-gray-200 text-gray-700' : ''}
                          ${index === 2 ? 'bg-orange-100 text-orange-700' : ''}
                          ${index > 2 ? 'bg-gray-100 text-gray-600' : ''}
                        `}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-3 text-sm text-gray-800 font-medium">{item.name}</td>
                      <td className="py-3 text-sm text-gray-600 text-right">{formatNumber(item.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Top 5 도메인 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">Top 5 불법 사이트</h3>
            <p className="text-sm text-gray-500">도메인별 발견 건수 기준</p>
          </div>
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : !data?.top_illegal_sites || data.top_illegal_sites.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <p>데이터가 없습니다</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-500 border-b border-gray-100">
                    <th className="pb-3 font-medium">순위</th>
                    <th className="pb-3 font-medium">도메인</th>
                    <th className="pb-3 font-medium text-right">발견 건수</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_illegal_sites.map((item, index) => (
                    <tr key={item.domain} className="border-b border-gray-50 last:border-0">
                      <td className="py-3">
                        <span className={`
                          inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
                          ${index === 0 ? 'bg-red-100 text-red-700' : ''}
                          ${index === 1 ? 'bg-red-50 text-red-600' : ''}
                          ${index === 2 ? 'bg-orange-50 text-orange-600' : ''}
                          ${index > 2 ? 'bg-gray-100 text-gray-600' : ''}
                        `}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-3 text-sm text-gray-800 font-medium font-mono">{item.domain}</td>
                      <td className="py-3 text-sm text-gray-600 text-right">{formatNumber(item.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Manta 검색 순위 - 카드 형태 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-800">Manta 검색 순위</h3>
          </div>
          {mantaLastUpdated && (
            <span className="text-xs text-gray-500">{formatDate(mantaLastUpdated)} 기준</span>
          )}
        </div>
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-xs text-gray-500">작품명만 검색 시 manta.net 순위 (P1-1 = 페이지1, 1위)</p>
        </div>
        <div className="p-6">
          {isLoadingManta ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <p>로딩 중...</p>
            </div>
          ) : mantaRankings.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <p>데이터가 없습니다</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {mantaRankings.map((ranking) => (
                <div
                  key={ranking.title}
                  className={`rounded-lg border p-4 ${getRankCardStyle(ranking.mantaRank)}`}
                >
                  {/* 작품명 */}
                  <h4 className="text-sm font-semibold text-gray-800 mb-2 line-clamp-1" title={ranking.title}>
                    {ranking.title}
                  </h4>
                  
                  {/* 순위 정보 */}
                  <div className="flex items-center justify-between">
                    <span className={`text-lg font-bold ${getRankTextColor(ranking.mantaRank)}`}>
                      {formatRankDisplay(ranking.mantaRank)}
                    </span>
                    
                    {/* 불법 건수 뱃지 */}
                    {ranking.page1IllegalCount > 0 && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                        불법 {ranking.page1IllegalCount}건/10
                      </span>
                    )}
                  </div>
                  
                  {/* 1위 도메인 */}
                  <p className="text-xs text-gray-500 mt-2 truncate" title={ranking.firstDomain}>
                    1위: {ranking.firstDomain}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
