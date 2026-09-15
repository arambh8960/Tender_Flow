import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';

/**
 * Compliance vault storage, on Supabase Storage.
 *
 * Replaces the local `vault_storage/` directory, which was wrong in three
 * ways that all matter in production: files vanished on every container
 * redeploy, nothing tied a file to a tenant, and the served path came from
 * a client-supplied filename.
 *
 * Objects live at  {organizationId}/{documentId}/{safeName}  in a PRIVATE
 * bucket. The leading segment is the tenant key that the storage RLS policy
 * in migration 0006 checks, so company A physically cannot read company B's
 * object even with a correct object name.
 */

export const DOCUMENT_BUCKET = 'org-documents';
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB, matches the bucket limit

/** Compliance certificates are documents and images, not archives or code. */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.xls', '.xlsx']);

export class DocumentValidationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

/**
 * Reduces any client filename to something safe to store.
 *
 * Strips directory components first, so "../../../etc/passwd" and
 * "C:\\windows\\system32\\x" both collapse to their basename before the
 * character filter runs.
 */
export function safeFileName(original: string): string {
  const base = path.basename(String(original ?? '').replace(/\\/g, '/'));
  const cleaned = base
    .replace(/\0/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : 'document';
}

/** Validates an upload before a byte reaches storage. */
export function assertValidUpload(file: { originalname: string; mimetype: string; size: number }): void {
  if (!file) throw new DocumentValidationError('NO_FILE', 'No file was uploaded.');

  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentValidationError(
      'FILE_TOO_LARGE',
      `The file is larger than the ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB limit.`
    );
  }
  if (file.size === 0) {
    throw new DocumentValidationError('EMPTY_FILE', 'The file is empty.');
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new DocumentValidationError('UNSUPPORTED_TYPE', `Files of type ${file.mimetype} are not accepted.`);
  }

  // The extension is checked too: a client sets its own Content-Type, so the
  // declared MIME type alone is not evidence of anything.
  const ext = path.extname(safeFileName(file.originalname)).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new DocumentValidationError('UNSUPPORTED_TYPE', `Files with a ${ext || 'missing'} extension are not accepted.`);
  }
}

/** Buffers the upload in memory; nothing is written to the container's disk. */
export const uploadToMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
});

export function objectPath(organizationId: string, documentId: string, fileName: string): string {
  return `${organizationId}/${documentId}/${safeFileName(fileName)}`;
}

export function checksumOf(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export interface StoredObject {
  storagePath: string;
  checksum: string;
  size: number;
  mimeType: string;
  fileName: string;
}

/**
 * Uploads through the CALLER's client, so storage RLS applies. Passing a
 * service-role client here would silently disable the tenant check that
 * makes the path prefix meaningful.
 */
export async function putDocument(
  client: SupabaseClient<Database>,
  organizationId: string,
  documentId: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer }
): Promise<StoredObject> {
  assertValidUpload(file);

  const fileName = safeFileName(file.originalname);
  const storagePath = objectPath(organizationId, documentId, fileName);

  const { error } = await client.storage.from(DOCUMENT_BUCKET).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: true,
  });

  if (error) throw new DocumentValidationError('UPLOAD_FAILED', `The document could not be stored: ${error.message}`);

  return {
    storagePath,
    checksum: checksumOf(file.buffer),
    size: file.size,
    mimeType: file.mimetype,
    fileName,
  };
}

/**
 * Short-lived signed URL. The bucket is private and stays private: a
 * permanent public URL would make a leaked link a permanent disclosure.
 */
export async function signedUrlFor(
  client: SupabaseClient<Database>,
  storagePath: string,
  expiresInSeconds = 300,
  download = false
): Promise<string> {
  const { data, error } = await client.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds, download ? { download: true } : undefined);

  if (error || !data?.signedUrl) {
    throw new DocumentValidationError('SIGN_FAILED', 'A download link could not be created for this document.');
  }
  return data.signedUrl;
}

export async function removeDocument(
  client: SupabaseClient<Database>,
  storagePath: string
): Promise<void> {
  const { error } = await client.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
  if (error) throw new DocumentValidationError('DELETE_FAILED', 'The document could not be removed.');
}

/**
 * Guards a stored path against the organisation that is asking for it.
 *
 * Storage RLS is the real barrier; this turns a cross-tenant attempt into an
 * explicit 403 rather than a confusing "not found", and stops us signing a
 * URL for a path we never should have looked up.
 */
export function pathBelongsToOrganization(storagePath: string, organizationId: string): boolean {
  if (typeof storagePath !== 'string' || storagePath.includes('..') || storagePath.includes('\0')) return false;
  return storagePath.split('/')[0] === organizationId;
}
