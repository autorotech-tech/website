import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import healthRouter from './routes/health.js';
import validateRouter from './routes/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.resolve(__dirname, '../demo');
const serveDemo = existsSync(path.join(demoDir, 'index.html'));

export function createApp() {
  const app = express();

  // Local vibe demo may use inline scripts; keep CSP off when serving demo/.
  app.use(helmet(serveDemo ? { contentSecurityPolicy: false } : undefined));
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.use(healthRouter);
  app.use(validateRouter);

  if (serveDemo) {
    app.use(express.static(demoDir));
  }

  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({
        ok: false,
        error: 'invalid_json',
        message: 'Request body must be valid JSON',
      });
      return;
    }

    console.error('[lead-validation]', err);
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: 'Internal server error',
    });
  });

  return app;
}
