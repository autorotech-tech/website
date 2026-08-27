/**
 * Autoro Hunt platform registry (T1 hh + T2 job boards).
 * Loaded before content/page-extract.js — elevates host detection without rewriting extractors.
 */
(function (global) {
  const T2_BOARDS = [
    'remote.co',
    'getmatch.ru',
    'finder.work',
    'relocate.me',
    'cryptojobslist.com',
    'web3.career',
    'workingnomads.com',
    'aijobs.net',
    'simplyhired.com',
    'jobgether.com',
    'flexjobs.com',
    'powertofly.com',
    'crossover.com',
    'justremote.co',
    'foorilla.com',
    'instahyre.com',
  ];

  const adapters = Object.create(null);

  function register(adapter) {
    if (!adapter || !adapter.id) throw new Error('adapter.id required');
    adapters[adapter.id] = adapter;
    return adapter;
  }

  function get(id) {
    return adapters[id] || null;
  }

  function list() {
    return Object.keys(adapters).map((k) => adapters[k]);
  }

  function detect(hostname) {
    let host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    for (const a of list()) {
      if (typeof a.matchHost === 'function' && a.matchHost(host)) return a;
    }
    return get('web') || null;
  }

  function hostKey(hostname) {
    const a = detect(hostname);
    if (a && typeof a.hostKey === 'function') return a.hostKey(hostname);
    return 'web';
  }

  function t2Boards() {
    return T2_BOARDS.slice();
  }

  function isKnownJobSite(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    if (detect(hostname)?.tier === 1) return true;
    return T2_BOARDS.some((d) => host === d || host.endsWith('.' + d));
  }

  global.__JR_PLATFORMS__ = {
    register,
    get,
    list,
    detect,
    hostKey,
    t2Boards,
    isKnownJobSite,
    T2_BOARDS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
