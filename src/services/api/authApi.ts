import { api } from './client';

/**
 * Vault-lock endpoints only.
 *
 * Sign-in, sign-up, OAuth, OTP, password reset and multi-factor enrolment
 * are all handled directly by the Supabase Auth SDK in AuthContext. No email
 * is ever passed here to identify an account: the server acts on the
 * authenticated caller.
 */

export interface VaultSecurityStatus {
  hasPin: boolean;
  isSetupComplete: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
}

export const authApi = {
  getVaultStatus: () => api.get<{ data: VaultSecurityStatus }>('/api/vault/security').then(r => r.data),

  setPin: (pin: string) => api.post<{ data: { hasPin: boolean } }>('/api/vault/pin', { pin }),

  /**
   * Forgotten PIN. Requires a recently-issued session, so the caller must
   * have just re-verified through Supabase; the server rejects a stale token
   * with REAUTH_REQUIRED.
   */
  resetPin: (pin: string) =>
    api.post<{ data: { hasPin: boolean; unlocked: boolean } }>('/api/vault/pin/reset', { pin }).then(r => r.data),

  verifyPin: (pin: string) =>
    api.post<{ data: { unlocked: boolean } }>('/api/vault/pin/verify', { pin }).then(r => r.data),

  disableVaultLock: () => api.delete<{ data: { hasPin: boolean } }>('/api/vault/security'),
};
