import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lead-validation',
    version: '0.1.0',
  });
});

export default router;
