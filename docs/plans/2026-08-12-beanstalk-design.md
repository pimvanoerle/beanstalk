# Beanstalk — Design

**Status:** accepted, not yet implemented
**Date:** 2026-08-12

## Problem

I buy coffee from roasters near me and while travelling, and I lose track of what I've had.
I want to photograph the bag and have its details recorded automatically — roaster, origin,
producer, process, altitude, varietal — then keep a history with notes and a rating.

Existing apps in this space are brew-recipe trackers. This is deliberately not that. The object
being tracked is **the bag**, not the brew. There is no grinder setting, no dose, no ratio, no
timer, and there never will be.

## Non-goals

- Recipe, brew, or extraction tracking of any kind.
- Sharing UI (v1). The data model is built for it; the surface is not built yet.
- Barcode/SKU lookup, export, notifications, offline editing.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Design for public sharing, ship single-user | Splitting the shareable catalogue from private log entries costs little now and avoids a migration later |
| 2 | Capture is instant; enrichment is deferred | Photos get taken in shops and abroad, often with no connectivity |
| 3 | PWA, not native | One codebase reaches Android, iOS, and desktop. Costs iOS background sync — acceptable here |
| 4 | Read the bag, and follow its QR/URL if present | Bounded and high-precision. Open web search risks attaching the wrong farm to the wrong lot |
| 5 | One row = one bag purchased | Repeat purchases become a first-class preference signal |
| 6 | Backend on GCP | Already owned; Vertex AI means no API key exists to leak |
| 7 | Serverless Postgres (Neon), not Cloud SQL | Real relations without Cloud SQL's ~$10/mo floor. Cloud SQL does not scale to zero |
| 8 | Home screen is the shelf, not the inbox | An inbox is a work queue — in steady state it is empty, which is a poor front door |
| 9 | Review is a one-at-a-time card stack | Most captures are correct, so the dominant action is confirmation. Optimise the one-tap path |

## Architecture

| Layer | Choice |
|---|---|
| Client | React + Vite PWA, TypeScript |
| Hosting | Firebase Hosting |
| Auth | Firebase Auth (Google sign-in) |
| API | Cloud Run — Node + Hono, TypeScript |
| Photos | Cloud Storage, direct upload via signed URL |
| Extraction | Vertex AI, `claude-opus-5` |
| Async work | Cloud Tasks |
| Database | Neon Postgres (**pooled** endpoint — Cloud Run scales horizontally) |

### Constraint: no server-side web fetch on Vertex

Claude's server-side `web_fetch` tool is unavailable on Vertex AI. Following a bag's QR/URL is
therefore done by our own backend, and the extracted page text is passed to the model as
ordinary input. This is a better shape regardless: we own the timeout, redirect cap, size limit,
and robots handling.

## Data model

Three shared tables, one private, plus an inbox.

**`roaster`** *(shared)* — name, slug, city, country, website. Globally deduplicated.

**`coffee`** *(shared)* — the lot. `roaster_id`, name, origin country, region, producer/farm,
varietals, process, `altitude_min_m`, `altitude_max_m`, roast level, harvest year, tasting notes.

> Altitude is **always stored in metres**. Bags print masl and feet interchangeably; normalising
> at write time means lists never sort wrong.

**`coffee.provenance`** — JSONB, one entry per field:

```json
{ "altitude_min_m": { "source": "roaster_page", "url": "…", "confidence": 0.92 } }
```

`source` is `bag_photo`, `roaster_page`, or `user`.

> **A `user` edit is permanent and re-enrichment never overwrites it.** Without this rule,
> refreshing a coffee silently reverts your corrections.

**`bag`** *(private)* — `coffee_id`, size, price, purchase location, `purchased_on`,
`opened_on`, `finished_on`, rating, notes, photo. Buying the same coffee twice creates two bags
against one coffee, each with its own rating.

**`capture`** — inbox row: photo, status
(`pending → extracting → needs_review → accepted`, plus `failed`), raw extraction JSON, and a
client-generated UUID.

> `UNIQUE (user_id, client_uuid)` makes a retried upload idempotent.

## Capture pipeline

1. Shutter tap writes the photo to IndexedDB with a client UUID. It appears in the inbox
   immediately. Nothing blocks on connectivity.
2. Downscale to **2576px on the long edge** — Claude's high-resolution ceiling. Bag typography is
   small, stylised, and often foil-embossed, so resolution buys real accuracy here.
   Cost is roughly 2–3¢ per bag.
3. On reconnect the uploader drains the queue: request a signed URL, `PUT` bytes straight to
   Cloud Storage, register the capture. Cloud Run enqueues a Cloud Task and returns.
4. The worker calls Claude on Vertex with **structured outputs**, so the response is
   schema-validated rather than parsed from prose. Every field returns a value plus a status:
   `printed`, `not_printed`, or `illegible`.

   > This three-way distinction is load-bearing. It is what lets the review screen flag a smudged
   > altitude while staying silent about one the roaster never listed.

