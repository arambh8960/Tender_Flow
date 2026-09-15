import * as React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase/client';
import { friendlyAuthError } from '../lib/authErrors';
import { BootSplash } from '../routes/guards';

/**
 * OAuth landing page.
 *
 * Supabase redirects here after Google. The SDK parses the fragment or code
 * from the URL and stores the session itself, so this page's only jobs are to
 * wait for that to finish, surface a provider error if one came back, and
 * then get out of the way.
 *
 * It deliberately does not decide where to go next. Routing to onboarding,
 * the invitation screen or the workspace is the membership question, and
 * OrganizationRoute already answers it — duplicating that logic here is how
 * the two drift apart.
 */
export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // The provider reports failures in the query string or the fragment,
    // depending on the flow. Neither produces a session, so check both before
    // waiting for one that will never arrive.
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const providerError =
      params.get('error_description') ?? params.get('error') ??
      fragment.get('error_description') ?? fragment.get('error');

    if (providerError) {
      setError(friendlyAuthError(providerError));
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;

        if (sessionError) {
          setError(friendlyAuthError(sessionError.message));
          return;
        }

        if (data.session) {
          // replace: the callback URL carries tokens and must not stay in
          // history where a back button would replay it.
          navigate('/dashboard', { replace: true });
          return;
        }

        // detectSessionInUrl may still be processing; onAuthStateChange fires
        // once it lands.
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session) navigate('/dashboard', { replace: true });
        });

        // If nothing arrives, say so rather than spinning forever.
        const timeout = setTimeout(() => {
          if (active) setError('Sign-in did not complete. Please try again.');
        }, 10_000);

        return () => {
          subscription.subscription.unsubscribe();
          clearTimeout(timeout);
        };
      })
      .catch(err => active && setError(friendlyAuthError(err?.message)));

    return () => {
      active = false;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="h-[100dvh] w-full bg-slate-950 flex items-center justify-center px-6 font-sans">
        <div className="max-w-sm text-center space-y-6">
          <h1 className="text-lg font-black text-white uppercase tracking-tight">Sign-in failed</h1>
          <p className="text-[12px] text-slate-400 leading-relaxed">{error}</p>
          <button
            onClick={() => navigate('/signin', { replace: true })}
            className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return <BootSplash label="Completing sign-in" />;
};
