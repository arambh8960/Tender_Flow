import { test, expect, E2E_READY, SKIP_REASON, createConfirmedUser, deleteUser, signIn, type TestUser } from './support/fixtures';

/**
 * FLOW A (part 1) — authentication against real Supabase Auth.
 *
 * The session here is a genuine JWT issued by GoTrue. Nothing is stubbed:
 * if Supabase rejects the credentials, this spec fails, which is the point.
 */

test.describe('authentication', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let user: TestUser;

  test.beforeAll(async () => {
    user = await createConfirmedUser('auth');
  });

  test.afterAll(async () => {
    await deleteUser(user.id);
  });

  test('an anonymous visitor is sent to sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/signin/);
  });

  test('signing in issues a real Supabase session', async ({ page }) => {
    await signIn(page, user);

    // The SDK persists the session under a project-scoped storage key; a real
    // token means GoTrue actually authenticated the credentials.
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      return key ? localStorage.getItem(key) : null;
    });

    expect(token, 'no Supabase session was stored after sign-in').toBeTruthy();
    const parsed = JSON.parse(token as string);
    expect(parsed.access_token).toMatch(/^ey/); // a JWT
    expect(parsed.user?.email).toBe(user.email);
  });

  test('the session survives a page reload', async ({ page }) => {
    await signIn(page, user);
    const before = page.url();

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Restoration must not bounce the user back to sign-in.
    await expect(page).not.toHaveURL(/\/signin/);
    expect(page.url()).toBe(before);
  });

  test('signing out clears the session and re-protects the app', async ({ page }) => {
    await signIn(page, user);

    await page.goto('/settings');
    await page.getByRole('button', { name: /log ?out|sign ?out/i }).first().click();

    await expect(page).toHaveURL(/\/signin/, { timeout: 20_000 });

    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      return key ? localStorage.getItem(key) : null;
    });
    expect(token === null || token === 'null').toBeTruthy();

    // And the protected route is protected again.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/signin/);
  });

  test('wrong credentials are rejected without a session', async ({ page }) => {
    await page.goto('/signin');
    await page.getByPlaceholder(/email/i).first().fill(user.email);

    const passwordToggle = page.getByRole('button', { name: /password/i }).first();
    if (await passwordToggle.isVisible().catch(() => false)) await passwordToggle.click();

    await page.getByPlaceholder(/password/i).first().fill('definitely-not-the-password');
    await page.getByRole('button', { name: /sign in|continue|log ?in/i }).first().click();

    await expect(page.getByText(/invalid|incorrect|credential/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/signin/);
  });

  test('the email code screen offers resend and shows expiry', async ({ page }) => {
    await page.goto('/signin');
    await page.getByPlaceholder(/organization email/i).fill(user.email);
    await page.getByRole('button', { name: /continue/i }).first().click();

    await expect(page.getByPlaceholder('000000')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/code expires in/i)).toBeVisible();

    // Resend is rate limited immediately after a send, so the button shows a
    // countdown rather than letting a user hammer Supabase.
    await expect(page.getByRole('button', { name: /resend in \d+s/i })).toBeVisible();
  });

  test('an invalid code is rejected with a clear message', async ({ page }) => {
    await page.goto('/signin');
    await page.getByPlaceholder(/organization email/i).fill(user.email);
    await page.getByRole('button', { name: /continue/i }).first().click();

    await page.getByPlaceholder('000000').fill('000000');

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/signin/);
  });

  test('the code screen can return to email entry', async ({ page }) => {
    await page.goto('/signin');
    await page.getByPlaceholder(/organization email/i).fill(user.email);
    await page.getByRole('button', { name: /continue/i }).first().click();

    await page.getByRole('button', { name: /change email/i }).click();
    await expect(page.getByPlaceholder(/organization email/i)).toBeVisible();
  });

  test('Google sign-in is offered and starts a real OAuth round trip', async ({ page }) => {
    await page.goto('/signin');

    const googleButton = page.getByRole('button', { name: /continue with google/i });
    await expect(googleButton).toBeVisible();

    // Either Supabase redirects to Google, or it reports the provider is not
    // configured. Both prove the button is wired to signInWithOAuth rather
    // than being decorative; a silent no-op would fail this.
    const [navigation] = await Promise.all([
      page.waitForURL(/accounts\.google\.com|\/signin/, { timeout: 20_000 }).catch(() => null),
      googleButton.click(),
    ]);

    const redirected = page.url().includes('accounts.google.com');
    const reportedError = await page.getByRole('alert').isVisible().catch(() => false);

    expect(redirected || reportedError, 'the Google button did nothing at all').toBe(true);
    void navigation;
  });

  test('the OAuth callback route exists and does not crash', async ({ page }) => {
    await page.goto('/auth/callback?error=access_denied&error_description=User+denied+access');

    // A declined consent screen must land somewhere explicable.
    await expect(page.getByText(/sign-in failed|back to sign in/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
