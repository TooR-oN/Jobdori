'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { siteStatusApi } from '@/lib/api';
import { MagnifyingGlassIcon, CheckCircleIcon, XCircleIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';

// ============================================
// 타입 정의
// ============================================

interface SiteStatusItem {
  id: number;
  domain: string;
  site_type: string;
  site_status: string;
  new_url: string | null;
  created_at: string;
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

// ============================================
// 컴포넌트
// ============================================

export default function SiteStatusPage() {
  const [sites, setSites] = useState<SiteStatusItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  // ============================================
  // 데이터 로드
  // ============================================

  const loadSites = async () => {
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
  };

  useEffect(() => {
    loadSites();
  }, []);

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
    // changed 상태인데 URL이 없으면 경고
    if (editStatus === 'changed' && !editNewUrl.trim()) {
      setError('주소 변경 상태에서는 새 URL을 입력해주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await siteStatusApi.updateStatus(domain, editStatus, editStatus === 'changed' ? editNewUrl.trim() : undefined);
      if (res.success) {
        // 로컬 상태 업데이트
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
  // 필터링
  // ============================================

  const filteredSites = sites.filter(site => {
    // 검색
    if (search && !site.domain.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    // 상태 필터
    if (statusFilter !== 'all' && site.site_status !== statusFilter) {
      return false;
    }
    // 분류 필터
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
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${opt.bg} ${opt.color} border ${opt.border}`}>
        <Icon className="w-3.5 h-3.5" />
        {opt.label}
      </span>
    );
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
          {/* 검색 */}
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

          {/* 상태 필터 */}
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

          {/* 분류 필터 */}
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

          {/* 결과 수 */}
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
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-12">#</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">도메인</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-44">분류</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600 w-32">상태</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">변경 URL</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-36">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSites.map((site, index) => {
                  const isEditing = editingDomain === site.domain;

                  return (
                    <tr key={site.domain} className={`hover:bg-gray-50 transition ${site.site_status === 'closed' ? 'opacity-60' : ''}`}>
                      {/* 번호 */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">{index + 1}</span>
                      </td>

                      {/* 도메인 */}
                      <td className="px-4 py-3">
                        <a
                          href={`https://${site.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-sm font-mono hover:underline ${
                            site.site_status === 'closed' ? 'text-gray-400 line-through' : 'text-blue-600'
                          }`}
                        >
                          {site.domain}
                        </a>
                      </td>

                      {/* 분류 */}
                      <td className="px-4 py-3">
                        <select
                          value={site.site_type || 'unclassified'}
                          onChange={(e) => handleClassify(site.domain, e.target.value)}
                          disabled={classifyingDomain === site.domain}
                          className={`
                            text-xs px-2 py-1 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400
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

                      {/* 상태 */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                            className="text-xs px-2 py-1 rounded border border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50"
                          >
                            {STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          renderStatusBadge(site.site_status)
                        )}
                      </td>

                      {/* 변경 URL */}
                      <td className="px-4 py-3">
                        {isEditing && editStatus === 'changed' ? (
                          <input
                            type="url"
                            value={editNewUrl}
                            onChange={(e) => setEditNewUrl(e.target.value)}
                            placeholder="새 URL (https://...)"
                            className="w-full text-xs px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-blue-50"
                          />
                        ) : site.site_status === 'changed' && site.new_url ? (
                          <a
                            href={site.new_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline truncate block max-w-xs"
                            title={site.new_url}
                          >
                            {site.new_url}
                          </a>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>

                      {/* 관리 버튼 */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleSaveStatus(site.domain)}
                              disabled={isSaving}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
                            >
                              {isSaving ? '저장 중...' : '저장'}
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-3 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(site)}
                            className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition"
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
