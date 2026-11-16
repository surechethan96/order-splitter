import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[\w-]{1,64}$/;

// Logs each request with its response time in ms and tags it with an id (from X-Request-Id or a new one) for tracing.
export function requestLogger(
  logger: Pick<Logger, 'log' | 'warn' | 'error'> = new Logger('HTTP'),
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && SAFE_ID.test(incoming)
        ? incoming
        : randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);

    // 'close' fires once per request: after the response is sent, or when the client gives up.
    res.on('close', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const status = res.writableFinished ? res.statusCode : 'ABORTED';
      const line = `${req.method} ${req.originalUrl} ${status} ${ms.toFixed(2)} ms [${requestId}]`;
      if (!res.writableFinished) logger.warn(line);
      else if (res.statusCode >= 500) logger.error(line);
      else if (res.statusCode >= 400) logger.warn(line);
      else logger.log(line);
    });
    next();
  };
}
