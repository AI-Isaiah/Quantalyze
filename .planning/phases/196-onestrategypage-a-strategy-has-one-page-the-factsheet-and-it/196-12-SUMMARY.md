---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 12
subsystem: ui
tags: [factsheet-share, visitor-header, session-wins, token-lane, referrer-policy]
status: complete

requires: ["196-05"]
provides:
  - "Token page (/factsheet-share/[token]) renders VisitorHeader, one main landmark and the SignUpLine slot"
  - "readRecipientSession: one boolean, chrome only (OQ-3)"
affects: [196-19, 196-21]

actuals:
  tokens: 14000   # chars/4 over the realized diff (227 insertions, 17 deletions across 3 files)
  tasks: 2
  commits: 2      # code commits, measured; this SUMMARY is a third commit
plan_head_before: 056a4e5ea1283034cbd11a552fc18938044af49f
plan_head_after: 57fd5476e136e822794c53b50a9b478e28438faa

key-files:
  modified:
    - src/app/factsheet-share/[token]/page.tsx
    - src/app/factsheet-share/[token]/page.test.tsx
    - src/app/factsheet-share/[token]/page.no-cache-reach.test.ts

key-decisions:
  - "OQ-3 default implemented: session wins. The token page reads whether a session exists after the HMAC match, for the visitor header only"
  - "page.cache-isolation.test.tsx needed no edit: it already mocks the server client and its payload finder walks the new fragment/main nesting"

requirements-completed: [ROUTE-04, ROUTE-02]
---

# Phase 196 Plan 12: Shared factsheet header Summary

The shared factsheet now carries the slim Quantalyze header and, for a recipient with no session, the sign-up button and sign-up line; a recipient with a session sees the header without Sign up and no sign-up line, with an identical payload, AUM rule and owner chrome.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: visitor header, main landmark, sign-up line | 7c1d60ce7 |
| 2 | Session wins plus the lane's isolation guards | 57fd5476e |

Note: the Task 1 commit also carries the Task 2 behavioural arms in `page.test.tsx` (one file, written together); the Task 2 commit carries the static arms in `page.no-cache-reach.test.ts`.

## What changed

- `page.tsx`: `readRecipientSession()` (module-private; `createClient()` + one `auth.getUser()`, false on any error), called as step 3b, after `findShareMatch` succeeds and before the builder. `VisitorHeader showSignUp={!signedIn}` in both the pending and render branches; the render branch wraps `FactsheetView` in a single `<main>` and passes `beforeFooterSlot={signedIn ? undefined : <SignUpLine />}`. The rate-limit card is untouched (no header, no session read); 410 redirects happen before the read.
- `FactsheetView` props otherwise unchanged: `withViewerAum(payload, false)`, `viewerNotice="shared_privately"`, `recipientShare`.

## The rewritten header paragraph (for the phase security review, OQ-3 / T-196-27)

```
// ⛔ THE SESSION READ (Phase 196 OQ-3, 2026-11-08). After the match, and only
// then, the page asks ONE question of the request client: does a session exist.
// The answer is one boolean that chooses the slim visitor header's chrome (the
// "Sign up" button and the sign-up line are shown without a session, never with
// one). It does not read a profile, a role or any owner state, it is never
// passed to `fetchAndBuildPayload` or `withViewerAum`, and it changes no data,
// no AUM rule and no owner control: every recipient gets the same payload.
// The rate-limit card and the 410 redirects run before it, so the enumeration
// defence is unchanged. The header links leave this URL, which is why
// `next.config.ts` sends `Referrer-Policy: no-referrer` for this path.
//
// ⛔ THE CONSTANT-TIME HMAC MATCH IS THE ONLY AUTHORIZATION. There is no RLS
// gate, and no status predicate on the payload read — deliberately, because
```

The first line of the old header, "This is a PUBLIC, sessionless route", now reads "This is a PUBLIC route".

## Verification

- `npx vitest run "src/app/factsheet-share"`: 4 files, 77 tests passed (`page.test.tsx` 51, was 43; `page.no-cache-reach.test.ts` 13, was 9).
- `npx tsc --noEmit`: exit 0. `npm run lint`: 0 errors, 2 pre-existing warnings in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`). `npm run check:route-contract`: OK.
- Grep gates: `VisitorHeader` 3 (HEAD 0); `auth.getUser(` 1; `from("profiles")` 0; `export const dynamic = "force-dynamic"` 1; `robots: "noindex"` 2 (unchanged, D-07).
- T-196-28: a test imports `next.config` and asserts `headers()` has `Referrer-Policy: no-referrer` for `/factsheet-share/:path*` (it already existed; now pinned from this page's tests).

## RED evidence (neuter, restore from `cp -p` backup, `cmp`, GREEN)

| # | Neuter | RED arm(s) | Restore | After |
|---|--------|-----------|---------|-------|
| 1 | `showSignUp={!signedIn}` replaced by `showSignUp={true}` (2 sites) | `a session wins: no Sign up anywhere, no sign-up line, the header still names Quantalyze` (1 failed, 50 passed) | `cp -p`, `cmp` exit 0 | 51 passed |
| 2 | `await readRecipientSession();` inserted above the rate limit | `the session is read for chrome only ...` and `the session is never read on the rate-limited, malformed or unknown-token paths` (2 failed) | `cp -p`, `cmp` exit 0 | 51 passed |
| 3 | A second `auth.getUser()` plus a `from("profiles")` read added | static arms `makes exactly one auth.getUser() call` and `reads no profile, role or owner state` (2 failed) | `cp -p`, `cmp` exit 0 | 77 passed across the directory |

Neuter 2 turns RED on two arms (the "once" arm too, because the neuter makes a second call on the happy path). The plan's named arm is the second one.

## Deviations from Plan

None. One fix inside this plan's own new test code: the payload-parity arm's recursive finder lacked a null base case (stack overflow on first run); fixed before commit.

## Not measured

- No browser or visual check of the header on this route (no server run; plan called for route-level tests). The header component itself was delivered and reviewed in plan 196-05.
- No PROD database access was made.

## Threat model status

T-196-27 (session read, medium): mitigated as planned, one boolean, after match, never passed to the builder; behavioural and static arms plus neuter evidence. Flagged for the phase security review per OQ-3: the token lane now constructs the request-scoped Supabase client (cookie read) where it previously did not.
T-196-28 (Referer leak): mitigated by the existing `no-referrer` header block, now pinned by a test.
T-196-29 (ordering): mitigated, arm asserts `createClient` is never called on the limiter, malformed and unknown-token paths.
T-196-30 (cache reach): mitigated, no next/cache import or primitive; existing guards stay green.

## Threat Flags

None beyond the OQ-3 session read already in the register.

## Known Stubs

None.

## Self-Check: PASSED

- `src/app/factsheet-share/[token]/page.tsx`, `page.test.tsx`, `page.no-cache-reach.test.ts`: present, modified.
- Commits 7c1d60ce7 and 57fd5476e are ancestors of HEAD.
