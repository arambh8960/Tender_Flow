import * as React from 'react';
import { Link } from 'react-router-dom';
import { Search, Cpu, Calculator, ShieldCheck, ArrowRight, Building2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Public landing page.
 *
 * Deliberately reachable without a session and deliberately free of tenant
 * data — it renders nothing that depends on an organisation. A signed-in
 * visitor is offered a way back into their workspace rather than being
 * redirected, so the marketing page stays reachable on purpose.
 */

const CAPABILITIES = [
  {
    icon: Search,
    title: 'Tender discovery',
    body:
      'Search public procurement portals and see only what your catalogue can actually supply — with the reason each tender was recommended or rejected.',
  },
  {
    icon: Cpu,
    title: 'Technical matching',
    body:
      'Requirements are checked against recorded SKU attributes. Every compliance claim cites the attribute that proves it, and conflicts are reported rather than averaged away.',
  },
  {
    icon: Calculator,
    title: 'Deterministic costing',
    body:
      'Material, GST, freight, portal fees, EMD and ePBG computed from your own commercial settings. Identical inputs always produce identical numbers.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance vault',
    body:
      'Certificates stored privately per company, with expiry tracking that feeds qualification — an expired document is never treated as held.',
  },
];

export const LandingPage: React.FC = () => {
  const { isAuthenticated, initializing } = useAuth();

  return (
    <div className="min-h-[100dvh] w-full bg-slate-950 text-white font-sans">
      {/* Header */}
      <header className="px-6 md:px-12 py-6 flex items-center justify-between border-b border-slate-900">
        <div>
          <h1 className="text-xl font-black uppercase italic tracking-tight">
            Tender<span className="text-gold-500">Flow</span>
          </h1>
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em] mt-0.5">
            Procurement intelligence
          </p>
        </div>

        <nav className="flex items-center gap-3">
          {/* A signed-in visitor gets a way back in, not a redirect. */}
          {!initializing && isAuthenticated ? (
            <Link
              to="/workspace"
              className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition flex items-center gap-2"
            >
              <Building2 className="w-3.5 h-3.5" /> Go to workspace
            </Link>
          ) : (
            <>
              <Link
                to="/signin"
                className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition"
              >
                Sign in
              </Link>
              <Link
                to="/signin"
                className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="relative px-6 md:px-12 py-20 md:py-28 overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gold-500/5 blur-[160px] rounded-full pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-8">
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter leading-[1.05]">
            Bid on the tenders
            <br />
            you can <span className="text-gold-500">actually win</span>.
          </h2>

          <p className="text-slate-400 text-base md:text-lg leading-relaxed max-w-2xl">
            TenderFlow reads public procurement listings, matches them against your inventory, warehouses and
            certifications, and produces a costed bid with the working shown. Every company gets an isolated
            workspace.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/signin"
              className="px-6 py-3.5 text-[11px] font-black uppercase tracking-widest rounded-xl bg-gold-500 text-slate-950 hover:brightness-110 transition flex items-center gap-2"
            >
              Get started <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/signin"
              className="px-6 py-3.5 text-[11px] font-black uppercase tracking-widest rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-900 transition"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="px-6 md:px-12 pb-20">
        <div className="grid sm:grid-cols-2 gap-5 max-w-5xl">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                <Icon className="w-4 h-4 text-gold-500" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-widest">{title}</h3>
              <p className="text-[12px] text-slate-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Isolation note — the product's central claim, stated plainly. */}
      <section className="px-6 md:px-12 pb-24">
        <div className="max-w-5xl bg-slate-900/40 border border-slate-800 rounded-2xl p-8 flex flex-col md:flex-row md:items-center gap-6">
          <ShieldCheck className="w-8 h-8 text-gold-500 shrink-0" />
          <div className="space-y-2">
            <h3 className="text-sm font-black uppercase tracking-widest">Separated at the database, not the screen</h3>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              Each company's tenders, inventory, documents and pricing are isolated by row-level security in
              PostgreSQL. Access is decided by the database on every query, not by a filter in the application.
            </p>
          </div>
        </div>
      </section>

      <footer className="px-6 md:px-12 py-8 border-t border-slate-900">
        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">
          TenderFlow · Procurement intelligence
        </p>
      </footer>
    </div>
  );
};
