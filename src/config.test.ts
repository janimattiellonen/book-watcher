import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import { loadDbConfig } from './dbConfig.js';
import { ConfigError } from './parseEnv.js';

describe('loadConfig', () => {
  it('uses the spec defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      listenerIntervalHours: 24,
      minGapMinutes: 30,
      gapJitterMinutes: 10,
      maxPagesPerSearch: 10,
      sekToEur: 0.087,
    });
  });

  it('reads values from the environment', () => {
    const config = loadConfig({ LISTENER_INTERVAL_HOURS: '48', MIN_GAP_MINUTES: '45' });
    expect(config.listenerIntervalHours).toBe(48);
    expect(config.minGapMinutes).toBe(45);
  });

  it('rejects a listener interval below 24 hours', () => {
    expect(() => loadConfig({ LISTENER_INTERVAL_HOURS: '12' })).toThrow(ConfigError);
    expect(() => loadConfig({ LISTENER_INTERVAL_HOURS: '12' })).toThrow(/LISTENER_INTERVAL_HOURS/);
  });

  it('reports every invalid variable at once', () => {
    expect(() => loadConfig({ MIN_GAP_MINUTES: 'soon', SEK_TO_EUR: '-1' })).toThrow(
      /MIN_GAP_MINUTES[\s\S]*SEK_TO_EUR/,
    );
  });
});

describe('loadDbConfig', () => {
  it('defaults to the Docker Postgres on port 5499', () => {
    expect(loadDbConfig({})).toEqual({
      host: 'localhost',
      port: 5499,
      user: 'book_watcher',
      password: 'book_watcher',
      database: 'book_watcher',
    });
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadDbConfig({ POSTGRES_PORT: 'abc' })).toThrow(/POSTGRES_PORT/);
  });
});
