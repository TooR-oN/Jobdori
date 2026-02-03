'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { statsApi } from '@/lib/api';

interface TitleStat {
  title: string;
  discovered: number;
  reported: number;
  blocked: number;
  blockRate: number;
}

export default function StatsPage() {
  const [stats, setStats] = useState<TitleStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 날짜 필터
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // 정렬
  const [sortField, setSortField] = useState<keyof TitleStat>('discovered');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // 데이터 로드
  const loadStats = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await statsApi.byTitle(startDate || undefined, endDate || undefined);
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
    loadStats();
  }, []);

  // 날짜 필터 적용
  const handleFilter = () => {
    loadStats();
  };

  // 필터 초기화
  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    loadStats();
  };

  // 정렬 처리
  const handleSort = (field: keyof TitleStat) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // 정렬된 데이터
  const sortedStats = [...stats].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    
    return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  // 합계 계산
  const totals = stats.reduce(
    (acc, s) => ({
      discovered: acc.discovered + s.discovered,
      reported: acc.reported + s.reported,
      blocked: acc.blocked + s.blocked,
    }),
    { discovered: 0, reported: 0, blocked: 0 }
  );
  const totalBlockRate = totals.reported > 0 ? Math.round((totals.blocked / totals.reported) * 100 * 10) / 10 : 0;

  // 정렬 아이콘
  const getSortIcon = (field: keyof TitleStat) => {
    if (sortField !== field) return '↕️';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  return (
    <MainLayout pageTitle="작품별 통계">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* 요약 카드 */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">총 작품</p>
          <p className="text-2xl font-bold text-gray-800">{stats.length}</p>
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
              onClick={handleReset}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm"
            >
              초기화
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
        ) : stats.length === 0 ? (
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
                {sortedStats.map((stat, index) => (
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
