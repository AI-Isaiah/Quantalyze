---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
reviewed: 2026-11-14T10:17:46Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/lib/email.ts
  - src/lib/email.test.ts
  - src/lib/queries.ts
  - src/lib/queries.anon-read-errors.test.ts
  - src/app/browse/browse-categories.ts
  - src/app/browse/page.tsx
  - src/app/browse/page.test.tsx
  - src/components/strategy/ShareableLink.tsx
  - src/components/strategy/ShareableLink.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx
  - src/app/api/strategies/[id]/share/route.ts
  - src/app/api/strategies/[id]/share/route.test.ts
  - src/app/api/allocator/scenario/share/route.ts
  - src/app/api/allocator/scenario/share/route.test.ts
  - src/app/api/allocator/scenario/share/route.csrf-integration.test.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
  necessity: 0
status: issues_found
---

# Phase 208: Code Review Report

**Reviewed:** 2026-11-14T10:17:46Z
**Depth:** standard
**Files Reviewed:** 16 (the diff `3b3c7443b..HEAD`, plus the collaborators each change relies on: `src/lib/csrf.ts`, `src/lib/api/withAuth.ts`, `src/lib/api/withAllocatorAuth.ts`, `src/proxy.ts`, `next.config.ts`, `src/components/ui/{Input,Modal,LiveRegion}.tsx`, `src/app/(dashboard)/layout.tsx`, `src/components/strategy/StrategyTable.tsx`)
**Status:** issues_found

## Summary

All five plans match their locked decisions:
- D-01: the digest link reads `Open your allocation →` and still points at `/allocations`. No "dashboard" text is left anywhere in `sendAlertDigest`, subject included.
- D-02..D-04 and D-14: `failAnonRead` throws; the helper returns the `ok`/`empty`/`error` tri-state; the redirect and the crumb are gated on `ok`; the error block matches the UI-SPEC markup.
- D-05..D-07 and D-13: `ShareMintError` carries only the status, the labels are mapped from it, and the row live region works.
- D-08..D-10 and D-15: there is one `copyTextBounded` helper, the dialog has its own Copy link, the copy is bounded in the factsheet `mintAndCopy`, and there is a Public link lane.
- D-16: both routes now try the request origin first.

There are no Critical or High findings. One MEDIUM: on PRODUCTION, D-16 hands out a link on a host the 308 rule does not cover (WR-01).

**D-16 security, confirmed (what the orchestrator asked to have checked):**
- **A forged header cannot reach the minted URL.** Both resolvers read exactly the expression the gate validated (`req.headers.get("origin") ?? req.headers.get("referer")`; strategies `route.ts:119`, scenario `route.ts:87`; gate `src/lib/csrf.ts` `assertSameOrigin`). Gate and resolver therefore cannot diverge:
  - Origin and Referer that disagree resolve to Origin in both.
  - An empty or unparseable header is a 403 at the gate.
  - `Host`, `x-forwarded-host` and `nextUrl` are never read.
- **GET and no-origin paths.** Each route exports only `runtime` and `POST`, so no GET/HEAD/OPTIONS path mints anything.
  - Strategies route: it calls `assertSameOrigin` at step (1), before `createClient`/`getUser`.
  - Scenario route: it reaches the gate through `withAllocatorAuth` → `withAuth`, which gates every non-GET/HEAD/OPTIONS method.
  - A request with neither header is a 403 in both. Rungs 2 and 3 are reachable only from unit tests with the gate mocked.
- **Allow-list.** The integration test runs the scenario route's real chain, unmocked, and pins that a forged Origin gets a 403 and a header-less request gets a 403 before any database call. Arm (iii) shows the gate is not an always-403 stub.
  - Residual 1 (WR-01): the allow-list admits more hosts on a Production build than the route comments account for.
  - Residual 2 (IN-01): the gate validates `URL.host`, not the scheme.
  - Neither one is a cross-user spoofing path. A browser page cannot set `Origin`, and the URL is returned only to the caller who sent it.

**Capability URL never logged: confirmed.**
- The mint log carries `{ strategyId, err }`, and `err` is a `ShareMintError` whose message holds only the status (`share mint failed: 404`, pinned exactly).
- `copyTextBounded` logs `{ strategyId, err }` and never `text`, pinned by a test that serializes every `console.warn` argument and asserts the URL and token are absent.
- The factsheet catch logs only the generic `Error("clipboard copy failed")`.
- The route side is unchanged: no audit row and no log carries a token.

