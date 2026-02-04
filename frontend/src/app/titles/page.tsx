'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { titlesApi } from '@/lib/api';
import { 
  PlusIcon, 
  TrashIcon, 
  ArrowPathIcon, 
  LanguageIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

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
  
  // 비공식 타이틀 편집 상태
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editingUnofficialTitles, setEditingUnofficialTitles] = useState<string[]>([]);
  const [newUnofficialTitle, setNewUnofficialTitle] = useState('');
  const [isSavingUnofficial, setIsSavingUnofficial] = useState(false);

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

  // 비공식 타이틀 편집 시작
  const handleStartEditUnofficial = (title: Title) => {
    setEditingTitle(title.name);
    setEditingUnofficialTitles(title.unofficial_titles || []);
    setNewUnofficialTitle('');
  };

  // 비공식 타이틀 편집 취소
  const handleCancelEditUnofficial = () => {
    setEditingTitle(null);
    setEditingUnofficialTitles([]);
    setNewUnofficialTitle('');
  };

  // 비공식 타이틀 추가 (로컬)
  const handleAddUnofficialTitle = () => {
    if (!newUnofficialTitle.trim()) return;
    if (editingUnofficialTitles.includes(newUnofficialTitle.trim())) {
      alert('이미 등록된 타이틀입니다.');
      return;
    }
    setEditingUnofficialTitles(prev => [...prev, newUnofficialTitle.trim()]);
    setNewUnofficialTitle('');
  };

  // 비공식 타이틀 삭제 (로컬)
  const handleRemoveUnofficialTitle = (index: number) => {
    setEditingUnofficialTitles(prev => prev.filter((_, i) => i !== index));
  };

  // 비공식 타이틀 저장
  const handleSaveUnofficialTitles = async () => {
    if (!editingTitle) return;
    
    setIsSavingUnofficial(true);
    try {
      const res = await titlesApi.updateUnofficial(editingTitle, editingUnofficialTitles);
      if (res.success) {
        setSuccessMessage(`"${editingTitle}" 작품의 비공식 타이틀이 업데이트되었습니다.`);
        handleCancelEditUnofficial();
        loadTitles();
      } else {
        setError(res.error || '비공식 타이틀 저장에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to save unofficial titles:', err);
      setError('비공식 타이틀 저장에 실패했습니다.');
    } finally {
      setIsSavingUnofficial(false);
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
    <MainLayout pageTitle="모니터링 작품 관리">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-180px)]">
        {/* 현재 모니터링 작품 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0">
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
          <div className="p-6 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : currentTitles.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <p>등록된 작품이 없습니다</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {currentTitles.map((title) => (
                  <li
                    key={title.name}
                    className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                  >
                    {editingTitle === title.name ? (
                      // 비공식 타이틀 편집 모드
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-800">{title.name}</p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={handleSaveUnofficialTitles}
                              disabled={isSavingUnofficial}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded transition"
                              title="저장"
                            >
                              <CheckIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEditUnofficial}
                              className="p-1.5 text-gray-500 hover:bg-gray-200 rounded transition"
                              title="취소"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        
                        {/* 비공식 타이틀 목록 */}
                        <div className="space-y-2">
                          <p className="text-xs text-gray-500">비공식 타이틀 (다국어/대체명)</p>
                          {editingUnofficialTitles.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">등록된 비공식 타이틀이 없습니다</p>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {editingUnofficialTitles.map((ut, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded"
                                >
                                  {ut}
                                  <button
                                    onClick={() => handleRemoveUnofficialTitle(idx)}
                                    className="hover:text-red-600"
                                  >
                                    <XMarkIcon className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          
                          {/* 새 비공식 타이틀 추가 */}
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newUnofficialTitle}
                              onChange={(e) => setNewUnofficialTitle(e.target.value)}
                              placeholder="새 비공식 타이틀"
                              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddUnofficialTitle())}
                            />
                            <button
                              onClick={handleAddUnofficialTitle}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      // 일반 모드
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{title.name}</p>
                          {title.manta_url && (
                            <a
                              href={title.manta_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline truncate block"
                            >
                              {title.manta_url}
                            </a>
                          )}
                          {title.unofficial_titles && title.unofficial_titles.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {title.unofficial_titles.map((ut, idx) => (
                                <span
                                  key={idx}
                                  className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-600 rounded"
                                >
                                  {ut}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleStartEditUnofficial(title)}
                            className="p-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                            title="다국어/대체 타이틀 편집"
                          >
                            <LanguageIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemove(title.name)}
                            className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                            title="모니터링 제외"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 이전 모니터링 작품 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800">이전 모니터링 대상</h3>
            <p className="text-sm text-gray-500">{historyTitles.length}개 작품 (모니터링 제외됨)</p>
          </div>

          <div className="p-6 flex-1 overflow-y-auto">
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
