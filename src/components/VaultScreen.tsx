import * as React from 'react';
import { useState } from 'react';
import { 
  ShieldCheck, Upload, FileText,
  Eye, ArrowLeft, Lock, Calendar, Plus, FolderLock, Download
} from 'lucide-react';
import { useVault } from '../hooks/useVault';
import { describeApiError } from '../services/api/client';

interface VaultScreenProps {
  onBack: () => void;
}

/**
 * Compliance vault.
 *
 * Documents live in Supabase Storage under this organisation's own path
 * prefix. Nothing in this component builds a file path: viewing or
 * downloading asks the server for a signed URL that expires in minutes.
 */
export const VaultScreen: React.FC<VaultScreenProps> = ({ onBack }) => {
  const { documents, uploading, error, addDocument, replaceDocument, openDocument } = useVault();


  // --- UPLOAD MODAL STATE ---
  const [uploadModal, setUploadModal] = useState<{ isOpen: boolean; mode: 'create' | 'edit'; docId: string | null; docName: string }>({
    isOpen: false, mode: 'edit', docId: null, docName: ''
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // New Document Fields
  const [newDocName, setNewDocName] = useState('');
  const [newDocCategory, setNewDocCategory] = useState<'FINANCIAL' | 'TECHNICAL' | 'LEGAL'>('LEGAL');
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [expiryDate, setExpiryDate] = useState('');
  const [noExpiry, setNoExpiry] = useState(false);
  const isUploading = uploading;

  const openUpdateModal = (docId: string, docName: string) => {
    setSelectedFile(null);
    setExpiryDate('');
    setNoExpiry(false);
    setUploadModal({ isOpen: true, mode: 'edit', docId, docName });
  };

  const openCreateModal = () => {
    setSelectedFile(null);
    setExpiryDate('');
    setNoExpiry(false);
    setNewDocName('');
    setNewDocCategory('LEGAL');
    setUploadModal({ isOpen: true, mode: 'create', docId: null, docName: 'New Document' });
  };

  const handleConfirmUpload = async () => {
    if (uploadModal.mode === 'create' && !newDocName.trim()) {
      setUploadError('Give the document a name.');
      return;
    }
    if (!selectedFile) {
      setUploadError('Choose a file to upload.');
      return;
    }
    if (!noExpiry && !expiryDate) {
      setUploadError('Set an expiry date, or mark the document as having none.');
      return;
    }

    setUploadError(null);

    try {
      if (uploadModal.mode === 'create') {
        await addDocument({
          file: selectedFile,
          certName: newDocName.trim(),
          category: newDocCategory,
          expiryDate: noExpiry ? 'Lifetime' : expiryDate,
        });
      } else if (uploadModal.docId) {
        await replaceDocument(uploadModal.docId, selectedFile, noExpiry ? 'Lifetime' : expiryDate);
      }

      // The hook reloads from the server instead of patching local state, so
      // what is displayed is what was actually stored.
      setUploadModal({ isOpen: false, mode: 'edit', docId: null, docName: '' });
      setSelectedFile(null);
    } catch (err) {
      setUploadError(describeApiError(err));
    }
  };

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col font-sans z-50">
      
      {/* HEADER */}
      <div className="shrink-0 p-6 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between z-10 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white">
             <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
              <Lock className="w-6 h-6 text-gold-500" /> Compliance Vault
            </h1>
            <p className="text-xs text-slate-500 mt-1">End-to-End Encrypted Document Storage for Automated Bidding</p>
          </div>
        </div>

        <button 
          onClick={openCreateModal} 
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20"
        >
          <Plus className="w-4 h-4" /> Add Document
        </button>
      </div>

      {/* CONTENT */}
      <div className="flex-grow overflow-y-auto scrollbar-hide p-8 relative">
        {(error || uploadError) && (
          <div className="max-w-7xl mx-auto mb-6 bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3">
            <p className="text-[11px] text-rose-300">{uploadError ?? error}</p>
          </div>
        )}
        {documents.length === 0 ? (
           <div className="w-full max-w-2xl mx-auto mt-20 flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-800 rounded-[3rem] bg-slate-900/20 text-center">
              <div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center mb-6 border border-slate-800 shadow-xl">
                 <FolderLock className="w-10 h-10 text-slate-600" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight mb-2">Vault is Empty</h2>
              <p className="text-slate-400 text-sm max-w-sm leading-relaxed mb-8">
                 Your secure locker has no compliance documents. Upload your company's foundation data to enable automated tender verification.
              </p>
              <button 
                 onClick={openCreateModal}
                 className="flex items-center gap-2 bg-gold-500 text-slate-950 hover:bg-white px-8 py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(212,175,55,0.3)]"
              >
                 <Upload className="w-4 h-4" /> Upload First Document
              </button>
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
              {documents.map((doc) => (
                <div key={doc.id} className={`flex flex-col bg-slate-900/40 border rounded-3xl p-6 relative overflow-hidden transition-all shadow-xl ${doc.validityStatus === 'expired' ? 'border-red-500/30 bg-red-500/5' : 'border-slate-800/80 hover:border-emerald-500/30'}`}>
                  
                  {/* Badge */}
                  <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[9px] font-black uppercase tracking-widest ${doc.category === 'FINANCIAL' ? 'bg-blue-500/20 text-blue-400' : doc.category === 'TECHNICAL' ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-700 text-slate-300'}`}>
                    {doc.category ?? 'UNCATEGORISED'}
                  </div>

                  <div className="flex items-start gap-4 mb-6 mt-2">
                      <div className={`p-3 rounded-xl shrink-0 ${doc.validityStatus === 'expired' ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                          {doc.validityStatus === 'expired' ? <FileText className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
                      </div>
                      <div>
                          <h3 className="text-sm font-bold text-white leading-tight pr-4">{doc.cert_name}</h3>
                          <p className={`text-[10px] font-black uppercase tracking-widest mt-1.5 ${
                            doc.validityStatus === 'expired'
                              ? 'text-red-400'
                              : doc.validityStatus === 'expiring_soon'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          }`}>
                              {doc.validityStatus === 'expired'
                                ? 'Expired'
                                : doc.validityStatus === 'expiring_soon'
                                  ? 'Expiring soon'
                                  : doc.validityStatus === 'unknown'
                                    ? 'No expiry recorded'
                                    : 'Valid'}
                          </p>
                      </div>
                  </div>

                  <div className="mt-auto space-y-4">
                      <div className="flex justify-between items-center text-[10px] font-bold uppercase text-slate-500 bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/50">
                          <span>Expiry Date</span>
                          <span className={doc.validityStatus === 'expired' ? 'text-red-400' : 'text-slate-300'}>
                            {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString('en-GB') : 'Not recorded'}
                          </span>
                      </div>

                      {/* --- THE NEW ACTION BAR (VIEW, DOWNLOAD, UPDATE) --- */}
                      <div className="flex gap-2">
                          {doc.hasFile && (
                              <>
                                <button
                                  onClick={() => void openDocument(doc.id)}
                                  className="flex-1 py-2.5 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                                  title="Preview Document"
                                >
                                    <Eye className="w-3 h-3" /> View
                                </button>
                                
                                <button
                                  onClick={() => void openDocument(doc.id, true)}
                                  className="flex-1 py-2.5 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                                  title="Download to PC"
                                >
                                    <Download className="w-3 h-3" /> Save
                                </button>
                              </>
                          )}
                          <button 
                              onClick={() => openUpdateModal(doc.id, doc.cert_name)}
                              className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                                  doc.hasFile
                                      ? 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-blue-400 hover:border-blue-500/50'
                                      : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20'
                                  }`}
                          >
                              <Upload className="w-3 h-3" /> {doc.hasFile ? 'Update' : 'Upload Now'}
                          </button>
                      </div>
                  </div>

                  {doc.validityStatus === 'expired' && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500/50 to-red-900/50 animate-pulse" />
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* --- UPLOAD OVERLAY MODAL --- */}
      {uploadModal.isOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-8">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95">
            <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2 mb-2">
              <Upload className="w-5 h-5 text-blue-500" /> {uploadModal.mode === 'create' ? 'Add New Document' : 'Update Document'}
            </h2>
            
            {uploadModal.mode === 'edit' ? (
              <p className="text-xs text-slate-400 mb-6 border-b border-slate-800 pb-4">Updating: <strong className="text-gold-500">{uploadModal.docName}</strong></p>
            ) : (
              <div className="space-y-4 mb-6 border-b border-slate-800 pb-6 pt-2">
                 <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Document Name</label>
                    <input 
                      type="text" 
                      value={newDocName} 
                      onChange={e => setNewDocName(e.target.value)} 
                      placeholder="e.g., ISO 14001:2015 Certificate"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500 transition-colors"
                    />
                 </div>
                 <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Category</label>
                    <select 
                      value={newDocCategory} 
                      onChange={e => setNewDocCategory(e.target.value as any)} 
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
                    >
                       <option value="FINANCIAL">Financial / Tax</option>
                       <option value="TECHNICAL">Technical / Quality</option>
                       <option value="LEGAL">Legal / Statutory</option>
                    </select>
                 </div>
              </div>
            )}
            
            <div className="space-y-6 mt-4">
              {/* File Input */}
              <div>
                 <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Select File (PDF, JPG, PNG)</label>
                 <input 
                   type="file" 
                   accept=".pdf, image/*"
                   onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                   className="w-full text-xs text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-blue-500/10 file:text-blue-400 hover:file:bg-blue-500/20 cursor-pointer bg-slate-950 border border-slate-800 rounded-xl p-2 outline-none"
                 />
              </div>

              {/* Expiry Logistics */}
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-4">
                 <div className="flex items-center gap-3">
                   <input 
                     type="checkbox" 
                     id="noExpiry" 
                     checked={noExpiry} 
                     onChange={(e) => setNoExpiry(e.target.checked)}
                     className="w-4 h-4 accent-blue-500 cursor-pointer"
                   />
                   <label htmlFor="noExpiry" className="text-xs font-bold text-slate-300 cursor-pointer">Document has no expiry date (Lifetime validity)</label>
                 </div>

                 {!noExpiry && (
                   <div className="pt-2">
                     <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2"><Calendar className="w-3 h-3" /> Valid Until</label>
                     <input 
                       type="date" 
                       value={expiryDate}
                       onChange={(e) => setExpiryDate(e.target.value)}
                       className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                     />
                   </div>
                 )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                 <button 
                   onClick={() => setUploadModal({ isOpen: false, mode: 'edit', docId: null, docName: '' })} 
                   className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                 >
                   Cancel
                 </button>
                 <button 
                   onClick={handleConfirmUpload}
                   disabled={isUploading}
                   className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20"
                 >
                   {isUploading ? 'Uploading...' : 'Save to Vault'}
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
};