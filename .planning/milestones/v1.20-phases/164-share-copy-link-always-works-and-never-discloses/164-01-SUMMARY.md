---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 01
subsystem: api
tags: [hmac, share-token, next-app-router, rsc, unstable-cache, disclosure, rate-limit]

requires:
  - phase: 148-owner-lane-cache-isolation
    provides: "The OWN-02 structural guard (`phase-148-owner-lane-cache-isolation.test.ts`) and the SL-1 id-keyed-cache invariant this plan re-points rather than replaces"
  - phase: 147-series-resolution
    provides: "`resolveDailyReturnSeries` + the phase-147 REFERENCE pins on the factsheet v2 page, one of which this plan re-pointed"
provides:
  - "`src/lib/factsheet/fetch-and-build-payload.ts` — the ONE factsheet payload builder, extracted verbatim from the v2 page so a second lane can call it without importing a page module"
  - "`src/lib/strategy-share-token.ts` — HMAC + generation share tokens, validated LOUD at module load"
  - "`/factsheet-share/[token]` — the anonymous recipient RSC route for unpublished strategies"
  - "`/factsheet-share/gone` — the genuine HTTP 410 emitter every miss on the token lane redirects to"
  - "`recipientShare` + `viewerNotice=\"shared_privately\"` render props on FactsheetView"
  - "Proxy + route-contract wiring for the `/factsheet-share` prefix"
affects: [164-02-strategy-shares-migration, 164-03-mint-and-revoke-routes, 164-04-copy-link-affordances, 164-05-telemetry-and-cache-isolation]

actuals:
  tokens: 33245
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Canonical-module pin: a structural guard asserts ONE declaration site plus a canonical import specifier, instead of allow-listing callers"
    - "Stateful keyed MAC: HMAC over `(resource_id, generation)` where the stored counter — not the token — is the revocation mechanism"
    - "410-by-redirect: an App Router page redirects to a sibling `route.ts` because pages cannot set a 410 status"

key-files:
  created:
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/strategy-share-token.ts
    - src/lib/strategy-share-token.test.ts
    - src/app/factsheet-share/[token]/page.tsx
    - src/app/factsheet-share/[token]/page.test.tsx
    - src/app/factsheet-share/gone/route.ts
    - src/app/factsheet-share/gone/route.test.ts
    - src/app/factsheet/[id]/v2/FactsheetView.recipient-share.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/__tests__/phase-148-owner-lane-cache-isolation.test.ts
    - src/__tests__/phase-147-series-resolution-guards.test.ts
    - src/proxy.ts
    - src/lib/routing/route-contract-manifest.ts
    - src/test-setup.ts
    - .env.example
    - .github/workflows/ci.yml

key-decisions:
  - "The phase-148 pin became a MODULE pin, not a two-caller allow-list: exactly one production file may DECLARE the builder, and every other file naming it must import the canonical specifier. A duplicate builder is then structurally impossible, which is what the SL-1 argument actually rests on."
  - "`/factsheet-share/gone` is classified `exception` in the route-contract manifest, not `public`: Rule 4 requires a backing `page.tsx` for every non-exception entry and this is a `route.ts`. Its public reachability is real and comes from the `/factsheet-share` PUBLIC_ROUTES prefix."
  - "The Task-2 build measurement was deferred until after Task 3. Run before a production module imported the token module, `npm run build` would have passed for the trivial reason that nothing evaluated it — a green that meant nothing."
  - "Two directional phrases in the moved doc block (\"below\") were rewritten to name `v2/page.tsx`. A verbatim move that leaves false cross-references behind is not verbatim in the way that matters."

patterns-established:
  - "Canonical-module pin (guard shape): assert `declarers == [CANONICAL]` AND `every other namer imports CANONICAL_SPECIFIER`. Strictly stronger than an import-path check alone — demonstrated by a RED experiment where a duplicate declaration satisfied the import rule and was still caught."
  - "Env-fixture placement: a module-scope env assert needs its test fixture set BEFORE `test-setup.ts`'s `INHERITED_ENV` snapshot, or `afterAll`'s restore deletes it as a key-added-since and every file after the first in a worker imports into a throw."
  - "Neutral rate-limit denial on a token lane: render a 'try again' card, never the miss status, or the limiter becomes a token-existence oracle for anyone willing to be throttled."

requirements-completed: [SHARE-01, SHARE-02]

