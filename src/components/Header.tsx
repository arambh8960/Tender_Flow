import * as React from 'react';
import { Logo } from './Logo';
import { View } from '../../types';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { useOrganization } from '../contexts/OrganizationContext';
import { ROLE_LABELS, type ModuleKey } from '../lib/authorization';
import type { OrgRole } from '../../database.types';

interface HeaderProps {
  currentView: View;
  setCurrentView: (view: View) => void;
  organizationName: string;
  userName: string;
  role: OrgRole | null;
}

/**
 * Navigation is driven by the organisation's enabled modules, so two tenants
 * on the same deployment can expose different feature sets without a
 * separate build. Items with no module gate are always shown.
 */
const NAV: { id: View; label: string; module?: ModuleKey }[] = [
  { id: 'frontpage', label: 'Dashboard' },
  { id: 'discovery', label: 'Discovery', module: 'tender_discovery' },
  { id: 'rfps', label: 'RFPs', module: 'tender_analysis' },
  { id: 'store', label: 'Inventory', module: 'inventory' },
  { id: 'vault', label: 'Vault', module: 'compliance' },
  // Organisation is the company's own identity and configuration, separate
  // from the operator's personal settings.
  { id: 'organization', label: 'Organisation' },
  { id: 'config', label: 'Settings' },
  { id: 'logs', label: 'Terminal' },
];

export const Header: React.FC<HeaderProps> = ({
  currentView,
  setCurrentView,
  organizationName,
  userName,
  role,
}) => {
  const { isModuleEnabled } = useOrganization();

  const navItems = NAV.filter(item => !item.module || isModuleEnabled(item.module));

  return (
    <header className="bg-slate-950 sticky top-0 z-[100] px-8 py-4 border-b border-slate-800 flex justify-between items-center shadow-2xl backdrop-blur-md bg-opacity-90">
      {/* 1. BRANDING */}
      <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setCurrentView('frontpage')}>
        <Logo />
        <div className="flex flex-col">
          <h1 className="text-2xl font-black tracking-tighter text-white uppercase italic leading-none">
            Tender<span className="text-gold-500">Flow</span>
          </h1>
          <span className="text-[8px] font-black text-slate-500 uppercase tracking-[0.4em] mt-1 ml-0.5 truncate max-w-[180px]">
            {organizationName}
          </span>
        </div>
      </div>

      {/* 2. NAVIGATION */}
      <nav className="flex items-center gap-1 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            className={`px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all duration-300 ${
              currentView === item.id
                ? 'bg-gold-500 shadow-[0_0_15px_rgba(212,175,55,0.3)] scale-105'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* 3. TENANT + OPERATOR */}
      <div className="hidden md:flex items-center gap-3">
        <OrganizationSwitcher />

        <div
          onClick={() => setCurrentView('config')}
          className="flex items-center gap-3 pl-3 border-l border-slate-800 cursor-pointer group hover:bg-slate-900/50 p-2 rounded-xl transition-all"
        >
          <div className="text-right">
            <p className="text-[9px] font-black text-white uppercase tracking-tighter group-hover:text-gold-500 transition-colors truncate max-w-[140px]">
              {userName}
            </p>
            <p className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest">
              {role ? ROLE_LABELS[role] : 'Operator'}
            </p>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs group-hover:border-gold-500/50 transition-all">
            {userName.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>
    </header>
  );
};
