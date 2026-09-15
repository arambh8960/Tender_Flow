import { api } from './client';

/**
 * Compliance vault.
 *
 * Documents are addressed by id, and access is a short-lived signed URL
 * issued by the server after it verifies ownership — the browser no longer
 * constructs a path to a file on the API host.
 */

export interface VaultDocument {
  id: string;
  cert_name: string;
  category: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  is_valid: boolean;
  mime_type: string | null;
  file_size: number | null;
  file_name: string | null;
  storage_path: string | null;
  validityStatus: 'valid' | 'expiring_soon' | 'expired' | 'unknown';
  hasFile: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentLink {
  url: string;
  expiresIn: number;
  fileName: string | null;
  mimeType: string | null;
}

export const vaultApi = {
  listDocuments: (organizationId: string) =>
    api
      .get<{ data: VaultDocument[] }>(`/api/vault/documents?organizationId=${encodeURIComponent(organizationId)}`)
      .then(res => res.data),

  addDocument: (form: FormData) =>
    api.upload<{ data: { id: string; storagePath: string; checksum: string } }>('/api/vault/documents', form),

  replaceDocument: (form: FormData) =>
    api.upload<{ data: { id: string; storagePath: string } }>('/api/vault/documents/replace', form),

  /** Signed URL, valid for a few minutes. Fetch it at the moment of use. */
  getLink: (organizationId: string, documentId: string, download = false) =>
    api
      .get<{ data: DocumentLink }>(
        `/api/vault/documents/${encodeURIComponent(documentId)}/link?organizationId=${encodeURIComponent(
          organizationId
        )}&download=${download}`
      )
      .then(res => res.data),

  archive: (organizationId: string, documentId: string) =>
    api.delete<{ data: { id: string; archived: boolean } }>(
      `/api/vault/documents/${encodeURIComponent(documentId)}?organizationId=${encodeURIComponent(organizationId)}`
    ),
};
