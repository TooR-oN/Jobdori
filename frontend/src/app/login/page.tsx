'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { LockClosedIcon, UserIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { user, isLoading, login } = useAuth();
  const router = useRouter();

  // 이미 로그인된 경우 홈으로 리다이렉트
  useEffect(() => {
    if (!isLoading && user) {
      router.push('/');
    }
  }, [user, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const result = await login(username, password);
    
    if (result.success) {
      router.push('/');
    } else {
      setError(result.error || '로그인에 실패했습니다.');
    }
    
    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900">
        <div className="text-center text-white">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* 좌측 패널 - 브랜딩 영역 (60%) */}
      <div className="hidden lg:flex lg:w-[60%] relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900 overflow-hidden">
        {/* 그리드 패턴 오버레이 */}
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}
        />
        
        {/* 하단 그라데이션 박스 */}
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-blue-800/50 to-transparent rounded-t-[3rem]" />
        
        {/* 중앙 콘텐츠 */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full px-12">
          {/* 자물쇠 아이콘 */}
          <div className="w-20 h-20 bg-blue-500/30 rounded-2xl flex items-center justify-center mb-8 backdrop-blur-sm border border-blue-400/30">
            <LockClosedIcon className="w-10 h-10 text-blue-200" />
          </div>
          
          {/* 메인 타이틀 */}
          <h1 className="text-4xl md:text-5xl font-bold text-white text-center leading-tight">
            Protecting Creative
          </h1>
          
          {/* 서브 타이틀 */}
          <p className="text-blue-200 text-center mt-6 max-w-md text-lg">
            리디 저작권 침해 모니터링 시스템
          </p>
          
          {/* 하단 차트 아이콘 데코레이션 */}
          <div className="absolute bottom-20 opacity-30">
            <svg className="w-32 h-32 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4-4 4 4 6-6 4 4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 20V4" />
            </svg>
          </div>
        </div>
      </div>

      {/* 우측 패널 - 로그인 폼 (40%) */}
      <div className="w-full lg:w-[40%] flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-md">
          {/* 로고 */}
          <div className="flex items-center gap-3 mb-8">
            {/* RIDI 로고 */}
            <svg width="60" height="28" viewBox="0 0 60 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <text x="0" y="22" fontFamily="Arial Black, sans-serif" fontSize="24" fontWeight="900" fill="#1E9EF4">RIDI</text>
            </svg>
            <span className="text-2xl font-bold text-gray-800">Jobdori</span>
          </div>
          
          {/* 환영 메시지 */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome back</h2>
            <p className="text-gray-500">Enter your credentials to access the dashboard</p>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}
          
          {/* 로그인 폼 */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 아이디 입력 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username or ID
              </label>
              <div className="relative">
                <UserIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="Enter your ID"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>
            
            {/* 비밀번호 입력 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <LockClosedIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="w-5 h-5" />
                  ) : (
                    <EyeIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
            
            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-3.5 px-4 rounded-xl transition flex items-center justify-center gap-2 mt-6"
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>로그인 중...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </>
              )}
            </button>
          </form>
          
          {/* 하단 안내 */}
          <p className="text-center text-sm text-gray-500 mt-8">
            도움이 필요하시면 법무팀에 문의해주세요
          </p>
        </div>
      </div>

      {/* 모바일에서는 그라데이션 배경만 표시 */}
      <style jsx>{`
        @media (max-width: 1023px) {
          .min-h-screen {
            background: linear-gradient(to bottom right, #2563eb, #1d4ed8, #312e81);
          }
        }
      `}</style>
    </div>
  );
}
