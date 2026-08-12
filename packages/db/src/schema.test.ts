import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, test } from 'vitest';

import { migrate } from './migrate.js';

let db: PGlite;
let roasterId: string;

beforeEach(async () => {
  db = new PGlite();
  await migrate(db);

  const { rows } = await db.query<{ id: string }>(
    `insert into roaster (name, slug) values ('Friedhats', 'friedhats') returning id`,
  );
  roasterId = rows[0]!.id;
});

/**
 * Guarantees enforced by the schema rather than by application code. These
 * hold even if a future repository, a migration script or a manual psql
 * session gets it wrong.
 */
describe('schema constraints', () => {
  test('rejects a rating outside one to five', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into coffee (roaster_id, name) values ($1, 'x') returning id`,
      [roasterId],
    );
    const coffeeId = rows[0]!.id;

    await expect(
      db.query('insert into bag (user_id, coffee_id, rating) values ($1, $2, 6)', [
        'user-1',
        coffeeId,
      ]),
    ).rejects.toThrow(/bag_rating_range/);
  });

  test('rejects an altitude range that runs backwards', async () => {
    // Mirrors the invariant normaliseAltitude enforces in core. Anything that
    // sorts or filters on these columns assumes minM <= maxM.
    await expect(
      db.query(
        `insert into coffee (roaster_id, name, altitude_min_m, altitude_max_m)
         values ($1, 'x', 1900, 1600)`,
        [roasterId],
      ),
    ).rejects.toThrow(/coffee_altitude_ordered/);
  });

  test('accepts a half-open altitude range', async () => {
    // Bags often print only a floor. That must not trip the check.
    await expect(
      db.query(
        `insert into coffee (roaster_id, name, altitude_min_m) values ($1, 'x', 1600)`,
        [roasterId],
      ),
    ).resolves.toBeDefined();
  });

  test('rejects a bag pointing at a coffee that does not exist', async () => {
    await expect(
      db.query('insert into bag (user_id, coffee_id) values ($1, $2)', [
        'user-1',
        '00000000-0000-4000-8000-000000000000',
      ]),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  test('rejects two roasters sharing a slug', async () => {
    await expect(
      db.query(`insert into roaster (name, slug) values ('Other', 'friedhats')`),
    ).rejects.toThrow(/roaster_slug_key|unique/i);
  });
});
