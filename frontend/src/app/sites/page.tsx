'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { sitesApi } from '@/lib/api';
import { PlusIcon, TrashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function SitesPage() {
  // API는 문자열 배열을 반환함
  const [illegalSites, setIllegalSites] = useState<string[]>([]);
  const [legalSites, setLegalSites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 검색
  const [illegalSearch, setIllegalSearch] = useState('');
  const [legalSearch, setLegalSearch] = useState('');
  
  // 추가 폼
  const [newIllegalDomain, setNewIllegalDomain] = useState('');
  const [newLegalDomain, setNewLegalDomain] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // 데이터 로드
  const loadSites = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const [illegalRes, legalRes] = await Promise.all([
        sitesApi.getByType('illegal'),
        sitesApi.getByType('legal'),
      ]);
      
      if (illegalRes.success) {
        // API가 문자열 배열을 반환
        setIllegalSites(illegalRes.sites || []);
      }
      if (legalRes.success) {
        setLegalSites(legalRes.sites || []);
      }
    } catch (err) {
      console.error('Failed to load sites:', err);
      setError('사이트 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSites();
  }, []);

  // 사이트 추가
  const handleAdd = async (type: 'illegal' | 'legal') => {
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
  const handleRemove = async (domain: string, type: 'illegal' | 'legal') => {
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

  // 필터된 목록 (문자열 배열)
  const filteredIllegalSites = illegalSites.filter(domain => 
    domain.toLowerCase().includes(illegalSearch.toLowerCase())
  );
  const filteredLegalSites = legalSites.filter(domain => 
    domain.toLowerCase().includes(legalSearch.toLowerCase())
  );

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  return (
    <MainLayout pageTitle="불법/합법 사이트" requireAdmin>
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
        {/* 불법 사이트 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 bg-red-50">
            <h3 className="text-lg font-semibold text-red-800">🚫 불법 사이트</h3>
            <p className="text-sm text-red-600">{illegalSites.length}개 등록됨</p>
          </div>
          
          {/* 검색 */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={illegalSearch}
                onChange={(e) => setIllegalSearch(e.target.value)}
                placeholder="도메인 검색..."
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>
          
          {/* 추가 폼 */}
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <form onSubmit={(e) => { e.preventDefault(); handleAdd('illegal'); }} className="flex gap-2">
              <input
                type="text"
                value={newIllegalDomain}
                onChange={(e) => setNewIllegalDomain(e.target.value)}
                placeholder="새 도메인 입력 (예: example.com)"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                disabled={isAdding}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* 목록 */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">로딩 중...</div>
            ) : filteredIllegalSites.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                {illegalSearch ? '검색 결과가 없습니다' : '등록된 사이트가 없습니다'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredIllegalSites.map((domain) => (
                  <li key={domain} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                    <span className="text-sm font-mono text-gray-800">{domain}</span>
                    <button
                      onClick={() => handleRemove(domain, 'illegal')}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 bg-green-50">
            <h3 className="text-lg font-semibold text-green-800">✅ 합법 사이트</h3>
            <p className="text-sm text-green-600">{legalSites.length}개 등록됨</p>
          </div>
          
          {/* 검색 */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={legalSearch}
                onChange={(e) => setLegalSearch(e.target.value)}
                placeholder="도메인 검색..."
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          
          {/* 추가 폼 */}
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <form onSubmit={(e) => { e.preventDefault(); handleAdd('legal'); }} className="flex gap-2">
              <input
                type="text"
                value={newLegalDomain}
                onChange={(e) => setNewLegalDomain(e.target.value)}
                placeholder="새 도메인 입력 (예: example.com)"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="submit"
                disabled={isAdding}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* 목록 */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">로딩 중...</div>
            ) : filteredLegalSites.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                {legalSearch ? '검색 결과가 없습니다' : '등록된 사이트가 없습니다'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredLegalSites.map((domain) => (
                  <li key={domain} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                    <span className="text-sm font-mono text-gray-800">{domain}</span>
                    <button
                      onClick={() => handleRemove(domain, 'legal')}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition"
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
