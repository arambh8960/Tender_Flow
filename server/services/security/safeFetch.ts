import axios from 'axios';
import { assertSafeUrl, assertSafeRedirect, BlockedUrlError } from './urlGuard';

/**
 * Outbound HTTP for caller-supplied URLs.
 *
 * axios follows redirects internally, which would re-open the SSRF hole the
 * URL guard closes: only the first hop would be validated, and a public URL
 * that 302s to 169.254.169.254 would still be fetched. Redirects are
 * therefore disabled and walked manually, validating every hop.
 */

export const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/pdf,application/json,text/html,text/plain,*/*',
};

/** Content types a tender document may legitimately arrive as. */
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/octet-stream',
  'text/html',
  'text/plain',
  'application/json',
  'application/xhtml+xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
];

export class UnsafeResponseError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'UnsafeResponseError';
  }
}

export interface FetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  hops: number;
}

/**
 * Fetches a URL after validating it (and every redirect target) against the
 * SSRF rules. Throws BlockedUrlError or UnsafeResponseError.
 */
export async function safeFetchDocument(rawUrl: string, extraHeaders: Record<string, string> = {}): Promise<FetchResult> {
  let target = await assertSafeUrl(rawUrl);
  let hops = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await axios.get(target.url.toString(), {
      responseType: 'arraybuffer',
      headers: { ...DEFAULT_HEADERS, ...extraHeaders },
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      // 3xx must reach us rather than throwing, so we can validate the hop.
      validateStatus: status => (status >= 200 && status < 300) || (status >= 300 && status < 400),
      decompress: true,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers['location'];
      if (!location || typeof location !== 'string') {
        throw new UnsafeResponseError('BAD_REDIRECT', 'The server issued a redirect without a destination.');
      }
      if (++hops > MAX_REDIRECTS) {
        throw new UnsafeResponseError('TOO_MANY_REDIRECTS', 'The document redirected too many times.');
      }
      // Each hop is validated exactly like the original URL.
      target = await assertSafeRedirect(location, target.url);
      continue;
    }

    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.some(allowed => contentType.includes(allowed))) {
      throw new UnsafeResponseError('UNSUPPORTED_CONTENT_TYPE', `The document type ${contentType} is not supported.`);
    }

    const buffer = Buffer.from(response.data);
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new UnsafeResponseError('RESPONSE_TOO_LARGE', 'The document exceeds the size limit.');
    }

    return { buffer, contentType, finalUrl: target.url.toString(), hops };
  }
}

export { BlockedUrlError };
