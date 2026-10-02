---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 04
subsystem: wizard-connect
tags: [connect, service-role, fail-closed, twin-pairing]
requires:
  - "156-02 (the RED route-contract tests)"
  - "156-03 (Migration A — both RPCs admit a service_role caller; applied to TEST)"
provides:
  - "single-key wizard connect writes api_keys under the server's own credential"
  - "composite wizard connect writes api_keys under the server's own credential"
  - "a missing SUPABASE_SERVICE_ROLE_KEY fails CLOSED on both routes (503 SEAM_MISCONFIGURED)"
affects:
  - "src/app/api/strategies/create-with-key/route.ts"
  - "src/app/api/strategies/composite/add-key/route.ts"
  - "src/app/api/strategies/create-with-key/route.audit.test.ts"
tech-stack:
  added: []
  patterns:
    - "fail-HARD admin client for a write, fail-SOFT admin client for a fence, in one file, named apart"
    - "503 SEAM_MISCONFIGURED reused, no new member minted into the wizard code union"
key-files:
  created: []
  modified:
    - "src/app/api/strategies/create-with-key/route.ts"
    - "src/app/api/strategies/composite/add-key/route.ts"
    - "src/app/api/strategies/create-with-key/route.audit.test.ts"
decisions:
  - "The service-role writer is NOT recorded as a fourth divergence on composite/add-key:42-67 — it lands identically on both twins, which is the whole point"
  - "The deleted user-scoped binding on the composite route is a consequence of divergences (1) and (3), not a new divergence"
  - "route.audit.test.ts needed the same G11 admin mock the twin route tests got in plan 02 — third instance of a row 156-PATTERNS.md § A enumerates as a pair"
metrics:
  duration: "~25 min"
  completed: 2026-08-13
  tasks: 3
  commits: 3
requirements: [CONNECT-02, CONNECT-03]
---

# Phase 156 Plan 04: Swap both wizard routes onto the service-role writer — Summary

Both wizard `api_keys` INSERTs now leave the browser's credential: `create_wizard_strategy`
and `add_wizard_composite_key` are called on a `createAdminClient()` binding, and a missing
`SUPABASE_SERVICE_ROLE_KEY` answers 503 `SEAM_MISCONFIGURED` **before any RPC attempt** rather
than falling back to the user-scoped client.

## Commits

| Commit | Task | What |
|---|---|---|
| `baae6da5` | 1 | single-key route → `rpcAdmin`, fail-HARD 503 arm, transitional prose |
| `74ca2d20` | 2 | composite twin, shape-identical, dead user-scoped binding + import deleted |
| `6097b655` | 3 (deviation) | `route.audit.test.ts` gets the G11 admin mock its route now needs |

## GREEN evidence — named, not an exit code

### Before (measured on `3b627d0f`, both files, `--no-file-parallelism`)

```
Tests  11 failed | 182 passed (193)
```

### After (same command, same two files)

```
Tests  193 passed (193)
```

182 did **not** shrink. 182 + 11 = 193, all passing — zero regressions among previously-passing
cases.

### The 11 cases from plan 02, by full name, all now `✓`

`src/app/api/strategies/create-with-key/route.test.ts` — 6 cases:

1. `[154-06 / WIZCONT-02] create-with-key — the venue-identity fence > [156 / CONNECT-03] a MISSING service-role credential fails CLOSED on the MT5 path too — 503, nothing submitted`
2. `[156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — create_wizard_strategy is reached through the ADMIN (service-role) client`
3. `… > 156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)`
4. `… > 156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"`
5. `… > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it`
6. `… > 156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING`

`src/app/api/strategies/composite/add-key/route.test.ts` — 5 cases:

7. `[156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — add_wizard_composite_key is reached through the ADMIN (service-role) client`
8. `… > 156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)`
9. `… > 156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"`
10. `… > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it`
11. `… > 156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING`

Per-file totals after: `create-with-key/route.test.ts` 121 passed | 1 skipped, plus
`audit-coverage.test.ts` 10 passed (run together: **131 passed | 1 skipped (132)**);
`composite/add-key/route.test.ts` **79 passed (79)**.

### Anti-vacuity — the green was earned, proven by mutation

Re-pointing the receiver back at the user-scoped client
(`rpcAdmin.rpc("create_wizard_strategy"` → `supabase.rpc("create_wizard_strategy"`) reds **6**
cases: 4 in `route.test.ts` and 2 in `route.audit.test.ts`. Reverted immediately; working tree
confirmed clean afterwards.

The other 2 of the 6 named single-key cases stay green under that mutation, and correctly so —
they assert the *fail-closed* half, which the `createAdminClient()` try/catch still supplies.
The two halves of this change are separately observable, which is what makes each assertion
non-vacuous.

## Wave gate

