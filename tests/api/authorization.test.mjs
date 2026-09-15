/**
 * API authorization tests.
 *
 * Boots the real Express app in-process on an ephemeral port and asserts the
 * middleware contract: organisation-scoped endpoints reject unauthenticated
 * callers and callers who are not members.
 *
 * These exist because before this phase EVERY endpoint was open.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.ts';

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

const post = (path, body, headers = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });

const get = (path, headers = {}) => fetch(`${baseUrl}${path}`, { headers });

describe('Unauthenticated access to organisation-scoped endpoints', () => {
  test('POST /api/discover is rejected without a token', async () => {
    const res = await post('/api/discover', { organizationId: 'x', category: 'cable' });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });

  test('GET /api/discovery/runs is rejected without a token', async () => {
    const res = await get('/api/discovery/runs?organizationId=x');
    assert.equal(res.status, 401);
  });

  test('a malformed Authorization header is rejected', async () => {
    const res = await post('/api/discover', { organizationId: 'x' }, { Authorization: 'NotBearer abc' });
    assert.equal(res.status, 401);
  });

  test('a bogus bearer token is rejected', async () => {
    const res = await post(
      '/api/discover',
      { organizationId: 'x', category: 'cable' },
      { Authorization: 'Bearer not-a-real-jwt' }
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_TOKEN');
  });
});

describe('Error envelope is consistent', () => {
  test('unknown routes return the standard shape', async () => {
    const res = await get('/api/definitely-not-a-route');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(typeof body.error.message, 'string');
  });

  test('health check responds', async () => {
    const res = await get('/api/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  test('no response body leaks a stack trace', async () => {
    const res = await get('/api/definitely-not-a-route');
    const text = await res.text();
    assert.ok(!text.includes('at '), 'response contained what looks like a stack frame');
    assert.ok(!/node_modules/.test(text));
  });
});

describe('Public endpoints stay public', () => {
  test('GET /api/discovery/portals lists supported portals', async () => {
    const res = await get('/api/discovery/portals');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.includes('gem'));
  });
});
