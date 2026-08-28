---
phase: 164-share-copy-link-always-works-and-never-discloses
reviewed: 2026-08-28T00:00:00Z
depth: standard
files_reviewed: 58
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - analytics-service/services/audit.py
  - next.config.ts
  - scripts/check-gdpr-export-coverage.ts
  - src/__tests__/audit-coverage.test.ts
  - src/__tests__/gdpr-export-coverage-hook.test.ts
  - src/__tests__/phase-147-series-resolution-guards.test.ts
  - src/__tests__/phase-148-owner-lane-cache-isolation.test.ts
  - src/__tests__/phase-164-share-lane-headers.test.ts
  - src/__tests__/phase-29-frozen-spine-guards.test.ts
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
  - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/page.wizard-draft-banner.test.tsx
  - src/app/api/strategies/[id]/share/revoke/route.test.ts
  - src/app/api/strategies/[id]/share/revoke/route.ts
  - src/app/api/strategies/[id]/share/route.test.ts
  - src/app/api/strategies/[id]/share/route.ts
  - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
  - src/app/factsheet-share/[token]/page.no-cache-reach.test.ts
  - src/app/factsheet-share/[token]/page.test.tsx
  - src/app/factsheet-share/[token]/page.tsx
  - src/app/factsheet-share/gone/route.test.ts
  - src/app/factsheet-share/gone/route.ts
  - src/app/factsheet/[id]/v2/factsheet-analytics.test.ts
  - src/app/factsheet/[id]/v2/factsheet-analytics.ts
  - src/app/factsheet/[id]/v2/FactsheetView.recipient-share.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/layout.tsx
  - src/app/PlausibleScript.test.tsx
  - src/app/PlausibleScript.tsx
  - src/components/strategy/ShareableLink.test.tsx
  - src/components/strategy/ShareableLink.tsx
  - src/instrumentation.test.ts
  - src/instrumentation.ts
  - src/lib/audit.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/gdpr-export-manifest.ts
  - src/lib/routing/route-contract-manifest.ts
  - src/lib/scrub-share-path.test.ts
  - src/lib/scrub-share-path.ts
  - src/lib/strategy-share-token.test.ts
  - src/lib/strategy-share-token.ts
  - src/proxy.ts
  - src/test-setup.ts
  - supabase/migrations/20260827120000_strategy_shares_generation_model.sql
  - supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql
  - supabase/schema/functions/create_strategy_share.sql
  - supabase/schema/functions/revoke_strategy_share.sql
  - supabase/schema/functions/sanitize_user.sql
  - supabase/schema/functions/strategy_shares_enforce_monotonic_generation.sql
  - supabase/tests/test_strategy_shares_rls.sql
  - vitest.config.ts
  - vitest.node-env.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 164: Code Review Report

**Reviewed:** 2026-08-28
**Depth:** standard
**Files Reviewed:** 58
**Status:** issues_found

## Summary

Reviewed the full share-lane surface: the HMAC token module (derivation, timing-safe
verification, pre-image injectivity), the mint and revoke routes (PostgREST
`RETURNS TABLE` array handling, B15 ordering, redacted envelopes), the tokenized
recipient page (rate-limit-first ordering, bounded constant-time scan, cache
isolation), both migrations (RLS, column-scoped grants, monotonic-generation trigger,
`sanitize_user` Art. 17 arm), the leak-channel mitigations (Sentry scrub, Plausible
withdrawal, per-route `no-referrer`), and the test corpus.

The security-sensitive claims I attacked all held under tracing:

- **Token derivation/comparison** — format guard precedes `timingSafeEqual`; both
  buffers are provably 43 bytes; the `.`-separator injectivity precondition holds
  (both variable fields are DB uuids, `generation` is a `CHECK (>= 1)` BIGINT written
  only as `generation + 1`); the measured `"a.b"/"b.c"` collision is pinned rather
  than hand-waved; the early-exit scan leaks only candidate ordering, not a
  byte-prefix oracle.
