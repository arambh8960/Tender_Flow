import * as React from 'react';

/**
 * Shared chrome for the admin screens.
 *
 * Kept in the existing dark/gold language deliberately: the admin area is
 * part of the same product, not a bolted-on console with its own look.
 */

export const ADMIN_TABS = [
  { id: 'overview', label: 'Overview', path: '/admin' },
  { id: 'company', label: 'Company', path: '/admin/company' },
  { id: 'users', label: 'Users', path: '/admin/users' },
  { id: 'inventory', label: 'Inventory', path: '/admin/inventory' },
  { id: 'compliance', label: 'Compliance', path: '/admin/compliance' },
  { id: 'discovery', label: 'Discovery', path: '/admin/discovery' },
  { id: 'audit', label: 'Audit', path: '/admin/audit' },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]['id'];

export const Panel: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  subtitle,
  action,
  children,
}) => (
  <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">{title}</h2>
        {subtitle && <p className="text-[11px] text-slate-500 mt-1.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const MetricCard: React.FC<{
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger';
}> = ({ label, value, hint, tone = 'default' }) => {
  const toneClass =
    tone === 'danger' ? 'text-rose-400' : tone === 'warning' ? 'text-amber-400' : 'text-white';

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
      <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.25em]">{label}</p>
      <p className={`text-3xl font-black mt-3 tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-600 mt-2">{hint}</p>}
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; message: string; action?: React.ReactNode }> = ({
  title,
  message,
  action,
}) => (
  <div className="text-center py-12 px-6 border border-dashed border-slate-800 rounded-2xl">
    <p className="text-sm font-black text-slate-300 uppercase tracking-widest">{title}</p>
    <p className="text-[12px] text-slate-500 mt-3 max-w-md mx-auto leading-relaxed">{message}</p>
    {action && <div className="mt-6">{action}</div>}
  </div>
);

export const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3 mb-4">
    <p className="text-[11px] text-rose-300">{message}</p>
  </div>
);

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div className="flex items-center gap-3 py-10 justify-center">
    <div className="w-5 h-5 border-2 border-slate-800 border-t-gold-500 rounded-full animate-spin" />
    <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">{label}</span>
  </div>
);

export const buttonClass =
  'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed';

export const ghostButtonClass =
  'px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed';

export const inputClass =
  'bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[12px] text-white placeholder:text-slate-600 focus:outline-none focus:border-gold-500/60 w-full';
