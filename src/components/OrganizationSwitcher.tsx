import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Plus, Building2 } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { ROLE_LABELS } from '../lib/authorization';
import type { OrgRole } from '../../database.types';

/**
 * Active-organisation selector.
 *
 * Switching swaps the tenant every query is scoped to. Data is re-fetched
 * rather than merged, so records from two organisations can never coexist
 * in the same view.
 */
export const OrganizationSwitcher: React.FC<{ onCreateNew?: () => void }> = ({ onCreateNew }) => {
  const navigate = useNavigate();

  // Creating another workspace is always offered, so a user is never stuck
  // inside one organisation with no way to start a second.
  const createNew = onCreateNew ?? (() => navigate('/organization/create'));
  const { memberships, activeOrganization, role, setActiveOrganization } = useOrganization();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!activeOrganization) return null;

  const multiple = memberships.length > 1;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-gold-500/50 transition-all group max-w-[240px]"
        title={activeOrganization.name}
      >
        <div className="w-6 h-6 rounded-lg bg-gold-500/10 border border-gold-500/30 flex items-center justify-center shrink-0">
          <Building2 className="w-3 h-3 text-gold-500" />
        </div>
        <div className="text-left min-w-0">
          <p className="text-[10px] font-black text-white uppercase tracking-tight truncate">
            {activeOrganization.name}
          </p>
          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">
            {role ? ROLE_LABELS[role as OrgRole] : '—'}
          </p>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-[200]">
          <div className="px-4 py-2.5 border-b border-slate-800">
            <p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.3em]">
              {multiple ? `${memberships.length} organisations` : 'Organisation'}
            </p>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {memberships.map(({ organization, membership }) => {
              const isActive = organization.id === activeOrganization.id;
              return (
                <button
                  key={organization.id}
                  onClick={() => {
                    setActiveOrganization(organization.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isActive ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-black text-gold-500">
                      {organization.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate">{organization.name}</p>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      {ROLE_LABELS[membership.role as OrgRole]}
                    </p>
                  </div>
                  {isActive && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                </button>
              );
            })}
          </div>

          {(
            <button
              onClick={() => {
                setOpen(false);
                createNew();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 border-t border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/40 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg border border-dashed border-slate-700 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest">Create organisation</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
