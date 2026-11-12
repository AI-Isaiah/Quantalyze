---
phase: 200-managerkeys
reviewed: 2026-11-11T12:13:19Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - .github/workflows/ci.yml
  - e2e/api-key-flow.spec.ts
  - e2e/csv-upload-flow.spec.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/manager-keys.spec.ts
  - e2e/sync-analytics-flow.spec.ts
  - src/__tests__/e2e-seeded-hydration-guard.test.ts
  - src/__tests__/manager-keys-e2e-wiring.test.ts
  - src/__tests__/observ12-fixtures-presence.test.ts
  - src/__tests__/tap-target-minimums.test.ts
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/ui/Modal.tsx
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
  necessity: 0
status: issues_found
---

# Gap-closure review round (2026-11-11)

**Reviewed:** 2026-11-11T12:13:19Z. The base is `d8b2df29e` and the head is `e282165f9` (plans 200-13, 200-14 and 200-15).
**Depth:** standard. Call chains were traced into `ApiKeyManager`, `SyncProgress`, `KeyPermissionBadge`, the `/api/keys/[id]/permissions` route, `e2e/helpers/reflow.ts`, `e2e/helpers/hydration-guard.ts` and `playwright.config.ts`.
**Files Reviewed:** 12
**Status:** issues_found
**Scope of the report:** MEDIUM and above only, as the caller asked. LOW and INFO items are left out. The review was read-only and no source file changed.

## Summary