coverage:
  - id: D1
    description: "The payload builder lives in one canonical lib module; a second builder is structurally impossible and the cached wrapper stays page-private"
    requirement: "SHARE-02"
    verification:
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts (12 tests)"
        status: pass
      - kind: unit
        ref: "src/__tests__/phase-147-series-resolution-guards.test.ts (13 tests, REFERENCE pin re-pointed + split)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Share tokens are HMAC(secret, `id.generation`); a missing or short SHARE_TOKEN_SECRET fails LOUD at module load with a named remedy"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "src/lib/strategy-share-token.test.ts (18 tests: literal digest vector, generation divergence, cross-namespace, format guard, module-load throw)"
        status: pass
      - kind: unit
        ref: "src/__tests__/contracts/env-manifest.test.ts"
        status: pass
      - kind: integration
        ref: "npm run build without SHARE_TOKEN_SECRET — fails 'Failed to collect configuration for /factsheet-share/[token]' with the remedy as the cause"
        status: pass
    human_judgment: false
  - id: D3
    description: "A valid token renders the unpublished factsheet for an anonymous session in recipient mode; every miss class lands on a genuine content-free 410"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "src/app/factsheet-share/[token]/page.test.tsx (18 tests)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet-share/gone/route.test.ts (9 tests)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recipient-share.test.tsx (10 tests)"
        status: pass
    human_judgment: true
    rationale: "Test-level only. Nobody has yet opened a real minted link in a private window — and the mint route does not exist until plan 164-03. The end-of-phase UAT is what closes this, including the deliberate URL-bar hop to /factsheet-share/gone."
  - id: D4
    description: "The token lane is reachable anonymously and does not bounce an authed owner to the dashboard"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "npm run lint → check-route-contract (58 page routes, Rules 1+2+5 across proxy.ts and the manifest)"
        status: pass
    human_judgment: true
    rationale: "The lint gate proves the manifest and PUBLIC_ROUTES are in lockstep; it does not prove an authed browser actually reaches the page. That needs a real session against a deployed build."

duration: 41min
completed: 2026-08-27
status: complete
---

# Phase 164 Plan 01: Recipient token lane (tracer) Summary

**An anonymous holder of a valid share token now renders an unpublished strategy's factsheet through the same builder the owner lane uses — from a module that structurally cannot reach the id-keyed public cache — and every miss ends at a genuine, content-free HTTP 410.**

## Performance

- **Duration:** 41 min
- **Tasks:** 3 of 3
- **Commits:** 4 (3 task commits + 1 Rule-3 guard fix)
- **Full vitest suite:** 813 files / 12,778 tests green in 245s (matches the 242s VALIDATION measurement)

## Accomplishments

### Task 1 — the seam (D-06)

`fetchAndBuildPayload` and `StrategyVisibility` moved out of the 699-line
`factsheet/[id]/v2/page.tsx` into `src/lib/factsheet/fetch-and-build-payload.ts`.
The move is byte-identical apart from two `export` keywords and two comment
fixes (below). `buildFactsheetPayloadCached` did **not** move — it stays private
to the page, where the lane decision that makes the id-keyed cache safe also
lives. The page's diff is an import swap plus a deletion; nine now-unused
imports were dropped with it.

The phase-148 OWN-02 guard's pin 4 split into two rules with different shapes:

- **4a** `buildFactsheetPayloadCached` — unchanged. Page-private, repo-walk enforced.
- **4b** `fetchAndBuildPayload` — a **module pin**: exactly one production file may
  contain a `function fetchAndBuildPayload` declaration and it must be the
  canonical module; every *other* production file naming the identifier must
  carry the literal specifier `@/lib/factsheet/fetch-and-build-payload`.

The module pin is strictly stronger than the two-caller allow-list the first
draft of D-06 proposed, and RED experiment 4 below is the proof rather than the
claim: a duplicate declaration that *did* import the canonical specifier —
satisfying rule 4b(ii) — was still caught by 4b(i).

### Task 2 — the token module (D-02)

`src/lib/strategy-share-token.ts` derives
`HMAC-SHA256(SHARE_TOKEN_SECRET, "${strategy_id}.${generation}")` as a 43-char
base64url token, and verifies with a format guard *before* `timingSafeEqual`.
It is a separate module from `scenario-share-token.ts` by ruling, and its header
states explicitly that this is a **stateful** keyed MAC — the stored generation
counter is the revocation mechanism — so a reviewer does not read it as
contradicting the scenario module's documented rejection of a *stateless* one.
The D-07 revisit threshold (1,000 active share rows) is recorded there, in the
module, rather than only in a plan file.

