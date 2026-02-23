'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { reportTrackingApi, titlesApi } from '@/lib/api';
import { 
  MagnifyingGlassIcon, 
  DocumentDuplicateIcon, 
  ArrowDownTrayIcon,
  PlusIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  XMarkIcon,
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

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PendingItem {
  id: number;
  session_id: string;
  url: string;
  domain: string;
  title: string | null;
  report_status: string;
  report_id: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS = ['미신고', '차단', '색인없음', '거부', '대기 중'];
const ITEMS_PER_PAGE = 50;

export default function ReportTrackingPage() {
  // 세션 관련
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  
  // 데이터
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [titles, setTitles] = useState<Title[]>([]);
  
  // 페이지네이션
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: ITEMS_PER_PAGE,
    total: 0,
    totalPages: 0
  });
  
  // 필터
  const [statusFilter, setStatusFilter] = useState<string>('전체 상태');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
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

  // 대기 중 요약 모달
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [pendingSortField, setPendingSortField] = useState<'created_at' | 'report_id'>('created_at');
  const [pendingSortOrder, setPendingSortOrder] = useState<'asc' | 'desc'>('desc');
  const [pendingCount, setPendingCount] = useState(0);

  // 검색어 디바운스
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  // 세션 데이터 로드 함수
  const loadSessionData = useCallback(async (page: number = 1) => {
    if (!selectedSessionId) return;
    
    setIsLoading(true);
    try {
      const status = statusFilter !== '전체 상태' ? statusFilter : undefined;
      const res = await reportTrackingApi.getBySession(selectedSessionId, {
        status,
        page,
        limit: ITEMS_PER_PAGE,
        search: debouncedSearch || undefined
      });
      
      if (res.success) {
        setItems(res.items || []);
        setPagination(res.pagination || {
          page: 1,
          limit: ITEMS_PER_PAGE,
          total: res.items?.length || 0,
          totalPages: 1
        });
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
    } finally {
      setIsLoading(false);
    }
  }, [selectedSessionId, statusFilter, debouncedSearch, sessions]);

  // 선택된 세션/필터/검색어 변경 시 데이터 로드
  useEffect(() => {
    if (selectedSessionId) {
      // 검색어나 필터 변경 시 1페이지로 리셋
      loadSessionData(1);
    }
  }, [selectedSessionId, statusFilter, debouncedSearch]);

  // 페이지 변경
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    loadSessionData(newPage);
  };

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // 날짜 포맷
  const formatSessionDate = (sessionId: string) => {
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
    const urls = items.map(item => item.url);
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
    if (items.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }
    
    const headers = ['URL', '도메인', '상태', '신고ID', '사유'];
    const rows = items.map(item => [
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
        loadSessionData(pagination.page);
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

  // CSV 파일명에서 신고 ID 추출 (예: "9-0695000040090_Urls.csv" → "9-0695000040090")
  const extractReportIdFromFileName = (fileName: string): string | null => {
    const match = fileName.match(/^(.+?)_Urls\.csv$/i);
    return match ? match[1] : null;
  };

  // CSV 파일 파싱 (파이프 구분자)
  const parseCsvContent = (text: string): { url: string; status: string; details: string }[] => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length <= 1) return []; // 헤더만 있거나 비어있음
    
    // 첫 줄은 헤더 (URL|Review Status|Details)
    return lines.slice(1).map(line => {
      const parts = line.split('|');
      return {
        url: (parts[0] || '').trim(),
        status: (parts[1] || '').trim(),
        details: (parts[2] || '').trim(),
      };
    }).filter(row => row.url && row.status);
  };

  // 파일 업로드 (CSV)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!selectedSessionId) {
      setErrorMessage('모니터링 회차를 선택해주세요.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setIsUploading(true);
    setErrorMessage(null);
    
    try {
      // 파일명에서 신고 ID 추출
      const extractedReportId = reportId.trim() || extractReportIdFromFileName(file.name);
      
      if (!extractedReportId) {
        setErrorMessage('파일명에서 신고 ID를 추출할 수 없습니다. 신고 ID를 직접 입력하거나, 파일명이 "신고ID_Urls.csv" 형식인지 확인해주세요.');
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      // CSV 파싱
      const csvText = await file.text();
      const csvRows = parseCsvContent(csvText);
      
      if (csvRows.length === 0) {
        setErrorMessage('CSV 파일에 유효한 데이터가 없습니다. 파이프(|) 구분자 형식인지 확인해주세요.');
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      const res = await reportTrackingApi.uploadCsv(
        selectedSessionId,
        csvRows,
        extractedReportId,
        file.name
      );
      
      if (res.success) {
        setSuccessMessage(res.message || `${res.matched_urls}개 URL이 업데이트되었습니다.`);
        setReportId('');
        // 목록 새로고침
        loadSessionData(pagination.page);
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

  // ============================================
  // 대기 중 요약 모달
  // ============================================

  // 대기 중 URL 개수 업데이트 (전체 세션 기준)
  useEffect(() => {
    // 전체 세션의 대기 중 합계
    const totalPending = sessions.reduce((sum, s) => sum + (s.tracking_stats?.['대기 중'] || 0), 0);
    setPendingCount(totalPending);
  }, [sessions]);

  const loadPendingItems = async () => {
    setIsLoadingPending(true);
    try {
      // 전체 세션에서 대기 중인 URL 모두 조회 (session_id 미전달)
      const res = await reportTrackingApi.getPendingSummary();
      if (res.success) {
        setPendingItems(res.items || []);
      }
    } catch (err) {
      console.error('Failed to load pending summary:', err);
    } finally {
      setIsLoadingPending(false);
    }
  };

  const handleOpenPendingModal = async () => {
    setShowPendingModal(true);
    await loadPendingItems();
  };

  const handleClosePendingModal = () => {
    setShowPendingModal(false);
    // 부모 페이지 데이터 새로고침 (모달에서 변경한 내용 반영)
    loadSessionData(pagination.page);
    // 세션 통계도 새로고침
    reportTrackingApi.getSessions().then(res => {
      if (res.success) {
        setSessions(res.sessions || []);
      }
    });
  };

  // 대기 중 모달 내 상태 변경 (인라인 저장)
  const handlePendingStatusChange = async (id: number, newStatus: string) => {
    try {
      await reportTrackingApi.updateStatus(id, newStatus);
      setPendingItems(prev => {
        if (newStatus !== '대기 중') {
          // 대기 중이 아닌 상태로 변경하면 목록에서 제거
          return prev.filter(item => item.id !== id);
        }
        return prev.map(item =>
          item.id === id ? { ...item, report_status: newStatus } : item
        );
      });
      // 대기 중 카운트 업데이트
      if (newStatus !== '대기 중') {
        setPendingCount(prev => Math.max(0, prev - 1));
      }
      // 세션 목록 통계 실시간 갱신 (모니터링 회차 상세에도 반영)
      const sessionsRes = await reportTrackingApi.getSessions();
      if (sessionsRes.success) {
        setSessions(sessionsRes.sessions || []);
      }
      // 현재 선택된 세션의 아이템도 실시간 갱신
      if (selectedSessionId) {
        loadSessionData(pagination.page);
      }
    } catch (err) {
      console.error('Failed to update pending status:', err);
    }
  };

  // 대기 중 모달 내 사유 변경 (인라인 저장)
  const handlePendingReasonChange = async (id: number, reasonText: string) => {
    try {
      if (reasonText) {
        await reportTrackingApi.updateReason(id, reasonText);
      }
      setPendingItems(prev => prev.map(item =>
        item.id === id ? { ...item, reason: reasonText || null } : item
      ));
    } catch (err) {
      console.error('Failed to update pending reason:', err);
    }
  };

  // 대기 중 모달 내 신고ID 변경 (인라인 저장)
  const handlePendingReportIdChange = async (id: number, newReportId: string) => {
    try {
      await reportTrackingApi.updateReportId(id, newReportId);
      setPendingItems(prev => prev.map(item =>
        item.id === id ? { ...item, report_id: newReportId } : item
      ));
    } catch (err) {
      console.error('Failed to update pending report ID:', err);
    }
  };

  // 대기 중 정렬
  const handlePendingSort = (field: 'created_at' | 'report_id') => {
    if (pendingSortField === field) {
      setPendingSortOrder(pendingSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setPendingSortField(field);
      setPendingSortOrder('desc');
    }
  };

  const getPendingSortIcon = (field: string) => {
    if (pendingSortField !== field) return ' ↕';
    return pendingSortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  const sortedPendingItems = [...pendingItems].sort((a, b) => {
    if (pendingSortField === 'created_at') {
      const aDate = new Date(a.created_at).getTime();
      const bDate = new Date(b.created_at).getTime();
      return pendingSortOrder === 'asc' ? aDate - bDate : bDate - aDate;
    } else if (pendingSortField === 'report_id') {
      const aId = a.report_id || '';
      const bId = b.report_id || '';
      const cmp = aId.localeCompare(bId);
      return pendingSortOrder === 'asc' ? cmp : -cmp;
    }
    return 0;
  });

  // 상태별 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case '미신고': return 'bg-purple-100 text-purple-700';
      case '차단': return 'bg-green-100 text-green-700';
      case '색인없음': return 'bg-gray-100 text-gray-600';
      case '거부': return 'bg-orange-100 text-orange-700';
      case '대기 중': return 'bg-cyan-100 text-cyan-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  // 페이지네이션 렌더링
  const renderPagination = () => {
    if (pagination.totalPages <= 1 || debouncedSearch) return null;
    
    const pages: (number | string)[] = [];
    const current = pagination.page;
    const total = pagination.totalPages;
    
    // 페이지 번호 생성 로직
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      if (current <= 3) {
        pages.push(1, 2, 3, 4, '...', total);
      } else if (current >= total - 2) {
        pages.push(1, '...', total - 3, total - 2, total - 1, total);
      } else {
        pages.push(1, '...', current - 1, current, current + 1, '...', total);
      }
    }
    
    return (
      <div className="flex items-center justify-center gap-1 mt-4">
        <button
          onClick={() => handlePageChange(current - 1)}
          disabled={current === 1}
          className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        
        {pages.map((page, idx) => (
          page === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-3 py-2 text-gray-400">...</span>
          ) : (
            <button
              key={page}
              onClick={() => handlePageChange(page as number)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                page === current
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              {page}
            </button>
          )
        ))}
        
        <button
          onClick={() => handlePageChange(current + 1)}
          disabled={current === total}
          className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      </div>
    );
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

      {/* 대기 중 요약 보기 버튼 */}
      <div className="mb-4">
        <button
          onClick={handleOpenPendingModal}
          disabled={!selectedSessionId || pendingCount === 0}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition shadow-sm ${
            pendingCount > 0
              ? 'bg-cyan-600 text-white hover:bg-cyan-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          <ClockIcon className="w-5 h-5" />
          대기 중 요약 보기
          {pendingCount > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-white text-cyan-700">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* 대기 중 요약 모달 */}
      {showPendingModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-100 rounded-lg">
                  <ClockIcon className="w-5 h-5 text-cyan-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">대기 중 URL 요약 (전체 세션)</h2>
                  <p className="text-sm text-gray-500">
                    모든 모니터링 회차 | {sortedPendingItems.length}건
                  </p>
                </div>
              </div>
              <button
                onClick={handleClosePendingModal}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="flex-1 overflow-auto px-6 py-4">
              {isLoadingPending ? (
                <div className="flex items-center justify-center h-48 text-gray-400">
                  <p>로딩 중...</p>
                </div>
              ) : sortedPendingItems.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-400">
                  <p>대기 중인 URL이 없습니다.</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-600 w-8">#</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-600 w-24">회차</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-600">URL</th>
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-600 w-28">도메인</th>
                      <th 
                        className="px-3 py-2.5 text-left text-xs font-medium text-gray-600 w-32 cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handlePendingSort('created_at')}
                      >
                        신고일시{getPendingSortIcon('created_at')}
                      </th>
                      <th 
                        className="px-3 py-2.5 text-center text-xs font-medium text-gray-600 w-24 cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handlePendingSort('report_id')}
                      >
                        신고ID{getPendingSortIcon('report_id')}
                      </th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-600 w-28">상태</th>
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-600 w-40">사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedPendingItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-gray-50 transition">
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-gray-400">{idx + 1}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-gray-500 font-mono" title={item.session_id}>
                            {item.session_id?.slice(0, 10) || '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline truncate block max-w-xs"
                            title={item.url}
                          >
                            {item.url}
                          </a>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-gray-600 truncate block" title={item.domain}>{item.domain}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-gray-500">
                            {new Date(item.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="text"
                            defaultValue={item.report_id || ''}
                            onBlur={(e) => {
                              const val = e.target.value.trim();
                              if (val !== (item.report_id || '')) {
                                handlePendingReportIdChange(item.id, val);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                            placeholder="-"
                            className="w-20 px-2 py-1 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <select
                            value={item.report_status}
                            onChange={(e) => handlePendingStatusChange(item.id, e.target.value)}
                            className={`px-2 py-1 text-xs font-medium rounded-full border-0 focus:ring-2 focus:ring-blue-500 ${getStatusColor(item.report_status)}`}
                          >
                            {STATUS_OPTIONS.map(status => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <select
                            value={item.reason || ''}
                            onChange={(e) => handlePendingReasonChange(item.id, e.target.value)}
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
              )}
            </div>

            {/* 모달 푸터 */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              <p className="text-xs text-gray-500">
                상태 및 사유 변경은 자동 저장됩니다.
              </p>
              <button
                onClick={handleClosePendingModal}
                className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
              >
                닫기
              </button>
            </div>
          </div>
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
                placeholder="신고 ID (미입력시 파일명에서 자동추출)"
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
                    <p className="text-sm text-gray-600">CSV 파일을 여기에 드래그하거나</p>
                    <p className="text-sm text-blue-600 hover:underline">클릭하여 선택</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </div>
              <p className="text-xs text-gray-500">구글 신고 결과 CSV 파일(신고ID_Urls.csv)을 업로드하면 상태별(차단/거부/대기 중)로 자동 매칭합니다.</p>
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
                    placeholder="URL/도메인 검색 (전체에서 검색)"
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              
              <div className="flex gap-2 items-center">
                {/* 현재 표시 정보 */}
                <span className="text-sm text-gray-500">
                  {debouncedSearch ? (
                    `검색 결과: ${pagination.total}개`
                  ) : (
                    `${pagination.total}개 중 ${(pagination.page - 1) * ITEMS_PER_PAGE + 1}-${Math.min(pagination.page * ITEMS_PER_PAGE, pagination.total)}개`
                  )}
                </span>
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
            ) : items.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <p>{debouncedSearch ? '검색 결과가 없습니다' : '데이터가 없습니다'}</p>
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
                    {items.map((item) => (
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
            
            {/* 페이지네이션 */}
            {renderPagination()}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
