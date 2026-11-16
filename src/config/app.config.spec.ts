import { loadConfig } from './app.config';

describe('loadConfig', () => {
  it('uses safe defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      quantityDecimals: 3,
      defaultStockPrice: '100',
      market: {
        timezone: 'America/New_York',
        open: '09:30',
        close: '16:00',
        holidays: [],
      },
      apiKey: undefined,
      rateLimit: { ttlMs: 60000, limit: 120 },
      maxStoredOrders: 10000,
    });
  });

  it('reads values from the environment', () => {
    const config = loadConfig({
      PORT: '8080',
      QUANTITY_DECIMALS: '7',
      DEFAULT_STOCK_PRICE: '250.5',
      MARKET_TIMEZONE: 'Europe/London',
      MARKET_OPEN: '08:00',
      MARKET_CLOSE: '16:30',
      API_KEY: 'secret',
      RATE_LIMIT_TTL_MS: '1000',
      RATE_LIMIT_MAX: '5',
      MAX_STORED_ORDERS: '50',
    });

    expect(config.quantityDecimals).toBe(7);
    expect(config.defaultStockPrice).toBe('250.5');
    expect(config.market).toEqual({
      timezone: 'Europe/London',
      open: '08:00',
      close: '16:30',
      holidays: [],
    });
    expect(config.apiKey).toBe('secret');
    expect(config.rateLimit).toEqual({ ttlMs: 1000, limit: 5 });
    expect(config.port).toBe(8080);
    expect(config.maxStoredOrders).toBe(50);
  });

  it('stops the app with one message that lists every bad setting', () => {
    const load = () =>
      loadConfig({
        QUANTITY_DECIMALS: '9',
        DEFAULT_STOCK_PRICE: '-1',
        MARKET_TIMEZONE: 'Mars/Olympus',
        MARKET_OPEN: '17:00',
        PORT: 'abc',
      });

    expect(load).toThrow(/QUANTITY_DECIMALS/);
    expect(load).toThrow(/DEFAULT_STOCK_PRICE/);
    expect(load).toThrow(/MARKET_TIMEZONE/);
    expect(load).toThrow(/MARKET_OPEN/);
    expect(load).toThrow(/PORT/);
  });

  it('treats blank values as not set', () => {
    const config = loadConfig({
      QUANTITY_DECIMALS: '  ',
      API_KEY: ' ',
      PORT: '',
    });
    expect(config.quantityDecimals).toBe(3);
    expect(config.apiKey).toBeUndefined();
    expect(config.port).toBe(3000);
  });

  it('accepts 0 and 8 decimals and rejects values outside that range', () => {
    expect(loadConfig({ QUANTITY_DECIMALS: '0' }).quantityDecimals).toBe(0);
    expect(loadConfig({ QUANTITY_DECIMALS: '8' }).quantityDecimals).toBe(8);
    expect(() => loadConfig({ QUANTITY_DECIMALS: '-1' })).toThrow(
      /QUANTITY_DECIMALS/,
    );
    expect(() => loadConfig({ QUANTITY_DECIMALS: '2.5' })).toThrow(
      /QUANTITY_DECIMALS/,
    );
  });

  it('reads market holidays and rejects dates that do not exist', () => {
    const config = loadConfig({ MARKET_HOLIDAYS: '2026-11-26, 2026-12-25,' });
    expect(config.market.holidays).toEqual(['2026-11-26', '2026-12-25']);
    expect(() => loadConfig({ MARKET_HOLIDAYS: '2026-02-30' })).toThrow(
      /MARKET_HOLIDAYS/,
    );
    expect(() => loadConfig({ MARKET_HOLIDAYS: 'christmas' })).toThrow(
      /MARKET_HOLIDAYS/,
    );
    expect(() => loadConfig({ MARKET_HOLIDAYS: '2026-W01' })).toThrow(
      /MARKET_HOLIDAYS/,
    );
  });

  it('rejects market hours that are the wrong way round or badly formatted', () => {
    expect(() =>
      loadConfig({ MARKET_OPEN: '16:00', MARKET_CLOSE: '09:30' }),
    ).toThrow(/MARKET_OPEN/);
    expect(() => loadConfig({ MARKET_OPEN: '9:30' })).toThrow(/MARKET_OPEN/);
    expect(() => loadConfig({ MARKET_CLOSE: '25:00' })).toThrow(/MARKET_OPEN/);
  });

  it('rejects a default price of zero', () => {
    expect(() => loadConfig({ DEFAULT_STOCK_PRICE: '0' })).toThrow(
      /DEFAULT_STOCK_PRICE/,
    );
  });
});
