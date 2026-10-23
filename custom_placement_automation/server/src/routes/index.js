import { Router } from 'express';
import placementCheckRoutes from './placementCheck.routes.js';
import historyRoutes from './history.routes.js';
import config from '../config/index.js';
import { getDatabase } from '../services/database.service.js';
import { queueState } from '../services/jobQueue.service.js';
import { browserReadiness } from '../services/browser.service.js';
import { deepReadiness } from '../services/deepValidation.service.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));
router.get('/ready', async (_req, res) => {
  let database = false;
  try { database = await getDatabase().ping(); } catch { /* Report unavailable without claiming readiness. */ }
  const queue = queueState();
  const browser = await browserReadiness();
  const ready = database && browser.launchable && !queue.stopping;
  // Deep test availability is reported separately; standard checks do not depend on it.
  const deep = await deepReadiness();
  res.status(ready ? 200 : 503).json({ ready, database, browserInstalled: browser.installed, browser, queue, deep });
});
router.get('/settings', (_req, res) =>
  res.json({
    urlTimeoutMs: config.placement.urlTimeoutMs,
    deepUrlTimeoutMs: config.deep.urlTimeoutMs,
    scroll: {
      stepViewportRatio: config.placement.lazyScroll.stepViewportRatio,
      intervalMs: config.placement.lazyScroll.intervalMs,
      limits: config.placement.scrollLimits,
    },
  }),
);
router.use('/placement-checks', placementCheckRoutes);
router.use('/history', historyRoutes);

export default router;
