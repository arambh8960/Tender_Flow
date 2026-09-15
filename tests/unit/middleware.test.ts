import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response } from 'express';

import { validate, validated } from '../../server/middleware/validate';
import { errorHandler, notFoundHandler, AppError, ok, fail, asyncHandler } from '../../server/middleware/errorHandler';
import { requestContext, clientIp } from '../../server/middleware/requestContext';

/**
 * Middleware unit tests.
 *
 * These cover the edge of the API — where untrusted input arrives and where
 * errors leave. The properties under test are security properties: a rejected
 * payload must not reach a handler, and an error must never carry a stack
 * trace, a file path or a credential back to the caller.
 */

function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    on() {
      /* no finish event in these tests */
    },
  };
  return res as unknown as Response & typeof res;
}

describe('validate()', () => {
  const schema = z.object({
    organizationId: z.string().uuid(),
    quantity: z.number().int().min(0),
  });

  it('passes a valid payload through and exposes the parsed value', () => {
    const req = { body: { organizationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', quantity: 5 } } as Request;
    const res = mockResponse();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(validated<z.infer<typeof schema>>(req).quantity).toBe(5);
  });

  it('rejects an invalid payload with 422 and does not call the handler', () => {
    const req = { body: { organizationId: 'not-a-uuid', quantity: -1 } } as Request;
    const res = mockResponse();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect((res.body as any).error.code).toBe('VALIDATION_FAILED');
  });

  it('names every offending field so the caller can fix the request', () => {
    const req = { body: { organizationId: 'nope', quantity: 'many' } } as Request;
    const res = mockResponse();

    validate(schema)(req, res, vi.fn());

    const paths = (res.body as any).details.map((d: { path: string }) => d.path);
    expect(paths).toContain('organizationId');
    expect(paths).toContain('quantity');
  });

  it('validates the query string when asked to', () => {
    const querySchema = z.object({ limit: z.string() });
    const req = { query: { limit: '25' } } as unknown as Request;
    const next = vi.fn();

    validate(querySchema, 'query')(req, mockResponse(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(validated<{ limit: string }>(req, 'query').limit).toBe('25');
  });

  it('keeps separately validated parts independent', () => {
    const req = { body: { a: '1' }, query: { b: '2' } } as unknown as Request;

    validate(z.object({ a: z.string() }))(req, mockResponse(), vi.fn());
    validate(z.object({ b: z.string() }), 'query')(req, mockResponse(), vi.fn());

    expect(validated<{ a: string }>(req).a).toBe('1');
    expect(validated<{ b: string }>(req, 'query').b).toBe('2');
  });

  it('rejects a missing body rather than treating it as empty', () => {
    const req = { body: undefined } as Request;
    const res = mockResponse();

    validate(schema)(req, res, vi.fn());
    expect(res.statusCode).toBe(422);
  });
});

describe('error handling', () => {
  it('returns an AppError status and code unchanged', () => {
    const res = mockResponse();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorHandler(new AppError('TEAPOT', 'I am a teapot', 418), {} as Request, res, vi.fn());

    expect(res.statusCode).toBe(418);
    expect((res.body as any).error).toEqual({ code: 'TEAPOT', message: 'I am a teapot' });
  });

  it('never leaks an unexpected error message to the caller', () => {
    const res = mockResponse();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const leaky = new Error('connection to postgres://user:hunter2@db.internal failed');
    errorHandler(leaky, {} as Request, res, vi.fn());

    expect(res.statusCode).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/hunter2/);
    expect(body).not.toMatch(/postgres:\/\//);
    expect((res.body as any).error.code).toBe('INTERNAL_ERROR');
  });

  it('logs the real error server-side even while hiding it from the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorHandler(new Error('the actual cause'), {} as Request, mockResponse(), vi.fn());

    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).toMatch(/the actual cause/);
  });

  it('shapes a 404 consistently with every other error', () => {
    const res = mockResponse();
    notFoundHandler({} as Request, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });

  it('wraps success payloads in a stable envelope', () => {
    const res = mockResponse();
    ok(res, { id: 'abc' }, { total: 1 });

    expect(res.body).toEqual({ success: true, data: { id: 'abc' }, total: 1 });
  });

  it('wraps failures in a stable envelope', () => {
    const res = mockResponse();
    fail(res, 403, 'FORBIDDEN', 'Not allowed.');

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: { code: 'FORBIDDEN', message: 'Not allowed.' } });
  });

  it('routes a rejected async handler to the error middleware', async () => {
    const next = vi.fn();
    const boom = new Error('async failure');

    await asyncHandler(async () => {
      throw boom;
    })({} as Request, mockResponse(), next);

    // Without this an async throw becomes an unhandled rejection and the
    // request hangs until the client times out.
    await new Promise(resolve => setImmediate(resolve));
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('request context', () => {
  it('generates a request id when the caller supplies none', () => {
    const req = { headers: {}, socket: {}, path: '/api/x', method: 'GET' } as unknown as Request;
    const res = mockResponse();

    requestContext(req, res, vi.fn());

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['X-Request-Id']).toBe(req.requestId);
  });

  it('honours a caller-supplied request id so a trace spans tiers', () => {
    const req = {
      headers: { 'x-request-id': 'trace-123' },
      socket: {},
      path: '/api/x',
      method: 'GET',
    } as unknown as Request;
    const res = mockResponse();

    requestContext(req, res, vi.fn());
    expect(req.requestId).toBe('trace-123');
  });

  it('ignores an absurdly long inbound id rather than echoing it', () => {
    const req = {
      headers: { 'x-request-id': 'x'.repeat(500) },
      socket: {},
      path: '/api/x',
      method: 'GET',
    } as unknown as Request;

    requestContext(req, mockResponse(), vi.fn());
    expect(req.requestId).not.toHaveLength(500);
  });

  it('prefers the forwarded client address behind a proxy', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;

    // The first entry is the original client; the rest are proxy hops.
    expect(clientIp(req)).toBe('203.0.113.5');
  });

  it('falls back to the socket address when there is no proxy header', () => {
    const req = { headers: {}, socket: { remoteAddress: '198.51.100.7' } } as unknown as Request;
    expect(clientIp(req)).toBe('198.51.100.7');
  });
});
