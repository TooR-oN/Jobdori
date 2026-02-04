'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';
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
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

// 커스텀 꺾은선 그래프 아이콘
const LineChartIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4-4 4 4 6-6 4 4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 20V4" />
  </svg>
);

interface MenuItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  children?: MenuItem[];
}

const mainMenuItems: MenuItem[] = [
  { name: '대시보드', href: '/', icon: ChartBarIcon },
  { name: '모니터링 작품 관리', href: '/titles', icon: BookOpenIcon },
  { name: '승인 대기', href: '/pending', icon: ClockIcon, adminOnly: true },
  { name: '모니터링 회차', href: '/sessions', icon: ListBulletIcon },
  { name: '신고결과 추적', href: '/report-tracking', icon: DocumentTextIcon },
  { 
    name: '작품별 통계', 
    href: '/stats', 
    icon: ChartPieIcon,
    children: [
      { name: '신고/차단 통계', href: '/stats', icon: ChartPieIcon },
      { name: 'Manta 순위 변화', href: '/stats/manta-rankings', icon: LineChartIcon },
    ]
  },
  { name: '사이트 목록', href: '/sites', icon: GlobeAltIcon, adminOnly: true },
];

const adminMenuItems: MenuItem[] = [
  { name: '계정 관리', href: '/users', icon: UsersIcon, adminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['/stats']);

  const handleLogout = async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
      await logout();
    }
  };

  const toggleExpand = (href: string) => {
    setExpandedMenus(prev => 
      prev.includes(href) 
        ? prev.filter(h => h !== href)
        : [...prev, href]
    );
  };

  // 자식 메뉴 아이템의 활성 상태 체크 (정확한 매칭 우선)
  const isChildActive = (href: string, parentHref?: string) => {
    // 정확한 매칭
    if (pathname === href) return true;
    
    // 부모와 같은 href인 경우 (예: /stats) 정확한 매칭만
    if (parentHref && href === parentHref) {
      return pathname === href;
    }
    
    // 그 외의 경우 prefix 매칭 (예: /stats/manta-rankings)
    return pathname.startsWith(href + '/');
  };

  // 일반 메뉴 아이템의 활성 상태 체크
  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname === href || pathname.startsWith(href + '/');
  };

  // 부모 메뉴가 활성화되었는지 (자식 중 하나라도 활성화되면)
  const isParentActive = (item: MenuItem) => {
    if (item.children) {
      return item.children.some(child => isChildActive(child.href, item.href));
    }
    return isActive(item.href);
  };

  const renderMenuItem = (item: MenuItem, isChild = false, parentHref?: string) => {
    // admin 전용 메뉴는 admin 역할만 볼 수 있음
    if (item.adminOnly && !isAdmin) {
      return null;
    }

    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedMenus.includes(item.href);
    const active = hasChildren 
      ? isParentActive(item) 
      : (isChild ? isChildActive(item.href, parentHref) : isActive(item.href));
    const Icon = item.icon;

    if (hasChildren) {
      return (
        <div key={item.href}>
          <button
            onClick={() => toggleExpand(item.href)}
            className={`
              flex items-center justify-between w-full px-4 py-3 text-sm font-medium rounded-lg mx-2 transition-colors
              ${active
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-700 hover:bg-gray-100'
              }
            `}
            style={{ width: 'calc(100% - 16px)' }}
          >
            <div className="flex items-center gap-3">
              <Icon className="w-5 h-5" />
              <span>{item.name}</span>
            </div>
            {isExpanded ? (
              <ChevronDownIcon className="w-4 h-4" />
            ) : (
              <ChevronRightIcon className="w-4 h-4" />
            )}
          </button>
          {isExpanded && (
            <div className="ml-4 mt-1 space-y-1">
              {item.children?.map(child => renderMenuItem(child, true, item.href))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`
          flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg mx-2 transition-colors
          ${isChild ? 'py-2 text-xs' : ''}
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
        <p className="text-xs text-gray-500 mt-0.5">리디 저작권 침해 모니터링</p>
      </div>

      {/* 메인 메뉴 */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <div className="space-y-1">
          {mainMenuItems.map(item => renderMenuItem(item))}
        </div>

        {/* 구분선 */}
        {isAdmin && (
          <>
            <div className="my-4 mx-4 border-t border-gray-200" />
            <div className="space-y-1">
              {adminMenuItems.map(item => renderMenuItem(item))}
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
