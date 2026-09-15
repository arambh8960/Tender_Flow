import { useCallback, useEffect, useState } from 'react';
import { vaultApi, type VaultDocument } from '../services/api/vaultApi';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';

/**
 * Compliance vault.
 *
 * Access URLs are minted on demand and expire in minutes, so nothing here
 * caches a link: a stored URL would outlive the permission it was issued
 * under.
 */
export function useVault() {
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;

  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDocuments(await vaultApi.listDocuments(organizationId));
    } catch (err) {
      setError(describeApiError(err));
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setDocuments([]);
    void load();
  }, [load]);

  const addDocument = useCallback(
    async (input: { file: File; certName: string; category?: string; issuedDate?: string; expiryDate?: string }) => {
      if (!organizationId) return;
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        form.append('file', input.file);
        form.append('organizationId', organizationId);
        form.append('certName', input.certName);
        if (input.category) form.append('category', input.category);
        if (input.issuedDate) form.append('issuedDate', input.issuedDate);
        if (input.expiryDate) form.append('expiryDate', input.expiryDate);

        await vaultApi.addDocument(form);
        await load();
      } catch (err) {
        setError(describeApiError(err));
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [organizationId, load]
  );

  const replaceDocument = useCallback(
    async (documentId: string, file: File, expiryDate?: string) => {
      if (!organizationId) return;
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('organizationId', organizationId);
        form.append('documentId', documentId);
        if (expiryDate) form.append('expiryDate', expiryDate);

        await vaultApi.replaceDocument(form);
        await load();
      } finally {
        setUploading(false);
      }
    },
    [organizationId, load]
  );

  /** Opens a document via a freshly signed, short-lived URL. */
  const openDocument = useCallback(
    async (documentId: string, download = false) => {
      if (!organizationId) return;
      const link = await vaultApi.getLink(organizationId, documentId, download);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    },
    [organizationId]
  );

  const archiveDocument = useCallback(
    async (documentId: string) => {
      if (!organizationId) return;
      await vaultApi.archive(organizationId, documentId);
      await load();
    },
    [organizationId, load]
  );

  const expiringSoon = documents.filter(d => d.validityStatus === 'expiring_soon');
  const expired = documents.filter(d => d.validityStatus === 'expired');

  return {
    documents,
    expiringSoon,
    expired,
    loading,
    uploading,
    error,
    isEmpty: !loading && !error && documents.length === 0,
    reload: load,
    addDocument,
    replaceDocument,
    openDocument,
    archiveDocument,
  };
}
