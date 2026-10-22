import { Router } from 'express';
import * as historyController from '../controllers/history.controller.js';

const router = Router();

router.get('/', historyController.listRuns);
router.get('/:runId', historyController.getRun);
router.get('/:runId/pdf', historyController.downloadRunPdf);
router.delete('/', historyController.clearRuns);
router.delete('/:runId', historyController.deleteRun);

export default router;
