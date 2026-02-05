'use client';

import { useState, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout';
import { reportTrackingApi, titlesApi } from '@/lib/api';
import { 
  MagnifyingGlassIcon, 
  DocumentDuplicateIcon, 
  ArrowDownTrayIcon,
  PlusIcon,
  ArrowUpTrayIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

interface Session {
  id: string;
  created_at: string;
  status: string;
  tracking_stats: {
    total: number;
    [key: string]: number;
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
  reason: string | null;
  created_at: string;
  updated_at: string;
}

interface Reason {
  id: number;
  text: string;
  usage_count: number;
}

interface Title {
  name: string;
  manta_url: string | null;
}

const STATUS_OPTIONS = ['미신고', '신고완료', '차단', '미차단', '확인필요', '색인없음', '거부', '대기 중'];

export default function ReportTrackingPage() {
  // 세션 관련
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  
  // 데이터
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [titles, setTitles] = useState<Title[]>([]);
  
  // 필터
  const [statusFilter, setStatusFilter] = useState<string>('전체 상태');
  const [searchQuery, setSearchQuery] = useState('');
  
  // URL 추가
  const [selectedTitle, setSelectedTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  
  // 파일 업로드
  const [reportId, setReportId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  
  // 상태
  const [isLoading, setIsLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 세션 목록 로드
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        const [sessionsRes, reasonsRes, titlesRes] = await Promise.all([
          reportTrackingApi.getSessions(),
          reportTrackingApi.getReasons(),
          titlesApi.getList(),
        ]);
        
        if (sessionsRes.success) {
          setSessions(sessionsRes.sessions || []);
          if (sessionsRes.sessions?.length > 0) {
            setSelectedSessionId(sessionsRes.sessions[0].id);
          }
        }
        if (reasonsRes.success) {
          setReasons(reasonsRes.reasons || []);
        }
        if (titlesRes.success) {
          setTitles(titlesRes.current || []);
        }
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialData();
  }, []);

  // 선택된 세션 데이터 로드
  useEffect(() => {
    if (!selectedSessionId) return;
    
    const loadSessionData = async () => {
      try {
        const res = await reportTrackingApi.getBySession(selectedSessionId);
        if (res.success) {
          setItems(res.items || []);
        }
        
        // 선택된 세션 정보 업데이트
        const session = sessions.find(s => s.id === selectedSessionId);
        setSelectedSession(session || null);
        // 업로드 이력 로드
        const uploadsRes = await reportTrackingApi.getUploads(selectedSessionId);
        if (uploadsRes.success) {
          setUploadHistory(uploadsRes.uploads || []);
        }
      } catch (err) {
        console.error('Failed to load session data:', err);
      }
    };
    loadSessionData();
  }, [selectedSessionId, sessions]);

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // 필터링된 아이템
  const filteredItems = items.filter(item => {
    if (statusFilter !== '전체 상태' && item.report_status !== statusFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return item.url.toLowerCase().includes(query) || item.domain.toLowerCase().includes(query);
    }
    return true;
  });

  // 날짜 포맷
  const formatSessionDate = (sessionId: string) => {
    // sessionId 형식: 2026-02-03T01-59-16
    try {
      const parts = sessionId.split('T');
      const datePart = parts[0];
      const date = new Date(datePart);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return sessionId;
    }
  };

  // 상태 변경
  const handleStatusChange = async (id: number, newStatus: string) => {
    try {
      await reportTrackingApi.updateStatus(id, newStatus);
      setItems(prev => prev.map(item => 
        item.id === id ? { ...item, report_status: newStatus } : item
      ));
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  // 신고ID 변경
  const handleReportIdChange = async (id: number, newReportId: string) => {
    try {
      await reportTrackingApi.updateReportId(id, newReportId);
      setItems(prev => prev.map(item => 
        item.id === id ? { ...item, report_id: newReportId } : item
      ));
    } catch (err) {
      console.error('Failed to update report ID:', err);
    }
  };

  // 사유 변경
  const handleReasonChange = async (id: number, reasonText: string) => {
    try {
      if (reasonText) {
        await reportTrackingApi.updateReason(id, reasonText);
      }
      setItems(prev => prev.map(item => 
        item.id === id ? { ...item, reason: reasonText || null } : item
      ));
    } catch (err) {
      console.error('Failed to update reason:', err);
    }
  };

  // URL 복사
  const handleCopyUrls = async () => {
    const urls = filteredItems.map(item => item.url);
    if (urls.length === 0) {
      alert('복사할 URL이 없습니다.');
      return;
    }
    try {
      await navigator.clipboard.writeText(urls.join('\n'));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      alert('클립보드 복사에 실패했습니다.');
    }
  };

  // CSV 내보내기
  const handleExportCsv = () => {
    if (filteredItems.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }
    
    const headers = ['URL', '도메인', '상태', '신고ID', '사유'];
    const rows = filteredItems.map(item => [
      item.url,
      item.domain,
      item.report_status,
      item.report_id || '',
      item.reason || '',
    ]);
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-tracking-${selectedSessionId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // URL 수동 추가
  const handleAddUrl = async () => {
    if (!selectedSessionId) {
      setErrorMessage('모니터링 회차를 선택해주세요.');
      return;
    }
    if (!selectedTitle || !newUrl) {
      setErrorMessage('작품과 URL을 모두 입력해주세요.');
      return;
    }
    
    setIsAddingUrl(true);
    setErrorMessage(null);
    
    try {
      const res = await reportTrackingApi.addUrl(selectedSessionId, newUrl, selectedTitle);
      if (res.success) {
        setSuccessMessage(res.message || 'URL이 추가되었습니다.');
        setNewUrl('');
        setSelectedTitle('');
        // 목록 새로고침
        const refreshRes = await reportTrackingApi.getBySession(selectedSessionId);
        if (refreshRes.success) {
          setItems(refreshRes.items || []);
        }
        // 세션 통계 새로고침
        const sessionsRes = await reportTrackingApi.getSessions();
        if (sessionsRes.success) {
          setSessions(sessionsRes.sessions || []);
        }
      } else {
        setErrorMessage(res.error || 'URL 추가에 실패했습니다.');
      }
    } catch (err: any) {
      console.error('Failed to add URL:', err);
      setErrorMessage(err.response?.data?.error || 'URL 추가에 실패했습니다.');
    } finally {
      setIsAddingUrl(false);
    }
  };

  // 파일 업로드
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!selectedSessionId) {
      setErrorMessage('모니터링 회차를 선택해주세요.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    if (!reportId.trim()) {
      setErrorMessage('신고 ID를 입력해주세요.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setIsUploading(true);
    setErrorMessage(null);
    
    try {
      // 파일 읽기
      const htmlContent = await file.text();
      
      const res = await reportTrackingApi.uploadHtml(
        selectedSessionId,
        htmlContent,
        reportId.trim(),
        file.name
      );
      
      if (res.success) {
        setSuccessMessage(res.message || `${res.matched_urls}개 URL이 '차단' 상태로 업데이트되었습니다.`);
        setReportId('');
        // 목록 새로고침
        const refreshRes = await reportTrackingApi.getBySession(selectedSessionId);
        if (refreshRes.success) {
          setItems(refreshRes.items || []);
        }
        // 업로드 이력 새로고침
        const uploadsRes = await reportTrackingApi.getUploads(selectedSessionId);
        if (uploadsRes.success) {
          setUploadHistory(uploadsRes.uploads || []);
        }
        // 세션 통계 새로고침
        const sessionsRes = await reportTrackingApi.getSessions();
        if (sessionsRes.success) {
          setSessions(sessionsRes.sessions || []);
        }
      } else {
        setErrorMessage(res.error || '파일 업로드에 실패했습니다.');
      }
    } catch (err: any) {
      console.error('Failed to upload file:', err);
      setErrorMessage(err.response?.data?.error || '파일 업로드에 실패했습니다.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 상태별 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case '미신고': return 'bg-purple-100 text-purple-700';
      case '신고완료': return 'bg-blue-100 text-blue-700';
      case '차단': return 'bg-green-100 text-green-700';
      case '미차단': return 'bg-red-100 text-red-700';
      case '확인필요': return 'bg-yellow-100 text-yellow-700';
      case '색인없음': return 'bg-gray-100 text-gray-600';
      case '거부': return 'bg-orange-100 text-orange-700';
      case '대기 중': return 'bg-cyan-100 text-cyan-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <MainLayout pageTitle="신고결과 추적">
      {/* 알림 메시지 */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)} className="ml-2 underline">닫기</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 좌측 패널 */}
        <div className="lg:col-span-1 space-y-6">
          {/* 모니터링 회차 선택 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              📅 모니터링 회차
            </h3>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {formatSessionDate(session.id)} ({session.tracking_stats?.total || 0}개)
                </option>
              ))}
            </select>
            
            {/* 현황 요약 */}
            {selectedSession && (
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-gray-800">
                      {selectedSession.tracking_stats?.total || 0}
                    </p>
                    <p className="text-xs text-gray-500">전체</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-green-600">
                      {selectedSession.tracking_stats?.['차단'] || 0}
                    </p>
                    <p className="text-xs text-gray-500">차단</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-purple-600">
                      {selectedSession.tracking_stats?.['미신고'] || 0}
                    </p>
                    <p className="text-xs text-gray-500">미신고</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-red-600">
                      {selectedSession.tracking_stats?.['거부'] || 0}
                    </p>
                    <p className="text-xs text-gray-500">거부</p>
                  </div>
                  <div className="bg-cyan-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-cyan-600">
                      {selectedSession.tracking_stats?.['대기 중'] || 0}
                    </p>
                    <p className="text-xs text-gray-500">대기중</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-slate-600">
                      {selectedSession.tracking_stats?.['색인없음'] || 0}
                    </p>
                    <p className="text-xs text-gray-500">색인없음</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* URL 수동 추가 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              ➕ URL 수동 추가
            </h3>
            <div className="space-y-3">
              <select
                value={selectedTitle}
                onChange={(e) => setSelectedTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- 작품 선택 --</option>
                {titles.map(title => (
                  <option key={title.name} value={title.name}>{title.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddUrl}
                  disabled={isAddingUrl}
                  className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAddingUrl ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <PlusIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">작품을 선택하고 불법 URL을 추가합니다.</p>
            </div>
          </div>

          {/* 신고 결과 업로드 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              📤 신고 결과 업로드
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={reportId}
                onChange={(e) => setReportId(e.target.value)}
                placeholder="신고 ID (예: 12345)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center transition ${
                  isUploading 
                    ? 'border-blue-400 bg-blue-50 cursor-wait' 
                    : 'border-gray-300 cursor-pointer hover:border-blue-500'
                }`}
              >
                {isUploading ? (
                  <>
                    <div className="w-8 h-8 mx-auto border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
                    <p className="text-sm text-blue-600">업로드 중...</p>
                  </>
                ) : (
                  <>
                    <ArrowUpTrayIcon className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">HTML 파일을 여기에 드래그하거나</p>
                    <p className="text-sm text-blue-600 hover:underline">클릭하여 선택</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".html,.htm"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </div>
              <p className="text-xs text-gray-500">구글 신고 결과 페이지를 업로드하면 차단된 URL을 자동 매칭합니다.</p>
            </div>
            
            {/* 업로드 이력 */}
            <div className="mt-4">
              <h4 className="text-xs font-medium text-gray-600 mb-2">⏱️ 업로드 이력</h4>
              {uploadHistory.length === 0 ? (
                <p className="text-xs text-gray-400">이력 없음</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {uploadHistory.map((item) => (
                    <div key={item.id} className="text-xs text-gray-600 flex justify-between items-center">
                      <span className="font-medium text-blue-600">#{item.report_id}</span>
                      <span>{item.matched_count}건 매칭</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 우측 패널 - URL 목록 */}
        <div className="lg:col-span-3">
          {/* 필터 및 액션 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex gap-2 items-center flex-1">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>전체 상태</option>
                  {STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <div className="relative flex-1 max-w-xs">
                  <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="URL 검색..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={handleCopyUrls}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                    copySuccess
                      ? 'bg-green-600 text-white'
                      : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {copySuccess ? <CheckIcon className="w-4 h-4" /> : <DocumentDuplicateIcon className="w-4 h-4" />}
                  <span>{copySuccess ? '복사됨!' : 'URL 복사'}</span>
                </button>
                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  <span>CSV 내보내기</span>
                </button>
              </div>
            </div>
          </div>

          {/* URL 테이블 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <p>데이터가 없습니다</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">URL</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">도메인</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-28">상태</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-24">신고ID</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-40">사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline truncate block max-w-sm"
                            title={item.url}
                          >
                            {item.url}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{item.domain}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <select
                            value={item.report_status}
                            onChange={(e) => handleStatusChange(item.id, e.target.value)}
                            className={`px-2 py-1 text-xs font-medium rounded-full border-0 focus:ring-2 focus:ring-blue-500 ${getStatusColor(item.report_status)}`}
                          >
                            {STATUS_OPTIONS.map(status => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="text"
                            value={item.report_id || ''}
                            onChange={(e) => handleReportIdChange(item.id, e.target.value)}
                            placeholder="-"
                            className="w-20 px-2 py-1 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <select
                            value={item.reason || ''}
                            onChange={(e) => handleReasonChange(item.id, e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">사유 선택...</option>
                            {reasons.map(reason => (
                              <option key={reason.id} value={reason.text}>{reason.text}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
