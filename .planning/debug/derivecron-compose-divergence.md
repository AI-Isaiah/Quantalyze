---
status: awaiting_human_verify
trigger: "D-12: 1 of 8 derive_allocator_equity composes failed_final in the 2026-10-07 rehearsal with 'forward/backward self-check diverged at day-index 1024 of 1199 - a roll-loop-vs-identity code divergence'"
created: 2026-10-07
updated: 2026-10-07
---

## Current Focus

bug_class: Bohrbug (deterministic; reproduced 3/3 from PROD inputs)
hypothesis: CONFIRMED - the self-check is ill-conditioned, not the roll. It recomputes level t by a CUMULATIVE forward replay from the stored day-0 level, so a relative error of a few ulp in equity[0] is multiplied by eq0*prod(1+r)/eq_t, while the band is scaled to the CURRENT level eq_t only. After strong growth and a near-total withdrawal that amplification is ~1.8e7 and no arithmetic can stay inside the band.
next_action: caller decides; fix committed. Post-fix the allocator composes, but its curve is untrustworthy (one BLOCKING out_of_window_flows on the same key) - a separate, already-named condition

reasoning_checkpoint:
  hypothesis: "The refusal is a false positive of _assert_forward_agreement: the backward roll is accurate (per-step residual <= 1.5e-16 of the step's operands on all 1198 steps; 2.2e-13 relative to the exact rational roll at t=1024), but the cumulative forward replay amplifies equity[0]'s ~1.9e-15 representation error by eq0*prod(1+r)/eq_1024 = 1.84e7 after a dollar grew 14,668x and a 99.4% withdrawal on day-index 1024 left the level at ~0.6% of the prior day's, giving |fwd-eq| ~1e-5 against a band of 1.31e-6."
  confirming_evidence:
    - "An EXACT rational forward replay from the stored float equity[0] also misses at t=1024 by 1.07e-5 (8x the band): the miss is conditioning, not float rounding in either loop"
    - "Per-step identity residual |eq[t-1](1+r_t)+F_t-eq[t]| max relative 1.49e-16 over all steps; the roll and the identity agree day by day"
    - "Float forward replay error is ~2.2e-6 and flat for days 1015-1023 (band 5e-5 there); it crosses only on the day the level collapses and the band shrinks 37x"
  falsification_test: "If a per-step check under the unchanged band still refused this input, or if the exact-rational replay had agreed with the stored series, the hypothesis would be wrong."
  fix_rationale: "Check the invariant the docstring names (roll loop == inverse of the identity) step by step against the STORED previous level. A real roll-vs-identity code divergence (wrong day's factor, wrong flow sign/day) shows on the step where it happens; rounding from earlier steps is not re-amplified. The band constants and formula (1e-6 + 1e-9*|eq_t|) are untouched."
  blind_spots: "Only this allocator's inputs were replayed; the other 7 composed with the old check, which the per-step check is no looser than on a day without a large flow."
  candidate_causes:
    - "code: roll loop defect (eliminated - per-step residual at ulp level)"
    - "code: self-check formulation (CONFIRMED)"
    - "data: genuine input condition - near-total withdrawal after strong growth (real, but it is the TRIGGER, not a defect; levels stay positive, no NaN, no key join/leave)"
  and_gate: "yes - needs (a) a check that re-amplifies day-0 error AND (b) an input whose growth-of-a-dollar dwarfs eq_t/eq_0. Either alone is benign: 7 composes passed the same check."

## Symptoms

expected: every derive_allocator_equity compose in the rehearsal reaches done (or degrades honestly)
actual: 1 of 8 composes went failed_final (permanent) after one attempt, 31 s run; the other 7 were done
errors: "derive_allocator_equity: compose refused a structural input - allocator equity replay: forward/backward self-check diverged at day-index 1024 of 1199 - a roll-loop-vs-identity code divergence"
reproduction: plan 02 rehearsal, 2026-10-07 ~21:03Z, PROD
started: first observed in the rehearsal (first PROD run of the compose at this scale)

## Eliminated

- hypothesis: backward roll loop computes a wrong level (code defect in the roll)
  evidence: per-step residual max 1.49e-16 relative; stored level at t=1024 matches the exact rational backward roll to 2.2e-13 relative
  timestamp: 2026-10-07
