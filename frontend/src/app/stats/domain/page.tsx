'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { statsApi } from '@/lib/api';

interface DomainStat {
  domain: string;
  site_type: string;
  site_status: string;
  language: string;
  discovered: number;
  reported: number;
  blocked: number;
  blockRate: number;
}

const LANGUAGE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  unset: { label: '미설정', color: 'text-gray-400', bg: 'bg-gray-50' },
  '다국어': { label: '다국어', color: 'text-indigo-600', bg: 'bg-indigo-50' },
  '영어': { label: '영어', color: 'text-blue-600', bg: 'bg-blue-50' },
  '스페인어': { label: '스페인어', color: 'text-orange-600', bg: 'bg-orange-50' },
  '포르투갈어': { label: '포르투갈어', color: 'text-green-600', bg: 'bg-green-50' },
  '러시아어': { label: '러시아어', color: 'text-red-600', bg: 'bg-red-50' },
  '아랍어': { label: '아랍어', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  '태국어': { label: '태국어', color: 'text-pink-600', bg: 'bg-pink-50' },
  '인도네시아어': { label: '인도네시아어', color: 'text-teal-600', bg: 'bg-teal-50' },
  '중국어': { label: '중국어', color: 'text-yellow-700', bg: 'bg-yellow-50' },
};

const SITE_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  scanlation_group: { label: 'Scanlation Group', color: 'text-red-600', bg: 'bg-red-50' },
  aggregator: { label: 'Aggregator', color: 'text-orange-600', bg: 'bg-orange-50' },
  clone: { label: 'Clone', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  blog: { label: 'Blog', color: 'text-blue-600', bg: 'bg-blue-50' },
  unclassified: { label: '미분류', color: 'text-gray-400', bg: 'bg-gray-50' },
};

const SITE_STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active: { label: '운영 중', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  closed: { label: '폐쇄', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  changed: { label: '주소 변경', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
};

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


export default function DomainStatsPage() {
  const defaults = getDefaultDates();
  const [stats, setStats] = useState<DomainStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAllPeriod, setIsAllPeriod] = useState(false);
  
  // 날짜 필터 (기본값: 당월)
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  
  // 정렬
  const [sortField, setSortField] = useState<keyof DomainStat>('discovered');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // 데이터 로드
  const loadStats = async (start?: string, end?: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await statsApi.byDomain(start || startDate, end || endDate);
      if (res.success) {
        setStats(res.stats || []);
      } else {
        setError('통계를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load domain stats:', err);
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

  // 정렬 처리
  const handleSort = (field: keyof DomainStat) => {
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

  // 정렬 아이콘
  const getSortIcon = (field: keyof DomainStat) => {
    if (sortField !== field) return '↕️';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  return (
    <MainLayout pageTitle="도메인별 신고/차단 통계">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

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
                    onClick={() => handleSort('domain')}
                  >
                    도메인 {getSortIcon('domain')}
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-36 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('site_type')}
                  >
                    분류 {getSortIcon('site_type')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-24 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('site_status')}
                  >
                    상태 {getSortIcon('site_status')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-24 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('language')}
                  >
                    언어 {getSortIcon('language')}
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
                  return (
                    <tr key={stat.domain} className="hover:bg-gray-50 transition">
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
                        <span className="text-sm font-medium text-gray-800">{stat.domain}</span>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const st = SITE_TYPE_LABELS[stat.site_type] || SITE_TYPE_LABELS['unclassified'];
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${st.color} ${st.bg}`}>
                              {st.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const ss = SITE_STATUS_LABELS[stat.site_status] || SITE_STATUS_LABELS['active'];
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ss.color} ${ss.bg} border ${ss.border}`}>
                              {ss.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const lang = LANGUAGE_LABELS[stat.language] || { label: stat.language || '미설정', color: 'text-gray-500', bg: 'bg-gray-50' };
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${lang.color} ${lang.bg}`}>
                              {lang.label}
                            </span>
                          );
                        })()}
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
