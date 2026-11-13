---
phase: "202"
slug: "residchurn-the-value-churn-left-by-188-is-attributed-and-boo"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-06"
---

# Phase 202 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `202-RESEARCH.md` § Validation Architecture. This phase's deliverables are
> measurements and a written explanation; the checks that can fail are capture integrity,
> the cross-checks, the attribution sums and the b3 replay.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), plus stdlib Python check scripts in the untracked scratch directory `~/.cache/quantalyze/residchurn/bin/` |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_inception.py -x -q` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -q` plus mypy strict over `services/ routers/ models/` and the entry modules (only if analytics code changes, i.e. the contingency fires) |
| **Estimated runtime** | ~6 seconds (quick), scratch checks under 10 seconds each |

---

## Sampling Rate

- **After every task commit:** run the relevant scratch check, plus `git diff --name-only origin/main...HEAD -- analytics-service supabase/migrations` (empty unless the contingency fires)
- **After every plan wave:** all scratch checks green; planning-only ship rule holds
- **Before `/gsd-verify-work`:** attribution sums to 1214, b3 section committed with replay output, SUMMARY carries the marker answers and `gc-*`-style lines
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

Filled by the planner's task IDs; the requirement-level map from research:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| RESID-01 | c1 capture integrity: marker PRODUCTION before and inside the last query, PROD-side md5 equals local recompute, no pending/running derive job at c1 | scratch script | `python3 ~/.cache/quantalyze/residchurn/bin/check_capture.py c1` | ❌ W0 | ⬜ pending |
| RESID-01 | Float-text recipe: digests recomputed from `b1` rows equal `c0` digests | scratch script | `python3 ~/.cache/quantalyze/residchurn/bin/recompute_digest.py` (shown RED on a 1-ULP edit) | ❌ W0 | ⬜ pending |
| RESID-01 | Each of the 1214 values in exactly one cause bucket or listed unexplained by scope; sums hold | scratch script | `python3 ~/.cache/quantalyze/residchurn/bin/attribute.py b0 b1` (with `--neuter` self-test) | ❌ W0 | ⬜ pending |
| RESID-01 | No code-changing deploy in the window (D-04 as amended 2026-11-06): every API and worker deployment has empty `git diff --stat <c0-live>..<its commit> -- analytics-service supabase/migrations`; ledger count/max/md5 equal from pre to c1 (measured); c0 to pre inferred from zero `supabase-migrate.yml` runs and zero `supabase/migrations` commits on main (c0 recorded no ledger) | shell + MCP read | `git diff --stat <c0sha>..<csha> -- analytics-service supabase/migrations`; `git log --first-parent origin/main --since --until -- supabase/migrations` | n/a | ⬜ pending |
| RESID-02 | b3's flag and reasons reproduce from stored inputs on `b1` and `c1` rows | scratch script using the repo function | b3 replay script | ❌ W0 | ⬜ pending |
| RESID-02 | Pinned venue rule unchanged | pytest | `cd analytics-service && python3 -m pytest tests/test_allocator_equity_inception.py -x -q` | ✅ | ⬜ pending |
| RESID-02 (contingency) | RED-first test for a defect, only if `c1` contradicts the verdict | pytest | new test in `tests/test_allocator_equity_inception.py` | contingency | ⬜ pending |

### By task (planner, 2026-11-06; revised after the plan check the same day)

