---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 04
subsystem: strategies-finalize
tags: [RANK-04, asset_class, annualization, attestation, anti-vacuity]
status: complete
requires:
  - "160-01 census (D-01 ordering gate — committed 11717b55, zero PENDING markers)"
  - "api_keys.attested_venue (migration 20260811210000: SECDEF RPC writer + scrub trigger + coupling CHECK)"
provides:
  - "attestation-derived asset_class stamp in finalize-wizard (RANK-04 core)"
  - "null-attestation SKIP guard closing the isCryptoExchange(null)===false laundering path"
  - "B-D2 economics oracles, proven falsifiable against BOTH the guard and the swap"
affects:
  - "strategies.asset_class → analytics worker periods_per_year_for_asset_class (√365 / √252 clock)"
tech-stack:
  added: []
  patterns:
    - "economic-invariant oracles with binding-divergent fixtures (attested ≠ exchange)"
    - "PARITY-04 truthful-fixture convention extended to the #597 asset_class describe"
key-files:
  created: []
  modified:
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
decisions:
  - "Guard keys on ONE binding (attestedVenue === null), never an AND of old and new — strict superset of the lookup-fault guard"
  - "Forgeable binding survives only as diagnostic copy in the skip warn-log; it feeds neither guard nor stamp"
  - "Both Test 1 and Test 2 made binding-divergent (not just Test 1) so each independently discriminates the two columns"
metrics:
  duration: "~13 min"
  completed: 2026-08-23
actuals:
  tokens: 3530
  tasks: 2
  commits: 2
---

# Phase 160 Plan 04: Attestation-Derived Annualization Stamp Summary

The `finalize-wizard` `asset_class` stamp now derives from `attested_venue` — the venue the
server itself validated — and a NULL attestation SKIPS the write entirely rather than
laundering `traditional`/√252 onto a crypto strategy through the `isCryptoExchange(null) === false`
trap. Guard extension and stamp swap landed in ONE commit, as D-07 requires.

## Commits

| Commit | Type | What |
|--------|------|------|
| `e9ffb0eb` | test | Failing B-D2 oracles (RED gate) |
| `a59f89c8` | fix | Guard extension + stamp swap + comment rewrite (GREEN) |

Task 2 (neuter audit) produced **no commit by design** — both neuters were reverted via
`git checkout`, leaving the file byte-identical to `a59f89c8`.

## What Changed

**`route.ts`** (all within the `:1246-1340` region, zero new queries — the swap consumes the
existing `attestedVenue` binding from the single `:1254` read, so the `SEAM_ROUTE_BUDGETS` pin
is untouched and `seam-budgets.invariant.test.ts` stays green):

1. **Guard** → `Boolean(apiKeyId) && attestedVenue === null`. ONE binding. Strict superset of
   the old lookup-fault guard: a faulted read attests nothing (both bindings null) so it still
   skips, and a legacy/trigger-scrubbed row whose forgeable label *resolves* now skips too.
2. **Stamp** → `isCryptoExchange(attestedVenue)`. Composite/CSV arms, `.eq` scoping, and the
   non-blocking error handling are byte-unchanged.
3. **Comments** → the measured-wrong "ONE-IDENTIFIER change" block and the stale fault-only
   rationale were rewritten. New prose sits ABOVE the `@audit-skip` pragma.
4. **Warn log** → now names the unverified label for operators (`unverified label: mt5`). It is
   diagnostic copy only; it feeds neither the guard nor the stamp, and there is no `??` fallback.

## Neuter-Cycle Evidence (first-hand, ROADMAP 160 SC-4)

Both cycles were **actually executed** — see "Vitest in the worktree" below for how.

| Cycle | Neuter applied | Observed RED | Verbatim assertion |
|-------|----------------|--------------|--------------------|
| **A — guard** | guard reverted to the forgeable binding | Test 3 only (`1 failed \| 141 passed`) | `AssertionError: expected [ { asset_class: 'traditional' } ] to have a length of +0 but got 1` |
| **B — swap** | guard restored; stamp input reverted to forgeable binding | Tests 1 **and** 2 (`2 failed \| 140 passed`) | `expected [ { asset_class: 'traditional' } ] to deep equally contain { asset_class: 'crypto' }`<br>`expected [ { asset_class: 'crypto' } ] to deep equally contain { asset_class: 'traditional' }` |

