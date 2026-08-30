import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { validateLead } from '../src/validators/lead.js';

describe('validateLead', () => {
  it('marks a clean lead as valid', async () => {
    const result = await validateLead(
      {
        email: 'user@company.com',
        phone: '+12025550123',
        name: 'Jane Doe',
      },
      { checkMx: false },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, 'valid');
    assert.ok(result.score >= 0.9);
    assert.equal(result.checks.email.valid, true);
    assert.equal(result.checks.phone.e164, '+12025550123');
  });

  it('rejects invalid email syntax', async () => {
    const result = await validateLead({ email: 'not-an-email' }, { checkMx: false });
    assert.equal(result.status, 'invalid');
    assert.ok(result.checks.email.reasons.includes('email_invalid_syntax'));
  });

  it('flags disposable email as risky', async () => {
    const result = await validateLead(
      { email: 'tmp@mailinator.com' },
      { checkMx: false },
    );
    assert.equal(result.status, 'risky');
    assert.ok(result.checks.email.reasons.includes('email_disposable_domain'));
  });

  it('rejects bad phone when provided', async () => {
    const result = await validateLead(
      { email: 'user@company.com', phone: '123' },
      { checkMx: false },
    );
    assert.equal(result.status, 'invalid');
    assert.ok(result.checks.phone.reasons.includes('phone_invalid'));
  });

  it('allows missing optional phone', async () => {
    const result = await validateLead({ email: 'user@company.com' }, { checkMx: false });
    assert.equal(result.status, 'valid');
    assert.equal(result.checks.phone.skipped, true);
  });
});

describe('HTTP API', () => {
  it('GET /health returns ok', async () => {
    const app = createApp();
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.service, 'lead-validation');
    } finally {
      server.close();
    }
  });

  it('POST /v1/leads/validate validates a lead', async () => {
    const app = createApp();
    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/leads/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@company.com',
          phone: '+12025550123',
          name: 'Jane Doe',
          company: 'Acme',
          source: 'landing',
        }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.status, 'valid');
    } finally {
      server.close();
    }
  });
});
