---
phase: 157-founder-confirm-the-observations-only-the-founder-can-make-a
reviewed: 2026-11-23T00:03:49Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - .planning/phases/157-founder-confirm-the-observations-only-the-founder-can-make-a/157-STAGING-KIT.js
  - .planning/phases/157-founder-confirm-the-observations-only-the-founder-can-make-a/157-STAGING-KIT.smoke.mjs
  - .planning/phases/157-founder-confirm-the-observations-only-the-founder-can-make-a/157-FOUNDER-SCRIPT.md
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: issues_found
round: 2
round_2_reviewed: 2026-11-23T00:17:05Z
round_2_head: 35b683be7
round_1_findings:
  critical: 2
  warning: 3
  resolved_in_round_2: 5
---

# Phase 157: Code Review Report (staging kit)

**Reviewed:** 2026-11-23T00:03:49Z
**Depth:** deep (traced against `src/` at worktree HEAD `3b7eb5e8e`)
**Files Reviewed:** 3
**Status:** issues_found (round 1). Round 2 below: all five resolved, no new MEDIUM+.

## Summary

I reviewed the staging kit, its smoke test and the founder script against the real wizard
(`src/app/(dashboard)/strategies/new/wizard/`), the overlay, `wizard-correlation.ts`,
`useStrategySyncPoller.ts`, `ErrorEnvelope.tsx`, `wizardErrors.ts`, `wizardKeyRosters.ts`, the
API routes under `src/app/api/strategies/` and `src/app/api/keys/`, and the Python
`/internal/keys/{id}/permissions` handler. The brief asked for MEDIUM and above only. In this
file, Critical means HIGH or BLOCKER and Warning means MEDIUM.

**What holds, verified at HEAD.** No `src/` file in the traced set changed between the kit's
pinned `0def03553` and `origin/main`.
- All four staged codes reach the copy the script quotes. `SEAM_INTERNAL_FAULT` is a value of
  `VENUE_WIRE_CODE_TO_VERDICT` (`wizardErrors.ts:5144`), so it is in
  `KNOWN_CREATE_WITH_KEY_CODES` (`wizardKeyRosters.ts:90-99,149-153`). The three finalize codes
  are in `KNOWN_FINALIZE_CODES` (`SubmitStep.tsx:445-447`), and no status arm takes them first
  (`SubmitStep.tsx:470-477`).
- The envelope literals and statuses match `finalize-wizard/route.ts:1151,2023,2884`. The
  create-with-key catch tail and `NO_STORE_HEADERS` match too.
- Every backticked UI string in the script appears verbatim in the source: `WIZARD_ERROR_COPY`,
  the amber JSX (`SyncPreviewStep.tsx:3349-3353`), the resume banner and the drawer CTAs.
- The amber stubs do reach `showRecomputing`. The two-column freshness read `[]` leads to an
  in-flight probe, then `waiting_for_complete`, a terminal ladder row, both counts at 0 and a
  running jobStatus (`SyncPreviewStep.tsx:2157-2165,3194`).
- The browser client passes no custom fetch (`src/lib/supabase/client.ts`). The wizard has no
  server actions, `sendBeacon`, XHR, `functions.invoke` or `.storage` callers.

**Not verified.** The worktree has no `node_modules`, so RESEARCH's claim that supabase-js
2.118 `resolveFetch` looks up the global `fetch` on each call is unconfirmed, and I did not
read the other checkout. Necessity review was not assessed (the brief is MEDIUM and above). No
project skills exist.

**Key concerns.** (1) A pass-through GET writes audit rows to PROD in three legs, and the kit
says no such write exists. (2) The submit section tells the founder to confirm the marker
before it tells them to open the new tab they then click in. That is the one leg where a miss
publishes the draft.

## Critical Issues

### CR-01: The permissions read the kit passes writes to PROD, and the kit says no pass-through write exists

**File:** `157-STAGING-KIT.js:35,51,196` (also `157-FOUNDER-SCRIPT.md:9`, `157-RESEARCH.md:239`)
**Issue:** `GET /api/keys/<id>/permissions` is passed in every mode (`PASS_API`, line 196).
Line 51 states "no pass-through write exists in any mode". The script says "nothing staged
reaches PROD" and never names this write. But the route writes:
- `src/app/api/keys/[id]/permissions/route.ts:420` calls `logAuditEvent(...)` on every
  successful request, cache hit or miss. That calls `client.rpc("log_audit_event", ...)`
  (`src/lib/audit.ts:1012`), which runs `INSERT INTO audit_log` with action `api_key.decrypt`.
