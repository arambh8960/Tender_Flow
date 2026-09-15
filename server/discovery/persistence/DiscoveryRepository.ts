import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DiscoveryStatus } from '../../../database.types';
import type { NormalizedTender } from '../normalization/types';
import type { QualificationResult } from '../qualification/TenderQualifier';

/**
 * Discovery persistence, always organisation-scoped.
 *
 * Takes the Supabase client as a constructor argument so callers choose the
 * privilege level. Pass a userClient(jwt) and RLS enforces tenancy for you;
 * pass a serviceClient and you are responsible for it — which is why
 * organizationId is a required constructor argument and is stamped onto
 * every write here rather than being left to the caller.
 */
export class DiscoveryRepository {
  constructor(
    private client: SupabaseClient<Database>,
    private organizationId: string
  ) {}

  async createRun(portal: string, criteria: unknown, triggeredBy: string | null): Promise<string> {
    const { data, error } = await this.client
      .from('discovery_runs')
      .insert({
        organization_id: this.organizationId,
        portal,
        criteria: criteria as never,
        status: 'running',
        started_at: new Date().toISOString(),
        triggered_by: triggeredBy,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Could not create discovery run: ${error.message}`);
    return data.id;
  }

  async completeRun(
    runId: string,
    status: DiscoveryStatus,
    counts: {
      totalFound: number;
      totalNormalized: number;
      totalDuplicates: number;
      totalExpired: number;
      totalCandidates: number;
      totalQualified: number;
    },
    errors: { scope: string; message: string; kind?: string }[]
  ): Promise<void> {
    const { error } = await this.client
      .from('discovery_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        total_found: counts.totalFound,
        total_normalized: counts.totalNormalized,
        total_duplicates: counts.totalDuplicates,
        total_expired: counts.totalExpired,
        total_candidates: counts.totalCandidates,
        total_qualified: counts.totalQualified,
        error_message: errors.length ? errors.map(e => `${e.scope}: ${e.message}`).join(' | ') : null,
        errors: errors as never,
      })
      .eq('id', runId)
      .eq('organization_id', this.organizationId);

    if (error) throw new Error(`Could not finalise discovery run: ${error.message}`);
  }

  async failRun(runId: string, message: string): Promise<void> {
    await this.client
      .from('discovery_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: message })
      .eq('id', runId)
      .eq('organization_id', this.organizationId);
  }

  /**
   * Upserts a tender on (organization_id, portal, external_id).
   * Returns its id and whether this run saw it for the first time.
   */
  async upsertTender(tender: NormalizedTender, runId: string): Promise<{ id: string; isNew: boolean }> {
    const existing = await this.client
      .from('tenders')
      .select('id')
      .eq('organization_id', this.organizationId)
      .eq('portal', tender.portal)
      .eq('external_id', tender.externalId)
      .maybeSingle();

    const isNew = !existing.data;

    const { data, error } = await this.client
      .from('tenders')
      .upsert(
        {
          organization_id: this.organizationId,
          portal: tender.portal,
          external_id: tender.externalId,
          title: tender.title,
          description: tender.description ?? null,
          buyer: tender.buyer ?? null,
          category: tender.category ?? null,
          subcategory: tender.subcategory ?? null,
          location: tender.location ?? null,
          latitude: tender.latitude ?? null,
          longitude: tender.longitude ?? null,
          tender_url: tender.tenderUrl ?? null,
          published_at: tender.publishedAt ?? null,
          closing_at: tender.closingAt ?? null,
          estimated_value: tender.estimatedValue ?? null,
          emd_amount: tender.emdAmount ?? null,
          emd_required: tender.emdRequired ?? null,
          raw_payload: tender.sourceMetadata as never,
          parse_warnings: tender.parseWarnings,
          first_seen_run: isNew ? runId : undefined,
          last_seen_at: new Date().toISOString(),
        } as never,
        { onConflict: 'organization_id,portal,external_id' }
      )
      .select('id')
      .single();

    if (error) throw new Error(`Could not persist tender ${tender.externalId}: ${error.message}`);

    await this.client
      .from('discovery_run_tenders')
      .upsert({ run_id: runId, tender_id: data.id, is_new: isNew }, { onConflict: 'run_id,tender_id' });

    return { id: data.id, isNew };
  }

  async saveQualification(tenderId: string, runId: string, result: QualificationResult): Promise<void> {
    const { error } = await this.client.from('tender_qualifications').upsert(
      {
        organization_id: this.organizationId,
        tender_id: tenderId,
        run_id: runId,
        ...result.scores,
        status: result.isQualified ? 'qualified' : 'rejected',
        is_qualified: result.isQualified,
        reason: result.reason,
        breakdown: result.breakdown as never,
      } as never,
      { onConflict: 'tender_id,run_id' }
    );

    if (error) throw new Error(`Could not persist qualification: ${error.message}`);
  }

  /** Inventory for THIS organisation. Never a global or demo catalogue. */
  async loadInventory() {
    const { data, error } = await this.client
      .from('inventory_items')
      .select('*, warehouses(*)')
      .eq('organization_id', this.organizationId)
      .eq('is_active', true);

    if (error) throw new Error(`Could not load inventory: ${error.message}`);
    return data ?? [];
  }

  async loadDiscoverySettings() {
    const { data } = await this.client
      .from('organization_discovery_settings')
      .select('*')
      .eq('organization_id', this.organizationId)
      .maybeSingle();
    return data;
  }

  async loadValidCertificateNames(): Promise<string[]> {
    const { data } = await this.client
      .from('compliance_documents')
      .select('cert_name')
      .eq('organization_id', this.organizationId)
      .eq('is_valid', true);
    return (data ?? []).map(r => r.cert_name);
  }
}
