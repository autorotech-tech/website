import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * @param {unknown} phone
 * @param {{ defaultRegion?: string }} [options]
 */
export function validatePhone(phone, options = {}) {
  const raw = typeof phone === 'string' ? phone.trim() : '';

  if (!raw) {
    return {
      valid: true,
      skipped: true,
      e164: null,
      reasons: [],
    };
  }

  const defaultRegion = options.defaultRegion || 'US';
  const parsed = parsePhoneNumberFromString(raw, defaultRegion);

  if (!parsed || !parsed.isValid()) {
    return {
      valid: false,
      skipped: false,
      e164: null,
      reasons: ['phone_invalid'],
    };
  }

  return {
    valid: true,
    skipped: false,
    e164: parsed.format('E.164'),
    reasons: [],
  };
}