The secret is read as a literal `process.env.SHARE_TOKEN_SECRET` (an indexed
read would be invisible to the env-manifest gate and would have to be parked in
its exemption list, which is how a key stops being enforced) and validated at
module scope. `.env.example` documents it; both `npm run build` steps in
`ci.yml` carry an obviously-fake placeholder.

### Task 3 — the tracer

`/factsheet-share/[token]` is an RSC route pinned `force-dynamic` + `nodejs`
that rate-limits **first**, format-guards, scans non-revoked `strategy_shares`
rows with a constant-time compare, and on a match calls the shared builder
directly with a local identity predicate. The header states plainly that the
HMAC match *is* the authorization, which is why the payload query deliberately
carries no status predicate — a published-only predicate there would make every
share link fail for exactly the strategies the feature exists for.

`/factsheet-share/gone` returns a real 410 with `no-store`, `noindex`,
`no-referrer` and a body containing two sentences and nothing else.

`FactsheetView` gained a `shared_privately` notice and a `recipientShare` render
prop that suppresses the Copy-Link control and outbound navigation.
`useShareMode()` is byte-unchanged (D-09); `ControlBar` ORs the two.

## Measurements (not assumptions)

**Where the fail-loud fires — the BUILD, measured.** `npm run build` without
`SHARE_TOKEN_SECRET`:

```
Error: Failed to collect configuration for /factsheet-share/[token]
  [cause]: Error: SHARE_TOKEN_SECRET must be set to a string of at least 32
  characters. Remedy: generate one locally (`openssl rand -base64 48`), add it
  in Vercel → Settings → Environment Variables for ALL environments and
  redeploy, and set it in .env.local for local dev. ⚠️ Rotating this value
  revokes EVERY outstanding share link.
```

A Vercel deploy with the var unset therefore **fails the build and never
reaches production** — the strongest of the two possible arms. With the CI
placeholder the build compiles in 20.6s and both routes emit as `ƒ (Dynamic)`.

**Pre-edit gate token counts** (comment-stripped production `src/`, 707 files):
`buildFactsheetPayloadCached` 1 file, `fetchAndBuildPayload` 1 file (+ a
comment-only mention in `types.ts`, which is the phase-148 guard's own
comment-stripping fence).

## Anti-vacuity — six RED experiments, all restored

Every guard touched or written here was demonstrated able to fail. Restoration
was always by re-editing or deleting temp files, never `git checkout --`, and
was verified by `shasum` or `git diff --quiet`.

| # | Neuter | Result |
|---|--------|--------|
| 1 | Temp `src/lib/__gate_demo__/a.ts` naming `fetchAndBuildPayload` without the canonical import | phase-148 rule 4b(ii) RED — 1 failed / 11 passed |
| 2 | Same file rewritten to **declare** the builder while importing the canonical specifier | phase-148 rule 4b(i) RED — 1 failed / 11 passed. This is the experiment showing the module pin beats an import-path check |
| 3 | Same file naming `buildFactsheetPayloadCached` | phase-148 rule 4a RED — 1 failed / 11 passed |
| 4 | Module-scope secret throw replaced by a lazy default | 3 token tests RED / 15 passed; sha256 matched pre-neuter on restore |
| 5 | `recipientShare` removed from the ControlBar OR **and** the ShareLinkButton guard | 2 recipient-mode tests RED / 8 passed; sha256 of `FactsheetView.tsx` matched pre-neuter on restore |
| 6 | `returns_series` dropped from the moved builder's select | 2 phase-147 tests RED / 11 passed; `git diff --quiet` clean on restore |

## Deviations from Plan

### 1. [Rule 3 — Blocking] The phase-147 REFERENCE pin also had to be re-pointed

- **Found during:** post-Task-3 verification, running the whole `src/__tests__`
  directory rather than the plan's file-scoped verify commands.
- **Issue:** `phase-147-series-resolution-guards.test.ts` pins that
  `factsheet/[id]/v2/page.tsx` selects `returns_series` and calls
  `resolveDailyReturnSeries`. Both travelled with the D-06 move, so the pin was
  asserting them against a file that no longer contains them. The plan named
  only the phase-148 guard.
- **Fix:** re-pointed at the builder and **split into two** so both halves of
  the original claim survive — (i) the builder selects and resolves, and (ii)
  the v2 page still reaches the series *through* that builder. Without (ii), a
  page that stopped calling the builder entirely would have left (i) green while
  the reference surface rendered nothing.
- **Commit:** `a3a6f6e6c`

### 2. [Rule 3 — Blocking] `/factsheet-share/gone` is classified `exception`, not `public`

