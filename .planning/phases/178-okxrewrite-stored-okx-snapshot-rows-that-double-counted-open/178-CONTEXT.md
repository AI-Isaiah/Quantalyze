# Phase 178 OKXREWRITE - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The stored OKX `allocator_equity_snapshots` rows that counted open profit twice are rebuilt inside the 90-day window through the product's forced-rebuild path, once the OKX ordering gate reads `ok`, so past OKX equity reads the same as the MARKSOURCE forward fix. Rows the product path cannot reach are kept and named with their counts.

Booked from MARKSOURCE 167.2.1.1.1.1 CONTEXT D-09. MARKSOURCE census 2026-10-27 (plan 10 SUMMARY): 248 suspect days over 3 accounts with snapshot history (census labels a1, a2, a5), 164 inside the 90-day window; a3 and a4 have `snapshot_days=0`.

</domain>

<decisions>
## Implementation Decisions

### Carried (locked, not re-asked)
- MARKSOURCE D-05 (founder 2026-10-27, "Also rewrite past rows"): the stored past rows are corrected through the product's own recompute path (the forced whole-account rebuild), measured read-only on PROD first, with a before/after census, writing nothing a later run cannot reproduce. An operator plan with its own PROD step.
- MARKSOURCE D-09 (founder 2026-10-27, "Measure gate first, then rewrite (Recommended)"): the rewrite waits on the OKX ordering gate; then the 90-day window is rebuilt. Rows older than the window and `allocator_holdings` history are kept and named.
- RESEARCH F1 / ROADMAP SC-3: rows no product path reaches (refresh rows older than the 90-day window, every `allocator_holdings` history row, any scenario-commit audit size) are kept and named under TODOS `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW`, never hand-corrected.
- ROADMAP SC-1: the Phase 173 reading (`okx-order: ok`, `readings=1 members_with_trades=1 violations=0 passes_ended_full=0 failure_class=none`, `173-03-SUMMARY.md`) is cited by run before any rewrite; any other reading stops the phase.
- ROADMAP SC-2: before/after census from `docs/runbooks/marksource-okx-census/` (counts only, marker query first).
- The procedure is `docs/runbooks/marksource-okx-history-correction.md` (on main): marker first in every session; pre-flight P0-P6 (P4 a write STOP); B'1 target choice by `suspect_days_in_window` above the post-deploy tail, never by predicted outcome; one forced job per account behind the `DO $guard$`; B'3c new-job proof; B'4 wait; B'5 classification rules 1-6 over the 15 `FORCED_REBUILD_REFUSAL_REASONS` tokens (7 re-enqueue once, 8 record-only); B'6 after-census and row diff with rows changed before the seam = 0 or STOP. Deribit counts as $0 in both writers.
- Phase 173 D-04 / SC-3 (founder 2026-10-28, "None now (Recommended)"): 173 enqueued no rebuild; a4 waits on 179, a6 on 180.
- ACCTREBUILD (founder 2026-10-23, "Accept as recorded (Recommended)"): accounts refused `account_key_not_working` keep their stored histories; a rebuild becomes possible once their Bybit key is reconnected. Narrowed by D-05 below.
- 172 tolerance (founder 2026-10-28, "Keep 0.05, re-decide later (Recommended)"): re-decided by Phase 179.
- Operator rules: live PROD steps, probes and Railway runs are orchestrator-only on the standing PROD authorization; no executor runs `supabase` with `--linked`; amounts and row sets stay in scratch and are deleted after use; tracked text is counts, tokens and a-labels only.

### D-01 Refused keys: measure first, then decide
Founder 2026-10-28, AskUserQuestion: "Measure first, then decide (Recommended)". Option text shown: "178 runs the runbook's read-only checks and the probe per account, then comes back to you with each account's predicted outcome before any write. No change to the rebuild."
Background: the 2026-10-28 deployed probe (`173-03-SUMMARY.md`) refused 4 of its 5 OKX-holding accounts at key selection with `account_key_not_working` (revoked Bybit key, `TODOS.md` ACCTREBUILD reading), and only one OKX account (probe a4, no stored rows) passed selection. Probe labels and census labels are ordered differently, so the mapping to census a1, a2, a5 is likely, not proven.

### D-02 Ordering gate: also read each target
Founder 2026-10-28, AskUserQuestion: "Also read each target (Recommended)". Option text shown: "Cite 173's OK as the success criterion says, and also require each target's own ordering reading from the probe before its write."

### D-03 Wait for Phase 179
Founder 2026-10-28, AskUserQuestion: "Wait for 179 (Recommended)". Option text shown: "No target writes until 179's post-deploy re-read and your tolerance decision are done."

