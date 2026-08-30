/**
 * @param {{
 *   email: { valid: boolean, reasons: string[], disposable?: boolean },
 *   phone: { valid: boolean, skipped?: boolean, reasons: string[] },
 *   required: { valid: boolean, missing: string[] },
 * }} checks
 * @returns {{ status: 'valid' | 'risky' | 'invalid', score: number }}
 */
export function computeScore(checks) {
  let score = 1;
  let hardFail = false;
  let risky = false;

  if (!checks.required.valid) {
    hardFail = true;
    score -= 0.5;
  }

  if (!checks.email.valid) {
    hardFail = true;
    score -= 0.45;
  } else {
    if (checks.email.reasons.includes('email_disposable_domain') || checks.email.disposable) {
      risky = true;
      score -= 0.25;
    }
    if (
      checks.email.reasons.includes('email_mx_missing') ||
      checks.email.reasons.includes('email_mx_lookup_failed')
    ) {
      risky = true;
      score -= 0.2;
    }
  }

  if (!checks.phone.valid) {
    hardFail = true;
    score -= 0.3;
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));

  if (hardFail) {
    return { status: 'invalid', score };
  }
  if (risky) {
    return { status: 'risky', score };
  }
  return { status: 'valid', score };
}
