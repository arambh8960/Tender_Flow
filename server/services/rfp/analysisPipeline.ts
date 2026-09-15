import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';
import type { SKU } from '../../../types';

import { parseRFP } from '../../gemini.js';
import { extractATCSlice, parseATCWithGrok } from '../../grok';
import { runTechnicalAgent } from '../../agents/technicalagent';
import runFinancialAgent, { type CommercialSettings } from '../../agents/financialagent';
import { extractTextFromBuffer, collectLinksFromText } from '../documents/pdfText';
import { safeFetchDocument } from '../security/safeFetch';
import {
  resolveLocation,
  selectNearestWarehouse,
  isUsableCoordinate,
  type WarehouseCandidate,
} from '../logistics/geo';
import { AnalysisRepository } from '../../repositories/analysisRepository';
import { InventoryRepository } from '../../repositories/inventoryRepository';
import { recordAudit } from '../audit/auditLog';

/**
 * The RFP pipeline, start to finish, as a persisted run.
 *
 * Each stage writes its status before it begins, so a client that reconnects
 * mid-run sees where processing actually is rather than an animation that
 * kept playing while the backend had already failed.
 *
 * Inventory is loaded here from the database for the calling organisation.
 * It is never taken from the request: the browser must not be able to decide
 * what stock the agents reason about.
 */

export interface PipelineContext {
  db: SupabaseClient<Database>;
  organizationId: string;
  userId: string;
  requestId: string;
}

export interface PipelineOutcome {
  analysisId: string;
  runId: string;
  status: 'Complete' | 'Error';
  durationMs: number;
  data?: {
    parsedData: unknown;
    technicalAnalysis: unknown;
    pricing: unknown;
    riskAnalysis: unknown;
  };
  error?: { code: string; message: string };
}

/**
 * Parses a date the LLM extracted. An unparseable value becomes null rather
 * than "today" — a fabricated closing date would silently qualify an expired
 * tender.
 */
function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Resolves the tender's delivery distance from real geography.
 *
 * Without this the costing fell back to the organisation's configured average
 * haul even when the consignee was perfectly resolvable — which is exactly the
 * "estimate presented as a measurement" problem the discovery rebuild removed.
 * Returns null when the consignee or the warehouses cannot be located, so the
 * caller keeps the clearly-labelled estimate rather than inventing a number.
 */
export function resolveDeliveryDistance(
  consignee: string | null | undefined,
  skus: SKU[]
): { distanceKm: number; warehouse: string } | null {
  const destination = resolveLocation(consignee);
  if (!destination) return null;

  const seen = new Set<string>();
  const candidates: WarehouseCandidate[] = [];

  for (const sku of skus) {
    const code = sku.warehouseCode || sku.warehouseLocation || '';
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const hasCoordinates = isUsableCoordinate(sku.warehouseLat) && isUsableCoordinate(sku.warehouseLon);
    candidates.push({
      code,
      location: sku.warehouseLocation || '',
      coordinates: hasCoordinates
        ? { latitude: sku.warehouseLat, longitude: sku.warehouseLon }
        : resolveLocation(sku.warehouseLocation)?.coordinates ?? null,
    });
  }

  const selection = selectNearestWarehouse(destination.coordinates, candidates);
  if (!selection) return null;

  return {
    distanceKm: selection.distanceKm,
    warehouse: selection.warehouse.code || selection.warehouse.location,
  };
}

/**
 * Commercial settings for one organisation.
 *
 * Every figure comes from that tenant's own configuration. The GST rate,
 * brokerage, EMD/ePBG percentages and transport buffer used to be literals
 * here, which meant one company's commercial assumptions priced every
 * customer's bids regardless of their actual business.
 *
 * Migration 0011 creates a financial settings row alongside every
 * organisation, so "no row" is not a normal state. If one is somehow missing
 * the statutory-ish fallbacks below apply and the caller is told, rather than
 * the numbers passing silently as though they were configured.
 */
