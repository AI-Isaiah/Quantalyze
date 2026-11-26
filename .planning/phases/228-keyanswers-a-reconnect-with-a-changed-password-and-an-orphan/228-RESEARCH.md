# Phase 228: KEYANSWERS - Research

**Researched:** 2026-11-26
**Domain:** one Next.js route (`create-with-key`, seam S4), one shared rotate seam (Next.js + FastAPI), the wizard error vocabulary, and the seam-census test suite that pins all of them.
**Confidence:** MEDIUM-HIGH. The code facts are Read at HEAD `fb28589f7` (worktree). The census edits are enumerated from the test sources but NOT run: no `node_modules` exists in this worktree (see Environment Availability), so the planner's Wave 0 must measure them.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **CONN-02: rotated or mistyped MT5 password (FOUNDER RULING, 2026-11-26): "Validate and update in place".** On the MT5 same-account arms, a reconnect with a new password is validated. If it passes, the stored key's secret is rotated through the same seam `PATCH /api/keys/[id]/rotate-secret` uses (`POST /internal/keys/{id}/rotate-secret`, `rotate_key_secret` in `analytics-service/routers/internal.py`). The answer names the key: "We updated the password on your key "X"". A mistyped password gets the named validation error (the existing `classifyKeyValidationError` vocabulary, including `KEY_MT5_MASTER_PASSWORD` for a master password). **Reversibility:** costly: a connect request now writes an existing PROD key's secret, and undoing it means removing a write path users will have relied on.
- **Trade-off the founder accepted:** the up-to-120 s validation comes back on those arms, which reverses 212-03 SC5 ("refuse before the 120 s validateKey") for MT5. A connect request now changes an existing key.
- **Which arms are "same-account":** the MT5 pre-validation fence verdicts where the caller's own WORKING holder is picked on the same login and server: `connected`, `orphaned`, `held`, and the other-session `draft`. `failing_holder` keeps its 225-07 path (a validated new key takes the slot). The planner confirms or narrows this set against the code, and records the final set in the plan.
- **What the answer carries:** the refusal that arm gives today still says what holds the account (strategy / key / draft), and a sentence naming the key whose password was updated is prepended. It is still not a new strategy, so no `strategy_id` is minted. The exact code shape (a new wizard code, or the existing code plus a `secret_updated` marker) is the planner's call, under the censuses. The answer must match `api_keys` afterwards.
- **Server rule:** rotate in place only when the picked holder is the same account at the fence (`pickSameAccountHolder`'s exact server, or its null-server legacy fallback). The seam validates against the STORED login and server. If the typed server differs from the stored one, the seam's own verdict is what the user hears, and nothing is written.
- **CONN-02 F6 session-fence strip:** correct the false fallback strip in `WizardClient.tsx` ("These credentials are already connected. We continued with your existing strategy instead of creating a duplicate."). It must not claim the submitted credentials are connected when the F6 fence did not validate them.
- **CONN-04:** `KEY_ORPHANED`'s Disconnect line (`fix[2]`) names the key when the holder is known, and degrades to today's sentence when it is not. SC-2's test drives an allocator-role and a manager-role owner through `KEY_ORPHANED`. For PROOF-01 it goes RED by removing the holder from the answer.
- **Review scope:** authz (owner only; owner-scoped read; `user_id` to the seam; UPDATE filtered on `id` + `user_id` + `exchange = 'mt5'`), the master-password refusal, and a race against a concurrent sync.
- **Decided autonomously (kept as locked by the orchestrator):** (1) the rotate seam alone, one probe, not validateKey plus the seam; (2) unchanged password: the seam reports whether the new secret equals the stored one (constant-time compare in Python, a boolean in the response), nothing is written, the answer says the stored password already works; (3) sync race: no change to poll or sync writers (Phase 225-21 owns the poll stamper), limit recorded in the plan and CHANGELOG; (4) extract the seam call and owner-scoped UPDATE into one helper used by both routes (TWIN-8), rotate-secret's behaviour byte-identical.

### Claude's Discretion
- Test layout, helper names and the exact copy wording within DESIGN.md and the existing copy voice.

### Deferred Ideas (OUT OF SCOPE)
- Guarding the rotate UPDATE against a concurrent sync writing `sign_in_failed` afterwards. It needs the poll writers, which Phase 225-21 owns.
- The archived-composite `KEY_ORPHANED` case (F-2, out).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-02 | Reconnecting an MT5 account with a rotated or mistyped password gets a named answer that matches what was stored. | Q1 (arms and holder id), Q2 (shared helper plus `secret_changed`), Q3 (authz parity), Q4 (master-password and wrong-server refusals), Q5 (deadline O2/O4), Q7 (wire shape and censuses), Q9 (F6 strip). |
| CONN-04 | `KEY_ORPHANED` copy tells an allocator-role owner which key to Disconnect. The archived-composite case is out. | Q8 (`formatKeyError` arm, the exact bullet, role test shape). |
</phase_requirements>

## Summary

The ruling is implementable inside one pre-validation arm, and only there. At the pre-validation fence `resolveByVenueIdentity` has already picked the caller's own live holder (`liveKeyId = picked.id`, `route.ts:380`), but it throws the key id away for `connected`, `held` and `orphaned` (only `draft` carries `api_key_id`, and only `failing_holder` carries `holderId`). The plan adds one optional member to the resolver's verdicts, set only on the working-holder path with an exact-server match, then the route, instead of returning the refusal, calls the shared rotate seam, optionally persists, and returns **the same refusal builder's body plus one new nested field** `key_secret: { outcome, name? }`. No new wizard code is needed: all four refusal codes and every seam refusal code are already on `KNOWN_CREATE_WITH_KEY_CODES`, so the roster, `wizardErrors.invariant`, `seam-wire-vocabulary` and `EXPECTED_TABLE_SIZE` censuses do not move.

Two things in the brief are not safe as written. (1) **The rotate must not run at the post-validation resolve:** by then `validate-key-serialized` (120 s) is spent, and adding `keys-rotate-secret` (120 s) plus the breaker-store term gives 265 500 ms failing against the browser deadline of 190 500 ms, so the server could write after the browser says "Nothing was saved" (UI-SPEC O2). At the pre-validation fence the arm spends exactly one 120 s leg, 132 750 ms failing, which fits with 57 750 ms to spare for the unbudgeted Supabase steps. (2) **The server rule's null-server tier is unsound:** the seam probes the server stored inside the ciphertext, not the one the user typed, so on a null-server holder a right password is written and reported "updated" even if the user typed another broker's server, and `KEY_MT5_WRONG_SERVER`'s "the broker server name you entered" would be false (O1). Recommendation: rotate only on the exact-server tier (`picked.venue_server === venueServer`, non-null); the null-server tier keeps today's refusal.

The largest planning risk is test churn, not code. The harness in `create-with-key/route.test.ts` has no rotate-seam mock, its admin `update()` double supports two `.eq` calls and no `.select`, and about 15 existing MT5 pre-fence tests pin "refused before validate, zero writes", which the ruling deliberately reverses. The seam-census suite (SC-4f import edge, the wiring roster B-15, `EXPECTED_SEAM_CALL_FILES`, `SEAM_ROUTE_BUDGETS`) is keyed on which files import or call the seam, so WHERE the shared helper lives decides how many censuses move. The recommended placement keeps both routes on the import edge.

**Primary recommendation:** extend the resolver to carry `rotate: { keyId }` only from the exact-server working-holder path; add `rotateKeySecret()` (the seam call, throws like `validateKey`) to `src/lib/analytics-client.ts` and a typed-outcome `persistRotatedMt5Secret()` to `src/lib/api/rotate-key-secret.ts`; keep every `NextResponse.json({ code … })` literal in each route; add `secret_changed` (optional in the TS schema, UTF-8-bytes `secrets.compare_digest` in Python); thread one optional `outcome` through the four existing refusal builders; do not touch the post-validation, race or `failing_holder` arms.

## Project Constraints (from CLAUDE.md)

- **Which database am I on:** this checkout's Supabase CLI is linked to PRODUCTION; never `db push` from here. This phase has no migration, so nothing here writes SQL. PROD writes need the marker query first.
- **Next.js:** AGENTS.md says this Next.js has breaking changes; read `node_modules/next/dist/docs/` before touching Next APIs. This phase uses only `NextResponse.json` and existing route patterns, so no new Next API.
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry, in the same commit as the `VERSION` bump (VERSION and `package.json` byte-equal 4-digit strings; never `npm version`). Section vocabulary: Fixed/Added/Changed/Removed/Tests/Notes/Security/Root cause/Why. The sync-race limit and the reversal of 212-03 SC5 for MT5 belong in `### Notes`.
- **Never write the CI skip trailer in a commit message or PR body, not even to deny it.**
- **TODOS.md holds open work only:** a ship deletes the entries it closed in the same PR and names them in the CHANGELOG. Here: `C-2 / A-4 — a rotated venue password re-connect reports success and stores nothing` (TODOS.md ~:3450) is closed and deleted. `[167.1.2-ORPHAN-COPY-FIX]` (TODOS.md ~:2623) is only HALF closed: its second half (the archived-composite case) is out per F-2, so the entry is EDITED down to the archived case, not deleted. LOW/Info review survivors are never booked in TODOS.md.
- **Completion is historical:** a VERIFICATION uses `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never go in `drift_subjects`.
- **DESIGN.md governs every visual decision;** the approved UI-SPEC already did that work.
- **SQL gate floors:** not touched (no SQL). Do not restate any floor from memory.
- **Memory-recorded rules that bind the plan:** review = code-reviewer plus silent-failure-hunter, MEDIUM and above; migrations need migration-reviewer plus rls-policy-auditor (N/A, none here); tests must be able to fail (neuter, see RED, restore from a byte backup, never `git checkout/restore/stash` on uncommitted work); pytest only from `analytics-service/`; always `grep -a`; mypy strict belongs in every analytics-touching brief; no AI authorship trailers.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide which holder a reconnect is "the same account as" | API / Backend (`resolveByVenueIdentity`, `pickSameAccountHolder`) | Database (`api_keys` read via admin client, owner filter) | Existing 225 fence; the new rotate decision hangs off its `liveKeyId` path. |
| Validate the typed password against the stored login+server, and compare to the stored password | Python analytics service (`rotate_key_secret`) | Broker gateway (MT5 terminal) | Only the Python service ever decrypts the stored row; Next.js must never see plaintext. |
| Write the new ciphertext | API / Backend (admin client UPDATE, filtered on id + user_id + exchange) | Database | `api_keys` UPDATE is revoked from `authenticated`; admin write scoped by the explicit owner filter. |
| Name the key in the answer | API / Backend (user-scoped label read) | Browser (render only) | The label is the caller's own row, read through RLS; the browser never gets a login, server or key id. |
| Render the outcome notice, the corrected F6 strip, the named Disconnect bullet | Browser / Client (`ConnectKeyStep`, `WizardClient`, `formatKeyError`) | — | Pure presentation of one server response. |
| Browser give-up deadline | Browser (`connectAbortDeadlineMsFor`) | API (route `maxDuration`, seam budgets) | The abort must be the LAST party to give up, or "Nothing was saved" is false. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js route handlers, `@supabase/supabase-js`, `zod` | repo-pinned (no change) | Route, DB client, schema | Existing stack; this phase adds no dependency. |
| FastAPI + Python stdlib `secrets` | repo-pinned | `rotate_key_secret`, constant-time compare | `secrets` is already imported at `analytics-service/routers/internal.py:37` and used at `:184`. |
| vitest | repo-pinned | TS tests | Existing. |
| pytest, mypy `--strict` | pytest 9.0.2, mypy 2.0.0 (local) | Python tests, type gate | CI step: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (`.github/workflows/ci.yml:5748`). |

### Supporting
None.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Optional `secret_changed` in `RotateSecretResponseSchema` | Required field | Vercel ships before Railway. A required field makes the CURRENT rotate-secret route fail its own parse in that window. Optional is the only safe order. |
| One nested `key_secret: { outcome, name? }` field on the refusal body | Two flat fields, or a new wizard code | A new code moves `EXPECTED_TABLE_SIZE`, both rosters and the invariant scanner for no gain. Nested keeps the top-level vocabulary at one new key. |
| Helper in `analytics-client.ts` + `src/lib/api/rotate-key-secret.ts` | One new lib file holding both halves | The one-file shape drops `rotate-secret/route.ts` off the `SEAM_IMPORT_EDGE`, which moves SC-4f, `EXPECTED_SEAM_FILES`, the wiring roster and weakens the guards (see Pitfall 3). |

**Installation:** none. **Version verification:** no package is added, so no registry check applies.

## Package Legitimacy Audit

No external packages are installed or recommended in this phase. Nothing to audit. **Packages removed due to SLOP:** none. **Packages flagged SUS:** none.

## Architecture Patterns

### System Architecture Diagram

```
Browser ConnectKeyStep.handleSubmit
  POST /api/strategies/create-with-key  {exchange:"mt5", api_key=login, api_secret=password, passphrase=server, wizard_session_id}
        |
        v
  withAuth: CSRF -> session -> approval gate           (rotate-secret's same three checks, inherited)
        |
        v  400 guards (3 MT5 slots non-blank, server normalises, uuid session, lengths)
  checkLimit userActionLimiter `strategies-create-with-key:<uid>`  (5 / 60 s; ONE token, spent here)
        |
        v
  F6 fence: strategies where user_id + wizard_session_id ? --yes--> 200 {deduped:true}  (no validate, no write)  --> WizardClient strip (CONN-02 copy fix)
        |no
        v
  resolveByVenueIdentity(mode "fence")  --> verdict
        |
        +-- failing_holder ------------> fall through to validateKey -> encrypt -> RPC -> swapAccountSlot   (UNCHANGED, 225-07)
        +-- held from a failing holder with a composite dependent ---------> 409 KEY_VENUE_ALREADY_CONNECTED   (UNCHANGED, not a working holder)
        +-- connected | orphaned | held | draft  AND  rotate present (working holder, EXACT server)
        |        |
        |        v   [NEW ARM, inside the route's existing try so a seam throw reaches the existing catch]
        |   1. createAdminClient() (fail hard -> 503 SEAM_MISCONFIGURED BEFORE the 120 s probe)
        |   2. user-scoped re-read of the holder row by id (ownership via RLS; label, is_active, disconnected_at, venue_account_id)
        |   3. rotateKeySecret(keyId, typed password, user.id)  --Railway POST /internal/keys/{id}/rotate-secret (120 s, retries 0)
        |        throws -> existing catch: classifyKeyValidationError -> {code} (400/424/5xx) ; NO write, NO key_secret field
        |   4. secret_changed === false -> NO UPDATE ; outcome "unchanged"
        |      else persistRotatedMt5Secret (UPDATE id+user_id+exchange='mt5', audit api_key.rotate_secret) -> outcome "updated"
        |        typed failure -> UNKNOWN 500 / SEAM_MISCONFIGURED 503 / holderReadFailed 503 (never "updated")
        |   5. same refusal builder as today (409) + key_secret:{outcome,name?}
        +-- connected | orphaned | held | draft AND no rotate (null-server tier, read faults) -> today's refusal, byte-identical
        +-- unresolved / read_failed -> unchanged (validate path / 503)
        |
        v
  validateKey -> post-validation resolve (refusals UNCHANGED, no rotate) -> encryptKey -> RPC ... (all unchanged)
```

### Recommended Project Structure
```
src/lib/analytics-client.ts          # + rotateKeySecret(): the keys-rotate-secret seam call (throws, route's catch classifies)
src/lib/api/rotate-key-secret.ts     # NEW: persistRotatedMt5Secret() -> typed outcome (never a NextResponse), logAuditEvent in the SAME function as the .update
src/lib/analytics-schemas.ts         # RotateSecretResponseSchema + secret_changed optional
src/lib/key-secret-outcome.ts        # NEW, client-safe: KeySecretOutcome type, keySecretField(), parseKeySecretOutcome()
src/lib/venue-identity.ts            # (no change expected)
src/lib/own-account-holder.ts        # + readOwnKeyLabel() (label only), same never-throws posture
src/app/api/strategies/create-with-key/route.ts   # resolver member, rotate arm, builders gain optional outcome param
src/app/api/keys/[id]/rotate-secret/route.ts      # calls the two shared functions; keeps classify/envelope and every response literal
analytics-service/routers/internal.py             # secret_changed
```

### Pattern 1: The resolver carries the rotate target from the working-holder path only
**What:** `VenueIdentityResolution` gains an optional `rotate?: { keyId: string }` on `connected`, `held`, `orphaned` and `draft`. It is set in `resolveByVenueIdentity` only where `liveKeyId = picked.id` is assigned after `isWorkingHolder(picked)` passed (`route.ts:380`), and only when `picked.venue_server !== null && picked.venue_server === venueServer`. It is never inferred from the verdict, because `held` has TWO producers: the working path (`resolveOtherKeyUse`, `:417-424`) and the failing-holder-with-composite-dependent path (`:372-377`), which returns `held` for a holder that is NOT working and must not rotate.
**Verbatim anchor** `[VERIFIED: src/app/api/strategies/create-with-key/route.ts:345,372-377,380]`:
```
    if (!isWorkingHolder(picked)) {
...
      if (dependent) {
        return {
          kind: "held",
          holder: await readOwnAccountHolder(supabase, userId, picked.id, HOLDER_LOG_LABEL),
        };
      }
      return { kind: "failing_holder", holderId: picked.id };
    }
    liveKeyId = picked.id;
```
**Per-verdict facts** (all `[VERIFIED: route.ts:395-425, 563-632]`):

| Verdict | Where produced | Picks own WORKING holder? | Key id source today | Nickname source |
|---|---|---|---|---|
| `connected` | `resolveStrategiesForKey` tail (`:624-631`), spread with `holder` at `:411-414` | yes (`liveKeyId`) | not carried; add `rotate.keyId = liveKeyId` | `holder` is `kind:"strategy"`, so a label read is needed |
| `orphaned` | `resolveOtherKeyUse` `ORPHANED` (`:478`), holder at `:419-424` | yes | not carried; add | `holder.kind==="key"` already holds `name` = label, but use the one label read for uniformity |
| `held` (working) | `resolveOtherKeyUse` `HELD` | yes | not carried; add | same |
| `held` (failing holder + composite dependent) | `:372-377` | **no** | `picked.id` is in scope | n/a: never rotates |
| `draft` | `resolveStrategiesForKey` (`:563-579`) returns `api_key_id: liveKeyId` | yes | carried already as `api_key_id`, but add `rotate` for one code path | label read |
| `failing_holder` | `:378` | no (failing) | `holderId` | n/a: keeps 225-07 |

The same-session `draft` never reaches the pre-fence arm: the F6 fence (`:1475-1508`) answers any same-`wizard_session_id` draft with `deduped: true` first, regardless of key. So the pre-fence `draft` is the OTHER-session draft, as CONTEXT says (and also the same-session draft when the F6 read faulted).

### Pattern 2: The refusal builders take one optional outcome parameter (TWIN-8)
**What:** `venueAlreadyConnectedResponse(strategyName, holder?, outcome?)`, `venueDraftInProgressResponse(draftName, outcome?)`, `keyOrphanedResponse(holder?, outcome?)`, `keyVenueAlreadyConnectedResponse(holder?, outcome?)` each spread `...keySecretField(outcome)` into the `extra` object that is already built ABOVE the `NextResponse.json` literal (that placement keeps `code:` first and the emitter inside the invariant scanner's `error:` window). With `outcome` undefined the body is byte-identical to today, so every non-rotate pin is untouched.
**Wire shape (recommended):** `key_secret: { outcome: "updated" | "unchanged"; name?: string }`, `name` omitted (not nulled) when the label is blank, exactly like `strategy_name`. No login, server or key id (G1, T-154-06-C). Client: `parseKeySecretOutcome(data.key_secret)` shape-checks `outcome` to the two literals and `name` to a non-blank string, never as an href.

### Pattern 3: The seam call is a function that THROWS, like `validateKey`
**What:** `rotateKeySecret({ keyId, userId, newSecret, correlationId })` in `analytics-client.ts` does the `resilientFetch("keys-rotate-secret", …)` call, the non-ok to `Error` conversion (carrying `seamCode`, `status`, `name = "AnalyticsUpstreamError"`), and `RotateSecretResponseSchema.safeParse`, moved verbatim from `rotate-secret/route.ts:295-410`. Both routes call it inside a `try`; both catches already call `classifyKeyValidationError(err)`. rotate-secret then answers `buildEnvelope(code, correlationId)` (unchanged); create-with-key answers `{ code }` + `keyRouteFailureHeaders(err)` (unchanged, its existing catch).
**Persist half:** `persistRotatedMt5Secret({ admin, supabase, userId, keyRow, parsed, newSecret })` returns a typed union, never a `NextResponse`:
`{ kind: "ok" } | { kind: "venue_collision" } | { kind: "holder_read_failed" } | { kind: "write_indeterminate" }`.
rotate-secret maps these to its existing literals (`KEY_VENUE_ALREADY_CONNECTED` 409, `UNKNOWN` 503, `DASHBOARD_WRITE_INDETERMINATE` 500, the `SEAM_MISCONFIGURED` 503 stays in the route because it owns `createAdminClient()`'s try). create-with-key maps them to its own roster-known answers (`UNKNOWN` 500, `holderReadFailedResponse()`, `SEAM_MISCONFIGURED` 503). `venue_collision` is unreachable on this arm because the holder was selected by `.eq("venue_account_id", login)`, so `venue_account_id` is non-null and the backfill never runs; the helper still takes the pre-read `venue_account_id` and applies rotate-secret's rule unchanged.
**Why typed outcomes, not responses:** rotate-secret answers `DASHBOARD_*` codes and `buildEnvelope`; create-with-key answers bare `{ code }` from its own roster (`KNOWN_CREATE_WITH_KEY_CODES` has no `DASHBOARD_*` member). A shared helper that returned a `NextResponse` would put the wrong vocabulary on one of the two routes.

### Anti-Patterns to Avoid
- **Rotating at the post-validation resolve or the 23505 race arm.** It spends validate (120 s) AND rotate (120 s): 265 500 ms failing against a 190 500 ms browser deadline.
- **Inferring "working holder" from the `held` verdict.** `held` has two producers (above).
- **Returning a `NextResponse` from the persist helper.** Moves emitters out of the route files the dialog-envelope and wizardErrors scanners read.
- **Adding the rotate leg to the `serialized-venue` branch of `SEAM_ROUTE_BUDGETS`.** That sums validate+encrypt+rotate: 308 250 ms, a real SC-4b breach.
- **Merging this phase's UPDATE with the poll stamper or touching `services/allocator_positions.py` / `job_worker.py`.** Phase 225-21 owns them.
- **Putting the typed password, login or server in any response, log or Sentry `extra`.** Every `scrubSeamError`/`captureToSentry` call in the arm names the full secrets array the route already builds.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constant-time password equality | `==` on strings, or `secrets.compare_digest(str, str)` | `secrets.compare_digest(old.encode("utf-8"), new.encode("utf-8"))` | `compare_digest` on two `str` raises `TypeError` for non-ASCII; MT5 investor passwords are user-chosen. |
| Failure classification | a second substring cascade | `classifyKeyValidationError` | Both key routes share it; its `seamCode` branch is read before the cascade. |
| The refusal bodies | inline `NextResponse.json` literals in the new arm | the four existing builders plus one optional param | TWIN-8: one builder per refusal body. |
| Ownership proof | a new query shape | the reuse arm's two-layer idiom (admin read filtered on `user_id`, then a user-scoped read through RLS) | Already reviewed; the user-scoped read also supplies the label and the `returnsKeyToLive` inputs. |
| Secret redaction | ad-hoc string replace | `scrubSeamError(err, secrets)` and `captureToSentry({ secrets })` | Seam-log-coverage enforces it on every seam file. |
| The venue-id backfill / 23505 retry / `history_inclusion` reset | a second copy | move rotate-secret's `attemptPersist` logic into `persistRotatedMt5Secret` unchanged | One writer of `api_keys` ciphertext. |

**Key insight:** every piece except the resolver member, the `secret_changed` boolean and the outcome field already exists and has been reviewed. The risk is in moving rotate-secret's code without changing a byte of its behaviour, and in the census edits that follow the move.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted. (One adjacent runtime fact: a deploy window exists in which new Next.js runs against the old Python service; see Pitfall 6.)

## Common Pitfalls

### Pitfall 1: The rotate runs after `validateKey` and breaks the browser-deadline invariant (O2/O4)
**What goes wrong:** rotate at the post-validation resolve spends `validate-key-serialized` 120 000 + `keys-rotate-secret` 120 000 plus store terms. **Numbers** (`[VERIFIED: src/lib/wizard/validate-budget.ts:65,138,151,192,246-253]`; arithmetic hand-computed here, planner re-derives from the invariant run): serialized connect worst case failing = 120 000 + 30 000 + 2 legs x 3 commands x 4 250 = 175 500 ms; browser deadline `connectAbortDeadlineMsFor("mt5")` = 120 000 + 30 000 + 25 500 + 15 000 = 190 500 ms. Pre-fence rotate arm: 120 000 + 1 leg x 3 x 4 250 = 132 750 ms failing, leaving 57 750 ms of the 190 500 for the unbudgeted Supabase reads and the UPDATE. Post-validation rotate: 120 000 + 120 000 + 2 legs... = 265 500 ms, past the deadline.
**How to avoid:** pre-fence only. Model the leg as its OWN exclusive branch in `SEAM_ROUTE_BUDGETS["…/create-with-key/route.ts"]` (e.g. `{ key: "keys-rotate-secret", calls: 1, branch: "mt5-rotate" }`). The shared unlabelled `encrypt-key` leg is then charged to it too (over-stating it to 175 500, equal to the serialized branch and still under 190 500), so the existing PARITY-03 oracle's two arms are unchanged. A third `CONNECT_VENUE_ARMS` row cannot simply be appended: the oracle loops BOTH connect routes over `CONNECT_VENUE_ARMS` and throws on a missing label, and `composite/add-key` has no rotate branch.
**Pin (O2/O4):** add a hand-typed assertion in `seam-budgets.invariant.test.ts` that `SEAM_BUDGETS["keys-rotate-secret"].timeoutMs <= SEAM_BUDGETS["validate-key-serialized"].timeoutMs` and equal `retries`, plus a hand-computed `mt5-rotate` failing figure below `connectAbortDeadlineMsFor("mt5") - WAIT_ABORT_GRACE_MS`. O4 (the cancelled line): a rotate that finishes after `Stop waiting` writes no second key, and a resubmit then gets `unchanged`: pin with a route test that runs the arm twice (first `secret_changed:true`, second `false`) and asserts one UPDATE.
**Warning signs:** `seam-budgets.invariant.test.ts` SC-4b red; the multi-branch roster test (`toEqual` of four routes) is unchanged because create-with-key is already multi-branch.

### Pitfall 2: `held` is not always a working holder
**What goes wrong:** treating every `held` as rotatable rotates a failing key beside a composite dependent. **Avoid:** carry `rotate` out of the `liveKeyId` path only (Pattern 1). **Test:** `[WR-06]` describe (`route.test.ts:3877`) already seeds a failing holder with a composite dependent; assert it still answers byte-identical `KEY_VENUE_ALREADY_CONNECTED`, zero seam calls, zero UPDATEs.

### Pitfall 3: Helper placement moves the seam censuses (measure, do not assume)
**What goes wrong:** if `rotate-secret/route.ts` no longer imports a seam module, it leaves the import-edge derivation. `[VERIFIED: src/lib/seam-budgets.invariant.test.ts:260-294]`:
```
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;
```
and `deriveSeamRouteFiles` selects `route.ts` files whose source matches `SEAM_IMPORT_EDGE` (`from "(@/lib/|./|../)?(lib/)?(analytics-client|resilient-fetch|process-key-client)"`). SC-4f then reports rotate-secret's row as STALE. The same derivation is duplicated in `seam-log-coverage.test.ts:92-99` (`EXPECTED_SEAM_FILES`), `seam-poll-disjointness.pin.test.ts:156`, `seam-ssr-exposure.pin.test.ts:94` and `SyncPreviewStep.poll-disjointness.runtime.test.tsx:86`: five copies, so widening `SEAM_MODULES` is five edits including a security pin. Separately `resilient-fetch.wiring.test.ts` discovers literal `resilientFetch("key"` call sites over `src` (`:858-883`), pins B-15's `site` to `src/app/api/keys/[id]/rotate-secret/route.ts` (`:989`) and lists that file in `EXPECTED_SEAM_CALL_FILES` (`:1006-1014`).
**Recommended placement (Option X):** the seam call lives in `src/lib/analytics-client.ts` (already a seam module, already in `HAND_TYPED_LIB_MODULES`, already in `EXPECTED_SEAM_CALL_FILES`, already imported by create-with-key); `rotate-secret/route.ts` then imports `analytics-client` and stays on the edge. Census edits that remain: (1) wiring B-15 `site` becomes `src/lib/analytics-client.ts`; (2) `EXPECTED_SEAM_CALL_FILES` drops the rotate-secret route (one deletion); (3) `SEAM_ROUTE_BUDGETS` create-with-key row gains the `mt5-rotate` leg, and `EXPECTED_ROUTE_BUDGETS` in `seam-budgets.invariant.test.ts` gets its twin; (4) re-run the route-source pins in `rotate-secret/route.test.ts`. Verify that `discoverAnalyticsWrappers` does not treat `rotateKeySecret` as a wrapper: it keys on `analyticsRequest(` inside each `export async function` body (`wiring.test.ts:732-748`), and the new function calls `resilientFetch(` directly, so it should not.
**Fallback (Option L):** a new `src/lib/api/…` file holding both halves. Costs: widen `SEAM_MODULES` in five files, plus the wiring edits above, plus `HAND_TYPED_LIB_MODULES`/`EXPECTED_SEAM_FILES`. Not recommended.
**Also read before moving any rotate-secret line:** `dialog-envelope.invariant.test.ts` pins this route (`:250`) with a `code:`-first literal scan of its emitters; `rotate-secret/route.test.ts` reads the route SOURCE at `:426` (`interface RotateSecretBody { new_secret?: unknown; }`) and `:1339-1379` (contains `classifyKeyValidationError`, every `NextResponse.json(` has a `NO_STORE_HEADERS`). Keep every response literal in the route; move only the seam call and the UPDATE.
**Audit census:** `src/__tests__/audit-coverage.test.ts` walks one import hop from each route to find `.update(`/`.insert(` mutations and requires an audit call or `@audit-skip` in the enclosing function. Put `logAuditEvent(supabase, { action: "api_key.rotate_secret", entity_type: "api_key", entity_id })` in the SAME function as the `.update(…)` inside `persistRotatedMt5Secret`.

### Pitfall 4: `compare_digest` on `str` raises for non-ASCII
Encode both to UTF-8 bytes first. Compare verbatim (D-08: the MT5 investor password is never trimmed), AFTER the probe succeeds (so "unchanged" truthfully means "and it signs in", UI-SPEC A4 / §1.3 probe-then-compare variant).

### Pitfall 5: The null-server tier cannot be told it is the same server
The picker's tier 2 matches `sameVenueServer(row.venue_server, server)` where a null stored server is a wildcard (`[VERIFIED: src/lib/venue-identity.ts:110-113,129-141]`: `export function sameVenueServer(a: string | null, b: string | null): boolean { return a === null || b === null || a === b; }`). On that tier the seam probes the real server inside the ciphertext. Result: a right password is written and reported "updated" even if the user typed another server, and a wrong-server verdict would claim "you entered". **Avoid:** gate on `picked.venue_server !== null && picked.venue_server === venueServer` (the resolver can compute it: `picked` is in scope). Pin O1 with a test: a null-server holder takes today's refusal with zero seam calls.

### Pitfall 6: Deploy order, Vercel before Railway
New Next.js can run against the OLD Python service. A required `secret_changed` in `RotateSecretResponseSchema` would fail the existing rotate-secret parse in that window. The schema is a plain `z.object(...).extend(...)` (`[VERIFIED: src/lib/analytics-schemas.ts:117-119]`: `export const RotateSecretResponseSchema = EncryptKeyResponseSchema.extend({ venue_account_id: z.string(), });`), which strips unknown keys, so new-Python/old-Next is harmless. Use `secret_changed: z.boolean().optional()`. Semantics when absent, for create-with-key: persist (old rotate semantics always wrote) and report `updated`; the sentence "We updated the password on your key" is true because the ciphertext was rewritten with the typed password. rotate-secret ignores the field and still UPDATEs.

### Pitfall 7: Test harness cannot express the new arm
`create-with-key/route.test.ts` mocks `@/lib/analytics-client` with only `validateKey` and `encryptKey` (`:95-98`), has no `resilient-fetch` mock, its admin `update()` returns `{ eq: () => ({ eq: async () => ({ error: null }) }) }` (two `.eq`, no `.select`; `:694-720`), and answers a user-scoped `api_keys` read by `id` with the reuse-arm double (`:593-596`). The planner must extend the double: a `rotateKeySecret` mock on the analytics-client factory, a 3-`.eq` + `.select("id")` admin update double that records its filters, and a label-only user-scoped read branch (or reuse the existing `columns === "label, created_at"` branch by exporting a helper that selects exactly those two columns).

### Pitfall 8: The ruling reverses existing tests on purpose
These pin "refused by name BEFORE validate, zero writes" for MT5 same-account arms and must be rewritten as "now rotates" (not deleted): `route.test.ts` `:1875`, `:1937` (draft, zero writes), `:2010` (orphan before validate), `:2429` (orphan up front), `:2845`, `:2862` (orphan wins even with wrong credentials), `:3417` (working same-login same-server key past draft), `:3437` (null-server wildcard; becomes the O1 NEGATIVE control), plus the `validateKeyMock).not.toHaveBeenCalled()` assertions at the MT5 refusal sites (34 occurrences file-wide; most are non-MT5 or other arms and stay). Keep their body byte-pins by asserting the same refusal body with `key_secret` appended. Run the file after Wave 1 and list the reds before editing.

## Code Examples

### Python: `secret_changed` (insert after the success-shape assertion, before `encrypt_credentials`)
```python
# Source: this research; mirrors routers/internal.py:184 `secrets.compare_digest` idiom
# `_old_password` -> `old_password` (it is no longer discarded). UTF-8 bytes: compare_digest(str, str) raises TypeError on non-ASCII.
secret_changed = not secrets.compare_digest(
    old_password.encode("utf-8"), req.new_secret.encode("utf-8")
)
encrypted = encrypt_credentials(login, req.new_secret, broker_server, kek)
return {**encrypted, "venue_account_id": mt5_venue_account_id(login), "secret_changed": secret_changed}
```
Never log `old_password`, `req.new_secret` or the compare result alongside them. The returned dict stays `dict[str, Any]` so mypy strict is unaffected; `decrypt_credentials` returns `tuple[str, str, str | None]` (`[VERIFIED: analytics-service/services/encryption.py:92-95]`).

### TS: the new arm's skeleton (shape, not final code)
```ts
// inside the existing try, before validateKey
if (rotateTarget) {
  let admin; try { admin = createAdminClient(); } catch { return 503 SEAM_MISCONFIGURED (nothing written) }  // BEFORE the 120 s probe
  const keyRow = await readOwnKeyRow(supabase, user.id, rotateTarget.keyId); // user-scoped, RLS; fail closed
  const parsed = await rotateKeySecret({ keyId, userId: user.id, newSecret: apiSecretNormalized, correlationId }); // throws -> existing catch
  if (parsed.secret_changed === false) return refusal({ outcome: "unchanged", name });
  const persisted = await persistRotatedMt5Secret({ admin, supabase, userId: user.id, keyRow, parsed, newSecret: apiSecretNormalized });
  if (persisted.kind !== "ok") return /* roster-known failure, never "updated" */;
  return refusal({ outcome: "updated", name });
}
```

### Authz parity table (answers Q3)

| Check | rotate-secret (`route.ts` HEAD) | create-with-key rotate arm |
|---|---|---|
| CSRF | `assertSameOrigin(req)` first line (`:162`) | `withAuth` calls it for non-GET (`src/lib/api/withAuth.ts`) |
| Session | `supabase.auth.getUser()` 401 `DASHBOARD_SIGNED_OUT` (`:165-174`) | `withAuth` 401 |
| Approval | `approvalGate.assertProfileApproved` (`:176`) | `withAuth` default `requireApproval: true` |
| Owner-scoped read | user-scoped read of `api_keys` by id, `keyRow.user_id !== user.id` -> 404 (`:239-261`) | admin resolver read filtered on `user_id` (`readLiveSameLoginKeys` makes it mandatory) PLUS a user-scoped re-read of the holder row by id (RLS); failure or absent row fails toward today's refusal |
| `user_id` to the seam | `JSON.stringify({ new_secret, user_id: user.id })` (`:318`) | same, from `withAuth`'s session, never the body |
| UPDATE filter | `.eq("id", id).eq("user_id", user.id).eq("exchange", "mt5").select("id")` (`:554-557`) | same function |
| Zero rows | `DASHBOARD_WRITE_INDETERMINATE` 500 | `UNKNOWN` 500 (not on this roster otherwise), never "updated" |
| Rate limit | `keys-rotate-secret:${user.id}` after validation (`:274`) | none added: the request already spent `strategies-create-with-key:${user.id}` (`userActionLimiter = makeLimiter(5, "60 s")`, `src/lib/ratelimit.ts:97`). The seam's own per-key bucket (`_RATE_LIMIT_MAX = 10` / 60 s, `internal.py:123-124`) is shared with `get_key_permissions` (`:240`) and caps probes per key. State this choice in the plan; do not double-spend a token. |
| Audit | `logAuditEvent(supabase, { action: "api_key.rotate_secret", entity_type: "api_key", entity_id: id })` (`:665-669`) | the same call inside the shared persist function |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MT5 working-holder reconnect refused instantly, before the 120 s validate | validated and rotated in place | founder ruling 2026-11-26 | Reverses 212-03 SC5 for MT5; the route comment block at `route.ts:1642-1677` and the `[212-03]` tests must say so. |
| `KEY_ORPHANED` generic Disconnect line | the line names the key when the holder is a key | this phase | `formatKeyError` arm at `wizardErrors.ts:4988`; the table sentence at `:2851` stays byte-identical for the unnamed case. |

**Deprecated/outdated (comments to correct, not code):** the `create-with-key` docblock claiming `api_keys.venue_account_id` is not on the column-SELECT allowlist (`route.ts:115-125`) is stale: `supabase/migrations/20260920120000_api_keys_venue_account_id_grant.sql` grants it (header line: `-- Migration: GRANT SELECT (venue_account_id) ON api_keys TO authenticated`). rotate-secret's user-scoped read of `venue_account_id` (`rotate-secret/route.ts:239-243`) is a live proof. The planner should not rely on the docblock.

## Q6: Who writes `sync_status` for an MT5 key (the race, stated honestly)

The rotate UPDATE writes `sync_error: null, sync_status: "idle"` (`rotate-secret/route.ts:537-538`). A poll/sync that started with the OLD password can still write a failure afterwards. The writers, from `[VERIFIED: grep + Read of analytics-service/services/job_worker.py ~:15788-16055]` (`run_poll_allocator_positions_job`, def at `:15688`): the rate-limit arm (`:15804`, `rate_limited` or `error`), the transient/sign-in arm (`:15864`, `exc.sync_status`, which is where `sign_in_failed` is written), the generic error arm (`:15954`, `status_target`), the success arm (`:16019`, `final_status` plus `last_sync_at`), and the persist-error fallback (`:16047`, `error`). SQL writers of `'syncing'`: `request_allocator_holdings_sync` (latest definition in `supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql`, `UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;`). A working holder can be mid-`syncing` when the rotate lands: `isWorkingHolder` admits `syncing` (the not-working set is `revoked`, `sign_in_failed`, `error`, `[VERIFIED: src/lib/account-share-note.ts:79-83]`):
```
export const NOT_WORKING_SYNC_STATUSES: ReadonlySet<string> = new Set([
  "revoked",
  "sign_in_failed",
  "error",
]);
```
No fix is planned (CONTEXT defers it; 225-21 owns the poll writers). The plan and the CHANGELOG state: "a sync already running with the old password can mark the key failed after the rotate; the next sync clears it." Do not edit `job_worker.py` or `services/allocator_positions.py`.

## Q7: Censuses that move, and the minimal wire shape

Recommended wire: existing codes + `key_secret: { outcome, name? }` on the four 409 refusals (Pattern 2). Consequences:

| Census | Moves? | Why |
|---|---|---|
| `KNOWN_CREATE_WITH_KEY_CODES` (`wizardKeyRosters.ts`) | **No** | No new code. The four refusal codes are in `CREATE_WITH_KEY_OWN_CODES`; every seam refusal (`KEY_MT5_SIGN_IN_REFUSED`, `KEY_MT5_MASTER_PASSWORD`, `KEY_MT5_WRONG_SERVER`, `KEY_MUST_BE_RECONNECTED`, `KEY_AUTH_FAILED`, rate-limit, timeout) comes through the one shared classifier and `CLASSIFIER_RETURNED_CODES` (derived from `VENUE_WIRE_CODE_TO_VERDICT` plus `KEY_CLASSIFIER_CASCADE_CODES`). (Rows in `VENUE_WIRE_CODE_TO_VERDICT` were grep-seen, e.g. `wizardErrors.ts:5446`; planner re-Reads before relying on a specific row: A5.) |
| `wizardErrors.invariant.test.ts` (emitter scan, `EXPECTED_TABLE_SIZE`) | **No** if the rotate arm adds no `NextResponse.json({ code … })` literal. The builders gain a spread inside `extra`, built above the literal. Run it anyway. |
| `wizardKeyRosters.test.ts`, `wizardErrors.roster-render.test.tsx` | **No** | Same reason; the render scan at `:430`/`:1038` reads emitter literals. |
| `seam-wire-vocabulary.invariant.test.ts` | **No** | It tracks codes, not extra body keys. Run it. |
| Byte-pins in `create-with-key/route.test.ts` | Existing non-rotate pins unchanged (outcome undefined => identical bytes). New pins for the rotate arm bodies. The `⛔ NO ARM EVER ECHOES THE LOGIN` test (`:2203`) must be extended to the rotate arm. |
| `seam-retry-registry` / `resilient-fetch` registry (`SEAM_BUDGETS`, `RETRY_AUDIT`) | **No** | No new budget key: `keys-rotate-secret` exists and stays `retries: 0` (`retriesOverride: 0`). `RouteBudgetKey` list unchanged. |
| `SEAM_ROUTE_BUDGETS` + `EXPECTED_ROUTE_BUDGETS` | **Yes**: create-with-key row gains the `mt5-rotate` leg (Pitfall 1). |
| `resilient-fetch.wiring.test.ts` B-15 + `EXPECTED_SEAM_CALL_FILES` | **Yes** under Option X (Pitfall 3). |
| `limiter-ordering.test.ts`, `seam-ratelimit-posture`, `seam-log-coverage`, `seam-citations` | Run; expected unchanged (create-with-key stays on every roster; the rotate arm sits after `checkLimit`). Any new `catch` in the arm must pass the request's secrets to `scrubSeamError`. |
| `seam-constants.pin.test.ts` | Unchanged: `"keys-rotate-secret": 120_000`, retries `0` (`:125,:249`). |

## Q8: CONN-04 (KEY_ORPHANED names the key)

- The bullet is the third `fix` entry at `wizardErrors.ts:2851`, verbatim `[VERIFIED: src/lib/wizardErrors.ts:2851]`: "To connect this account with new credentials instead, choose “Disconnect” on that row. The stored key is kept on record but no longer used, and connecting the account again then works." It is not pinned verbatim in any test (grep of `src`: one hit, the table itself), so extracting it to a constant is safe.
- The holder arm already exists at `wizardErrors.ts:4988` (`if (code === "KEY_ORPHANED" && context?.holder?.kind === "key") { … return { ...base, cause: … } }`). Add the named bullet there: `fix: base.fix.map((f) => f === KEY_ORPHANED_DISCONNECT_FIX ? named(context.holder.name) : f)`, with the unnamed sentence held once as a constant used by the table (so the unnamed case stays byte-identical) and `named(name)` building `…choose “Disconnect” on the row for your key “${name}”. The stored key is kept on record but no longer used, and connecting the account again then works.` (UI-SPEC §3). Holder `kind === "strategy"`, absent holder, blank name: today's sentence (`parseAccountHolder` already drops blank names, `own-account-holder.ts:180-192`). Identify the bullet by content, not index.
- **Role test.** The route never reads `profiles` (grep of `route.ts`: no `profiles` read; `assertProfileApproved` is stubbed in `src/test-setup.ts` per `withAuth.ts:62-65`). A role parameter is therefore decorative unless the test also asserts that no `profiles` read happens. Shape: `it.each(["allocator","manager","both"])` seeds a profile role in the supabase double (add a `profiles` branch to `makeSelectBuilder` that records reads), drives `KEY_ORPHANED` with a key holder, and asserts (a) the three response bodies are byte-equal and carry `holder.name`, (b) zero `profiles` reads. PROOF-01 neuters: (i) `keyOrphanedResponse(venueMatch.holder)` -> `keyOrphanedResponse()` (named answer lost: RED on the arm name), (ii) add a `profiles` read to the route (role-invariance guard RED). The H-0306 describe (`:4917`) shows how to swap the `withAuth` mock via `vi.doMock` + `vi.importActual` if a real-withAuth profile read is wanted; the bypass mock is enough for the parity assertion.
- Client rendering test: `ConnectKeyStep.test.tsx:2299` is the existing KEY_ORPHANED holder render test (`holder: { kind: "key", name: "Test", … }`); extend it with the named bullet, and add the strategy-holder and no-holder byte-identical cases. `formatKeyError` unit tests belong next to the other holder arms in `wizardErrors.test.ts`.
- Disconnect safety for an allocator is measured in CONTEXT (the `/strategies` row calls `disconnect_allocator_api_key`); not re-measured here.

## Q9: The F6 strip

`WizardClient.tsx`: the strip is gated `dedupedExisting && step === "sync_preview"` (`:1399`), `data-testid="wizard-dedup-notice"`, classes `mb-4 rounded-md border border-border bg-page px-3 py-2 text-caption text-text-secondary`; the fallback branch is the third arm of the ternary at `:1404-1408` (`dedupedKeptDraft` ? … : `dedupedHeldOnly` ? … : fallback). Replace only the fallback string with UI-SPEC §2's sentence: "We continued with the strategy this setup already created, on the key it was first connected with. The details you just entered did not change that key. To connect different credentials, delete this draft first." Tests that hard-code the old copy and must change: `WizardClient.test.tsx:923` (`DEDUP_COPY`, the 154-06 describe, asserts it renders) and `:1001` (`OLD_COPY`, the 213 describe, asserts it is ABSENT: keep as an absence pin, now genuinely discriminating). Add: the fallback test asserts the new sentence and that `already connected`, `checked` and `not saved` are absent; the two other branches' tests (`KEPT_COPY` `:1002`, `HELD_ONLY_COPY` `:1034`) stay byte-identical. The docblock at `:375` and `ConnectKeyStep.tsx:1364` quote the old sentence in comments; update them in the same edit so no comment claims the retired copy. `ContributionWizardOverlay.preselect.test.tsx:339-341` only asserts the strip is absent on the preselect arm; unchanged.

## Q5 summary: deadlines
- `create-with-key` `export const maxDuration = 300;` (`route.ts:92`). `keys-rotate-secret`: `timeoutMs: 120_000`, `dependencies: ["mt5-gateway"]` (`resilient-fetch.ts:802-816`), called with `retriesOverride: 0`. Browser: `connectAbortDeadlineMsFor` = validate + `ENCRYPT_KEY_BUDGET_MS` (30 000) + `BREAKER_STORE_WORST_CASE_FAILING_MS` (25 500) + `WAIT_ABORT_GRACE_MS` (15 000); serialized (MT5) = 190 500 ms (`validate-budget.ts:65,138,151,192,246`). `SEAM_DEADLINE_EXCEEDED` is raised in the browser (`ConnectKeyStep` abort `deadline` arm) and its copy ends "Nothing was saved — your key was not stored"; neither route reads `request.signal`, so an abort stops the browser listening, not the server.
- Conclusion: the pre-fence rotate arm (132 750 ms failing) fits inside 190 500 with 57 750 ms of margin for non-seam work, so the deadline answer remains true on this arm as long as the arm spends exactly ONE seam leg. Post-validation rotate would not (Pitfall 1). The browser deadline function and its copy do NOT change.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The null-server tier should be excluded (rotate only when `picked.venue_server` is non-null and equals the typed normalised server). This NARROWS CONTEXT's server rule, which the planner may narrow. | Pitfall 5, Open Q1 | If the founder wants legacy null-server keys rotated too, an expected-server check must be added to the Python seam (optional `expected_server`, compared after normalisation, before the probe), a bigger Python change. |
| A2 | `held` from a failing holder with a composite dependent does not rotate (not a working holder, CONTEXT's set). | Pitfall 2 | If the founder wants it rotated, `rotate` must also be set on that path; the `[WR-06]` tests change. |
| A3 | Prevalence of MT5 keys with `venue_server IS NULL` on PROD is unknown to this research (no DB access). Under A1 they keep today's refusal, so this only sizes how often the old refusal still shows. | Open Q1 | Under-sizes the user impact of A1. |
| A4 | An absent `secret_changed` (old Python) is reported as `updated` after a write. | Pitfall 6 | Marginally wrong only if the typed password equalled the stored one during the deploy window. |
| A5 | `VENUE_WIRE_CODE_TO_VERDICT` rows (`MT5_SIGN_IN_REFUSED` -> `KEY_MT5_SIGN_IN_REFUSED` 424, `KEY_UNDECRYPTABLE` -> `KEY_MUST_BE_RECONNECTED`) and `RETRY_AUDIT` membership were seen by grep, not Read this session. | Q7 | A seam refusal code missing from the create-with-key roster would render `UNKNOWN` with a Retry. Wave 0 asserts every code the rotate path can classify to is in `KNOWN_CREATE_WITH_KEY_CODES`. |
| A6 | `ruff` is not a CI gate: `grep -rn ruff .github/workflows` returned nothing and no ruff config was found in `pyproject.toml`/`Makefile`. Reported as an observation (no ruff step seen), not as a proof of absence. Run `ruff check` on touched Python files as hygiene only. | Validation | If a ruff step exists elsewhere, an unlinted Python edit fails CI. |
| A7 | The census edit list (Pitfall 3, Q7) is derived from reading the test sources, not from running them. | Pitfall 3 | An unlisted census reds; Wave 0 must run the whole seam census set after the extraction. |
| A8 | Returning HTTP 409 for the `updated` outcome is acceptable to SLO/monitoring consumers (the body is a refusal-with-outcome by the founder's ruling). | Pattern 2 | Dashboards that count 409s as user-fault refusals will count successful password updates. Record in CHANGELOG `### Notes`. |

## Open Questions

1. **Null-server tier (recommend: exact-server only).**
   - Known: the picker's tier 2 admits a null stored server as a wildcard; the seam probes the server inside the ciphertext, not the typed one. O1's "you entered" is true only on an exact match.
   - Unclear: how many PROD MT5 keys still have `venue_server IS NULL`.
   - Recommendation: exact tier only; read the PROD count via MCP (reads authorized, marker query first) before the plan commits, to size how often the old refusal remains. Alternative if the count is material: optional `expected_server` in the seam.
2. **Does a failing holder with a composite dependent rotate?** Recommendation: no (A2). Its remedy is the key card's existing "Update password" dialog.
3. **Which `held` producers are in scope?** Only the working-holder producer (Pattern 1). Record the final set in the plan as the founder asked.
4. **Helper placement.** Option X recommended (Pitfall 3). Confirm by running the seam census set once after the extraction, before building the arm.
5. **TODOS bookkeeping:** delete `C-2 / A-4`; edit `[167.1.2-ORPHAN-COPY-FIX]` down to the archived case; name both in the CHANGELOG.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | vitest, tsc | yes | v25.8.1 | n/a |
| `node_modules` in the 228 worktree | any vitest/tsc run here | **no** (`ls node_modules` fails) | n/a | the main checkout has `node_modules/.bin/vitest` (`/Users/helios-mammut/claude-projects/quantalyze/node_modules`); run `npm ci` in the worktree, or point a one-off `vitest` run at the main checkout's binary. Do not symlink over uncommitted work. |
| pytest | Python tests | yes | 9.0.2 (baseline: `tests/test_mt5_rotate_secret_internal.py` 23 passed in 11 s from `analytics-service/`) | n/a |
| mypy | Python type gate | yes | 2.0.0 | n/a |
| ruff | hygiene only | yes | 0.15.7 | n/a |
| Docker / Supabase local stack | not needed (no SQL) | not probed | n/a | n/a |

**Missing dependencies with no fallback:** none. **With fallback:** worktree `node_modules`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS), pytest 9 + mypy `--strict` (Python) |
| Config file | `vitest.config.ts` (repo root), `analytics-service/pytest.ini` + `pyproject.toml [tool.mypy]` |
| Quick run command | `npx vitest run "src/app/api/strategies/create-with-key/route.test.ts"` (single file); `cd analytics-service && python3 -m pytest tests/test_mt5_rotate_secret_internal.py -q` |
| Full suite command | `npm run test` (not needed locally); census set: `npx vitest run src/lib/seam-budgets.invariant.test.ts src/lib/resilient-fetch.wiring.test.ts src/lib/seam-log-coverage.test.ts src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/dialog-envelope.invariant.test.ts src/lib/wizardErrors.invariant.test.ts src/lib/wizardKeyRosters.test.ts src/lib/seam-wire-vocabulary.invariant.test.ts src/lib/api/limiter-ordering.test.ts src/__tests__/audit-coverage.test.ts` |

### Phase Requirements -> Test Map
Every row lists its PROOF-01 neuter: edit the named target, see RED with the named arm first, restore from the byte backup (`cp` back, `cmp`), see GREEN, and paste the output into the plan SUMMARY.

| Req ID / SC | Behaviour | Test Type | Automated Command | File Exists? | Neuter (RED when…) |
|-------------|-----------|-----------|-------------------|--------------|--------------------|
| CONN-02 / SC-1 | `connected` + new valid password: seam called with the holder's key id, typed password verbatim, `user_id`; ONE admin UPDATE filtered on `id`+`user_id`+`exchange='mt5'` with the seam ciphertext; 409 `VENUE_ALREADY_CONNECTED` body carries `key_secret:{outcome:"updated",name:<label>}` | route unit | `vitest run …/create-with-key/route.test.ts -t "228"` | ❌ Wave 0 (extend double) | replace the rotate call with `return refusal` (old behaviour) |
| CONN-02 / SC-1 | same for `orphaned`, `held` (working), other-session `draft` (four named arms) | route unit | same | ❌ | neuter each arm's `rotate` assignment in the resolver |
| CONN-02 / SC-1 | UPDATE filter triple is exact: drop `.eq("user_id", …)` -> RED naming the filter arm | route unit (records filters) | same | ❌ | delete `.eq("user_id", userId)` in `persistRotatedMt5Secret` |
| CONN-02 / SC-1 | `secret_changed:false` -> ZERO UPDATEs, outcome `unchanged`, no ciphertext written | route unit | same | ❌ | ignore `secret_changed` (always write) |
| CONN-02 / SC-1 | mistyped password: seam throws `AUTH_FAILED` / master password / wrong server -> classifier code, **no `key_secret`, zero UPDATEs, zero audit** (O3) | route unit, `it.each` over the three details | same | ❌ | wrap the seam call in a swallowing try (writes anyway) |
| CONN-02 | UPDATE failure after seam success: never `updated` (`UNKNOWN` 500); zero rows -> same; missing service credential -> 503 `SEAM_MISCONFIGURED` BEFORE the seam call (assert `rotateKeySecret` not called) | route unit | same | ❌ | map the failure to the `updated` answer |
| CONN-02 / O1 | null-server holder (tier 2) and different-server holder: today's refusal byte-identical, zero seam calls | route unit | same | ❌ (rewrite of `:3437`) | drop the `picked.venue_server === venueServer` gate |
| CONN-02 / Pitfall 2 | failing holder + composite dependent: byte-identical `KEY_VENUE_ALREADY_CONNECTED`, zero seam calls | route unit | existing `[WR-06]` describe + assertion | partial | set `rotate` on the `:372` path |
| CONN-02 | `failing_holder` keeps the 225-07 swap path; post-validation `connected`/`orphaned` arms and the 23505 race arm unchanged (no rotate) | route unit | existing 225-07/225-11 describes | ✅ (assert `rotateKeySecret` not called) | add a rotate to the post-validation arm |
| CONN-02 / G1 | no login, server, key id, password or ciphertext in the response body, logs or Sentry `extra` on the rotate arm | route unit (extend `:2203`) | same | ❌ | add `venue_account_id` to the body |
| CONN-02 / O2, O4 | `mt5-rotate` branch worst case < `connectAbortDeadlineMsFor("mt5") - WAIT_ABORT_GRACE_MS`; rotate budget <= validate-serialized budget and equal retries; double run: second is `unchanged`, one UPDATE | invariant + route unit | seam census set; `vitest run …/seam-budgets.invariant.test.ts` | ❌ extend | raise `keys-rotate-secret.timeoutMs` above the serialized budget |
| CONN-02 | helper moved without behaviour change: the whole existing `rotate-secret/route.test.ts` (56 `it` blocks) passes UNCHANGED | route unit | `vitest run "src/app/api/keys/[id]/rotate-secret/route.test.ts"` | ✅ | n/a (regression gate, must be GREEN untouched) |
| CONN-02 | Python: `secret_changed` True/False, non-ASCII password compare does not raise, neither password in the body, probe still runs first | pytest | `cd analytics-service && python3 -m pytest tests/test_mt5_rotate_secret_internal.py -q` plus `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | ❌ extend | swap `secrets.compare_digest` for `==` / drop the `.encode` |
| CONN-02 | TS schema: `secret_changed` optional; absent parses and is treated as changed | unit | add to `analytics-schemas` test or the helper test | ❌ | make it required |
| CONN-02 / UI-SPEC T1-T6 | notice renders exact sentence for `updated`/`unchanged`, named and unnamed; `data-outcome`; DOM order before `error-envelope`; no notice on a seam refusal; cleared on submit and on Retry; always-mounted `LiveRegion`; no role on the `<p>`; no login/server/key id in text/attrs | component (`ConnectKeyStep.test.tsx`) | `vitest run "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx" -t "228"` | ❌ | drop `name` from the response / drop the clear in `handleSubmit` |
| CONN-02 / T7 | F6 fallback new sentence; the other two branches byte-identical; `already connected`, `checked`, `not saved` absent | component (`WizardClient.test.tsx`) | `vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` | ✅ edit `:923`,`:1001` | restore the old fallback string |
| CONN-04 / SC-2 | `KEY_ORPHANED` with a key holder: named bullet, identical for allocator, manager, `both`; zero `profiles` reads; no holder / strategy holder / blank name: today's bullet byte-identical | route unit + `formatKeyError` unit + `ConnectKeyStep` render | the three files above | ❌ | `keyOrphanedResponse()` without the holder; drop the `.map` in the holder arm |
| SC-3 | PROOF-01 transcript for every row above | process | n/a | n/a | recorded verbatim in the plan SUMMARY |

### Sampling Rate
- **Per task commit:** the single touched test file (vitest) or `pytest tests/test_mt5_rotate_secret_internal.py -q`.
- **Per wave merge:** the census set above, `npx tsc --noEmit`, `eslint` on touched files, mypy strict on `analytics-service`.
- **Phase gate:** full CI green bound to the head SHA with the expected check count before `/gsd-verify-work`. Manual backstop (UI-SPEC): 320 px reflow row of `e2e/reflow-sweep-authed.spec.ts` with the notice and envelope both rendered; axe zero violations on `/strategies/new/wizard`.

### Wave 0 Gaps
- [ ] Extend the `create-with-key/route.test.ts` doubles: a `rotateKeySecret` mock on the analytics-client factory, a 3-`.eq` + `.select("id")` admin update double that records filters, a label-only user-scoped read branch, a `profiles` read recorder.
- [ ] Enumerate the red tests the ruling causes (Pitfall 8) BEFORE editing them, and rewrite them in the same wave as the arm.
- [ ] New helper test file `src/lib/api/rotate-key-secret.test.ts` (typed outcomes, filter triple, backfill rule, audit in the same function) and a `key-secret-outcome` parse test (rejects an unknown outcome, a blank name, a non-string name).
- [ ] Python tests in `tests/test_mt5_rotate_secret_internal.py` for `secret_changed`.
- [ ] Worktree `node_modules` (Environment Availability).
- [ ] Assert every code the rotate path can classify to is a member of `KNOWN_CREATE_WITH_KEY_CODES` (closes A5).

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (a connect request now changes a credential) | `withAuth` session + approval gate; the typed password is only ever sent to the Python seam; Python plaintext never leaves that service |
| V3 Session Management | yes | CSRF `assertSameOrigin` via `withAuth` |
| V4 Access Control | yes (the review focus) | owner filter on every read and on the UPDATE (`id` + `user_id` + `exchange='mt5'`); `user_id` also sent to the seam as the owner-scoping depth; admin client crosses RLS, so the explicit filter IS the tenant boundary; a user-scoped re-read proves ownership through RLS and fails toward the refusal |
| V5 Input Validation | yes | existing MT5 three-slot guards, server normalisation, length caps, and the `key_secret` shape-check on the client (`outcome` closed set, `name` non-blank string, never an href) |
| V6 Cryptography | yes | never hand-roll: ciphertext produced by the Python `encrypt_credentials`; equality via `secrets.compare_digest` on UTF-8 bytes |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Password oracle: use the connect route to test passwords against another user's key id | Spoofing / Info disclosure | the key id never comes from the body; it comes from the owner-filtered resolver; the seam also receives `user_id` and 404s a mismatched owner before any decrypt |
| Brute-forcing the user's own MT5 password through repeated connects | Elevation | `userActionLimiter` 5/60 s per user, plus the seam's per-key bucket (10/60 s) |
| Credential or identifier leak via logs/Sentry/response | Info disclosure | every `scrubSeamError`/`captureToSentry` call names the typed password, login, server and `venueAccountId`; the response carries only the key's label; G1 test |
| Write after a "nothing saved" claim | Repudiation | pre-fence only; one seam leg; browser deadline derived from the serialized arm; O2/O4 pins |
| Wrong-account write via a null-server wildcard | Tampering | exact-server tier only (A1) |
| Writing on any seam refusal | Tampering | typed outcomes; the persist helper is only reachable after a parsed success; O3 test asserts zero UPDATEs on each refusal |
| A sync racing the UPDATE | Tampering (availability) | accepted limit, recorded (Q6) |

## Sources

### Primary (HIGH confidence): Read this session at HEAD `fb28589f7`
- `src/app/api/strategies/create-with-key/route.ts` (:80-1040 in part, :1226-1900, :1990-2170, :2400-2565): resolver, builders, fence, pre/post-validation arms, catch.
- `src/app/api/keys/[id]/rotate-secret/route.ts` (whole file).
- `src/lib/own-account-holder.ts`, `src/lib/venue-identity.ts` (whole files); `src/lib/account-share-note.ts` (:70-126).
- `analytics-service/routers/internal.py` (:540-797); `src/lib/analytics-schemas.ts` (:100-147).
- `src/lib/wizardKeyRosters.ts` (:1-200); `src/lib/wizardErrors.ts` (:1940-1985, :2825-2900, :4780-5080, :6165-6182).
- `src/lib/wizard/validate-budget.ts` (:1-290); `src/lib/analytics-client.ts` (:760-900).
- `src/lib/seam-budgets.invariant.test.ts` (:60-200, :380-830, :1030-1135, :1230-1640); `src/lib/resilient-fetch.wiring.test.ts` (:855-1070); `src/lib/seam-log-coverage.test.ts` (:150-260); `src/lib/dialog-envelope.invariant.test.ts` (:225-275).
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (:360-392, :1385-1420) and `WizardClient.test.tsx` (:905-1060); `ConnectKeyStep.tsx` (:215-330, :1085-1330) and `ConnectKeyStep.test.tsx` (:2270-2420).
- `src/app/api/strategies/create-with-key/route.test.ts` (doubles :55-760, describe map by grep); `src/app/api/keys/[id]/rotate-secret/route.test.ts` (:415-470, :595-625, :1320-1379); `analytics-service/tests/test_mt5_rotate_secret_internal.py` (:40-170).
- `.planning/phases/228-…/228-CONTEXT.md`, `228-UI-SPEC.md`; `.planning/ROADMAP.md` `### Phase 228`.

### Secondary (MEDIUM confidence): grep-measured only
- `job_worker.py` writers of `api_keys.sync_status` (Q6), `request_allocator_holdings_sync` migrations, `VENUE_WIRE_CODE_TO_VERDICT` rows, TODOS entry locations, `audit-coverage.test.ts` walk description, `seam-ratelimit-posture` roster lines.

### Tertiary (LOW confidence)
- None used. No web or Context7 lookup was needed: every question is about in-repo code; no external library is introduced.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependency.
- Architecture (arms, resolver member, wire shape, budget arithmetic): HIGH for what was Read; the budget figures are hand-computed from constants read in `validate-budget.ts` and the invariant file's own derivation.
- Census edits: MEDIUM, derived from test sources, not executed (no `node_modules`).
- Pitfalls: HIGH for 1, 2, 4, 5, 6; MEDIUM for 3, 7, 8 (need a measured Wave 0 run).

**Research date:** 2026-11-26
**Valid until:** 2026-12-03 (fast-moving: Phase 225-21 edits the poll stamper in parallel and `create-with-key/route.ts` line numbers drift; re-anchor by symbol).
