import * as React from 'react';
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase/client';
import { ProfileRepository } from '../services/supabase/repositories/organizationRepository';
import { setAuthTokenProvider } from '../services/api/client';
import { isOtpMode } from '../lib/emailAuthMode';
import type { Tables } from '../../database.types';

export type Profile = Tables<'profiles'>;

interface AuthContextValue {
  /** null while still restoring the session on first paint. */
  initializing: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isAuthenticated: boolean;

  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Redirects to Google; the session lands via the OAuth callback route. */
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string, fullName?: string) => Promise<{ needsConfirmation: boolean }>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;

  /**
   * Re-verifies identity for a step-up action (resetting the vault PIN).
   * Sends a fresh code; verifying it mints a token with a recent `iat`,
   * which is what the server checks.
   */
  reauthenticate: (email: string) => Promise<void>;

  /**
   * Supabase Auth MFA. Replaces the previous standalone TOTP library plus a
   * secret column we managed ourselves, which could never gate sign-in.
   */
  mfa: {
    listFactors: () => Promise<{ id: string; status: string; friendlyName: string | null }[]>;
    enroll: () => Promise<{ factorId: string; qrCode: string; secret: string }>;
    verifyEnrollment: (factorId: string, code: string) => Promise<void>;
    challengeAndVerify: (factorId: string, code: string) => Promise<void>;
    unenroll: (factorId: string) => Promise<void>;
  };
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Backend calls carry the Supabase JWT so the server can enforce RLS as
  // the caller rather than trusting a client-supplied organization id.
  useEffect(() => {
    setAuthTokenProvider(() => session?.access_token ?? null);
    return () => setAuthTokenProvider(null);
  }, [session]);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      setProfile(await ProfileRepository.getMine(userId));
    } catch (err) {
      console.error('[auth] failed to load profile', err);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitializing(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => active && setInitializing(false));
      } else {
        setInitializing(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) void loadProfile(nextSession.user.id);
      else setProfile(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      session,
      user: session?.user ?? null,
      profile,
      isAuthenticated: Boolean(session?.user),

      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (error) throw new Error(error.message);
      },

      /**
       * Google sign-in.
       *
       * Supabase performs the OAuth exchange and establishes the session; the
       * browser never handles a Google credential, and no Google token is
       * posted to our own backend for verification. `redirectTo` must be
       * registered in the Supabase dashboard or the provider refuses the
       * round trip.
       */
      async signInWithGoogle(redirectPath = '/auth/callback') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}${redirectPath}`,
            queryParams: { access_type: 'offline', prompt: 'consent' },
          },
        });
        if (error) throw new Error(error.message);
      },

      async signUpWithPassword(email, password, fullName) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: fullName ? { full_name: fullName } : undefined },
        });
        if (error) throw new Error(error.message);
        // No session back means the project requires email confirmation.
        return { needsConfirmation: !data.session };
      },

      /**
       * Starts email sign-in.
       *
       * The same Supabase call backs both experiences; the project's email
       * template decides whether the recipient gets a six digit code or a
       * link. `emailRedirectTo` is only meaningful for the link, and is sent
       * regardless so a project that mails both still lands correctly.
       */
      async sendOtp(email) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw new Error(error.message);
      },

      async verifyOtp(email, token) {
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: token.trim(),
          type: 'email',
        });
        if (error) throw new Error(error.message);
      },

      async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw new Error(error.message);
      },

      async signOut() {
        await supabase.auth.signOut();
        setProfile(null);
      },

      async refreshProfile() {
        if (session?.user) await loadProfile(session.user.id);
      },

      async reauthenticate(email) {
        // shouldCreateUser:false — this is a re-verification of an existing
        // account, never a signup path.
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            shouldCreateUser: false,
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw new Error(error.message);

        // The PIN reset step needs a code the user can type. Under
        // magic-link configuration there is none, so say so plainly rather
        // than presenting an input nothing will satisfy.
        if (!isOtpMode) {
          throw new Error(
            'This deployment sends a sign-in link rather than a code. Open the link we just emailed you, then return here to set a new PIN.'
          );
        }
      },

      mfa: {
        async listFactors() {
          const { data, error } = await supabase.auth.mfa.listFactors();
          if (error) throw new Error(error.message);
          return (data?.totp ?? []).map(f => ({
            id: f.id,
            status: f.status,
            friendlyName: f.friendly_name ?? null,
          }));
        },

        async enroll() {
          const { data, error } = await supabase.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: `TenderFlow ${new Date().toISOString().slice(0, 10)}`,
          });
          if (error) throw new Error(error.message);

          return {
            factorId: data.id,
            qrCode: data.totp.qr_code,
            // Shown once, for an authenticator that cannot scan a QR code.
            secret: data.totp.secret,
          };
        },

        async verifyEnrollment(factorId, code) {
          const challenge = await supabase.auth.mfa.challenge({ factorId });
          if (challenge.error) throw new Error(challenge.error.message);

          const { error } = await supabase.auth.mfa.verify({
            factorId,
            challengeId: challenge.data.id,
            code: code.trim(),
          });
          if (error) throw new Error(error.message);
        },

        async challengeAndVerify(factorId, code) {
          const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
          if (error) throw new Error(error.message);
        },

        async unenroll(factorId) {
          const { error } = await supabase.auth.mfa.unenroll({ factorId });
          if (error) throw new Error(error.message);
        },
      },
    }),
    [initializing, session, profile, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
