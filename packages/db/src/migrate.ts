import type { Database } from './database.js';

/**
 * Schema migrations, applied in array order.
 *
 * Embedded as strings rather than .sql files so there is no filesystem or
 * bundling story to get wrong, and so the ordering is explicit rather than
 * an artefact of how filenames happen to sort.
 */
const MIGRATIONS: readonly { readonly id: string; readonly sql: string }[] = [
  {
    id: '001_roaster',
    sql: `
      create table roaster (
        id         uuid primary key default gen_random_uuid(),
        name       text not null,
        slug       text not null unique,
        city       text,
        country    text,
        website    text,
        created_at timestamptz not null default now()
      );
    `,
  },
  {
    id: '002_capture',
    sql: `
      create type capture_status as enum (
        'pending', 'extracting', 'needs_review', 'accepted', 'failed'
      );

      create table capture (
        id           uuid primary key default gen_random_uuid(),
        user_id      text not null,
        client_uuid  uuid not null,
        photo_object text not null,
        status       capture_status not null default 'pending',
        extraction   jsonb,
        error        text,
        created_at   timestamptz not null default now(),

        -- The client generates client_uuid before the upload is attempted, so
        -- a retry after a dropped connection carries the same one. This is
        -- what makes re-uploading idempotent rather than duplicating the bag.
        constraint capture_user_client_uuid_key unique (user_id, client_uuid)
      );
    `,
  },
];

/** Bring the database up to the latest schema. Safe to run repeatedly. */
export async function migrate(db: Database): Promise<void> {
  await db.exec(`
    create table if not exists schema_migration (
      id         text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await db.query<{ id: string }>('select id from schema_migration');
  const applied = new Set(rows.map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }
    await db.exec(migration.sql);
    await db.query('insert into schema_migration (id) values ($1)', [migration.id]);
  }
}
