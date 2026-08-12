import type { ClientBase } from 'pg';

import type { Database } from './database.js';

/**
 * Adapt a node-postgres client to the `Database` interface.
 *
 * Pure delegation — deliberately so. Every behaviour worth testing lives in
 * the migrations and repositories, which run against real Postgres via PGlite.
 * A mock-based test of this function would only assert that it calls the thing
 * it obviously calls.
 */
export function pgDatabase(client: ClientBase): Database {
  return {
    async query<Row>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as Row[] };
    },
    async exec(sql: string) {
      return client.query(sql);
    },
  };
}
