'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { mantaRankingsApi } from '@/lib/api';
import { 
  ArrowUpIcon, 
  ArrowDownIcon, 
  MinusIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface MantaRanking {
  title: string;
  mantaRank: number | null;
  firstDomain: string;
  searchQuery: string;
  sessionId: string;
  page1IllegalCount: number;
}

export default function MantaRankingsPage() {
  const [rankings, setRankings] = useState<MantaRanking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'title' | 'rank' | 'illegal'>('rank');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [searchQuery, setSearchQuery] = useState('');

  // 데이터 로드
  useEffect(() => {
    const loadRankings = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const res = await mantaRankingsApi.getList();
        if (res.success) {
          setRankings(res.rankings || []);
        } else {
          setError('순위 데이터를 불러오는데 실패했습니다.');
        }
      } catch (err) {
        console.error('Failed to load rankings:', err);
        setError('순위 데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    loadRankings();
  }, []);

  // 정렬
  const sortedRankings = [...rankings]
    .filter(r => !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'rank':
          // null은 마지막으로
          if (a.mantaRank === null && b.mantaRank === null) comparison = 0;
          else if (a.mantaRank === null) comparison = 1;
          else if (b.mantaRank === null) comparison = -1;
          else comparison = a.mantaRank - b.mantaRank;
          break;
        case 'illegal':
          comparison = b.page1IllegalCount - a.page1IllegalCount;
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  // 통계 계산
  const stats = {
    total: rankings.length,
    ranked: rankings.filter(r => r.mantaRank !== null).length,
    top3: rankings.filter(r => r.mantaRank !== null && r.mantaRank <= 3).length,
    hasIllegal: rankings.filter(r => r.page1IllegalCount > 0).length,
  };

  // 순위 배지
  const getRankBadge = (rank: number | null) => {
    if (rank === null) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">
          순위권 외
        </span>
      );
    }
    if (rank <= 3) {
      return (
        <span className={`px-3 py-1 text-sm font-bold rounded-full ${
          rank === 1 ? 'bg-yellow-100 text-yellow-700' :
          rank === 2 ? 'bg-gray-100 text-gray-700' :
          'bg-orange-100 text-orange-700'
        }`}>
          {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'} {rank}위
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
        {rank}위
      </span>
    );
  };

  // 정렬 토글
  const handleSort = (field: 'title' | 'rank' | 'illegal') => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // 정렬 아이콘
  const getSortIcon = (field: string) => {
    if (sortBy !== field) return <MinusIcon className="w-4 h-4 text-gray-300" />;
    return sortOrder === 'asc' 
      ? <ArrowUpIcon className="w-4 h-4 text-blue-600" />
      : <ArrowDownIcon className="w-4 h-4 text-blue-600" />;
  };

  return (
    <MainLayout pageTitle="Manta 검색 순위 변화">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* 요약 카드 */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">전체 작품</p>
          <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">순위권 내</p>
          <p className="text-2xl font-bold text-blue-600">{stats.ranked}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Top 3</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.top3}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">불법 발견</p>
          <p className="text-2xl font-bold text-red-600">{stats.hasIllegal}</p>
        </div>
      </div>

      {/* 검색 */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="작품명 검색..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 순위 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : sortedRankings.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>데이터가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th 
                    className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('title')}
                  >
                    <div className="flex items-center gap-2">
                      <span>작품명</span>
                      {getSortIcon('title')}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>Manta 순위</span>
                      {getSortIcon('rank')}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    첫 번째 도메인
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('illegal')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>1페이지 불법</span>
                      {getSortIcon('illegal')}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    검색어
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRankings.map((item) => (
                  <tr key={item.title} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-800">{item.title}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getRankBadge(item.mantaRank)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm ${
                        item.firstDomain === 'manta.net' 
                          ? 'text-green-600 font-medium' 
                          : 'text-gray-600'
                      }`}>
                        {item.firstDomain}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.page1IllegalCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                          <ExclamationTriangleIcon className="w-3 h-3" />
                          {item.page1IllegalCount}개
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 font-mono">{item.searchQuery}</span>
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