| Gate | Result |
|---|---|
| `npx vitest run --coverage` (full suite) | **780 passed \| 19 skipped (799)** files; **11806 passed \| 287 skipped (12093)** tests. 0 failed |
| Coverage thresholds (82 L / 80 S / 74 F / 72 B) | **clear** — Lines 88.55, Statements 86.5, Functions 83.42, Branches 80.97. No threshold error emitted |
| `npx tsc --noEmit` | exit **0** |
| `npm run lint` | **0 errors**, 2 warnings — both pre-existing, in files this plan does not touch (`ContributionWizardOverlay.tsx:91`, `EquityChart.tsx:1119`). Route-contract + admin-manifest checks OK |
| `npm run schema:functions:check` | exit **0** — "SQL function snapshot is current (111 functions)"; plan 03's snapshots still current |
| `src/__tests__/audit-coverage.test.ts` | pass — the `@audit-skip` pragma is still within 8 lines of the mutation (G12), proven by the test, not by eye |
| `git diff --stat src/lib/database.types.ts` | **empty** — untouched, as required |
| `git diff --name-only 3b627d0f..HEAD -- supabase/` | **empty** — plan 03's territory untouched |

## Twin-pairing checklist (`156-PATTERNS.md` § A)

⛔ A row is marked closed only with the file:line that closes it.

| Artifact | single-key instance | composite twin | Status |
|---|---|---|---|
| RPC body re-base (plan 03) | `20260813150106_wizard_rpcs_service_role_writer.sql:82` (`CREATE OR REPLACE`), role gate at `:131`/`:136` | same migration `:278`, role gate at `:307`/`:312` | ✅ **CLOSED** |
| REVOKE/GRANT (plan 03) | `20260813150106…sql:432` (`GRANT EXECUTE … TO service_role`, 12-arg sig) | `…sql:433` (11-arg sig) | ✅ **CLOSED** |
| route `.rpc` swap (this plan) | `create-with-key/route.ts:820` | `composite/add-key/route.ts:465` | ✅ **CLOSED** |
| route test admin mock (plan 02 + this plan) | `create-with-key/route.test.ts:299` **and** `create-with-key/route.audit.test.ts:101` | `composite/add-key/route.test.ts:194` | ✅ **CLOSED** — see Deviation 1; the pair was actually a triple |
| SQL gate 5d/5f | — | — | ⛔ **OPEN — owned by plan 08** |
| stale-re-base canary | — | — | ⛔ **OPEN — owned by plan 09** |
| `MUTATING_RPC_NAMES` | `audit-coverage.test.ts:209` | — | ⛔ **OPEN by decision** — log, do not fix (Rule 3). Plan 05 logs it to `TODOS.md`. Deliberately unmodified by this plan |

## What changed, per file

**`src/app/api/strategies/create-with-key/route.ts`**
- New `rpcAdmin` binding from `createAdminClient()` inside a `try`/`catch`, immediately before
  the RPC (only the type-cast comment and the pragma sit between). Named distinctly from the
  fence's `admin` at `:170`, whose scope, lifetime and posture are the opposite.
- `catch` logs via `scrubSeamError` with this request's three secrets, then returns 503
  `{ code: "SEAM_MISCONFIGURED", error: "Service credential unavailable" }` + `NO_STORE_HEADERS`.
  **No fallback path to `supabase.rpc` exists** — `grep -n 'supabase.rpc("create_wizard_strategy"'`
  returns nothing.
- Argument object byte-unchanged: `p_user_id: user.id`, `p_exchange: exchangeNormalized`, and the
  conditional `p_venue_account_id` spread.
- `const supabase = await createClient();` **kept**, with a new comment naming its three surviving
  consumers and warning against mirroring the twin's deletion.
- `@audit-skip` pragma **not moved** — the acquisition block was placed above the type-cast comment
  so the five pragma lines stay directly above the `.rpc`, well inside G12's 8-line window.
- Prose: the `resolveByVenueIdentity` header prediction is now present tense and states that
  `authenticated` EXECUTE is withdrawn by `..._wizard_rpcs_withdraw_authenticated.sql` (plan 07),
  **not yet**. The `p_venue_account_id` ⛔ block marks the **reachability** half as *closing* (not
  closed) and keeps the rest exactly: the value still has **no in-database oracle**, and it is
  still "what the server passed", never "what the venue confirmed".
- `git diff` shows **no hunk inside `:160-210`** — the venue-identity fence is untouched.

**`src/app/api/strategies/composite/add-key/route.ts`**
- Same `rpcAdmin` block, same 503 arm, same byte-unchanged argument object;
  `.rpc("add_wizard_composite_key", …)` now hangs off it.
- `createClient` import **and** the `const supabase = await createClient();` binding deleted.
  Deadness confirmed by grep first: the `.rpc` was the file's only consumer.
  `grep -n 'createClient' src/app/api/strategies/composite/add-key/route.ts` returns nothing.
- `grep -n 'createAdminClient'` returns the import (`:10`) and exactly one construction site
  (`:432`), plus two prose mentions.
