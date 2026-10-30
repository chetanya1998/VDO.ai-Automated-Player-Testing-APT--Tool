import { request } from './client.js';

// Every option the form sets is sent; the server validates them.
export const startPlacementCheck = ({ type, domain, tag, devices, urls, script, scriptId, scriptName, scroll, deep, refreshIntervalSec, stickyCode, stickyAdditional }) =>
  request('/api/placement-checks', {
    method: 'POST',
    body: { type, domain, tag, devices, urls, script, scriptId, scriptName, scroll, deep, refreshIntervalSec, stickyCode, stickyAdditional },
  });

export const getPlacementCheck = (jobId) => request(`/api/placement-checks/${encodeURIComponent(jobId)}`);
