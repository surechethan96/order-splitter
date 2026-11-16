import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const ORDERS = '/api/v1/orders';
const example = {
  orderType: 'BUY',
  totalAmount: 100,
  portfolio: [
    { symbol: 'AAPL', weight: 60 },
    { symbol: 'TSLA', weight: 40 },
  ],
};

async function startApp(
  env: Record<string, string> = {},
): Promise<NestExpressApplication> {
  Object.assign(process.env, env);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

function clearEnv(...names: string[]): void {
  names.forEach((name) => delete process.env[name]);
}

describe('Order Splitter API (end to end)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());
  const post = (body: string | object) =>
    api().post(ORDERS).set('Content-Type', 'application/json').send(body);

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => app.close());

  describe('creating orders', () => {
    it('splits the example from the brief', async () => {
      const res = await post(example).expect(201);

      expect(res.body).toMatchObject({
        orderType: 'BUY',
        totalAmount: 100,
        currency: 'USD',
        quantityDecimals: 3,
        orders: [
          {
            symbol: 'AAPL',
            amount: 60,
            quantity: 0.6,
            price: 100,
            priceSource: 'DEFAULT',
          },
          {
            symbol: 'TSLA',
            amount: 40,
            quantity: 0.4,
            price: 100,
            priceSource: 'DEFAULT',
          },
        ],
        allocatedAmount: 100,
        unallocatedAmount: 0,
      });
      expect(res.body.execution.executeAt).toEqual(expect.any(String));
      expect(res.headers.location).toBe(`${ORDERS}/${res.body.id}`);
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('lets the partner price win over the fixed price, for SELL too', async () => {
      const res = await post({
        ...example,
        orderType: 'SELL',
        portfolioName: '  Income  ',
        portfolio: [
          { symbol: 'aapl', weight: 50, price: 187.5 },
          { symbol: 'TSLA', weight: 50, price: null },
        ],
      }).expect(201);

      expect(res.body.portfolioName).toBe('Income');
      expect(res.body.orders).toMatchObject([
        {
          symbol: 'AAPL',
          price: 187.5,
          priceSource: 'PARTNER',
          quantity: 0.266,
        },
        { symbol: 'TSLA', price: 100, priceSource: 'DEFAULT', quantity: 0.5 },
      ]);
    });

    it('returns a zero line when one stock is too small to trade but another is not', async () => {
      const res = await post({
        ...example,
        totalAmount: 10,
        portfolio: [
          { symbol: 'AAPL', weight: 99.99 },
          { symbol: 'BRK', weight: 0.01, price: 500000 },
        ],
      }).expect(201);
      expect(res.body.orders[1]).toMatchObject({
        symbol: 'BRK',
        quantity: 0,
        amount: 0,
      });
    });

    it('answers 422 when the amount is too small to trade any share', async () => {
      const res = await post({
        ...example,
        totalAmount: 0.01,
        portfolio: [{ symbol: 'AAPL', weight: 100, price: 5000 }],
      }).expect(422);
      expect(res.body.message).toMatch(/too small/);
    });
  });

  describe('bad input never causes a 500', () => {
    it('explains every validation problem in one consistent error shape', async () => {
      const res = await api()
        .post(ORDERS)
        .set('X-Request-Id', 'trace-123')
        .send({
          orderType: 'HOLD',
          totalAmount: -1,
          portfolio: [{ symbol: 'AAPL', weight: 50 }],
          hack: true,
        })
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        path: ORDERS,
        requestId: 'trace-123',
      });
      expect(res.body.details).toEqual([
        'property hack should not exist',
        'orderType must be one of the following values: BUY, SELL',
        'totalAmount must not be less than 0.01',
        'portfolio weights must add up to exactly 100',
      ]);
    });

    it.each([
      ['numbers written like 1e-7 (amount)', { ...example, totalAmount: 1e-7 }],
      [
        'numbers written like 1e-7 (price)',
        { ...example, portfolio: [{ symbol: 'A', weight: 100, price: 1e-7 }] },
      ],
      [
        'numbers written like 1e-7 (weight)',
        {
          ...example,
          portfolio: [
            { symbol: 'A', weight: 1e-7 },
            { symbol: 'B', weight: 99.9999999 },
          ],
        },
      ],
      [
        'a list inside the portfolio list',
        { ...example, portfolio: [[{ symbol: 'A', weight: 100 }]] },
      ],
      ['a null item in the portfolio', { ...example, portfolio: [null] }],
      ['a text item in the portfolio', { ...example, portfolio: ['AAPL'] }],
      ['a body that is a list', []],
      ['a body that is a list of objects', [example]],
      ['an empty object', {}],
      [
        'unknown fields inside a holding',
        { ...example, portfolio: [{ symbol: 'A', weight: 100, shares: 5 }] },
      ],
    ])('rejects %s with 400', async (_name, body) => {
      const res = await post(body).expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it.each([
      ['broken JSON', '{oops'],
      ['JSON that is only null', 'null'],
      ['JSON that is only text', '"hello"'],
      ['JSON that is only a number', '123'],
    ])('rejects %s with 400', async (_name, raw) => {
      await post(raw).expect(400);
    });

    it('rejects an empty body and a non-JSON content type with 400', async () => {
      await api().post(ORDERS).expect(400);
      await api()
        .post(ORDERS)
        .set('Content-Type', 'text/plain')
        .send(JSON.stringify(example))
        .expect(400);
    });

    it('answers 413 when the body is larger than 100 KB', async () => {
      const res = await post({
        ...example,
        portfolioName: 'x'.repeat(200_000),
      }).expect(413);
      expect(res.body).toMatchObject({
        statusCode: 413,
        error: 'Payload Too Large',
      });
    });

    it('ignores __proto__ and constructor keys without polluting objects', async () => {
      const raw =
        '{"orderType":"BUY","totalAmount":100,"__proto__":{"polluted":true},' +
        '"constructor":{"prototype":{"polluted":true}},' +
        '"portfolio":[{"symbol":"AAPL","weight":100}]}';
      const res = await post(raw);

      expect([201, 400]).toContain(res.status);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('polluted');
    });

    it('rejects bad query values and unknown query fields with 400', async () => {
      await api().get(`${ORDERS}?limit=1000`).expect(400);
      await api().get(`${ORDERS}?limit=0`).expect(400);
      await api().get(`${ORDERS}?limit=abc`).expect(400);
      await api().get(`${ORDERS}?limit=1&limit=2`).expect(400);
      await api().get(`${ORDERS}?offset=-1`).expect(400);
      await api().get(`${ORDERS}?offset=1.5`).expect(400);
      await api().get(`${ORDERS}?offset=1e30`).expect(400);
      await api().get(`${ORDERS}?orderType=buy`).expect(400);
      await api().get(`${ORDERS}?foo=1`).expect(400);
    });

    it('answers 404 for routes and methods that do not exist', async () => {
      await api().get('/api/v2/orders').expect(404);
      await api()
        .delete(`${ORDERS}/7c0a4d6e-1f8b-4a55-9d2e-0b1c2d3e4f5a`)
        .expect(404);
      const res = await api().put(ORDERS).send(example).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });
  });

  describe('history', () => {
    it('lists orders newest first, with paging and a filter', async () => {
      const all = await api().get(ORDERS).expect(200);
      const total: number = all.body.meta.total;
      expect(total).toBeGreaterThanOrEqual(3);
      expect(all.body.meta).toEqual({ total, limit: 20, offset: 0 });
      const created = all.body.data.map(
        (o: { createdAt: string }) => o.createdAt,
      );
      expect(created).toEqual([...created].sort().reverse());

      const sells = await api().get(`${ORDERS}?orderType=SELL`).expect(200);
      expect(
        sells.body.data.every(
          (o: { orderType: string }) => o.orderType === 'SELL',
        ),
      ).toBe(true);
      expect(sells.body.meta.total).toBe(1);

      const page = await api().get(`${ORDERS}?limit=1&offset=1`).expect(200);
      expect(page.body.data).toEqual([all.body.data[1]]);

      const beyond = await api().get(`${ORDERS}?offset=${total}`).expect(200);
      expect(beyond.body).toEqual({
        data: [],
        meta: { total, limit: 20, offset: total },
      });
    });

    it('returns one order by id (any letter case), 404 if unknown, 400 if not a UUID', async () => {
      const created = await post(example);
      const id: string = created.body.id;

      expect((await api().get(`${ORDERS}/${id}`).expect(200)).body).toEqual(
        created.body,
      );
      expect(
        (await api().get(`${ORDERS}/${id.toUpperCase()}`).expect(200)).body.id,
      ).toBe(id);
      await api()
        .get(`${ORDERS}/7c0a4d6e-1f8b-4a55-9d2e-0b1c2d3e4f5a`)
        .expect(404);
      await api().get(`${ORDERS}/not-a-uuid`).expect(400);
    });

    it('does not store rejected requests', async () => {
      const before = (await api().get(ORDERS)).body.meta.total;
      await post({ ...example, totalAmount: -1 }).expect(400);
      await post({
        ...example,
        totalAmount: 0.01,
        portfolio: [{ symbol: 'A', weight: 100, price: 5000 }],
      }).expect(422);
      expect((await api().get(ORDERS)).body.meta.total).toBe(before);
    });
  });

  describe('idempotency', () => {
    const withKey = (key: string, body: object = example) =>
      api().post(ORDERS).set('Idempotency-Key', key).send(body);

    it('does not create a second order when the same key is retried', async () => {
      const before = (await api().get(ORDERS)).body.meta.total;
      const first = await withKey('retry-1').expect(201);
      const retry = await withKey('retry-1').expect(201);

      expect(retry.body).toEqual(first.body);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect((await api().get(ORDERS)).body.meta.total).toBe(before + 1);
    });

    it('answers 409 when the key is reused with a different body', async () => {
      const res = await withKey('retry-1', {
        ...example,
        totalAmount: 500,
      }).expect(409);
      expect(res.body.message).toMatch(/different request body/);
    });

    it('treats lower-case symbols as the same request', async () => {
      const lower = {
        ...example,
        portfolio: [
          { symbol: 'aapl', weight: 60 },
          { symbol: 'tsla', weight: 40 },
        ],
      };
      const res = await withKey('retry-1', lower).expect(201);
      expect(res.headers['idempotent-replayed']).toBe('true');
    });

    it('creates only one order when the same key arrives several times at once', async () => {
      const before = (await api().get(ORDERS)).body.meta.total;
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => withKey('parallel-1')),
      );

      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect((await api().get(ORDERS)).body.meta.total).toBe(before + 1);
    });

    it('does not remember a key whose request failed validation', async () => {
      await withKey('retry-2', { ...example, totalAmount: -1 }).expect(400);
      const res = await withKey('retry-2').expect(201);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    });

    it('rejects a key that is too long or has spaces', async () => {
      await withKey('x'.repeat(129)).expect(400);
      await withKey('has space').expect(400);
    });
  });

  describe('other endpoints', () => {
    it('serves the health check, the Swagger document and the console page', async () => {
      const health = await api().get('/health').expect(200);
      expect(health.body.status).toBe('ok');

      const docs = await api().get('/docs-json').expect(200);
      expect(Object.keys(docs.body.paths)).toEqual(
        expect.arrayContaining([ORDERS, `${ORDERS}/{id}`, '/health']),
      );

      const page = await api().get('/').expect(200);
      expect(page.text).toContain('Order Splitter');
    });

    it('sends security headers and echoes a safe request id', async () => {
      const res = await api().get('/health').set('X-Request-Id', 'abc-123');
      expect(res.headers['x-request-id']).toBe('abc-123');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('replaces an unsafe request id', async () => {
      const res = await api()
        .get('/health')
        .set('X-Request-Id', 'bad id <script>');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});

describe('Order Splitter API with other settings', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());
  const post = (body: object) =>
    api().post(ORDERS).set('x-api-key', 'test-key').send(body);
  const settings = {
    API_KEY: 'test-key',
    RATE_LIMIT_MAX: '8',
    QUANTITY_DECIMALS: '7',
    DEFAULT_STOCK_PRICE: '250',
    MAX_STORED_ORDERS: '2',
  };

  beforeAll(async () => {
    app = await startApp(settings);
  });
  afterAll(async () => {
    clearEnv(...Object.keys(settings));
    await app.close();
  });

  it('needs the API key when one is configured, except for the health check', async () => {
    await api().post(ORDERS).send(example).expect(401);
    await api()
      .post(ORDERS)
      .set('x-api-key', 'wrong')
      .send(example)
      .expect(401);
    await api().get('/health').expect(200);
  });

  it('uses the configured quantity decimals and default price', async () => {
    const res = await post({
      ...example,
      portfolio: [
        { symbol: 'AAPL', weight: 50, price: 3 },
        { symbol: 'TSLA', weight: 50 },
      ],
    }).expect(201);
    expect(res.body.quantityDecimals).toBe(7);
    expect(res.body.orders).toMatchObject([
      { quantity: 16.6666666, priceSource: 'PARTNER' },
      { quantity: 0.2, price: 250, priceSource: 'DEFAULT' },
    ]);
  });

  it('answers 422 for a quantity that cannot be returned exactly', async () => {
    const res = await post({
      ...example,
      totalAmount: 9999999.99,
      portfolio: [{ symbol: 'PENNY', weight: 100, price: 0.07 }],
    }).expect(422);
    expect(res.body.message).toMatch(/PENNY/);
  });

  it('keeps only the newest orders once the memory limit is reached', async () => {
    const first = await post(example).expect(201);
    await post(example).expect(201);
    await post(example).expect(201);

    const list = await api()
      .get(ORDERS)
      .set('x-api-key', 'test-key')
      .expect(200);
    expect(list.body.meta.total).toBe(2);
    await api()
      .get(`${ORDERS}/${first.body.id}`)
      .set('x-api-key', 'test-key')
      .expect(404);
  });

  it('limits how many requests one client can send, but never the health check', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push(
        (await api().get(ORDERS).set('x-api-key', 'test-key')).status,
      );
    }
    expect(statuses).toContain(429);
    await api().get('/health').expect(200);
  });
});

describe('Order Splitter API on a market holiday', () => {
  let app: NestExpressApplication;

  // Wednesday 11 November 2026, 10:00 in New York: a normal trading time.
  const now = new Date('2026-11-11T15:00:00Z');

  afterEach(async () => {
    jest.useRealTimers();
    clearEnv('MARKET_HOLIDAYS');
    await app.close();
  });

  async function executionFor(holidays: string) {
    app = await startApp({ MARKET_HOLIDAYS: holidays });
    jest
      .useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'],
      })
      .setSystemTime(now);
    const res = await request(app.getHttpServer())
      .post(ORDERS)
      .send(example)
      .expect(201);
    return res.body.execution;
  }

  it('executes now on a normal day', async () => {
    expect(await executionFor('')).toMatchObject({
      marketOpenNow: true,
      executeAt: '2026-11-11T15:00:00.000Z',
    });
  });

  it('waits for the next trading day when today is a holiday', async () => {
    expect(await executionFor('2026-11-11')).toMatchObject({
      marketOpenNow: false,
      executeAt: '2026-11-12T14:30:00.000Z',
    });
  });
});

describe('Order Splitter API start-up', () => {
  afterEach(() => clearEnv('QUANTITY_DECIMALS'));

  it('refuses to start with a wrong setting', async () => {
    await expect(startApp({ QUANTITY_DECIMALS: '99' })).rejects.toThrow(
      /QUANTITY_DECIMALS/,
    );
  });
});
