'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { dashboardApi } from '@/lib/api';

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

export default function DashboardPage() {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 월 목록 로드
  useEffect(() => {
    const loadMonths = async () => {
      try {
        const res = await dashboardApi.getMonths();
        if (res.success && res.months) {
          setMonths(res.months);
          // 최신 월 선택
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

  // 숫자 포맷팅
  const formatNumber = (num: number) => {
    return num.toLocaleString('ko-KR');
  };

  // 월 포맷팅 (2025-01 -> 2025년 1월)
  const formatMonth = (month: string) => {
    const [year, m] = month.split('-');
    return `${year}년 ${parseInt(m)}월`;
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
    </MainLayout>
  );
}
