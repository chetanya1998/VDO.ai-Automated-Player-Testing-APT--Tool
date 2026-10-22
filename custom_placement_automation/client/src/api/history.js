import { request } from './client.js';

export const listRuns = ({ page = 1, pageSize = 20, q = '', status = '', type = '' } = {}) => {
  const params = new URLSearchParams({ page, pageSize });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  return request(`/api/history?${params}`);
};

export const getRun = (runId) => request(`/api/history/${encodeURIComponent(runId)}`);

export const deleteRun = (runId) => request(`/api/history/${encodeURIComponent(runId)}`, { method: 'DELETE' });

export const clearHistory = () => request('/api/history', { method: 'DELETE' });

export const runPdfUrl = (runId) => `/api/history/${encodeURIComponent(runId)}/pdf`;