- hypothesis: an input defect (NaN, zero/negative level, <=-100% day) at day-index 1024
  evidence: all returns finite (max |r| 1.64), every reconstructed level > 0, day 1024 r=+0.1%; it carries one withdrawal of ~99.4% of the prior level - a real, valid flow
  timestamp: 2026-10-07

## Evidence

- timestamp: 2026-10-07
  checked: analytics-service/services/allocator_equity_derive.py replay_key_equity / _assert_forward_agreement
  found: backward roll equity[t-1] = (equity[t] - F_t)/(1+r_t) from the terminal anchor; the self-check replays forward fwd = fwd*(1+r_t)+F_t from equity[0] and requires |fwd - equity[t]| <= 1e-6 + 1e-9*|equity[t]| at every t
  implication: the invariant is "the backward roll is the exact algebraic inverse of the forward recursion"; the check compares a 1024-step recomputation against the stored value with a near-machine-eps band

- timestamp: 2026-10-07
  checked: PROD compute_jobs (read only, marker-guarded) for kind=derive_allocator_equity failed_final since 2026-10-07 20:00Z
  found: exactly one job; its allocator has 11 keys, 7 with csv_daily_returns, 5 with key_inputs rows. Raw CSVs in ~/.cache (not tracked)
  implication: inputs are fully recoverable for a local replay
- timestamp: 2026-10-07
  checked: local replay_key_equity per key from the PROD rows, run 3 times
  found: 4 keys OK; one key (1188 return days + flow days = 1199 union days, 85 flow days) refuses with the exact PROD message at day-index 1024 of 1199, 3/3
  implication: deterministic, and reproducible at the per-key core without the job's stitching
- timestamp: 2026-10-07
  checked: diagnostics around t=1015..1024 and an exact Fraction forward replay
  found: float |fwd-eq| ~2.2e-6 steady, band ~5e-5 until t=1024 where a withdrawal of ~99.4% drops the level and the band to 1.31e-6; exact rational forward replay from stored eq[0] misses by 1.07e-5; growth of a dollar over days 0..1024 is 14,668x; amplification eq0*growth/eq_1024 = 1.84e7
  implication: the cumulative check fails under exact arithmetic - its formulation is ill-conditioned for this (valid) input

## Resolution

root_cause: "Code defect in the SELF-CHECK, not in the roll loop or the identity. _assert_forward_agreement recomputed each level by a cumulative forward replay from the stored day-0 level, whose rounding is amplified by equity_0*prod(1+r)/equity_t, against a band scaled to equity_t. A valid input (a dollar grew 14,668x with gains withdrawn, then a ~99.4% withdrawal on day-index 1024) drives that factor to 1.84e7, so the check refused a correct roll. Trigger: a genuine input condition; cause: the check's formulation (AND-gate: both needed)."
fix: "_assert_forward_agreement now checks the forward identity per step from the STORED previous level (fwd = vals[t-1]*(1+r_t)+F_t). Band constants and formula unchanged (1e-6 + 1e-9*|equity_t|)."
oracle_type: derived (exact rational forward construction of the true levels, fractions.Fraction - never read off the replay)
verification:
  - signal: regression test RED without fix, GREEN with fix
    result: "tests/test_allocator_equity_self_check.py 3 failed / 5 passed on the byte-backup of the unfixed module (each 'self-check diverged at day-index 1000 of 1100'); 8 passed after restoring the fixed module from its byte backup"
  - signal: teeth (the check still bites)
    result: "flow one day late, one day early, sign inverted, and one level off by 2x the band are all refused (4 cases), before and after the fix"
  - signal: PROD inputs replayed locally
    result: "the failing key now replays (1199 days); every level within 5.6e-5 of the band of an exact rational backward roll; the other 4 anchored keys unchanged (OK)"
  - signal: full analytics-service pytest
    result: "8223 passed, 90 skipped (pre-existing live-DB/env-gated files, none touched), 0 failed"
  guardrail_verdict: accepted
files_changed:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/tests/test_allocator_equity_self_check.py
post_fix_note: "That key carries out_of_window_flows=1 (a flow dated outside its return window; BLOCKING OUT_OF_WINDOW_FLOW), so after the fix the compose ends done with an untrustworthy curve rather than failed_final. That is existing, named behaviour, not this defect." 

