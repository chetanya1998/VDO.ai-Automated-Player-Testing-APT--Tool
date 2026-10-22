import { request } from './client.js';

export const getSettings = () => request('/api/settings');

export const getHealth = () => request('/api/health');

export async function getReadiness() {
  const response = await fetch('/api/ready', { signal: AbortSignal.timeout(20000) });
  if (response.status !== 200 && response.status !== 503) throw new Error('Readiness check failed');
  const data = await response.json();
  if (typeof data.ready !== 'boolean') throw new Error('Backend returned an invalid readiness response');
  return data;
}
