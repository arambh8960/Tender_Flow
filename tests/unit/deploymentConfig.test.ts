import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Deployment configuration.
 *
 * These guard the settings whose wrong value fails only in production: a
 * headed browser on a display-less server, a missing Chromium path on a slim
 * image, and a CORS allowlist that silently degrades to "allow everything".
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

async function loadEnv() {
  return (await import('../../server/config/env')).env;
}

describe('puppeteer configuration', () => {
  it('is headless when the variable is not set at all', async () => {
    delete process.env.PUPPETEER_HEADLESS;
    expect((await loadEnv()).puppeteer.headless).toBe(true);
  });

  it('is headless for any value other than an explicit "false"', async () => {
    process.env.PUPPETEER_HEADLESS = 'true';
    expect((await loadEnv()).puppeteer.headless).toBe(true);
  });

  it('is headed only when explicitly disabled for local debugging', async () => {
    process.env.PUPPETEER_HEADLESS = 'false';
    expect((await loadEnv()).puppeteer.headless).toBe(false);
  });

  it('passes through a system Chromium path when one is configured', async () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium';
    expect((await loadEnv()).puppeteer.executablePath).toBe('/usr/bin/chromium');
  });

  it('leaves the executable path undefined when unset, so Puppeteer decides', async () => {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    expect((await loadEnv()).puppeteer.executablePath).toBeUndefined();
  });
});

describe('CORS configuration', () => {
  it('has development defaults when unset outside production', async () => {
    delete process.env.CORS_ORIGINS;
    process.env.APP_ENV = 'development';

    const origins = (await loadEnv()).corsOrigins;
    expect(origins).toContain('http://localhost:5173');
  });

  it('defaults to NOTHING in production rather than to a wildcard', async () => {
    delete process.env.CORS_ORIGINS;
    process.env.APP_ENV = 'production';

    // An empty allowlist blocks every browser, which is the safe failure.
    expect((await loadEnv()).corsOrigins).toEqual([]);
  });

  it('parses a comma-separated list and trims trailing slashes', async () => {
    process.env.CORS_ORIGINS = 'https://app.example.com/, https://admin.example.com';

    expect((await loadEnv()).corsOrigins).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });
});

describe('production configuration assertion', () => {
  it('refuses to start without the values production requires', async () => {
    process.env.APP_ENV = 'production';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.CORS_ORIGINS = '';

    const { assertProductionConfig } = await import('../../server/config/env');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionConfig();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects a wildcard CORS origin in production', async () => {
    process.env.APP_ENV = 'production';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    process.env.CORS_ORIGINS = '*';

    const { assertProductionConfig } = await import('../../server/config/env');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionConfig();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('accepts a complete production configuration', async () => {
    process.env.APP_ENV = 'production';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const { assertProductionConfig } = await import('../../server/config/env');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    assertProductionConfig();
    expect(exit).not.toHaveBeenCalled();
  });
});
