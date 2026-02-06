'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { pendingApi } from '@/lib/api';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface PendingItem {
  id: number;
  domain: string;
  urls: string[];
  titles: string[];
  llm_judgment: 'likely_illegal' | 'likely_legal' | 'uncertain' | null;
  llm_reason: string | null;
  created_at: string;
}

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

  // 일괄 승인/거부
  const handleBulkReview = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) {
      setError('선택된 항목이 없습니다.');
      return;
    }
    
    if (!confirm(`선택한 ${selectedIds.size}개 항목을 ${action === 'approve' ? '불법 사이트로 등록' : '합법 사이트로 처리'}하시겠습니까?`)) {
      return;
    }
    
    setIsBulkProcessing(true);
    
    try {
      const res = await pendingApi.bulkReview(Array.from(selectedIds), action);
      if (res.success) {
        setSuccessMessage(`${res.processed || selectedIds.size}개 항목이 처리되었습니다.`);
        setSelectedIds(new Set());
        loadPending();
      } else {
        setError(res.error || '일괄 처리에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to bulk review:', err);
      setError('일괄 처리에 실패했습니다.');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // NOTE: AI 일괄 검토 기능 삭제됨 - Manus API 연동으로 대체 예정
  // LLM 2차 판별은 파이프라인(llm-judge.ts)에서 처리

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
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">불법 추정</span>;
      case 'likely_legal':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">합법 추정</span>;
      case 'uncertain':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">불확실</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">미분석</span>;
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
        
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleBulkReview('approve')}
            disabled={isBulkProcessing || selectedIds.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <CheckIcon className="w-4 h-4" />
            {isBulkProcessing ? '처리 중...' : '선택 불법 등록'}
          </button>
          
          <button
            onClick={() => handleBulkReview('reject')}
            disabled={isBulkProcessing || selectedIds.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            <XMarkIcon className="w-4 h-4" />
            {isBulkProcessing ? '처리 중...' : '선택 합법 처리'}
          </button>
        </div>
      </div>

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
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === items.length && items.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">도메인</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">관련 작품</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">AI 판단</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">URL 수</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => handleSelect(item.id)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-800 font-mono">{item.domain}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {item.titles?.slice(0, 3).map((title, idx) => (
                          <span key={idx} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                            {title}
                          </span>
                        ))}
                        {item.titles?.length > 3 && (
                          <span className="text-xs text-gray-500">+{item.titles.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {getJudgmentBadge(item.llm_judgment)}
                        {item.llm_reason && (
                          <p className="mt-1 text-xs text-gray-500 max-w-xs truncate" title={item.llm_reason}>
                            {item.llm_reason}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{item.urls?.length || 0}개</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleReview(item.id, 'approve')}
                          disabled={processingIds.has(item.id)}
                          className="flex items-center gap-1 px-2 py-1.5 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50 text-sm font-medium border border-red-200"
                          title="불법 사이트로 등록"
                        >
                          <CheckIcon className="w-4 h-4" />
                          <span>불법</span>
                        </button>
                        <button
                          onClick={() => handleReview(item.id, 'reject')}
                          disabled={processingIds.has(item.id)}
                          className="flex items-center gap-1 px-2 py-1.5 text-green-600 hover:bg-green-50 rounded-lg transition disabled:opacity-50 text-sm font-medium border border-green-200"
                          title="합법 사이트로 처리"
                        >
                          <XMarkIcon className="w-4 h-4" />
                          <span>합법</span>
                        </button>
                      </div>
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
