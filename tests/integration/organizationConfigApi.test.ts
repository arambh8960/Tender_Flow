import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Organisation configuration endpoints — warehouses, financial defaults and
 * setup progress.
 *
 * These feed the agents, so the properties under test are that they are
 * tenant-scoped, role-gated, and impossible to aim at another organisation.
 */

let app: Express;

beforeAll(async () => {
  process.env.APP_ENV = 'test';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  const { createApp } = await import('../../server/app');
  app = createApp();
});

const ORG = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('warehouse endpoints', () => {
  it.each([
    ['get', '/api/organization/warehouses'],
    ['post', '/api/organization/warehouses'],
  ])('refuses an anonymous %s %s', async (method, path) => {
    const response = await (request(app) as never as Record<string, (p: string) => request.Test>)[method](path);
    expect([401, 503]).toContain(response.status);
  });

  it('requires a warehouse code', async () => {
    const { warehouseSchema } = await import('../../server/controllers/organizationConfig.controller');

    expect(warehouseSchema.safeParse({ organizationId: ORG }).success).toBe(false);
    expect(warehouseSchema.safeParse({ organizationId: ORG, code: 'WH-JAL' }).success).toBe(true);
  });

  it('rejects a zero coordinate rather than treating it as a location', async () => {
    const { warehouseSchema } = await import('../../server/controllers/organizationConfig.controller');

    // 0,0 is in the Atlantic; accepting it would silently produce absurd
    // haul distances instead of reporting a missing coordinate.
    expect(warehouseSchema.safeParse({ organizationId: ORG, code: 'W', latitude: 0 }).success).toBe(false);
    expect(warehouseSchema.safeParse({ organizationId: ORG, code: 'W', longitude: 0 }).success).toBe(false);
    expect(warehouseSchema.safeParse({ organizationId: ORG, code: 'W', latitude: 31.326 }).success).toBe(true);
  });

  it('rejects coordinates outside the possible range', async () => {
    const { warehouseSchema } = await import('../../server/controllers/organizationConfig.controller');

    expect(warehouseSchema.safeParse({ organizationId: ORG, code: 'W', latitude: 91 }).success).toBe(false);
    expect(warehouseSchema.safeParse({ organizationId: ORG, code: 'W', longitude: -181 }).success).toBe(false);
  });
});

describe('financial settings endpoints', () => {
  it('refuses an anonymous read', async () => {
    const response = await request(app).get('/api/organization/financial-settings');
    expect([401, 503]).toContain(response.status);
  });

  it('refuses an anonymous write', async () => {
    const response = await request(app)
      .put('/api/organization/financial-settings')
      .send({ organizationId: ORG, defaultGstRate: 5 });
    expect([401, 503]).toContain(response.status);
  });

  it('constrains every percentage to a real range', async () => {
    const { financialSettingsSchema } = await import('../../server/controllers/organizationConfig.controller');

    for (const field of [
      'defaultGstRate',
      'brokeragePercent',
      'targetMarginPercent',
      'transportBufferPercent',
      'defaultEmdPercent',
      'defaultEpbgPercent',
    ]) {
      expect(financialSettingsSchema.safeParse({ organizationId: ORG, [field]: -1 }).success).toBe(false);
      expect(financialSettingsSchema.safeParse({ organizationId: ORG, [field]: 101 }).success).toBe(false);
      expect(financialSettingsSchema.safeParse({ organizationId: ORG, [field]: 18 }).success).toBe(true);
    }
  });

  it('accepts a full set of defaults', async () => {
    const { financialSettingsSchema } = await import('../../server/controllers/organizationConfig.controller');

    expect(
      financialSettingsSchema.safeParse({
        organizationId: ORG,
        defaultGstRate: 18,
        brokeragePercent: 1.5,
        targetMarginPercent: 12,
        transportBufferPercent: 10,
        defaultEmdPercent: 2,
        defaultEpbgPercent: 3,
        ratePerKm: 55,
      }).success
    ).toBe(true);
  });
});

describe('setup progress endpoint', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(app).get('/api/organization/setup-progress');
    expect([401, 503]).toContain(response.status);
  });
});

describe('tenant scoping of configuration', () => {
  it('no configuration schema lets the client choose a role', async () => {
    const controller = await import('../../server/controllers/organizationConfig.controller');

    for (const schema of [
      controller.warehouseSchema,
      controller.warehouseUpdateSchema,
      controller.financialSettingsSchema,
    ]) {
      const parsed = schema.parse({ organizationId: ORG, code: 'X', role: 'owner' } as never);
      expect(parsed).not.toHaveProperty('role');
    }
  });

  it('organizationId is a selector the server verifies, present on every call', async () => {
    const controller = await import('../../server/controllers/organizationConfig.controller');

    // It must be REQUIRED — an absent tenant would otherwise be ambiguous.
    expect(controller.warehouseSchema.safeParse({ code: 'WH' }).success).toBe(false);
    expect(controller.financialSettingsSchema.safeParse({ defaultGstRate: 18 }).success).toBe(false);
  });
});