- Header docblock gained the transitional paragraph and an explicit statement that the
  service-role writer is **not** a fourth divergence.

## Deviations

### 1. A third test file needed the plan-02 G11 admin mock — `route.audit.test.ts`

**Rule 3 (auto-fix blocking issue).** The plan lists two files and Task 3's acceptance says
`git diff --name-only` should list exactly those two. It lists **three**.

`src/app/api/strategies/create-with-key/route.audit.test.ts` mocks the same route as
`route.test.ts` but had no `@/lib/supabase/admin` mock. It never needed one: on its `binance`
body the only admin consumer was the MT5-only `resolveByVenueIdentity`, never reached, and
fail-SOFT anyway. Once the RPC itself rides `createAdminClient()` and fails **hard**, the real
factory ran in a unit-test process, found no `SUPABASE_SERVICE_ROLE_KEY`, threw — and 2 of its
10 cases answered 503 for a reason unrelated to the H-0305/H-0308 payload-forwarding claims they
exist to make. This is exactly the G11 / Pitfall 6 failure the plan-02 mocks were written to
prevent; `156-PATTERNS.md` § A enumerates the "route test admin mock" row as a *pair*, and it is
in fact a *triple*.

**Fix (route unchanged):**
- Added the admin mock, delegating `.rpc` to the **same** `rpcMock` the cases already assert
  against, so every existing expectation reads the same call it always read.
- **Dropped `rpc` from the user-scoped mock in that file.** Without this the file would pass
  vacuously if the route were ever re-pointed back at `supabase`. Verified by mutation: with the
  method omitted, a reverted route reds 2 cases here (and 4 in `route.test.ts`).

No route behaviour changed for this deviation.

### 2. The composite route's deleted client is documented in prose, and the plan's literal grep still passes

The plan asked for prose explaining the deletion **and** for
`! grep -n 'createClient' composite/add-key/route.ts` to hold. Naming the token in a comment
would have broken the literal gate. The comments therefore say "the user-scoped
`@/lib/supabase/server` binding" instead — more precise anyway, since the module is what
matters. The gate passes verbatim (exit 0, no match).

### 3. No divergence (4) added to `composite/add-key:42-67`

The plan allowed either a shape-identical diff or a documented divergence (4). The `rpcAdmin`
block **is** shape-identical, so no divergence was minted. The deleted user-scoped binding is a
*consequence* of existing divergences (1) and (3) — no app-layer SELECT, no `asset_class`
derive — and is recorded as such in the header rather than as a new divergence. Judgement call,
recorded here so it is reviewable.

## Not done by this plan, deliberately

- `authenticated` still holds EXECUTE on both RPCs. This route is the only **sanctioned** writer,
  not yet the only **possible** one. Plan 07 closes that.
- `MUTATING_RPC_NAMES` does **not** gain `add_wizard_composite_key` — a real pre-existing gap,
  but adding it creates an audit-emission obligation on a route this plan is already rewiring
  (Rule 3). Plan 05 logs it.
- Nothing under `supabase/` was touched.
- `src/lib/database.types.ts` was not touched — no RPC signature changed, and `tsc` (exit 0) is
  the proof.

## Threat register outcomes

| Threat ID | Outcome |
|---|---|
| T-156-17 (user-scoped fallback on the missing-key path) | **mitigated** — the 503 arm returns before any RPC attempt; `rpcMock` asserted never called; the old call form greps to nothing |
| T-156-18 (`p_user_id` drifting to a body field) | **mitigated** — argument object byte-unchanged; both conflicting-body cases green, asserting over the whole serialized argument object |
| T-156-19 (orphaned `@audit-skip` pragma) | **mitigated** — `audit-coverage.test.ts` green in the Task 1 verify command |
| T-156-20 (`SUPABASE_SERVICE_ROLE_KEY` absent in Vercel Preview) | **stated, not closed** — connect-a-key now hard-depends on the service key in Production **and Preview**, where before only *submit* did. Plan 06's live checkpoint verifies Production. The 503 copy does not blame the user's key |
| T-156-21 (admin-client error leaking credential material) | **mitigated** — `scrubSeamError(adminErr, [api_key, apiSecretNormalized, passphraseOrNull])` on both catch paths |
| T-156-SC (package installs) | **n/a** — zero packages installed |

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file access pattern, or schema change at a trust
boundary. The change moves an existing write from one credential to another and adds a
fail-closed arm.

## Self-Check: PASSED

- `src/app/api/strategies/create-with-key/route.ts` — FOUND, contains `createAdminClient`
- `src/app/api/strategies/composite/add-key/route.ts` — FOUND, contains `createAdminClient` and
  matches `\.rpc\(\s*["']add_wizard_composite_key["']`
- `src/app/api/strategies/create-with-key/route.audit.test.ts` — FOUND
- Commits `baae6da5`, `74ca2d20`, `6097b655` — all present in `git log`
</content>
</invoke>
