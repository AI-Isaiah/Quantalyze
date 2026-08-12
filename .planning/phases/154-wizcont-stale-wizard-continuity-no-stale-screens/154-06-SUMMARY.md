---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 06
subsystem: api
tags: [wizard, idempotency, dedup, mt5, postgres-23505, security, service-role, ui-strip]

# Dependency graph
requires:
  - phase: 154-03
    provides: "api_keys.venue_account_id, the LIVE-scoped partial UNIQUE api_keys_user_exchange_venue_account_uniq, the scrub trigger, and create_wizard_strategy's 12th parameter — all applied to PROD and TEST 2026-08-12"
  - phase: 153.6-parity-the-fixes-that-only-landed-on-one-path
    provides: "finalize-wizard/route.ts:1223 — the precedent for reading a non-allowlisted api_keys column (attested_venue) through createAdminClient()"
provides:
  - "create-with-key's second fence key: a token-less MT5 re-connect resolves to the EXISTING (strategy, api_key) pair, read-only"
  - "src/lib/api/pgConstraintName.ts — the shared 23505 constraint-name leaf both wizard-write routes read"
  - "constraint-name discrimination on BOTH 23505 arms (TWIN-8 closed)"
  - "the UI-SPEC State Contract 4 dedup strip, rendered in WizardClient's chrome"
  - "ConnectKeySuccess.deduped — the marker the step reports upward"