Cycle A's failure is the defect itself made visible: with the guard neutered, the unattested
row reaches the stamp arm and mints `{ asset_class: 'traditional' }` — √252 onto a strategy
whose real venue is unknown. Cycle A left Tests 1, 2, 4 green; Cycle B left Tests 3, 4 green.
Each neuter reddens exactly its own oracle and nothing else.

**Divergent-fixture note.** No mid-cycle fixture repair was needed: both Test 1
(attested `deribit` / forgeable `mt5`) and Test 2 (attested `mt5` / forgeable `binance`) were
authored binding-divergent from the start, so each discriminates the two columns on its own.
The plan only required Test 1 to be divergent; making Test 2 divergent too is why Cycle B
reddened *two* oracles instead of one.

**Restore discipline:** both restores used `git checkout --` against the Task-1 commit, never a
from-memory retype. Final `git diff --quiet` → clean; `git status` → empty.

## The Oracles (B-D2, D-08)

Expectations are **literal** `asset_class` values. No oracle calls `isCryptoExchange` or mirrors
the route's conditional — the self-referential-oracle failure class (Pitfall 8) is avoided by
construction, and Cycle B proves it: a self-referential oracle could not have reddened.

| # | Fixture | Expectation |
|---|---------|-------------|
| 1 | attested `deribit`, exchange `mt5` | `{ asset_class: "crypto" }` |
| 2 | attested `mt5`, exchange `binance` | `{ asset_class: "traditional" }` |
| 3 | attested `NULL`, exchange `bybit` (resolves) | 0 updates, response still 200 |
| 4 | lookup fault (pre-existing, unmodified) | 0 updates |

## Deviations from Plan

**1. [Rule 3 — Blocking] The `adminApiKeysAttestedVenue` harness knob already existed.**
The plan specified adding it as a NEW knob; PARITY-04 had already introduced it
(`route.test.ts:130`, default `"okx"` mirroring `adminApiKeysExchange`), wired through the
`api_keys` mock at `:317`. No new knob was written — the existing one was used as-is. The
plan's `contains: adminApiKeysAttestedVenue` artifact assertion still holds.

**2. [Rule 1 — Bug] Two pre-existing MT5RECON-02 fixtures had to gain `attested_venue`.**
The plan stated only Test 4 needed to survive unmodified, but two other existing tests set
`adminApiKeysExchange` while leaving `adminApiKeysAttestedVenue` at its `"okx"` default:

- `"MT5RECON-02: persists 'traditional' … on an mt5 venue"` — would have gone **RED** after the
  swap (attested `okx` is crypto ⇒ `crypto`, test expects `traditional`).
- `"MT5RECON-02: still FORCE-DERIVES 'crypto' for a crypto (bybit) single-key venue"` — would
  have stayed green, but only because `okx` happens to be crypto, *not* because `bybit` is. Its
  fixture no longer expressed what its name claimed.

Both got `STATE.adminApiKeysAttestedVenue` set to match their `exchange` — a self-consistent
post-backfill row, which is exactly what PROD holds (census: 31/31 rows satisfy
`attested_venue = exchange`). **Assertions were not touched** — the MT5RECON-02 economics being
pinned (mt5 ⇒ √252) are unchanged; only the binding that now drives them was made explicit.
This follows the same truthful-fixture convention PARITY-04 already applied to the probe-gate
tests at `:3854`/`:3927`.

## Explicit Non-Changes (verified)

`git diff --stat` over the whole plan shows **exactly two files**. Confirmed zero changes to:

- **`src/lib/closed-sets.ts`** — `isCryptoExchange` semantics untouched; `mt5` stays deliberately
  excluded from `CRYPTO_EXCHANGES` (= √252).
- **`src/app/api/strategies/create-with-key/route.ts`** — the **ARCHITECTURE B.3 confirmation**.
  Its draft stamp at `:1089` reads `isCryptoExchange(exchange)`, where `exchange` is the
  **route-local, request-validated** venue — the same binding passed as `p_exchange` to the
  SECDEF RPC at `:837` that writes `attested_venue`. The draft stamp and the attestation share
  provenance, which is precisely why the null-attestation SKIP is *safe* rather than merely
  cautious: skipping leaves a correct, server-derived stamp in place.
