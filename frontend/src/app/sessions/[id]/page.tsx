'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout';
import { sessionsApi, titlesApi } from '@/lib/api';
import { ArrowLeftIcon, ArrowDownTrayIcon, DocumentDuplicateIcon, CheckIcon, ClipboardIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

interface Result {
  title: string;
  domain: string;
  url: string;
  search_query: string;
  page: number;
  rank: number;
  status: string;
  llm_judgment: string | null;
  llm_reason: string | null;
  final_status: 'illegal' | 'legal' | 'pending';
}

interface Title {
  name: string;
  manta_url: string | null;
  unofficial_titles?: string[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  
  const [results, setResults] = useState<Result[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [availableTitles, setAvailableTitles] = useState<string[]>([]);
  const [titlesData, setTitlesData] = useState<Title[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isCopyingAll, setIsCopyingAll] = useState(false);
  
  // 필터
  const [titleFilter, setTitleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Manta URL 토글
  const [showMantaUrl, setShowMantaUrl] = useState(false);

  // 타이틀 데이터 로드 (Manta URL 포함)
  useEffect(() => {
    const loadTitles = async () => {
      try {
        const res = await titlesApi.getList();
        if (res.success) {
          setTitlesData(res.current || []);
        }
      } catch (err) {
        console.error('Failed to load titles:', err);
      }
    };
    loadTitles();
  }, []);

  // 데이터 로드 (서버사이드 필터링)
  const loadResults = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await sessionsApi.getResults(sessionId, currentPage, titleFilter, statusFilter);
      if (res.success) {
        setResults(res.results || []);
        setPagination(res.pagination);
        setAvailableTitles(res.available_titles || []);
      } else {
        setError('결과를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load results:', err);
      setError('결과를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 필터 변경 시 페이지 1로 리셋하고 다시 로드
  useEffect(() => {
    setCurrentPage(1);
  }, [titleFilter, statusFilter]);

  useEffect(() => {
    if (sessionId) {
      loadResults();
    }
  }, [sessionId, currentPage, titleFilter, statusFilter]);

  // 선택한 작품의 Manta URL 가져오기
  const getSelectedTitleMantaUrl = () => {
    if (titleFilter === 'all') return null;
    const title = titlesData.find(t => t.name === titleFilter);
    return title?.manta_url || null;
  };

  // 선택한 필터 조건의 모든 불법 URL 복사
  const handleCopyAllIllegalUrls = async () => {
    setIsCopyingAll(true);
    try {
      // 서버에서 해당 조건의 모든 URL 가져오기
      const res = await sessionsApi.getAllUrls(
        sessionId, 
        titleFilter, 
        statusFilter === 'all' ? 'illegal' : statusFilter
      );
      
      if (res.success) {
        const urls = res.results
          .filter((r: Result) => r.final_status === 'illegal')
          .map((r: Result) => r.url);
        
        if (urls.length === 0) {
          alert('복사할 불법 URL이 없습니다.');
          return;
        }
        
        await navigator.clipboard.writeText(urls.join('\n'));
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy URLs:', err);
      alert('URL 복사에 실패했습니다.');
    } finally {
      setIsCopyingAll(false);
    }
  };

  // Manta URL 복사
  const handleCopyMantaUrl = async () => {
    const mantaUrl = getSelectedTitleMantaUrl();
    if (mantaUrl) {
      await navigator.clipboard.writeText(mantaUrl);
      alert('Manta URL이 복사되었습니다.');
    }
  };

  // 상태 배지
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'illegal':
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">불법</span>;
      case 'legal':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">합법</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">대기</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">{status}</span>;
    }
  };

  // 행 배경색
  const getRowBgColor = (status: string) => {
    switch (status) {
      case 'illegal':
        return 'bg-red-50 hover:bg-red-100';
      case 'legal':
        return 'bg-green-50 hover:bg-green-100';
      case 'pending':
        return 'bg-yellow-50 hover:bg-yellow-100';
      default:
        return 'hover:bg-gray-50';
    }
  };

  // 다운로드
  const handleDownload = () => {
    window.open(`/api/sessions/${sessionId}/download`, '_blank');
  };

  // 불법 URL 개수 (서버에서 필터링된 전체 개수)
  const illegalCount = pagination?.total || 0;

  return (
    <MainLayout pageTitle={`모니터링 회차: ${sessionId}`}>
      {/* 상단 네비게이션 */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button
          onClick={() => router.push('/sessions')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span>목록으로 돌아가기</span>
        </button>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAllIllegalUrls}
            disabled={isCopyingAll}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
              copySuccess 
                ? 'bg-green-600 text-white' 
                : 'bg-red-600 text-white hover:bg-red-700'
            } disabled:opacity-50`}
          >
            {isCopyingAll ? (
              <span>로딩...</span>
            ) : copySuccess ? (
              <>
                <CheckIcon className="w-4 h-4" />
                <span>복사됨!</span>
              </>
            ) : (
              <>
                <DocumentDuplicateIcon className="w-4 h-4" />
                <span>불법 URL 복사 {statusFilter === 'illegal' && pagination ? `(${pagination.total})` : ''}</span>
              </>
            )}
          </button>
          
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            <span>Excel 다운로드</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* 필터 */}
      <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">작품 선택</label>
            <select
              value={titleFilter}
              onChange={(e) => setTitleFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">전체 작품</option>
              {availableTitles.map(title => (
                <option key={title} value={title}>{title}</option>
              ))}
            </select>
            
            {/* 선택한 작품의 Manta URL 토글 */}
            {titleFilter !== 'all' && getSelectedTitleMantaUrl() && (
              <div className="mt-2">
                <button
                  onClick={() => setShowMantaUrl(!showMantaUrl)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  📖 Manta 공식 페이지
                  {showMantaUrl ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                </button>
                {showMantaUrl && (
                  <div className="mt-1 p-2 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <a
                        href={getSelectedTitleMantaUrl()!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline break-all flex-1"
                      >
                        {getSelectedTitleMantaUrl()}
                      </a>
                      <button
                        onClick={handleCopyMantaUrl}
                        className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                        title="URL 복사"
                      >
                        <ClipboardIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">상태 필터</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">전체 상태</option>
              <option value="illegal">🔴 불법</option>
              <option value="legal">🟢 합법</option>
              <option value="pending">🟡 대기</option>
            </select>
          </div>
          
          <div className="flex items-end">
            {pagination && (
              <div className="text-sm text-gray-600 py-2">
                총 <strong>{pagination.total.toLocaleString()}</strong>건
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 결과 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>결과가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">작품</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">도메인</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">URL</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">상태</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">페이지</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">순위</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((result, idx) => (
                  <tr key={idx} className={`transition ${getRowBgColor(result.final_status)}`}>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-800">{result.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono text-gray-600">{result.domain}</span>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline truncate block max-w-xs"
                        title={result.url}
                      >
                        {result.url}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getStatusBadge(result.final_status)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-600">{result.page}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-600">{result.rank}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {pagination && pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">
              {currentPage} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={currentPage === pagination.totalPages}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
