import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import ConvertAPI from 'convertapi';

import { env } from '../config/env';

import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import { AnalysisRepository } from '../repositories/analysisRepository';
import { runAnalysisPipeline } from '../services/rfp/analysisPipeline';
import { safeFetchDocument, UnsafeResponseError } from '../services/security/safeFetch';
import { BlockedUrlError } from '../services/security/urlGuard';
import { extractTextFromBuffer } from '../services/documents/pdfText';
import { recordAudit } from '../services/audit/auditLog';

/**
 * RFP intake and analysis.
 *
 * Every RFP is a database row before any work starts, so a browser refresh
 * mid-run rejoins the same record instead of losing it. The heavy lifting
 * lives in the pipeline service; these handlers only validate, authorise and
 * translate.
 */

export const createRfpSchema = z.object({
  organizationId: z.string().uuid(),
  source: z.enum(['URL', 'File', 'Discovery']),
  // For URL/Discovery this is the document address; for File it is the text.
  content: z.string().min(1).max(5_000_000),
  fileName: z.string().max(300).optional(),
  title: z.string().max(300).optional(),
  bidNumber: z.string().max(120).optional(),
  tenderId: z.string().uuid().optional(),
});

export const convertPdfSchema = z.object({
  organizationId: z.string().uuid(),
  url: z.string().min(1).max(2000),
  fileName: z.string().max(300).optional(),
});

export const fetchUrlSchema = z.object({
  organizationId: z.string().uuid(),
  url: z.string().min(1).max(2000),
});

/** Creates the RFP record and runs the pipeline. */
export async function createAndProcessRfp(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const input = validated<z.infer<typeof createRfpSchema>>(req);

  const isUrlSource = input.source === 'URL' || input.source === 'Discovery';
  const repo = new AnalysisRepository(auth.db, org.id);

  let record;
  try {
    record = await repo.create(
      {
        source: input.source,
        sourceUrl: isUrlSource ? input.content : null,
        rawContent: isUrlSource ? null : input.content,
        fileName: input.fileName ?? null,
        title: input.title ?? input.fileName ?? null,
        bidNumber: input.bidNumber ?? null,
        tenderId: input.tenderId ?? null,
      },
      auth.userId
    );
  } catch (err) {
    return fail(res, 403, 'RFP_CREATE_FAILED', (err as Error).message);
  }

  await recordAudit(
    {
      organizationId: org.id,
      action: 'rfp.created',
      entityType: 'tender_analysis',
      entityId: record.id,
      metadata: { source: input.source, fileName: input.fileName ?? null },
    },
    req
  );

  const outcome = await runAnalysisPipeline(
    { db: auth.db, organizationId: org.id, userId: auth.userId, requestId: req.requestId },
    record.id
  );

  if (outcome.status === 'Error') {
    // 200-with-an-error-body was the old behaviour and it made failures
    // invisible to the client's error handling.
    return fail(res, 422, outcome.error?.code ?? 'PROCESSING_FAILED', outcome.error?.message ?? 'Processing failed.', {
      analysisId: outcome.analysisId,
      runId: outcome.runId,
    });
  }

  return ok(res, {
    analysisId: outcome.analysisId,
    runId: outcome.runId,
    status: outcome.status,
    durationMs: outcome.durationMs,
    ...outcome.data,
  });
}

/** Re-runs analysis for an existing RFP, appending a new run. */
export async function reprocessRfp(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const analysisId = String(req.params.analysisId);

  const repo = new AnalysisRepository(auth.db, org.id);
  const existing = await repo.get(analysisId);
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'RFP not found.');

  const outcome = await runAnalysisPipeline(
    { db: auth.db, organizationId: org.id, userId: auth.userId, requestId: req.requestId },
    analysisId
  );

  if (outcome.status === 'Error') {
    return fail(res, 422, outcome.error?.code ?? 'PROCESSING_FAILED', outcome.error?.message ?? 'Processing failed.', {
      analysisId: outcome.analysisId,
      runId: outcome.runId,
    });
  }

  return ok(res, { analysisId, runId: outcome.runId, status: outcome.status, ...outcome.data });
}

