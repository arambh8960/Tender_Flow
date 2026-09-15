import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

import { requireRecentAuth } from '../../server/middleware/auth';
import { friendlyAuthError } from '../../src/lib/authErrors';

/**
 * Authentication security properties that can be proven without a live
 * project: the step-up check, and the rule that no part of the codebase
 * mints or accepts a session credential of its own.
 */

function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

/** Builds a token whose payload carries the given issued-at. */
function tokenIssuedAt(secondsAgo: number): string {
  const payload = { iat: Math.floor(Date.now() / 1000) - secondsAgo, sub: 'user-1' };
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function authedRequest(token: string): Request {
  return { auth: { userId: 'user-1', email: 'a@b.com', accessToken: token, db: {} as never } } as unknown as Request;
}

describe('requireRecentAuth — step-up for security changes', () => {
  it('allows a freshly issued session through', () => {
    const next = vi.fn();
    const res = mockResponse();

    requireRecentAuth(15 * 60)(authedRequest(tokenIssuedAt(30)), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses a session that was issued long ago', () => {
    const next = vi.fn();
    const res = mockResponse();

    // A refreshed months-old session proves the account was signed into once.
    // It does not prove who is at the keyboard now.
    requireRecentAuth(15 * 60)(authedRequest(tokenIssuedAt(60 * 60)), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
  });

  it('refuses a token with no issue time rather than assuming it is fresh', () => {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const noIat = `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-1' })}.sig`;

    const res = mockResponse();
    requireRecentAuth()(authedRequest(noIat), res, vi.fn());

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('refuses a malformed token', () => {
    const res = mockResponse();
    requireRecentAuth()(authedRequest('not-a-jwt'), res, vi.fn());

    expect(res.statusCode).toBe(401);
  });

  it('refuses when there is no authenticated caller at all', () => {
    const res = mockResponse();
    requireRecentAuth()({} as Request, res, vi.fn());

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('honours a caller-specified freshness window', () => {
    const strict = mockResponse();
    requireRecentAuth(60)(authedRequest(tokenIssuedAt(120)), strict, vi.fn());
    expect(strict.statusCode).toBe(403);

    const lenient = vi.fn();
    requireRecentAuth(600)(authedRequest(tokenIssuedAt(120)), mockResponse(), lenient);
    expect(lenient).toHaveBeenCalledOnce();
  });
});

describe('no self-issued session credentials anywhere', () => {
  it('the codebase mints no token of its own', async () => {
    // The old build returned a constant string the browser then presented as
    // proof of identity. Nothing may reintroduce that shape.
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk('server');
    walk('src');

    const offenders = files.filter(file => {
      const text = readFileSync(file, 'utf8');
      return (
        text.includes('session_token_approved') ||
        /token:\s*['"]approved/.test(text) ||
        /TF-Admin-\d{4}/.test(text)
      );
    });

    expect(offenders, `self-issued credential found in: ${offenders.join(', ')}`).toHaveLength(0);
  });

  it('no OTP is generated or stored by the application', async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk('server');
    walk('src');

    // Supabase issues and verifies one-time codes. An application that also
    // generates them is storing a credential it has no way to protect.
    const offenders = files.filter(file => {
      const text = readFileSync(file, 'utf8');
      return /Math\.random\(\)[^\n]*\b(otp|code|token)\b/i.test(text) || /reset_token/.test(text);
    });

    expect(offenders, `application-generated OTP found in: ${offenders.join(', ')}`).toHaveLength(0);
  });

  it('the service-role key is never referenced from frontend source', async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk('src');

    const offenders = files.filter(file => {
      const text = readFileSync(file, 'utf8');
      // The guard in services/supabase/client.ts mentions it in order to
      // REJECT it, which is the opposite of a leak.
      if (file.includes('supabase') && text.includes('must never reach the browser')) return false;
      return text.includes('SERVICE_ROLE');
    });

    expect(offenders, `service-role reference in frontend: ${offenders.join(', ')}`).toHaveLength(0);
  });
});

describe('authentication error messages', () => {
  it('turns an expired code into an actionable instruction', () => {
    expect(friendlyAuthError('Token has expired or is invalid')).toMatch(/expired/i);
    expect(friendlyAuthError('otp_expired')).toMatch(/request a new one/i);
  });

  it('explains a rate limit rather than showing the raw error', () => {
    expect(friendlyAuthError('For security purposes, email rate limit exceeded')).toMatch(/wait a minute/i);
  });

  it('says plainly when Google is not enabled on the deployment', () => {
    expect(friendlyAuthError('Unsupported provider: provider is not enabled')).toMatch(/not enabled/i);
  });

  it('does not invent a message when none was given', () => {
    expect(friendlyAuthError(undefined)).toMatch(/something went wrong/i);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(friendlyAuthError('A very specific backend failure')).toBe('A very specific backend failure');
  });

  it('never echoes a credential VALUE back to the user', () => {
    // Naming the field is fine and helpful; repeating what was typed is not.
    const secret = 'hunter2-my-actual-password';
    const message = friendlyAuthError(`Invalid login credentials for ${secret}`);

    expect(message).not.toContain(secret);
  });

  it('does not echo a raw token from a provider error', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.leaked';
    expect(friendlyAuthError(`Token has expired: ${token}`)).not.toContain(token);
  });
});
