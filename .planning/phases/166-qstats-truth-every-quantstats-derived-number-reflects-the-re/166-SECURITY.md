---
phase: "166"
slug: "qstats-truth-every-quantstats-derived-number-reflects-the-re"
status: verified
verdict: SECURED
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-09-25"
audited_at_sha: 36c528b9788d512092247b1f7ab1ee27fe87fc0e
---

# Phase 166 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verdict: **SECURED**. 28 of 28 registered threats closed (24 mitigate, 4 accept); 0 open; 0 unregistered flags.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| manager-supplied returns → analytics worker | CSV/API daily returns enter `compute_all_metrics`; results persist to `strategy_analytics.metrics_json` and sibling series, read by public surfaces | untrusted numeric series |
| benchmark feed → worker | the BTC daily benchmark feeds the scalar and rolling greeks and `r_squared` | numeric series |
| worker → Postgres JSONB | NaN / inf are rejected by Postgres; every persisted float must be finite or None | scalars + series |
| future code change → persisted metrics | a reintroduced unclosed quantstats call would re-open the price guess; the AST gate is the control | source |
| csv-finalize route → Supabase | the clock-safety guard's projection decides which KPI columns are read, under the owner's user-scoped client | column list |
| client-reachable module graph | `queries.ts` is client-reachable; `percentile-core.ts` has no imports | column names |
| planning docs / CHANGELOG / TODOS → public repo | world-readable on push; CHANGELOG is scanned by gitleaks on push to main | prose |
| founder → PRODUCTION | the census SQL and OPEN-2 recompute are founder actions; nothing in this phase connects | none |

---

## Threat Register

Severity threshold: `block_on: high`, ASVS L1. Threats that appear in several plans are merged under one ID at the highest severity any plan gave them. The supply-chain rows are split per plan because their dispositions differ.

