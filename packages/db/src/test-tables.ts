/**
 * Reset every application table between tests, leaving the schema in place.
 *
 * Tests boot one PGlite instance per file rather than one per test: booting
 * costs ~1.5s while migrating costs ~35ms, so a fresh instance per test made
 * the suite slow enough to time out under parallel load.
 *
 * Deliberately excludes schema_migration — that records what has been applied
 * to this instance, and clearing it would make migrate() re-run DDL against a
 * schema that already exists.
 */
export const TRUNCATE_ALL = `
  truncate table bag, coffee, roaster, capture restart identity cascade;
`;
