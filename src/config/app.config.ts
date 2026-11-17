import { DateTime, IANAZone } from 'luxon';

// Injection token for the validated application settings.
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  // How many decimal places a share quantity may have (3 today, maybe 7 later).
  quantityDecimals: number;
  // Price used when the partner does not send one. Kept as text to avoid float errors.
  defaultStockPrice: string;
  market: {
    timezone: string;
    open: string;
    close: string;
    // Extra closed days as YYYY-MM-DD, in market time.
    holidays: string[];
  };
  // Cap on orders kept in memory, so the process cannot grow without limit.
  maxStoredOrders: number;
  // Cap on Idempotency-Keys kept in memory. Keys outlive their orders, so a late retry is not run twice.
  maxIdempotencyKeys: number;
}

type Env = Record<string, string | undefined>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Reads settings from env vars, applies defaults, and fails fast with one message listing every problem.
export function loadConfig(rawEnv: Env = process.env): AppConfig {
  const errors: string[] = [];
  // A blank value ("" or spaces) means "not set".
  const env: Env = {};
  for (const [name, value] of Object.entries(rawEnv)) {
    if (value?.trim()) env[name] = value.trim();
  }

  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return value;
  };

  const defaultStockPrice = env.DEFAULT_STOCK_PRICE || '100';
  if (
    !/^\d+(\.\d{1,4})?$/.test(defaultStockPrice) ||
    Number(defaultStockPrice) <= 0
  ) {
    errors.push(
      'DEFAULT_STOCK_PRICE must be a positive number with up to 4 decimals',
    );
  }

  const timezone = env.MARKET_TIMEZONE || 'America/New_York';
  if (!IANAZone.isValidZone(timezone)) {
    errors.push(
      'MARKET_TIMEZONE must be a valid IANA time zone, e.g. America/New_York',
    );
  }

  const open = env.MARKET_OPEN || '09:30';
  const close = env.MARKET_CLOSE || '16:00';
  if (!TIME.test(open) || !TIME.test(close) || open >= close) {
    errors.push(
      'MARKET_OPEN and MARKET_CLOSE must be HH:mm and open must be before close',
    );
  }

  const holidays = (env.MARKET_HOLIDAYS ?? '')
    .split(',')
    .map((day) => day.trim())
    .filter(Boolean);
  if (
    !holidays.every((day) => DateTime.fromISO(day).isValid && DAY.test(day))
  ) {
    errors.push(
      'MARKET_HOLIDAYS must be a comma-separated list of dates like 2026-12-25',
    );
  }

  const config: AppConfig = {
    port: int('PORT', 3000, 1, 65535),
    quantityDecimals: int('QUANTITY_DECIMALS', 3, 0, 8),
    defaultStockPrice,
    market: { timezone, open, close, holidays },
    maxStoredOrders: int('MAX_STORED_ORDERS', 10_000, 1, 1_000_000),
    maxIdempotencyKeys: int('MAX_IDEMPOTENCY_KEYS', 100_000, 1, 10_000_000),
  };

  // A key must never be forgotten while its order is still stored.
  if (config.maxIdempotencyKeys < config.maxStoredOrders) {
    errors.push('MAX_IDEMPOTENCY_KEYS must be at least MAX_STORED_ORDERS');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
  return config;
}
