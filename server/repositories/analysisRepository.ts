import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';

/**
 * RFP persistence.
 *
 * Processing state used to live only in React state, so a refresh mid-run
 * lost the RFP, its status and every agent output. Two tables carry it now:
 *
 *   tender_analyses — the RFP and its latest outputs (what the UI lists)
 *   analysis_runs   — one row per processing attempt (what actually happened)
 *
 * Splitting them means a re-run appends history instead of erasing the
 * previous failure, which is what makes a failed run diagnosable later.
 */

export const ANALYSIS_STATUSES = [
  'Pending',
  'Extracting',
  'Parsing',
  'Processing',
  'Complete',
  'Error',
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * Legal forward transitions. Enforced so a late callback from an abandoned
 * run cannot drag a Complete analysis back to Parsing.
 */
const ALLOWED_TRANSITIONS: Record<AnalysisStatus, AnalysisStatus[]> = {
  Pending: ['Extracting', 'Parsing', 'Error'],
  Extracting: ['Parsing', 'Error'],
  Parsing: ['Processing', 'Error'],
  Processing: ['Complete', 'Error'],
  Complete: [],
  // A failed run may be retried from the beginning.
  Error: ['Pending', 'Extracting', 'Parsing'],
};

export function canTransition(from: AnalysisStatus, to: AnalysisStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CreateAnalysisInput {
  title?: string | null;
  bidNumber?: string | null;
  buyer?: string | null;
  bidType?: string | null;
  closingAt?: string | null;
  source: 'URL' | 'File' | 'Discovery';
  sourceUrl?: string | null;
  fileName?: string | null;
  rawContent?: string | null;
  tenderId?: string | null;
}

export interface AnalysisRecord {
  id: string;
  organization_id: string;
  status: AnalysisStatus;
  title: string | null;
  bid_number: string | null;
  buyer: string | null;
  bid_type: string | null;
  closing_at: string | null;
  source: string | null;
  source_url: string | null;
  file_name: string | null;
  raw_content: string | null;
  parsed_data: unknown;
  technical_analysis: unknown;
  pricing: unknown;
  risk_analysis: unknown;
  processing_seconds: number | null;
  error_message: string | null;
  current_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export class AnalysisRepository {
  constructor(
    private client: SupabaseClient<Database>,
    private organizationId: string
  ) {}

  async create(input: CreateAnalysisInput, userId: string): Promise<AnalysisRecord> {
    const { data, error } = await this.client
      .from('tender_analyses')
      .insert({
        organization_id: this.organizationId,
        tender_id: input.tenderId ?? null,
        title: input.title ?? null,
        bid_number: input.bidNumber ?? null,
        buyer: input.buyer ?? null,
        bid_type: input.bidType ?? null,
        closing_at: input.closingAt ?? null,
        source: input.source,
        source_ref: input.sourceUrl ?? input.fileName ?? null,
        source_url: input.sourceUrl ?? null,
        file_name: input.fileName ?? null,
        raw_content: input.rawContent ?? null,
        status: 'Pending',
        created_by: userId,
      } as never)
      .select('*')
      .single();

    if (error) throw new Error(`Could not create the RFP record: ${error.message}`);
    return data as unknown as AnalysisRecord;
  }

  async get(analysisId: string): Promise<AnalysisRecord | null> {
    const { data, error } = await this.client
      .from('tender_analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('organization_id', this.organizationId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data as unknown as AnalysisRecord) ?? null;
  }

  /**
   * Listing for the RFP screen. Deliberately excludes raw_content and the
   * agent output blobs — loading every historical payload into a list view
   * is how a dashboard becomes unusable at 200 RFPs.
   */
  async list(options: { limit?: number; offset?: number; status?: AnalysisStatus } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    let builder = this.client
      .from('tender_analyses')
      .select(
        'id, title, bid_number, buyer, bid_type, closing_at, source, source_url, file_name, status, processing_seconds, error_message, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('organization_id', this.organizationId);

    if (options.status) builder = builder.eq('status', options.status);

    const { data, error, count } = await builder
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    return { items: data ?? [], total: count ?? 0 };
  }

  async startRun(analysisId: string, requestId: string, userId: string): Promise<string> {
    const { data, error } = await this.client
      .from('analysis_runs')
      .insert({
        organization_id: this.organizationId,
        analysis_id: analysisId,
        request_id: requestId,
        status: 'Pending',
        stage: 'queued',
        triggered_by: userId,
      } as never)
      .select('id')
      .single();

    if (error) throw new Error(`Could not start the processing run: ${error.message}`);

    await this.client
      .from('tender_analyses')
      .update({ current_run_id: data.id, error_message: null } as never)
      .eq('id', analysisId)
      .eq('organization_id', this.organizationId);

    return data.id;
  }

  /**
   * Advances both the run and its analysis. Rejects illegal transitions
   * rather than writing them, so the status column stays trustworthy.
   */
  async advance(
    analysisId: string,
    runId: string,
    to: AnalysisStatus,
    stage?: string
  ): Promise<void> {
    const current = await this.get(analysisId);
    if (!current) throw new Error('RFP not found');

    if (!canTransition(current.status, to)) {
      throw new Error(`Illegal status transition: ${current.status} -> ${to}`);
    }

    await this.client
      .from('tender_analyses')
      .update({ status: to } as never)
      .eq('id', analysisId)
      .eq('organization_id', this.organizationId);

    await this.client
      .from('analysis_runs')
      .update({ status: to, stage: stage ?? to.toLowerCase() } as never)
      .eq('id', runId)
      .eq('organization_id', this.organizationId);
  }

  async completeRun(
    analysisId: string,
    runId: string,
    outputs: {
      parsedData: unknown;
      technicalAnalysis: unknown;
      pricing: unknown;
      riskAnalysis: unknown;
      durationMs: number;
      metadata?: Record<string, unknown>;
      identity?: { title?: string | null; bidNumber?: string | null; buyer?: string | null; bidType?: string | null; closingAt?: string | null };
    }
  ): Promise<void> {
    const { error } = await this.client
      .from('tender_analyses')
      .update({
        status: 'Complete',
        parsed_data: outputs.parsedData as never,
        technical_analysis: outputs.technicalAnalysis as never,
        pricing: outputs.pricing as never,
        risk_analysis: outputs.riskAnalysis as never,
        processing_seconds: Math.round(outputs.durationMs / 1000),
        error_message: null,
        ...(outputs.identity?.title ? { title: outputs.identity.title } : {}),
        ...(outputs.identity?.bidNumber ? { bid_number: outputs.identity.bidNumber } : {}),
        ...(outputs.identity?.buyer ? { buyer: outputs.identity.buyer } : {}),
        ...(outputs.identity?.bidType ? { bid_type: outputs.identity.bidType } : {}),
        ...(outputs.identity?.closingAt ? { closing_at: outputs.identity.closingAt } : {}),
      } as never)
      .eq('id', analysisId)
      .eq('organization_id', this.organizationId);

    if (error) throw new Error(error.message);

    await this.client
      .from('analysis_runs')
      .update({
        status: 'Complete',
        stage: 'complete',
        completed_at: new Date().toISOString(),
        duration_ms: outputs.durationMs,
        metadata: (outputs.metadata ?? {}) as never,
      } as never)
      .eq('id', runId)
      .eq('organization_id', this.organizationId);
  }

  async failRun(
    analysisId: string,
    runId: string,
    code: string,
    message: string,
    durationMs: number
  ): Promise<void> {
    await this.client
      .from('tender_analyses')
      .update({ status: 'Error', error_message: message } as never)
      .eq('id', analysisId)
      .eq('organization_id', this.organizationId);

    await this.client
      .from('analysis_runs')
      .update({
        status: 'Error',
        stage: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_code: code,
        error_message: message,
      } as never)
      .eq('id', runId)
      .eq('organization_id', this.organizationId);
  }

  async listRuns(analysisId: string) {
    const { data, error } = await this.client
      .from('analysis_runs')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('analysis_id', analysisId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
