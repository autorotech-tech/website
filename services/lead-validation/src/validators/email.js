/** Common disposable / throwaway email domains (local blocklist for MVP). */
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'sharklasers.com',
  'discard.email',
  'mailnesia.com',
  'maildrop.cc',
  'throwaway.email',
  'fakeinbox.com',
]);

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * @param {unknown} email
 * @param {{ checkMx?: boolean }} [options]
 */
export async function validateEmail(email, options = {}) {
  const reasons = [];
  const value = typeof email === 'string' ? email.trim() : '';

  if (!value) {
    return {
      valid: false,
      reasons: ['email_required'],
      disposable: false,
      mx: null,
      domain: null,
    };
  }

  if (value.length > 254 || !EMAIL_RE.test(value)) {
    return {
      valid: false,
      reasons: ['email_invalid_syntax'],
      disposable: false,
      mx: null,
      domain: null,
    };
  }

  const domain = value.split('@')[1]?.toLowerCase() ?? null;
  const disposable = Boolean(domain && DISPOSABLE_DOMAINS.has(domain));
  if (disposable) {
    reasons.push('email_disposable_domain');
  }

  let mx = null;
  if (options.checkMx && domain) {
    try {
      const { resolveMx } = await import('node:dns/promises');
      const records = await resolveMx(domain);
      mx = Array.isArray(records) && records.length > 0;
      if (!mx) {
        reasons.push('email_mx_missing');
      }
    } catch {
      mx = false;
      reasons.push('email_mx_lookup_failed');
    }
  }

  const hardInvalid = reasons.some((r) =>
    r === 'email_required' || r === 'email_invalid_syntax',
  );

  return {
    valid: !hardInvalid,
    reasons,
    disposable,
    mx,
    domain,
  };
}