## Follow-up 1: the out_of_window_flows=1 on the same key (2026-10-07)

status: decision_needed (no code changed)

### Which flow
- One DEPOSIT (positive sign), dated the UTC day immediately BEFORE the key's first return day (first return day 2023-06-28, last 2026-10-07; window has 10 interior missing days).
- Source: the key's `allocator_equity_derived` `key_inputs:<key>` row, `payload.flows` (written by the key-mode derive epilogue from the Deribit transaction-log crawl, `report.dated_external_flows`). Not a stored raw venue row.
- Size: 0.46 of the replayed level on that day. It is the key's earliest flow.

### Is the date real
- No stored raw venue record exists to check it against: `trades` / `funding_fees` hold 0 rows for this key (it is not linked to any strategy through `strategy_keys`), and no table stores the raw Deribit ledger. A venue-side check needs a live crawl (key decryption, exchange I/O), out of scope for a read-only pass.
- Indirect evidence that the date is real and correctly stamped: the deposit is the first ledger event, and the return on that day is undefined BY CONSTRUCTION. `chain_linked_twr` (nav_twr) breaks day 0 when the prior capital is 0 (`negative_nav_guard`), the row is not persisted, so `csv_daily_returns` starts the next day. The same 10 interior missing days are all flow days (flow-dominated guard), the same mechanism.
- It sits BEFORE the first return day (adjacent), not after the last, not in a gap.

### Is the window wrong, or the date mis-stamped
- Not a crawl bound: Deribit is `full_history=True` (txn-log reaches inception) and the native core's inception gate passed for this key.
- Not a timezone / settlement shift: interior flows line up with interior return days, and the population signature below is exactly "one day before" for every Deribit key.
- The window is "wrong" only in the sense that the compose infers it from persisted return rows, and the writer never persists the funding day's (undefined) return.

### Population (PROD, read only)
- Anchored keys with returns and flows: deribit 7/7 and mt5 7/7 have their FIRST flow before the first return day (deribit 7/7 exactly one day before; mt5 4/7 one day before, the rest a contiguous 2-day run). bybit 2 and okx 6 have no flows at all.
- So OUT_OF_WINDOW_FLOW (BLOCKING) fires on every flow-bearing key in PROD. In this allocator it fires on all 5 anchored keys, so the book cannot read ready even with this key removed.

### Independent check: does the curve reconcile to zero capital at inception
Capital before the first flow, implied by the replay = level(first union day) - that day's flow, as a share of the window day-0 level:
- the other 4 keys: -0.004, -0.000, -0.004, 0.000 (inception reconciles; the flag is a false positive there)
- THIS key: 0.551. Its replayed early history does not reconcile to zero at inception. Together with a growth-of-a-dollar of ~14,668x over days 0..1024 and a largest daily return of +164%, its early levels are suspect. So for this key the BLOCKING verdict is right, for a different reason than the flag names.

### Verdict
Not a simple code defect with one correct fix. The flag's positional rule ("a flow outside [first, last] return day") cannot tell the legitimate inception-funding shape (its own docstring calls it legitimate) from a genuinely suspect pre-window flow, and fires 14/14. Re-defining what blocks is a trust-semantics choice, so options go to the founder:
- A. Keep as is. Every flow-bearing deribit/mt5 book stays not ready.
- B. (recommended) For pre-window flows on a contiguous run ending the day before the first return day, replace the positional test with the inception invariant: implied pre-history capital within a band of 0 means benign; outside the band is BLOCKING under a name that says so (e.g. inception_unreconciled). Non-adjacent pre-window flows and post-window flows keep OUT_OF_WINDOW_FLOW. Only for full-history venues (deribit; mt5 if its deal history is confirmed to reach inception). On today's PROD data: 4 keys unblock, this key stays blocked, now for the right reason. The band is a materiality call (clean keys measure <= 0.4%).
- C. Writer-side provenance: persist the first-ledger day and the native inception-gate verdict in `key_inputs`; the compose takes its window start from it. Strongest provenance, more plumbing (derive epilogue + compose + payload shape).
Separately: this key's early history (0.551 inception residual, ~14,668x growth) needs its own investigation before any option makes its book ready.
