---
phase: 158-ops-ci-a-merge-means-a-deploy
reviewed: 2026-08-20T21:45:32Z
depth: standard
iteration: 4
review_type: final-convergence-re-review
files_reviewed: 7
files_reviewed_list:
  - .github/workflows/ci.yml
  - .github/workflows/main-ci-cancelled-watcher.yml
  - .github/workflows/analytics-deploy-verify.yml
  - .github/workflows/mutex-probe.yml
  - docs/runbooks/shared-test-db-mutex.md
  - scripts/drain-test-compute-backlog.ts
  - TODOS.md
prior_findings_verified: 7
prior_findings_correctly_fixed: 7
prior_findings_regressed: 0
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
status: clean
---

# Phase 158: Code Review Report (iteration 4 — final convergence)

**Reviewed:** 2026-08-20T21:45:32Z
**Depth:** standard
**Range:** `790345b4..c5be8a08` (7 fix commits) on `feat/v1.20-phase-158`
**Files Reviewed:** 7
**Status:** clean

## Summary

All seven iteration-3 findings (1 blocker + 6 warnings) are **correctly and
completely closed**, and the fix round introduced **no new defect at Critical or
Warning severity**. I re-derived each fix from the source at HEAD rather than from
the fix report, and executed four of them against stubs and a throwaway real
PostgreSQL 16 rather than reading them.

The three documented deviations are each defensible, and one of them I was able to
**measure** rather than accept: the two-`-c` form of the census (WR-01) does
persist `statement_timeout` into the next statement, does emit no extra line under
`-q`, and does abort a long query — see the measurement table below. The other two
(4800 s rather than 4500 s; count cross-check rather than `PAGE_SIZE` reduction)
are the stronger choice in each case and are not re-opened.

The residue is five Info observations. None is user-facing and none touches data
integrity, so under this repo's stopping rule none blocks. They are recorded so the
phase is not read as having zero loose ends.

## Gates I ran myself

