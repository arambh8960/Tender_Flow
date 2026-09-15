import type { SKU, AgentName } from '../../types';
import type { DiscoveryStatus } from '../../database.types';
import { createAdapter, isPortalSupported } from './portals/PortalRegistry';
import { PortalError, type ProcurementPortalAdapter } from './portals/PortalAdapter';
import type { DiscoveryCriteria, NormalizedTender } from './normalization/types';
import { Deduplicator } from './deduplication/Deduplicator';
import { TenderQualifier, type QualificationResult, type QualifierSettings } from './qualification/TenderQualifier';
import type { DiscoveryRepository } from './persistence/DiscoveryRepository';

export type LogFn = (agent: AgentName | 'SYSTEM', message: string, data?: unknown) => void;

export interface DiscoveryRunCounts {
  totalFound: number;
  totalNormalized: number;
  totalDuplicates: number;
  totalExpired: number;
  totalCandidates: number;
  totalQualified: number;
}

export interface DiscoveryOutcome {
  runId: string | null;
  status: DiscoveryStatus;
  counts: DiscoveryRunCounts;
  results: QualificationResult[];
  errors: { scope: string; message: string; kind: string }[];
  startedAt: string;
  completedAt: string;
}

export interface DiscoveryRequest {
  organizationId: string;
  portal: string;
  criteria: DiscoveryCriteria;
  inventory: SKU[];
  settings: QualifierSettings;
  triggeredBy?: string | null;
  /** Omit to run without persistence (e.g. a dry run). */
  repository?: DiscoveryRepository;
}

/**
 * Orchestrates the discovery pipeline. Portal-agnostic: it talks to a
 * ProcurementPortalAdapter and never sees a DOM selector or a GeM-shaped
 * record.
 *
 *   adapter.search -> normalize -> dedupe -> expiry filter
 *     -> qualify (inventory, technical, quantity, compliance,
 *                 logistics, commercial) -> persist
 */
export class DiscoveryCoordinator {
  constructor(private log: LogFn = () => {}) {}