### D-04 Ownership and timing
Founder 2026-10-28, AskUserQuestion: "178 owns it, after plan 08 (Recommended)". Option text shown: "MARKSOURCE plan 14 closes as 'follow-up phase: 178'; 178 runs the runbook rewrite. First PROD write only after plan 08's cut-over (tonight 02:22Z) and its first night, after every working OKX key has been polled, never in the 00:00–02:15Z hold."

### D-05 A revoked key affects only that key
Founder 2026-10-28, verbatim: "If a bybit Ley is Revoked, then that is only relevant for that Key. It is Not relevant for OKX and its keys, neither for other bybit keys"
The rebuild's whole-account refusal `account_key_not_working` (`_select_account_crawl_keys` in `analytics-service/services/equity_reconstruction.py`, ACCTREBUILD's "a stored total cannot be split per key") is a defect. It supersedes D-01's premise that the targets are refused, and narrows ACCTREBUILD's 2026-10-23 "Accept as recorded (Recommended)" for `account_key_not_working`. 178 fixes it at the root, in every place where one non-working key refuses or blocks an account (rebuild key selection, the probe's selection, any similar gate), as an autonomous code plan ahead of the operator plans, with a test that goes RED on the current whole-account refusal. D-01's measure-first still holds for the PROD rewrite; the measurement runs on the fixed path. Open until research answers it: what a revoked key contributes inside the rebuilt window (its history cannot be read); if the code does not answer it consistently with what the refresh wrote, it goes back to the founder.

### D-07 A tied crosswalk fingerprint: keep refusing, measure first
Founder 2026-10-29, AskUserQuestion: "Keep refusing; measure first (Recommended)". Option text shown: "Leave the safe rule; the plan 03 check shows whether ties actually occur. If they do, I come back with a way to tell them apart (e.g. a second fingerprint field) as a small follow-up before any write."
A label whose crosswalk fingerprint ties with another stays `recorded, not recomputed (crosswalk ambiguous)`; if plan 03 measures ties on the targets, a small follow-up that tells them apart comes back to the founder before any write.

### D-08 Phase 179 gate includes the 179-07 re-read
Founder 2026-10-29, AskUserQuestion: "Also the 179-07 re-read (Recommended)". Option text shown: "178 writes only after 179-07's reading is recorded and 179 is closed; it runs today, so little delay."
Plan 04's D-03 precondition also requires `179-07-SUMMARY.md` on main and Phase 179 closed. The WR-01 owner confirmation (no key hard-deleted inside the window) stays a founder item at the plan 03 checkpoint.

### Context note (accepted with the answers above)
The rebuild replaces the whole 90-day window per account, including MT5 legs (census a5 holds working MT5 and Deribit keys), so an account's in-window level can move by more than the OKX open profit. Record the size; do not judge it (runbook B'5 note).

### D-09 Close 178 record-only: no rewrite, nothing written to PROD
Founder 2026-10-29, AskUserQuestion at the D-01 checkpoint, after plan 03's probe, crosswalk and P7 readings: "Close 178, record only (Recommended)". Option text shown: "Record the measurement, name the in-window rows in the existing double-count TODOS entry, close 178 with zero rewrites. Nothing written to PROD."
Plan 178-04 (the guarded rebuild) is not run (`status: superseded` in its frontmatter; recorded in `178-03-SUMMARY.md`, no SUMMARY of its own); zero targets are writable and nothing is enqueued. SC-2's "rebuilt through the forced path" is replaced by this ruling and the phase reports SC-2 as not met by founder ruling, never as met. The in-window rows of census a1, a2 and a5 are kept as stored and named under TODOS `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW`. Measured basis (178-03-SUMMARY, counts only): each of the three has a dead key whose holdings overlap the 90-day window (34, 34 and 46 in-window days), so D-06 reads `not recomputed` for all three before the ruling.

### D-06 A dead key that overlaps the window: do not rebuild that account
Founder 2026-10-28, AskUserQuestion: "Don't rebuild that account (Recommended)". Option text shown: "Keep its stored window as is, name it as not recomputed; other accounts are rebuilt normally." The question framed it as: a read-only PROD check before any write decides whether any dead key overlaps the window for a1, a2, a5; if none overlaps, the skip is exact.
Background (RESEARCH Finding 1c): the daily refresh skips an exchange account with no eligible key and carries an error/sign_in_failed key for at most `CARRY_AGE_CAP_DAYS` (7), so a rebuild that skips a dead group matches the stored rows on every day after the dead key stopped counting. On days before that, inside the window, the stored row holds the dead key's balance, which the rebuild cannot read; those days would be understated by a whole account. D-06 rules that such an account is not rebuilt.

