import * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2 } from 'lucide-react';

import { useOrganization } from '../contexts/OrganizationContext';
import { organizationAccountApi } from '../services/api/invitationApi';
import { organizationApi } from '../services/api/organizationApi';
import { organizationConfigApi } from '../services/api/organizationConfigApi';
import { describeApiError } from '../services/api/client';

/**
 * Dedicated organisation creation.
 *
 * Only the identity section is required. Everything after it is optional and
 * can be revisited from Organisation → Settings — a company should not have to
 * enter warehouse coordinates before it is allowed to look at the product.
 *
 * The sections after identity are saved individually AFTER the organisation
 * exists, because each targets a different table. A failure in one does not
 * lose the organisation or the sections already saved.
 */

type Section = 'IDENTITY' | 'BUSINESS' | 'ADDRESS' | 'PROCUREMENT' | 'LOGISTICS' | 'FINANCIAL' | 'DONE';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'IDENTITY', label: 'Identity' },
  { key: 'BUSINESS', label: 'Business' },
  { key: 'ADDRESS', label: 'Address' },
  { key: 'PROCUREMENT', label: 'Procurement' },
  { key: 'LOGISTICS', label: 'Logistics' },
  { key: 'FINANCIAL', label: 'Financial' },
];

const INDUSTRIES = [
  'Industrial Supply',
  'Electrical & Power',
  'Construction & Infrastructure',
  'IT & Electronics',
  'Medical & Laboratory',
  'Textiles & Apparel',
  'Automotive & Transport',
  'Chemicals',
  'Other',
];

const OEM_STATUSES = ['OEM', 'Authorised Dealer', 'Reseller', 'Trader', 'Service Provider'];
const TRUCK_TYPES = ['MINI_TRUCK', 'LCV', 'MEDIUM_TRUCK', 'HEAVY_TRUCK'];

interface WarehouseDraft {
  code: string;
  name: string;
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
  truckType: string;
  leadTimeDays: string;
}

const emptyWarehouse = (): WarehouseDraft => ({
  code: '',
  name: '',
  city: '',
  state: '',
  pincode: '',
  latitude: '',
  longitude: '',
  truckType: TRUCK_TYPES[1],
  leadTimeDays: '7',
});

