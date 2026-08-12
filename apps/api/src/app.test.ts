import { PGlite } from '@electric-sql/pglite';
import { migrate } from '@beanstalk/db';
import { beforeEach, describe, expect, test } from 'vitest';

import { createApp } from './app.js';
import type { TokenVerifier } from './auth.js';

let db: PGlite;

/** Accepts any token, reporting whatever uid the test asked for. */
function asUser(uid: string): TokenVerifier {
  return { verify: async () => ({ uid }) };
}

const AUTH = { Authorization: 'Bearer any' };

beforeEach(async () => {
  db = new PGlite();
  await migrate(db);
});

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/captures', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /captures', () => {
  test('registers a capture for the authenticated user', async () => {
    const app = createApp({ db, verifier: asUser('user-1') });

    const response = await post(app, {
      clientUuid: '11111111-1111-4111-8111-111111111111',
      photoObject: 'captures/abc.jpg',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: 'pending',
      photoObject: 'captures/abc.jpg',
    });
  });

  test('requires authentication', async () => {
    const app = createApp({ db, verifier: asUser('user-1') });

    const response = await app.request('/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUuid: '11111111-1111-4111-8111-111111111111',
        photoObject: 'a.jpg',
      }),
    });

    expect(response.status).toBe(401);
  });

  test('rejects a body without a client uuid', async () => {
    const app = createApp({ db, verifier: asUser('user-1') });

    const response = await post(app, { photoObject: 'a.jpg' });

    expect(response.status).toBe(400);
  });

  test('rejects a client uuid that is not a uuid', async () => {
    // Without this the malformed value reaches Postgres and surfaces as a 500,
    // which reads as our fault rather than the caller's.
    const app = createApp({ db, verifier: asUser('user-1') });

    const response = await post(app, {
      clientUuid: 'not-a-uuid',
      photoObject: 'a.jpg',
    });

    expect(response.status).toBe(400);
  });

  test('a retried upload returns the original capture', async () => {
    const app = createApp({ db, verifier: asUser('user-1') });
    const body = {
      clientUuid: '22222222-2222-4222-8222-222222222222',
      photoObject: 'a.jpg',
    };

    const first = await (await post(app, body)).json();
    const second = await (await post(app, body)).json();

    expect(second).toEqual(first);
  });
});

describe('GET /captures', () => {
  test('returns only the authenticated user\'s captures', async () => {
    // The one that matters. Scoping is enforced server-side from the verified
    // token; there is no request field a caller could set to widen it.
    const mine = createApp({ db, verifier: asUser('user-1') });
    const theirs = createApp({ db, verifier: asUser('user-2') });

    await post(mine, {
      clientUuid: '33333333-3333-4333-8333-333333333333',
      photoObject: 'mine.jpg',
    });
    await post(theirs, {
      clientUuid: '44444444-4444-4444-8444-444444444444',
      photoObject: 'theirs.jpg',
    });

    const response = await mine.request('/captures', { headers: AUTH });
    const body = (await response.json()) as { photoObject: string }[];

    expect(body.map((capture) => capture.photoObject)).toEqual(['mine.jpg']);
  });
});
