import type { AppConfig, Rfp, RfpStatus } from '../../types';
import type { CompanySnapshot } from '../services/api/organizationApi';
import type { RfpDetail } from '../services/api/rfpApi';

/**
 * Adapters between the persisted shapes and the shapes the existing screens
 * render.
 *
 * The screens were written against in-memory objects from data/*.ts. Rather
 * than rewrite every screen, the API shapes are mapped here — one place that
 * changes if either side moves, instead of conversion logic scattered through
 * JSX.
 */

/** Company settings in the shape ConfigScreen and the agents expect. */
export function toAppConfig(snapshot: CompanySnapshot | null): AppConfig {
  const profile = snapshot?.profile ?? null;
  const settings = snapshot?.settings ?? null;

  return {
    companyDetails: {
      // Blank rather than a placeholder company: a new workspace should look
      // empty, not look like someone else's.
      companyName: snapshot?.organization?.name ?? '',
      companyAddress: profile?.address ?? '',
      gstin: profile?.gstin ?? '',
      pan: profile?.pan ?? '',
      domain: profile?.domain ?? '',
      turnover: profile?.annual_turnover_cr != null ? String(profile.annual_turnover_cr) : '',
      turnoverYear: profile?.turnover_year ?? '',
      oemStatus: profile?.oem_status ?? '',
    },
    signingAuthorities: (snapshot?.signingAuthorities ?? []).map(authority => ({
      id: authority.id,
      name: authority.name,
      designation: authority.designation ?? '',
      din: authority.din ?? '',
    })),
    discoveryFilters: {
      allowEMD: settings?.allow_emd ?? true,
      minMatchThreshold: settings?.min_match_threshold ?? 20,
      categories: (settings?.categories?.length ? settings.categories : ['']) as [string],
      manualAvgKms: settings?.manual_avg_kms ?? 0,
      manualRatePerKm: settings?.manual_rate_per_km ?? 0,
    },
  };
}

/** A persisted analysis in the Rfp shape the analysis screens render. */
export function toRfp(detail: RfpDetail): Rfp {
  return {
    id: detail.id,
    organisation: detail.buyer ?? 'Buyer not identified',
    bidType: detail.bid_type ?? 'Not specified',
    closingDate: detail.closing_at ? new Date(detail.closing_at) : new Date(),
    status: detail.status as RfpStatus,
    rawDocument: detail.raw_content ?? detail.source_url ?? '',
    source: (detail.source === 'File' ? 'File' : 'URL') as 'URL' | 'File',
    fileName: detail.file_name ?? undefined,
    processingDuration: detail.processing_seconds ?? undefined,
    agentOutputs: {
      parsedData: detail.parsed_data
        ? { ...(detail.parsed_data as Record<string, unknown>), riskAnalysis: detail.risk_analysis }
        : undefined,
      technicalAnalysis: (detail.technical_analysis as Rfp['agentOutputs'] extends undefined ? never : any) ?? null,
      pricing: (detail.pricing as any) ?? null,
    },
  };
}