| Task ID | Requirement | Automated command (each paired with a `<fails_when>` in the plan) | Can fail on purpose | Status |
|---------|-------------|--------------------------------------------------------------------|---------------------|--------|
| 202-01-T1 (tracer) | RESID-01 | `recompute_digest.py --rows $GC/b1 --digests $RC/c0` (38/38, 16/16, 7/7, 30/30) and `--self-test` | 1-ULP flip | ⬜ pending |
| 202-01-T2 | RESID-01, RESID-02 | `shasum -c SHA256SUMS.d`, `gen_sql.py lint`, `gen_sql.py --self-test`; `gc-c-kit:` line | DELETE file | ⬜ pending |
| 202-01-T3 | RESID-01, RESID-02 | `check_capture.py --kind c0` (`checks=4/4`), `check_capture.py --self-test`; `gc-c-kit-gate:` line; the c1 coverage gate takes `--nightly-created` and `--nightly-after` as required arguments | edited h, TEST marker, pending job, edited line, original result without `checks.json`, `--kind c1` without the nightly arguments, `jobs_after` differing from `jobs` | ⬜ pending |
| 202-02-T1 | RESID-01 | `attribute.py --self-test`; `attribute.py --pair b01 ... --expect-summary 188-16` (1214, 62/966/186) | band boundaries, reverted value | ⬜ pending |
| 202-02-T2 | RESID-01 | `attribute.py --neuter ...`; bucket total `sum=1214` | perturbed stretch CV | ⬜ pending |
| 202-02-T3 | RESID-01 | `final_attribution.py --self-test`; `gc-c-final-rule` hash equal to the script on disk | each control downgrade, including (a) not recurring; short sum | ⬜ pending |
| 202-03-T1 | RESID-02 | `b3_replay.py --capture $GC/b1 --expect b1`; `--neuter` must exit 1; `gc-c-b3-stored` line | moved k15 flow | ⬜ pending |
| 202-03-T2 | RESID-02 | `pytest tests/test_allocator_equity_inception.py -x -q` (19 passed); verdict recomputed from component lines | verdict vs components | ⬜ pending |
| 202-04-T1 | RESID-01 | checkpoint (orchestrator MCP and Railway reads, with a late path to 00:35Z and a missed-window path); file presence and `window.txt`; no `pre/books.json` | n/a (manual) | ⬜ pending |
| 202-04-T2 | RESID-01 | `check_capture.py --kind pre`; `compare_prefix.py --self-test` (takes `--prefix-date` and `--base-file`); pre lines; `gc-c-pre-window: missed=no ... before_nightly=yes idle=yes ... wave_keys_books=none` | edited prefix line, edited b1 book value, a self-compare under `--base-file prefix`; a missed or late-past-00:35Z read, or a key or book derived from 00:10Z, cannot pass | ⬜ pending |
| 202-04-T3 | RESID-01 | `deploy_proof.py --self-test` (50594c750 nonempty, ba3c90128 empty); `gc-c-ledger-basis` with `inference` recomputed from the two counts | code-touching commit, missing hash, a non-zero ledger signal | ⬜ pending |
| 202-05-T1 | RESID-01 | derive and candidate lines (6 and 3) | n/a (read-only analysis) | ⬜ pending |
| 202-05-T2 | RESID-01 | `evidence.json` shape check; evidence re-run `sum=1214` | malformed evidence entry | ⬜ pending |
| 202-06-T1 | RESID-01, RESID-02 | checkpoint (orchestrator c1 reads); file presence | n/a (manual) | ⬜ pending |
| 202-06-T2 | RESID-01 | `check_capture.py --kind c1 --pre --nightly-created --nightly-after`; pair verdict recomputed from deploy, ledger, migrate-run, migration-commit and anchor lines; `ledger_c0_to_pre=inferred` on the pair line; on a void pair the retake is a re-plan on c0b/c1b with a stated input table and the row base `$RC/c0brows` | verdict vs components | ⬜ pending |
| 202-06-T3 | RESID-01, RESID-02 | prefix, books, predictions 1/4/5 (P5 from the chk-bound `books_prefix` lines), `moved.json`, `gen_sql.py lint` | n/a | ⬜ pending |
| 202-07-T1 | RESID-01, RESID-02 | checkpoint (orchestrator row reads); file presence | n/a (manual) | ⬜ pending |
| 202-07-T2 | RESID-01 | `check_capture.py --kind rows --c1`; `assemble_c1.py --self-test`; `final_attribution.py` hash equal to plan 02's and its `--self-test`; total sums to 1214 | wrong group, rule edited after c1, short sum | ⬜ pending |
| 202-07-T3 | RESID-02 | D-12 line and d13 value recomputed from the c1 verdict line (including `reason_absent`); report sections; `## Limits` names the inferred ledger half; leak greps | verdict vs D-12 line | ⬜ pending |
| 202-08-T1 | RESID-02 | contingency line consistent with plan 07 (`none` to `d13_applies`, `reason_absent` to `reason_absent`); `git status -- analytics-service` empty when not fired | fired vs re-opened | ⬜ pending |
| 202-08-T2 | RESID-02 | checkpoint:decision (founder), only when fired | n/a (manual) | ⬜ pending |
| 202-08-T3 | RESID-02 | when fired with a code option: pytest inception, mypy strict, `gc-c-fix` line; otherwise `analytics-service` unchanged and no `gc-c-fix` line | RED on today's code, neuter from byte backup | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `check_capture.py`, `recompute_digest.py`, `attribute.py` in `~/.cache/quantalyze/residchurn/bin/` (untracked), each shown RED on a deliberately broken input before it is trusted
- [ ] New SQL files only (existing `d_*.sql` stay byte-identical): prefix-digest variants (`date <= '2026-11-05'`), anchor, per-subject jobs, and PROD-side md5 checks for each (D-02)
- [ ] c0 deploy anchor and ledger state recorded in `c0/MANIFEST.md`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD reads (c1 digests, per-subject jobs, ledger, moved-scope rows) | RESID-01, RESID-02 | D-01: Supabase MCP, one read-only query per call, marker first; run by the orchestrator, not an executor | Orchestrator runs each query file through `mcp__claude_ai_Supabase__execute_sql`, saves the result, then the scratch check verifies it against the PROD-side md5 |
| Railway deployment lists for the API and worker services over the window | RESID-01 | external service read | List deployments, record each commit, run the content criterion above |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
