import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { fail, ok } from '../middleware/errorHandler';
import { validated } from '../middleware/validate';
import { serviceClient, hasServiceRole } from '../db/supabase';

/**
 * Vault unlock: an OPTIONAL second factor in front of compliance documents.
 *
 * This is explicitly not an authentication system. Supabase Auth decides who
 * the caller is; every handler below requires an already-valid session and
 * acts on that user's own row. What used to live here — Google token
 * exchange, email OTP, a constant string treated as a session credential,
 * and an account lookup keyed by a client-supplied email — is
 * gone, because all of it let the browser nominate its own identity.
 *
 * The PIN is stored only as a bcrypt hash, and repeated failures lock the
 * vault rather than allowing unlimited guesses at a six-digit number.
 */

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export const pinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'The PIN must be exactly 6 digits.'),
});

/**
 * user_security rows are written with the service role: the table holds a
 * PIN hash and a TOTP secret, so it deliberately has no client-writable
 * policy. The user_id predicate is always the AUTHENTICATED user's id, never
 * a value from the request.
 */
function securityTable() {
  if (!hasServiceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for vault security operations.');
  return serviceClient().from('user_security');
}

async function loadSecurity(userId: string) {
  const { data, error } = await securityTable().select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Current vault state for the signed-in user. */
export async function getVaultStatus(req: Request, res: Response) {
  const auth = req.auth!;
  const row = await loadSecurity(auth.userId);

  const lockedUntil = lockoutExpiry(row);
  return ok(res, {
    hasPin: Boolean(row?.pin_hash),
    isSetupComplete: Boolean(row?.is_setup_complete),
    isLocked: Boolean(lockedUntil && lockedUntil > new Date()),
    lockedUntil: lockedUntil && lockedUntil > new Date() ? lockedUntil.toISOString() : null,
    failedAttempts: row?.failed_attempts ?? 0,
  });
}

/**
 * The lockout deadline, read from the stored column.
 *
 * It used to be derived from updated_at, which moved every time any other
 * field changed — so a successful unrelated write silently shortened or
 * extended the lockout. The deadline is now written explicitly when the
 * threshold is crossed.
 */
function lockoutExpiry(row: { failed_attempts?: number | null; locked_until?: string | null } | null) {
  if (!row?.locked_until) return null;
  const until = new Date(row.locked_until);
  return Number.isNaN(until.getTime()) ? null : until;
}

export async function setPin(req: Request, res: Response) {
  const auth = req.auth!;
  const { pin } = validated<z.infer<typeof pinSchema>>(req);

  const hash = await bcrypt.hash(pin, SALT_ROUNDS);

  const { error } = await securityTable().upsert(
    {
      user_id: auth.userId,
      pin_hash: hash,
      failed_attempts: 0,
      is_locked: false,
      locked_until: null,
      pin_updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'user_id' }
  );

  if (error) return fail(res, 500, 'PIN_SETUP_FAILED', 'The vault PIN could not be saved.');
  return ok(res, { hasPin: true });
}

export async function verifyPin(req: Request, res: Response) {
  const auth = req.auth!;
  const { pin } = validated<z.infer<typeof pinSchema>>(req);

  const row = await loadSecurity(auth.userId);
  if (!row?.pin_hash) return fail(res, 409, 'NO_PIN', 'No vault PIN has been set for this account.');

  const lockedUntil = lockoutExpiry(row);
  if (lockedUntil && lockedUntil > new Date()) {
    return fail(
      res,
      429,
      'VAULT_LOCKED',
      `Too many failed attempts. The vault unlocks at ${lockedUntil.toISOString()}.`
    );
  }

  const matches = await bcrypt.compare(pin, row.pin_hash);

  if (!matches) {
    const attempts = (row.failed_attempts ?? 0) + 1;
    const locked = attempts >= MAX_FAILED_ATTEMPTS;

    await securityTable()
      .update({
        failed_attempts: attempts,
        is_locked: locked,
        locked_until: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
      } as never)
      .eq('user_id', auth.userId);

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - attempts);
    return fail(
      res,
      401,
      'INVALID_PIN',
      remaining > 0
        ? `Incorrect PIN. ${remaining} attempt(s) remaining before the vault locks.`
        : `Incorrect PIN. The vault is now locked for ${LOCKOUT_MINUTES} minutes.`
    );
  }

  // A counter that is never reset turns a slow trickle of typos into a
  // permanent lockout.
  await securityTable()
    .update({
      failed_attempts: 0,
      is_locked: false,
      locked_until: null,
      last_login: new Date().toISOString(),
    } as never)
    .eq('user_id', auth.userId);

  // No token is minted: the caller is already authenticated. Unlocking is
  // per-session UI state, and the vault's real protection is RLS.
  //
  // There is no vault-level TOTP step any more: multi-factor is enforced by
  // Supabase Auth at SIGN-IN, which covers the whole session rather than one
  // screen. A second TOTP prompt here would be theatre.
  return ok(res, { unlocked: true });
}

/**
 * Forgotten PIN.
 *
 * There is no secret question and no emailed reset token. The caller has
 * already proved who they are to Supabase Auth — a valid session IS the
 * identity verification — and the reset acts only on that user's own row.
 *
 * What makes this safe is the same thing that makes the whole model work: the
 * PIN protects the vault as a second factor, it is not the thing that
 * authenticates you. A user who can present a valid session could read their
 * own documents anyway; resetting the PIN grants nothing new. The old flow,
 * by contrast, accepted a reset for whatever email the browser named.
 *
 * Callers are expected to have just re-verified through Supabase (a fresh OTP
 * or an OAuth round trip); `requireRecentAuth` enforces that the session is
 * young enough for that claim to mean something.
 */
export async function resetPin(req: Request, res: Response) {
  const auth = req.auth!;
  const { pin } = validated<z.infer<typeof pinSchema>>(req);

  const hash = await bcrypt.hash(pin, SALT_ROUNDS);

  const { error } = await securityTable().upsert(
    {
      user_id: auth.userId,
      pin_hash: hash,
      failed_attempts: 0,
      is_locked: false,
      locked_until: null,
      pin_updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'user_id' }
  );

  if (error) return fail(res, 500, 'PIN_RESET_FAILED', 'The vault PIN could not be reset.');

  // A PIN reset clears any lockout, which is the point of the flow.
  return ok(res, { hasPin: true, unlocked: true });
}

/** Removes the vault PIN for the signed-in user. */
export async function disableVaultLock(req: Request, res: Response) {
  const auth = req.auth!;

  const { error } = await securityTable()
    .update({
      pin_hash: null,
      failed_attempts: 0,
      is_locked: false,
      locked_until: null,
      pin_updated_at: new Date().toISOString(),
    } as never)
    .eq('user_id', auth.userId);

  if (error) return fail(res, 500, 'DISABLE_FAILED', 'The vault lock could not be removed.');
  return ok(res, { hasPin: false });
}
