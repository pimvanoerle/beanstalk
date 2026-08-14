import { Storage } from '@google-cloud/storage';

/**
 * Issues a short-lived URL that permits a single upload of one object.
 *
 * Injected rather than imported so the routing and — more importantly — the
 * object-naming rules are testable without credentials or a bucket. The real
 * implementation is a thin adapter over Cloud Storage's signer.
 */
export interface PhotoStore {
  signUpload(object: string): Promise<string>;
}

/**
 * Long enough to survive a slow upload on a bad connection abroad, short enough
 * that a leaked URL is not a lasting write grant. The queue retries by asking
 * for a fresh URL, so nothing depends on this being generous.
 */
export const UPLOAD_URL_TTL_SECONDS = 900;

export interface CloudStoragePhotosOptions {
  readonly bucket: string;
  /** Injectable so tests can sign with a local keypair. */
  readonly storage?: Storage;
}

/**
 * Sign uploads against a real Cloud Storage bucket.
 *
 * On Cloud Run the service account has no private key, so the library signs via
 * the IAM signBlob API instead. That needs the account to hold
 * `roles/iam.serviceAccountTokenCreator` on itself — signing is otherwise the
 * one Storage operation that fails with an object-permissions error that does
 * not mention IAM at all.
 */
export function cloudStoragePhotos({
  bucket,
  storage = new Storage(),
}: CloudStoragePhotosOptions): PhotoStore {
  return {
    async signUpload(object: string) {
      const [url] = await storage
        .bucket(bucket)
        .file(object)
        .getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
        });
      return url;
    },
  };
}
