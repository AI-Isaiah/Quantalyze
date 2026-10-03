---
status: resolved
trigger: "e2e-seeded flake on the runner-private local-stack lane (Phase 164.9.4)"
created: 2026-10-02
updated: 2026-10-02
---

# Debug: e2e-seeded first-attempt timeout on the local-stack lane

## Trigger (verbatim, data only)

DATA_START
e2e-seeded flake on the runner-private local-stack lane (Phase 164.9.4, branch feat/164.9.4-cioffmutex, worktree quantalyze-164.9.4). In CI run 37039941530 (head d69f43c6b, the only lane run of e2e-seeded), `e2e/full-flow.spec.ts:84:7` timed out after 60 s on its FIRST attempt waiting for `table tbody tr a` on `/browse/crypto-sma`, then passed on retry: 200 passed + 1 flaky + 11 skipped. Six main runs on shared TEST (37028872024, 37058017079, 37052118322, 37019085185, 37018979650, 37014526371) show 201 passed and no flaky line, and the merge-base main run 37028872024 has identical analytics-service/ and e2e/ trees. Hypotheses to test, not assume: cold first request on the fresh lane (Next server compile, PostgREST schema cache, first query planning), seed data for /browse/crypto-sma not yet visible when the spec starts (seed step ordering vs spec start, a materialized view or cache that the seed doesn't refresh), test ordering (this spec running first in its worker), or a lane-specific RLS/role difference. Read the job log of run 37039941530 (gh run view --log --job) for timings, the seed step and the Playwright trace/attachments if uploaded; compare with the main run's log. Find the ROOT CAUSE with evidence; then propose the fix (no test weakening: do not raise the timeout or add retries as the fix). Work only in the 164.9.4 worktree; never touch shared TEST or PROD; no pushes. Founder decision 2026-10-02: root-cause before ship.
DATA_END

## Symptoms

- expected: `e2e/full-flow.spec.ts:84:7` passes on its first attempt on the lane, as it does on shared TEST (201 passed, no flaky line, six main runs).
- actual: first attempt timed out after 60 s waiting for `table tbody tr a` on `/browse/crypto-sma`; passed on retry (run 37039941530, job e2e-seeded).
- errors: Playwright locator timeout (60 s).
- timeline: first and only lane run of e2e-seeded so far (Phase 164.9.4 moved the job off shared TEST onto `scripts/local-stack/run.sh up`).
- reproduction: unknown; one occurrence in one lane run.

## Constraints

- Work only in this worktree (branch feat/164.9.4-cioffmutex). Shell cwd resets elsewhere: prefix every command with `cd <this worktree> &&`.
- Never touch shared TEST or PROD. No pushes. The Supabase CLI in the main checkout is linked to PROD: no `db push`, `--linked`, `--db-url`.
- A local lane run is allowed (`bash scripts/local-stack/run.sh up` / `down` + `--assert-teardown`).
- The fix must not weaken the test (no longer timeout, no added retries).

## Current Focus

bug_class: Bohrbug in the data (deterministic final DOM state) exposed through a timing race in the test (Heisenbug-shaped symptom)
hypothesis: On the lane, crypto-sma holds ONLY is_example=true rows. /browse/[slug] SSRs StrategyTable with showExamples=true (all rows), then the anon prefs-mirror effect flips showExamples=false on mount, emptying the table. hasStrategyRow samples the SSR row (true), the row vanishes at hydration, getAttribute waits the whole 60 s.
next_action: none -- resolved, fix committed as 8e1e9c041 (e2e/full-flow.spec.ts only); session archived.
reasoning_checkpoint:
  hypothesis: "The full-flow:84 first-attempt timeout happens because the lane's crypto-sma category holds only example rows, which /browse SSRs and then hides on mount for anonymous visitors, while hasStrategyRow samples the pre-hydration paint once."
  confirming_evidence:
    - "CI call log: getAttribute waited 60 s and never resolved the locator after hasStrategyRow returned true"
    - "Local lane: SSR HTML has 8 factsheet anchors; settled DOM has 0 and the 'No strategies match your filters.' row (10/10)"
    - "CPU throttle 4x reproduces the exact hang 6/6; 1x gives vacuous pass 6/6; 8x/16x race through 6/6"
    - "Real spec x20 locally: 20/20 hasStrategyRow=false (vacuous)"
  falsification_test: "If a non-example published crypto-sma row existed on the lane when full-flow runs, or if the settled /browse DOM kept rows, the hypothesis would be false. Both measured not to hold."
  fix_rationale: "Any accepted fix must make the settled /browse state contain a navigable row the test owns or can rely on, AND make the test fail loud when it does not -- removing the race and the vacuous branch together."
  blind_spots: "Whether the CI retry was vacuous is inferred from the local measurement, not observed in CI (no trace uploaded). Whether shared TEST's pass was meaningful depends on TEST data I did not (and must not) query."
  candidate_causes:
    - "data: lane crypto-sma has only is_example rows"
    - "code: StrategyTable useState(true) + on-mount hide for anon"
    - "test: single isVisible sample + silent if(hasStrategies) branch"
    - "environment: runner CPU speed decides the band (fast/medium/slow); not a cause by itself"
  and_gate: "yes -- all three of data, code, test are required; remove any one and the flake disappears (non-example row present; SSR already filtered; or the test waits for the settled state)."

## Evidence

- timestamp: 2026-10-02
  checked: job log of run 37039941530, job 110947724476 (e2e-seeded), failure block
  found: "Error: locator.getAttribute: Test timeout of 60000ms exceeded. Call log: - waiting for locator('table tbody tr a').first()" at full-flow.spec.ts:91:36. The call log NEVER shows "locator resolved", so no row was attached at any point during getAttribute. getAttribute is only reached when hasStrategyRow() returned true, i.e. firstLink.isVisible() was true a moment earlier.
  implication: a row existed, then disappeared. Not a cold-start / slow SSR (that would time out in goto or return false from hasStrategyRow).

- timestamp: 2026-10-02
  checked: "Seed demo data into test Supabase" step of the same job
  found: "[seed] Resolved crypto-sma category_id=...; inserting 8 example strategies" -- the seeder inserts ONLY is_example=true rows; the baseline is schema-only (BASELINE.md: 0 data statements). No other step publishes a non-example crypto-sma row before full-flow (axe-app-wide's seedBridgeCandidate({crypto-sma}) row is torn down in a finally, per the ci.yml comment).
  implication: on the lane the crypto-sma category contains example rows only.

- timestamp: 2026-10-02
  checked: src/components/strategy/StrategyTable.tsx:390 + :472-481, src/lib/discovery-prefs.ts:25 + useDiscoveryPrefs, src/lib/storage/cross-tab.ts:263-264
  found: showExamples = useState(true) (SSR + first client render show ALL rows incl. examples). useDiscoveryPrefs(undefined, slug) on /browse runs useCrossTabStorage with enabled=false, so isHydrated starts TRUE; the mirror effect fires on mount and calls setShowExamples(!DEFAULTS.hide_examples) = false, filtering out every is_example row (:564-565). The empty state is a tbody tr with "No strategies match your filters." and no <a>.
  implication: for an anonymous visitor on a category holding only examples, the SSR HTML has rows that vanish at hydration. The settled state is EMPTY. discovery-hide-examples-default.spec.ts's own comment documents this exact first-paint-then-filter behaviour.

- timestamp: 2026-10-02
  checked: e2e/full-flow.spec.ts hasStrategyRow (lines 42-53)
  found: Promise.race resolves as soon as firstLink is visible (SSR paint, before hydration), then a single isVisible() sample decides the branch. Whether that sample (and the following getAttribute/textContent) lands before or after the hydration effect is pure timing. Before -> true -> row then vanishes -> 60 s hang (attempt 1). After -> "No strategies" visible -> false -> the test passes VACUOUSLY with zero assertions (likely attempt 2; or it wins the race fully and walks to an example factsheet).
  implication: on the lane this test cannot pass meaningfully except by winning a race; its retry "pass" is very probably vacuous. On shared TEST it is stable because accumulated non-example published crypto-sma rows survive the examples filter.

- timestamp: 2026-10-02
  checked: every e2e spec/helper that can publish a crypto-sma row (grep crypto-sma / seedBridgeCandidate / status published / category_id)
  found: only seedBridgeCandidate sets a category. Its seeded-list caller (axe-app-wide.spec.ts:218) deletes the row in a finally. discovery-watchlist (the other caller) is not in the seeded list. seedStrategyWithHistory sets no category. playwright.config: CI workers=1, retries=2, fullyParallel.
  implication: no surviving non-example crypto-sma row on the lane when full-flow runs. axe-app-wide's own comment states the intended invariant: "all 8 seeds are is_example=true; no other non-example published row exists".

- timestamp: 2026-10-02
  checked: LOCAL LANE RUN (run.sh up, seed-demo-data, next build with the lane env, next start; torn down with down + --assert-teardown -> 0 containers)
  found: (a) curl /browse/crypto-sma raw SSR HTML: 8 distinct /factsheet/ anchors (the 8 example seeds), 0 "No strategies match". (b) Playwright probe, 10 fresh contexts: after networkidle + 1.5 s, `table tbody tr a` count = 0 and the "No strategies match your filters." row = 1, every time.
  implication: MEASURED. SSR shows rows; settled hydrated state is empty. Hypothesis mechanism confirmed directly.

- timestamp: 2026-10-02
  checked: the real spec `full-flow.spec.ts` "factsheet page loads for published strategy", --repeat-each 20 --workers 1, with a SCRATCH uncommitted console.log of the hasStrategyRow branch (reverted after; git diff on e2e/ is empty)
  found: 20/20 passed, 20/20 `hasStrategyRow=false`.
  implication: MEASURED. On a fast host the test passes VACUOUSLY every time: zero assertions after the goto. The retry "pass" in CI was almost certainly this branch (inferred for CI itself; measured locally).

- timestamp: 2026-10-02
  checked: same hasStrategyRow logic in a probe with CDP CPU throttling, 6 fresh contexts per rate
  found: rate 1x: 6/6 sampled false (vacuous). rate 4x: 6/6 sampled TRUE, then getAttribute never resolved (8 s cap) -- the exact CI attempt-1 failure. rate 8x and 16x: 6/6 sampled true and getAttribute resolved (hydration not yet done), i.e. the test would race through to an EXAMPLE strategy's factsheet.
  implication: MEASURED REPRODUCTION. The outcome is a pure function of host speed vs. hydration: fast -> vacuous pass, medium -> 60 s hang (the CI flake), slow -> passes by winning the race. A slower first attempt on a cold CI runner landed in the medium band.

- timestamp: 2026-10-02
  checked: main run 37028872024 e2e-seeded log for "The destination stream closed early"
  found: 79 occurrences on main (shared TEST) vs ~similar volume on the lane.
  implication: not lane-specific; eliminated as a cause.

- timestamp: 2026-10-02
  checked: artifacts of run 37039941530
  found: no Playwright artifact uploaded (job concluded success); only vitest blobs, gitleaks sarif, nextjs-build.
  implication: no trace/screenshot available; evidence rests on call log + seed log + source.

- timestamp: 2026-10-02
  checked: option D applied to e2e/full-flow.spec.ts; local lane (run.sh up, seed-demo-data, npm run build with the lane env, npm run start); the real test "factsheet page loads for published strategy", CI=1, --retries 0, --workers 1, with a TEMPORARY probe (CDP Emulation.setCPUThrottlingRate + a console line after the last assertion), reverted from a scratch backup afterwards
  found: rate 1x --repeat-each 10: 10 passed, 10/10 probe lines. 4x x10: 10/10, 10/10. 8x x10: 10/10, 10/10 (~1.0 s each). 16x x10: 10/10, 10/10. 4x x30 (the old hang band): 30/30, 30/30. Every repetition reached the final identity assertion (row "Vega Volatility Harvester").
  implication: the race is gone at every measured speed band, and no repetition passes without executing the assertions.

- timestamp: 2026-10-02
  checked: negative probe -- same test with the untick skipped (Hide examples kept ticked, so no row is reachable)
  found: exit 1, 0 probe lines. "Error: no published strategy row on /browse/crypto-sma with Hide examples off ... expect(locator).toBeVisible() failed".
  implication: the test now fails loudly on an empty browse table. The vacuous branch is gone.

- timestamp: 2026-10-02
  checked: counter-probe -- settle wait (toBeChecked before the untick) removed, 10 repetitions each at 1x/4x/8x
  found: 30/30 still passed. page.goto waits for the load event, and on this host hydration had already committed by then.
  implication: the settle wait could not be shown to be necessary on this host. It is kept on reasoning: a Space pressed before the mount effect would be overwritten by setShowExamples(!hide_examples), leaving the box checked and the table empty. It costs nothing when hydration is already done. Not measured as load-bearing.

- timestamp: 2026-10-02
  checked: whole full-flow.spec.ts once unprobed on the lane; teardown
  found: 4 passed, 6 skipped (the skipped-by-design authed/admin describes). next start killed (port 3000 free); run.sh down; run.sh --assert-teardown: "surviving quantalyze containers -> 0"; docker ps: 0.
  implication: no regression in the spec's other tests; lane fully torn down.

## Eliminated

- hypothesis: cold first request (Next compile / PostgREST schema cache / query planning) made the page slow
  evidence: a slow page would time out in goto or make hasStrategyRow return false; instead hasStrategyRow returned true (row visible) and the row then vanished. `next start` serves a prebuilt bundle (Ready in 142 ms).
  timestamp: 2026-10-02
- hypothesis: seed data not yet visible when the spec starts
  evidence: seed step completed at 17:23:18, specs started 17:23:44; the row WAS visible (isVisible true). Rows present, then removed client-side.
  timestamp: 2026-10-02
- hypothesis: lane-specific RLS/role difference
  evidence: SSR (anon) returns all 8 rows on the lane; the removal is the client is_example filter, not a read failure.
  timestamp: 2026-10-02
- hypothesis: "destination stream closed early" SSR errors are lane-specific and caused the hang
  evidence: 79 occurrences in main run 37028872024 on shared TEST, where the test does not flake.
  timestamp: 2026-10-02

## Resolution

root_cause: AND-gate (three contributing conditions, all required): (1) DATA -- on the lane, crypto-sma holds ONLY is_example=true rows (seed-demo-data inserts 8 examples; baseline is schema-only; the one non-example crypto-sma seed is deleted in a finally). Shared TEST masked this with accumulated non-example rows. (2) CODE -- StrategyTable SSRs with showExamples=useState(true) (all rows), and for an anonymous /browse visitor useDiscoveryPrefs is enabled=false so isHydrated starts true and the mirror effect immediately sets showExamples=false on mount, removing every example row (a flash of example rows for real anonymous users too). (3) TEST -- hasStrategyRow resolves on the SSR paint and samples isVisible once; true then vanish = 60 s getAttribute hang; false = the `if (hasStrategies)` branch skips every assertion silently.
oracle_type: specified (the factsheet h1 must name the strategy whose browse row was followed), now reachable on the lane
fix: founder option D, in e2e/full-flow.spec.ts only. The test waits for the hydrated default (Hide examples checked, the settle signal discovery-hide-examples-default.spec.ts uses), unticks it with that spec's focus + Space idiom, waits for not-checked, then REQUIRES `table tbody tr a[href^="/factsheet/"]` to be visible and the href to carry an id. The `if (hasStrategies)` and `if (strategyId)` branches are gone, so an empty table fails. A WHY comment names the funnel the test protects. hasStrategyRow stays for its other caller (the skipped-by-design authed describe). No seed change, no product change, no timeout raise, no retries.
verification: |
  Local lane, real spec, CI=1, --retries 0, --workers 1, temporary CDP throttle + end-of-test probe line (reverted):
    1x  x10: 10 passed, 10/10 reached the last assertion
    4x  x10: 10 passed, 10/10
    8x  x10: 10 passed, 10/10
    16x x10: 10 passed, 10/10
    4x  x30: 30 passed, 30/30 (the band that hung 6/6 before the fix)
  Negative probe (Hide examples kept ticked): FAILS -- "no published strategy row on /browse/crypto-sma with Hide examples off".
  Settle-wait counter-probe: without it, 30/30 still passed on this host, so the wait is kept on reasoning, not on a measured failure.
  Whole spec unprobed: 4 passed, 6 skipped-by-design. tsc clean for the file; eslint clean.
  git diff after probes: only the intended fix. Commit 8e1e9c041 touches e2e/full-flow.spec.ts only.
  Teardown: next start killed, run.sh down, --assert-teardown -> 0 containers.
  Not verified: a CI run of e2e-seeded at the new head (no push in this session).
guardrail_verdict: accepted
files_changed: [e2e/full-flow.spec.ts]
prevention:
  why_not_caught: "no gate existed for this class. The test's own silent branch turned an empty table into a pass, and shared TEST's accumulated non-example rows hid the data dependency until the lane ran on seed data alone."
  recurrence_guard: "e2e/full-flow.spec.ts 'factsheet page loads for published strategy' now has no conditional around its assertions and fails on an empty browse table (negative probe measured). Follow-up already booked by the founder: option A, the StrategyTable example-row flash for anonymous visitors."

## Specialist Review

- 2026-10-02: specialist_hint=react maps to typescript-expert, but no Skill tool was available to the session manager, so the review was NOT run. Manager spot-check confirmed the cited code: StrategyTable.tsx useState(true) for showExamples, the prefsHydrated effect setting showExamples from hide_examples, and hasStrategyRow returning a single isVisible() sample.
- Fix NOT applied: every fix option (A product / B seed / C test-owned row / D untick Hide examples) is a founder decision.

## Founder Decision

- 2026-10-02 (via AskUserQuestion, data only):
  DATA_START
  Option D. e2e/full-flow.spec.ts unticks "Hide examples" on /browse/crypto-sma, waits for a row and fails loudly if there is none. Remove the silent `if (hasStrategies)` skip so an empty table fails the test. No seed change. No product change (option A, the StrategyTable flash, is booked separately as a follow-up). No timeout raise. No added retries.
  DATA_END
