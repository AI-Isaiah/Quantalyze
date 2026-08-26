---
phase: 163-harden-fail-safe-closed-and-loud
verified: 2026-08-26T18:45:00Z
status: gaps_found
score: 12/13 requirements MET at HEAD (OPS-08 MET-AT-MERGE by construction)
behavior_unverified: 0
overrides_applied: 0
supersedes: >-
  The pre-fix-round verdict written earlier on 2026-08-26 at `af93ad8dd`. That verdict
  is RETIRED, not amended: it predates 33 dispositioned findings (19 from `163-REVIEW.md`,
  14 from a three-reviewer re-audit of the OPS-08 migration and its gate), including two
  BLOCKERS (CR-01/CR-02, a live HMAC-signature leak) that were open when it was written
  and are closed here. Two of its three gaps are closed at HEAD; one is partly closed;
  its `coincidental_reliance` advisory is closed; and it did not see WR-10.
  ONE FILE, ONE CURRENT TRUTH — this document replaces it entirely.
verification_method: >-
  Goal-backward, run against HEAD `a81deb13b` on branch `feat/v1.20-phase-163-harden`
  (working tree clean; merge-base with origin/main `640baf8fb`). Every verdict rests on
  code read at HEAD plus a command this verifier ran itself. No verdict rests on a
  SUMMARY claim; where a SUMMARY and the code disagree, the disagreement is recorded as a
  finding. Commands executed: `npx tsx scripts/check-planning-hygiene.ts` (exit 0, 5712
  files); an INDEPENDENT NUL-safe latin1 scan of all 5712 tracked files for the
  local-identity token, needle derived at runtime from the home-directory basename
  (0 files / 0 occurrences); `npm run lint` (0 errors, 3 pre-existing warnings, all in
  files outside this phase's diff); `npm run typecheck` (exit 0); 16 vitest files
  (521 tests, 1 skipped, 0 failures); 7 pytest files in `analytics-service/`
  (173 tests, 0 failures); a byte-exact debt-marker scan over the 78 non-planning files
  in the phase diff (0 new markers on added lines); and a mechanical comment-only proof
  on both edited applied migrations.
database_facts_taken_as_read: >-
  No database was reachable from this worktree. The deployed-function facts below are the
  requester's own read-only catalog reads of 2026-08-26, attributed as such and NOT
  independently re-measured here: TEST and PROD both carry a 10-param overload with four
  `INTO STRICT` re-reads and NO `Phase 163 OPS-08` catalog marker (migration unapplied);
  both 7-param overloads carry `serialization_failure` + the retired-kind branch +
  SECURITY DEFINER; `proconfig` is exactly `{"search_path=public, pg_catalog"}`; `anon`
  and `authenticated` hold no EXECUTE, `service_role` does; `_assert_no_public_execute`
  exists; PROD's 7-param carries one `INTO STRICT` inside a COMMENT (comment-stripped: 0)
  and TEST runs a comment-stripped build of the same function (DRIFT-01).
gaps:
  - truth: "OPS-08 — the DEPLOYED 10-param `_enqueue_compute_job_internal` no longer uses `INTO STRICT` on its lost-race branches"
    status: partial
    reason: >-
      MET-AT-MERGE BY CONSTRUCTION, and un-MET-able before it. The requirement is worded
      as a property of the deployed function. The fix is a forward-only migration that
      no database has received, so TEST and PROD still run all four strict re-reads.
      Merging `supabase/migrations/**` to main auto-applies to PROD, so the merge of this
      PR is the event that makes the requirement true. Withholding the merge cannot
      advance it. NOT A SHIP BLOCKER — see the Overall Verdict.
    artifacts:
      - path: "supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql"
        issue: "Unapplied on TEST and PROD. Self-verifying on apply (the trailing DO block RAISEs and aborts the deploy on a bad end state), idempotent, three-reviewer re-audited (14 findings closed at ef4d9d3f8)."
      - path: "supabase/tests/test_enqueue_internal_destrict.sql"
        issue: >-
          The Part 1+3 arm prints `SKIP (Part 3)` and exits 0 on a COHERENT pre-apply
          database (`:632`). Verified against `ci.yml:1366-1420`: the whole-file anti-SKIP
          net keys on a marker STARTING `SKIP:`, which `SKIP (Part 3):` does not match.
          So the `sql-tests` lane is GREEN today and no CI signal will ever redden to
          report that the migration was never applied. Deliberate and well-argued
          (first-failure blast radius, this file sorts ~30th of ~70) — but the tracking
          of the unapplied state is prose alone.
    missing:
      - "Merge to main so the PROD auto-migrate applies 20260826150000, then re-read the deployed body and tick OPS-08 by measurement."
      - "Hand-apply to the TEST project so `sql-tests` prints `OPS-08 Part 1+3 OK` instead of `SKIP (Part 3)` — otherwise the recurring gate stays half-armed on TEST forever."
  - truth: "Every finding this phase's own review raised is either FIXED or RECORDED"
    status: failed
    reason: >-
      WR-10 is dispositioned NOWHERE. 18 of the 19 `163-REVIEW.md` findings are closed in
      code or booked in TODOS.md; WR-10 is not fixed, not booked, not accepted, and not
      mentioned in the SEC-01 requirement entry. A repo-wide grep for `WR-10` returns only
      the review file itself and unrelated same-ID findings from phases 140.4 and 158.
      The review named the remedy AND the fallback ("if the founder prefers to defer,
      record the deferral as an accepted risk"); neither happened.
    artifacts:
      - path: ".planning/phases/163-harden-fail-safe-closed-and-loud/163-REVIEW.md"
        issue: ":598-621 — SEC-01 closes with a 6-character, no-character-class password floor on a platform that custodies decryptable exchange API keys, and GoTrue leaked-password protection is unaddressed. The phase MEASURED this floor and mirrored it; it did not raise it."
      - path: ".planning/REQUIREMENTS.md"
        issue: "SEC-01's five recorded points cover the reading, the method, the enforcement locus and the drift-proofing limit. None of them records WR-10's substantive concern or a decision about it."
    missing:
      - "A founder decision, recorded in the SEC-01 entry or TODOS.md: raise the hosted minimum (10-12) and enable leaked-password protection, OR accept the 6-char floor as a named, dated risk."
  - truth: "The project's own ledger and backlog describe what this phase achieved"
    status: partial
    reason: >-
      The traceability table was corrected at 040c66ae3 and is now right. Three residues
      survive, plus two stale narratives. Bookkeeping, not code — but on a phase whose
      goal clause is "fail loud", a ledger that reads Not started for landed, tested work
      is the same class of defect the phase exists to close.
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: >-
          Checkbox/traceability disagreement inside one file. OPS-06 (`:66`), OPS-09
          (`:72`), SEC-02 (`:92`), SEC-04 (`:107`) and SEC-05 (`:108`) read `- [ ]` while
          their traceability rows read `Complete`. Every other Complete v1.20 requirement
          is `- [x]`. (OPS-08's `- [ ]` at `:71` is CORRECT and deliberate.)
      - path: ".planning/ROADMAP.md"
        issue: >-
          `:515` — the v1.20 Progress table still reads `163. HARDEN reliability +
          security | 0/? | Not started | -`, contradicting `:82` (`- [x]`) and `:379`
          (`9/9 plans executed`) in the same file. `:528` — the Requirement Coverage row
          for 163 lists 12 IDs, omitting HONEST-08, which `:367` and the REQUIREMENTS
          traceability table both assign to this phase.
      - path: "TODOS.md"
        issue: >-
          `:1122-1152` — the WR-07 entry still reads as owed work (`[WR-07-TS] Branch the
          enqueue-failure copy on SQLSTATE in csv-finalize/route.ts`) and asserts
          "measured: ZERO quoted '40001' anywhere in src/**". FALSE at HEAD: that branch
          is implemented at `src/app/api/strategies/csv-finalize/route.ts:2044`. The
          migration's prose WAS retired (61d1dadc1, `:63` now reads `✅ CLOSED: WR-07`);
          the backlog ground truth was not.
      - path: ".planning/phases/163-harden-fail-safe-closed-and-loud/163-06-SUMMARY.md"
        issue: >-
          Stale as merged, and it disagrees with the code. `:190` claims `Gate RED
          pre-apply / GREEN post-apply | PASS`; `:197-201` claims "CI's `sql-tests` lane
          will be RED for this file until someone applies 20260826150000 to the TEST
          project by hand". The merged gate is a both-or-neither COHERENCE assertion that
          is GREEN pre-apply. The SUMMARY was written at d6e5c4507; the file was reshaped
          at eb27e5ada and again at ef4d9d3f8, both after it.
      - path: ".planning/STATE.md"
        issue: "`:8` embeds the superseded verdict verbatim (`verification gaps_found 12/13, OPS-08 code-complete but UNAPPLIED`). Correct as of that reading; it now points at a retired document."
    missing:
      - "Tick the five REQUIREMENTS checkboxes; leave OPS-08 unticked with its reason."
      - "Set the ROADMAP progress row to `9/9 | Complete | 2026-08-26` and add HONEST-08 to the 163 coverage row."
      - "Mark the TODOS WR-07 entry ✅ RESOLVED with the HEAD coordinate, keeping the analysis (it is what stops the defect being re-derived in SQL)."
      - "Add a dated addendum to 163-06-SUMMARY recording the eb27e5ada / ef4d9d3f8 reshape, or correct the two rows."
deferred: []
behavior_unverified_items: []
coincidental_reliance_items: []
human_verification:
  - test: "Decide WR-10 — the hosted password floor."
    expected: "Either the hosted minimum is raised (10-12) with leaked-password protection enabled and `MIN_PASSWORD_LENGTH` + its recorded reading moved in the same commit, or the 6-character floor is recorded in `.planning/REQUIREMENTS.md` SEC-01 as a dated, accepted risk with the reason."
    why_human: "Dashboard-owned setting with no repo representation, and a risk-acceptance call. No test in this repo can read or change it."
    result: "DECIDED 2026-08-26 by the founder: the six-character floor is ACCEPTED. Recorded as ACCEPTED RISK in TODOS.md and qualified at SEC-01. The reading (min length 6, no character-class rule) stands as a point-in-time endpoint probe, never an invariant — it is a dashboard-owned setting with no repo representation and can change outside git."
  - test: "After merge to main, confirm the PROD auto-migrate workflow applied `20260826150000` and re-read the deployed body."
    expected: "`pg_get_functiondef` on the 10-param overload shows zero `INTO STRICT` lost-race re-reads and one `serialization_failure` raise; `obj_description` carries the phrase `Phase 163 OPS-08`."
    why_human: "PROD apply is founder-gated and happens on merge; no lane in this worktree can observe it. The migration's own trailing DO block aborts the deploy if the end state is wrong, so a green deploy is itself evidence — but read the body anyway before ticking OPS-08."
    result: "PASSED 2026-08-26 — the Supabase Migrate workflow concluded success on the merge commit and the effect was VERIFIED BY DIRECT MEASUREMENT rather than by the workflow exit code. PROD 10-param `_enqueue_compute_job_internal`: INTO STRICT lost-race re-reads 4 -> 0, plain re-reads 4, `serialization_failure` raise absent -> present, OPS-08 marker comment absent -> present, anon EXECUTE false (held), service_role EXECUTE true (held). The 7-param control overload was unchanged, proving the migration hit exactly its target."
  - test: "Hand-apply `20260826150000` to the TEST project, then run the `sql-tests` lane."
    expected: "`test_enqueue_internal_destrict.sql` prints `OPS-08 Part 1+3 OK: the deployed 10-param body carries no strict lost-race re-read, does raise serialization_failure on an exhausted one, and its catalog COMMENT still carries the revert-discriminator marker.` — not `SKIP (Part 3)`."
    why_human: "Requires the TEST database URL, a CI secret with no representation in this worktree. No automated lane applies migrations to TEST. Until this happens, Part 3 is withheld on every CI run."
---

# Phase 163: HARDEN — Fail safe, closed, and loud — Verification Report

**Phase Goal:** The backend fails safe, closed, and loud — secrets cannot reach logs,
monitors cannot report false health, committed work cannot 500, and every mutating or
compute-heavy surface is limited and audited.

**Verified at:** `a81deb13b` (`feat/v1.20-phase-163-harden`, working tree clean)
**Status:** gaps_found
**Re-verification:** Yes. This document **supersedes and replaces** the verdict written
earlier the same day at `af93ad8dd`, which is retired rather than amended. That verdict
predates the fix round: it was written while CR-01 and CR-02 — a live HMAC-signature leak
— were still open, before the WR-01 username countdown reached zero, before three
blind-monitor arms learned to page, before the portfolio-optimizer refund was removed,
before WR-07 was fixed in TypeScript, before `src/lib/observability.ts` was deleted, and
before the OPS-08 gate absorbed 14 re-audit findings. Its own advisory (an undeclared
`returns_series` date-ordering precondition) is closed. Its list of open items is no
longer accurate in either direction — two of its three gaps are closed, and it never saw
WR-10.

---

## Per-Requirement Verdicts

Each row states the PROMISE from `.planning/REQUIREMENTS.md` / `.planning/ROADMAP.md`
(never from a SUMMARY), the EVIDENCE found at HEAD with `file:line`, and a verdict.

| # | Req | Promise (from the requirement, not the SUMMARY) | Evidence at HEAD | Verdict |
|---|-----|---|---|---|
| 1 | **OPS-05** | The structlog frozen-proxy class is fixed at the CLASS level — no module-level proxy can bind a pre-`configure_logging` chain that skips `_redact_processor`. Mode A source-scan gate + Mode B behavioral redaction test, each RED-demonstrable. | `analytics-service/main.py:67` and `main_worker.py:91` both call `configure_logging()` at MODULE scope above every first-party import. Chain at `services/logging_config.py:48-105`. ⭐ **The blocker fix is real and I read it:** `_scrub_rendered_in_place` (`:124-197`) renders the line via `record.getMessage()` FIRST and scrubs the result, closing CR-01 (a bare `exc` arg is not a `str`, so the per-arg loop never touched it and `getMessage()` stringified it AFTER redaction — ten non-test sites including the signed ccxt permission probes at `services/key_permissions.py:133/165/213`) and CR-02 (a scrubbed `%`-template ate its conversion specifier, so stdlib dropped the record; the prior revert-to-template "fix" emitted the bare credential arg in plaintext). Regressions are named and paired: `tests/test_stdlib_redact_bridge.py:445` (CR-01 headline), `:476` (pins it is the non-`str` path, so "wrap callers in `str()`" does not satisfy it), `:495` (CR-02), `:519` (a clean record keeps its template and args unbaked — the IN-04 double-format bound). Mode A `tests/test_structlog_frozen_proxy.py:661-767`, Mode B `:212-341`, negative control `:343-372`, entrypoint ordering `:443-499`. **Ran:** 10 + 22 tests pass. | ✓ **MET** — see O-3 |
| 2 | **OPS-06** | `createAdminClient()` cannot throw on the request path after an irreversible commit — the class closed at all three known sites. | Hoisted above the commit at all three: `src/app/api/preferences/route.ts:217`, `src/app/api/account/deletion-request/route.ts:122`, `src/app/api/strategies/csv-finalize/route.ts:776`, each with a docblock at `:201`/`:107`/`:758` naming the inline-argument form it replaced. **Independently measured:** a repo-wide grep for `logAuditEvent*(createAdminClient()` returns zero hits. The two remaining `createAdminClient()` calls in csv-finalize (`:1875`, `:2032`) are inside `after(...)` post-response side effects, each already inside a `try/catch` — off the request path by construction. **Ran:** the three route specs pass (ordering assertions included). | ✓ **MET** |
| 3 | **OPS-07** | Flag-monitor honesty — a failed monitor read PAGES instead of logging success, and the integration test actually falsifies it. ⚠️ AMENDED 2026-08-26: the `checkStuckNotifications` clause is closed BY DELETION. | The amendment is honoured, not narrated: `src/lib/observability.ts` **does not exist** at HEAD, and a repo-wide grep for `checkStuckNotifications` and for `observability` in `knip.json` returns nothing — the module, its test, its byte-gate fixture and the knip entry-point declaration are all gone. WR-11's finding (three guards protecting code nobody called) is closed at the root. The surviving clause is stronger than the requirement asks: `MONITOR_FAILURE_STATUS = 503` (`src/app/api/cron/flag-monitor/route.ts:145`) routed through one `monitorReadFailed` helper (`:161-201`, Sentry capture **awaited**), and ALL FOUR blind arms now use it — the two denominator arms plus the three numerator arms WR-02 found still logging green: fetch threw (`:263`), non-ok Sentry response (`:295`, where a rotated auth token lands), and missing credentials (`:572`). The `denominator_read_failed` tag is kept verbatim (`:180-185`) so existing Sentry filters keep matching. **Ran:** `tests/integration/cron-flag-monitor.test.ts` passes. | ✓ **MET** (as amended) — see O-1 |
| 4 | **OPS-08** | The 10-param `_enqueue_compute_job_internal` no longer uses `INTO STRICT` on its lost-race branches (parity with the de-STRICT-ed 7-param overload). | Repo half complete: `supabase/migrations/20260826150000…sql:362-383` (four plain `SELECT id INTO v_new_id`) + `:431-432` (one `RAISE … USING ERRCODE = 'serialization_failure'`). ACL re-converged (`:462-470`), catalog marker written (`:510-521`), self-verifying DO block (`:600-880`) that aborts the deploy on a bad end state. **Deployed half absent:** TEST and PROD both still carry four strict re-reads and no marker. | ⚠️ **MET-AT-MERGE** — see the dedicated section |
| 5 | **OPS-09** | The resync draft pre-check is deterministic (`ORDER BY created_at DESC` + bounded window). | `analytics-service/routers/process_key.py:765` (`_RESYNC_DRAFT_RESUME_WINDOW = timedelta(hours=8)`), `:1476` cutoff, `:1483` `.gte("created_at", …)`, `:1484` `.order("created_at", desc=True)`, `:1485` `.limit(1)`. Both halves present; neither is decorative. **Ran:** `test_resync_precheck_determinism.py` + `test_resync_draft_dedup.py` pass. | ✓ **MET** |
| 6 | **OPS-10** | The retry loop cancels abandoned response bodies (`body.cancel()`). | `src/lib/resilient-fetch.ts:2260` (`cancelAbandonedBody`, full capability ladder) called at `:2759`. I read the surrounding control flow to confirm the call sits INSIDE the retry branch and immediately before `continue` (`:2760`) — the two fall-throughs (D-01 fail-fast, last-attempt surrender) return the response with its body intact, and `instrumentBody` still wraps the returned one. **Ran:** `resilient-fetch.retry.test.ts` passes. | ✓ **MET** |
| 7 | **SEC-01** | The server-side password policy is verified and enforced — client `minLength={6}` is backed by an explicit Supabase-side policy, documented. Recorded as a point-in-time READING, never an invariant. | `src/lib/auth/password-policy.ts` carries one exported `MIN_PASSWORD_LENGTH = 6` with the value, the date and the probe method in its docblock; both forms derive `minLength` AND their user-facing copy from it (`SignupForm.tsx`, `ResetPasswordForm.tsx`). `password-policy.test.ts` pins value drift AND site drift by scanning both sources, with three neuters recorded RED and restored. The requirement's five points explicitly rule out `supabase/config.toml` as evidence. **Ran:** passes. | ✓ **MET on the amended standard** — ⚠️ but see the WR-10 gap and O-2 |
| 8 | **SEC-02** | Tracked docs carry no local absolute paths / macOS username; verified by a NO-ALLOWLIST scan (gitleaks' allowlist is path-based and blind here). | ⭐ **Independently measured by this verifier, not read from a SUMMARY.** A NUL-safe `latin1` scan of all **5712** tracked files, needle derived at runtime from the home-directory basename: **0 files, 0 occurrences.** The WR-01 countdown (940 → 2 → 0) has reached zero — the two base64-encoded residues in the scanner and its own test are gone, because the needle is now DERIVED rather than stored (`scripts/check-planning-hygiene.ts:221-260`), and the third file found later is closed too. The gate is no-allowlist by construction and its own spec proves it fails in both directions, including `src/__tests__/check-planning-hygiene.test.ts:151` ("still flags a real path in a file that a path allowlist would exempt") and the NUL-byte arms at `:270-296`. Wired at `package.json:11` → `frontend-lint` → the blocking `frontend` aggregator's `needs:` (`.github/workflows/ci.yml:804`). The two applied-migration edits are mechanically proven comment-only (diff filtered to non-`--`, non-blank lines is EMPTY on both) and each carries a `⚠️ RECORDED EXCEPTION` header at `:4`. **Ran:** the gate (exit 0) and `npm run lint` (0 errors). | ✓ **MET** — bounded by O-4 |
| 9 | **SEC-03** | `add_wizard_composite_key` is policed by the audit-coverage gate — the pragma-vs-real-emission decision made and RECORDED. | Allowlist entry `src/__tests__/audit-coverage.test.ts:217`; pragma + call at `src/app/api/strategies/composite/add-key/route.ts:477-481`. The decision is recorded as five numbered points in `.planning/REQUIREMENTS.md` SEC-03, including the control run that MEASURED the escape (name unlisted ⇒ deleting the pragma left the gate GREEN, 17 passed) and the same deletion turning it RED once listed. Both directions observed. **Ran:** passes. | ✓ **MET** |
| 10 | **SEC-04** | Bridge + portfolio-optimizer get a named `bridgeComputeLimiter` sized to backend reality, ⛔ without resizing the shared `userActionLimiter`. | `src/lib/ratelimit.ts:293` (`makeLimiter(10, "3600 s")`) with the measured derivation above it; consumed at `src/app/api/bridge/route.ts:94` and `src/app/api/portfolio-optimizer/route.ts:121`. **Prohibition holds:** `src/lib/ratelimit.ts:97` `userActionLimiter = makeLimiter(5, "60 s")`, unchanged. ⭐ **WR-03 closed at the root:** the "symmetric token refund" is REMOVED, not narrowed — `src/app/api/portfolio-optimizer/route.ts:141-192` records why (`@upstash/ratelimit` offers only `resetUsedTokens`, which DELETES every store key matching the identifier — a whole-window reset, not a decrement, so every 5xx handed the caller a fresh hour and re-opened the exact DoS the limiter was added to close). A repo-wide grep confirms no `resetUsedTokens` call survives on either route, and `:192` carries a ⛔ not-to-re-add note. Roster pin captures limiter IDENTITY per site under a strict `toEqual`. **Ran:** three specs pass. | ✓ **MET** |
| 11 | **SEC-05** | The tenth IP-keyed route (`simulator.py`) is repaired along with the test whose wrapper-check conceals it — equality assertion, quarantine shrinks to 0. | `analytics-service/routers/simulator.py:244` now decorates with `partial(tenant_or_platform_key, scope="simulator")`; `_simulator_rate_limit_key` was DELETED, not merely unwired (only a tombstone comment at `:79` remains). `tests/test_limiter_identity.py:138` `EXPECTED_CLASS_SIZE = 10`, `:159` `IP_KEYED_QUARANTINE = frozenset()`, `:545` `assert offenders == IP_KEYED_QUARANTINE` — equality retained on purpose. IN-05's premise (that production sends no tenant claim) was measured FALSE and the five comments resting on it corrected at 0a941794b; the in-handler per-user check was kept and re-based on the durable reason. **Ran:** 141 tests across four affected files pass. | ✓ **MET** |
| 12 | **SEC-06** | Removing a panel mid-validate aborts the in-flight credential-carrying POST. | `MultiKeyConnectStep.tsx:1134-1150` — `doRemove` resolves the panel from `panelsRef.current[idx]`, sets abort reason `"user"` keyed on `p.id`, aborts that controller, and then **filters by `panel.id`**. ⭐ WR-09 made this stronger than the requirement asks: the old code aborted by identity but removed by POSITION from a different snapshot, and the MEASURED consequence was the wizard deleting keys 1 and 3 when the user clicked 1 and 2 — destroying credentials for a key the user never touched. An unresolvable index now THROWS (`:1136-1142`) instead of silently no-opping. **Ran:** `MultiKeyConnectStep.test.tsx` passes. | ✓ **MET** |
| 13 | **HONEST-08** | The public discovery "Synced Nd ago" badge buckets on the **staler** of sync- and series-recency, mirroring `FreshnessChip`. ⛔ Not by deleting the badge, ⛔ not via the `is_example` gate; test on a REAL published row, RED under neutering. | One shared resolver, `src/lib/freshness.ts:198-224` (`resolveEffectiveRecency`) — the series binds only when its verdict is STRICTLY worse, and `unknown` caps `fresh`→`warm` without softening a known-bad sync age. Consumed only by `src/components/strategy/SyncBadge.tsx:98`, whose `seriesEnd: string \| null` (`:20`) is REQUIRED, so no mount can omit it. **Data flow traced end-to-end:** `src/lib/queries.ts:321` projects `series_end:returns_series->-1->>date` as a scalar (the array never reaches an anon reader) → `withResolvedSeriesEnd` (`:525`) / `seriesEndOf` (`src/lib/utils.ts:221`) → all four live mounts (`StrategyTable.tsx:1181`, `StrategyGrid.tsx:118`, `StrategyBreakdownTable.tsx:212`, `CompositionDonut.tsx:111`; `StrategyHeader.tsx:22-25` records itself as unmounted per IN-01). The public surface `src/app/browse/[slug]/page.tsx:38,63` mounts `StrategyTable` off `getStrategiesByCategory` — the query carrying the new column. WR-06 closed the one boundary the "shared ladder" had not shared: a future-dated point now maps to `warm` (`freshness.ts:148`) matching the chip's `future` bucket, instead of `stale`. Spec `SyncBadge.staler-of-two.test.tsx` drives real published-row fixtures through both mount paths with the neuter and restore recorded. **Ran:** passes. | ✓ **MET** |

**Score: 12/13 MET at HEAD. OPS-08 is MET-AT-MERGE by construction.**

---

## OPS-08 — the explicit verdict the ship gate turns on

**The state, stated plainly.** The migration is written, three-reviewer re-audited
(14 findings closed at `ef4d9d3f8`), idempotent, self-verifying on apply, and proven on a
scratch Postgres 16. **No database has received it.** TEST and PROD both still run a
10-param `_enqueue_compute_job_internal` carrying all four `INTO STRICT` lost-race
re-reads, with no `Phase 163 OPS-08` catalog marker. The requirement is worded as a
property of the DEPLOYED function. **It is therefore NOT MET at HEAD, and it could not
have been.**

**Why it cannot become MET before the merge.** Merging `supabase/migrations/**` to main
auto-applies to PROD. That is the only automated apply path this project has. So the merge
of this PR is the event that makes the requirement true; there is no ordering in which
OPS-08 is MET first and merged second. Holding the PR to "close the gap" does not close
it — it prevents it from closing.

**Is a requirement in that state a blocker for shipping THIS PR? No.** Reasons, in order
of weight:

1. **Blocking is causally backwards.** The merge is the remedy. Withholding it leaves PROD
   raising `P0002 NO_DATA_FOUND` on every lost enqueue race and surfacing an opaque 500 —
   the exact defect OPS-08 exists to remove — indefinitely.
2. **The apply fails loud, not silent.** The migration's trailing DO block asserts its own
   end state and `RAISE`s — including on a missing catalog marker
   (`20260826150000…sql:868`) and on a surviving strict re-read (`:766`). A bad apply
   aborts the PROD deploy visibly rather than half-landing.
3. **The known deploy hazard was measured, not assumed.** PROD's 7-param carries
   `INTO STRICT` inside a COMMENT, and the parity arm is an ABSENCE arm — so the
   comment-strip is load-bearing on PROD specifically. Comment-stripped, PROD reads 0.
   The arms were measured green on both databases before this PR was assembled.
4. **The ACL is re-converged before it is asserted** (`:462-470`), deliberately, so a
   Supabase default-grant event trigger firing on the `CREATE OR REPLACE` cannot turn an
   unrelated security condition into a failed production deploy while leaving the gap open.

**What a human must accept to ship.** Exactly two things, and they should be said out
loud rather than absorbed:

- **OPS-08 stays unticked until the deployed body is measured.** `163-06-SUMMARY.md`'s
  refusal to tick it is the right call and this verification endorses it. Do not close the
  requirement on the strength of a green deploy alone — read `pg_get_functiondef`.
- **The recurring gate is half-armed on TEST until someone hand-applies the migration
  there.** Part 3 is withheld on every CI run today, and `SKIP (Part 3)` exits 0. Nothing
  will ever go red to remind you. Book the TEST apply as an owned action, not a hope.

**What is NOT a reason to block:** the four routed OPS-08 follow-ups (`OPS-08-TS`
`TODOS.md:1047`, `F2` `:1060`, `F9` `:1069`, `F8` `:1078`) and `DRIFT-01` (`:1086`). Each
is recorded with its measurement and its remedy; none is user-facing or data-integrity at
HEAD; and `OPS-08-TS`'s user-visible half was closed inside this phase (WR-07, below).

---

## Gate Falsifiability Audit

This phase added and then hardened several gates. For each: **can it ever go RED, and can
I identify the failure mode by reading it?**

| Gate | Can it fail? | Failure mode I could identify by reading | Assessment |
|---|---|---|---|
| `scripts/check-planning-hygiene.ts` | **Yes** | One unescaped home-path prefix or username occurrence in any tracked file → exit 1. Its own spec injects a violation into a path a path-allowlist would exempt (`:151`), so *adding* a carve-out reddens too. NUL-byte and EMPTY-SCAN arms both pinned. Needle now derived at runtime, so the scanner no longer needs a self-exemption. | ✓ **Strongest gate in the phase.** Verified failing in both directions by its own spec; verified passing by two independent scans (its own, and mine). |
| Mode A — module-scope `.bind()` AST scan | **Yes** | Reports `relpath:lineno`; recorded RED demo M3. WR-05 broadened the walk beyond direct module-body assignments; the probe at `:573-644` carries six shapes and three deliberately-deferred lines. Anti-vacuity: ≥90 modules AND five named anchor modules must be reached. | ✓ Real. Still narrower than its name — see O-3. |
| `TestEntrypointOrdering` | **Yes** | Sinking `configure_logging()` below the first-party imports in either entrypoint reddens by name. Two anti-vacuity guards (the call must exist; the anchor import must be found). | ✓ Strong. |
| CR-01/CR-02 regression pairs | **Yes** | `:445` reverts to per-arg-only scrubbing → the HMAC survives. `:476` is the anti-"fix it by wrapping callers in `str()`" pin. `:519` reddens if the scrub bakes every record (the IN-04 cost bound). Each names the mechanism it would catch. | ✓ Strong — and paired, which is what stops a cosmetic fix passing. |
| `test_enqueue_internal_destrict.sql` Parts 2 / 4 / 5 / 6 | **Yes** | Arm count (form-agnostic, `<> 4` equality), 7-param parity, retired-kind admission branch, SECURITY DEFINER, `search_path` VALUE, and the ACL on both overloads. All live in BOTH pre- and post-apply states — so most of the file is armed today. Absent overload now RAISEs (`:529`) rather than skipping; an unreadable body RAISEs (`:557`). | ✓ |
| `test_enqueue_internal_destrict.sql` Part 1+3 | **Partly, and I can name exactly where it stops** | RAISEs on incoherent (`:605`, `:607`), on no-strict-no-raise (`:609`), on REVERT — pre-fix body **with** marker (`:611`, the WR-04 discriminator), on HYBRID counts 1..3 (`:629`), and on marker-dark-but-fixed (`:647`). It does NOT fail on the coherent pre-fix state: `:632` prints `SKIP (Part 3)` and continues. | ⚠️ Deliberate, argued at `:57-141`, and I verified the consequence rather than taking it on trust: `ci.yml:1366-1420` keys the whole-file anti-SKIP net on a marker STARTING `SKIP:`, which `SKIP (Part 3):` does not match. **So the lane is GREEN and no CI signal will ever report the unapplied state.** Recorded in the OPS-08 gap. |
| `audit-coverage.test.ts` SEC-03 entry | **Yes** | Control run recorded in the requirement: unlisted ⇒ deleting the pragma left it GREEN (17 passed); listed ⇒ the same deletion turns it RED naming `composite/add-key/route.ts:477`. Both directions observed 2026-08-26, restore hash-verified. | ✓ Strong — the entry is what converts a decorative pragma into law. |
| Limiter-identity roster pin | **Yes** | `EXPECTED_ROUTE_LIMITERS` under a strict `toEqual`, so reverting either route to `userActionLimiter` reddens naming both. The capture regex has positive- AND negative-polarity self-tests. Route specs mock ONLY `bridgeComputeLimiter`, so a revert cannot even resolve its import. | ✓ Strong. Added because the pre-existing roster was MEASURED unable to see a swap. |
| `password-policy.test.ts` | **Yes, on the repo half only** | Value drift (literal `6`, not a re-export), import presence, no local constant, no numeric `minLength` literal, plus an anti-vacuity arm proving the floor was shared rather than deleted. Three neuters observed RED and restored. | ✓ for the repo half. **Cannot** observe the hosted setting — stated at the constant, not papered over. See O-2 and the WR-10 gap. |
| SEC-05 quarantine equality | **Yes** | `assert offenders == IP_KEYED_QUARANTINE` with the set now EMPTY; class-size and label-continuity assertions guard the enumeration itself, so shrinking the class to make it pass reddens. | ✓ |
| Hygiene gate — **Rule 1 in CI** | **No, and it says so** | The needle derives from the home-directory basename; on the CI runner that is a generic account name the scanner deliberately REFUSES (`:254-259`) — measured, because a naive derivation would have turned the lint job permanently red. When Rule 1 cannot run the gate DROPS the username clause from its success line instead of claiming a check it did not perform (`:443-461`). | ⚠️ **A gate that cannot fire in CI.** Not a defect being hidden: DECIDED and recorded at `TODOS.md:1154-1185` with the reasoning and the one-line remedy (`[WR-01-CI]`). Structural Rules 2/3 still run everywhere. Named here because "the gate is green in CI" must not be read as "Rule 1 passed in CI". |

---

## Requirements Coverage

| Requirement | Roadmap SC | Status | Evidence |
|---|---|---|---|
| OPS-05 | SC-1 | ✓ SATISFIED | Row 1 |
| OPS-06 | SC-2 | ✓ SATISFIED | Row 2 |
| OPS-07 | SC-2 | ✓ SATISFIED (as amended) | Row 3 |
| OPS-08 | SC-3 | ⚠️ MET-AT-MERGE | Row 4 + dedicated section |
| OPS-09 | SC-3 | ✓ SATISFIED | Row 5 |
| OPS-10 | SC-3 | ✓ SATISFIED | Row 6 |
| SEC-01 | SC-4 | ✓ SATISFIED (bounded) | Row 7 + WR-10 gap |
| SEC-02 | SC-4 | ✓ SATISFIED | Row 8 |
| SEC-03 | SC-5 | ✓ SATISFIED | Row 9 |
| SEC-04 | SC-5 | ✓ SATISFIED | Row 10 |
| SEC-05 | SC-4 | ✓ SATISFIED | Row 11 |
| SEC-06 | SC-4 | ✓ SATISFIED | Row 12 |
| HONEST-08 | SC-6 | ✓ SATISFIED | Row 13 |

No orphaned requirements: `.planning/ROADMAP.md:367` lists all 13 and every one is
claimed by a plan. (The ROADMAP's own summary Requirement Coverage table at `:528` omits
HONEST-08 — recorded as a ledger gap, not an orphan.)

---

## Review-Finding Disposition — all 19, checked at HEAD

| Finding | Disposition at HEAD | Confirmed |
|---|---|---|
| CR-01 — non-`str` `%`-arg leaks the signed ccxt URL | FIXED — render-then-scrub, `logging_config.py:124-197` | ✓ |
| CR-02 — template revert emits the bare credential arg | FIXED — same fix; regression at `test_stdlib_redact_bridge.py:495` | ✓ |
| WR-01 — username still published, base64-encoded | FIXED — needle derived at runtime; **0 of 5712 measured by this verifier** | ✓ |
| WR-02 — three blind numerator arms logged green | FIXED — all now 503 via `monitorReadFailed` | ✓ |
| WR-03 — 5xx refund resets the whole hourly bucket | FIXED **by removal**, with a ⛔ not-to-re-add note | ✓ |
| WR-04 — gate cannot tell "not applied" from "reverted" | FIXED — catalog-comment revert discriminator, `:611` / `:647` | ✓ |
| WR-05 — Mode A walk too narrow | FIXED — walk broadened, six-shape probe | ✓ (bounded, O-3) |
| WR-06 — future-dated series end reads red beside "just now" | FIXED — `freshness.ts:148`, `days < 0 → warm` | ✓ |
| WR-07 — operator jargon reaches a user-visible column | FIXED **in TypeScript** — `csv-finalize/route.ts:2044` branches on SQLSTATE `40001`; migration prose retired (`:63` `✅ CLOSED: WR-07`) | ⚠️ code yes, **`TODOS.md:1122-1152` still reads as owed** |
| WR-08 — two contradictory worker claims | FIXED — Dockerfile header + SUMMARY corrected at 0a941794b | ✓ |
| WR-09 — `doRemove` silent no-op on mis-index | FIXED — throws, and removes by identity | ✓ |
| WR-10 — 6-char floor, no character class, no leaked-password protection | **UNDISPOSITIONED — not fixed, not booked, not accepted** | ✗ **GAP** |
| WR-11 — hardened monitor with no caller | FIXED **by deletion**; OPS-07 requirement amended to record closure-by-deletion | ✓ |
| IN-01 — `StrategyHeader` is not a live mount | FIXED — recorded at `StrategyHeader.tsx:22-25`; mount count is four | ✓ |
| IN-02 — `CompositionDonut` re-optionalises `seriesEnd` | FIXED — forcing function restored past the badge boundary | ✓ |
| IN-03 — main-module guard degenerates to always-true | FIXED — 917a61483 | ✓ |
| IN-04 — record formatted twice | ACCEPTED, bounded and priced at `logging_config.py:163-180`; pinned by `:519` | ✓ |
| IN-05 — tenant assertion exercises a header production never sends | **REFUTED with evidence** — production DOES send it; five comments resting on the dead premise corrected | ✓ |
| IN-06 — six unaudited single-line mutation sites | RECORDED — `TODOS.md:1186-1207`, census re-measured (6, not 4; every prior coordinate stale) | ✓ |

**18 of 19 closed or recorded. WR-10 is the one that fell through.**

---

## Known-Open Items — confirmed recorded, not re-derived

| Item | Recorded at | Confirmed |
|---|---|---|
| H-0001 — six single-line mutation sites unaudited | `TODOS.md:1186-1207` + `src/__tests__/audit-coverage.test.ts` | ✓ |
| OPS-08-TS — nothing retries on `40001` | `TODOS.md:1047-1058` | ✓ |
| OPS-08-F2 — both pg_cron fan-out paths swallow the new error | `TODOS.md:1060` | ✓ |
| OPS-08-F9 — the SQL gate has no `ALL N ARMS EXECUTED` sentinel | `TODOS.md:1069-1076` | ✓ |
| OPS-08-F8 — sql-tests first-failure blast radius | `TODOS.md:1078` | ✓ |
| WR-07-TS — **now CLOSED in code** | migration `:63` updated ✓ / `TODOS.md:1122-1152` **NOT updated** | ⚠️ half |
| WR-01/CI — Rule 1 cannot run in CI; DECIDED, not deferred | `TODOS.md:1154-1185` | ✓ |
| DRIFT-01 — TEST runs a comment-stripped build of the enqueue function | `TODOS.md:1086-1120`, with the measured table | ✓ |
| Forward-only redaction; history deliberately not rewritten | `.planning/REQUIREMENTS.md` SEC-02 decision 1 | ✓ |
| Applied-migration comment-only exception (2 files) | SEC-02 decision 3 + `⚠️ RECORDED EXCEPTION` headers at `:4` of both | ✓ |

Nothing else was found quietly dropped **except WR-10**. Every scope reduction encountered
in the code states itself at the site that makes it and traces to a recorded decision.

---

## Anti-Pattern Scan

| Scope | Result |
|---|---|
| Added lines across all 78 non-planning files in the phase diff, scanned byte-exact (`grep -a`, so the NUL-carrying file is not skipped) | **0 new `TBD` / `FIXME` / `XXX` / `HACK` markers.** The only tree-wide hits are pre-existing prose in `CHANGELOG.md` and two `docs/superpowers/plans/` files, none on a line this phase added. |
| `npm run lint` | 0 errors; 3 warnings, all in files **outside** this phase's diff (verified against the diff file list). |
| `npm run typecheck` | Exit 0. |
| Applied-migration edits | Comment-only proven mechanically: the diff filtered to non-`--`, non-blank lines is EMPTY for both files. |
| Stub / hollow-render patterns on the HONEST-08 path | None. `series_end` flows from a real PostgREST projection through a required prop to four real mounts; no hardcoded literal or static fallback anywhere in the chain. |

---

## Observations (not gaps)

**O-1 — OPS-07's amendment is the honest framing, and I checked it is a closure not a
regression.** The clause was closed by deleting the module, so the correct evidence is
ABSENCE, and absence is what I found: no `src/lib/observability.ts`, no
`checkStuckNotifications` anywhere in the tree, no `observability` entry in `knip.json`.
The surviving clause is met four-for-four rather than one-for-four. Worth stating plainly:
stuck notifications are no more monitored after this phase than before — but they were
never monitored, the function that appeared to monitor them never had a caller, and three
separate guards were protecting it. Deleting it makes the coverage story true.

**O-2 — SEC-01's guarantee has an un-pinnable half, and the requirement says so.** The
hosted minimum was READ (a `422 weak_password` with `reasons = ["length"]`), not assumed;
value, date and method live at the constant. But the setting is dashboard-owned with no
repo representation: it can change outside git and nothing here can observe that. Verdict
MET on that amended standard. **A reader must not read "enforced" as "enforced by anything
in this repo"** — and separately, must not read MET as "the floor is adequate". That is
WR-10, and it is a gap.

**O-3 — the Mode A AST walk is narrower than its name suggests, even after WR-05.** It is
a preventive gate (measured 0 violations pre-edit) with five credential-adjacent anchor
modules pinned, and its own probe declares three shapes it does not catch
(`_PROBE_DEFERRED_LINES`). Acceptable, and honestly self-described — but it proves less
than "no module-scope bind anywhere". Mode B carries the behavioural half.

**O-4 — SEC-02's scan is complete over the TRACKED tree at HEAD; it does not unpublish
history.** Founder-ruled forward-only, recorded as decision 1. My 0-of-5712 measurement is
a statement about the working tree, not about what is already cloned, forked and cached
from a public repo.

**O-5 — the earlier verdict's ordering advisory is CLOSED, and closed twice over.** It
flagged that "where does the track record end" was answered POSITIONALLY in both
derivations, correct only if `returns_series` is stored date-ascending, with nothing
asserting it. At HEAD: `seriesEndOf` (`src/lib/utils.ts:229-239`) takes the LATEST readable
date and is order-independent by construction; and the PostgREST projection — which cannot
follow, because the select grammar can express a positional index but not an aggregate over
a JSONB array — now DECLARES the precondition at `src/lib/queries.ts:292-320` and cites the
writer that ENFORCES it: `compute_all_metrics` raises `ValueError` on a non-monotonic index
(`analytics-service/services/metrics.py:491-499`) and `returns_series` is built by
iterating that same index (`:910-913`). An undeclared assumption became a declared
precondition backed by a fail-loud writer. That is the right shape of fix.

---

## Coverage Honesty — what this verification did NOT establish

Naming these is part of the verdict, not a caveat to it.

1. **No database was read by me.** Every deployed-function fact is the requester's
   read-only catalog measurement of 2026-08-26, attributed in the frontmatter. If someone
   has since applied `20260826150000` to TEST, OPS-08's verdict flips on re-measurement —
   nothing observable from this worktree would say so.
2. **`sql-tests` was not executed.** Its pre-apply behaviour is READ, not run: I traced
   `SKIP (Part 3)` at `:632` against the anti-SKIP net at `ci.yml:1366-1420` and concluded
   the lane is green. That is a reading of two files, not a run of either.
3. **The hosted password policy was not re-probed.** SEC-01's "6, no character class" is
   carried forward from the recorded 2026-08-26 reading. I verified the repo half only.
4. **The 14-day request census behind SEC-04's sizing was not re-run.** The derivation is
   internally coherent and cites its controls; the numbers are taken as read.
5. **No production surface was loaded.** HONEST-08 is verified by tracing the data path
   through the real query, all four real mount sites and a real published-row spec — not
   by viewing the live discovery page. PROD confirmation belongs to post-deploy QA.
6. **I mutation-tested nothing myself.** Every RED demo cited is recorded in a test
   docstring or in the requirement, or is structurally implied by an assertion I read.
   Where a gate's failure mode was not identifiable by reading, it is called out in the
   Falsifiability Audit (Part 1+3's pre-apply arm; Mode A's residual shapes; Rule 1 in CI).
7. **I did not run the full vitest or pytest suites.** 16 vitest files and 7 pytest files,
   targeted at the requirements under verification, all green. Full-suite health is the
   ship gate's job, and running it here would have shared the box with nothing to gain.

---

## Overall Verdict

**gaps_found — and the engineering is not what is short.**

Twelve of thirteen requirements are MET at HEAD, and they are MET well. This is a
materially stronger phase than the verdict it supersedes described, because that verdict
was written before the fix round: it saw a redaction bridge that published an HMAC
signature, a username countdown stuck at two, a monitor that paged on one of four blind
arms, a rate-limit refund that handed attackers a fresh hour, and a dead module protected
by three guards. All five are closed at HEAD, at the root rather than at the symptom —
WR-03 and WR-11 were closed by DELETING the offending mechanism, which is the right answer
and the rarer one. The SEC-02 scrub is the strongest single result: independently
re-measured by this verifier at 0 of 5712 tracked files, behind a gate that is
no-allowlist by construction and demonstrated failing in both directions. HONEST-08 flows
real data through all four real mount paths and now declares the one precondition it
depends on, citing the writer that enforces it.

**The gaps are three, and none of them is a merge blocker:**

1. **OPS-08 is MET-AT-MERGE by construction.** Not a shortfall of engineering — a
   shortfall of *deployment*, and one that only the merge can close. Ship it. Then read
   the deployed body before ticking the requirement, and book the TEST hand-apply, because
   nothing will ever go red to remind you.
2. **WR-10 fell through.** A security review finding on a phase titled *harden* — a
   six-character, no-character-class password floor on a platform that custodies
   decryptable exchange API keys — is not fixed, not booked, and not accepted anywhere in
   the tree. It is pre-existing and merging does not worsen it, so it does not block. But
   it must not be silently absorbed into a passing phase: the review named both the remedy
   and the fallback, and neither was taken. **This is the one item requiring a human
   decision before the phase is closed.**
3. **The ledger and backlog still lag the code in five places** — five REQUIREMENTS
   checkboxes, two ROADMAP tables, one stale TODOS entry describing work that is done, and
   one SUMMARY whose Blockers section describes a test revision replaced before merge.
   Each is minutes of work. Together they are the phase failing quiet about itself, on a
   phase whose goal clause is *fail loud*.

**Recommended:** ship this PR. Close the three ledger residues and the stale WR-07 entry
first (minutes). Put WR-10 in front of the founder as an explicit accept-or-raise
decision. Record the OPS-08 apply — both the PROD auto-apply and the TEST hand-apply — as
owned actions rather than letting a green `sql-tests` lane imply the fix is live.

---

_Verified: 2026-08-26 at `a81deb13b`_
_Verifier: gsd-verifier (goal-backward, adversarial stance)_
_Supersedes the pre-fix-round verdict at `af93ad8dd`._
