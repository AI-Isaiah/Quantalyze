---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
audited_at_sha: 177ac6a9e
asvs_level: 2
status: secured
threats_total: 34
threats_open: 0
---

# Phase 233 Security Audit

**Verdict: SECURED, after one fix.** The audit covered 34 distinct threat ids from the STRIDE registers of plans 01 to 07. gsd-security-auditor ran read-only at `177ac6a9e` and found 33 closed and 1 open. That open id, T-233-13, is now closed by `5c02f3131`.

## T-233-13 (Information disclosure, high): closed by fix

`.planning/debug/deribit-stale-returns.md` carried rounded absolute USD amounts for a real PROD key in two Evidence lines. Those were the withdrawal, the levels before and after it, the terminal, the window peak and the 2026-11-09 deposit. Commit `5c02f3131` restates them as ratios and leaves the diagnosis's logic as it was.

Two points about the fix:
- Plan 06's write scope kept the Evidence section "as written". The mitigation this threat promises ("letters only, no amounts") takes precedence over that scope.
- The amounts are still in this branch's history, in `b4f29e68a`. The record is not on `origin/main`. It reaches `main` only through a records PR, and that PR must carry the file's current content and not this branch's commits.

## Closed (auditor evidence, summarized)

- **T-233-01 (classifier).**
  - In `analytics-service/services/deribit_txn.py`, `correction_is_trading` checks the capital denylist first.
  - It then requires a trading word AND an anchored instrument token.
  - `assert_correction_classifiable` fails loud otherwise.
  - Fixtures in `tests/test_deribit_txn.py` cover each case.
- **T-233-03, -16 (no id in public output).** The freshness SQL outputs only the venue, an 8-hex md5 tag, ISO days, the anchor reason and tiny days. `parseFreshnessRows` regex-restricts each field, and the error details carry no values.
- **T-233-04 (read-only SQL).**
  - Both `*_SQL` constants are a single SELECT or WITH, with no `;` and no write token.
  - The self-test scenario over `SQL_ARM_MODULES` pins this.
- **T-233-05, -15 (not silent).**
  - A failed, unparsable or count-mismatched read is a `measure-fail`.
  - Zero derived keys gives `freshness-no-scope`.
  - The per-venue guard covers venues whose keys cannot be judged.
  - The prober self-test passes 109/109.
- **T-233-06 (credentials).** No new env var or secret is added, and psql stderr is redacted by the existing seam.
- **T-233-08, -10, -17, -20, -24 (oracle output).**
  - The oracle prints from a closed vocabulary of ratios, shares and counts only.
  - A final backstop refuses UUIDs and long digit runs.
  - `_refuse_id_shaped` rejects an id-shaped field in the export.
- **T-233-09, -18, -19 (oracle independence).**
  - An AST allowlist scan keeps production helpers out of the oracle.
  - Parity pins tie its constants to production.
  - The emptied-level fixtures are RED under the defect they guard.
- **T-233-11, -12, -21, -22, -23 (PROD readings).** The readings were marker-first, SELECT-only and one statement per call, as each SUMMARY attests.
- **T-233-14 (narrowed dispatch).** The workflow changed only in comments, names and the arm input description. A narrowed run skips the incident step.
- **Accepted:** T-233-02 (A1), T-233-07 (O3) and T-233-SC. No dependency file changed.

## Non-blocking flag

`233-01-SUMMARY.md` quotes a pytest trace containing a tiny BTC correction amount. It comes from an already-public Phase 128 fixture on `main`, carries no identifier and is left unchanged.
