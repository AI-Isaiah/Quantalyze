---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 05
subsystem: security
tags: [sentry, plausible, posthog, referrer-policy, unstable_cache, share-token, disclosure]

requires:
  - phase: 164-01
    provides: "the recipient route `/factsheet-share/[token]`, `strategy-share-token.ts` (module-load secret throw), the 410 gone sibling"
provides:
  - "src/lib/scrub-share-path.ts — pure share-path scrubber + isSharePath predicate"
  - "Sentry beforeSend + beforeSendTransaction + onRequestError path scrub (net-new; no prior scrub existed in src/)"
  - "Boot-time visibility for SHARE_TOKEN_SECRET (D-02 second half)"
  - "Per-route Referrer-Policy: no-referrer on the share lane"
  - "Plausible withdrawn on the share lane via src/app/PlausibleScript.tsx"
  - "Recipient-mode PostHog suppression in factsheet-analytics.ts"
  - "SHARE-02's ORDERED adversarial cache-isolation acceptance, RED-demonstrated"
  - "A structural no-cache-reach guard for the token route (closes a MEASURED gap in the phase-148 guard)"
affects: [164-06, 164-07, 164.1, phase-148 guard maintenance, any future client-side Sentry init]

actuals:
  tokens: 21053
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Path-derived leak suppression: the route implies the mode, no prop threading"
    - "Two independent detectors per disclosure defect — one behavioural, one structural"

key-files:
  created:
    - src/lib/scrub-share-path.ts
    - src/lib/scrub-share-path.test.ts
    - src/app/PlausibleScript.tsx
    - src/app/PlausibleScript.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
    - src/app/factsheet-share/[token]/page.no-cache-reach.test.ts
    - src/app/factsheet/[id]/v2/factsheet-analytics.test.ts
    - src/__tests__/phase-164-share-lane-headers.test.ts
  modified:
    - src/instrumentation.ts
    - src/instrumentation.test.ts
    - next.config.ts
    - src/app/layout.tsx
    - src/app/factsheet/[id]/v2/factsheet-analytics.ts

key-decisions:
  - "Plausible: shipped CONDITIONAL SCRIPT OMISSION, not the plan's data-exclude — the assumed mechanism is pageview-only AND removed from Plausible's current script (both measured 2026-08-28)"
  - "The per-route no-referrer is justified by the SAME-ORIGIN gap, not by the false 'strips query but never path' claim, which is recorded as false in code and test"
  - "The scrubber's segment class is RFC 3986 pchar, not [^/?#] — over-matching costs a log comma, under-matching leaks"
  - "SHARE_TOKEN_SECRET's length floor is duplicated in instrumentation.ts rather than imported, because the canonical module throws at module scope"
  - "Added a token-route structural guard in a NEW file rather than editing phase-148's (owned by concurrently-running 164-07)"

patterns-established:
  - "Ordered adversarial acceptance: poison-then-probe on UNCLEARED spies; two split tests would both stay green against a poisoned cache"
  - "Assert on the OUTPUT of the callback the process really registers, never on config-key presence"

requirements-completed: [SHARE-02, SHARE-01]

