'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { reportTrackingApi } from '@/lib/api';
import { ChevronDownIcon, ChevronUpIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface TrackingSession {
  id: string;
  created_at: string;
  status: string;
  tracking_stats: {
    total: number;
    reported: number;
    blocked: number;
    pending: number;
  };
}

interface TrackingItem {
  id: number;
  session_id: string;
  url: string;
  domain: string;
  title: string;
  report_status: string;
  report_id: string | null;
  reason_id: number | null;
  reason_text: string | null;
  created_at: string;
}

interface Reason {
  id: number;
  text: string;
  usage_count: number;
}

const STATUS_OPTIONS = [
  { value: '미신고', label: '미신고', color: 'bg-gray-100 text-gray-700' },
  { value: '신고완료', label: '신고완료', color: 'bg-blue-100 text-blue-700' },
  { value: '차단', label: '차단', color: 'bg-green-100 text-green-700' },
  { value: '미차단', label: '미차단', color: 'bg-red-100 text-red-700' },
  { value: '확인필요', label: '확인필요', color: 'bg-yellow-100 text-yellow-700' },
];

export default function ReportTrackingPage() {
  const [sessions, setSessions] = useState<TrackingSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isItemsLoading, setIsItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 필터
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);

  // 세션 목록 로드
  useEffect(() => {
    const loadSessions = async () => {
      setIsLoading(true);
      try {
        const [sessionsRes, reasonsRes] = await Promise.all([
          reportTrackingApi.getSessions(),
          reportTrackingApi.getReasons(),
        ]);
        
        if (sessionsRes.success) {
          setSessions(sessionsRes.sessions || []);
          // 첫 번째 세션 자동 선택
          if (sessionsRes.sessions?.length > 0) {
            setSelectedSessionId(sessionsRes.sessions[0].id);
          }
        }
        
        if (reasonsRes.success) {
          setReasons(reasonsRes.reasons || []);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
        setError('데이터를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    loadSessions();
  }, []);

  // 선택된 세션의 아이템 로드
  useEffect(() => {
    if (!selectedSessionId) return;
    
    const loadItems = async () => {
      setIsItemsLoading(true);
      try {
        const res = await reportTrackingApi.getBySession(selectedSessionId, {
          status: statusFilter || undefined,
          page: currentPage,
          limit: 50,
          search: searchQuery || undefined,
        });
        
        if (res.success) {
          setItems(res.items || []);
          setPagination(res.pagination);
        }
      } catch (err) {
        console.error('Failed to load items:', err);
      } finally {
        setIsItemsLoading(false);
      }
    };
    loadItems();
  }, [selectedSessionId, statusFilter, currentPage, searchQuery]);

  // 상태 업데이트
  const handleStatusChange = async (itemId: number, newStatus: string) => {
    try {
      await reportTrackingApi.updateStatus(itemId, newStatus);
      setItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, report_status: newStatus } : item
      ));
    } catch (err) {
      console.error('Failed to update status:', err);
      setError('상태 업데이트에 실패했습니다.');
    }
  };

  // 날짜 포맷
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // 상태 배지
  const getStatusBadge = (status: string) => {
    const option = STATUS_OPTIONS.find(o => o.value === status);
    const color = option?.color || 'bg-gray-100 text-gray-600';
    return <span className={`px-2 py-1 text-xs font-medium rounded-full ${color}`}>{status}</span>;
  };

  return (
    <MainLayout pageTitle="신고결과 추적">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">닫기</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 왼쪽: 세션 목록 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">모니터링 회차</h3>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-gray-400">로딩 중...</div>
              ) : sessions.length === 0 ? (
                <div className="p-4 text-center text-gray-400">신고 추적 데이터가 없습니다</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {sessions.map((session) => (
                    <li key={session.id}>
                      <button
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          setCurrentPage(1);
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition ${
                          selectedSessionId === session.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-800">{session.id}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(session.created_at)}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="text-gray-600">총 {session.tracking_stats.total}</span>
                          <span className="text-green-600">차단 {session.tracking_stats.blocked}</span>
                          <span className="text-yellow-600">대기 {session.tracking_stats.pending}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* 오른쪽: 상세 목록 */}
        <div className="lg:col-span-3">
          {!selectedSessionId ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-400">
              왼쪽에서 회차를 선택하세요
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              {/* 필터 바 */}
              <div className="px-4 py-3 border-b border-gray-100 flex flex-col sm:flex-row gap-3">
                <div className="flex items-center gap-2">
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">전체 상태</option>
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex-1 relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="URL 또는 도메인 검색..."
                    className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                {pagination && (
                  <div className="text-sm text-gray-600 flex items-center">
                    총 {pagination.total.toLocaleString()}건
                  </div>
                )}
              </div>

              {/* 테이블 */}
              <div className="overflow-x-auto">
                {isItemsLoading ? (
                  <div className="p-8 text-center text-gray-400">로딩 중...</div>
                ) : items.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">데이터가 없습니다</div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">작품</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">도메인</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">URL</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-800">{item.title || '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-mono text-gray-600">{item.domain}</span>
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline truncate block max-w-xs"
                              title={item.url}
                            >
                              {item.url}
                            </a>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={item.report_status}
                              onChange={(e) => handleStatusChange(item.id, e.target.value)}
                              className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {STATUS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 페이지네이션 */}
              {pagination && pagination.totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    이전
                  </button>
                  <span className="text-sm text-gray-600">
                    {currentPage} / {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
                    disabled={currentPage === pagination.totalPages}
                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
