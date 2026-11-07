---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
verified: 2026-11-07T00:00:00Z
status: passed
score: 4/4 must-haves verified (one sub-part of success criterion 3 deferred to Phase 203 by founder decision D-17)
verified_at_sha: 99b40b423d240eb341a9bdf66f1b85a0ead9bb44
drift_subjects:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/nav_marks_apply.py
behavior_unverified: 0
overrides_applied: 0
re_verification: false
deferred:
  - truth: "Book b3's `window_truncated` reason is explained from its stored inputs (RESID-02, success criterion 3, second half)"
    addressed_in: "Phase 203"
    evidence: "ROADMAP Phase 203 B3TRUNC goal: 'Find why book b3 carries window_truncated, using Phase 202's evidence as input'. Founder D-17 (2026-11-07, 'book the investigation as a phase'): b3 is not re-opened in 202, its window_truncated stays unexplained, and no file under analytics-service/ changes."
---

# Phase 202: RESIDCHURN Verification Report

**Phase Goal:** A control capture across a nightly with no deploy in between shows whether stored values move without a code change, each value that moved in 188's re-reading (1214) is attributed to a cause or named as unexplained, and book b3's earlier reasons (`out_of_window_flow`, `window_truncated`) are explained and fixed where they are a defect.
**Verified:** 2026-11-07, HEAD `99b40b423d240eb341a9bdf66f1b85a0ead9bb44` (branch feat/202-residchurn)
**Status:** passed (see "What is deferred to Phase 203" for the one open part)
**Re-verification:** No, initial verification

## Verdict in one paragraph

RESID-01 is fully achieved and independently reproduced. RESID-02 is half achieved in the literal sense and fully achieved as amended by the founder. `out_of_window_flow` is explained from b3's stored inputs and is correct behaviour (nothing to fix, D-13). `window_truncated` is, by the plan's own rule, still `unexplained`, and its investigation is deferred to Phase 203 B3TRUNC by D-17. Because the founder made that deferral, Phase 203 is booked in the ROADMAP with a goal that is exactly the open question, and no defect was found that 202 left unfixed, this is a Step 9b deferral and does not lower the status. I recommend `passed`, with the two bookkeeping cautions in "Warnings" below.

## Goal Achievement

