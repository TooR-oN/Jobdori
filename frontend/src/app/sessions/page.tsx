'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout';
import { sessionsApi } from '@/lib/api';

interface Session {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  titles_count: number;
  keywords_count: number;
  total_searches: number;
  results_summary: {
    total: number;
    illegal: number;
    legal: number;
    pending: number;
  };
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 데이터 로드
  useEffect(() => {
    const loadSessions = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const res = await sessionsApi.getList();
        if (res.success) {
          setSessions(res.sessions || []);
        } else {
          setError('세션 목록을 불러오는데 실패했습니다.');
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
        setError('세션 목록을 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };
    loadSessions();
  }, []);

  // 날짜 포맷
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 상태 배지
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">완료</span>;
      case 'running':
        return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">진행 중</span>;
      case 'failed':
        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">실패</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">{status}</span>;
    }
  };

  return (
    <MainLayout pageTitle="모니터링 회차">
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* 요약 카드 */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">전체 회차</p>
          <p className="text-2xl font-bold text-gray-800">{sessions.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">완료</p>
          <p className="text-2xl font-bold text-green-600">
            {sessions.filter(s => s.status === 'completed').length}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">진행 중</p>
          <p className="text-2xl font-bold text-blue-600">
            {sessions.filter(s => s.status === 'running').length}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">총 발견 URL</p>
          <p className="text-2xl font-bold text-gray-800">
            {sessions.reduce((sum, s) => sum + (s.results_summary?.total || 0), 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* 세션 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>모니터링 회차가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">회차 ID</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">실행일시</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">상태</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">작품 수</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">검색 수</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">불법</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">합법</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">대기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/sessions/${session.id}`)}
                        className="text-sm font-mono text-blue-600 hover:text-blue-800 hover:underline transition"
                        title="상세 보기"
                      >
                        {session.id}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{formatDate(session.created_at)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getStatusBadge(session.status)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-600">{session.titles_count}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-600">{session.total_searches}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-medium text-red-600">
                        {session.results_summary?.illegal || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-medium text-green-600">
                        {session.results_summary?.legal || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-medium text-yellow-600">
                        {session.results_summary?.pending || 0}
                      </span>
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
