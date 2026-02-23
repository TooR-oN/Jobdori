'use client';

import { useState, useEffect, useMemo } from 'react';
import { MainLayout } from '@/components/layout';
import { statsApi, titlesApi } from '@/lib/api';

interface TitleStat {
  title: string;
  discovered: number;
  reported: number;
  blocked: number;
  blockRate: number;
}

// 당월 기본 날짜 (YYYY-MM-01 ~ 오늘)
function getDefaultDates() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${day}`,
  };
}

export default function StatsPage() {
  const defaults = getDefaultDates();
  const [stats, setStats] = useState<TitleStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAllPeriod, setIsAllPeriod] = useState(false);
  const [showAllTitles, setShowAllTitles] = useState(false);
  
  // 현재 모니터링 중인 작품 목록
  const [currentTitles, setCurrentTitles] = useState<string[]>([]);
  
  // 날짜 필터 (기본값: 당월)
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  
  // 정렬
  const [sortField, setSortField] = useState<keyof TitleStat | 'isCurrent'>('discovered');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // 현재 모니터링 작품 목록 로드
  useEffect(() => {
    const loadTitles = async () => {
      try {
        const res = await titlesApi.getList();
        if (res.success) {
          setCurrentTitles((res.current || []).map((t: { name: string }) => t.name));
        }
      } catch (err) {
        console.error('Failed to load titles:', err);
      }
    };
    loadTitles();
  }, []);

  // 데이터 로드
  const loadStats = async (start?: string, end?: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await statsApi.byTitle(start || startDate || undefined, end || endDate || undefined);
      if (res.success) {
        setStats(res.stats || []);
      } else {
        setError('통계를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
      setError('통계를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats(defaults.start, defaults.end);
  }, []);

  // 날짜 필터 적용
  const handleFilter = () => {
    setIsAllPeriod(false);
    loadStats();
  };

  // 전체기간 토글
  const handleToggleAllPeriod = () => {
    if (isAllPeriod) {
      // 전체기간 → 당월로 복귀
      const d = getDefaultDates();
      setStartDate(d.start);
      setEndDate(d.end);
      setIsAllPeriod(false);
      loadStats(d.start, d.end);
    } else {
      // 당월 → 전체기간
      setStartDate('');
      setEndDate('');
      setIsAllPeriod(true);
      loadStats('', '');
    }
  };

  // 전체 작품 보기 토글
  const handleToggleAllTitles = () => {
    setShowAllTitles(prev => !prev);
  };

  // 정렬 처리
  const handleSort = (field: keyof TitleStat | 'isCurrent') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // 필터링된 데이터 (모니터링 중인 작품만 또는 전체)
  const filteredStats = useMemo(() => {
    if (showAllTitles) return stats;
    return stats.filter(s => currentTitles.includes(s.title));
  }, [stats, showAllTitles, currentTitles]);

  // 정렬된 데이터
  const sortedStats = useMemo(() => {
    return [...filteredStats].sort((a, b) => {
      if (sortField === 'isCurrent') {
        const aVal = currentTitles.includes(a.title) ? 1 : 0;
        const bVal = currentTitles.includes(b.title) ? 1 : 0;
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const aVal = a[sortField as keyof TitleStat];
      const bVal = b[sortField as keyof TitleStat];
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [filteredStats, sortField, sortOrder, currentTitles]);

  // 합계 계산
  const totals = filteredStats.reduce(
    (acc, s) => ({
      discovered: acc.discovered + s.discovered,
      reported: acc.reported + s.reported,
      blocked: acc.blocked + s.blocked,
    }),
    { discovered: 0, reported: 0, blocked: 0 }
  );
  const totalBlockRate = totals.reported > 0 ? Math.round((totals.blocked / totals.reported) * 100 * 10) / 10 : 0;

  // 정렬 아이콘
  const getSortIcon = (field: keyof TitleStat | 'isCurrent') => {
    if (sortField !== field) return '↕️';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  return (
    <MainLayout pageTitle="작품별 신고/차단 통계">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* 요약 카드 */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">총 작품</p>
          <p className="text-2xl font-bold text-gray-800">{filteredStats.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">총 발견</p>
          <p className="text-2xl font-bold text-blue-600">{totals.discovered.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">총 신고</p>
          <p className="text-2xl font-bold text-orange-600">{totals.reported.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">총 차단</p>
          <p className="text-2xl font-bold text-green-600">{totals.blocked.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">평균 차단율</p>
          <p className="text-2xl font-bold text-purple-600">{totalBlockRate}%</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="mb-6 bg-white rounded-xl shadow-sm p-4 border border-gray-100">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">시작일:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">종료일:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleFilter}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
            >
              조회
            </button>
            <button
              onClick={handleToggleAllPeriod}
              className={`px-4 py-2 rounded-lg transition text-sm font-medium ${
                isAllPeriod
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
              }`}
            >
              전체기간
            </button>
            <button
              onClick={handleToggleAllTitles}
              className={`px-4 py-2 rounded-lg transition text-sm font-medium ${
                showAllTitles
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              }`}
            >
              {showAllTitles ? '모니터링 작품만' : '전체 작품 보기'}
            </button>
          </div>
        </div>
      </div>

      {/* 통계 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : filteredStats.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>통계 데이터가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">순위</th>
                  <th 
                    className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('title')}
                  >
                    작품명 {getSortIcon('title')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100 w-16"
                    onClick={() => handleSort('isCurrent')}
                    title="모니터링 상태"
                  >
                    상태 {getSortIcon('isCurrent')}
                  </th>
                  <th 
                    className="px-4 py-3 text-right text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('discovered')}
                  >
                    발견 {getSortIcon('discovered')}
                  </th>
                  <th 
                    className="px-4 py-3 text-right text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('reported')}
                  >
                    신고 {getSortIcon('reported')}
                  </th>
                  <th 
                    className="px-4 py-3 text-right text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('blocked')}
                  >
                    차단 {getSortIcon('blocked')}
                  </th>
                  <th 
                    className="px-4 py-3 text-right text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('blockRate')}
                  >
                    차단율 {getSortIcon('blockRate')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedStats.map((stat, index) => {
                  const isCurrent = currentTitles.includes(stat.title);
                  return (
                    <tr key={stat.title} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-800">{stat.title}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${isCurrent ? 'bg-green-500' : 'bg-gray-300'}`}
                          title={isCurrent ? '모니터링 중' : '모니터링 중단'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-blue-600 font-medium">{stat.discovered.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-orange-600 font-medium">{stat.reported.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-green-600 font-medium">{stat.blocked.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-medium ${
                          stat.blockRate >= 50 ? 'text-green-600' : 
                          stat.blockRate >= 20 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {stat.blockRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
