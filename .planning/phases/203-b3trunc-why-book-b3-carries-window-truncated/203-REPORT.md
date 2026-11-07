# Phase 203 B3TRUNC: report

Written by plan 01 on its execution date, 2026-11-07. Labels, ISO days, tokens and counts only. Every figure below comes from 202's committed result lines (the `gc-c-b3-*` lines in `202-03-SUMMARY.md` and `202-07-SUMMARY.md`), from the repo's own functions replayed locally, from plan 01's own `gc-203-*` lines, or from one read-only PROD reading the orchestrator took and handed to the executor (marker query first, as its own call, and it answered PRODUCTION). The executor made no PROD read and no PROD write (D-03), no Railway operation, and nothing under `analytics-service/services/` changed. The only code change in the phase is one added test.

## Verdict

**Intended behaviour, not a defect.** Book b3 carries `window_truncated` because its seven member keys open on seven different days. The token is one boolean over unequal member windows, it sits under the BENIGN header of `DegradeReason`, and it is absent from `_BLOCKING_REASONS`. This is D-01's second branch: b3's flag is documented as expected, and RESID-02's `window_truncated` half closes with this record. D-01's first branch (fix a defect, show the flag gone after a derive) does not arise.

202's numbers (the D-15 record) stand and are quoted here, not re-scored. `out_of_window_flow` stays the reason b3 is untrustworthy (202, correct behaviour). `window_truncated` is not a reason a book is untrusted: b2, b5 and b7 carry it while trustworthy.

## The rule

The token is set in `allocator_equity_derive.py:allocator_equity_curve`, by one expression over the anchored keys:

```python
    window_truncated = any(
        key_first[k] != union_days[0] or key_last[k] != union_days[-1]
        for k in anchored
    )
```

and added to the reasons by one line in the same function:

```python
    if window_truncated:
        reasons.add(DegradeReason.WINDOW_TRUNCATED)
```

The `DegradeReason` header classes it as benign:

```python
    # ── BENIGN (curve is correct) ──
    WINDOW_TRUNCATED = "window_truncated"
    STALE_MARK_CARRY = "stale_mark_carry"
    CLASSIFIED_ROTATION = "classified_rotation"
```

and `_BLOCKING_REASONS` does not hold it:

```python
_BLOCKING_REASONS: frozenset[DegradeReason] = frozenset(
    {
        DegradeReason.UNCLASSIFIED_ROTATION,
        DegradeReason.EXCLUSIVE_FILL,
        DegradeReason.OUT_OF_WINDOW_FLOW,
        DegradeReason.INCEPTION_UNRECONCILED,
        DegradeReason.DROPPED_KEY,
        DegradeReason.NONFINITE_RETURN,
        DegradeReason.SHARED_ACCOUNT_HISTORY_TRUNCATED,
        DegradeReason.SHARED_ACCOUNT_NO_WORKING_KEY,
        DegradeReason.KEY_INPUTS_MISMATCH,
        DegradeReason.SHARED_ACCOUNT_FLOWS_DISAGREE,
        DegradeReason.ACCOUNT_IDENTITY_PENDING,
    }
)
```

`_is_trustworthy` returns true exactly when none of a row's reasons is in that set, so the token cannot make a book untrusted.

How the token reaches the stored row: `allocator_equity_compose.py:compose_allocator_equity` calls the curve, unions the curve's reasons into the payload, and writes the sorted tokens and the `_is_trustworthy` verdict. `job_worker.py` never sets this token. A key the book does not count never reaches the curve, so it cannot raise the token.

"Truncated" is the token's name and it means one thing: a key's window is a strict subset of the union of all keys' windows. It does not mean data was lost; the curve spans the union and carries each key at its own last mark.

The live row, as read by the orchestrator: `payload.flags` is not an object. It is a sorted list of tokens, built by `compose_allocator_equity` through `_bool_flag_tokens`, which keeps only the flags whose value is boolean True. Count and list flags (`n_tail_days_carried`, `rotated_out_keys`) are never stored. b3's stored equity-curve row (computed 2026-11-07T01:36:13Z) has `degrade_reasons` = `out_of_window_flow`, `window_truncated`, `is_trustworthy` false, and the stored flag list `degraded`, `emptied_stretch`, `missing_return_inside_coverage`, `skipped_nonpositive_denominator`, `sole_key`, `window_truncated`, `writer_basis`.

## The b3 windows

First and last return day per member key, from 202's `gc-c-b3-key` lines (capture c1 for the last day). Seven different first days:

| key | venue | first return day | last return day (c1) |
|---|---|---|---|
| C | deribit | 2023-06-28 | 2026-10-26 |
| k4 | deribit | 2024-12-07 | 2026-11-06 |
| k8 | mt5 | 2025-10-17 | 2026-11-06 |
| k10 | deribit | 2025-09-27 | 2026-11-06 |
| k14 | mt5 | 2026-07-29 | 2026-11-06 |
| k15 | bybit | 2026-01-23 | 2026-11-06 |
| k35 | mt5 | 2026-07-28 | 2026-11-06 |

202-07's stored lines for b3, verbatim:

```
gc-c-b3-stored: capture=c1 book=b3 trust=false reasons=out_of_window_flow,window_truncated other_blocking=none
gc-c-b3-truncated: capture=c1 book=b3 keys=7 predicted=yes stored=yes agree=yes trustworthy=false
```

Seven different first days make the expression true on the starts alone, whatever the tails are: any one key whose first day differs from the union's first day is enough.