### Observable Truths (ROADMAP success criteria, the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Two PROD captures with the same SQL bracket one nightly, each preceded by the marker query with its answer recorded, and deploy history between them is empty (read under the D-04 content rule). Their diff says whether values move without a code change, and on which scopes. | VERIFIED | c0 (2026-11-06T15:02:09Z) and c1 (final query 2026-11-07T02:59:51Z) both come from the seven `d_*.sql` files. I re-ran `shasum -c SHA256SUMS.d`: 7/7 OK. `gen_sql lint` reads `files=31 violations=0 sha256_d=7/7`; `gen_sql --self-test` ran 32 cases, red-as-expected. `check_capture --kind c1 ...` reproduces `gc-c-check: capture=c1 marker=PRODUCTION checks=4/4 counts=ok n_files=8/8 jobs=idle sql_sha=ok` and `gc-c-nightly: ... matched=26 of 40 ... not_rederived=s3,s4,s6,s7,s9,s10`. `c1/marker.json` and `c1/marker-taken.txt` hold the PRODUCTION answer. `deploy/proof-c0-c1.out`: api and worker `deployments=0 code_diff=empty`, exit 0. I confirmed from git that `git diff --stat 50594c750..ba3c90128 -- analytics-service supabase/migrations` is empty. `attr/c0-c1.out`: `changed_scopes=14 changed=1193`, buckets a 0, b 1106, c 0, d 87. The report's answer ("yes, for ten scopes; the other four straddle worker commits") is supported, and the CR-01 per-side writer table (`codepath/c0c1-writers.out`) was a correct review catch. |
| 2 | Each of the 1214 values from 188's re-reading is attributed to a cause or listed by scope as unexplained. | VERIFIED | `attr/b0-b1-evidence.out`: `gc-c-b01-total: ... changed=1214 ... reproduces_188_16=yes`, `gc-c-b01-bucket-total: a=0 b=1142 c=0 d=72 sum=1214`. Hand-sum: k15 277 + s14 277 + eight 69-row scopes 552 + k38 36 = 1142; s6 31 + s9 24 + s10 17 = 72. I re-ran `final_attribution.py` (sha12 `8a62ca3b1215`, 7/7 self-test) on `attr/b0-b1-evidence.out` + `attr/c0-c1.out` + `c1/groups.json`: output is byte-equal to `attr/final.out` (`gc-c-total: a=0 b=36 c=0 d=1178`, the pinned lineage). `attr/final-d15.out` carries `gc-c-alt-total: ... a=0 b=1142 c=0 d=72 sum_ok=yes`, the record under founder deviation D-15. Every one of the 1214 sits in exactly one bucket, (d) is listed by scope (s6, s9, s10), and the pinned script was not edited. |
| 3a | Book b3's `out_of_window_flow` is explained from its stored inputs; fixed only if a defect. | VERIFIED | Re-ran `b3_replay.py` on c1 with the analytics venv under `-I`: exit 0, output byte-equal to saved `b3/c1.out`. `gc-c-b3-replay: capture=c1 key=k15 inception=false flags=out_of_window_flows:1 reasons=out_of_window_flow trustworthy=false`, `gc-c-b3-xcheck ... replay=1 formula=1 agree=yes`, `gc-c-b3-stored: book=b3 trust=false reasons=out_of_window_flow,window_truncated other_blocking=none`. In the code, `OUT_OF_WINDOW_FLOW` is in `_BLOCKING_REASONS` and `FULL_HISTORY_VENUES = {deribit, mt5}` (line 1144), so Bybit's k15 flow dated before its first return day is counted by the positional rule: correct behaviour, D-13 applies, no fix, and `git diff origin/main...HEAD` touches nothing under `analytics-service/` or `supabase/`. The counterfactual (venue-list extension would not green the book: `inception_unreconciled`, share 0.0082 vs band 0.0001) is reproduced by the replay's second line. |
| 3b | Book b3's `window_truncated` is explained from its stored inputs; fixed where a defect. | DEFERRED (founder D-17) | Not met by the plan's own rule, and recorded as such: `gc-c-b3-verdict: capture=c1 window_truncated=unexplained ...`, `gc-c-b3-d12: reopened=yes reason=component_disagrees`, `gc-c-contingency: fired=yes`, `gc-c-contingency-choice: option=no-fix-override decided_by=founder`. What 202 did establish: `WINDOW_TRUNCATED` is not in `_BLOCKING_REASONS`, b3's own truncation line agrees (`predicted=yes stored=yes agree=yes`, reproduced), and b2, b5, b7 carry it while trustworthy. `unexplained` comes only from book b6 (`predicted=yes stored=no agree=no`), whose omitted key was then closed by the founder as intended (D-14 closed). The plan's prediction rule was not amended. See next section. |
| 4 | Never invent data. | VERIFIED | Every PROD read was read-only (lint: no write verb, no SELECT INTO, function denylist); the report states its 15-significant-digit blind spot, the untested prediction 4, the unproven A1 offset origin and the "(c)=0 by table construction" limit rather than smoothing them. Nothing moved out of (d) without the rule's evidence; the MT5 clock lead is booked, not asserted (D-16). |

**Score:** 4/4 truths verified, counting 3a and 3b under truth 3 as one amended criterion: 3a verified, 3b deferred by the founder to a booked phase.

### What is deferred to Phase 203

RESID-02's second half only: why book b3 carries `window_truncated`. Phase 203 B3TRUNC (ROADMAP line 387) names exactly this and takes 202's evidence as input. The deferral is the founder's (D-17), it is recorded in 202-CONTEXT.md, the ROADMAP and plan 08's SUMMARY, and no code defect was identified that 202 failed to fix: the reason is non-blocking, so b3's untrusted state is owed entirely to `out_of_window_flow`, which is correct. Therefore `passed`, not `human_needed` (no human judgment is outstanding) and not `gaps_found` (the gap is scheduled, not an unaddressed failure).

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | b3 `window_truncated` explained (RESID-02, second half) | Phase 203 B3TRUNC | ROADMAP Phase 203 goal; founder D-17 |

