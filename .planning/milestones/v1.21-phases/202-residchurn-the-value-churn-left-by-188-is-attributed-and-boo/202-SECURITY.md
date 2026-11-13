---
phase: 202-residchurn
slug: residchurn
status: secured
asvs_level: 1
block_on: high
threats_total: 36
threats_closed: 36
threats_open: 0
threats_open_nonblocking: 0
audited: 2026-11-07
audited_head: 99b40b423
---

# Phase 202 RESIDCHURN: security verification

Verification method: each declared mitigation was looked for in what was built (scratch kit under
`~/.cache/quantalyze/residchurn/`, saved results, tracked artifacts, git diff), and each re-runnable
gate was re-run at audit time. No PROD read, no Supabase or Railway call and no Keychain access
was made by this audit. Implementation files were not modified.

## Audit-time evidence (re-run, not quoted from SUMMARYs)

| Check | Result |
|-------|--------|
| `gen_sql.py lint sql` | `files=31 violations=0 sha256_d=7/7` |
| `gen_sql.py --self-test` | 32 cases, `red-as-expected` (RED cases include DELETE, two statements, CTE delete, literal-hidden delete, SELECT INTO, pg_sleep, set_config, advisory locks, dblink, net.http, cron.unschedule) |
| Independent grep of `sql/*.sql` for write verbs, INTO, side-effecting functions, `net.`, `cron.` | 0 matches |
| `check_capture.py --kind pre` / `--kind rows` / `--kind c1` (with the nightly times plan 06 names) | all exit clean: `marker=PRODUCTION`, `checks=4/4` for c1, `sql_sha=ok` |
| `check_capture.py --self-test --dir c0` | `red-as-expected` (edited line, edited marker, pending job, unbound original, jobs-after differing, gate cases all RED where required) |
| `final_attribution.py` sha256 prefix | `8a62ca3b1215`, equal to the `gc-c-final-rule` recorded in 202-02-SUMMARY; file mtime precedes every c1 file |
| `final_attribution.py --self-test`, `attribute.py --self-test` | 7 cases ok, all ok |
| Mtimes: `SHA256SUMS.d` vs `n_*.sql` | pin written before any generated file; all seven `d_*.sql` match it |
| `git diff origin/main...HEAD -- analytics-service supabase` | 0 bytes; `git status --porcelain` clean |
| Files changed on the branch outside `.planning/` | `TODOS.md` only; no `package*.json`, lockfile or requirements change |
| Files in `tinybase-gc` (188's kit) newer than 202's first artifact | 0 |
| `npx --no-install tsx scripts/check-planning-hygiene.ts` | OK: rule 1 (no local username or absolute home path), rule 6, rule 7 |
| Scratch scripts: network, DB or Keychain clients | none imported; only `subprocess` uses are `git cat-file/merge-base/log/diff/rev-parse/show` and self-invocation of the kit's own scripts |

## Tracked-text leak scan (`git diff origin/main...HEAD`, added lines)

| Pattern | Hits |
|---------|------|
| uuid shape | 0 (also 0 in `git grep` over the phase dir) |
| `[/]Users[/]`, `/home/<name>` | 0 in added lines; scratch is referenced only as `~/.cache/...` or `$HOME/.cache/...` |
| JWT, `sk_`, cloud-key, PAT, `sbp_`, PEM header, DSN-with-password shapes | 0 |
| 32+ char hex | 17 unique, all 40-char, every one resolves to a commit in the repo (public ids) |
| `anchor_usd=<n>`, `usd_signed=<n>`, `balance=<n>`, currency-with-thousands | 0 |
| 9+ digit numbers | only a migration version (`20261106120000`) and a zero run |
| email, supabase project URL, http URL | 0 |
| `password / secret / api key / service role / token` words | 86, all LLM `tokens:` budget lines, the word "tokens" as a vocabulary term, or prose; none is a credential |

## Threat register

Severity and disposition are as declared in each plan's `<threat_model>`.

| Threat | Plan | Category | Severity | Disposition | Status | Evidence |
|--------|------|----------|----------|-------------|--------|----------|
| T-202-01 | 01 | Tampering (write in generated SQL) | high | mitigate | CLOSED | `gen_sql.py` `lint_text` (SELECT/WITH start, one statement, `WRITE_VERBS`, INTO, `DENY_FN`, `DENY_SCHEMA`, tokenizer that sees comment and literal bypasses); lint 31 files 0 violations; self-test RED on a `delete` case; independent grep clean |
| T-202-02 | 01 | Tampering (transcription accepted) | medium | mitigate | CLOSED | `check_capture.py` recomputes `chk` / md5s; re-run clean on pre, c1, rows; self-test RED on `edited-h` and `unbound-original` |
| T-202-03 | 01 | Repudiation (d_*.sql drift) | medium | mitigate | CLOSED | `sql/SHA256SUMS.d` pins the seven originals; `sha256_d=7/7` at audit; pin predates all `n_*.sql` by mtime |
| T-202-04 | 01 | Info disclosure | high | mitigate | CLOSED | Leak scan above: 0 uuid, 0 home path, 0 amounts. PROD key uuids exist only in scratch `r_rows_*.sql` and captures |
| T-202-05 | 02 | Repudiation (rule bent after data) | high | mitigate | CLOSED | Rule pinned before c1 by hash (`8a62ca3b1215`, unchanged); sum gate exits 1 on a short sum (self-test case); `--neuter` and `--expect-summary` present in `attribute.py`. The D-15 founder deviation is addressed in Observation 3 |
| T-202-06 | 02 | Info disclosure | high | mitigate | CLOSED | No `anchor_usd=<n>` or `usd_signed` value in tracked text; `attr/inputs-b0.json` and `inputs-b1.json` are scratch only |
| T-202-07 | 02 | Tampering (edit 188's kit) | low | mitigate | CLOSED | 0 files in `tinybase-gc` newer than 202's first artifact; scratch scripts open `$GC` read-only |
| T-202-34 | 02 | Repudiation (control rule fitted to c1) | high | mitigate | CLOSED | `gc-c-final-rule: script_sha12=8a62ca3b1215` in 202-02-SUMMARY; `gc-c-final-rule-used: ... equal_to_plan_02=yes` in 202-07-SUMMARY; hash recomputed at audit and equal; script mtime (11-07 01:49) precedes c1 files |
| T-202-08 | 03 | Tampering (replay edits repo) | low | mitigate | CLOSED | Diff and `git status --porcelain` for `analytics-service` and `supabase` empty. Ignored `__pycache__` only, see Observation 2 |
| T-202-09 | 03 | Repudiation (verdict without evidence) | high | mitigate | CLOSED | `gc-c-b3-xcheck` replay-vs-formula lines for every key, `gc-c-b3-verdict` composed from component lines, unexplained `window_truncated` left `unexplained` (not asserted) and sent to Phase 203 |
| T-202-10 | 03 | Info disclosure | high | mitigate | CLOSED | Leak scan: counts, days, venue names, flags only |
| T-202-11 | 04 | Tampering (write in pre read) | high | mitigate | CLOSED | Lint clean; `n_final.sql` carries the `shobj_description` marker; `pre/marker.json` names PRODUCTION; no DB client in any kit script; ledger `equal_to_pre=yes` at c1 (n=316), so no migration write |
| T-202-12 | 04 | Tampering (Railway action) | high | mitigate | CLOSED | Plan 04 must_have forbids `railway up`, redeploy, `connect-service-source`; `gc-c-deploy ... deployments=0 code_diff=empty` on both services at pre and c1; no Railway client in the scripts |
| T-202-13 | 04 | Tampering (transcription) | medium | mitigate | CLOSED | `check_capture.py --kind pre` exits clean (`jobs=idle`, `sql_sha=ok`); see T-202-02 |
| T-202-14 | 04 | Repudiation (void pair read as valid) | high | mitigate | CLOSED | `gc-c-deploy` emitted separately for `service=api` and `service=worker`; `deploy_proof.py` content criterion with a self-test; `gc-c-deploy-gap` and `gc-c-migrate-runs` recorded |
| T-202-15 | 04 | Info disclosure | high | mitigate | CLOSED | Leak scan clean |
| T-202-32 | 04 | Repudiation (c0 ledger half) | medium | mitigate | CLOSED | `gc-c-ledger-basis: c0=not_recorded pre=measured c0_to_pre=inferred ... inference=holds uncovered=other_write_paths` present |
| T-202-33 | 04 | Tampering (late pre read) | medium | mitigate | CLOSED | `gc-c-pre-window: missed=no late=no final_taken=2026-11-06T23:47:06Z before_nightly=yes idle=yes wave_touched=none wave_keys_books=none` |
| T-202-16 | 05 | Repudiation (commit named on timing) | high | mitigate | CLOSED | `codepath_judge.py` and `codepath_xcheck.py`; nine candidate commits listed and none met the rule, so no commit was named; `gc-c-cause` shows `bucket=c scopes=none` |
| T-202-17 | 05 | Info disclosure | medium | mitigate | CLOSED | Leak scan clean |
| T-202-18 | 06 | Tampering (write during c1) | high | mitigate | CLOSED | Same controls as T-202-11; `c1/marker.json` and `c1/final.json` present, `marker=PRODUCTION`; `gc-c-ledger ... equal_to_pre=yes`; `gc-c-migrate-runs ... runs=0` |
| T-202-19 | 06 | Repudiation (void pair as control) | high | mitigate | CLOSED | `gc-c-pair: verdict=valid api_code_diff=empty worker_code_diff=empty ledger=unchanged migrate_runs=0 migration_commits=0 ledger_c0_to_pre=inferred anchor_stable=yes` |
| T-202-20 | 06 | Tampering (derive mid-capture) | medium | mitigate | CLOSED | `check_capture.py` gate (`--gate-only`) and `jobs_after` equality; self-test `jobs-after-differs` RED; c1 re-run `jobs=idle` |
| T-202-21 | 06 | Tampering (transcription) | medium | mitigate | CLOSED | c1 re-run at audit: `checks=4/4`, `counts=ok` |
| T-202-22 | 06 | Info disclosure | high | mitigate | CLOSED | Leak scan clean; `n_anchor` and `n_b3_ki` outputs only in scratch |
| T-202-35 | 06 | Repudiation (D-06 retake row base) | high | mitigate | CLOSED, not triggered | No retake occurred (`gc-c-pair verdict=valid` first time); `assemble_c1.py` exists with a 12-case self-test and `c1rows` was produced with 38/38 and 16/16 prefix digests reproduced (202-07-SUMMARY). The control is present and exercised on the c1 row base |
| T-202-23 | 07 | Tampering (rows after a later derive) | medium | mitigate | CLOSED | `check_capture.py --kind rows --c1 c1`: `n_files=15/15`, every read bound to c1's whole-scope `h`; `jobs=absent` is stated, and `final.json` shows `last_done` equal to c1's |
| T-202-24 | 07 | Repudiation (bucket kept against control) | high | mitigate | CLOSED | Pinned script run unchanged; its output is preserved (`attr/final.out`, `gc-c-total ... sum_ok=yes`); self-test 7 cases. See Observation 3 for D-15 |
| T-202-25 | 07 | Repudiation (D-12 fix without a measured fact) | high | mitigate | CLOSED | `gc-c-b3-d12: reopened=yes reason=component_disagrees` is derived from `gc-c-b3-verdict`; no fix built on it |
| T-202-26 | 07 | Info disclosure | high | mitigate | CLOSED | Leak scan clean on SUMMARYs and `202-REPORT.md` |
| T-202-27 | 07 | Tampering (write during row reads) | high | mitigate | CLOSED | Rows files linted (14 `r_rows_*.sql` in the 31); `rows/marker.json` names PRODUCTION and `n_final.sql` ran last (`last_query=PRODUCTION`) |
| T-202-28 | 08 | Tampering (founder pin changed) | high | mitigate | CLOSED | 202-08-PLAN Task 2 is `checkpoint:decision gate="blocking-human"` with no `auto_select`; Task 3 not run; no pin edited (no source diff) |
| T-202-29 | 08 | Repudiation (fix for correct behaviour) | high | mitigate | CLOSED | No file under `analytics-service/` changed (diff 0 bytes); founder chose no-fix (D-17) |
| T-202-30 | 08 | Tampering (test that cannot fail) | medium | mitigate | CLOSED, vacuous | No test or fix was built, so there is nothing to certify. The RED-first and neuter procedure is moot, and the kit's own tests were each shown RED (`gen_sql`, `check_capture`, `attribute`, `final_attribution` self-tests) |
| T-202-31 | 08 | Tampering (fix before c1 voids control) | high | mitigate | CLOSED | No fix deployed in 202; c1 taken with `api` and `worker` `deployments=0` through c1 |
| T-202-SC (x8) | 01 to 08 | Tampering (installs) | low | accept | CLOSED (accepted) | See accepted risks. Branch changes no `package*.json`, lockfile or requirements file; no `pip install` or `npm install` in any kit script |

## Accepted risks log

| ID | Risk | Basis |
|----|------|-------|
| T-202-SC | Supply-chain risk of package installs, in each of plans 01 to 08 | Accepted in every plan: nothing is installed, stdlib Python plus the system pandas are used. Verified: no dependency file changed |

## Unregistered flags

All eight SUMMARYs list `## Threat Flags: None`. No unregistered attack surface was found: no
endpoint, auth path or schema was added, and the branch changes only planning documents and `TODOS.md`.

## Observations (non-blocking, no threat ID)

1. **Scratch file modes are not uniform.** `attr/inputs-b0.json` and `attr/inputs-b1.json` are mode 600,
   but `attr/inputs-c1.json` (the same balance-bearing shape) is 644, and `~/.cache/quantalyze` and
   `residchurn/` are 755. No plan states a mode, so this contradicts no declared mitigation, and the
   files are outside the repo on a single-user machine. Suggested follow-up: `chmod 600` on
   `attr/inputs-*.json` and on the saved captures, and let `inputs.py` open its output with mode 600
   if the kit is reused (it opens with a plain `open(..., "w")`). Tracked as part of kit reuse, not blocking.
2. **Ignored bytecode under `analytics-service/`.** The replay imports repo modules, so Python wrote
   gitignored `__pycache__` files (mtimes 11-06 20:50 to 20:54 and 11-07 01:57 to 02:03, alongside the
   pytest cache). No tracked or untracked-visible source changed (`git status --porcelain` is empty). The
   "no write under analytics-service/" check holds for source and is stated here for the bytecode.
3. **D-15 is a founder deviation from the pinned rule's reading, not a bent rule.** The attribution of
   record (a 0, b 1142, c 0, d 72) differs from the pinned script's output (b 36, d 1178). The deviation
   is recorded in 202-CONTEXT.md, ROADMAP.md and 202-REPORT.md; the unchanged script (hash equal) and its
   printed output are kept as lineage next to it, and `attr/final-d15.out` shows how the alternative was
   derived (one input filter, same script hash). This satisfies the repo's deviation policy and does not
   undermine T-202-05, T-202-24 or T-202-34, whose mitigation is that the rule is fixed and hashed before
   c1 and shown unchanged.
4. **Lint is pattern-based by design.** It cannot prove a statement read-only against every Postgres
   feature; it is backed here by an independent grep, by the single-statement and SELECT/WITH start
   rules, and by the ledger and job state being unchanged across c1. `202-KIT-RESIDUALS-01` in TODOS.md
   books the four residual kit findings from review round 3 (none is a security finding).
5. **Executor-never-wrote-PROD is evidenced by artifacts, not by a PROD audit log.** No kit script
   contains a DB, HTTP, Railway or Keychain client, every PROD statement was by design the orchestrator's,
   and PROD state across c0 to c1 shows no ledger change and no job outside the nightly. A PROD log was
   out of scope for this audit (no PROD reads).

## Verdict

SECURED. 36 of 36 threats closed, 0 open, 0 blocking. `threats_open: 0`.
