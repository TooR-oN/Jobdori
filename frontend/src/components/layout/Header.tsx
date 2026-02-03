'use client';

interface HeaderProps {
  pageTitle: string;
}

export default function Header({ pageTitle }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6">
      {/* 페이지 제목만 표시 (검색창, 알림, 프로필 없음) */}
      <h1 className="text-xl font-bold text-gray-800">{pageTitle}</h1>
    </header>
  );
}
