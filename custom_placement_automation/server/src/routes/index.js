import { Router } from 'express';
import placementCheckRoutes from './placementCheck.routes.js';
import historyRoutes from './history.routes.js';
import config from '../config/index.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));
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
