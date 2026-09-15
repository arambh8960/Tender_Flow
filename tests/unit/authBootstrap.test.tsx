// @vitest-environment jsdom
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Post-authentication bootstrap.
 *
 * The bug these lock down: a signed-in user could reach a screen that
 * rendered nothing — no spinner they could interpret, no error they could
 * act on, and no route out. Every state below must produce something
 * explicit, and the guards must send the user to the right one.
 *
 * The contexts are stubbed rather than driven through Supabase, because the
 * subject here is the decision tree, not the network.
 */

type AuthStub = {
  initializing?: boolean;
  isAuthenticated?: boolean;
  signOut?: () => void;
};

type OrgStub = {
  loading?: boolean;
  loadFailed?: boolean;
  error?: string | null;
  activeOrganization?: { id: string; name: string } | null;
  memberships?: { organization: { id: string; name: string }; membership: { role: string } }[];
  needsOnboarding?: boolean;
  needsOrganizationChoice?: boolean;
  role?: string | null;
  refresh?: () => void;
  setActiveOrganization?: (id: string) => void;
};

const authState: Required<AuthStub> = { initializing: false, isAuthenticated: true, signOut: () => undefined };
const orgState: OrgStub = {};

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../src/contexts/OrganizationContext', () => ({
  useOrganization: () => ({
    loading: false,
    loadFailed: false,
    error: null,
    activeOrganization: null,
    memberships: [],
    needsOnboarding: false,
    needsOrganizationChoice: false,
    role: 'owner',
    refresh: () => undefined,
    setActiveOrganization: () => undefined,
    ...orgState,
  }),
}));

function setAuth(next: AuthStub) {
  Object.assign(authState, next);
}

function setOrg(next: OrgStub) {
  for (const key of Object.keys(orgState)) delete (orgState as Record<string, unknown>)[key];
  Object.assign(orgState, next);
}

afterEach(() => {
  cleanup();
  setAuth({ initializing: false, isAuthenticated: true });
  setOrg({});
});