- **Issue:** the plan specified `class: "public"` for both manifest entries.
  `check-route-contract.ts` Rule 4 requires every non-`exception` entry to map to
  a real `page.tsx`; `gone` is a `route.ts`, so a `public` entry would have been
  reported STALE and reddened `npm run lint`.
- **Fix:** classified `exception` with notes recording that its public
  reachability is real and comes from the `/factsheet-share` PUBLIC_ROUTES
  prefix. This is exactly the carve-out `/api/health` already uses, and the
  guard's own error message names it as the remedy.

### 3. [Rule 2 — Doc correctness] Two directional phrases fixed inside the verbatim move

- **Issue:** the moved doc block said "`buildFactsheetPayloadCached` below" and
  "the wrapper below", both of which became false the moment the block left the
  page. The page's own wrapper comment said "see the header comment", pointing
  at a header that had moved to another file.
- **Fix:** the three references now name `v2/page.tsx` /
  `@/lib/factsheet/fetch-and-build-payload` explicitly. Function bodies are
  byte-identical; only comment prose changed. A verbatim move that leaves lies
  in its comments is not verbatim in the way that matters.

### 4. [Ordering] The Task-2 build measurement ran after Task 3

- **Rationale:** the plan places it in Task 2, but at that point no production
  module imported the token module, so `npm run build` would have passed for the
  trivial reason that nothing evaluated it. Deferring made the measurement mean
  something. Result recorded above.

## Environment note (not a code change)

`npm run build` initially died with `Too many levels of symbolic links` inside
`node_modules/node_modules/node_modules/…`. Cause: the **main** checkout's
`node_modules` contains a self-referential symlink
`node_modules -> node_modules`, dated 2026-08-25 — almost certainly a mis-rooted
worktree bootstrap from an earlier session. It is untracked and pre-existing,
not created here.

Worked around **inside this worktree only**, without touching the main
checkout: the worktree's `node_modules` symlink was replaced with a directory of
754 per-entry symlinks into the main `node_modules`, skipping the bogus
`node_modules` entry. Both builds then ran normally.

⚠️ **Worth booking as a TODO for the founder:** every `npm run build` in a GSD
worktree hits this until the stray `node_modules/node_modules` symlink is
removed from the main checkout's `node_modules/`. A worktree agent should not
delete files from the main checkout, so it was left in place.

## Known Stubs

None. The token lane is fully wired at every layer it owns.

The `strategy_shares` table it reads does not exist yet — it lands in plan
164-02 — but that is a declared cross-plan dependency, not a stub: the read is
typed through the repo's cast-through-unknown pattern with the standard "delete
when types regen lands" note, and the tests exercise the real query shape
(projection, `.is("revoked_at", null)`) against a double pinned to that contract.

## UAT notes for the reviewer

1. **The URL-bar hop to `/factsheet-share/gone` is the D-08 design, not a bug.**
   App Router pages cannot emit 410 — verified against the bundled Next 16 docs,
   which expose only `notFound`, `forbidden` and `unauthorized`. The honest
   status line costs one visible redirect.
2. **410 here, 404 on the bare-id lane, deliberately.** Telling a token holder
   their link is dead leaks nothing. Telling an id holder that an id *exists* is
   an existence oracle, so `/factsheet/[id]` keeps its uniform 404.
3. **A valid token whose payload is still computing shows a pending card, not
   the 410.** Calling a live link dead would be a false statement, and pending is
   exactly when an owner is most likely to have shared it.
4. **End-to-end UAT is still owed** and cannot run until plan 164-03 ships the
   mint route — there is currently no way to obtain a real token outside a test.

## Self-Check: PASSED

All 8 created files exist on disk; all 4 commits resolve in `git log`.

| File | Status |
|------|--------|
| `src/lib/factsheet/fetch-and-build-payload.ts` | FOUND |
| `src/lib/strategy-share-token.ts` | FOUND |
| `src/lib/strategy-share-token.test.ts` | FOUND |
| `src/app/factsheet-share/[token]/page.tsx` | FOUND |
| `src/app/factsheet-share/[token]/page.test.tsx` | FOUND |
| `src/app/factsheet-share/gone/route.ts` | FOUND |
| `src/app/factsheet-share/gone/route.test.ts` | FOUND |
| `src/app/factsheet/[id]/v2/FactsheetView.recipient-share.test.tsx` | FOUND |

| Commit | Status |
|--------|--------|
| `41a04c100` refactor(164-01) | FOUND |
| `e4fda2230` feat(164-02) | FOUND |
| `e2f67f6cb` feat(164-03) | FOUND |
| `a3a6f6e6c` fix(164-01) | FOUND |
