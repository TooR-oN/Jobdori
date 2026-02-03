import axios from 'axios';

// API 클라이언트 생성
const api = axios.create({
  baseURL: '', // Next.js rewrites를 통해 프록시
  withCredentials: true, // 쿠키 포함
  headers: {
    'Content-Type': 'application/json',
  },
});

// 응답 인터셉터 (에러 처리)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 인증 실패 시 로그인 페이지로
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ============================================
// Auth API
// ============================================

export const authApi = {
  login: async (username: string, password: string) => {
    // 임시: 백엔드는 password만 확인, username은 프론트에서 처리
    const res = await api.post('/api/auth/login', { password });
    if (res.data.success) {
      // 임시 사용자 정보 (백엔드 사용자 관리 구현 전까지)
      const role = username === 'admin' ? 'admin' : 'user';
      const user = { username, role };
      // 로컬스토리지에 저장 (페이지 새로고침 시 복원용)
      if (typeof window !== 'undefined') {
        localStorage.setItem('jobdori_user', JSON.stringify(user));
      }
      return { success: true, user };
    }
    return res.data;
  },
  
  logout: async () => {
    const res = await api.post('/api/auth/logout');
    // 임시: 로컬스토리지 정리
    if (typeof window !== 'undefined') {
      localStorage.removeItem('jobdori_user');
    }
    return res.data;
  },
  
  status: async () => {
    const res = await api.get('/api/auth/status');
    if (res.data.authenticated) {
      // 임시: 로컬스토리지에서 사용자 정보 복원
      const savedUser = typeof window !== 'undefined' 
        ? localStorage.getItem('jobdori_user') 
        : null;
      if (savedUser) {
        return { authenticated: true, user: JSON.parse(savedUser) };
      }
      // 기본값: admin으로 처리 (테스트용)
      return { authenticated: true, user: { username: 'admin', role: 'admin' } };
    }
    return res.data;
  },
};

// ============================================
// Dashboard API
// ============================================

export const dashboardApi = {
  getMonths: async () => {
    const res = await api.get('/api/dashboard/months');
    return res.data;
  },
  
  getData: async (month?: string) => {
    const res = await api.get('/api/dashboard', { params: { month } });
    return res.data;
  },
};

// ============================================
// Sessions API
// ============================================

export const sessionsApi = {
  getList: async () => {
    const res = await api.get('/api/sessions');
    return res.data;
  },
  
  getById: async (id: string) => {
    const res = await api.get(`/api/sessions/${id}`);
    return res.data;
  },
  
  getResults: async (id: string, page: number = 1) => {
    const res = await api.get(`/api/sessions/${id}/results`, { params: { page } });
    return res.data;
  },
};

// ============================================
// Pending Reviews API (Admin only)
// ============================================

export const pendingApi = {
  getList: async () => {
    const res = await api.get('/api/pending');
    return res.data;
  },
  
  review: async (id: number, action: 'approve' | 'reject') => {
    const res = await api.post('/api/review', { id, action });
    return res.data;
  },
  
  bulkReview: async (ids: number[], action: 'approve' | 'reject') => {
    const res = await api.post('/api/review/bulk', { ids, action });
    return res.data;
  },
  
  aiReview: async () => {
    const res = await api.post('/api/pending/ai-review');
    return res.data;
  },
};

// ============================================
// Sites API (Admin only)
// ============================================

export const sitesApi = {
  getByType: async (type: 'illegal' | 'legal') => {
    const res = await api.get(`/api/sites/${type}`);
    return res.data;
  },
  
  add: async (domain: string, type: 'illegal' | 'legal') => {
    const res = await api.post(`/api/sites/${type}`, { domain });
    return res.data;
  },
  
  remove: async (domain: string, type: 'illegal' | 'legal') => {
    const res = await api.delete(`/api/sites/${type}/${encodeURIComponent(domain)}`);
    return res.data;
  },
};

// ============================================
// Titles API
// ============================================

export const titlesApi = {
  getList: async () => {
    const res = await api.get('/api/titles');
    return res.data;
  },
  
  add: async (title: string, mantaUrl?: string) => {
    const res = await api.post('/api/titles', { title, manta_url: mantaUrl });
    return res.data;
  },
  
  remove: async (title: string) => {
    const res = await api.delete(`/api/titles/${encodeURIComponent(title)}`);
    return res.data;
  },
  
  restore: async (title: string) => {
    const res = await api.post('/api/titles/restore', { title });
    return res.data;
  },
  
  updateUnofficial: async (title: string, unofficialTitles: string[]) => {
    const res = await api.put(`/api/titles/${encodeURIComponent(title)}/unofficial`, {
      unofficial_titles: unofficialTitles,
    });
    return res.data;
  },
};

// ============================================
// Users API (Admin only)
// ============================================

export const usersApi = {
  getList: async () => {
    const res = await api.get('/api/users');
    return res.data;
  },
  
  create: async (username: string, password: string, role: 'admin' | 'user') => {
    const res = await api.post('/api/users', { username, password, role });
    return res.data;
  },
  
  update: async (id: number, data: { role?: string; is_active?: boolean; password?: string }) => {
    const res = await api.put(`/api/users/${id}`, data);
    return res.data;
  },
  
  delete: async (id: number) => {
    const res = await api.delete(`/api/users/${id}`);
    return res.data;
  },
};

// ============================================
// Stats API
// ============================================

export const statsApi = {
  byTitle: async (startDate?: string, endDate?: string) => {
    const res = await api.get('/api/stats/by-title', { params: { start_date: startDate, end_date: endDate } });
    return res.data;
  },
};

// ============================================
// Manta Rankings API
// ============================================

export const mantaRankingsApi = {
  getAll: async () => {
    const res = await api.get('/api/manta-rankings');
    return res.data;
  },
};

// ============================================
// Excluded URLs API (Admin only)
// ============================================

export const excludedUrlsApi = {
  getList: async () => {
    const res = await api.get('/api/excluded-urls');
    return res.data;
  },
  
  add: async (url: string) => {
    const res = await api.post('/api/excluded-urls', { url });
    return res.data;
  },
  
  remove: async (id: number) => {
    const res = await api.delete(`/api/excluded-urls/${id}`);
    return res.data;
  },
};

// ============================================
// Report Tracking API
// ============================================

export const reportTrackingApi = {
  getSessions: async () => {
    const res = await api.get('/api/report-tracking/sessions');
    return res.data;
  },
  
  getBySession: async (sessionId: string, params?: { status?: string; page?: number; limit?: number; search?: string }) => {
    const res = await api.get(`/api/report-tracking/${sessionId}`, { params });
    return res.data;
  },
  
  getStats: async (sessionId: string) => {
    const res = await api.get(`/api/report-tracking/${sessionId}/stats`);
    return res.data;
  },
  
  getReasons: async () => {
    const res = await api.get('/api/report-tracking/reasons');
    return res.data;
  },
  
  updateStatus: async (id: number, status: string) => {
    const res = await api.put(`/api/report-tracking/${id}/status`, { status });
    return res.data;
  },
  
  updateReason: async (id: number, reasonId: number | null) => {
    const res = await api.put(`/api/report-tracking/${id}/reason`, { reason_id: reasonId });
    return res.data;
  },
  
  updateReportId: async (id: number, reportId: string) => {
    const res = await api.put(`/api/report-tracking/${id}/report-id`, { report_id: reportId });
    return res.data;
  },
};

export default api;