| Gate | Command | Actual output |
| --- | --- | --- |
| **CR-01 credential gate** | `git grep -n -I -E 'matratzentester24\|demo-allocator@quantalyze\.test\|DemoAlpha2026' -- . ':!.planning/'` plus a separate `-w Test12` pass | **Exactly three hits, all in the sanctioned fixture**: `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:67,71,72`. `TODOS.md` no longer matches. Pair B (`demo-allocator@quantalyze.test` / `DemoAlpha2026!`) has **zero** tracked hits anywhere, including inside `.planning/`. |
| **Regression pins** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run src/__tests__/critical-regressions.test.ts --no-file-parallelism` | **1 file passed, 143 tests passed**, 667 ms |
| **Three-site byte identity** | Regex-extracted all three `start_holder() { … sections 2-3."` blocks from `ci.yml` and SHA-256'd them | **3 blocks found, 1 distinct hash**, 7974 bytes each (`c6332195f490…`) |
| **cap < TTL < sleep** | grep across all three DB jobs + runbook §2 | `3600` (cap, 6 sites) `<` `5400` (`timeout-minutes: 90`, 3 jobs) `<` `6000` (`pg_sleep`, 3 sites). Runbook §2's table states the same three numbers; `4800` appears in the runbook, the workflow comment and the workflow code. Every surviving `1800`/`2700`/`3300` is inside an explicit "the old value was…" comment. |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | **exit 0, zero lines of output** |
| Lint (drain script) | `npx eslint scripts/drain-test-compute-backlog.ts` | clean |
| Workflow lint | `actionlint` on all four workflows | **exit 0**, one `SC2129` style note at `main-ci-cancelled-watcher.yml:124` — **proved pre-existing** by re-running actionlint against `git show 790345b4~1:…`, which reports the identical finding at line 107 |
| Secret scan | `gitleaks git . --log-opts=790345b4~1..HEAD --config .gitleaks.toml` | 7 commits, **no leaks found** |
| Secret scan (allowlist-blind) | same range, **no `--config`** | 7 commits, **no leaks found** |
| Blast radius | `git diff --name-only 790345b4~1..HEAD` | **exactly the 7 in-scope files** — no collateral edits |
| No new job-graph edges | diff of `.github/workflows/` for `needs:` changes | **zero** added |
| No resurrected concurrency group | `grep -rn "group: shared-test-db" .github/workflows/` | zero hits (exit 1) |
| CI Node 22 | `grep -c "node-version: 22" .github/workflows/ci.yml` | 12, untouched |

## Executed verification (not read — run)

I extracted the **verbatim committed** acquire step out of `ci.yml` with a YAML
parser (8386 bytes, step name `Acquire shared-test-db mutex`) and ran it under
`bash` against a stub `psql`. Only the cap literal was scaled (3600 → 40) where the
branch boundary had to be reachable in seconds; that variant is noted per row.

| Path | Result |
| --- | --- |
| **Happy** (`psql` acquires) | `Acquired the shared-test-db advisory lock (key 61616158) after 5s (attempt 1/3).` **exit 0** |
| **WR-13 recovery** (die twice, acquire on 3rd) | `Acquired … after 30s (attempt 3/3).` **exit 0** in 30 s — the retry loop still works after WR-02's guard was inserted into its body |
| **WR-02 die-always** | Three `attempt n/3` warnings, backoffs printed after attempts **1 and 2 only**, then `::error::… after 3 attempts … CONNECT/session fault`. **No phantom "retrying" after the final attempt.** `waited` ended at 30 (not 45), so the session-fault branch was selected correctly. exit 1, 30 s |
| **WR-01 census, bounded** (cap scaled to 40) | Step returned at **60 s total** = 40 s cap + **exactly 20 s** of census, printing `Lock census: unavailable`. The `${census:-unavailable}` fallback keeps the message honest |
| **WR-01 census, NEUTERED** (`timeout 20` removed, nothing else changed) | **Ran unbounded** — my harness killed it at 120 s (`exit 124`). The bound is real and the check is falsifiable |
| **WR-08 redaction, still intact** | The stub emitted the two real psql shapes; the step printed `server at "***", port 5432 failed` and `for user "***"`. Host, IP and DB username all gone |

### WR-01's documented deviation, measured against a real PostgreSQL 16

The fixer used two `-c` flags rather than the review's single multi-statement `-c`.
I stood up a throwaway `initdb` cluster on port 55432 and measured all three
properties that deviation depends on:

| Claim | Measured |
| --- | --- |
| `SET` in one `-c` persists into the next `-c` | `-c "SET statement_timeout='10s';" -c "SHOW statement_timeout;"` → **`10s`** |
| `-q` suppresses the `SET` command tag, so the census is one line | `od -c` of the output shows exactly `1 0 s \n` — no `SET` line. The real census query returned the single line `0 granted, 0 waiting` under `tail -1` |
| The server-side timeout actually aborts the following statement | `-c "SET statement_timeout='2s';" -c "SELECT pg_sleep(30);"` → `ERROR: canceling statement due to statement timeout` in **2.03 s** |

The deviation is correct, and `tail -1` is correct rather than merely harmless.

## Prior findings — verification ledger

| ID | Verdict | How I verified it |
| --- | --- | --- |
| **CR-01** (TODOS re-published both pairs) | **fixed, complete** | Repo-wide grep at HEAD: the only tracked hits outside `.planning/` are the three sanctioned lines in `e2e-match-queue-no-vacuous-admin-gate.test.ts`. The rewritten entry names the accounts by **role** and by the **commits** that hold the values (`11041327`, `65e1cc52`) — no email, no password, nothing grep-able. The fixer also caught a **third** occurrence the prior review's grep line did not display (pair A named in prose in the "Still open" clause); without that, the repo-wide gate would still be red. Both gitleaks passes (with and without the repo config) are clean over the fix range. |
| **WR-01** (unbounded census) | **fixed, measured** | Two independent bounds at all three byte-identical sites. Bounded: returns at 20 s. Neutered: unbounded. `head -1` → `tail -1` validated against a real server. |
| **WR-02** (phantom retry after final attempt) | **fixed, measured** | `if [ "${attempt}" -lt 3 ]` guard. Die-always path now ends `waited=30`, not 45, so the cap-vs-session-fault branch is selected on the true wait. The happy and die-twice-then-acquire paths still exit 0 — the guard did not break the retry it sits inside. |
| **WR-03** (watcher had no `timeout-minutes`) | **fixed as scoped** | `timeout-minutes: 10` on `report-cancelled`, and the ornamental `actions/checkout` is now `continue-on-error: true`. I confirmed nothing downstream reads the working tree (the remaining steps are one `run:` writing `$GITHUB_OUTPUT`, two `github-script` actions the runner fetches independently of the checkout, and an `echo`). I also re-read the C-0293 block-walk: it collects indented non-`-` lines after the `uses:` line, so `continue-on-error: true` sitting between `uses:` and `with:` does **not** make the guard vacuous — and 143/143 still pass. Residual red route noted as IN-02. |
| **WR-04** (stale 1800 s window) | **fixed, and the deviation is right** | 4800 s, with the derivation written into the workflow **and** mirrored into runbook §2 as an explicit ⛔ "a fourth number depends on these three, in another file". The fixer's 4800-not-4500 argument checks out arithmetically: the runbook's own chain is `~2 + 60 + ~12 ≈ 74` min plus Railway's ~3 min ≈ 77 min, and 4500 s = 75 min sits **below** that. The forced companion change (`timeout-minutes: 90` on `verify`) is necessary and correctly sized: worst case is checkout + one loop iteration overshooting the deadline by ~75 s ≈ 81.5 min, comfortably inside 90. |
| **WR-05** (allowlist could still fail open) | **fixed, and the deviation is right** | Both arms of the `liveAllowlistIds` loop now take an exact `head: true` count with the **same** filters (`.eq(column, value).not("api_key_id","is",null)`) and `die()` on disagreement — structurally identical to the check `flipEligibility` already carried, including its `count !== null` guard. `count=exact` reads PostgREST's `Content-Range` total, which is *not* capped by `max-rows`, so the cross-check genuinely detects the truncation `rows.length < PAGE_SIZE` cannot distinguish. Choosing detection over a smaller `PAGE_SIZE` is the stronger call for a guard whose failure mode is silent. `die` (exit 1) matches the nearest sibling rather than `refuse` (exit 3); `tsc` and `eslint` clean. |
| **WR-06** (two contradictory probe comments) | **fixed** | The cost note now separates *safe to dispatch* from *certain to pass*, states the `timeout-minutes: 15` vs ~20 min hold conflict explicitly, and warns off the tempting wrong fix. The same warning was added to runbook §5 **at the point of use**, which is what an operator running the drill actually reads. The change to `mutex-probe.yml` is comment-only — the CR-01 ref gates (`startsWith(github.ref, 'refs/heads/ci-probe/')` on both real jobs, ANDed into `assert-serialization`'s `always()`) and all three job timeouts (5/15/10) are untouched. |

## Narrative Findings (AI reviewer)

### Critical Issues

None.

### Warnings

None.

### Info

Non-blocking under the repo's stopping rule (nothing user-facing, nothing touching
data integrity). Recorded rather than fixed.

#### IN-01: widening the convergence window 1800 → 4800 s also widens two pre-existing false-alarm routes and stretches time-to-signal

**File:** `.github/workflows/analytics-deploy-verify.yml:111` (and `:49-51`)
**Issue:** `MAIN_SHA` is captured once at run start, and the probe now polls
against it for up to 80 minutes instead of 30. Three second-order effects follow,
none of them introduced by this fix but all of them ~2.7× larger:

1. If any merge lands on `main` during the poll, Railway deploys the **newer**
   commit and prod never displays `MAIN_SHA` — a false P1 for a healthy deploy.
   This is the exact race the header cites as its reason for dropping the `push`
   trigger, so the shape is already recognised in-file.
2. Worst-case time-to-signal on a genuinely skipped deploy moves from ~6 h 30 to
   ~7 h 20. The comment's "detection latency is bounded by the 6 h schedule
   regardless" bounds probe *start*, not signal.
3. `concurrency: cancel-in-progress: false` means the manual dispatch the header
   advertises for "an immediate check" after an analytics merge can now queue up to
   ~80 min behind a scheduled run.

The trade is defensible — a false P1 is louder and worse than 50 extra minutes of
latency — and it is the direct consequence of CR-04's cap increase, not of this
fix. Recording it so the next person to touch the cap sees all four consequences.
**Fix (if taken):** re-read main HEAD inside the loop and treat "prod is on a
**descendant** of `MAIN_SHA`" as converged, rather than pinning a single SHA for
80 minutes.

#### IN-02: `timeout-minutes: 10` bounds the watcher's red-main-HEAD route; it does not eliminate it

**File:** `.github/workflows/main-ci-cancelled-watcher.yml:85-94`
**Issue:** A job killed by `timeout-minutes` concludes **failure** — which is
itself the red main-HEAD check the header forbids, now arriving at 10 minutes
instead of 360. The comment's framing ("without an explicit bound … would redden
main HEAD six hours later") reads as though the bound closes the route when it
only shortens and cheapens it. The residual `github-script` download failure route
is likewise bounded, not closed — the fix report's own skipped-issues table says so
plainly, so this is a comment-precision point, not a concealed gap. Realistic
probability is negligible (two API calls, seconds of work), and the alternative
(job-level `continue-on-error`) has its own check-conclusion ambiguity, so the
change is a net improvement either way.
**Fix (if taken):** amend the comment to say the bound *caps the damage* rather
than removing the route.

#### IN-03: the fourth coupled number (4800 s) is enforced by prose only, while its three siblings carry pins

**Files:** `docs/runbooks/shared-test-db-mutex.md:99-109`,
`.github/workflows/analytics-deploy-verify.yml:111`
**Issue:** `critical-regressions.test.ts` pins `timeout-minutes: 90` on all three
DB jobs and pins the `pg_sleep > TTL` **relationship** — precisely because a
one-sided edit is invisible downstream. WR-04 was itself a one-sided edit that
survived a full phase. Its remedy is a ⛔ paragraph in the runbook and a comment in
the workflow, both of which the next editor may not read. This is the asymmetry
that produced the finding, closed by the same mechanism that failed.
**Fix (if taken):** a fourth pin asserting `analytics-deploy-verify.yml`'s
`deadline` addend exceeds `ci.yml`'s acquire cap, in the same relational style as
the existing `pg_sleep > TTL` pin.

#### IN-04: stale relative citation in the new probe comment

**File:** `.github/workflows/mutex-probe.yml:52`
**Issue:** "the CR-01 note twelve lines above" — the note is at line 30 and the
sentence is at line 52, i.e. 22 lines above. The fixer deliberately avoided adding
a line *number* that would go stale; the relative count went stale instead.
Explicitly non-blocking under the repo's stated bar (prose/citations/stale
integers).
**Fix (if taken):** cite the CR-01 note by name rather than by distance.

