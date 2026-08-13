import { serve } from '@hono/node-server';
import { pgDatabase } from '@beanstalk/db';
import pg from 'pg';

import { createApp } from './app.js';
import type { TokenVerifier } from './auth.js';

/**
 * Rejects every token.
 *
 * Placeholder until the Firebase verifier lands. Failing closed is the right
 * default: an unconfigured deployment serves nothing rather than serving
 * everything. Health endpoints stay reachable, which is all the first Cloud
 * Run deployment needs to prove.
 */
const denyAll: TokenVerifier = {
  verify: async () => null,
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

const pool = new pg.Pool({
  connectionString: required('DATABASE_URL'),
  // Cloud Run gives each instance a small CPU allocation and scales out rather
  // than up, so a large per-instance pool wastes Neon's connection budget
  // without buying throughput.
  max: 5,
  idleTimeoutMillis: 30_000,
});

const app = createApp({ db: pgDatabase(pool), verifier: denyAll });

// Cloud Run supplies PORT and expects the container to listen on it.
const port = Number(process.env['PORT'] ?? '8080');

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`listening on ${String(info.port)}`);
});

/**
 * Cloud Run sends SIGTERM before stopping an instance. Draining the pool means
 * in-flight queries finish rather than being severed mid-statement.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
