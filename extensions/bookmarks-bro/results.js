function mdFromRows(payload, rows) {
  const { overview = '', retrievalMode = '', candidateCount = 0 } = payload || {};
  const out = [];
  out.push('# Keep It For Me AI Search Results');
  out.push('');
  out.push(`- Mode: ${retrievalMode || '—'}`);
  out.push(`- Candidates: ${candidateCount || rows.length || 0}`);
  out.push(`- Selected: ${rows.length}`);
  out.push('');
  out.push('## Overview');
  out.push('');
  out.push(overview || 'No overview.');
  out.push('');
  out.push('## Recommendations');
  out.push('');
  rows.forEach((item, i) => {
    const rel = typeof item?.relevance === 'number' ? `${Math.round(item.relevance * 100)}%` : '—';
    const srcProvider = item?.sourceProvider ? ` (${item.sourceProvider})` : '';
    out.push(`### ${i + 1}. ${item?.title || item?.url || 'Untitled'}`);
    out.push(`- URL: ${item?.url || ''}`);
    out.push(`- Source: ${item?.source || 'bookmark'}${srcProvider}`);
    out.push(`- Category: ${item?.category || 'general'}`);
    out.push(`- Relevance: ${rel}`);
    out.push('');
    out.push(item?.reason || '');
    out.push('');
  });
  return out.join('\n');
}

function setup(payload) {
  const allRows = Array.isArray(payload?.picks) ? payload.picks.slice() : [];
  const kMode = document.getElementById('kMode');
  const kCandidates = document.getElementById('kCandidates');
  const kSelected = document.getElementById('kSelected');
  const overview = document.getElementById('overview');
  const filter = document.getElementById('filter');
  const copyBtn = document.getElementById('copyBtn');
  const exportBtn = document.getElementById('exportBtn');
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('empty');

  kMode.textContent = payload?.retrievalMode || '—';
  kCandidates.textContent = String(payload?.candidateCount || allRows.length || 0);
  kSelected.textContent = String(allRows.length);
  overview.textContent = payload?.overview || 'No overview.';

  const toPct = (v) => (typeof v === 'number' && !Number.isNaN(v) ? `${Math.round(v * 100)}%` : '—');
  const sourceBadge = (source, sourceProvider) => {
    const src = String(source || 'bookmark').toLowerCase();
    if (src === 'web') {
      const provider = String(sourceProvider || '').trim();
      return `<span class="src-badge src-web">web${provider ? `:${provider}` : ''}</span>`;
    }
    return '<span class="src-badge src-bookmark">bookmark</span>';
  };

  const render = (rows) => {
    tbody.innerHTML = '';
    if (!rows.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    rows.forEach((item, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="#">${i + 1}</td>
        <td data-label="Source">${sourceBadge(item?.source, item?.sourceProvider)}</td>
        <td data-label="Resource"><strong>${item?.title || 'Untitled'}</strong><br/><a class="url" href="${item?.url || '#'}" target="_blank" rel="noopener noreferrer">${item?.url || ''}</a></td>
        <td data-label="Category">${item?.category || 'general'}</td>
        <td data-label="Rel.">${toPct(item?.relevance)}</td>
        <td data-label="Reason" class="reason">${item?.reason || ''}</td>
        <td data-label="Actions" class="actions"></td>
      `;
      const actions = tr.querySelector('.actions');
      const open = document.createElement('button');
      open.textContent = 'Open';
      open.disabled = !item?.url;
      open.onclick = () => {
        if (item?.url) window.open(item.url, '_blank', 'noopener,noreferrer');
      };
      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.disabled = !item?.url;
      copy.onclick = async () => {
        if (!item?.url) return;
        try {
          await navigator.clipboard.writeText(item.url);
          copy.textContent = 'OK';
          setTimeout(() => {
            copy.textContent = 'Copy';
          }, 800);
        } catch (_) {}
      };
      actions.appendChild(open);
      actions.appendChild(copy);
      tbody.appendChild(tr);
    });
  };

  render(allRows);

  filter.addEventListener('input', () => {
    const q = String(filter.value || '').trim().toLowerCase();
    if (!q) {
      render(allRows);
      return;
    }
    render(
      allRows.filter((r) =>
        `${r?.title || ''}\n${r?.url || ''}\n${r?.reason || ''}`.toLowerCase().includes(q),
      ),
    );
  });

  copyBtn.addEventListener('click', async () => {
    const text = allRows.map((r, i) => `${i + 1}. ${r?.title || r?.url || ''}\n${r?.reason || ''}\n${r?.url || ''}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy summary';
      }, 900);
    } catch (_) {}
  });

  exportBtn.addEventListener('click', () => {
    const md = mdFromRows(payload, allRows);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarks-bro-search-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

chrome.storage.local.get(['aiSearchLastResult']).then((data) => {
  setup(data?.aiSearchLastResult || {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes.aiSearchLastResult?.newValue) return;
  window.location.reload();
});
