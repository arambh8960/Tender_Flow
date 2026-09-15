import * as React from 'react';
import { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { rfpApi } from '../services/api';
import { useOrganization } from '../contexts/OrganizationContext';
import { describeApiError } from '../services/api/client';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface RfpInputProps {
    onSubmit: (data: { source: 'URL' | 'File'; content: string; fileName?: string; }) => void;
}

type InputMode = 'url' | 'file';

interface IngestionProgress {
    status: 'idle' | 'processing' | 'done' | 'error';
    steps: { message: string, icon: string }[];
}

export const RfpInput: React.FC<RfpInputProps> = ({ onSubmit }) => {
    const [mode, setMode] = useState<InputMode>('file');
    const [url, setUrl] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [ingestionProgress, setIngestionProgress] = useState<IngestionProgress>({ status: 'idle', steps: [] });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const { activeOrganization } = useOrganization();
    const organizationId = activeOrganization?.id ?? null;

    const extractTextFromPdf = async (file: File): Promise<string> => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map((item: any) => ('str' in item ? item.str : '')).join(' ') + '\n';
        }
        return fullText;
    };

    const handleFileProcessing = async (file: File) => {
        if (!file) return;
        setIngestionProgress({ status: 'processing', steps: [{ message: 'Reading file...', icon: '⚙️' }] });
        try {
            let content = '';
            if (file.type === 'application/pdf') {
                setIngestionProgress(prev => ({...prev, steps: [...prev.steps, { message: 'Digital PDF detected', icon: '📄' }]}));
                content = await extractTextFromPdf(file);
                if (content.trim().length < 100) {
                    // Substituting a bundled sample here would analyse a
                    // document the user never uploaded and present the result
                    // as theirs. A scanned PDF needs OCR, not a stand-in.
                    setIngestionProgress({
                        status: 'error',
                        steps: [{ message: 'No readable text found — this looks like a scanned PDF. Upload a text-based PDF.', icon: '✖' }],
                    });
                    return;
                }
            } else {
                content = await file.text();
            }
            setIngestionProgress(prev => ({...prev, steps: [...prev.steps, { message: 'Extraction successful', icon: '✔' }]}));
            setTimeout(() => {
                onSubmit({ source: 'File', content: content, fileName: file.name });
                setIngestionProgress({ status: 'idle', steps: [] });
                setSelectedFile(null);
            }, 1000);
        } catch (error) {
            setIngestionProgress({ status: 'error', steps: [{ message: 'Terminal Error: Process Aborted', icon: '✖' }] });
            setTimeout(() => { setIngestionProgress({ status: 'idle', steps: [] }); setSelectedFile(null); }, 3000);
        }
    };

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        if (event.dataTransfer.files && event.dataTransfer.files[0] && ingestionProgress.status !== 'processing') {
            setSelectedFile(event.dataTransfer.files[0]);
        }
    }, [ingestionProgress.status]);

    const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (ingestionProgress.status !== 'processing') setIsDragOver(true);
    }, [ingestionProgress.status]);

    const handleUrlSubmit = async () => {
        if (!url) return;
        setIngestionProgress({ status: 'processing', steps: [{ message: 'Proxying through Master Backend...', icon: '🔗' }] });
        try {
            if (!organizationId) throw new Error('No active organisation.');
            const data = await rfpApi.fetchFromUrl(organizationId, url);
            onSubmit({ source: 'URL', content: data.content, fileName: url });
            setIngestionProgress({ status: 'idle', steps: [] });
        } catch (e) {
            // The real reason matters here: a blocked URL and a timeout call
            // for different actions from the user.
            setIngestionProgress({ status: 'error', steps: [{ message: describeApiError(e), icon: '✖' }] });
        }
    };
    const renderFileContent = () => {
        if (ingestionProgress.status === 'processing' || ingestionProgress.status === 'error') {
            return (
                <div className="flex flex-col items-center justify-center py-2">
                    <div className="flex gap-2 mb-3">
                        <div className="w-2 h-2 bg-gold-500 rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-gold-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-2 h-2 bg-gold-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                    {ingestionProgress.steps.map((step, index) => (
                        <p key={index} className={`text-[9px] font-black uppercase tracking-widest leading-relaxed ${ingestionProgress.status === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                            {step.icon} {step.message}
                        </p>
                    ))}
                </div>
            );
        }
        if (selectedFile) {
            return (
                <div className="flex flex-col items-center justify-center">
                    <div className="text-2xl mb-1">📄</div>
                    <p className="font-bold text-white uppercase text-[10px] tracking-tight truncate max-w-[200px]">{selectedFile.name}</p>
                    <p className="text-[9px] text-slate-500 font-mono">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} className="mt-2 text-[9px] font-black text-red-500 uppercase hover:underline">Eject</button>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center">
                <div className={`text-3xl mb-2 transition-transform ${isDragOver ? 'scale-110' : 'scale-100'}`}>📥</div>
                <p className="font-black text-slate-300 uppercase tracking-widest text-[10px]">Drop Master RFP</p>
                <p className="text-[8px] text-slate-600 mt-1 uppercase font-bold">PDF, DOCX, TXT</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-5 backdrop-blur-xl flex flex-col h-full overflow-hidden shadow-2xl">
            {/* 1. HEADER AREA - Reduced padding for vertical space */}
            <div className="flex justify-between items-center mb-4 border-b border-slate-800/50 pb-3 shrink-0">
                <div className="flex flex-col">
                    <h3 className="text-lg font-black italic tracking-tighter text-white uppercase leading-none">
                        Manual <span className="text-gold-500">Ingestion</span>
                    </h3>
                    <p className="text-[8px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">Deep Parser</p>
                </div>
                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 scale-90">
                    <button onClick={() => setMode('file')} className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${mode === 'file' ? 'bg-gold-500 text-slate-950 shadow-md' : 'text-slate-500 hover:text-white'}`}>File</button>
                    <button onClick={() => setMode('url')} className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${mode === 'url' ? 'bg-gold-500 text-slate-950 shadow-md' : 'text-slate-500 hover:text-white'}`}>URL</button>
                </div>
            </div>

            {/* 2. DYNAMIC INPUT AREA - flex-grow ensures it takes available space */}
            <div className="flex-grow flex flex-col justify-center min-h-0">
                {mode === 'file' ? (
                    <div className="flex flex-col h-full">
                        <input type="file" id="file-upload" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} accept=".pdf,.docx,.txt" />
                        <div 
                            onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={() => setIsDragOver(false)}
                            onClick={() => document.getElementById('file-upload')?.click()}
                            className={`flex-grow border-2 border-dashed rounded-2xl transition-all duration-300 flex flex-col items-center justify-center px-4 py-6 ${
                                isDragOver ? 'border-gold-500 bg-gold-500/5' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                            } ${ingestionProgress.status === 'processing' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                           {renderFileContent()}
                        </div>
                        <button
                            onClick={() => { if (selectedFile) handleFileProcessing(selectedFile); }}
                            disabled={!selectedFile || ingestionProgress.status === 'processing'}
                            className="mt-3 w-full bg-white text-slate-950 py-3 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] transition-all shadow-lg disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
                        >
                            {ingestionProgress.status === 'processing' ? 'Analyzing...' : 'Initiate Analysis'}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4 flex flex-col justify-center h-full pb-2">
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Government e Marketplace</label>
                            <input 
                                type="url" value={url} onChange={(e) => setUrl(e.target.value)} 
                                placeholder="https://bidplus.gem.gov.in/..." 
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:border-gold-500 outline-none transition-all placeholder:text-slate-800 font-bold" 
                            />
                        </div>
                        <button 
                            onClick={handleUrlSubmit} 
                            disabled={ingestionProgress.status === 'processing' || !url}
                            className="bg-white text-slate-950 px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(212,175,55,0.3)]"
                        >
                            Scrape Documentation
                        </button>
                        {ingestionProgress.status === 'processing' && (
                            <div className="text-center animate-pulse pt-2">
                                <p className="text-[8px] font-black text-gold-500 uppercase tracking-widest">Master Agent Bypassing Proxy...</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};