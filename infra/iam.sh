#!/usr/bin/env bash
#
# Every IAM grant the API service account holds, in one place.
#
# These were applied by hand as each phase needed them, which left the whole
# authorisation model as console state that only the handover notes described.
# The bucket CORS policy is checked in for exactly this reason; its grants
# deserve the same treatment.
#
# Idempotent — safe to re-run. Nothing here is applied automatically: IAM is a
# deliberate step, like migrations.
#
#   ./infra/iam.sh
#
set -euo pipefail

PROJECT=beanstalk-505411
BUCKET=gs://beanstalk-505411-photos
SA=beanstalk-api@${PROJECT}.iam.gserviceaccount.com
READER_ROLE=projects/${PROJECT}/roles/beanstalkPhotoReader

# The service account runs the Cloud Run service. It deliberately holds no
# project-level roles at all — every grant below names one resource.

# --- Signing --------------------------------------------------------------
# On Cloud Run the account has no private key, so the Storage library signs v4
# URLs through the IAM signBlob API. That needs the account to be able to
# impersonate *itself*. Without it every signing attempt fails at request time
# rather than at startup, with an error mentioning neither IAM nor this role.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project="$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role=roles/iam.serviceAccountTokenCreator

# --- Database -------------------------------------------------------------
# The Neon connection string. Read access to one secret, not to Secret Manager.
gcloud secrets add-iam-policy-binding beanstalk-database-url \
  --project="$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role=roles/secretmanager.secretAccessor

# --- Photos: write --------------------------------------------------------
# objectCreator, not objectAdmin: the API issues upload URLs, and a capture is
# immutable once written. Nothing in the design overwrites or deletes a photo,
# so nothing needs permission to.
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member="serviceAccount:${SA}" \
  --role=roles/storage.objectCreator

# --- Photos: read ---------------------------------------------------------
# A custom role rather than roles/storage.objectViewer, which would also grant
# storage.objects.list — the ability to walk every user's photos — plus five
# other permissions nothing uses. Definition in infra/photo-reader-role.yaml.
#
# Needed by the Phase 4 extraction worker, and to sign read URLs for the Phase 5
# review screen: a signed URL is only usable if the account that signed it holds
# the permission at the time of use.
gcloud iam roles describe beanstalkPhotoReader --project="$PROJECT" >/dev/null 2>&1 \
  && gcloud iam roles update beanstalkPhotoReader --project="$PROJECT" \
       --file=infra/photo-reader-role.yaml \
  || gcloud iam roles create beanstalkPhotoReader --project="$PROJECT" \
       --file=infra/photo-reader-role.yaml

gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member="serviceAccount:${SA}" \
  --role="$READER_ROLE"

# --- CORS -----------------------------------------------------------------
# Not IAM, but the other half of making a browser PUT work, and equally easy to
# lose. A signed URL authorises the write; CORS authorises the cross-origin
# request that carries it.
gcloud storage buckets update "$BUCKET" --cors-file=infra/photos-cors.json

echo
echo "Applied. Current bucket policy:"
gcloud storage buckets get-iam-policy "$BUCKET" \
  --flatten="bindings[].members" \
  --format="table(bindings.role, bindings.members)"
