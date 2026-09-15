import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Consistent API envelope.
 *
 * The codebase previously returned five different error shapes — some JSON,
 * one plain text, and one HTTP 200 carrying success:false.
 */
export interface ApiError {
  code: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public detail?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function ok<T>(res: Response, data: T, extra: Record<string, unknown> = {}) {
  return res.json({ success: true, data, ...extra });
}

export function fail(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ success: false, error: { code, message }, ...extra });
}

/** Wraps an async handler so rejections reach the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Terminal error middleware. Logs the full error server-side and returns a
 * safe envelope — never a stack trace or an internal message.
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    console.error(`🔥 [${err.code}]`, err.message, err.detail ?? '');
    return fail(res, err.status, err.code, err.message);
  }

  console.error('🔥 [UNHANDLED]', err?.stack || err);
  return fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

export function notFoundHandler(_req: Request, res: Response) {
  return fail(res, 404, 'NOT_FOUND', 'Endpoint not found.');
}
