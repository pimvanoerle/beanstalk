import type { Database } from './database.js';

export interface NewBag {
  readonly userId: string;
  readonly coffeeId: string;
  readonly rating?: number;
}

export interface Bag {
  readonly id: string;
  readonly userId: string;
  readonly coffeeId: string;
  readonly rating: number | null;
  readonly createdAt: Date;
}

interface BagRow {
  id: string;
  user_id: string;
  coffee_id: string;
  rating: number | null;
  created_at: Date;
}

function toBag(row: BagRow): Bag {
  return {
    id: row.id,
    userId: row.user_id,
    coffeeId: row.coffee_id,
    rating: row.rating,
    createdAt: row.created_at,
  };
}

/** Record a bag the user bought. */
export async function createBag(db: Database, input: NewBag): Promise<Bag> {
  const { rows } = await db.query<BagRow>(
    `insert into bag (user_id, coffee_id, rating)
     values ($1, $2, $3)
     returning id, user_id, coffee_id, rating, created_at`,
    [input.userId, input.coffeeId, input.rating ?? null],
  );

  const row = rows[0];
  if (row === undefined) {
    throw new Error('insert returned no row');
  }
  return toBag(row);
}

/**
 * How many times this user has bought this coffee.
 *
 * Scoped to the user: another person's purchases are not evidence about yours.
 */
export async function countPurchases(
  db: Database,
  userId: string,
  coffeeId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    'select count(*)::int as n from bag where user_id = $1 and coffee_id = $2',
    [userId, coffeeId],
  );
  return rows[0]?.n ?? 0;
}
