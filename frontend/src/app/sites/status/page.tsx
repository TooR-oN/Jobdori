'use client';

import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { siteStatusApi, distributionChannelApi, siteNotesApi } from '@/lib/api';
import {
  MagnifyingGlassIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowsRightLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

// ============================================
// 타입 정의
// ============================================

interface SiteNote {
  id: number;
  domain: string;
  note_type: string; // 'memo' | 'channel_change'
  content: string;
  created_at: string;
}

interface SiteStatusItem {
  id: number;
  domain: string;
  site_type: string;
  site_status: string;
  new_url: string | null;
  distribution_channel: string;
  latest_note: SiteNote | null;
  created_at: string;
}

interface DistributionChannel {
  id: number;
  name: string;
  is_default: boolean;
}

// ============================================
// 상수
// ============================================

const SITE_TYPE_OPTIONS = [
  { value: 'unclassified', label: '미분류', color: 'text-gray-400', bg: 'bg-gray-100' },
  { value: 'scanlation_group', label: 'Scanlation Group', color: 'text-red-600', bg: 'bg-red-50' },
  { value: 'aggregator', label: 'Aggregator', color: 'text-orange-600', bg: 'bg-orange-50' },
  { value: 'clone', label: 'Clone', color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { value: 'blog', label: 'Blog', color: 'text-blue-600', bg: 'bg-blue-50' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: '운영 중', icon: CheckCircleIcon, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  { value: 'closed', label: '폐쇄', icon: XCircleIcon, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  { value: 'changed', label: '주소 변경', icon: ArrowsRightLeftIcon, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
];

// KST 날짜 포맷 (YYYY-MM-DD HH:mm)
function formatKST(dateStr: string): string {
  const d = new Date(dateStr);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

// ============================================
// 컴포넌트
// ============================================

export default function SiteStatusPage() {
  const [sites, setSites] = useState<SiteStatusItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 유통 경로 옵션
  const [channels, setChannels] = useState<DistributionChannel[]>([]);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  // 검색
  const [search, setSearch] = useState('');

  // 필터
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // 수정 중 상태
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('active');
  const [editNewUrl, setEditNewUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 분류 변경 중
  const [classifyingDomain, setClassifyingDomain] = useState<string | null>(null);

  // 유통 경로 변경 중
  const [channelChangingDomain, setChannelChangingDomain] = useState<string | null>(null);

  // 활동 이력 펼치기
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<SiteNote[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [newMemo, setNewMemo] = useState('');
  const [isAddingMemo, setIsAddingMemo] = useState(false);

  // ============================================
  // 데이터 로드
  // ============================================

  const loadSites = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await siteStatusApi.getList();
      if (res.success) {
        setSites(res.sites || []);
      } else {
        setError('데이터를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load site status:', err);
      setError('데이터를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const res = await distributionChannelApi.getList();
      if (res.success) {
        setChannels(res.channels || []);
      }
    } catch (err) {
      console.error('Failed to load distribution channels:', err);
    }
  }, []);

  useEffect(() => {
    loadSites();
    loadChannels();
  }, [loadSites, loadChannels]);

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ============================================
  // 상태 변경 핸들러
  // ============================================

  const handleStartEdit = (site: SiteStatusItem) => {
    setEditingDomain(site.domain);
    setEditStatus(site.site_status);
    setEditNewUrl(site.new_url || '');
  };

  const handleCancelEdit = () => {
    setEditingDomain(null);
    setEditStatus('active');
    setEditNewUrl('');
  };

  const handleSaveStatus = async (domain: string) => {
    if (editStatus === 'changed' && !editNewUrl.trim()) {
      setError('주소 변경 상태에서는 새 URL을 입력해주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await siteStatusApi.updateStatus(domain, editStatus, editStatus === 'changed' ? editNewUrl.trim() : undefined);
      if (res.success) {
        setSites(prev => prev.map(s =>
          s.domain === domain
            ? { ...s, site_status: editStatus, new_url: editStatus === 'changed' ? editNewUrl.trim() : null }
            : s
        ));
        setSuccessMessage(`"${domain}" 상태가 업데이트되었습니다.`);
        handleCancelEdit();
      } else {
        setError(res.error || '상태 업데이트에 실패했습니다.');
      }
    } catch (err: any) {
      console.error('Failed to update site status:', err);
      setError(err.response?.data?.error || '상태 업데이트에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================
  // 분류 변경 핸들러
  // ============================================

  const handleClassify = async (domain: string, newType: string) => {
    setClassifyingDomain(domain);
    try {
      const res = await siteStatusApi.classify(domain, newType);
      if (res.success) {
        setSites(prev => prev.map(s =>
          s.domain === domain ? { ...s, site_type: newType } : s
        ));
        setSuccessMessage(`"${domain}" 분류가 변경되었습니다.`);
      } else {
        setError(res.error || '분류 변경에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to classify site:', err);
      setError('분류 변경에 실패했습니다.');
    } finally {
      setClassifyingDomain(null);
    }
  };

  // ============================================
  // 유통 경로 변경 핸들러
  // ============================================

  const handleChannelChange = async (domain: string, newChannel: string) => {
    if (newChannel === '__add_new__') {
      setShowAddChannel(true);
      return;
    }
    setChannelChangingDomain(domain);
    try {
      const res = await siteStatusApi.updateChannel(domain, newChannel);
      if (res.success) {
        setSites(prev => prev.map(s =>
          s.domain === domain ? { ...s, distribution_channel: newChannel } : s
        ));
        // latest_note도 갱신 (유통 경로 변경 이력이 생겼으므로)
        if (res.previous_channel !== newChannel) {
          const noteContent = `${res.previous_channel} → ${newChannel}`;
          setSites(prev => prev.map(s =>
            s.domain === domain
              ? {
                  ...s,
                  latest_note: {
                    id: 0,
                    domain,
                    note_type: 'channel_change',
                    content: noteContent,
                    created_at: new Date().toISOString(),
                  },
                }
              : s
          ));
        }
        setSuccessMessage(`"${domain}" 유통 경로가 "${newChannel}"로 변경되었습니다.`);
        // 펼쳐져 있으면 이력 새로고침
        if (expandedDomain === domain) {
          loadNotes(domain);
        }
      } else {
        setError(res.error || '유통 경로 변경에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to update channel:', err);
      setError('유통 경로 변경에 실패했습니다.');
    } finally {
      setChannelChangingDomain(null);
    }
  };

  const handleAddChannel = async () => {
    if (!newChannelName.trim()) return;
    try {
      const res = await distributionChannelApi.create(newChannelName.trim());
      if (res.success) {
        await loadChannels();
        setSuccessMessage(`유통 경로 "${newChannelName.trim()}" 추가됨`);
      }
    } catch (err) {
      console.error('Failed to add channel:', err);
      setError('유통 경로 추가에 실패했습니다.');
    } finally {
      setShowAddChannel(false);
      setNewChannelName('');
    }
  };

  // ============================================
  // 활동 이력 핸들러
  // ============================================

  const loadNotes = async (domain: string) => {
    setIsLoadingNotes(true);
    try {
      const res = await siteNotesApi.getByDomain(domain);
      if (res.success) {
        setExpandedNotes(res.notes || []);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const toggleNotes = async (domain: string) => {
    if (expandedDomain === domain) {
      setExpandedDomain(null);
      setExpandedNotes([]);
      setNewMemo('');
    } else {
      setExpandedDomain(domain);
      setNewMemo('');
      await loadNotes(domain);
    }
  };

  const handleAddMemo = async (domain: string) => {
    if (!newMemo.trim()) return;
    setIsAddingMemo(true);
    try {
      const res = await siteNotesApi.addMemo(domain, newMemo.trim());
      if (res.success) {
        setNewMemo('');
        await loadNotes(domain);
        // latest_note 갱신
        setSites(prev => prev.map(s =>
          s.domain === domain
            ? { ...s, latest_note: res.note }
            : s
        ));
        setSuccessMessage('메모가 추가되었습니다.');
      }
    } catch (err) {
      console.error('Failed to add memo:', err);
      setError('메모 추가에 실패했습니다.');
    } finally {
      setIsAddingMemo(false);
    }
  };

  const handleDeleteNote = async (noteId: number, domain: string) => {
    if (!confirm('이 이력을 삭제하시겠습니까?')) return;
    try {
      const res = await siteNotesApi.delete(noteId);
      if (res.success) {
        // 로컬 상태에서 즉시 제거 (리프레시 없음)
        const updatedNotes = expandedNotes.filter(n => n.id !== noteId);
        setExpandedNotes(updatedNotes);

        // latest_note도 로컬 업데이트
        const newLatest = updatedNotes.length > 0 ? updatedNotes[0] : null;
        setSites(prev => prev.map(s =>
          s.domain.toLowerCase() === domain.toLowerCase()
            ? { ...s, latest_note: newLatest }
            : s
        ));
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
      setError('이력 삭제에 실패했습니다.');
    }
  };

  // ============================================
  // 필터링
  // ============================================

  const filteredSites = sites.filter(site => {
    if (search && !site.domain.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (statusFilter !== 'all' && site.site_status !== statusFilter) {
      return false;
    }
    if (typeFilter !== 'all' && site.site_type !== typeFilter) {
      return false;
    }
    return true;
  });

  // ============================================
  // 통계 카운트
  // ============================================

  const statusCounts = {
    total: sites.length,
    active: sites.filter(s => s.site_status === 'active').length,
    closed: sites.filter(s => s.site_status === 'closed').length,
    changed: sites.filter(s => s.site_status === 'changed').length,
  };

  // ============================================
  // 상태 배지 렌더링
  // ============================================

  const renderStatusBadge = (status: string) => {
    const opt = STATUS_OPTIONS.find(o => o.value === status) || STATUS_OPTIONS[0];
    const Icon = opt.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${opt.bg} ${opt.color} border ${opt.border}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {opt.label}
      </span>
    );
  };

  // 활동 이력 아이콘/색상
  const getNoteIcon = (noteType: string) => {
    if (noteType === 'channel_change') return { emoji: '', color: 'text-purple-600', bg: 'bg-purple-50', label: '유통 경로 변경' };
    return { emoji: '', color: 'text-blue-600', bg: 'bg-blue-50', label: '메모' };
  };

  // ============================================
  // 렌더링
  // ============================================

  return (
    <MainLayout pageTitle="불법 사이트 현황">
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

      {/* 유통 경로 추가 모달 */}
      {showAddChannel && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">유통 경로 추가</h3>
            <input
              type="text"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="새 유통 경로 이름"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowAddChannel(false); setNewChannelName(''); }}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleAddChannel}
                disabled={!newChannelName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 상태 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">전체 사이트</p>
          <p className="text-2xl font-bold text-gray-800">{statusCounts.total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-green-100">
          <p className="text-xs text-green-600 mb-1">운영 중</p>
          <p className="text-2xl font-bold text-green-600">{statusCounts.active}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-red-100">
          <p className="text-xs text-red-600 mb-1">폐쇄</p>
          <p className="text-2xl font-bold text-red-600">{statusCounts.closed}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-amber-100">
          <p className="text-xs text-amber-600 mb-1">주소 변경</p>
          <p className="text-2xl font-bold text-amber-600">{statusCounts.changed}</p>
        </div>
      </div>

      {/* 필터 영역 */}
      <div className="mb-6 bg-white rounded-xl shadow-sm p-4 border border-gray-100">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="relative flex-1 min-w-0">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="도메인 검색..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">상태:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">전체</option>
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">분류:</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">전체</option>
              {SITE_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {filteredSites.length}개 표시
          </span>
        </div>
      </div>

      {/* 사이트 목록 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>로딩 중...</p>
          </div>
        ) : filteredSites.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>등록된 불법 사이트가 없습니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 w-8">#</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 w-48">도메인</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 w-36">분류</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 w-24">상태</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 w-48">변경 URL</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600 w-20">유통 경로</th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-600">활동 이력</th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-600 w-28 whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSites.map((site, index) => {
                  const isEditing = editingDomain === site.domain;
                  const isExpanded = expandedDomain === site.domain;

                  return (
                    <tr key={site.domain} className="group">
                      {/* 메인 행 */}
                      <td className={`px-2 py-3 align-top ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        <span className="text-xs text-gray-400">{index + 1}</span>
                      </td>

                      <td className={`px-2 py-3 align-top ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        <a
                          href={`https://${site.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-sm font-mono hover:underline truncate block max-w-[11rem] ${
                            site.site_status === 'closed' ? 'text-gray-400 line-through' : 'text-blue-600'
                          }`}
                          title={site.domain}
                        >
                          {site.domain}
                        </a>
                      </td>

                      <td className={`px-2 py-3 align-top ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        <select
                          value={site.site_type || 'unclassified'}
                          onChange={(e) => handleClassify(site.domain, e.target.value)}
                          disabled={classifyingDomain === site.domain}
                          className={`
                            text-xs px-1.5 py-1 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full
                            ${site.site_type === 'unclassified' || !site.site_type ? 'text-gray-400 bg-gray-50' : 'bg-white'}
                            ${site.site_type === 'scanlation_group' ? 'text-red-600 font-medium' : ''}
                            ${site.site_type === 'aggregator' ? 'text-orange-600 font-medium' : ''}
                            ${site.site_type === 'clone' ? 'text-yellow-600 font-medium' : ''}
                            ${site.site_type === 'blog' ? 'text-blue-600 font-medium' : ''}
                            ${classifyingDomain === site.domain ? 'opacity-50' : ''}
                          `}
                        >
                          {SITE_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>

                      <td className={`px-2 py-3 align-top whitespace-nowrap ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        {isEditing ? (
                          <select
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                            className="text-xs px-1.5 py-1 rounded border border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50 w-full"
                          >
                            {STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          renderStatusBadge(site.site_status)
                        )}
                      </td>

                      <td className={`px-2 py-3 align-top ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        {isEditing && editStatus === 'changed' ? (
                          <input
                            type="url"
                            value={editNewUrl}
                            onChange={(e) => setEditNewUrl(e.target.value)}
                            placeholder="새 URL"
                            className="w-full text-xs px-1.5 py-1 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50"
                          />
                        ) : site.site_status === 'changed' && site.new_url ? (
                          <a
                            href={site.new_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline truncate block"
                            title={site.new_url}
                          >
                            {site.new_url}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>

                      {/* 유통 경로 */}
                      <td className={`px-2 py-3 align-top ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        <select
                          value={site.distribution_channel || '웹'}
                          onChange={(e) => handleChannelChange(site.domain, e.target.value)}
                          disabled={channelChangingDomain === site.domain}
                          className={`text-xs px-1.5 py-1 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white
                            ${channelChangingDomain === site.domain ? 'opacity-50' : ''}
                          `}
                        >
                          {channels.map(ch => (
                            <option key={ch.id} value={ch.name}>{ch.name}</option>
                          ))}
                          <option value="__add_new__">+ 직접 입력</option>
                        </select>
                      </td>

                      {/* 활동 이력 */}
                      <td className={`px-2 py-3 align-top ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        <div className="flex items-start gap-1">
                          <div className="flex-1 min-w-0">
                            {site.latest_note ? (
                              <div className="text-xs">
                                <span className="text-gray-400">{formatKST(site.latest_note.created_at)}</span>
                                <span className={`ml-1 ${
                                  site.latest_note.note_type === 'channel_change' ? 'text-purple-600' : 'text-gray-700'
                                }`}>
                                  {site.latest_note.note_type === 'channel_change' ? '[경로] ' : ''}
                                  {site.latest_note.content.length > 30
                                    ? site.latest_note.content.substring(0, 30) + '...'
                                    : site.latest_note.content}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-300">이력 없음</span>
                            )}
                          </div>
                          <button
                            onClick={() => toggleNotes(site.domain)}
                            className="flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-600 rounded"
                            title={isExpanded ? '접기' : '이력 펼치기'}
                          >
                            {isExpanded ? (
                              <ChevronUpIcon className="w-4 h-4" />
                            ) : (
                              <ChevronDownIcon className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {/* 펼쳐진 활동 이력 */}
                        {isExpanded && (
                          <div className="mt-2 border-t border-gray-100 pt-2 space-y-2">
                            {/* 메모 입력 */}
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={newMemo}
                                onChange={(e) => setNewMemo(e.target.value)}
                                placeholder="메모 입력..."
                                className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddMemo(site.domain)}
                              />
                              <button
                                onClick={() => handleAddMemo(site.domain)}
                                disabled={isAddingMemo || !newMemo.trim()}
                                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-0.5"
                              >
                                <PlusIcon className="w-3 h-3" />
                                추가
                              </button>
                            </div>

                            {/* 이력 목록 */}
                            {isLoadingNotes ? (
                              <p className="text-xs text-gray-400">로딩 중...</p>
                            ) : expandedNotes.length === 0 ? (
                              <p className="text-xs text-gray-400">이력이 없습니다.</p>
                            ) : (
                              <div className="max-h-48 overflow-y-auto space-y-1.5">
                                {expandedNotes.map(note => {
                                  const ni = getNoteIcon(note.note_type);
                                  return (
                                    <div key={note.id} className={`flex items-start gap-1.5 p-1.5 rounded ${ni.bg}`}>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                          <span className={`text-[10px] font-medium ${ni.color}`}>{ni.label}</span>
                                          <span className="text-[10px] text-gray-400">{formatKST(note.created_at)}</span>
                                        </div>
                                        <p className="text-xs text-gray-700 mt-0.5 break-words">{note.content}</p>
                                      </div>
                                      <button
                                        onClick={() => handleDeleteNote(note.id, site.domain)}
                                        className="flex-shrink-0 p-0.5 text-gray-300 hover:text-red-500"
                                        title="삭제"
                                      >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 관리 버튼 */}
                      <td className={`px-2 py-3 text-center align-top whitespace-nowrap ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => handleSaveStatus(site.domain)}
                              disabled={isSaving}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
                            >
                              {isSaving ? '...' : '저장'}
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(site)}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition whitespace-nowrap"
                          >
                            상태 변경
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