- **`supabase/migrations/`** — no migration created (PR-1 material).

## Verification

| Gate | Result |
|------|--------|
| `route.test.ts` + `audit-coverage.test.ts` | **159 passed, 1 skipped** |
| Adjacent seam/invariant suites (6 files) | **338 passed** |
| Adjacent route/contract suites (7 files) | **256 passed** |
| `tsc --noEmit` | clean |
| `eslint` (both files) | clean |
| Positive greps `isCryptoExchange(attestedVenue)` / `attestedVenue === null` | 1 / 1 |
| Negative greps `isCryptoExchange(apiKeyExchange)` / `apiKeyExchange === null` | 0 / 0 |
| `ONE-IDENTIFIER` stale framing | 0 |
| `@audit-skip` pragma window | line 1328, `.update(` at 1333 — **5 lines**, inside the 8-line window |

**The one `?? apiKeyExchange` grep hit is the in-file ⛔ prohibition rule itself**
(`route.ts:1277`: "⛔ NEVER `?? apiKeyExchange`"), deliberately retained — not a fallback.

**Skipped test disclosure (Rule 12).** The 1 skip is
`H-0001 (intended behavior): findMutations DETECTS the single-line from(...).insert(...) idiom`
in `audit-coverage.test.ts` — **pre-existing**, in a file this plan did not touch. Left alone per
the scope boundary; logged below.

## Vitest in the Worktree (method note)

The known project fact "GSD worktree agents get NO `node_modules`" held — but the neuter cycles
*require* real execution, so rather than defer them I verified that the worktree's `package.json`
and `package-lock.json` are **byte-identical** to the main checkout's (matching SHAs), then
symlinked `node_modules` from the main checkout. `node_modules` is gitignored
(`.gitignore:4`), so the tree stayed clean throughout and nothing could leak into the branch.
**The symlink was removed at the end** — the worktree is pristine.

This worktree also has **no `.env` files** (only `.env.example`), which per project convention is
the *valid* local vitest gate — the ~274 by-design local reds come from `.env.test.local`
un-skipping `HAS_LIVE_DB`, and that file is absent here.

To reproduce: `ln -s <main-checkout>/node_modules node_modules` from the worktree root, then
`npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts --no-file-parallelism`.

## Flagged for the Verifier

- **RANK-04 edge-probe returned `unclassified`** — unresolved per protocol. The four-oracle set
  (attested-crypto / attested-traditional / null-skip / fault-arm) is the planner's **manual**
  edge enumeration. Its *completeness* is a flagged assumption, not a probe-derived guarantee.
- **The null-attestation path remains REACHABLE in PROD until plan 160-05's REVOKE lands.**
  `anon`/`authenticated` still hold INSERT on `public.api_keys` and the scrub trigger is live, so
  a client-minted row still arrives with `attested_venue = NULL`. The census found no
  *accumulated* contamination (0 rows); it did not find the hole closed. This guard is what makes
  such a row harmless to the money math in the interim.
- Both plan prohibitions (`no ?? fallback`, `composite/CSV arms byte-unchanged`) were marked
  `unverified/flagged` in the plan and are **now verified** — see the Verification table and the
  diff confined to the `apiKeyId`-truthy branch input plus the guard line.

## Known Stubs

None. No stubs, TODOs, or FIXMEs introduced.

## Deferred Issues

| Item | Where | Note |
|------|-------|------|
| Pre-existing skipped test `H-0001` | `src/__tests__/audit-coverage.test.ts` | Out of scope (untouched file); disclosed rather than silently absorbed |

## Self-Check: PASSED

- `src/app/api/strategies/finalize-wizard/route.ts` — FOUND (modified)
- `src/app/api/strategies/finalize-wizard/route.test.ts` — FOUND (modified)
- Commit `e9ffb0eb` — FOUND
- Commit `a59f89c8` — FOUND
- `.planning/.../160-04-SUMMARY.md` — this file
