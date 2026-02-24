'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { mantaRankingsApi, titlesApi } from '@/lib/api';
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
  top30IllegalCount: number;
}

interface RankHistoryPoint {
  date: string;
  fullDate: string;
  sessionId: string;
  rank: number | null;
  page1IllegalCount: number;
  top30IllegalCount: number;
}

export default function MantaRankingsPage() {
  const [rankings, setRankings] = useState<MantaRanking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [rankHistory, setRankHistory] = useState<RankHistoryPoint[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showAllTitles, setShowAllTitles] = useState(false);
  const [currentTitles, setCurrentTitles] = useState<string[]>([]);
  // 비모니터링 작품 (is_current=false in titles table)
  const [historyTitles, setHistoryTitles] = useState<string[]>([]);
  // 히스토리 테이블에만 존재하는 작품 (titles 테이블에 없는)
  const [historyOnlyTitles, setHistoryOnlyTitles] = useState<string[]>([]);
  
  // 날짜 필터 (각 작품별)
  const [dateFilterStart, setDateFilterStart] = useState('');
  const [dateFilterEnd, setDateFilterEnd] = useState('');
  
  // 차트 호버 상태
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  // 전체 비모니터링 작품 목록 (history + historyOnly)
  const allNonCurrentTitles = useMemo(() => {
    return Array.from(new Set([...historyTitles, ...historyOnlyTitles]));
  }, [historyTitles, historyOnlyTitles]);

  // 작품 목록 (현재 모니터링 + 비모니터링 + 히스토리 only)
  const titles = useMemo(() => {
    const rankingTitles = Array.from(new Set(rankings.map(r => r.title)));
    const allTitles = Array.from(new Set([...rankingTitles, ...currentTitles, ...allNonCurrentTitles]));
    return allTitles.sort((a, b) => a.localeCompare(b));
  }, [rankings, currentTitles, allNonCurrentTitles]);

  // 필터된 작품 목록 (모니터링 상태 + 검색)
  const filteredTitles = useMemo(() => {
    let filtered = titles;
    // 모니터링 상태 필터
    if (!showAllTitles) {
      filtered = filtered.filter(t => currentTitles.includes(t));
    }
    // 검색 필터
    if (searchQuery) {
      filtered = filtered.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return filtered;
  }, [titles, searchQuery, showAllTitles, currentTitles]);

  // 데이터 로드
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const [rankingsRes, titlesRes] = await Promise.all([
          mantaRankingsApi.getAll(),
          titlesApi.getList(),
        ]);
        
        if (rankingsRes.success) {
          setRankings(rankingsRes.rankings || []);
        }
        if (titlesRes.success) {
          setCurrentTitles((titlesRes.current || []).map((t: { name: string }) => t.name));
          setHistoryTitles((titlesRes.history || []).map((t: { name: string }) => t.name));
          setHistoryOnlyTitles(titlesRes.historyOnlyTitles || []);
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
    if (filteredTitles.length > 0 && (!selectedTitle || !filteredTitles.includes(selectedTitle))) {
      setSelectedTitle(filteredTitles[0]);
    }
  }, [filteredTitles, selectedTitle]);

  // 선택된 작품의 순위 히스토리 로드
  const loadHistory = useCallback(async (title: string) => {
    setIsLoadingHistory(true);
    
    try {
      const res = await mantaRankingsApi.getRankingHistory(title);
      
      if (res.success && res.history && res.history.length > 0) {
        const history: RankHistoryPoint[] = res.history.map((h: { rank: number | null; sessionId: string; recordedAt: string; page1IllegalCount?: number; top30IllegalCount?: number }) => {
          const date = new Date(h.recordedAt);
          return {
            date: `${date.getMonth() + 1}/${date.getDate()}`,
            fullDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
            sessionId: h.sessionId,
            rank: h.rank,
            page1IllegalCount: h.page1IllegalCount ?? 0,
            top30IllegalCount: h.top30IllegalCount ?? 0,
          };
        });
        
        setRankHistory(history);
      } else {
        const currentRanking = rankings.find(r => r.title === title);
        if (currentRanking) {
          setRankHistory([{
            date: '현재',
            fullDate: new Date().toISOString().slice(0, 10),
            sessionId: currentRanking.sessionId,
            rank: currentRanking.mantaRank,
            page1IllegalCount: currentRanking.page1IllegalCount ?? 0,
            top30IllegalCount: currentRanking.top30IllegalCount ?? 0,
          }]);
        } else {
          setRankHistory([]);
        }
      }
    } catch (err) {
      console.error('Failed to load ranking history:', err);
      const currentRanking = rankings.find(r => r.title === title);
      if (currentRanking) {
        setRankHistory([{
          date: '현재',
          fullDate: new Date().toISOString().slice(0, 10),
          sessionId: currentRanking.sessionId,
          rank: currentRanking.mantaRank,
          page1IllegalCount: currentRanking.page1IllegalCount ?? 0,
          top30IllegalCount: currentRanking.top30IllegalCount ?? 0,
        }]);
      } else {
        setRankHistory([]);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  }, [rankings]);

  useEffect(() => {
    if (selectedTitle) {
      setDateFilterStart('');
      setDateFilterEnd('');
      setHoveredPoint(null);
      loadHistory(selectedTitle);
    } else {
      setRankHistory([]);
    }
  }, [selectedTitle, loadHistory]);

  // 날짜 필터가 적용된 히스토리
  const filteredHistory = useMemo(() => {
    if (!dateFilterStart && !dateFilterEnd) return rankHistory;
    return rankHistory.filter(p => {
      if (dateFilterStart && p.fullDate < dateFilterStart) return false;
      if (dateFilterEnd && p.fullDate > dateFilterEnd) return false;
      return true;
    });
  }, [rankHistory, dateFilterStart, dateFilterEnd]);

  // 듀얼 Y축 그래프 SVG 생성
  const generateChartSVG = () => {
    if (filteredHistory.length === 0) return null;

    const width = 1200;
    const height = 500;
    const padding = { top: 50, right: 70, bottom: 60, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxRank = 30;
    const minRank = 1;

    // 불법 URL Y축 최대값 30 고정
    const illegalYMax = 30;

    const allPoints = filteredHistory.map((point, index) => {
      const x = filteredHistory.length === 1
        ? padding.left + chartWidth / 2
        : padding.left + (index / (filteredHistory.length - 1)) * chartWidth;
      const y = point.rank !== null
        ? padding.top + ((point.rank - minRank) / (maxRank - minRank)) * chartHeight
        : null;
      // 불법 URL 꺾은선 Y 좌표 (우측 Y축, 위가 30, 아래가 0)
      const illegalY = padding.top + chartHeight - (point.top30IllegalCount / illegalYMax) * chartHeight;
      return { x, y, illegalY, ...point, index };
    });

    // 순위 라인: null(권외)에서 끊김 처리
    // 연속된 유효 포인트 그룹으로 분리
    const rankSegments: (typeof allPoints[0] & { y: number })[][] = [];
    let currentSegment: (typeof allPoints[0] & { y: number })[] = [];
    for (const p of allPoints) {
      if (p.y !== null) {
        currentSegment.push(p as typeof allPoints[0] & { y: number });
      } else {
        if (currentSegment.length > 0) {
          rankSegments.push(currentSegment);
          currentSegment = [];
        }
      }
    }
    if (currentSegment.length > 0) {
      rankSegments.push(currentSegment);
    }

    // 불법 URL 꺾은선 path
    const illegalLinePath = allPoints.length > 1
      ? `M ${allPoints.map(p => `${p.x},${p.illegalY}`).join(' L ')}`
      : '';

    const yTicks = [1, 5, 10, 15, 20, 25, 30];

    // 페이지 경계선 위치
    const page1Bottom = padding.top + ((10 - minRank) / (maxRank - minRank)) * chartHeight;
    const page2Bottom = padding.top + ((20 - minRank) / (maxRank - minRank)) * chartHeight;

    // 우측 Y축 눈금 (불법 URL 개수, 0~30 고정)
    const illegalTicks = [0, 5, 10, 15, 20, 25, 30];

    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHoveredPoint(null)}
      >
        {/* 범례 (Legend) - 차트 상단 중앙 */}
        <g>
          <line x1={width / 2 - 180} y1={16} x2={width / 2 - 156} y2={16} stroke="#3b82f6" strokeWidth={2.5} />
          <circle cx={width / 2 - 168} cy={16} r={3} fill="#3b82f6" stroke="white" strokeWidth={1} />
          <text x={width / 2 - 150} y={20} className="text-[11px] fill-gray-700 font-medium">Manta 순위</text>
          
          <line x1={width / 2 + 10} y1={16} x2={width / 2 + 34} y2={16} stroke="#ef4444" strokeWidth={2} strokeDasharray="4" />
          <circle cx={width / 2 + 22} cy={16} r={3} fill="#ef4444" stroke="white" strokeWidth={1} />
          <text x={width / 2 + 40} y={20} className="text-[11px] fill-gray-700 font-medium">불법 URL 개수 (30위 내)</text>
        </g>

        {/* Page 영역 하이라이트 */}
        <rect x={padding.left} y={padding.top} width={chartWidth} height={page1Bottom - padding.top} fill="#f0fdf4" opacity={0.5} />
        <rect x={padding.left} y={page1Bottom} width={chartWidth} height={page2Bottom - page1Bottom} fill="#fefce8" opacity={0.3} />
        <rect x={padding.left} y={page2Bottom} width={chartWidth} height={(padding.top + chartHeight) - page2Bottom} fill="#fef2f2" opacity={0.3} />

        {/* 페이지 표시 (좌측 Y축 바로 옆, 숫자 안쪽) */}
        <text x={padding.left + 4} y={padding.top + ((5 - minRank) / (maxRank - minRank)) * chartHeight + 4} className="text-[9px] fill-green-500 font-bold" textAnchor="start" opacity={0.6}>P1</text>
        <text x={padding.left + 4} y={padding.top + ((15 - minRank) / (maxRank - minRank)) * chartHeight + 4} className="text-[9px] fill-amber-500 font-bold" textAnchor="start" opacity={0.6}>P2</text>
        <text x={padding.left + 4} y={padding.top + ((25 - minRank) / (maxRank - minRank)) * chartHeight + 4} className="text-[9px] fill-red-400 font-bold" textAnchor="start" opacity={0.6}>P3</text>

        {/* Y축 그리드 라인 + 좌측 눈금 (순위) */}
        {yTicks.map(tick => {
          const y = padding.top + ((tick - minRank) / (maxRank - minRank)) * chartHeight;
          const isPageBoundary = tick === 10 || tick === 20 || tick === 30;
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke={isPageBoundary ? (tick === 10 ? '#86efac' : tick === 20 ? '#fde68a' : '#fca5a5') : '#e5e7eb'}
                strokeDasharray={isPageBoundary ? '0' : '4'}
                strokeWidth={isPageBoundary ? 1.5 : 1}
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="text-xs fill-gray-500">
                {tick}
              </text>
            </g>
          );
        })}

        {/* 우측 Y축 눈금 (불법 URL 개수, 0~30) */}
        {illegalTicks.map(tick => {
          const y = padding.top + chartHeight - (tick / illegalYMax) * chartHeight;
          return (
            <g key={`illegal-${tick}`}>
              <text x={width - padding.right + 8} y={y + 4} textAnchor="start" className="text-xs fill-red-400">
                {tick}
              </text>
            </g>
          );
        })}
        {/* 우측 Y축 라벨 */}
        <text
          x={width - 8}
          y={padding.top + chartHeight / 2}
          textAnchor="middle"
          className="text-[10px] fill-red-400"
          transform={`rotate(90, ${width - 8}, ${padding.top + chartHeight / 2})`}
        >
          불법 URL 수
        </text>
        {/* 좌측 Y축 라벨 */}
        <text
          x={12}
          y={padding.top + chartHeight / 2}
          textAnchor="middle"
          className="text-[10px] fill-blue-500"
          transform={`rotate(-90, 12, ${padding.top + chartHeight / 2})`}
        >
          순위
        </text>

        {/* X축 라벨 */}
        {filteredHistory.map((point, index) => {
          const x = filteredHistory.length === 1
            ? padding.left + chartWidth / 2
            : padding.left + (index / (filteredHistory.length - 1)) * chartWidth;
          if (filteredHistory.length > 15 && index % Math.ceil(filteredHistory.length / 12) !== 0 && index !== filteredHistory.length - 1) {
            return null;
          }
          return (
            <text key={index} x={x} y={height - 10} textAnchor="middle" className="text-xs fill-gray-500">
              {point.date}
            </text>
          );
        })}

        {/* 불법 URL 꺾은선 (빨간 점선) */}
        {allPoints.length > 1 && (
          <path
            d={illegalLinePath}
            fill="none"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="6 3"
            strokeLinejoin="round"
            opacity={0.6}
          />
        )}
        {/* 불법 URL 데이터 포인트 */}
        {allPoints.map((point, index) => {
          if (point.top30IllegalCount === 0) return null;
          const isHovered = hoveredPoint === index;
          return (
            <circle
              key={`ill-${index}`}
              cx={point.x}
              cy={point.illegalY}
              r={isHovered ? 5 : 3}
              fill="#ef4444"
              stroke="white"
              strokeWidth={1.5}
              opacity={isHovered ? 0.9 : 0.6}
              className="transition-all"
            />
          );
        })}

        {/* 순위 라인 (파란색) - null에서 끊김 */}
        {rankSegments.map((seg, segIdx) => {
          if (seg.length < 2) return null;
          const path = `M ${seg.map(p => `${p.x},${p.y}`).join(' L ')}`;
          return (
            <path
              key={`seg-${segIdx}`}
              d={path}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          );
        })}

        {/* 순위권 외 표시 (null rank) */}
        {allPoints.filter(p => p.y === null).map((point, i) => (
          <g key={`null-${i}`}>
            <line x1={point.x} y1={padding.top} x2={point.x} y2={height - padding.bottom} stroke="#fecaca" strokeDasharray="4" strokeWidth={1} />
            <text x={point.x} y={height - padding.bottom + 15} textAnchor="middle" className="text-[10px] fill-red-400">
              권외
            </text>
          </g>
        ))}

        {/* 데이터 포인트 + 인터랙션 */}
        {allPoints.map((point, index) => {
          const isHovered = hoveredPoint === index;
          const px = point.x;
          const isNull = point.y === null;
          
          // 툴팁 위치 계산: 포인트 기준으로 좌/우 여유공간에 따라
          const tooltipWidth = 185;
          const tooltipHeight = 90;
          const rightSpace = width - padding.right - px;
          const leftSpace = px - padding.left;
          // 우측 공간이 넓으면 우측에, 아니면 좌측에
          const tooltipOnRight = rightSpace > leftSpace;
          const tooltipX = tooltipOnRight
            ? px + 15
            : px - tooltipWidth - 15;
          const tooltipY = Math.max(padding.top, Math.min(
            (point.y ?? padding.top + chartHeight / 2) - tooltipHeight / 2,
            padding.top + chartHeight - tooltipHeight
          ));

          return (
            <g key={index}>
              {/* 히트 영역 */}
              <rect
                x={px - 20}
                y={padding.top - 10}
                width={40}
                height={chartHeight + 20}
                fill="transparent"
                onMouseEnter={() => setHoveredPoint(index)}
              />

              {/* 순위 포인트 */}
              {!isNull && (
                <circle
                  cx={px}
                  cy={point.y!}
                  r={isHovered ? 6 : 4}
                  fill={isHovered ? '#2563eb' : '#3b82f6'}
                  stroke="white"
                  strokeWidth={2}
                  className="transition-all"
                />
              )}
              {/* 단독 포인트 (세그먼트 길이 1) */}
              {!isNull && rankSegments.some(seg => seg.length === 1 && seg[0].index === index) && (
                <circle
                  cx={px}
                  cy={point.y!}
                  r={isHovered ? 6 : 4}
                  fill={isHovered ? '#2563eb' : '#3b82f6'}
                  stroke="white"
                  strokeWidth={2}
                  className="transition-all"
                />
              )}

              {isNull && (
                <text x={px} y={height - padding.bottom - 15} textAnchor="middle" className="text-xs fill-red-400 font-medium">
                  X
                </text>
              )}

              {/* 툴팁 - 파란 점선 좌/우에 위치 */}
              {isHovered && (
                <g>
                  <line x1={px} y1={padding.top} x2={px} y2={height - padding.bottom} stroke="#93c5fd" strokeWidth={1} strokeDasharray="4" />
                  <foreignObject
                    x={tooltipX}
                    y={tooltipY}
                    width={tooltipWidth}
                    height={tooltipHeight}
                  >
                    <div className="bg-gray-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-lg">
                      <p className="font-medium">{point.fullDate}</p>
                      <p className="mt-0.5">
                        {point.rank !== null 
                          ? <>순위: <span className="font-bold text-blue-300">{point.rank}위</span> ({point.rank <= 10 ? '1페이지' : point.rank <= 20 ? '2페이지' : '3페이지'})</>
                          : <span className="text-red-300 font-medium">순위권 외 (30위 밖)</span>
                        }
                      </p>
                      <p className="mt-0.5">
                        불법 URL: <span className={`font-bold ${point.top30IllegalCount > 0 ? 'text-red-300' : 'text-green-300'}`}>
                          {point.top30IllegalCount}건
                        </span>
                        <span className="text-gray-400 ml-1">(30위 내)</span>
                      </p>
                    </div>
                  </foreignObject>
                </g>
              )}
            </g>
          );
        })}

        {/* 축 */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#93c5fd" strokeWidth={1.5} />
        <line x1={width - padding.right} y1={padding.top} x2={width - padding.right} y2={height - padding.bottom} stroke="#fca5a5" strokeWidth={1.5} />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#d1d5db" />
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

      <div className="flex gap-4 h-[calc(100vh-170px)]">
        {/* 좌측: 작품 목록 */}
        <div className="w-64 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col flex-shrink-0">
          <div className="px-3 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-800">작품 목록</h3>
              <button
                onClick={() => setShowAllTitles(prev => !prev)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition ${
                  showAllTitles
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
                title={showAllTitles ? '모니터링 작품만 표시' : '전체 작품 보기'}
              >
                {showAllTitles ? '전체' : '모니터링 중'}
              </button>
            </div>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="작품 검색..."
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-gray-400 text-sm">로딩 중...</div>
            ) : filteredTitles.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">
                {searchQuery ? '검색 결과가 없습니다' : '작품이 없습니다'}
              </div>
            ) : (
              <ul>
                {filteredTitles.map(title => {
                  const ranking = rankings.find(r => r.title === title);
                  const isSelected = selectedTitle === title;
                  const isCurrent = currentTitles.includes(title);
                  
                  return (
                    <li key={title}>
                      <button
                        onClick={() => setSelectedTitle(title)}
                        className={`w-full px-3 py-2 text-left text-xs transition hover:bg-gray-50 flex items-center gap-2 ${
                          isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                        }`}
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${isCurrent ? 'bg-green-500' : 'bg-gray-300'}`}
                          title={isCurrent ? '모니터링 중' : '모니터링 중단'}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium truncate ${isSelected ? 'text-blue-600' : 'text-gray-800'}`}>
                            {title}
                          </p>
                          {ranking ? (
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {ranking.mantaRank !== null 
                                ? `${ranking.mantaRank}위` 
                                : '순위권 외'
                              }
                              {ranking.page1IllegalCount > 0 && (
                                <span className="text-red-500 ml-1">불법 {ranking.page1IllegalCount}</span>
                              )}
                            </p>
                          ) : !isCurrent ? (
                            <p className="text-[10px] text-gray-400 mt-0.5">모니터링 종료</p>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 우측: 순위 변화 그래프 */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-w-0">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4-4 4 4 6-6 4 4" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 20V4" />
                </svg>
                <h3 className="text-base font-semibold text-gray-800 truncate">
                  {selectedTitle || '작품을 선택하세요'}
                </h3>
                {selectedTitle && !currentTitles.includes(selectedTitle) && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-600 rounded">모니터링 종료</span>
                )}
              </div>
              {selectedRanking && (
                <p className="text-xs text-gray-500 mt-0.5">
                  현재 순위: {selectedRanking.mantaRank !== null ? `${selectedRanking.mantaRank}위` : '순위권 외'} | 
                  1위 도메인: {selectedRanking.firstDomain}
                  {selectedRanking.page1IllegalCount > 0 && (
                    <span className="text-red-600 ml-2">불법 {selectedRanking.page1IllegalCount}건</span>
                  )}
                </p>
              )}
              {selectedTitle && !selectedRanking && (
                <p className="text-xs text-gray-400 mt-0.5">현재 순위 없음 (과거 히스토리만 존재)</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selectedTitle && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={dateFilterStart}
                    onChange={(e) => setDateFilterStart(e.target.value)}
                    className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-[120px]"
                  />
                  <span className="text-gray-400 text-xs">~</span>
                  <input
                    type="date"
                    value={dateFilterEnd}
                    onChange={(e) => setDateFilterEnd(e.target.value)}
                    className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-[120px]"
                  />
                  {(dateFilterStart || dateFilterEnd) && (
                    <button
                      onClick={() => { setDateFilterStart(''); setDateFilterEnd(''); }}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition"
                    >
                      초기화
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition"
              >
                <ArrowPathIcon className="w-3.5 h-3.5" />
                새로고침
              </button>
            </div>
          </div>

          {/* 그래프 영역 */}
          <div className="flex-1 p-4 flex flex-col min-h-0">
            {!selectedTitle ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>좌측에서 작품을 선택하세요</p>
              </div>
            ) : isLoadingHistory ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2">
                <p className="text-sm font-medium">데이터가 없습니다</p>
                <p className="text-xs">
                  {dateFilterStart || dateFilterEnd
                    ? '선택한 기간에 해당하는 데이터가 없습니다. 기간을 조정하거나 초기화해보세요.'
                    : '모니터링 실행 후 순위 데이터가 기록됩니다.'}
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-400">
                    {filteredHistory.length}개 데이터 포인트
                    {(dateFilterStart || dateFilterEnd) && ' (필터 적용 중)'}
                  </span>
                  <span className="text-[10px] text-gray-400">↑ 1위가 가장 좋음 (상단) | 포인트에 마우스를 올리면 상세 정보</span>
                </div>
                <div className="flex-1 min-h-0">
                  {generateChartSVG()}
                </div>
                <div className="mt-1 flex items-center justify-center gap-4 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-green-100 border border-green-300 rounded-sm"></span> 1페이지 (1~10위)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-yellow-100 border border-yellow-300 rounded-sm"></span> 2페이지 (11~20위)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-red-100 border border-red-300 rounded-sm"></span> 3페이지 (21~30위)</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
