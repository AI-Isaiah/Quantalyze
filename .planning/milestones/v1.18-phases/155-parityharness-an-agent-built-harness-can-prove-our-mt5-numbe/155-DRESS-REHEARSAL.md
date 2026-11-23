DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# Phase 155 dress rehearsal record

This record is the success criterion 4 rehearsal. It is not a parity result. Every verdict below compares a real account's sealed capture against the committed synthetic oracle, so a RED or `unexplained` reading is the expected outcome, and nothing was fixed to change it.

- Run id: `run-2026-11-13-2123` (the sealed real capture from plan 10; the path is not recorded).
- Capture day (UTC, the run day passed to every command): 2026-11-13.
- Accounts present in the sealed manifest: MM2, MM3, FX-AI_V.
- Oracle binding: the committed synthetic worksheet and its UTF-16LE Report, bound as `SYN-A` (`--oracle-label SYN-A`), for every account. `final_green` is false for every verdict by construction.
- Tolerance: the one `MT5_PARITY_TOLERANCE`, applied unchanged. No per-account tolerance exists.
- Base clock rule: `us` (the CLI default).
- Renderings below are the verbatim output of `python3 -m scripts.mt5_parity_run verdict`, concatenated with `cat`. Each section is one account in label order, and each section's own first line repeats the DRESS REHEARSAL line.

## Part 1. The plan's windows (the synthetic oracle's own edges, passed explicitly)

Gate A 2026-10-05 to 2026-10-30, Gate B 2026-11-06 to 2026-11-13. The real accounts' first mark is 2026-10-26, so Gate A reaches the first mark, and Gate B ends on the run day so it is not a closed window. Both are therefore recorded as `window_refused:<reason>` verdicts, which is the plan's stated outcome for a window the real capture cannot support. They prove the refusal path runs end to end on real inputs.

## Part 2. Supplementary: the picker's proposed windows (no `--gate-*` flags)

Added so the rehearsal also exercises the evaluation legs on real inputs, which Part 1 cannot (see the Deviations section of the plan summary). The windows are the picker's proposal from the real deals, not a founder reading. The synthetic oracle is in a different magnitude than the real accounts, so Gate B legs breach with large gaps and Gate A legs read `not_measurable:unit_mismatch`. Those readings come from the synthetic binding and say nothing about the product.


### Part 1 renderings

DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# MT5 parity verdict

Rehearsal: yes, a synthetic oracle: not a parity result
Accounts: 2

## MM2 (gate A)

- window days: 25
- bucket: unexplained
- matched: none
- passed: no
- reason: window_refused:gate_a_reaches_first_mark
- oracle label: SYN-A

## MM2 (gate B)

- window days: 7
- bucket: unexplained
- matched: none
- passed: no
- reason: window_refused:window_not_closed
- oracle label: SYN-A

DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# MT5 parity verdict

Rehearsal: yes, a synthetic oracle: not a parity result
Accounts: 2

## MM3 (gate A)

- window days: 25
- bucket: unexplained
- matched: none
- passed: no
- reason: window_refused:gate_a_reaches_first_mark
- oracle label: SYN-A

## MM3 (gate B)

- window days: 7
- bucket: unexplained
- matched: none
- passed: no
- reason: window_refused:window_not_closed
- oracle label: SYN-A

DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# MT5 parity verdict

Rehearsal: yes, a synthetic oracle: not a parity result
Accounts: 2

## FX-AI_V (gate A)

- window days: 25
- bucket: unexplained
- matched: none
- passed: no
- reason: window_refused:gate_a_reaches_first_mark
- oracle label: SYN-A

## FX-AI_V (gate B)

- window days: 7
- bucket: unexplained
- matched: none
- passed: no
- reason: window_refused:window_not_closed
- oracle label: SYN-A


### Part 2 renderings

DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# MT5 parity verdict

Rehearsal: yes, a synthetic oracle: not a parity result
Accounts: 2

## MM2 (gate A)

- window days: 18
- bucket: unexplained
- matched: none
- passed: no
- reason: not_measurable:unit_mismatch;not_measurable:unit_mismatch;not_measurable:unit_mismatch;not_measurable:unit_mismatch
- oracle label: SYN-A
- leg start_level: fail, gap n/a
- leg end_level: fail, gap n/a
- leg cum_return: fail, gap n/a
- leg inception_identity: pass, gap 0
- leg day_placement: fail, gap n/a

## MM2 (gate B)

- window days: 7
- bucket: unexplained
- matched: none
- passed: no
- reason: start_level;end_level;cum_return
- oracle label: SYN-A
- leg start_level: fail, gap 7.82
- leg end_level: fail, gap 7.52
- leg cum_return: fail, gap 0.308

DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# MT5 parity verdict

Rehearsal: yes, a synthetic oracle: not a parity result
Accounts: 2

## MM3 (gate A)

- window days: 18
- bucket: unexplained
- matched: none
- passed: no
- reason: not_measurable:unit_mismatch;not_measurable:unit_mismatch;not_measurable:unit_mismatch;not_measurable:unit_mismatch
- oracle label: SYN-A
- leg start_level: fail, gap n/a
- leg end_level: fail, gap n/a
- leg cum_return: fail, gap n/a
- leg inception_identity: pass, gap 0
- leg day_placement: fail, gap n/a

## MM3 (gate B)

- window days: 7
- bucket: unexplained
- matched: none
- passed: no
- reason: start_level;end_level;cum_return
- oracle label: SYN-A
- leg start_level: fail, gap 7.82
- leg end_level: fail, gap 7.52
- leg cum_return: fail, gap 0.308

DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity.

# MT5 parity verdict

Rehearsal: yes, a synthetic oracle: not a parity result
Accounts: 2

## FX-AI_V (gate A)

- window days: 18
- bucket: unexplained
- matched: none
- passed: no
- reason: not_measurable:unit_mismatch;not_measurable:unit_mismatch;not_measurable:unit_mismatch;not_measurable:unit_mismatch
- oracle label: SYN-A
- leg start_level: fail, gap n/a
- leg end_level: fail, gap n/a
- leg cum_return: fail, gap n/a
- leg inception_identity: pass, gap 4.85e-16
- leg day_placement: fail, gap n/a

## FX-AI_V (gate B)

- window days: 7
- bucket: unexplained
- matched: none
- passed: no
- reason: start_level;end_level;cum_return
- oracle label: SYN-A
- leg start_level: fail, gap 9.33
- leg end_level: fail, gap 8.07
- leg cum_return: fail, gap 1.26

