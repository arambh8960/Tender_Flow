import { supabase } from '../client';
import { unwrap, unwrapList, unwrapMaybe } from './base';
import type { Tables, DiscoveryStatus } from '../../../../database.types';

export type DiscoveryRun = Tables<'discovery_runs'>;
export type TenderRow = Tables<'tenders'>;
export type QualificationRow = Tables<'tender_qualifications'>;

export interface RunWithCounts extends DiscoveryRun {
  duration_seconds: number | null;
}

function withDuration(run: DiscoveryRun): RunWithCounts {
  const duration =
    run.started_at && run.completed_at
      ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
      : null;
  return { ...run, duration_seconds: duration };
}

export const DiscoveryRepository = {
  async listRuns(organizationId: string, limit = 25): Promise<RunWithCounts[]> {
    const rows = unwrapList(
      await supabase
        .from('discovery_runs')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit)
    );
    return rows.map(withDuration);
  },

  async getRun(runId: string): Promise<RunWithCounts | null> {
    const row = unwrapMaybe(await supabase.from('discovery_runs').select('*').eq('id', runId).single());
    return row ? withDuration(row) : null;
  },

  /** Tenders discovered by one run, with their qualification result. */
  async listRunTenders(runId: string) {
    const res = await supabase
      .from('discovery_run_tenders')
      .select('is_new, tenders(*)')
      .eq('run_id', runId);
    return unwrapList(res as { data: any[] | null; error: any });
  },

  async listTenders(organizationId: string, limit = 100): Promise<TenderRow[]> {
    return unwrapList(
      await supabase
        .from('tenders')
        .select('*')
        .eq('organization_id', organizationId)
        .order('closing_at', { ascending: true, nullsFirst: false })
        .limit(limit)
    );
  },

  async getQualifications(organizationId: string, tenderIds: string[]): Promise<QualificationRow[]> {
    if (tenderIds.length === 0) return [];
    return unwrapList(
      await supabase
        .from('tender_qualifications')
        .select('*')
        .eq('organization_id', organizationId)
        .in('tender_id', tenderIds)
    );
  },

  async runStatusCounts(organizationId: string): Promise<Record<DiscoveryStatus, number>> {
    const rows = unwrapList(
      await supabase.from('discovery_runs').select('status').eq('organization_id', organizationId)
    );
    const counts = {} as Record<DiscoveryStatus, number>;
    for (const r of rows) counts[r.status as DiscoveryStatus] = (counts[r.status as DiscoveryStatus] ?? 0) + 1;
    return counts;
  },
};

export const TenderRepository = {
  async getById(tenderId: string): Promise<TenderRow | null> {
    return unwrapMaybe(await supabase.from('tenders').select('*').eq('id', tenderId).single());
  },

  async listAnalyses(organizationId: string, limit = 50): Promise<Tables<'tender_analyses'>[]> {
    return unwrapList(
      await supabase
        .from('tender_analyses')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit)
    );
  },

  async saveAnalysis(
    organizationId: string,
    payload: Omit<Tables<'tender_analyses'>, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
  ): Promise<Tables<'tender_analyses'>> {
    return unwrap(
      await supabase
        .from('tender_analyses')
        .insert({ ...payload, organization_id: organizationId } as never)
        .select()
        .single()
    );
  },
};

export const DiscoverySettingsRepository = {
  async get(organizationId: string): Promise<Tables<'organization_discovery_settings'> | null> {
    return unwrapMaybe(
      await supabase
        .from('organization_discovery_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .single()
    );
  },

  async upsert(organizationId: string, patch: Partial<Tables<'organization_discovery_settings'>>) {
    return unwrap(
      await supabase
        .from('organization_discovery_settings')
        .upsert({ ...patch, organization_id: organizationId } as never, { onConflict: 'organization_id' })
        .select()
        .single()
    );
  },
};

export const ComplianceRepository = {
  async list(organizationId: string): Promise<Tables<'compliance_documents'>[]> {
    return unwrapList(
      await supabase
        .from('compliance_documents')
        .select('*')
        .eq('organization_id', organizationId)
        .order('cert_name')
    );
  },
};

export const ProjectRepository = {
  async list(organizationId: string): Promise<Tables<'projects'>[]> {
    return unwrapList(
      await supabase.from('projects').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false })
    );
  },
};
