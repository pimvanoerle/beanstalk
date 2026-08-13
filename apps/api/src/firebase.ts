import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { TokenVerifier } from './auth.js';

/**
 * Where Google publishes the public keys Firebase signs ID tokens with. Keys
 * rotate; createRemoteJWKSet caches them and refetches on an unknown key id.
 */
const GOOGLE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

export interface FirebaseVerifierOptions {
  readonly projectId: string;
  /** Injectable so tests can verify against a local keypair. */
  readonly jwks?: JWTVerifyGetKey;
}

/**
 * Verify Firebase ID tokens.
 *
 * Uses jose rather than firebase-admin: the only thing needed here is checking
 * a signature, issuer and audience, and the admin SDK is a large dependency
 * built for privileged server operations this never performs.
 *
 * Every failure returns null rather than throwing. The caller's question is
 * "is this request authenticated", and a malformed token and an expired one
 * deserve the same answer — 401, with nothing leaked about which.
 */
export function firebaseVerifier({
  projectId,
  jwks = createRemoteJWKSet(GOOGLE_JWKS_URL),
}: FirebaseVerifierOptions): TokenVerifier {
  const issuer = `https://securetoken.google.com/${projectId}`;

  return {
    async verify(token: string) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          // Without this, a token minted by any other Firebase project would
          // be accepted: they are all signed by the same Google keys.
          audience: projectId,
          algorithms: ['RS256'],
        });

        const uid = payload.sub;
        if (typeof uid !== 'string' || uid === '') {
          return null;
        }
        return { uid };
      } catch {
        return null;
      }
    },
  };
}
