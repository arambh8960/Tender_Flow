import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Mail, ArrowRight, ArrowLeft, ShieldCheck, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isSupabaseConfigured } from '../services/supabase/client';
import { friendlyAuthError } from '../lib/authErrors';
import { isOtpMode } from '../lib/emailAuthMode';

type Mode = 'EMAIL' | 'OTP' | 'LINK_SENT' | 'PASSWORD' | 'SIGNUP';

/**
 * Primary authentication gate.
 *
 * This restores the original TenderFlow sign-in experience — email, a six
 * digit code, Google, polished error and loading states — on top of Supabase
 * Auth. What changed is underneath: the code is issued and verified by
 * Supabase, and the result is a real JWT session rather than a localStorage
 * blob that the browser could simply write for itself.
 *
 * The PIN and authenticator flows are not here on purpose. They protect the
 * compliance vault as a second factor, which is where they belong; they are
 * not what authenticates you into the product.
 */

/** How long a Supabase email code stays valid, by default. */
const OTP_TTL_SECONDS = 60 * 60;
/** Supabase rate-limits sends; this stops a user hammering the button. */
const RESEND_COOLDOWN_SECONDS = 45;

export const AuthGate: React.FC = () => {
  const { sendOtp, verifyOtp, signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<Mode>('EMAIL');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [cooldown, setCooldown] = useState(0);
  const [codeExpiresIn, setCodeExpiresIn] = useState(0);

  // One interval drives both the resend cooldown and the code's expiry, so
  // the two can never disagree about how much time is left.
  useEffect(() => {
    if (cooldown === 0 && codeExpiresIn === 0) return;
    const timer = setInterval(() => {
      setCooldown(current => (current > 0 ? current - 1 : 0));
      setCodeExpiresIn(current => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown, codeExpiresIn]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = useCallback(
    async (address: string, isResend: boolean) => {
      await sendOtp(address);
      setOtp('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCodeExpiresIn(OTP_TTL_SECONDS);
      const target = address.trim().toLowerCase();

      // The screen must match what the project actually mails. Asking for a
      // code when Supabase sent a link leaves the user with nothing to type.
      if (isOtpMode) {
        setNotice(isResend ? `A new code is on its way to ${target}.` : `We sent a six digit code to ${target}.`);
        setMode('OTP');
      } else {
        setNotice(null);
        setMode('LINK_SENT');
      }
    },
    [sendOtp]
  );

  const handleSendCode = () =>
    run(async () => {
      if (!email.trim()) throw new Error('Enter your work email.');
      await requestCode(email, false);
    });

  const handleResend = () =>
    run(async () => {
      if (cooldown > 0) return;
      await requestCode(email, true);
    });

  const handleVerify = (code: string) =>
    run(async () => {
      if (code.length !== 6) throw new Error('Enter the six digit code.');
      if (codeExpiresIn === 0) throw new Error('That code has expired. Request a new one.');
      await verifyOtp(email, code);
    });

  const handlePassword = () => run(() => signInWithPassword(email, password));

  const handleSignUp = () =>
    run(async () => {
      if (password.length < 8) throw new Error('Choose a password of at least 8 characters.');
      const { needsConfirmation } = await signUpWithPassword(email, password, fullName);
      if (needsConfirmation) {
        setNotice('Check your inbox to confirm your address, then sign in.');
        setMode('EMAIL');
      }
    });

  const handleGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      // Redirects away; nothing after this runs on success.
      await signInWithGoogle();
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
      setGoogleBusy(false);
    }
  };

  const inputClass =
    'w-full bg-slate-900 border border-slate-800 text-white pl-12 pr-4 py-4 rounded-2xl ' +
    'focus:ring-2 focus:ring-blue-600 outline-none transition-all placeholder:text-slate-700';

  const primaryButton =
    'w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-2xl flex items-center ' +
    'justify-center gap-3 transition-all shadow-lg shadow-blue-900/20 active:scale-95 disabled:opacity-50';

  return (
    <div className="h-[100dvh] w-full bg-slate-950 flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Brand panel */}
      <div className="hidden md:flex md:w-1/2 flex-col justify-center px-16 relative">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-600/5 blur-[150px] rounded-full pointer-events-none" />
        <div className="relative z-10 space-y-8">
          <h1 className="text-5xl font-black tracking-tighter text-white leading-none">
            Intelligent
            <br />
            <span className="text-blue-500">Procurement Intelligence</span>
          </h1>
          <div className="space-y-4 text-slate-400 text-sm max-w-md">
            <p className="flex gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              Every organisation's tenders, inventory and documents are isolated at the database level.
            </p>
            <p className="flex gap-3">
              <KeyRound className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              Role-based access across owner, admin, manager, member and viewer.
            </p>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-6 md:px-16">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-black text-white tracking-tight">
              {mode === 'SIGNUP' ? 'Create your account' : 'Initialize Session'}
            </h2>
            <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">
              {mode === 'OTP'
                ? 'Enter the 6-digit code sent to your email'
                : mode === 'LINK_SENT'
                  ? 'Check your email'
                  : 'Access your secure workspace'}
            </p>
          </div>

          {!isSupabaseConfigured && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs">
              Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
            </div>
          )}

          {notice && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-300 text-xs text-center">
              {notice}
            </div>
          )}
          {error && (
            <div role="alert" className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs text-center">
              {error}
            </div>
          )}

          {mode === 'EMAIL' && (
            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-4 w-5 h-5 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendCode()}
                  placeholder="Organization Email"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <button onClick={handleSendCode} disabled={busy || !email} className={primaryButton}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Continue <ArrowRight className="w-5 h-5" /></>}
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">or</span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>

              <GoogleButton onClick={handleGoogle} busy={googleBusy} label="Continue with Google" />

              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest pt-2">
                <button onClick={() => { setMode('PASSWORD'); setError(null); }} className="text-slate-500 hover:text-white">
                  Use password
                </button>
                <button onClick={() => { setMode('SIGNUP'); setError(null); }} className="text-blue-500 hover:text-blue-400">
                  Create account
                </button>
              </div>
            </div>
          )}

          {mode === 'OTP' && (
            <div className="space-y-4">
              <input
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={e => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setOtp(value);
                  if (value.length === 6) handleVerify(value);
                }}
                placeholder="000000"
                aria-label="Six digit verification code"
                className="w-full bg-slate-900 border border-slate-800 text-white text-center text-3xl font-mono tracking-[0.5em] py-5 rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none"
                autoFocus
              />

              <p className="text-center text-[11px] text-slate-400">
                Enter the 6-digit code sent to{' '}
                <span className="text-slate-200">{email.trim().toLowerCase()}</span>
              </p>

              <p className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {codeExpiresIn > 0 ? (
                  <>Code expires in {formatDuration(codeExpiresIn)}</>
                ) : (
                  <span className="text-amber-400">Code expired — request a new one</span>
                )}
              </p>

              <button onClick={() => handleVerify(otp)} disabled={busy || otp.length !== 6} className={primaryButton}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify'}
              </button>

              <button
                onClick={handleResend}
                disabled={busy || cooldown > 0}
                className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700"
              >
                <RefreshCw className="w-3 h-3" />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>

              <button
                onClick={() => { setMode('EMAIL'); setNotice(null); setError(null); setCodeExpiresIn(0); }}
                className="w-full flex items-center justify-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-white"
              >
                <ArrowLeft className="w-3 h-3" /> Change email
              </button>
            </div>
          )}

          {mode === 'LINK_SENT' && (
            <div className="space-y-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl border border-slate-800 bg-slate-900/60 flex items-center justify-center">
                <Mail className="w-6 h-6 text-blue-500" />
              </div>

              <div className="space-y-2">
                <p className="text-sm text-white font-bold">Check your email</p>
                <p className="text-[12px] text-slate-400 leading-relaxed">
                  We sent a secure sign-in link to{' '}
                  <span className="text-slate-200">{email.trim().toLowerCase()}</span>. Click it and you will be
                  returned to TenderFlow, signed in.
                </p>
                <p className="text-[11px] text-slate-600">You can close this tab once you have clicked the link.</p>
              </div>

              <button
                onClick={handleResend}
                disabled={busy || cooldown > 0}
                className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700"
              >
                <RefreshCw className="w-3 h-3" />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
              </button>

              <button
                onClick={() => { setMode('EMAIL'); setNotice(null); setError(null); }}
                className="w-full flex items-center justify-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-white"
              >
                <ArrowLeft className="w-3 h-3" /> Use a different email
              </button>
            </div>
          )}

          {mode === 'PASSWORD' && (
            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-4 w-5 h-5 text-slate-500" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Organization Email" className={inputClass} />
              </div>
              <div className="relative">
                <KeyRound className="absolute left-4 top-4 w-5 h-5 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePassword()}
                  placeholder="Password"
                  className={inputClass}
                />
              </div>
              <button onClick={handlePassword} disabled={busy || !email || !password} className={primaryButton}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign in <ArrowRight className="w-5 h-5" /></>}
              </button>
              <GoogleButton onClick={handleGoogle} busy={googleBusy} label="Continue with Google" />
              <button
                onClick={() => { setMode('EMAIL'); setError(null); }}
                className="w-full text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-white"
              >
                Use an email code instead
              </button>
            </div>
          )}

          {mode === 'SIGNUP' && (
            <div className="space-y-4">
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" className={inputClass.replace('pl-12', 'pl-4')} />
              <div className="relative">
                <Mail className="absolute left-4 top-4 w-5 h-5 text-slate-500" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Work email" className={inputClass} />
              </div>
              <div className="relative">
                <KeyRound className="absolute left-4 top-4 w-5 h-5 text-slate-500" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 8 characters)" className={inputClass} />
              </div>
              <button onClick={handleSignUp} disabled={busy || !email || !password} className={primaryButton}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Create account <ArrowRight className="w-5 h-5" /></>}
              </button>
              <GoogleButton onClick={handleGoogle} busy={googleBusy} label="Sign up with Google" />
              <button
                onClick={() => { setMode('EMAIL'); setError(null); }}
                className="w-full flex items-center justify-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-white"
              >
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Google's mark, inline so the button needs no network request to render. */
const GoogleButton: React.FC<{ onClick: () => void; busy: boolean; label: string }> = ({ onClick, busy, label }) => (
  <button
    onClick={onClick}
    disabled={busy}
    className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-60"
  >
    {busy ? (
      <Loader2 className="w-5 h-5 animate-spin" />
    ) : (
      <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
        <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z" />
      </svg>
    )}
    {label}
  </button>
);

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}
