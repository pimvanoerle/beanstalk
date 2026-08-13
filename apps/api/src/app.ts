import { createCapture, listCaptures, type Database } from '@beanstalk/db';
import { Hono, type Context } from 'hono';

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

/**
 * The only unauthenticated paths. Everything else is denied by default, so a
 * route added later is protected without anyone remembering to protect it.
 *
 * Liveness is /livez rather than the conventional /healthz because Google's
 * frontend intercepts /healthz on Cloud Run and returns its own 404 — the
 * request never reaches the container. Verified against a deployed revision:
 * /healthz is absent from the request logs while every other path appears.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/livez', '/readyz']);

/** Health checkers are not fussy about trailing slashes; a Set lookup is. */
function normalisePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function createApp({ db, verifier }: AppDependencies) {
  const app = new Hono<{ Variables: { uid: string } }>();

  app.use('*', async (c, next) => {
    if (PUBLIC_PATHS.has(normalisePath(c.req.path))) {
      return next();
    }
    return requireUser(verifier)(c, next);
  });

  // Liveness. Answers "is this process running", nothing more. Deliberately
  // does not query Postgres: a liveness probe that depends on the database
  // turns a database blip into a restart loop.
  app.get('/livez', (c) => c.json({ status: 'ok' }));
  app.get('/livez/', (c) => c.json({ status: 'ok' }));

  // Readiness. Answers "can this instance actually serve traffic", which does
  // require the database.
  const readiness = async (c: Context) => {
    try {
      await db.query('select 1');
      return c.json({ status: 'ok', database: 'ok' });
    } catch {
      // Deliberately no error detail: this endpoint is unauthenticated, and
      // driver messages leak hostnames.
      return c.json({ status: 'degraded', database: 'unreachable' }, 503);
    }
  };
  app.get('/readyz', readiness);
  app.get('/readyz/', readiness);

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
