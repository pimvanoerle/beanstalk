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
  {
    id: '003_coffee_and_bag',
    sql: `
      create table coffee (
        id              uuid primary key default gen_random_uuid(),
        roaster_id      uuid not null references roaster (id),
        name            text not null,
        origin_country  text,
        region          text,
        producer        text,
        varietals       text[],
        process         text,
        altitude_min_m  integer,
        altitude_max_m  integer,
        roast_level     text,
        harvest_year    integer,
        tasting_notes   text[],

        -- Per-field {source, confidence}. A user edit is permanent, so this is
        -- what stops re-enrichment silently reverting a correction.
        provenance      jsonb not null default '{}'::jsonb,
        created_at      timestamptz not null default now(),

        -- Mirrors the invariant normaliseAltitude already enforces. Belt and
        -- braces: anything sorting or filtering on these assumes it holds.
        constraint coffee_altitude_ordered check (
          altitude_min_m is null
          or altitude_max_m is null
          or altitude_min_m <= altitude_max_m
        )
      );

      create index coffee_roaster_id_idx on coffee (roaster_id);

      create table bag (
        id             uuid primary key default gen_random_uuid(),
        user_id        text not null,
        coffee_id      uuid not null references coffee (id),
        size_g         integer,
        price_cents    integer,
        currency       text,
        purchased_on   date,
        purchased_at   text,
        opened_on      date,
        finished_on    date,
        rating         smallint,
        notes          text,
        photo_object   text,
        created_at     timestamptz not null default now(),

        constraint bag_rating_range check (rating is null or rating between 1 and 5)
      );

      -- Every list view is "this user's bags, newest first", and counting
      -- repeat purchases hits (user_id, coffee_id).
      create index bag_user_created_idx on bag (user_id, created_at desc);
      create index bag_user_coffee_idx on bag (user_id, coffee_id);
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
