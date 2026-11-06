---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
reviewed: 2026-08-23T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
  - src/components/strategy/StrategyForm.tsx
  - src/components/strategy/StrategyForm.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/exchanges/AllocatorExchangeManager.test.tsx
  - supabase/tests/test_api_keys_insert_not_client_writable.sql
  - supabase/tests/test_api_keys_exchange_not_user_writable.sql
  - supabase/migrations/20260823120000_revoke_api_keys_insert.sql
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
status: findings
---

# Phase 160: Code Review Report

**Reviewed:** 2026-08-23
**Depth:** standard (retrospective — PRs #703/#704 already merged and live)
**Files Reviewed:** 13
**Status:** findings (no Critical; one Warning worth a follow-up commit)

## Summary

The TypeScript work is sound. Every directed probe from the review brief was traced to
source and came back clean or better-than-claimed:

- **Persist-arm failure surface** (`validate-and-encrypt/route.ts:380-510`): every arm
  answers honestly. Both the admin-factory catch and the INSERT-failure arm build
  `perRequestSecrets = [api_key, api_secret, passphrase]` and thread it into BOTH sinks
  (`scrubSeamError(..., perRequestSecrets)` at console.error, `secrets:` at
  `captureToSentry`). `scrubSeamError` accepts `readonly unknown[]`
  (`seam-redaction.ts:447-450`), so an `undefined` passphrase entry is tolerated. The raw
  PostgREST message never reaches the response body — the 500 carries curated copy +
  `code: "UNKNOWN"`. The persist success response is exact-matched in the test AND pattern
  scanned for ciphertext-shaped keys.
- **`...encrypted` spread override** — cannot override today, but see WR-01: the only
  thing preventing it is a strip-mode Zod schema two modules away.
- **`ApiKeyManager` loud throw** (`:254`): coherent. The throw lands in the `handleAddKey`
  catch (`:324-328`) → `setError(err.message)` + `finally setLoading(false)`; the form
  stays open with the banner, no optimistic state was set before the throw. The DELETE
  path (`:350`, `.from("api_keys").delete().eq("id", keyId)`) is untouched by the diff —
  byte-preserved, confirmed against `git diff bf00ad0c..ae53d3cd`. The dedented link/sync
  blocks are content-identical (only indentation + `newKey.id` → `newKeyId`).
- **`AllocatorExchangeManager` re-fetch** (`:600-620`): visibility is not a race — the
  route awaits the committed INSERT before responding, the re-fetch runs as the same
  authed user the row's `user_id` names, and Supabase has no read replicas here. The
  failure arm renders coherently (curated copy, `setFormLoading(false)`, early return) and
  no longer pipes `insertErr.message` (H-0405 class) into the banner. One residual UX gap
  booked as IN-02.
- **`skipAssetClassWrite` superset claim** (`finalize-wizard/route.ts:1301`): VERIFIED
  structurally, not just by test. Both bindings come from ONE
  `.select("exchange, attested_venue").eq("id", apiKeyId).single()` read (`:1250-1258`),
  and `api_keys.exchange` is `TEXT NOT NULL` (`20260405061911_initial_schema.sql:22`), so
  `apiKeyExchange === null` ⟺ lookup fault ⟹ `attestedVenue === null`. There is NO state
  in which the old guard skipped and the new guard writes. The new guard additionally
  skips attested-NULL rows — the laundering path the phase exists to close. The comment
  correction "inflated → deflated Sharpe" is mathematically right (annualized Sharpe
  scales with √N; √252 < √365).
- **Test quality**: the route's RANK-03 oracle is genuinely adversarial (hostile
  `user_id` + `attested_venue` in the body, asserted absent from the captured row); the
  B-D2 oracles use binding-divergent fixtures with literal `asset_class` expectations,
  never a recomputation via `isCryptoExchange`; the documented neuter/RED cycles in the
  summaries are consistent with what the assertions can actually detect. The one vacuity
  found during execution (the `String({...})` → `"[object Object]"` scrub assertion) was
  caught and fixed by the executor itself (`route.test.ts:1351-1357`).

**Known gap 1 — CONFIRMED with evidence.** Enumerated every `.from("api_keys")` verb in
non-test `src/`: the ONLY `.insert` chain is the server writer in
`validate-and-encrypt/route.ts:468`; `finalize-wizard`'s api_keys `.update` touches only
`last_sync_at` (`route.ts:2095`); the browser components hold `select` and `delete` only.
With INSERT revoked from `anon`/`authenticated` (verified live on PROD per 160-05), the
legacy ciphertext arm has no residual row-creating path. It is dead weight, correctly
booked for retirement — see IN-05.