export async function loadCommercialSettings(
  db: SupabaseClient<Database>,
  organizationId: string
): Promise<CommercialSettings & { usedFallbackDefaults: boolean }> {
  const [discovery, financial] = await Promise.all([
    db
      .from('organization_discovery_settings')
      .select('manual_avg_kms, manual_rate_per_km, allow_emd, min_match_threshold')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    db
      .from('organization_financial_settings')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle(),
  ]);

  const money = financial.data;

  // The freight rate lives in discovery settings (where it is edited) and is
  // mirrored onto the financial row; prefer whichever is actually set so the
  // two can never silently disagree.
  const ratePerKm = Number(discovery.data?.manual_rate_per_km ?? money?.rate_per_km ?? 0);

  return {
    assumedDistanceKm: Number(discovery.data?.manual_avg_kms ?? 0),
    ratePerKm,
    // Stays true until a measured route replaces it; the agent labels the
    // output accordingly.
    distanceIsEstimate: true,
    transportBufferPercent: Number(money?.transport_buffer_percent ?? 10),
    defaultEmdPercent: Number(money?.default_emd_percent ?? 2),
    defaultEpbgPercent: Number(money?.default_epbg_percent ?? 3),
    defaultGstRate: Number(money?.default_gst_rate ?? 18),
    usedFallbackDefaults: !money,
  };
}