All three gaps are closed in the way the plans describe. Product code has no defect at MEDIUM or above. All four findings (WR-07 to WR-10; the IDs continue from the earlier rounds' WR-01 to WR-06) are in the moved e2e tests and the wiring pin, and the question in each is the same one this round exists to answer: can a blocking test fail? The tests gap 1 names (`Change key…` opens the picker, a pick opens the confirm, nothing is written before `Change key`, the confirm writes) hold, and they have a product-neuter RED proof. WR-07 to WR-09 concern the other tests that moved with them: the Resync failure lines, the completion state and the absence check.

**What holds, checked against the code:**

- **Placement and blocking.** `e2e/manager-keys.spec.ts` is in the `e2e-seeded` list (`ci.yml:7086`), and the step runs under bash `-e`. The job is in the `frontend` aggregator's `needs:` list and its result loop. That loop tolerates a skip only on a fork PR, and on a trusted event a skip is an `::error::`, so a lost `E2E_TEST_DB_CONFIGURED` goes red too. The job has no job-level `continue-on-error`. `critical-regressions.test.ts:737` pins the job's shape, its `vars.E2E_TEST_DB_CONFIGURED` gate included. The spec has no env self-skip. `seedManagerKeyPanel` → `getAdmin()` throws when the env is missing.
- **Unauthenticated contract tests.** The 401 tests use Playwright's `request` fixture. `playwright.config.ts` sets no `storageState`, and the new spec logs in through `loginAs` on its own per-test `page` context. So no session can reach the `request` fixture.
- **Seed isolation.** Each test mints its own user (`uniqueSuffix`), and `workers` is 1 in CI. `e2e-seeded` runs on a local stack private to its runner (Phase 164.9.4), so leftover users never reach shared TEST. Cleanup deletes the strategy first and then the keys, and logs any failure. One gap is LOW and not reported: a seed that throws after its key inserts leaks those keys and leaves a stale `seeded` for `afterEach`.
- **Analytics dependency.** Nothing in the spec calls the analytics service. Every `/api/keys/sync` call is stubbed. The edit page's `KeyPermissionBadge` probe fails at once in this lane: `INTERNAL_API_TOKEN` is set nowhere in `ci.yml`: one comment names it and no `env:` does (`permissions/route.ts:206-210`), so the route returns a JSON 502 (`:658-700`), and outside `VERCEL_ENV=production` the rate limiter fails open. That makes it deterministic, not flaky. The permanent red alert it leaves on the page is what WR-07 rests on.
- **Modal Close geometry.** At 320px a native `<dialog>` is at most `100% - 2em - 6px` = 282px wide. After the card's `p-6` and border, about 232px of content is left. The Close button's margin box is 44 - 12 = 32px wide, which leaves the `<h2>` about 200px to wrap in. The 44px box can stick out of the header by at most (44 - 20) / 2 = 12px above and below. That stays inside the card's 24px top padding and the header's 16px `mb-4`, so the button covers neither the title nor the dialog body. A wrapping title only makes the header taller, and `items-center` keeps the button centred. Every importer passes a title that is never empty: a string literal, or a template or ternary whose branches are all non-empty (`AllocateDialog`, `RequestIntroButton`, `AllocatorExchangeManager`'s delete confirm). A grep finds no importer with its own `Close` or `Dismiss` control and no top-anchored absolute child. One case is LOW and not reported: `RequestCallModal.tsx:116` starts its body with a `-mt-3` subtitle, which leaves only 4px of the `mb-4` gap. For a single-line title of about 26px, the Close box and its focus ring now overlap the subtitle's top right by about 5px.
- **Row at 320px.** `basis-[calc(100%_-_3.5rem)]` works out exactly to the row's content box minus `w-10` and `gap-4`. Tailwind's default `--spacing` is not overridden: `globals.css` only adds `--spacing-sidebar`. The MT5, share-note, balance-elsewhere, feeds and departed lines all sit inside the label column, so they gain width and nothing else changes.

**Not measured, recorded rather than reported:** the key row from `md` (768px) up to about 880px. From `sm` up the change is a no-op (`sm:basis-0` equals `flex-1`'s own 0% basis), so this is not a regression. At `md` the 260px sidebar appears, though (`DashboardChrome.tsx:240`), and the row's content box falls to about 360px at a 768px viewport. That is computed from the classes, not measured: `px-8`, Card `p-6`, the borders and the row's `px-4`. The row's non-label items take about 304px with the gaps, and a `basis-0` label column gets only what is left over. So the "label squeezed by Last sync" mechanism behind gap 2 probably comes back at 768–880px. Neither new test covers that band (320 and 1280 only), and neither does `layout-narrow`'s SC2-PROFILE (V390 and V640). DESIGN.md's 2026-06-29 entry says strips should reflow on their own width (`@container`), not on the viewport. A measured box at 768px would settle it.

## Warnings

### WR-07: "sync failure shows error message" passes on the permissions badge's alert, not on the sync failure (MEDIUM, test reliability)

**File:** `e2e/manager-keys.spec.ts:262-281` (assertion at `:275`)
**Issue:** `page.locator(".text-negative")` is satisfied before the Resync click has any effect:
- **The page already has one match.** It renders `KeyPermissionBadge` for every key-backed strategy that has an `api_key_id` (`src/app/(dashboard)/strategies/[id]/edit/page.tsx:214-216`). In this lane that badge's probe always fails (see the Summary), so it shows `<p className="text-fixed-13 text-negative" role="alert">` (`KeyPermissionBadge.tsx:336-339`).
- **The sync failure cannot produce a single match.** It renders two `.text-negative` nodes: the icon span (`SyncProgress.tsx:564`) and the "Sync failed" label (`:573`). The panel's own `{error}` line is hidden because `error === syncError` (`ApiKeyManager.tsx:1707`).
- **Probed, not run against the app.** A Playwright probe on a static page holding two nodes with those classes gives `strict mode violation: locator('.text-negative') resolved to 2 elements`.

The 200-13 run is green in 1.7s. That is only possible if the first poll after the click resolved to exactly one node, which was the badge's alert, before the sync error rendered. That conclusion is inferred from the code and the probe, not observed in a trace.

**What follows:**
- **The test cannot fail on the behaviour it names.** A regression that shows nothing on a 500 still passes. The second assertion, Resync enabled again, also passes on any outcome that ends the attempt.
- **It is fragile the other way too.** If the badge's alert goes away, whether through a seed with real permissions, a lane that sets `INTERNAL_API_TOKEN`, or a badge fix, the locator resolves to 2 nodes and the test goes red. That red would come from a strict-mode violation, not from the product.

**Fix:** assert the failure's own text inside the panel, and assert it is absent before the click:
```ts
const panel = page.getByRole("heading", { name: /Exchange API Keys/i }).locator("xpath=../..");
await expect(panel.getByText("Exchange API rate limit exceeded")).toHaveCount(0);
await page.getByRole("button", { name: /Resync/i }).click();
await expect(panel.getByText("Exchange API rate limit exceeded")).toBeVisible({ timeout: 10_000 });
await expect(panel.getByRole("status").filter({ hasText: "Sync failed" })).toBeVisible();
await expect(page.getByRole("button", { name: /Resync/i })).toBeEnabled({ timeout: 5_000 });
```
That is the route's own `error` string, which `syncFailureMessage` returns and `SyncProgress.tsx:661-663` renders.

### WR-08: The "completion" test and the "non-JSON" test both pass through any failure arm, so neither can tell its own branch apart (MEDIUM, test reliability)

**File:** `e2e/manager-keys.spec.ts:243-260` (stub body at `:249`), `:283-299` (regex at `:296`)
**Issue:**
- **"sync button returns to normal state after completion".** The stub answers `{ trades_fetched: 10, analytics_status: "complete" }` with no `ok: true`. `isSyncEnqueued` (`ApiKeyManager.tsx:160-166`) requires `ok === true`, so `:1245` throws `EnqueueAnswerError(SYNC_UNAVAILABLE_COPY, "unrecognized")` and the attempt ends as an **error**. The test passes because the failure arm re-enables Resync. No success or completion path runs. A regression that leaves Resync disabled after a real enqueue would pass, and so would one that turned every 2xx into an error.
- **"sync failure with non-JSON response shows service unavailable".** The 502 HTML stub makes `syncFailureMessage` (`:113-128`) return `SYNC_UNAVAILABLE_COPY` ("We couldn't start the sync. …", `:89-90`), and that string matches neither half of `/service unavailable|sync failed/i`. The test passes on the generic "Sync failed" label (`SyncProgress.tsx:210`), which every error shows. The point of the content-type branch is that an HTML body must not end in a `SyntaxError` message. If it regressed to a bare `res.json()`, the panel would show "Unexpected token '<'…" under the same "Sync failed" label, and the test would stay green.

**Fix:**
- **The 502 test.** Assert the copy itself: `await expect(page.getByText("We couldn't start the sync. Your key is saved", { exact: false })).toBeVisible({ timeout: 10_000 })`.
- **The "completion" test.** The honest minimal fix is to rename it to what it covers, "an unrecognised 2xx ends the attempt, shows the unavailable copy and re-enables Resync", and assert that copy. Testing real completion takes more than adding `ok: true`. An enqueued attempt stays live (Resync reads `Syncing…`) until `SyncProgress` reads a terminal, so the test would also have to seed a terminal compute job or analytics row for the strategy.

### WR-09: "edit page no longer offers Add Key or Delete": nothing waits for the key cards before the per-card absence checks (MEDIUM, test reliability)

**File:** `e2e/manager-keys.spec.ts:200-209`
**Issue:** The test waits only for the panel heading, which renders on the first paint. The key cards load on the client afterwards:
- `keys` starts as `[]` (`ApiKeyManager.tsx:440`) and `firstReadSettled` starts as `false` (`:445`), so the panel shows "Loading keys…" (`:1498`) until `loadKeys` (`:590`) answers.

`toHaveCount(0)` passes on its first poll that finds no match. So the `Delete` and "No API keys connected" assertions can run against a panel that has no cards yet, and then they pass even if a per-card `Delete` came back. This is a race: no run showed which way it goes. Only the header-level `Add Key` check is reliable.

**Fix:** wait for a card before asserting absence, for example `await expect(panel.getByRole("button", { name: /Resync/i })).toBeVisible();` right after the heading. The seeded linked key always renders Resync.

### WR-10: The wiring pin catches the exact neuters it was proven against, but common equivalents slip past it (MEDIUM, gate integrity)

**File:** `src/__tests__/manager-keys-e2e-wiring.test.ts:87-103`, `:122-136`
**Issue:**
- **The tolerance check.** It matches only `continue-on-error:`, `set +e` and the literal `|| true` in the else arm. Each of these keeps the step green when Playwright fails, and none is caught:
  - `npx playwright test … || PW_EXIT=$?`, the capture idiom the unseeded job already uses at `ci.yml:6409-6411` without its `set +e`, followed by a cleanup that never re-exits.
  - `|| :`
  - `|| echo …`
  - `|| exit 0`
- **The skip check.** It looks for literal needles. These all let the spec pass without running its assertions, and none is caught:
  - `test.info().skip(…)` or `testInfo.skip(…)` (no `test.skip(` substring).
  - An early `return` in `beforeEach` or a test body.
  - An env gate under any name other than `PLAYWRIGHT_TEST_STRATEGY_ID`.
  - An aliased import (`import { test as t }` then `t.skip(`).

The pin's docblock promises it pins "the four ways that placement can quietly stop meaning anything". Two of the four are pinned only against their most literal form.

**Fix:**
- **Tolerance.** Invert the check: require that the else arm's `npx playwright test` line, plus its continuation lines, end at `--timeout 60000` with no `||`, `;` or `&&` after it, and that no later code line in the step assigns `$?`.
- **Skips.** Widen the needles to `/\.skip\(/`, `/\.fixme\(/` and `/\.only\(/` on any receiver, and add `process.env` as a needle. The spec reads no env var by design. Then add one RED proof per new needle, as plan 13 did for the first two.

---

_Reviewed: 2026-11-11T12:13:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (gap-closure round, MEDIUM+)

### SFH-G1: cleanupManagerKeyPanel only console.warns on a failed delete (MEDIUM, test hygiene)
`e2e/helpers/seed-test-project.ts` `cleanupManagerKeyPanel` (called from `e2e/manager-keys.spec.ts` afterEach in both describes). A failed strategy or key delete is logged and ignored, so leaked rows never fail a run. Note: e2e-seeded runs on a lane private to its runner (CLAUDE.md, Phase 164.9.4), so the leak does not reach shared TEST; it still hides a broken cleanup locally. Fix: attempt every delete, collect errors, throw one aggregated Error at the end.

### SFH-G2: a seed that fails partway leaks rows, and afterEach then re-cleans the previous test's ids (MEDIUM, test hygiene)
`e2e/manager-keys.spec.ts` beforeEach/afterEach (both describes) and `seedManagerKeyPanel`. `seeded` is never reset, so a throwing seed leaves `seeded` pointing at the previous test. Fix: reset `seeded` to undefined at the top of beforeEach; in `seedManagerKeyPanel`, on a failed insert delete the ids created so far and rethrow.

### SFH-G3: the Resync route stubs are never shown to be hit, and their URL patterns differ (MEDIUM, test reliability)
`e2e/manager-keys.spec.ts` uses `**/api/keys/sync` in one stub and bare `/api/keys/sync` in the others. A stub that misses lets the real route run against an undecryptable placeholder key, which fails on its own and satisfies the failure tests (compounds WR-07/WR-08). Fix: `**/api/keys/sync` everywhere, count hits per stub, assert the count is greater than 0 after the click.

### Orchestrator note R-G1: row layout between sm and lg is unmeasured (MEDIUM candidate, user-facing)
The reviewer computed (not measured) that from 768px the 260px sidebar narrows the row's content box to about 360px, so the label squeeze may return around 768-880px; the new tests cover only 320px and 1280px. Fix: measure the label column at 640, 768, 900 and 1024px; if the label truncates materially or the metadata wraps word-per-line at any of them, move the breakpoint of the plan-15 classes (`sm:basis-0`, `sm:text-right`) to the smallest breakpoint that measures clean, and add that width to the e2e row test.

## Re-review (round 2)

**Reviewed:** 2026-11-11T17:45:15Z. The base is `a3c3aaa96` and the head is `998790212` (9 commits, gap-closure fix round). Scope: `git diff a3c3aaa96..HEAD -- . ':!.planning'`, which covers `e2e/manager-keys.spec.ts`, `e2e/helpers/seed-test-project.ts`, `src/components/exchanges/AllocatorExchangeManager.tsx` and `src/__tests__/manager-keys-e2e-wiring.test.ts`.
**Depth:** standard. Only MEDIUM and above are reported. The review was read-only. `manager-keys-e2e-wiring.test.ts` (4/4), `spec-disabling.invariant.test.ts` and `e2e-seeded-hydration-guard.test.ts` (39/39) are green at HEAD. The e2e spec was NOT run, because it needs the seeded local stack. No workflow run is bound to `998790212` either (`actions/runs?head_sha=` returns 0 runs), so every e2e verdict below comes from reading the code, not from a run.

### Dispositions of the gap-closure findings

- **WR-07: FIXED.** The test no longer uses `.text-negative`. It asserts that the route's own string ("Exchange API rate limit exceeded") is absent from the panel before the click and visible after it, then asserts the panel's `role="status"` "Sync failed" node. Both locators are scoped to the panel root (`heading` → `xpath=../..`), and `SyncProgress` renders inside that root (`ApiKeyManager.tsx:1399`, `:1654`). Only the stub can produce that string, so the badge's alert can no longer satisfy the test.
- **WR-08: FIXED.** The 502 test asserts `SYNC_UNAVAILABLE_COPY` ("We couldn't start the sync. Your key is saved…"). For a 502 with an HTML body, that copy comes from `syncFailureMessage`'s non-JSON arm (`ApiKeyManager.tsx:113-128`). A regression to a bare `res.json()` would show a `SyntaxError` message instead, and the test would go red. The old "completion" test is renamed to what it covers (an un-stamped 2xx → `unrecognized` → the same copy, `:1245`) and asserts that copy. The docblock says real completion is not covered.
- **WR-09: FIXED.** The test waits for the panel's `Resync` button, which only a loaded key card renders, before it runs the three `toHaveCount(0)` checks.
- **WR-10: PARTLY FIXED. See WR-11.** The skip side is fixed. `/\.skip\(/`, `/\.fixme\(/`, `/\.only\(/` and `/process\.env/` run on the comment-stripped spec, so they catch `test.info().skip(`, an aliased `t.skip(` and any env gate. The escaped-dot sources pass the spec-disabling invariant. The invocation-line side is also fixed. Replaying the pin's own logic against a mutated copy of `ci.yml` turns `--timeout 60000 || true` red, and any `||`, `;`, `&&` or extra line before the arm's `fi` is caught the same way. `$?` is rejected anywhere in the step, and today's step has none (`SERVER_PID=$!` is `$!`). Three equivalents still pass the pin: `fi || true` at the compound level, and the `set +o errexit` and `set +eo pipefail` spellings, which the errexit check misses. They are WR-11.
- **SFH-G1: FIXED.** `cleanupManagerKeyPanel` attempts the strategy delete and every key delete, collects the failures, and throws one aggregated Error. Making this fatal should not add spurious reds. This was checked by reading the code, not by a run. Cleanup deletes the strategy first, so the `strategies.api_key_id` FK cannot block the key deletes. `strategies` has no delete trigger (its only trigger is the `BEFORE INSERT OR UPDATE OF api_key_id` ownership check). The `api_keys` composite delete guard applies only to published composites, and the seed is `private`. Every non-cascading FK into `strategies` comes from `match_decisions` or the portfolio-intelligence tables, and no test here writes those. Every trigger on `strategies` is `BEFORE`, so none of them writes rows. The re-point and Resync tests write no rows that reference these keys.
- **SFH-G2: FIXED.** `seedManagerKeyPanel` records each id as it is created. On a throw it deletes the strategy first, then the keys, and rethrows the original error unchanged. If the rollback itself fails, it throws one Error that carries the seed's message and every rollback failure, so the seed's reason is not lost. Both describes reset `cleanupTarget` at the top of `beforeEach` and set it only after a full seed, and `afterEach` cleans only `cleanupTarget`. `afterEach` still runs when `loginAs` throws after a successful seed, so that case is cleaned too.
- **SFH-G3: FIXED.** All four Resync stubs use `**/api/keys/sync`. `ApiKeyManager.tsx:1224` fetches the bare `/api/keys/sync` with no query string, so the glob matches. Each stub counts its hits. The syncing-state test polls the count with `expect.poll`, which fails on timeout and never passes on one. The handler increments the count before its 2 s delay, so the poll does not wait out that delay. The other three tests assert the count once the answer is visible. Only the 500 test's string is unique to the stub. In the 2xx and 502 tests the unavailable copy could also come from the real route, and the hit count is what rules that out. The re-point test's stub has no hit counter, which is acceptable: that test's verdict is the database read of `api_key_id`, which the stub does not affect.
- **R-G1: FIXED at 768. NOT FIXED for the lg band, see WR-12.** `basis-0` and `text-right` moved from `sm:` to `lg:` on both the active row and the disconnected row. The row test now loops over 320 and 768. At 768 it asserts that the label column fills the content box, starts beside the tag and is not truncated, and that Last sync wraps below it. The old `sm:basis-0` measured 28px at 768 (the test's docblock), so the test can fail. The 1280 one-line test still has a valid RED proof: without `lg:basis-0` the column keeps its `calc(100% - 3.5rem)` basis at 1280, Last sync wraps, and `lastSyncTop < column.bottom` fails. No unit test or e2e pins the old `sm:` class strings. `layout-narrow`'s SC2-PROFILE (V390, V640) checks only that Disconnect sits inside the viewport after scrolling, and a taller wrapped row at 640 does not change that. R-G1's own fix text asked to "add that width to the e2e row test", meaning the smallest width that measures clean on the single-line side. The loop holds only wrapped-side widths, and 1024, the width where the single-line layout now starts, measures squeezed (WR-12).

### WR-11: The wiring pin still passes three neuters of the seeded step under `bash -e`: `fi || true`, `set +o errexit` and `set +eo pipefail` (MEDIUM, gate integrity)

**File:** `src/__tests__/manager-keys-e2e-wiring.test.ts:88-112`. The step is `.github/workflows/ci.yml`, `Run seed-gated specs (MA-8 / BLOCK-3)`, at the `fi` after `e2e/manager-keys.spec.ts \ --timeout 60000`.
**Issue:** The pin's tail check reads only the text between `--timeout 60000` and the `fi` that closes the else arm (`seededElseArm` stops at the first `\n\s*fi\b`, `:58-61`, and the tail regex stops there too). Nothing looks at what follows that `fi` on the same line. In bash, errexit is ignored for every command inside a compound command that runs as a non-final element of an `||` list. So `fi || true`, `fi || :` and `fi || echo …` all turn a red Playwright run into a green step:
- **Shell, measured.** `bash -e` on `if …; else false \ --timeout 60000; fi || true; echo after` prints `after` and exits 0.
- **Pin, replayed.** The test's own `seededStep`, `codeLines`, `seededElseArm` and tail logic, replayed in node against a copy of `ci.yml` with that one `fi` changed, give these results: `fi || true`: passes; `fi || :`: passes; `--timeout 60000 || true`: red (control).

**The errexit check has the same gap.** `/\bset \+e\b/` (`:95`) does not match `set +o errexit`, and it does not match `set +eo pipefail` either, because `e` is followed by a word character. Replayed in the same way, each line inserted before the `if` passes the pin. `bash -e` on `set +o errexit; false; echo after` prints `after` and exits 0.

This is the same failure class WR-10 named ("the seeded step starts tolerating failure"), moved one token to the right. The docblock (`:16-18`) promises "anything chained after the invocation". It covers the invocation line but not the `if` the invocation sits in. `$?` capture is still caught (`fi || PW_EXIT=$?` contains `$?`), but the no-capture forms are not.
**Fix:** require the `fi` that closes the arm to stand alone on its line. Extend the tail match past the `fi` and require the rest of that line to be empty:
```ts
const tail = arm.match(/--timeout 60000([\s\S]*?)\n\s*fi\b/);
// ...existing tail assertion...
const afterFi = step.slice(step.indexOf(seededElseArm(step)) + seededElseArm(step).length);
expect(
  afterFi.split("\n")[0].trim(),
  "the seeded `if` has something chained after its `fi` (`fi || true`), which ignores errexit for the whole arm",
).toBe("");
```
For errexit, match the option, not one spelling of it: `/\bset\s+\+[a-z]*e/` together with `/\bset\s+\+o\s+errexit\b/`. Add one RED proof each for `fi || true` and `set +o errexit`, as the earlier neuters had. A subshell wrapper (`( if …; fi ) || true`) is the same class. A cheap pin for it is to reject any code line in the step that, trimmed, starts with `)` or matches `/\bfi\s*(\|\||&&)/`. Run against today's step, that pin matches 0 lines, so it adds no false red on `ci.yml`.

### WR-12: From 1024px (`lg`) the label column is squeezed again, and no test measures any width between 768 and 1280 (MEDIUM, user-facing)

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:1813` (active row) and `:1944` (disconnected row), `lg:basis-0`. Test gap at `e2e/manager-keys.spec.ts:435` (`[320, 768]`) and `:465-482` (the 1280 test asserts no label width).
**Issue:** R-G1 moved the switch to the single-line layout from 640 to 1024, but the mechanism behind gap 2 is still there at the new switch point. From `lg` up the label column has `flex-basis: 0` and `min-width: 0`, so the flex line takes it as 0px wide. Last sync, the status block and the `sm:basis-auto` actions group all join line one whenever they fit, and the label gets only what is left. At 1024 the sidebar layout leaves a 616px content box: viewport − 260 (`md:ml-[260px]`) − 64 (`md:px-8`) − 48 (Card `p-6`) − borders − 32 (row `px-4`).

**Measured, in a static harness and not against the app.** The harness is an HTML page that uses this worktree's own compiled Tailwind CSS (`.next/dev/static/chunks/src_app_globals_css_*.css`, built after `30294b3b5`). It copies the shell's exact classes (`md:ml-[260px]`, `max-w-7xl`, `md:px-8`, Card `p-6`), the row's exact classes and the `Button` `md` size, and it measures in Playwright Chromium. It reproduces the content box exactly: 360px at 768, which the spec's own "about 392px" row minus `px-4` gives, and 616 / 872 at 1024 / 1280. Label-column widths:

| viewport | manager, `Delete key` | MT5, `Update password` + `Delete key` | allocator, `Sync now` + `Disconnect` | error status with helper |
|---|---|---|---|---|
| 1023 (wrapped) | 559 | 559 | 559 | 559 |
| **1024** | **241** | **113** | **164** | **150** |
| 1100 | 317 | 188 | 239 | 226 |
| 1280 | 496 | 365 | 417 | 405 |

At 1024 the MT5 row's `Binance · Read-only`, `MT5 account …` and feeds lines each wrap to 2 lines (all 1 line at 1100). A 24-character label ("UAT Binance main account") truncates in 3 of the 4 rows. The 2026-11-11 320px UAT reported exactly that symptom ("UAT ..."). **The harness under-states the squeeze.** It uses fallback fonts, and its stand-ins for `KeyFeedsLine` and the status helper are short. With `flex-basis: 0` forced at 768 it gives the manager row 108px, where the real seeded row measured 28px. So real rows lose about 80px more than the harness shows, which puts the MT5 and allocator rows at 1024 near the width that failed at 768. A measurement of the real app at 1024 would settle it, and the spec's `measureKeyRow` already does that.

No test can see this. The loop's 768 sits on the wrapped side. The 1280 test asserts only that Last sync shares the line and sits to the right of the column, and it would pass with a 20px column.
**Fix:** measure the real seeded rows at 1024 and 1152 (and an MT5 row, if one can be seeded). Then pick one of two options:
- **The minimal fix.** Move the two `lg:` pairs to `xl:` (1280). At 1280 the harness gives 365–496px. Then add 1024 to the wrapped-side loop.
- **The DESIGN.md fix.** The 2026-06-29 entry says strips reflow on their own width, not the viewport's. Mark the list wrapper `@container` and switch on the row's own width (for example `@3xl:basis-0` and `@3xl:text-right`, 48rem = 768px of row). That also covers the narrower card on any future surface that reuses this list.

Either way, add a label-width floor to the single-line test so that a squeezed column goes red, for example `expect(g.column.right - g.column.left).toBeGreaterThanOrEqual(200)` at the smallest single-line width. Prove it RED against today's `lg:` at 1024.

## Re-review (round 3)

**Reviewed:** 2026-11-11T18:08:32Z. The base is `42a32848b` and the head is `b43def9f3` (2 commits: `1eca04c47` for WR-11, `b43def9f3` for WR-12). Scope: `git diff 42a32848b..HEAD -- . ':!.planning'`, which covers `src/__tests__/manager-keys-e2e-wiring.test.ts`, `src/components/exchanges/AllocatorExchangeManager.tsx` and `e2e/manager-keys.spec.ts`.
**Depth:** standard. Only MEDIUM and above are reported. The review was read-only. `manager-keys-e2e-wiring.test.ts` (4/4) is green at HEAD, as are `src/components/exchanges`, `ProfileTabs.test.tsx` and `e2e-seeded-hydration-guard.test.ts` (11 files, 312 tests). The e2e spec was NOT run, because it needs the seeded local stack. No workflow run is bound to `b43def9f3` (`actions/runs?head_sha=` returns 0 runs). Every e2e verdict below comes from reading the code and from a static harness, not from a run of the app.

### Dispositions of the round-2 findings

- **WR-11: FIXED for the three named neuters. Some residual spellings are below MEDIUM.** The pin now reads the rest of the line after the `fi` that closes the arm. `seededElseArm` ends its match at `\n\s*fi\b`, so `afterFi` really is the text after `fi` on that line. It is not a vacuous empty string. The errexit check now matches the option (`/\bset\s+\+[a-z]*e/`, `/\bset\s+\+o\s+errexit\b/`). The pin's own logic was replayed in node against mutated copies of `ci.yml`:
  - `fi || true`, `fi||true`, `set +o errexit` and `set +eo pipefail` all go red.
  - Today's file is green.
  - The new regexes match no line of today's seeded step. Its code lines have no `set` at all. `set +e` appears elsewhere in `ci.yml` (seven other places), but the pin is scoped to this step only, so none of those can false-red it.

  Three spellings still pass:
  - the subshell wrapper `( if …; fi ) || true`, which round 2 called "the same class" and offered an optional pin for;
  - `set +Ee`, because `[a-z]` does not include `E`;
  - `set -x +e`, because the regex needs `+` straight after `set`.

  These are rated below MEDIUM. Each one is a deliberate multi-token construction that nobody types by accident. The pin's job is to catch accidental tolerance, and the likely forms (`continue-on-error`, `set +e`, `|| true` on either line, a `$?` capture) are all covered. `fi || true` is different: it is a one-token edit at the end of a line that already exists. Neither the two commit messages nor the test records a RED proof for the new arms, so the replay above is the evidence.
- **WR-12: FIXED as filed (the viewport band from 1024 to 1272). The mechanism survives in rows that carry a status helper, see WR-13.** The two `lg:` pairs are now `@4xl:` pairs on both rows, and each key list is the `@container` host. Tailwind v4's `--container-4xl` is 56rem, `globals.css` does not override it, and the repo already uses `@4xl:` (`StrategiesLegend.tsx`).
  - **The host is a strict ancestor and breaks nothing nearby.** The `@container` is the list `div`, the parent of every row. Each `@4xl:` class sits on a grandchild, so no same-element trap applies. The list is a block box in normal flow inside `Card` (a block `div` in `space-y-4`), so inline-size containment does not collapse it. Its width comes from its parent, not from its content. The empty state (the dashed `div`), the header, the Disconnected card's header and the "How exchange sync works" card are all outside both hosts. No row descendant is `fixed`, `absolute` or portalled (`AllocatorSyncStatus`, `KeyFeedsLine` and `renderDepartedHistory` were checked), and no descendant carries another `@<size>:` variant that would now resolve against the list. No unit test pins the old `lg:` strings.
  - **The test closes the band.** 1024 is in the wrapped loop. At 1024 the container is 648px, under 896, so the row wraps. Against the old `lg:basis-0` the column would not reach the row's right edge at 1024, so the loop has a valid RED proof. The 1280 test adds a 200px label floor.
  - **The 8px margin at 1280 is deterministic in CI.** The container width is fixed arithmetic: viewport − 260 − 64 − 48 − 2 (Card border) − 2 (list border) = 904 at 1280. No font metric enters it. `playwright-core` pushes `--hide-scrollbars` whenever `options.headless` is set, and `playwright.config.ts` does not turn headless off. So the vertical scrollbar of the `overflow-y-auto` `<main>` takes no width in CI. In a real browser with classic scrollbars (Windows, Linux, macOS set to always show them), that scrollbar takes about 15-17px, so a 1280 viewport gives a container of about 887-889px and the row stays WRAPPED. That is the safe side. Two consequences, neither one a defect: the single-line layout starts at about 1290 there, and a headed Linux run of the 1280 test would go red. Neither changes the CI verdict.

### WR-13: In the single-line layout an allocator row with a status helper still squeezes its label to a few px, at every width up to the page cap, and the 200px floor measures only a healthy manager row (MEDIUM, user-facing; this is older than Phase 200 and the phase did not fix it)

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:1817` (active row, `@4xl:basis-0`). The disconnected row has the same class at `:1948`. The status block is `src/components/exchanges/AllocatorSyncStatus.tsx:330-340` (`flex flex-col items-end`, with a helper `div` that has no width bound). The test gap is `e2e/manager-keys.spec.ts:469-493`, where the 1280 floor measures only `seeded.linkedKey`, a healthy, helper-free manager row.
**Issue:** WR-12 named the mechanism. In the single-line layout the label column has `flex-basis: 0; min-width: 0`, so flex line-breaking counts it as 0px. Every sibling joins line one whenever its max-content width fits, and the label gets what is left over. The container query decides WHEN the single-line layout applies. It does not change what the layout does. So the leftover still depends on the row's CONTENT, and not only on its width.

The status block's helper (`AllocatorSyncStatus.tsx:293-316`) is one unwrapped sentence at max-content width. Two real strings make it wide:
- `CREDENTIAL_FAILED_HELPER`, "Update this account's credentials — they may have changed." This is the authored helper for `sign_in_failed`, which the holdings sync writes (`analytics-service/services/allocator_positions.py`, `SIGN_IN_FAILED_SYNC_STATUS`). That file names MT5 as the case it was built for.
- The `error` row of `SYNC_ERROR_COPY_BY_STATUS`, "Couldn't sync holdings from {venue} — the balances shown are from the last successful sync." `sync_error_copy` writes it to `api_keys.sync_error`, and the helper renders it for `error`.

`complete_with_warnings` renders a worker warning capped at 500 characters, and `helper_override` renders the client's own copy.

The new code comment says the threshold was "measured clean from about 52rem of row on the heaviest rows". That holds for rows with no helper. It does not hold for the rows in a failed state, which are the rows the owner most needs to identify.

**Attribution.** Before Phase 200 the label column was a bare `flex-1 min-w-0` (`git show 19353fd1f^:src/components/exchanges/AllocatorExchangeManager.tsx`, `:1431` and `:1558`), so it was basis 0 at every width. The helper-row squeeze is therefore older than the phase. Phase 200 narrowed where it can happen (rows of 56rem and up), but it did not remove it. This diff did not introduce it.

**Measured, in a static harness and not against the app.** The harness is hand-written CSS equivalent to the row's classes: the `flex flex-wrap gap-4 px-4` row, a 40px tag, the `flex: 1 1 0; min-width: 0` column with its metadata lines, the Last sync block, the status block as above, and `md` Buttons at 14px with `px-4`. Only the allocator row shapes the component really renders are measured: `Sync now` + `Disconnect`, plus `Update password` on an MT5 row. The real copy above is used, and the label is the 24-character "UAT Binance main account". The harness uses Arial and runs in Playwright Chromium. Label-column width in px:

| row width (≈ viewport) | allocator MT5, `sign_in_failed` (credential helper) | allocator MT5, `error` copy | allocator Binance, `error` copy |
|---|---|---|---|
| 896 (≈1272, the threshold) | **15, truncated** | 213 | 213 |
| 904 (1280, the width the test uses) | **23, truncated** | 221 | 221 |
| 1000 (≈1376) | **119, truncated** | 317 | **95, truncated** |
| 1100 (≈1476) | 219 | **44, truncated** | 195 |
| 1164 (the `max-w-7xl` cap, every viewport from about 1540 up) | 283 | **108, truncated** | 259 |

The result does not move steadily with width. Each time the row grows enough for one more sibling to fit on line one, the label falls back to the leftover. So some failed-state row squeezes at every width from the threshold up to the page cap.

**The harness under-states the squeeze, for two reasons.** The app font is DM Sans, which is wider than Arial. And `text-body` is `clamp(0.875rem, 0.85rem + 0.125vw, 1rem)`, about 15.2px at a 1280 viewport, so the real Buttons are wider than 14px ones.

The 1280 test cannot see any of this. Its only measured row is healthy and helper-free, and that row measured about 496px in round 2.
**Fix:** give the label column a real basis in the single-line layout instead of 0, so the line-breaker counts the label's floor. Then the status block and the actions wrap to line two before the label drops under it. On both rows:
```tsx
<div className="flex-1 min-w-0 basis-[calc(100%_-_3.5rem)] @4xl:basis-[12.5rem]">
```
In the same harness, `flex: 1 1 12.5rem` keeps every cell above at 213px or more:
- the `sign_in_failed` MT5 row reads 387-395 at 896/904 and 219-491 from 1000 to 1164;
- the `error` rows read 213-221 at 896/904 and 259-481 from 1000 to 1164.

Helper-free rows are unchanged, because their siblings already fit beside a column that wide. `min-w-0` stays, so truncation still works below the floor.

Then pin the fix by adding a failed-state row to the 1280 test and asserting the same `>= 200` floor on it. Use, for example, an allocator MT5 key with `sync_status: 'sign_in_failed'`, which is the worst cell above, or a key whose `sync_status` is `error` with the real copy. Prove that row RED against today's `@4xl:basis-0`.

This depends on whether `seedManagerKeyPanel` can seed an allocator role, an MT5 key or a `sync_status`. That was not checked. The panel describe seeds a manager, so this may need a separate seed. If it does, a cheaper pin is a component test that renders the row with the credential helper and asserts the class. It is weaker, because jsdom does no layout.

# Earlier review rounds (history)

The block below is the file's previous frontmatter, kept verbatim as a fenced block. Everything after it is the previous body, unchanged.

```yaml
---
phase: 200-managerkeys
reviewed: 2026-11-11T00:00:00Z
depth: standard
files_reviewed: 63
files_reviewed_list:
  - "git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning' (63 files, branch feat/200-managerkeys)"
findings:
  critical: 1
  warning: 6
  info: 0
  total: 7
status: issues_found
---
```

# Phase 200: Code Review Report (round 1)

**Reviewed:** 2026-11-11
**Depth:** standard. The key-risk path was traced end to end: every `strategies.api_key_id` and `strategy_keys` writer, plus the link and sync routes.
**Files Reviewed:** 63
**Status:** issues_found
**Scope of the report:** MEDIUM and above only, as the caller asked. LOW and INFO items are left out.

## Summary

The core re-point path holds. `Change key…` → `ConfirmKeyChangeDialog` → `handleSyncTrades` is the only browser writer of `strategies.api_key_id` that is left. `StrategyForm` edit mode no longer writes `name` or `api_key_id`. The factsheet and list `Rename…` controls are gone. No encryption restatement is left in any `.tsx` outside `/security`. Wizard writers (`create-with-key`, `composite/*`, `MultiKeyConnectStep`) only touch new or draft strategies, so D-03/D-08 put them out of scope.

**What is still open on the key risk:** two existing-strategy writers can re-point a strategy's key with no confirm:
- Resync on a stale page.
- A confirmed change whose "current key" is stale.

Both pass the attempt's read-back guard. The confirm itself is sound.

**Executor items, rated:**
- The 9 skips: MEDIUM (WR-03).
- The "Use & Sync" remedy copy: MEDIUM, user-facing (WR-01).
- The e2e `Use & Sync` spec: MEDIUM, test reliability (WR-04).
- The `ExchangesTabContent` intro: MEDIUM, user-facing (WR-02).
- The orphaned `addKeyBlockedReason`, `DELETE_MEMBERSHIP_UNCHECKED_COPY` and `deleteCompositeWarning` (the last is still imported by the memberships route): dead code, LOW, not reported. `ApiKeyForm` is still referenced (`ValidateWaitCard`, `UpdateMt5SecretDialog` and others), so it is not orphaned.

**Manager-role Delete in AllocatorExchangeManager:**
- Role-gated (`canHardDeleteKey`, `managerOnly`).
- Errors are handled with authored copy.
- The no-holdings arm sends `p_cascade_holdings:false`.
- The holdings arm can send `true` (WR-06).

## Critical Issues

### CR-01: Resync, and a confirmed change on a stale page, re-point the strategy's key with no confirm (HIGH, data-integrity)

**File:** `src/components/strategy/ApiKeyManager.tsx:874-877` (unconditional write), `:1086` (every attempt links first), `:1527-1533` (Resync), `:1640` (confirm's current label), `:1619` (panel Retry)

**Issue:**
- `handleSyncTrades(keyId)` always calls `handleLinkKey(keyId)`, which runs `update({ api_key_id: keyId }).eq("id", strategyId)` with no condition on the row's current value.
- Resync passes `key.id === currentKeyId`, and `currentKeyId` is the server-rendered prop.

**How it breaks:**
1. The edit page is opened at key K1.
2. The key is changed to K2 elsewhere: another tab, another device, or the wizard.
3. Resync is pressed on the first page. It writes `api_key_id = K1`, which silently re-points the strategy back with no dialog.

`readLinkedKeyId` cannot catch this, because it reads back the value this same attempt just wrote.

The same gap exists for a confirmed `Change key…`. The dialog says "will read trades from K3 instead of K1", but the real current key may be K2. The write still lands, so the manager confirmed a sentence that was false.

The phase goal says "nothing re-points a strategy's key without an explicit confirmation". A wrong key changes every number on the factsheet.

**Fix (minimal):**
```ts
// handleLinkKey
if (keyId === currentKeyId) return; // Resync: no write; the read-back below refuses a mismatch
let q = supabase.from("strategies").update({ api_key_id: keyId }).eq("id", strategyId);
q = currentKeyId === null ? q.is("api_key_id", null) : q.eq("api_key_id", currentKeyId);
const { data, error: linkError } = await q.select("id");
if (linkError) throw new Error(`Failed to link key to strategy: ${linkError.message}`);
if (data?.length !== 1) throw new Error("This strategy's key changed since the page loaded. Reload the page and try again.");
```
With the Resync early return, `readLinkedKeyId` then refuses a stale Resync as `link_unverified` and writes nothing.

## Warnings

### WR-01: Owner remedy copy sends managers to "Use & Sync", a control that no longer exists (MEDIUM, user-facing)

**File:** `src/lib/status-surface-copy.ts:399` (`KCS21-UNLINKED`), `src/lib/degrade-warnings.ts:218` (`A-LINK-KEY-EDIT`)

**Issue:** An unlinked strategy's remedy says "Link a key with Use & Sync on this strategy's edit page". The edit page now offers `Change key…`, and only when the account holds another key (`showChangeKey`, `ApiKeyManager.tsx:851`). With no keys it offers only the Profile link. The remedy names a button the manager cannot find.

**Fix:** Reword both sentences, for example: "Link a key with Change key… on this strategy's edit page (add one on your Profile API keys tab first if you have none) to start a new computation." Then update the pinned copy tests.

### WR-02: The API keys tab tells a manager their positions build an Active Allocation portfolio (MEDIUM, user-facing)

**File:** `src/components/exchanges/ExchangesTabContent.tsx:30-35`

**Issue:** D-06 opened the tab to every role. The intro paragraph is still allocator-only copy: "sync your real positions and build your Active Allocation portfolio … invest and divest events are detected".

For a manager none of that happens, because `AllocatorExchangeManager` keeps every holdings call out for `!isAllocatorRole`. The component already gates its own subtitle and "how it works" list by role (`AllocatorExchangeManager.tsx:1676`, `:1981`). The intro was missed.

**Fix:** Gate the paragraph on `role === "allocator" || role === "both"`. Give a manager a neutral sentence, for example: "Read-only exchange API keys your strategies read trades from."

### WR-03: The 200-08-DEFERRED skips leave the first-link confirm and the post-re-point feeds refresh untested (MEDIUM, data-integrity coverage)

**File:** `src/components/strategy/ApiKeyManager.test.tsx:1831, 2608, 2667, 2981, 3386, 3400, 3595`

**Issue:** Nine cases are `it.skip`, all with the reason "needs a non-current-key card or a removed control". That reason is false for at least two of them:
- **`FIRST-LINK` (:3595):** with `currentKeyId: null`, `changeKeyCandidates` is every key (`:848-850`), so the header picker drives it. This is the only test of D-04's "no key is linked yet" wording.
- **`SHAPE-UNKNOWN-NOTE` (:2981):** the note renders for `keyShape="unknown"` (`:1419-1423`) with no per-card control.

`REFRESH-AFTER-RE-POINT` (:3386) and `STALE-ANSWER-DROPPED` (:3400) also look drivable through the picker. The terminal-arm cases (:1831, :2608, :2667) can go through Resync on the current key.

The skips remove coverage from exactly the re-point and feeds-honesty paths this phase exists to protect.

**Fix:** Re-drive each case through `Change key…` → option → `Change key` (or Resync for the terminal-arm cases) and remove the skips. Any case that truly has no driver left should be deleted with a reason, not skipped.

### WR-04: The e2e spec still asserts the removed `Use & Sync` button (MEDIUM, test reliability)

**File:** `e2e/sync-analytics-flow.spec.ts:125-131` (also review `e2e/api-key-flow.spec.ts:252`)

**Issue:** "Use & Sync button is visible for unlinked keys" expects `getByRole("button", { name: /Use & Sync/i })` on the edit page. That button is gone, and the edit page now lists only the strategy's own key, so the test fails whenever the lane runs it.

`api-key-flow.spec.ts:252` matches `/Resync|Use & Sync/`. It passes only if the target key is the current one, so check its fixture.

**Fix:** Replace the test with one that asserts `Change key…` opens the picker and that a pick opens the confirm dialog without a write.

### WR-05: The rename dialog's hint states the OLD name as what the factsheet shows, while the manager types the new one (MEDIUM, user-facing)

**File:** `src/components/strategy/StrategyNameBlock.tsx:47-49, 96-101`; `src/components/strategy/RenameStrategyDialog.tsx:222`

**Issue:** `publicNote={factsheetLine}` passes "A shared factsheet link shows <current name>." That sentence is rendered as the hint under the input where the new name is typed. The prop's own doc says it is "what the public sees under the new name".

After saving, the factsheet title is the new name, so the hint misstates the result of the very action it sits beside. D-11 requires the rename place to say what the public sees.

**Fix:** Pass a sentence that does not interpolate the current name. For example: "The name you save becomes the factsheet title; discovery shows <preview.discovery> to other viewers." Or render the typed value live.

### WR-06: The manager-only Delete can send `p_cascade_holdings: true`, which also deletes derived allocator history (MEDIUM, data-integrity)

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:1096-1101, 2030-2032, 2165-2180`

**Issue:** The brief's contract is that the manager-role Delete uses `p_cascade_holdings:false`. It does when `deleteHoldingsCount === 0`. When a manager-only user's key has holdings (left from an earlier allocator or `both` role), `managerNeedsCascade` keeps `Delete key` disabled until the cascade box is ticked. `handleDeleteKey` then sends `p_cascade_holdings: true`.

In `delete_allocator_api_key` (migration `20261104120000`, Step 4), that flag also runs the last-key cascade over `allocator_equity_derived`. The box's copy names only "N historical holdings", so a manager would erase allocator book history the role cannot see.

**Fix:** For `managerOnly`, do not render the cascade box. When holdings exist, show a sentence that the key holds allocator data and must be removed under an allocator role. Or, if the founder decides managers may cascade, name the derived-history loss in the box copy. This needs a decision and must not be left implicit.

---

_Reviewed: 2026-11-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (round 1, MEDIUM+)

Full text: scratchpad p200-sfh-r1.md (session-local). Summary:

- **SFH-1 (MEDIUM, user-facing + data-integrity):** AllocatorExchangeManager.tsx ~1076-1080: a failed holdings-count read becomes 0 ("no holdings") and enables a manager's `Delete key`, and the read has no seq guard (a late answer for key A can land on key B).
- **SFH-2 (MEDIUM, user-facing + data-integrity):** AllocatorExchangeManager.tsx ~2160-2190: when feeds are "unchecked", the dialog only warns, so Delete and Disconnect stay enabled while it says it could not check what the key feeds.
- **SFH-3 (MEDIUM, user-facing):** AllocatorExchangeManager.tsx ~516-527 and ApiKeyManager.tsx ~373-380: a failed or 429 feeds read has no retry and stays until reload.
- **SFH-4 (MEDIUM, tests):** ApiKeyManager.test.tsx: STALE-ANSWER-DROPPED cannot fail, and the 9 `200-08-DEFERRED` skips remove coverage (overlaps WR-03).

## Round 1 dispositions (fixer round, topic-split A/B/C, merged --no-ff)

| ID | Disposition | Commit | Proof (neuter → RED) |
|---|---|---|---|
| CR-01 | FIXED | 146d8a737 | Resync writes no `api_key_id`; the confirmed write is conditional on the named current key (`.eq`/`.is(null)`), and zero rows gives a loud "changed since the page loaded" error with no sync. CR01-* tests go RED without either half |
| WR-01 | FIXED | 7a76a966d | remedy copy names `Change key…`; RED "Received Link a key with Use & Sync" |
| WR-02 | FIXED | a3fc46eab | managers get a role-correct intro; MANAGER-INTRO goes RED on the old text |
| WR-03 / SFH-4 | FIXED | cb0157cf0 | all 9 skips re-driven, 0 `it.skip` left; STALE-ANSWER-DROPPED goes RED with the seq guard neutered |
| WR-04 | FIXED (not run) | 093f04ee4 | e2e specs assert `Change key…` + confirm. Playwright was not run (disk rule); the specs are env-gated |
| WR-05 | FIXED | dd9ae8117 | hint no longer quotes the old name; RED on the new-hint assertion |
| WR-06 | FIXED (design default) | c6fa0e33e | manager Delete always sends cascade false; a 23503 refusal is surfaced; the `both` cascade copy names the derived history deletion; RED on the `allocator-cascade-derived-history` testid |
| SFH-1 | FIXED | 96fb7fc62 | a failed holdings read is unknown (Delete disabled) and seq-guarded; RED on the HOLDINGS-UNKNOWN / STALE tests |
| SFH-2 | FIXED (design default) | 2c14609be | Delete and Disconnect are held while feeds are "unchecked"; 4 tests RED |
| SFH-3 | FIXED | d60958e3b, 9d67bcb1f | Retry on a failed feeds/holdings read in both managers; RED with the handler neutered |

Gates after the merge: tsc 0; vitest over the 39 phase-touched test files is 1281 passed, 0 skipped; eslint 0.

## Round 2 findings

**Reviewed:** 2026-11-11, at HEAD `0d966376f` (branch `feat/200-managerkeys`). Read-only; no source file changed.
**Scope:** the 11 round-1 fix commits, the key risk re-checked across `git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning'`, and new problems the fixes may have caused. MEDIUM and above only.
**Gates re-run:** vitest over the six fix-touched files (`ApiKeyManager`, `ApiKeyManager.poll`, `AllocatorExchangeManager`, `AllocatorExchangeManager.feeds`, `ExchangesTabContent`, `StrategyNameBlock`) gave 324 passed, 0 skipped. Nothing was neutered, because the review is read-only. "Its test can fail" was argued from the code instead.

### Verdicts on the round-1 fixes

| ID | Verdict | Notes |
|---|---|---|
| CR-01 (146d8a737) | **Partly fixed**, see R2-01 | The 0-row guard is sound. `.select("id")` plus `linkedRows?.length !== 1` throws on an RLS-filtered row, on a stale condition, and on `data: null`, so a 0-row update can never report success. The mock models the server row, so the CR01-* tests can fail. Gap: the panel Retry. |
| WR-01 (7a76a966d) | Fixed | Both sentences name `Change key…` and the `API keys` tab, which is the label `ProfileTabs` uses. |
| WR-02 (a3fc46eab) | Fixed | |
| WR-03 / SFH-4 (cb0157cf0) | Fixed | 0 `it.skip` left. DROPPED-READ-SUBJECT and IN-FLIGHT-UNTOUCHED now assert the pill, not the button. Each still separates the two outcomes: a released marker shows `sign_in_failed`, a held one shows `syncing`, and an applied healthy row renders no pill at all. |
| WR-04 (093f04ee4) | **Incomplete**, see R2-02 | |
| WR-05 (dd9ae8117) | Fixed | |
| WR-06 (c6fa0e33e) | Fixed | Measured: `allocator_holdings_api_key_id_fkey` is `ON DELETE RESTRICT` (baseline), and the RPC's Step 2 and Step 4 run only on `p_cascade_holdings`. So a manager's delete with `false` on a key that has holdings raises 23503 and rolls back. Not reported: on a manager key that has holdings, `Delete key` stays enabled beside "cannot be deleted". That state needs a pre-role-lock account, since `prevent_profile_role_change` blocks a role switch, and the database refuses the delete. |
| SFH-1 (96fb7fc62) | Fixed | Seq-guarded: Cancel and a reopen bump `holdingsSeqRef`. |
| SFH-2 (2c14609be) | Fixed as written; **decision conflict**, see R2-03 | |
| SFH-3 (d60958e3b, 9d67bcb1f) | Fixed | No loop or race. A Retry sets the read to `loading`/`checking`, so the button unmounts until the answer lands, and every answer is seq-guarded. A rate-limited Retry stays could-not-check only until the 60 s window passes. Not locked forever. |

### R2-01: The panel's Retry re-points the strategy's key with no confirm once the page has refreshed (HIGH, data-integrity)

**File:** `src/components/strategy/ApiKeyManager.tsx:1644` (Retry target), `:893-897` (the condition reads the live `currentKeyId` prop), `src/components/strategy/RenameStrategyDialog.tsx:211` (`router.refresh()` on the same page)

**Issue:** `SyncProgress` renders Retry on every `error` (`SyncProgress.tsx:658-667`). Retry calls `handleSyncTrades(lastAttemptedKeyId)`. `handleLinkKey` then decides whether to write, and what to condition the write on, from the `currentKeyId` prop at click time. It does not use the key the attempt was started or confirmed against. The prop changes on any `router.refresh()` while the component stays mounted. `RenameStrategyDialog` refreshes on every successful rename, and so do `handleSyncTrades` itself and the terminal arm. The panel's `syncStatus`, `lastAttemptedKeyId` and Retry survive that refresh.

**How it breaks (Resync, no dialog at any point):**
1. On tab A, Resync on K1 runs and its computation fails. The error panel shows Retry, and `lastAttemptedKeyId` is K1.
2. On tab B, or in the wizard, the key is changed to K3 with the confirm.
3. On tab A, the manager renames the strategy. `router.refresh()` changes the prop to `currentKeyId = K3`, and the card now lists K3.
4. On tab A, the manager presses Retry. `handleLinkKey(K1)` sees `K1 !== K3` and writes `api_key_id = K1` with `.eq("api_key_id", K3)`. That condition matches, so the strategy is silently re-pointed back to K1.

The read-back cannot catch this, because it reads back K1, which this attempt just wrote. The same happens after a confirmed change that failed on the 0-row guard (CR01-CONFIRM-ON-STALE-PAGE): after a refresh, Retry writes K2 over K3, a key no dialog named. No test drives Retry after a refresh.

**Fix (minimal):** carry the expected current key with the attempt, and condition the write on it, never on the live prop:
```ts
// handleSyncTrades(keyId, expectedCurrent): Resync passes (key.id, key.id); the dialog's onConfirm
// passes (pendingKeyId, currentKeyId captured when the dialog opened). Store the pair with
// lastAttemptedKeyId; Retry replays the same pair.
// handleLinkKey(keyId, expectedCurrent):
if (keyId === expectedCurrent) return;           // a Resync, or a Retry of one, never writes
const q = supabase.from("strategies").update({ api_key_id: keyId }).eq("id", strategyId);
const { data, error } = await (expectedCurrent === null ? q.is("api_key_id", null) : q.eq("api_key_id", expectedCurrent)).select("id");
```
Add a test: Resync fails, a rerender with another `currentKeyId` follows, then Retry. It must assert `strategiesUpdateMock` was not called and the mocked row is unchanged.

### R2-02: WR-04 is only partly fixed: `e2e/api-key-flow.spec.ts` still drives the removed edit-page controls (MEDIUM, test reliability)

**File:** `e2e/api-key-flow.spec.ts:119-209`, `:230-254`, `:257-268`, `:272-290`

**Issue:** D-07 removed `Add Key`, `Delete`, the `Delete API Key` modal and the "No API keys connected" empty state from `/strategies/[id]/edit`. The edit page now says `No key is linked to this strategy yet.` and similar. The fix changed one line (`:252`). That line sits in a test whose first action is `getByRole("button", { name: /Add Key/i }).click()` (`:233`), so the changed line can never be reached. Every test in "Edit page — API key form rendering" and "Key submission and connected keys list" fails as soon as its env gate (`PLAYWRIGHT_TEST_STRATEGY_ID`, or the exchange credentials) is set.

**Fix:** delete these edit-page tests, or move them to the Profile API keys tab (`/profile?tab=exchanges`), where add and delete now live. Keep only an edit-page test that asserts the panel heading and the "Add or remove keys" Profile link.

### R2-03: SFH-2 now blocks a reversible Disconnect on a warning-only read, and reverses a recorded "warn, never block" with no CONTEXT/ROADMAP record (MEDIUM, user-facing)

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:2073-2074` (`feedsUnknownOrOpen` gates both buttons), `:1094` (comment still says "a failure warns, never blocks")

**Issue:**
- 200-07 shipped the could-not-check state as "warn, never block", citing 167.2.1 D-10, the founder's 2026-09-24 decision. The fixer reversed it as a "design default (founder cannot be asked)". The reversal is recorded only in this file's disposition table. Neither 200-CONTEXT.md nor the ROADMAP records it, which the deviation policy requires.
- The block now also holds an allocator's **Disconnect**. That action keeps the key and its holdings and offers Reconnect, so it is reversible, and the feeds read exists only to warn about it.
- The memberships route allows 5 reads per 60 s per user (`userActionLimiter`). Each confirm open and each Retry spends one. A few opens in a minute therefore leave both buttons disabled until the window passes, with only Cancel available. A persistent route failure (5xx, 404 on a key deleted elsewhere) holds them until a reload.

**Fix:** pick one and record it in 200-CONTEXT.md **and** the ROADMAP.
- Recommended: hold only the irreversible `Delete key` (and the cascade) on "unchecked", and restore warn-only for Disconnect.
- Alternatively, keep both held and record the reversal as a founder-revisitable default.

Either way, fix the stale comment at `:1094`.

### Key-risk re-check, whole diff

Measured:
- The browser writers of `strategies.api_key_id` left in the diff are `handleLinkKey` alone. `StrategyForm`'s `.update({ api_key_id })` was removed.
- `AllocatorExchangeManager`, the feeds and memberships routes, and the wizard preselect read only.
- Every path to `handleLinkKey` except the panel Retry passes the confirm: `Change key…` → option → `ConfirmKeyChangeDialog` → `onConfirm`. Resync writes nothing.

R2-01 is the one remaining path.

_Reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard, with the call chains into `SyncProgress`, `RenameStrategyDialog`, the RPC and the baseline FKs traced_

### Silent-failure hunter, round 2 (MEDIUM+)

- **SFH2-1 (MEDIUM, user-facing + data-integrity):** AllocatorExchangeManager.tsx ~1101-1118, 2123-2160: the delete-confirm Retry re-runs the holdings read without resetting `deleteHoldingsCount`, so a failed re-read leaves the stale count driving the UI (no could-not-check line; buttons enabled on stale data).
- **SFH2-2 (MEDIUM, user-facing):** AllocatorExchangeManager.tsx ~1141-1147: only the manager path maps 23503, so an owner's cascade=false Delete refused by 23503 shows a generic "Please try again" that can never succeed.

## Round 2 dispositions (fixer round, topic-split A/B, merged --no-ff)

| ID | Disposition | Commit | Proof (neuter → RED) |
|---|---|---|---|
| R2-01 | FIXED | 718a3aedf | the write is conditional on the attempt's stored expected key, never the live prop. A Resync replay writes nothing, and a landed change retries as a Resync. R2-01-RESYNC-RETRY-AFTER-REFRESH and R2-01-CONFIRMED-RETRY-AFTER-REFRESH go RED without the fix |
| R2-02 | FIXED (not run) | 418990e6f | api-key-flow.spec.ts matches the one-key panel, and the add/delete steps point at the AEM parity cases. Playwright not run (disk rule) |
| R2-03 | FIXED (design default, CONTEXT D-R1) | 257b0b99f | Disconnect warns only on an unchecked read; Delete key stays held. DISCONNECT-WARNS-ONLY and DELETE-HELD-ON-UNCHECKED go RED |
| SFH2-1 | FIXED | 3f4e1cd3d | Retry resets the holdings count to unknown before re-reading. HOLDINGS-RETRY-FAILS goes RED |
| SFH2-2 | FIXED | f03d8d15f | a 23503 refusal is mapped on every role's Delete path. The role-both test goes RED on the generic text |

Gates after the merge: tsc 0; vitest over the 39 phase-touched test files is 1288 passed, 0 skipped; eslint 0.

## Round 3 findings

**Reviewed:** 2026-11-11, at HEAD `486e9266c` (branch `feat/200-managerkeys`). This was a read-only review and no source file changed.
**Scope:**
- The five round-2 fix commits: `718a3aedf`, `418990e6f`, `257b0b99f`, `3f4e1cd3d` and `f03d8d15f`.
- The key-risk check over `git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning'`.

Only MEDIUM and above is reported.
**Gates re-run:** vitest over `ApiKeyManager.test.tsx`, `AllocatorExchangeManager.test.tsx` and `AllocatorExchangeManager.feeds.test.tsx` gave 284 passed, 0 skipped. Because the review is read-only, nothing was neutered. "Its test can fail" was argued from the code and the mocks.

### Verdicts on the round-2 fixes

| ID | Verdict | Notes |
|---|---|---|
| R2-01 (718a3aedf) | Fixed | **Write condition.** `handleLinkKey` now conditions on the attempt's `expectedCurrent`, never on the live prop. It has three callers, and each passes a pair the manager saw: Resync passes `(key.id, key.id)`, the confirm passes `(pendingKeyId, currentKeyId)` from the render that drew its label, and Retry passes the stored ref.<br>**When the ref moves.** It moves to `keyId` only inside the live attempt, after the link landed.<br>**Bound expiry.** On an expired link bound, Retry replays the original condition. A late landing then gives zero rows and a loud error, and nothing is written.<br>**Tests.** The mock models the server row, so RESYNC-RETRY-AFTER-REFRESH and CONFIRMED-RETRY-AFTER-REFRESH go RED on the round-1 code. LANDED-CHANGE-RETRIES-AS-RESYNC passes on the old code too. It pins only the post-link ref update, and it goes RED without that update. |
| R2-02 (418990e6f) | Fixed (not run) | The edit-page tests assert the panel heading, the Profile link `href`, and that `Add Key`, `Delete` and the empty state are absent. No removed control is driven. |
| R2-03 (257b0b99f) | **Regression**, see R3-01 | The count-0 `Delete key` is held as D-R1 says. Disconnect is now released, and that also releases the cascade, which is irreversible. |
| SFH2-1 (3f4e1cd3d) | Fixed | Retry sets the count to `null` before the re-read, and both buttons are disabled on `null`. **Can the test fail?** Yes. On the old code the count stays 0, so the `allocator-delete-holdings-unchecked` line never renders and the test goes RED. |
| SFH2-2 (f03d8d15f) | Fixed | Measured: `allocator_holdings_api_key_id_fkey` is the only `ON DELETE RESTRICT` FK on `api_keys` (baseline), so a 23503 always means holdings. The owner re-read brings back the box the message names. **Can the test fail?** Yes. On the old code the alert carries the generic text and the test goes RED. |

### R3-01: With the cascade box ticked, Disconnect runs the irreversible cascade delete while the feeds read is unchecked (MEDIUM, data-integrity)

**File:**
- `src/components/exchanges/AllocatorExchangeManager.tsx:2256`: the Disconnect `disabled` checks only `feedsOpen`.
- `:1143`: `cascadeHoldings || hardDelete` sends the delete RPC.
- `:2183`: the cascade box.

**Issue:**
- `257b0b99f` released `Disconnect` on `deleteFeeds.state === "unchecked"`, on the premise that Disconnect is reversible. That premise holds only while the cascade box is unticked.
- For role `allocator` or `both`, on a key with holdings > 0, ticking the box sets `cascadeHoldings`. `Disconnect` then calls `handleDeleteKey(id, false)`, which takes the `cascadeHoldings || hardDelete` branch and sends `delete_allocator_api_key` with `p_cascade_holdings: true`.
- That call hard-deletes the `api_keys` row, its holdings, its `csv_daily_returns` and its `strategy_keys` memberships. On the last key it also deletes `allocator_equity_derived`.
- So the most destructive action on the tab now runs when the dialog has just said "Could not check which strategies this key feeds."

**What the rules say:**
- D-R1 holds `Delete key` on an unchecked read "because a delete is irreversible".
- R2-03's recommended fix said to hold `Delete key` "(and the cascade)".
- The comment at `:2085-2087` says "a key is never deleted without knowing what it feeds".

**Why the tests miss it:** DELETE-HELD-ON-UNCHECKED drives only the count-0 `Delete key` button. DISCONNECT-WARNS-ONLY drives only the unticked soft disconnect. No test ticks the box on an unchecked read.

**Fix (minimal):** hold the button whenever it would cascade on an unchecked read, and pin that with a test. The test should cover role `allocator`, holdings 2, a memberships 500, the box ticked, then assert the button is disabled and that `delete_allocator_api_key` was not called.
```tsx
disabled={
  deleteLoading ||
  deleteHoldingsCount === null ||
  feedsOpen ||
  (cascadeHoldings && deleteFeeds?.state === "unchecked")
}
```

### Key-risk check, whole diff

**Re-pointing a strategy's key:** clean.
- `handleLinkKey` (`ApiKeyManager.tsx:906`) is the only browser writer of `strategies.api_key_id` in the diff.
- Resync and its Retry write nothing.
- The confirmed change, and a Retry of it, write only on the key the dialog named as current. Zero matched rows gives a loud error.
- The wizard steps, the feeds and memberships routes, and `AllocatorExchangeManager` only read.

**A Retry or replay writing against an expectation the manager did not see:** clean after R2-01, for the reasons in the table above.

**A manager's Delete cascading:** clean.
- The cascade box is not rendered for `managerOnly`, and `setCascadeHoldings` is set to true only from that box (`:2183`).
- So a manager's `Delete key` always sends `p_cascade_holdings: false`. A key with holdings is refused by the RESTRICT FK and gets the manager message.
- `AllocatorExchangeManager.tsx:1145` is the only caller of `delete_allocator_api_key` in `src`.

_Reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

### Silent-failure hunter, round 3

- **R3-1 (MEDIUM, data-integrity):** the same defect as R3-01 (Disconnect with the cascade box ticked on an unchecked read). Duplicate; disposition follows R3-01.

## Round 3 dispositions (the review cap of 3 is reached)

| ID | Disposition | Commit | Proof |
|---|---|---|---|
| R3-01 / R3-1 | FIXED | 1fb1bc033 | Disconnect is held when the cascade box is ticked on an unchecked feeds read (D-R1); unticked it keeps R2-03's warn-only behaviour. The orchestrator re-neutered the clause to `false`: R3-01 CASCADE-DISCONNECT-HELD-ON-UNCHECKED went RED ("Received element is not disabled", 1 failed / 26 passed); restored by `cp`, `cmp` OK |

Both R3 reviewers converged on this one minimal, agreed fix, which an R2 fix had introduced. It was applied after round 3 and verified by the orchestrator's own neuter→RED→restore plus the gates below. No fourth review round was run, because 3 is the cap. All three key-risk checks were clean in R3 (no re-point without confirm, no replay against an unseen expectation, no manager cascade).
Open MEDIUM+ survivors: none.
