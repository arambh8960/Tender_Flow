import { Request, Response } from 'express';
import { z } from 'zod';
import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import {
  putDocument,
  signedUrlFor,
  removeDocument,
  pathBelongsToOrganization,
  DocumentValidationError,
  assertValidUpload,
} from '../services/documents/documentStorage';
import { recordAudit } from '../services/audit/auditLog';

/**
 * Compliance vault, organisation-scoped and backed by Supabase Storage.
 *
 * Every handler here reads req.org, which requireOrgMember derived from the
 * caller's membership — never from a body field. Documents are addressed by
 * their database id, so a client can no longer name a file on disk.
 */

const LIFETIME_EXPIRY = '2099-12-31';

function normaliseExpiry(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value === 'Lifetime') return LIFETIME_EXPIRY;
  return value;
}

export const addDocumentSchema = z.object({
  certName: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
  issuedDate: z.string().max(40).optional(),
  expiryDate: z.string().max(40).optional(),
  organizationId: z.string().uuid(),
});

export const replaceDocumentSchema = z.object({
  documentId: z.string().uuid(),
  expiryDate: z.string().max(40).optional(),
  organizationId: z.string().uuid(),
});

/** Uploads a new compliance document. */
export async function addDocument(req: Request, res: Response) {
  const org = req.org!;
  const auth = req.auth!;
  const input = validated<z.infer<typeof addDocumentSchema>>(req);
  const file = req.file;

  if (!file) return fail(res, 400, 'NO_FILE', 'No file was uploaded.');

  try {
    assertValidUpload(file);
  } catch (err) {
    const e = err as DocumentValidationError;
    await recordAudit(
      {
        organizationId: org.id,
        action: 'security.upload_rejected',
        entityType: 'compliance_document',
        metadata: { reason: e.code, fileName: file.originalname, size: file.size },
      },
      req
    );
    return fail(res, 400, e.code, e.message);
  }

  // The row is created first so the object path can be keyed by a real id
  // rather than a timestamp, which is what makes replacement idempotent.
  const { data: row, error: insertError } = await auth.db
    .from('compliance_documents')
    .insert({
      organization_id: org.id,
      cert_name: input.certName,
      category: input.category ?? null,
      issued_date: normaliseExpiry(input.issuedDate),
      expiry_date: normaliseExpiry(input.expiryDate),
      is_valid: true,
      uploaded_by: auth.userId,
    } as never)
    .select('id')
    .single();

  if (insertError || !row) {
    if (insertError?.code === '23505') {
      return fail(res, 409, 'DUPLICATE_DOCUMENT', 'A document with this name already exists for your organisation.');
    }
    return fail(res, 403, 'DOCUMENT_CREATE_FAILED', 'The document record could not be created.');
  }

  try {
    const stored = await putDocument(auth.db, org.id, row.id, file);

    await auth.db
      .from('compliance_documents')
      .update({
        storage_path: stored.storagePath,
        mime_type: stored.mimeType,
        file_size: stored.size,
        checksum: stored.checksum,
        file_name: stored.fileName,
      } as never)
      .eq('id', row.id)
      .eq('organization_id', org.id);

    await recordAudit(
      {
        organizationId: org.id,
        action: 'document.uploaded',
        entityType: 'compliance_document',
        entityId: row.id,
        metadata: { certName: input.certName, size: stored.size, checksum: stored.checksum },
      },
      req
    );

    return ok(res, { id: row.id, storagePath: stored.storagePath, checksum: stored.checksum });
  } catch (err) {
    // Storage failed: drop the orphan row so the vault does not list a
    // document that has no file behind it.
    await auth.db.from('compliance_documents').delete().eq('id', row.id).eq('organization_id', org.id);
    const e = err as DocumentValidationError;
    return fail(res, 400, e.code ?? 'UPLOAD_FAILED', e.message ?? 'The document could not be stored.');
  }
}

/** Lists the organisation's documents with computed validity. */
export async function listDocuments(req: Request, res: Response) {
  const org = req.org!;
  const auth = req.auth!;

  const { data, error } = await auth.db
    .from('compliance_documents')
    .select('id, cert_name, category, issued_date, expiry_date, is_valid, mime_type, file_size, file_name, storage_path, archived_at, created_at, updated_at')
    .eq('organization_id', org.id)
    .is('archived_at', null)
    .order('cert_name', { ascending: true });

  if (error) return fail(res, 500, 'DOCUMENTS_FETCH_FAILED', 'The compliance vault could not be loaded.');

  const today = new Date();
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const documents = (data ?? []).map(doc => {
    const expiry = doc.expiry_date ? new Date(doc.expiry_date) : null;
    const status = !expiry
      ? 'unknown'
      : expiry < today
        ? 'expired'
        : expiry < in30Days
          ? 'expiring_soon'
          : 'valid';

    return {
      ...doc,
      // Validity is derived from the date, not trusted from the is_valid
      // flag, which nothing was keeping up to date.
      validityStatus: status,
      hasFile: Boolean(doc.storage_path),
    };
  });

  return ok(res, documents);
}

