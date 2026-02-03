'use client';

import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import { usersApi } from '@/lib/api';
import { PlusIcon, PencilIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  // 폼 데이터
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'user' as 'admin' | 'user',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 데이터 로드
  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await usersApi.getList();
      if (res.success) {
        setUsers(res.users || []);
      } else {
        setError('사용자 목록을 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to load users:', err);
      setError('사용자 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // 모달 열기 (생성)
  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'user' });
    setIsModalOpen(true);
  };

  // 모달 열기 (수정)
  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role });
    setIsModalOpen(true);
  };

  // 모달 닫기
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setFormData({ username: '', password: '', role: 'user' });
  };

  // 사용자 생성/수정
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
        // 수정
        const updateData: any = { role: formData.role };
        if (formData.password) {
          updateData.password = formData.password;
        }
        
        const res = await usersApi.update(editingUser.id, updateData);
        if (res.success) {
          setSuccessMessage('사용자 정보가 수정되었습니다.');
          closeModal();
          loadUsers();
        } else {
          setError(res.error || '수정에 실패했습니다.');
        }
      } else {
        // 생성
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
      console.error('Failed to save user:', err);
      setError(err.response?.data?.error || '저장에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 사용자 삭제
  const handleDelete = async (user: User) => {
    if (!confirm(`"${user.username}" 계정을 삭제하시겠습니까?`)) {
      return;
    }
    
    try {
      const res = await usersApi.delete(user.id);
      if (res.success) {
        setSuccessMessage('계정이 삭제되었습니다.');
        loadUsers();
      } else {
        setError(res.error || '삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError('삭제에 실패했습니다.');
    }
  };

  // 활성화/비활성화 토글
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
      console.error('Failed to toggle user:', err);
      setError('상태 변경에 실패했습니다.');
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

  // 메시지 자동 숨김
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  return (
    <MainLayout pageTitle="계정 관리" requireAdmin>
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

      {/* 액션 바 */}
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

      {/* 사용자 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
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

      {/* 모달 */}
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
