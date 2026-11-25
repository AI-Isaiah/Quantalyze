# Phase 229 MT5DERIVE2 - round 1 silent-failure review (SFH)

Scope: `git diff e5759fa76..HEAD -- . ':!.planning'` (12 files under `analytics-service/`), plus the callers read for context. Read-only; nothing edited or committed. MEDIUM and above only.

Result: 2 findings, both MEDIUM, both at the compose seam (`run_derive_allocator_equity_job`). The money-math edits (`_judged_cohorts`, `chain_linked_twr` inception count, `_walk_cohorts`), the annotation carries, the closed-token writer, the counts-only logs and the whole-row `key_inputs` rewrite (so a token or stamp clears itself) held up. No empty catch, no swallowed exception, no id/day/amount in any new log line.

## SFH-229-01 - a withheld token blocks the book from keys that are not composed or can never re-derive

- Severity: MEDIUM. Confidence: 5/10.
- Where: `analytics-service/services/job_worker.py` the three `read_writer_basis_withheld` reads in the compose loop: departed-key branch (~17188), stitch-source branch (~17220), counted branch (~17245). The only removal is the no-history pop at ~17798.
- Silent outcome: any key row carrying `writer_basis_withheld` raises the blocking `key_inputs_mismatch` for the whole book (`bool(withheld_by_key)` at ~17908). That set is filled for keys the compose does not sum as a live input, and the token never clears for them:
  - a departed (revoked or disconnected) key still in `departed_end_by_key`. Nothing re-derives it, so its last row, token included, is frozen;
  - a shared-account stitch source (not counted, only lends days before the kept member's first day);
  - a counted key whose anchor is NULL by `dust` or `native_unpriced`, which the compose leaves out of the sum anyway.
- Why it matters: the founder's ruling ("Block it", CONTEXT) rests on "self-heals on the next derive once the missing close lands". That is true for a live key and false for a departed one, so a transient missing close at the moment of disconnect becomes a permanent blocked book with the generic reason and no action the allocator can take (the only exit is deleting the key). User-facing and data-integrity: a healthy book is withheld, indefinitely.
- Hidden errors this can mask: the real state (book is fine, one frozen key has a stale transient token) is indistinguishable from the real state the block is for (a live key composing on the wrong roll).
- Minimal fix: restrict the block to keys that actually feed the sum. In the departed and stitch-source branches do not add to `withheld_by_key`; count them into a non-blocking benign flag (same shape as `writer_basis_absent_stitched`) and log the count. If the founder wants departed keys blocked too, record that ruling and name the exit (delete the key) in the book's reason; do not leave it implicit. Also pop `withheld_by_key` for keys the compose omits as dust.

## SFH-229-02 - the returns-stamp refusal can be published and then not recomputed (enqueue dedups into the running compose)

- Severity: MEDIUM (lower end). Confidence: 4/10.
- Where: stamp read at `job_worker.py` ~17248 (`_compare_returns_stamp`), blocking at ~17908; writer side: returns upsert ~10675, `key_inputs` upsert in `_persist_key_inputs` ~10217, epilogue enqueue ~10236 (swallows a dedup collision as benign).
- Silent outcome: a derive writes `csv_daily_returns` first and `key_inputs` (with the new stamp) later, with no transaction. A compose that reads between the two (started by a sibling key's derive, common in the nightly fan-out) sees new returns against the old stamp and publishes `key_inputs_mismatch`. This derive's own epilogue then calls `enqueue_compute_job`, and the unique index `compute_jobs_one_inflight_per_kind_allocator` (`status IN ('pending','running','done_pending_children')`, migration `20260418194206`) dedups it into the RUNNING compose. Nothing is queued after the `key_inputs` row lands, so the false block stays until the next derive or refresh.
- Scope of the exposure: the stamp window is first to last stamped day, so the routine next-day append is ignored; the check only fires when an in-window stored return changed, i.e. a genuine correction landing during a concurrent compose. That is rare, which is why confidence is low. It is the same class as the existing transient `realized_terminal_day_mismatch`, but that one is bounded to the append day and this one is any changed day, and the written-down premise ("transient") ignores the running-job dedup.
- User impact: a book that is correct reads blocked with a reason that, once the derive has finished, is no longer true.
- Minimal fix: no new abstraction needed if the founder accepts the residual; record it as an accepted limit next to the "no stamp = counted" limit. If not accepted, the smallest change is for the compose to re-enqueue itself once (delayed, `p_run_at`) when `stamp_mismatch_days_by_key` is the only raised reason, so the retry runs after the in-flight job ends.

## Below threshold, recorded here only (not for fixing, per the LOW/Info rule)

- `returns_stamp` is absent on a post-229 row from the under-two-days key-mode exit when no marks applied (`_short_exit_stamp` is None, `job_worker.py` ~10303). The compose then logs it as "written before 229 HOLD-03" (~17866), which mislabels a post-229 row. Counts-only info line, no refusal change. LOW.
- `inception_day_pnl_dropped` is persisted (nav_twr -> transforms -> prestamp -> analytics_runner carry) but no `src/` reader consumes it yet (grep: only `analytics-service/`), unlike `flow_timing_day_level_large`. The phase's own wording ("carried as a bool to the strategy's flags") is met; surfacing it is a separate piece of work. Info.
- Founder-ruled behaviours I checked and did not flag: empty cohort 0 skipped on every day with a later P&L cohort (so a non-positive start-of-day NAV no longer raises `negative_nav_guard` on such a day; 188's tiny-base test still runs on `prev`), and the block on a timed MT5 key with no basis.
