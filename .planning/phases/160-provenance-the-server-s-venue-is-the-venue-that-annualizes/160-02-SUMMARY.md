---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 02
subsystem: api-keys-connect
status: complete
tags: [RANK-03, provenance, attested-venue, service-role-writer, skew-window]

requires:
  - "160-01 census (D-01 ordering gate) — verified committed, zero RESULTS: PENDING markers"
  - "public.api_keys BEFORE INSERT scrub trigger admitting service_role by name (20260811210000:534)"
  - "CHECK api_keys_attested_venue_matches_exchange (20260811210000:294)"
provides:
  - "POST /api/keys/validate-and-encrypt persist arm: `persist: true` ⇒ server-side attested INSERT ⇒ `{ api_key_id, valid, read_only }`, no ciphertext"
  - "ApiKeyManager converted: zero browser-composed api_keys INSERTs; consumes api_key_id"
  - "Legacy (absent-discriminator) contract byte-preserved for the soak window"
affects:
  - "160-03 (StrategyForm + AllocatorExchangeManager point at the same persist arm)"
  - "160-05 (REVOKE INSERT — may only land after this has soaked on PROD)"

tech-stack:
  added: []
  patterns:
    - "service-role privileged write via createAdminClient() (finalize-wizard:1192 idiom)"
    - "request-versioned skew discriminator (RESEARCH Pattern 2)"
    - "coded error envelopes + NO_STORE_HEADERS"
    - "perRequestSecrets scrub at both console and Sentry sinks"

key-files:
  created: []
  modified:
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx

decisions:
  - "Persist arm shares ONE function body with the legacy arm rather than living in a parallel handler — the limiter, venue gates, breaker arm, 4xx forward, timeout arm and scrubbed terminal arm must police both arms identically."
  - "Label is CAPPED (truncated at 120) rather than rejected: a cosmetic display string must not fail a connect whose credentials already validated against the live venue."
  - "A 2xx carrying no api_key_id is a loud client-side failure, not a silent skip — the pre-conversion `if (newKey)` guard would have reported success for an unsaved key."
  - "Audit coverage satisfied via @audit-skip pragma (sibling precedent create-with-key:830), not a new AuditAction literal — adding one would touch audit.ts, the entity_type map and the Python parity test, all out of scope."

metrics:
  duration: ~75 min
  completed: 2026-08-23
  tasks: 2
  commits: 2

actuals:
  tokens: 16595
  tasks: 2
  commits: 2
---

# Phase 160 Plan 02: Persist-arm tracer — the server writes the attested row

The `validate-and-encrypt` route now writes the `api_keys` row itself behind a strict
`persist: true` discriminator, stamping `exchange` and `attested_venue` from the single
`exchangeNormalized` binding it validated, and `ApiKeyManager` consumes the returned
`api_key_id` instead of composing the row in the browser.

## The persist-arm contract as shipped

**Request** (`POST /api/keys/validate-and-encrypt`):

| Field | Type | Notes |
|-------|------|-------|
| `persist` | `true` (strict boolean) | Anything else — absent, `"true"`, `1`, `"1"`, `{}`, `null`, `false` — falls through to the legacy arm and mints ZERO rows |
| `label` | `string` (optional) | Trimmed, capped at 120 chars; absent/blank/non-string ⇒ server default `` `${exchangeNormalized} key` `` |
| `exchange`, `api_key`, `api_secret`, `passphrase` | unchanged | |

**Response (persist success, 200):** `{ api_key_id, valid: true, read_only: true }` with
`NO_STORE_HEADERS`. No ciphertext field of any name.

**Response (persist failures):**

| Arm | Status | Code | Copy |
|-----|--------|------|------|
| INSERT rejected / returned no row | 500 | `UNKNOWN` | "Your key was verified but couldn't be saved. Please try again." |
| `createAdminClient()` threw (no service key) | 503 | `SEAM_MISCONFIGURED` | "Service credential unavailable" |
| rate limited / venue gates / upstream 4xx / read_only:false / timeout / terminal | unchanged from the legacy arm | unchanged | unchanged |

**INSERT payload:** `{ user_id: <withAuth session id>, exchange: exchangeNormalized,
attested_venue: exchangeNormalized, label: <normalized>, ...six ciphertext columns }`.

## Anti-vacuity: RED observations