coverage:
  - id: D1
    description: "A raw share token never reaches Sentry — event URL, transaction, breadcrumbs, spans, trace and extra all scrubbed on PATH"
    requirement: SHARE-01
    verification:
      - kind: unit
        ref: "src/instrumentation.test.ts#the REGISTERED beforeSend scrubs every URL-shaped field of the event"
        status: pass
      - kind: unit
        ref: "src/instrumentation.test.ts#onRequestError sends the PLACEHOLDER as extra.path, never the raw token"
        status: pass
      - kind: unit
        ref: "src/lib/scrub-share-path.test.ts (21 vectors)"
        status: pass
    human_judgment: true
    rationale: "A config-level test proves the WIRING and the TRANSFORM. It cannot prove a REAL event, from a real error on a deployed token URL, arrives redacted — the SDK's event assembly is mocked. 164-CONTEXT.md Blocker 3 mandates reading a real captured event. Post-deploy UAT."
  - id: D2
    description: "Plausible receives no /factsheet-share/<token> pageview — the script is not loaded on the lane at all"
    requirement: SHARE-01
    verification:
      - kind: unit
        ref: "src/app/PlausibleScript.test.tsx#renders NO script element at all on /factsheet-share/*"
        status: pass
    human_judgment: true
    rationale: "Asserted on rendered markup in jsdom. The deployed claim (open a token link with the network panel filtered to plausible.io and see zero requests) needs a browser against a real deploy."
  - id: D3
    description: "Referrers from the token route carry no token — per-route no-referrer beside the untouched global policy"
    requirement: SHARE-01
    verification:
      - kind: unit
        ref: "src/__tests__/phase-164-share-lane-headers.test.ts#the share route resolves to Referrer-Policy: no-referrer"
        status: pass
    human_judgment: true
    rationale: "Asserts the RESOLVED header table from next.config.ts, which is stronger than a grep but is still build-time config. `curl -sI` on a live token URL is the deployed proof."
  - id: D4
    description: "Recipient-mode pageviews fire no product analytics — the PostHog bundle is never imported on the lane"
    requirement: SHARE-01
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-analytics.test.ts#no-ops on /factsheet-share/* — posthog-js is never even imported"
        status: pass
    human_judgment: false
  - id: D5
    description: "SHARE-02: after a token-lane render of an unpublished strategy, an anonymous request for /factsheet/<id> STILL 404s — ordered, RED-demonstrated"
    requirement: SHARE-02
    verification:
      - kind: unit
        ref: "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx#2. ORDER IS THE TEST"
        status: pass
      - kind: unit
        ref: "src/app/factsheet-share/[token]/page.no-cache-reach.test.ts (structural, 9 assertions)"
        status: pass
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts (regression, unedited)"
        status: pass
    human_judgment: false
  - id: D6
    description: "SHARE_TOKEN_SECRET misconfiguration is visible in the production deploy log before anyone clicks Copy Link"
    requirement: SHARE-01
    verification:
      - kind: unit
        ref: "src/instrumentation.test.ts#register() logs the error AND captures it to Sentry in a broken prod"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-08-28
status: complete
---

# Phase 164 Plan 05: Token-leak channel closure + SHARE-02 acceptance Summary

**Every path-token leak channel the A-D1 re-derivation found is closed by a mechanism that cannot silently degrade, and SHARE-02's ordered adversarial cache isolation is proven by two detectors both observed RED under the real poisoning.**

## Performance

- **Duration:** 32 min
- **Tasks:** 3/3
- **Commits:** 4 (3 task + 1 metadata)
- **Files:** 8 created, 5 modified, 1746 insertions

## Accomplishments

### Task 1 — Sentry path scrub (net-new) + boot-visible secret — `6b649d811`

`grep -rn "beforeSend\|beforeBreadcrumb" src/` returned zero hits at HEAD, so this had no analog to extend and none to copy. It is deliberately not unified with the demo-pdf token code.

