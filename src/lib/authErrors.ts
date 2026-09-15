/**
 * Human-readable rewrites of Supabase Auth errors.
 *
 * Supabase's messages are accurate but written for a developer reading a
 * stack trace, not for an operator who just wants to get into the product.
 * These keep the meaning and add what to do about it.
 *
 * Deliberately a standalone module with no React or browser dependency: it is
 * pure string logic, it is used from several screens, and it can be tested
 * without mounting anything.
 */
export function friendlyAuthError(message?: string): string {
  if (!message) return 'Something went wrong. Try again.';
  const text = message.toLowerCase();

  if (text.includes('invalid login credentials')) return 'That email and password do not match an account.';
  if (text.includes('token has expired') || text.includes('otp_expired')) {
    return 'That code has expired. Request a new one.';
  }
  if (text.includes('invalid') && text.includes('token')) return 'That code is not valid. Check it and try again.';
  if (text.includes('email rate limit') || text.includes('over_email_send_rate_limit')) {
    return 'Too many codes requested. Wait a minute before trying again.';
  }
  if (text.includes('rate limit') || text.includes('too many requests')) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (text.includes('email not confirmed')) return 'Confirm your email address first — check your inbox.';
  if (text.includes('user already registered')) return 'That email already has an account. Sign in instead.';
  if (text.includes('should be at least')) return 'Choose a longer password (at least 8 characters).';
  if (text.includes('provider is not enabled') || text.includes('unsupported provider')) {
    return 'Google sign-in is not enabled on this deployment yet.';
  }
  if (text.includes('mfa') && text.includes('not enabled')) {
    return 'Multi-factor authentication is not enabled on this project yet.';
  }
  if (text.includes('failed to fetch') || text.includes('networkerror')) {
    return 'Could not reach the authentication service. Check your connection.';
  }

  return message;
}
