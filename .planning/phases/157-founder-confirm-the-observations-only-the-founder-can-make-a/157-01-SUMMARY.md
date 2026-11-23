---
phase: 157-founder-confirm-the-observations-only-the-founder-can-make-a
plan: 01
subsystem: founder-observation tooling (no product code)
tags: [staging-kit, fetch-router, fail-closed, founder-script, FCONF]
requires: []
provides:
  - "157-STAGING-KIT.js: fail-closed window.fetch router with modes resume, amber, connect, submit"
  - "157-STAGING-KIT.smoke.mjs: 31 node:test cases over the real kit file"
  - "157-FOUNDER-SCRIPT.md: one-step-at-a-time script for FCONF-01..04"
affects: [157-02, 157-03]
tech-stack:
  added: []
  patterns:
    - "single fail-closed refuse path; stubs and the GET/HEAD pass list are anchored regexes"
    - "smoke test evaluates the real kit file with node:vm against a fake window, document and location"
key-files:
  created:
    - .planning/phases/157-founder-confirm-the-observations-only-the-founder-can-make-a/157-STAGING-KIT.js
    - .planning/phases/157-founder-confirm-the-observations-only-the-founder-can-make-a/157-STAGING-KIT.smoke.mjs
    - .planning/phases/157-founder-confirm-the-observations-only-the-founder-can-make-a/157-FOUNDER-SCRIPT.md
  modified: []
key-decisions:
  - "Finalize has no dedicated refusal arm: unarmed or consumed finalize falls through the one api-non-read refusal, so a single-arm neuter is observable"
  - "arm() also throws when an envelope code is given to a mode other than submit, so a misuse is loud"
  - "GET /api/keys/feeds (preselect connect form read) added to the pass list and named in the kit header"
status: complete
completed: 2026-11-23
commits: 4
plan_head_before: 0def03553a117020fa1e9a5398d06c9b33070e0a
plan_head_after: ea9320a7693b94ae395bfb212481cedc9c5799c1
actuals:
  tokens: 11000
  tasks: 3
  commits: 4
---

# Phase 157 Plan 01: Staging kit, smoke test and founder script Summary

A fail-closed browser fetch router (four modes, a visible marker, a fixed-literal stub for each failure state) with a 31-case smoke test that runs the real kit file, plus the founder script for FCONF-01..04. Phase 157 still ships no product code: `git diff --name-only` for this plan touches only the three phase-directory files.

