import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';

import { requireUser, type TokenVerifier } from './auth.js';

/** Stands in for Firebase. The real verifier needs Google's public keys. */
function verifierReturning(uid: string | null): TokenVerifier {
  return {
    verify: async () => (uid === null ? null : { uid }),
  };
}

function appWith(verifier: TokenVerifier) {
  const app = new Hono<{ Variables: { uid: string } }>();
  app.use('*', requireUser(verifier));
  app.get('/whoami', (c) => c.json({ uid: c.get('uid') }));
  return app;
}

describe('requireUser', () => {
  test('rejects a request with no Authorization header', async () => {
    const response = await appWith(verifierReturning('user-1')).request('/whoami');

    expect(response.status).toBe(401);
  });

  test('rejects an Authorization header that is not a bearer token', async () => {
    const response = await appWith(verifierReturning('user-1')).request('/whoami', {
      headers: { Authorization: 'Basic abc123' },
    });

    expect(response.status).toBe(401);
  });

  test('rejects a token the verifier does not accept', async () => {
    const response = await appWith(verifierReturning(null)).request('/whoami', {
      headers: { Authorization: 'Bearer expired-or-forged' },
    });

    expect(response.status).toBe(401);
  });

  test('passes the verified uid to the handler', async () => {
    const response = await appWith(verifierReturning('user-1')).request('/whoami', {
      headers: { Authorization: 'Bearer good' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uid: 'user-1' });
  });

  test('ignores a client-supplied identity', async () => {
    // The load-bearing one. Identity comes from the verified token and from
    // nowhere else, however plausibly a caller dresses up a header.
    const response = await appWith(verifierReturning('user-1')).request('/whoami', {
      headers: {
        Authorization: 'Bearer good',
        'X-User-Id': 'user-2',
      },
    });

    expect(await response.json()).toEqual({ uid: 'user-1' });
  });
});
