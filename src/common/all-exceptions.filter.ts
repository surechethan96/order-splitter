import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

// Errors thrown by Express middleware (for example "payload too large") carry a 4xx statusCode.
function isClientError(error: unknown): error is { statusCode: number } {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return (
    typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
  );
}

// Gives every error the same JSON shape and never leaks internal details.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    let statusCode = 500;
    let message = 'Something went wrong on our side. Please try again.';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      const raw =
        typeof body === 'string'
          ? body
          : (body as { message?: string | string[] }).message;
      if (Array.isArray(raw)) {
        message = 'Validation failed';
        details = raw;
      } else if (raw) {
        message = raw;
      }
    } else if (isClientError(exception)) {
      statusCode = exception.statusCode;
      message = STATUS_CODES[statusCode] ?? message;
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(statusCode).json({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      details,
      path: req.originalUrl,
      requestId: req.headers['x-request-id'],
      timestamp: new Date().toISOString(),
    });
  }
}
