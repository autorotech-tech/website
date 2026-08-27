/**
 * HeadHunter T1 adapter — wraps host detection used by page-extract.js.
 */
(function (global) {
  const reg = global.__JR_PLATFORMS__;
  if (!reg) return;

  const HH_HOSTS = {
    ru: /(^|\.)hh\.ru$/i,
    kz: /(^|\.)hh\.kz$/i,
    uz: /(^|\.)hh\.uz$/i,
  };

  reg.register({
    id: 'hh',
    tier: 1,
    label: 'HeadHunter',
    supportsListBatch: true,
    domains: ['hh.ru', 'hh.kz', 'hh.uz'],
    selectors: {
      letter: '[data-qa="vacancy-response-popup-form-letter-input"]',
      formField: '[data-qa="vacancy-response-popup-form-field"]',
    },
    matchHost(host) {
      const h = String(host || '').toLowerCase();
      return Object.values(HH_HOSTS).some((re) => re.test(h));
    },
    hostKey(hostname) {
      const host = String(hostname || '').toLowerCase();
      for (const [key, pattern] of Object.entries(HH_HOSTS)) {
        if (pattern.test(host)) return key;
      }
      return 'web';
    },
  });

  reg.register({
    id: 'web',
    tier: 2,
    label: 'Generic job board / web',
    supportsListBatch: true,
    domains: reg.T2_BOARDS || [],
    matchHost() {
      return true; // fallback last
    },
    hostKey() {
      return 'web';
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