- On a 60 s Next-cache miss the route POSTs to Python. Python inserts into
  `key_permission_audit` (`analytics-service/routers/internal.py:294`, docstring step 3), then loads and decrypts the stored
  credential.

`KeyPermissionBadge` mounts on the single-key passed preview (`SyncPreviewStep.tsx:3101`). So
the FCONF-01 resume leg (when it lands on the preview), connect variant (b) and the whole
submit walk each write at least one PROD `audit_log` row. RESEARCH:239 called the route a read
"by grep" of the route file alone, which misses the imported `logAuditEvent` and the Python
seam. This breaks the brief's invariant ("No staged session may let a write reach PROD") and
CONTEXT's rule that any pass-through write is named in the kit and in the script.
**Fix:** Keep the verdict real (do not stub it). Name the write instead:
```js
// Pass-through WRITES (named per CONTEXT): GET /api/keys/<id>/permissions writes one
// audit_log row (log_audit_event, every call) and, on a Next-cache miss, one
// key_permission_audit row plus a credential decrypt in the analytics service.
```
Delete line 51. Add one bullet to script section 0: the preview's permission badge records an
`api_key.decrypt` audit row each time it loads, and that is the session's only PROD database
write. Correct RESEARCH:239.

### CR-02: The submit section confirms the marker before it opens the new tab, then says to click in that tab

**File:** `157-FOUNDER-SCRIPT.md:65-67`
**Issue:** Line 65 says "I arm `submit` with `DRAFT_LOOKUP_FAILED`. Confirm the marker
reads ...". Line 67, step 1, then says "In a new tab on `/strategies`: click 'Add a strategy',
then `Resume draft` ... click the submit button". A tab opened at step 1 has no kit, because
the kit lives in the tab it was injected into and a new tab is a fresh page. The marker was
already confirmed one line earlier, so the step reads as permission to click. Sections 2 and 3
use the right order: new tab, then arm, then confirm, then click (lines 32-34, 42). Section 5
reverses it in the only leg where a miss is one-way. In an unarmed tab, Resume can POST a real
`/api/keys/sync` (`SyncPreviewStep.tsx:1055`), and the walk ends in a real
`POST /api/strategies/finalize-wizard` (`SubmitStep.tsx:265`), which publishes the founder's
only draft. The section 0 rule ("No marker on screen: do not click anything") is the only thing
in the way, and step 1 itself contradicts it.
**Fix:** Reorder so it matches sections 2 and 3:
```
1. Open a NEW normal tab and go to `/strategies`.
2. I arm `submit` with `DRAFT_LOOKUP_FAILED` in that tab. Confirm the marker there reads
   `STAGED RESPONSES ACTIVE — FCONF-03 (submit: DRAFT_LOOKUP_FAILED)`.
3. Only then click "Add a strategy", ...
```

## Warnings

### WR-01: The router lets every write outside two prefixes through, including Supabase `/functions/v1`, `/storage/v1`, `/graphql/v1` and same-origin non-`/api` POSTs

**File:** `157-STAGING-KIT.js:282-284` (pinned by `157-STAGING-KIT.smoke.mjs:91-103`)
**Issue:** `decide` returns `outside` for any method unless the path is same-origin `/api/` or
any-origin `/rest/v1/`. Run against the real kit file with `submit` armed (scratch probe),
every one of these returned 200 and reached the native fetch:
- `POST <supabase>/functions/v1/anything`
- `POST <supabase>/storage/v1/object/bucket/x`
- `POST <supabase>/graphql/v1`
- `POST https://<app>/strategies/new/wizard`
- `PUT <supabase>/auth/v1/user`
- `POST <supabase>/auth/v1/logout`

Smoke cases (d) and (e) assert that pass-through as intended behaviour. None of these is
reachable at HEAD:
- `src/` has no `functions.invoke`, `.storage` or `graphql/v1` caller.
- There is no `"use server"` file.
- The only non-`/api` route handlers are GET-only (`auth/callback/route.ts:108`,
  `factsheet-share/gone/route.ts:78`).
