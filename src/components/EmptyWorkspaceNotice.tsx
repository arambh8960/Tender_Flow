import * as React from 'react';

/**
 * The empty state a brand-new workspace sees.
 *
 * A new company starts genuinely empty — no seeded inventory, no sample
 * tenders, no placeholder company. This is what stands in for that data, and
 * it always says what to do next rather than just reporting the absence.
 */
export const EmptyWorkspaceNotice: React.FC<{
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}> = ({ title, message, actionLabel, onAction, secondaryLabel, onSecondary }) => (
  <div className="h-full flex items-center justify-center">
    <div className="max-w-lg text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl border border-slate-800 bg-slate-900/60 flex items-center justify-center mb-6">
        <div className="w-5 h-5 rounded-md border-2 border-dashed border-gold-500/60" />
      </div>

      <h2 className="text-lg font-black text-white uppercase tracking-tight">{title}</h2>
      <p className="text-[12px] text-slate-400 mt-4 leading-relaxed">{message}</p>

      {(actionLabel || secondaryLabel) && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition"
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  </div>
);
