import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';

import { firebaseVerifier } from './firebase.js';

const PROJECT_ID = 'beanstalk-505411';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: JWTVerifyGetKey;

/**
 * A real keypair and a real JWKS, so these exercise genuine signature
 * verification rather than a stub that agrees with us. Firebase's own JWKS is
 * the same shape served over HTTPS; only the fetch is different.
 */
beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  otherKey = other.privateKey;

  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

interface TokenOptions {
  readonly sub?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresIn?: string;
  readonly key?: CryptoKey;
}

async function token(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(options.sub ?? 'firebase-uid-1')
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? PROJECT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(options.key ?? signingKey);
}

describe('firebaseVerifier', () => {
  test('accepts a properly signed token and returns its subject', async () => {
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(await verifier.verify(await token())).toEqual({ uid: 'firebase-uid-1' });
  });

  test('rejects a token signed by a different key', async () => {
    // The whole point of verification. A forged token is the attack.
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(await verifier.verify(await token({ key: otherKey }))).toBeNull();
  });

  test('rejects an expired token', async () => {
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(await verifier.verify(await token({ expiresIn: '-1h' }))).toBeNull();
  });

  test('rejects a token issued for another Firebase project', async () => {
    // Without the audience check, a token from anyone else's Firebase project
    // would authenticate here.
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(await verifier.verify(await token({ audience: 'someone-elses' }))).toBeNull();
  });

  test('rejects a token from an unexpected issuer', async () => {
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(
      await verifier.verify(await token({ issuer: 'https://evil.example/' })),
    ).toBeNull();
  });

  test('rejects a token with no subject', async () => {
    // No subject means no uid, and a uid of undefined would scope every query
    // to the same phantom user.
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(await verifier.verify(await token({ sub: '' }))).toBeNull();
  });

  test('rejects a tampered token', async () => {
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });
    const [header, , signature] = (await token()).split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'someone-else', iss: ISSUER, aud: PROJECT_ID }),
    ).toString('base64url');

    expect(
      await verifier.verify(`${header!}.${forgedPayload}.${signature!}`),
    ).toBeNull();
  });

  test('rejects a token that is not a token at all', async () => {
    const verifier = firebaseVerifier({ projectId: PROJECT_ID, jwks });

    expect(await verifier.verify('not-a-jwt')).toBeNull();
  });
});