- The `auth.updateUser` and `auth.signOut` callers are not on wizard pages.

So the kit is "fail closed" only because no current code uses those surfaces. A deploy that
adds an edge-function or storage call before the sitting would pass silently.
**Fix:** Refuse writes by default and allowlist the few that must pass:
```js
var isRead = m === "GET" || m === "HEAD";
var authPass = /^\/auth\/v1\/(token|user)$/.test(path);   // refresh + session read
var sameOrigin = u.origin === location.origin;
if (!isRead && (sameOrigin || /^\/(rest|functions|storage|graphql)\/v1(\/|$)/.test(path)) && !authPass)
  return refuse("write-outside-stub");
```
Keep cross-origin telemetry (PostHog) as `outside`, which the script already discloses. Add a
smoke case for each refused class.

### WR-02: The marker proves the kit ran, not that the page's own `fetch` is wrapped, and nothing checks interception before the first click

**File:** `157-STAGING-KIT.js:323-325,334-350`, `157-FOUNDER-SCRIPT.md:10,13,36`
**Issue:** The only gate before a click is the DOM marker. The marker is painted by
`paint()` (line 425) whether or not the wrapper sits on the `fetch` the app calls. The page
and an extension's isolated world share the DOM but not `window`. If the injection path (the
preferred one is the browser tool's `javascript_tool`) evaluates outside the page's main world,
the marker appears and every staged request goes to PROD unstaged. I cannot tell from here
which world that tool uses, so this rests on the script ordering, not on a measured failure.
The first `__fconf` read-back is section 2 step 5 (line 36), after `Resume draft`, and that is
the click that can enqueue a real sync.
**Fix:** Have the kit refuse to install (throw, paint nothing) unless it can see a page-world
global the Next app router always defines, for example
`if (!Array.isArray(self.__next_f)) throw new Error("[fconf] not in the page world");`. Also
add a script step after arming and before the entry click: the agent reads back
`window.__fconf.mode` and `window.fetch.name === "fconfFetch"` in the same evaluation context
the app uses.

### WR-03: The "byte-equal to the route literal" cases cannot fail when the route changes, and the connect-mode members stub has no case

**File:** `157-STAGING-KIT.smoke.mjs:163-185` (also `:62-71`)
**Issue:** The test names claim "byte-equal to the route literal", but the expected bodies are
literals typed into the smoke file. The file reads only the kit (`readFileSync(KIT_PATH)`,
line 10) and never opens `src/app/api/strategies/finalize-wizard/route.ts` or the
create-with-key route. The comparison is also `deepEqual` on parsed JSON, not a byte compare.
If a route's `error` string, status or headers drift before the sitting, the kit and the test
stay in agreement with each other and stay green. That is the drift the kit header (lines 7-8)
asks the reader to re-check by hand. Separately, the kit copy with the connect-mode
`GET /api/strategies/composite/members` stub deleted (`157-STAGING-KIT.js:243-245`) still passes
all 32 cases (scratch mutation: `pass 32, fail 0`). Without that stub, a composite draft in
connect variant (b) rehydrates into State B and submits to the refused
`composite/add-key` instead of `create-with-key`.
**Fix:** Read the route source in the smoke and extract the literals, for example
`const route = readFileSync(new URL("../../../src/app/api/strategies/finalize-wizard/route.ts", import.meta.url), "utf8")`.
Then assert that each kit `ENVELOPES[code].body` appears in it as
`{ code: "<code>", error: "<msg>" }` with its `status:`. Add a connect-mode case asserting
`composite/members` returns `{"members":[]}` and never reaches the spy.

---

_Reviewed: 2026-11-23T00:03:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Round 2 — 2026-11-23T00:17:05Z (fixer commits `2c02e2bc2..b692d64cf` plus `35b683be7`)

**Head:** `35b683be7`. **Smoke:** `node --test 157-STAGING-KIT.smoke.mjs` gives 46/46 pass.
**Result:** all five round-1 findings are resolved. The fixes introduced no new MEDIUM+ issue.
In this repo LOW and Info items stay here and are not fixed, so the four left over are listed as
Info at the end. The frontmatter `findings:` block now records the round-2 state.

