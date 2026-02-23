'use client';

import { useState, useEffect, useMemo } from 'react';
import { MainLayout } from '@/components/layout';
import { pendingApi } from '@/lib/api';
import { CheckIcon, XMarkIcon, ChevronUpIcon, ChevronDownIcon, ArrowsUpDownIcon } from '@heroicons/react/24/outline';

interface PendingItem {
  id: number;
  domain: string;
  urls: string[];
  titles: string[];
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null;
  llm_reason: string | null;
  created_at: string;
}

type SortField = 'domain' | 'llm_judgment' | 'titles';
type SortDirection = 'asc' | 'desc' | null;

export default function PendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 선택된 항목
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // 처리 중 상태
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  
  // 벌크 처리 진행률
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, failed: 0 });

  // 정렬 상태
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // 데이터 로드
  const loadPending = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await pendingApi.getList();
      if (res.success) {
        setItems(res.items || []);
      } else {
        setError('승인 대기 목록을 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load pending:', err);
      setError('승인 대기 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  // 정렬된 아이템
  const sortedItems = useMemo(() => {
    if (!sortField || !sortDirection) return items;

    return [...items].sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';

      switch (sortField) {
        case 'domain':
          aValue = a.domain.toLowerCase();
          bValue = b.domain.toLowerCase();
          break;
        case 'llm_judgment':
          // 정렬 순서: likely_illegal > uncertain > likely_legal > null
          const judgmentOrder: Record<string, number> = {
            'likely_illegal': 0,
            'uncertain': 1,
            'likely_legal': 2,
          };
          aValue = a.llm_judgment ? judgmentOrder[a.llm_judgment] ?? 3 : 3;
          bValue = b.llm_judgment ? judgmentOrder[b.llm_judgment] ?? 3 : 3;
          break;
        case 'titles':
          aValue = a.titles?.[0]?.toLowerCase() || '';
          bValue = b.titles?.[0]?.toLowerCase() || '';
          break;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [items, sortField, sortDirection]);

  // 정렬 핸들러
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // 같은 필드 클릭 시 방향 토글
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortField(null);
        setSortDirection(null);
      } else {
        setSortDirection('asc');
      }
    } else {
      // 새 필드 클릭 시 오름차순으로 시작
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // 정렬 아이콘
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowsUpDownIcon className="w-4 h-4 text-gray-400" />;
    }
    if (sortDirection === 'asc') {
      return <ChevronUpIcon className="w-4 h-4 text-blue-600" />;
    }
    return <ChevronDownIcon className="w-4 h-4 text-blue-600" />;
  };

  // 개별 승인/거부
  const handleReview = async (id: number, action: 'approve' | 'reject') => {
    setProcessingIds(prev => new Set(prev).add(id));
    
    try {
      const res = await pendingApi.review(id, action);
      if (res.success) {
        setSuccessMessage(action === 'approve' ? '불법 사이트로 등록되었습니다.' : '합법 사이트로 처리되었습니다.');
        loadPending();
      } else {
        setError(res.error || '처리에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to review:', err);
      setError('처리에 실패했습니다.');
    } finally {
      setProcessingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  // 일괄 승인/거부 (개별 처리로 진행률 표시)
  const handleBulkReview = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) {
      setError('선택된 항목이 없습니다.');
      return;
    }
    
    if (!confirm(`선택한 ${selectedIds.size}개 항목을 ${action === 'approve' ? '불법 사이트로 등록' : '합법 사이트로 처리'}하시겠습니까?`)) {
      return;
    }
    
    const ids = Array.from(selectedIds);
    const total = ids.length;
    
    setIsBulkProcessing(true);
    setBulkProgress({ current: 0, total, failed: 0 });
    
    let processed = 0;
    let failed = 0;
    
    for (const id of ids) {
      try {
        await pendingApi.review(id, action);
        processed++;
      } catch (err) {
        console.error(`Failed to review item ${id}:`, err);
        failed++;
      }
      setBulkProgress({ current: processed + failed, total, failed });
    }
    
    setSuccessMessage(`${processed}개 항목이 처리되었습니다.${failed > 0 ? ` (${failed}개 실패)` : ''}`);
    setSelectedIds(new Set());
    setIsBulkProcessing(false);
    setBulkProgress({ current: 0, total: 0, failed: 0 });
    loadPending();
  };

  // 전체 선택/해제
  const handleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(item => item.id)));
    }
  };

  // 개별 선택
  const handleSelect = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // LLM 판단 배지
  const getJudgmentBadge = (judgment: string | null) => {
    switch (judgment) {
      case 'likely_illegal':
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full whitespace-nowrap">불법 추정</span>;
      case 'likely_legal':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full whitespace-nowrap">합법 추정</span>;
      case 'uncertain':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full whitespace-nowrap">불확실</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full whitespace-nowrap">미분석</span>;
    }
  };

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  return (
    <MainLayout pageTitle="승인 대기" requireAdmin>
      {/* 알림 메시지 */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {successMessage}
        </div>
      )}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">닫기</button>
        </div>
      )}

      {/* 액션 바 */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">
            총 <strong>{items.length}</strong>개 항목
            {selectedIds.size > 0 && ` (${selectedIds.size}개 선택됨)`}
          </span>
        </div>
      </div>

      {/* 벌크 처리 진행률 표시 */}
      {isBulkProcessing && bulkProgress.total > 0 && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-700">
              일괄 처리 중... ({bulkProgress.current}/{bulkProgress.total})
            </span>
            <span className="text-sm font-bold text-blue-700">
              {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden">
            <div 
              className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            />
          </div>
          {bulkProgress.failed > 0 && (
            <p className="mt-1 text-xs text-red-600">{bulkProgress.failed}개 실패</p>
          )}
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">🎉</p>
              <p>승인 대기 중인 항목이 없습니다</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {/* 체크박스 */}
                  <th className="px-3 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === items.length && items.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </th>
                  {/* 일괄 액션 버튼 */}
                  <th className="px-2 py-3 text-left w-48">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleBulkReview('approve')}
                        disabled={isBulkProcessing || selectedIds.size === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title="선택한 항목을 불법 사이트로 등록"
                      >
                        <CheckIcon className="w-3 h-3" />
                        불법등록
                      </button>
                      <button
                        onClick={() => handleBulkReview('reject')}
                        disabled={isBulkProcessing || selectedIds.size === 0}
                        className="flex items-center gap-1 px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title="선택한 항목을 합법 사이트로 처리"
                      >
                        <XMarkIcon className="w-3 h-3" />
                        합법처리
                      </button>
                    </div>
                  </th>
                  {/* 도메인 - 정렬 가능 */}
                  <th className="px-4 py-3 text-left">
                    <button 
                      onClick={() => handleSort('domain')}
                      className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-800"
                    >
                      도메인
                      {getSortIcon('domain')}
                    </button>
                  </th>
                  {/* AI 판단 - 정렬 가능 */}
                  <th className="px-4 py-3 text-left min-w-[300px]">
                    <button 
                      onClick={() => handleSort('llm_judgment')}
                      className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-800"
                    >
                      AI 판단
                      {getSortIcon('llm_judgment')}
                    </button>
                  </th>
                  {/* 관련 작품 - 정렬 가능 */}
                  <th className="px-4 py-3 text-left">
                    <button 
                      onClick={() => handleSort('titles')}
                      className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-800"
                    >
                      관련 작품
                      {getSortIcon('titles')}
                    </button>
                  </th>
                  {/* URL 수 */}
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-20">URL 수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition">
                    {/* 체크박스 */}
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => handleSelect(item.id)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </td>
                    {/* 개별 액션 버튼 */}
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleReview(item.id, 'approve')}
                          disabled={processingIds.has(item.id)}
                          className="flex items-center gap-1 px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs font-medium border border-red-200 disabled:opacity-50"
                          title="불법 사이트로 등록"
                        >
                          <CheckIcon className="w-3 h-3" />
                          불법
                        </button>
                        <button
                          onClick={() => handleReview(item.id, 'reject')}
                          disabled={processingIds.has(item.id)}
                          className="flex items-center gap-1 px-2 py-1 text-green-600 hover:bg-green-50 rounded text-xs font-medium border border-green-200 disabled:opacity-50"
                          title="합법 사이트로 처리"
                        >
                          <XMarkIcon className="w-3 h-3" />
                          합법
                        </button>
                      </div>
                    </td>
                    {/* 도메인 (링크) */}
                    <td className="px-4 py-3">
                      <a 
                        href={`https://${item.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline font-mono"
                      >
                        {item.domain}
                      </a>
                    </td>
                    {/* AI 판단 (전체 표시) */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {getJudgmentBadge(item.llm_judgment)}
                        {item.llm_reason && (
                          <p className="text-xs text-gray-600 leading-relaxed">
                            {item.llm_reason}
                          </p>
                        )}
                      </div>
                    </td>
                    {/* 관련 작품 */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {item.titles?.slice(0, 3).map((title, idx) => (
                          <span key={idx} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded whitespace-nowrap">
                            {title}
                          </span>
                        ))}
                        {item.titles?.length > 3 && (
                          <span className="text-xs text-gray-500">+{item.titles.length - 3}</span>
                        )}
                      </div>
                    </td>
                    {/* URL 수 */}
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{item.urls?.length || 0}개</span>
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