- **`src/lib/scrub-share-path.ts`** — pure, total, idempotent. Collapses any `/factsheet-share/<segment>` to `/factsheet-share/[token]`, preserving query, hash and trailing path. Deliberately not scoped to the 43-char token shape: malformed tokens raise errors too, and the gone path is on the lane.
- **`src/instrumentation.ts`** — `beforeSend` AND `beforeSendTransaction`. Both hooks, because a token reaches Sentry by two independent routes: an error event (`request.url`, breadcrumbs) and a transaction event (transaction name, span descriptions). Wiring only `beforeSend` would leave the tracing channel — sampled at 10% — leaking on its own schedule. `onRequestError` scrubs `extra.path` at the point of capture as a second, independent point; `tags.routePath` is left alone because Next hands it already parameterized.
- **Guard comment**, as the plan required: Sentry is server-only here, and a future client init re-opens the browser breadcrumb/replay channel and must adopt this same scrubber.
- **Boot check** for `SHARE_TOKEN_SECRET` in production — `console.error` with the named remedy plus a Sentry `captureMessage`, never on `SOFT_SKIP_PROD_KEYS` (whose contract is warn-only/never-crash, the opposite of D-02's intent). The message names the variable and its LENGTH, never its value.

### Task 2 — Referrer, Plausible, PostHog — `bf88785b3`

- **`next.config.ts`** — route-scoped `Referrer-Policy: no-referrer` on `/factsheet-share/:path*`; the global `strict-origin-when-cross-origin` is untouched.
- **`src/app/PlausibleScript.tsx`** — the tracker is withdrawn on the share lane. See "Deviations" for the measurement that replaced the plan's mechanism.
- **`src/app/factsheet/[id]/v2/factsheet-analytics.ts`** — path-derived recipient no-op. Gating the tracker (not `init()`) means the PostHog bundle is never imported on the lane at all.
- **`src/__tests__/phase-164-share-lane-headers.test.ts`** — asserts the RESOLVED header table returned by `next.config.ts`'s `headers()`, not the file's text.

### Task 3 — the ORDERED adversarial acceptance — `22a1cb708`

`src/app/factsheet-share/[token]/page.cache-isolation.test.tsx`. Order is the test: a token render of an UNPUBLISHED strategy first, then an ANONYMOUS probe of the same id on **uncleared spies**. Two tests that each checked one half would both stay green against a poisoned cache, because neither observes the second request in the state the first left behind. Zero is the only acceptable count, not "a different key" (SL-1a).

Harness properties that are load-bearing: `unstable_cache` is a **spy**, not a bare identity stub; the token is derived by the **real** `deriveShareToken` and authorised by the page's **real** `verifyShareToken` scan; `fetchAndBuildPayload` is **not** mocked — both lanes run the shipped builder; `@/lib/visibility` runs via `importActual`.

## RED-then-GREEN evidence

All three neuter cycles restored from **byte backups verified by `shasum`**. `git checkout --` was never used in this tree.

### NEUTER-A + NEUTER-B — Sentry scrub (Task 1)

`scrubSentryEvent` early-returns; `extra.path` unscrubbed.

```
 Test Files  1 failed (1)
      Tests  3 failed | 13 passed (16)

 × the REGISTERED beforeSend scrubs every URL-shaped field of the event
   AssertionError: expected 'GET /factsheet-share/Xk3pQ9vLm2Rt7Wb1…' to be 'GET /factsheet-share/[token]'
   Expected: "GET /factsheet-share/[token]"
   Received: "GET /factsheet-share/Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov"

 × the REGISTERED beforeSendTransaction scrubs too — tracing is its own channel
   AssertionError: expected '{"transaction":"GET /factsheet-share/…' not to contain 'Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7…'

 × onRequestError sends the PLACEHOLDER as extra.path, never the raw token
   AssertionError: expected '/factsheet-share/Xk3pQ9vLm2Rt7Wb1Yz4N…' to be '/factsheet-share/[token]'
```

Restore verified: `97ad695f7805afecb1f8150709041577a50c2eb9` on both the backup and the restored file; 16/16 green.

### NEUTER-C — recipient analytics gate (Task 2)

`isSharePath` early return removed.

```
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)

 × no-ops on "/factsheet-share/Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov" — posthog-js is never even imported
   AssertionError: the PostHog bundle must not load: expected "vi.fn()" to not be called at all, but actually been called 1 times
 × no-ops on "/factsheet-share/gone" — posthog-js is never even imported
 × no-ops on "/factsheet-share" — posthog-js is never even imported
```

Restore verified: `6873d08893125638794f3b75d536f0abcec26b72`; 5/5 green.

### NEUTER-D — the cache poisoning (Task 3) — THE HEADLINE

The token page's payload fetch rewired through `unstable_cache(async () => fetchAndBuildPayload(...), ["factsheet-v2-payload-v6", match.strategy_id], { revalidate: 3600, tags: [...] })` — the exact poisoning D-01's structural argument prevents.

**Detector (a) — behavioural, `page.cache-isolation.test.tsx`:**

```
 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)

 × 1. token render of an UNPUBLISHED strategy succeeds and touches the cache ZERO times
   AssertionError: SL-1: the token lane must produce ZERO cache reads and ZERO cache writes
   — a key suffix is not a key: expected "vi.fn()" to be called +0 times, but got 1 times

 × 2. ORDER IS THE TEST — after that token render, an ANONYMOUS request for the SAME id
     still 404s, cache still at zero
   AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times

 × 3. the token lane does not shift the PUBLIC lane's key shape
   AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times
```

**Detector (b) — the plan said phase-148 would also go red. IT DID NOT:**

```
$ npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

This is a plan error, and a real unowned gap — see "The plan was wrong" below. The gap was closed with a **new** structural guard, `page.no-cache-reach.test.ts`, which on the SAME neutered tree gave:

```
 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)

 × imports nothing from next/cache
   AssertionError: an import from next/cache on this lane is the SL-1 disclosure shape:
   expected '\nimport { redirect } from "next/navi…' not to contain 'next/cache'
 × never names unstable_cache outside a comment
   AssertionError: expected '\nimport { redirect } from "next/navi…' not to contain 'unstable_cache'