#### IN-05: the retry bound `3` is now literal in a fourth place per acquire block

**File:** `.github/workflows/ci.yml:1207`, `:1649`, `:2285`
**Issue:** `if [ "${attempt}" -lt 3 ]` duplicates the bound already spelled in
`for attempt in 1 2 3`, in the `attempt n/3` messages, and in "after 3 attempts".
Raising the retry count means editing four places in each of three byte-identical
blocks, and missing this one silently drops the last backoff. It matches the file's
existing convention (`3600` is likewise literal at several sites), so conformance
beats taste here; noted only because the block is replicated three times.

## Phase invariants re-checked at HEAD

| Invariant | Result |
| --- | --- |
| Three `ci.yml` acquire/census blocks byte-identical | ✅ 3 extracted, **1 distinct SHA-256**, 7974 bytes each |
| Mutex key `61616158` parity | ✅ one distinct value across `pg_advisory_lock` and `objid` sites |
| No `shared-test-db` concurrency group | ✅ zero hits |
| No new `needs:` edges | ✅ zero added in `790345b4~1..HEAD` |
| `cap < TTL < sleep`, workflows **and** runbook | ✅ `3600 < 5400 < 6000`; runbook §2 states the same three, plus the new fourth (`4800`) with its derivation |
| Watcher / probe can never red a main-HEAD check | ⚠️ **bounded, not eliminated** (IN-02) — every script path exits 0, the ref gates hold, the ornamental checkout is non-fatal, and both never-red workflows now carry explicit job timeouts; a job-timeout conclusion remains a theoretical red route |
| Every new check able to fail | ✅ WR-01's bound drilled RED by me (neutered → unbounded); WR-02's guard drilled by observing `waited=30` vs the neutered `45`; the C-0293 guard re-verified to still bite through `continue-on-error` |
| Repo PUBLIC — no new secrets | ✅ **CR-01 closed** — one tracked hit outside `.planning/`, the sanctioned anti-vacuity needle; both gitleaks passes clean |
| CI Node 22 | ✅ 12 declarations, untouched |
| Blast radius = the 7 in-scope files | ✅ exact |

## Known-open, tracked, deliberately not re-flagged

Per the orchestrator's scope: credential **rotation** (human action, `TODOS.md`),
iteration-1 WR-06's promotion of the two specs into a blocking lane (needs a
measured run), the `auth.users` teardown convention, and the `.planning/` sweep
owned by v1.20 SEC-02. The credential needle in
`src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` is exempt by design.

**Still not verified end-to-end, and cannot be from here:** the mutex sizing is
arithmetic plus simulation. Three genuinely simultaneous runs serializing and all
passing has not been observed. This phase's own CI run is the first real test —
watch it rather than assuming it.

---

_Reviewed: 2026-08-20T21:45:32Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — iteration 4, final convergence re-review of `790345b4..c5be8a08`_
