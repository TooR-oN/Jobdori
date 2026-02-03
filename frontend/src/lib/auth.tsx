'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi } from './api';

// 사용자 타입
export interface User {
  username: string;
  role: 'admin' | 'user';
}

// Auth 컨텍스트 타입
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Auth Provider
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 인증 상태 확인
  const refreshAuth = async () => {
    try {
      const data = await authApi.status();
      if (data.authenticated && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 로그인
  const login = async (username: string, password: string) => {
    try {
      const data = await authApi.login(username, password);
      if (data.success && data.user) {
        setUser(data.user);
        return { success: true };
      }
      return { success: false, error: data.error || '로그인에 실패했습니다.' };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || '로그인 중 오류가 발생했습니다.' };
    }
  };

  // 로그아웃
  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  };

  // 초기 로드 시 인증 상태 확인
  useEffect(() => {
    refreshAuth();
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    login,
    logout,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// useAuth 훅
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
