# Phase 155 RED-proof record (PARITY-02)

Each RED proof breaks the oracle deliberately on a byte copy outside the committed fixtures, checks the verdict goes RED with the named bucket and leg, restores from the byte backup, and compares the restored verdict byte for byte with the baseline. The three mutations are `reclassify_balance` (expects bucket `flow_placement`, leg `cum_return`), `clock_shift_1h` (expects bucket `clock_mismatch`, leg `day_placement`) and `drop_oldest_deal` (expects bucket `unexplained`, leg `inception_identity`). Renderings are the verbatim output of `python3 -m scripts.mt5_parity_run red-proof --mutation all`, concatenated with `cat`.

Runs recorded (run id `run-2026-11-13-2123`, run day 2026-11-13, base clock rule `us`):

1. Part 1: the synthetic pair (committed capture bundle, worksheet and Report, account SYN-A, run day 2026-11-16). This is the literal GREEN to RED to GREEN cycle with sha256 equality. The CLI exited 0, which means all three mutations met their expectation.
2. Part 2: each real account's sealed capture against the synthetic oracle bound as `SYN-A`, with the plan's explicit windows (Gate A 2026-10-05 to 2026-10-30, Gate B 2026-11-06 to 2026-11-13).
3. Part 3 (supplementary): the same real inputs with the picker's proposed windows.

Plan 07 assumption on rehearsal inputs: a real account's baseline against the synthetic oracle is never GREEN, so the literal GREEN to RED to GREEN cycle is proven on the synthetic pair only. On rehearsal inputs the record shows whether the named leg moved and that the restored verdict is byte-identical to the baseline. Where `meets expectation` reads no on a real account, that is the oracle mismatch, not a harness fault. Where the named leg did not move, the `note:` line carries the reason: `named_leg_absent:window_refused:<reason>` means no window was judged (Part 2), and `named_leg_unchanged` means the leg was `not_measurable` or already breaching before and after (Part 3).


## Part 1. Synthetic pair

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (SYN-A)

- expected: bucket flow_placement, leg cum_return
- baseline passed: yes
- mutated passed: no
- mutated bucket: flow_placement
- mutated breaching legs: cum_return, day_placement
- named leg moved: yes
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: yes
- meets expectation: yes
- gap start_level: before 0, mutated 0, restored 0
- gap end_level: before 0, mutated 0, restored 0
- gap cum_return: before 0, mutated 0.2, restored 0
- gap inception_identity: before 0, mutated 0, restored 0
- gap day_placement: before 0, mutated 0.2, restored 0

## clock_shift_1h (SYN-A)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: yes
- mutated passed: no
- mutated bucket: clock_mismatch
- mutated breaching legs: day_placement
- named leg moved: yes
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: yes
- meets expectation: yes
- gap start_level: before 0, mutated 0, restored 0
- gap end_level: before 0, mutated 0, restored 0
- gap cum_return: before 0, mutated 0, restored 0
- gap inception_identity: before 0, mutated 0, restored 0
- gap day_placement: before 0, mutated 0.05, restored 0

## drop_oldest_deal (SYN-A)

- expected: bucket unexplained, leg inception_identity
- baseline passed: yes
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: inception_identity
- named leg moved: yes
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: yes
- meets expectation: yes
- gap start_level: before 0, mutated 0, restored 0
- gap end_level: before 0, mutated 0, restored 0
- gap cum_return: before 0, mutated 0, restored 0
- gap inception_identity: before 0, mutated 5, restored 0
- gap day_placement: before 0, mutated 0, restored 0

## Part 2. Real accounts, the plan windows

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (MM2)

- expected: bucket flow_placement, leg cum_return
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

## clock_shift_1h (MM2)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

## drop_oldest_deal (MM2)

- expected: bucket unexplained, leg inception_identity
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (MM3)

- expected: bucket flow_placement, leg cum_return
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

## clock_shift_1h (MM3)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

## drop_oldest_deal (MM3)

- expected: bucket unexplained, leg inception_identity
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (FX-AI_V)

- expected: bucket flow_placement, leg cum_return
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

## clock_shift_1h (FX-AI_V)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark

## drop_oldest_deal (FX-AI_V)

- expected: bucket unexplained, leg inception_identity
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: none
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- note: named_leg_absent:window_refused:gate_a_reaches_first_mark


## Part 3. Real accounts, the picker windows (supplementary)

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (MM2)

- expected: bucket flow_placement, leg cum_return
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, day_placement
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 0, mutated 0, restored 0
- gap day_placement: before n/a, mutated n/a, restored n/a
- note: named_leg_unchanged

## clock_shift_1h (MM2)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, day_placement
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 0, mutated 0, restored 0
- gap day_placement: before n/a, mutated n/a, restored n/a
- note: named_leg_unchanged

## drop_oldest_deal (MM2)

- expected: bucket unexplained, leg inception_identity
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, inception_identity, day_placement
- named leg moved: yes
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 0, mutated 5, restored 0
- gap day_placement: before n/a, mutated n/a, restored n/a

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (MM3)

- expected: bucket flow_placement, leg cum_return
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, day_placement
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 0, mutated 0, restored 0
- gap day_placement: before n/a, mutated n/a, restored n/a
- note: named_leg_unchanged

## clock_shift_1h (MM3)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, day_placement
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 0, mutated 0, restored 0
- gap day_placement: before n/a, mutated n/a, restored n/a
- note: named_leg_unchanged

## drop_oldest_deal (MM3)

- expected: bucket unexplained, leg inception_identity
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, inception_identity, day_placement
- named leg moved: yes
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 0, mutated 5, restored 0
- gap day_placement: before n/a, mutated n/a, restored n/a

# MT5 parity RED proofs

Proofs: 3

## reclassify_balance (FX-AI_V)

- expected: bucket flow_placement, leg cum_return
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, day_placement
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 4.85e-16, mutated 4.85e-16, restored 4.85e-16
- gap day_placement: before n/a, mutated n/a, restored n/a
- note: named_leg_unchanged

## clock_shift_1h (FX-AI_V)

- expected: bucket clock_mismatch, leg day_placement
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, day_placement
- named leg moved: no
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 4.85e-16, mutated 4.85e-16, restored 4.85e-16
- gap day_placement: before n/a, mutated n/a, restored n/a
- note: named_leg_unchanged

## drop_oldest_deal (FX-AI_V)

- expected: bucket unexplained, leg inception_identity
- baseline passed: no
- mutated passed: no
- mutated bucket: unexplained
- mutated breaching legs: start_level, end_level, cum_return, inception_identity, day_placement
- named leg moved: yes
- restored sha256 equal: yes
- restored verdict byte-identical: yes
- restored passed: no
- meets expectation: no
- gap start_level: before n/a, mutated n/a, restored n/a
- gap end_level: before n/a, mutated n/a, restored n/a
- gap cum_return: before n/a, mutated n/a, restored n/a
- gap inception_identity: before 4.85e-16, mutated 5, restored 4.85e-16
- gap day_placement: before n/a, mutated n/a, restored n/a