### Decision index (one line each, for the coverage gate; the sections above are the record)
- **D-01:** Refused keys: measure first, then decide; the founder sees each account's predicted outcome before any write.
- **D-02:** Cite 173's ordering gate and also require each target's own ordering reading from the probe before its write.
- **D-03:** No target writes until Phase 179's post-deploy re-read and the founder's tolerance decision are done.
- **D-04:** 178 owns the runbook rewrite; first PROD write only after MARKSOURCE plan 08's cut-over and first night, every working OKX key polled, never in the merge hold.
- **D-05:** A revoked key affects only that key; the whole-account refusal is fixed at the root in every place.
- **D-06:** An account whose dead key overlaps the window is not rebuilt; it is named as not recomputed.
- **D-07:** A tied crosswalk fingerprint keeps refusing; plan 03 measures whether ties occur, and a follow-up to tell them apart comes back before any write.
- **D-08:** 178 writes only after 179-07's re-read is recorded on main and Phase 179 is closed.
- **D-09:** Close 178 record-only: no rewrite, nothing written to PROD; plan 04 is not run; the in-window rows of a1, a2 and a5 are kept and named.

### Claude's Discretion
- Guard placement C1 (taken): the code skips a dead exchange account unconditionally (an account with no working key at all still refuses `account_key_not_working`); a new blocking runbook pre-flight P7, a read-only dead-key census, runs before any enqueue and decides per target "rebuild" or "not recomputed (D-06)"; B'5 checks the audit's excluded count against P7's prediction, and a mismatch is a STOP. Reason: smallest change, matches the founder's D-05 wording, and fits D-01's operator-measured model for three one-off target accounts; an in-code refusal (C2) would tie the product to the refresh's carry internals.
- A target with zero OKX trades inside the window gives no D-02 ordering reading, so that target is not written (recorded as not recomputed). Recommended rule, flagged to the founder at the plan 03 checkpoint.
- The runbook's refusal-token list moves from 15 to 16 tokens, adding `account_key_read_stalled`, with a parity pin against `FORCED_REBUILD_REFUSAL_REASONS`.
- D-03 as a precondition of the write plan: Phase 179's D-07 close fix is on the deployed worker SHA, and 179-05's tolerance decision is recorded.
- Orchestrator precondition for 178's SUMMARY (not 178's own work): MARKSOURCE plan 14 closes as option-b with `follow-up phase: 178` in a records PR on main.
- How the per-account probe reading and the runbook pre-flight are combined into one read-only operator pass, and whether any runbook or probe change is needed to carry a per-target ordering reading (D-02). Any such code change gets a test that can go RED.

</decisions>

<code_context>
## Evidence and starting points
- `analytics-service/services/equity_reconstruction.py`: `_select_account_crawl_keys` (refuses `account_key_not_working` when an exchange account has no working member), `_account_rebuild_window` (OKX forces the 90-day window), `FORCED_REBUILD_REFUSAL_REASONS`, `_ACCOUNT_ZERO_CONTRIBUTION_VENUES` (Deribit).
- `analytics-service/services/allocator_equity_derive.py`: `working_holder_predicate`, `account_groups`.
- `analytics-service/scripts/allocator_history_probe.py`: `_probe_account` (same selection and window as a forced rebuild), `okx_order_verdict`, `summarize`, `run` (labels by earliest active OKX/Bybit key, not the census order).
- `docs/runbooks/marksource-okx-history-correction.md` and `docs/runbooks/marksource-okx-census/` (census files, `okx-snapshot-rows.sql`).
- `docs/runbooks/marksource-legacy-chain-move-go-live.md` (plan 08's cut-over).
</code_context>

<canonical_refs>
## Canonical References
- MARKSOURCE CONTEXT D-05, D-09; plan 10 SUMMARY (census of record); plans 08 and 14 (on branch feat/167.2.1.1.1.1-marksource).
- `.planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-03-SUMMARY.md`, `173-VERIFICATION.md`.
- TODOS `167.2.1.1.2.1-OKX-ORDER-UNMEASURED` (CLOSED 2026-10-28), `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`, `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW`, `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`.
- ROADMAP Phase 179 OKXBILLSCHAIN.
</canonical_refs>

<deferred>
## Deferred Ideas
- Correcting rows beyond the 90-day window or `allocator_holdings` history (kept and named).
</deferred>
