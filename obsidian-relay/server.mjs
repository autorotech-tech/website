import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR || '/data/obsidian-vault';
const SYNC_TOKEN = String(process.env.OBSIDIAN_SYNC_TOKEN || '').trim();

const stats = {
  startedAt: new Date().toISOString(),
  total: 0,
  ok: 0,
  failed: 0,
  lastError: null,
  lastFile: null,
  lastAt: null,
};

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function safeRelative(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  return normalized;
}

async function appendOrCreate(absPath, content) {
  try {
    const prev = await readFile(absPath, 'utf8');
    const next = prev.trimEnd() + '\n\n' + content.trim() + '\n';
    await writeFile(absPath, next, 'utf8');
    return 'appended';
  } catch {
    await writeFile(absPath, content.trim() + '\n', 'utf8');
    return 'created';
  }
}

async function handleSync(req, res, payload) {
  if (SYNC_TOKEN) {
    const auth = String(req.headers['x-obsidian-token'] || '');
    if (!auth || auth !== SYNC_TOKEN) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
  }

  const rel = safeRelative(payload?.file_path);
  const mode = String(payload?.mode || 'append_or_create');
  const content = String(payload?.content || '').trim();

  if (!rel) return sendJson(res, 400, { ok: false, error: 'invalid file_path' });
  if (!content) return sendJson(res, 400, { ok: false, error: 'empty content' });

  const absPath = path.resolve(VAULT_DIR, rel);
  if (!absPath.startsWith(path.resolve(VAULT_DIR))) {
    return sendJson(res, 400, { ok: false, error: 'path escapes vault' });
  }

  await mkdir(path.dirname(absPath), { recursive: true });

  let op;
  if (mode === 'create') {
    await writeFile(absPath, content + '\n', { encoding: 'utf8', flag: 'wx' });
    op = 'created';
  } else if (mode === 'update') {
    await writeFile(absPath, content + '\n', 'utf8');
    op = 'updated';
  } else {
    op = await appendOrCreate(absPath, content);
  }

  stats.ok += 1;
  stats.lastFile = rel;
  stats.lastAt = new Date().toISOString();

  return sendJson(res, 200, { ok: true, operation: op, file_path: rel, vault_dir: VAULT_DIR });
}

const server = createServer(async (req, res) => {
  stats.total += 1;
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, service: 'obsidian-relay', vault_dir: VAULT_DIR });
    }

    if (req.method === 'GET' && req.url === '/stats') {
      return sendJson(res, 200, { ok: true, stats });
    }

    if (req.method === 'POST' && req.url === '/sync') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const payload = raw ? JSON.parse(raw) : {};
      return await handleSync(req, res, payload);
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    stats.failed += 1;
    stats.lastError = String(err?.message || err);
    return sendJson(res, 500, { ok: false, error: 'relay_error', details: stats.lastError });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`obsidian-relay listening on ${HOST}:${PORT}`);
});
