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

<deferred>
## Deferred Ideas

- A publish path for `status='private'` strategies — deliberately still open (A-D2).
- Token access for the tearsheet and PDF routes (A-D3).
- Any change to `/api/og/factsheet/[id]` (SL-1d forbids the obvious one).

</deferred>
