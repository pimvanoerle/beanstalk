import { createCapture, listCaptures, type Database } from '@beanstalk/db';
import { Hono } from 'hono';

import { requireUser, type TokenVerifier } from './auth.js';

export interface AppDependencies {
  readonly db: Database;
  readonly verifier: TokenVerifier;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CaptureRequest {
  readonly clientUuid: string;
  readonly photoObject: string;
}

/**
 * Validate the request body before it reaches Postgres.
 *
 * A malformed uuid would otherwise surface as a driver error and a 500, which
 * reports the caller's mistake as ours.
 */
function parseCaptureRequest(body: unknown): CaptureRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { clientUuid, photoObject } = body as Record<string, unknown>;
  if (typeof clientUuid !== 'string' || !UUID_PATTERN.test(clientUuid)) {
    return null;
  }
  if (typeof photoObject !== 'string' || photoObject === '') {
    return null;
  }

  return { clientUuid, photoObject };
}

export function createApp({ db, verifier }: AppDependencies) {
  const app = new Hono<{ Variables: { uid: string } }>();

  // Applied to everything. A route that forgets to authenticate is a much
  // worse failure than one that cannot be reached.
  app.use('*', requireUser(verifier));

  app.post('/captures', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const request = parseCaptureRequest(body);
    if (request === null) {
      return c.json({ error: 'clientUuid (uuid) and photoObject are required' }, 400);
    }

    const capture = await createCapture(db, {
      // From the verified token, never from the request.
      userId: c.get('uid'),
      clientUuid: request.clientUuid,
      photoObject: request.photoObject,
    });

    return c.json(capture, 201);
  });

  app.get('/captures', async (c) => {
    return c.json(await listCaptures(db, c.get('uid')));
  });

  return app;
}
