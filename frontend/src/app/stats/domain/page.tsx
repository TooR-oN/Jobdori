'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { statsApi, siteClassifyApi } from '@/lib/api';

interface DomainStat {
  domain: string;
  site_type: string;
  discovered: number;
  reported: number;
  blocked: number;
  blockRate: number;
}

const SITE_TYPE_OPTIONS = [
  { value: 'unclassified', label: '미분류', color: 'text-gray-400' },
  { value: 'scanlation_group', label: 'Scanlation Group', color: 'text-red-600' },
  { value: 'aggregator', label: 'Aggregator', color: 'text-orange-600' },
  { value: 'clone', label: 'Clone', color: 'text-yellow-600' },
  { value: 'blog', label: 'Blog', color: 'text-blue-600' },
];

const TYPE_SCORE_MAP: Record<string, number> = {
  'scanlation_group': 35,
  'aggregator': 20,
  'clone': 10,
  'blog': 5,
  'unclassified': 0,
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

// 1달 전 전체 기간
function getLastMonthDates() {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const year = lastMonth.getFullYear();
  const month = String(lastMonth.getMonth() + 1).padStart(2, '0');
  const endDay = String(lastMonthEnd.getDate()).padStart(2, '0');
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${endDay}`,
  };
}

export default function DomainStatsPage() {
  const defaults = getDefaultDates();
  const [stats, setStats] = useState<DomainStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classifyingDomain, setClassifyingDomain] = useState<string | null>(null);
  
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
    loadStats();
  };

  // 필터 초기화 (당월로 리셋)
  const handleReset = () => {
    const d = getDefaultDates();
    setStartDate(d.start);
    setEndDate(d.end);
    loadStats(d.start, d.end);
  };

  // 1달 전 바로 조회
  const handleLastMonth = () => {
    const d = getLastMonthDates();
    setStartDate(d.start);
    setEndDate(d.end);
    loadStats(d.start, d.end);
  };

  // 사이트 분류 변경
  const handleClassify = async (domain: string, newType: string) => {
    setClassifyingDomain(domain);
    try {
      const res = await siteClassifyApi.classify(domain, newType);
      if (res.success) {
        // 로컬 상태 업데이트
        setStats(prev => prev.map(s => 
          s.domain === domain ? { ...s, site_type: newType } : s
        ));
      }
    } catch (err) {
      console.error('Failed to classify domain:', err);
    } finally {
      setClassifyingDomain(null);
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
              onClick={handleReset}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm"
            >
              초기화
            </button>
            <button
              onClick={handleLastMonth}
              className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition text-sm font-medium"
            >
              1달 전
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
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">분류</th>
                  <th 
                    className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('domain')}
                  >
                    도메인 {getSortIcon('domain')}
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
                  const typeOption = SITE_TYPE_OPTIONS.find(o => o.value === stat.site_type) || SITE_TYPE_OPTIONS[0];
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
                        <select
                          value={stat.site_type || 'unclassified'}
                          onChange={(e) => handleClassify(stat.domain, e.target.value)}
                          disabled={classifyingDomain === stat.domain}
                          className={`
                            text-xs px-2 py-1 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400
                            ${stat.site_type === 'unclassified' || !stat.site_type ? 'text-gray-400 bg-gray-50' : 'bg-white'}
                            ${stat.site_type === 'scanlation_group' ? 'text-red-600 font-medium' : ''}
                            ${stat.site_type === 'aggregator' ? 'text-orange-600 font-medium' : ''}
                            ${stat.site_type === 'clone' ? 'text-yellow-600 font-medium' : ''}
                            ${stat.site_type === 'blog' ? 'text-blue-600 font-medium' : ''}
                            ${classifyingDomain === stat.domain ? 'opacity-50' : ''}
                          `}
                        >
                          {SITE_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-800">{stat.domain}</span>
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