### Required Artifacts

The measurement kit is untracked scratch by design (CONTEXT, `files_modified` marks it so), so the tracked deliverables are the planning documents and TODOS entries.

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `~/.cache/quantalyze/residchurn/{bin,sql,c0,c1,pre,rows,attr,b3,codepath,deploy}` | Scripts and saved outputs | VERIFIED | All present; scripts run and reproduce the saved outputs (see spot-checks). |
| `202-REPORT.md` | Phase report | VERIFIED | 122 lines; every figure I cross-checked matches the saved outputs. |
| `202-0{1..8}-SUMMARY.md` | Eight summaries | VERIFIED | Present; 254 `gc-c-` lines in plan 07's. |
| `202-REVIEW.md`, `202-REVIEW-DISPOSITION.md` | Three review rounds | VERIFIED | Disposition table lists round-3 survivors; none changes a bucket total. |
| TODOS `202-KIT-RESIDUALS-01`, `202-MT5-CLOCK-LEAD-01` | Booked survivors and the D-16 follow-up | VERIFIED | Both present in `TODOS.md` (lines ~1486 and ~1503). |
| ROADMAP Phase 203 | Follow-up phase for D-17 | VERIFIED | Present, goal matches. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| b0/b1 rows | c0 digests | plan 01 `recompute_digest` | WIRED | `reproduces_188_16=yes`; plan 01 `<automated>` passes. |
| `attribute.py` outputs | `final_attribution.py` | `--b01 --c01 --groups` | WIRED | Byte-equal rerun of `attr/final.out`. |
| `b3_replay.py --c1` | repo `allocator_equity_derive` | `-I` + analytics venv | WIRED | Rerun byte-equal to `b3/c1.out`. |
| deploy proof | content diff | `deploy_proof.py` | WIRED | `proof-c0-c1.out` plus my own `git diff`. |

### Data-Flow Trace (Level 4)

