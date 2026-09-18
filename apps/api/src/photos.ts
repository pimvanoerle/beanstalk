import { Storage } from '@google-cloud/storage';

/**
 * Issues a short-lived URL that permits a single upload of one object, as one
 * exact content type.
 *
 * Injected rather than imported so the routing and — more importantly — the
 * object-naming rules are testable without credentials or a bucket. The real
 * implementation is a thin adapter over Cloud Storage's signer.
 */
export interface PhotoStore {
  signUpload(object: string, contentType: string): Promise<string>;
}

/**
 * Long enough to survive a slow upload on a bad connection abroad, short enough
 * that a leaked URL is not a lasting write grant. The queue retries by asking
 * for a fresh URL, so nothing depends on this being generous.
 */
export const UPLOAD_URL_TTL_SECONDS = 900;

/**
 * The content types an upload URL may be signed for.
 *
 * A v4 signature covers one exact `Content-Type` string, so there is no way to
 * sign for `image/*` — "images only" has to be an allowlist checked here, with
 * each URL then pinned to the single type the client declared.
 *
 * These three are the intersection of what a browser canvas can emit from the
 * downscale step and what the extraction model accepts as input. Formats a
 * phone might produce natively but the canvas never outputs — HEIC above all —
 * are deliberately absent: they cannot reach the uploader.
 */
export const UPLOAD_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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
    async signUpload(object: string, contentType: string) {
      const [url] = await storage
        .bucket(bucket)
        .file(object)
        .getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
          // Adds content-type to the signed headers, so the client must send
          // exactly this value and Cloud Storage rejects anything else.
          contentType,
        });
      return url;
    },
  };
}