export async function listRfps(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const repo = new AnalysisRepository(auth.db, org.id);

  const { items, total } = await repo.list({
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
    status: typeof req.query.status === 'string' ? (req.query.status as never) : undefined,
  });

  return ok(res, items, { total });
}

/** One RFP with its outputs and run history — this is what survives a refresh. */
export async function getRfp(req: Request, res: Response) {
  const { auth, org } = req as Required<Pick<Request, 'auth' | 'org'>> & Request;
  const repo = new AnalysisRepository(auth.db, org.id);
  const analysisId = String(req.params.analysisId);

  const record = await repo.get(analysisId);
  if (!record) return fail(res, 404, 'NOT_FOUND', 'RFP not found.');

  const runs = await repo.listRuns(analysisId);
  return ok(res, { ...record, runs });
}

/**
 * Fetches a tender document by URL.
 *
 * Retained because the UI previews a document before committing to a full
 * analysis, but now behind SSRF validation: protocol, host, resolved
 * address and every redirect hop are checked before a request leaves the
 * process.
 */
export async function fetchRfpFromUrl(req: Request, res: Response) {
  const { org } = req as Required<Pick<Request, 'org'>> & Request;
  const input = validated<z.infer<typeof fetchUrlSchema>>(req);

  try {
    const fetched = await safeFetchDocument(input.url, { Referer: 'https://bidplus.gem.gov.in/' });
    const extracted = await extractTextFromBuffer(fetched.buffer);

    return ok(res, {
      content: extracted.fullText,
      extractedLinks: extracted.extractedLinks,
      finalUrl: fetched.finalUrl,
      redirects: fetched.hops,
    });
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      // Logged as a security event: a blocked target is worth seeing in the
      // audit trail, whether it was a mistake or a probe.
      await recordAudit(
        {
          organizationId: org.id,
          action: 'security.url_blocked',
          entityType: 'url',
          metadata: { reason: err.reason, url: input.url.slice(0, 300) },
        },
        req
      );
      return fail(res, 400, 'URL_BLOCKED', err.message);
    }

    if (err instanceof UnsafeResponseError) {
      return fail(res, 422, err.code, err.message);
    }

    console.error(`[${req.requestId}] document fetch failed:`, (err as Error).message);
    return fail(res, 502, 'FETCH_FAILED', 'The tender document could not be retrieved.');
  }
}

/**
 * Converts a tender PDF to DOCX via ConvertAPI.
 *
 * The source URL goes through the same SSRF validation, and the temporary
 * file is written to the OS temp directory rather than into the document
 * vault, which is neither a scratch space nor writable in production.
 */
export async function convertPdf(req: Request, res: Response) {
  const { org } = req as Required<Pick<Request, 'org'>> & Request;
  const input = validated<z.infer<typeof convertPdfSchema>>(req);

  if (!env.convertApiSecret) {
    return fail(res, 503, 'CONVERT_UNAVAILABLE', 'Document conversion is not configured on this deployment.');
  }

  let tempFilePath = '';
  try {
    const fetched = await safeFetchDocument(input.url, { Referer: 'https://bidplus.gem.gov.in/' });

    tempFilePath = path.join(os.tmpdir(), `tenderflow_${randomUUID()}.pdf`);
    await fs.writeFile(tempFilePath, fetched.buffer);

    const convertapi = new ConvertAPI(env.convertApiSecret);
    const result = await convertapi.convert('docx', { File: tempFilePath }, 'pdf');

    return ok(res, { docxUrl: result.file.url });
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      await recordAudit(
        {
          organizationId: org.id,
          action: 'security.url_blocked',
          entityType: 'url',
          metadata: { reason: err.reason, url: input.url.slice(0, 300), endpoint: 'convert-pdf' },
        },
        req
      );
      return fail(res, 400, 'URL_BLOCKED', err.message);
    }
    console.error(`[${req.requestId}] conversion failed:`, (err as Error).message);
    return fail(res, 502, 'CONVERSION_FAILED', 'Document conversion failed.');
  } finally {
    if (tempFilePath) await fs.unlink(tempFilePath).catch(() => undefined);
  }
}
