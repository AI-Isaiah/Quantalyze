---
phase: 170-pagecopy
review: silent-failure-hunter (round 2, confirmation)
scope: "git diff 37dfad67d..HEAD -- src e2e (20 files)"
head: a82496148
reviewed: 2026-10-01
threshold: MEDIUM and above only (founder rule)
status: issues_found
findings:
  critical: 0
  high: 0
  medium: 1
---

# Phase 170: round-2 silent-failure review

Scope: the round-1 fix diff, `git diff 37dfad67d..HEAD -- src e2e` at `a82496148`. Only MEDIUM-or-higher findings are listed. Each was checked against source, and for the finding below against the installed `@supabase/auth-js`.

## Round-1 findings: confirmation

| Finding | Verdict | Evidence |
|---|---|---|
| SFH-170-01 (N-TABLE precondition) | Fixed | `e2e/layout-narrow.spec.ts`: the dead loop is gone. Each select is probed only after `elementsFromPoint` at its centre finds a z-indexed sticky cell inside `[data-strategy-table]`. Missing table, select or filter returns a `missing …` string, and an exhausted scroller returns `not-reached …`. Both fail `toBe("reached")` with the measured geometry. The 8 px step loop ends once `scrollTop` stops advancing. |
| SFH-170-02 (ancestor clip) | Fixed | `e2e/helpers/geometry.ts` `assertNotClippedByAncestors` intersects the element rect with every non-`visible` ancestor's padding box along the containing-block chain. Zero matches throw (W-02). It runs on SC2-PROFILE Disconnect after `scrollIntoViewIfNeeded`. Three server-free fixtures in `e2e/reflow.spec.ts` cover half-clipped (rejects), fits (resolves) and an absolute escapee (resolves). The helper can fail. |
| SFH-170-03 (admin queue reads) | Fixed | `src/app/(dashboard)/admin/page.tsx` checks all four `error`s, logs `[admin] <name> query failed` with code and message, and throws. `./error.tsx` exists, logs, and renders a digest-only error state. `page.test.tsx` checks both a primary and a sibling query failure, and a clean render. |
| SFH-170-04 (masthead session read) | **Partially fixed, see SFH-R2-01** | `unstable_rethrow` is first in the catch, and thrown failures are logged. The auth outage named in round 1 never reaches that catch. |
| SFH-170-05 (below-md recompute and Save) | Fixed | `AllocatorMatchQueue.tsx`: `handleRecompute` checks `readOnly \|\| readOnlyRef.current`, which covers the stale `setTimeout` closure. A refusal sets a `role="status"` notice. `PreferencesPanel.tsx` disables Save, guards `handleSubmit` against an implicit submit, and shows a read-only banner. In the in-flight race, `onSuccess()` runs `load()`, which clears the notice synchronously before `onRecomputeRequested()` sets it. The notice survives because `load()` does not clear it after its `await`. |

## Findings

### SFH-R2-01: an auth outage still renders "Sign in" with no log, because `getUser()` returns network and 5xx failures instead of throwing (MEDIUM)

- **Location:** `src/components/marketing/MarketingHeaderActions.tsx:40-58`. In particular, `signedIn = !error && user != null;` at :44 and the comment at :49-52.
- **What is wrong:**
  - The comment says the catch handles a "network failure inside getUser", and that the `error` return is "the ordinary anonymous-visitor path". The installed auth-js does not behave that way.
  - In `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2668-2677`, `_getUser` catches every error that passes `isAuthError` and **returns** it as `{ data: { user: null }, error }`.
  - `lib/fetch.js:38/42/124` turns a fetch failure, a 502/503/504 and a timeout into `AuthRetryableFetchError`, which is an `AuthError`. A 5xx from GoTrue becomes an `AuthApiError`. A failed refresh of an expired session inside `_useSession` is thrown at :2655 and then returned the same way.
  - So every realistic auth outage takes the unlogged `error` branch. It is indistinguishable from a visitor with no cookie (`AuthSessionMissingError`, :2659). Only a missing env var or a cookie-store fault in `createClient()` actually reaches the new `console.error`.
  - The round-1 recommendation was to leave the `AuthSessionMissingError` return unlogged, not every `error` return.