**Known gap 2 — stands, cannot be closed by review.** The persist arm's failure arms are
well-tested in vitest and the deploy-skew degradation is honest (an old server ignoring
`persist` returns no `api_key_id` → all three clients throw the loud "verified but not
saved" copy, zero rows minted). But no code reading substitutes for the first real PROD
connect — see IN-06.

## Warnings

### WR-01: `...encrypted` spread last in the api_keys INSERT — venue/tenant override guarded only by a distant Zod strip mode

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:468-474`
**Issue:** The INSERT is
`{ user_id, exchange, attested_venue, label, ...encrypted }` — the spread comes AFTER the
server-decided columns, so any key named `user_id`, `exchange`, `attested_venue`, or
`label` in `encrypted` would silently override them. Today it cannot: `encrypted` is the
output of `parseResponse(EncryptKeyResponseSchema, ...)` and that schema
(`analytics-schemas.ts:59-66`) is default strip-mode `z.object` with exactly six
ciphertext fields. But that guarantee lives two modules away from the writer, in a file
where a sibling schema carries a sanctioned `.passthrough()` exception
(`analytics-schemas.ts:72`) and whose own comments record a schema having been "converted
to strip" — i.e., the mode has churned before. If `EncryptKeyResponseSchema` ever goes
passthrough, the analytics service (an X-Service-Key seam — a DIFFERENT trust domain from
`service_role`) gains override of the tenant and both venue columns at the writer, which
is precisely the provenance RANK-03 pins. The route's hostile-body oracle
(`route.test.ts:1046+`) covers the request-body vector only; the mock `encryptKey`
resolves clean fields, so this vector has no oracle.
**Fix:** One-line reorder — spread FIRST, explicit columns last:
```ts
.insert({
  ...encrypted,
  user_id: userId,
  exchange: exchangeNormalized,
  attested_venue: exchangeNormalized,
  label: labelOrDefault,
})
```
Then add `exchange: "evil-venue", user_id: "evil-uid"` to the mock `encryptKey`
resolution in the RANK-03 oracle and assert the row still carries the server values —
that oracle would go RED against today's ordering, proving it can fail. Follow-up
commit, not an emergency: the strip-mode schema holds the line in production right now.

## Info

### IN-01: Persist retry after a committed-but-unacknowledged INSERT mints an orphaned credential row

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:476-505`
**Issue:** If the INSERT commits but the PostgREST response is lost (or `.single()`
faults post-commit), the route answers 500 "Please try again"; the retry re-encrypts
(fresh ciphertext, so nothing dedupes) and inserts a second row. The first row is
unlinked but real, holding valid encrypted credentials. Rows are user-visible and
deletable in the key list, so this is hygiene, not integrity — but it can also drift the
count-pinned census discipline this phase leans on.
**Fix:** Accept as-is (the pre-conversion client INSERT had a similar, slightly narrower
window), or note it next to the census methodology so a future count-drift has a known
benign explanation.

### IN-02: Allocator's refetch-failure arm strands the saved key without its first-run sync

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:608-619`
**Issue:** When the re-fetch fails, the early return means the awaited first-run sync
(INGEST-07/D-09) never fires for a key the server DID save. The copy says "Refresh the
page to see it," but after refresh the key sits at `sync_status: idle` until the user
clicks Sync now. The old code had no such state (insert failure ⇒ no row), so this is a
new, rare, coherent-but-idle arm.
**Fix:** Either extend the copy ("…then click Sync now") or fire the sync POST with
`newKeyId` before the early return. Low priority.

### IN-03: Stale-tab UX during the post-REVOKE skew shows a raw Postgres denial

**File:** `src/components/strategy/ApiKeyManager.tsx` (pre-conversion bundle, historical)
**Issue:** A tab still running the pre-#703 bundle that connects a key post-REVOKE hits
`42501` on its client INSERT; the old bundle's handler was
`throw new Error(insertError.message)` → "permission denied for table api_keys" rendered
in the banner. Transient by design (self-heals on refresh), and the intended cost of the
two-PR rollout — recorded so the first such support report is recognized, not debugged.
**Fix:** None needed; expected decay of the skew window.

### IN-04: `kek_version` covered structurally, not by name (already booked in 160-03)

**File:** `src/app/api/keys/validate-and-encrypt/route.test.ts:1074-1076`
**Issue:** The RANK-03 oracle asserts `api_key_encrypted` and `dek_encrypted` on the
captured row but not `kek_version`; it arrives via the same single spread, so a
regression would need a per-field expression that does not exist — but the retired
M-0407 spec pinned it by name and nothing does now. 160-03's summary discloses this.
**Fix:** One line in the RANK-03 oracle: `expect(row.kek_version).toBe(3);` — closes the
booked delta next time the file is touched.

### IN-05: Legacy ciphertext arm confirmed dead as a row-creating path — retire it as booked

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:384-390`
**Issue:** Verified (see Summary): no non-test `src/` code INSERTs into `api_keys` except
the persist arm, and the browser roles hold no INSERT grant. The legacy arm now serves
only stale tabs, returning ciphertext they can no longer store. It remains a standing
authenticated encryption/validation oracle (rate-limited, pre-existing) and ~40 lines of
contract that every future editor must keep byte-stable for no remaining consumer.
**Fix:** Execute the already-booked retirement (160-05 "Carried forward") once the skew
window is credibly over — e.g., strict `persist !== true` → 400 `STALE_CLIENT`.

### IN-06: The persist arm has never executed a real PROD connect

**File:** n/a (operational)
**Issue:** Zero keys were connected during the soak (160-05's own honest disclosure), so
the writer's INSERT, the scrub-trigger admission of `service_role`, and the coupling
CHECK have been exercised on PROD only by the migration's fixture-verified assertions —
never by the live Vercel → Supabase path with real env credentials. The failure arms all
degrade honestly (503 `SEAM_MISCONFIGURED` if the service key is absent; loud client
throw on any 2xx without an id), so a first-connect failure will be visible, not silent.
**Fix:** Treat the next PROD connect-a-key as a monitored event: watch Sentry for
`arm: "persist"` tags and confirm the row lands with `attested_venue = exchange`.

---

_Reviewed: 2026-08-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
