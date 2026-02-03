'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { titlesApi } from '@/lib/api';
import { PlusIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface Title {
  name: string;
  manta_url?: string;
  unofficial_titles?: string[];
}

export default function TitlesPage() {
  const [currentTitles, setCurrentTitles] = useState<Title[]>([]);
  const [historyTitles, setHistoryTitles] = useState<Title[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 추가 폼 상태
  const [newTitle, setNewTitle] = useState('');
  const [newMantaUrl, setNewMantaUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 데이터 로드
  const loadTitles = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await titlesApi.getList();
      if (res.success) {
        setCurrentTitles(res.current || []);
        setHistoryTitles(res.history || []);
      } else {
        setError('작품 목록을 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load titles:', err);
      setError('작품 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTitles();
  }, []);

  // 작품 추가
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newTitle.trim()) {
      setAddError('작품명을 입력해주세요.');
      return;
    }
    
    setIsAdding(true);
    setAddError(null);
    setSuccessMessage(null);
    
    try {
      const res = await titlesApi.add(newTitle.trim(), newMantaUrl.trim() || undefined);
      if (res.success) {
        setNewTitle('');
        setNewMantaUrl('');
        if (res.message) {
          setSuccessMessage(res.message);
        } else {
          setSuccessMessage(`"${newTitle.trim()}" 작품이 추가되었습니다.`);
        }
        loadTitles();
      } else {
        setAddError(res.error || '작품 추가에 실패했습니다.');
      }
    } catch (err: any) {
      console.error('Failed to add title:', err);
      setAddError(err.response?.data?.error || '작품 추가에 실패했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  // 작품 삭제
  const handleRemove = async (title: string) => {
    if (!confirm(`"${title}" 작품을 모니터링 대상에서 제외하시겠습니까?`)) {
      return;
    }
    
    try {
      const res = await titlesApi.remove(title);
      if (res.success) {
        setSuccessMessage(`"${title}" 작품이 모니터링 대상에서 제외되었습니다.`);
        loadTitles();
      } else {
        setError(res.error || '작품 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to remove title:', err);
      setError('작품 삭제에 실패했습니다.');
    }
  };

  // 작품 복원
  const handleRestore = async (title: string) => {
    if (!confirm(`"${title}" 작품을 다시 모니터링 대상에 추가하시겠습니까?`)) {
      return;
    }
    
    try {
      const res = await titlesApi.restore(title);
      if (res.success) {
        setSuccessMessage(`"${title}" 작품이 다시 모니터링 대상에 추가되었습니다.`);
        loadTitles();
      } else {
        setError(res.error || '작품 복원에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to restore title:', err);
      setError('작품 복원에 실패했습니다.');
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
    <MainLayout pageTitle="모니터링 작품">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 현재 모니터링 작품 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">현재 모니터링 대상</h3>
              <p className="text-sm text-gray-500">{currentTitles.length}개 작품</p>
            </div>
          </div>
          
          {/* 작품 추가 폼 */}
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="작품명 입력"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <input
                  type="text"
                  value={newMantaUrl}
                  onChange={(e) => setNewMantaUrl(e.target.value)}
                  placeholder="Manta URL (선택)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {addError && (
                <p className="text-sm text-red-600">{addError}</p>
              )}
              <button
                type="submit"
                disabled={isAdding}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlusIcon className="w-4 h-4" />
                {isAdding ? '추가 중...' : '작품 추가'}
              </button>
            </form>
          </div>

          {/* 현재 작품 목록 */}
          <div className="p-6 max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : currentTitles.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <p>등록된 작품이 없습니다</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {currentTitles.map((title) => (
                  <li
                    key={title.name}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{title.name}</p>
                      {title.manta_url && (
                        <p className="text-xs text-gray-500 truncate">{title.manta_url}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(title.name)}
                      className="ml-3 p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                      title="모니터링 제외"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 이전 모니터링 작품 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">이전 모니터링 대상</h3>
            <p className="text-sm text-gray-500">{historyTitles.length}개 작품 (모니터링 제외됨)</p>
          </div>

          <div className="p-6 max-h-[500px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : historyTitles.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <p>이전 작품이 없습니다</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {historyTitles.map((title) => (
                  <li
                    key={title.name}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-500 truncate">{title.name}</p>
                      {title.manta_url && (
                        <p className="text-xs text-gray-400 truncate">{title.manta_url}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestore(title.name)}
                      className="ml-3 p-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                      title="다시 모니터링"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
