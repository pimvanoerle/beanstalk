import { PGlite } from '@electric-sql/pglite';
import { migrate, TRUNCATE_ALL } from '@beanstalk/db';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import type { PhotoStore } from './photos.js';

let db: PGlite;

/** Accepts any token, reporting whatever uid the test asked for. */
function asUser(uid: string): TokenVerifier {
  return { verify: async () => ({ uid }) };
}

const AUTH = { Authorization: 'Bearer any' };

/**
 * Signs by concatenation, so a test can assert on the object name the app
 * derived. The real signer is Cloud Storage's, and there is nothing in it worth
 * reimplementing here — what matters is which object we ask it to sign.
 */
const photos: PhotoStore = {
  signUpload: async (object) => `https://signed.example/${object}`,
};

beforeAll(async () => {
  db = new PGlite();
  await migrate(db);
});

beforeEach(async () => {
  await db.exec(TRUNCATE_ALL);
});

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/captures', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('health endpoints', () => {
  test('liveness needs no token and does not touch the database', async () => {
    // Deliberately no query: a liveness probe that depends on Postgres will
    // report the process dead during a database blip and get it restarted,
    // which helps nothing.
    const exploding = {
      query: () => {
        throw new Error('database must not be touched');
      },
      exec: () => {
        throw new Error('database must not be touched');
      },
    };
    const app = createApp({ db: exploding, verifier: asUser('user-1') });

    expect((await app.request('/livez')).status).toBe(200);
  });

  test('readiness needs no token and reports the database reachable', async () => {
    const app = createApp({ db, verifier: asUser('user-1') });

    const response = await app.request('/readyz');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ database: 'ok' });
  });

  test('readiness fails when the database is unreachable', async () => {
    const broken = {
      query: async () => {
        throw new Error('ECONNREFUSED');
      },
      exec: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const app = createApp({ db: broken, verifier: asUser('user-1') });

    expect((await app.request('/readyz')).status).toBe(503);
  });

  test('a trailing slash does not turn a public path into a 401', async () => {
    // Health checkers are not fussy about trailing slashes; an exact-string
    // allow-list is. Found by probing the deployed service.
    const app = createApp({ db, verifier: asUser('user-1') });

    expect((await app.request('/livez/')).status).toBe(200);
    expect((await app.request('/readyz/')).status).toBe(200);
  });

  test('every other route still requires a token', async () => {
    // The allow-list is exactly the two health paths. Anything else, including
    // a route nobody has written yet, is denied by default.
    const app = createApp({ db, verifier: asUser('user-1'), photos });

    expect((await app.request('/captures')).status).toBe(401);
    expect((await app.request('/uploads', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/livez/../captures')).status).not.toBe(200);
  });
});

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

describe('POST /uploads', () => {
  test('issues a signed URL for an object owned by the authenticated user', async () => {
    const app = createApp({ db, verifier: asUser('user-1'), photos });

    const response = await app.request('/uploads', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUuid: '55555555-5555-4555-8555-555555555555',
        contentType: 'image/jpeg',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: 'photos/user-1/55555555-5555-4555-8555-555555555555',
      url: 'https://signed.example/photos/user-1/55555555-5555-4555-8555-555555555555',
      contentType: 'image/jpeg',
    });
  });

  test('will not sign an object outside the caller\'s own prefix', async () => {
    // The whole point of deriving the path server-side. A client uuid
    // interpolated unchecked lets a caller climb out of their prefix and get a
    // write URL for someone else's photo.
    const signed: string[] = [];
    const app = createApp({
      db,
      verifier: asUser('user-1'),
      photos: {
        signUpload: async (object) => {
          signed.push(object);
          return 'https://signed.example/anything';
        },
      },
    });

    const response = await app.request('/uploads', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      // Content type is valid, so the 400 below can only be the uuid.
      body: JSON.stringify({
        clientUuid: '../user-2/stolen',
        contentType: 'image/jpeg',
      }),
    });

    expect(response.status).toBe(400);
    expect(signed).toEqual([]);
  });

  test('signs for the declared content type and tells the client which it used', async () => {
    // The signature covers this exact string, so a client that guesses gets a
    // signature mismatch rather than a helpful error. Echoing it back removes
    // the guess.
    const signed: { object: string; contentType: string }[] = [];
    const app = createApp({
      db,
      verifier: asUser('user-1'),
      photos: {
        signUpload: async (object, contentType) => {
          signed.push({ object, contentType });
          return 'https://signed.example/pinned';
        },
      },
    });

    const response = await app.request('/uploads', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUuid: '55555555-5555-4555-8555-555555555555',
        contentType: 'image/webp',
      }),
    });

    expect(response.status).toBe(200);
    expect(signed).toEqual([
      {
        object: 'photos/user-1/55555555-5555-4555-8555-555555555555',
        contentType: 'image/webp',
      },
    ]);
    expect(await response.json()).toMatchObject({ contentType: 'image/webp' });
  });

  test('will not sign a content type outside the allowlist', async () => {
    // A signed URL authorises a write of whatever the holder sends. Without a
    // pinned content type the upload path doubles as general-purpose storage
    // for anything at all.
    const signed: string[] = [];
    const app = createApp({
      db,
      verifier: asUser('user-1'),
      photos: {
        signUpload: async (object) => {
          signed.push(object);
          return 'https://signed.example/anything';
        },
      },
    });

    const response = await app.request('/uploads', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUuid: '55555555-5555-4555-8555-555555555555',
        contentType: 'application/zip',
      }),
    });

    expect(response.status).toBe(400);
    expect(signed).toEqual([]);
  });

  test('will not sign without a declared content type', async () => {
    // There is deliberately no default. Defaulting to image/jpeg would sign a
    // jpeg-only URL for a client that never said what it was sending, and the
    // mismatch would surface as an opaque signature failure at PUT time rather
    // than as this 400.
    const signed: string[] = [];
    const app = createApp({
      db,
      verifier: asUser('user-1'),
      photos: {
        signUpload: async (object) => {
          signed.push(object);
          return 'https://signed.example/anything';
        },
      },
    });

    const response = await app.request('/uploads', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUuid: '55555555-5555-4555-8555-555555555555',
      }),
    });

    expect(response.status).toBe(400);
    expect(signed).toEqual([]);
  });

  test('reports 503 when signing is unavailable', async () => {
    // Signing is the one Storage call that fails when the service account
    // cannot call IAM signBlob, and it fails at request time rather than at
    // startup. A 500 would blame the caller's request for our configuration.
    const app = createApp({
      db,
      verifier: asUser('user-1'),
      photos: {
        signUpload: async () => {
          throw new Error('Permission iam.serviceAccounts.signBlob denied');
        },
      },
    });

    const response = await app.request('/uploads', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUuid: '55555555-5555-4555-8555-555555555555',
        contentType: 'image/jpeg',
      }),
    });

    expect(response.status).toBe(503);
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
