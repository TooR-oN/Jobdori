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
    const res = await api.post('/api/auth/login', { username, password });
    return res.data;
  },
  
  logout: async () => {
    const res = await api.post('/api/auth/logout');
    return res.data;
  },
  
  status: async () => {
    const res = await api.get('/api/auth/status');
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
// Report Tracking API
// ============================================

export const reportTrackingApi = {
  getSessions: async () => {
    const res = await api.get('/api/report-tracking/sessions');
    return res.data;
  },
  
  getBySession: async (sessionId: string) => {
    const res = await api.get(`/api/report-tracking/${sessionId}`);
    return res.data;
  },
  
  updateStatus: async (id: number, status: string) => {
    const res = await api.put(`/api/report-tracking/${id}/status`, { status });
    return res.data;
  },
};

export default api;