HEAD at which every literal was read: `0def03553` (the kit's `version` constant is `head-0def03553`). The finalize-wizard literals, the create-with-key catch tail, `NO_STORE_HEADERS` and the four `WIZARD_ERROR_COPY` entries were re-read at that HEAD, not carried from RESEARCH (which was written at a different sha).

## What was built

- **Kit** (`157-STAGING-KIT.js`): self-contained IIFE, no imports. One `decide(method, url, mode, envelope)` returns `stub`, `pass`, `refuse` or `outside`. Same-origin `/api/` and any `/rest/v1/` are stubbed, passed (GET/HEAD list only) or refused with 599; `/auth/v1/`, telemetry, RSC fetches and assets reach the native fetch. Before `arm()` the tables are empty, so everything is refused. Marker `#fconf-staging-marker` is set with `textContent` only. A second paste does not wrap twice. The test export `globalThis.__FCONF_ROUTER__` exists only under `__FCONF_TEST__`.
- **Smoke** (`157-STAGING-KIT.smoke.mjs`): 31 cases, fresh vm context per case, `readFileSync` plus `vm.runInContext` of the real kit, ids built at runtime. Covers all nine tracer cases, the three finalize envelopes byte-for-byte (status, body, `cache-control`, no `retry-after`), one-shot arming, the kickoff stub in every mode, the amber poller shapes (both select shapes, percent-encoded and raw commas), HEAD counts parsed by the postgrest-js rule, the alias-keyed heavy row, the permissions pass-through in every mode, write refusals in every mode, marker text per mode, and `scrub`.
- **Script** (`157-FOUNDER-SCRIPT.md`): sections 0 to 6 in the required order. Expected copy is quoted from `src/lib/wizardErrors.ts` and `SyncPreviewStep.tsx` at HEAD; I checked every quoted cause and fix line against source, not only the four titles.

## Neuter-RED evidence (T-157-01)

Each proof: byte backup with `cp` to a fixed scratchpad path, a scoped edit to one arm, run, restore with `cp`, `cmp`, rerun. No git checkout, restore or stash was used.

| Proof | Arm neutered | RED tests | `cmp` after restore | Rerun |
|---|---|---|---|---|
| Task 1 | wrapper refuse arm calls the native fetch | `(c) connect: a draft DELETE is refused...`, `(f) before any arm, a same-origin /api/ GET is refused...` | CMP-OK | 10/10 |
| (i) | finalize with no armed envelope passes | `submit: finalize with no armed envelope is refused, never passed through`, `submit: the armed envelope is one-shot...`, `finalize is refused in every other mode and before any arm` | CMP-OK | 31/31 |
| (ii) | armed envelope not consumed after serving | `submit: the armed envelope is one-shot, a second finalize is refused and never sent`, `marker text per mode, and the submit marker drops to not armed...` | CMP-OK | 31/31 |
| (iii) | non-GET on `/rest/v1/` passes | `every mode refuses a write on /rest/v1/ and an unknown non-GET on /api/, never sent` | CMP-OK | 31/31 |
| (iv) | unknown non-GET on `/api/` passes | `(c)` draft DELETE, the three finalize refusal cases, and `every mode refuses a write...` | CMP-OK | 31/31 |

Proof (i) neuters a scoped bypass inserted ahead of the refusal rather than deleting a dedicated finalize arm, because the router deliberately has no second finalize guard (see decisions).

## Submit-leg derivation (Task 2 item 8)

`submit-leg-derivation:` YES, the submit leg needs no real write, conditionally. It rests on these `SyncPreviewStep.tsx` and `useStrategySyncPoller.ts` symbols:

- Mount effect: `SYNC_FRESHNESS_WINDOW_MS`, `isComputedAnalytics(existing?.computation_status)` and `isFresh`. A terminal but stale row falls through to the kickoff path.
- `probeExistingChain` (first mount, `kickoffNonce === 0`): the passed-through `strategies` and `sync-progress` reads answer `in_flight` or `settled`, so no POST is sent, or `none`, in which case the `POST /api/keys/sync` kickoff is stubbed. Both end in `waiting_for_complete`.
- Poller ladder arm: the terminal branch is `nextStatus === "failed" || isComputedAnalytics(nextStatus)` with no `computed_at`-after-kickoff test. `computed_at` appears only in the mount freshness probe, the interval-mode `.single()` arm (not used by the wizard ladder) and the snapshot.
- `onTerminal` single-key arm: reaches `setPhase("passed")` only if `seriesMayBeMidReDerive` is false (real `tradeCount` and `csvRowCount` not both zero, or `jobsHaveFinished`) AND `checkStrategyGate` passes on the real row. A red gate or both counts zero stops the walk.

So Plan 02 does not need to put a real sync on the table by default. The script carries a record-and-stop branch plus the `skip-submit` / `fresh-sync-then-submit` options for the case the real data cannot reach Submit.

## Hygiene grep pattern set (recorded as a grep, not as proof of absence)

```
[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}
(^|[^0-9A-Za-z])[0-9]{7,}([^0-9A-Za-z]|$)
```

Run over the script and the kit (and the kit plus smoke): no match. A separate grep for home-path prefixes over the kit and smoke: no match. The secrets-read gate (`cookie`, browser-storage words, `.body` on input/init/req/request, `innerHTML`) over non-comment kit lines: 0. `node scripts/check-planning-hygiene.ts` with the three files tracked: exit 0 (rule 1 over 11908 tracked files, rule 6, rule 7 all OK). `node scripts/verify-plan-anchors.mjs` on the three phase-157 plans: 8 claims checked, no stale claims.

## Acceptance greps

- Route literals: each of `Could not load draft`, `Could not finalize wizard draft`, `Upstream service returned unexpected response` has `grep -cF` 1 in the kit and 1 in `finalize-wizard/route.ts`.
- `private, no-store` 2, `"memberProgress":[]` 1, `*/0` 1, `no pass-through write exists in any mode` exactly 1, `submit-leg-derivation:` line 1.
- Script: nine verify strings present, four titles present in `wizardErrors.ts`, amber body verbatim, headings ascending (0, 1, 2, 3, 4, 5, 6), `after 155.2` and `complete_with_warnings` present, every `Start fresh` line carries "never" or "Do not", `+ Strategy` only on the SC-1 line, no skip-trailer token in any file.

## Deviations from Plan

None that change scope. Notes:

1. [Plan detail, not a deviation] The plan's Task 2 is `tdd="true"`; the 20 new behaviour cases were committed first (RED: 20 of 31 failed against the tracer kit) and the kit second (GREEN), as two commits.
2. [Rule 2 - hardening] `arm()` throws if an envelope code is passed to a mode other than `submit`. The plan only required throwing on unknown modes and unknown codes; silently ignoring an envelope on another mode would hide a founder-session mistake.
3. [Plan item "further reads"] `GET /api/keys/feeds` (read by `ConnectKeyStep`'s preselect path) added to the pass list and named in the kit header. Every other read found on the steps was already in the plan's list. `POST /api/strategies/composite/add-key` and `set-members` (composite steps) have no stub and no pass row, so they are refused.
4. [Plan item] The four-column `strategy_analytics` select is the interval-mode `.single()` arm, which the wizard ladder does not use. It is answered with the plan's array shape; the kit header says so.

## Known Stubs

None. The kit's stubs are the deliberate staged responses; no placeholder reaches any shipped surface.

## Threat Flags

None. No product endpoints, auth paths or schema were touched.

## Things the founder session should know (carried to Plan 02)

- Refused reads from page chrome are expected noise; a refused non-GET is a finding.
- The kit stubs `POST /api/keys/sync` in every mode, so no armed leg can enqueue a sync. The only sanctioned real write is the optional `fresh-sync-then-submit` exception, offered only after the founder confirms the shared MT5 terminal is idle.
- STATE.md, state.json and ROADMAP.md were not touched, and no requirement was marked complete: FCONF-01..04 are founder observations that this plan only prepares.

## Self-Check: PASSED

- FOUND: 157-STAGING-KIT.js, 157-STAGING-KIT.smoke.mjs, 157-FOUNDER-SCRIPT.md
- FOUND commits: 202d007b2, e82935efc, 3f1886c2a, ea9320a76
- `node --check` on the kit exits 0; `node --test` on the smoke: 31 tests, 31 pass, 0 fail

## Post-execution review (2026-11-23)

The phase agent ran the review pair on the kit before handing it over. They were `gsd-code-reviewer` and `silent-failure-hunter`, rated MEDIUM+ only. The full record is in `157-REVIEW.md`.

**Round 1** found 2 critical and 3 warning items from the code reviewer, plus 5 MEDIUM from the silent-failure hunter.
- The phase agent fixed one item itself in `3b7eb5e8e`: the router catch failed open and now fails closed.
- A `gsd-code-fixer` round fixed the rest in `2c02e2bc2..b692d64cf`:
  - The key-permissions read is refused. It writes an audit row and runs a live decrypt.
  - The submit section of the script was reordered.
  - Writes outside the two prefixes are refused or logged.
  - A page-world install guard was added.
  - The literal cases now read the route source.
  - Each log entry carries its evidence.
  - The marker and state stay consistent.

**Round 2:** the code reviewer found no new MEDIUM+. The silent-failure hunter found one MEDIUM, a marker that could misreport. The phase agent fixed it in `3d6306fcd`.

The kit version is now `head-0def03553-r2`, and the smoke passes 47/47.