Measured on the live row by the orchestrator: `window_truncated` is in the stored flag list, so the boolean was True, and `payload.inputs.n_keys` is 7 (`n_keys` lives under `inputs`, not under the flags). The stored curve runs 2023-06-27 to 2026-11-06, 1229 points, and the returns end 2026-11-06.

Key C's last return day (2026-10-26) is eleven days before the others', which can look like a stale tail. The stored reasons carry neither `stale_mark_carry` nor `classified_rotation` (nor `unclassified_rotation`). In `allocator_equity_curve`, `STALE_MARK_CARRY` is raised if and only if `n_tail_days_carried > 0`, and `CLASSIFIED_ROTATION` if and only if `rotated_out_keys` is non-empty. So on the live row `n_tail_days_carried` is 0 and `rotated_out_keys` is empty: every counted key's equity index reaches the book's last day. That index is built by `replay_key_equity` from return days, flow days and, in writer-basis mode, writer P&L days, not from return days alone. `window_truncated` and `STALE_MARK_CARRY` both compare index endpoints only, so the detector cannot tell whether key C's last eleven index days are real marks or carried or filled days (for example `r = 0` days or writer-basis fill; the stored row also carries `missing_return_inside_coverage`). That was not read, so whether C's tail is a stale tail is not shown either way. The counts themselves are not stored, so even the index claim is derived from the stored reason set, not read. The verdict is unaffected: it rests on the seven distinct start days, not on C's tail.

## Local replay

A scratch probe of the repo's own `replay_key_equity` and `allocator_equity_curve`, fed seven keys with b3's seven first days and one common last day, printed, verbatim:

```
staggered starts, common end: True 0 True ['window_truncated']
identical windows: False True []
one key: False []
```

Columns on the first line: `window_truncated`, `n_tail_days_carried`, `is_trustworthy`, sorted reasons. The committed test is a smaller, three-key form of the seven-key replay quoted above.

The committed test is `test_staggered_starts_common_end_carry_window_truncated_only`, in `analytics-service/tests/test_e2_equity_curve_layer.py`. Three keys open on days 0, 1 and 2 and all end on the last day. It asserts `window_truncated` True, `n_tail_days_carried` 0, no rotated-out keys, `degrade_reasons == {WINDOW_TRUNCATED}`, trustworthy True, the hand-derivable union levels 100000, 220000, 352000 and 387200, the same reasons with seams passed explicitly, and an identical-windows control that raises nothing.

It was shown able to fail, with two neuters of a byte copy of `allocator_equity_derive.py`, each restored from the copy and compared identical:

```
gc-203-neuter: mutation=never_raise result=red restored=identical
gc-203-neuter: mutation=benign_to_blocking result=red restored=identical
```

Never-raise (the comparison pair replaced by `False`) fails the `window_truncated` assertion. Benign-to-blocking (the token unioned into the blocking set inside `_is_trustworthy`) fails the `is_trustworthy` assertion.

## Closure of the 202 unexplained reading

202-03's verdict rule marked `window_truncated` `unexplained` because one component line disagreed: b6, predicted yes, stored no. b6's compose hands one key to the curve, because `job_worker.py:departed_history_inclusion` excludes an unknown-account departed key with no venue_account_id by default (202 D-14, closed by the founder as "Intended, no flag"; D-03's standing rule). The revoked-key-scope rule is standing context only. A predictor that ranges over the keys a book counts, not every stored member key, makes b6 predicted no and all seven books agree. That is 202-03's own option (1). b3's own line agreed on b0, b1 and c1.

202's member-keys predictor is close to tautological for a book of several keys (any two different first days make it say yes), and it must not be reused as a gate. The rule is the thing under study and it is one expression.

## No PROD write

Per D-02, no re-derive or recompute was run, and none is needed: a derive would reproduce the token for as long as b3's member windows differ, and it would write rows for no evidential gain. Had a defect been found, a re-derive that depends on new analytics-service code would have waited for ship and Railway deploy, as the orchestrator's post-deploy step. Per D-03, the executor made no PROD read and no Railway operation. The one PROD reading above was read-only, through the Supabase MCP, one statement per call, marker first, and wrote nothing.

## Observation (not booked)

b3's blocking `out_of_window_flow` is not one of the tokens `untrustworthyRebuildReason` (`src/lib/queries.ts`) maps, so a viewer of b3 gets the `derivation_rejected` line. That belongs to 202's closed half and to the reader. Nothing is booked here.

## Limits

- **A1** (key C's equity index reaches the book's last day, though its last stored return day is 2026-10-26): inferred, not read. It follows from the stored reason set (no `stale_mark_carry`, no `classified_rotation`), a derivation about the counts and not a read of them, because the counts are not stored. What is not shown: whether C's last eleven index days are real marks or carried or filled days. The detector compares index endpoints only and cannot distinguish them, and the underlying rows were not read. It does not change the verdict, which rests on the seven distinct start days.
- **A2** (`window_truncated` true and `n_keys` 7 on the live row): measured on the live row by the orchestrator, as written under the b3 windows. The token is the same boolean the rule computes.
- The local replay used the repo's functions on synthetic windows shaped like b3's, not on b3's stored rows.
- Edge probe: RESID-02 came back `unclassified`, status `unresolved`, with no verification tier from the spec-less probe, because its deliverable is an explanation. It was carried as a flagged assumption, not auto-resolved and not dropped. The rule-to-verdict link above and the committed test stand in for it.
