import * as React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Header } from './components/Header';
import { HelperBot } from './components/Helperbot';
import { useAuth } from './contexts/AuthContext';
import { useOrganization } from './contexts/OrganizationContext';
import type { View } from '../types';

/**
 * Application shell.
 *
 * This used to be a 500-line state container: the RFP list, the config
 * object, the inventory array, the discovery results, the processing
 * pipeline and the view switch all lived here, seeded from data/*.ts at
 * module scope. Data now comes from hooks over the API, navigation is
 * handled by the router, and this component is chrome.
 */

/** Maps the header's view ids to routes, keeping the existing Header API. */
const VIEW_ROUTES: Record<string, string> = {
  frontpage: '/dashboard',
  discovery: '/discovery',
  store: '/inventory',
  config: '/settings',
  vault: '/vault',
  logs: '/logs',
  rfps: '/rfps',
  organization: '/organization',
};

function viewForPath(pathname: string): View {
  // Checked before /settings so /organization/settings is not mistaken for
  // the operator's personal settings screen.
  if (pathname.startsWith('/organization')) return 'organization';
  if (pathname.startsWith('/discovery')) return 'discovery';
  if (pathname.startsWith('/inventory')) return 'store';
  if (pathname.startsWith('/vault')) return 'vault';
  if (pathname.startsWith('/settings')) return 'config';
  if (pathname.startsWith('/logs')) return 'logs';
  if (pathname.startsWith('/rfps')) return 'rfps';
  return 'frontpage';
}

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const { user, profile } = useAuth();
  const { activeOrganization, role, can } = useOrganization();

  return (
    <div className="h-screen w-full bg-slate-950 flex flex-col overflow-hidden font-sans">
      <Header
        currentView={viewForPath(location.pathname)}
        setCurrentView={view => navigate(VIEW_ROUTES[view] ?? '/dashboard')}
        organizationName={activeOrganization?.name ?? ''}
        userName={profile?.full_name ?? user?.email ?? 'Operator'}
        role={role}
      />

      {/* Admin is a separate area, surfaced only to those who can use it. */}
      {can('members:manage') && !location.pathname.startsWith('/admin') && (
        <button
          onClick={() => navigate('/admin')}
          className="absolute top-[70px] right-8 z-[110] px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-gold-500/60 transition"
        >
          Admin
        </button>
      )}

      <main className="flex-grow relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gold-500/5 blur-[150px] rounded-full pointer-events-none" />
        <div className="h-full w-full p-8 relative z-10 overflow-hidden">
          <Outlet />
        </div>
      </main>

      <HelperBot currentRfp={null} />

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

export default App;
