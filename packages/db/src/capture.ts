import type { Database } from './database.js';

export type CaptureStatus =
  | 'pending'
  | 'extracting'
  | 'needs_review'
  | 'accepted'
  | 'failed';

export interface NewCapture {
  readonly userId: string;
  /** Generated on the client before upload, so retries carry the same one. */
  readonly clientUuid: string;
  readonly photoObject: string;
}

export interface Capture {
  readonly id: string;
  readonly userId: string;
  readonly clientUuid: string;
  readonly photoObject: string;
  readonly status: CaptureStatus;
  readonly createdAt: Date;
}

interface CaptureRow {
  id: string;
  user_id: string;
  client_uuid: string;
  photo_object: string;
  status: CaptureStatus;
  created_at: Date;
}

function toCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    userId: row.user_id,
    clientUuid: row.client_uuid,
    photoObject: row.photo_object,
    status: row.status,
    createdAt: row.created_at,
  };
}

const RETURNED_COLUMNS =
  'id, user_id, client_uuid, photo_object, status, created_at';

/**
 * Register an uploaded photo awaiting extraction.
 *
 * Idempotent on (userId, clientUuid). A client that retries after a dropped
 * connection gets the original capture back rather than a duplicate, which is
 * what stops one bag being logged twice on a flaky connection.
 */
export async function createCapture(
  db: Database,
  input: NewCapture,
): Promise<Capture> {
  const inserted = await db.query<CaptureRow>(
    `insert into capture (user_id, client_uuid, photo_object)
     values ($1, $2, $3)
     on conflict (user_id, client_uuid) do nothing
     returning ${RETURNED_COLUMNS}`,
    [input.userId, input.clientUuid, input.photoObject],
  );

  const insertedRow = inserted.rows[0];
  if (insertedRow !== undefined) {
    return toCapture(insertedRow);
  }

  // Lost the race, or this is a retry. Either way the existing row is the
  // answer. `do nothing` rather than a no-op `do update` keeps this path from
  // writing a new row version just to get RETURNING to fire.
  const existing = await db.query<CaptureRow>(
    `select ${RETURNED_COLUMNS} from capture
     where user_id = $1 and client_uuid = $2`,
    [input.userId, input.clientUuid],
  );

  const existingRow = existing.rows[0];
  if (existingRow === undefined) {
    throw new Error('capture neither inserted nor found');
  }
  return toCapture(existingRow);
}

/**
 * A user's captures, newest first.
 *
 * Scoped by user_id in the query rather than filtered afterwards — the caller
 * never sees another user's rows, so it cannot forget to.
 *
 * Ordered by created_at with id as the tie-break. Since ids are uuidv7 and so
 * time-ordered, that stays correct for captures written in the same
 * millisecond, which the retry path makes entirely possible.
 */
export async function listCaptures(
  db: Database,
  userId: string,
): Promise<Capture[]> {
  const { rows } = await db.query<CaptureRow>(
    `select ${RETURNED_COLUMNS} from capture
     where user_id = $1
     order by created_at desc, id desc`,
    [userId],
  );
  return rows.map(toCapture);
}
