import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * API integration tests.
 *
 * These exercise the real Express app end to end: middleware ordering, the
 * auth gate, validation, the error envelope and the security headers. They
 * deliberately do NOT require Supabase credentials — an unauthenticated
 * caller must be rejected before any database work happens, and that is
 * exactly the property under test.
 *
 * The cross-tenant data tests that DO need a live project are in
 * tests/api/tenantIsolation.test.mjs, run by `npm run test:rls`.
 */

let app: Express;

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  const { createApp } = await import('../../server/app');
  app = createApp();
});

// A well-formed v4 UUID: zod validates the RFC variant nibble, so an
// all-ones placeholder would fail validation before reaching the auth gate.
const ORG_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('health and readiness', () => {
  it('reports liveness without touching a dependency', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('never leaks configuration values from the readiness probe', async () => {
    const response = await request(app).get('/api/ready');
    const body = JSON.stringify(response.body);

    expect([200, 503]).toContain(response.status);
    expect(body).not.toMatch(/supabase\.co/);
    expect(body).not.toMatch(/eyJ/); // a JWT prefix
    expect(body).not.toMatch(/service_role/);
  });

  it('stamps a request id on every response', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('echoes a caller-supplied request id so a trace can be followed', async () => {
    const response = await request(app).get('/api/health').set('X-Request-Id', 'trace-abc-123');
    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });
});

describe('security headers', () => {
  it('sets the headers helmet provides', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-dns-prefetch-control']).toBeDefined();
    // The API must not advertise its stack.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows a configured origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('refuses an origin that is not on the allowlist', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('authentication gate', () => {
  const protectedRoutes: [string, string][] = [
    ['get', '/api/inventory'],
    ['get', '/api/rfps'],
    ['get', '/api/vault/documents'],
    ['get', '/api/organization/profile'],
    ['get', '/api/admin/overview'],
    ['get', '/api/admin/members'],
    ['get', '/api/admin/audit-logs'],
    ['get', '/api/discovery/runs'],
    ['get', '/api/vault/security'],
  ];

  it.each(protectedRoutes)('rejects an anonymous %s %s', async (method, path) => {
    const response = await (request(app) as never as Record<string, (p: string) => request.Test>)[method](path);

    // 401 when Supabase is configured, 503 when it is not — either way the
    // request never reaches a handler that could return tenant data.
    expect([401, 503]).toContain(response.status);
    expect(response.body.success).toBe(false);
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await request(app).get('/api/inventory').set('Authorization', 'Basic abc123');
    expect([401, 503]).toContain(response.status);
  });

  it('rejects a forged bearer token', async () => {
    const response = await request(app)
      .get('/api/inventory')
      .set('Authorization', 'Bearer not-a-real-token');

    expect([401, 503]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toMatch(/organization_id/);
  });

  it('rejects an anonymous write just as firmly as an anonymous read', async () => {
    const response = await request(app)
      .post('/api/inventory')
      .send({ organizationId: ORG_ID, skuId: 'X', productName: 'Y' });

    expect([401, 403, 503]).toContain(response.status);
  });

  it('rejects an anonymous discovery run', async () => {
    const response = await request(app).post('/api/discover').send({ organizationId: ORG_ID, category: 'Cables' });
    expect([401, 503]).toContain(response.status);
  });
});

describe('request validation', () => {
  it('returns 422 with field detail for an invalid payload', async () => {
    const response = await request(app).post('/api/rfps').send({ organizationId: 'not-a-uuid', source: 'URL' });

    // Validation runs after the auth gate, so an unauthenticated caller sees
    // the auth failure first — both are acceptable, a 500 is not.
    expect([401, 422, 503]).toContain(response.status);
    if (response.status === 422) {
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(Array.isArray(response.body.details)).toBe(true);
    }
  });

  it('returns a consistent envelope for an unknown endpoint', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });
});

describe('error envelope', () => {
  it('never returns a stack trace or internal path', async () => {
    const response = await request(app).post('/api/fetch-rfp-url').send({ url: 'http://127.0.0.1/' });
    const body = JSON.stringify(response.body);

    expect(body).not.toMatch(/at Object\./);
    expect(body).not.toMatch(/node_modules/);
    expect(body).not.toMatch(/[A-Z]:\\\\/);
    expect(body).not.toMatch(/\/server\//);
  });

  it('shapes every error as { success, error: { code, message } }', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.body).toHaveProperty('success', false);
    expect(response.body.error).toHaveProperty('code');
    expect(response.body.error).toHaveProperty('message');
  });
});

describe('public endpoints', () => {
  it('lists supported portals without a session', async () => {
    const response = await request(app).get('/api/discovery/portals');

    expect(response.status).toBe(200);
    expect(response.body.data).toContain('gem');
  });
});

describe('rate limiting', () => {
  /**
   * The limiter must actually reject, not merely be mounted. Auth endpoints
   * carry the tightest budget (20 per 15 minutes) because they are the
   * credential-guessing surface.
   */
  it('rejects a burst on an auth endpoint with 429 and a retry hint', async () => {
    let limited: request.Response | undefined;

    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await request(app).post('/api/vault/pin/verify').send({ pin: '000000' });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited, 'the auth limiter never triggered within 40 attempts').toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMITED');
    // draft-7 standard headers let a client back off intelligently.
    expect(limited!.headers['ratelimit']).toBeDefined();
  });

  it('leaves unlimited endpoints usable while another bucket is exhausted', async () => {
    // Health is deliberately outside the auth bucket: a credential-stuffing
    // attempt must not take down liveness probes.
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });
});