- **Mint/reuse** — `create_strategy_share`'s row array is destructured as
  `mintedRows?.[0]` with a fail-loud null/absent-field arm (a token over `undefined`
  would be a well-formed dead URL); the route never names `generation`/`nonce`; reuse
  is byte-identical by construction and round-tripped through the real verifier in
  `route.test.ts` (which would catch the stale two-argument pre-image the plan
  originally specified).
- **Revocation** — one atomic `UPDATE ... SET revoked_at = now(), generation =
  generation + 1 WHERE ... revoked_at IS NULL`; double-revoke converges at 0 rows;
  the 404 arm is byte-identical for non-owner and already-revoked (no existence
  oracle); the client reads 404 as convergence.
- **Cache/analytics isolation** — the token page has no import path to
  `unstable_cache`/`buildFactsheetPayloadCached` (structurally pinned in
  `page.no-cache-reach.test.ts` after a measured gap in the phase-148 guard), the
  ordered poison-then-probe behavioural spec exists, `trackFactsheetEvent` is
  path-gated, Plausible is withheld by route, and Sentry paths are scrubbed at two
  independent points.
- **RLS/SECURITY** — both share RPCs are SECURITY INVOKER with `service_role`
  EXECUTE revoked (the honest correction that `auth.uid()` is not a wall against a
  claims-spoofing service_role caller is pinned by SERVICE-ROLE 2f); the trigger's
  INSERT branch forces both MAC inputs, covering the roles grants cannot bind; the
  `sanitize_user` re-base is proved against the PROD body md5 and its DRIFT-02
  view-vs-table arms bite in both directions.

