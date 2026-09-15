import * as React from 'react';
import { useState } from 'react';
import { useVault } from '../../hooks/useVault';
import { describeApiError } from '../../services/api/client';
import { Panel, Spinner, ErrorNote, EmptyState, buttonClass, ghostButtonClass, inputClass } from './AdminShell';

/** Human label and colour for a computed validity status. */
const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  valid: { label: 'Valid', className: 'bg-emerald-950/50 text-emerald-400' },
  expiring_soon: { label: 'Expiring soon', className: 'bg-amber-950/50 text-amber-400' },
  expired: { label: 'Expired', className: 'bg-rose-950/50 text-rose-400' },
  unknown: { label: 'No expiry recorded', className: 'bg-slate-800 text-slate-400' },
};

const formatSize = (bytes: number | null) =>
  bytes === null ? '—' : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export const AdminCompliancePage: React.FC = () => {
  const { documents, expiringSoon, expired, loading, uploading, error, isEmpty, addDocument, openDocument, archiveDocument } =
    useVault();

  const [file, setFile] = useState<File | null>(null);
  const [certName, setCertName] = useState('');
  const [category, setCategory] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !certName.trim()) return;

    setUploadError(null);
    try {
      await addDocument({
        file,
        certName: certName.trim(),
        category: category.trim() || undefined,
        expiryDate: expiryDate || undefined,
      });
      setFile(null);
      setCertName('');
      setCategory('');
      setExpiryDate('');
      (document.getElementById('vault-file-input') as HTMLInputElement | null)?.value &&
        ((document.getElementById('vault-file-input') as HTMLInputElement).value = '');
    } catch (err) {
      setUploadError(describeApiError(err));
    }
  };

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}
      {uploadError && <ErrorNote message={uploadError} />}

      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl px-5 py-4">
          <p className="text-[11px] text-amber-300">
            {expired.length} expired and {expiringSoon.length} expiring within 30 days. An expired certificate is
            treated as not held during tender qualification.
          </p>
        </div>
      )}

      <Panel title="Upload a document" subtitle="PDF, image or office document, up to 25 MB. Stored privately.">
        <form onSubmit={submit} className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            id="vault-file-input"
            type="file"
            required
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className="text-[11px] text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-slate-800 file:text-slate-300"
          />
          <input required value={certName} onChange={e => setCertName(e.target.value)} placeholder="Certificate name" className={inputClass} />
          <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Category" className={inputClass} />
          <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={inputClass} />
          <button type="submit" disabled={uploading || !file} className={buttonClass}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      </Panel>

      <Panel title="Compliance vault" subtitle={`${documents.length} document(s)`}>
        {loading && documents.length === 0 ? (
          <Spinner label="Loading documents" />
        ) : isEmpty ? (
          <EmptyState
            title="Vault is empty"
            message="Upload your registration certificates, ISO documents and licences. Tender qualification checks them by expiry date."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">
                  <th className="pb-3 pr-4">Document</th>
                  <th className="pb-3 pr-4">Category</th>
                  <th className="pb-3 pr-4">Expiry</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Size</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => {
                  const style = STATUS_STYLES[doc.validityStatus] ?? STATUS_STYLES.unknown;
                  return (
                    <tr key={doc.id} className="border-t border-slate-800/60">
                      <td className="py-3 pr-4 text-[12px] text-slate-200">{doc.cert_name}</td>
                      <td className="py-3 pr-4 text-[11px] text-slate-500">{doc.category ?? '—'}</td>
                      <td className="py-3 pr-4 text-[11px] text-slate-400 tabular-nums">
                        {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString('en-GB') : '—'}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${style.className}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-[11px] text-slate-500">{formatSize(doc.file_size)}</td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <button disabled={!doc.hasFile} onClick={() => void openDocument(doc.id)} className={ghostButtonClass}>
                          View
                        </button>
                        <button disabled={!doc.hasFile} onClick={() => void openDocument(doc.id, true)} className={ghostButtonClass}>
                          Download
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Archive "${doc.cert_name}"? The stored file is deleted.`)) {
                              void archiveDocument(doc.id);
                            }
                          }}
                          className={ghostButtonClass}
                        >
                          Archive
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
