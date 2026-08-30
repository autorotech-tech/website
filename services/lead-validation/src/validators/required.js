/**
 * @param {Record<string, unknown>} lead
 */
export function validateRequired(lead) {
  const missing = [];
  const email = typeof lead.email === 'string' ? lead.email.trim() : '';

  if (!email) {
    missing.push('email');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