Every new oracle was neutered, observed RED, and restored. Each neuter was applied to a
byte-verified-clean baseline and reverted by file restore (`diff` confirmed identical).

| # | Neuter applied | Observed |
|---|----------------|----------|
| 1 | audit pragma renamed to a non-pragma comment | `audit-coverage.test.ts` RED — names `route.ts:462 > .insert({` |
| 2 | `body.persist === true` → `Boolean(body.persist)` | 4 RED — the string/number/`"1"`/object skew probes |
| 3 | POST threads raw `exchange` instead of `exchangeNormalized` | 5 RED — my mixed-case MT5 persist oracle **plus** 4 pre-existing normalization tests |
| 4 | ciphertext spread back into the persist response | 2 RED — the no-ciphertext response oracle and the all-arms invariant |
| 5 | `userId: user.id` → `body.user_id ?? user.id` | 1 RED — the tenant-identity oracle |
| 6 | `scrubSeamError(...)` removed from the INSERT-failure log | **initially GREEN — see below**; RED after the fix |
| 7 | `persist: true` deleted from the component's request body | 1 RED — the discriminator-type oracle |
| 8 | loud-fail guard `typeof newKeyId !== "string"` disabled | 1 RED — the no-false-success oracle |
| 9 | a browser `from("api_keys").insert(...)` reintroduced | 1 RED — the negative oracle, **and** the plan's whitespace-collapsed grep gate returned 1 |

### A vacuous assertion, caught and fixed (neuter 6)

The console-scrub assertion in the INSERT-failure test was **vacuous as first written**.
A PostgREST error is a plain object, `String({...})` is `"[object Object]"`, and the test
joined log args with `String(a)` — so `expect(logged).not.toContain("okx-api-key")` passed
regardless of what the route did. Measured: deleting `scrubSeamError` from the route left
all 77 tests green.

Fixed by JSON-stringifying non-string log args, which makes an un-scrubbed object's
contents visible to the assertion. Re-running the identical neuter now reddens with
`Received: '[keys/validate-and-encrypt] persist INSERT failed: {"message":"...(okx-api-key,
okx-api-secret)","code":"23514"}'`. A comment at the call site records this so the
serializer is not "simplified" back. A companion positive assertion pins that the scrub
does not eat the diagnosis (the constraint name still reaches the operator).

## No migration file was touched

Confirmed: `git diff --stat <base>..HEAD` lists exactly the four planned files. Nothing
under `supabase/migrations/`, and nothing in `finalize-wizard/route.ts` or its test
(plan 160-04's territory, wave-2 parallel). PR-1 is TS-only — deploy-first,
revoke-second (D-06).

## Deviations from Plan

### 1. [Rule 3 — process] Task 2's tests were written alongside the arms, not strictly before

The plan's Task 2 said "write the behavior tests first, observe the relevant ones RED,
then finish the arm". The persist arm's failure handling (INSERT-fault envelope, admin-factory
catch) landed in the Task-1 tracer commit because splitting a single `if (!persist)` branch
across two commits would have produced a knowingly-broken intermediate state.

