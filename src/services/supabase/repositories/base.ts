import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Repositories translate Supabase's { data, error } envelope into values or
 * thrown errors, so callers never branch on PostgrestError shapes.
 */
export class RepositoryError extends Error {
  constructor(public code: string, message: string, public details?: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) {
    throw new RepositoryError(res.error.code ?? 'DB_ERROR', res.error.message, res.error.details ?? undefined);
  }
  if (res.data === null) {
    throw new RepositoryError('NOT_FOUND', 'No record returned');
  }
  return res.data;
}

export function unwrapMaybe<T>(res: { data: T | null; error: PostgrestError | null }): T | null {
  if (res.error) {
    // PGRST116 = "0 rows" from .single(); a legitimate absence, not a fault.
    if (res.error.code === 'PGRST116') return null;
    throw new RepositoryError(res.error.code ?? 'DB_ERROR', res.error.message, res.error.details ?? undefined);
  }
  return res.data;
}

export function unwrapList<T>(res: { data: T[] | null; error: PostgrestError | null }): T[] {
  if (res.error) {
    throw new RepositoryError(res.error.code ?? 'DB_ERROR', res.error.message, res.error.details ?? undefined);
  }
  return res.data ?? [];
}
