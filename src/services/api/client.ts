/**
 * Single HTTP entry point for the frontend.
 *
 * Replaces ~20 hand-written fetch calls that each hardcoded
 * `http://localhost:3001` or recomputed an `API_BASE` ternary inline. The
 * base URL is now configurable, which matters in practice: another local
 * process (VS Code's port forwarding) can occupy 127.0.0.1:3001 and
 * silently shadow the backend.
 */

const DEFAULT_DEV_BASE = 'http://localhost:3001';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? DEFAULT_DEV_BASE
    : '');

/** Error shape returned by the backend's error middleware. */
export interface ApiErrorBody {
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Auth token supplier — populated by AuthContext once Supabase Auth lands. */
let authTokenProvider: (() => string | null) | null = null;

export function setAuthTokenProvider(fn: (() => string | null) | null) {
  authTokenProvider = fn;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send as multipart instead of JSON. */
  formData?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal, headers = {} } = options;

  const finalHeaders: Record<string, string> = { ...headers };

  const token = authTokenProvider?.();
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const url = `${API_BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, { method, headers: finalHeaders, body: payload, signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('NETWORK_ERROR', `Could not reach the server at ${API_BASE_URL}.`, 0, err);
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const parsed = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    // A 401 means the session is gone; the app should return to sign-in
    // rather than leaving the user clicking into failures.
    if (response.status === 401) unauthorizedHandler?.();

    const raw = (parsed as any)?.error;

    // Two shapes exist during the migration:
    // Errors arrive as { error: { code, message } } from the error
    // middleware; the string/message forms are tolerated defensively.
    const code = typeof raw === 'object' && raw ? raw.code : 'HTTP_ERROR';
    const message =
      (typeof raw === 'string' ? raw : raw?.message) ||
      (parsed as any)?.message ||
      `Request failed with status ${response.status}`;

    throw new ApiError(code || 'HTTP_ERROR', message, response.status, parsed);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData, options?: Omit<RequestOptions, 'method' | 'formData'>) =>
    request<T>(path, { ...options, method: 'POST', formData }),
};

/**
 * Human-readable message for a failed call.
 *
 * Each status means something specific to the user, and saying "request
 * failed" for all of them hides the one piece of information that would let
 * them fix it themselves.
 */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }

  switch (error.status) {
    case 0:
      return 'The server could not be reached. Check your connection and try again.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return error.message || 'You do not have permission to do that.';
    case 404:
      return error.message || 'That item no longer exists.';
    case 409:
      return error.message || 'That conflicts with something that already exists.';
    case 422:
      return error.message || 'Some of the information supplied is not valid.';
    case 429:
      return 'Too many requests. Wait a moment and try again.';
    default:
      return error.status >= 500
        ? 'The server ran into a problem. The team has been notified.'
        : error.message || 'The request failed.';
  }
}

/** Invoked when the API reports an expired or invalid session. */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

/** Absolute URL for a resource the browser loads directly (img src, links). */
export function assetUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
