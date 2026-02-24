'use client';

import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { settingsApi, usersApi, titlesApi, keywordApi } from '@/lib/api';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  Cog6ToothIcon,
  UsersIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
}

interface SystemSetting {
  key: string;
  value: string;
  updated_at: string;
}

interface KeywordHistoryItem {
  id: number;
  suffix: string;
  deleted_at: string;
}

export default function AdminSettingsPage() {
  // 탭 관리
  const [activeTab, setActiveTab] = useState<'monitoring' | 'users'>('users');

  // ============================================
  // 모니터링 설정
  // ============================================
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [currentTitleCount, setCurrentTitleCount] = useState(0);
  const [maxTitles, setMaxTitles] = useState(20);
  const [editMaxTitles, setEditMaxTitles] = useState('');
  const [isEditingMax, setIsEditingMax] = useState(false);
  const [isSavingMax, setIsSavingMax] = useState(false);

  // ============================================
  // 키워드 관리
  // ============================================
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordHistory, setKeywordHistory] = useState<KeywordHistoryItem[]>([]);
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(true);
  const [newKeywordSuffix, setNewKeywordSuffix] = useState('');
  const [isAddingKeyword, setIsAddingKeyword] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // ============================================
  // 계정 관리
  // ============================================
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'user' as 'admin' | 'user',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 공통
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ============================================
  // 데이터 로드
  // ============================================

  const loadSettings = useCallback(async () => {
    setIsLoadingSettings(true);
    try {
      const [settingsRes, titlesRes] = await Promise.all([
        settingsApi.getAll(),
        titlesApi.getList(),
      ]);
      
      if (settingsRes.success) {
        setSettings(settingsRes.settings || []);
        const maxSetting = (settingsRes.settings || []).find((s: SystemSetting) => s.key === 'max_monitoring_titles');
        if (maxSetting) {
          const val = parseInt(maxSetting.value);
          setMaxTitles(val);
          setEditMaxTitles(String(val));
        }
      }
      
      if (titlesRes.success) {
        setCurrentTitleCount((titlesRes.current || []).length);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('설정을 불러오는데 실패했습니다.');
    } finally {
      setIsLoadingSettings(false);
    }
  }, []);

  const loadKeywords = useCallback(async () => {
    setIsLoadingKeywords(true);
    try {
      const [kwRes, historyRes] = await Promise.all([
        keywordApi.getList(),
        keywordApi.getHistory(),
      ]);
      
      if (kwRes.success) {
        setKeywords(kwRes.suffixes || []);
      }
      if (historyRes.success) {
        setKeywordHistory(historyRes.history || []);
      }
    } catch (err) {
      console.error('Failed to load keywords:', err);
    } finally {
      setIsLoadingKeywords(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    try {
      const res = await usersApi.getList();
      if (res.success) {
        setUsers(res.users || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
      setError('사용자 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadKeywords();
    loadUsers();
  }, [loadSettings, loadKeywords, loadUsers]);

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ============================================
  // 모니터링 설정 핸들러
  // ============================================

  const handleSaveMaxTitles = async () => {
    const newMax = parseInt(editMaxTitles);
    if (isNaN(newMax) || newMax < 1 || newMax > 100) {
      setError('1~100 사이의 숫자를 입력해주세요.');
      return;
    }

    setIsSavingMax(true);
    try {
      const res = await settingsApi.update('max_monitoring_titles', String(newMax));
      if (res.success) {
        setMaxTitles(newMax);
        setIsEditingMax(false);
        setSuccessMessage(`모니터링 작품 수 제한이 ${newMax}개로 변경되었습니다.`);
      } else {
        setError(res.error || '설정 변경에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to save max titles:', err);
      setError('설정 변경에 실패했습니다.');
    } finally {
      setIsSavingMax(false);
    }
  };

  // ============================================
  // 키워드 핸들러
  // ============================================

  const handleAddKeyword = async () => {
    const suffix = newKeywordSuffix.trim();
    // 빈 문자열은 "[작품명]" 키워드를 의미 - 별도 버튼으로 추가
    if (!suffix) return;
    
    setIsAddingKeyword(true);
    try {
      const res = await keywordApi.add(suffix);
      if (res.success) {
        setKeywords(res.suffixes);
        setNewKeywordSuffix('');
        setSuccessMessage(`키워드 "[작품명] ${suffix}" 추가됨 (다음 모니터링부터 적용)`);
        loadKeywords(); // 히스토리도 갱신
      } else {
        setError(res.error || '키워드 추가에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to add keyword:', err);
      setError('키워드 추가에 실패했습니다.');
    } finally {
      setIsAddingKeyword(false);
    }
  };

  const handleAddTitleOnlyKeyword = async () => {
    // 빈 문자열 = [작품명]만 검색
    setIsAddingKeyword(true);
    try {
      const res = await keywordApi.add('');
      if (res.success) {
        setKeywords(res.suffixes);
        setSuccessMessage(`키워드 "[작품명]" 추가됨 (다음 모니터링부터 적용)`);
        loadKeywords();
      } else {
        setError(res.error || '키워드 추가에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to add title-only keyword:', err);
      setError('키워드 추가에 실패했습니다.');
    } finally {
      setIsAddingKeyword(false);
    }
  };

  const handleDeleteKeyword = async (suffix: string) => {
    const displayName = suffix === '' ? '[작품명]' : `[작품명] ${suffix}`;
    if (!confirm(`"${displayName}" 키워드를 삭제하시겠습니까?\n삭제된 키워드는 히스토리에서 복원할 수 있습니다.`)) return;
    
    try {
      const res = await keywordApi.remove(suffix);
      if (res.success) {
        setKeywords(res.suffixes);
        setSuccessMessage(`키워드 "${displayName}" 삭제됨 (다음 모니터링부터 적용)`);
        loadKeywords(); // 히스토리 갱신
      } else {
        setError(res.error || '키워드 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to delete keyword:', err);
      setError('키워드 삭제에 실패했습니다.');
    }
  };

  const handleRestoreKeyword = async (item: KeywordHistoryItem) => {
    try {
      const res = await keywordApi.restore(item.id);
      if (res.success) {
        setKeywords(res.suffixes);
        const displayName = item.suffix === '' ? '[작품명]' : `[작품명] ${item.suffix}`;
        setSuccessMessage(`키워드 "${displayName}" 복원됨 (다음 모니터링부터 적용)`);
        loadKeywords();
      } else {
        setError(res.error || '키워드 복원에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to restore keyword:', err);
      setError('키워드 복원에 실패했습니다.');
    }
  };

  const handlePermanentDeleteKeyword = async (item: KeywordHistoryItem) => {
    const displayName = item.suffix === '' ? '[작품명]' : `[작품명] ${item.suffix}`;
    if (!confirm(`"${displayName}" 키워드를 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    
    try {
      const res = await keywordApi.permanentDelete(item.id);
      if (res.success) {
        setSuccessMessage(`키워드 "${displayName}" 영구 삭제됨`);
        loadKeywords();
      } else {
        setError(res.error || '영구 삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to permanently delete keyword:', err);
      setError('영구 삭제에 실패했습니다.');
    }
  };

  // ============================================
  // 계정 관리 핸들러
  // ============================================

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'user' });
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'user' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username.trim()) {
      setError('아이디를 입력해주세요.');
      return;
    }
    if (!editingUser && !formData.password) {
      setError('비밀번호를 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingUser) {
        const updateData: { role: string; password?: string } = { role: formData.role };
        if (formData.password) updateData.password = formData.password;
        const res = await usersApi.update(editingUser.id, updateData);
        if (res.success) {
          setSuccessMessage('사용자 정보가 수정되었습니다.');
          closeModal();
          loadUsers();
        } else {
          setError(res.error || '수정에 실패했습니다.');
        }
      } else {
        const res = await usersApi.create(formData.username, formData.password, formData.role);
        if (res.success) {
          setSuccessMessage('새 사용자가 생성되었습니다.');
          closeModal();
          loadUsers();
        } else {
          setError(res.error || '생성에 실패했습니다.');
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`"${user.username}" 계정을 삭제하시겠습니까?`)) return;
    try {
      const res = await usersApi.delete(user.id);
      if (res.success) {
        setSuccessMessage('계정이 삭제되었습니다.');
        loadUsers();
      } else {
        setError(res.error || '삭제에 실패했습니다.');
      }
    } catch (err) {
      setError('삭제에 실패했습니다.');
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      const res = await usersApi.update(user.id, { is_active: !user.is_active });
      if (res.success) {
        setSuccessMessage(`계정이 ${user.is_active ? '비활성화' : '활성화'}되었습니다.`);
        loadUsers();
      } else {
        setError(res.error || '상태 변경에 실패했습니다.');
      }
    } catch (err) {
      setError('상태 변경에 실패했습니다.');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  };

  const formatKST = (dateStr: string) => {
    const d = new Date(dateStr);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kst.getUTCDate()).padStart(2, '0');
    const h = String(kst.getUTCHours()).padStart(2, '0');
    const min = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  };

  // 제한 초과 여부
  const isOverLimit = currentTitleCount > maxTitles;

  // 작품명만 검색 키워드 존재 여부
  const hasTitleOnlyKeyword = keywords.includes('');

  return (
    <MainLayout pageTitle="관리자 설정" requireAdmin>
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

      {/* 탭 */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === 'users' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <UsersIcon className="w-4 h-4" />
            계정 관리
          </div>
        </button>
        <button
          onClick={() => setActiveTab('monitoring')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === 'monitoring' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <Cog6ToothIcon className="w-4 h-4" />
            모니터링 설정
          </div>
        </button>
      </div>

      {/* 모니터링 설정 탭 */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* 모니터링 작품 수 제한 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">모니터링 작품 수 제한</h3>
            
            {isLoadingSettings ? (
              <p className="text-gray-400 text-sm">로딩 중...</p>
            ) : (
              <div className="space-y-4">
                {/* 현황 */}
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-end gap-2">
                      <span className={`text-3xl font-bold ${isOverLimit ? 'text-amber-600' : 'text-blue-600'}`}>
                        {currentTitleCount}
                      </span>
                      <span className="text-lg text-gray-400 mb-1">/</span>
                      <span className="text-3xl font-bold text-gray-400">
                        {maxTitles}
                      </span>
                      <span className="text-sm text-gray-500 mb-1.5">개</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      현재 모니터링 중인 작품 수 / 최대 제한
                    </p>
                  </div>
                  
                  {/* 프로그레스 바 */}
                  <div className="flex-1">
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className={`h-3 rounded-full transition-all ${
                          isOverLimit ? 'bg-amber-500' : currentTitleCount / maxTitles > 0.8 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, (currentTitleCount / maxTitles) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-right">
                      {Math.round((currentTitleCount / maxTitles) * 100)}% 사용 중
                    </p>
                  </div>
                </div>

                {isOverLimit && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                    현재 제한({maxTitles}개)을 초과하고 있습니다. 기존 작품은 유지되지만 새 작품 추가가 제한됩니다.
                  </div>
                )}

                {/* 제한 수정 */}
                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    최대 모니터링 작품 수
                  </label>
                  <div className="flex items-center gap-3">
                    {isEditingMax ? (
                      <>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={editMaxTitles}
                          onChange={(e) => setEditMaxTitles(e.target.value)}
                          className="w-24 px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveMaxTitles()}
                        />
                        <button
                          onClick={handleSaveMaxTitles}
                          disabled={isSavingMax}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition"
                        >
                          {isSavingMax ? '저장 중...' : '저장'}
                        </button>
                        <button
                          onClick={() => { setIsEditingMax(false); setEditMaxTitles(String(maxTitles)); }}
                          className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-lg font-semibold text-gray-800">{maxTitles}개</span>
                        <button
                          onClick={() => setIsEditingMax(true)}
                          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition"
                        >
                          변경
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    메인 타이틀 기준으로 카운트됩니다 (비공식 타이틀 제외). 
                    제한을 초과한 상태에서 제한을 줄이면 기존 작품은 유지되고 새 작품 추가만 제한됩니다.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 모니터링 키워드 관리 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">모니터링 키워드 관리</h3>
                <p className="text-xs text-gray-500 mt-1">
                  각 작품명 뒤에 키워드를 붙여 검색합니다. 변경 사항은 다음 모니터링부터 적용됩니다.
                </p>
              </div>
              {keywordHistory.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition ${
                    showHistory 
                      ? 'bg-gray-200 text-gray-700' 
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  <ArrowPathIcon className="w-3.5 h-3.5" />
                  삭제된 키워드 ({keywordHistory.length})
                </button>
              )}
            </div>
            
            {isLoadingKeywords ? (
              <p className="text-gray-400 text-sm">로딩 중...</p>
            ) : (
              <div className="space-y-4">
                {/* 현재 활성 키워드 목록 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    현재 사용 중인 키워드 ({keywords.length}개)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((suffix, idx) => (
                      <div
                        key={idx}
                        className="group flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg"
                      >
                        <span className="text-sm text-blue-700 font-mono">
                          {suffix === '' ? '[작품명]' : `[작품명] ${suffix}`}
                        </span>
                        <button
                          onClick={() => handleDeleteKeyword(suffix)}
                          className="p-0.5 text-blue-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                          title="삭제"
                        >
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {keywords.length === 0 && (
                      <p className="text-sm text-gray-400">등록된 키워드가 없습니다.</p>
                    )}
                  </div>
                </div>

                {/* 키워드 추가 */}
                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    키워드 추가
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-mono whitespace-nowrap">[작품명]</span>
                    <input
                      type="text"
                      value={newKeywordSuffix}
                      onChange={(e) => setNewKeywordSuffix(e.target.value)}
                      placeholder="접미사 입력 (예: manhwa, free read)"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
                    />
                    <button
                      onClick={handleAddKeyword}
                      disabled={isAddingKeyword || !newKeywordSuffix.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition whitespace-nowrap"
                    >
                      <PlusIcon className="w-4 h-4" />
                      추가
                    </button>
                  </div>
                  {!hasTitleOnlyKeyword && (
                    <button
                      onClick={handleAddTitleOnlyKeyword}
                      disabled={isAddingKeyword}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      &quot;[작품명]&quot; 키워드 추가 (작품명만 검색)
                    </button>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    예시: &quot;manhwa&quot;를 추가하면 &quot;Crack manhwa&quot;, &quot;Barge In manhwa&quot; 등으로 검색됩니다.
                  </p>
                </div>

                {/* 삭제된 키워드 히스토리 */}
                {showHistory && keywordHistory.length > 0 && (
                  <div className="pt-4 border-t border-gray-100">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      삭제된 키워드 히스토리
                    </label>
                    <div className="space-y-1.5">
                      {keywordHistory.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm text-gray-500 font-mono line-through">
                              {item.suffix === '' ? '[작품명]' : `[작품명] ${item.suffix}`}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {formatKST(item.deleted_at)} 삭제
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRestoreKeyword(item)}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition"
                              title="복원"
                            >
                              <ArrowPathIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handlePermanentDeleteKeyword(item)}
                              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition"
                              title="영구 삭제"
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 계정 관리 탭 */}
      {activeTab === 'users' && (
        <div>
          <div className="mb-6 flex items-center justify-between">
            <p className="text-sm text-gray-600">총 {users.length}명의 사용자</p>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <PlusIcon className="w-4 h-4" />
              새 계정 추가
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {isLoadingUsers ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <p>로딩 중...</p>
              </div>
            ) : users.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <p>등록된 사용자가 없습니다</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">아이디</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">역할</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">상태</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">생성일</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-800">{user.username}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {user.role === 'admin' ? 'Admin' : 'User'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(user)}
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {user.is_active ? '활성' : '비활성'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-gray-600">{formatDate(user.created_at)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(user)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                              title="수정"
                            >
                              <PencilIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="삭제"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 사용자 생성/수정 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingUser ? '계정 수정' : '새 계정 추가'}
              </h3>
              <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded">
                <XMarkIcon className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">아이디</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  disabled={!!editingUser}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  placeholder="아이디 입력"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  비밀번호 {editingUser && '(변경 시에만 입력)'}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={editingUser ? '변경할 비밀번호 입력' : '비밀번호 입력'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'user' })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {isSubmitting ? '저장 중...' : (editingUser ? '수정' : '생성')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
