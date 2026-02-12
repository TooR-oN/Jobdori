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
    // 백엔드에 username과 password 모두 전송
    const res = await api.post('/api/auth/login', { username, password });
    if (res.data.success) {
      // 백엔드에서 반환된 사용자 정보 사용
      const user = res.data.user || { username, role: 'user' };
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
  
  getResults: async (id: string, page: number = 1, title?: string, status?: string) => {
    const params: { page: number; title?: string; status?: string } = { page };
    if (title && title !== 'all') params.title = title;
    if (status && status !== 'all') params.status = status;
    const res = await api.get(`/api/sessions/${id}/results`, { params });
    return res.data;
  },
  
  // 필터 조건에 맞는 모든 URL 가져오기 (복사용)
  getAllUrls: async (id: string, title?: string, status?: string) => {
    const params: { limit: number; title?: string; status?: string } = { limit: 10000 };
    if (title && title !== 'all') params.title = title;
    if (status && status !== 'all') params.status = status;
    const res = await api.get(`/api/sessions/${id}/results`, { params });
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
  
  // NOTE: AI 일괄 검토 기능 삭제됨 - Manus API 연동으로 대체 예정
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
  byDomain: async (startDate?: string, endDate?: string) => {
    const res = await api.get('/api/stats/by-domain', { params: { start_date: startDate, end_date: endDate } });
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
  
  // 작품별 순위 히스토리 조회
  getRankingHistory: async (title: string) => {
    const res = await api.get(`/api/titles/${encodeURIComponent(title)}/ranking-history`);
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
  
  updateReason: async (id: number, reason: string) => {
    const res = await api.put(`/api/report-tracking/${id}/reason`, { reason });
    return res.data;
  },
  
  updateReportId: async (id: number, reportId: string) => {
    const res = await api.put(`/api/report-tracking/${id}/report-id`, { report_id: reportId });
    return res.data;
  },
  
  // URL 수동 추가
  addUrl: async (sessionId: string, url: string, title: string) => {
    const res = await api.post(`/api/report-tracking/${sessionId}/add-url`, { url, title });
    return res.data;
  },
  
  // HTML 파일 업로드 (신고 결과 매칭) - reportId는 선택 사항 (없으면 HTML에서 자동 추출)
  uploadHtml: async (sessionId: string, htmlContent: string, reportId?: string, fileName?: string) => {
    const res = await api.post(`/api/report-tracking/${sessionId}/upload`, {
      html_content: htmlContent,
      report_id: reportId || undefined,
      file_name: fileName,
    });
    return res.data;
  },
  
  // 업로드 이력 조회
  getUploads: async (sessionId: string) => {
    const res = await api.get(`/api/report-tracking/${sessionId}/uploads`);
    return res.data;
  },
  
  // URL 목록 내보내기
  getUrls: async (sessionId: string, status?: string) => {
    const res = await api.get(`/api/report-tracking/${sessionId}/urls`, { params: { status } });
    return res.data;
  },
};

// ============================================
// Deep Monitoring API (사이트 집중 모니터링)
// ============================================

export const deepMonitoringApi = {
  // 대상 검색 (scan)
  scan: async (sessionId: string) => {
    const res = await api.post(`/api/sessions/${sessionId}/deep-monitoring/scan`);
    return res.data;
  },

  // 대상 1건 실행 (순차 호출용)
  executeTarget: async (sessionId: string, targetId: number) => {
    const res = await api.post(`/api/sessions/${sessionId}/deep-monitoring/execute-target/${targetId}`);
    return res.data;
  },

  // 전체 완료 후처리 (세션 통계 갱신)
  finalize: async (sessionId: string) => {
    const res = await api.post(`/api/sessions/${sessionId}/deep-monitoring/finalize`);
    return res.data;
  },

  // 대상 목록 조회
  getTargets: async (sessionId: string) => {
    const res = await api.get(`/api/sessions/${sessionId}/deep-monitoring/targets`);
    return res.data;
  },

  // 실행 상태 조회 (폴링용)
  getStatus: async (sessionId: string) => {
    const res = await api.get(`/api/sessions/${sessionId}/deep-monitoring/status`);
    return res.data;
  },
};

export const dmcaReportApi = {
  generate: async (sessionId: string) => {
    const res = await api.post(`/api/sessions/${sessionId}/dmca-report/generate`);
    return res.data;
  },
};

// ============================================
// Domain Analysis API (월간 불법 도메인 분석)
// ============================================

export const domainAnalysisApi = {
  // 분석 실행
  run: async (month?: string) => {
    const res = await api.post('/api/domain-analysis/run', { month });
    return res.data;
  },

  // 상태 조회 (폴링용)
  getStatus: async (month: string) => {
    const res = await api.get(`/api/domain-analysis/status/${month}`);
    return res.data;
  },

  // 결과 처리 (Manus 완료 후)
  processResult: async (month: string) => {
    const res = await api.post('/api/domain-analysis/process-result', { month });
    return res.data;
  },

  // 월 목록 조회
  getMonths: async () => {
    const res = await api.get('/api/domain-analysis/months');
    return res.data;
  },

  // 분석 결과 조회
  getResult: async (month: string) => {
    const res = await api.get(`/api/domain-analysis/${month}`);
    return res.data;
  },

  // 재실행
  rerun: async (month: string) => {
    const res = await api.post('/api/domain-analysis/rerun', { month });
    return res.data;
  },
};

export default api;
