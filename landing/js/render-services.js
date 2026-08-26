(function () {
  'use strict';

  var ICONS = {
    chart: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>',
    message: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>',
    file: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
    share: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>',
    globe: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>',
    search: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>',
    link: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>',
    bookmark: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>',
    brain: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>',
  };

  var STATUS = {
    en: { live: 'Live', beta: 'Beta', planned: 'Planned' },
    ru: { live: 'В проде', beta: 'Бета', planned: 'В планах' },
  };

  var UI = {
    en: { more: 'Learn more →', loading: 'Loading services…', error: 'Could not load services.' },
    ru: { more: 'Подробнее →', loading: 'Загрузка сервисов…', error: 'Не удалось загрузить сервисы.' },
  };

  function lang() {
    var l = (document.documentElement.lang || 'en').slice(0, 2);
    return l === 'ru' ? 'ru' : 'en';
  }

  function t(obj) {
    var l = lang();
    return (obj && (obj[l] || obj.en)) || '';
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function iconSvg(name) {
    var path = ICONS[name] || ICONS.search;
    return (
      '<svg class="w-12 h-12 text-[#00F5D4] mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">' +
      path +
      '</svg>'
    );
  }

  function statusClass(status) {
    if (status === 'live') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
    if (status === 'beta') return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
    return 'text-slate-400 bg-white/5 border-white/10';
  }

  function isPublicHref(href) {
    if (!href) return false;
    if (/\/login(\?|$|\/)/.test(href)) return false;
    if (/\/admin(\/|$)/.test(href)) return false;
    if (/swoop\.autoro\.tech/.test(href) && !/\/api\//.test(href)) return false;
    return true;
  }

  function capsList(svc) {
    var raw = t(svc.capabilities);
    return Array.isArray(raw) ? raw : [];
  }

  function loadCatalog() {
    var inline = document.getElementById('autoro-services-catalog');
    if (inline && inline.textContent) {
      try {
        return Promise.resolve(JSON.parse(inline.textContent.trim()));
      } catch (e) {
        console.error('[autoro-services] inline catalog parse failed', e);
      }
    }
    return fetch(catalogUrl() + '?v=5').then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  function renderServices(services) {
    var grid = document.getElementById('services-grid');
    if (!grid) return;

    var l = lang();
    var labels = STATUS[l] || STATUS.en;
    var ui = UI[l] || UI.en;

    if (!services || !services.length) {
      grid.innerHTML = '<p class="text-center text-gray-400 col-span-full">' + esc(ui.error) + '</p>';
      return;
    }

    grid.innerHTML = services
      .map(function (svc) {
        var caps = capsList(svc)
          .slice(0, 4)
          .map(function (c) {
            return '<li>• ' + esc(c) + '</li>';
          })
          .join('');
        var tags = (svc.tags || [])
          .slice(0, 4)
          .map(function (tag) {
            return (
              '<span class="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-white/5 border border-white/10 text-slate-300">' +
              esc(tag) +
              '</span>'
            );
          })
          .join('');
        var href = isPublicHref(svc.href) ? svc.href : '';
        var linkBlock = href
          ? '<a href="' +
            esc(href) +
            '" target="_blank" rel="noopener" class="text-sm font-medium text-[#00F5D4] hover:text-white transition-colors">' +
            esc(ui.more) +
            '</a>'
          : '';

        return (
          '<div class="rounded-lg border shadow-sm bg-white/5 backdrop-blur-sm border-white/10 text-white hover:bg-white/10 transition-all duration-300 hover:scale-[1.02]">' +
          '<div class="flex flex-col space-y-1.5 p-6">' +
          iconSvg(svc.icon) +
          '<div class="flex flex-wrap gap-2 mb-2">' +
          '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ' +
          statusClass(svc.status) +
          '">' +
          esc(labels[svc.status] || svc.status) +
          '</span>' +
          tags +
          '</div>' +
          '<h3 class="text-xl font-semibold leading-none tracking-tight text-white">' +
          esc(t(svc.title)) +
          '</h3>' +
          '<p class="text-sm text-gray-300">' +
          esc(t(svc.description)) +
          '</p>' +
          '</div>' +
          '<div class="p-6 pt-0">' +
          '<ul class="text-sm text-gray-300 space-y-1 mb-4">' +
          caps +
          '</ul>' +
          linkBlock +
          '</div></div>'
        );
      })
      .join('');
  }

  function catalogUrl() {
    var base = document.querySelector('meta[name="catalog-base"]');
    return base && base.content ? base.content : '/services-catalog.json';
  }

  function init() {
    var grid = document.getElementById('services-grid');
    if (!grid) return;

    var l = lang();
    grid.innerHTML =
      '<p class="text-center text-gray-400 col-span-full py-8">' + esc((UI[l] || UI.en).loading) + '</p>';

    loadCatalog()
      .then(function (data) {
        renderServices(data.services);
      })
      .catch(function (err) {
        console.error('[autoro-services] catalog load failed', err);
        grid.innerHTML =
          '<p class="text-center text-gray-400 col-span-full py-8">' + esc((UI[l] || UI.en).error) + '</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