export async function runAnalysisPipeline(
  ctx: PipelineContext,
  analysisId: string
): Promise<PipelineOutcome> {
  const analyses = new AnalysisRepository(ctx.db, ctx.organizationId);
  const inventoryRepo = new InventoryRepository(ctx.db, ctx.organizationId);

  const record = await analyses.get(analysisId);
  if (!record) throw new Error('RFP not found');

  const runId = await analyses.startRun(analysisId, ctx.requestId, ctx.userId);
  const startedAt = Date.now();

  const failWith = async (code: string, message: string): Promise<PipelineOutcome> => {
    const durationMs = Date.now() - startedAt;
    await analyses.failRun(analysisId, runId, code, message, durationMs);
    await recordAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'rfp.failed',
      entityType: 'tender_analysis',
      entityId: analysisId,
      metadata: { runId, code, message },
    });
    return { analysisId, runId, status: 'Error', durationMs, error: { code, message } };
  };

  try {
    await recordAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'rfp.processing_started',
      entityType: 'tender_analysis',
      entityId: analysisId,
      metadata: { runId, source: record.source },
    });

    /* ── 1. content acquisition ─────────────────────────────────────── */
    let content = record.raw_content ?? '';
    let extractedLinks: string[] = [];

    if (record.source === 'URL' || record.source === 'Discovery') {
      await analyses.advance(analysisId, runId, 'Extracting', 'fetching source document');

      const sourceUrl = record.source_url ?? record.raw_content;
      if (!sourceUrl) return failWith('NO_SOURCE', 'The RFP has no source URL to fetch.');

      try {
        const fetched = await safeFetchDocument(sourceUrl, { Referer: 'https://bidplus.gem.gov.in/' });
        const extracted = await extractTextFromBuffer(fetched.buffer);
        content = extracted.fullText;
        extractedLinks = extracted.extractedLinks ?? [];
      } catch (err) {
        const e = err as { code?: string; message: string };
        return failWith(e.code ?? 'FETCH_FAILED', e.message || 'The tender document could not be retrieved.');
      }
    }

    if (!content || content.trim().length === 0) {
      return failWith('EMPTY_DOCUMENT', 'The tender document contained no readable text.');
    }

    /* ── 2. inventory (server-resolved, this organisation only) ──────── */
    const inventory: SKU[] = await inventoryRepo.listActiveForAgents();
    if (inventory.length === 0) {
      return failWith(
        'NO_INVENTORY',
        'This organisation has no active inventory, so the tender cannot be matched. Add inventory first.'
      );
    }

    /* ── 3. structural + ATC parsing ────────────────────────────────── */
    await analyses.advance(analysisId, runId, 'Parsing', 'structural parse');

    const links = extractedLinks.length > 0 ? extractedLinks : collectLinksFromText(content);
    const atcSlice = extractATCSlice(content);

    const [parsedSettled, atcSettled] = await Promise.allSettled([
      parseRFP(content),
      parseATCWithGrok(atcSlice, links),
    ]);

    if (parsedSettled.status === 'rejected') {
      return failWith('PARSE_FAILED', 'The tender document could not be parsed.');
    }

    const parsedData = parsedSettled.value;
    const atcData =
      atcSettled.status === 'fulfilled'
        ? atcSettled.value
        : { atc_summary: [], required_documents: [], documents: [], risk_entries: [] };

    const parseWarnings: string[] = [];
    if (atcSettled.status === 'rejected') {
      parseWarnings.push('Buyer-added-terms analysis failed; only the structural parse was used.');
    }

    parsedData.buyer_added_terms = atcData.atc_summary || [];
    parsedData.mandatoryDocuments = Array.from(
      new Set([...(parsedData.mandatoryDocuments || []), ...(atcData.required_documents || [])])
    );
    parsedData.extractedLinks = atcData.documents || [];

    /* ── 4. technical + financial agents ────────────────────────────── */
    await analyses.advance(analysisId, runId, 'Processing', 'technical and financial agents');

    const products = Array.isArray(parsedData?.products) ? parsedData.products : [];
    const technicalResult =
      products.length > 0
        ? runTechnicalAgent(products, inventory)
        : { itemAnalyses: [], riskEntries: [] };

    const settings = await loadCommercialSettings(ctx.db, ctx.organizationId);

    // Measure the haul from the warehouses actually holding the matched SKUs
    // to the tender's consignee. Only if that cannot be resolved does the
    // configured average apply, and the agent labels it as an estimate.
    const matchedSkus = technicalResult.itemAnalyses
      .map(analysis => analysis.selectedSku)
      .filter((sku): sku is SKU => Boolean(sku));

    if (settings.usedFallbackDefaults) {
      parseWarnings.push(
        'This organisation has no financial defaults configured, so statutory fallbacks were used for GST, EMD and ePBG. Set them under Organisation → Settings.'
      );
    }

    const measured = resolveDeliveryDistance(parsedData?.consignee, matchedSkus);
    if (measured) {
      settings.measuredDistanceKm = measured.distanceKm;
      settings.measuredFromWarehouse = measured.warehouse;
      settings.distanceIsEstimate = false;
    } else if (parsedData?.consignee) {
      parseWarnings.push(
        `Delivery distance is an estimate: the consignee "${parsedData.consignee}" could not be located.`
      );
    }

    const financialResult =
      technicalResult.itemAnalyses.length > 0
        ? runFinancialAgent(technicalResult.itemAnalyses, parsedData, settings)
        : { pricing: {}, riskEntries: [], summary: { requiresManualReview: true, reasons: ['No line items were identified in the tender.'] } };

    if (products.length === 0) {
      parseWarnings.push('No product line items were identified in this tender.');
    }

    const riskAnalysis = [
      ...(atcData.risk_entries ?? []),
      ...(technicalResult.riskEntries ?? []),
      ...(financialResult.riskEntries ?? []),
    ];

    /* ── 5. persist ─────────────────────────────────────────────────── */
    const durationMs = Date.now() - startedAt;
    const outputs = {
      parsedData: { ...parsedData, parseWarnings },
      technicalAnalysis: { itemAnalyses: technicalResult.itemAnalyses },
      pricing: financialResult,
      riskAnalysis,
    };

    await analyses.completeRun(analysisId, runId, {
      ...outputs,
      durationMs,
      metadata: {
        inventorySize: inventory.length,
        lineItems: products.length,
        atcAvailable: atcSettled.status === 'fulfilled',
        distanceBasis: measured ? 'measured' : 'estimated',
        financialDefaults: settings.usedFallbackDefaults ? 'fallback' : 'organization',
        distanceKm: measured?.distanceKm ?? settings.assumedDistanceKm,
        distanceFromWarehouse: measured?.warehouse ?? null,
        warnings: parseWarnings,
      },
      identity: {
        title: parsedData?.metadata?.itemCategory ?? parsedData?.metadata?.bidNumber ?? null,
        bidNumber: parsedData?.metadata?.bidNumber ?? null,
        buyer: parsedData?.metadata?.issuingOrganization ?? null,
        bidType: parsedData?.metadata?.bidType ?? null,
        closingAt: toIsoOrNull(parsedData?.metadata?.bidEndDate),
      },
    });

    await recordAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'rfp.processed',
      entityType: 'tender_analysis',
      entityId: analysisId,
      metadata: { runId, durationMs, lineItems: products.length },
    });

    return { analysisId, runId, status: 'Complete', durationMs, data: outputs };
  } catch (err) {
    return failWith('PIPELINE_ERROR', (err as Error).message || 'RFP processing failed.');
  }
}
