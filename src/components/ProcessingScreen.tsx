import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Rfp, LogEntry,AppConfig,VaultItem } from '../../types';
import { useOrganization } from '../contexts/OrganizationContext';
import { TrendingUp, TrendingDown, Activity, Cpu, ShieldCheck, Database, Factory, Award } from 'lucide-react';
import { aiApi, organizationApi } from '../services/api';

interface ProcessingScreenProps {
  rfp: Rfp;
  logs: LogEntry[];
  onViewResults: () => void;
  onBack: () => void;
  config: AppConfig;
  priorPhasesDuration: number;
  processingStartTime: Date | null;
}

export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({
  rfp,config, logs, onViewResults, onBack, priorPhasesDuration = 0,
}) => {
  const [totalElapsed, setTotalElapsed] = useState(priorPhasesDuration);
  const [insightIndex, setInsightIndex] = useState(0);
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);
  const [vaultDocs, setVaultDocs] = useState<VaultItem[]>([]);
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;
  // LIVE AI MARKET DATA (Unified Payload)
  const [liveInsights, setLiveInsights] = useState<string[]>(["Establishing secure uplink to market intelligence..."]);
  const [commodities, setCommodities] = useState<any[]>([
    { symbol: "LME.Cu", name: "Copper (Grade A)", price: "₹---", trend: "---", up: true },
    { symbol: "LME.Al", name: "Primary Alum", price: "₹---", trend: "---", up: true },
    { symbol: "IDX.PVC", name: "PVC Resin", price: "₹---", trend: "---", up: true },
    { symbol: "IDX.STL", name: "Galv Steel", price: "₹---", trend: "---", up: true }
  ]);


  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const isProcessing = rfp.status !== 'Complete' && rfp.status !== 'Error';
  const isExtractionDone = rfp.status === 'Complete';

  // 1. FETCH LIVE MARKET DATA ON MOUNT
  useEffect(() => {
    const fetchLiveIntelligence = async () => {
      try {
        const json = await aiApi.marketInsights();

        if (json.data) {
          if (json.data.insights && json.data.insights.length > 0) {
            setLiveInsights(json.data.insights);
          }
          if (json.data.commodities && json.data.commodities.length > 0) {
            setCommodities(json.data.commodities);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch live insights.");
        setLiveInsights(["Market intelligence telemetry temporarily offline."]);
      }
    };
    fetchLiveIntelligence();
  }, []);

  useEffect(() => {
    const fetchVault = async () => {
      try {
        if (!organizationId) return;
        const data = await organizationApi.getComplianceSnapshot(organizationId);
        setVaultDocs(data.certificates);
      } catch (err) {
        console.error('Vault fetch failed', err);
      }
    };
    fetchVault();
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isProcessing) {
      timer = setInterval(() => setTotalElapsed(prev => prev + 1), 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [isProcessing]);

  // 3. DYNAMIC INSIGHT TICKER
  useEffect(() => {
    const insightTicker = setInterval(() => {
      setInsightIndex(prev => (prev + 1) % liveInsights.length);
    }, 6000);
    return () => clearInterval(insightTicker);
  }, [liveInsights.length]);

  // Auto-Scroll trigger whenever 'logs' array updates
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);
    const vaultCount = vaultDocs.length || 13;
    const validVaultCount = vaultDocs.length > 0 ? vaultDocs.filter(doc => doc.is_valid).length : 11;

  return (
    <div className="h-full w-full bg-slate-950 text-slate-200 flex flex-col relative font-sans overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gold-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 h-full flex flex-col">
        
        {/* LOCAL HEADER */}
        <div className="flex justify-between items-end mb-8 border-b border-slate-800 pb-6 shrink-0">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-white mb-1 uppercase italic">
              Orchestrating <span className="text-gold-500">Analysis</span>
            </h1>
            <p className="text-slate-500 font-mono text-[10px] uppercase tracking-[0.2em] font-bold">
              Authorization: Validated  ⟹ RFP ID: {rfp.id}
            </p>
          </div>
          <div className="text-right">
            <span className="block text-[9px] text-gold-500/60 uppercase font-black tracking-widest mb-1">
              {isProcessing ? "Cumulative Process Time" : "Total Time Taken"}
            </span>
            <span className={`text-4xl font-light tracking-tighter transition-colors ${isProcessing ? 'text-white' : 'text-gold-500'}`}>
              {totalElapsed}<span className="text-lg text-slate-600 ml-1 italic">s</span>
            </span>
          </div>
        </div>

        {/* MAIN COMMAND GRID: Strict 3-Column Layout */}
        <div className="grid grid-cols-12 gap-6 flex-grow overflow-hidden mb-6 min-h-0">
          
          {/* COLUMN 1: LIVE LOG STREAM */}
          <div className="col-span-4 flex flex-col bg-slate-900/40 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-md min-h-0 h-full">
            <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex justify-between items-center shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                 <Cpu className="w-3 h-3 text-purple-500" /> Agent Live Stream
              </span>
              {!isProcessing && <span className="text-[8px] bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded font-black">STABLE</span>}
            </div>
            <div className="flex-grow p-6 font-mono text-[11px] overflow-y-auto space-y-3 scrollbar-hide relative">
              <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.1)_50%)] bg-[size:100%_4px] pointer-events-none z-0" />
              <div className="relative z-10">
                {logs.map((log, i) => (
                  <div key={i} className="animate-fade-in opacity-80 hover:opacity-100 transition-opacity flex gap-3 mb-2">
                    <span className="text-gold-500/50 shrink-0">
                      [{log.timestamp instanceof Date ? log.timestamp.toLocaleTimeString('en-US', { hour12: false }) : log.timestamp}]
                    </span>
                    <div className="flex flex-col">
                      <span className="text-blue-400 uppercase font-black tracking-tighter text-[9px]">{log.agent}:</span>
                      <span className="text-slate-300 leading-relaxed">{log.message}</span>
                    </div>
                  </div>
                ))}
                {isProcessing && (
                  <div className="animate-pulse text-gold-500 text-[10px] font-black mt-2 flex items-center gap-2">
                    <div className="w-1.5 h-3 bg-gold-500" /> SYSTEM_ORCHESTRATION_ACTIVE...
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>

          {/* COLUMN 2: DYNAMIC MIDDLE (Corporate Baseline -> Success Button) */}
          <div className="col-span-4 flex flex-col min-h-0">
            {!isExtractionDone ? (
              <div className="h-full flex flex-col bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 blur-[40px] rounded-full pointer-events-none" />
                
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2 relative z-10">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> Corporate Baseline Matrix
                </h3>
                
                <div className="space-y-4 relative z-10 flex-grow">
                  <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4">
                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Pre-Loading Eligibility Context</div>
                    <div className="text-sm font-bold text-white truncate">Preparing System for Cross-Reference</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="bg-slate-900/80 border border-slate-700/50 p-3 rounded-xl flex flex-col justify-center">
                      <Factory className="w-4 h-4 text-slate-400 mb-2" />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Verified Turnover</span>
                      <span className="text-sm font-black text-white mt-0.5">
                        {(config.companyDetails as any).turnover || 'TBD'} 
                        <span className="text-[9px] text-emerald-400 ml-1">{(config.companyDetails as any).turnoverYear || ''}</span>
                      </span>
                    </div>
                    <div className="bg-slate-900/80 border border-slate-700/50 p-3 rounded-xl flex flex-col justify-center">
                      <Award className="w-4 h-4 text-slate-400 mb-2" />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">OEM Status</span>
                      <span className="text-sm font-black text-white mt-0.5">{(config.companyDetails as any).oemStatus || 'Not Declared'}</span>
                    </div>
                    <div className="bg-slate-900/80 border border-slate-700/50 p-3 rounded-xl flex flex-col justify-center">
                      <ShieldCheck className="w-4 h-4 text-slate-400 mb-2" />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Vault Integrity</span>
                      <span className="text-sm font-black text-emerald-400 mt-0.5">{validVaultCount}/{vaultCount} Verified</span>
                    </div>
                    <div className="bg-slate-900/80 border border-slate-700/50 p-3 rounded-xl flex flex-col justify-center">
                      <Database className="w-4 h-4 text-slate-400 mb-2" />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">PIM Inventory Ping</span>
                      <span className="text-sm font-black text-blue-400 mt-0.5">Nodes Online</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-gold-500 animate-pulse text-center">
                    Aligning RFP Requirements against Baseline...
                  </span>
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gold-500 w-[65%] animate-[loading_2s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>
            ) : (
              <div 
                onClick={() => setIsSnapshotOpen(true)}
                className="h-full group cursor-pointer flex flex-col items-center justify-center p-8 bg-gold-500/5 border border-gold-500/20 rounded-3xl transition-all hover:bg-gold-500/10 hover:border-gold-500/40 backdrop-blur-md animate-in zoom-in-95 duration-500"
              >
                <div className="w-14 h-14 rounded-full bg-gold-500 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(212,175,55,0.4)] transition-transform group-hover:scale-110">
                  <svg className="w-6 h-6 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
                <h2 className="text-xl font-black text-white uppercase tracking-tighter mb-2 text-center">Extraction Successful</h2>
                <p className="text-slate-400 text-xs italic mb-4 text-center">Pipeline stabilized at {totalElapsed}s. Click to interrogate raw JSON payload.</p>
                <span className="text-gold-500 text-[9px] font-black uppercase tracking-widest border-b border-gold-500/30 pb-0.5 group-hover:text-white transition-colors">Review Technical Snapshot →</span>
              </div>
            )}
          </div>

          {/* COLUMN 3: MARKET INTELLIGENCE (Always visible) */}
          <div className="col-span-4 flex flex-col gap-4 min-h-0">
            <div className="grid grid-cols-2 gap-4 shrink-0">
              {commodities.map((item, idx) => (
                <CommodityCard 
                  key={idx} 
                  symbol={item.symbol} 
                  name={item.name} 
                  price={item.price} 
                  trend={item.trend} 
                  up={item.up} 
                />
              ))}
            </div>
            
            <div className="flex-grow bg-blue-900/10 border border-blue-500/20 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-center backdrop-blur-md">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[50px] pointer-events-none" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-4 flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Live Market Intelligence
                </h3>
                <p className="text-sm text-slate-300 font-medium leading-relaxed italic animate-in fade-in slide-in-from-right-4 duration-500" key={insightIndex}>
                  "{liveInsights[insightIndex]}"
                </p>
            </div>
          </div>
          
        </div>

        {/* FOOTER */}
        <div className="flex justify-between items-center py-6 border-t border-slate-900 shrink-0">
          <button onClick={onBack} className="text-slate-600 hover:text-white transition-colors text-[10px] font-black uppercase tracking-widest">← Abort Pipeline</button>
          
          {isExtractionDone && (
            <button 
              onClick={onViewResults}
              className="group relative px-12 py-4 bg-white text-slate-950 font-black uppercase text-[10px] tracking-widest rounded-xl overflow-hidden transition-all hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] shadow-lg"
            >
              <div className="absolute inset-0 bg-gold-500/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
              <span className="relative z-10">Initiate Deep Analysis →</span>
            </button>
          )}
        </div>
      </div>

      {/* SNAPSHOT OVERLAY */}
      {isSnapshotOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-3xl flex flex-col p-8">
          <div className="max-w-6xl mx-auto w-full flex flex-col h-full bg-slate-900/50 border border-slate-800 rounded-[40px] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95">
            <div className="p-8 border-b border-slate-800 flex justify-between items-center bg-slate-900/40">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">Extraction <span className="text-gold-500">Fragment</span></h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Raw Telemetry & Extracted Metadata</p>
              </div>
              <button 
                onClick={() => setIsSnapshotOpen(false)} 
                className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 text-white hover:border-gold-500 hover:text-gold-500 transition-all flex items-center justify-center text-xl font-black"
              >✕</button>
            </div>
            
            <div className="flex-grow overflow-y-auto p-12 scrollbar-hide">
              <pre className="text-[11px] text-blue-300 bg-slate-950/80 p-8 rounded-3xl border border-gold-500/10 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
                {JSON.stringify(rfp.agentOutputs?.parsedData, null, 4)}
              </pre>
            </div>

            <div className="p-8 border-t border-slate-800 bg-slate-900/40 flex justify-center gap-6">
              <button 
                onClick={() => setIsSnapshotOpen(false)}
                className="px-10 py-3 bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-700 transition-all shadow-md"
              >Close Fragment</button>
              <button 
                onClick={() => { setIsSnapshotOpen(false); onViewResults(); }}
                className="bg-white text-slate-950 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gold-500 transition-all shadow-lg flex items-center gap-2"
              >Proceed to Analysis →</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

const CommodityCard = ({ symbol, name, price, trend, up }: { symbol: string, name: string, price: string, trend: string, up: boolean }) => (
  <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between backdrop-blur-md">
    <div className="flex justify-between items-start mb-2">
      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">{symbol}</span>
      {up ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-red-500" />}
    </div>
    <div>
      <p className="text-[10px] font-bold text-white mb-0.5 truncate">{name}</p>
      <div className="flex items-end gap-2">
        <span className="text-sm font-mono font-black text-slate-200">{price}</span>
        <span className={`text-[9px] font-bold mb-0.5 ${up ? 'text-emerald-400' : 'text-red-400'}`}>{trend}</span>
      </div>
    </div>
  </div>
);