import type { AppConfig } from '../src/config/app.config';
import { loadConfig } from '../src/config/app.config';

/** Default settings for tests, with optional overrides. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig({}), ...overrides };
}