  async run(request: DiscoveryRequest): Promise<DiscoveryOutcome> {
    const startedAt = new Date().toISOString();
    const errors: { scope: string; message: string; kind: string }[] = [];
    const counts: DiscoveryRunCounts = {
      totalFound: 0,
      totalNormalized: 0,
      totalDuplicates: 0,
      totalExpired: 0,
      totalCandidates: 0,
      totalQualified: 0,
    };

    if (!isPortalSupported(request.portal)) {
      throw new Error(`Portal "${request.portal}" is not supported.`);
    }

    let runId: string | null = null;
    if (request.repository) {
      runId = await request.repository.createRun(request.portal, request.criteria, request.triggeredBy ?? null);
      this.log('MASTER_AGENT', `Discovery run ${runId} started on ${request.portal.toUpperCase()}.`);
    }

    let adapter: ProcurementPortalAdapter | null = null;

    try {
      adapter = createAdapter(request.portal);

      // ── 1. fetch ────────────────────────────────────────────────────────
      const rawTenders = await this.fetchRaw(adapter, request.criteria, errors);
      counts.totalFound = rawTenders.length;
      this.log('MASTER_AGENT', `${counts.totalFound} raw results from ${adapter.displayName}.`);

      // Every scope failed and nothing came back — a failure, not an empty set.
      if (counts.totalFound === 0 && errors.length > 0) {
        const completedAt = new Date().toISOString();
        if (request.repository && runId) {
          await request.repository.completeRun(runId, 'failed', counts, errors);
        }
        this.log('SYSTEM', 'Discovery failed: every portal query errored.', errors);
        return { runId, status: 'failed', counts, results: [], errors, startedAt, completedAt };
      }

      // ── 2. normalize ────────────────────────────────────────────────────
      const normalized: NormalizedTender[] = [];
      for (const raw of rawTenders) {
        try {
          normalized.push(adapter.normalize(raw));
        } catch (err) {
          errors.push({ scope: `normalize:${raw.externalId}`, message: (err as Error).message, kind: 'parser' });
        }
      }
      counts.totalNormalized = normalized.length;

      // ── 3. deduplicate ──────────────────────────────────────────────────
      const { unique, duplicates } = Deduplicator.withinRun(normalized);
      counts.totalDuplicates = duplicates;
      this.log('MASTER_AGENT', `${duplicates} duplicate(s) collapsed; ${unique.length} distinct tenders.`);

      // ── 4. basic filters (expiry window) ────────────────────────────────
      const candidates = this.filterByClosingWindow(unique, request.criteria.closingWithinDays ?? 90);
      counts.totalExpired = unique.length - candidates.length;
      counts.totalCandidates = candidates.length;
      this.log('MASTER_AGENT', `${counts.totalExpired} outside the closing window; ${candidates.length} candidates.`);

      // ── 5. qualification ────────────────────────────────────────────────
      const qualifier = new TenderQualifier(request.inventory, request.settings);
      const results = candidates.map(t => qualifier.qualify(t));
      const qualified = results.filter(r => r.isQualified);
      counts.totalQualified = qualified.length;

      this.log('MASTER_AGENT', `${qualified.length} qualified of ${candidates.length} candidates.`, {
        inventoryCompatible: results.filter(r => r.breakdown.inventory.match).length,
        logisticsFeasible: results.filter(r => r.breakdown.logistics.feasible).length,
      });

      // ── 6. persistence ──────────────────────────────────────────────────
      if (request.repository && runId) {
        for (const result of results) {
          try {
            const { id } = await request.repository.upsertTender(result.tender, runId);
            await request.repository.saveQualification(id, runId, result);
          } catch (err) {
            errors.push({
              scope: `persist:${result.tender.externalId}`,
              message: (err as Error).message,
              kind: 'persistence',
            });
          }
        }
      }

      const status: DiscoveryStatus = errors.length > 0 ? 'partial' : 'completed';
      const completedAt = new Date().toISOString();

      if (request.repository && runId) {
        await request.repository.completeRun(runId, status, counts, errors);
      }

      return {
        runId,
        status,
        counts,
        results: qualified.sort((a, b) => b.scores.overall_score - a.scores.overall_score),
        errors,
        startedAt,
        completedAt,
      };
    } catch (err) {
      const message = (err as Error).message;
      this.log('SYSTEM', `Discovery aborted: ${message}`);
      if (request.repository && runId) await request.repository.failRun(runId, message);
      throw err;
    } finally {
      await adapter?.dispose?.().catch(() => undefined);
    }
  }

  /** One scope per category (or a single advanced query); one failure does not zero the run. */
  private async fetchRaw(
    adapter: ProcurementPortalAdapter,
    criteria: DiscoveryCriteria,
    errors: { scope: string; message: string; kind: string }[]
  ) {
    const collected = [] as Awaited<ReturnType<ProcurementPortalAdapter['search']>>;

    if (criteria.advanced) {
      try {
        collected.push(...(await adapter.search(criteria)));
      } catch (err) {
        this.pushError(errors, 'advanced', err);
      }
      return collected;
    }

    for (const category of criteria.categories) {
      this.log('MASTER_AGENT', `Querying ${adapter.displayName} for "${category}"...`);
      try {
        collected.push(...(await adapter.search({ ...criteria, categories: [category] })));
      } catch (err) {
        this.pushError(errors, category, err);
      }
    }

    return collected;
  }

  private pushError(
    errors: { scope: string; message: string; kind: string }[],
    scope: string,
    err: unknown
  ) {
    const kind = err instanceof PortalError ? err.kind : 'unknown';
    const message = (err as Error).message;
    errors.push({ scope, message, kind });
    this.log('SYSTEM', `Scope "${scope}" failed (${kind}): ${message}`);
  }

  private filterByClosingWindow(tenders: NormalizedTender[], withinDays: number): NormalizedTender[] {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + withinDays);

    return tenders.filter(t => {
      if (!t.closingAt) return false;
      const closing = new Date(t.closingAt);
      if (Number.isNaN(closing.getTime())) return false;
      return closing >= now && closing <= horizon;
    });
  }
}