affects: [156-connect-refactor, 154-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constraint-name discrimination on 23505, parsed from `message` only — never `details`, which embeds client-supplied key values"
    - "Owner-filtered service-role READ for a column outside the api_keys SELECT allowlist (the 153.6 finalize-wizard precedent)"

key-files:
  created:
    - src/lib/api/pgConstraintName.ts
    - src/lib/api/pgConstraintName.test.ts
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/composite/add-key/route.ts
    - src/app/api/strategies/composite/add-key/route.test.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The venue-identity fence reads via createAdminClient() because venue_account_id is NOT on the api_keys column-SELECT allowlist and Postgres requires SELECT privilege on every REFERENCED column — the user-scoped client would 42501 on every call"
  - "The app fence filters `disconnected_at IS NULL`, mirroring the LIVE-scoped index predicate — the plan text described the older lifecycle-blind predicate"
  - "pgConstraintName parses `message` only; `details` embeds the offending key values (the MT5 login), which is both an identity-echo hazard and a client-controlled input to a control decision"
  - "The dedup strip lives in WizardClient's chrome, NOT in ConnectKeyStep as planned — onSuccess IS the step advance, so a strip inside ConnectKeyStep could never paint"
  - "An unrecognised 23505 constraint answers 500 + Sentry, never the wrong 409; an UNPARSEABLE one keeps the byte-identical pre-154 409"
  - "The venue-identity arm on composite/add-key is alarm-only (500 + Sentry), because that constraint is unreachable there today (TWIN-7)"

requirements-completed: [WIZCONT-02]

# Metrics
duration: ~55min
completed: 2026-08-12
---

# Phase 154 Plan 06: WIZCONT-02 Application Layer Summary

**A token-less MT5 re-connect now resolves to the strategy the user already had — read-only, with one
neutral line explaining it — and a 23505 stopped being one fact on both wizard-write routes.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 of 3
- **Files:** 11 (2 created, 9 modified)
- **Tests:** 285 passing across the 6 touched suites (97 create-with-key, 74 add-key, 66
  ConnectKeyStep, 30 WizardClient, 8 pgConstraintName, plus the composite harness)

## Commits

| Commit | What |
|---|---|
| `0b92ada0` | `pgConstraintName` — the shared 23505 leaf + 8 tests |
| `bac9a981` | Task 1 — the second fence key, RPC threading, 23505 discrimination |
| `64f88b98` | Task 2 — TWIN-8 closed on `composite/add-key` |
| `9e45b11c` | Task 3 — the dedup strip, the `deduped` marker, REQUIREMENTS residuals |

## Accomplishments

### Task 1 — one fence, two keys (`bac9a981`)

`resolveByVenueIdentity()` sits beside the `wizard_session_id` fence and asks the question that fence
cannot: *does this user already have a LIVE key for this exact venue account, with a strategy on it?*
A hit returns the existing `{strategy_id, api_key_id}` plus an additive `deduped: true`, with
`NO_STORE_HEADERS`. It **only ever reads** — the existing `api_keys` row carries `strategy_keys`
membership and synced history, so nothing is overwritten. A failed read logs and falls through to the
RPC exactly as the session fence does; the DB index is still the backstop.

`p_venue_account_id` is threaded as the 12th RPC parameter, **omitted** rather than nulled for
non-MT5 venues so the wire is byte-identical for everything else.

### Task 2 — TWIN-8 closed (`64f88b98`)

Both routes now branch on the constraint name. `composite/add-key`'s venue-identity arm is
deliberately **alarm-only** (500 + Sentry): `add_wizard_composite_key` writes no `venue_account_id`
(TWIN-7) and MT5 cannot be a composite member, so that constraint firing there would mean a premise
changed — worth an alarm, not a silent 409. The reason is stated in the code, not just here.

### Task 3 — the notice, where it can be seen (`9e45b11c`)

The UI-SPEC State Contract 4 strip, in the session-expired strip's exact tokens
(`rounded-md border border-border bg-page px-3 py-2 text-caption text-text-secondary`), verbatim copy,
`data-testid="wizard-dedup-notice"`, gated on `sync_preview` — the step the dedup lands the user on.

## Deviations from Plan

### 1. [Rule 3 — Blocking] The fence CANNOT read `venue_account_id` on the user-scoped client

- **Found during:** Task 1, before writing any code.
- **Issue:** the plan specifies the fence as `supabase.from("api_keys")…eq("venue_account_id", …)` on
  the **user-scoped** client. `venue_account_id` is **not on the `api_keys` SELECT allowlist** —
  `20260410225608` revoked table-level SELECT from `authenticated` and granted back a named list,
  extended since by exactly three columns (`sync_error`, `last_429_at`, `disconnected_at`).
  PostgreSQL requires SELECT privilege on **every column a query references, a `WHERE` filter
  included**. So that read does not degrade — it answers 42501 on *every* call, the fence
  log-and-falls-through forever, and the 23505 race arm (which re-runs the same read) can never
  resolve either. Shipped as written, **every token-less MT5 re-connect would have hit a
  409 `DRAFT_ALREADY_EXISTS` and the user would have been hard-blocked from re-connecting** — worse
  than the duplicate the plan set out to prevent. The migration's own COMMENT records the
  non-readability as a *feature* ("not readable by anon/authenticated anyway"); nobody noticed it also
  closes the door on the app fence.
- **Fix:** the key read goes through `createAdminClient()`, owner-filtered. This is **not a new
  posture** — it is the established pattern for exactly this column class in exactly this flow:
  `finalize-wizard/route.ts:1223` reads the sibling non-allowlisted `attested_venue` the same way
  (153.6-04 / PARITY-04, shipped in PR #675). ⛔ **No SQL was authored** and no GRANT was widened.
- **Scoped tightly:** one `id` column; `.eq("user_id", user.id)` is load-bearing because the admin
  client bypasses RLS, and that value comes from `withAuth`'s session, never the body; the follow-up
  `strategies` read stays on the **user-scoped** client so the returned row passes through RLS as
  defence in depth; `createAdminClient()` throwing (no `SUPABASE_SERVICE_ROLE_KEY`) is caught and
  degrades to a dark fence, never a failed submit.
- **Recorded** as the third residual in REQUIREMENTS.md. Phase 156 absorbs it when the whole INSERT
  moves behind the service-role writer.

### 2. [Rule 1 — Bug] The planned strip location could never render

- **Found during:** Task 3.
- **Issue:** the plan puts the strip in `ConnectKeyStep.tsx`. But the dedup arrives on the **success**
  path, and success calls `onSuccess`, which is `WizardClient.handleConnectSuccess` →
  `setStep("sync_preview")`. Both state updates batch into one commit, so `ConnectKeyStep` **unmounts
  before the strip could paint a single frame**. Worse, a unit test in `ConnectKeyStep.test.tsx` would
  have passed anyway, because its `onSuccess` is an inert `vi.fn()` that advances nothing — green test
  over dead UI.
- **Fix:** `ConnectKeySuccess` gained an optional `deduped` marker; the strip renders in
  `WizardClient`'s chrome **beside the session-expired strip that UI-SPEC's own Component Inventory
  names as its visual donor**. Rendering is pinned in `WizardClient.test.tsx`, which drives the real
  parent and therefore the real step change.
- **Out-of-plan file touched:** `WizardClient.tsx` / `WizardClient.test.tsx` (see the conflict warning
  below). The ordinary payload stays byte-identical — a conditional spread, not `deduped: false` —
  which the pre-existing exact-match assertion at `ConnectKeyStep.test.tsx:144` would otherwise have
  reddened.

### 3. [Rule 2 — Security] `pgConstraintName` parses `message` only, never `details`

- **Issue:** the plan says to branch on the name "parsed from `error.message`/`error.details`". A
  `unique_violation`'s `details` is `Key (user_id, exchange, venue_account_id)=(…, mt5, 5551234)
  already exists.` — it embeds the **offending key values**, which for this index is the MT5 login.
  Reading it makes the control's input **partly client-supplied**: a caller who put
  `constraint "strategies_user_wizard_session_source_uniq"` inside their login would steer which arm
  answers them. It also drags the identity into anything derived from the return value.
- **Fix:** `message` only (Postgres composes it from catalog names, no row data). Both halves are
  asserted: a name present only in `details` is not found, and a crafted `details` cannot override the
  real name in `message`.

### 4. [Rule 2 — Security] The 23505 log line gained this request's secrets

- **Issue:** `console.error("… RPC error:", scrubSeamError(error), error.code)` renders a plain
  PostgREST error's `details` (it is in `PLAIN_OBJECT_DIAGNOSTIC_KEYS`). With the new index, that puts
  the MT5 login in the server log — and the plan forbids `venueAccountId` in console logs.
- **Fix:** the call site now passes `[api_key, apiSecretNormalized, passphraseOrNull, venueAccountId]`.
  ⭐ Verified this actually works rather than assuming: `MIN_REDACTABLE_SECRET_LENGTH` (12) is checked
  **only for ENV candidates** (`seam-redaction.ts:281-292`), so a 6-digit per-request login is
  genuinely redacted, not merely reported as unredactable. `venueAccountId` is listed **separately**
  from `api_key` because it is the *trimmed* value — a login submitted as `" 5551234 "` is stored and
  echoed as `5551234`, which the untrimmed candidate would not substring-match.

### 5. [Rule 1 — Bug] The `disconnected_at` filter the plan's fence omits

The plan's `<interfaces>` block describes the **superseded** index predicate
(`WHERE venue_account_id IS NOT NULL`). The live one is LIVE-scoped
(`… AND disconnected_at IS NULL`, the migration's HIGH-1 amendment). An app fence blind to that would
hand a re-connecting user a **soft-disconnected key that every cron dispatcher skips** — a strategy
that silently never syncs, which the migration header calls out as *worse than the duplicate the index
prevents*. The fence filters `.is("disconnected_at", null)`, pinned by a filter-equality assertion.

## ⚠️ Merge-conflict warning for the orchestrator

**`154-05` (wave 2, WIZCONT-01) declares `WizardClient.tsx` and `WizardClient.test.tsx` in its own
`files_modified`, and so does this plan now (deviation 2).** My edits are in three places:

1. the `dedupedExisting` state declaration beside `sessionExpired` (~:268),
2. one line in `handleConnectSuccess`,
3. the strip JSX **immediately above the `showResumeBanner && initialDraft` block** — which is exactly
   the region 154-05 exists to change.

Site 3 is the likely conflict. Resolution is additive in both directions: keep both strips, mine
first, and keep 154-05's resume banner unchanged. In `WizardClient.test.tsx` I added a
`connect-success-deduped` button to the `MultiKeyConnectStep` mock and `deduped?: boolean` to that
mock's prop type; both are additive.

## SC-3 falsifiability mutations (for 154-08 to transcribe)

All three run against the committed state and restored with `git checkout --`; `grep -rn MUTANT src/`
→ **0**, `git status --short` → clean.

**Mutant A — drop the venue-identity arm from the fence** (`if (venueAccountId)` → `if (false)`):

```
× THE BUG: same MT5 login + a DIFFERENT wizard_session_id resolves to the EXISTING row, not a second draft
× FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes and never re-encrypts
× reads the LIVE row only — the fence filters disconnected_at IS NULL, mirroring the index predicate
× trims the login so a stray space cannot make the dedup MISS (agrees with the RPC's NULLIF(btrim(…)))
× a fence READ FAULT falls through to the RPC and never 500s (the DB index still dedups)
× a MISSING service-role credential degrades to a dark fence, never to a failed submit
× venue-identity constraint + resolvable → 200 deduped with the EXISTING ids
Tests  7 failed | 90 passed (97)
```

**Mutant B — make the dedup path write** (an UPDATE on the resolved row before returning):

```
× FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes and never re-encrypts
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
Tests  1 failed | 96 passed (97)
```

**Mutant C — delete the dedup strip** (added for deviation 2, since the strip moved files):

```
× renders the neutral strip after a connect the server resolved onto the existing strategy
× is NEUTRAL, not an error: no ErrorEnvelope, and none of the warning/negative tokens
× is SELF-CLEARING: a later ordinary connect takes the notice down
Tests  3 failed | 27 passed (30)
```

**The third mutation the plan names — index predicate made total — was NOT re-run here.** It is a SQL
concern already pinned by 154-03's gate (`supabase/tests/test_api_keys_venue_identity_uniq.sql`
asserts the predicate TEXT, not merely that a partial index by that name exists), and this plan
authored no DDL.

## Pre-existing failures observed (NOT mine, not fixed)

Running the whole wizard directory shows **4 failures in
`SyncPreviewStep.stale.runtime.test.tsx` / `SyncPreviewStep.stale-refusal.runtime.test.tsx`**
(T1, T1b, T2b, T3). These were landed **deliberately RED** by 154-01 (`8a74683f` — *"land T1/T1b/T2/T2b
RED"*), and `SyncPreviewStep.tsx` plus both files are in **154-08**'s `files_modified` (wave 3). I
touched none of them — `git diff --stat` against the base confirms 11 files, none under
`SyncPreviewStep`. Out of scope per the scope boundary; recorded rather than silently ignored.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint` on all 9 touched source/test files | clean |
| 6 touched suites, `--no-file-parallelism` | **285 passed** |
| Pre-existing create-with-key tests still green | 81/81 unchanged after the client-double rewrite |
| Pre-existing add-key tests still green | 70/70 + 4 new |
| Session-constraint 409 body byte-identical | asserted on the raw text, both routes |
| Dedup path writes | zero (call-count on the RPC + update doubles) |
| Login in any response body | none (`res.text()` on the deduped, created and 409 arms) |
| Login in rendered UI | none (`container.textContent`, with a scoping assertion proving non-vacuity) |
| `p_venue_account_id` for non-MT5 | key ABSENT from the rpc args |
| No new migration authored | confirmed — `git diff --stat` shows no `supabase/` path |

⚠️ **Not verified against a live database.** Every assertion here is a unit-level double. The
migration is live on PROD and TEST (154-03-TEST-APPLY), so the PGRST202 deploy-order hazard is closed
for this change, but the end-to-end path — a real MT5 re-connect resolving onto a real existing row —
has not been exercised against Postgres by this plan.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: privilege | `src/app/api/strategies/create-with-key/route.ts` | A **service-role read** on `api_keys` now exists on a route that was previously 100% user-scoped. It is read-only, one column, and owner-filtered — but `.eq("user_id", user.id)` is the *only* tenant scoping, since the admin client bypasses RLS. Precedented (`finalize-wizard:1223`) and absorbed by Phase 156, but it deserves a reviewer's eye. |

## Known Stubs

None. Every path added here is wired end to end: the fence reads real tables, the marker crosses the
wire, and the strip renders in a test that drives the real parent component.

## Requirements

`WIZCONT-02` marked complete in REQUIREMENTS.md — **for MT5 only**, with three residuals written into
the entry itself (no ccxt venue identity; the RPC parameter is unvalidated so the stored value is
"what the server passed", not "what the venue confirmed"; and the service-role read above). The
traceability row was updated to say the same thing. Phase 156 owns the last two.

## Self-Check: PASSED

Files:
- FOUND: `src/lib/api/pgConstraintName.ts`
- FOUND: `src/lib/api/pgConstraintName.test.ts`
- FOUND: `src/app/api/strategies/create-with-key/route.ts` (modified)
- FOUND: `src/app/api/strategies/composite/add-key/route.ts` (modified)
- FOUND: `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (modified)
- FOUND: `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` (modified)
- FOUND: `.planning/REQUIREMENTS.md` (modified)

Commits: `0b92ada0`, `bac9a981`, `64f88b98`, `9e45b11c` — all present in `git log`.

No file deletions in any commit. No untracked files left behind. `STATE.md` and `ROADMAP.md` NOT
modified (orchestrator-owned).
