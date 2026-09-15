import * as React from 'react';
import { useAuditLog } from '../../hooks/useAdmin';
import { Panel, Spinner, ErrorNote, EmptyState, ghostButtonClass, inputClass } from './AdminShell';
import { describeAction } from './AdminOverviewPage';

/**
 * Persistent audit history.
 *
 * Server-side pagination: an active workspace accumulates thousands of
 * entries, and loading them all to filter in the browser would be both slow
 * and pointless.
 */

const ACTION_GROUPS = [
  { value: '', label: 'All activity' },
  { value: 'inventory.created', label: 'Inventory created' },
  { value: 'inventory.stock_adjusted', label: 'Stock adjusted' },
  { value: 'document.uploaded', label: 'Document uploaded' },
  { value: 'document.downloaded', label: 'Document downloaded' },
  { value: 'discovery.completed', label: 'Discovery completed' },
  { value: 'discovery.failed', label: 'Discovery failed' },
  { value: 'rfp.processed', label: 'RFP processed' },
  { value: 'rfp.failed', label: 'RFP failed' },
  { value: 'member.invited', label: 'Member invited' },
  { value: 'member.role_changed', label: 'Role changed' },
  { value: 'organization.settings_updated', label: 'Settings changed' },
  { value: 'security.url_blocked', label: 'Blocked URL' },
  { value: 'security.upload_rejected', label: 'Rejected upload' },
];

export const AdminAuditPage: React.FC = () => {
  const { entries, total, offset, pageSize, loading, error, actionFilter, setActionFilter, next, previous } =
    useAuditLog(50);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <Panel
        title="Audit log"
        subtitle={`${total} recorded event(s)`}
        action={
          <select
            value={actionFilter ?? ''}
            onChange={e => setActionFilter(e.target.value || undefined)}
            className={`${inputClass} w-56`}
          >
            {ACTION_GROUPS.map(group => (
              <option key={group.value} value={group.value}>
                {group.label}
              </option>
            ))}
          </select>
        }
      >
        {loading && entries.length === 0 ? (
          <Spinner label="Loading audit log" />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded"
            message="Configuration changes, inventory edits, document access, discovery runs and tender processing all appear here once they happen."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                    <th className="pb-3 pr-4">When</th>
                    <th className="pb-3 pr-4">Action</th>
                    <th className="pb-3 pr-4">Actor</th>
                    <th className="pb-3 pr-4">Entity</th>
                    <th className="pb-3">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.id} className="border-t border-slate-800/60 align-top">
                      <td className="py-3 pr-4 text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString('en-GB')}
                      </td>
                      <td className="py-3 pr-4 text-[11px] text-slate-200">{describeAction(entry.action)}</td>
                      <td className="py-3 pr-4 text-[11px] text-slate-400">{entry.actorName ?? 'System'}</td>
                      <td className="py-3 pr-4 text-[10px] text-slate-500 font-mono truncate max-w-[180px]">
                        {entry.entity_type ? `${entry.entity_type}${entry.entity_id ? `/${entry.entity_id}` : ''}` : '—'}
                      </td>
                      <td className="py-3 text-[10px] text-slate-500 max-w-sm">
                        {Object.keys(entry.metadata ?? {}).length > 0 ? (
                          <code className="break-words">{JSON.stringify(entry.metadata)}</code>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-5">
              <span className="text-[10px] text-slate-600 tabular-nums">
                Showing {from}–{to} of {total}
              </span>
              <div className="space-x-2">
                <button onClick={previous} disabled={offset === 0} className={ghostButtonClass}>
                  Previous
                </button>
                <button onClick={next} disabled={to >= total} className={ghostButtonClass}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
};
