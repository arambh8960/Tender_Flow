/**
 * Which email sign-in experience this deployment actually offers.
 *
 * Supabase's `signInWithOtp` call is identical in both cases — what differs is
 * the EMAIL TEMPLATE. A template containing `{{ .Token }}` sends a six digit
 * code; the stock template contains `{{ .ConfirmationURL }}` and sends a
 * clickable link. The API response is the same either way, so the frontend
 * cannot detect which one arrived in the user's inbox.
 *
 * That is why this is explicit configuration rather than a guess. Showing a
 * code entry box while Supabase mails a link is the specific bug this exists
 * to prevent: the user has nothing to type.
 *
 * Set VITE_EMAIL_AUTH_MODE to:
 *
 *   otp         the Magic Link template has been edited to include
 *               {{ .Token }} (see README §7). The UI asks for a code.
 *
 *   magic_link  the stock template is in use. The UI says "check your email"
 *               and the link lands on /auth/callback.
 */
export type EmailAuthMode = 'otp' | 'magic_link';

const configured = (import.meta.env.VITE_EMAIL_AUTH_MODE as string | undefined)?.trim().toLowerCase();

/**
 * Defaults to magic_link because that is what an UNMODIFIED Supabase project
 * sends. Defaulting to `otp` would mean every fresh deployment shows a code
 * box for an email that contains no code — the failure we are fixing.
 */
export const EMAIL_AUTH_MODE: EmailAuthMode = configured === 'otp' ? 'otp' : 'magic_link';

export const isOtpMode = EMAIL_AUTH_MODE === 'otp';
