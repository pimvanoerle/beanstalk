import type { MiddlewareHandler } from 'hono';

export interface VerifiedUser {
  readonly uid: string;
}

/**
 * Turns a bearer token into a user, or null if it cannot be trusted.
 *
 * Injected rather than imported so the middleware's logic is testable without
 * a network round trip to Google's public keys or a Firebase project. The real
 * implementation is a thin adapter; everything worth testing is here.
 */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedUser | null>;
}

const BEARER = /^Bearer (.+)$/;

/**
 * Reject anything without a valid token, and hand the verified uid to the
 * handler.
 *
 * Identity comes from the token and nowhere else. Nothing a caller can set —
 * header, query, body — is ever consulted, because all of it is attacker
 * controlled.
 */
export function requireUser(
  verifier: TokenVerifier,
): MiddlewareHandler<{ Variables: { uid: string } }> {
  return async (c, next) => {
    const match = BEARER.exec(c.req.header('Authorization') ?? '');
    const token = match?.[1];
    if (token === undefined) {
      return c.json({ error: 'unauthorised' }, 401);
    }

    const user = await verifier.verify(token);
    if (user === null) {
      return c.json({ error: 'unauthorised' }, 401);
    }

    c.set('uid', user.uid);
    await next();
    return undefined;
  };
}
