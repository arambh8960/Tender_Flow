import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Organisation-account and invitation endpoints.
 *
 * These are the routes a user reaches BEFORE they belong to any organisation,
 * so they are the one place `requireOrgMember` cannot protect. What protects
 * them instead is that the database functions behind them derive everything
 * from the caller's own session — and these tests pin the edge behaviour that
 * guards that: no anonymous access, and no client-chosen role or tenant.
 */

let app: Express;

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  const { createApp } = await import('../../server/app');
  app = createApp();
});

const VALID_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('organisation creation endpoint', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(app).post('/api/organizations').send({ name: 'Anonymous Corp' });

    expect([401, 503]).toContain(response.status);
    expect(response.body.success).toBe(false);
  });

  it('refuses a forged bearer token', async () => {
    const response = await request(app)
      .post('/api/organizations')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ name: 'Forged Corp' });

    expect([401, 503]).toContain(response.status);
  });

  it('offers no way for the client to ask for a role', async () => {
    // The schema has no `role` field at all. A payload carrying one is
    // accepted only in the sense that the extra key is ignored — it can never
    // influence the membership the server creates.
    const { createOrganizationSchema } = await import('../../server/controllers/organizationAccount.controller');
    const parsed = createOrganizationSchema.parse({ name: 'Role Probe', role: 'owner' } as never);

    expect(parsed).not.toHaveProperty('role');
  });

  it('offers no way for the client to nominate an organisation id', async () => {
    const { createOrganizationSchema } = await import('../../server/controllers/organizationAccount.controller');
    const parsed = createOrganizationSchema.parse({ name: 'Tenant Probe', organizationId: VALID_UUID } as never);

    expect(parsed).not.toHaveProperty('organizationId');
  });

  it('rejects an empty organisation name', async () => {
    const { createOrganizationSchema } = await import('../../server/controllers/organizationAccount.controller');

    expect(createOrganizationSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: 'Acme Pvt Ltd' }).success).toBe(true);
  });

  it('accepts the full company profile in one call', async () => {
    const { createOrganizationSchema } = await import('../../server/controllers/organizationAccount.controller');

    const result = createOrganizationSchema.safeParse({
      name: 'Acme Electrical',
      legalName: 'Acme Electrical Private Limited',
      address: '12 Industrial Estate, Ludhiana',
      gstin: '03AAAAA0000A1Z5',
      pan: 'AAAAA0000A',
      domain: 'acme.co.in',
      industry: 'Electrical & Power',
      annualTurnoverCr: 42.5,
      turnoverYear: '2024-25',
      oemStatus: 'OEM',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a negative turnover', async () => {
    const { createOrganizationSchema } = await import('../../server/controllers/organizationAccount.controller');
    expect(createOrganizationSchema.safeParse({ name: 'Acme', annualTurnoverCr: -1 }).success).toBe(false);
  });
});

describe('invitation endpoints', () => {
  it('refuses an anonymous listing', async () => {
    const response = await request(app).get('/api/invitations/mine');
    expect([401, 503]).toContain(response.status);
  });

  it('refuses an anonymous acceptance', async () => {
    const response = await request(app).post('/api/invitations/accept').send({ invitationId: VALID_UUID });
    expect([401, 503]).toContain(response.status);
  });

  it('requires a well-formed invitation id', async () => {
    const { acceptInvitationSchema } = await import('../../server/controllers/organizationAccount.controller');

    expect(acceptInvitationSchema.safeParse({ invitationId: 'nonsense' }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ invitationId: VALID_UUID }).success).toBe(true);
  });

  it('takes no organisation id — the invitation determines the tenant', async () => {
    const { acceptInvitationSchema } = await import('../../server/controllers/organizationAccount.controller');
    const parsed = acceptInvitationSchema.parse({ invitationId: VALID_UUID, organizationId: VALID_UUID } as never);

    // Accepting into an arbitrary organisation must be impossible to express.
    expect(parsed).not.toHaveProperty('organizationId');
  });

  it('takes no role — the invitation determines it, and never grants owner', async () => {
    const { acceptInvitationSchema } = await import('../../server/controllers/organizationAccount.controller');
    const parsed = acceptInvitationSchema.parse({ invitationId: VALID_UUID, role: 'owner' } as never);

    expect(parsed).not.toHaveProperty('role');
  });
});

describe('vault PIN reset endpoint', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(app).post('/api/vault/pin/reset').send({ pin: '123456' });
    expect([401, 429, 503]).toContain(response.status);
  });

  it('requires exactly six digits', async () => {
    const { pinSchema } = await import('../../server/controllers/vaultSecurity.controller');

    expect(pinSchema.safeParse({ pin: '12345' }).success).toBe(false);
    expect(pinSchema.safeParse({ pin: '1234567' }).success).toBe(false);
    expect(pinSchema.safeParse({ pin: 'abcdef' }).success).toBe(false);
    expect(pinSchema.safeParse({ pin: '123456' }).success).toBe(true);
  });

  it('exposes no endpoint that accepts an email to identify the account', async () => {
    // The old reset flow trusted whatever address the browser named.
    const legacy = ['/api/auth/send-otp', '/api/auth/verify-otp', '/api/auth/login', '/api/auth/check-email'];

    for (const path of legacy) {
      const response = await request(app).post(path).send({ email: 'victim@example.com' });
      expect(response.status, `${path} still exists`).toBe(404);
    }
  });

  it('no longer exposes the self-managed TOTP endpoints', async () => {
    // Multi-factor moved to Supabase Auth, which can enforce it at sign-in.
    for (const path of ['/api/vault/2fa/setup', '/api/vault/2fa/verify']) {
      const response = await request(app).post(path).send({ code: '123456' });
      expect(response.status, `${path} still exists`).toBe(404);
    }
  });
});
