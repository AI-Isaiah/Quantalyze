# Phase 164: SHARE — Copy Link always works, and never discloses - Context

**Gathered:** 2026-08-26
**Status:** Ready for planning

<domain>
## Phase Boundary

"Copy Link" on a strategy its owner can view yields a URL its recipient can view — a revocable
per-strategy share token — and the token lane can never disclose an unpublished strategy through
the id-keyed public cache.

In scope: SHARE-01..SHARE-04. Out of scope: any publish flow for `status='private'` (see A-D2),
the tearsheet and PDF routes (see A-D3), and the curated-copy delivery problem (Phase 164.2).

</domain>

<decisions>
## Implementation Decisions

### ⭐ FOUNDER DECISIONS — taken 2026-08-26. All four were owed by success criterion 1 and are now CLOSED. Do not re-open, do not default, do not re-litigate.

#### A-D1 — URL shape: **separate route `/factsheet-share/<token>`**

The token lives in its own route, NOT as `?s=` on `/factsheet/[id]`.

Rationale (founder call, following ARCHITECTURE.md A.2's recommendation):
- **Enforcement becomes STRUCTURAL rather than behavioural.** A separate module physically cannot
  reach the `["factsheet-v2-payload-v6", id]` cache entry. The `?s=` option would have been a third
  branch inside a 664-line page that already carries two lanes and three "⛔ do not route this
  through the cache" comments — correctness would depend on a future editor reading them.
- **The SL-1c failure mode justifies the stronger guard.** A violation ships GREEN: the poisoning
  request is the owner's own, so it renders correctly, and the 3600s window in which every
  anonymous visitor to `/factsheet/<id>` receives a private strategy opens afterwards. No error,
  no log, no Sentry event. Structural beats behavioural when the failure is silent and TTL-long.
- **The id never enters the URL**, which strengthens the founder's own "the id must stay a
  non-secret" rationale rather than merely preserving it.
- Precedent exists and is CI-pinned: `/scenario-share/[token]`.
- Cost: +1 entry at `proxy.ts:17` and +1 prefix arm at `proxy.ts:117`. Accepted.

⚠️ **THIS SUPERSEDES A PREMISE IN `research/FEATURES.md`. Do not blend the two documents.**
`FEATURES.md:13-17` declares the 2026-08-13 shape (`?s=<token>`) to be "INPUT, not a question" and
its comparison table (`:96`) rejects a separate route as "contradicts the settled `?s=` URL shape".
That premise is now **withdrawn by the founder**. ARCHITECTURE.md A.2 had already recorded why the
two are not in fact the same kind of claim: `?s=` was a UX statement about what the recipient sees,
not a routing decision. Concretely, when reading FEATURES.md the planner MUST treat as void:
- the dependency line `?s= must imply shareMode` (`:121`) — the route now implies share mode
  structurally, so there is no query param to detect;
- the `:96` row rejecting the separate route;
- any reasoning downstream of "the URL contains the id".
Everything else in FEATURES.md (honest affordances, 410-vs-404 asymmetry, revoke semantics,
mint-on-copy, no auto-mint, no disabled buttons) is UNAFFECTED and still governs.

#### Token model — **HMAC + stored generation counter**

`token = HMAC(SHARE_TOKEN_SECRET, strategy_id || generation)`. The table stores
`(strategy_id, generation, revoked_at)` and **never a token, raw or hashed**.

Rationale:
- **Reuse is the requirement, and only a re-derivable token delivers it.** Success criterion 2 is
  explicit that a verbatim `/scenario-share` port "cannot deliver reuse — it stores only the hash
  and unconditionally revokes on mint, regenerating the original bug in slow motion." Hash-only
  storage makes the raw token unrecoverable, so every Copy Link would mint a new link and silently
  break the recipient's existing one. That is the founder-hit defect wearing a different hat.
- **Nothing secret sits at rest.** Rejected raw-at-rest for exactly this reason: it would make the
  database itself a disclosure surface, so a backup, a log, a support query or a future RLS mistake
  hands out working links.
- **Revoke is one atomic increment.** `generation += 1` invalidates every previously-copied link at
  once, and double-revoke converges naturally.

⚠️ **The new secret is a PROD-ONLY failure mode and must fail LOUD.** `SHARE_TOKEN_SECRET` must be
validated at module load / boot, not at first share — a missing var that only surfaces when a
founder clicks Copy Link in production is precisely the class this milestone exists to remove.
Treat a missing or short secret as a startup error with a named remedy.

⚠️ **Separate module from `scenario-share-token.ts`** (ARCHITECTURE.md A.5 anti-pattern 5). Do not
reuse it and do not extend it: `scenario-share-token.test.ts:53-55` pins
`hashShareToken("scenario-share")` to a literal digest, and one token namespace serving two
resources invites cross-resource replay if either RPC ever loosens. New module, separate pin.

#### A-D2 — Revoke lives **on the factsheet**; `StrategyActions` is UNCHANGED

Share state and the revoke control go on the factsheet itself, where the owner already is when they
share. `StrategyActions`' `return null` fall-through for `status='private'` stays exactly as it is.

⛔ **No publish flow grows inside this phase.** Widening `StrategyActions` would have forced a
decision on what else private rows can do and reopened the open product question TODOS.md records.
That question stays open deliberately.

#### A-D3 — Token scope: **HTML factsheet ONLY**

`/factsheet/[id]/tearsheet` and the PDF routes are OUT. A recipient hitting them gets the normal
404. The tearsheet carries its own `force-dynamic` pin and disclosure-tier redaction, and the PDF
route is separate again; each would need its own SL-1 argument and its own adversarial test.

⛔ The reason this is written down rather than assumed: deciding it *implicitly* is how a second
unguarded surface appears.

### Claude's Discretion

- Table and RPC naming, migration timestamp, and whether `create_strategy_share` is INVOKER or
  SECDEF — subject to the three-reviewer migration gate below.
- The inline-confirm copy for revoke (must match the `SavedScenariosList.tsx:598-615` precedent
  shape, NOT a `window.confirm`).
- Whether the owner's "a live link exists" state reuses the `has_active_share` + local-override
  shape from `SavedScenariosList.tsx:45-51,199-203` (recommended) or derives it fresh.

</decisions>

<code_context>
## Existing Code Insights

### Invariant the phase exists to protect

**SL-1 (cache):** for any strategy id `X`, the `unstable_cache` entry keyed
`["factsheet-v2-payload-vN", X]` MUST be exactly what `fetchAndBuildPayload(X, withPublishedOnly)`
returns — a pure function of `(X, database state)`, independent of viewer, session, cookies, query
string, headers, and any share token. **The token lane must produce zero cache WRITES and consume
zero cache READS at that key.** `null` is a value like any other and is stored unconditionally
(`v2/page.tsx:530-533`).

Corollaries, each already bitten once:
- **SL-1a** — a key SUFFIX is not a key. The `cacheKey` string is split at `::` and everything after
  the id is DISCARDED (`v2/page.tsx:282`). Any design whose safety argument is "we vary the
  cacheKey" is wrong by construction.
- **SL-1b** — the wrapper must stay predicate-free. `buildFactsheetPayloadCached` accepts no
  visibility argument (`v2/page.tsx:287-294`) and that is the single structural defence. ⛔ Do not
  generalise it. A token lane needing a payload calls `fetchAndBuildPayload` DIRECTLY, exactly as
  the owner lane does at `v2/page.tsx:535-538`.
- **SL-1c** — the failure is silent and TTL-long (see A-D1 rationale).
- **SL-1d** — the CDN is a second cache. ⛔ Do NOT make `/api/og/factsheet/[id]` token-aware: it
  would put a CDN-cached, URL-keyed, un-revocable public image of a private strategy behind a 7-day
  `stale-while-revalidate`. The token lane ships NO OG image, keeps `robots: "noindex"`, and its
  metadata must not leak the strategy NAME (today's fallback already degrades to "Strategy" —
  verify, do not widen).

### Reusable assets
- `/scenario-share/[token]/page.tsx` — the whole recipient-route pattern: `force-dynamic`,
  `no-store`, service-role transport, `publicIpLimiter` + `getClientIp`.
- `share/revoke/route.ts` — owner-scoped UPDATE setting `revoked_at`, never a hard DELETE; 0 rows →
  404 not 403 (no existence oracle); 404-on-double-revoke read as convergence, not failure.
- `SavedScenariosList.tsx:333-341, 45-51, 199-203, 598-615` — revoke semantics, `has_active_share`
  state machine (none → `Share`; active → `Copy link` + `Revoke`), and the inline-confirm shape.

### Established patterns
- Anti-vacuity is a hard project rule: the ORDERED adversarial cache test must be demonstrated RED
  with the bypass neutered, then restored. Shape: owner-with-token request FIRST, then an anonymous
  request for the same id must still `notFound()` (the phase-148 / T-148-04 template).
- Gate tokens must be counted PRE-EDIT.
- ⛔ Unknown token and unknown id must produce byte-identical responses on their own lanes: 410 on
  the TOKEN lane (deliberate revocation), uniform 404 on the bare-id lane. Telling a token holder
  their token *was* valid leaks nothing; telling an id holder the id exists is an existence oracle.

### Integration points
- `proxy.ts:17` (PUBLIC_ROUTES) + `proxy.ts:117` (prefix arm) — the +2 lines A-D1 accepts.
- `next.config.ts:79` sets `Referrer-Policy: strict-origin-when-cross-origin`, which strips the
  query string on CROSS-origin navigation only. Under A-D1 the token is a path segment, not a query
  param, so `Referrer-Policy` does not strip it at all — see the token-leak note below.
- Sentry: scrub the token from URL fields via `beforeSend`/`beforeBreadcrumb` BEFORE the lane ships,
  and verify by triggering a real error on a token URL and reading the event — do not assert it
  from the config file.

</code_context>

<specifics>
## Specific Ideas

- ⚠️ **A-D1 changes the token-leak surface and the mitigation must follow it.** PITFALLS.md's
  analysis was written for `?s=<token>`, where the token is a query param. As a PATH SEGMENT the
  token is carried by strictly more channels: `Referrer-Policy: strict-origin-when-cross-origin`
  strips query strings cross-origin but never strips the path. Re-derive the mitigation for a path
  token rather than porting the query-param analysis. The channels that still apply unchanged:
  same-origin navigation, in-page JS reading `location.href` (Sentry transaction names,
  breadcrumbs, replay), server/CDN/platform access logs, browser history and history sync, and link
  unfurlers fetching the URL server-side.
- The revoked/unknown-token page must carry NO strategy name, NO metrics, NO id, NO owner identity,
  and `no-store`. Substance: "This link is no longer active. The person who shared it turned it off.
  Ask them for a new link."
- `OwnerUnpublishedNotice`'s "anyone else sees a 404" sentence becomes FALSE the moment tokens ship
  and must be corrected in the SAME phase (SHARE-04).
- `FactsheetView.tsx:1312` strips the token when rebuilding the URL — under A-D1 this becomes "a
  recipient must not see a Copy-Link control at all", since there is no id-route URL for them to
  rebuild. Re-read that site against the new route shape.
- ⛔ Three reviewers before any migration apply: `migration-reviewer`, `rls-policy-auditor`,
  `silent-failure-hunter`.
- ⚠️ **SKIP-01 applies to this phase's SQL gates.** No workflow applies migrations to TEST and
  `sql-tests` has no apply step, so any migration self-check written with a pre-apply tolerance arm
  goes permanently silent in CI. Do not author a gate whose "safe" arm is the state TEST is stuck
  in.

</specifics>

<verified_corrections>
## ⛔ VERIFIED CORRECTIONS + BLOCKERS (measured at HEAD 2026-08-26 by the orchestrator)

The line numbers this file inherited from `research/*` are STALE. Every citation below was
re-read at HEAD. **Use these, not the research files' numbers.**

### Corrected citations

| Claim | Research said | ACTUAL at HEAD |
|---|---|---|
| Copy-Link URL builder | `FactsheetView.tsx:1312` | **`FactsheetView.tsx:1489`** (`:1312` is about observation counts — unrelated) |
| Share-mode detection | "`?s=` must imply shareMode" | **`useShareMode()` at `FactsheetView.tsx:1470-1481`** |
| Cached wrapper | `v2/page.tsx:287-294` | **`v2/page.tsx:314`** (`buildFactsheetPayloadCached`) |
| Owner-lane direct call | `v2/page.tsx:535-538` | **`v2/page.tsx:563-573`** |
| `OwnerUnpublishedNotice` | — | **`v2/page.tsx:605`** |

### ⭐ `?share=1` ALREADY EXISTS — and A-D1 relocates it

`FactsheetView.tsx:1489` builds the copy URL as `${origin}${pathname}?share=1`, commented
"Strip every query param except `share=1` so recipients don't inherit the sender's transient
camera/comparator state." `useShareMode()` reads it and `:1742` uses it to suppress owner chrome.

⛔ **CORRECTED 2026-08-26 — an earlier draft of this file said the `?share=1` mechanism "must
move" to the token route. That was WRONG and would have deleted a working path. Read this version.**

`?share=1` does TWO things today and only ONE of them changes:

1. **Recipient-chrome suppression** (`useShareMode()` :1470-1481, consumed at :1742). This STAYS on
   the id route exactly as it is. It is not relocated.
2. **The URL Copy Link hands out** (`ShareLinkButton` :1482-1489). This is where the defect lives:
   the component takes only `strategyId`, does NOT know publication status, and builds `?share=1`
   **unconditionally** — so for an unpublished strategy it hands out a URL that 404s for the
   recipient. That is the founder-hit bug, stated precisely.

**The end state is TWO share mechanisms, and that is CORRECT, not a smell:**

| Strategy is… | Copy Link yields | Why |
|---|---|---|
| **published** | `/factsheet/<id>?share=1` — **UNCHANGED, no token** | The id is already public; a capability token would add revocation theatre over public data. ARCHITECTURE.md `:99` states this for BOTH A-D1 options. |
| **unpublished / private** | `/factsheet-share/<token>` | The id must stay a non-secret and the payload is private, so access needs a revocable capability. |

They differ in disclosure properties **because their subjects differ** — a public id versus a
private capability. Do NOT collapse them into one lane, and do NOT delete the `?share=1` path.

**The actual work at `:1482-1489`:** give `ShareLinkButton` the publication status it currently
lacks and branch. Published → today's URL, untouched. Unpublished → mint-or-reuse, then the token
URL. Recipient-chrome suppression must hold on BOTH lanes: `useShareMode()` continues to serve the
id route, and the token route implies share mode structurally (there is no query param to read).

### Blocker 1 — the Phase-29 guard WILL redden on this phase's migration

`src/__tests__/phase-29-frozen-spine-guards.test.ts:141` sets
`FORBIDDEN_MIGRATION_RE = /scenario|share/i` and fails on any CHANGED migration whose FILENAME
matches, versus the merge-base. A migration named `*_strategy_shares_*.sql` matches `/share/i`
and trips it. **Verified by reading the file, not inferred.**

⭐ **FOUNDER RULING 2026-08-26: AMEND THE GUARD'S SCOPE.** Narrow `FORBIDDEN_MIGRATION_RE` from the
bare substring to the locked set the guard's own comment names — `scenario_shares`,
`get_shared_scenario`, `create_scenario_share` — so `strategy_shares` passes while the scenario
spine stays frozen. ⛔ Do NOT rename the migration to dodge the substring: that satisfies CI without
satisfying the gate and leaves the trap armed for the next table with "share" in its name.
⚠️ Cross-phase: Phase 164.1 is "retire the frozen-spine gates that no longer bite". This narrowing
is the 164 slice; record it in 164.1 so the same guard is not edited twice with two rationales.
⚠️ Anti-vacuity: after narrowing, prove the guard STILL bites — add a scenario-spine filename to the
changed set and observe RED, then restore. A narrowed guard that no longer fails on anything is
worse than the one it replaced.

### Blocker 2 — `fetchAndBuildPayload` is NOT exported, and a guard pins that

It is declared at `v2/page.tsx:83` with no `export`. The token lane needs it (A.4 option (a)).
Phase-148 guard pin #4 walks the repo and asserts no file other than `page.tsx` mentions it.

⛔ **SUPERSEDED — read the second ruling. The first was taken on a STALE COST ESTIMATE that I
supplied, and the founder revisited once it was corrected.**

~~First ruling (2026-08-26, withdrawn): export in place and widen pin #4 to a two-lane allow-list.~~
It rested on ARCHITECTURE.md's warning that extraction "touches the composite arm and the
single-key basis arm, so its diff is wider than it looks". **That was true on 2026-08-20 and is
FALSE at HEAD:** those arms were extracted to `src/lib/factsheet/` in July
(`build-payload.ts`, `composite-read-path.ts`, `allocator-portfolio-payload.ts`), and
`v2/page.tsx:16-20` already imports them. The build half now delegates to lib functions, so
extraction is a one-function verbatim move.

⭐ **FOUNDER RULING 2026-08-26 (FINAL): EXTRACT TO `src/lib/factsheet/`.** Move
`fetchAndBuildPayload` into the lib package beside the functions it already calls. Both lanes
import it. Then re-point the phase-148 guard to pin the **MODULE** as the canonical home rather
than allow-listing two callers — a stronger invariant, and it removes the oddity of a Next.js page
file owning a builder two routes depend on.
⛔ Still no duplicate builder: the entire SL-1 argument rests on the token lane producing exactly
what the owner lane produces.
⚠️ The guard bans TWO tokens, not one — `phase-148-owner-lane-cache-isolation.test.ts:364-372`
lists both `buildFactsheetPayloadCached` and `fetchAndBuildPayload`. Only the second moves;
`buildFactsheetPayloadCached` must stay pinned to `v2/page.tsx` exactly as it is.
⚠️ Anti-vacuity: after re-pointing, add a file that mentions the moved symbol from outside the
allowed set and observe the guard RED, then remove it.

#### Token lookup — **bounded constant-time scan** (ruled 2026-08-26)

A consequence of HMAC + A-D1 TOGETHER that was not surfaced when either was decided: nothing
token-derived is stored AND the strategy id is not in the URL, so the server cannot locate the row
from the token. Ruled: scan active share rows and `timingSafeEqual`-compare, **rate-limited first**.
`UNIQUE(strategy_id)` caps it at one active row per strategy.
⚠️ **Record a revisit threshold in the plan** — an explicit number of active shares at which the
O(1) locator variant gets reconsidered. Do not leave the growth implicit. Today the count is 0
(3 published strategies exist in total), so the scan is trivially bounded now and will not stay so.
⛔ The rejected alternative was putting a share-row locator in the URL (`<row_id>.<hmac>`); it is
O(1) but softens the "no identifier in the URL" property A-D1 chose.

#### 410 delivery — **redirect to a sibling route handler** (ruled 2026-08-26)

App Router pages CANNOT emit 410 (verified against the bundled Next docs: only `notFound`,
`forbidden`, `unauthorized` exist). Ruled: on a token miss the page `redirect()`s to a sibling
route handler that returns a genuine **410 + `no-store`** with a content-free body.
⚠️ The recipient sees one extra hop in the URL bar — call this out in UAT so it is not read as a
bug. ⛔ Rejected: rendering the dead-link page with HTTP 200, because a status line that says "fine"
about a dead link is the same dishonesty class this milestone keeps closing.

### Blocker 3 — the Sentry token scrub is NET-NEW, with no analog

`grep -rn "beforeSend\|beforeBreadcrumb" src/` returns **ZERO** hits (`Sentry.init` is at
`src/instrumentation.ts:30`). There is no existing scrub to extend.

⭐ **The genuinely NEW leak channel under A-D1 is Plausible, not Sentry.** `layout.tsx:92-96` loads
`plausible.io/js/script.tagged-events.js` site-wide, and Plausible records PATHNAMES. A path token
is therefore sent to a third-party analytics host on every recipient view. The query-param analysis
in PITFALLS.md never had to consider this because Plausible does not record query strings by
default. Decide the mitigation explicitly (exclude the route, or proxy/strip the segment) — do not
inherit the query-param conclusion. Sentry is server-only here, with `onRequestError` forwarding the
raw path (`instrumentation.ts:54-58`), so its scrub must also match on PATH. ⚠️ And because A-D1 makes the
token a PATH SEGMENT, the scrub must match on path, not on a query param — and
`Referrer-Policy: strict-origin-when-cross-origin` (`next.config.ts:79`) strips query strings
cross-origin but NEVER strips the path, so the leak surface is strictly wider than PITFALLS.md
assumed. Verify by triggering a real error on a token URL and reading the event, not from config.

### Blocker 4 — no in-repo precedent returns HTTP 410

App Router pages cannot set a 410 status directly. The 410-on-token-lane requirement needs a
resolved mechanism (route handler, `notFound()` variant, or middleware) — decide it in the plan,
do not leave it to the executor.

</verified_corrections>

<deferred>
## Deferred Ideas

- A publish path for `status='private'` strategies — deliberately still open (A-D2).
- Token access for the tearsheet and PDF routes (A-D3).
- Any change to `/api/og/factsheet/[id]` (SL-1d forbids the obvious one).

</deferred>
