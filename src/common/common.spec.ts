import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { HealthController } from '../health/health.controller';
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  findInputProblems,
  MAX_DEPTH,
  RejectUnsafeInputPipe,
} from './reject-unsafe-input.pipe';
import { requestLogger } from './request-logger.middleware';

describe('requestLogger', () => {
  function run(statusCode: number, incomingId?: string, finished = true) {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/orders',
      headers: { 'x-request-id': incomingId },
    };
    const res = Object.assign(new EventEmitter(), {
      statusCode,
      writableFinished: finished,
      setHeader: jest.fn(),
    });
    const next = jest.fn();

    requestLogger(logger)(
      req as unknown as Request,
      res as unknown as Response,
      next,
    );
    res.emit('close');
    return { logger, req, res, next };
  }

  it('prints method, path, status and the time in milliseconds', () => {
    const { logger, next } = run(201, 'req-1');
    expect(next).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^POST \/api\/v1\/orders 201 \d+\.\d{2} ms \[req-1\]$/,
      ),
    );
  });

  it('warns on 4xx and reports 5xx as errors', () => {
    expect(run(400).logger.warn).toHaveBeenCalled();
    expect(run(500).logger.error).toHaveBeenCalled();
  });

  it('reports a request the client gave up on', () => {
    const { logger } = run(200, 'req-1', false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/ ABORTED \d+\.\d{2} ms \[req-1\]$/),
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('keeps a safe incoming request id', () => {
    const { req, res } = run(200, 'trace_ABC-123');
    expect(req.headers['x-request-id']).toBe('trace_ABC-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace_ABC-123');
  });

  it('creates a request id when none (or an unsafe one) is sent', () => {
    const { req, res } = run(200, 'bad id with spaces');
    expect(req.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      req.headers['x-request-id'],
    );
  });
});

describe('AllExceptionsFilter', () => {
  function run(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          originalUrl: '/api/v1/orders',
          headers: { 'x-request-id': 'req-1' },
        }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new AllExceptionsFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(exception, host);
    return { status, body: json.mock.calls[0][0] as Record<string, unknown> };
  }

  it('keeps the status and message of an HTTP error', () => {
    const { status, body } = run(
      new NotFoundException('Order x was not found.'),
    );
    expect(status).toHaveBeenCalledWith(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Order x was not found.',
      path: '/api/v1/orders',
      requestId: 'req-1',
    });
  });

  it('lists validation problems under details', () => {
    const { body } = run(
      new BadRequestException(['a must be a number', 'b is required']),
    );
    expect(body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
      details: ['a must be a number', 'b is required'],
    });
  });

  it('keeps 4xx errors raised by Express middleware, such as a body that is too large', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
    });
    const { status, body } = run(tooLarge);
    expect(status).toHaveBeenCalledWith(413);
    expect(body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Payload Too Large',
    });
  });

  it('does not trust a 5xx or odd status code on an unknown error', () => {
    for (const statusCode of [503, 200, '400']) {
      const { status } = run(Object.assign(new Error('boom'), { statusCode }));
      expect(status).toHaveBeenCalledWith(500);
    }
    expect(run(null).status).toHaveBeenCalledWith(500);
  });

  it('keeps a plain text HTTP error message', () => {
    const { body } = run(new HttpException('Already used', 409));
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      message: 'Already used',
    });
  });

  it('hides the details of an unexpected error', () => {
    for (const failure of [
      new Error('database password is hunter2'),
      'plain text failure',
    ]) {
      const { status, body } = run(failure);
      expect(status).toHaveBeenCalledWith(500);
      expect(JSON.stringify(body)).not.toContain('hunter2');
      expect(body.message).toBe(
        'Something went wrong on our side. Please try again.',
      );
    }
  });
});

describe('RejectUnsafeInputPipe', () => {
  const pipe = new RejectUnsafeInputPipe();
  const as = (type: ArgumentMetadata['type']) => ({ type }) as ArgumentMetadata;
  const nested = (levels: number) => {
    let value: unknown = 'leaf';
    for (let i = 0; i < levels; i++) value = [value];
    return value;
  };

  it('finds __proto__, constructor and prototype keys at any depth', () => {
    const body = JSON.parse(
      '{"__proto__":{"x":1},"constructor":{},"portfolio":[{"symbol":"A","prototype":1}]}',
    ) as unknown;
    expect(findInputProblems(body)).toEqual([
      'property __proto__ should not exist',
      'property constructor should not exist',
      'property portfolio.0.prototype should not exist',
    ]);
  });

  it('rejects them with the same message as any other unknown field', () => {
    const body = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    expect(() => pipe.transform(body, as('body'))).toThrow(BadRequestException);
    try {
      pipe.transform(body, as('body'));
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: ['property __proto__ should not exist'],
      });
    }
  });

  it('checks the query too, and leaves clean values and other params alone', () => {
    const query = JSON.parse('{"constructor":"x"}') as unknown;
    expect(() => pipe.transform(query, as('query'))).toThrow(
      BadRequestException,
    );
    const clean = { orderType: 'BUY', portfolio: [{ symbol: 'A' }] };
    expect(pipe.transform(clean, as('body'))).toBe(clean);
    expect(pipe.transform('__proto__', as('param'))).toBe('__proto__');
    expect(pipe.transform(null, as('body'))).toBeNull();
  });

  it('allows normal nesting but rejects input nested too deeply, without crashing', () => {
    const tooDeep = [
      `request must not be nested more than ${MAX_DEPTH} levels deep`,
    ];
    expect(findInputProblems(nested(MAX_DEPTH))).toEqual([]);
    expect(findInputProblems(nested(MAX_DEPTH + 1))).toEqual(tooDeep);
    expect(findInputProblems(nested(100_000))).toEqual(tooDeep);
  });
});

describe('HealthController', () => {
  it('reports that the service is up', () => {
    expect(new HealthController().check()).toMatchObject({ status: 'ok' });
  });
});
