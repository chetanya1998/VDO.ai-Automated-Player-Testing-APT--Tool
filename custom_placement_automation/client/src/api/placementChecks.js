import { request } from './client.js';

export const startPlacementCheck = ({ type, domain, tag, devices, urls, script, scriptId, scriptName, scroll, deep }) =>
  request('/api/placement-checks', {
    method: 'POST',
    body: { type, domain, tag, devices, urls, script, scriptId, scriptName, scroll, deep },
  });

export const getPlacementCheck = (jobId) => request(`/api/placement-checks/${encodeURIComponent(jobId)}`);
