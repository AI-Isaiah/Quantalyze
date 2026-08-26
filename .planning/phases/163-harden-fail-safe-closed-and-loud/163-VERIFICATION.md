---
phase: 163-harden-fail-safe-closed-and-loud
verified: 2026-08-26T16:50:00Z
status: gaps_found
score: 12/13 requirements verified MET at HEAD
behavior_unverified: 0
overrides_applied: 0
verification_method: >-
  Goal-backward. Every verdict below rests on code read at HEAD (af93ad8dd) plus a
  command this verifier ran itself. No verdict rests on a SUMMARY claim. Commands
  executed: `npx tsx scripts/check-planning-hygiene.ts` (exit 0, 5712 files); an
  independent NUL-safe latin1 scan of all 5712 tracked files for the local-identity
  token (0 files, 0 occurrences); `npm run lint` (0 errors); `npm run typecheck`
  (clean); 18 vitest files (483 tests, all pass); 6 pytest files in
  `analytics-service/` (157 pass) plus `test_structlog_frozen_proxy.py` Mode A +
  Mode B (9 pass).
gaps:
  - truth: "OPS-08 — the 10-param `_enqueue_compute_job_internal` no longer uses `INTO STRICT` on its lost-race branches"
    status: partial
    reason: >-
      The requirement is worded as a property of the DEPLOYED function. The fix exists
      only as an unapplied forward-only migration; the function that TEST and PROD
      actually run still carries all four strict re-reads. Code-complete, not in effect.
    artifacts:
      - path: "supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql"
        issue: "Never applied to TEST or PROD. Verified on a scratch Postgres 16 only (163-06-SUMMARY.md:190, :197-201, :232-237)."
      - path: "supabase/tests/test_enqueue_internal_destrict.sql"
        issue: >-
          The Part 1+3 arm is a both-or-neither COHERENCE assertion, deliberately GREEN in
          the pre-apply state (it emits `SKIP (Part 3)` at :274). Correct engineering for
          the first-failure blast radius, but the consequence is that NO CI signal will
          ever redden to say the migration was never applied. The only thing tracking
          that is prose.
    missing:
      - "Hand-apply `20260826150000` to the TEST project, then confirm `sql-tests` prints `OPS-08 Part 1+3 OK` rather than `SKIP (Part 3)`."
      - "Merge to main to auto-apply to PROD (founder-gated), then re-verify against the deployed body."
      - "Tick REQUIREMENTS.md OPS-08 only after the deployed body is measured — the SUMMARY's own reasoning, and it is correct."
  - truth: "The project's own ledger reflects what this phase achieved"
    status: failed
    reason: >-
      The phase ledger understates completion by six requirements and mis-states plan
      progress. This is bookkeeping, not code — but on a phase whose goal clause is
      'fail loud', a ground truth that reads Pending for landed, tested work is the
      same class of defect the phase exists to close.
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: >-
          Traceability rows mark OPS-06, OPS-07, OPS-09, SEC-02, SEC-04, SEC-05 as
          `Pending` and their checkboxes `- [ ]`, though all six are verified MET below.
          (OPS-08's `Pending` is correct and deliberate.)
      - path: ".planning/ROADMAP.md"
        issue: >-
          Reads `**Plans**: 1/9 plans executed` while 9 SUMMARYs exist; only 4 of the
          plan checkboxes are ticked; and the 163-03 / 163-04 lines are DUPLICATED with
          conflicting checkbox states (four lines where there should be two) — a
          concurrent-worktree merge artifact that survived into HEAD.
      - path: ".planning/STATE.md"
        issue: "`stopped_at: Phase 163 wave 1 complete — all 8 plans merged`. Wave 2 (163-09, SEC-01 + SEC-03) merged afterwards and is not recorded."
    missing:
      - "De-duplicate the 163-03 / 163-04 plan lines in ROADMAP.md and tick all nine."
      - "Set ROADMAP.md to `9/9 plans executed`."
      - "Flip the six ledger rows to Complete; leave OPS-08 Pending with its reason."
      - "Advance STATE.md past wave 1."
  - truth: "163-06-SUMMARY.md describes the code that merged"
    status: failed
    reason: >-
      The SUMMARY was written at `d6e5c4507`; the test file was then rewritten at
      `eb27e5ada` (three-reviewer findings R1-R9 + F8) which INVERTED the claim. The
      SUMMARY's Blockers section is stale as merged.
    artifacts:
      - path: ".planning/phases/163-harden-fail-safe-closed-and-loud/163-06-SUMMARY.md"
        issue: >-
          ":197-201 states CI's `sql-tests` lane 'will be RED for this file until someone
          applies 20260826150000 by hand'. The merged test is a coherence assertion that
          is GREEN pre-apply (F8 in eb27e5ada's own message says so explicitly). The
          verification table at :190 ('Gate RED pre-apply') likewise describes a
          superseded revision."
    missing:
      - "Correct the Blockers and verification-table rows in 163-06-SUMMARY.md, or add a dated addendum recording the eb27e5ada reshape."
deferred: []
coincidental_reliance_items:
  - truth: "HONEST-08 — the discovery badge buckets on the staler of sync- and series-recency"
    reason: undeclared-precondition
    harden: >-
      Both series-end derivations take the LAST element — `returns_series->-1->>date` in
      the PostgREST projection (`src/lib/queries.ts`) and `points[points.length - 1]` in
      `seriesEndOf` (`src/lib/utils.ts:194`). Both are correct only if `returns_series`
      is stored date-ASCENDING. Nothing in this phase's code, and nothing found in the
      tests, asserts that ordering; the writer's convention is an undeclared precondition
      the reader depends on. Advisory only — the verdict stays MET. Hardening would be a
      writer-side ordering pin or a `max(date)` projection instead of a positional one.
human_verification:
  - test: "Hand-apply `supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql` to the TEST project, then run the sql-tests lane."
    expected: "`test_enqueue_internal_destrict.sql` prints `OPS-08 Part 1+3 OK: the deployed 10-param body carries no strict lost-race re-read and does raise serialization_failure on an exhausted one.` — not `SKIP (Part 3)`."
    why_human: "Requires the TEST database URL, which is a CI secret with no representation in this worktree. No automated lane applies migrations to TEST."
  - test: "After merge to main, confirm the PROD auto-migrate workflow applied 20260826150000 and re-read the deployed body."
    expected: "`pg_get_functiondef` on the 10-param overload shows zero `INTO STRICT` lost-race re-reads and one `serialization_failure` raise."
    why_human: "PROD apply is founder-gated and deliberately untouched by this phase."
---

# Phase 163: HARDEN — Fail safe, closed, and loud — Verification Report

**Phase Goal:** The backend fails safe, closed, and loud — secrets cannot reach logs,
monitors cannot report false health, committed work cannot 500, and every mutating or
compute-heavy surface is limited and audited.

**Verified at:** `af93ad8dd` (working tree clean)
**Status:** gaps_found
**Re-verification:** No — initial verification.

---

## Per-Requirement Verdicts

Each row states the PROMISE from `.planning/REQUIREMENTS.md` / `.planning/ROADMAP.md`
(not from a SUMMARY), the EVIDENCE found at HEAD, and a verdict.

| # | Req | Promise (from the requirement, not the SUMMARY) | Evidence at HEAD (`file:line`) | Verdict |
|---|-----|---|---|---|
| 1 | **OPS-05** | The structlog frozen-proxy class is fixed at the CLASS level — no module-level proxy can bind a pre-`configure_logging` chain that skips `_redact_processor`. Mode A source-scan gate + Mode B behavioral redaction test, each RED-demonstrable. | `analytics-service/main.py:67` (hoisted above every first-party import); `analytics-service/main_worker.py:91` (the live worker configured for the first time); `analytics-service/services/logging_config.py:132-170`; ordering gate `analytics-service/tests/test_structlog_frozen_proxy.py:415-458`; Mode A `:546-618`; Mode B + negative control `:180-330`. **Ran:** 5 Mode-A/ordering tests pass, 4 Mode-B tests pass. | ✓ **MET** |
| 2 | **OPS-06** | `createAdminClient()` cannot throw on the request path after an irreversible commit — the class is closed at the known sites. | `src/app/api/preferences/route.ts:217`; `src/app/api/account/deletion-request/route.ts:122`; `src/app/api/strategies/csv-finalize/route.ts:776`. All four inline-argument occurrences replaced. **Independently measured:** a repo-wide grep for `logAuditEvent*(\s*createAdminClient()` returns zero non-comment hits. Ordering tests (`constructs the admin client BEFORE the …`) pass in all three route specs. | ✓ **MET** |
| 3 | **OPS-07** | `checkStuckNotifications` distinguishes "nothing stuck" from "could not tell"; a failed denominator read PAGES instead of logging success; the integration test actually falsifies both. | Union `src/lib/observability.ts:18-20`, both indeterminate arms `:47`, `:62`; paging `src/app/api/cron/flag-monitor/route.ts:324` (503) + `:329` (`denominatorReadFailed`, Sentry capture awaited); falsifiers `tests/integration/cron-flag-monitor.test.ts`. **Ran:** 26 integration tests pass; `src/lib/observability.test.ts` passes. | ✓ **MET** — see Observation O-1 |
| 4 | **OPS-08** | The 10-param `_enqueue_compute_job_internal` **no longer uses** `INTO STRICT` on its lost-race branches. | Migration `supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql:251-282` (four plain `SELECT id INTO v_new_id` + one classified raise); gate `supabase/tests/test_enqueue_internal_destrict.sql`. **But:** unapplied on TEST and PROD (163-06-SUMMARY.md:197-201). The deployed body still carries all four strict re-reads. | ⚠️ **PARTIAL** — code-complete, **NOT in effect** |
| 5 | **OPS-09** | The resync draft pre-check is deterministic (`ORDER BY created_at DESC` + bounded window). | `analytics-service/routers/process_key.py:765` (`_RESYNC_DRAFT_RESUME_WINDOW = timedelta(hours=8)`, derived from the single-hop 13,230s ceiling); `:1476` cutoff, `:1483` `.gte("created_at", …)`, `:1484` `.order("created_at", desc=True)`. **Ran:** `tests/test_resync_precheck_determinism.py` + `test_resync_draft_dedup.py` pass. | ✓ **MET** |
| 6 | **OPS-10** | The retry loop cancels abandoned response bodies (`body.cancel()`). | `src/lib/resilient-fetch.ts:2260` (`cancelAbandonedBody`, full capability ladder — null check, `typeof cancel === "function"`, try/catch, thenable-guarded `.catch`); call site `:2759`, verified to sit INSIDE the retry branch and not on the two return paths. **Ran:** `src/lib/resilient-fetch.retry.test.ts` passes. | ✓ **MET** |
| 7 | **SEC-01** | The server-side password policy is verified and enforced — client `minLength={6}` is backed by an explicit Supabase-side policy, documented. Recorded as a point-in-time READING, never an invariant. | `src/lib/auth/password-policy.ts:43` (`MIN_PASSWORD_LENGTH = 6`) with the reading, the date and the probe method in its docblock; both forms derive `minLength` AND copy from it (`SignupForm.tsx:240,242`; `ResetPasswordForm.tsx:40,41,94,96,107`); `src/lib/auth/password-policy.test.ts` pins value drift AND site drift by scanning both sources. **Ran:** passes. | ✓ **MET** (bounded — see Observation O-2) |
| 8 | **SEC-02** | Tracked docs carry no local absolute paths / macOS username; verified by a NO-ALLOWLIST scan (gitleaks' allowlist is path-based and blind here). | **Independently measured by this verifier**, not read from a SUMMARY: a NUL-safe latin1 scan of all **5712** tracked files found **0 files / 0 occurrences**. Gate `scripts/check-planning-hygiene.ts` (no path exclusions; value-only `<user>` exemption; EMPTY-SCAN is a failure) wired at `package.json:11` into `npm run lint`, which runs in `frontend-lint`, which is in the blocking `frontend` aggregator's `needs:` (`.github/workflows/ci.yml:804`). **Ran:** the gate directly (exit 0) and `npm run lint` (0 errors). The two applied-migration edits verified **comment-only** — a diff filtered to non-`--` lines is empty. | ✓ **MET** |
| 9 | **SEC-03** | `add_wizard_composite_key` is policed by the audit-coverage gate — the pragma-vs-real-emission decision made and RECORDED. | Allowlist entry `src/__tests__/audit-coverage.test.ts:217`; pragma at `src/app/api/strategies/composite/add-key/route.ts:477-480`, call at `:481` (inside the 8-line window the gate reads); decision recorded as five numbered points in `.planning/REQUIREMENTS.md` SEC-03. **Ran:** `audit-coverage.test.ts` passes. | ✓ **MET** |
| 10 | **SEC-04** | The bridge + portfolio-optimizer flows get a named `bridgeComputeLimiter` sized to backend reality, ⛔ without resizing the shared `userActionLimiter`. | `src/lib/ratelimit.ts:277` (`makeLimiter(10, "3600 s")`) with a measured derivation at `:218-276` (14-day request census = 0 on both paths, validated against a positive control; slowapi 10/hour × measured `numReplicas = 1`); consumed at `src/app/api/bridge/route.ts:94` and `src/app/api/portfolio-optimizer/route.ts:119`, `:156`. **Prohibition holds:** `src/lib/ratelimit.ts:97` `userActionLimiter = makeLimiter(5, "60 s")` — unchanged. Roster pin now captures limiter IDENTITY per site (`src/lib/seam-ratelimit-posture.invariant.test.ts:281-287` pinned, `:372-383` strict `toEqual`). **Ran:** all three specs pass. | ✓ **MET** |
| 11 | **SEC-05** | The tenth IP-keyed route (`simulator.py`) is repaired along with the test whose wrapper-check conceals it — equality assertion, quarantine shrinks to 0. | `analytics-service/routers/simulator.py` now decorates with `partial(tenant_or_platform_key, scope="simulator")`; the old `_simulator_rate_limit_key` was DELETED, not merely unwired. `analytics-service/tests/test_limiter_identity.py:138` `EXPECTED_CLASS_SIZE = 10`, `:159` `IP_KEYED_QUARANTINE = frozenset()`, `:545` `assert offenders == IP_KEYED_QUARANTINE` (equality retained on purpose). **Ran:** 157 pytest tests across the six affected files pass. | ✓ **MET** |
| 12 | **SEC-06** | Removing a panel mid-validate aborts the in-flight credential-carrying POST. | `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:1251` (`doRemove` sets reason `"user"` then `controller.abort()`, by panel identity); `:1103` (leave-step arm); classification consumed at `:1430-1446`. The prior docblock that recorded this path as deliberately-left-open is deleted. **Ran:** `MultiKeyConnectStep.test.tsx` passes. | ✓ **MET** |
| 13 | **HONEST-08** | The public discovery "Synced Nd ago" badge buckets on the **staler** of sync- and series-recency, mirroring `FreshnessChip`. ⛔ Not by deleting the badge, ⛔ not via the `is_example` gate; test on a REAL published row, RED under neutering. | Shared resolver `src/lib/freshness.ts:163` (`resolveEffectiveRecency`; series binds only when STRICTLY worse; `unknown` caps `fresh`→`warm` but never softens a known-bad sync age); consumed once, at `src/components/strategy/SyncBadge.tsx`. **Data flow traced end-to-end:** `src/lib/queries.ts` `CATEGORY_RANKING_ANALYTICS_COLUMNS` projects `series_end:returns_series->-1->>date` (scalar, so the array never reaches an anon reader) → `withResolvedSeriesEnd` / `seriesEndOf` (`src/lib/utils.ts:194`) → `StrategyTable.tsx:1192` and `StrategyGrid.tsx:125` → `SyncBadge`. The live surface `src/app/browse/[slug]/page.tsx:63` mounts `StrategyTable` off `getStrategiesByCategory`, i.e. the query that carries the new column. Spec `src/components/strategy/SyncBadge.staler-of-two.test.tsx` uses `status: "published", is_example: false` fixtures through BOTH mount paths, with the neuter and the restore recorded at `:230-260`. **Ran:** passes. | ✓ **MET** |

**Score: 12/13 MET, 1 PARTIAL.**

---

## Gate Falsifiability Audit

The phase added or amended several gates. For each: *can it ever go RED?*

| Gate | Can it fail? | How | Assessment |
|---|---|---|---|
| `scripts/check-planning-hygiene.ts` | **Yes** | One unescaped home-path prefix or username occurrence in any tracked file → exit 1. Its own spec injects violations into paths a path-allowlist would exempt (`src/__tests__/check-planning-hygiene.test.ts`, "still flags a real path in a file that a path allowlist would exempt"), so *adding* a carve-out also reddens. NUL-byte and EMPTY-SCAN arms both pinned. | ✓ Strong. The needle is base64/char-coded so the scanner passes its own scan without the carve-out it forbids. |
| Mode A — module-scope `.bind()` AST scan | **Yes** | `_module_scope_binds()` reports `relpath:lineno`; recorded RED demo M3 named `services/rate_limit.py:140`. Anti-vacuity: ≥90 modules AND five named anchor modules must be reached. | ✓ Real, but **narrow** — see Observation O-3. |
| `TestEntrypointOrdering` | **Yes** | Sinking `configure_logging()` below the first-party imports in either entrypoint reddens by name. Two anti-vacuity guards (call must exist; anchor import must be found). | ✓ Strong. |
| `test_enqueue_internal_destrict.sql` Parts 2 / 4 / 5 | **Yes** | Arm-count (form-agnostic), 7-param parity, retired-kind admission branch / SECURITY DEFINER / SET search_path. All live in both pre- and post-apply states. | ✓ |
| `test_enqueue_internal_destrict.sql` Part 1+3 | **Partly** | Fails on either MIXTURE (strict + raise, or neither). Does **not** fail on the coherent pre-fix state — it emits `SKIP (Part 3)` at `:274` and continues. | ⚠️ Deliberate and well-argued (the runner exits on first failure and this file sorts ~30th of ~70). But the consequence is a real one: **no CI signal will ever redden to report that the migration was never applied.** Recorded as part of the OPS-08 gap. |
| `audit-coverage.test.ts` SEC-03 entry | **Yes** | Control run recorded in the requirement: with the name unlisted, deleting the pragma left the suite GREEN (17 passed); with it listed the same deletion turns it RED naming `composite/add-key/route.ts:477`. Both directions observed. | ✓ Strong — the entry is precisely what converts a decorative pragma into law. |
| Limiter-identity roster pin | **Yes** | `EXPECTED_ROUTE_LIMITERS` is compared with a strict `toEqual`, so reverting either route to `userActionLimiter` reddens naming both limiters. The capture regex has positive- **and** negative-polarity self-tests (`:390-411`). | ✓ Strong. Explicitly added because the pre-existing roster could not see a swap — measured, not assumed. |
| `password-policy.test.ts` | **Yes, on the repo half only** | Value drift (literal `6`, not a re-export), import presence, no local constant, no numeric `minLength` literal, and an anti-vacuity arm proving the floor was shared rather than deleted. | ✓ for the repo half. **Cannot** observe the hosted dashboard setting — stated, not papered over. See O-2. |
| SEC-05 quarantine equality | **Yes** | `assert offenders == IP_KEYED_QUARANTINE` with the set now empty; class-size and label-continuity assertions guard the enumeration itself. | ✓ |

---

## Anti-Pattern Scan

Every non-planning file this phase touched was scanned for debt markers
(`TBD` / `FIXME` / `XXX`, byte-exact with `grep -a` so the NUL-carrying file is not
skipped).

| Scope | Result |
|---|---|
| All phase-modified files under `src/`, `scripts/`, `supabase/`, `analytics-service/`, `tests/`, `.github/`, `docs/` | **0 debt markers.** |
| `npm run lint` | 0 errors, 3 pre-existing warnings (all in files this phase did not touch). |
| `npm run typecheck` | Clean. |
| Applied-migration edits | Comment-only confirmed mechanically: the diff filtered to non-`--` lines is empty for both files. |

---

## Observations (not gaps)

**O-1 — `checkStuckNotifications` has no production caller.** The discriminated union is
correct and tested, but `grep` across `src/` finds the symbol only in
`src/lib/observability.ts`, its own spec, and `src/__tests__/observ12-fixtures-presence.test.ts`.
`163-05-SUMMARY.md:253` states this plainly and records that wiring a consumer was
declined as new scope. The requirement is worded about the function's contract, which is
met; but the phase clause "monitors cannot report false health" is satisfied here by a
monitor nothing consults. Worth a TODOS entry if it does not already have one.

**O-2 — SEC-01's guarantee has an un-pinnable half, and the requirement says so.** The
hosted minimum was READ (a `422 weak_password` / `reasons = ["length"]` response), not
assumed, and both the value and the method are documented at the constant. But the setting
is dashboard-owned with no repo representation: it can change outside git and no test in
this repo can observe that. The requirement records this as a point-in-time reading rather
than an invariant, which is the honest framing. Verdict MET on that amended standard;
a reader should not treat "enforced" here as "enforced by anything in this repo".

**O-3 — the Mode A AST walk is narrower than its name suggests.** `_module_scope_binds()`
iterates `tree.body` only, and matches `Assign` / `AnnAssign` whose value is *directly* a
`.bind()` `Call`. Three shapes evade it: a bare expression-statement bind, a bind wrapped
in another call (`X = wrap(logger.bind())`), and a bind inside a module-scope `try:` or
`if:` block. Given that the gate is preventive (measured 0 violations pre-edit) and the
five credential-adjacent anchor modules are covered, this is acceptable — but the gate
proves less than "no module-scope bind anywhere".

**O-4 — three reviewers did run on the migration, after the SUMMARY was written.**
`eb27e5ada` closes nine findings (R1-R9 plus F2/F8/F9), including two that mattered: the
gate's needle pinned this codebase's `v_` naming habit rather than the dangerous construct
(`INTO STRICT winner_id` passed GREEN), and the comment-strip covered only `--`, so a
block comment reopened the identical green-washing hole. The house rule
("three reviewers before asking to apply any migration") is satisfied. This is also why
the SUMMARY is stale — the reshape post-dates it.

---

## Deferred / Known-Open Items — confirmed recorded, nothing else dropped

| Item | Recorded at | Confirmed |
|---|---|---|
| H-0001 — six single-line mutation sites unaudited (census re-measured; was recorded as four, and every coordinate was stale) | `TODOS.md:1086-1107`, and the re-measured list in `src/__tests__/audit-coverage.test.ts` | ✓ |
| OPS-08-TS — nothing retries on `40001`; the DB contract is correct, the app layer is not | `TODOS.md:1047-1058` | ✓ |
| OPS-08-F2 — both pg_cron fan-out paths swallow the new error | `TODOS.md:1060` | ✓ |
| OPS-08-F9 — the new SQL gate has no `ALL N ARMS EXECUTED` sentinel | `TODOS.md:1069-1076` | ✓ |
| OPS-08-F8 — sql-tests first-failure blast radius, beyond this file's own instance | `TODOS.md:1078` | ✓ |
| Hosted password minimum is dashboard-owned, unpinnable by any test here | `.planning/REQUIREMENTS.md` SEC-01 item 5; `src/lib/auth/password-policy.ts` docblock | ✓ |
| Forward-only redaction; git history deliberately not rewritten | `.planning/REQUIREMENTS.md` SEC-02 decision 1; scanner docblock | ✓ |
| Applied-migration comment-only exception (2 files) | `.planning/REQUIREMENTS.md` SEC-02 decision 3; `⚠️ RECORDED EXCEPTION` headers in both files | ✓ |

Nothing else was found quietly dropped. Every scope reduction encountered in the code is
stated at the site that makes it and traced to a recorded decision.

---

## Coverage Honesty — what this verification did NOT establish

Naming these is part of the verdict, not a caveat to it.

1. **The deployed SQL body was never read.** No database was reachable from here. OPS-08's
   PARTIAL rests on the migration file, the gate's own pre-apply arm, and the SUMMARY's
   account of where it was applied (scratch Postgres 16 only). If someone has since
   hand-applied it to TEST, the verdict flips to MET on re-measurement — but nothing
   observable from this worktree says so.
2. **The hosted password policy was not re-probed.** SEC-01's "6, no character class" is
   carried forward from the 2026-08-26 reading recorded in `163-CONTEXT.md`. This
   verification confirms the repo half (one constant, both forms derive from it, drift
   pinned); it did not re-run the endpoint probe.
3. **The 14-day request census behind SEC-04's sizing was not re-run.** The derivation is
   internally coherent and cites its controls; the numbers themselves are taken as read.
4. **No production surface was loaded.** HONEST-08 is verified by tracing the data path
   through the real query, the real mount sites and a real published-row spec — not by
   viewing `/browse/crypto-sma`. The PROD confirmation belongs to post-deploy QA.
5. **Nothing was mutation-tested by this verifier.** Every RED demo cited is either
   recorded in a test docstring or structurally implied by an assertion I read. Where a
   gate's failure mode was not identifiable by reading, it is called out above (Part 1+3;
   Mode A's narrowness).
6. **`sql-tests` was not executed.** Its behaviour pre-apply is inferred from reading
   `ci.yml:1488-1564` (the whole-file-SKIP net keys on `SKIP:`, which `SKIP (Part 3):`
   does not match; the F13 unpoliced-partial check keys on a `RETURN` within four lines,
   which this arm does not have) — so the lane should be green. That is a reading, not a
   run.

---

## Overall Verdict

**gaps_found — the phase goal is substantially achieved, with one requirement shipped but
not in effect and a ledger that does not yet say so.**

Twelve of thirteen requirements are MET at HEAD, and they are MET well: the gates this
phase added are, with one flagged exception, genuinely falsifiable, anti-vacuity-guarded,
and wired into blocking CI. The SEC-02 scrub is the strongest result — independently
re-measured at 0 of 5712 tracked files, behind a gate that is no-allowlist by construction
and demonstrated failing in both directions. OPS-05 closes both failure modes with a live
negative control rather than an assertion. HONEST-08 flows real data through both real
mount paths on a real published row.

The one substantive shortfall is **OPS-08**, and it is a shortfall of *deployment*, not of
engineering: the migration is written, three-reviewer-reviewed, idempotent, and proven on
a real Postgres — and the function TEST and PROD actually run is unchanged. The phase's own
163-06 SUMMARY refuses to tick the requirement for exactly this reason, which is the right
call. Do not close OPS-08 until the deployed body has been measured.

The two `failed`-status gaps are documentation, but they are not cosmetic. A phase whose
goal clause is *"fail loud"* currently ships a REQUIREMENTS ledger that reads `Pending`
for six landed, tested requirements, a ROADMAP that reads `1/9 plans executed` with a
duplicated plan pair, and a SUMMARY whose Blockers section describes a test revision that
was replaced before merge. Each is a small edit; together they are the phase failing quiet
about itself.

**Recommended before shipping:** close the three ledger/SUMMARY gaps (minutes of work),
and record the OPS-08 apply as an explicit, owned follow-up rather than letting a green
`sql-tests` lane imply the fix is live.

---

_Verified: 2026-08-26_
_Verifier: gsd-verifier (goal-backward, adversarial stance)_
