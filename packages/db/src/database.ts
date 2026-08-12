/**
 * The slice of a Postgres client this package needs.
 *
 * Structural, so PGlite satisfies it directly in tests. A thin adapter over
 * node-postgres will satisfy it in production — see Phase 3. Keeping the
 * surface this small is what lets the same schema and repository code run
 * against both without a compatibility layer.
 */
export interface Database {
  /** Parameterised, single-statement. */
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  /** Multi-statement, no parameters. Used for DDL. */
  exec(sql: string): Promise<unknown>;
}
