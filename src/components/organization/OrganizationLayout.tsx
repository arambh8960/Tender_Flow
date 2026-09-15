import * as React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useOrganization } from '../../contexts/OrganizationContext';
import { ROLE_LABELS } from '../../lib/authorization';

/**
 * Organisation section chrome.
 *
 * Distinct from Admin on purpose: this is the company's own identity and
 * configuration, which any member may read, while Admin is about operating
 * the workspace and is role-gated.
 */
const TABS = [
  { label: 'Profile', path: '/organization', end: true },
  { label: 'Settings', path: '/organization/settings', end: false },
  { label: 'Members', path: '/organization/members', end: false },
  { label: 'Invitations', path: '/organization/invitations', end: false },
];

export const OrganizationLayout: React.FC = () => {
  const { activeOrganization, role } = useOrganization();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-end justify-between gap-6 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-black text-white uppercase italic tracking-tight">
            Organisation<span className="text-gold-500">.</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1.5">
            {activeOrganization?.name} · {role ? ROLE_LABELS[role] ?? role : ''}
          </p>
        </div>

        <nav className="flex items-center gap-1 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto">
          {TABS.map(tab => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.end}
              className={({ isActive }) =>
                `px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-gold-500 text-slate-950 shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide pb-8">
        <Outlet />
      </div>
    </div>
  );
};