**Live regions: confirmed.**
- The row region and the dialog region are both mounted before their message arrives, and both are `sr-only` and `role="status"`.
- The row region is a sibling outside the Modal, as the spec requires, and sits as an out-of-flow child inside the `flex` actions cell (`StrategyTable.tsx:2142`). Its markup is valid and it adds no layout gap.
- The UI-SPEC mitigation for the inert row region under `showModal()` (`aria-describedby={helperId}` on the field) holds: `Input` spreads `...props` onto the `<input>` and sets no `aria-describedby` of its own.
- The browse error shell is `role="alert"` with the DESIGN.md Error Envelope shell, title and body classes. Its departure from `buildEnvelope` is recorded in the UI-SPEC under CONTEXT D-03's discretion.

**Tests can fail (verified for the arms read, plus every removed line of the ShareableLink test diff).**
- Every D-12 item has an arm that asserts the intent, not the shape:
  - no second `fetch` on the dialog Copy link;
  - exact label strings, with `try again`/`retry` asserted absent;
  - a `HTMLElement.prototype.focus` stub, so only the explicit `setSelectionRange` can satisfy D-09;
  - fake-timer hang arms on both the dialog and the factsheet;
  - the real-chain csrf file.
- The SUMMARYs record a neuter-RED for each. Neuter 208-03 (d) was rewritten after it first stayed GREEN, which is the discipline working.
- No removed assertion lacks a replacement at least as strict.

**Necessity:** reviewed against `necessity-review.md`; no finding. The unreachable `catch` and rungs 2 and 3 in `resolveAppUrl` sit on a trust boundary and are kept as test seams, so they are not necessity findings.

Each finding below carries the orchestrator's severity label and a user-facing / data-integrity tag.
- **Severity mapping, chosen on purpose:** MEDIUM → `WR-`, and LOW → `IN-`, even for a real logic error such as IN-02. Under the schema's own rubric IN-02 could sit under Warning. It is put under Info so the project rule "never fix LOW/INFO" applies to it.
- **Coverage note:** only the scenario route has a real-chain csrf test. The strategies route's step-(1) gate call is pinned only by the mocked-csrf 403 arm (`route.test.ts:308-314`), with `src/lib/csrf.test.ts` covering the gate itself. That is adequate today, but it is weaker than the scenario route's pin.
- **Reading scope, disclosed:**
  - I read `DESIGN.md` only for the Error Envelope and a11y sections (lines 341-362 and 400-401), not all 515 lines.
  - The worktree has no `.claude/skills/` or `.agents/skills/`.
  - I used the main checkout's `CLAUDE.md` and `AGENTS.md` (same repo, loaded in context) and did not open the worktree copies separately.
  - In `ShareableLink.test.tsx` I checked every removed line of the diff. Each removed assertion has a replacement at least as strict: role-named `findByRole` queries, and the same awaits with an explicit `{ timeout: 5000 }`.

## Warnings

### WR-01: D-16 — a link minted on PRODUCTION's own per-deployment `*.vercel.app` host comes back pinned to that deployment, not the canonical domain [MEDIUM]

