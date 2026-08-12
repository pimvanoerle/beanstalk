#!/usr/bin/env node
/**
 * Apply pending migrations. Run as a deploy step, never on application boot:
 * boot-time migration races when several instances start together, and lets an
 * unrelated restart apply a schema change nobody meant to ship.
 *
 *   DATABASE_URL=postgres://... npm run migrate
 *
 * The connection string is read from the environment only. Accepting it as an
 * argument would put a live credential into shell history and CI logs.
 */
import { Client } from 'pg';

import { migrate } from '../migrate.js';
import { pgDatabase } from '../pg.js';

async function main(): Promise<number> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set');
    return 1;
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
  } catch (error) {
    // Deliberately not echoing the connection string, which carries the
    // password. The driver's message is enough to tell host from auth.
    console.error(`could not connect: ${describe(error)}`);
    return 1;
  }

  try {
    const before = await appliedIds(client);
    await migrate(pgDatabase(client));
    const after = await appliedIds(client);

    const fresh = after.filter((id) => !before.includes(id));
    console.log(
      fresh.length === 0
        ? 'already up to date'
        : `applied ${String(fresh.length)}: ${fresh.join(', ')}`,
    );
    return 0;
  } catch (error) {
    console.error(`migration failed: ${describe(error)}`);
    return 1;
  } finally {
    await client.end();
  }
}

async function appliedIds(client: Client): Promise<string[]> {
  try {
    const { rows } = await client.query<{ id: string }>(
      'select id from schema_migration order by id',
    );
    return rows.map((row) => row.id);
  } catch {
    // First run: the tracking table does not exist yet.
    return [];
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
