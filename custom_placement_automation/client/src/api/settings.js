import { request } from './client.js';

export const getSettings = () => request('/api/settings');

export const getHealth = () => request('/api/health');