**User-facing:** yes · **Data-integrity:** no · **Needs a founder decision** (the minimal fix narrows D-16's literal "ahead of NEXT_PUBLIC_APP_URL")

**File:**
- Strategies route: `src/app/api/strategies/[id]/share/route.ts:91-98` and `:108-110` (both false claims) and `:118-133` (the resolver)
- Scenario twin: `src/app/api/allocator/scenario/share/route.ts:86-101` (the resolver; its comment at `:82-84` makes no false claim)
- Root of the allow-list: `src/lib/csrf.ts:60-75`

**Issue:** The route comment justifies dropping env-first like this: "The WR-03 reason for env-first, that an alias host is allow-listed by CSRF but is not the address we want on a link, no longer holds: the alias now 308s to the canonical domain". The same file adds, at `:108-110`, "in a deployed environment the url is always the validated origin". Both statements, which appear only in the strategies route, were checked against only ONE production host. The 308 rule in `next.config.ts:179` matches the exact alias `quantalyze-rho.vercel.app`, and its own comment says per-deployment hosts "must NEVER match".

`buildAllowedHosts` (`csrf.ts:60-75`) adds `NEXT_PUBLIC_VERCEL_URL` with no `VERCEL_ENV` gate. On a Production deployment, Vercel's documented value for that variable is the deployment's own immutable URL, in the repo's own form `quantalyze-<hash>-<team>-projects.vercel.app` (`next.config.ts:170`), not the custom domain.

What the repo proves:
- `csrf.ts` has no `VERCEL_ENV` gate on that rung.
- The 308 matches one exact alias.
- `next.config.ts:171-173` says requests (cron, for example) do arrive on the per-deployment host.
- CHANGELOG M-0509 (line ~23341, "adversarially verified against live Vercel prod") records that `NEXT_PUBLIC_VERCEL_URL` is auto-exposed under the same toggle as `VERCEL_URL`.

NOT measured from this checkout: the variable's value on the current Production build, and whether Vercel Deployment Protection is on.

Traced input → output:
1. An owner opens production through its deployment URL. No product path links there (`grep -rn VERCEL_URL src` outside tests finds only `csrf.ts` and the server-side PDF routes), so the way in is a Vercel dashboard or GitHub deployment link.
2. They click Get private link.
3. `assertSameOrigin` admits the host (it is in `ALLOWED_HOSTS`).
4. `resolveAppUrl` returns `https://quantalyze-<hash>-<team>.vercel.app`.
5. The owner forwards `https://quantalyze-<hash>-<team>.vercel.app/factsheet-share/<token>`.

That URL serves that one build forever, so later fixes never reach the recipient. If Vercel Deployment Protection is on (it covers non-production-domain URLs by default), the recipient gets a Vercel login wall: a dead link that read "Link copied!". Before D-16 this case got the canonical URL, because a Production build's `NEXT_PUBLIC_APP_URL` is guaranteed canonical (`assertCanonicalAppUrl`, `next.config.ts:123-152`). Any extra host listed in `NEXT_PUBLIC_ALLOWED_ORIGINS` has the same property.

Prior treatment: `208-RESEARCH.md` has no entry for per-deployment hosts or Deployment Protection, and TODOS `SHARE-HOST-01` covers the rho alias and preview hosts only. Plan 208-05's threat row T-208-15 reasons only about preview hosts reaching production ("preview hosts are not in production's allow-list"). It does not consider production's own deployment host, which IS in production's allow-list.

Reachability is limited to people who hold Vercel or GitHub links, which today means the founder, who is also the only manager. The case is plausible, not hypothetical. MEDIUM rests on two things: it is a regression against the pre-D-16 production behaviour, and the comment makes a false safety claim. If the founder judges deployment-URL browsing negligible, LOW is defensible. Either way this is a wrong-host link, not a spoofing hole.

**Fix:** keep D-16's ordering everywhere except a Production build, whose env value is guaranteed canonical by the build guard. The D-16 test ("a non-production host returns that host") still holds. Apply this in both resolvers, as twins:
```ts
function resolveAppUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  // A Production build's NEXT_PUBLIC_APP_URL is the canonical origin
  // (assertCanonicalAppUrl refuses anything else), while production's own
  // per-deployment *.vercel.app host is also in ALLOWED_HOSTS and must not
  // become a link host. Every other environment links on the minting host (D-16).
  if (process.env.VERCEL_ENV === "production" && configured) return configured;

  const source = req.headers.get("origin") ?? req.headers.get("referer");
  if (source) {
    try {
      return new URL(source).origin;
    } catch {
      /* unreachable behind the gate */
    }
  }
  if (configured) return configured;
  return "http://localhost:3000";
}
```
- Add one arm per route: with `VERCEL_ENV=production`, an allow-listed `*.vercel.app` Origin returns `NEXT_PUBLIC_APP_URL`.
- Correct the strategies route's "no longer holds" (`:94`) and "always the validated origin" (`:109-110`) comments. In the scenario twin, update only the "Rungs 2 and 3" paragraph to name the production rung.
- If the founder prefers origin-first even on production, record that, and the per-deployment-host consequence, in CONTEXT D-16 and the ROADMAP, and fix the comments instead.

## Info

### IN-01: D-16 — the gate validates `URL.host` but the resolver emits `URL.origin`, so the scheme is never validated [LOW]

**User-facing:** no (self-inflicted only) · **Data-integrity:** no

**File:**
- `src/app/api/strategies/[id]/share/route.ts:122`
- `src/app/api/allocator/scenario/share/route.ts:90`
- Gate: `src/lib/csrf.ts` `assertSameOrigin`, which compares `new URL(source).host` only

**Issue:** Measured with `node`:
- `new URL("foo://quantalyze.xyz")` has `host = "quantalyze.xyz"` but `origin = "null"`.
- `http://quantalyze.xyz` keeps `http:`.
- `ftp://quantalyze.xyz` gives `ftp://quantalyze.xyz`.

Each of these passes the host allow-list. The share URL then comes back as `null/factsheet-share/<token>`, `http://…` or `ftp://…`. Only a non-browser caller holding their own session can send such a header, and the URL is returned only to that caller, so nobody else is affected. The route comments do claim the origin is "validated", though, and it is validated only as far as its host.

**Fix:** in both resolvers, accept only a web scheme and fall through otherwise:
```ts
const u = new URL(source);
if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) {
  return u.origin;
}
```

### IN-02: ShareableLink — feedback timers are never cleared, so an earlier timer clobbers a later state [LOW]

**User-facing:** yes (minor, transient) · **Data-integrity:** no

**File:** `src/components/strategy/ShareableLink.tsx:393, 399, 418, 422` (and `:375`)

**Issue:**
- **Dialog copy.**
  1. Tap Copy link and it succeeds: `copied`, with a 2 s timer to `idle` (`:418`). The button stays enabled.
  2. Tap again within 2 s, with the clipboard hanging: `working`, button disabled.
  3. At the 2 s mark the first timer fires, and `setDialogCopy("idle")` re-enables the button and shows `Copy link` while the bounded write is still in flight.
  4. A third tap starts a concurrent copy.

  The reverse order (copied, then a fast failure) cuts `Copy failed` and its dialog-region announcement short, to under 2 s instead of 4 s.
- **Row.** `handleCopy` resets `mintFailure` but never `copyFailed`, so a second both-paths failure within 4 s (published lane, after closing the dialog) leaves `rowFailureText` byte-identical, and the row region does not re-announce. The first failure's 4 s timer then clears the second failure's label early.

**Fix:** keep each timer in a `useRef`, and `clearTimeout` it before scheduling a new one and on unmount. At the start of `handleCopy`, call `setCopyFailed(false)` next to `setMintFailure(null)`.

### IN-03: `getBrowseCategories` — the catch comment says the helper "already logged and captured", which is false for a throw before the query [LOW]

**User-facing:** no · **Data-integrity:** no (ops signal only)

**File:** `src/app/browse/browse-categories.ts:33-36`

**Issue:** The catch is now load-bearing: it decides the `error` state. Its comment asserts that every throw was logged and captured at the source. That is true only for the `failAnonRead` path (`queries.ts:1476`). A throw from `createClient()` or `withPublishedOnly` (`queries.ts:1460-1466`), for example a missing env var or a `cookies()` failure, reaches `state = "error"` with no log and no Sentry event. The page tells the visitor the read failed, while ops sees nothing. The silence predates this phase (the old catch was also bare), but the new comment turns it into a false claim, and the error state is now the visible outcome.

**Fix:** log without capturing to Sentry a second time, so the `failAnonRead` path is not double-captured:
```ts
} catch (err) {
  // failAnonRead already captured a query error; a throw before the query
  // (createClient, env) did not, so leave a server-side line either way.
  console.error("[browse] getPopulatedCategorySlugs threw:", err instanceof Error ? err.name : "unknown");
  state = "error";
}
```
Alternatively, correct the comment so it names only the query-error path.

---

_Reviewed: 2026-11-14T10:17:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Orchestrator disposition (2026-11-14)

- **Silent-failure hunter:** no new MEDIUM+ findings; confirmed WR-01 as MEDIUM, user-facing.
- **WR-01: OPEN, founder decision, blocks merge. No fixer round was run.** The reviewer's minimal
  fix (`NEXT_PUBLIC_APP_URL` first when `VERCEL_ENV === "production"`) would undo D-16 on the
  exact case that motivated it: TODOS `SHARE-HOST-01` was MEASURED on production
  (`quantalyze.xyz` minted a `quantalyze-rho.vercel.app` link because `NEXT_PUBLIC_APP_URL` holds
  that value in Production and Preview). So there is no safe agent default. Options for the founder:
  (A) accept the per-deployment-host risk and record it in D-16 and the ROADMAP;
  (B) on production, trust the origin only when it is the canonical domain, else fall back to a
  canonical URL (needs a correct canonical value, which `NEXT_PUBLIC_APP_URL` is not today);
  (C) gate the `NEXT_PUBLIC_VERCEL_URL` allow-list entry in `src/lib/csrf.ts` to non-production.
- Only the two false comments in the strategies route were corrected (`a2b2a421f`).
- IN-01..IN-03 (LOW) are recorded here only, not fixed and not booked.
