'use client';

import { useState, useEffect, useMemo } from 'react';
import { MainLayout } from '@/components/layout';
import { mantaRankingsApi, sessionsApi } from '@/lib/api';
import { 
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface MantaRanking {
  title: string;
  mantaRank: number | null;
  firstDomain: string;
  searchQuery: string;
  sessionId: string;
  page1IllegalCount: number;
}

interface Session {
  id: string;
  created_at: string;
}

interface RankHistoryPoint {
  date: string;
  sessionId: string;
  rank: number | null;
}

export default function MantaRankingsPage() {
  const [rankings, setRankings] = useState<MantaRanking[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [rankHistory, setRankHistory] = useState<RankHistoryPoint[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // 작품 목록 (중복 제거 및 정렬)
  const titles = useMemo(() => {
    const uniqueTitles = [...new Set(rankings.map(r => r.title))];
    return uniqueTitles.sort((a, b) => a.localeCompare(b));
  }, [rankings]);

  // 필터된 작품 목록
  const filteredTitles = useMemo(() => {
    if (!searchQuery) return titles;
    return titles.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [titles, searchQuery]);

  // 데이터 로드
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const [rankingsRes, sessionsRes] = await Promise.all([
          mantaRankingsApi.getAll(),
          sessionsApi.getList(),
        ]);
        
        if (rankingsRes.success) {
          setRankings(rankingsRes.rankings || []);
        }
        if (sessionsRes.success) {
          setSessions(sessionsRes.sessions || []);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
        setError('데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  // 첫 번째 작품 자동 선택
  useEffect(() => {
    if (filteredTitles.length > 0 && !selectedTitle) {
      setSelectedTitle(filteredTitles[0]);
    }
  }, [filteredTitles, selectedTitle]);

  // 선택된 작품의 순위 히스토리 시뮬레이션 (실제 API가 없으므로 현재 데이터 기반)
  useEffect(() => {
    if (!selectedTitle || sessions.length === 0) {
      setRankHistory([]);
      return;
    }

    setIsLoadingHistory(true);
    
    // 현재 rankings에서 해당 작품의 순위 가져오기
    const currentRanking = rankings.find(r => r.title === selectedTitle);
    const currentRank = currentRanking?.mantaRank || null;
    
    // 세션 데이터를 기반으로 히스토리 생성 (실제로는 API에서 가져와야 함)
    // 여기서는 현재 순위를 기반으로 시뮬레이션된 데이터를 생성
    const recentSessions = sessions
      .filter(s => s.id && s.created_at)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-20);
    
    // 시뮬레이션된 히스토리 (실제 API 연동 시 교체 필요)
    const history: RankHistoryPoint[] = recentSessions.map((session, index) => {
      const date = new Date(session.created_at);
      // 현재 순위 기반으로 약간의 변동 추가 (실제 데이터가 아님)
      let rank = currentRank;
      if (currentRank !== null && index < recentSessions.length - 1) {
        // 과거 데이터에 약간의 변동 추가
        const variation = Math.floor(Math.random() * 3) - 1;
        rank = Math.max(1, currentRank + variation);
      }
      
      return {
        date: `${date.getMonth() + 1}/${date.getDate()}`,
        sessionId: session.id,
        rank: rank,
      };
    });

    setRankHistory(history);
    setIsLoadingHistory(false);
  }, [selectedTitle, sessions, rankings]);

  // 그래프 SVG 생성
  const generateChartSVG = () => {
    if (rankHistory.length === 0) return null;

    const width = 700;
    const height = 250;
    const padding = { top: 30, right: 30, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Y축 범위 (순위: 1이 위, 30이 아래)
    const maxRank = 30;
    const minRank = 1;

    // 데이터 포인트 계산
    const points = rankHistory
      .filter(p => p.rank !== null)
      .map((point, index) => {
        const x = padding.left + (index / (rankHistory.length - 1 || 1)) * chartWidth;
        const y = padding.top + ((point.rank! - minRank) / (maxRank - minRank)) * chartHeight;
        return { x, y, ...point };
      });

    // 라인 경로 생성
    const linePath = points.length > 0
      ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`
      : '';

    // Y축 눈금
    const yTicks = [1, 5, 10, 15, 20, 25, 30];

    return (
      <svg width={width} height={height} className="w-full">
        {/* Y축 그리드 라인 */}
        {yTicks.map(tick => {
          const y = padding.top + ((tick - minRank) / (maxRank - minRank)) * chartHeight;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="4"
              />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                className="text-xs fill-gray-500"
              >
                {tick}위
              </text>
            </g>
          );
        })}

        {/* X축 라벨 */}
        {rankHistory.map((point, index) => {
          const x = padding.left + (index / (rankHistory.length - 1 || 1)) * chartWidth;
          // 너무 많으면 일부만 표시
          if (rankHistory.length > 10 && index % Math.ceil(rankHistory.length / 10) !== 0 && index !== rankHistory.length - 1) {
            return null;
          }
          return (
            <text
              key={index}
              x={x}
              y={height - 10}
              textAnchor="middle"
              className="text-xs fill-gray-500"
            >
              {point.date}
            </text>
          );
        })}

        {/* 라인 */}
        {points.length > 1 && (
          <path
            d={linePath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
          />
        )}

        {/* 데이터 포인트 */}
        {points.map((point, index) => (
          <g key={index}>
            <circle
              cx={point.x}
              cy={point.y}
              r={4}
              fill="#3b82f6"
              stroke="white"
              strokeWidth={2}
            />
          </g>
        ))}

        {/* 축 */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="#d1d5db"
        />
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="#d1d5db"
        />
      </svg>
    );
  };

  // 현재 선택된 작품의 순위 정보
  const selectedRanking = rankings.find(r => r.title === selectedTitle);

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <MainLayout pageTitle="Manta 검색 순위 변화">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-6 h-[calc(100vh-180px)]">
        {/* 좌측: 작품 목록 */}
        <div className="w-72 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">📚 작품 목록</h3>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="작품 검색..."
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-gray-400 text-sm">로딩 중...</div>
            ) : filteredTitles.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">작품이 없습니다</div>
            ) : (
              <ul>
                {filteredTitles.map(title => {
                  const ranking = rankings.find(r => r.title === title);
                  const isSelected = selectedTitle === title;
                  
                  return (
                    <li key={title}>
                      <button
                        onClick={() => setSelectedTitle(title)}
                        className={`w-full px-4 py-3 text-left text-sm transition hover:bg-gray-50 ${
                          isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                        }`}
                      >
                        <p className={`font-medium truncate ${isSelected ? 'text-blue-600' : 'text-gray-800'}`}>
                          {title}
                        </p>
                        {ranking && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {ranking.mantaRank !== null 
                              ? `P1-${ranking.mantaRank}` 
                              : '순위권 외'
                            }
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 우측: 순위 변화 그래프 */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4-4 4 4 6-6 4 4" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 20V4" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-800">
                  {selectedTitle || '작품을 선택하세요'}
                </h3>
              </div>
              {selectedRanking && (
                <p className="text-sm text-gray-500 mt-1">
                  현재 순위: {selectedRanking.mantaRank !== null ? `${selectedRanking.mantaRank}위` : '순위권 외'} | 
                  1위 도메인: {selectedRanking.firstDomain}
                  {selectedRanking.page1IllegalCount > 0 && (
                    <span className="text-red-600 ml-2">
                      • 1페이지 불법 {selectedRanking.page1IllegalCount}건
                    </span>
                  )}
                </p>
              )}
            </div>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition"
            >
              <ArrowPathIcon className="w-4 h-4" />
              새로고침
            </button>
          </div>

          {/* 그래프 영역 */}
          <div className="flex-1 p-6 flex flex-col">
            {!selectedTitle ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>좌측에서 작품을 선택하세요</p>
              </div>
            ) : isLoadingHistory ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : rankHistory.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>히스토리 데이터가 없습니다</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-end mb-2">
                  <span className="text-xs text-gray-500">1위가 가장 좋음</span>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  {generateChartSVG()}
                </div>
                <div className="mt-4 text-center text-xs text-gray-400">
                  ※ 현재는 시뮬레이션 데이터입니다. 실제 히스토리 API 연동 시 정확한 데이터가 표시됩니다.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
