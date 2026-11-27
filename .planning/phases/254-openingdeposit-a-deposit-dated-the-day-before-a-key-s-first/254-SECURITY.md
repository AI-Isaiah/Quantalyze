---
phase: 254
slug: openingdeposit
status: secured
threats_open: 0
asvs_level: 1
audited_at_sha: a4df36f6f
---

# Phase 254 — Security (OPENINGDEPOSIT)

Verified against `git diff 68c004338..HEAD -- analytics-service/` (3 files: `services/allocator_equity_derive.py`, `services/allocator_equity_compose.py`, `tests/test_allocator_equity_inception.py`). Implementation files read-only; `tests/test_allocator_equity_inception.py` re-run at audit time: 54 passed. Working tree clean (no neuter left behind).

## Threat Verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-254-01 | Tampering (integrity) | high | mitigate | CLOSED | `allocator_equity_derive.py` ~1695-1699: exemption requires `not history_reaches_inception`, `opening_eve = lo - timedelta(days=1)` (exactly the day before), and `fbd.get(opening_eve, 0.0) > 0.0` (strictly positive net). Decrement is `-= 1`, one flow only. Pinned by B1/B3/B4/C1; neuters N2 (`> 0` to `!= 0`), N3 (`days=2`), N4 (`-= 1` to `= 0`), N5 recorded RED by node id in SUMMARY PROOF-01 with `restore cmp exit=0` and GREEN_OK each. |
| T-254-02 | Tampering (integrity) | high | mitigate | CLOSED | Diff shows `FULL_HISTORY_VENUES = frozenset({"deribit", "mt5"})` (line 1294) and `_INCEPTION_ZERO_START_BAND = 1e-4` (line 1247) unchanged in code (comment-only hunks); `_opening_flow_run` and the `if opening_run:` block are absent from the diff; `opening_run = _opening_flow_run(fbd, lo)` still runs only under `if history_reaches_inception:`. The new block runs only under the inverse condition, so the two paths are disjoint. N5 (`if True:`), N9 (venue widened), N10 (band moved) each recorded RED. |
| T-254-03 | Information disclosure | low | mitigate | CLOSED | `flags["opening_deposit_exempted"] = 1` (int, line ~1877). `_bool_flag_tokens` (`allocator_equity_compose.py:212`) keeps only `v is True`, so an int never reaches payload `flags`; no other consumer of the flag (grep of non-test code: derive.py only). A3 and E1 assert absence from the payload (tests lines 435, 473, 571); N7 (`= True`) recorded RED on both. |
| T-254-04 | Repudiation | medium | mitigate | CLOSED | SUMMARY PROOF-01: tally RED_OK 32, GREEN_OK 10, `restore cmp exit=0` 10, `neutered occurrences=1` 10, no `_MISSING` line; RED_OK matched per node id on anchored `FAILED` lines. Evidence is recorded verbatim in 254-01-SUMMARY.md. Harness and its scratch files are untracked by design, so the verbatim log is the surviving record; spot-checked consistency (each neuter's named arms exist in the test file, test module docstring lists N1..N10). |
| T-254-05 | Tampering | high | mitigate | CLOSED | Verified end state rather than harness code: `git status --porcelain` empty at audit; `git diff` of `allocator_equity_derive.py` contains only the intended exemption, comments and docstring (no `if False:`/`if True:`/`days=2`/`!= 0.0`/`= True`/widened venue/moved band); tests pass 54/54 on the committed file. SUMMARY records `cmp` against the byte backup exit 0 and empty `git status --porcelain -- analytics-service` after the run. |
| T-254-06 | Tampering (integrity) | low | accept | CLOSED | Accepted risk logged below. Named in the `replay_key_equity` docstring ("Known limit") and SUMMARY Ship notes. |
| T-254-07 | Tampering (integrity) | medium | accept | CLOSED | Accepted risk logged below. Named in the `replay_key_equity` docstring ("Known edge") and SUMMARY Ship notes. |
| T-254-SC | Tampering | low | accept | CLOSED | Accepted risk logged below. Diff touches no manifest or lockfile (3 analytics-service files only; no `supabase`, `src`, `package.json`). |

## Accepted Risks Log

| Threat ID | Risk | Basis |
|-----------|------|-------|
| T-254-06 | On a retention-capped venue (OKX ~90d, Bybit ~365d) a day -1 deposit is exempted even when returns start at the retention edge, not the account's start. | Founder ruling 2026-11-26 ("Exempt it, book for v1.23"), narrow scope; documented in code and ship notes. |
| T-254-07 | A later re-entry segment of a Deribit or MT5 key split at an unpriced hole is replayed with `history_reaches_inception` False and takes the exemption. | Within the locked wording; such a segment never had the D-13 check, so none is skipped; no level changes; PROD impact nil (one PROD book carries `out_of_window_flow`). Documented in code and ship notes. |
| T-254-SC | No package installed. | Diff contains no dependency change. |

## Unregistered Flags

None. SUMMARY `## Threat Flags` equivalent reports only the `opening_deposit_exempted` count flag, which maps to T-254-03.

## Audit Notes

- ASVS L1 (grep-level presence) plus a boundary check on T-254-01/02: the exemption sits in the same `if ret_days:` block that computes `out_of_window_flows`, so the subtraction is applied to the very count it adjusts, and reads `fbd` (the replay's own flow basis, covering both legacy and writer-basis modes; N8 pins this).
- Residual observation, not a threat: the exemption does not check that the exempted day's flow is itself plausible in size against the first-day level. This is by the founder's locked design (deposit-only, "No level changes"), not a missing declared mitigation.

**threats_open:** 0
