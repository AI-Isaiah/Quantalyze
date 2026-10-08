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

## Follow-up 2: the residual under the D-13/D-14 zero-start check (2026-10-08)

status: diagnosed. No code changed. The fix changes the D-13 invariant, so it is a product decision.

### Symptom (HEAD 2c1c2df9e, PROD rows read 2026-10-08, marker-guarded, read only)
- 4 Deribit keys imply pre-funding capital of -0.3555%, -0.3554%, -0.3555% and -0.3584% of the first-return-day level. They block as `inception_unreconciled` against the 1e-4 band.
- All 4 belong to ONE account. They share identical returns on common days and identical flows (one key's window ends 2 months earlier, so it lacks the 2 newest flows). Same first return day, same day-1 return.

### Root cause
The D-13 check reads "this day has no return row" as "this day had zero P&L". That is false for the days the TWR writer leaves out:
- **Funding day.** `chain_linked_twr` is given `prev0` near 0, so `negative_nav_guard` drops the day. The account's P&L on that day is still in NAV(d0). So `equity[d0] - F[d0] = pnl(d0)`, not the capital before the first flow.
- **Flow-dominated interior days** (`|F| >= FLOW_DOM_RATIO (1.0) x prev`). These are also dropped. The replay sets r = 0 there, so that day's P&L moves into every earlier level and ends up in the inception residual, divided by the growth in between.

What the check computes: `implied_start = pnl(d0) + sum over dropped interior days t of pnl(t) / G(d0 -> t-1)`.

What the native §5 gate checks: `B(d0) - pnl(d0) - flow(d0)`. It subtracts the funding day's P&L, which the compose cannot see. On Deribit (`full_history=True`) the writer has already proven a zero start under §5.

So the residual is a day's trading P&L. It is not missing capital.

### Evidence
- **Exact reproduction through the real writer and replay.** Build a synthetic ledger whose pre-history capital is EXACTLY 0. Give it P&L on the funding day and on one flow-dominated day, and run it through the real `chain_linked_twr` (prev0=0) and the real `replay_key_equity`.
  - The TWR drops the same two days PROD drops (`negative_nav_guard`, `flow_dominated_guard`).
  - The replay's implied start equals `pnl(d0) + pnl(t)/(1+r1)` to float precision (exact Fraction oracle).
  - The check returns `inception_unreconciled`.
  - Replayed levels after the dropped day equal the true NAV exactly. Levels before it are off by exactly `pnl(t)`.
- **The PROD account fits only this shape.** Its window has exactly two no-return days: the funding day, and one day 2 days later whose deposit is 2.34x the prior level (flow_dominated). Everything else is a return day.
  - To explain the residual alone, the funding day would need a P&L of -0.354% of the deposit. The dropped day would need -0.355% of its prior level, or -0.106% after its flow.
  - This account's mean |daily return| over its first 54 days is about 7.7% (sum |r| = 4.14). A -0.35% day is ordinary for it.
- **MT5 shows the funding-day half on its own.** One MT5 key has NO dropped interior day and a residual of +2.05%: a pure funding-day P&L or a broker credit. The 5 MT5 keys that reconcile to about 1e-14 have r = 0 on their early days, so they did not trade on the funding day.
- **Repeated values.** -0.3554/-0.3555% is one account seen through 3 keys whose anchors were read minutes apart. -0.3584% is the 4th key, whose anchor was read 81 days earlier. Same returns, same flows, different anchor.

### Candidates eliminated
| candidate | verdict | evidence |
|---|---|---|
| deposit/transfer fee not recorded | eliminated | The flow is the txn-log `change`, the balance delta actually credited, so a fee is already netted inside it. The residual is -0.3540% of the deposit, which matches no fee schedule. |
| deposit recorded net vs gross | eliminated | Same reason: `change` is net by construction. |
| currency conversion at the wrong day's price | eliminated for the funding day | The funding deposit is a USD-family amount (round, passes 1:1 through `txn_change_to_usd`). The later coin deposit is valued at the same-day settlement index on both the flow side and the mark side. |
| anchor read later than the last return day (gap of 29 days on 3 keys, 10 on the 4th) | minor contributor only | Zeroing the residual would need the anchor 3.34% higher, the SAME for two anchors read 81 days apart on an account that has been nearly idle since month 2 (8 non-zero returns in 229 days). The two anchors disagree by 2.8e-4 relative at a common day, which moves the residual by 3e-5 (0.3 of the band). That explains the -0.3584 vs -0.3555 split, not the residual itself. |
| §5 inception gate in native_nav accepted something wrong | eliminated | §5 subtracts pnl(d0) (`resid = B(d0) - pnl(d0) - flow(d0)`) against max($1, 1e-4 x anchor NAV), per currency, with a native dust floor. It answers a different and correct question. |
| implied-start formula off by one day | not a defect | `equity[d0] - F[d0]` is the right level arithmetic. The flaw is the premise "no return row means zero P&L". |

### The D-12 key (55%)
It is likely the same class, but that is not confirmed. It has 10 dropped interior days, all flow days, and several follow a near-total drain (the prior level is about 0.1% of the flow). To explain 0.55 on its own, a single early dropped day would need a P&L of 17-54% of that day's capital. That is extreme, but this key's largest stored daily return is +164%. Without the native per-day P&L its early history remains separately suspect, as recorded in Follow-up 1.

### Other MT5 keys
Two flow-bearing MT5 keys also sit outside the band: +12.4% (2 dropped flow days) and +2.05% (no dropped day). The 5 that reconcile to about 1e-14 are the ones that did not trade on their funding day.

### Verdict table (HEAD 2c1c2df9e, unchanged: no fix applied)
| # | venue | account group | flow days | dropped interior days | implied start / first-return level | verdict |
|---|---|---|---|---|---|---|
| 1-3 | deribit | A | 54 | 1 | -3.555e-3 (x3) | inception_unreconciled |
| 4 | deribit | A | 52 | 1 | -3.584e-3 | inception_unreconciled |
| 5-7 | deribit | B (D-12) | 85 | 10 | +5.507e-1 (x3) | inception_unreconciled |
| 8-10 | mt5 | C | 4 | 0 | +8.1e-16 (x3) | opening_flows_reconciled |
| 11-12 | mt5 | D | 14 | 2 | -3.2e-14 (x2) | opening_flows_reconciled |
| 13 | mt5 | E | 3 | 2 | +1.240e-1 | inception_unreconciled |
| 14 | mt5 | F | 3 | 0 | +2.053e-2 | inception_unreconciled |

### Options (founder decision; D-13's formula is the founder's own)
- **A. Keep D-13 as written.** Account A stays blocked although §5 proved its zero start. Any account that trades on its funding day, or that receives a deposit larger than its prior level, blocks.
- **B. (recommended) Writer-side provenance.** The derive epilogue already runs the native core. It would persist into `key_inputs` (a) `pnl_usd` for every day the TWR left out (the funding day and each guarded day) and (b) the native §5 verdict. The compose would then:
  - check the real invariant `level(d0) - pnl(d0) - F(d0)` within D-14's 1e-4;
  - stop forcing r = 0 on a dropped day, so the early levels are right too. Today they are off by the dropped day's P&L, which is a curve error separate from the verdict.
  
  Exact for Deribit (§5 already holds). For MT5 the deal ledger carries per-day P&L. More plumbing: epilogue, payload shape, compose.
- **C. Widen the band** to absorb a day's P&L. Not recommended: there is no principled width (0.36% for A, 2% for F), it hides the early-level error, and D-14 chose 1e-4 deliberately.
- **D. Drop the funding day's P&L from the check only** (compare against `level(d0) - F(d0) - pnl(d0)` without the data). Not possible: the compose does not have pnl(d0). That is what B supplies.
