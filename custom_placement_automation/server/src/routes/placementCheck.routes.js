import { Router } from 'express';
import * as placementCheckController from '../controllers/placementCheck.controller.js';

const router = Router();

router.post('/', placementCheckController.createPlacementCheck);
router.get('/:jobId', placementCheckController.getPlacementCheck);

export default router;
