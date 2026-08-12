import { PGlite } from '@electric-sql/pglite';
import { describe, expect, test } from 'vitest';

import { migrate } from './migrate.js';

async function tableNames(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`,
  );
  return rows.map((row) => row.table_name);
}

describe('migrate', () => {
  test('creates the roaster table', async () => {
    const db = new PGlite();
    await migrate(db);

    expect(await tableNames(db)).toContain('roaster');
  });

  test('running twice is safe', async () => {
    const db = new PGlite();
    await migrate(db);
    await migrate(db);

    expect(await tableNames(db)).toContain('roaster');
  });

  test('records applied migrations exactly once', async () => {
    const db = new PGlite();
    await migrate(db);
    await migrate(db);

    const { rows } = await db.query<{ id: string }>(
      'select id from schema_migration order by id',
    );
    const ids = rows.map((row) => row.id);

    // Asserting the property, not the inventory: pinning the exact list would
    // mean every new migration breaks this test.
    expect(ids).toContain('001_roaster');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