```

Restore verified: `506d04e12881b7b0fb46889081c2e16f24760f9d`, and `page.tsx` is **absent from `git status`** — byte-identical to HEAD. All three suites re-run green: 25/25.

## Leak channels closed, and how each is verified

| Channel | Mitigation | Pre-merge verification | Residual |
|---|---|---|---|
| Sentry error events (`request.url`, breadcrumbs, `extra.path`) | `beforeSend` + point-of-capture scrub | RED-proven output-event assertions on the REGISTERED callback | Real deployed event unread — UAT |
| Sentry transaction events (transaction name, spans, trace) | `beforeSendTransaction` | Same | Same |
| Plausible (`location.href` on every event) | Script not loaded on the lane | Rendered-markup assertions, jsdom | Network-panel check on a deploy — UAT |
| PostHog product events (`$current_url`) | Path-derived tracker no-op; bundle never imported | RED-proven; the module-load spy is the oracle | None |
| `Referer` on same-origin navigation | Per-route `no-referrer` | Resolved header table from the real `headers()` | `curl -sI` on a deploy — UAT |
| id-keyed `unstable_cache` poisoning | Structural: the module has no cache reach | Two detectors, both RED under NEUTER-D | None |
| Access logs, browser history, link unfurlers | **Accepted** (T-164-17) | — | Revocability is the designed mitigation |

## Deviations from Plan

### 1. [Rule 1 — Bug] The scrubber's first segment class corrupted free text

- **Found during:** Task 1, by the multiple-occurrence vector — not by review.
- **Issue:** `[^/?#]+` matched everything up to the next `/`, `?` or `#`. Sentry breadcrumb messages are free text, so a token followed by prose was swallowed whole: `"GET /factsheet-share/[token]//quantalyze.xyz/..."` instead of `"GET /factsheet-share/[token] failed; retried https://quantalyze.xyz/..."`.
- **Fix:** the class is now RFC 3986 `pchar` — exactly what a URL path segment may contain. base64url is a strict subset, so widening beyond the token alphabet can only ever consume MORE than the token, never less; over-matching costs a trailing comma in a log line, under-matching leaks the capability. The asymmetry decides it. Both behaviours are pinned by vectors.
- **Commit:** `6b649d811`

### 2. [Plan error — the plan's own escape hatch taken] Plausible `data-exclude` replaced by conditional omission

The plan flagged the exclusions mechanics `[ASSUMED]` and instructed: verify against current docs; if the docs contradict the mechanism, **do not ship a guess** — fall back to conditional script omission. The docs contradict it. **Verified 2026-08-28 against the real artefacts, not a summary:**

| Claim | Source | Result |
|---|---|---|
| The composite build exists | `curl https://plausible.io/js/script.exclusions.tagged-events.js` | **200, 4497 bytes** — it does |
| Wildcard semantics | live bundle: `` RegExp("^"+e.trim().replace(/\*\*/g,".*").replace(/([^\.])\*/g,"$1[^\s/]*")+"/?$") `` | **As assumed** — `*` does not cross `/`, anchored. This half of the research held up |
| The exclusion covers all events | live bundle: `var b = "pageview" === m; … if (b) { … return h(m,g,"exclusion rule") }` and `N.u = location.href` on EVERY event | ❌ **PAGEVIEW-ONLY.** A tagged event on the lane still posts the full href |
| `data-exclude` is current | `plausible/docs/script-update-guide.md` §10, "Removed: `data-exclude` and `data-include`" (Oct-2025 script) | ❌ **Removed.** Points at `excluding.md` |
| The documented replacement | `plausible/docs/excluding.md` — dashboard "Shields → Pages" | ❌ **Server-side.** Stops Plausible RECORDING the hit, not the browser SENDING it |

A Shield is not a mitigation for a capability token: the secret has already crossed the trust boundary. And the migration is silent — regenerating the snippet from Plausible's site settings drops the attribute with no error and reopens the channel.

**Shipped instead:** `src/app/PlausibleScript.tsx`, a client gate that renders nothing on the lane and the identical tag everywhere else. It depends on nothing a third party can deprecate: no script means no pageview, no tagged event, no `location.href`.

Explicitly rejected: "zero `plausible-event-name=` sites exist in `src/` today (measured), so pageview-only is fine." That is an accident of the current tree, and an accident is not a mitigation — the same Pitfall-6 reasoning that refuses to count the CSP's missing PostHog host as a control.

**Files beyond `files_modified`:** `src/app/PlausibleScript.tsx` + its test. A layout cannot know the pathname server-side — layouts do not re-render on navigation, so Next withholds it (bundled Next **16.2.11** docs, `layout.md` §Pathname). `usePathname` in a Client Component is the documented mechanism, and it needs a Suspense boundary only under `cacheComponents`, which is off here.

### 3. [Rule 2 — missing critical functionality] The plan's "two independent detectors" claim was false; the second detector did not exist

Measured under NEUTER-D: phase-148 stayed **12/12 green** against a live cache-poisoning of the token lane.

**Why:** `phase-148-owner-lane-cache-isolation.test.ts:382` counts `unstable_cache(` occurrences in `factsheet/[id]/v2/page.tsx` **only**. A second call site in a different file is invisible to it. Its repo-wide walks ban two *symbols* (`buildFactsheetPayloadCached`, `fetchAndBuildPayload`) and the neuter used neither — it inlined `unstable_cache` directly, which is both the shortest path to the defect and the one a "make the recipient page faster" PR would actually take.

**164-07 does not close it either.** That plan pins the *transitive import closure* of `fetch-and-build-payload.ts`. This page imports the builder; the builder does not import the page, so the page is not in that closure and never will be. The gap was unowned.

**Fix:** `src/app/factsheet-share/[token]/page.no-cache-reach.test.ts` — a new file, deliberately **not** an edit to phase-148's file, which belongs to the concurrently-running 164-07. Pins: no `next/cache` import; no cache primitive named outside a comment (`unstable_cache`, `revalidateTag`, `revalidatePath`, `cacheTag`, `cacheLife`, `buildFactsheetPayloadCached`); `force-dynamic` survives; plus anti-vacuity that the comment stripper left real code behind. A missing page is a FAILURE, not a skip. RED output above.

### 4. [Correction carried] The `Referrer-Policy` rationale in this plan and in CONTEXT.md is factually wrong

`164-CONTEXT.md:158,346` and `164-05-PLAN.md`'s objective state that `strict-origin-when-cross-origin` "strips query strings cross-origin but NEVER strips the path". **That is false.** Cross-origin, that policy sends **only the origin** — neither path nor query survives. Query and path tokens are equally covered cross-origin.

The header is still correct, for a different and real reason: **same-origin** navigation, where the policy sends the FULL URL as `Referer` — path, token and all. The `no-referrer` block closes that, and costs nothing on this lane.

The false mechanism is **not** reproduced in any comment or docblock written here; it is recorded *as false* in `next.config.ts` and in `phase-164-share-lane-headers.test.ts` so it cannot be re-derived. See "Findings for the phase" for the one place it still survives.

### 5. [Scope] Files touched beyond `files_modified`

`src/lib/scrub-share-path.ts` gained `isSharePath` during Task 2 (one boundary shared by two suppressions beats two `startsWith` calls that drift), and three test files were added: `PlausibleScript.test.tsx`, `factsheet-analytics.test.ts`, `phase-164-share-lane-headers.test.ts`, `page.no-cache-reach.test.ts`. No file owned by another concurrent plan was touched — `phase-148-owner-lane-cache-isolation.test.ts` and `fetch-and-build-payload.ts` were **read and run, never edited**.

## Findings for the phase (not fixed here — out of this plan's file scope)

1. **`src/app/factsheet-share/gone/route.ts:77-80` and its test carry the same false Referrer-Policy mechanism.** Shipped by plan 164-01: *"The token arrived as a PATH segment, so `Referrer-Policy` on the origin…"* and the test name *"the token is a PATH segment, which Referrer-Policy does not strip"*. The **header is correct**; only the stated reason is wrong. Not corrected here because the file is outside this plan's `files_modified` and rewriting another plan's shipped comments mid-wave risks a conflict. Recommend a one-line correction pass at the phase gate.
2. **The `tagged-events` Plausible build is loaded but unused** — zero `plausible-event-name=` sites in `src/` (measured). Not this plan's business, but the plain `script.js` build would be smaller.
3. **The `SHARE_TOKEN_SECRET_MIN_LENGTH = 32` duplication** between `instrumentation.ts` and `strategy-share-token.ts` has no coupling test, because writing one requires importing the module that throws. Documented in both places.

## Known Stubs

None. No hardcoded empty values, placeholder text, TODO/FIXME markers, or unwired components were introduced.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change was introduced; every change removes surface or adds a detector. The register's dispositions hold: T-164-01 mitigated (two RED-proven detectors), T-164-02 mitigated (four channels, table above), T-164-09 mitigated (boot check), T-164-17 accepted unchanged.

## Verification

| Gate | Result |
|---|---|
| `npx vitest run src/lib/scrub-share-path.test.ts src/instrumentation.test.ts` | **37 passed** |
| `npx vitest run src/app/PlausibleScript.test.tsx …factsheet-analytics.test.ts …share-lane-headers.test.ts` | **67 passed** (with the two above) |
| `npx vitest run …page.cache-isolation.test.tsx …page.no-cache-reach.test.ts …phase-148…` | **25 passed** |
| `npx vitest run src/__tests__/contracts` | **109 passed (5 files)** — re-run after every task |
| `npx vitest run src/app` (343 files) | **5432 passed, 3 skipped** |
| Suites reading the changed files (route-contract, critical-regressions, phase-32 spine, viewport-zoom-meta, sentry-environment, cron-flag-monitor) | **205 passed** |
| `npx tsc --noEmit` | **clean** |
| `npm run lint` | **0 errors**, 3 pre-existing warnings in untouched files (`ContributionWizardOverlay`, `EquityChart`, `SyncPreviewStep`) |
| `npm run build` | **green** |
| D-04 / SL-1d fences (`api/og`, `tearsheet`, `api/factsheet`, `api/portfolio-pdf`) | **empty diffs**, committed and working tree — verified by `git`, not memory |

**Not run here:** the full-suite arbiter (`npm run test`). It is the orchestrator's phase gate, and 164-07 is executing concurrently — a shared-box full vitest run turns contention into fake regressions (measured previously: 1 → 9 → 55 red, 54 of them timeouts).

**Build note:** `npm run build` first failed with `SHARE_TOKEN_SECRET must be set…`. Environmental, and pre-existing on this branch since 164-01 added the module-load throw: the worktree has no `.env.local`. Re-run with the variable set — green. Not a code defect.

## Post-deploy UAT (cannot run pre-merge)

1. **Sentry.** Trigger a real error on a token URL in the deployed environment and read the captured event: every URL field must show `/factsheet-share/[token]` and none may show a 43-char base64url segment. 164-CONTEXT.md Blocker 3 is explicit that this must be read off a real event, not asserted from config.
2. **Plausible.** Open a token link with the network panel filtered to `plausible.io` — there must be **no request at all**, not merely one without the token.
3. **Referrer.** `curl -sI` a live token URL and confirm `Referrer-Policy: no-referrer`; confirm any other route still returns `strict-origin-when-cross-origin`.

## Self-Check: PASSED

All 8 created files exist on disk; all 5 modified files carry the changes. All three task commits exist in `git log`:

- `6b649d811` feat(164-05): scrub the share token out of Sentry + boot-visible SHARE_TOKEN_SECRET
- `bf88785b3` feat(164-05): close the browser-side token channels — referrer, Plausible, PostHog
- `22a1cb708` test(164-05): SHARE-02's ordered adversarial cache isolation, RED-demonstrated