| Threat ID | Category | Component | Severity | Disposition | Evidence (by symbol, at the audited sha) | Status |
|-----------|----------|-----------|----------|-------------|------------------------------------------|--------|
| T-166-01 | Tampering | primitive extraction (`_annualized_vol_sharpe`, `_downside_rms`, `_cvar_of_tail`, the drawdown primitives) | medium | mitigate | both 166-01 commits touch `services/metrics.py` only: no test and no golden edited. The golden fixture changed in exactly two later commits (166-04 PSR, 166-06 rolling alpha), both disclosed | closed |
| T-166-02 | Denial of Service | NaN/inf reaching JSONB | medium | mitigate | every mirror goes through `_safe_qstats_scalar` → `_safe_float`; alpha/beta/correlation/info_ratio/treynor/r_squared through `_safe_float`; rolling outputs through `_finalize_rolling` → `_drop_nonfinite`; `sanitize_metrics` is the final walk. Auditor probe: 6 edge series × 3 benchmarks (constant, compounding yield, all-winning with a +150% day, NaN-bearing, all-zero, inf day) gave 0 non-finite and 0 values with magnitude above 1e9 anywhere in `metrics_json` or `sibling_kinds` | closed |
| T-166-03 | Information Disclosure | SUMMARY / review docs quoting output | medium | mitigate | no home path or username in any phase-166 planning doc (grep: 0 files); the one TODOS.md hit is a pre-existing `<user>` placeholder the phase did not add; planning-hygiene check OK with this file staged | closed |
| T-166-04 | Tampering | ranking projection / clock-safety guard | medium | mitigate | `CLOCK_SAFETY_KPI_COLUMNS = PERCENTILE_METRICS`; `PERCENTILE_ANALYTICS_COLUMNS = PERCENTILE_METRICS.join(", ")`; `PERCENTILE_METRICS` members and order are unchanged by the phase and equal the old literals; hand-written byte pins in `queries.percentile-columns.test.ts` and `csv-finalize-cross-submission-merge.test.ts` | closed |
| T-166-05 | Information Disclosure | importing `percentile-core` into the route | low | accept | `percentile-core.ts` has 0 import statements and holds public column names. See Accepted Risks Log | closed |
| T-166-06 | Elevation / contract break | csv-finalize `route.ts` exports | low | mitigate | the export lines of `route.ts` are identical at base and HEAD (6 exports; `POST` is still `withAuth(...)`); the route diff adds no auth, admin-client, rate-limit or `.eq(` change | closed |
| T-166-07 | Tampering | eight dispatched scalars (`_QSTATS_SINGLE_ARG_SCALARS`) | high | mitigate | every entry is a module mirror (`_recovery_factor` … `_serenity_index`); the only quantstats calls left in them are the 7 `KWARG_PROVEN` leaves with `prepare_returns=False`; the gate reports 0 violations, so no `getattr` dispatch remains (rule B3). Auditor probe: on an all-winning series with a +150% day, all six drawdown/loss-family mirrors persist None and never a fabricated finite value | closed |
| T-166-08 | Repudiation | golden PSR / rolling alpha | medium | mitigate | flattened key-path diff of `golden_252d_expected.json`, phase base vs HEAD, re-run by the auditor: exactly `metrics_json.metrics_json.probabilistic_sharpe_ratio` and `sibling.rolling_alpha` moved, both carried as D-10 rows in the 166-04 and 166-06 SUMMARYs | closed |
| T-166-09 | Tampering (fault masking) | failure-soft wrappers | low | mitigate | `test_q166_composed_leaf_fault_is_failure_soft`, `test_qstats_scalars_r_squared_status_error_on_qs_failure` (fault in `linregress`), `test_rolling_alpha_beta_logs_warning_on_qs_failure`, `test_qstats_scalars_dispatch_table_per_entry`; the WARNING names the scalar in `_safe_qstats_scalar` | closed |
| T-166-10 | Tampering (fabricated rendered value) | scalar greeks on NaN-bearing strategies | high | mitigate | `_greeks_no_guess` joins pairwise-complete rows, returns `(None, None)` below 2 rows or on a residue benchmark variance, and drops 0.0.81's `.fillna(0)`; the `greeks.get("alpha", 0)` / `.get("beta", 0)` reads are removed; `test_q166_greeks_nan_days_are_not_fabricated_zeros`, `test_q166_greeks_undefined_beta_is_none_not_zero`. The treynor guard's `metrics_json.get("beta", 0)` still exists (older code) but only gates `if beta and beta != 0`, so a 0 default skips treynor and persists nothing | closed |
| T-166-11 | Tampering (misleading series) | rolling alpha | high | mitigate | `_rolling_greeks` computes alpha as the windowed intercept `means["returns"] - beta * means["benchmark"]`; `test_q166_rolling_alpha_is_the_windowed_intercept`, `..._full_precision`, `..._differs_from_the_full_sample_form`; rolling-beta parity tests against live quantstats remain | closed |
| T-166-12 | Tampering (silent drift) | `r_squared` alignment | medium | mitigate | `_r_squared` prepares the benchmark twice through `_align_benchmark_like_qs` (reindex/bfill branch kept); `test_q166_parity_r_squared_matches_live_quantstats`; no r_squared golden key moved (T-166-08 diff) | closed |
| T-166-13 | Tampering (a control that cannot fail) | AST gate `tests/qstats_gate.py` | high | mitigate | `scan_tree` walks every production `*.py`; rules A, A', B1–B6 fail closed (non-constant `prepare_returns`, a `**kwargs` splat, a computed module name, a namespace dict read by a computed key, any non-`stats` quantstats surface are all RED); `test_qstats_gate_real_corpus_is_not_blind`, `..._kwarg_allowlist_is_not_stale`, `..._red_needle_is_named` (parametrized), `..._reexport_needle_is_named`; 4 neuter drills recorded in the 166-08 SUMMARY. Auditor run: 355 passed in `test_qstats_gate.py` + `test_metrics.py`; census `13 quantstats node(s) … 0 violation(s); arms kwarg-proven=12 exempt=1 inline=11` | closed |
| T-166-14 | Spoofing (a keyword that lies) | `KWARG_PROVEN` allowlist | high | mitigate | allowlist by function name (7 leaves); `test_qstats_gate_kwarg_proven_leaf_never_reaches_a_preparer` is parametrized over `sorted(KWARG_PROVEN)`; `test_qstats_gate_calibration_non_honouring_functions_do_reach_a_preparer` proves the spy fires on `cvar` and `payoff_ratio`; the needles for `cvar` and `payoff_ratio` with the keyword are RED | closed |
| T-166-15 | Repudiation (invisible census) | pytest output | medium | mitigate | `pytest_terminal_summary` in `tests/conftest.py` prints `safe_census_lines`; `test_qstats_gate_census_is_printed_on_a_real_run` runs pytest in a subprocess and reads stdout; `test_qstats_gate_census_that_cannot_be_built_is_a_named_line` | closed |
| T-166-16 | Tampering (destructive drill) | neuter drills on `metrics.py` | medium | mitigate | 166-08 SUMMARY records a `cp` backup, a `cmp` check and a byte-identical restore for each drill, with no checkout, restore or stash; the working tree has no unstaged change to any implementation file | closed |
| T-166-17 | Information Disclosure | SUMMARY / TODOS / WINDOWS text | high | mitigate | census SQL is table-level (column names only, no values); no home path, username, project ref or credential in the phase docs; range-scoped gitleaks over the phase commits: no leaks found | closed |
| T-166-18 | Tampering (PROD write) | census SQL | high | mitigate | every census statement in the 166-09 SUMMARY is a `SELECT` (grep: 0 UPDATE/INSERT/DELETE); nothing was recomputed or enqueued | closed |
| T-166-19 | Repudiation | D-10 table | medium | mitigate | same golden key-path diff as T-166-08: exactly the two disclosed paths | closed |
| T-166-20 | Tampering (ledger clobber) | gsd-tools windows handler | medium | mitigate | 166-09 SUMMARY records backups and `cmp`: STATE.md, ROADMAP.md and state.json unchanged | closed |
| T-166-21 | Tampering (CI suppression) | commit messages | high | mitigate | auditor scan of every commit message between phase base and HEAD for all six skip-token forms: 0 hits | closed |
| T-166-22 | Information Disclosure | CHANGELOG entry | medium | mitigate | range-scoped gitleaks, phase base..HEAD, with the repo config: no leaks found; no home path in the added CHANGELOG lines | closed |
| T-166-23 | Tampering (PROD write) | OPEN-2 | high | mitigate | OPEN-2 is recorded as a founder decision routed to a new phase; the phase diff contains no migration and no DB connection code; the auditor ran no DB command | closed |
| T-166-24 | Repudiation (unshipped fact) | CHANGELOG | medium | mitigate | 166-10 SUMMARY records `commits=35 unmapped=0` from the commit checklist | closed |
| T-166-SC-01 | Tampering (supply chain) | dependencies, plan 01 | low | accept | no dependency file changed in the phase (requirements*.txt, requirements.in, pyproject.toml, package-lock.json: empty diff). See Accepted Risks Log | closed |
| T-166-SC-02 | Tampering (supply chain) | node_modules link, plan 02 | low | mitigate | no `node_modules` in the worktree; `/node_modules` is gitignored; 0 tracked files under it | closed |
| T-166-SC-04 | Tampering (supply chain) | new scipy import, plan 04 | low | accept | `from scipy.stats import linregress, norm` is new in `services/metrics.py`; scipy is already pinned in `analytics-service/requirements.txt` (transitive via quantstats) and the lock is unchanged. See Accepted Risks Log | closed |
| T-166-SC-10 | Tampering (supply chain) | package.json, plan 10 | low | mitigate | the `package.json` diff is the version field only; `package-lock.json` unchanged | closed |

