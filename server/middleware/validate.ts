import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';
import { fail } from './errorHandler';

/**
 * Schema validation for external input.
 *
 * Handlers previously read req.body fields directly, so a missing field
 * became `undefined` deep inside business logic (or reached the database as
 * null). Validation happens once, at the edge, and the handler receives a
 * parsed value it can trust.
 */
export type RequestPart = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodType<T>, part: RequestPart = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      const details = result.error.issues.map(issue => ({
        path: issue.path.join('.') || part,
        message: issue.message,
      }));
      return fail(res, 422, 'VALIDATION_FAILED', 'The request payload is invalid.', { details });
    }

    // Store the parsed value rather than overwriting req.query, which is a
    // getter-only property on Express 5.
    (req as Request & { valid?: Record<string, unknown> }).valid = {
      ...(req as Request & { valid?: Record<string, unknown> }).valid,
      [part]: result.data,
    };
    next();
  };
}

/** Reads a value produced by validate(). */
export function validated<T>(req: Request, part: RequestPart = 'body'): T {
  const bag = (req as Request & { valid?: Record<string, unknown> }).valid;
  return bag?.[part] as T;
}
