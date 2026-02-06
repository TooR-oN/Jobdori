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
      <div className="min-h-screen flex items-center justify-center bg-[#136dec]">
        <div className="text-center text-white">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* 좌측 패널 - 브랜딩 영역 (70%) */}
      <div 
        className="hidden lg:flex lg:w-[70%] relative overflow-hidden flex-col justify-center items-center p-12 text-white"
        style={{
          backgroundColor: '#136dec',
          backgroundImage: `
            radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
            radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
            radial-gradient(at 100% 0%, hsla(263,93%,61%,1) 0, transparent 50%)
          `
        }}
      >
        {/* 격자 패턴 오버레이 */}
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        
        {/* 중앙 콘텐츠 */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center">
          {/* RIDI 로고 - SVG 직접 구현 (5배 확대, 박스 제거) */}
          <div className="mb-10">
            <svg width="500" height="160" viewBox="0 0 500 160" fill="none" xmlns="http://www.w3.org/2000/svg">
              <text x="250" y="120" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontSize="140" fontWeight="900" fill="white">RIDI</text>
            </svg>
          </div>
          
          {/* 메인 타이틀 */}
          <h1 className="text-4xl xl:text-5xl font-black leading-tight tracking-tight">
            Protecting RIDI&apos;s Creative
          </h1>
        </div>
      </div>

      {/* 우측 패널 - 로그인 폼 (30%) */}
      <div className="w-full lg:w-[30%] flex flex-col justify-center items-center p-6 sm:p-8 bg-white">
        <div className="w-full max-w-[360px]">
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
            <p className="text-gray-500 text-sm">Enter your credentials to access the dashboard</p>
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
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Username or ID
              </label>
              <div className="relative">
                <UserIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-gray-100 border-none rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition text-gray-900"
                  placeholder="Enter your ID"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>
            
            {/* 비밀번호 입력 */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <LockClosedIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3.5 bg-gray-100 border-none rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition text-gray-900"
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
              className="w-full bg-[#136dec] hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold py-4 px-4 rounded-xl transition shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 mt-2"
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
            background: #136dec;
          }
        }
      `}</style>
    </div>
  );
}