The anti-vacuity guarantee was obtained the other way round — neuter, observe RED, restore
(the founder's stated pattern) — and is recorded in full in the table above. Task 2's
acceptance criterion "zero modifications to legacy-arm code paths in this task's diff" is
satisfied literally: `git diff --stat` for commit `7806b1b9` is `route.test.ts | 280 +++`,
test-only.

### 2. [Rule 2 — missing critical functionality] Loud failure on a 2xx without an `api_key_id`

Not in the plan. The pre-conversion `if (newKey)` guard silently skipped the link and sync
when the insert returned no row. Carried forward verbatim, that would report "key added"
while the key was unlinked and would never sync — the exact false-success class this
component's NEW-C37-03 and B-06 fixes exist to prevent (Rule 12). The component now throws
a user-visible "Your key was verified but not saved. Please try again."

Consequence: the `if (newKey)` wrapper became unconditional and was removed, dedenting the
link-update and background-sync blocks. Their content is byte-preserved; only indentation
and the `newKey.id` → `newKeyId` binding changed.

### 3. [Rule 1 — dead code] `stripValidationFields` deleted from `ApiKeyManager.tsx`

The helper existed only to strip `valid`/`read_only` before the client INSERT. With the
INSERT gone it had zero callers and would have tripped lint. Its docblock claimed it was
shared with StrategyForm; it was not — grep confirmed it was module-local with one caller.

### 4. [Rule 3] Two stale comments corrected

The `SYNC_UNAVAILABLE_COPY` docblock cited `if (newKey)` (the insert returned a row) as the
justification for "Your key is saved"; the F6 comment asserted "the CLIENT performs the
api_keys INSERT directly". Both statements became false with this change. Left as-is they
would have been load-bearing-looking documentation of behavior that no longer exists.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Route tests | `vitest run src/app/api/keys/validate-and-encrypt/route.test.ts --no-file-parallelism` | **77 passed** |
| Component tests | `vitest run src/components/strategy/ApiKeyManager.test.tsx --no-file-parallelism` | **23 passed** |
| Audit-coverage gate | `vitest run src/__tests__/audit-coverage.test.ts --no-file-parallelism` | **17 passed, 1 skipped** |
| Combined (plan's `<verify>`) | all three, `--no-file-parallelism` | **117 passed, 1 skipped** |
| Typecheck | `tsc --noEmit -p tsconfig.json` | **clean, no output** |
| Lint | `eslint <the four changed files>` | **clean, no output** |
| Grep gate 1 | `grep -q 'attested_venue: exchangeNormalized' route.ts` | PASS |
| Grep gate 2 | `grep -q 'persist: true' ApiKeyManager.tsx` | PASS |
| Grep gate 3 | `! tr -d ' \n\t' < ApiKeyManager.tsx \| grep -q 'from("api_keys").insert('` | PASS (count 0) |

### How these gates were actually run — read this before trusting them

This worktree has **no `node_modules`** (measured: `ls node_modules` → no such file;
`npx tsc --version` reports `6.0.3`, an unrelated package, exactly as the project's own
notes warn). The binaries were therefore invoked by absolute path from the parent
checkout's `node_modules/.bin`, with the **cwd inside this worktree**. Vitest confirms the
root it used on every run:

```
RUN  v4.1.10 /Users/helios-mammut/claude-projects/quantalyze/.claude/worktrees/agent-a42f5cc19d7fde907
```

Module resolution reaches the parent's `node_modules` because this worktree is nested
inside the main checkout, so Node's upward walk finds it. These are **real gates against
this worktree's files**, not a proxy run against main — the neuter/RED cycle above is the
proof: edits to these files changed the results.

Two caveats an orchestrator re-run should be aware of:

- This worktree has **no `.env.test.local`**, so `HAS_LIVE_DB` stays false and the live-DB
  specs skip. That is the project's documented condition for a valid local gate, but it
  means these runs assert nothing about the SQL layer (none of this plan's work touches it).
- CI runs Node 22; this ran on the parent's toolchain. The project has a documented class
  of CI-only vitest failures from that skew.

**Recommended orchestrator re-run** (from a checkout with its own `node_modules`):

```bash
npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts \
  src/components/strategy/ApiKeyManager.test.tsx \
  src/__tests__/audit-coverage.test.ts --no-file-parallelism
npx tsc --noEmit
npm run lint
```

## Known Stubs

None. No stub patterns, no `TODO`/`FIXME`, no skipped tests introduced. The one skipped
test in the audit-coverage run is pre-existing and untouched.

## Threat Flags

None. The change removes surface rather than adding it: the browser loses an `api_keys`
write path and stops receiving ciphertext. The `service_role` write path is pre-existing
standing surface (T-160-07, disposition **accept**), and the persist arm states that
ceiling honestly in-code — "only our own server code can forge", never "cannot be forged"
(ADR-0001/0003).

## Commits

| Task | Commit | Scope |
|------|--------|-------|
| 1 (tracer) | `3b7f286c` | route persist arm, component conversion, tracer + skew oracles |
| 2 (harden) | `7806b1b9` | failure-surface suite, test-only diff |

## Self-Check: PASSED

- `src/app/api/keys/validate-and-encrypt/route.ts` — FOUND (modified)
- `src/app/api/keys/validate-and-encrypt/route.test.ts` — FOUND (modified)
- `src/components/strategy/ApiKeyManager.tsx` — FOUND (modified)
- `src/components/strategy/ApiKeyManager.test.tsx` — FOUND (modified)
- Commit `3b7f286c` — FOUND in `git log`
- Commit `7806b1b9` — FOUND in `git log`
- `supabase/migrations/` — no file added or modified (confirmed via `git diff --stat`)
