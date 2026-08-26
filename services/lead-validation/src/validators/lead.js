import { validateEmail } from './email.js';
import { validatePhone } from './phone.js';
import { validateRequired } from './required.js';
import { computeScore } from '../lib/score.js';

/**
 * @param {Record<string, unknown>} lead
 * @param {{ checkMx?: boolean, defaultRegion?: string }} [options]
 */
export async function validateLead(lead, options = {}) {
  const required = validateRequired(lead);
  const email = await validateEmail(lead.email, { checkMx: Boolean(options.checkMx) });
  const phone = validatePhone(lead.phone, { defaultRegion: options.defaultRegion || 'US' });

  const checks = {
    email: {
      valid: email.valid,
      reasons: email.reasons,
      ...(email.domain ? { domain: email.domain } : {}),
      ...(email.disposable ? { disposable: true } : {}),
      ...(email.mx !== null ? { mx: email.mx } : {}),
    },
    phone: {
      valid: phone.valid,
      reasons: phone.reasons,
      ...(phone.e164 ? { e164: phone.e164 } : {}),
      ...(phone.skipped ? { skipped: true } : {}),
    },
    required,
  };

  const { status, score } = computeScore({
    email: {
      valid: email.valid,
      reasons: email.reasons,
      disposable: email.disposable,
    },
    phone,
    required,
  });

  return {
    ok: true,
    status,
    score,
    checks,
  };
}
