import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Email sign-in mode.
 *
 * Supabase's API call is identical whether the project mails a six digit code
 * or a clickable link — only the email TEMPLATE differs, and the frontend
 * cannot see it. Presenting a code box for an email containing no code is the
 * failure this configuration exists to prevent, so the default must be the
 * one that matches an UNMODIFIED Supabase project.
 */

async function loadMode(value?: string) {
  vi.resetModules();
  vi.stubEnv('VITE_EMAIL_AUTH_MODE', value ?? '');
  return import('../../src/lib/emailAuthMode');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('email auth mode', () => {
  it('defaults to magic link, because that is what a stock project sends', async () => {
    const { EMAIL_AUTH_MODE, isOtpMode } = await loadMode(undefined);

    // Defaulting to OTP would show a code box for an email with no code.
    expect(EMAIL_AUTH_MODE).toBe('magic_link');
    expect(isOtpMode).toBe(false);
  });

  it('honours an explicit otp configuration', async () => {
    const { EMAIL_AUTH_MODE, isOtpMode } = await loadMode('otp');

    expect(EMAIL_AUTH_MODE).toBe('otp');
    expect(isOtpMode).toBe(true);
  });

  it('honours an explicit magic_link configuration', async () => {
    const { EMAIL_AUTH_MODE } = await loadMode('magic_link');
    expect(EMAIL_AUTH_MODE).toBe('magic_link');
  });

  it('tolerates casing and surrounding whitespace', async () => {
    expect((await loadMode('  OTP  ')).EMAIL_AUTH_MODE).toBe('otp');
    expect((await loadMode('Otp')).EMAIL_AUTH_MODE).toBe('otp');
  });

  it('falls back to the safe mode for an unrecognised value', async () => {
    // A typo must not silently produce a code box.
    expect((await loadMode('sms')).EMAIL_AUTH_MODE).toBe('magic_link');
    expect((await loadMode('true')).EMAIL_AUTH_MODE).toBe('magic_link');
  });
});