### Round-1 findings, one by one

**CR-01, resolved.** The fixer refused the permissions read with 599 instead of only naming the
write. It is neither stubbed nor passed: it is in no `PASS_API` entry (`157-STAGING-KIT.js:207-212`),
and its 599 comes from `decide`'s `unlisted-read` arm (`:320`). That meets the brief's invariant
more strictly than the disclosure I suggested. I checked what refusing it costs:
- The badge is presentation only. It takes `apiKeyId` alone, and `handleUseThisKey`
  (`SyncPreviewStep.tsx:2293-2295`) does not depend on it.
- On 599 the badge renders `HTTP 599` in red under "Detected key scopes", plus a Re-check
  button (`KeyPermissionBadge.tsx:155,337-339`).
- Script section 0 now tells the founder to expect a badge error, and the kit header
  (`:58-63`) and RESEARCH:239/469 say why.
- Mutation check: putting the permissions regex back into `PASS_API` turns the smoke red.

**CR-02, resolved.** Section 5 now runs (1) new tab, do not click; (2) arm in that tab,
confirm the marker, and the agent reads back `__fconf.mode` and the fetch identity; (3) only
then click (`157-FOUNDER-SCRIPT.md:67-69`). That matches sections 2 and 3.

**WR-01, resolved.** `outsideWrite` (`157-STAGING-KIT.js:291-301`) refuses these:
- any `/functions|storage|graphql/v1` write on any origin;
- every `/auth/v1/` write except `POST /auth/v1/token`;
- every same-origin write outside `/api/`.

Cross-origin telemetry writes still pass, but are now logged in `__fconf.outside`. I re-ran
round 1's probe on the new kit with `submit` armed. Functions, storage, graphql, a same-origin
page POST, `PUT /auth/v1/user`, `POST /auth/v1/logout`, `PUT /auth/v1/token`, a REST
`rpc/*` write, `/API/…`, `/api//…`, `/%61pi/…` and `OPTIONS` on `/api/` and `/rest/v1/` were
all held at 599. A trailing-slash `/api/strategies/finalize-wizard/` got the stub, not the
network. Mutation checks: allowing any `/auth/v1/` POST, and deleting the same-origin refusal,
each turn the smoke red.

**The `/auth/v1/token`-only pass** is correct for this app:
- The match uses the cleaned path, so `?grant_type=refresh_token` and a trailing slash both
  pass. Any other method on that path is refused.
- The browser auth traffic is the refresh (`POST /auth/v1/token`) and the session read (`GET
  /auth/v1/user`), which goes out as an outside read. The only auth writes in `src/` are
  sign-out, login and password-reset components (`SignOutButton`, `LoginForm`,
  `ResetPasswordForm`). The wizard does not mount them.
- If the founder signs out during a leg, the logout is refused. That fails safe.

**WR-02, resolved.** The kit paints `STAGING KIT NOT ACTIVE — wrong context` and throws
before wrapping when `self.__next_f` is undefined (`:353-356`). After assigning it checks
`window.fetch === fconfFetch` (`:485-488`). The script now reads back `window.__fconf.mode` and
`window.fetch.name === "fconfFetch"` before the first click of every leg. Mutation check:
disabling the guard turns the smoke red (case j).

**Can the `__next_f` guard block a legitimate page-world paste?** Only if the Next App Router
stopped defining `self.__next_f` in the page world. It pushes its streamed flight data through
that global and does not delete it after hydration. I could not measure this against
`next@16.4.2`: the worktree has no `node_modules`, and I did not read the other checkout or
fetch the PROD page. **Either way it cannot open a hole.** A missing global makes the kit
refuse to install anywhere and paint NOT ACTIVE, so the session stops rather than staging
unsafely. Cheap pre-check before the sitting: in the founder's DevTools console on PROD,
`Array.isArray(self.__next_f)` should be `true`.

Interaction I checked: a NOT ACTIVE paint can overwrite the marker of a kit already active in
the page world, and an in-world install overwrites a stale NOT ACTIVE paint. Both directions
fail safe or report the truth.