/** Renders the guard under test with a recognisable workspace behind it. */
async function renderGuard(initialPath = '/dashboard') {
  const { AuthedRoute, OrganizationRoute, OnboardingRoute } = await import('../../src/routes/guards');

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/signin" element={<div>SIGN IN SCREEN</div>} />
        {/* The gateway is where a signed-in user with no active organisation
            is sent; it decides between creating, joining and opening one. */}
        <Route path="/workspace" element={<div>WORKSPACE GATEWAY</div>} />
        <Route element={<AuthedRoute />}>
          <Route element={<OnboardingRoute />}>
            <Route path="/onboarding" element={<div>ONBOARDING SCREEN</div>} />
          </Route>
          <Route element={<OrganizationRoute />}>
            <Route path="/dashboard" element={<div>TENDERFLOW WORKSPACE</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

/** Nothing rendered at all is the failure mode under test. */
function expectSomethingRendered(container: HTMLElement) {
  expect(container.textContent?.trim(), 'the guard rendered a blank screen').not.toBe('');
}

describe('bootstrap — no state renders blank', () => {
  it('1. session still restoring shows a loading state', async () => {
    setAuth({ initializing: true });
    const { container } = await renderGuard();

    expect(screen.getByText(/restoring session/i)).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('2. organisations still loading names the TenderFlow workspace', async () => {
    setOrg({ loading: true });
    const { container } = await renderGuard();

    expect(screen.getByText(/loading your tenderflow workspace/i)).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('3. unauthenticated goes to sign-in, never to a blank page', async () => {
    setAuth({ isAuthenticated: false });
    const { container } = await renderGuard();

    expect(screen.getByText('SIGN IN SCREEN')).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('4. authenticated with zero organisations lands on the workspace gateway', async () => {
    setOrg({ needsOnboarding: true, memberships: [] });
    const { container } = await renderGuard();

    // The gateway offers create / join / accept-invitation rather than
    // assuming which one the user needs.
    expect(screen.getByText('WORKSPACE GATEWAY')).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('5. authenticated with one organisation opens the workspace', async () => {
    setOrg({ activeOrganization: { id: 'org-1', name: 'Acme' } });
    const { container } = await renderGuard();

    expect(screen.getByText('TENDERFLOW WORKSPACE')).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('6. authenticated with several organisations and no choice shows a selector', async () => {
    setOrg({
      needsOrganizationChoice: true,
      memberships: [
        { organization: { id: 'a', name: 'Alpha Industries' }, membership: { role: 'owner' } },
        { organization: { id: 'b', name: 'Beta Traders' }, membership: { role: 'member' } },
      ],
    });
    const { container } = await renderGuard();

    expect(screen.getByText(/choose a workspace/i)).toBeTruthy();
    expect(screen.getByText('Alpha Industries')).toBeTruthy();
    expect(screen.getByText('Beta Traders')).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('7. a failed organisation lookup shows an error with a retry, not onboarding', async () => {
    setOrg({ loadFailed: true, error: 'Could not reach the service.' });
    const { container } = await renderGuard();

    expect(screen.getByText(/could not load your workspace/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();

    // Critically, a failure must NOT be mistaken for "this user is new".
    expect(screen.queryByText('WORKSPACE GATEWAY')).toBeNull();
    expectSomethingRendered(container);
  });

  it('8. retry actually re-runs the lookup', async () => {
    const refresh = vi.fn();
    setOrg({ loadFailed: true, error: 'Network error', refresh });

    await renderGuard();
    (screen.getByRole('button', { name: /try again/i }) as HTMLButtonElement).click();

    expect(refresh).toHaveBeenCalled();
  });

  it('9. an inconsistent state offers recovery rather than an endless spinner', async () => {
    // No active organisation, but not flagged as new and not failed either.
    setOrg({ activeOrganization: null, needsOnboarding: false, needsOrganizationChoice: false });
    const { container } = await renderGuard();

    expect(screen.getByText(/no workspace selected/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expectSomethingRendered(container);
  });

  it('10. choosing from the selector sets the active organisation', async () => {
    const setActiveOrganization = vi.fn();
    setOrg({
      needsOrganizationChoice: true,
      setActiveOrganization,
      memberships: [
        { organization: { id: 'alpha-id', name: 'Alpha Industries' }, membership: { role: 'owner' } },
        { organization: { id: 'beta-id', name: 'Beta Traders' }, membership: { role: 'member' } },
      ],
    });

    await renderGuard();
    (screen.getByText('Beta Traders').closest('button') as HTMLButtonElement).click();

    expect(setActiveOrganization).toHaveBeenCalledWith('beta-id');
  });
});

describe('onboarding route', () => {
  it('is reachable for a user with no organisation', async () => {
    setOrg({ activeOrganization: null, needsOnboarding: true });
    await renderGuard('/onboarding');

    expect(screen.getByText('ONBOARDING SCREEN')).toBeTruthy();
  });

  it('redirects a user who already has a workspace', async () => {
    // Someone who already belongs somewhere has no business on onboarding.
    setOrg({ activeOrganization: { id: 'org-1', name: 'Acme' } });
    await renderGuard('/onboarding');

    expect(screen.getByText('TENDERFLOW WORKSPACE')).toBeTruthy();
  });

  it('shows the error state rather than onboarding when the lookup failed', async () => {
    setOrg({ loadFailed: true, error: 'boom' });
    await renderGuard('/onboarding');

    expect(screen.getByText(/could not load your workspace/i)).toBeTruthy();
    expect(screen.queryByText('ONBOARDING SCREEN')).toBeNull();
  });

  it('keeps rendering onboarding while a workspace is created mid-flow', async () => {
    // Entering with none, then an organisation appearing, is exactly what
    // happens between "Create" and the remaining setup steps. Redirecting on
    // that change would skip company details and procurement defaults.
    setOrg({ activeOrganization: null, needsOnboarding: true });
    const { rerender } = await renderGuard('/onboarding');

    expect(screen.getByText('ONBOARDING SCREEN')).toBeTruthy();

    setOrg({ activeOrganization: { id: 'new-org', name: 'Just Created' } });
    const { AuthedRoute, OnboardingRoute } = await import('../../src/routes/guards');
    rerender(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route element={<AuthedRoute />}>
            <Route element={<OnboardingRoute />}>
              <Route path="/onboarding" element={<div>ONBOARDING SCREEN</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('ONBOARDING SCREEN')).toBeTruthy();
  });
});