No Critical findings. Three Warnings (an operator-facing `.env.example` instruction
that contradicts the per-environment-secret ruling, a structural gap in the Plausible
withdrawal under client-side navigation, and a silent `localhost` fallback in the
mint route's URL builder) and six Info items.

## Warnings

### WR-01: `.env.example` tells the operator to reuse one SHARE_TOKEN_SECRET across all environments, and documents a stale pre-image

**File:** `.env.example:62-69` (the block added in this phase)
**Issue:** Two claims in the new block contradict the shipped model:

1. `"Generate with \`openssl rand -base64 48\` and set it in ALL Vercel
   environments."` reads as one shared value across Production/Preview/Development.
   That is precisely the configuration the founder ruling of 2026-08-27 forbids —
   `strategy-share-token.ts` (module docblock + `SECRET_REMEDY`) and
   `shareTokenSecretBootError()` both instruct a **DISTINCT** secret per environment,
   because a shared secret makes every preview/branch database seeded from a
   production snapshot a production-token factory. An operator provisioning from
   `.env.example` — the file whose whole job is to be followed verbatim — gets the
   harmful configuration, and nothing downstream detects it (the boot check verifies
   length, not distinctness).
2. `token = HMAC-SHA256(secret, "<strategy_id>.<generation>")` is the pre-nonce,
   pre-domain-tag pre-image (T-164-21's "stale two-argument form"). The real
   pre-image is `qz.strategy-share.v1.<strategy_id>.<nonce>.<generation>`. Harmless
   to the runtime, but this is the first description a new engineer reads.

**Fix:**
```
# HMAC key (>= 32 chars) for revocable per-strategy share tokens
# (src/lib/strategy-share-token.ts). token = HMAC-SHA256(secret,
# "qz.strategy-share.v1.<strategy_id>.<nonce>.<generation>"). REQUIRED, and
# validated at MODULE LOAD. Generate a SEPARATE value per Vercel environment
# (`openssl rand -base64 48`) — do NOT reuse one value across environments, or a
# preview deploy seeded from a production snapshot can derive production-valid
# links.
# ⚠️ Rotating this value revokes EVERY outstanding share link in THAT environment.
```

### WR-02: The Plausible withdrawal does not survive a client-side navigation INTO the share lane — the loaded script cannot be un-loaded

**File:** `src/app/PlausibleScript.tsx:71-85`
**Issue:** `PlausibleScript` returns `null` when `isSharePath(pathname)` — which is
correct and complete for a full document load of a share URL. But `next/script` with
`strategy="afterInteractive"` injects the tracker into the document once; on a
subsequent client-side route transition the component re-rendering to `null` does
**not** remove the already-executing script, and Plausible's `script.tagged-events.js`
auto-tracks SPA pageviews on history changes, sending `location.href`. So a session
that loaded the tracker on any normal page and then client-navigates to
`/factsheet-share/<token>` would post the live capability to plausible.io — and the
CSP explicitly allows `https://plausible.io` in both `script-src` and `connect-src`
(next.config.ts:97), so nothing else blocks it.

Today this is unreachable: I verified no production source renders a link,
`router.push`, or `redirect` targeting `/factsheet-share/*` (the URL reaches a
browser only via clipboard, i.e. full navigations). But this module's own header
refuses exactly this kind of reasoning — "an accident of the current tree is not a
mitigation" is its stated ground for rejecting the pageview-only `data-exclude`
mechanism. One future in-app affordance (e.g. an owner-lane "preview as recipient"
link) re-opens the channel with zero red anywhere.

**Fix:** Add a structural guard in the phase-164 test family (the repo's established
idiom) asserting no production source under `src/` references `/factsheet-share/` in
an `href`/`push`/`replace`/`<Link>` position — so the first in-app navigation to the
lane must confront this constraint. Alternatively (stronger), gate at the tracker:
Plausible respects `localStorage.plausible_ignore`, or wrap the pageview trigger; but
the cheap structural pin preserves the current "omission is stronger" design.

### WR-03: Mint route silently builds share URLs on `http://localhost:3000` when `NEXT_PUBLIC_APP_URL` is unset

**File:** `src/app/api/strategies/[id]/share/route.ts:87-89`
**Issue:**
```ts
function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
```
In a production deployment missing `NEXT_PUBLIC_APP_URL`, the mint succeeds, the
share row is created, the UI flashes "Link copied" — and the owner's clipboard holds
`http://localhost:3000/factsheet-share/<token>`, a link that is dead for every
recipient with no error anywhere. That is the exact silent-misconfig →
dead-link-with-success-flash class D-02 exists to remove; the phase added a loud
module-scope throw and a boot-time check for `SHARE_TOKEN_SECRET` but left this
second env dependency on the same route fail-open. (The fallback is copied from the
scenario mint route's `resolveAppUrl` precedent, so the class survives by
precedent.)

**Fix:** In production, treat an unset `NEXT_PUBLIC_APP_URL` as a 500 on this route
(same redacted envelope, Sentry-tagged), or add it to the boot-time visibility check
beside `shareTokenSecretBootError()` in `src/instrumentation.ts` so the deploy log
names it before anyone clicks Copy Link:
```ts
if (process.env.VERCEL_ENV === "production" && !process.env.NEXT_PUBLIC_APP_URL) {
  console.error("[startup] NEXT_PUBLIC_APP_URL unset — share links will point at localhost");
}
```

## Info

### IN-01: ci.yml arm-count narrative arithmetic is internally inconsistent (enforced numbers are correct)

**File:** `.github/workflows/ci.yml` (the 164 re-measure comment block, ~:1688-1739)
**Issue:** The F-1 note derives `106 - 5 + 1 = 102`, then the F-3 note says
`101 + 1 = 102` (implying a 101 starting point) and F-4 says `102 + 1 = 103`. The
prose chain does not compose. The *enforced* values all agree and are
machine-checked: the file's sentinel declares 103, the roster names 103, non-comment
`RAISE EXCEPTION` sites = 103 (verified this review), and `ARMS_FLOOR=166` sums
correctly. Prose-only per the blast-radius bar.
**Fix:** Reconcile the F-1/F-3 sentences on the next touch of this block (F-1's net
should read `106 - 5 = 101` with the rebuilt 5b arm arriving in F-3's `+1`, or
equivalent).

### IN-02: Sentry scrub is one-level-deep on breadcrumb `data` and `extra`

**File:** `src/instrumentation.ts:54-61` (`scrubRecordStrings`)
**Issue:** Only top-level string values are scrubbed; a URL nested one object deeper
(e.g. a future integration putting `data.request.url`) escapes. Today's SDK puts
breadcrumb URLs at the top level, so this is defense-in-depth only.
**Fix:** Recurse with a small depth cap (the `capAuditMetadata` shape in
`src/lib/audit.ts:834` is the in-repo precedent).

### IN-03: The 32-char secret floor is duplicated with no drift test

**File:** `src/instrumentation.ts:137` vs `src/lib/strategy-share-token.ts:151`
**Issue:** Documented as deliberate (importing the token module would make the boot
diagnostic a crash). The stated reason a coupling test is impossible — "writing one
requires importing the throwing module" — is not quite true: a test can read
`strategy-share-token.ts` with `fs` and regex `MIN_SECRET_LENGTH = (\d+)` against
the instrumentation constant, the same source-pin idiom this phase uses elsewhere.
**Fix:** Add that two-line source-pin test, or accept the drift risk explicitly.

### IN-04: `sanitize_user` keeps `SET search_path = public, pg_catalog` (no explicit trailing `pg_temp`)

**File:** `supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql:174`
**Issue:** House canon for new functions is `public, pg_temp` (pg_temp pinned last);
this SECURITY DEFINER body leaves `pg_temp` implicitly first for relation lookup.
Exposure is bounded — EXECUTE is service_role-only — and the value is a *faithful
transcription of the live PROD body* (md5-proved), which the DRIFT-02 rule required;
changing it in this migration would have been the wrong move. Recording so a future
deliberate migration can normalize it.
**Fix:** None in this phase. Candidate for a dedicated hardening migration.

### IN-05: `strategy-share-token.test.ts` mutates `process.env.SHARE_TOKEN_SECRET` without per-test restore

**File:** `src/lib/strategy-share-token.test.ts:198-215, 304-377`
**Issue:** Several tests set/delete the env var and rely on (a) the top-level import
binding having captured the fixture secret and (b) the `test-setup.ts` env-restore
fence to repair state for the next file. Both hold today, but the later
`verifyShareToken` describe stays green only because it uses the initially-bound
module — a reorder that put the fail-loud describe first plus a fresh import would
change fixtures silently.
**Fix:** `afterEach(() => { process.env.SHARE_TOKEN_SECRET = FIXTURE_SECRET; })` in
the mutating describes.

### IN-06: A future strategy-ownership transfer would wedge mint and orphan a live capability

**Files:** `supabase/migrations/20260827120000_strategy_shares_generation_model.sql`
(policy + `create_strategy_share`), `src/app/api/strategies/[id]/share/route.ts`
**Issue:** If `strategies.user_id` ever changes while a `strategy_shares` row exists
(no such feature today — verified `capital_ownership` flips do not transfer
`user_id`): the new owner's mint hits `ON CONFLICT` on a row whose `created_by` is
the old owner, the policy USING rejects it, and Copy Link becomes a permanent
generic 500 for that strategy — while the old owner's live token keeps resolving to
the *new* owner's private factsheet, revocable only by the departed owner (or
service_role). Unreachable at HEAD; recorded so any future transfer feature includes
a share-row revoke-and-reassign step.
**Fix:** None now. Add to the transfer feature's checklist if/when one is planned.

---

_Reviewed: 2026-08-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

Note on scope: `.env.example` is deny-listed for direct reads in this environment;
its phase change (the 11-line `SHARE_TOKEN_SECRET` block) was reviewed in full via
`git diff` instead, which covers everything this phase touched in that file.
