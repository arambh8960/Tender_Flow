import * as React from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrganization } from '../contexts/OrganizationContext';
import { can, type Permission } from '../lib/authorization';
import { ROLE_LABELS } from '../lib/authorization';

/**
 * Route guards.
 *
 * These control what is rendered, not what is permitted. Every protected
 * action is independently authorised on the server, because a route guard
 * lives in code the user controls.
 *
 * Every state below renders something explicit. There is deliberately no path
 * that returns null or leaves a spinner with no exit: a signed-in user who
 * sees nothing cannot tell a slow network from a broken app, and has no way
 * to recover either.
 */

export const BootSplash: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-[100dvh] w-full bg-slate-950 flex flex-col items-center justify-center gap-4 font-sans">
    <div className="w-10 h-10 border-2 border-slate-800 border-t-gold-500 rounded-full animate-spin" />
    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">{label}</p>
  </div>
);

/** A dead end the user can act on, rather than a spinner that never resolves. */
export const BootError: React.FC<{
  title: string;
  message: string;
  onRetry?: () => void;
  onSignOut?: () => void;
}> = ({ title, message, onRetry, onSignOut }) => (
  <div className="h-[100dvh] w-full bg-slate-950 flex items-center justify-center px-6 font-sans">
    <div className="max-w-md text-center space-y-6">
      <h1 className="text-lg font-black text-white uppercase tracking-tight">{title}</h1>
      <p className="text-[12px] text-slate-400 leading-relaxed">{message}</p>
      <div className="flex items-center justify-center gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition"
          >
            Try again
          </button>
        )}
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  </div>
);

/** Requires a Supabase session. */
export const AuthedRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { initializing, isAuthenticated } = useAuth();
  const location = useLocation();

  if (initializing) return <BootSplash label="Restoring session" />;
  if (!isAuthenticated) {
    // Remember where they were heading so sign-in can return them there.
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  return <>{children ?? <Outlet />}</>;
};

/**
 * Lets the user pick which workspace to open.
 *
 * Reached only when someone belongs to several organisations and has not
 * chosen one this session. Choosing silently on their behalf is worse than
 * asking: the first row is arbitrary, and the workspaces hold different data.
 */
const OrganizationChooser: React.FC = () => {
  const { memberships, setActiveOrganization } = useOrganization();
  const { signOut } = useAuth();

  return (
    <div className="h-[100dvh] w-full bg-slate-950 flex items-center justify-center px-6 font-sans">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-black text-white uppercase italic tracking-tight">
            Choose a workspace<span className="text-gold-500">.</span>
          </h1>
          <p className="text-[11px] text-slate-500">You belong to {memberships.length} organisations.</p>
        </div>

        <div className="space-y-2">
          {memberships.map(({ organization, membership }) => (
            <button
              key={organization.id}
              onClick={() => setActiveOrganization(organization.id)}
              className="w-full text-left bg-slate-900/50 border border-slate-800 rounded-2xl px-5 py-4 hover:border-gold-500/50 transition-colors"
            >
              <p className="text-sm font-bold text-white truncate">{organization.name}</p>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">
                {ROLE_LABELS[membership.role as keyof typeof ROLE_LABELS] ?? membership.role}
              </p>
            </button>
          ))}
        </div>

        <button
          onClick={() => void signOut()}
          className="w-full text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};

/**
 * Requires an active organisation.
 *
 * The four outcomes are distinct and each has its own screen: still loading,
 * the lookup failed, the user has no organisation, or several and none
 * chosen. Collapsing any of them into a bare spinner is what left a
 * signed-in user staring at nothing.
 */
export const OrganizationRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { loading, activeOrganization, needsOnboarding, needsOrganizationChoice, loadFailed, error, refresh } =
    useOrganization();
  const { signOut } = useAuth();

  if (loading) return <BootSplash label="Loading your TenderFlow workspace" />;

  if (loadFailed) {
    return (
      <BootError
        title="Could not load your workspace"
        message={
          error ??
          'We could not reach the service that knows which organisations you belong to. Check your connection and try again.'
        }
        onRetry={() => void refresh()}
        onSignOut={() => void signOut()}
      />
    );
  }

  // The gateway is the single place that decides what a user without an
  // active organisation should see next.
  if (needsOnboarding) return <Navigate to="/workspace" replace />;
  if (needsOrganizationChoice) return <OrganizationChooser />;

  if (!activeOrganization) {
    // Reachable only if state goes inconsistent; previously an inescapable
    // spinner, now something the user can act on.
    return (
      <BootError
        title="No workspace selected"
        message="Your session is valid but no organisation is active. Reloading usually resolves this."
        onRetry={() => void refresh()}
        onSignOut={() => void signOut()}
      />
    );
  }

  return <>{children ?? <Outlet />}</>;
};

/**
 * Keeps onboarding reachable only while it is the right screen.
 *
 * Without this, a user who already has a workspace could sit on /onboarding
 * indefinitely — which is exactly what happened after creating an
 * organisation, because nothing re-evaluated the route.
 */
export const OnboardingRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { loading, activeOrganization, loadFailed, error, refresh } = useOrganization();
  const { signOut } = useAuth();

  /**
   * Whether a workspace already existed when this route was first entered.
   *
   * The distinction matters: someone who ALREADY had an organisation has no
   * business on onboarding and is redirected. Someone who creates one WHILE
   * here must stay, because the remaining steps (company profile, procurement
   * defaults) come after creation — redirecting on the state change would
   * skip them. Onboarding navigates away itself when the user is done.
   */
  const hadOrganizationOnEntry = React.useRef<boolean | null>(null);

  if (loading) return <BootSplash label="Loading your TenderFlow workspace" />;

  if (loadFailed) {
    return (
      <BootError
        title="Could not load your workspace"
        message={error ?? 'We could not check which organisations you belong to.'}
        onRetry={() => void refresh()}
        onSignOut={() => void signOut()}
      />
    );
  }

  // Recorded once, on the first settled render.
  if (hadOrganizationOnEntry.current === null) {
    hadOrganizationOnEntry.current = Boolean(activeOrganization);
  }

  if (hadOrganizationOnEntry.current) return <Navigate to="/dashboard" replace />;

  return <>{children ?? <Outlet />}</>;
};

/** Requires a permission from the authorization table. */
export const RoleRoute: React.FC<{ permission: Permission; children?: React.ReactNode }> = ({
  permission,
  children,
}) => {
  const { role, loading } = useOrganization();
  const navigate = useNavigate();

  if (loading) return <BootSplash label="Checking permissions" />;

  if (!can(role, permission)) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-sm font-black text-slate-300 uppercase tracking-widest">Not available to your role</p>
          <p className="text-[12px] text-slate-500 mt-3 leading-relaxed">
            Your role in this workspace does not include this area. An owner or admin can change that from the Users
            screen.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="mt-6 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
};
