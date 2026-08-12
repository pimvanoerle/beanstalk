import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, test } from 'vitest';

import { createCapture } from './capture.js';
import { migrate } from './migrate.js';

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await migrate(db);
});

describe('createCapture', () => {
  test('records a capture as pending', async () => {
    const capture = await createCapture(db, {
      userId: 'user-1',
      clientUuid: '11111111-1111-4111-8111-111111111111',
      photoObject: 'captures/user-1/abc.jpg',
    });

    expect(capture.status).toBe('pending');
    expect(capture.photoObject).toBe('captures/user-1/abc.jpg');
    expect(capture.id).toEqual(expect.any(String));
  });

  test('a retried upload does not create a second capture', async () => {
    const input = {
      userId: 'user-1',
      clientUuid: '11111111-1111-4111-8111-111111111111',
      photoObject: 'captures/user-1/abc.jpg',
    };

    const first = await createCapture(db, input);
    const second = await createCapture(db, input);

    expect(second.id).toBe(first.id);

    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from capture',
    );
    expect(rows[0]?.n).toBe(1);
  });

  test('the same client uuid from a different user is a different capture', async () => {
    // The constraint is composite. Two users can generate the same uuid —
    // vanishingly unlikely, but scoping to the user costs nothing.
    const clientUuid = '22222222-2222-4222-8222-222222222222';

    const a = await createCapture(db, {
      userId: 'user-1',
      clientUuid,
      photoObject: 'a.jpg',
    });
    const b = await createCapture(db, {
      userId: 'user-2',
      clientUuid,
      photoObject: 'b.jpg',
    });

    expect(b.id).not.toBe(a.id);
  });
});
