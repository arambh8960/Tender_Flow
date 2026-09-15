import { api } from './client';

/**
 * RFP intake, analysis and history.
 *
 * Inventory is no longer sent with the request: the server loads the
 * organisation's own catalogue. What the browser supplies is the document
 * and where it came from.
 */

export type RfpStatus = 'Pending' | 'Extracting' | 'Parsing' | 'Processing' | 'Complete' | 'Error';

export interface RfpListItem {
  id: string;
  title: string | null;
  bid_number: string | null;
  buyer: string | null;
  bid_type: string | null;
  closing_at: string | null;
  source: string | null;
  source_url: string | null;
  file_name: string | null;
  status: RfpStatus;
  processing_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisRun {
  id: string;
  status: RfpStatus;
  stage: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
}

export interface RfpDetail extends RfpListItem {
  parsed_data: any;
  technical_analysis: any;
  pricing: any;
  risk_analysis: any;
  raw_content: string | null;
  runs: AnalysisRun[];
}

export interface ProcessedRfp {
  analysisId: string;
  runId: string;
  status: 'Complete';
  durationMs: number;
  parsedData: any;
  technicalAnalysis: { itemAnalyses: any[] };
  pricing: any;
  riskAnalysis: any[];
}

export const rfpApi = {
  /** Creates the record and runs the pipeline in one call. */
  createAndProcess: (params: {
    organizationId: string;
    source: 'URL' | 'File' | 'Discovery';
    content: string;
    fileName?: string;
    title?: string;
    bidNumber?: string;
  }) => api.post<{ data: ProcessedRfp }>('/api/rfps', params).then(r => r.data),

  reprocess: (organizationId: string, analysisId: string) =>
    api
      .post<{ data: ProcessedRfp }>(`/api/rfps/${encodeURIComponent(analysisId)}/reprocess`, { organizationId })
      .then(r => r.data),

  list: (organizationId: string, options: { limit?: number; offset?: number; status?: RfpStatus } = {}) => {
    const params = new URLSearchParams({ organizationId });
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    if (options.status) params.set('status', options.status);
    return api.get<{ data: RfpListItem[]; total: number }>(`/api/rfps?${params.toString()}`);
  },

  /** Full record including agent outputs — what a page reload restores from. */
  get: (organizationId: string, analysisId: string) =>
    api
      .get<{ data: RfpDetail }>(
        `/api/rfps/${encodeURIComponent(analysisId)}?organizationId=${encodeURIComponent(organizationId)}`
      )
      .then(r => r.data),

  fetchFromUrl: (organizationId: string, url: string) =>
    api
      .post<{ data: { content: string; extractedLinks: string[]; finalUrl: string } }>('/api/fetch-rfp-url', {
        organizationId,
        url,
      })
      .then(r => r.data),

  convertPdf: (organizationId: string, url: string, fileName?: string) =>
    api
      .post<{ data: { docxUrl: string } }>('/api/convert-pdf', { organizationId, url, fileName })
      .then(r => r.data),
};
