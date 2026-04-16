import { Router } from 'express';
import { authInternal } from '../middleware/authInternal.js';
import { validateJobPayload } from '../middleware/validateJobPayload.js';
import { enqueueJob, healthCheck } from '../controllers/jobs.controller.js';

const router = Router();

// Healthcheck (sem autenticação)
router.get('/health', healthCheck);

// Enfileirar job (com autenticação e validação)
router.post('/jobs/enqueue', authInternal, validateJobPayload, enqueueJob);

export default router;
