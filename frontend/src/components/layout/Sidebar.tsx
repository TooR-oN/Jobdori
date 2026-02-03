'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  ChartBarIcon,
  BookOpenIcon,
  ClockIcon,
  ListBulletIcon,
  DocumentTextIcon,
  ChartPieIcon,
  GlobeAltIcon,
  UsersIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';

interface MenuItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const mainMenuItems: MenuItem[] = [
  { name: '대시보드', href: '/', icon: ChartBarIcon },
  { name: '모니터링 작품', href: '/titles', icon: BookOpenIcon },
  { name: '승인 대기', href: '/pending', icon: ClockIcon, adminOnly: true },
  { name: '모니터링 회차', href: '/sessions', icon: ListBulletIcon },
  { name: '신고결과 추적', href: '/report-tracking', icon: DocumentTextIcon },
  { name: '작품별 통계', href: '/stats', icon: ChartPieIcon },
  { name: '사이트 목록', href: '/sites', icon: GlobeAltIcon, adminOnly: true },
];

const adminMenuItems: MenuItem[] = [
  { name: '계정 관리', href: '/users', icon: UsersIcon, adminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();

  const handleLogout = async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      await logout();
    }
  };

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  const renderMenuItem = (item: MenuItem) => {
    // admin 전용 메뉴는 admin 역할만 볼 수 있음
    if (item.adminOnly && !isAdmin) {
      return null;
    }

    const active = isActive(item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`
          flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg mx-2 transition-colors
          ${active
            ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600 -ml-0 pl-3'
            : 'text-gray-700 hover:bg-gray-100'
          }
        `}
      >
        <Icon className="w-5 h-5" />
        <span>{item.name}</span>
      </Link>
    );
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0">
      {/* 로고 영역 */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-[#1E9EF4]">RIDI</span>
        </div>
        <h1 className="text-xl font-bold text-gray-800 mt-1">Jobdori</h1>
        <p className="text-xs text-gray-500 mt-0.5">저작권 침해 모니터링</p>
      </div>

      {/* 메인 메뉴 */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <div className="space-y-1">
          {mainMenuItems.map(renderMenuItem)}
        </div>

        {/* 구분선 */}
        {isAdmin && (
          <>
            <div className="my-4 mx-4 border-t border-gray-200" />
            <div className="space-y-1">
              {adminMenuItems.map(renderMenuItem)}
            </div>
          </>
        )}
      </nav>

      {/* 하단 사용자 정보 */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-blue-600 font-medium text-sm">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">{user?.username || 'User'}</p>
            <p className="text-xs text-gray-500 capitalize">
              {user?.role === 'admin' ? 'Admin' : 'User'}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowRightOnRectangleIcon className="w-5 h-5" />
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  );
}