*Status: open · closed. Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third party).*

---

## Surfaces the caller named

| Surface | Result |
|---------|--------|
| quantstats mirrors: no fabricated finite values | the D-09 undefined arms map to NaN, then None; the auditor probe persisted None for all six loss/drawdown mirrors on the all-winning trigger |
| no NaN/inf persisted as numbers | 18 probe runs, 0 non-finite values in `metrics_json` or `sibling_kinds` |
| dispersion floor | `_residue_floor` / `_dispersion_is_residue` / `_dispersion_is_real` guard every std or variance divisor: headline sharpe and info_ratio (through `_annualized_vol_sharpe`), headline vol, smart_sharpe, serenity, PSR base, `_greeks_no_guess` (both legs), `_r_squared_pair_varies`, correlation, outlier ratios, `_rolling_sharpe`, `_rolling_greeks`, `_rolling_correlation`. Probe: a constant series and a compounding 1e-4 yield both persist sharpe None, treynor None, r_squared None with status `error` |
| AST gate fail-closed rules | rules A, A', B1–B6 as in T-166-13; known static-analysis limits (values passed through data flow, `eval`/`exec`) are recorded in the module docstring, and none of those shapes exists in the tree |
| csv-finalize: auth unchanged, column list changed only by derivation | T-166-04 and T-166-06 |
| `percentile-core.ts` / `queries.ts`: no new data exposure | the only additions are a type (`CommaSpaceJoined`) and a derived constant whose bytes equal the old literal; no new column, table or export of data |
| logs: no secrets and no user identifiers | the 3 new WARNING lines carry the scalar name, `returns_len`, `benchmark_len`, the non-finite raw value and the exception text. `_refuse_mismatched_day_labels`' message carries only the two tz names. `services/metrics.py` never logs strategy_id, user_id or email; the TS diff adds no log call |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-166-01 | T-166-05 | `percentile-core.ts` has no imports and holds only public KPI column names already present in client code. Importing it into the route pulls nothing client-reachable into it | plan 166-02 threat model | 2026-09-25 |
| AR-166-02 | T-166-SC-01 | plan 01 installs nothing and changes no dependency file (D-01) | plan 166-01 threat model | 2026-09-25 |
| AR-166-03 | T-166-SC-04 | scipy is already installed and pinned as a quantstats transitive; the phase adds a direct import but no install and no lock change | plan 166-04 threat model | 2026-09-25 |

---

## Unregistered Flags

None. All ten SUMMARY `## Threat Flags` sections read "None" and map only to registered IDs.

---

## Informational (not threats)

- The treynor guard in `compute_all_metrics` still reads `metrics_json.get("beta", 0)`. The default is used only as a falsy gate, so it cannot persist a value. Left as is.
- A strategy leg with no real dispersion now persists `beta = 0.0` with alpha equal to its annualized mean. That is the true covariance, documented in `_greeks_no_guess` and disclosed under D-10. It is not a fabricated zero.
- The TS byte-pin tests were verified by reading them, not by running them: the worktree has no `node_modules`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-25 | 28 | 28 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-25
