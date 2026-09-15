import * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { AgentName, LogEntry } from '../../types';

/**
 * In-session operational log for the Terminal screen.
 *
 * Deliberately ephemeral and clearly separate from the audit trail: this is
 * running commentary for the person watching, while the durable record of
 * what happened lives in audit_logs and analysis_runs on the server. Nothing
 * in here is a source of truth, and nothing here fabricates progress — every
 * entry is written by real code at the moment it runs.
 */

interface ActivityLogValue {
  logs: LogEntry[];
  addLog: (agent: AgentName | 'SYSTEM', message: string, data?: unknown) => void;
  clear: () => void;
  since: (start: Date | null) => LogEntry[];
}

const ActivityLogContext = createContext<ActivityLogValue | undefined>(undefined);

const MAX_ENTRIES = 500;

export const ActivityLogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((agent: AgentName | 'SYSTEM', message: string, data?: unknown) => {
    setLogs(previous => {
      const next = [
        ...previous,
        {
          timestamp: new Date(),
          agent,
          message,
          data: data ? JSON.stringify(data, null, 2) : undefined,
        },
      ];
      // Bounded: a long session should not grow this array without limit.
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  const value = useMemo<ActivityLogValue>(
    () => ({
      logs,
      addLog,
      clear: () => setLogs([]),
      since: (start: Date | null) => (start ? logs.filter(entry => entry.timestamp >= start) : logs),
    }),
    [logs, addLog]
  );

  return <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>;
};

export function useActivityLog(): ActivityLogValue {
  const context = useContext(ActivityLogContext);
  if (!context) throw new Error('useActivityLog must be used inside <ActivityLogProvider>');
  return context;
}
