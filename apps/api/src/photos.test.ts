import { generateKeyPairSync } from 'node:crypto';

import { Storage } from '@google-cloud/storage';
import { beforeAll, describe, expect, test } from 'vitest';

import { cloudStoragePhotos, UPLOAD_URL_TTL_SECONDS } from './photos.js';

const BUCKET = 'beanstalk-photos';
const OBJECT = 'photos/user-1/55555555-5555-4555-8555-555555555555';

let storage: Storage;

/**
 * A real keypair, so the signing path actually runs rather than being stubbed
 * into agreement. Cloud Storage signs v4 URLs locally from the service
 * account's private key; on Cloud Run there is no key file and the same library
 * delegates to the IAM signBlob API instead. Only the source of the signature
 * differs, so a local key exercises everything worth testing here.
 */
beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  storage = new Storage({
    projectId: 'beanstalk-505411',
    credentials: {
      client_email: 'test@beanstalk-505411.iam.gserviceaccount.com',
      private_key: privateKey,
    },
  });
});

describe('cloudStoragePhotos', () => {
  test('signs a URL addressing the requested object in the configured bucket', async () => {
    const photos = cloudStoragePhotos({ bucket: BUCKET, storage });

    const url = new URL(await photos.signUpload(OBJECT));

    expect(url.origin).toBe('https://storage.googleapis.com');
    expect(url.pathname).toBe(`/${BUCKET}/${OBJECT}`);
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
    expect(url.searchParams.get('X-Goog-Signature')).toBeTruthy();
  });

  test('binds the content type into the signature', async () => {
    // Listing content-type among the signed headers is what makes the pin real:
    // Cloud Storage recomputes the signature from the header the client
    // actually sends, so a URL signed for a PNG cannot be used to upload
    // anything else. A content type left out of this list would be advisory.
    const photos = cloudStoragePhotos({ bucket: BUCKET, storage });

    const url = new URL(await photos.signUpload(OBJECT, 'image/png'));

    expect(url.searchParams.get('X-Goog-SignedHeaders')).toContain('content-type');
  });

  test('the URL expires', async () => {
    // An upload URL is a bearer credential for writing to the bucket. One that
    // never expired would be a permanent write grant to anyone it leaked to.
    const photos = cloudStoragePhotos({ bucket: BUCKET, storage });

    const url = new URL(await photos.signUpload(OBJECT));

    const expires = Number(url.searchParams.get('X-Goog-Expires'));
    expect(expires).toBe(UPLOAD_URL_TTL_SECONDS);
    expect(expires).toBeLessThanOrEqual(900);
  });
});