**WR-03, resolved.** The smoke now reads the seven source files from the repo root
(`smoke.mjs:12-34`). It extracts each finalize literal with a formatting-tolerant regex that
must match exactly one site, and compares the response body with `res.text()` byte for byte.
It pins `NO_STORE_HEADERS`, the create-with-key catch tail, the status of the
`SEAM_INTERNAL_FAULT` classifier rows and `keyRouteFailureHeaders`. It also adds a case for
connect-mode `composite/members`. I proved the source pins bite on a scratch tree holding the
kit, the smoke and copies of the seven source files:
- changing `"Could not load draft"` in the route copy gives 45 pass, 1 fail;
- changing `Cache-Control` in the `headers.ts` copy gives 42 pass, 4 fail;
- deleting the members stub from the kit copy gives 1 fail (it survived in round 1).

**The new object log format** has no MEDIUM+ issue:
- Each entry is `{ at, mode, envelope, request, status }`, and `request` goes through
  `scrub`. Cross-origin writes keep only their path, so a Sentry `sentry_key=` or PostHog
  query string never enters the log.
- `served()` returns the same Response it records the status from, so it cannot change what
  the page sees. A network rejection is rethrown after recording `network-error`.
- Boundary entries have no `request`. The smoke's `reqs()` filters them, and anyone reading
  the log by hand has to do the same.
- The script's "read-back as `GET` lines" still fits, because `request` starts with the method.

### Info (LOW, recorded here only; not counted as MEDIUM+)

**IN-01: two script lines do not match the CR-01 refusal.**
`157-FOUNDER-SCRIPT.md:38` (section 2, step 5) says "Nothing should be refused except
page-chrome reads", but a passed preview always adds `GET /api/keys/:id/permissions` to
`refused`. Section 0 says the badge "shows an error" without quoting it. Quoting `HTTP 599`
under "Detected key scopes" would keep the founder from reading it as a red gate (section 5,
step 12, "gate red: record and stop").

**IN-02: the kit and RESEARCH overstate the MT5 probe.**
`157-STAGING-KIT.js:61` and RESEARCH:239 say the Python call includes "a broker probe that may
hit the shared MT5 terminal". For MT5 the handler returns a fixed read-only triple and makes no
broker call (`analytics-service/routers/internal.py:483-490`). The audit insert and the decrypt
are real, so the refusal still stands.

**IN-03: one Supabase write still passes as telemetry.**
`POST <supabase>/realtime/v1/api/broadcast` (supabase-js's REST broadcast) is not covered by
`BACKEND_WRITE_RE` and passes as outside telemetry. It is logged, it writes no table, and
`src/` has no `.channel(` caller. Adding `realtime` to the regex would close it.

**IN-04: the consume step paints outside the router's try.**
At `157-STAGING-KIT.js:465-468`, a throwing `paint` (DOM unavailable) would make `fetch` throw
synchronously, and the envelope would stay armed for the next finalize click. That still sends
nothing over the network. Clearing `state.envelope` before painting, or painting inside a try,
would remove the edge.

---

_Round 2 reviewed: 2026-11-23T00:17:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunter, rounds 1 and 2 (2026-11-23), recorded by the phase agent

- Round 1 findings SFH-1..5, all MEDIUM, were fixed in the same fixer commits (`2c02e2bc2..b692d64cf`):
  - SFH-1 is the same finding as CR-01.
  - SFH-2: outside-prefix writes passed with no log.
  - SFH-3: the router catch swallowed its cause.
  - SFH-4: the logs could not prove which answer was served.
  - SFH-5: the marker could disagree with the armed state.
- Round 2 confirmed SFH-1..5 resolved. It found one new MEDIUM, N1: a wrong-world re-evaluation could paint `NOT ACTIVE` over a live marker, and a stale marker text was never repainted. The phase agent fixed N1 in `3d6306fcd`. The new smoke case went RED under both neuters and was restored with `cp` + `cmp`. The smoke now passes 47/47.
- Round 2 also asked whether Next 16.4.2's app router defines `self.__next_f`. It does: `next/dist/client/app-index.js` reads it, and the server flight stream writes it. That was confirmed by reading the installed package.
- LOW items stay here and are not fixed:
  - A thrown non-Error value logs an empty cause.
  - An aborted passed request is recorded as `network-error`.
- IN-01, partly addressed in `3d6306fcd`: script section 2 step 5 now names the expected permissions refusal.
