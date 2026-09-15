import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Fingerprint, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authApi, type VaultSecurityStatus } from '../services/api/authApi';
import { describeApiError } from '../services/api/client';
import { useAuth } from '../contexts/AuthContext';
import { friendlyAuthError } from '../lib/authErrors';
import logo from '../assets/TenderFlow.png';

/**
 * Vault unlock.
 *
 * Replaces SignInScreen, which mixed two different things: signing in
 * (now Supabase Auth, in AuthGate) and unlocking the document vault. This
 * screen only does the second, for the already-authenticated user, so there
 * is no email field — there is nothing here to identify, only to confirm.
 *
 * The six-bubble input is kept deliberately: it is the product's existing
 * visual signature for entering a code.
 */

const BubbleInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, onComplete, disabled = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) setTimeout(() => inputRef.current?.focus(), 100);
  }, [disabled]);

  return (
    <div className="relative w-full h-20">
      <div className="absolute inset-0 flex justify-center gap-2 md:gap-3 pointer-events-none z-10">
        {[...Array(6)].map((_, index) => (
          <motion.div
            key={index}
            whileHover={{ scale: 1.05 }}
            className={`w-12 h-14 md:w-14 md:h-16 rounded-2xl flex items-center justify-center text-2xl font-bold transition-all duration-300 border-2 border-dashed border-opacity-50 ${
              value[index]
                ? 'bg-gold-500 text-slate-950 border-gold-400 shadow-[0_0_20px_rgba(212,175,55,0.35)] scale-105'
                : 'bg-slate-900 text-slate-800 border-slate-800'
            }`}
          >
            {value[index] ? (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                •
              </motion.span>
            ) : (
              ''
            )}
          </motion.div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="tel"
        maxLength={6}
        value={value}
        disabled={disabled}
        onChange={event => {
          const digits = event.target.value.replace(/\D/g, '');
          onChange(digits);
          if (digits.length === 6) setTimeout(() => onComplete(digits), 50);
        }}
        className={`absolute inset-0 w-full h-full opacity-0 z-20 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      />
    </div>
  );
};

export const VaultUnlock: React.FC<{ onUnlocked: () => void; onCancel?: () => void }> = ({
  onUnlocked,
  onCancel,
}) => {
  const navigate = useNavigate();

  const { user, verifyOtp, reauthenticate } = useAuth();

  const [status, setStatus] = useState<VaultSecurityStatus | null>(null);
  const [checking, setChecking] = useState(true);
  /**
   * RECOVER_* are the forgotten-PIN path: prove identity through Supabase
   * again, then set a new PIN. There is no emailed reset token and no secret
   * question — the session IS the identity proof, and the server additionally
   * requires it to be freshly issued.
   */
  const [stage, setStage] = useState<'PIN' | 'RECOVER_CODE' | 'RECOVER_NEW_PIN'>('PIN');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    authApi
      .getVaultStatus()
      .then(result => {
        if (!active) return;
        setStatus(result);
        // No PIN configured means no second factor to satisfy; the vault is
        // already protected by the session and by RLS.
        if (!result.hasPin) onUnlocked();
      })
      .catch(err => active && setError(describeApiError(err)))
      .finally(() => active && setChecking(false));

    return () => {
      active = false;
    };
  }, [onUnlocked]);

  const submitPin = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.verifyPin(value);
      onUnlocked();
    } catch (err) {
      setError(describeApiError(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  /** Sends a fresh Supabase code, which mints a token with a recent `iat`. */
  const startRecovery = async () => {
    if (!user?.email) {
      setError('This account has no email address, so the PIN cannot be recovered here.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await reauthenticate(user.email);
      setNotice(`We sent a verification code to ${user.email}.`);
      setRecoveryCode('');
      setStage('RECOVER_CODE');
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  const submitRecoveryCode = async (value: string) => {
    if (!user?.email) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(user.email, value);
      setNotice('Identity confirmed. Choose a new vault PIN.');
      setNewPin('');
      setStage('RECOVER_NEW_PIN');
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
      setRecoveryCode('');
    } finally {
      setBusy(false);
    }
  };

  const submitNewPin = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPin(value);
      onUnlocked();
    } catch (err) {
      setError(describeApiError(err));
      setNewPin('');
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-800 border-t-gold-500 rounded-full animate-spin" />
      </div>
    );
  }

  const locked = status?.isLocked;

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-md text-center">
        <img src={logo} alt="TenderFlow" className="w-14 h-14 mx-auto mb-6 opacity-90" />

        <div className="flex items-center justify-center gap-2 mb-2">
          {stage === 'PIN' ? <Lock className="w-4 h-4 text-gold-500" /> : <Fingerprint className="w-4 h-4 text-gold-500" />}
          <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">
            {stage === 'PIN'
              ? 'Vault locked'
              : stage === 'RECOVER_CODE'
                ? 'Confirm your identity'
                : 'Set a new PIN'}
          </h2>
        </div>

        <p className="text-[11px] text-slate-500 mb-8">
          {stage === 'PIN'
            ? 'Enter your six digit vault PIN to view compliance documents.'
            : stage === 'RECOVER_CODE'
              ? 'Enter the six digit code we emailed you.'
              : 'Choose a new six digit PIN for this vault.'}
        </p>

        {notice && <p className="text-[11px] text-blue-300 mb-5">{notice}</p>}

        {locked ? (
          <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-4">
            <p className="text-[11px] text-rose-300">
              Too many failed attempts. The vault unlocks
              {status?.lockedUntil ? ` at ${new Date(status.lockedUntil).toLocaleTimeString('en-GB')}` : ' shortly'}.
            </p>
          </div>
        ) : stage === 'PIN' ? (
          <BubbleInput value={pin} onChange={setPin} onComplete={submitPin} disabled={busy} />
        ) : stage === 'RECOVER_CODE' ? (
          <BubbleInput value={recoveryCode} onChange={setRecoveryCode} onComplete={submitRecoveryCode} disabled={busy} />
        ) : (
          <BubbleInput value={newPin} onChange={setNewPin} onComplete={submitNewPin} disabled={busy} />
        )}

        {error && <p className="text-[11px] text-rose-400 mt-5">{error}</p>}

        {status && status.failedAttempts > 0 && !locked && (
          <p className="text-[10px] text-amber-500/80 mt-3">
            {5 - status.failedAttempts} attempt(s) remaining before the vault locks.
          </p>
        )}

        {(stage === 'PIN' || locked) && (
          <button
            onClick={() => void startRecovery()}
            disabled={busy}
            className="mt-6 text-[10px] font-black uppercase tracking-widest text-gold-500/80 hover:text-gold-400 transition disabled:opacity-40"
          >
            Forgot your PIN?
          </button>
        )}

        <div className="mt-10 flex items-center justify-center gap-4">
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
          )}
          <button
            onClick={() => navigate('/settings/security')}
            className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition"
          >
            Vault settings
          </button>
        </div>
      </div>
    </div>
  );
};