/** Replaces the file behind an existing document. */
export async function replaceDocument(req: Request, res: Response) {
  const org = req.org!;
  const auth = req.auth!;
  const input = validated<z.infer<typeof replaceDocumentSchema>>(req);
  const file = req.file;

  if (!file) return fail(res, 400, 'NO_FILE', 'No file was uploaded.');

  const { data: existing, error } = await auth.db
    .from('compliance_documents')
    .select('id, cert_name, storage_path')
    .eq('id', input.documentId)
    .eq('organization_id', org.id)
    .maybeSingle();

  if (error) return fail(res, 500, 'DOCUMENT_LOOKUP_FAILED', 'The document could not be loaded.');
  // Ownership is explicit: a document belonging to another organisation is
  // indistinguishable from one that does not exist.
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Document not found.');

  try {
    const stored = await putDocument(auth.db, org.id, existing.id, file);

    await auth.db
      .from('compliance_documents')
      .update({
        storage_path: stored.storagePath,
        mime_type: stored.mimeType,
        file_size: stored.size,
        checksum: stored.checksum,
        file_name: stored.fileName,
        is_valid: true,
        expiry_date: normaliseExpiry(input.expiryDate),
      } as never)
      .eq('id', existing.id)
      .eq('organization_id', org.id);

    // A replaced file at a different name would otherwise linger unreferenced.
    if (existing.storage_path && existing.storage_path !== stored.storagePath) {
      await removeDocument(auth.db, existing.storage_path).catch(() => undefined);
    }

    await recordAudit(
      {
        organizationId: org.id,
        action: 'document.replaced',
        entityType: 'compliance_document',
        entityId: existing.id,
        metadata: { certName: existing.cert_name, checksum: stored.checksum },
      },
      req
    );

    return ok(res, { id: existing.id, storagePath: stored.storagePath });
  } catch (err) {
    const e = err as DocumentValidationError;
    return fail(res, 400, e.code ?? 'UPLOAD_FAILED', e.message ?? 'The document could not be stored.');
  }
}

/**
 * Issues a short-lived signed URL.
 *
 * Replaces the old /vault/view/:filename and /vault/download/:filename,
 * which served any file in a shared directory to anyone who could name it.
 */
export async function getDocumentLink(req: Request, res: Response) {
  const org = req.org!;
  const auth = req.auth!;
  const documentId = String(req.params.documentId);
  const wantsDownload = req.query.download === 'true';

  const { data, error } = await auth.db
    .from('compliance_documents')
    .select('id, cert_name, storage_path, mime_type, file_name')
    .eq('id', documentId)
    .eq('organization_id', org.id)
    .maybeSingle();

  if (error) return fail(res, 500, 'DOCUMENT_LOOKUP_FAILED', 'The document could not be loaded.');
  if (!data) return fail(res, 404, 'NOT_FOUND', 'Document not found.');
  if (!data.storage_path) return fail(res, 409, 'NO_FILE', 'This document has no file attached.');

  // Defence in depth: the row said it belongs to this organisation, so its
  // object path must agree.
  if (!pathBelongsToOrganization(data.storage_path, org.id)) {
    return fail(res, 403, 'FORBIDDEN', 'This document does not belong to your organisation.');
  }

  try {
    const url = await signedUrlFor(auth.db, data.storage_path, 300, wantsDownload);

    if (wantsDownload) {
      await recordAudit(
        {
          organizationId: org.id,
          action: 'document.downloaded',
          entityType: 'compliance_document',
          entityId: data.id,
          metadata: { certName: data.cert_name },
        },
        req
      );
    }

    return ok(res, { url, expiresIn: 300, fileName: data.file_name, mimeType: data.mime_type });
  } catch (err) {
    const e = err as DocumentValidationError;
    return fail(res, 502, e.code ?? 'SIGN_FAILED', e.message ?? 'A download link could not be created.');
  }
}

/** Archives a document (soft delete) and removes the stored object. */
export async function archiveDocument(req: Request, res: Response) {
  const org = req.org!;
  const auth = req.auth!;
  const documentId = String(req.params.documentId);

  const { data, error } = await auth.db
    .from('compliance_documents')
    .select('id, cert_name, storage_path')
    .eq('id', documentId)
    .eq('organization_id', org.id)
    .maybeSingle();

  if (error) return fail(res, 500, 'DOCUMENT_LOOKUP_FAILED', 'The document could not be loaded.');
  if (!data) return fail(res, 404, 'NOT_FOUND', 'Document not found.');

  const { error: updateError } = await auth.db
    .from('compliance_documents')
    .update({ archived_at: new Date().toISOString(), is_valid: false } as never)
    .eq('id', data.id)
    .eq('organization_id', org.id);

  if (updateError) return fail(res, 403, 'ARCHIVE_FAILED', 'The document could not be archived.');

  if (data.storage_path) {
    await removeDocument(auth.db, data.storage_path).catch(() => undefined);
  }

  await recordAudit(
    {
      organizationId: org.id,
      action: 'document.archived',
      entityType: 'compliance_document',
      entityId: data.id,
      metadata: { certName: data.cert_name },
    },
    req
  );

  return ok(res, { id: data.id, archived: true });
}