5. If a QR code or URL is present, the backend fetches that page and a second pass fills gaps,
   tagging each field `roaster_page` with its source URL.
6. Status becomes `needs_review`.

If extraction fails, the photo remains and manual entry always works. **The model is an
accelerator, never a gate.**

## UX

**Shelf** is home: bags reverse-chronologically, filterable by roaster, origin, process, rating.
A review strip appears at the top only while captures are pending. **Roasters** is the second
tab. The camera is a persistent floating button. **Coffee** and **Roaster** detail views sit
one level down.

Review is full-screen, one bag at a time, with the photo pinned and pinch-zoomable — you are
reading the bag to correct the field, so it must stay visible. Uncertain fields are flagged;
fields the bag never printed render as a subtle `+ add` rather than an empty required-looking
input. The primary action is a single **Looks right ✓** that advances to the next card.

## Security

The repository is public, so nothing secret may reach the client bundle.

- Firebase web config is public by design and safe to commit.
- The Neon connection string and service-account material live in Secret Manager, injected into
  Cloud Run at runtime.
- Vertex authenticates via the Cloud Run service account. **No API key exists.**
- Secret scanning runs in CI.
- Every query is scoped by the `uid` from a verified Firebase ID token. The client never supplies
  its own user ID.

### The roaster page is untrusted input

A fetched page containing instruction-shaped text must not be able to steer extraction. Page
content is passed as clearly delimited data, structured outputs constrain the response shape, and
page-sourced values can never overwrite a `user`-sourced field.

## Implementation plan (TDD)

Each phase is one or more vertical slices. Within a slice: **RED → GREEN → REFACTOR**, one
behaviour at a time. Every phase ends green and is committed independently.

Writing the whole suite up front is explicitly *not* the approach — you never observe an
individual test fail for the right reason, and one bug lights up the entire suite at once.

### Phase 0 — Rails

**npm** workspaces, TypeScript, Vitest, ESLint, and a GitHub Actions pipeline running typecheck,
lint, test, and secret scan. Lands with one real passing test so CI is proven from the first
commit — not a tautological assertion, but the first genuine RED-GREEN slice of Phase 1.

> npm rather than pnpm: Node 26 no longer bundles corepack, so pnpm would require a global
> install on every dev machine and an extra CI step. npm workspaces are sufficient at this size.

Workspace directories are created when their phase arrives, rather than sitting empty:
`packages/core` now, `apps/api` at Phase 3, `apps/web` at Phase 5.

Secret scanning is deliberately doubled up: **Gitleaks** in CI scans full history on every PR,
and **GitHub push protection** (enabled on the repo) blocks known credential formats at push
time. They overlap but do not subsume each other.

### Phase 1 — Domain core (`packages/core`, pure, zero I/O)

Highest test value, no infrastructure required:

- Altitude normalisation — `1,600–1,900 masl`, `5,200 ft`, `1800m`, single values vs ranges.
- Provenance merge precedence — a `user` edit survives every subsequent enrichment.
- Extraction schema validation, including the three-state field.
- Coffee identity matching — roaster plus normalised name, for repeat purchases.

### Phase 2 — Persistence

Schema and migrations. Tests run against a **real Postgres** via PGlite — Postgres compiled to
WASM, running in-process. Not a mock, because the behaviour under test is the unique constraint
and the transaction boundary; and no container, daemon or credentials, so CI needs nothing
configured. Proves a retried upload cannot create two bags.

> **Migrations run as a deploy step, never on application boot.** Boot-time migration creates a
> race the moment Cloud Run starts two instances at once, and it means an unrelated restart can
> silently apply a schema change nobody intended to ship yet. A deploy step has exactly one
> runner, needs no advisory lock, and makes schema changes something you decide rather than
> something that happens.

### Phase 3 — API

Auth middleware, signed-URL issuance, capture lifecycle. Integration tests exercise real handlers
with the token verifier faked at the boundary only.

### Phase 4 — Extraction worker

Two tiers, and the split matters:

- **Fast, deterministic** — recorded model responses as fixtures. Runs on every CI run.
- **Slow, live** — real Vertex calls against a golden set of ~20 real bag photos, scored per
  field with a pass threshold. Runs nightly and on demand, never blocking a PR.

> CI must never depend on a non-deterministic model call. The golden set is what catches a prompt
> change quietly degrading accuracy six months from now.

### Phase 5 — PWA

Component tests, offline-queue tests against a fake IndexedDB, and a Playwright run covering
capture → review → shelf.

### Phase 6 — Deploy

Cloud Run and Firebase Hosting from CI.

## Open questions

- Rating granularity — five stars, or half-stars?
- Notes: freeform only, or a few structured fields alongside?
- Roaster deduplication across users once sharing exists (same roaster, different spellings).
- Photo retention and Cloud Storage lifecycle policy.