Not applicable: no rendered UI. The data chain (PROD MCP read, saved JSON, `chk` md5 verified against PROD's own digest, attribution scripts) was checked end to end through `check_capture` (4/4, 8/8).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SQL kit is read-only and pinned | `gen_sql.py lint $RC/sql`; `shasum -c SHA256SUMS.d` | `files=31 violations=0 sha256_d=7/7`; 7 OK | PASS |
| Lint can fail | `gen_sql.py --self-test` | 32 cases, red-as-expected | PASS |
| c1 capture gate | `check_capture --kind c1 --dir c1 ...` | `checks=4/4 ... n_files=8/8 jobs=idle sql_sha=ok`, exit 0 | PASS |
| Pinned attribution reproduces | `final_attribution.py` on saved inputs | byte-equal to `attr/final.out`; self-test 7 cases ok | PASS |
| Attribution of record | `attr/final-d15.out` | a 0, b 1142, c 0, d 72, sum_ok | PASS |
| b3 replay | `b3_replay.py` (venv python, `-I`) on c1 | byte-equal to saved `b3/c1.out`, exit 0 | PASS |
| Blocking-reason claims | read `allocator_equity_derive.py:181-200`, `:1144` | `OUT_OF_WINDOW_FLOW` blocking, `WINDOW_TRUNCATED` not, venues `{deribit, mt5}` | PASS |
| Code identity for the ten OKX/Bybit scopes | `git diff --stat 50594c750 ba3c90128 -- analytics-service supabase/migrations` | empty | PASS |
| Four MT5 scopes straddle code | `git log 099a9f166947..ba3c90128 -- analytics-service supabase/migrations` | 8 commits (#1190, #1193, #1194, #1196, #1197, #1200, #1202, #1205) | PASS (matches report) |
| No code changed in 202 | `git diff --name-only origin/main...HEAD` outside `.planning/` | only `TODOS.md` | PASS |
| All plan `<automated>` verifies | 18 blocks extracted from 8 PLAN files, run from the worktree | 18/18 exit 0 | PASS |

### Probe Execution

No `probe-*.sh` declared or present for this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| RESID-01 | 01, 02, 04, 05, 06, 07 | Control capture across a nightly with no deploy shows whether values move without a code change; each of the 1214 attributed or unexplained | SATISFIED | Truths 1 and 2. |
| RESID-02 | 01, 03, 06, 07, 08 | b3's `out_of_window_flow` and `window_truncated` explained, fixed where a defect | PARTIAL, as amended by D-17 | `out_of_window_flow` SATISFIED (correct behaviour, no fix); `window_truncated` deferred to Phase 203 by the founder. |

Both IDs appear in PLAN frontmatter (plan 01: both; 02, 04, 05: RESID-01; 03: RESID-02; 06 and 07: both; 08: RESID-02) and in REQUIREMENTS.md (lines 55-56, traceability lines 108-109). No orphaned IDs.

### Anti-Patterns Found

None blocking. The only tracked non-planning change is `TODOS.md`. No code under `analytics-service/` or `supabase/` changed, so the debt-marker gate has nothing to scan; the `TBD` stub in ROADMAP Phase 203 is the allowed `/gsd-phase --insert` form (hygiene rule 6e, phase has no plan rows).

## Warnings (non-blocking, for the orchestrator's judgment)

1. **RESID-02 traceability will over-claim if ticked.** REQUIREMENTS.md maps RESID-02 to Phase 202 only, and Phase 203 lists `Requirements: TBD`. When 202 completes, marking RESID-02 `Complete` would hide that its second half is open. Suggest keeping it Pending until 203 closes, or mapping RESID-02 to 203 as well, so the deferral stays visible in the one place requirements are read.
2. **The (b) bucket depends on a post-hoc mark-day cut that the REPORT does not mention.** In plan 02 the executor saw the literal offset test fail (cv 5.0e-02 for k15 and s14, 1.4e-01 for the OKX five), then cut each stretch at the key's first mark day `S` (cv 1e-9 to 1e-12). The 202-02-SUMMARY discloses it (Deviations; sensitivity: under the literal reading (b) would be 36 and (d) 1178 for 899 rows), and the cut is mechanistically justified by `nav_marks_apply.py` rule 2 (days before `S` keep their realized value, which I confirmed in the module docstring). But `202-REPORT.md` explains the 1142 vs 36 split only through D-15's "undefined one-day stretch" and omits the larger sensitivity. A reader of the REPORT alone sees one founder decision where there are two judgments. Not a gap (attribution is honestly labeled, A1 is stated as unproven), but worth one sentence in the REPORT.
3. **`window_truncated` evidence in 202 arguably already supports an explanation.** With D-14 closed as intended, the b6 disagreement that keeps b3's verdict `unexplained` is itself explained (an unknown-account departed key excluded by default). b3's own line agrees, and the reason is non-blocking. Phase 203 may therefore be short. This is an observation, not a defect: the founder chose to book the investigation, and plan 03's rule was deliberately not amended.
4. **Four kit residuals are booked, not fixed** (`202-KIT-RESIDUALS-01`): `not_rederived` ignores job status, the judge's `reason=` token is a fixed string, the gate proves job completion not a write, and unjobbed scopes are invisible to coverage. None changes a 202 number (all 47 c1 jobs are `done`, every judge TABLE kind is None). They matter only on reuse of the kit.
5. **Prediction 4 is untested, not held** (corrected in review round 2). s6, s9 and s10 were never re-derived between c0 and c1, so their "quiet" control reading means only "no job wrote them". The report says this plainly.
6. **Measurement precision limit.** All values are compared at 15 significant digits on both sides (PROD MCP rendering). 188's 1214 is a count at that precision. Stated in the REPORT's Limits.

## Human Verification Required

None. The remaining decisions (D-14 to D-17) were made by the founder and are recorded.

## Gaps Summary

No gaps. RESID-01 is complete and reproduces from the scripts and saved outputs. RESID-02's `out_of_window_flow` half is complete and `window_truncated` is a founder-scheduled deferral to Phase 203, carried by the `deferred:` entry above.

---

_Verified: 2026-11-07_
_Verifier: Claude (gsd-verifier)_