- **Why the tests did not catch it:** `MarketingHeaderActions.test.tsx` simulates an outage with `auth.getUser.mockRejectedValue(new Error("auth down"))`. The real client never rejects for that case. The test encodes a failure shape that cannot occur, so it passes while the real path stays silent.
- **Hidden errors:** `AuthRetryableFetchError` (DNS, connection reset, gateway 502/503/504, timeout), `AuthApiError` with status ≥ 500 (GoTrue down), and a refresh-token failure for a signed-in user whose access token expired during the outage.
- **What the user sees:** this is the SFH-170-04 scenario, still live. During a Supabase Auth outage, every signed-in visitor to `/security`, `/legal/*` and `/demo` is offered Sign in and Sign up, which looks like a lost session. No log line or Sentry event records it, so the masthead gives no signal that auth is failing.
- **Recommendation:** classify the returned `error`. Stay silent only for the anonymous case, and log everything else before failing closed. `isAuthSessionMissingError` is exported from `@supabase/auth-js` (`lib/errors.d.ts:94`). A stale or invalid cookie (`AuthApiError` 4xx such as `bad_jwt`) can stay quiet or go to warn level. Retryable and 5xx errors must log. Fix the comment at :49-52. Replace or add a test whose `getUser` *resolves* with an `AuthRetryableFetchError`-shaped error (`name: "AuthRetryableFetchError"`, `status: 0`) and asserts the log, next to the existing test that asserts silence for `AuthSessionMissingError`.
- **Example:**
  ```ts
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && !isAuthSessionMissingError(error)) {
    console.error("[marketing-header] session read failed", {
      name: error.name, status: error.status, message: error.message,
    });
  }
  signedIn = !error && user != null;
  ```

## Checked clean (no MEDIUM+ finding)

- **`assertNotClippedByAncestors`: false-pass hunt.** A 0×0 element cannot be "not clipped" in a meaningful way here, but `assertInsideViewport` runs first on the same locator. The walk breaks before `<html>`, so viewport clipping is left to `assertInsideViewport`, which is correct. It stops at a `position: fixed` element: a fixed Disconnect would be ancestor-clipped only under a transformed ancestor, and nothing in this flow is fixed. The `display: contents` and transform containing-block edge cases can only produce a loud false failure, never a false pass.
- **N-TABLE `reached` probe.** `elementsFromPoint` returns boxes painted under the select too. So "reached" means a z-indexed sticky cell is beneath the select, which is exactly the overlap `isolate` must win, and `assertNotCovered` then checks the top hit. A `scroll-behavior: smooth` scroller or a non-sticky filter bar ends in `not-reached`, which fails.
- **CR-01 draft-row case.** The `Submit for Review` assertion stops a silently published row from passing on the narrower published control group. The name-rect versus control-rect check covers the "0 px block intersects nothing" blind spot that the comment names. Cleanup uses the per-worker `NAME_PREFIX` already shared by the file's other describes. The new `status` option defaults to `"published"`, so existing callers are unchanged. The `HAS_SEED_ENV` skip follows the file's existing W-02 pattern.
- **Admin page throw.** Throwing inside the server component reaches the `/admin` boundary. Production redacts the message to a digest, and the server log line keeps the query name and PostgREST code. A rejected promise in `Promise.all` also reaches the boundary.
- **`readOnlyRef` sync.** It is updated in an effect after commit. The only reader that can be stale is the panel's `setTimeout` closure, which fires after the commit that changed `readOnly`. `handleDecision` keeps a bare `if (readOnly) return;`, but its triggers are CSS-hidden below md and its keyboard shortcuts are gated at lg+. A refusal there has no reachable silent path in this diff.
- **Tweaks focus effect, `NowrapWords breakOverlong`, `monthRowLabel` months-behind.** No error handling is involved. `monthRowLabel` keeps its "Month-to-date" fallback for an empty or unparseable `end`, which round 1 showed real data cannot reach.
