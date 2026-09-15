import * as React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ADMIN_TABS } from './AdminShell';
import { useOrganization } from '../../contexts/OrganizationContext';

/**
 * Admin chrome.
 *
 * The route itself is guarded by RoleRoute; this component only renders the
 * navigation. Nothing here is a security boundary — the server rejects an
 * admin API call from a non-admin regardless of what the UI shows.
 */
export const AdminLayout: React.FC = () => {
  const { activeOrganization, role } = useOrganization();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-end justify-between gap-6 mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-black text-white uppercase italic tracking-tight">
            Admin<span className="text-gold-500">.</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1.5">
            {activeOrganization?.name} · {role}
          </p>
        </div>

        <nav className="flex items-center gap-1 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto">
          {ADMIN_TABS.map(tab => (
            <NavLink
              key={tab.id}
              to={tab.path}
              // `end` on the index route stops it matching every child path.
              end={tab.path === '/admin'}
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
