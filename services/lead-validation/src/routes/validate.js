import { Router } from 'express';
import { z } from 'zod';
import { validateLead } from '../validators/lead.js';

const router = Router();

const leadSchema = z
  .object({
    email: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
  })
  .passthrough();

router.post('/v1/leads/validate', async (req, res, next) => {
  try {
    const parsed = leadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'invalid_body',
        message: 'Request body failed schema validation',
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await validateLead(parsed.data, {
      checkMx: String(process.env.CHECK_MX || 'false').toLowerCase() === 'true',
      defaultRegion: process.env.DEFAULT_PHONE_REGION || 'US',
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
