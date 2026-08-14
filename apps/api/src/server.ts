import { serve } from '@hono/node-server';
import { pgDatabase } from '@beanstalk/db';
import pg from 'pg';

import { createApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import { firebaseVerifier } from './firebase.js';
import { cloudStoragePhotos, type PhotoStore } from './photos.js';

/** Rejects every token. Used only when Firebase is not configured. */
const denyAll: TokenVerifier = {
  verify: async () => null,
};

/** Signs nothing. Used only when the photo bucket is not configured. */
const noBucket: PhotoStore = {
  signUpload: () => Promise.reject(new Error('PHOTO_BUCKET is not set')),
};

/**
 * Fail closed when unconfigured.
 *
 * A deployment without FIREBASE_PROJECT_ID serves health checks and rejects
 * everything else, rather than either refusing to start or — far worse —
 * accepting anything. Loud on startup, because a permanently-401 API is
 * otherwise a baffling thing to debug.
 */
function buildVerifier(): TokenVerifier {
  const projectId = process.env['FIREBASE_PROJECT_ID'];
  if (projectId === undefined || projectId === '') {
    console.warn(
      'FIREBASE_PROJECT_ID is not set: authenticating nothing, all authenticated routes will return 401',
    );
    return denyAll;
  }
  return firebaseVerifier({ projectId });
}

/**
 * Same bargain as the verifier: an unconfigured deployment serves everything
 * else and answers /uploads with a 503, rather than refusing to start.
 */
function buildPhotos(): PhotoStore {
  const bucket = process.env['PHOTO_BUCKET'];
  if (bucket === undefined || bucket === '') {
    console.warn('PHOTO_BUCKET is not set: /uploads will return 503');
    return noBucket;
  }
  return cloudStoragePhotos({ bucket });
}

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

const app = createApp({
  db: pgDatabase(pool),
  verifier: buildVerifier(),
  photos: buildPhotos(),
});

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
