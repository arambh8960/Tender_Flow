import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a log line, an error envelope and an audit row. */
      requestId: string;
    }
  }
}

/**
 * Stamps every request with an id and logs its outcome.
 *
 * The id is echoed in the error envelope and stored on audit rows, so a user
 * reporting "it failed at 14:02" can be traced to exact server log lines
 * without asking them to reproduce it.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const inbound = req.headers['x-request-id'];
  req.requestId = typeof inbound === 'string' && inbound.length <= 100 ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    // Health probes fire constantly; logging them buries real traffic.
    if (req.path === '/api/health' || req.path === '/api/ready') return;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
    console[level](
      `[${req.requestId}] ${req.method} ${req.path} -> ${res.statusCode} ${ms}ms`
    );
  });

  next();
}

/** Best-effort client IP, honouring one proxy hop. */
export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? undefined;
}
