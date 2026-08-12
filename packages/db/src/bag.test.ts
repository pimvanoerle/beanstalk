import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, test } from 'vitest';

import { countPurchases, createBag } from './bag.js';
import { migrate } from './migrate.js';

let db: PGlite;
let coffeeId: string;

beforeEach(async () => {
  db = new PGlite();
  await migrate(db);

  const { rows } = await db.query<{ id: string }>(
    `with r as (
       insert into roaster (name, slug) values ('Friedhats', 'friedhats') returning id
     )
     insert into coffee (roaster_id, name) select id, 'Ethiopia Guji' from r
     returning id`,
  );
  coffeeId = rows[0]!.id;
});

describe('createBag', () => {
  test('records a bag against a coffee', async () => {
    const bag = await createBag(db, {
      userId: 'user-1',
      coffeeId,
      rating: 4,
    });

    expect(bag.coffeeId).toBe(coffeeId);
    expect(bag.rating).toBe(4);
  });
});

describe('countPurchases', () => {
  test('counts every bag of the same coffee', async () => {
    // The signal the whole three-level model exists for: buying a coffee
    // again is itself evidence you liked it.
    await createBag(db, { userId: 'user-1', coffeeId });
    await createBag(db, { userId: 'user-1', coffeeId });
    await createBag(db, { userId: 'user-1', coffeeId });

    expect(await countPurchases(db, 'user-1', coffeeId)).toBe(3);
  });

  test('does not count another user\'s bags', async () => {
    await createBag(db, { userId: 'user-1', coffeeId });
    await createBag(db, { userId: 'user-2', coffeeId });

    expect(await countPurchases(db, 'user-1', coffeeId)).toBe(1);
  });
});
