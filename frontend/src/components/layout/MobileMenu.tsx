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
  XMarkIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  { name: '작품별 신고/차단 통계', href: '/stats', icon: ChartPieIcon },
  { name: '도메인별 신고/차단 통계', href: '/stats/domain', icon: GlobeAltIcon },
  { name: '월간 불법 도메인 분석', href: '/domain-analysis', icon: MagnifyingGlassIcon },
  { name: '사이트 목록', href: '/sites', icon: GlobeAltIcon, adminOnly: true },
];

const adminMenuItems: MenuItem[] = [
  { name: '계정 관리', href: '/users', icon: UsersIcon, adminOnly: true },
];

export default function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();

  const handleLogout = async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      await logout();
      onClose();
    }
  };

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  const renderMenuItem = (item: MenuItem) => {
    if (item.adminOnly && !isAdmin) {
      return null;
    }

    const active = isActive(item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={`
          flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors
          ${active
            ? 'bg-blue-50 text-blue-600'
            : 'text-gray-700 hover:bg-gray-100'
          }
        `}
      >
        <Icon className="w-5 h-5" />
        <span>{item.name}</span>
      </Link>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 오버레이 */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
        onClick={onClose}
      />

      {/* 메뉴 패널 */}
      <div className="fixed inset-y-0 left-0 w-72 bg-white z-50 md:hidden overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <span className="text-xl font-bold text-[#1E9EF4]">RIDI</span>
            <span className="text-lg font-bold text-gray-800 ml-2">Jobdori</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <XMarkIcon className="w-6 h-6 text-gray-600" />
          </button>
        </div>

        {/* 메뉴 */}
        <nav className="p-4 space-y-1">
          {mainMenuItems.map(renderMenuItem)}

          {isAdmin && (
            <>
              <div className="my-4 border-t border-gray-200" />
              {adminMenuItems.map(renderMenuItem)}
            </>
          )}
        </nav>

        {/* 하단 사용자 정보 */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-gray-200 p-4 bg-white">
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
      </div>
    </>
  );
}
