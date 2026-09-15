import * as React from 'react';
import { useState, useMemo } from 'react';
import { ShieldCheck, LogOut, KeyRound, Factory, TrendingUp, Award } from 'lucide-react';
import { AppConfig, CompanyConfig, SigningAuthority, SKU } from '../../types';
import { organizationApi } from '../services/api';
import { describeApiError } from '../services/api/client';
import { useOrganization } from '../contexts/OrganizationContext';

interface ConfigScreenProps {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  inventory: SKU[]; 
  onOpenVault: () => void;
  onLogout: () => void;      
  onChangePin: () => void;   
}

export const ConfigScreen: React.FC<ConfigScreenProps> = ({ 
  config, 
  setConfig,
  inventory,
  onOpenVault,
  onLogout,
  onChangePin
}) => {
  const [companyDetails, setCompanyDetails] = useState<CompanyConfig>(config.companyDetails);
  const [isAddingAuthority, setIsAddingAuthority] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const { activeOrganization } = useOrganization();
  const organizationId = activeOrganization?.id ?? null;
  const [newAuth, setNewAuth] = useState({ name: '', designation: '', din: '' });

  // --- LIVE ASSET CALCULATIONS (Bulletproof Fallback) ---
  const totalInventoryValue = useMemo(() => {
    if (!inventory) return 0;
    return inventory.reduce((sum, item) => sum + (item.availableQuantity * item.unitSalesPrice), 0);
  }, [inventory]);

  const top3Assets = useMemo(() => {
    if (!inventory) return [];
    return [...inventory]
      .map(item => ({ ...item, totalValue: item.availableQuantity * item.unitSalesPrice }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 3);
  }, [inventory]);

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCompanyDetails(prev => ({ ...prev, [name]: value }));
  };

  /**
   * Saves the company profile.
   *
   * Authorisation is the caller's role in this organisation, checked by the
   * server. The shared admin password that used to gate this is gone: it was
   * the same for every deployment and sat in the repository.
   */
  const handleSave = async () => {
    if (!organizationId) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await organizationApi.updateProfile(organizationId, {
        address: companyDetails.companyAddress,
        gstin: companyDetails.gstin,
        pan: companyDetails.pan,
        domain: companyDetails.domain,
        turnoverYear: companyDetails.turnoverYear,
        oemStatus: companyDetails.oemStatus,
        ...(companyDetails.turnover ? { annualTurnoverCr: Number(companyDetails.turnover) } : {}),
      });
      setSaveMessage('Company profile saved.');
    } catch (err) {
      setSaveMessage(describeApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const addAuthority = () => {
    if (!newAuth.name || !newAuth.din) return;
    const authority: SigningAuthority = { id: `DIR-${Date.now()}`, ...newAuth };
    setConfig(prev => ({ ...prev, signingAuthorities: [...prev.signingAuthorities, authority] }));
    setNewAuth({ name: '', designation: '', din: '' });
    setIsAddingAuthority(false);
  };

  return (
    <div className="h-full flex flex-col space-y-5 overflow-hidden text-slate-200">
      
      {/* 1. HEADER SECTION */}      
      <div className="shrink-0 h-[15%] min-h-[100px] bg-slate-900/40 border border-slate-800 rounded-3xl p-6 flex items-center justify-between backdrop-blur-xl shadow-xl">
        <div className="space-y-1">
          <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase drop-shadow-md">
            Company <span className="text-gold-500">Profile</span>
          </h1>
          <p className="text-[10px] text-slate-400 font-bold leading-relaxed max-w-xs uppercase tracking-widest">
            Master Identity & Authorization Control
          </p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={onOpenVault}
            className="flex items-center gap-2 bg-slate-950 text-blue-400 border border-blue-900/30 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:bg-blue-600 hover:text-white shadow-[0_0_20px_rgba(37,99,235,0.2)]"
          >
            <ShieldCheck className="w-4 h-4" />
            Manage Vault
          </button>
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-white text-slate-950 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            >
              {saving ? 'Saving…' : 'Push Changes'}
            </button>
            {/* The outcome is shown in place rather than in an alert box. */}
            {saveMessage && <span className="text-[10px] text-slate-400">{saveMessage}</span>}
          </div>
        </div>
      </div>

      {/* 2. MAIN CONFIG GRID (3 Columns - Made Scrollable) */}
      <div className="grid grid-cols-12 gap-6 flex-grow overflow-hidden">
        
        {/* LEFT: COMPANY IDENTITY (Editable) */}
        <div className="col-span-4 bg-slate-900/40 border border-slate-800 rounded-3xl p-6 flex flex-col backdrop-blur-xl shadow-xl overflow-hidden">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-5 shrink-0">Corporate Identity</h3>
          
          <div className="space-y-4 flex-grow overflow-y-auto scrollbar-hide pr-2">
            <ConfigInput label="Registered Entity Name" name="companyName" value={companyDetails.companyName} onChange={handleCompanyChange} />
            
            <div className="grid grid-cols-2 gap-3">
              <ConfigInput label="GSTIN (Tax ID)" name="gstin" value={companyDetails.gstin} onChange={handleCompanyChange} />
              <ConfigInput label="PAN (Tax ID)" name="pan" value={companyDetails.pan} onChange={handleCompanyChange} />
            </div>

            {/* NEW EDITABLE DYNAMIC FIELDS */}
            <div className="grid grid-cols-2 gap-3">
              <ConfigInput label="Primary Domain" name="domain" value={(companyDetails as any).domain || ''} onChange={handleCompanyChange} />
              <ConfigInput label="OEM Status" name="oemStatus" value={(companyDetails as any).oemStatus || ''} onChange={handleCompanyChange} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ConfigInput label="Annual Turnover" name="turnover" value={(companyDetails as any).turnover || ''} onChange={handleCompanyChange} />
              <ConfigInput label="Financial Year" name="turnoverYear" value={(companyDetails as any).turnoverYear || ''} onChange={handleCompanyChange} />
            </div>

            <div className="flex flex-col gap-1 pb-4">
              <label className="text-[9px] font-black uppercase text-slate-500 ml-2">Headquarters Address</label>
              <textarea 
                name="companyAddress"
                value={companyDetails.companyAddress}
                onChange={handleCompanyChange}
                rows={3}
                className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm focus:border-gold-500 outline-none transition-all resize-none placeholder:text-slate-700 text-white"
              />
            </div>
          </div>
        </div>

        {/* MIDDLE: CORPORATE BASELINE & VALUATION (Dynamic) */}
        <div className="col-span-4 bg-slate-900/40 border border-slate-800 rounded-3xl p-6 flex flex-col relative overflow-hidden backdrop-blur-xl shadow-xl">
          <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-emerald-500/5 blur-[60px] rounded-full pointer-events-none" />
          
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-500/80 mb-6 relative z-10 flex items-center gap-2 shrink-0">
            <TrendingUp className="w-4 h-4" /> Baseline & Assets
          </h3>

          <div className="overflow-y-auto scrollbar-hide flex flex-col flex-grow pr-1 relative z-10">
            {/* Dynamic Corporate Metrics */}
            <div className="space-y-3 mb-6 shrink-0">
              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-2xl flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Factory className="w-4 h-4 text-slate-500" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Primary Domain</span>
                </div>
                {/* Dynamically reads from companyDetails */}
                <span className="text-xs font-black text-white">{(companyDetails as any).domain || 'Update Profile →'}</span>
              </div>
              
              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-2xl flex justify-between items-center">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pl-1">Annual Turnover</span>
                <span className="text-xs font-black text-emerald-400">
                  {(companyDetails as any).turnover || 'TBD'} 
                  <span className="text-[9px] text-slate-500 ml-1">{(companyDetails as any).turnoverYear || ''}</span>
                </span>
              </div>

              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-2xl flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Award className="w-4 h-4 text-slate-500" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">OEM Status</span>
                </div>
                <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-md border border-emerald-500/30">
                  {(companyDetails as any).oemStatus || 'Not Declared'}
                </span>
              </div>
            </div>

            {/* Dynamic Inventory Valuation */}
            <div className="mt-auto flex flex-col justify-end">
              <div className="mb-4">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Live Inventory Valuation</span>
                <span className="text-xl font-mono font-black text-white">
                  ₹{totalInventoryValue.toLocaleString()}
                </span>
              </div>

              <div className="space-y-2.5">
                <span className="text-[9px] font-black text-gold-500 uppercase tracking-widest block border-b border-slate-800/50 pb-2 mb-3">
                  Top 3 Assets by Gross Value
                </span>
                {top3Assets.map((asset, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2.5 bg-slate-950/50 rounded-xl border border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className="text-[10px] font-black text-slate-600 bg-slate-900 px-2 py-1 rounded">#{idx + 1}</span>
                      <span className="text-[11px] text-slate-300 truncate font-bold uppercase" title={asset.productName}>
                        {asset.productName}
                      </span>
                    </div>
                    <span className="text-xs text-gold-400 font-mono font-black pl-2 shrink-0">
                      ₹{asset.totalValue.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: SIGNING AUTHORITIES */}
        <div className="col-span-4 bg-slate-900/40 border border-slate-800 rounded-3xl p-6 flex flex-col relative overflow-hidden backdrop-blur-xl shadow-xl">
          <div className="flex justify-between items-center mb-5 shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Authorized Signatories</h3>
            <button 
              onClick={() => setIsAddingAuthority(true)}
              className="text-[9px] font-black px-3 py-1.5 bg-slate-800 rounded border border-slate-700 hover:text-gold-500 transition-colors uppercase tracking-widest"
            >
              + Add New
            </button>
          </div>

          <div className="flex-grow space-y-3 overflow-y-auto pr-2 scrollbar-hide pb-4">
            {config.signingAuthorities.map(auth => (
              <div key={auth.id} className="group flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-gold-500/30 transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-lg border border-slate-800">👤</div>
                  <div>
                    <p className="text-sm font-bold text-white uppercase">{auth.name}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{auth.designation} <span className="text-slate-600 mx-1">|</span> DIN: {auth.din}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setConfig(prev => ({...prev, signingAuthorities: prev.signingAuthorities.filter(a => a.id !== auth.id)}))}
                  className="text-[9px] font-black text-slate-600 hover:text-red-500 transition-colors uppercase"
                >
                  Revoke
                </button>
              </div>
            ))}

            {isAddingAuthority && (
              <div className="p-4 bg-slate-900/80 border-2 border-dashed border-gold-500/30 rounded-2xl animate-in zoom-in-95 duration-300 flex flex-col gap-3">
                <input placeholder="Full Name" className="auth-input w-full" value={newAuth.name} onChange={e => setNewAuth({...newAuth, name: e.target.value})} />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Designation" className="auth-input" value={newAuth.designation} onChange={e => setNewAuth({...newAuth, designation: e.target.value})} />
                  <input placeholder="DIN No." className="auth-input" value={newAuth.din} onChange={e => setNewAuth({...newAuth, din: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-1">
                  <button onClick={() => setIsAddingAuthority(false)} className="text-[9px] font-bold px-3 py-1 uppercase text-slate-500 hover:text-white">Cancel</button>
                  <button onClick={addAuthority} className="bg-gold-500 text-slate-950 px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all shadow-[0_0_15px_rgba(212,175,55,0.3)]">Save</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. SYSTEM FOOTER (Slimmed down by 20%) */}
      <div className="shrink-0 bg-slate-900/40 border border-slate-800 rounded-3xl py-3 px-6 flex items-center justify-between backdrop-blur-xl shadow-xl">
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest pl-2">
          System Version 2.0 • Authorized Access Only
        </p>
        
        <div className="flex gap-3">
          <button 
            onClick={onChangePin}
            className="flex items-center gap-2 px-4 py-2 bg-slate-950 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-sm"
          >
            <KeyRound className="w-3 h-3" /> Change Master PIN
          </button>
          
          <button 
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shadow-sm"
          >
            <LogOut className="w-3 h-3" /> End Session
          </button>
        </div>
      </div>

      <style>{`.auth-input { @apply bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs outline-none transition-all font-medium text-white; }
      .auth-input::placeholder {
        color: #475569;
        opacity: 1;    
      }
      .auth-input:focus {
        @apply border-gold-500;
      }
      .scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
};

const ConfigInput = ({ label, name, value, onChange }: any) => (
  <div className="flex flex-col gap-1">
    <label className="text-[9px] font-black uppercase text-slate-400 ml-2 italic tracking-widest">{label}</label>
    <input 
      type="text" 
      name={name}
      value={value || ''}
      onChange={onChange}
      className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-2 text-sm focus:border-gold-500 outline-none transition-all placeholder:text-slate-700 text-white font-medium"
    />
  </div>
);