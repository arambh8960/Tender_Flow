import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, type VaultSecurityStatus } from '../services/api/authApi';
import { describeApiError } from '../services/api/client';
import { useAuth } from '../contexts/AuthContext';
import { friendlyAuthError } from '../lib/authErrors';
import { Panel, buttonClass, ghostButtonClass, inputClass, ErrorNote, Spinner } from '../components/admin/AdminShell';

/**
 * Vault lock settings.
 *
 * The PIN is a second factor in front of compliance documents, not a login.
 * It is stored as a bcrypt hash against the signed-in user and locks after
 * repeated failures — the old flow accepted a PIN for whatever email the
 * browser named, which authenticated nobody.
 */
export const VaultSecurityPage: React.FC = () => {
  const navigate = useNavigate();
  const { mfa } = useAuth();

  /**
   * Authenticator enrolment runs through Supabase Auth MFA rather than a
   * self-managed TOTP secret. That matters beyond tidiness: a
   * factor registered with Supabase can be enforced at SIGN-IN, whereas a
   * secret we stored ourselves could only gate screens we remembered to
   * check. The setup key is shown once during enrolment, never after.
   */
  const [factors, setFactors] = useState<{ id: string; status: string; friendlyName: string | null }[]>([]);
  const [enrolment, setEnrolment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const [status, setStatus] = useState<VaultSecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await authApi.getVaultStatus());
    } catch (err) {
      setError(describeApiError(err));
    }

    try {
      setFactors(await mfa.listFactors());
    } catch {
      // MFA being unavailable on the project is not a page-level failure;
      // the section simply reports that it cannot enrol.
      setFactors([]);
    } finally {
      setLoading(false);
    }
  }, [mfa]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (pin !== confirmPin) {
      setError('The two PINs do not match.');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError('The PIN must be exactly six digits.');
      return;
    }

    try {
      await authApi.setPin(pin);
      setPin('');
      setConfirmPin('');
      setNotice('Vault PIN saved.');
      await load();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  const startTotp = async () => {
    setError(null);
    try {
      setEnrolment(await mfa.enroll());
      setShowSecret(false);
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
    }
  };

  const confirmTotp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (!enrolment) return;
      await mfa.verifyEnrollment(enrolment.factorId, totpCode);
      // The setup key is discarded the moment the factor is verified.
      setEnrolment(null);
      setTotpCode('');
      setNotice('Authenticator linked. It will be required when you sign in.');
      await load();
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
      setTotpCode('');
    }
  };

  const removeFactor = async (factorId: string) => {
    if (!window.confirm('Remove this authenticator? You will no longer be asked for a code at sign-in.')) return;
    setError(null);
    try {
      await mfa.unenroll(factorId);
      setNotice('Authenticator removed.');
      await load();
    } catch (err: any) {
      setError(friendlyAuthError(err?.message));
    }
  };

  if (loading && !status) return <Spinner label="Loading vault settings" />;

  const verifiedFactors = factors.filter(f => f.status === 'verified');

  return (
    <div className="h-full overflow-y-auto scrollbar-hide space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black text-white uppercase italic tracking-tight">
            Vault security<span className="text-gold-500">.</span>
          </h1>
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1.5">
            Optional second factor for compliance documents
          </p>
        </div>
        <button onClick={() => navigate('/settings')} className={ghostButtonClass}>
          Back to settings
        </button>
      </div>

      {error && <ErrorNote message={error} />}
      {notice && <p className="text-[11px] text-emerald-400">{notice}</p>}

      {status?.isLocked && (
        <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl px-4 py-3">
          <p className="text-[11px] text-rose-300">
            The vault is locked after repeated failed attempts
            {status.lockedUntil ? ` until ${new Date(status.lockedUntil).toLocaleTimeString('en-GB')}` : ''}.
          </p>
        </div>
      )}

      <Panel
        title={status?.hasPin ? 'Change vault PIN' : 'Set a vault PIN'}
        subtitle="Six digits. Stored as a hash — it cannot be read back, only replaced."
      >
        <form onSubmit={savePin} className="flex flex-col sm:flex-row gap-3 max-w-xl">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="New PIN"
            className={inputClass}
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Confirm PIN"
            className={inputClass}
          />
          <button type="submit" className={buttonClass}>
            Save
          </button>
        </form>
      </Panel>

      <Panel
        title="Two-factor authentication"
        subtitle={
          verifiedFactors.length > 0
            ? 'An authenticator is linked and will be required at sign-in.'
            : 'Add an authenticator app as a second step at sign-in.'
        }
      >
        {enrolment ? (
          <form onSubmit={confirmTotp} className="space-y-4">
            <p className="text-[11px] text-slate-400">
              Scan this with your authenticator app, then enter the code it shows.
            </p>

            {/* Supabase returns the QR as a data URI, so no network fetch. */}
            <img src={enrolment.qrCode} alt="Authenticator QR code" className="w-44 h-44 rounded-xl bg-white p-2" />

            <div>
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
              >
                {showSecret ? 'Hide setup key' : 'Cannot scan? Show setup key'}
              </button>
              {showSecret && (
                <code className="block mt-2 text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 break-all">
                  {enrolment.secret}
                </code>
              )}
            </div>

            <div className="flex gap-3 max-w-sm">
              <input
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="6-digit code"
                className={inputClass}
                autoFocus
              />
              <button type="submit" disabled={totpCode.length !== 6} className={buttonClass}>
                Confirm
              </button>
            </div>

            <button
              type="button"
              onClick={() => { setEnrolment(null); setTotpCode(''); }}
              className={ghostButtonClass}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {verifiedFactors.length > 0 && (
              <ul className="space-y-2">
                {verifiedFactors.map(factor => (
                  <li
                    key={factor.id}
                    className="flex items-center justify-between gap-4 py-2 border-b border-slate-800/60 last:border-0"
                  >
                    <div>
                      <p className="text-[12px] text-slate-200">{factor.friendlyName ?? 'Authenticator app'}</p>
                      <p className="text-[10px] text-emerald-400 uppercase tracking-widest font-black">Active</p>
                    </div>
                    <button onClick={() => void removeFactor(factor.id)} className={ghostButtonClass}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button onClick={() => void startTotp()} className={buttonClass}>
              {verifiedFactors.length > 0 ? 'Add another authenticator' : 'Set up authenticator'}
            </button>
          </div>
        )}
      </Panel>

      {(status?.hasPin || verifiedFactors.length > 0) && (
        <Panel title="Remove vault lock" subtitle="Documents stay protected by workspace permissions.">
          <button
            onClick={async () => {
              if (!window.confirm('Remove the vault PIN and authenticator binding?')) return;
              try {
                await authApi.disableVaultLock();
                setNotice('Vault lock removed.');
                await load();
              } catch (err) {
                setError(describeApiError(err));
              }
            }}
            className={ghostButtonClass}
          >
            Remove lock
          </button>
        </Panel>
      )}
    </div>
  );
};
