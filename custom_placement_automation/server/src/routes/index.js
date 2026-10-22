import { Router } from 'express';
import placementCheckRoutes from './placementCheck.routes.js';
import historyRoutes from './history.routes.js';
import config from '../config/index.js';
import { getDatabase } from '../services/database.service.js';
import { queueState } from '../services/jobQueue.service.js';
import { chromiumInstalled } from '../services/browser.service.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));
router.get('/ready', async (_req, res) => {
  const database = await getDatabase().ping();
  const queue = queueState();
  const browserInstalled = chromiumInstalled();
  res.status(database && browserInstalled && !queue.stopping ? 200 : 503).json({ database, browserInstalled, queue });
});
router.get('/settings', (_req, res) =>
  res.json({
    urlTimeoutMs: config.placement.urlTimeoutMs,
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
