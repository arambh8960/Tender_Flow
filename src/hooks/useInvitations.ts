import { useCallback, useEffect, useState } from 'react';
import { invitationApi, type PendingInvitation } from '../services/api/invitationApi';
import { describeApiError } from '../services/api/client';
import { useAuth } from '../contexts/AuthContext';

/**
 * Invitations waiting for the signed-in user.
 *
 * Loaded as soon as there is a session, because the first-login decision tree
 * needs the answer before it can choose between "create an organisation" and
 * "join one you were invited to".
 */
export function useInvitations() {
  const { isAuthenticated, initializing } = useAuth();

  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (initializing) return;
    if (!isAuthenticated) {
      setInvitations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setInvitations(await invitationApi.listMine());
    } catch (err) {
      setError(describeApiError(err));
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, initializing]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = useCallback(
    async (invitationId: string) => {
      setAccepting(invitationId);
      setError(null);
      try {
        return await invitationApi.accept(invitationId);
      } catch (err) {
        setError(describeApiError(err));
        throw err;
      } finally {
        setAccepting(null);
      }
    },
    []
  );

  const decline = useCallback(
    async (invitationId: string) => {
      setAccepting(invitationId);
      setError(null);
      try {
        await invitationApi.decline(invitationId);
        // Drop it locally too, so the card disappears without a round trip.
        setInvitations(current => current.filter(i => i.id !== invitationId));
      } catch (err) {
        setError(describeApiError(err));
        throw err;
      } finally {
        setAccepting(null);
      }
    },
    []
  );

  return {
    invitations,
    loading,
    error,
    accepting,
    hasInvitations: invitations.length > 0,
    reload: load,
    accept,
    decline,
  };
}
