'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { excludedUrlsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { 
  PlusIcon, 
  TrashIcon, 
  MagnifyingGlassIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';

interface ExcludedUrl {
  id: number;
  url: string;
  created_at: string;
}

export default function ExcludedUrlsPage() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const router = useRouter();
  
  const [urls, setUrls] = useState<ExcludedUrl[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // 권한 체크
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/');
    }
  }, [isAdmin, authLoading, router]);

  // 데이터 로드
  useEffect(() => {
    const loadUrls = async () => {
      if (!isAdmin) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const res = await excludedUrlsApi.getList();
        if (res.success) {
          setUrls(res.items || []);
        } else {
          setError('제외 URL 목록을 불러오는데 실패했습니다.');
        }
      } catch (err) {
        console.error('Failed to load excluded urls:', err);
        setError('제외 URL 목록을 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    loadUrls();
  }, [isAdmin]);

  // 필터링
  const filteredUrls = urls.filter(url =>
    url.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // URL 추가
  const handleAdd = async () => {
    if (!newUrl.trim()) {
      alert('URL을 입력해주세요.');
      return;
    }
    
    setIsAdding(true);
    try {
      const res = await excludedUrlsApi.add(newUrl.trim());
      if (res.success) {
        setUrls(prev => [res.item, ...prev]);
        setNewUrl('');
      } else {
        alert(res.error || 'URL 추가에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to add url:', err);
      alert('URL 추가에 실패했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  // URL 삭제
  const handleDelete = async (id: number) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    
    try {
      const res = await excludedUrlsApi.remove(id);
      if (res.success) {
        setUrls(prev => prev.filter(url => url.id !== id));
      } else {
        alert(res.error || 'URL 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to delete url:', err);
      alert('URL 삭제에 실패했습니다.');
    }
  };

  // 날짜 포맷
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (authLoading) {
    return (
      <MainLayout pageTitle="제외 URL 관리">
        <div className="flex items-center justify-center h-64 text-gray-400">
          <p>로딩 중...</p>
        </div>
      </MainLayout>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <MainLayout pageTitle="제외 URL 관리">
      {/* 설명 */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <ExclamationCircleIcon className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <p className="text-sm text-blue-800 font-medium">제외 URL이란?</p>
            <p className="text-sm text-blue-700 mt-1">
              모니터링 결과에서 제외할 URL 목록입니다. 여기에 등록된 URL은 불법/합법 판정에서 
              자동으로 제외되며, 통계에도 포함되지 않습니다.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* URL 추가 */}
      <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">새 URL 추가</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/path"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={isAdding}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition"
          >
            <PlusIcon className="w-5 h-5" />
            <span>{isAdding ? '추가 중...' : '추가'}</span>
          </button>
        </div>
      </div>

      {/* 검색 */}
      <div className="mb-4 flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="URL 검색..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <span className="text-sm text-gray-500">
          총 {filteredUrls.length}개
        </span>
      </div>

      {/* URL 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : filteredUrls.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>{searchQuery ? '검색 결과가 없습니다' : '등록된 제외 URL이 없습니다'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">URL</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-40">등록일</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-20">삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUrls.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline"
                      >
                        {item.url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-500">{formatDate(item.created_at)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="삭제"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
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
