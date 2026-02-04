'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { sitesApi, excludedUrlsApi } from '@/lib/api';
import { PlusIcon, TrashIcon, MagnifyingGlassIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

interface ExcludedUrl {
  id: number;
  url: string;
  created_at: string;
}

export default function SitesPage() {
  // 사이트 목록 (API는 문자열 배열 반환)
  const [illegalSites, setIllegalSites] = useState<string[]>([]);
  const [legalSites, setLegalSites] = useState<string[]>([]);
  const [excludedUrls, setExcludedUrls] = useState<ExcludedUrl[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 검색
  const [illegalSearch, setIllegalSearch] = useState('');
  const [legalSearch, setLegalSearch] = useState('');
  const [excludedSearch, setExcludedSearch] = useState('');
  
  // 추가 폼
  const [newIllegalDomain, setNewIllegalDomain] = useState('');
  const [newLegalDomain, setNewLegalDomain] = useState('');
  const [newExcludedUrl, setNewExcludedUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // 데이터 로드
  const loadSites = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const [illegalRes, legalRes, excludedRes] = await Promise.all([
        sitesApi.getByType('illegal'),
        sitesApi.getByType('legal'),
        excludedUrlsApi.getList(),
      ]);
      
      if (illegalRes.success) {
        setIllegalSites(illegalRes.sites || []);
      }
      if (legalRes.success) {
        setLegalSites(legalRes.sites || []);
      }
      if (excludedRes.success) {
        setExcludedUrls(excludedRes.items || []);
      }
    } catch (err) {
      console.error('Failed to load sites:', err);
      setError('데이터를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSites();
  }, []);

  // 사이트 추가
  const handleAddSite = async (type: 'illegal' | 'legal') => {
    const domain = type === 'illegal' ? newIllegalDomain.trim() : newLegalDomain.trim();
    
    if (!domain) {
      setError('도메인을 입력해주세요.');
      return;
    }
    
    setIsAdding(true);
    
    try {
      const res = await sitesApi.add(domain, type);
      if (res.success) {
        if (type === 'illegal') {
          setNewIllegalDomain('');
        } else {
          setNewLegalDomain('');
        }
        setSuccessMessage(`"${domain}"이(가) ${type === 'illegal' ? '불법' : '합법'} 사이트 목록에 추가되었습니다.`);
        loadSites();
      } else {
        setError(res.error || '사이트 추가에 실패했습니다.');
      }
    } catch (err: any) {
      console.error('Failed to add site:', err);
      setError(err.response?.data?.error || '사이트 추가에 실패했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  // 사이트 삭제
  const handleRemoveSite = async (domain: string, type: 'illegal' | 'legal') => {
    if (!confirm(`"${domain}"을(를) ${type === 'illegal' ? '불법' : '합법'} 사이트 목록에서 삭제하시겠습니까?`)) {
      return;
    }
    
    try {
      const res = await sitesApi.remove(domain, type);
      if (res.success) {
        setSuccessMessage(`"${domain}"이(가) 목록에서 삭제되었습니다.`);
        loadSites();
      } else {
        setError(res.error || '사이트 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to remove site:', err);
      setError('사이트 삭제에 실패했습니다.');
    }
  };

  // 제외 URL 추가
  const handleAddExcludedUrl = async () => {
    if (!newExcludedUrl.trim()) {
      setError('URL을 입력해주세요.');
      return;
    }
    
    setIsAdding(true);
    try {
      const res = await excludedUrlsApi.add(newExcludedUrl.trim());
      if (res.success) {
        setNewExcludedUrl('');
        setSuccessMessage('제외 URL이 추가되었습니다.');
        loadSites();
      } else {
        setError(res.error || 'URL 추가에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to add excluded url:', err);
      setError('URL 추가에 실패했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  // 제외 URL 삭제
  const handleRemoveExcludedUrl = async (id: number, url: string) => {
    if (!confirm(`"${url}"을(를) 제외 URL 목록에서 삭제하시겠습니까?`)) {
      return;
    }
    
    try {
      const res = await excludedUrlsApi.remove(id);
      if (res.success) {
        setSuccessMessage('제외 URL이 삭제되었습니다.');
        loadSites();
      } else {
        setError(res.error || 'URL 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to remove excluded url:', err);
      setError('URL 삭제에 실패했습니다.');
    }
  };

  // 필터된 목록
  const filteredIllegalSites = illegalSites.filter(domain => 
    domain.toLowerCase().includes(illegalSearch.toLowerCase())
  );
  const filteredLegalSites = legalSites.filter(domain => 
    domain.toLowerCase().includes(legalSearch.toLowerCase())
  );
  const filteredExcludedUrls = excludedUrls.filter(item =>
    item.url.toLowerCase().includes(excludedSearch.toLowerCase())
  );

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  return (
    <MainLayout pageTitle="사이트 목록" requireAdmin>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
        {/* 불법 사이트 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-gray-100 bg-red-50">
            <h3 className="text-base font-semibold text-red-800">🚫 불법 사이트 ({illegalSites.length}개)</h3>
          </div>
          
          {/* 추가 폼 */}
          <div className="px-3 py-2 border-b border-gray-100">
            <form onSubmit={(e) => { e.preventDefault(); handleAddSite('illegal'); }} className="flex gap-2">
              <input
                type="text"
                value={newIllegalDomain}
                onChange={(e) => setNewIllegalDomain(e.target.value)}
                placeholder="불법 사이트 도메인 입력..."
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                disabled={isAdding}
                className="p-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition disabled:opacity-50"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">로딩 중...</div>
            ) : filteredIllegalSites.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                등록된 사이트가 없습니다
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredIllegalSites.map((domain) => (
                  <li key={domain} className="px-3 py-2 flex items-center justify-between hover:bg-gray-50 text-sm">
                    <span className="font-mono text-gray-800 truncate">{domain}</span>
                    <button
                      onClick={() => handleRemoveSite(domain, 'illegal')}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition flex-shrink-0"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 합법 사이트 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-gray-100 bg-green-50">
            <h3 className="text-base font-semibold text-green-800">✅ 합법 사이트 ({legalSites.length}개)</h3>
          </div>
          
          {/* 추가 폼 */}
          <div className="px-3 py-2 border-b border-gray-100">
            <form onSubmit={(e) => { e.preventDefault(); handleAddSite('legal'); }} className="flex gap-2">
              <input
                type="text"
                value={newLegalDomain}
                onChange={(e) => setNewLegalDomain(e.target.value)}
                placeholder="합법 사이트 도메인 입력..."
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="submit"
                disabled={isAdding}
                className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition disabled:opacity-50"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">로딩 중...</div>
            ) : filteredLegalSites.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                등록된 사이트가 없습니다
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredLegalSites.map((domain) => (
                  <li key={domain} className="px-3 py-2 flex items-center justify-between hover:bg-gray-50 text-sm">
                    <span className="font-mono text-gray-800 truncate">{domain}</span>
                    <button
                      onClick={() => handleRemoveSite(domain, 'legal')}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition flex-shrink-0"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 신고 제외 URL */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-gray-100 bg-orange-50">
            <h3 className="text-base font-semibold text-orange-800">🚫 신고 제외 URL ({excludedUrls.length}개)</h3>
          </div>
          
          {/* 추가 폼 */}
          <div className="px-3 py-2 border-b border-gray-100">
            <form onSubmit={(e) => { e.preventDefault(); handleAddExcludedUrl(); }} className="flex gap-2">
              <input
                type="text"
                value={newExcludedUrl}
                onChange={(e) => setNewExcludedUrl(e.target.value)}
                placeholder="신고 제외할 전체 URL 입력 (https://...)"
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                type="submit"
                disabled={isAdding}
                className="p-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition disabled:opacity-50"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* 설명 */}
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
            <p className="text-xs text-gray-500 flex items-start gap-1">
              <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              불법 사이트지만 신고해도 처리되지 않는 URL (예: 메인 페이지)
            </p>
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">로딩 중...</div>
            ) : filteredExcludedUrls.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                등록된 URL이 없습니다
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredExcludedUrls.map((item) => (
                  <li key={item.id} className="px-3 py-2 flex items-center justify-between hover:bg-gray-50 text-sm group">
                    <a 
                      href={item.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline truncate flex-1"
                      title={item.url}
                    >
                      {item.url}
                    </a>
                    <button
                      onClick={() => handleRemoveExcludedUrl(item.id, item.url)}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition flex-shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <TrashIcon className="w-4 h-4" />
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