export const OrganizationCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { refresh, setActiveOrganization } = useOrganization();

  const [section, setSection] = useState<Section>('IDENTITY');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Identity
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [description, setDescription] = useState('');

  // Business / legal
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [turnover, setTurnover] = useState('');
  const [turnoverYear, setTurnoverYear] = useState('');
  const [oemStatus, setOemStatus] = useState(OEM_STATUSES[0]);

  // Address
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [country, setCountry] = useState('India');

  // Procurement
  const [categories, setCategories] = useState('');
  const [authorities, setAuthorities] = useState('');
  const [minTenderValue, setMinTenderValue] = useState('');
  const [minMatch, setMinMatch] = useState('20');
  const [allowEmd, setAllowEmd] = useState(true);

  // Logistics
  const [warehouses, setWarehouses] = useState<WarehouseDraft[]>([emptyWarehouse()]);
  const [ratePerKm, setRatePerKm] = useState('55');
  const [maxDistance, setMaxDistance] = useState('');
  const [avgKms, setAvgKms] = useState('400');

  // Financial
  const [gstRate, setGstRate] = useState('18');
  const [brokerage, setBrokerage] = useState('0');
  const [targetMargin, setTargetMargin] = useState('10');
  const [transportBuffer, setTransportBuffer] = useState('10');
  const [emdPercent, setEmdPercent] = useState('2');
  const [epbgPercent, setEpbgPercent] = useState('3');

  const input =
    'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white ' +
    'placeholder:text-slate-700 focus:outline-none focus:border-gold-500/60 transition-colors';
  const primary =
    'px-6 py-3 rounded-xl bg-gold-500 text-slate-950 text-[10px] font-black uppercase tracking-widest ' +
    'hover:brightness-110 transition disabled:opacity-40 flex items-center gap-2';
  const ghost =
    'px-5 py-3 rounded-xl border border-slate-700 text-slate-300 text-[10px] font-black uppercase ' +
    'tracking-widest hover:bg-slate-800 transition disabled:opacity-40';

  const csv = (value: string) =>
    value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

  /** Creates the organisation. The server makes the caller its OWNER. */
  const createOrganization = async () => {
    if (name.trim().length < 2) {
      setError('Enter your organisation name.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const organization = await organizationAccountApi.create({
        name: name.trim(),
        legalName: legalName.trim() || undefined,
        domain: website.trim() || undefined,
        industry,
      });

      setOrgId(organization.id);
      await refresh();
      setActiveOrganization(organization.id);
      setSection('BUSINESS');
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Saves one optional section.
   *
   * Failures are collected as warnings rather than thrown: the organisation
   * already exists, so losing a detail must not strand the user outside the
   * product. They are told what did not save and can fix it in Settings.
   */
  const saveSection = async (label: string, work: () => Promise<unknown>, next: Section) => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setWarnings(current => [...current, `${label} could not be saved: ${describeApiError(err)}`]);
    } finally {
      setBusy(false);
      setSection(next);
    }
  };

  const saveBusiness = () =>
    saveSection(
      'Business details',
      () =>
        organizationApi.updateProfile(orgId as string, {
          legalName: legalName.trim() || undefined,
          gstin: gstin.trim() || undefined,
          pan: pan.trim() || undefined,
          turnoverYear: turnoverYear.trim() || undefined,
          oemStatus,
          ...(turnover ? { annualTurnoverCr: Number(turnover) } : {}),
        }),
      'ADDRESS'
    );

  const saveAddress = () =>
    saveSection(
      'Address',
      () =>
        organizationApi.updateProfile(orgId as string, {
          address: address.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          pincode: pincode.trim() || undefined,
          country: country.trim() || undefined,
          description: description.trim() || undefined,
        }),
      'PROCUREMENT'
    );

  const saveProcurement = () =>
    saveSection(
      'Procurement preferences',
      () =>
        organizationApi.updateDiscoverySettings(orgId as string, {
          categories: csv(categories),
          preferredAuthorities: csv(authorities),
          minMatchThreshold: Number(minMatch || 20),
          allowEmd,
          ...(minTenderValue ? { minTenderValue: Number(minTenderValue) } : {}),
        }),
      'LOGISTICS'
    );

  const saveLogistics = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);

    // Freight settings and warehouses are separate records; each reports its
    // own failure so one bad row does not discard the rest.
    try {
      await organizationApi.updateDiscoverySettings(orgId, {
        manualRatePerKm: Number(ratePerKm || 0),
        manualAvgKms: Number(avgKms || 0),
        ...(maxDistance ? { maxDistanceKm: Number(maxDistance) } : {}),
      });
    } catch (err) {
      setWarnings(c => [...c, `Freight settings could not be saved: ${describeApiError(err)}`]);
    }

    for (const warehouse of warehouses) {
      if (!warehouse.code.trim()) continue;
      try {
        await organizationConfigApi.createWarehouse(orgId, {
          code: warehouse.code.trim(),
          name: warehouse.name.trim() || undefined,
          city: warehouse.city.trim() || undefined,
          state: warehouse.state.trim() || undefined,
          pincode: warehouse.pincode.trim() || undefined,
          ...(warehouse.latitude ? { latitude: Number(warehouse.latitude) } : {}),
          ...(warehouse.longitude ? { longitude: Number(warehouse.longitude) } : {}),
        });
      } catch (err) {
        setWarnings(c => [...c, `Warehouse ${warehouse.code} could not be saved: ${describeApiError(err)}`]);
      }
    }

    setBusy(false);
    setSection('FINANCIAL');
  };

  const saveFinancial = () =>
    saveSection(
      'Financial defaults',
      () =>
        organizationConfigApi.updateFinancialSettings(orgId as string, {
          defaultGstRate: Number(gstRate || 18),
          brokeragePercent: Number(brokerage || 0),
          targetMarginPercent: Number(targetMargin || 10),
          transportBufferPercent: Number(transportBuffer || 10),
          defaultEmdPercent: Number(emdPercent || 2),
          defaultEpbgPercent: Number(epbgPercent || 3),
          ratePerKm: Number(ratePerKm || 0),
        }),
      'DONE'
    );

  const enterWorkspace = async () => {
    setBusy(true);
    try {
      await refresh();
      navigate('/dashboard', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const activeIndex = SECTIONS.findIndex(s => s.key === section);

  return (
    <div className="min-h-[100dvh] w-full bg-slate-950 text-white font-sans">
      <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black uppercase italic tracking-tight">
            Create organisation<span className="text-gold-500">.</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1">
            You become its owner
          </p>
        </div>
        <button onClick={() => navigate('/workspace')} className={ghost}>
          <ArrowLeft className="w-3 h-3 inline mr-1" /> Back
        </button>
      </div>

      <div className="px-6 py-10 flex justify-center">
        <div className="w-full max-w-3xl space-y-6">
          {/* Progress */}
          {section !== 'DONE' && (
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {SECTIONS.map((s, i) => (
                <React.Fragment key={s.key}>
                  <div
                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${
                      i === activeIndex
                        ? 'bg-gold-500 text-slate-950'
                        : i < activeIndex
                          ? 'bg-slate-800 text-slate-300'
                          : 'border border-slate-800 text-slate-600'
                    }`}
                  >
                    {i < activeIndex ? '✓ ' : ''}
                    {s.label}
                  </div>
                  {i < SECTIONS.length - 1 && <div className="w-4 h-px bg-slate-800 shrink-0" />}
                </React.Fragment>
              ))}
            </div>
          )}

          {error && (
            <div role="alert" className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3">
              <p className="text-[11px] text-rose-300">{error}</p>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl px-4 py-3 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-200">
                  {w}
                </p>
              ))}
              <p className="text-[10px] text-amber-400/70">You can fix these later in Organisation → Settings.</p>
            </div>
          )}

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 space-y-5">
            {section === 'IDENTITY' && (
              <>
                <Heading title="Organisation identity" hint="Only the name is required." />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Organisation name" required full>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Electrical Pvt Ltd" className={input} autoFocus />
                  </Field>
                  <Field label="Legal name">
                    <input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Registered entity name" className={input} />
                  </Field>
                  <Field label="Website">
                    <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="acme.co.in" className={input} />
                  </Field>
                  <Field label="Industry">
                    <select value={industry} onChange={e => setIndustry(e.target.value)} className={input}>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </Field>
                  <Field label="Description" full>
                    <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What your company supplies" className={input} />
                  </Field>
                </div>
                <Actions>
                  <button onClick={() => void createOrganization()} disabled={busy || name.trim().length < 2} className={primary}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create & continue <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </Actions>
              </>
            )}

            {section === 'BUSINESS' && (
              <>
                <Heading title="Legal & business" hint="Used on bid documents and eligibility checks." />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="GSTIN"><input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" className={input} /></Field>
                  <Field label="PAN"><input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="AAAAA0000A" className={input} /></Field>
                  <Field label="Annual turnover (₹ Cr)"><input type="number" min="0" step="0.01" value={turnover} onChange={e => setTurnover(e.target.value)} className={input} /></Field>
                  <Field label="Turnover year"><input value={turnoverYear} onChange={e => setTurnoverYear(e.target.value)} placeholder="2024-25" className={input} /></Field>
                  <Field label="OEM status" full>
                    <select value={oemStatus} onChange={e => setOemStatus(e.target.value)} className={input}>
                      {OEM_STATUSES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                </div>
                <Actions>
                  <button onClick={() => setSection('ADDRESS')} className={ghost}>Skip</button>
                  <button onClick={() => void saveBusiness()} disabled={busy} className={primary}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </Actions>
              </>
            )}

            {section === 'ADDRESS' && (
              <>
                <Heading title="Address" hint="Your registered place of business." />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Address" full><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street and locality" className={input} /></Field>
                  <Field label="City"><input value={city} onChange={e => setCity(e.target.value)} placeholder="Ludhiana" className={input} /></Field>
                  <Field label="State"><input value={state} onChange={e => setState(e.target.value)} placeholder="Punjab" className={input} /></Field>
                  <Field label="PIN code"><input value={pincode} onChange={e => setPincode(e.target.value)} placeholder="141001" className={input} /></Field>
                  <Field label="Country"><input value={country} onChange={e => setCountry(e.target.value)} className={input} /></Field>
                </div>
                <Actions>
                  <button onClick={() => setSection('PROCUREMENT')} className={ghost}>Skip</button>
                  <button onClick={() => void saveAddress()} disabled={busy} className={primary}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </Actions>
              </>
            )}

            {section === 'PROCUREMENT' && (
              <>
                <Heading title="Procurement profile" hint="This is what discovery searches for on your behalf." />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Product / tender categories" full>
                    <input value={categories} onChange={e => setCategories(e.target.value)} placeholder="Cables, Switchgear, Fasteners" className={input} />
                  </Field>
                  <Field label="Preferred authorities" full>
                    <input value={authorities} onChange={e => setAuthorities(e.target.value)} placeholder="CPWD, Indian Railways" className={input} />
                  </Field>
                  <Field label="Minimum tender value (₹)">
                    <input type="number" min="0" value={minTenderValue} onChange={e => setMinTenderValue(e.target.value)} placeholder="No minimum" className={input} />
                  </Field>
                  <Field label="Qualification threshold (%)">
                    <input type="number" min="0" max="100" value={minMatch} onChange={e => setMinMatch(e.target.value)} className={input} />
                  </Field>
                  <Field label="EMD tenders" full>
                    <label className="flex items-center gap-3 pt-2">
                      <input type="checkbox" checked={allowEmd} onChange={e => setAllowEmd(e.target.checked)} className="w-4 h-4 accent-gold-500" />
                      <span className="text-[11px] text-slate-300">Bid on tenders that require a deposit</span>
                    </label>
                  </Field>
                </div>
                <Actions>
                  <button onClick={() => setSection('LOGISTICS')} className={ghost}>Skip</button>
                  <button onClick={() => void saveProcurement()} disabled={busy} className={primary}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </Actions>
              </>
            )}

            {section === 'LOGISTICS' && (
              <>
                <Heading
                  title="Logistics"
                  hint="Warehouse coordinates are what let TenderFlow measure a real delivery distance instead of estimating one."
                />

                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Freight rate (₹/km)"><input type="number" min="0" step="0.01" value={ratePerKm} onChange={e => setRatePerKm(e.target.value)} className={input} /></Field>
                  <Field label="Max delivery distance (km)"><input type="number" min="0" value={maxDistance} onChange={e => setMaxDistance(e.target.value)} placeholder="No limit" className={input} /></Field>
                  <Field label="Fallback average (km)"><input type="number" min="0" value={avgKms} onChange={e => setAvgKms(e.target.value)} className={input} /></Field>
                </div>

                <div className="space-y-4">
                  {warehouses.map((warehouse, index) => (
                    <div key={index} className="border border-slate-800 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Warehouse {index + 1}
                        </p>
                        {warehouses.length > 1 && (
                          <button
                            onClick={() => setWarehouses(w => w.filter((_, i) => i !== index))}
                            className="text-slate-600 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid sm:grid-cols-3 gap-3">
                        {([
                          ['code', 'Code', 'WH-JAL'],
                          ['name', 'Name', 'Main depot'],
                          ['city', 'City', 'Jalandhar'],
                          ['state', 'State', 'Punjab'],
                          ['pincode', 'PIN code', '144001'],
                          ['latitude', 'Latitude', '31.3260'],
                          ['longitude', 'Longitude', '75.5762'],
                          ['leadTimeDays', 'Lead time (days)', '7'],
                        ] as const).map(([key, label, placeholder]) => (
                          <Field key={key} label={label}>
                            <input
                              value={warehouse[key]}
                              onChange={e =>
                                setWarehouses(list =>
                                  list.map((w, i) => (i === index ? { ...w, [key]: e.target.value } : w))
                                )
                              }
                              placeholder={placeholder}
                              className={input}
                            />
                          </Field>
                        ))}
                        <Field label="Truck type">
                          <select
                            value={warehouse.truckType}
                            onChange={e =>
                              setWarehouses(list => list.map((w, i) => (i === index ? { ...w, truckType: e.target.value } : w)))
                            }
                            className={input}
                          >
                            {TRUCK_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                          </select>
                        </Field>
                      </div>
                    </div>
                  ))}

                  <button onClick={() => setWarehouses(w => [...w, emptyWarehouse()])} className={ghost}>
                    <Plus className="w-3 h-3 inline mr-1" /> Add another warehouse
                  </button>
                </div>

                <Actions>
                  <button onClick={() => setSection('FINANCIAL')} className={ghost}>Skip</button>
                  <button onClick={() => void saveLogistics()} disabled={busy} className={primary}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </Actions>
              </>
            )}

            {section === 'FINANCIAL' && (
              <>
                <Heading
                  title="Financial defaults"
                  hint="Fallbacks only — a tender's own stated figure and a SKU's own rate always take precedence."
                />
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Default GST (%)"><input type="number" min="0" max="100" step="0.01" value={gstRate} onChange={e => setGstRate(e.target.value)} className={input} /></Field>
                  <Field label="Brokerage (%)"><input type="number" min="0" max="100" step="0.01" value={brokerage} onChange={e => setBrokerage(e.target.value)} className={input} /></Field>
                  <Field label="Target margin (%)"><input type="number" min="0" max="100" step="0.01" value={targetMargin} onChange={e => setTargetMargin(e.target.value)} className={input} /></Field>
                  <Field label="Transport buffer (%)"><input type="number" min="0" max="100" step="0.01" value={transportBuffer} onChange={e => setTransportBuffer(e.target.value)} className={input} /></Field>
                  <Field label="Default EMD (%)"><input type="number" min="0" max="100" step="0.01" value={emdPercent} onChange={e => setEmdPercent(e.target.value)} className={input} /></Field>
                  <Field label="Default ePBG (%)"><input type="number" min="0" max="100" step="0.01" value={epbgPercent} onChange={e => setEpbgPercent(e.target.value)} className={input} /></Field>
                </div>
                <Actions>
                  <button onClick={() => setSection('DONE')} className={ghost}>Skip</button>
                  <button onClick={() => void saveFinancial()} disabled={busy} className={primary}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Finish <Check className="w-4 h-4" /></>}
                  </button>
                </Actions>
              </>
            )}

            {section === 'DONE' && (
              <div className="text-center space-y-5 py-6">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Check className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-black tracking-tight">{name} is ready</h2>
                  <p className="text-[12px] text-slate-400 max-w-md mx-auto leading-relaxed">
                    You are its owner. Anything you skipped can be completed from Organisation → Settings, and your
                    dashboard will show what is still outstanding.
                  </p>
                </div>
                <button onClick={() => void enterWorkspace()} disabled={busy} className={`${primary} mx-auto`}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Enter workspace <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Heading: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="space-y-1">
    <h2 className="text-lg font-black tracking-tight">{title}</h2>
    {hint && <p className="text-[11px] text-slate-500 leading-relaxed">{hint}</p>}
  </div>
);

const Field: React.FC<{ label: string; required?: boolean; full?: boolean; children: React.ReactNode }> = ({
  label,
  required,
  full,
  children,
}) => (
  <div className={`space-y-2 ${full ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
      {label}
      {required && <span className="text-gold-500 ml-1">*</span>}
    </label>
    {children}
  </div>
);

const Actions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-between pt-2 gap-3">{children}</div>
);
