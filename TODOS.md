# Quantalyze — Backlog (single source of truth)

**Consolidated 2026-07-23.** This file replaces and supersedes every prior scattered
tracker. The following were folded in here and then deleted so there is ONE ground
truth going forward:

- `TODOS.md` (old 60KB sprawl), `.planning/FUTURE-MILESTONES.md`,
  `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md`,
  `.planning/tech-debt/TECH-DEBT-AUDIT-2026-06-09.md`,
  `.planning/DOGFOODING-FINDINGS-2026-07-16.md`, `.planning/DEMO-REPOINT-SCOPE.md`,
  `.planning/BACKBONE-BYPASS-INVENTORY.md`, `.planning/debug/bybit-reconcile-3-findings.md`,
  `.planning/SCENARIO-COVERAGE-WINDOW-ADR.md`, `.review/b7-tweaks/DEFERRED-FOLLOWUPS.md`,
  `.review/follow-ups.md`, `audit/tech-debt-round-1.md`, `audit/tech-debt-round-2.md`,
  `tasks/ADVERSARIAL_USER_NOTES.md`, `.gstack/handoff-2026-04-26-uat-followup.md`.

Kept (NOT backlog): `.planning/milestones/*` (shipped history), `.planning/codebase/*`
+ `research/*` (architecture), `.planning/{STATE,ROADMAP,REQUIREMENTS,PROJECT,MILESTONES}.md`
(active GSD state), `.planning/RETROSPECTIVE.md` (process history), `CHANGELOG.md`.

Items resolved by intervening milestones (v1.10–v1.14) and stale-but-in-prod-without-issue
items were dropped, not carried. Categories: **Fix now** / **Fix mid-term** / **Don't fix**.

**Purged 2026-08-20 (milestone v1.20 Backlog Burndown):** ~56 verified-open items moved into `.planning/milestones/v1.20-REQUIREMENTS.md` (v1.20 scope — RANK/SHARE/WIZERR/HONEST/OPS/SEC/DEPS) and deleted here; ~28 entries verified STALE at HEAD by a 17-agent triage (solved by earlier milestones) and deleted. Founder-gated and remaining open items below are untouched. Snapshot of the pre-purge file: `git show 2e67c4a0:TODOS.md`.

---

## 🔴 FIX NOW — live correctness, trust-boundary security, active go-live

0.011. **`[D-161-01]` The `first_rule.upper()` CSV code family is invisible to the derived vocabulary.**
   Phase 161's deferred error-surface item (`.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/deferred-items.md`),
   re-measured live 2026-11-14 at `analytics-service/services/csv_adapter.py` (the `first_rule.upper()` site).
   Re-homed from the deleted 0.01 "Phase 164.1 scope" wrapper.
   **Owner:** Phase 215 TESTREACH (booked 2026-11-14)

0.012. **`[D-161-05-B]` An orphaned MT5 connect waits out the full 120 s validate before refusing.**
   Phase 161's deferred error-surface item. Re-measured live 2026-11-14: the orphan verdict is
   reached only after validation in `src/app/api/strategies/create-with-key/route.ts`. Where the
   key's identity is known before validation, the refusal should come first.
   Re-homed from the deleted 0.01 "Phase 164.1 scope" wrapper.
   **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)

0.013. **WIZFORM-02 — server-classified codes still render `code: UNKNOWN` on the dashboard key surfaces. RECORDED OPEN**
   (Phase 153 span verification FAILED 2026-08-13). It GATES other work (see the entry near the
   `GATED ON WIZFORM-02 CLOSING` marker: a new code cannot be minted until the coverage-law
   population is honest). Re-homed from the deleted 0.01 wrapper's §D.
   - ⭐ **FRESH EVIDENCE 2026-08-25, measured on PROD, not inherited:** `/api/keys/validate-and-encrypt`
     returned `{"error":"Unauthorized","code":"UNKNOWN"}` — a server-classified upstream fault
     reaching the client with NO code, exactly the defect. This is a live reproduction, so plan
     against it rather than re-verifying whether the gate is still open.
   - ⛔ **STILL OPEN after Phase 164.2 — FOUNDER DECISION 2026-09-06, taken at the plan-06 gate:
     accept criterion 3 on FOUR of the five locked surfaces and book the fifth's wiring.** Phase
     164.2 plan 09 built a RENDER sweep (`src/lib/wizardErrors.roster-render.test.tsx`, 96 tests)
     that asserts the rendered DOM rather than roster membership, and it was observed RED under
     two neuters applied to files OTHER than the test — see `164.2-09-SUMMARY.md` →
     `## Anti-vacuity observations` (Neuter 1, deleting the `["SEAM_MISCONFIGURED",
     "SEAM_MISCONFIGURED"]` alias row at `wizardErrors.ts:4995`, → `4 failed | 92 passed (96)`;
     Neuter 2, deleting `"VENUE_ALREADY_CONNECTED"` from `KNOWN_CREATE_WITH_KEY_CODES`).
     **The fifth surface, `keys/validate-and-encrypt`, has NO code→copy render path at HEAD** —
     `164.2-09-SUMMARY.md` → `## Surfaces not rendered` re-measured all three consumers
     (`ApiKeyManager.tsx`, `StrategyForm.tsx`, `AllocatorExchangeManager.tsx`) and **none reads
     `code`**; a row there could only pass by feeding the expected title in as wire prose and
     reading it back, which is the proof-by-adjacent-signal that let WIZFORM-02 be *believed*
     closed in Phase 153. The wiring is booked as **`[WIZFORM-02-VE-CODECHANNEL]`** (🟡 FIX
     MID-TERM). ⛔ Therefore **the `GATED ON WIZFORM-02 CLOSING` marker STAYS DOWN** — plan 10's
     W4 precondition required that section to be ABSENT and it is PRESENT, which is the
     revision-round-2 guard working as designed, not a shortfall.
     ⭐ The 2026-08-25 PROD reproduction above is nonetheless closed AT THE ROUTE by 164.2 plan 05
     (`UPSTREAM_STATUS_TO_SEAM_CODE`: 401/403 → `SEAM_MISCONFIGURED`), so a *wizard step* now
     receives `SEAM_MISCONFIGURED` and the sweep proves `connect-key` renders it as itself. The
     unproven half is that the three DASHBOARD consumers show it — because they cannot.
   **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)

0.07. **⚠️ The composite arm tells a `sampled_gapped` series a false provenance sentence.** Found and
   deliberately left live by Phase 161 (`161-07`, D-161-07-A) — it fell outside that task's declared
   file scope, so it was booked rather than silently widened into.
   - `SyncPreviewStep.tsx:1306` / `:1311` hardcode `GATE_SERIES_PROVENANCE_UNVERIFIED` for **every**
     inadmissible composite verdict. A `sampled_gapped` composite is therefore told *"nothing on our
     side recorded how that series was built"* — which is false: the series' provenance IS recorded;
     it simply has a gap (`nav_gap_days > 0`). Reachable via the FIX-2 downgrade, and currently
     pinned by a 142.2 test.
   - Same defect class Phase 161 exists to eliminate — a sentence that names a blocker other than the
     real one — so this is unfinished business of that phase, not new scope.
   - **Fix shape:** branch the composite arm's code on the actual verdict instead of hardcoding one,
     mapping `sampled_gapped` to its own reason. One-line fix recorded in
     `.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/deferred-items.md`; the 142.2 pin moves with it.
   **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)

0.09. **⚠️ MT5 generic fallback names a cause it has NOT proven — a false sentence in the arm that
   exists for "cause unknown".** Found 2026-08-24 during Phase 161 (WIZERR-01) execution; the plan
   deliberately did not touch it, and `161-UI-SPEC.md` holds arm 3 unchanged, so this is a scoped
   follow-up, not a regression.
   - `MT5_GATEWAY_MISCONFIGURED_DETAIL` (`analytics-service/services/mt5_probe.py`) reads:
     *"MT5 gateway refuses automated trading (the 'Disable automatic trading through the external
     Python API' option is in force), so read-only capability cannot be proven…"*
   - That parenthetical is **arm 2's specific claim** (`MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL`
     asserts the same option, legitimately, because arm 2 *is* that case). Arm 3 is the fallback
     used when **no cause is provable** — the A1 absent-key path and `classify_exception`'s
     allow-list degradation target. Asserting a specific option there is exactly the
     names-a-blocker-it-cannot-establish defect WIZERR-01 exists to eliminate.
   - **Currently low-urgency:** structurally unreachable from both raise sites (they enter the
     operator arm only via `terminal_trade_permission_off`, which forces arm 1 or 2). It survives as
     `Mt5GatewayMisconfigured()`'s default argument and as the allow-list's degradation target — so
     it CAN still surface.
   - **Fix shape:** amend `161-UI-SPEC.md` arm 3 to a cause-free sentence, re-run the 14-token fence
     check, change the constant, and re-run `test_mt5_validate_parity.py` (the default-argument pin
     `str(Mt5GatewayMisconfigured()) == MT5_GATEWAY_MISCONFIGURED_DETAIL` binds it). Founder call on
     the wording, since the UI-SPEC copy contract is an approved artifact.
   **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)

0.51. **Phase 153.5 finding #10 — the 20 s interactive lease wait is shorter than one in-flight derive.**
   `_MT5_LEASE_WAIT_S` is 20 s, while the worker's derive holds the terminal for a 40 s read plus a
   10 s restart (`services/mt5_concurrency.py`, re-measured 2026-11-14). So an interactive validate
   can never wait out one in-flight derive. Size the wait from measured hold times (D-32 made them
   collectable), or tell the user the terminal is busy and when to retry. Kept from the deleted
   0.5 "Phase 153.5 complete" entry; finding #8 moved to TRIGGER-GATED.
   **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)

0.12. **🎨 FreshnessChip's longest label overflows its masthead column — measured in a real browser.**
   Found 2026-08-26 during the phase-162 browser pass on localhost/TEST (the first time this phase
   was rendered outside jsdom). Measured on the factsheet v2 masthead at 1485px viewport:
   - `COMPUTED · FRESH` → 1 line, 204.2px — fits
   - `TRACK RECORD · OLD` → 1 line, 204.2px — **fits** (this was the badge fixer's flagged worry; DISPROVED)
   - `TRACK RECORD · FUTURE — CHECK DATA` → **297.9px in a 204.2px container** — overflows
   The row is `flex … justify-end`, so it pushes left rather than wrapping.
   **Reachable:** the `future` tone fires on a future-dated input, and the chip names whichever fact
   carried the verdict — so a future-dated SERIES END produces exactly this string. That is the case
   `NEW-C20-07` exists to catch, so it is not hypothetical.
   **Severity: cosmetic.** The sentence is TRUE; only its width is wrong. Not user-deceiving, so
   non-blocking per the stopping rule.
   **Fix candidates:** shorten the future label on the series arm (e.g. `TRACK RECORD · FUTURE`), or
   let the label row wrap at this breakpoint. Re-measure in a browser — jsdom cannot see this class.
   **Owner:** Phase 214 FRESHTRUTH (booked 2026-11-14)

0.1. **⛔ LEDGER-BACKED VENUES HAVE NO RECURRING STRATEGY REFRESH — MT5 factsheets go stale
   silently, forever.** Founder-reported 2026-08-23 ("MT5 strategies are not being read out every
   day, and data gets stale"); root-caused by measurement against PROD 2026-08-24.
   - **Measured on PROD.** `strategy_analytics` for the 4 live MT5 strategies: newest
     `2026-08-21 13:51`, oldest `2026-08-04 14:20` (17–20 days). Same query for okx:
     `2026-08-23 21:44` (~2h). MT5 `api_keys.last_sync_at` is FRESH (`2026-08-23 04:09`).
   - **Root cause.** `process_key_long` is the ONLY path that reaches `strategy_analytics` for a
     ledger-backed venue. There is **no recurring enqueuer for it anywhere.** The two
     daily strategy-keyed crons both gate on ccxt-only closed sets that exclude mt5:
     `/api/cron/reconcile-strategies` (03:30) on `RECONCILABLE_EXCHANGES = FUNDING_EXCHANGES`
     = binance/okx/bybit, and `/api/cron/sync-funding` (04:00) on the same set. The 15-min
     `cron_sync` defers anything outside `EXCHANGE_CLASSES` (binance/okx/bybit/deribit) at
     `routers/cron.py:182`. So after onboarding, an MT5 strategy is never recomputed again.
   - ⚠️ **CORRECTED 2026-08-25 (re-measured at HEAD `57a407ea`).** Two refinements this entry
     originally got wrong or left implicit:
     1. **`process_key_long` is not enqueued from `api/strategies/finalize-wizard`** — that route's
        own test asserts the opposite (`route.test.ts:1630`). At HEAD it is enqueued at two Python
        sites: `analytics-service/routers/process_key.py:1517` and `:765`.
     2. **The three ledger venues are ASYMMETRIC.** Only mt5 and sfox hit the `:182` deferral;
        deribit is IN `EXCHANGE_CLASSES` (as this entry already notes) and instead falls to the
        `stored > 0` fill-count filter at `routers/cron.py:471-472`, which is structurally wrong
        for a settlement-ledger venue. Any fix scoped as "venues absent from `EXCHANGE_CLASSES`"
        silently drops deribit — scope off `_LEDGER_BACKED_SOURCES` instead.
     3. **Re-enqueuing `process_key_long` is a provable no-op**, so the naive fix ships green and
        does nothing: `long_fetch.py:154` returns `DONE` on `published`, `:193` on the whole
        `advanced_statuses` set, and every onboarded strategy is `published`.
     Full detail in `.planning/phases/161.1-.../161.1-RESEARCH.md`.
   - **Why it stayed invisible.** The two pg_cron KEY-scoped jobs that DO cover mt5 —
     `poll_allocator_positions` (04:00) and `refresh_allocator_equity_daily` (05:00) — run clean
     every day and advance `last_sync_at`. Key-mode `derive_broker_dailies` explicitly does NOT
     stamp `strategy_analytics` (`job_worker.py:2366` docstring: the per-key series is "dark").
     Net effect: the UI reads "synced 20h ago" on a factsheet that is weeks old. Zero errors,
     zero failed jobs — 14-day `compute_jobs` census shows no MT5 failures at all.
   - **⛔ Two fixes that look right and are NOT.** (a) Adding mt5 to `RECONCILABLE_EXCHANGES`:
     `run_reconcile_strategy_job` calls `fetch_raw_trades` (ccxt) — mt5 is in
     `_LEDGER_BACKED_SOURCES`, so this is the BYB-02 ccxt-fill class. (b) Re-registering the
     `derive-allocator-key-dailies` cron: it is key-mode (never stamps `strategy_analytics`), it
     was DELIBERATELY unscheduled at the v1.11 recovery, and
     `docs/runbooks/flipretry-derived-equity-go-live.md:171` forbids re-registering it via a
     migration — an auto-applying migration paired with a silently-skipped worker deploy recreates
     the v1.11 wedge verbatim. A migration doing exactly this was written and DELETED unmerged
     on 2026-08-24 after `migration-reviewer` caught it.
     ⛔ **AMENDED 2026-10-07 (Phase 167.1.2.2 DERIVECRON, D-05):** the
     `derive-allocator-key-dailies` cron is being re-registered by 167.1.2.2, see its runbook
     `docs/runbooks/derivecron-go-live.md`, for allocator books (167.1.2 PR C2's reader accepts
     only the version-2 row it produces). Item (b) remains correct as a statement about the
     strategy-refresh problem it sits under: the job still does not stamp `strategy_analytics`.
     The migration prohibition stands.
   - **Shape of the real fix.** A recurring strategy-keyed enqueuer of `process_key_long` for
     ledger-backed venues (mt5/sfox/deribit), which chains → `derive_broker_dailies` (strategy-mode)
     → `compute_analytics_from_csv` → `strategy_analytics`. ⚠️ Carries the v1.11 worker-wedge risk
     shape: MT5 serializes on ONE shared terminal (`services/mt5_concurrency.py`) at a 15-min
     timeout per key. Founder-gated activation (schedule left unregistered, SFOX_ENABLED pattern)
     is the safe landing. NOT yet built.
   - ⚠️ **PROGRESS 2026-08-25 (Phase 161.1) — built, DORMANT, and this entry stays OPEN.**
     Shipped: `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` (the
     read-only freshness surface, keyed on the max date inside `returns_series` — a signal no
     status transition can advance); `supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql`
     (`enqueue_ledger_refresh_for_strategies()`, a staleness-gated, bounded fan-out on the chain
     TAIL, fail-closed behind the `app.ledger_refresh_enabled` database setting); the D-15
     non-destructive failure guard in `job_worker.py`; and the founder-gated activation runbook
     `docs/runbooks/ledger-refresh-go-live.md`.
     - **The A7 unknown is closed.** The recurring mt5 `derive_broker_dailies` →
       `strategy_analytics` path had never run end-to-end. Executed on PROD 2026-08-25: PASS —
       `last_return_date` 2026-08-21 → 2026-08-25 (+4 real bars), status held
       `complete_with_warnings`, whole chain 44 s.
     - ⛔ **NOT CLOSED, and not closable by merging.** The mechanism ships DORMANT by design: no
       schedule is registered anywhere in the repo, and the fan-out returns 0 until a founder
       executes the runbook's two LIVE ops. **A merged-but-dormant fix is not a fixed defect.**
       Recording this closed at merge would put a green badge over strategies that are still going
       stale — which is precisely the failure mode this phase exists to eliminate, committed by
       the ledger that is supposed to track it. Close it only after the runbook has been executed
       and the staleness view's stale count is observed to drain.
   - **Re-measured on PROD 2026-11-14 (FIX NOW triage).** The fan-out has been live since
     2026-09-17. `ledger_refresh_staleness` held 13 rows: 9 of 11 MT5 strategies fresh (1-4 days).
     One MT5 strategy at 81 days has a disconnected key (expected). One MT5 strategy at 36 days has
     a live key that synced the same day, and its daily derive and compute finish `publish_warned`
     with flags `dust_nav_guard` / `twr_chain_broken` / `insufficient_window`, so its series cannot
     advance while the fan-out re-derives it daily. That residue, not the whole venue class, is
     what stays open here.
   **Owner:** Phase 214 FRESHTRUTH (booked 2026-11-14)

### Phase 153.7 review + verification — findings routed onward (added 2026-08-14)

The 153.7 fix round closed WR-01, WR-02, WR-03, W-153.7-1 (with a real guard, not a note),
W-153.7-2 and W-153.7-4 in code. The three below are recorded rather than fixed, each for a
stated reason. ⛔ Neither of the first two is a 153.7 regression — both are pre-existing and are
listed now only because 153.7 is what made them reachable or re-read them.

- [ ] **`ROSTER-DERIVE-01` — the two key-step rosters are still HAND-TYPED, and the class fix has
  no owner until this line does.** `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and
  `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) are hand-maintained allow-lists. Their own
  docblock used to assign the derived-roster class fix to *"Phase 153 / WIZFORM-02"* — which is
  now **ticked COMPLETE** (`REQUIREMENTS.md`), so that pointer named a closed requirement and the
  fix was ownerless. **This item is that owner**; both docblocks now cite it by name.
  ⭐ **WHAT CHANGED IN THE MEANTIME, so this is no longer a silent hazard.** 153.7's verifier
  MEASURED that deleting `"SEAM_INTERNAL_FAULT",` from either roster left the whole suite green
  while the wizard rendered `UNKNOWN` **with a Retry control** against `retryable=False` faults —
  the 2026-08-05 `SERVICE_UNREACHABLE` incident shape. The 153.7 fix round closed that with
  `[153.7 review W-153.7-1]` in `wizardErrors.invariant.test.ts`: the classifier-reachable
  population is derived (cascade literals by source scan + the LIVE `VENUE_WIRE_CODE_TO_VERDICT`)
  and checked against each roster under the translate-first admission rule. **A missing roster row
  now reds CI by name.** So what remains is DUPLICATION, not exposure.
  What is blocked: nothing ships wrong today. What unblocks it: deriving both rosters from the
  route contract instead of typing them, so the guard has nothing left to catch.
  ⚠️ **The obvious shortcut is wrong and is written down so it is not re-attempted:** merging the
  two rosters. They are separate on purpose (`ConnectKeyStep`'s docblock argues it at length — a
  step admits the codes ITS route emits, not the whole vocabulary), and a merged set would pass the
  guard while admitting each route's codes at the other.
  **Owner:** Phase 215 TESTREACH (booked 2026-11-14)

### v1.16 Phase-140.1 review — formerly HOMELESS findings (added 2026-07-26; owned by Phase 215 TESTREACH since 2026-11-14)

> ⚠️ **Why these are here:** they lived only in `.planning/phases/140.1-*/140.1-REVIEW.md` and
> `140.1-TS-OBLIGATIONS.md`, which are **gitignored and have zero git backup** (`git ls-files
> .planning` → 5 legacy phase-19 files only), in a repo whose memory records two prior accidental
> destructions of exactly these ledgers. Full evidence stays in those files while they exist.

- **Tests that run in NO environment (three findings).** (a) `TEST_SUPABASE_DB_URL` is wired into
  the `sql-tests` CI job only (`ci.yml:810`), never the `python` job (`ci.yml:1030-1033`) — so
  **31 pytest cases skip in CI exactly as they do locally**. (b) `HAS_PY_ENV` is set in **zero files
  repo-wide** — the 5 Phase-4-vs-Phase-5 **money-math KPI parity** cases it gates are permanently
  dormant. (c) 4 `tests/test_repro_key_flow.py` cases skip on missing **binance** cassettes
  (`tests/cassettes/` holds only `okx/` and `bybit/`). CI wiring; no owning phase.
- **Nine test modules mount a bare `FastAPI()`**, so they never see the app-global 422/429 handlers
  and their 422s render in FastAPI's default **leaking** shape. **Negative half: none of them is
  vacuous today — do NOT schedule a "fix the broken tests" sweep.** Positive half: the credential-safe
  422 is gated by exactly ONE file (`tests/test_validation_error_contract.py`), and
  `test_process_key.py` is where a future author would "prove the 422 is safe" and prove nothing.
  A shared app-factory fixture closes it.
- **403-vs-422 split unowned.** `_scope_rejected` (`routers/process_key.py:1295-1299`) is a three-arm
  OR behind one return, so ordinary `not val.valid` failures (incl. a malformed CSV) now answer
  **403** where 422 would be sharper. The consumer half is tracked as TS-14; the split decision itself
  has no owner.
- **Worker raises an HTTP exception.** `analytics_runner.py:1725` raises `HTTPException(500)` from the
  WORKER — a category error that can never render.
- **Anonymous teaser bucket 30/hour** (`routers/process_key.py:99`) — deliberate and founder-retunable;
  wants a saturation alert so exhaustion is visible rather than silent.

**Owner (all five bullets above):** Phase 215 TESTREACH (booked 2026-11-14)

---

## ⏳ TRIGGER-GATED — not work until the trigger fires

Moved here from FIX NOW on 2026-11-14 (founder: "Yes, do all three"). Each item keeps its id.
None of these is work until its **Trigger:** fires.

0.02. **⏸️ NOT PURSUED — founder call 2026-08-25: "forget OKX entity".** A different OKX key connected successfully at 21:38:12Z, so the immediate need is met and the entity theory was never confirmed (the founder's OKX domain was never read back). Kept as a RECORD, not a task: the underlying limitation below is real and measured, so if a future user reports a key that cannot connect while another key on the same account can, start here rather than re-deriving it. Do NOT schedule work on it without a fresh confirmation.
   ORIGINAL FILING: **OKX is hardcoded to ccxt's default (global) entity — a key issued on any other OKX
   entity can NEVER connect, and the UI blames the user's credentials.** Surfaced 2026-08-25 when
   a founder key issued AFTER an OKX re-KYC failed while an older key on the same account passed.
   - `analytics-service/services/exchange.py:817-830` — `create_exchange` sets only `apiKey`,
     `secret`, `password`, `enableRateLimit`. No hostname, region, or entity option is offered for
     any venue, so OKX resolves to ccxt's default endpoint.
   - OKX operates separate entities on separate API hosts. A key minted on entity B produces a
     signature entity A cannot verify, which OKX reports as `50113 Invalid Sign` — indistinguishable
     at the UI from a mistyped secret.
   - **MEASURED, same deployment, minutes apart:** the stored pre-KYC key `QA OKX Read-key` probed
     clean at 21:37:12 (`read:true, trade:false, withdraw:false, probe_error:false`), while the
     post-KYC key returned `50113` at 21:30:12. Our signing path is NOT broken; the endpoint is
     simply the wrong one for that key. ⚠️ CONFIRM the entity with the founder before building
     anything — the correlation is strong but the OKX domain has not yet been read back.
   - **Why this is worse than a missing feature:** the user is told "Authentication failed. Check
     your API key and secret." They then re-issue keys, re-paste secrets, and doubt their own
     account — which is exactly what happened tonight — for a venue we simply do not support the
     entity of. There is no path by which a correct user action resolves it.
   - **Fix shape (needs a founder decision — do not default it):**
     (a) support an entity/host selector for OKX and persist it beside the key, or
     (b) detect the entity mismatch and say so explicitly in the error copy.
     (b) alone is honest but still leaves the user unable to connect; (a) alone without (b) leaves
     the next mis-selected key equally mute. The pair is the complete fix.
   - **HONEST-01 class (Phase 162):** a venue verdict our own configuration caused, rendered as a
     statement about the user's credential. Same class as 0.03 and the `Unauthorized` case, and the
     third instance found in one evening — the error-copy work in 162 should treat "whose fault is
     this actually" as the organising question, not the individual strings.
   **Trigger:** a user reports a key that cannot connect while another key on the same OKX account can.

0. **⛔ MT5 ARCHITECTURE — one shared gateway terminal serves every MT5 account (decision record).**
   Found 2026-08-08 by the platform research Phase 134 specified (`153-EVIDENCE-mt5-platform.md`,
   `153-EVIDENCE-mt5-latency.md`). ⭐ 2026-11-14: three sub-points were removed as resolved, see
   `git show 3f52d473a:TODOS.md` for their text. The shared-session sub-point is answered by the
   founder's option (3) decision below. The read-only fail-open sub-point is closed (`terminal_info`
   and `tradeapi_disabled` are read in `services/mt5_probe.py`, and `classify_trade_capability` in
   `services/mt5_validation.py` is tri-state and fails closed). The first-call-empty sub-point is
   closed too.
   - **Login classification is inverted both ways** (`services/mt5_validation.py:37-56`, both
     token tables `[ASSUMED]`): a wrong-but-known server returns `-6 AUTH_FAILED` → we blame the
     user's password; an *unknown* server **times out** rather than erroring.
   - **Why none of this was caught:** CI never installs `mt5linux` (`Dockerfile:29` installs it
     into the image only); every contract test injects a `_connect` double
     (`services/mt5_client.py:135-141`). The real transport has never run outside production.
     Phase 134 designed `scripts/mt5_spike.py` to answer exactly these four unknowns — **the
     harness was never built and `analytics-service/docs/mt5-spike-gonogo.md` still has 38
     `human_needed` cells.** v1.15 shipped through a gate that was never opened.
   - **RESOLVED 2026-08-08 — founder chose option (3), and the "once per day" fact makes it the
     right answer on cost too.** See `docs/notes/mt5-scaling-cost-2026-08-08.md` (prices read
     2026-08-08) — but note that report models **one terminal per account**, which is the wrong
     model for us. MT5 accounts refresh **once per day**, and a daily sync is sequential, so ONE
     terminal serves many accounts across a day (capacity ≈ daily window ÷ cycle time). Corrected
     comparison:
     | | one-terminal self-host (what we have) | MetaApi, duty-cycled nightly |
     |---|---|---|
     | 25 accounts | ~$20/mo **flat** | ~$124/mo |
     | 100 accounts | ~$20/mo **flat** | ~$495/mo |
     | per extra account | **≈ $0** | $4.95/mo |
     The per-account marginal cost is ~zero until we exceed one terminal's daily throughput —
     then we add a second container, not a subscription. ⚠️ Throughput is currently
     **unquantified** because cycle time is uninstrumented; D-32 fixes that and is the input to
     any future revisit.
   - **Credential custody is the decisive non-price factor and it points the same way.** A managed
     provider means a third party holds customers' broker investor passwords — a GDPR
     sub-processor whose blast radius is every MT5 user at once. Quantalyze sells verified track
     records to allocators; this surfaces in diligence. Self-hosting keeps it in our own store.
   - ⚠️ Useful even though we are not buying: MetaApi bills **6 hours minimum per server start**,
     so a wizard validation there would cost ~$0.144 a click — rate-limiting interactive
     validation is sound design regardless of provider.
   - ⛔ **API2Trade: do not use** for anything holding credentials — domain created 2026-04-13,
     no Wayback history, ~5h of status-page history, yet claims "10,000+ Active Accounts", two
     different legal entities named across the site, mail-forwarding address in the Imprint.
   - **Revisit trigger** (not a task): if we ever need *interactive* MT5 at a rate that saturates
     one terminal, or if a second replica is proposed (which breaks the one-session invariant —
     D-33), re-open this with real cycle-time data in hand.
   - ⚠️ **Interacts with Phase 153 WIZFORM-05:** the 30 s wall is *also* a real timeout inversion
     (`initialize()` unbounded at its 60 s vendor default inside a 30 s rpyc bound — D-24), but
     fixing the timeout on a one-account architecture buys a working single user, not a working
     product. Decide the architecture before sizing the budget.
   **Trigger:** interactive MT5 at a rate that saturates one terminal, or a proposal for a second
   gateway replica (D-33). Re-open with real cycle-time data in hand.

0.52. **Phase 153.5 finding #8 — the 60 s per-stage ceiling wraps SIX round-trips.** Their own
   ceilings are 45 000 ms IPC and 55 s rpyc, so "innermost fires first" holds per round-trip but
   not per stage. That re-censors exactly the slow-but-working login D-24 unblocked. Do NOT guess
   these numbers. Kept from the deleted 0.5 entry; finding #10 is owned by Phase 212 WIZTRUTH.
   **Trigger:** measured per-stage latency data (D-32) shows a stage ceiling firing on a working login.

0.10. **⚠️ The wizard preselect can render a dismissal control that does nothing.**
   ⚠️ *Id note: this is the zero-padded `0.01`–`0.10` series. Do NOT confuse it with the legacy
   unpadded `0.1` item in FIX NOW, which is an older scheme cited by
   `docs/runbooks/ledger-refresh-go-live.md` (items `0.2` and `0.3` were removed 2026-11-14).* Found by the
   B-2 fixer while closing the KEY_REUSE_UNAVAILABLE dead end (2026-08-26); recorded, NOT fixed.
   `onUseDifferentKey` is an OPTIONAL prop while `preselectKey` is also optional, so a host can in
   principle render the preselect branch with no dismissal handler. The "Use a different key"
   button would then paint as a no-op — and because `KEY_REUSE_UNAVAILABLE`'s copy now NAMES that
   control as the remedy, the refusal would point at a dead button. That is the same unwinnable-loop
   class the fix just closed, one prop away.
   **Not live today** (measured): `ContributionWizardOverlay:302-303` passes both and
   `WizardClient:1262-1263` forwards both, so no host omits it. Severity is guard-hygiene, not
   user-facing — filed per the stopping rule, not blocking.
   **Fix:** make the two props co-travel in the type (a discriminated union on the preselect
   branch), so a host that supplies `preselectKey` MUST supply `onUseDifferentKey`. Requires
   editing `WizardClient.tsx`, which the fixer did not own.
   **Trigger:** a host renders the preselect branch without `onUseDifferentKey`, or `WizardClient.tsx` is next edited.

0.014. **`[D-161-04]` A contracts-registry full-suite timeout flake.** Phase 161's deferred
   tooling item (`.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/deferred-items.md`).
   Not user-facing. Re-homed from the deleted 0.01 wrapper.
   **Trigger:** the flake reds a CI run.

0.015. **`[D-161-07-B]` A `vercel-functions` validator false-positive.** Phase 161's deferred tooling
   item (same file). Not user-facing. Re-homed from the deleted 0.01 wrapper.
   **Trigger:** the false positive blocks a deploy or a PR.

### v1.14 Smoothed-MTM go-live blockers — FIXED in the v1.14 landing (2026-07-23)
Surfaced by the /ship Fable red team; the safety-critical ones fixed in the landing PR so
flipping `SMOOTHED_MTM_ENABLED` ON can never sink a healthy book's cash+MTM factsheet.
- ⏳ **GLB-1 (REMAINS — now non-catastrophic, dogfood-driven):** on an option expiry day the
  ΔMTM grid caps at `last_settled=T-1` while the anchor read is post-08:00-UTC delivery on day T,
  so the book-channel residual can breach `_assert_smoothed_book_channel`
  (`deribit_ingest.py`~2032, `deribit_txn.py`~1746) → `LedgerValuationError`. With GLB-2/GLB-3
  in place this now DEGRADES safely (smoothed omitted for that book/day, cash+MTM intact) rather
  than failing the whole job — so it is NO LONGER a flag-flip safety blocker, but it does mean
  smoothed may be unavailable on expiry days for active options books. Proper fix (reconcile the
  book channel at a boundary consistent with the anchor) is best validated against real options
  books in the live dogfood, not blind. Watch for it in the /qa + Phoenix acceptance.
  **Trigger:** `SMOOTHED_MTM_ENABLED` is turned on, or a real options book is dogfooded.

### No branch protection on `main` (from the v1.16 merge guards, added 2026-07-26)

- **No branch protection on `main` at all.** GitHub `rulesets: []` and
  `branches/main/protection` → 404 — verified first-hand. There are **no required status checks**,
  so nothing mechanically blocks a merge with red CI. Combined with the next item this is the live
  risk. ~~**Founder action:** enable branch protection requiring the `frontend`, `python` and
  `sql-tests` aggregator checks.~~
  → ✅ **DECIDED 2026-07-27 (founder): DEFERRED until there are paying clients.** Raised twice and
  declined twice; **this is settled — do not re-raise it each phase.** The reasoning is a solo-founder
  velocity trade, and it is defensible while the only committer is the founder.
  ⚠️ **The one consequence that must not go invisible:** every CI gate in this repo — including the
  real-Redis lane 140.2 built and wired strictly into the `frontend` aggregator — is **advisory at
  merge**. So *"CI is green"* is a statement about a **run**, never about **what landed on `main`**.
  Any phase-closure or verification wording must say **"the workflow would have caught it"**, never
  **"the workflow did stop it"**. `140.3-VALIDATION.md` already carries this rule verbatim; keep it
  in every subsequent phase's validation doc. **Re-open when the first paying client lands** — at
  that point the merge-time guarantee starts protecting someone other than us.
  **Trigger:** the first paying client lands.

---

## 👤 FOUNDER OPS — founder actions, not phase work

Moved here from FIX NOW on 2026-11-14 (founder: "Yes, do all three"). Each is an action only the
founder can take.

1. **`RESEND_API_KEY` unset in Vercel prod** — founder-LP report cron + all transactional
   email are dead (code soft-skips, only Sentry fires). **Founder action:** set the key in
   Vercel prod. Do before the first warned founder month. (Note: portfolio email *alerts*
   are out of the pipeline as of 2026-07-25 — the `alert-digest` cron was removed; alerts
   surface in-app + engineering failures via Sentry. This item is now only about the
   founder-LP report + transactional email.)
   **Widened 2026-07-31 (phase 141.1-08):** the flag-monitor error-rate alert now also
   depends on this key. `sendErrorRateAlert` only emails when `resend && founderEmail` are
   truthy; otherwise it returns `action: "alerted"`, logs, and sends nothing — founder-facing
   silence one layer *below* the numerator 141.1-08 just repaired. Test `I-T6` pins the
   soft-skip as intended code behaviour, but the operational gap is unverified. **Founder
   action:** confirm `RESEND_API_KEY` *and* `FOUNDER_LP_REPORT_TO` in Vercel prod before
   treating this alert as live.
2. **Deribit / Zavara mandate reconciliation (go-live).** Performance reconstructs from the
   API alone (green: cum 62.66% / maxDD −4.13%). The reported capital **4M/10M/1M/2M is
   custodied at Matrixport (keys 1&2) / LiquidityTech (key3), NOT in the Deribit keys** —
   the accounts hold only a $150–750K working-margin slice. **Custodian-statement
   reconciliation is dropped (founder call 2026-07-25) — the API reconstruction stands as
   ground truth.** Zavara live *activation* (write the proven reconciliation config to a
   `strategies` row) remains, pending a founder trigger + strategy id.
3. **sFOX / Nautilus manager-data go-live (v1.13 founder flags).** Pending founder ops:
   EGRESS / WORKER-01/03/04 / FACTSHEET / E2GT-01 / FLIP / GOLIVE. **Reframe:** manager
   data = Nautilus DD API (`api.nautilus.finance`, x-api-key), not sFOX direct — the "sFOX
   key" was a Nautilus key. Enable path = set `NEXT_PUBLIC_SFOX_ENABLED` + `SFOX_ENABLED`
   in Vercel + redeploy main (build-time flag); IP-whitelist the 3 worker egress IPs
   {208.77.244.242, 152.55.184.240/.241} with Nautilus (7-day access, email all 3).
   **Founder decision:** sFOX-venue vs Nautilus-manager path; actual vs adjusted NAV.

### Founder sign-offs pending (re-booked 2026-11-14)

### [200-FOUNDER-SIGNOFF-ACCEPTED-RISKS-AND-DEFAULTS] — founder sign-off pending on accepted risks T-200-06, T-200-09, T-200-10, T-200-13 and on the orchestrator-default decisions D-01..D-15 and D-R1 (booked 2026-11-11, Phase 200 verification; re-booked 2026-11-14 as a founder decision, not a LOW finding)

**Reading.** Phase 200 ran with orchestrator defaults for decisions D-01 through D-15, and D-R1 (an unchecked feeds read holds Delete key, not Disconnect) was recorded at review time. The security audit accepted four risks (T-200-06, T-200-09, T-200-10, T-200-13). None of this has been signed off by the founder. D-06 (the API keys tab for every role) is the costly one to reverse.

**Why it is back.** TODOS sweep 2 deleted it with the Phase 200 LOW section because its own tag read LOW. The founder chose to keep tracking it (2026-11-14).

**Owner / Trigger:** founder. Closed when the founder confirms or changes each, starting with D-06.

---

## 🟡 FIX MID-TERM

- [ ] **[209-SENTRY-DIRECT-CAPTURE-DETAILS]** (logged 2026-11-14, Phase 209 SCRUBLEAKS review residual, CONTEXT `<deferred>`; MEDIUM, security/data-integrity; owner: unassigned, book a phase when taken up) **Direct `Sentry.captureException` call sites bypass `scrubCaptureInput`, so a plain PostgREST error object captured there still carries `details` and `hint` to Sentry under `extra.__serialized__`.**
  - **Why:** Phase 209 scrubbed the `captureToSentry` chokepoint and made `beforeSend` total; the SDK serialises a non-Error capture into `extra.__serialized__`, which `scrubSentryEvent` scrubs for share tokens only. Measured in review: `alert-digest` (two sites) ships `details`/`hint` this way.
  - **Candidate sites:** `alert-digest` (2), `admin.ts`, `founder-lp-report`, `ops-alert`, `for-quants-lead`, `error.tsx`/`global-error.tsx`, plus `audit.ts`, `for-quants-leads-admin.ts`, `preferences.ts`. Find them with `grep -rn -a 'Sentry.captureException' src --include=*.ts --include=*.tsx`, excluding tests.
  - **Fix direction:** one arm in `scrubSentryEvent` (`src/instrumentation.ts`) that drops `details`/`hint` from `extra.__serialized__`, so every direct site is covered at the last hop; or route the sites through `captureToSentry`.
  - **Gate:** a real-SDK envelope test (the in-memory transport in `src/instrumentation.test.ts`) capturing a plain object with `details`/`hint` sentinels, shown RED before the fix.

- [ ] **[198-FD3-SIDEBAR-ADD-A-STRATEGY]** (logged 2026-11-09, Phase 198 MYBOOK, founder decision FD-3 2026-11-08; owner: unassigned, book a phase when taken up). On the allocator workspace, the sidebar and mobile-nav "Add a Strategy" still open the manager `WizardClient`. Phase 198 took the wizard off the My allocation header only; the header now opens the allocator's own add-allocation flow. The founder chose to leave the sidebar entry alone in that phase and book this follow-up. Decide what "Add a Strategy" means for an allocator (the add-allocation flow, a manager-only entry, or hidden), and update `e2e/wizard-resume.spec.ts`, which now reaches the wizard through the sidebar.

- [ ] **[198-SHARED-ACCOUNT-FALLBACK-UNNAMED]** (logged 2026-11-09, Phase 198 MYBOOK review round 3 residual of R3-01, MEDIUM, user-facing; owner: unassigned). In `MissingDataMessage.tsx`, the `not_syncing` fallback now prints unless every attributed key is named. `shared_account_failing` still counts printed lines, not the keys the reason attributes, because its producer carries no attributed-key list. So a shared-account key whose history reaches yesterday can go unnamed when another key of the same cause prints a line. Fix: have the producer in `key-data-gaps.ts` / `queries.ts` (`deriveKeyDataGapsField`) emit the attributed key ids for that cause, then apply the R3-01 rule to it. Test: two keys, both shared-account failing, one with a gap and one with data through yesterday; both must be covered.

- [ ] **[DEPS-REACT-HOOKS-7.1-LINT]** (logged 2026-10-30, found landing PR #1157, which superseded Dependabot #1122-#1124; owner: unassigned, book a phase when taken up) `eslint-config-next` 16.3.8 to 16.4.2 was LEFT OUT of #1157 because it pulls `eslint-plugin-react-hooks` 7.1.1, which raises 64 new lint errors in `src/` across six rules: `set-state-in-effect`, `refs`, `purity`, `immutability`, `preserve-manual-memoization` and `error-boundaries`. ⛔ Do NOT land it by downgrading those rules to `warn`; fix the sites, then take the bump. Dependabot will re-propose it; that PR stays red until the sites are fixed. Done when `eslint-config-next` is at 16.4.2 or later, `eslint.config.mjs` is unchanged in rule severity, and `npm run lint` exits 0.

- **[170.1-CSV-ODD-SPELLING-REJECTED]** (logged 2026-10-19, Phase 170.1 COPY final silent-failure hunt F2, MEDIUM, user-facing; owner: CSV timezone/header follow-up phase). **Still open (narrowed 2026-10-19 by `317ac4dd1` and 2026-10-20 by `4231f3de7`):** year-first (ISO) cells in a day-first column and ISO cells in a US month-first column are accepted again with the right range. A month-name cell (`12 Mar 2024`) in a numeric-date column stays a loud row rejection by choice (reading it needs a month-name parse). **Closed when:** the founder accepts that as final, or a month-name parse ships with a test.

- **[170.1.2-VERIFIER-RESIDUALS]** (logged 2026-10-20, Phase 170.1.2 LABELS verification W-1 to W-7, none a FAILED truth; owner: the next phase touching each surface). One line each:
  - W-1 (WARNING): `src/components/strategy/TrustTierLabel.tsx` reads `TRUST_TIER_TOKENS[trustTier]` with no guard and no census on `strategy_verifications_trust_tier_check`, so a new tier would make `/admin/csv-status` throw instead of reading a fallback; unreachable today.
  **Closed when:** each line is fixed or struck by decision.

- **[170.1-SC5-SCENARIO-NARROW-DEFECTS]** (logged 2026-10-20, Phase 170.1 COPY SC-5 measurement on the local stack; owner: Phase 170 LAYOUT or the next phase touching the scenario composer). **Still open:** (1) at 390 px the sticky commit bar's change summary ("+0.67 Sharpe · −6.5% Max DD · +4.5% TWR") runs underneath the "Reset" button, overlapping text (user-facing); (4) copy: the CSV envelope summary reads "(1 rows)". Item (2), the clipped chart axis labels, shipped in Phase 170.1.3 NARROWCHARTS. **Closed when:** each is fixed or ruled acceptable, with a 390 px measurement.

- **[170.1-CSV-OFFSET-DATE-SHIFT-PROD]** (logged 2026-10-16, Phase 170.1 COPY, review finding D14-M3, founder decision "Measure now"; owner: the CSV timezone phase if the founder's split is booked, otherwise the founder). Before Phase 170.1's D-14 round, a CSV upload whose `date` column carried a single UTC offset with a time (for example `T00:00:00+02:00`, or `T20:00:00-05:00`) validated, and the `daily_returns_series` the wizard then finalized could sit one calendar day off the dates the user wrote, while the validator's `date_range` showed the written dates. 170.1 fixes it for new uploads (`daily_returns` and `daily_nav` keep the wall-clock date). **What cannot be measured:** the original upload is not kept anywhere; the validate envelope (`preview`, `date_range`) goes back to the browser and is never persisted, so only the parsed dates in `csv_daily_returns.date` exist, and a uniform one-day shift is invisible in them. **PROD reading 2026-10-16 (read-only, counts only, marker first):** 27 strategies with `source = 'csv'`, 0 published; 18 have no daily rows; 9 have a daily series. Weekday signature of those 9: 2 are Mon–Fri only (a shift would have made them Sun–Thu or Tue–Sat, so those 2 are unshifted); 7 carry every weekday, where a shift cannot be seen; 0 show a Sun–Thu or Tue–Sat signature. The 35 per-key series in `csv_daily_returns` (`api_key_id` set) are all seven-day, so equally undetectable. **Exposure today:** nothing published; at most 7 unpublished CSV strategies could carry a shifted series, unprovable either way. **Closed when:** the founder accepts the reading, or the owners of those strategies re-upload (a re-upload of the same file now stores the written dates). Trigger: any of the 7 being submitted for publication, or a user report of dates one day off.

- **[170.1-STRATEGIES-NOTE-WAIT-WORDING]** (logged 2026-10-16, Phase 170.1 COPY plan 06 follow-up, coordinator decision the same day; owner: Phase 170.1.2 LABELS, or the next phase that touches the `/strategies` share notes). D-08 ("notes follow the body") was scoped deliberately to two kinds: `analytics_failed`, and `finished_not_built` for a job that FINISHED without a buildable factsheet. Every other unpublished row whose recipient arm is `not_available` still gets the KCS12-MINT-B note, `MINT_TOKEN_NOTES.not_available` in `src/lib/status-surface-copy.ts`: "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds." **Trigger:** an unpublished strategy on `/strategies` whose compute state is `failed`, `stalled` or `never_started` (all three map to the `not_available` arm in `recipientArm`), without the `analytics_failed` embed. For those rows "not available yet … once a computation succeeds" tells the owner to wait, while nothing is running and nothing will succeed without an action. **Closed when:** each of the three states gets a note that names what the owner can do (or the founder rules the wait wording correct for one of them), with a `page.key-pill.test.tsx` case per state asserting the rendered sentence, and the `it.each` over those states in that file re-pointed rather than deleted.

- **[166.5-PDF-MIXED-VINTAGE-WINDOW]** (logged 2026-10-15, Phase 166.5 COMPUTEDATSTAMP plan 07, Pitfall 6; owner: a FOUNDER decision; trigger: a factsheet PDF that disagrees with its own lazy panels). The analytics runner now stamps `computed_at` in the same upsert as the metrics, and writes the sibling series (the rolling, drawdown, grid and log-return kinds the lazy panels read) AFTER it through `upsert_strategy_analytics_series_batch`. The factsheet payload cache (`unstable_cache`, keyed on `computed_at`) is NOT exposed: it builds only from the metrics row and the cash, MTM and smoothed-MTM series, all written BEFORE the stamp. The PDF route (`src/app/api/factsheet/[id]/pdf/route.ts`) IS exposed: it renders the page with puppeteer `networkidle0`, so the lazy panels fetch the sibling series, and a render that lands between the stamp and the sibling write shows NEW scalars beside the PREVIOUS run's lazy panels. That PDF carries ETag `id:computed_at` under the NEW date, `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`, and answers `If-None-Match` with 304, so the CDN can serve it for up to 3600 s (stale up to 86400 s more) and a revalidating client keeps it 304-valid until the next real recompute moves `computed_at`. Before this phase the bridge stamped AFTER the siblings, so such a render carried the OLD date and was replaced on revalidation. **Window width, measured 2026-10-15 on the local stack:** one `upsert_strategy_analytics_series_batch` round trip through PostgREST as the service role, 12 kinds, 560 034 bytes (real `compute_all_metrics` output over 1 100 daily points plus two synthetic kinds), 5 calls: median 24.1 ms, max 41.6 ms. A LOWER BOUND for PROD (no network hop). Only a PDF requested inside that interval is affected, and the sibling write is skipped entirely for a strategy with no sibling kinds. **Closing option:** write the sibling series BEFORE the success write, as the cash series already is (`_persist_cash_series` before `_mark_complete`), folding a sibling failure into that write's flags (`sibling_kinds_failed`) instead of the current after-the-fact flag upsert. That moves the stamp to be the last write of a good compute again. **Closed when:** a test proves a sibling-series write never lands after the date moves (the order of the two writes is asserted in both the CSV runner and the composite stitch), or the founder accepts the window and this entry is struck with the width above recorded.

- **[166.5-STALE01-PREMISE]** (logged 2026-10-15, Phase 166.5 COMPUTEDATSTAMP plan 07; owner: Phase 166.5 follow-up, a FOUNDER decision; trigger: a failed row now carries an honest last-good date). STALE-01 (`src/lib/queries.ts`, `isComputedAnalytics` and the `failed` / `pending` / `computing` arm below it) hides every figure on a ranked-list row whose analytics status is not a computed one. Its stated reason was that the date beside those figures dated the FAILURE, not the numbers (the status bridge re-stamped `computed_at` on every transition). Since Phase 166.5 the bridge writes no date and the analytics runner stamps it on its success write only, so a failed or computing row carries the date of its LAST GOOD compute, and the premise the gate rests on has changed. **Question for the founder:** should a failed or computing row now show its last good figures beside that honest date, instead of hiding them? **If yes:** the arm returns the stored figures (with the badge reading the last good date, and a visible "last run failed" cue so a dead figure is never presented as current), `isRankableAnalyticsRow` and the percentile cohort gate must be re-decided in the same change so the cell and the cohort cannot disagree (RANK-01), and the `computing` arm stops costing a published row its figures for the ~10-15 minutes a job runs. **If no:** the arm is kept as it is and only its comment changes; hiding stays the product rule. **Behaviour today:** unchanged by Phase 166.5. The comments in `queries.ts` were rewritten to the new truth and point here. **Closed when:** the founder answers, and either the arm changes with a test that fails on today's behaviour or this entry is struck with the decision recorded.

- **[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]** (logged 2026-10-15, Phase 166.5 COMPUTEDATSTAMP review round 2; owner: none routed, it REVERSES CONTEXT R-04 so it needs a FOUNDER decision first; trigger: a portfolio constituent reading > 0, or the next phase that touches `computed_at` readers). `strategy_analytics.computed_at` is `DEFAULT now() NOT NULL`, so a row nothing has ever computed (the bridge's INSERT arms omit the column, the runner's `computing` entry write inserts it) carries the date of its INSERT, a date no compute wrote. Phase 166.5 narrows this (before it, the bridge re-stamped such a row on every hop) but does not remove it, and CONTEXT R-04 recorded it as a known limit. **PROD reading 2026-10-15 (read-only, marker first):** 12 never-computed rows, 0 of them portfolio constituents, which is why it is booked and not fixed. **Where it shows:** the portfolio page reads the raw column for the donut slice tooltip (`src/app/(dashboard)/portfolios/[id]/page.tsx`, `SyncBadge`: "Analytics last computed 3h ago" over a strategy nothing computed) and for `staleConstituents` (a never-computed row is not `stale` for its first 48 h, so the amber warning omits it); the breakdown table for the same row shows no date, so the two surfaces disagree. **The root fix the review evaluated:** `ALTER TABLE public.strategy_analytics ALTER COLUMN computed_at DROP DEFAULT, ALTER COLUMN computed_at DROP NOT NULL`, a one-off `UPDATE ... SET computed_at = NULL` for rows that never completed, and `StrategyAnalytics.computed_at: string | null` in `src/lib/types.ts`. NULL is the honest encoding, `computeFreshness(null)` already returns `stale`, and the bridge INSERT arms already omit the column. **Four caveats that make it not ready as a quick change:** (1) **The 166.3.1 hold trigger defeats a plain backfill UPDATE.** `strategy_analytics_hold_computed_at_until_success()` (`20261013120000_strategy_analytics_hold_computed_at_until_success.sql`, BEFORE UPDATE) does `NEW.computed_at := OLD.computed_at` whenever `computation_status IN ('failed','computing')`, so for exactly the rows the UPDATE targets it reports success and changes nothing; it sticks only for `pending`. The migration needs a trigger-aware path (disable the trigger around the UPDATE inside the transaction, or let an explicit NULL through and update that migration's verify anchors and the SQL gate that pins the body), and in every case a post-UPDATE `DO` block that asserts zero never-completed non-NULL rows remain, so a no-op fails loud. (2) **It reverses CONTEXT R-04** ("first-ever rows keep the column `DEFAULT now()` (NOT NULL); recorded as a known limit"), which is why it is a founder decision and its own phase. (3) **The rollback cannot restore `NOT NULL` honestly.** Once NULLs exist, `SET NOT NULL` fails unless the rollback first writes a value into them, which reintroduces the false "computed now" date the change exists to remove; the rollback has to name the value it writes and why. (4) **NULL semantics at readers that never saw one:** `ORDER BY computed_at DESC` puts NULLs FIRST by default in Postgres and PostgREST (no such site on `strategy_analytics` in `src/lib/queries.ts`, but re-check SQL functions, e.g. `get_allocator_recommendations` returning `sa.computed_at AS analytics_computed_at`); `x > sa.computed_at` silently evaluates false (the `ledger_refresh_staleness` view projects the column); the factsheet payload cache key and the PDF ETag must treat NULL as a distinct, non-colliding value; every other `INSERT INTO strategy_analytics` site (5 in the baseline, including the wizard RPCs and `finalize_csv_strategy_with_returns`) starts producing NULL, so each consumer needs the typecheck sweep. It also moves the baseline snapshot, the carried-migration marker, VAC-04 and baseline-content-drift, and needs `migration-reviewer` and `rls-policy-auditor` clean before merge because PROD auto-applies with no human stop. **Closed when:** the founder decides, and either the migration ships with the four caveats answered in its own gate (a NULL backfill that visibly sticks on a `computing` row, a rollback that names its fill value, a NULL arm for each reader above) or this entry is struck with the decision recorded.

- **[164.6.8-OPS-ALERT-EMAIL-UNCONFIGURED]** (logged 2026-10-14, OUTAGEALERT plan 09 drill, founder decision D-15; owner: the founder). The founder-email paging channel cannot send, because production has no Resend key configured in Vercel. The 2026-10-14 drill (19:50 UTC, `source=drill`) reached the analytics side and Sentry, and then `POST /api/cron/ops-alert` answered 502 with `EmailSkippedError: [email] Resend not configured`. It failed loud, as designed: the Next.js route logged the error to Sentry and the Python side logged `ops_alert: the founder email POST was not accepted (status=502)`. Founder decision D-15 (2026-10-14): Sentry is the only live paging channel for now ("Sentry only for now"); the email code stays shipped and loud, and this is not a defect in it. Until this closes, an outage page reaches a human only through the Sentry rule "Ops alert: outage (164.6.8)", and the closures of the entries listed in the Phase 164.6.8 plan 09 SUMMARY rest on that Sentry delivery alone. Done when Resend is configured in Vercel production, the plan 09 drill is re-sent, and the founder confirms the email arrives (the route answers 200 instead of 502). Not a close: a green deploy, or a unit test of the route. Trigger: the founder wants a second paging channel, or the first outage whose Sentry notification is missed. ⭐ **2026-10-15, D-16 (Phase 164.6.8 plan 10):** a RECOVERED notice is now credited once its Sentry capture returns an event id, so the open-page record closes while email is unconfigured. Known limit routed here: the Sentry rule "Ops alert: outage (164.6.8)" filters `ops_alert_event=outage`, so a credited recovered capture notifies nobody until the Sentry rule is widened (or a second rule added). Until email works or the rule is widened, a recovery is visible in Sentry but not pushed to the founder. ⭐ **2026-10-15 (founder: "Widen the rule to recovered"):** the rule was widened the same day. A second action group on `ops_alert_event=recovered` sends the same email to the issue owners, so a recovery is now pushed through Sentry like an outage. What stays open here is the email channel alone.
- **[170.6.1-SYNCBADGE-OTHER-MOUNTS]** (logged 2026-10-14, DISCOVERYPHONE (2/2), D-06; owner: the next phase touching any of these surfaces). PR-B names the venue a strategy's trades come from on the Discovery table and grid only. Measured 2026-10-14: `CompositionDonut`, `StrategyBreakdownTable` and `/recommendations` mount `SyncBadge` and render no venue label today, and `StrategyHeader` passes `exchange` but its badge resolves to no bound and renders nothing, and the component is mounted on no page. Action: decide whether these surfaces should name the venue; if so, feed them the venue read (`readPublishedTradeVenues` is module-private in `src/lib/queries.ts`, so it needs exporting or a shared helper), and update the source-reading pin in `src/lib/queries.trade-venues.test.ts` deliberately, because it asserts these four files pass neither `tradeVenues` nor `listedExchanges`. Trigger: the next phase touching any of them.
- **[170.6.1-PUBLIC-TRADEFETCHVENUE]** (logged 2026-10-14, DISCOVERYPHONE (2/2), D-07; owner: a TRADESYNC state decision for the founder). Public mounts pass `tradeFetchVenue={null}` to `SyncBadge`, so a never-fetched key strategy reads as no claim rather than "No trade fetch recorded yet". PR-B deliberately changed only the label and tooltip, because feeding the state's venue turns every null-stamp row on a public surface into a visible "never fetched" claim. Done when the founder decides whether the public badge should carry that claim and, if so, the venue read feeds `resolveTradeFetch` with the state tests updated in the same commit.
- **[166.3.1-NOCAP-MT5-A2-CIRCULAR]** (logged 2026-10-13, NAVBREACH review round 1, SFH F3, MEDIUM conf 5; owner: a future phase touching the allocator compose). For MT5 the stored realized terminal is the live balance, so the A2 check (stored terminal at or below `DUST_NAV_FLOOR`) does not independently confirm a live `dust`/`nonpositive` read. A transient zero balance without `balance_error` could make a funded MT5 key exit while the book stays trustworthy, and a negative equity exits under `nonpositive` with no sign recorded. `refresh_allocator_equity_daily` requires an independent clean-empty poll for the same reasons. Done when the no-capital exit requires independent proof (the poll-outcome audit or a terminal not derived from the live read) and `nonpositive` with negative equity degrades or records its sign.
  ⭐ 2026-11-02 (Phase 176 LEGACYRETIRE): the `refresh_allocator_equity_daily` comparison no longer exists (its job body was deleted by Phase 176 plan 11 (PR 2, shipped in v0.133.15.0)); the A2 check itself is unaffected. Stays open.
- **[166.3.1-NOCAP-FALLBACK-TRACE]** (logged 2026-10-13, NAVBREACH review round 1, SFH F1, MEDIUM conf 6; owner: as above). When a no-capital candidate falls back to `dropped_key` (compose-level refusal, blocking reason, or the job-level revert), only a log line records it. The payload carries no flag or counter, so a regression in A3 would look like today's state. Done when a benign payload token (for example `no_capital_exit_refused`) with a counts-only field marks every fallback.
- **[166.3.1-NOCAP-NONNAV-EXCEPTIONS]** (logged 2026-10-13, NAVBREACH review round 1, SFH F2, MEDIUM conf 5; owner: as above). The "a candidate never costs the book its stored row" revert covers `NavReconstructionError` only. A `KeyError`/`ValueError`/`TypeError` from a candidate's inputs in the compose or the apply loop escapes the job, leaving the row stale on every retry. Done when any exception while candidates are in play reverts to the stored inputs once, with the exception class logged.
- **[166.3.1-NOCAP-SEGMENT-REASON-RESIDUE]** (logged 2026-10-13, NAVBREACH review round 2, WR-04, MEDIUM; owner: a future phase touching the allocator compose). When a no-capital candidate's interior hole lacks its stored segment terminals, the candidate falls back but the payload keeps `key_inputs_mismatch` as a blocking reason that today's payload never carries. The book is still untrustworthy either way, so it never reads wrongly trustworthy; only the reason differs. Done when a refused candidate leaves the payload byte-equal to the no-candidate payload, with a test on that shape.
- **[166.3.1-SYNC-PANEL-UNSTAMPED-FAILURES]** (logged 2026-10-13, NAVBREACH secure-phase T-25; plan 03 was to book it and is deferred; owner: a future phase touching analytics failure writers). Eight failure paths write `strategy_analytics` `failed` with no `computation_error_job_id`, so a failed-to-failed Retry on the key-card Sync panel gets no evidence (c) and waits for the ~120 s cap: the sync-trades `_mark_analytics_failed`, the stuck-computing reaper, bridge-generic `failed_final`s, a stamped writer that is not the latest failure, the `upsert_or_drop_provenance` degrade, `_unrecoverable_reissue_payload`, `run_csv_strategy_analytics` with `job_id=None`, and the TS pre-enqueue writers. The list with reasons is in the plan 07 SUMMARY. UX cost only, not integrity. Done when each path either stamps an id or the panel has another evidence signal for it, with a fast-fail test per class.
- **[166.3.1-M3-ANCHOR-OPTIONS-UPL-RESIDUE]** (logged 2026-10-15, NAVBREACH plan 05, MEDIUM, data integrity; owner/trigger: Phase 167.1.2.1.1 WRITERRESIDUALS or the next phase touching the Deribit anchor). Two recomputes of the composite in two quiet UTC sessions agree to the last digit on members 1 and 2 but member 3 differs on 64 of 143 common days, by up to 5.5e-08 (none above 1e-7; median 2.3e-09). Hypothesis, unconfirmed: member 3 holds an open options book (probe: `has_open_options_book` true, `options_session_upl_nonzero` true, `gate_candidate_rpl_only` `breach:1.54`), and its session options UPL moves the anchor between sessions; members 1 and 2 have no options book and are exact. SC-3 was accepted at 1e-7 absolute (D-12). Done when the comparison is re-run on a session where the options book is flat, or the anchor is computed with and without the options UPL, and the residue is either removed or shown to be float noise.
- **[166.3.1-STITCH-ATTEMPT1-STALL]** (logged 2026-10-15, NAVBREACH plan 05, MEDIUM; owner: the next phase touching the job worker or `stitch_composite`). Run 2's `stitch_composite` was claimed, then showed no update for about 25 minutes and was reclaimed by the worker's own recovery; attempt 2 ran to `done`, 49 minutes after the enqueue in total against about 18 minutes for run 1. Cause not investigated. Done when the worker logs for that window say why the first attempt stalled (a deploy restart, a lost heartbeat, a hung venue call) and the cause is fixed or recorded as benign.
- **[CI-LIVE-DB-LANE-GATEWAY-502]** (logged 2026-10-15, main CI run 38711968694 on the #1042 merge; owner: the next phase touching `scripts/local-stack/run.sh` or the live-DB lane). `frontend-live-db-lane` failed once: the claim RPC call in `compute-jobs-audit-2026-05-07-g10b.test.ts` (arm "P12-harm: a parented child is not claimable before its parent is done") received "An invalid response was received from the upstream server" from the runner-private local stack's gateway, so the execution ledger flagged one NEW failing arm. The same arm passed on the PR's own run and on main's next push; the lane passed 22 of the last 23 executed runs. Not a fan-in logic failure. Done when a second occurrence is either absent over the next 50 lane runs (close), or, if it recurs, the gateway or PostgREST log for that window names the cause and it is fixed at the source (never a retry around the arm).

### 201.1-COMPOSER-RANGE-AS-DATES — the composer saves its selected range as dates, so 12M always ends on the latest day (booked 2026-11-13, Phase 201.1 review, founder decision at the v1.21 close, user-facing)

**Reading (Phase 201.1, 2026-11-12).** The scenario composer keeps the user's selected range as indices into the date axis (`userRange` in `factsheet-context.tsx`, kept while `userRange[1] <= maxIdx`). When the axis grows at the FRONT, because an earlier day is added, the same indices point at different days, so a 12M pick drifts off the latest day. 201.1 fixed the opening-range defect and the shrunk-axis case (WR-01, `56ae54095`) and booked this one, because storing dates conflicts with the pinned "kept when the series grows" contract. Recorded in `201.1-VERIFICATION.md` (Notes, item 4) and the v1.21 milestone audit.

**Decision (founder, 2026-11-13, "Book a fix"):** "save the composer's selected range as dates, so presets like 12M always end on the latest day, and re-pin the 'kept when the series grows' contract to mean the same dates are kept." It belongs to the NEXT milestone and did not block the v1.21 close.

**Owner:** the next milestone (book it as a phase with `/gsd-phase` when that milestone's roadmap is written).

**Trigger / closed when.** The next milestone's roadmap, or the next phase that touches `factsheet-context.tsx` or the composer range presets. Closed when the selected range is stored as dates, a 12M preset still ends on the latest day after the axis grows at the front (a test that goes RED on today's index storage), and the "kept when the series grows" pins assert that the same dates are kept.

### 196-V2-PANELS-REVIVAL-01 — revive the Trades & positions and Exposure & benchmark greeks panels dropped with /strategy/[id]/v2 (booked 2026-11-09, Phase 196 D-06, founder decision 2026-11-08)

**Why it is open.** The two panels rendered only inside `StrategyV2Shell` on `/strategy/[id]/v2`, which Phase 196 retired (D-03). The founder chose "drop now, book a phase" (D-06), so they were deleted with the shell, their tests and their library helpers. The factsheet carries none of what they showed:

- **Trades & positions** showed trade counts (total, long, short, wins, losses, win rate), position counts (open, closed, average duration), the risk-reward profile (R:R, weighted R:R, profit factor, payoff ratio, long and short profit factor, expectancy, SQN), volume metrics (gross volume, mean trade size, daily and monthly turnover) and a Trade mix sub-panel (long and short maker and taker buckets, entry counts).
- **Exposure & benchmark greeks** showed the net and gross exposure chart, the turnover chart, the benchmark greeks table (alpha, beta, information ratio, Treynor) and the 90-day rolling correlation with BTC chart, each with a say-why line when its series was absent.

Beta, alpha, information ratio and Treynor still appear on the factsheet through its own rail and Advanced Detailed metrics. What is gone is the trade and position counts, the risk-reward and volume figures, the exposure and turnover charts and the rolling correlation chart.

**Owner:** unrouted, a follow-up phase to be booked (`/gsd-phase`).

**Trigger.** A founder or an allocator asks for trades, positions, exposure or greeks on the factsheet.

**What closing it means.** Both panels live inside the factsheet's Advanced disclosure under the document layout, each with a say-why line for an absent series, behind the same figure gates as the rest of the page, and with tests (including the record-gate and unit arms). The panel hooks, readers and charts were deleted in Phase 196 plan 14 and must be rebuilt or restored from history; the original files are in the git history before the plan 14 commits. The 13 chart-token exports and three minimum-history constants plan 14 left behind (see `196-ORPHANS-01`) are the ones those panels read.

### 196-STYLE-DRIFT-CENSUS-BLIND-01 — the census counter cannot see the Style Drift table, so "0 repeated metrics" does not cover its rows (booked 2026-11-09, Phase 196 plan 09, open item 3)

**Why it is open.** Style Drift lists Sharpe, Sortino, Ann. Volatility, Skew, Kurtosis and Max Drawdown per half in a `text-fixed-11` table; `countFactsheetCensus` reads `table.text-fixed-12` rows only. They are first-half and second-half figures, arguably not repeats of the headline ones, but the counter cannot say either way. Two small-sample notes in `BatchDPanels.tsx` (`style-drift-figure-gate-note`, "One or both halves have < 126 obs") also read as small-sample statements and were outside plan 09's files.

**Owner:** unrouted, founder or planner call.

**Trigger.** The next edit to `countFactsheetCensus` or to `BatchDPanels.tsx`.

**What closing it means.** Either the counter reads the Style Drift rows and the decision on whether per-half figures are repeats is recorded, or the exclusion is written into the counter's definitions in `196-CENSUS.md`; and the two small-sample notes are either added to the note family or ruled out of it.

**Restated 2026-11-11 (Phase 201 plan 201-09, still OPEN).** Plan 201-09 edited `BatchDPanels.tsx`, this entry's trigger file: each `StyleDriftPanel` row gained a sixth tuple member (the glossary term key) so its label renders through `Term`; the label is still the React key and the displayed text. The close condition was NOT met: `countFactsheetCensus` was not changed and still does not read the Style Drift rows (`scripts/factsheet-census/count.test.tsx` and `FactsheetBody.census.test.tsx` stay green with no edit), no decision on per-half repeats was recorded, and the two small-sample notes (`style-drift-figure-gate-note` and the `thinHalf` note below 126 days) are unchanged and still render, neither added to the note family nor ruled out of it. The next edit to the counter or to the notes is still the trigger.

### 196-HINT-COPY-PARITY-01 — the one chart hint dropped two interactions the per-chart screen-reader text described (booked 2026-11-09, Phase 196 plan 11, open item 2)

**Why it is open.** The UI-SPEC's hint copy was used verbatim. The per-chart screen-reader text it replaced said "Home or zero resets" and "the wheel alone scrolls the page"; the UI-SPEC copy says "Home resets" and omits the plain-wheel statement. The chart code also resets on `0` and `Escape` (code, not copy). A screen-reader user told only "Home resets" loses the `0` alias, and nothing says a plain wheel scrolls the page. The histogram's "double-click to reset" is kept. Copy is a designer decision, so it was recorded, not changed.

**Owner:** unrouted, founder or designer call. Proposal on the table: "Home, 0 or Escape resets".

**Trigger.** The next edit to `chart-hint.tsx`, or an accessibility review of the factsheet.

**What closing it means.** The copy states every reset key the charts accept and the plain-wheel behaviour, or the omission is decided and recorded in the UI-SPEC; a test pins the copy against the keys the chart handlers accept.

### 196-FACTSHEET-DETAIL-CALLS-01 — four small design calls Phase 196 recorded and did not decide (booked 2026-11-09, Phase 196 plans 09, 10 and 11)

**Why it is open.** Each is a one-line design call on the factsheet's detail, left as it was because it needed a designer or founder decision:

1. **BASIS eyebrow twice (plan 10).** `part="detailed"` still renders the BASIS eyebrow, so on a composite or MTM strategy with Advanced open the eyebrow shows once above Main metrics and once above Detailed metrics.
2. **`maxDdSpan` wording (plan 09).** The Risk group's kept note says "Max Drawdown covers only that span; the other figures in this panel cover the whole record", but Max Drawdown lives in the strip now.
3. **Signatures for a native-unit strategy (plan 11).** The section renders with withheld-form panels (a 164.6.6.2 D-10 decision), which the "empty sections are not rendered" rule could be read to cover. It stays on its own gate.
4. **No "Strategy" column label in Main metrics (plan 09).** The UI-SPEC says the header carries `Strategy` plus the comparator column; the existing `Panel` has no per-column Strategy header, and only the dated `vs <comparator>` header is there.

**Owner:** unrouted, founder or designer call.

**Trigger.** The next edit to `MetricsColumn.tsx`, `AdvancedDisclosure.tsx` or the Signatures gate.

**What closing it means.** Each of the four is decided and either changed with a test or recorded as accepted in the UI-SPEC.

### 196-BENCHMARK-ROW-FULL-LAYOUT-01 — the Terms Benchmark row also shows on the full-layout mounts (allocator and composer), not only on the published factsheet (booked 2026-11-09, Phase 196 plan 16, deviation 3)

**Why it is open.** Plan 16 added a Benchmark row to Terms, rendered when `native.benchmark` is a non-empty string, and the plan named no variant. `TermsPanel` also renders in the full layout (the allocator mounts and the composer), so a declared benchmark now shows there too. No test pinned the full layout's Terms rows against a declared benchmark, and the `v2` suite stayed green. Whether the allocator mounts were meant to stay byte-identical is a design call.

**Owner:** unrouted, founder call.

**Trigger.** The next edit to `MandatePanels.tsx`, or a report that an allocator mount shows a benchmark it did not before.

**What closing it means.** Either the row is gated on the document variant (`documentVariant &&`) with a test that the full layout renders no Benchmark row, or the full-layout row is accepted and pinned.

### 196-ORPHANS-01 — orphans Phase 196 plan 14 left because their files were not declared, plus stale mentions (booked 2026-11-09, Phase 196 plan 21, residuals R2 to R5)

**Why it is open.** Plan 14 deleted every orphan it had declared and recorded the rest, none deleted undeclared. The end-of-phase knip reading (`196-KNIP-BASELINE.txt`, `## end of phase`) has four entries the pre-phase reading lacks:

- **R2** `TradeFetchUnavailableLine` and the `fixed-10` size variant in `src/app/factsheet/[id]/trade-fetch-lines.tsx`: orphaned by plans 13, 15 and 17. Only a comment in `FactsheetView.reconstructed-range.test.tsx` names the former.
- **R3** the unused `chart-tokens.ts` exports `CHART_SURFACE`, `CHART_TRACK`, `CHART_NEUTRAL`, `CHART_POSITIVE_*` and `CHART_NEGATIVE_*` (100, 300, 700, 800) and `CHART_TEXT_ON_LIGHT_POSITIVE` and `CHART_TEXT_ON_LIGHT_NEGATIVE`. Their last readers were the deleted charts; token-drift tests pin them.
- **R4** the unused `min-history.ts` constants `CORRELATION_90D_MIN_DAYS`, `BENCHMARK_ROLLING_WINDOW_DAYS` and `WORST_DRAWDOWNS_MIN_DAYS`.
- **R5** `LazyMetricsPayload` in `types.ts` (type-only, pinned by `types-design-tests.test.ts`, no production user) and its `self-referential-oracle` allowlist entry.
- `readRecordSpan` in `src/lib/record-span-read.ts` has no non-test importer after plan 13 (comments only); knip does not list it because its tests import it.
- `src/lib/queries.stale-analytics-detail.test.ts` has two unused fixtures, `WARNED_ROW` and `COMPUTING_ROW`, left when plan 14 removed the test groups that used them; `npm run lint` reports them as two new warnings (0 errors).
- `scripts/factsheet-census/run.ts` is listed as an unused file, like the other standalone scripts in the baseline; it is a manual Playwright driver and not wired to CI by design.

Stale mentions, comment-only or in generated maps: `.planning/codebase/STACK.md` and `INTEGRATIONS.md` still describe `BookIntroCall` and `NEXT_PUBLIC_SCHEDULING_URL`; `src/test-setup.ts`'s IntersectionObserver stub comment names `useLazyPanelMetrics`; comments in `FactsheetView.tsx` and `composite-read-path.ts` still mention the deleted discovery page or "three sites".

**Owner:** unrouted. If `196-V2-PANELS-REVIVAL-01` is taken up, R3 and R4 are its to reuse or delete; otherwise the next dead-code pass.

**Trigger.** The next dead-code pass, or the `196-V2-PANELS-REVIVAL-01` phase (which would reuse the chart tokens and minimum-history constants).

**What closing it means.** Each item is deleted with its test rows in the same commit, or kept with a reason in the file; `npx knip --include files,exports --reporter compact` shows no entry the `## pre-phase` section of `196-KNIP-BASELINE.txt` lacks; the generated maps are regenerated.

### 196-PDF-ROUTE-RETRY-CLASSES-01 — the two factsheet PDF routes still mislabel some failures for their callers (booked 2026-11-09, Phase 196 review round 3, R3-02 and silent-failure M-B)

**Why it is open.** Two review-round-3 survivors, both fail-loud, neither data-integrity. (1) R3-02: `src/app/api/factsheet/[id]/pdf/route.ts` budgets its waits against a 27 s deadline (`maxDuration - 3`), but the founder LP cron aborts its fetch at `FETCH_TIMEOUT_MS = 25_000` (`src/app/api/cron/founder-lp-report/route.ts`), so the 503 the cron retries on arrives after the cron gave up; the cron alerts instead of retrying. Not a regression against pre-phase. (2) M-B: `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` answers a permanently pending tear sheet (complete analytics, unbuildable payload) with the same retryable 503 and error-level Sentry event as a broken render; the LP route splits these (409 for not built).

**Owner:** unrouted.

**Trigger.** A founder LP report alert that was a slow render, or the next edit to either PDF route.

**What closing it means.** The route budget is pinned below the cron's fetch timeout by a test, and `tearsheet.pdf` reads `[data-testid="tearsheet-pending"]` and answers it with a non-retryable 409 and no error-level event.

### 202-KIT-RESIDUALS-01 — four review survivors in Phase 202's untracked capture kit, to fix before the kit is reused (booked 2026-11-07, Phase 202 review round 3)

**Why it is open.** Phase 202's capture and attribution kit lives untracked under `~/.cache/quantalyze/residchurn/bin/`. After three review rounds, four findings survive. None changes a Phase 202 number, because every c1 job is `done` and every judge TABLE entry has kind None. Each one would mislead a future capture:

- (1) `check_capture.py` `nightly_coverage` names a skipped subject as re-derived when its later job is `failed_final`. The check is time only and never tests `status in COVERING`.
- (2) `codepath_judge.py` prints a fixed `reason=` token, so it would be false for a TABLE entry whose kind the scope lacks.
- (3) The gate proves a job finished, not that it wrote rows.
- (4) Scopes with no job row in pre are invisible to coverage, and the `of N` denominator counts job subjects, not scopes.

Details are in `202-REVIEW.md` Round 3 and `202-REVIEW-DISPOSITION.md`.

**Owner:** Phase 203 B3TRUNC if it reuses the kit; otherwise unrouted.

**Trigger.** Any reuse of the residchurn kit for a new PROD capture.

**What closing it means.** (1) and (2) are fixed with a RED self-test case each. (3) and (4) are printed by the gate: written versus finished, and the unjobbed scopes by name.

### 202-MT5-CLOCK-LEAD-01 — confirm or rule out the MT5 server-clock switch as the cause of the (d) values Phase 202 left unexplained (booked 2026-11-07, Phase 202)

**Why it is open.** Phase 202 (RESIDCHURN) left s6, s9 and s10 (72 of 188's 1214 moved values, b0 to b1) and s2, s5, s8 and s13 (87 values, c0 to c1) in bucket (d), unexplained. Founder decision D-16 ("Don't widen; book it") kept them in (d) under the rule as fixed. Plan 05 and plan 07 measured a lead that is not a code commit: the worker's MT5 server-clock setting (`resolve_mt5_server_clock()`, `mt5_server_clock.py`), recorded as a fixed offset from 2026-11-01 and switched to the US rule on 2026-11-03. In both pairs, the set of MT5 strategies re-derived across the switch equals the set that moved, and the changed days fall in US-rule summer. The winter control is not clean: 29 winter rows vanished from s9 (b0 to b1) and from s2 (c0 to c1), the same 29 days. The lead comes from the repo's record of the setting, not a read of the Railway variables, and no derive was replayed.

**It is not the only candidate, and the c0 to c1 pair is not code-identical.** The four c0 to c1 scopes were not written by one commit on both sides: their c0 rows came from worker commit 099a9f166947 (the derives of 2026-11-03) and their c1 rows from ba3c9012858e, with 8 analytics-service commits between (#1190, #1193, #1194, #1196, #1197, #1200, #1202, #1205), among them #1196 TINYBASE and #1205 (stale-row delete). Plan 05's judge, run on that pair, found none of them entered as producing the changed-day kinds, but it weighs changed days only: #1196 and #1205 were not weighed against the 29 vanished rows. The ten OKX and Bybit scopes (1106 values) are the code-identical evidence (same code both sides); the four MT5 strategies are a straddle, as s6, s9 and s10 were. Closing this entry therefore also means weighing the TINYBASE deletions against the vanished rows. ⚠️ **Prediction 4 is not evidence for the lead.** The quiet control for s6, s9 and s10 (that they stay unmoved across a nightly) is untested: none of the three was re-derived between c0 and c1 (their latest derives, 2026-11-06 00:25Z, 00:25Z and 01:25Z, predate c0), so "did not move" means no job wrote them. Whoever closes this entry must not cite it. Evidence: `202-05-SUMMARY.md`, `202-07-SUMMARY.md`, `202-REPORT.md`, and scratch `~/.cache/quantalyze/residchurn/codepath/clock-candidate.json` and `codepath/c0c1-writers.out`.

**Owner: unrouted.** Founder to assign.

**Trigger.** The next phase that touches MT5 strategy-mode day bucketing or the server-clock setting, or the next MT5 re-derive across a DST boundary.

**What closing it means.** One test confirms or rules out the lead and records the result. Either replay a moved scope's derive under both clock settings and show the moved days match, or read the worker's recorded setting history and show it does not fit. If confirmed, name the bucket the founder assigns. If ruled out, the values stay (d) with the lead struck.

### ALLOCSYNC-CAPTION-01 — the AllocatorSyncStatus pill and helper line are text-xs inside the /strategies note row, whose other lines are text-caption (booked 2026-10-09, Phase 170.7)

**Why it is open.** The Phase 170.7 UI-SPEC accepted this typography residue. `AllocatorSyncStatus` is a
shared component used on other surfaces, so 170.7 did not resize it. In the `/strategies` note row the
other lines are DM Sans `text-caption` (12 to 13 px), while the pill (`text-xs`) and its helper line
(`text-xs`) stay at 12 px.

**Owner: unrouted.** Founder to assign.

**Trigger.** The next phase that edits `AllocatorSyncStatus` or the `/strategies` note row.

**What closing it means.** Both `text-xs` sites in `src/components/exchanges/AllocatorSyncStatus.tsx`
move to `text-caption`, after checking every surface that mounts the component, and DESIGN.md's
typography stays one tier per role.

### 164.6.6.3.3-WITHHELD-RESIDUE — a Withheld factsheet still prints three whole-record readings outside the rail's single figures (booked 2026-10-15, Phase 164.6.6.3.3 plan 15 close; ten of thirteen closed 2026-10-15, three founder-deferred items and one hover note open)

**Why it is open.** D-15 and its two extensions (phase CONTEXT) make every whole-record rail figure read "—" on a Withheld row at full history with no what-if. Plan 15 left three items undashed as ambiguous, and the founder chose on 2026-10-15 to ship and book them ("Ship as is, book them"). The plan 15 review (`164.6.6.3.3-15-REVIEW.md`, no HIGH) and the silent-failure pass added four MEDIUMs, booked under the review rule. **The four MEDIUMs were fixed the same day, the round-2 review's four more in round 3, and the round-3 review's two in round 4,** under the founder rule of 2026-10-15 ("fix also the medium user facing and data integrity issues"); the three founder-deferred items below stay open. Fix reports: `164.6.6.3.3-15-REVIEW-FIX.md`, `-R3.md`, `-R4.md`.

- **Founder-deferred, plan 15 SUMMARY class D6 (OPEN):** (1) Worst 10 Drawdowns: row #1 Depth is the same whole-record max drawdown the rail dashes. (2) EOY Returns and Calmar by Year for a break year that is NOT the Year-to-date year: both compound across it. (3) Style Drift and its Kolmogorov-Smirnov line: the statistic uses every day.
- **WR-01 (MEDIUM) FIXED in `3194279bf`:** the last EOY Returns row (strategy, benchmark, delta) and the last Calmar by Year row (Return, Max DD, Calmar) read "—" with no tone under `wholeRecordWithheld`, because that year is the dashed Year-to-date figure. Earlier years keep their figures. Tests D1 and D4 were flipped deliberately; a new WR-01 test pins the identity with YTD on a clean row.
- **WR-02 (MEDIUM) FIXED in `3a0f2392c`:** Rolling Metrics "Now" (Volatility, Sharpe, Sortino) reads "—" with no accent under the gate. Test D5 was flipped deliberately.
- **WR-03 (MEDIUM) FIXED in `cbeb6b2da`:** a render test of the rail on a Withheld row under mark-to-market (all 62 cells keep digits, no Withheld note; the same payload under cash dashes all 62). Seen RED with `railBasis` neutered to cash in the gate, restored from a byte backup.
- **SFH-2 (MEDIUM) FIXED in `da19bdeb9`:** `BootstrapCIPanel` takes `wholeRecordWithheld` as a required boolean; `tsc` fails on an omitting caller (seen RED).
- **Round 3 (review `164.6.6.3.3-15-REVIEW-R2.md`, four MEDIUMs, all FIXED 2026-10-15 under the same founder rule; fix report `164.6.6.3.3-15-REVIEW-FIX-R3.md`).** The Withheld verdict now has two scopes, both built on the one hook `useFullHistoryWithheld()` (`MetricsColumn.tsx`): the verdict itself (full-history panels, a zoom included) and the rail's slice-aware gate, `!selected && ` that verdict (D-78).
  - **R2-WR-01 (MEDIUM) FIXED in `b512f5c03`:** the 3194279bf fix reused the slice-aware gate for EOY Returns and Calmar by Year, which always show the full history (labelled "Full history" in a zoom), so any zoom re-printed the withheld last-year row. Both panels take the verdict without the window term. Seen RED (the zoomed Withheld EOY cell read "-8.36%").
  - **R2-WR-02 (MEDIUM) FIXED in `1eb83b4b6`:** `EndOfYearBarsPanel` printed the last calendar year, the dashed Year-to-date figure, as a bar, a value label and through the `scale ±N%` caption. **This corrects the entry above, which filed this bar under founder item 2: it is NOT a break-year row, it is the Year-to-date year, the case R2-WR-01 already decided to dash.** The panel takes `fullHistoryWithheld` as a required prop; under it the last year keeps its row label and loses both bars and both labels, and so drops out of `maxAbs`. A Dated row is unchanged. The earlier "charts show the whole record by design" rationale was wrong for a Withheld row (the Withheld note has no chart clause; only the Dated notes do). Seen RED.
  - **R2-WR-03 (MEDIUM) FIXED in `6027c61c6`:** the Monthly Returns heatmap's last-row "YTD" cell reads "—" with no tone under the full-history verdict. Earlier rows' totals and every month cell (per-period entries) stay. Seen RED.
  - **R2-WR-04 (MEDIUM) FIXED in `c4682c358`:** the three rolling charts' "avg" label (`showStratAverage`) is off under the rail's slice-aware gate: dropped at full history on a Withheld row, kept inside a zoom (there it is the visible range's average, a slice figure). Done in `PerformanceCharts` by config, so the frozen-island `TimeSeriesChart.tsx` is untouched. Seen RED.
  - Tests in `bcc47eee9`: the mark-to-market render now covers the new copies (all four plus the rolling avg keep their figures; the same payload under cash dashes each; seen RED with the basis term neutered), and a zoom keeps the full-history copies dashed.
- **Round 4 (review `164.6.6.3.3-15-REVIEW-R3.md`, two MEDIUMs, both FIXED 2026-10-15 under the same founder rule; fix report `164.6.6.3.3-15-REVIEW-FIX-R4.md`).**
  - **R3-WR-01 (MEDIUM) FIXED in `514805e66`:** the Monthly Returns heatmap's last month cell (the month holding the record's last date) IS the Month-to-date figure the Returns panel dashes (same dates, same compounding; in January also the Year-to-date figure). Under the heatmap's existing full-history verdict it reads "—" with no tint and a figure-free title (`YYYY-MM: withheld`). Earlier month cells keep their figures. Round 3's assertion that every month cell stays was flipped for that one cell only, deliberately. Seen RED.
  - **R3-WR-02 (MEDIUM) FIXED in `6add59aa7`:** the rolling charts' avg gate decided "zoomed" from `useWindowedView` (the held or deferred range) while the label is computed over the chart's live range, so a zoom-out gesture reaching the whole record printed the whole-record avg until the hold released. The gate now reads `resolveRangeScope(useXRange().xRange, ...)`. Seen RED with a real wheel tick and a faked settle timer, and RED again with the old gate restored from a byte backup.
  - LOW fixed in `b97080820`: the zoom test now proves the zoom took effect on the Withheld render before it asserts the copies stay dashed.

### CONTACT-SUPPORT-POINTERS-01 — fifteen user-facing strings tell a user to "contact support" without saying how (booked 2026-10-07, Phase 164.6.6.3.5)

**Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)

**Why it is open.** These strings send a user to "contact support" and name no channel. Before Phase
164.6.6.3.5 that was an unspoken email address; after its D-01 the only channel is the contact form
(`/contact`), so each string should become the `contact form` pointer, rendered through
`ContactPointerText` (the phrase `contact form` is the link). Phase 164.6.6.3.5 (D-16, an
orchestrator-taken research recommendation, not a founder decision) booked them instead of changing
them, because they sit outside `wizardErrors.ts`, the surface it rewrites. None was changed.

**The list (measured 2026-10-07 at the phase worktree HEAD: 24 raw matching lines, 15 after the
exclusions below).** Excluded: three comments (`gdpr-export.ts`, `fetch-and-build-payload.ts`, one
doc comment in `key-card-copy.ts`), `key-card-copy.ts`'s four address-bearing constants and
`csv-finalize`'s two address-bearing messages (all rewritten by Phase 164.6.6.3.5 plan 07), test
files and `wizardErrors.ts`. Research counted about 17, which is these 15 plus the two
`csv-finalize` address-bearing messages (inferred, not re-derived).

- `src/app/api/strategies/csv-finalize/route.ts`: `ENQUEUE_LOST_RACE_USER_COPY` ("Analytics could not
  complete for this strategy. Retry the sync, or contact support if this persists."). Plan 07 does
  not touch it (orchestrator ruling I7).
- `src/app/api/strategies/finalize-wizard/route.ts`: the `computation_error` written for composite
  strategies on the unified-backbone path ("... Contact support."), around line 2601.
- `src/app/api/admin/match/send-intro/route.ts`: `audit_warning` (operator-facing), around line 627.
- `src/app/api/admin/partner-import/route.ts`: `audit_warning` (operator-facing), around line 1037.
- `src/app/api/account/export/route.ts`: the export-limit message (around line 509) and the
  "Export manifest drift" error (around line 540).
- `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx`: the two commit-outcome
  remedies, around lines 371 and 372.
- `src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx`: the unreadable-optimizer
  body, around line 119.
- `src/components/auth/ProfileForm.tsx`: the locked-field help text, around line 116.
- `src/components/auth/SignupForm.tsx`: the generic signup failure (around line 148) and the
  locked-after-signup help text (around line 212).
- `src/components/strategy/ApiKeyManager.tsx`: the sync-start failure copy (around line 86), the
  delete-failure constant (around line 271) and the still-connected delete failure (around line 1098).

**Owner: unrouted.** Founder to assign.

**What closing it means.** Each string is in a pointer shape (the `contact form` phrase linking to
`contactHref(...)` with the right topic and reference), the tests that pin the old wording move in the
same change, the no-email-in-copy sweep that Phase 164.6.6.3.5 added is extended to the touched
modules, and the regenerate command below returns only comments and fixtures. Server-side strings
(`audit_warning`, `computation_error`, route error bodies) need the rendering host decided first,
because `ContactPointerText` is a React component and a JSON field is not.

Regenerate the census with `grep -rni 'contact support' src --include='*.ts' --include='*.tsx' | grep -v 'wizardErrors.ts' | grep -v '[.]test[.]'`
and drop comments by hand.

### SECURITY-TXT-EXPIRES-01 — `security.txt` Expires lapses on 2027-04-10 and nothing renews it (booked 2026-10-07, Phase 164.6.6.3.5)

**Why it is open.** `public/.well-known/security.txt` carries `Expires: 2027-04-10T00:00:00.000Z`.
RFC 9116 requires the field and says a file past its Expires date must be treated as stale; it
RECOMMENDS an Expires less than a year ahead. Phase 164.6.6.3.5 moved the file to the contact form and
left the date as it found it. Nothing in the repo renews it.

**Owner: unrouted.** Founder to assign.

**Trigger.** Renew by 2027-03-10: set a new `Expires` less than a year after the edit. `src/__tests__/security-txt.test.ts`
(Phase 164.6.6.3.5 plan 09) is the check that goes red once the date lapses.

**What closing it means.** The `Expires` value is a future date under a year ahead, the same edit
re-measures `Contact:`, `Canonical`, `Policy` and `Acknowledgments` against the live
`https://quantalyze.xyz/.well-known/security.txt`, and this entry is re-booked for the next renewal.

### SENTRY-UNSCOPED-TAG-01 — five pre-existing `sentry_sdk.set_tag` calls label every later event the process sends (booked 2026-10-06)

**Why it is open.** Phase 164.6.6.3 review WR-03 found that an unscoped `sentry_sdk.set_tag` on the
worker path stays on the long-lived isolation scope, so every later event carries the tag. Its fix
scoped the four MT5 validation sites this phase touches (`new_scope()`, the `job_worker
_capture_read_failure` idiom). These five predate the phase and were left as found:
`services/audit.py` (`audit_emit_permission_denied`, `audit_emit_transient`,
`audit_emit_unexpected`), `routers/cron.py` (`prober_cadence_alert`) and `routers/internal.py`
(`kek_unavailable`). The router sites may sit inside a per-request scope, which is unmeasured.

**Owner: unrouted.** Founder to assign.

**What closing it means.** Each site sets its tag on a `new_scope()` around its own capture, with a
real-sdk test (recording `before_send`) showing the tag is absent from a later unrelated event.
Regenerate the census with `grep -rn "sentry_sdk.set_tag(" --include='*.py' analytics-service`
excluding tests.

### UPSTASH-RATELIMIT-KEY-LOCKING-01 — @upstash/ratelimit is held at 2.0.8; 2.2.0's scripts are refused by the CI Redis (booked 2026-10-05, Dependabot #951)

**Why it is open.** Dependabot #951 bumped @upstash/ratelimit 2.0.8 → 2.2.0. The `frontend-seam-redis`
lane failed: every scripted call returned `ERR Unexpected flag in script shebang: allow-key-locking`
from the lane's pinned Redis image behind `serverless-redis-http`, and `resilient-fetch` logged that
the breaker state may be stale. The rest of the group shipped; the package is pinned at 2.0.8 and
`.github/dependabot.yml` ignores it.

**What closing it means.** Establish whether PROD's Upstash accepts the `allow-key-locking` flag (a
read against the real service, not an assumption), then either move the lane to a Redis that accepts
it or keep the hold with the reason measured. Adopt the new version and remove the Dependabot ignore
in the same PR.
⛔ **Not a close:** shipping 2.2.0 to production on the strength of the lane being skipped or relaxed.

### QUANTSTATS-0086-REDERIVE-01 — quantstats is held at 0.0.81; adopting 0.0.86 changes reported risk figures (booked 2026-10-05, Dependabot #953)

**Why it is open.** Dependabot #953 bumped quantstats 0.0.81 → 0.0.86. Upstream 0.0.85/0.0.86 are
statistical corrections, and the repo's own gates went red on them: `test_rank05_quantstats_pin_is_still_0_0_81`,
the RANK-05 live-parity arm for `cvar` (−0.0279 → −0.0344 on the benign fixture), the Q166 parity
arms for `serenity_index` and `common_sense_ratio`, `test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form`,
and the qstats-gate calibration arm for `cvar` (8 tests). The founder chose to hold quantstats and ship
the rest of the group. `.github/dependabot.yml` ignores quantstats until this closes.

**What closing it means.** Re-derive every inline mirror in `analytics-service/services/metrics.py`
that cites 0.0.81 source against 0.0.86, decide per metric whether the new upstream figure is the one
this product reports, move the pin, and remove the Dependabot ignore in the same PR. The reported
CVaR and the other moved figures change for every strategy on its next recompute, so the PR says so
in its CHANGELOG entry.
⛔ **Not a close:** loosening the parity tolerance, or re-pinning the expected values without the
per-metric decision.

- [ ] **`[164.9.3.2.1-OQ1-DEPARTED-KEY-55006-DEFEATS-RETRY]` `set_departed_key_history_inclusion` turns the
      enqueue race-loss 40001 into a 55006 "try again", so the user is asked to retry a race PostgREST 14
      would have absorbed (booked 2026-10-02, Phase 164.9.3.2.1 review WR-02, RESEARCH open question 1).**
      - **Where.** `supabase/migrations/20260927180000_working_holder_rule_d18.sql`, the
        `EXCEPTION WHEN serialization_failure THEN RAISE EXCEPTION 'HISTORY_RECOMPOSE_RACED' USING ERRCODE = '55006'`
        block around its `enqueue_compute_job(p_kind := 'derive_allocator_equity', p_allocator_id := v_uid)`
        call. Its DETAIL reads "Try again; nothing was changed."
      - **Why it matters.** Phase 164.9.3.2.1 plan 01 measured the race-loss 40001 converging through
        PostgREST v14.7: the gateway re-runs the transaction and the re-run enqueues. Catching the 40001
        inside the function and re-raising 55006 removes the code PostgREST retries, so the gateway
        returns the error to the user once instead of converging. The mechanism is REASONED, NOT
        MEASURED: the 20260927180000 comment itself says the lost race "needs a second backend", and
        this call is on the allocator-target branch, which neither plan 01 nor
        `supabase/tests/test_enqueue_race_loss_40001.sql` exercises (that gate pins the strategy and
        api_key branches only).
      - **Not changed in 164.9.3.2.1:** that phase took the D-02 converge branch, which carries no
        migration. A fix is a re-based `CREATE OR REPLACE` of the function (latest definition across ALL
        migrations) with the three pre-merge migration reviewers, because merge auto-applies to PROD.
      - **Trigger.** A user report of `HISTORY_RECOMPOSE_RACED` / 55006 on the departed-key history
        toggle, OR the next edit to `set_departed_key_history_inclusion`, OR evidence that PROD's
        PostgREST is ≥16 (where the 40001 would no longer be retried and the 55006 becomes the
        better answer, so the decision flips).
      ⏳ **Destination: AWAITS ROUTING via /gsd-phase (founder freeze 2026-09-27).**

- [ ] **`[164.9.3.2.1-OQ2-PYTHON-ENQUEUE-NO-40001]` The Python enqueue callers have no 40001 handling, so on
      PostgREST ≥16 a lost enqueue race fails the enqueue instead of converging (booked 2026-10-02, Phase
      164.9.3.2.1 review WR-02, RESEARCH open question 2).**
      - **Where.** `supabase.rpc("enqueue_compute_job", …)` call sites in `analytics-service/`, measured
        2026-10-02 by grep: `routers/process_key.py:947` and `:1896`, `routers/cron.py:1151`,
        `services/job_worker.py:2117`, `:5722` and `:6684`, `services/ingestion/long_fetch.py:685`.
        None of those files handles SQLSTATE 40001 around an enqueue (the `40001` hits in
        `job_worker.py` are the claim-token fence, now 55006).
      - **Why it matters.** On PostgREST 14.x the gateway re-runs the race-loss 40001 itself and the
        re-run converges (measured on v14.7, Phase 164.9.3.2.1 plan 01). PostgREST 16.0 stopped retrying
        and returns the 40001 to the client as HTTP 500 (PostgREST PR #4222), so after an upgrade each
        of these callers would see a lost race as an enqueue error: a compute job that should have been
        queued is not. The TS callers already carry a retry-once helper
        (`src/lib/supabase/retry-serialization-failure.ts`); the Python side has no equivalent.
      - **Not changed in 164.9.3.2.1:** D-04 limited that phase to comment corrections.
      - **Trigger.** Any evidence that PROD's PostgREST is ≥16 (D-06 forbade measuring it in
        164.9.3.2.1; RESEARCH assumed 14.5 from a link cache), OR a PostgREST image bump on the
        local-stack lane to ≥16, OR a production enqueue failure carrying `40001`.
      ⏳ **Destination: AWAITS ROUTING via /gsd-phase (founder freeze 2026-09-27).**

- [ ] **`[170.1-READ-ONLY-ONLY-COPY]` The connect-key warning strip reads "READ ONLY ONLY — keys with
      Trade or Withdraw permissions are refused on submission." (seen by the founder on the composite
      wizard, 2026-10-01).**
      - **Where.** `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.tsx`; the bold
        span `READ ONLY` is followed by the text `ONLY — …`, so the page shows the word twice.
      - ⚠️ **A test pins it:** `WithdrawalWarningStrip.test.tsx`
        asserts the sentence byte for byte as the "verbatim D-08 sentence". Find the D-08 decision
        before changing it; if D-08 meant the doubled form, the fix is a decision, not a typo.
      - **Destination: Phase 170.1 COPY.**

- [ ] **`[169.1-UAT-SCENARIO-COMMIT-BAR-GAP]` On the /allocations Scenario tab at narrow widths, the
      sticky `No changes yet / Commit scenario` bar floats about 74 px above the bottom nav, and the
      chart scrolls visibly through the gap (seen in the 169.1 browser pass, 2026-10-01).**
      - **Measured.** At a 735 px viewport the bar's bottom edge sat at 629 px and the nav's top at
        703 px. The bar carries `sticky bottom-16 md:bottom-0`; the 64 px offset alone does not explain
        the 74 px gap, so measure the scroll container's own bottom padding before fixing.
      - Seen at 500 px and 735 px. Not caused by 169.1.
      - **Destination: Phase 170.1 COPY** (page-layout pass), or fix-or-drop if 170.1 declines it.

- [ ] **`[169-DEAD-ADMIN-JOBS-RPC]` Drop the dead `get_admin_compute_jobs` database function
      (booked 2026-09-25, Phase 169 D-01).**
      It raises "column reference `id` is ambiguous" on every call (its `RETURNS TABLE` declares an
      OUT column named `id`, which collides with the admin gate's `WHERE id = auth.uid()`), and
      under the service-role client `auth.uid()` is NULL, so even a fixed body would return nothing.
      Phase 169 plan 01 stops calling it: `/api/admin/compute-jobs` reads the `compute_jobs_admin`
      view after its admin gate. After that it has no caller. Evidence: `169-RESEARCH.md` root
      cause A (a local reproduction of the error on a throwaway cluster).
      **Why not dropped in 169:** a DROP is a migration, and merging `supabase/migrations/**`
      auto-applies to TEST then PROD with no human gate, needs the 3-reviewer pass, and moves
      `database.types.ts` and the census pins. None of that was needed to fix the page.
      **Owner:** the next migration-carrying phase. **Trigger:** that phase's planning.
      **Closed when:** a migration drops the function, `database.types.ts` loses it, and
      `grep -rn get_admin_compute_jobs src` finds only lineage comments.

- [ ] **`[169.2-BTC-GAP-RETURN-STAMP]` A BTC return across a missing stored day is stamped as one
      day's move (booked 2026-09-27, Phase 169.2 D-47, review round 3 WR-01).**
      `pricesToDailyReturns` (`src/lib/factsheet/benchmark-source.ts`) bridges two stored closes with
      a missing day between them into ONE return at the later date. The cumulative BTC overlay
      (`ScenarioComposer`, the scenario-share page) needs that bridge to stay on BTC's real level;
      the inner-joined metrics would rather skip it. Phase 169.2 briefly skipped every gap (round-2
      WR-03), which made the overlay drift, so it reverted to bridging and kept only the skip across a
      dropped corrupt close. Pre-existing and latent: the daily refresh treats any calendar gap as a
      cache miss and refetches, so a gap in `benchmark_prices` should not persist.
      ✅ **Destination: Phase 169.4 ALLOCTRUTH**, whose plans read BTC through `readBenchmarkPrices`
      and `mergeWithFixture`. **Closed when:** consumers build the overlay from closes (or levels)
      and the metrics from exactly-one-day returns, with a test for each across a missing day.
- [ ] **`[166.4.1-CRON-SYNC-UNSCHEDULED]` Nothing schedules the analytics service's `/cron-sync`, so
      portfolio analytics never recompute and the trade sync it carries does not run (booked
      2026-10-09, Phase 166.4.1 D-03).** Evidence, counts and verdicts only (`166.4.1-RESEARCH.md`
      Q2, read-only PROD reads with the marker query first): no schedule in `vercel.json`, the GitHub
      workflow schedules, `supabase/functions/`, `analytics-service/railway.toml`, PROD `cron.job`
      (0 jobs or functions mentioning it) or the Railway services. PROD `strategy_sync_cursors`
      holds 0 rows although `routers/cron.py` writes one per strategy per tick. PROD holds 0
      `compute_portfolio` jobs and the Next.js `computePortfolioAnalytics` has zero call sites. PROD's
      6 `complete` `portfolio_analytics` rows were written by `scripts/seed-full-app-demo.ts`, not by
      a compute (so no failure line was logged 2026-09-13..27). `docs/architecture/adr-0008-cron-architecture.md`
      still names a Python-side cron_sync trigger and is stale. Nothing was built in 166.4.1.
      **The first question (R-03) has an answer: live-key trade ingestion has no other path.**
      `.planning/debug/cron-sync-unscheduled.md` (diagnosed 2026-10-09) found that the 4 live ccxt
      strategy keys on PROD have had no trade ingestion for 14 to 156 days, hidden because the
      "Synced Nd ago" pill reads `strategy_analytics.computed_at`. That root cause and its fix are
      not repeated here.
      **Owner:** Phase 167.1.2.2.2 TRADESYNC (booked 2026-10-09, on main via #985; ROADMAP section
      `### Phase 167.1.2.2.2`), which owns the schedule, the cursor seeding and the "Synced" label.
      **Trigger:** TRADESYNC's planning. **Closed when:** `/cron-sync` is either scheduled with a PROD
      reading showing ticks (`strategy_sync_cursors` rows), or deliberately retired with its docstring
      and ADR-0008 corrected. TRADESYNC's success criteria decide which; close this entry when its
      verification passes.

- [ ] **`[166.4.1-SERIES-CURVE-DATETIME]` The writers of the portfolio curve fields still emit ISO
      datetime strings; only one reader normalises them (booked 2026-10-09, Phase 166.4.1 plan 03).**
      `_series_to_curve` (`analytics-service/routers/portfolio.py`) stores `Timestamp.isoformat()`
      ("yyyy-mm-ddT00:00:00") for `portfolio_equity_curve`, and `compute_rolling_correlation`
      (`analytics-service/services/portfolio_risk.py`) does the same for `rolling_correlation`.
      `verify_strategy` also uses `_series_to_curve` for its `equity_curve`. lightweight-charts accepts
      only `yyyy-mm-dd`, so any portfolio computed by the real service crashed `/portfolios/[id]` into
      its error boundary (found on the seeded local lane; PROD never met it because its 6 rows are
      seeder rows with date-only strings and the compute selected phantom columns until #973).
      **What 166.4.1 did:** the reader was fixed, not the writer. `parseTimeSeriesPoint` in
      `src/lib/portfolio-analytics-adapter.ts` keeps the calendar date of a stored timestamp, as a
      tolerant reader that also covers rows already stored, with a failing-first test. The stored shape
      is unchanged.
      **Still open:** the writer still emits datetime strings, so any OTHER reader of these curve fields
      (a new page, an export, a script, a reader of `verify_strategy`'s `equity_curve`) must normalise
      the same way or will meet the same crash. The readers were not enumerated beyond the adapter.
      **Owner:** the founder, to route. **Trigger:** the first new consumer of `portfolio_equity_curve`,
      `rolling_correlation` or `verify_strategy`'s `equity_curve`, or the next edit of either writer.
      **Closed when:** either the writers emit `yyyy-mm-dd` (with the adapter kept as the tolerant
      reader and a test that fails on today's `isoformat()`), or the list of readers is enumerated and
      each is shown to normalise.

- [ ] **`[166.4.1-BENCHMARK-OUTAGE-LABEL]` A total benchmark source failure is labelled "stale", so an
      outage reads as stale data (booked 2026-10-09, Phase 166.4.1 silent-failure review, MEDIUM M1).**
      `get_benchmark_returns` (`analytics-service/services/benchmark.py`) returns `(None, True)` when
      every price source failed and no recent cached day exists. `_compute_portfolio_analytics`
      (`analytics-service/routers/portfolio.py`) tests `benchmark_rets is None or benchmark_stale` and
      writes `BENCHMARK_NOTE_STALE` ("benchmark unavailable: stale") with `stale: true`. The page
      therefore shows the stale wording where there is no benchmark data at all, and a reader cannot
      tell a lagging cache from an outage. The comparison is honestly shown as unavailable and no
      figure is wrong; the cause it names is the weaker of the two.
      **Why not fixed in 166.4.1:** the worst finding of the review was MEDIUM, so by the founder's
      rule there was no fixer round. The fix adds a fourth fixed sentence on both sides (the Python
      constant and the page's colour rule), which is a wording call.
      **Owner:** the founder, to route. **Trigger:** the next edit of the benchmark block in
      `_compute_portfolio_analytics`, or the first report of a "stale" portfolio comparison that was
      in fact an outage.
      **Closed when:** the `(None, True)` exit writes its own named note, distinct from the stale-cache
      note; the card renders it in the muted treatment, not amber; and a test that fails on today's
      single label pins both exits.

- [ ] **`[164.9.3.1-FANIN-GRAPH-RESIDUALS]` Four latent or loud defects on the fan-in graph and
      the bridge's decision cascade (booked 2026-09-26; routed 2026-09-25 from the Phase 164.9.1
      review round 1 to Phase 164.5.2, re-routed 2026-09-26 by founder decision).**
      (1) **Stranded child:** a fan-in child whose parent is still open at enqueue and later
      ends `failed_final` stays in `done_pending_children` forever. Latent: no caller passes
      parents today.
      (2) **Cascade 23505:** a second `match_decisions` delete can raise 23505 through the
      `ON DELETE SET NULL` cascade onto `bridge_outcomes_legacy_per_strategy_holding_when_md_null`.
      Pre-existing and loud; the admin decisions route issues these deletes.
      (3) **Diamond deadlock:** the fan-in parent lock `FOR SHARE ... ORDER BY id` can deadlock
      (40P01) against `mark_compute_job_done` when a child's parents include another waiting
      child. Latent. Whoever first passes parents must treat 40P01 as retryable on both the
      enqueue and the worker's mark path.
      (4) **Lost release:** a concurrent fan-in "lost release" in `mark_compute_job_done` can
      strand a two-parent child in `done_pending_children`. It is pre-existing: the body is
      carried byte-for-byte from 20260603120000. Found by the Phase 164.5.2 round-1 review as
      WR-02, and routed here 2026-09-26 (ROADMAP `### Phase 164.9.3.1`, "ROUTED IN 2026-09-26").
      Its success test is a two-backend lane arm that fails on today's body.
      (1) and (3) are recorded in the header of M1, `20260924230827_fanin_initial_status_10param.sql`.
      ✅ **Destination: Phase 164.9.3.1 FANINGRAPH**, inserted 2026-09-26 via `/gsd-phase --insert`
      and booked under the new-phase freeze, NOT started. The ROADMAP section holds one success
      criterion per defect; this entry is the evidence.

- [ ] **`[STRATTABLE-DESC-01]` The strategy list shows only the NAME, so two strategies
      with the same name are indistinguishable — the `description` that disambiguates them is
      already fetched and simply not rendered (founder-reported 2026-09-11 from the /browse
      list: *"would be good to have the comment of the strategy be displayed here, considering
      it is there to know which one is which"*).**
      **The collision is live, not hypothetical:** the current list renders **two rows both
      named "Alpha Centauri"** (#1 Deribit / Other, #5 mt5 / Long-Short) with no way to tell
      them apart from the row itself. The factsheet DOES show the field — `<strategy X>`
      renders *"<strategy X subtitle>"* as an italic subtitle under the title — so the data
      exists and the list is the only surface that drops it.
      - **Measured at HEAD 2026-09-11.** `getStrategiesByCategory` selects `*` on `strategies`
        (`src/lib/queries.ts:343-344`), so `description` is ALREADY on the row — no query
        change, no new column, no extra round trip. `StrategyWithAnalytics` is
        `Strategy & {...}` (`src/components/strategy/StrategyTable.tsx:43`), so the field is
        already in the row type and typechecks today. ⚠️ `grep -n description
        src/components/strategy/StrategyTable.tsx` returns **ZERO hits**: the component simply
        never reads it.
      - **Shape of the fix.** Render `s.description` under the `{s.name}` link in the sticky
        name cell (`StrategyTable.tsx:1093-1097`), muted and secondary to the name, beside the
        existing venue/"Synced …" line. It is nullable (`description: null` across the test
        fixtures) so the render must be conditional, and it is FREE TEXT — clamp it (one or two
        lines) so a long comment cannot blow out a sticky column that already carries a
        wrapping name, a verified tick, Private/Own-capital chips and the sync line.
      - ⚠️ **Check `StrategyGrid.tsx` in the same pass** — the card surface has the same row
        type and the same gap; fixing only the table leaves the class half-closed
        (fix-campaign discipline: close the whole surface, not the instance reported).
      - ⚠️ **`description` is user-authored free text on a PUBLIC surface** (`/browse` is
        anon-readable). Render it as text, never as markup.
      - **Severity: not user-facing-broken, not data-integrity — does not block.** Filed as a
        founder feature request, not a review finding. No phase owns strategy-list presentation
        today; per the severity rule this entry IS the complete routing unless one appears.

- [ ] **`[WIZFORM-02-VE-CODECHANNEL]` `keys/validate-and-encrypt` has no code→copy render path,
      so criterion 3's fifth surface cannot be rendered (booked 2026-09-06, Phase 164.2 plan 09,
      FOUNDER DECISION at the plan-06 gate: accept 4-of-5 and book the wiring).**
      **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)
      Measured at HEAD by reading all three consumers: `ApiKeyManager.tsx`, `StrategyForm.tsx` and
      `AllocatorExchangeManager.tsx` each read `err.error` / `result.error` — the PROSE — and
      **none reads `code`**. So a row for that surface in `src/lib/wizardErrors.roster-render.test.tsx`
      could only pass by feeding the expected title in as wire prose and reading it back, which is the
      tautology plan 09 forbids. It is recorded as PLANNING INCONCLUSIVE under
      `## Surfaces not rendered` in `164.2-09-SUMMARY.md`, with two live assertions that go RED the
      day a consumer starts reading `code`.
      ⛔ **WIZFORM-02 therefore does NOT close on Phase 164.2** and the `GATED ON WIZFORM-02 CLOSING`
      marker stays down — plan 10's W4 precondition checks for exactly that section's absence, and it
      is present. This is the guard added in revision round 2 working as designed, not a shortfall.
      **The work:** wire the three consumers onto the code channel (roster + `WIZARD_ERROR_COPY`
      lookup, as `ConnectKeyStep.tsx`'s `recogniseCreateWithKeyCode` does), then add the fifth surface
      to the render sweep
      and raise `EXPECTED_POPULATION_MIN` off the new measurement. Touches live components, not just
      tests — which is why it is its own item rather than a stretch of 164.2.

- [ ] **`[SYNCTRADES-ENQUEUE-DONE]` `run_sync_trades_job` returns DONE after recording an
      analytics failure, so the bridge erases the record one RPC later — and the F1 remedy
      does NOT transfer to this handler (booked 2026-09-06, 164.2-REVIEW WR-01).**
      `analytics-service/services/job_worker.py` `run_sync_trades_job._mark_analytics_failed`
      writes `computation_status='failed'` plus a curated sentence when the follow-on
      `enqueue_compute_job` fails, then the handler returns `DispatchOutcome.DONE` (the trades
      DID persist). `main_worker.py:929` maps DONE to `mark_compute_job_done`, whose in-RPC
      `PERFORM sync_strategy_analytics_status` finds every job for the strategy terminal-done —
      no analytics job was enqueued, that being the failure — and takes branch (c):
      `computation_status='complete'`, `computation_error=NULL`, both provenance markers NULL,
      `computed_at=now()`. **The user's row reads 'complete' with no analytics and a fresh
      vintage**, and the wizard poller is handed a success for a strategy with no factsheet.
      The erasure is PRE-EXISTING — the 161.1 F1 class, whose comment at `job_worker.py:5082`
      describes it exactly and fixes it for the derive path by returning FAILED/permanent.
      ⛔ **Do not simply copy that remedy here.** MEASURED: the bridge's `is_protected` predicate
      is scoped to kinds `derive_broker_dailies`, `compute_analytics_from_csv` and
      `stitch_composite` (`supabase/schema/functions/sync_strategy_analytics_status.sql:258-263`).
      F1 is applied at a `derive_broker_dailies` job, so on a marked recurring refresh over a
      healthy published row it lands on branch (b-prime), which PRESERVES the publish state.
      `sync_trades` is not in that list and can never be protected, so the same edit here always
      lands on the LOUD branch (b): a routine cron sync whose follow-on enqueue hiccups would
      unpublish a live funded factsheet to 'failed' until the next tick's `done` supersedes it,
      and a SYSTEMATIC enqueue fault (a bad kind, an RLS change) would take every live strategy
      dark within one cron tick. **The work:** scope the FAILED return to the case with nothing
      published to lose (no `strategy_analytics` row at `complete`/`complete_with_warnings`), or
      give the dropped-enqueue readmit sweep a path that covers live-API strategies — either is
      a founder-facing behaviour decision, which is why the review fix pass corrected the false
      claims instead. Until it lands, P1's payload is deliberately UNSTAMPED and
      `tests/test_computation_error_provenance_census.py` carves it out by exact key set with
      `EXPECTED_INERT_SITES = 1`, so re-stamping it takes that count to 0 and reddens the gate.

- [ ] **`[PROV-WRITER-23514]` The provenance markers sit on the FAILURE-RECORDING path, so a
      writer bug must cost the provenance and NOT the failure record (booked 2026-09-06,
      Phase 164.2 plan 06 three-reviewer gate, silent-failure-hunter).**
      ⭐ **STATUS 2026-09-06: IMPLEMENTED by Phase 164.2 plan 08, deliberately still OPEN.**
      `upsert_or_drop_provenance` (`analytics-service/services/strategy_analytics_provenance.py`)
      carries the degrade at every stamped site — NINE of them, the count pinned as
      `EXPECTED_STAMPED_SITES` in `test_computation_error_provenance_census.py`; the tenth
      candidate, `run_sync_trades_job`, is deliberately unstamped per
      `[SYNCTRADES-ENQUEUE-DONE]` — narrowed by constraint NAME at the review's
      WR-03, and plan 08 made a half-stamp inexpressible by deriving both markers from one
      `provenance_source(job_id)` expression. It stays OPEN because **implemented ≠ proven**: the
      retry arm is unreachable from today's writers and is exercised only against a mocked
      `APIError`, so it is defence for a future constraint rather than a path any live writer
      takes. Close it when a real writer can reach it. See `164.2-10-SUMMARY.md`
      (`## Code review fixes`) and `164.2-08-SUMMARY.md`.
      `supabase/migrations/20260906120000_computation_error_provenance.sql` puts TWO CHECK
      constraints on `strategy_analytics`: `..._computation_error_source_check` narrows the
      source column to the single value `'writer'`, and `..._computation_error_markers_together_check`
      requires `(source IS NULL) = (job_id IS NULL)`. Both are correct and both are deliberate —
      the first is the T-164.2-11 tampering mitigation, the second turns a half-stamped marker
      into a loud 23514 at the writer instead of a silent fall to the per-kind generic at the
      reader. ⚠️ **But the statement they can reject is the one that RECORDS A FAILURE.**
      `analytics-service/services/job_worker.py`'s `_upsert_error_only` (and the composite
      handler's twin) writes `computation_error` on the path where a job has just failed; when
      the writer plan starts sending the two marker keys, a bug in either of them — an unexpected
      source string, a `None` job id — makes that upsert raise 23514 and the failure is not
      recorded AT ALL: no sentence, no status, nothing for the user or the operator.
      **The writer must catch a constraint violation on the marker keys and retry the SAME
      upsert WITHOUT them**, so a provenance bug degrades to today's behaviour (NULL markers →
      the bridge writes the per-kind generic, exactly as it does now) rather than to a missing
      failure record. That is a property of the WRITER and cannot be fixed in the migration; it
      belongs to the Python half (Phase 164.2 plan 08, which already carries a P11 minimal-key
      fallback for the PostgREST schema-cache miss — this is the SECOND fallback that path
      needs, on a different error class). ⛔ Do NOT "fix" this by widening or dropping either
      CHECK: the narrowness is the mitigation, and a marker that can carry an arbitrary
      attribution string is the tampering surface the constraint exists to close.

- [ ] **`[PROV-COMMENT-STALE]` `sync_strategy_analytics_status`'s `COMMENT ON FUNCTION` now
      contradicts the deployed behaviour, and the snapshot cannot carry the correction
      (booked 2026-09-06, Phase 164.2 plan 06 three-reviewer gate, migration-reviewer W1).**
      `20260906120000` deliberately does NOT reissue `COMMENT ON FUNCTION` — `CREATE OR REPLACE`
      keeps the function's oid and therefore its `pg_description` row, and that comment is the
      applied-ness KEY for arms `0a`/`0b` of
      `supabase/tests/test_sync_status_marked_refresh_protected.sql`, whose `RED-UNDER-M` twin
      EDITS the ids inside `20260826120000`'s comment text. Reissuing it here would overwrite
      that mutation later in the same apply list and the twin would stop biting. The migration
      asserts the comment SURVIVED instead (assumption A1, measured at apply time).
      **The cost, which is real:** the surviving comment is `20260826120000`'s, and it records
      the provenance fix as OWED WORK. That is now false — the debt is paid in `20260906120000`.
      A reader of `\df+` or of `supabase/schema/functions/sync_strategy_analytics_status.sql`
      (the generated snapshot carries no `COMMENT` statement at all) is told the opposite of what
      the deployed body does, and every future re-base widens the gap. **Options, neither free:**
      (i) take option (ii) from `20260906120000`'s A1 arm — reissue the comment with the full
      migration roll-call AND re-point arm `0a`'s `RED-UNDER-M` twin at the new file in the same
      commit; or (ii) make `scripts/dump-sql-functions.ts` replay `COMMENT ON FUNCTION` into the
      snapshot so at least the repo-side reader sees the current text. Small, non-user-facing,
      and coupled to a mutation twin — which is why it is booked rather than done inline.

- [ ] **`[WR-D-DUMP-SCOPE]` DRIFT-05 gate (b) compares a `--schema public` dump against a
      baseline documented as a FULL dump — not live today, latent tomorrow (booked 2026-09-08,
      Phase 164.5 code review iteration 2, finding WR-D).**
      `.github/workflows/migration-drift-check.yml:203` runs
      `supabase db dump --linked --schema public -f "$DUMP"`, while the remedy the gate itself
      names — regenerating the committed baseline — is documented at
      `supabase/schema/BASELINE.md:150` as `supabase db dump --linked -f supabase/schema/baseline.sql`,
      with **no `--schema` flag**. The two scopes are not the same.
      ⚠️ **NOT A LIVE DEFECT, and do not report it as one.** Measured 2026-09-08: every function
      in the committed baseline is `"public".`, so the two scopes coincide on today's corpus and
      gate (b) is comparing like with like.
      **Why it is booked anyway.** It is the unchecked premise under WR-07's refusal to add a
      ratchet to gate (b). That refusal rests on "every divergence gate (b) can report is cleared
      by regenerating, BY CONSTRUCTION" — which is true only while the comparand and the remedy
      cover the same schemas. A function created outside `public` would be permanently
      `baseline-only` with no ratchet path, i.e. exactly the state the refusal assumes cannot
      arise, and the gate would be red forever with the documented remedy unable to clear it.
      ⛔ **The answer is NOT to add a ratchet** — that reintroduces the "we declined the remedy"
      list this repo forbids. Align the two dump scopes. That needs a measured regeneration (a
      full dump pulls in more than `public`, and nobody has measured what that does to the 122
      compared functions or to the committed file's size), so it is a separate reviewed act with
      a credential, not a flag edit.
      The condition is recorded at the source in `scripts/prod-body-drift-check.sh`, in the
      `⛔ NO RATCHET HERE` block, so a reader of the refusal meets its own caveat.

- [ ] **`[164.8.5-MANIFEST-SIDE-LOOP-DEAD]` ◆ **IN PROGRESS 2026-09-12 — the ORDERING half is code-complete on `phase-164.8.6-proberhygiene` but NOT MERGED, and carries a known defect.** The manifest-side loop now runs above every early return, with three one-lever controls each observed RED against the pre-hoist file. ⛔ The hoist introduced a regression the review caught: a `null` element in `manifest.jobs` THROWS at the new position, and because the loop is above every return the throw DISCARDS section (0)'s already-collected live PROD credential findings — a SUBSTITUTIVE refusal, the exact invariant this phase exists to enforce. Reproduced independently; under fix. ⚠️ `164.5.1` still owns the re-capture half.
  ↳ ORIGINAL ENTRY: `compareManifest`'s MANIFEST-side hygiene loop sits
      BELOW all three early returns, so it is dead on every production run today (booked
      2026-09-11, found by the round-3 silent-failure hunt).**
      ⛔ **MEASURED, and the deadness is not hypothetical:** `scripts/prod-prober/cron-manifest.json`
      declares `normalization: ws-collapse-v1` while the arm computes `ws-collapse-v2`, so the
      `manifest-invalid` early return fires on every real run and the manifest-side loop is never
      reached.
      ```
      CONTROL: valid manifest      -> manifest-side credential defects: 1
      normalization ws-collapse-v1 -> 0        schema_version wrong -> 0        marker mismatch -> 0
      ```
      ⚠️ **Deliberately NOT graded Critical**, and the reasoning is worth keeping: a credential
      LIVE IN PROD is still reported on every one of those paths, because decision D1 hoisted the
      PROD-side loop above every `return`. What this loop uniquely catches is a credential in
      COMMITTED REPO TEXT that is no longer in PROD — a real class, but repo text, which gitleaks
      also scans.
      ⭐ **The coupling is the point, and it is a trap for whoever does the re-capture:** the
      pending PROD re-capture clears `manifest-invalid`, which SILENTLY RE-ANIMATES this loop.
      A check that has not run for weeks starts running again as a side effect of an unrelated
      action. Whoever re-captures should know that before, not after.
      ⛔ The fix pass's own audit table justified these early returns as "ADDITIVE by construction
      — D1 hoisted the PROD hygiene loop above every `return`". That is only half true: D1 hoisted
      the PROD loop; the manifest loop was never hoisted. A recorded justification that is
      narrower than it reads is exactly the class this phase exists to eliminate.
      <deferred>Phase 164.5.1 CRONREPOINT (the re-capture) AND Phase 164.8.6 VAULTTICKFIX (the
      ordering fix)</deferred> — routed 2026-09-11. TWO destinations DELIBERATELY, not a
      duplicate: 164.5.1 owns the re-capture that silently RE-ANIMATES the loop; 164.8.6 would
      own moving the loop above `compareManifest`'s early returns so it stops being skippable
      at all. Whichever lands first must say so in its SUMMARY.
      **Evidence:** `.planning/phases/164.8.5-proberparse-*/164.8.5-REVIEW-R3.md`.

- [ ] **`[T-OPEN-03]` `retention_compute_jobs_orphaned_running` was committed to
      `scripts/prod-prober/cron-manifest.json` with 0 newlines and lexed to a pure comment, so
      `visible = 0 of 1791` characters — an ATTRIBUTION gap, not a credential blind spot.**
      MEASURED: a spliced key in that row still fires `long-token-anywhere` via the comment
      producer, and `jwt-shape` / `service-role` / `pg-password` all still fire — only the
      header-anchored rules and `vault-absent` were lost to the newline fold. Graded `low` on
      measurement rather than accepted as booked, because the credential itself remains
      detectable through the surviving rules; what is lost is which specific rule would have
      named it.
      **The DATA half was already discharged** by the 2026-09-11 re-capture at `ws-collapse-v2`
      (capture run `34611594511`, landed by PR #776) — the newline fold is restored in the
      committed manifest today. **The RESIDUAL owned here is the CI GATE, not the data:** nothing
      in CI catches a future re-fold of the same shape, so this entry stays open until that gate
      exists.
      Owner: Phase 164.5.1 CRONREPOINT, plan 07.

- [ ] **`[T-OPEN-04]` The committed manifest declared `normalization: ws-collapse-v1` while the
      cron-drift arm computed `ws-collapse-v2`, and two normalizations produce two different shas
      for identical text — so the cron-drift arm was performing NO comparison at all and
      `manifest-invalid` fired on every production run.**
      MEASURED: the mismatch was caught by an hourly PRODUCTION probe an hour after it shipped,
      and by nothing in CI — a control that silently stopped being able to find anything. The
      DATA half was discharged by the same 2026-09-11 re-capture (`ws-collapse-v2`, run
      `34611594511`, PR #776).
      **The RESIDUAL owned here is the missing CI gate:** any future normalization bump re-opens
      this identically, because nothing asserts the arm's exported `NORMALIZATION` and the
      manifest's `normalization` key agree.
      Owner: Phase 164.5.1 CRONREPOINT, plan 07.

- [ ] **`[164.8.5-HYGIENE-RESIDUALS]` ◆ **IN PROGRESS 2026-09-12 — code-complete on `phase-164.8.6-proberhygiene` (v0.77.35.0) but NOT MERGED, and NOT yet clean.** Phase 164.8.6 plan 08 replaced the per-shape exemptions with ONE whole-token measure (`tokenMeasure`). ⛔ A code review then found the new measure fires the credential rule — whose remedy is "treat the named secret as EXPOSED and rotate it" — on credential-free PROSE assembled by `concat_ws` / `format` / `||`, hourly, against production. Reproduced independently. Under fix. **Do not tick until merged and the false-positive class is closed with green-corpus rows that exercise the new mechanism** (the original zero-FP evidence was vacuous for it: zero of the 14 committed manifest commands contain `||` or any builder callee).
  ↳ ORIGINAL ENTRY: Five credential shapes the prod-prober's hygiene rules still
      do not report, each measured and each individually below the bar that blocked the ship
      (booked 2026-09-11, from three initial reviews + three bounded re-review rounds over
      Phase 164.8.5).**
      ⛔ **All five are MEASURED, not hypothetical, and none is a false green on a shape the arm
      claims to cover** — they are gaps the arm's own docstrings now name honestly, which is the
      change this phase made. Grouped as ONE entry on purpose: they share a cause (a rule that
      reads a token must decide what a token IS) and no existing phase thematically owns them.
      ⚠️ Phase 164.8.4 GATERESIDUE is NOT their home — its goal is scoped to Phase 164.8.2's
      deferrals "and nothing else".
      1. **A credential inside a too-deeply-nested `DO` body** reports `["command-unjudgeable"]`
         alone. Honest — those spans were genuinely never read — but the key is not named.
      2. **`DETECT_RE`'s concatenation blind spot** and the **`||`-split value OUTSIDE a header
         region**: a value assembled from short operands is under every length threshold by
         construction.
      3. **The A2 alphabetic-token residual** — a long token carrying no digit is exempt, because
         the digit test is what keeps `'application/json'`-class constants from firing.
      4. **`MIGRATION_FILENAME_RE`'s body charset is `[a-z0-9_]`**, which is the charset of an
         `sk_live_`-style key: `-- 20260907130000_<32 hex>.sql` is exempt while the bare token is
         not. Needs deliberate construction and is comment-only, but the docstring's "the prefix
         and suffix stop this being a one-step off-switch" reads stronger than it is.
      5. **`captureManifest`'s malformed / `countMismatch` refusals return 3 before the hygiene
         loop**, so findings on readable rows go unprinted. Documented as deliberate; recorded
         because "deliberate" and "known to the next reader" are different things.
      ⭐ **The honest remedy for 2-4 is a whole-token measure rather than five more exemptions —
      which is a DECISION about what the arm is for, not a fix.** That is why this is booked
      rather than patched: each individual narrowing risks the zero-false-positive budget the
      whole arm depends on (an arm that cries wolf gets switched off), and the budget is the
      reason the one true positive is still readable.
      <deferred>Phase 164.8.6 VAULTTICKFIX</deferred> — routed 2026-09-11 by founder decision.
      ⚠️ THEMATIC MISMATCH, recorded in that phase's Requirements: 164.8.6 is the SQL-migration
      phase and these are pure JavaScript. Plan them as a separate wave, and do not read the
      migration's discipline (3 reviewers, TEST before PROD) as applying to them.
      **Evidence:** `.planning/phases/164.8.5-proberparse-*/164.8.5-REVIEW-R2.md`,
      `164.8.5-REVIEW-R3.md`, `164.8.5-FIX-R2-SUMMARY.md`.

- [ ] **`[164.8.1-DISPATCH-RECORD-GAP]` A founder-dispatched `workflow_dispatch` leaves its
      evidence in GitHub Actions and NOTHING in `.planning/`, so a phase's record depends on
      someone remembering to write it afterwards (booked 2026-09-11, found while closing
      Phase 164.8.1 plan 04).**
      ⛔ **MEASURED, not hypothetical.** Plan 04's preflight (run `34329459044`) and restore
      (run `34330741339`) both completed on `main` at 2026-09-09 08:47:39Z, green, under the
      held mutex, with the which-database marker printed. No `SUMMARY.md` and no `RESTORE.log`
      were written. For two days the phase therefore carried three executed plans and a fourth
      that read as a pending `checkpoint:decision` — and a founder-checkpoint inventory on
      2026-09-11 duly reported it as awaiting a founder dispatch that had already been made.
      ⭐ **The defect is the INFERENCE the missing artifact invites:** absence of the artifact
      read as absence of the action. Same shape as the reconstruction defect
      `164.7-REVIEWS.md` records. Only reading the two runs' own job logs corrected it.
      ⚠️ Compounding trap, measured the same session: the Actions runner ECHOES each script
      line with an ANSI colour prefix, so a naive grep over a job log matches the SOURCE of an
      `echo` rather than its OUTPUT — the first read mistook the echoed string
      `mode=restore requires -f confirm=…` for evidence of a run's mode. Filter `\[36;1m`
      lines out before concluding what a run printed. (`--allow-escape-sequences` is still
      required at all, per `164.7-06-SUMMARY.md`.)
      **Remedy shape (not yet decided):** either the workflow itself commits a machine-written
      run record, or the phase gate refuses to close a plan whose must-haves name a run id
      that no artifact cites. <deferred>Phase 164.9 TESTISOLATION</deferred>
      **Evidence:** `.planning/phases/164.8.1-refdata-.../164.8.1-04-RESTORE.log`,
      `164.8.1-04-SUMMARY.md`.

- [ ] **`[164.5-STALE-GENERATED-TYPES]` `src/lib/database.types.ts` keeps a generated declaration
      for `create_allocator_connected_strategy` after PR #758 drops it (booked 2026-09-08).**
      Inert, and deliberately left rather than hand-edited: **nothing generates or gates this
      file** — `grep -rn 'database.types' .github/workflows/` returns nothing and `package.json`
      carries no `gen:types`-shaped script, so there is no regeneration step to run and no CI job
      that would catch the staleness. Hand-editing a generated file to match would create the
      illusion that something keeps it current. The right fix is a types-regeneration step with a
      freshness gate; until one exists, a declaration for an RPC that has zero `.rpc()` call sites
      is dead weight, not a defect.

- [ ] **`[164.7-MARKER-GREP-VACUOUS]` Plan 07's verify block greps for `which_database` OUTSIDE the
      ACTIVATED/DEFERRED branch, so on the DEFER path the leg CANNOT FAIL (found by `gsd-verifier`,
      2026-09-10).**
      `164.7-07-PLAN.md:149` runs `grep -a -c 'which_database' "$R"` before the `if grep -a -q
      '^## ACTIVATED'` split. On a DEFER path no PROD statement runs, so no marker OUTPUT can exist —
      yet the leg still demands the STRING. It passes on the query text alone, and would pass
      identically for a fabricated record that merely mentions the marker.
      ⭐ `164.7-ACTIVATION-RECORD.md` discloses this honestly and in bold (*"Do not read this section
      as evidence that the marker was checked"*), so the RECORD is not misleading. The DEFECT is the
      CONTROL: a verify leg that cannot fail on the path actually taken is the anti-vacuity class
      this project ranks above correctness, and disclosure in prose is not a substitute for a gate
      that bites.
      **Fix:** move the `which_database` assertion INSIDE the ACTIVATED branch (where a marker output
      genuinely must exist and can be asserted non-empty), and give the DEFERRED branch its own
      assertion that no PROD statement was run — e.g. the manifest is byte-identical to `origin/main`,
      which the branch already checks, plus an explicit `grep -c '^## DEFERRED'` of exactly 1.
      ⛔ Do NOT "fix" it by deleting the leg; the ACTIVATED path genuinely needs it.
      Owner: **Phase 164.8.4 GATERESIDUE** (gate-integrity leftovers below the ship bar).

- [ ] **`[164.7-ACTIVATION-DEFERRED]` Phase 164.7 plan 07's PROD activation of the 161.1
      ledger-refresh switch was DEFERRED 2026-09-10 at its founder gate, on a FAILED pre-flight —
      criteria 3 and 4 are BLOCKED by an operational fault outside this phase.**
      **Failed pre-flight:** P3-C (mt5 `compute_jobs` `done` within 3 days).
      **Measured value:** the newest usable mt5 job is ~2026-09-07 04:0xZ. The MT5 terminal broke at
      **04:05:08** that day — five minutes AFTER the 04:00Z `poll-allocator-positions` tick and
      before the 05:00Z `refresh-allocator-equity` tick — and failed identically for three days
      (`'<key A>': authorization on VantageMarkets-Live 14 failed (Invalid account)`). At the
      decision point the gap was ~3.5 days against a 3-day window.
      ⚠️ **Both enqueue jobs are DAILY, not hourly** (`0 4 * * *` jobid 15, `0 5 * * *` jobid 17), so
      no wait inside 2026-09-10 could have closed the gap.
      ⛔ **Forcing was considered and declined on blast radius:**
      `enqueue_refresh_allocator_equity_for_all()` / `enqueue_poll_allocator_positions_for_all_keys()`
      enqueue for EVERY key at EVERY venue — a full cross-venue day-run to produce one mt5 row for a
      pre-flight. The activation closes a reproducibility gap, not an outage; there is no time
      pressure that justifies it.
      **Re-entry condition:** after the 04:00Z and 05:00Z ticks on **2026-09-11**, re-run P3-C from
      `164.7-ACTIVATION-PREFLIGHT.md` (P0 marker first). MT5 has been authorized again since
      2026-09-10 ~16:10Z — issue #753 closed, prober run **34500455961** reported `conclusion:
      success` (its `Open or update the prod-prober issue` step was SKIPPED).
      ⛔ **CORRECTED 2026-09-11 — the REASON recorded here was wrong, and it has been cited as
      evidence in a later session.** That step is NOT gated on a `^❌` line. Its `if:` is
      `failure() && steps.probe.outcome == 'failure' && inputs.arm == ''`
      (`.github/workflows/prod-prober.yml:353`, measured at this commit), so a SKIP means the probe step did not end in
      `failure` — which is not the same statement, and on a SCHEDULED run it is a much weaker one,
      because the POSTURE LINE makes a scheduled probe exit 0 on purpose. Read `conclusion:` on the
      run, or the runner log's own `❌ N defect(s)` line; never infer "zero defects" from a skipped
      issue step.
      ⚠️ **AND UNTIL 2026-09-11 THE PROBE STEP COULD NOT REACH ITS OWN POSTURE LINE.** GitHub runs
      a `run:` block under `/usr/bin/bash -e {0}`, so the bare `node scripts/prod-prober/run.mjs >
      "$RUNNER_LOG" 2>&1` terminated the step on any non-zero exit — before the `cat`, before the
      `^❌` step-summary block and before the `exit 0`. Measured that day: 10 of the last 12
      SCHEDULED runs `conclusion: failure`, i.e. an hourly red check on main's HEAD. Fixed with
      `|| status=$?` in both branches. Any earlier reading of this workflow's conclusions predates
      that fix and should be re-measured rather than trusted.
      **Nothing was written to PROD.** `scripts/prod-prober/cron-manifest.json` is untouched at 14
      jobs; `ledger_refresh_fanout` is still absent from it and from PROD.
      Owner: Phase 164.7 plan 07, re-entered at the same gate. Record:
      `164.7-ACTIVATION-RECORD.md`.

- [ ] **`[164.7-VAULT-ABSENT-RULE]` The `vault-absent` cron-hygiene rule and a Phase 164.5 repoint
      of jobid 1 are in direct conflict, and must move in ONE change (booked 2026-09-07, Phase
      164.7 plan 05, from `164.7-RESEARCH.md` § Q1 Open Question 2).**
      `scripts/prod-prober/arms/cron-drift.mjs`'s `vault-absent` rule fires when
      `name === "match_engine_cron" && !text.includes("vault.decrypted_secrets")` — it requires
      that literal string in the job's COMMAND TEXT. Phase 164.7 shipped
      `public.match_engine_cron_tick()` (migration `20260907120000`), which reads Vault INSIDE its
      body. So the moment Phase 164.5 item (7) repoints the live row to
      `SELECT public.match_engine_cron_tick();`, the command text no longer contains the literal
      and the rule fires **against a correct repair**. Phase 164.5 item 7 was SPLIT OUT to
      Phase 164.5.1 CRONREPOINT on 2026-09-07 by founder decision — not renamed, not dropped.
      ⛔ Do not discover this at repair time and
      "fix" it by keeping a decorative `DO` wrapper around the call purely to satisfy a grep —
      that is a gate shaped by its own false positive. **Three things move together, in one
      commit:** (a) the rule — accept EITHER the literal or a call to a function whose committed
      body contains it, and ship a RED fixture for the new arm, because a widened rule with no
      fixture is a rule nobody has watched fail; (b)
      `scripts/prod-prober/cron-manifest.json`, re-captured from PROD after the repair; and (c)
      the live row itself. Owner: Phase 164.5.1 CRONREPOINT (Phase 164.5 item 7 was SPLIT OUT
      here on 2026-09-07 by founder decision — not renamed, not dropped).

- [ ] **`[164.2-TYPES-REGEN-CHECK]` After the migration PR merges and auto-applies to PROD,
      re-derive the six `database.types.ts` lines that were hand-extended, and confirm no
      failure upsert was lost in the schema-cache window (booked 2026-09-06, Phase 164.2 plan 10;
      the hand-extension and this owed check are recorded in `164.2-06-SUMMARY.md` under the
      `database.types.ts` bullet, "⚠️ For plan 10").**
      Plan 06 added `computation_error_job_id` and `computation_error_source` to
      `strategy_analytics`'s `Row`, `Insert` and `Update` **by hand**, in the generated
      alphabetical position between `computation_error` and `computation_status` — six lines. It
      could not be generated at authoring time because the CLI is linked to PROD, where the
      columns did not yet exist (RESEARCH Open Q5).
      **Two checks, both post-merge:**
      1. Run the which-database marker query FIRST (this is a **READ-only** `gen types`, but the
         CLI is linked to PROD and the habit is the guard), then
         `supabase gen types typescript --linked` and confirm those six lines produce **no diff**.
         A diff means the hand-extension guessed the generator's shape wrong and every consumer
         of those types has been typed against a fiction.
      2. On PROD, confirm **no failure upsert was lost in the PostgREST schema-cache window**
         around the deploy: the writer starts sending the two marker keys the moment the Python
         half ships, and PostgREST can answer `PGRST204` for a column it has not yet cached.
         Read `net._http_response` and the worker logs for `PGRST204` in that interval. Plan 08
         carries a P11 minimal-key fallback for exactly this, so the expected finding is ZERO
         lost records — but "expected" is not "measured", and an effect never identifies the
         writer.

- [ ] **`[164.5-BASELINE-PROVENANCE-COLS]` `supabase/schema/baseline.sql` does not carry
      `computation_error_source` / `computation_error_job_id`, and Phase 164.5 gates the baseline
      hash (booked 2026-09-06, Phase 164.2 plan 10).**
      `supabase/migrations/20260906120000_computation_error_provenance.sql` adds both columns to
      `strategy_analytics` (plus the `..._computation_error_source_check` and
      `..._computation_error_markers_together_check` constraints — see `[PROV-WRITER-23514]`).
      **Measured at HEAD 2026-09-06:** `grep -c 'computation_error_source'
      supabase/schema/baseline.sql` → **0**; the table's column list at `baseline.sql:5183` still
      ends `"computation_error" "text",` with no marker columns after it.
      **Why it is booked and not fixed here:** the baseline is a generated snapshot of APPLIED
      PROD schema, and the migration has not merged, so regenerating it now would encode a
      not-yet-true state. Phase 164.5 is the phase that gates the baseline hash — it must
      regenerate `baseline.sql` after this migration auto-applies, or its own gate will fail on a
      drift that is really just this pending apply. ⚠️ Sequence with
      `[164.2-TYPES-REGEN-CHECK]`: both wait on the same PROD apply.

- [ ] **`[164.2-WIZARD-BARE401]` A bare upstream 401/403 with no seam envelope still answers
      `code: "UNKNOWN"` on the two routes the wizard actually calls (booked 2026-09-06, Phase
      164.2 ship review).**
      **Owner:** Phase 212 WIZTRUTH (booked 2026-11-14)
      `create-with-key/route.ts:1731` and `composite/add-key/route.ts:710` both funnel the
      upstream error through `classifyKeyValidationError`, which reads `seamCode` — **null** on
      the middleware's bare `{"detail": "Unauthorized"}` body (`analytics-service/main.py:868`) —
      never reads `.status`, and carries no 401 needle in its substring cascade. So the honest
      "our credential to the analytics service is wrong" case lands as `UNKNOWN`.
      The `UPSTREAM_STATUS_TO_SEAM_CODE` map added by this phase closes exactly this hole, but it
      was added ONLY to `keys/validate-and-encrypt` (`route.ts:123`, consulted at `:879`), whose
      three consumers read `err.error` and ignore `code` — so the fix currently reaches no user.
      **Fix:** read the status in the classifier's null-`seamCode` branch, or consult a shared
      map from both key routes before the cascade; then add a route test on BOTH twins with
      `new AnalyticsUpstreamError("Unauthorized", 401)`.
      **Why booked, not fixed at ship time:** it is not a regression — `UNKNOWN` is what these
      routes answered before this phase too — and `UNKNOWN`'s copy does not blame the user for
      our own misconfiguration. It fails the blast-radius bar for blocking, not the bar for
      being real.

- [ ] **`[164.2-RECLAIM-PROVENANCE]` `reclaim_stuck_compute_jobs` requeues without resetting the
      provenance markers, so a crash-recovered job can lose its curated sentence (booked
      2026-09-06, Phase 164.2 ship review).**
      `supabase/schema/functions/reclaim_stuck_compute_jobs.sql:32` sets `status = 'pending'`
      directly and **never calls `sync_strategy_analytics_status`**, so the marker reset every
      other requeue path performs does not happen here. The reachable sequence: a job stamps a
      curated sentence with `('writer', J)`; it dies before `mark_compute_job_failed`; the
      reaper reclaims it; on attempt 2 the writer writes a **different** curated sentence while
      restating `('writer', J)` unchanged. The `BEFORE UPDATE` trigger
      `strategy_analytics_drop_stale_error_provenance` then reads that as a marker outliving its
      sentence and silently NULLs both markers, and the next bridge call replaces the curated
      sentence with the per-kind generic.
      ⚠️ The trigger's own `COMMENT` at
      `supabase/migrations/20260906120000_computation_error_provenance.sql:1138-1145` records
      this cost as though it were theoretical. It is not — the crash-recovery path reaches it.
      **Fix:** `PERFORM sync_strategy_analytics_status(strategy_id)` for each reclaimed row, plus
      a lane arm in `supabase/tests/test_sync_status_curated_sentence_survives.sql` that
      reclaims, re-stamps a DIFFERENT sentence under the SAME job id, and reads the curated
      sentence back.

- [ ] **`[164.2-SEAMCODE-UNION]` `UPSTREAM_STATUS_TO_SEAM_CODE`'s "every value is a key of
      `SEAM_CODE_TO_WIZARD_CODE`" law is enforced by a source-text scan, not by the compiler
      (booked 2026-09-06, Phase 164.2 ship review).**
      The map is typed `ReadonlyMap<number, string>`
      (`src/app/api/keys/validate-and-encrypt/route.ts:123`). Nothing in the type system stops a
      value that no wizard code answers to; what stops it is the SOURCE-TEXT scan in
      `src/lib/wizardErrors.invariant.test.ts:2681-2755` (`deriveStatusMap` at `:2681`, the
      no-more-no-less assertion at `:2741`, the every-code-is-a-key assertion at `:2757`), which
      parses the declaration out of the route file's source text.
      A `SeamWireCode` union in place of `string` would make the same law compile-time.
      ⚠️ **Why it is booked rather than done:** that scan is guarded by a SELF-TEST that
      byte-pins the declaration's exact opening line at `:2724` (its sibling for
      `SEAM_CODE_TO_WIZARD_CODE` at `:1602` does the same). Narrowing the annotation changes
      those bytes, so the pins must move in the SAME commit or the suite reds on the type change
      alone — which makes this a small, coupled edit rather than a one-line improvement.

- [ ] **`[164.2-FRESHNESS-TWO-BUCKETERS]` One fact — how old the series end is — is judged by two
      bucketers with three verdict vocabularies and three rank tables (booked 2026-09-06, Phase
      164.2 ship review).**
      `Freshness` + `FRESHNESS_RANK`, `SeriesVerdict` + `SERIES_RANK`, and `FreshnessTone` +
      `TONE_RANK` all describe the same question. `src/lib/freshness.ts:48-53` names this
      structure as **exactly how the two public surfaces came to contradict each other** about
      one strategy: `bucketSeriesAge` (the discovery badge) and `bucketByAge` in
      `app/factsheet/[id]/v2/FactsheetView.tsx` (the factsheet chip). The remedy actually chosen
      was a shared exported constant plus a cross-file agreement test — which stops the numbers
      diverging but leaves the duplication that produced the divergence.
      **Fix:** export `bucketSeriesAge` and have the chip map `SeriesVerdict -> FreshnessTone`,
      so the three day-constants are read in ONE place and the two-surfaces test degrades from a
      value-agreement test to a mapping test.

- [ ] **`[164.2-DENYBODY-DRY]` The rate-limit deny bodies are hand-spelled at every
      `rateLimitDenyJson` call site, in two key orders (booked 2026-09-06, Phase 164.2 ship
      review).**
      **Measured at HEAD 2026-09-06** (`grep -rn 'code: "RATE_LIMITED"' src/app | grep -v
      '\.test\.'`): NINE `throttledBody` sites spell `{ code: "RATE_LIMITED", error: "Too many
      requests" }` by hand — `portfolio-optimizer:131`, `strategies/composite/add-key:326`,
      `strategies/create-with-key:514` and `:1050`, `admin/match/recompute:114`,
      `admin/match/eval:170`, `keys/sync:172` and `:186`, `keys/validate-and-encrypt:389` — and
      they disagree on KEY ORDER (`{ code, error }` on the wizard routes, `{ error, code }` on
      the rest). Each carries a paired `misconfiguredBody` spelling
      `{ code: "SEAM_MISCONFIGURED", error: "Rate limiter unavailable" }` the same way.
      **Fix:** export the two bodies as shared constants from `src/lib/ratelimit.ts` and spread
      them. ⚠️ The byte-wise route tests need their key order settled ONCE first; the code
      comments at these sites already state that neither order is a contract, so settling it is
      a decision nobody has had to make yet rather than a contract change.

- [ ] **`[164.2-SENTRY-WITHSENTRY]` `addSentryBreadcrumb` re-types `captureToSentry`'s whole
      dynamic-import skeleton (booked 2026-09-06, Phase 164.2 ship review).**
      `src/lib/sentry-capture.ts:275-303` (inside `addSentryBreadcrumb`) is the same outer try /
      `import()` / inner try / `.catch` that RESOLVES / outer catch returning a settled promise
      as `:206-233` (inside `captureToSentry`) — the second function's own docblock says the
      shape is copied deliberately. A module-private `withSentry(use)` would carry it once, at
      roughly 14 lines instead of ~30 twice.
      **Verified safe to do:** the three tests that read this file's SOURCE pin only its
      relative imports and its citations, and the behavioural tests drive it through
      `vi.doMock`, so none of them pins the internal shape. Booked rather than done only because
      it is a refactor of live error-reporting code and this phase was prose-only.

- [ ] **`[REDUNDER-COVGAP-01]` `test_funding_fees_rls.sql` Assertion 2 cannot falsify its OWN conjunct.**
      MEASURED 2026-09-03 (plan 164.4-07) while authoring the twin. Dropping ONLY the
      `AND s.user_id = auth.uid()` conjunct from `funding_fees_read`'s USING predicate scores
      **NO-RED**: the policy's sub-select on `strategies` is itself subject to `strategies`' OWN RLS,
      which already hides tenant B's DRAFT strategy from tenant A. The conjunct is the binding
      constraint only for a strategy the reader can ALREADY see — i.e. a **PUBLISHED** one — and this
      gate seeds only `status='draft'`, so it cannot distinguish "funding_fees_read is owner-scoped"
      from "strategies_read is owner-scoped". The shipped twin replaces the whole predicate with
      `true`, which the arm CAN observe, so the ARM is proven; the CONJUNCT is not.
      **Fix:** seed a PUBLISHED strategy owned by tenant B, which makes the conjunct itself
      falsifiable. Out of scope for 164.4 (the phase may not add arms).

- [ ] **`[REDUNDER-COVGAP-02]` `test_user_notes_dashboard_scope.sql` Assertion 4 has a second,
      incidental fence.** MEASURED 2026-09-03 (plan 164.4-07). Opening `user_notes_insert_own`'s
      `WITH CHECK (user_id = auth.uid())` to `true` ALONE scores **NO-IDENTITY**: tenant B's forge
      targets tenant A's EXISTING `(user_id, scope_kind, scope_ref)` triple, so once the policy admits
      it the `user_notes_unique_multiscope` UNIQUE index refuses it with 23505 — a SQLSTATE the arm's
      handler (`insufficient_privilege OR check_violation`) does not catch, so the file dies OUTSIDE
      every arm. On this forge the unique index, not the INSERT policy, is the outer fence.
      **Fix:** forge a triple that does not collide, so the INSERT policy is the only fence.

- [ ] **`[PRBRANCH-STALEBASE-01]` ⚠️ CLAUDE.md's PR-branch deletion guard resolves its base to the
      LOCAL `main`, which is routinely stale.** The documented line is
      `BASE=$(git rev-parse --abbrev-ref origin/HEAD | sed 's|origin/||')` -> the string `main`, so
      the guard then diffs against whatever the local `main` branch happens to point at. MEASURED
      2026-09-04: local `main` sat at `c2251b6d` while `origin/main` was `f82d9c1b`, and the guard
      reported **6 `.planning/` files** in a PR that actually touches **none**. The failure mode is
      conservative (a stale base shows EXTRA files, so it can only false-STOP, never false-PASS),
      which is why it has never caused damage — but it makes the guard cry wolf and trains the
      reader to wave it through, which is exactly how a real deletion would get merged.
      **Fix:** pin the guard to `origin/main` directly (or `git fetch` + `git rev-parse origin/HEAD`
      as a SHA) in the CLAUDE.md snippet, so it is independent of the local branch's freshness.

- [ ] **`[REDUNDER-SWEEPCOPY]` `test_scenario_downgrade_sweep.sql` re-implements the sweep script
      it claims to prove, and nothing enforces they agree.** MEASURED 2026-09-04 (plan 164.4-08)
      while authoring its twins. The artifact under test is
      `scripts/sweeps/f4-memberkeyids-restamp.sql`; the gate does NOT execute it, it carries the
      discriminator and the `jsonb_set` transform **copied verbatim** (`:5-10`). The copy is
      asserted to be verbatim in PROSE only — no test, lint rule or CI step compares the bytes — so
      the sweep script can drift and every arm in that file stays green. That is the
      two-registries drift class this repo deletes elsewhere.
      **Consequence for 164.4:** every twin in that file necessarily targets the gate's own copy
      (a legal target, `run.mjs:1806`, precedent in `test_create_wizard_strategy_for_key.sql`), so
      the arms are proven falsifiable but the mutation cannot reach production.
      **Fix:** either have the gate `\i` the sweep script, or add a lint rule that diffs the copied
      block against the script. Out of scope for 164.4 (the phase may not change what a gate does).

- [ ] **`[ANCHOR-QUOTE-01]` `verify-plan-anchors.mjs` binds a quote ACROSS an XML element boundary — false stales, masked only by element ORDER (booked 2026-09-03, Phase 164.4 plan-check iteration 3).**
      `scripts/verify-plan-anchors.mjs:279-292` (`boundQuote`): when an anchor is the last on its line
      and no backtick span follows it, the verifier binds the FIRST backtick span of the NEXT line as
      that anchor's quote. It does not stop at a line that opens a new XML element. Measured in Phase
      164.4: with `<read_first>` placed before `<precondition>` in Task 1 of every batch plan, a
      `sql-mutation` span on the following `<precondition>` line was read as a quote against the last
      `<read_first>` anchor and reported STALE. The plans were reordered (`<read_first>` after
      `<precondition>`) to dodge it — correct today, fragile forever: any future edit that puts a
      backtick span on the line after `</read_first>` re-triggers the false stale, and an executor
      told "anchor stale" will loosen the anchor rather than suspect the verifier.
      Fix: `boundQuote` must never bind across a line that opens a new XML element (`^\s*<[a-z_]+`)
      or closes the current one (`^\s*</`); return `null` at that boundary. Ship with a red fixture
      (anchor last on its line, next line opens `<precondition>` with a backtick span → must report
      NO quote, not a stale) and a green one (same anchor, span on a plain continuation line → bound).
      Verify with `node scripts/verify-plan-anchors.mjs --pending` on the 164.4 plans: claims count
      unchanged, stale 0, with `<read_first>` moved BEFORE `<precondition>` in one batch plan as the
      probe (then restored).

- [ ] **`[REDUNDER-SAVEPOINT]` THREE migrations cannot apply to a vanilla PostgreSQL 16 at all — `SAVEPOINT` inside a PL/pgSQL body (first measured 2026-09-02, Plan 164.4-00; class closed at exactly 3 on 2026-09-04, Plan 164.4-09).**
      Its final `DO $$ … $$;` block issues `SAVEPOINT audit_log_probe;` and `ROLLBACK TO SAVEPOINT
      audit_log_probe;` (`:239-267`) **inside a PL/pgSQL body**. PL/pgSQL has no savepoint statements, so
      the body fails to PARSE: `42601 syntax error at or near "TO"` at `plpgsql_yyerror`
      (`pl_scanner.c:542`), before a single statement in the block runs. Reproduced in isolation from an
      8-line DO body on an empty cluster (probe M1 in the Plan 00 record). It is what killed the stubbed
      real-migration-chain candidate at migration 51 of 262.
      **Either the deployed body differs from the repo body (repo-vs-PROD drift — VAC-04's own subject),
      or this migration never applied as written.** Resolve by DIFFING the deployed
      `audit_log`/`log_audit_event` state against this file before editing anything. Phase 164.4 may not
      touch `supabase/migrations/`, so it is booked, not fixed.
      **⭐ THE CLASS IS EXACTLY THREE, not one (measured 2026-09-04, Plan 164.4-09).** Plan 09 hit two
      more on real lanes while discovering apply lists, each failing identically with
      `ERROR 42601 syntax error at or near "TO"`:
      `20260417031851_user_app_roles.sql:433` and
      `20260510173005_process_key_long_idempotency_drain.sql:397`.
      An AST-level scan of every migration puts the class at **exactly 3** — these two plus the
      audit-log one above. The same disjunction applies to all three: none has ever applied to a
      vanilla cluster as written, so either the deployed bodies differ from the repo (VAC-04's
      subject) or they never applied. Both were EXCLUDED from Plan 09's apply lists by measurement;
      a scaffold fixture carrying the REAL helper body substitutes for the `user_app_roles` one,
      because a hardcoded `RETURN FALSE` stub would make every admin-policy arm structurally
      unfalsifiable.

- [ ] **`[REDUNDER-NONIDIOM]` The 27 non-idiom SQL gate files are excluded from Phase 164.4 and need their own phase (logged 2026-09-02, founder scope decision).**
      Phase 164.4's criterion 1 was NARROWED to the 44 `TEST FAILED (` idiom files. The other **27
      files / 334 `RAISE EXCEPTION` sites** assert through their own message prefixes
      (`'MT5SRC-03 (1a): api_keys did not admit exchange=mt5'`,
      `'FLIPRETRY-02: include predicate present % time(s)'`) and are structurally invisible to the
      mutation runner, whose identity needle is the literal `TEST FAILED (<arm>)` (`run.mjs:544`,
      defined once at `run.mjs:947`). They are therefore UNPROVEN — nothing machine-checks that
      those 334 assertions can fail.
      **This is a real coverage gap, deliberately accepted and made loud, not closed.** Phase 164.4
      requires the runner to PRINT these 27 files by name on every run, so the exclusion is emitted
      by the gate rather than asserted in a ledger.
      **The successor work is a message-only rename** into the idiom. Measured and NOT free: the
      321 no-idiom raises carry only **139 distinct prefixes** (`B5b:` heads 28), so unique arm
      identities must be INVENTED per arm, not mechanically transformed — authoring judgement
      across 27 files. It is safe from the "no assertion edits" angle: nothing external reads those
      strings (the sentinel gate counts `RAISE EXCEPTION` lines at `ci.yml:2360`; `sql-tests` uses
      `ON_ERROR_STOP`), so a rename changes message text only, never what an assertion asserts.
      ⛔ Do NOT fold this into 164.4. It has a different risk profile — 164.4 annotates what exists,
      this one authors new identities — and mixing them is how a backfill turns into 334 fresh
      unverified claims.
      ⚠️ Also carries the 174 non-idiom raises that sit INSIDE the 44 idiom files (unreachable and
      un-neuterable there); seven "mixed" files are the concentration, e.g.
      `test_api_keys_exchange_not_user_writable.sql` at 38 non-idiom vs 9 idiom.
      ⚠️ **164.4 closed 2026-09-04: 39/71 files, 262 arms biting, 0 waived; the runner prints these
      27 by name every run** (`unreachable:`), and `sql-mutation` MEASURE_FAILs if that line goes
      missing or if its count disagrees with the names beside it. The seven mixed files ARE now
      annotated — plan 164.4-11 twinned all 15 of their idiom sections — so what this item still
      owes is unchanged: the 27 whole files, plus those files' own non-idiom raises, which stayed
      invisible to the runner throughout. Measured while annotating them: the shadowing raise is
      typically a PRIVILEGE abort (`permission denied for table …`), which carries no
      `TEST FAILED (…)` and scores NO-IDENTITY — concrete evidence for the rename this item
      proposes.

- [ ] **`[VAC08-SELFTEST-CI]` VAC-08's five-arm self-test never runs in CI (logged 2026-09-02, Phase 164.3.1 UAT test 2).**
      `ci.yml:2051` invokes `bash scripts/test-ledger-drift-check.sh` with no argument, which the
      script's `case` dispatches to `check` — the `--self-test` mode at
      `scripts/test-ledger-drift-check.sh:671` is therefore never exercised by any workflow. The
      gate itself runs and produces a real verdict, so this is not a dead gate; what is missing is
      the machine proof that its four RED modes still fire. That proof is exactly what
      `feedback_every_test_must_be_able_to_fail` requires, and today it exists only when a human
      runs the flag by hand (the orchestrator did so at HEAD on 2026-09-02: `self-test OK (5/5)`).
      Fix: add a `--self-test` step to the `sql-tests` job ahead of the live check, mirroring how
      `sql-mutation` already runs `run.mjs --self-test` before its corpus pass. Guard hygiene, not
      user-facing — recorded rather than blocking, per the stopping rule.

- [ ] **`[VAC04-ARMS-UNRUN]` VAC-04's three behavioural arms have still never executed in CI (logged 2026-09-02, Phase 164.3.1 UAT test 2).**
      PR #730 closed the big unknown — `migration-drift-check` run 33643046189 ran on a real
      `pull_request` with the real PROD credential (`::notice::Drift-check credentials present.`),
      which retires the WINDOWS.md 25 "never run against its real credential" entry. But that PR
      changed no `supabase/migrations/**` files (it matched the paths filter on VAC-04's own script
      entries), so `scripts/prod-body-drift-check.sh` exited at its EARLIEST short-circuit, `:198`
      *"this PR changes no migration files — nothing to compare against PROD."* Never reached, and
      therefore still unproven on the real credential: the D-13 LEGITIMATE-ZERO branch (`:448`), the
      normal compare verdict, and the absurdity floor (`:608+`, index ≥ half the 118-body snapshot).
      These need a migration-bearing PR to fire. ⛔ Do NOT manufacture one to tick this off while
      the 164.3.1→164.4 window is open — UAT test 2 carries a standing instruction not to merge a
      migration PR in that window. Close it on the next genuine migration PR and record the run id.

- [ ] **`[MUT-SELFTEST-UNREGISTERED]` Three of the mutation runner's 15 self-test modes are not bound by name (logged 2026-09-02, Phase 164.3.1 re-verification finding O-3).**
      The ship-review pass took `scripts/mutation-runner/run.mjs --self-test` from 12 modes to 15
      (the count is visible as `SELF-TEST n/15` in the script). The three added modes fire and pass,
      but they were never registered in `INSTANCE_ARM_REGISTRY`
      (`src/__tests__/gate-family-meta.test.ts:120`), which is what binds an instance to the arm
      that proves it by NAME. Consequence, and it is narrow: renaming or deleting one of those
      three would not fail by name — the count arm would still see 15 and the mode itself would
      still run, so this is a naming-durability gap, not a coverage gap. Fix: add the three entries
      with their needles, and re-derive the `21 needles` measurement recorded at
      `gate-family-meta.test.ts:317` (it is stamped `MEASURED 2026-09-02 at 8969513e`, which
      predates the additions). Not user-facing and not data-integrity, so recorded rather than
      blocking, per the stopping rule.

- [ ] **Two cosmetic verify-precision notes from Phase 164.3's plan gate (logged 2026-08-29).**
      Neither is user-facing nor data-integrity, so neither blocked the phase — recorded so they are
      not re-derived.
      1. `164.3-02-PLAN.md` Task 3 asserts the OPS-08-F9 floors with `grep -a "SENTINEL_FLOOR=8"`,
         which would also match `SENTINEL_FLOOR=80` or a comment containing the string. It is
         verify-and-record of an ALREADY-DONE raise (floors are 8 and 166 at `ci.yml:1738-1739`),
         not a shipped control, so a loose match cannot hide a regression here. Tighten to an
         anchored exact match if the arm ever becomes load-bearing.
      2. `164.3-07-PLAN.md` Task 1's verify masks the status of its `local-stack ... down` teardown
         (`up && test; RC=$?; down; exit $RC`). That is deliberate — it preserves the TEST verdict
         rather than letting a teardown hiccup overwrite it — and orphaned containers are caught
         independently by the lane's `--self-test` no-containers assertion and by the next `up`.

- [ ] **`[VAC-04-ROLE]` Swap Phase 164.3's repo-vs-PROD body diff onto a zero-table-grant role.**
      Booked 2026-08-29 as the deferred half of a founder ruling, so it is not lost.
      **Current state (deliberate, not an oversight):** VAC-04 runs as a step inside
      `.github/workflows/migration-drift-check.yml` and reuses the `SUPABASE_ACCESS_TOKEN` +
      `SUPABASE_DB_PASSWORD` that job already carries. That was chosen over minting a second prod
      credential, because the secret is already in that job's blast radius on every migrations PR —
      adding a step widens nothing, while a new secret would have been a second copy of prod access
      rather than a smaller one.
      **The improvement:** `pg_get_functiondef` needs NO table privileges, so a role with zero
      grants can do the whole job. A credential whose permitted actions are legible from its name
      beats a shared one whose are not.
      **Done when:** a login role with no table grants exists, its DSN is a CI secret, VAC-04 reads
      only that, and the check still exits 1 (never skips) when it is absent.
      ⚠️ Not urgent and not blocking: this changes WHICH credential is used, not whether the control
      works. Do not let it gate the phase.

### RANK-SPLAT-01 — the anon metrics surface is unbounded by construction (booked 2026-08-26)

- **[RANK-SPLAT-01] Still open (re-measured 2026-11-14).** The `metrics_json` half is done: `src/lib/factsheet/fetch-and-build-payload.ts` selects named `metrics_json->x` aliases and its test forbids a bare `metrics_json`. `strategy_analytics.metrics_json_by_basis` is still selected as a whole column in that same select, so whatever the analytics stage writes into it becomes readable by an anonymous visitor of a published strategy with no review step. **Closed when:** that column is projected as a named alias set (or through an RPC that returns one), pinned by a test that FAILS when a new key appears in the projection.

### Phase 164.8 TESTPREPROD — the NEW couplings the TEST-first pipeline creates, and the one disposition it deliberately did not build (booked 2026-09-09)

Opened by Phase 164.8 plan 06 as it closed `CI-MIGRATE-01`, `[164.2-TEST-APPLY-PROVENANCE]`,
`[164.7-TEST-APPLY-APPSETTINGS]`, `[164.5-TEST-EXCEPT-DRIFT04]`, `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]`
and `[VAC08-LEDGER-32]`. ⛔ **Every entry below names a PHASE, not just a problem** (founder rule
2026-09-08: a TODOS line alone has no owner, no date and no gate).

- [ ] **`[164.8.4-SCOPE-DEPTH-AXIS]` the class-lint's scope sentence outruns its filter for the THIRD
      time on one branch — now on the DEPTH axis (booked 2026-09-10, Phase 164.8.2 terminal review;
      routed to Phase 164.8.4). LATENT — zero offenders in the unscanned files today.**
      **MEASURED 2026-09-10:** `readdirSync` is NON-RECURSIVE. 144 test files live under
      `src/__tests__`; **139 are scanned, 5 are not** — the `.test.ts` files in
      `src/__tests__/contracts/` and `src/__tests__/helpers/`. Meanwhile the describe is titled
      "…anywhere in `src/__tests__`" and its floor arm is titled "the scan covers the whole
      directory". All 5 unscanned files were scanned by hand with the shipped scanner: **0
      offenders**, so today's green is TRUE.
      ⭐ **THE POINT IS THE RECURRENCE, NOT THE AXIS.** Round one: the rule covered 2 files while
      its name claimed a class. Round five: 137 files, silently skipping 346 `.test.tsx`. Round six:
      139 files, silently skipping 5 by directory depth. Each fix closed the axis it was SHOWN and
      left the next one.
      ⛔ **DO NOT close this with a third hand-widening.** The deliverable is a mechanism that makes
      the scope CLAIM and the file SET agree by construction — derive one from the other — so a
      fourth axis (depth, extension, location, symlink) cannot open quietly. A calibration must
      prove it by OPENING a new axis on a scratch tree and observing RED, never by asserting
      today's count.

- [ ] **`[164.8.4-DEMOS-OFF-HELPER]` this branch planted two fresh copies of the offending
      expression in exactly the files the docblock names as the next widening step (booked
      2026-09-10; routed to Phase 164.8.4). LATENT.**
      `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx:7980` and
      `src/lib/pdf-render-token.test.ts:163`. Both are legitimate calibration subjects demonstrating
      the pre-fix form — but `src/test/helpers/degenerate-narrow.ts` exists PRECISELY so
      demonstrations live outside the scanned surface, and neither routes through it. The rule's own
      failure message instructs offenders to use it.
      ⛔ **The hazard is the REFLEX, not the red.** When the promised widening lands and reds two
      arms this branch wrote, the instinct will be to restore the file+function tolerance this
      branch just DELETED as unworkable (its own calibration legs called the untolerated path and
      could not fail). Route them through the helper instead, and add an arm asserting a NEW inline
      demonstration outside the helper is reported.

- [ ] **`[164.8.4-HELPER-UNPOLICED]` `degenerate-narrow.ts` left the scanned surface entirely, so
      nothing polices the rest of that file (booked 2026-09-10; routed to Phase 164.8.4). LATENT.**
      Deleting the file+function tolerance was correct — it could not fail, and the file is 79 lines
      with ONE exported function, so the old tolerance policed an empty region. But the deletion
      also removed the only thing watching that file outside `degenerateNarrow`. A second exported
      helper added there that narrows on a raw lookup would be caught by nothing, and a gate calling
      it would inherit the degradation.
      Close it, or record a dated reason why one 79-line single-function file does not need it.
      ⛔ Not silence.

- [ ] **`[164.8.4-PROSE-OVERCLAIM]` four sentences that describe more than their code does (booked
      2026-09-10; routed to Phase 164.8.4). COSMETIC — but this is the branch's own defect class, so
      it is booked rather than shrugged off.**
      1. `src/lib/seam-venue-vocabulary.invariant.test.ts` — the docblock says dropping the `^` from
         `KEYWORD_ARG_RE` would red. MEASURED: it reds NOTHING and does not reintroduce the class
         (the prefix from `kw.index` still cannot hold an `=`). The self-test DOES pin the genuinely
         load-bearing property — relaxing the prefix to `([^\s]*)` on the `a=b=c` shape goes red,
         verified — so the ARM is sound and only one clause of its prose is wrong.
      2. `src/__tests__/restore-test-from-baseline.test.ts` — a sentence describing the sibling's
         filter as `*.test.ts` went stale TWO COMMITS LATER on the same branch (`/\.test\.tsx?$/`).
         Conclusion still holds, so it misleads without misdirecting.
      3. `src/lib/pdf-render-token.test.ts` — one tautological illustration beside three
         load-bearing legs.
      4. `src/__tests__/test-restore-workflow-wiring.test.ts` — `SCAN_FILES.length > 130` over an
         actual **139** lets nine test files be deleted silently. The in-code comment states the
         limitation honestly; the floor still does not measure what a reader assumes.

- [ ] **`[164.8.4-COMMENTISH-FALSE-RED]` the whole-directory floor's `commentish` test can false-RED
      on a legitimate docblock continuation (booked 2026-09-10; routed to Phase 164.8.4). REACH.**
      `/^\s*(\/\/|\/\*|\*)/` does not recognise a blanked continuation line that does not begin with
      `*`. MEASURED: **0 occurrences across all 139 scanned files**, and it fails in the LOUD
      direction, so it costs a false alarm rather than a false pass. Recorded so the next person to
      see it red knows it is this, not a stripper regression.

- [ ] **`[164.8.2-EVIDENCE-DOTENV-LEAK]` a local test wrapper injects repo credentials and turns 16
      SKIPPED live-DB suites into real writes against SHARED TEST (booked 2026-09-10, Phase 164.8.2
      gate run; routed to Phase 164.8.4).**
      **MEASURED.** A recorded full-suite run reported `16 failed | 853 passed`, `39 failed`, with
      skips collapsed from **19 files / 280 tests to 3 / 94**. A plain `npx vitest run` in the same
      tree at the same commit is GREEN with skips intact, and none of the 16 failing files is in the
      branch diff.
      **CAUSE.** `gstack-evidence` carries `#!/usr/bin/env bun`, and bun AUTO-LOADS `.env.local` into
      `process.env`; the child `vitest` inherits it, `HAS_LIVE_DB` flips true, and the gated suites
      run for real. The wrapper HAS a scrubber for exactly this and it did not fire.
      ⚠️ **The failures were the harmless half — the WRITES are the item.** Those suites INSERT
      (`user_notes`, `match_decisions`); the observed `42501` / `22023` / rate-limit / NOT-NULL
      errors are real answers from a real remote database. PROD was NOT touched
      (`assertNotProductionSupabaseUrl` throws before any `getAdmin()` write, and these were ordinary
      DB errors rather than that assertion), so it was SHARED TEST.
      ⛔ **Do not close this by editing the skip gates.** `it.skipIf(!HAS_LIVE_DB)` is correct; the
      defect is that `HAS_LIVE_DB` became true by accident.

- [ ] **`[164.8.2-GATE-RESIDUE]` seven small gate-integrity leftovers from Phase 164.8.2's four
      review rounds, each below the bar that blocked the ship, none with an owner (booked
      2026-09-10; routed to Phase 164.8.4).**
      ⭐ Booked as ONE entry deliberately: one sweep over one file family. Splitting it into seven
      thin entries is how a class becomes seven half-classes — which this branch demonstrated three
      times.
      1. **`src/__tests__/test-restore-workflow-wiring.test.ts` (ancestry arm)** asserts on `git`'s
         own stderr wording (`/not a valid/i`). Upstream reword = red for a non-defect.
      2. **`src/__tests__/supabase-migrate-test-first.test.ts`** pins three literal needles inside a
         prose comment. Defensible as a documentation gate; a maintenance liability as a guard test.
      3. **`src/__tests__/restore-test-from-baseline.test.ts:720`** governs softening tokens with a
         COUNT (`{"|| true": 4, "set +e": 7}`), in the family whose sibling rule was rewritten to a
         SITE SET precisely because a count is blind to a one-for-one swap. Pre-existing; the batch's
         own reasoning now applies verbatim.
      4. **The database-marker regexes are HAND-COPIED** from `restore-test-from-baseline.sh`'s
         `RESTORE_EXPECT_MARKER_RE` / `RESTORE_REFUSE_MARKER_RE` defaults into
         `test-restore-from-baseline.yml`, with nothing pinning the copies to each other. Tighten the
         script and the cheap early gate silently becomes the weaker of the two. The workflow comment
         says this out loud and does not fix it; a two-line assertion would.
      5. **`staged_n`** is computed and printed and never compared — it exists to be a floor and is
         not one.
      6. **The artifact README advertises six diagnostic channels unconditionally**, including on the
         denial path that stages NONE of them, so a reader opening the zip finds a document
         describing files it does not carry.
      7. **A dead local** (`body3`, shellcheck SC2034) in `restore-test-from-baseline.sh`, and a
         reused failure message naming the wrong subject in the self-test step.

- [ ] **`[164.6-SOURCE-ANCHOR-ROT]` `file:line` anchors in SOURCE comments are an unguarded class
      (booked 2026-09-10, Phase 164.8.2 maintainability audit; routed to Phase 164.8.4).**
      `plan-anchor-verify` re-resolves every anchor a pending PLAN.md asserts and fails loud.
      NOTHING does that for a comment in a `.ts`/`.sh`/`.yml`/`.mjs` file — and those rot faster,
      because every edit above an anchor moves it.
      **MEASURED 2026-09-10** over the ten files 164.8.2 touched:
      `grep -noE '[A-Za-z0-9_./-]+\.(ts|sh|yml|mjs|sql|md):[0-9]+'` finds ~30 anchors; spot-checks
      found several that do not resolve (`test-restore-from-baseline.yml:412`/`:517`,
      `test-ledger-drift-check.sh:281`/`:604`/`:667`/`:675`/`:140`, `ci.yml:2610`,
      `restore-test-from-baseline.test.ts:217`). One was **already wrong on `main`** and pointed at
      a bare `exit 1` in an unrelated step.
      ⚠️ Only the TWO load-bearing anchors were pinned during 164.8.2 — converted to SYMBOLS with
      an arm that reads the target file plus a calibration. Rewriting thirty by hand was refused
      deliberately: it fixes today's instances and leaves the class open.
      **DELIVERABLE: a repo-owned gate, `plan-anchor-verify`'s shape applied to source comments.**
      ⭐ Prefer converting an anchor to a SYMBOL over re-pinning a number — a symbol survives the
      edit that moves the line. Encode that preference in the gate's MESSAGE, not just its docs.

- [ ] **`[167.2.1-CLIENT-SENTRY-NOOP]` every `captureToSentry` call in browser code is a silent
      no-op, because there is no client `Sentry.init` (booked 2026-09-26, Phase 167.2.1
      FACTSHEETBUILDABLE, 167.2.1-REVIEW-R2 IN-04 and 167.2.1-REVIEW-SFH M-6)** — Sentry is
      initialised server-side only, in `src/instrumentation.ts`. There is no `sentry.client.config.*`
      and no `instrumentation-client.ts` (checked 2026-09-26). So a `captureToSentry` or `@sentry/*`
      call in a `"use client"` module reports nothing, and the author has no way to see that.
      **The class, measured 2026-09-26:** **12** non-test files carry a real `"use client"` directive
      and call `captureToSentry` or import `@sentry/*`. The count comes from
      `grep -rlE "['\"]use client['\"]" src | grep -v '\.test\.' | xargs grep -lE 'captureToSentry|@sentry/'`,
      keeping only files whose directive is on its own line. That grep matches 18 files. Six only
      mention "use client" in prose: a server route, a contracts registry, and four `src/lib`
      modules. Shared helpers such as `src/lib/resilient-fetch.ts` may also be bundled into client
      code, so 12 is a floor. The round-2 reviewer counted 16 by another method. Regenerate the
      count; do not trust either number.
      **Why this is not fixed in place:** adding a browser `Sentry.init` is a security decision.
      `scrubSentryEvent` in `src/instrumentation.ts` states that a client init re-opens the browser
      channel (breadcrumbs record `location.href`, Replay records the URL bar, so a share token
      leaks). Any client init MUST use `scrubSentryEvent` as `beforeSend`, and Replay URL masking,
      before the channel opens. This is observability, not data integrity, so it gets a booking and
      not a phase.
      **Two candidate fixes:** (a) a client `Sentry.init` whose `beforeSend` and
      `beforeSendTransaction` are `scrubSentryEvent`, with Replay off or URL-masked; or (b) the
      alternative, a tags-only, rate-limited server endpoint that client code posts `{ route,
      stage, code }` to and that captures server-side. (b) never opens a browser channel.
      **Interim rule:** do not add a client `captureToSentry` call on the belief that it reports.
      Put the capture on the server side of the request, as the key memberships route does
      (167.2.1 round-1 fixer C).
      **Trigger:** the next phase that needs a client-side failure to reach Sentry, or any proposal
      to add Session Replay or a browser `Sentry.init`.
      **Owner:** the founder decides between (a) and (b), because (a) is a security decision.
      Unrouted until then.

- [ ] **`[167.2.1-LOCAL-STACK-NO-CROSS-WORKTREE-LOCK]` two worktrees running the local-stack lane at
      once collide on the same containers (booked 2026-09-26, Phase 167.2.1 FACTSHEETBUILDABLE)** —
      `scripts/local-stack/run.sh` reads `PROJECT_ID` from the committed `config.toml`, so every
      checkout on one Docker daemon gets the same `supabase_db_${PROJECT_ID}` container names.
      Nothing in `run.sh` serialises across checkouts. It has a `teardown()` EXIT trap but no lock.
      During Phase 167.2.1, parallel worktree agents collided on it (reported by the orchestrator).
      The failure it allows: one agent's `up` or `down` reuses or tears down a stack another agent is
      still using. CI is not affected, because each CI job has its own runner.
      **Interim convention:** before `up`, take a lock by creating a lock directory with `mkdir`
      (atomic, so it fails if another agent holds it). Wait and retry while it exists. Remove it
      with `rmdir` after `down`. Put the directory at a location every worktree resolves the same
      way, such as the shared Docker host's temp area, and never under a single worktree's
      `STACK_DIR`. A holder that dies leaves the directory behind. A stale lock is cleared by hand,
      and only after checking that no `supabase_db_${PROJECT_ID}` container is running.
      **Fix shape:** move that lock into `run.sh` itself. Take it before `up`, release it in
      `teardown()`, and fail loud with the holder's pid when the lock is held.
      **Trigger:** the next plan or review that dispatches more than one agent to the local-stack
      lane at the same time, or the next collision.
      **Owner:** the owner of the local-stack lane (Phase 164.4.2 SUBSETSPLIT built `run.sh`). Until
      a phase takes it, the orchestrator applies the interim convention when it dispatches.

- [ ] **`[167.2.1-STRATEGIES-PROBE-COST]` `/strategies` runs one heavy buildability probe per
      computed row on every load (booked 2026-09-26, Phase 167.2.1 FACTSHEETBUILDABLE,
      167.2.1-REVIEW WR-01)** — `StrategiesPage` in `src/app/(dashboard)/strategies/page.tsx` calls
      `probeFactsheetBuildable` for each computed row, uncached (D-08). Each probe is the builder's
      resolve stage: a service-role read of the strategy row with its largest JSON columns, plus a
      composite's `csv_daily_returns` read. The list is unpaginated.
      **Bound today:** at most `PROBE_CONCURRENCY` probes run at once (`concurrencyLimiter`), and
      round 2 bounds each probe with a deadline (167.2.1-REVIEW-SFH-R2 N-3). Read both values from
      that file by symbol; they are not restated here.
      **Cost ceiling:** with N computed rows the page does N heavy reads per load. The probe phase
      takes about ceil(N / `PROBE_CONCURRENCY`) probe durations, and at worst ceil(N /
      `PROBE_CONCURRENCY`) times the per-probe deadline. That grows linearly with the owner's
      computed strategies, and it sits on the dashboard landing page.
      **Upgrade path:** read a persisted buildable flag instead of probing. The analytics writer
      would store the resolve stage's verdict next to `computed_at` when a run finishes, and the list
      would read it with its existing embed. That is a migration plus a writer-side change in the
      Python worker, and it must keep D-04's parity (the verdict is the builder's own resolve stage,
      not a second implementation). A column-light resolve is the cheaper intermediate step.
      **Trigger:** a `/strategies` load measured slow, or an owner with more than a few multiples of
      `PROBE_CONCURRENCY` computed strategies, or a pooler-saturation event traced to this page.
      **Owner:** unrouted. The next phase that touches the analytics writer's completion path takes
      it.

- [ ] **[164.6.6.3.6-MT5SERVERLEARN-NEXT-MILESTONE] — learn an MT5 broker server on its first successful validation, instead of hand-listing it (retired from v1.20 2026-10-16).**
  The founder retired Phase 164.6.6.3.6 MT5SERVERLEARN from v1.20 on 2026-10-16: "We will do it in the next milestone (maybe)".
  Nothing shipped. Until then, servers stay hand-listed in `MT5_KNOWN_SERVERS`, using the Step 2d runbook from Phase 164.6.6.3.
  The work done so far is on branch `feat/164.6.6.3.6-mt5serverlearn` (pushed): CONTEXT, RESEARCH, PATTERNS, VALIDATION, BROKER-SERVERS, plan 01 (the criterion-1 gate, a founder-run headless-resolution measurement) and the gate protocol S0-S9.
  The ROADMAP section stays as the spec.
  **Owner / Trigger:** the next milestone's planning, if the founder takes it up. The gate needs the founder's MT5 accounts.

- [ ] **[189-OPTIONREPLAY-NEXT-MILESTONE] — a Deribit key whose option-book replay refuses gets the smoothed option values (retired from v1.20 2026-11-03).**
  The founder moved every open phase that is purely about Deribit or SFOX out of v1.20 on 2026-11-03: "put all open phases that are purely about deribit or sfox into todos and not do them in this milestone".
  Phase 189 OPTIONREPLAY was not planned and nothing shipped. Key C's replay still raises `LedgerValuationError`, so the key stays on the cash basis with the amber caveat, and its three cash-basis days above +50% stay on the book's curve (185 D-10, read again by 185 plan 10 on 2026-11-03).
  The ROADMAP `### Phase 189` section stays as the spec, including the three row shapes the code narrows it to and the read-only worker count that comes first.
  **Owner / Trigger:** the next milestone's planning. The first step needs the founder's approval for each worker run.

- [ ] **[185-BOOK-CUMULATIVE-UNEXPLAINED] — the founder's Deribit book compounds to about x3836 over its history, and valuing options at market did not bring it down (logged 2026-11-03).**
  185 plan 10 (PROD, 2026-11-03, after the 185 deploy): valuing options at market cut the book's days above +50% from 6 to 2. The cumulative did not come down: whole history x3516 to x3836, 2025 x1008 to x999, 2026 x2.07 to x2.09. So cash-basis options are not what drives the multi-year compounding, as the 185-01 debug session already suspected.
  The founder chose a TODOS entry, not a phase (185 D-14, 2026-11-03), under the same day's rule that purely Deribit work leaves v1.20.
  **Owner / Trigger:** the next milestone's planning. Start from the 185-01 debug session and the plan 10 `sc4-book:` and `sc4-report:` lines.

- [ ] **[187-BINANCEINCOME-NEXT-MILESTONE] — Binance futures realized P&L and funding never reach the derive, because the income call uses a method name the pinned ccxt does not have (retired from v1.20 2026-11-03).**
  The founder moved Phase 187 BINANCEINCOME out of v1.20 on 2026-11-03: "put binance into todos". Not planned, nothing shipped.
  It is still true on main: `fapiPrivate_get_income` (realized P&L in `services/exchange.py`, funding in `services/funding_fetch.py`) and `fapiPublic_get_premiumindex` (Binance marks) do not exist on the pinned ccxt. So realized P&L falls back to spot trades with only a DQ flag, a Binance key's derive fails at the funding read, and Binance marks fall back to entry price. The mocks use the same wrong names, which is why the tests pass.
  The ROADMAP `### Phase 187` section stays as the spec: the six success criteria and the full census of mixed-case implicit calls.
  **Owner / Trigger:** the next milestone's planning, or sooner if a Binance key is connected to a published strategy or an allocator book. Data integrity: the fix changes published Binance numbers.

- [ ] **[175-NIGHTLY-MT5-DERIVE-CHECK] — after the 2026-11-04 00:40Z derive, check that every MT5 derive ended clean under the US rule (logged 2026-11-03).**
  Phase 175 closed with only one MT5 key derived under the rule (done on attempt 1, no clock configuration fault). The 2026-11-04 00:40Z nightly is the first run that derives all MT5 keys under it.
  Check that every MT5 `derive_broker_dailies` job is `done` with `attempts=1` and that no `compute_jobs.last_error` carries a clock-configuration text. A job that is `done` with `attempts>1` can hide a fault a retry healed, so `attempts=1` is the test, not `done` alone. Read-only, marker query first.
  **Owner / Trigger:** the first session after 2026-11-04 00:40Z. Not a phase; if a key fails, it is a fix against `analytics-service/services/mt5_server_clock.py` and the worker's rule setting.

- **[192-ORPHANED-LANDING-VERIFY]** (logged 2026-11-07, Phase 192 PUBLICTRUTH; owner: unrouted, founder to assign). The landing verification section, form, results and progress components under `src/components/landing` are rendered nowhere after Phase 192 turned the home verify band into a sign-up link (no non-test importer outside that directory). `VerificationForm.tsx` still carries its false "never stored" line, and `/api/verify-strategy` stays in `PUBLIC_ROUTES` in `src/proxy.ts` with no caller. The public-truth census does not scan this directory for that reason. **Closed when:** the components are deleted together with their registry entries (`closed-sets.test.ts`, `complete-status-scan.test.ts`) and the public allowlist entry, or reused behind sign-in.

- **[192-SFOX-FLAG-SPLIT]** (logged 2026-11-07, Phase 192 PUBLICTRUTH; owner: unrouted). `EXCHANGES` follows `NEXT_PUBLIC_SFOX_ENABLED` while /security's sFOX guide follows `SFOX_ENABLED` (server), and the static security packet's exchange list is pinned under default flags only, so flipping one flag leaves the three public lists disagreeing. **Closed when:** one flag drives all three, or flipping either regenerates the packet and its parity test.

- **[195-DEMO-PDF-SECRET-REMOVAL]** (logged 2026-11-07, Phase 195 TRIM, 195-01-SUMMARY; owner: the founder; trigger: any time, no code depends on it). `DEMO_PDF_SECRET` is read nowhere since Phase 195 deleted `src/lib/pdf-render-token.ts` and its `.env.example` entry, but it is still set in Vercel and in GitHub secrets. **Closed when:** the founder has removed it from every Vercel environment and from the GitHub repository secrets.

## Phase 164.9 (TESTISOLATION) — ids booked at planning time (logged 2026-09-21)

- [ ] **`[164.9-LIVEDB-LANE-EXECUTION-CENSUS]` seven live-DB lane tests still fail and are carried in `scripts/live-db-execution-ledger.txt` (booked 2026-09-21, Phase 164.9 TESTISOLATION plan 08).**
      **Still open (re-measured 2026-11-14):** the ledger's `ENTRY_COUNT` is 7. Six are in
      `src/__tests__/wizard-rpcs-live-db.test.ts` and fail with 42501 from the FUNCTION BODY's own role
      gate, not from an EXECUTE denial (the baseline carries the REVOKE/GRANT pair), so a baseline
      re-dump will not close them: they need a migration-or-invariant decision. One is
      `src/__tests__/sanitize-user-rpc.test.ts` (the `sanitize_user` auth-session purge arm), which fails
      because the schema-only baseline does not carry the privilege state. This entry also absorbs
      `[164.9-BASELINE-PRIVILEGES-ABSENT]`, which carried the same seven. ⛔ Not closed by weakening an
      assertion, skipping the arms or growing the ledger. **Closed when:** the ledger is empty.

- [ ] **`[164.9-DATA-DEPENDENT-GUARD-CENSUS]` 83 anonymous-block guards across 63 applied
      migrations raise on data TEST does not have — the class is now REFUSED at author time, and
      the EXISTING corpus is censused rather than repaired (booked 2026-09-21, Phase 164.9
      TESTISOLATION plan 09)** — MEASURED by `node scripts/lint-migration-data-dependence.mjs`
      over `supabase/migrations` at that date: **272 migration(s), 345 anonymous block(s), 83
      refusal(s) across 63 files**, seeded verbatim into the dated shrink-only ledger
      `scripts/lint-migration-data-dependence-baseline.txt`. Regenerate rather than trust these
      figures; the run prints them.
      **WHY IT EXISTS, and it is the other half of `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`.**
      That entry asked for a MECHANISM and plan 09 built one: a hermetic refusal in
      `sql-gate-lint` that fires on the pull request, with no opt-out marker, so a NEW guard of
      this shape cannot merge. It deliberately did NOT touch the 79 that already merged —
      repairing an APPLIED migration re-enters the apply pipeline and is a separate act with its
      own review posture. This entry owns those 79.
      ⚠️ **THE CENSUS IS NOT A TRIAGE, and the ledger's own header says so.** The scan refuses a
      SHAPE. Some instances are benign on a data-empty TEST because the block SEEDS the row it
      then reads back — a self-verifying probe (`20260416201929_audit_log_hardening.sql` is the
      clearest specimen) rather than a precondition on production rows — and a static scan cannot
      tell those from a genuine precondition without executing them. The owed work is a
      per-entry decision: benign (delete the line), or repair the guard.
      **TRIGGER — the condition that says this has come due, stated so a human recognises it
      under pressure:** `apply-test` RED on a `RAISE` from a data-reading `DO` block **while
      PROD's `plan` dry-run is CLEAN**, inherited verbatim from the parent entry. That divergence
      is the signature; red on BOTH sides is an ordinary bad migration and is not this.
      **INTERIM REMEDY — revert the merge.** ⛔ NOT an edit to
      `.github/workflows/supabase-migrate.yml`. A failed TEST apply blocking the PROD apply is a
      LOCKED decision, and editing the pipeline under deploy pressure to get a deploy out is
      precisely the failure mode this family exists to prevent.
      ⛔ **Forbidden closures:** relaxing the classifier; widening the ledger; adding an opt-out
      marker to the linter (the escape hatch Phase 164.8 specified and deliberately did not
      build, because a hatch is something a person must remember to claim); and deleting a ledger
      line for any reason other than the scan no longer refusing it.
      **Owner:** Phase 164.9 TESTISOLATION built the refusal. ⚠️ The REPAIR of the 83 needs a
      named successor phase booked via `/gsd-phase --edit` — recorded here rather than left
      blank, and surfaced in `164.9-09-SUMMARY.md` as a routed deferral for that booking.

- [ ] **`[164.8-TEST-DATA-RESEEDED]` The restore destroyed every row in shared TEST's `public`
      schema and that is NOT reversible; what TEST holds now is whatever CI has written since
      (booked 2026-09-09, Phase 164.8 plan 04, recorded there as W6).**
      **WHAT WAS LOST.** Restore run `34274355596`, head `88581b8bc66415bfa86b7d5a019741b1cbd0ff49`
      dropped and rebuilt `public` from `supabase/schema/baseline.sql`, which `BASELINE.md`
      records as "schema only, **0 data statements**". Every `public` table therefore came back
      EMPTY. The backup artifact (`test-restore-backup-34274355596`, 90-day retention) holds the
      old ledger byte-exact and the old SCHEMA — **it does not hold the old rows**, so this is a
      one-way door by construction and not by oversight.
      **WHAT RE-CREATED WHAT, read off the first `main` CI run after the restore PR (#764) rather
      than predicted** — run **`34329426898`**, head **`a622df279dcdf4fe6f58d39f990eeaa008aaed99`**:
      `e2e-seeded` **success**, `e2e` **success**, `python` **success**. The seed path is
      `SEED_CONFIRM_STAGING=true npx tsx scripts/seed-demo-data.ts`, which re-populates the
      8-strategy demo set the seed-gated Playwright specs require, inside the held mutex and
      before the test-env build.
      ✅ **NO spec failed for a missing pre-existing row.** That is the measurement this entry
      was opened to record, and it came back clean: nothing was re-seeded by hand, and nothing
      needs to be. The only red on that run was `sql-tests` on
      `test_commit_scenario_batch_p1956_range.sql` Test 5 — a stale CONSTRAINT assertion the
      restore revealed, not a missing row — fixed in PR #765 (`b8951132`).
      ⚠️ **WHY THIS STAYS OPEN ANYWAY.** A green run proves the seeded set is sufficient for the
      specs that ran; it does not establish a CONTRACT. Nothing today states what a run may
      assume about TEST's rows, so the next spec that quietly depends on a row it did not create
      will fail at the next restore rather than at review. ⚠️ Note also that PR #767
      (Phase 164.8.1 REFDATA) landed AFTER this restore: a FUTURE restore replays allowlisted
      migration-seeded reference data, so "every public table comes back empty" describes the
      2026-09-08 restore and will not describe the next one.
      ✅ **Destination: Phase 164.9 TESTISOLATION** — the per-run seed contract. "Whose rows is a
      run asserting about" and "which rows may a run assume exist" are one question.
      ⚠️ **ROUTING NOTE (2026-09-21, Phase 164.9 planning):** this entry names Phase 164.9
      TESTISOLATION as its destination, but Phase 164.9's `ROADMAP.md` `**Requirements**` line
      does not cite `[164.8-TEST-DATA-RESEEDED]`. Phase 164.9's plan 01 did NOT claim this entry
      and leaves the routing discrepancy for a decision — its destination, disposition and scope
      are unchanged by this note.

- [x] **`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` A migration that is VALID on PROD can REFUSE on
      TEST because TEST has PROD's catalogue and none of its rows — and under the locked Area 1
      Q2 rule that refusal BLOCKS the production deploy. There is no escape hatch (booked
      2026-09-09, Phase 164.8 plan-checker finding B4).**
      ✅ **CLOSED by Phase 164.9 TESTISOLATION** (recorded 2026-11-14, TODOS sweep 2):
      `scripts/lint-migration-data-dependence.mjs` refuses a data-reading `DO`-block guard at author
      time, with no opt-out marker, and the 83 applied ones are carried by
      `[164.9-DATA-DEPENDENT-GUARD-CENSUS]`. Kept only because that open entry inherits from this one.
      **WHY IT EXISTS.** TEST was restored from a SCHEMA-ONLY dump (`BASELINE.md`: **0 data
      statements**), so it reproduces PROD's CATALOGUE and never its ROWS. This repo's house
      style for a migration precondition is a data-reading `DO` block that `RAISE EXCEPTION`s on
      an unexpected count — `supabase/migrations/20260907130000_ledger_refresh_switch_to_system_flags.sql:925-935`
      is the specimen (`SELECT enabled INTO v_seeded …` then `RAISE EXCEPTION`). Such a migration
      reads a PROD-populated table, applies cleanly to PROD, and refuses on TEST.
      ⛔ **Area 3's `TEST-NOT-APPLICABLE` header pragma was the declared escape hatch and was NOT BUILT**
      — deliberately, because it has no consumer today (see the closed
      `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]` for the full two-part verdict).
      **TRIGGER — the condition that says this entry has come due, stated so a human recognises
      it under pressure:** `apply-test-verdict` reports **failure cause (3)** — `apply-test` RED
      on a `RAISE` from a data-reading `DO` block — **while PROD's `plan` dry-run is CLEAN**. That
      divergence is the signature; a failure that is red on BOTH sides is an ordinary bad
      migration and is not this.
      **INTERIM REMEDY — revert the merge.** ⛔ NOT an edit to `.github/workflows/supabase-migrate.yml`.
      Area 1 Q2 (a failed TEST apply blocks the PROD apply) is LOCKED, and editing the pipeline
      under deploy pressure to get a deploy out is precisely the failure mode this entry exists to
      prevent. Reverting restores a known state and costs one merge.
      **CANDIDATE SHAPES — decide in the destination phase, not by inertia:**
      (i) the retired `-- TEST-NOT-APPLICABLE: <reason>` header pragma, parsed by ONE piece of
      code that BOTH `apply-test` and VAC-08 read (two switches drift, and the apply would then
      abort on exactly the migrations VAC-08 was told to forgive), shipped with the THREE-arm
      proof 164.8 `CONTEXT.md` Area 3 specifies — RED for an unpragma'd genuine absence, GREEN for
      the pragma'd migration, **RED for a pragma whose stated reason is FALSE**; arm 3 is what
      stops a pragma becoming a mute button; or
      (ii) a per-run SEED CONTRACT that makes the read valid on TEST, so the migration never
      needs forgiving.
      ✅ **Destination: Phase 164.9 TESTISOLATION.** That phase's goal is what a run may assume
      about TEST's rows ("the restore changes what a clean starting state even means"), and a
      data-reading migration refusing on TEST is exactly a claim about what TEST's rows are.
      ⛔ **Phase 164.10 BODYDRIFT was checked and REJECTED as the home** — it is three PROD
      function BODIES and carries no data-contract scope. Recorded so the rejection is not
      re-litigated.
      ⭐ This entry has an OWNER, a TRIGGER and a PHASE because a TODOS line alone has none of the
      three (founder rule 2026-09-08).

### FANOUT-COHORT-PRIVATE-01 — the ledger-refresh fan-out enqueues NOTHING because every PROD strategy is `private` (booked 2026-09-17)

**Measured 2026-09-17 on PROD, on the FIRST tick after Phase 164.5.1 activated the fan-out.**
`cron.job_run_details` runid `11159`, jobid 40, `08:25:00.371Z`, `succeeded`. The job ran, was NOT
dormant, ran to candidate selection and selected **ZERO** strategies: no `derive_broker_dailies`
row in `compute_jobs`, and `ledger_refresh_staleness` byte-identical to the BEFORE census (6
strategies, `min 23 / avg 52.50 / max 141` days).

⚠️ **`return_message: "1 row"` is not "one job enqueued"** — the function returns an INTEGER and
`SELECT f()` always returns one row. This is the SAME reading error as CRON-DRIFT-01 below, whose
own record already says `succeeded / '1 row'` while six consecutive ticks were 401ing. Second
instance of one class, five weeks apart.

**Cause, per strategy:** `cooldown_jobs = 0` and `inflight = 0` for all six — neither the 20-hour
attempt cooldown nor the in-flight guard excludes anything. The single binding conjunct is
`s.status IN ('published','pending_review')` in `enqueue_ledger_refresh_for_strategies()`
(`supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql`), and every
production strategy carries `status = 'private'` — an owner-only terminal status added by
`20260716130000_strategies_status_private.sql` (CONTRIB-02, Phase 110) for allocator-contributed
strategies, which are real live strategies with real keys and real ledgers.
`ledger_refresh_staleness` does not filter on `status`, so **the view and the fan-out disagree
about the cohort totally: 6 stale rows, 0 eligible.** The string `private` appears **0 times** in
both migrations — never considered, not considered and rejected. The pair mirrors
`ALLOWED_STRATEGY_STATUSES` (`analytics-service/routers/cron.py:148` =
`{draft, pending_review, published}`), never widened when `private` shipped in July 2026; the
sibling fan-out `20260412094449:239` carries the same pair.

⛔ **BLOCKS `T-164.5.1-09-07`** — the all-candidates-failed branch cannot be exercised while the
candidate set is empty for an unrelated reason, so `164.5.1-VERIFICATION.md` cannot report
`passed` and `WINDOWS.md` entry 60 cannot close.

Founder decision 2026-09-17: admit `private`, as one forward migration behind the three reviewers.
Owner: **Phase 164.5.1.1 FANOUTCOHORT.**

⭐ **LEDGER ARM HALF-CLOSED 2026-09-17 by Phase 164.5.1.1 FANOUTCOHORT (plans 01-03).** Shipped:
the forward migration `20260917120000_ledger_fanout_admit_private.sql` (one executable edit — the
single-key fan-out's lifecycle conjunct gains the owner-only terminal status — plus the
regenerated canonical snapshot); **two** new `test_ledger_refresh_fanout.sql` gate arms, both
neuter-verified with the mutation confirmed APPLIED before its red was accepted — arm **P**, the
first arm in this corpus ever to promote a fixture to that status and prove it IS enqueued, and
arm **Q**, which derives the lifecycle DOMAIN from `pg_get_constraintdef` and the ADMITTED set
from a comment-stripped `pg_get_functiondef` so the pair cannot silently diverge again; and
`ARMS_FLOOR` raised **392 → 394** with the three coupled pins in
`src/__tests__/mutation-runner-floors.test.ts`, read off the runner's own printed biting count.

✅ **CLOSED 2026-09-20 by Phase 164.5.1.1 plan 04, on the NATURAL tick.** The paragraph that stood
here said *"THE ENTRY IS NOT CLOSED, and the BLOCKS clause above is NOT lifted"*, and it was correct
when written: the migration was written and unapplied, and the block lifted only when the fan-out's
natural `25 * * * *` tick was measured selecting a non-empty candidate set against the BEFORE
census. That measurement has now been taken.

**The reading that closes it — tick `11231`, jobid 40, 2026-09-17 17:25:00.229704Z, `succeeded`.**
TWO `derive_broker_dailies` rows in `compute_jobs`, created on the tick's own millisecond, both
completed, no `last_error`; stale census **6 → 4**, avg days 52.50 → 56.75. ⭐ The average RISING is
the tell: the two freshest rows left the set and the older ones remain. A FALLING average would have
been the suspicious reading. ⛔ `return_message: "1 row"` proves nothing and is not cited here — the
function returns INTEGER and `SELECT f()` always returns one row, the same misreading this entry
already warned about twice. The verdict lives in `compute_jobs`, and that is where it was taken.
Recorded in `164.5.1.1-PROD-SESSION.md` § B.

⚠️ **The `T-164.5.1-09-07` clause closes by SUBSTITUTION, and the distinction is load-bearing.**
The all-candidates-failed branch was NEVER exercised — the tick's two jobs both SUCCEEDED, so the
branch stayed unreached. What closed the risk is **mutation-gate arm R** in
`supabase/tests/test_ledger_refresh_fanout.sql`, merged as PR #810 during Phase **164.5.1's** own
closure — a different phase and a different mechanism from the one plan 04 specified. ⭐ A permanent
gate is arguably stronger than a one-off exercise, since it re-proves the branch every run rather
than once; `164.5.1-SECURITY.md` recorded it as a disclosed substitution at `medium`, below the
blocking threshold, and the founder accepted it for this truth. ⛔ It is NOT compliance with plan
04's literal mechanism and must never be cited as though it were.

⚠️ **One item is disclosed rather than closed:** plan 04 task 3's session record (§ B) carries no
database-marker output of its own. Measured: **§ B performed no writes** — it observed a tick that
fired on its own schedule and then read three tables — and the marker rule is scoped to statements
that write, with § A (the apply, which did write) carrying its marker. So the miss is against the
plan's literal acceptance criterion with zero safety consequence. It is surfaced for a founder
decision, not graded away. See `164.5.1.1-PROD-SESSION.md` § C-3.
⛔ And it did NOT fix the 141-day composite — see `FANOUT-COHORT-SIBLING-COMPOSITE-01` immediately
below, which carries the measurement and the destination for that decision.

### FANOUT-COHORT-SIBLING-COMPOSITE-01 — the composite fan-out carries the SAME lifecycle literal, and has no schedule at all (booked 2026-09-17)

**Measured 2026-09-17** by Phase 164.5.1.1 plan 03, from the canonical bodies under
`supabase/schema/functions/` — the replayed current definitions, which is the right place to ask
this question, because a migration-by-migration search answers a different one and can be fooled by
a later redefinition. `enqueue_ledger_composite_refresh` carries the two-value lifecycle conjunct at
`supabase/schema/functions/enqueue_ledger_composite_refresh.sql:266`, identical to the one
Phase 164.5.1.1 widened in the single-key fan-out and left alone here.

⛔ **THREE OF THAT PHASE'S OWN RESEARCH ARTIFACTS SAY OTHERWISE AND ARE WRONG.**
`164.5.1.1-RESEARCH.md` and `164.5.1.1-PATTERNS.md` both assert the composite function "has no
status conjunct at all", and all three of RESEARCH / PATTERNS / VALIDATION then instruct that
`supabase/tests/test_ledger_refresh_composite_arm.sql`'s foreign-candidate precondition be widened
in lockstep. The premise is false — the researcher read a partial line range — so the instruction is
refused, and the refusal is now written into the gate file itself beside the literal it protects.
**Widening that guard ALONE would be a false abort, not a tighter gate:** it would abort the file on
a committed row the guarded function would itself refuse to enqueue, on a SHARED test project,
surfacing in a file that has nothing to do with the cause. ⛔ Do not re-derive that instruction from
those three documents.

**What a user observes today: NOTHING, and that is the finding.** The function is not scheduled and
is not called. Zero matching rows in the captured production cron manifest
(`scripts/prod-prober/cron-manifest.json`, captured `2026-09-17T08:05:56Z` against the PROD
database marker), no caller anywhere in `analytics-service/` or `src/`, and
`20260825140000_ledger_refresh_composite_arm.sql` applied it DORMANT in its own `RAISE NOTICE`
(*"no schedule registered"*). So widening this conjunct on its own would change nothing observable,
and the absent schedule is the larger question.

⛔ **THE 141-DAY COMPOSITE IS NOT FIXED BY PHASE 164.5.1.1, AND MUST NEVER BE REPORTED AS SUCH**
(CTX-10, founder-locked). The oldest factsheet in the 2026-09-17 census is excluded from the
SINGLE-KEY fan-out by that function's `is_composite` conjunct — D-01, by name and by design — and
from the composite fan-out by the absence of any schedule. **Reversing D-01 is a separate decision
with its own evidence, and it must be taken deliberately rather than arrive as a side effect of a
literal edit.** That is precisely the class of silent side effect Phase 164.5.1.1 existed to clean up.

**TRIGGER — the condition that says this entry has come due:** anyone proposes to widen the
composite conjunct, to register a schedule for the composite fan-out, or to "complete" the widening
in `test_ledger_refresh_composite_arm.sql`. Any one of the three pulls in the other two and pulls in
D-01; none of them is a one-line change.
✅ **Destination: Phase 164.5.1.2 FANOUTSIBLINGS** — inserted into the ROADMAP 2026-09-17 directly
after 164.5.1.1, with this measurement in its goal. Owner: that phase.
⭐ This entry has an OWNER, a TRIGGER and a PHASE because a TODOS line alone has none of the three
(founder rule 2026-09-08).

⛔ **DESTINATION CORRECTION — 2026-09-19, at Phase 164.5.1.2's close.** The Destination line above
is now STALE and this note supersedes it: **Phase 164.5.1.2 closed WITHOUT addressing this entry,
deliberately and on the record.** The founder descoped the composite site at that phase's CONTEXT
time (D-01, 2026-09-17) — `enqueue_ledger_composite_refresh` is NOT SCHEDULED, is called by
nothing, and no user observes it — so 164.5.1.2's success criteria covered TWO sites by design, the
single-key poll and the trade-sync constant, and never this third one. Nothing here was measured and
left undone; it was ruled out of scope before any plan was written.

⛔ **THIS ENTRY DELIBERATELY HAS NO OWNER PHASE, AND THAT IS THE DECISION — NOT AN OVERSIGHT.**
Re-pointing it at a live phase would fabricate scheduled work for a fan-out nobody has scheduled and
no user can see, which is the opposite of what the descope decided. It stays **TRIGGER-GATED**: the
TRIGGER stated above is the sole thing that activates it, and any one of those three proposals pulls
in the other two and pulls in D-01. ⭐ The founder rule that every deferral names an owner phase is
answered here by an explicit standing decision rather than by a phase number — recorded so a future
reader finds a reasoned "no owner, by design", not a dangling pointer at a finished phase.
⚠️ Nothing about the 141-day composite factsheet changed; the CTX-10 prohibition above stands in
full and is not weakened by this note.

### FANOUT-COHORT-SIBLING-POLL-01 — the April poll-positions fan-out carries the same literal, IS live, and is excluded twice over (booked 2026-09-17)

**Still open.** `enqueue_poll_positions_for_all_strategies`
(`supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql`) admits only `published` and
`pending_review` strategies and also requires a `sync_trades` job done in the last 30 days; the Railway
worker's `daily_enqueue_tick` calls it once per UTC day. So no `private` strategy has ever had a position
snapshot, while every `published` one is current (PROD measurement, `164.5.1.2-CONTEXT.md` D-02). Phase
164.5.1.2 refused to widen the lifecycle conjunct alone because the second conjunct excluded the same
strategies; `/cron-sync` has since admitted `private` (#830), so re-measure the second conjunct first.
**Trigger:** anyone proposing to widen either conjunct; decide both together, with a fresh measurement.

### SYNC-DRIFT-PAYLOAD-LOGGED-VERBATIM-01 — the contract-drift log renders the unknown RPC return verbatim with `%r` (booked 2026-09-19)

**Found by the Phase 164.5.1.2 security audit**, outside that phase's 13 registered threats, so it
did not affect `threats_open` and did not block the ship. Recorded here rather than closed by silence.

In `analytics-service/routers/cron.py::_sync_single_key`, the "unexpected shape" `logger.error` on
the `sync_trades` contract-drift path renders the drifted return value with `%r`. ⚠️ **Phase
164.5.1.2 edited that message TWICE without touching the payload argument** — the value is still
logged verbatim.

**Why it is LATENT and not live:** `sync_trades` is declared `RETURNS INTEGER` at the SQL level, so
the drift branch is unreachable today, and the destination is an internal log (Railway / Sentry),
NOT the public repo. A drift that returned a structured row set rather than an unexpected scalar
would put that payload in the log. ⛔ This is why it is booked rather than dismissed: the branch
exists precisely to handle shapes nobody enumerated.

⛔ **NOT a one-line `%r` deletion, and that is the whole reason it needs a phase rather than a
drive-by fix.** The `%r` is the only diagnostic an operator gets when drift actually fires; removing
it outright trades an information-disclosure risk for a debuggability hole and would leave the next
operator with a type name and nothing else. ⭐ The shape that satisfies both is BOUNDED rendering —
the type name plus a length-capped, structure-aware excerpt — and choosing that cap is a design
decision, not a patch. ⚠️ Note the operator-facing signal is ALREADY safe: the `strategy_errors`
value this phase added is type-name-only (`ContractDrift: sync_trades returned <type>`), so the
`%r` is redundant for classification and matters only for diagnosis.

**TRIGGER — the condition that says this entry has come due:** anyone changes `sync_trades`'s
declared return type away from `INTEGER`, or the drift branch is observed firing in production.
Either makes the latent path live.
✅ **Destination: Phase 164.5.1.4 SYNCCURSOR** — it reworks this exact drift-and-cursor path, so the
bounded-rendering decision belongs with the work that is already reading these lines. Owner: that phase.
⭐ This entry has an OWNER, a TRIGGER and a PHASE because a TODOS line alone has none of the three
(founder rule 2026-09-08).

### FANOUT-FAILBRANCH-UNEXERCISED-01 / 164.5.1-TODOS-DISPOSITION-OWED — the two items Phase 164.5.1 leaves open (booked 2026-09-17)

Both come out of Phase 164.5.1's verification and its plan-09 security re-audit. Both existed
ONLY as prose inside `.planning/` until this entry, which is exactly the `FANOUT-GLOBAL-01`
failure mode this milestone already records: an item with no `TODOS.md` id has no owner, no
trigger and no phase.
⛔ (2026-09-21: `FANOUT-GLOBAL-01` now has its own entry in this file's `## 🟡 FIX MID-TERM`
section — this citation is retro-linked to it.)

- [ ] **`[FANOUT-FAILBRANCH-UNEXERCISED-01]` The ledger fan-out's all-candidates-failed branch
      has still never run in PRODUCTION. It is gated, not exercised — and those are not the
      same claim.**
      Threat `T-164.5.1-09-07` (DoS, `medium`) in `164.5.1-SECURITY.md`. Its mitigation plan
      said the branch "becomes reachable AT activation and is exercised DELIBERATELY with the
      result recorded". ⛔ **The live exercise did NOT happen**, and the reason is worth keeping:
      at activation the candidate set was EMPTY for an unrelated reason — the cohort mismatch
      booked as `FANOUT-COHORT-PRIVATE-01` above, every PROD strategy carrying `status='private'`.
      So there was nothing to fail.
      **What exists instead, and it is a disclosed SUBSTITUTION, not compliance:** "arm R" in
      `supabase/tests/test_ledger_refresh_fanout.sql` — a permanent, `RED-UNDER-M`
      mutation-calibrated gate that poisons every candidate, asserts zero enqueued, asserts a
      **ZERO DELTA over `pg_locks`** for the backend, and asserts the next tick still enqueues.
      ⭐ The `pg_locks` delta is the load-bearing part: `pg_try_advisory_lock` is SESSION-level and
      RE-ENTRANT, so re-taking the lock in the same session proves NOTHING about whether it
      leaked. Merged `9c6e53ce` (PR #810), 27 checks green.
      ⚖️ **A standing regression gate is the STRONGER control** — it runs on every corpus run,
      forever, where a one-off live exercise runs once. But it is not what the plan's text
      promised, and `164.5.1.1-PROD-SESSION.md` § B says so itself: *"unblocked, NOT yet
      exercised — do not record it as met"*. This entry exists so that sentence does not quietly
      become "met" by age.
      **Trigger:** a genuine candidate failure occurring naturally on PROD, OR a deliberate
      constructed-candidate exercise once the cohort is widened.
      **Owner / destination: Phase 164.5.1.2 FANOUTSIBLINGS** — it is the phase that decides the
      cohort question, and a widened cohort is the precondition for a real candidate to fail.
      ⛔ It does NOT block: `medium` is below `workflow.security_block_on` (`high`), so
      `threats_open` stays 0 and this never gated the ship.

- [ ] **`[164.5.1-TODOS-DISPOSITION-OWED]` Six entries this phase substantively resolved are
      still unchecked here, and a SUMMARY claims otherwise.**
      `164.5.1-09-SUMMARY.md` lists `TODOS.md` under "Files Created/Modified" and states
      `[VAULTTICK-EMPTYKEY-01]` and `[CRON-DRIFT-01]`'s live-row half were "dispositioned from
      the recorded outputs". **MEASURED and FALSE:** `git show <commit> -- TODOS.md` on all three
      plan-09 task commits (`2ca23014`, `f429067d`, `2ffb0b6c`) AND on the squash-merge
      (`d6607a88`) returns an EMPTY diff in every case. Found independently three times — by
      `gsd-verifier`, by `gsd-security-auditor`, and by the orchestrator re-running it rather
      than accepting either.
      **The six, all still `- [ ]` at HEAD with contradicting prose** (`VAULTTICK-EMPTYKEY-01`
      still reads "STILL OPEN 2026-09-12"): `CRON-DRIFT-01` (live-row half only — the DETECT half
      is Phase 164.1's), `VAULTTICK-EMPTYKEY-01`, `164.7-ACTIVATION-DEFERRED`,
      `164.7-VAULT-ABSENT-RULE`, `164.8.5-MANIFEST-SIDE-LOOP-DEAD`,
      `164.5.1-GATEWAY-CEILING-INVERSION`.
      ⭐ **The evidence to close all six already exists** in `164.5.1-PROD-SESSION.md` — this is
      transcription, not investigation.
      ⛔ **Classified non-blocking, and the reasoning is stated rather than assumed.** It shares
      `T-164.5.1-09-04`'s Repudiation *shape* — a claimed act with no supporting evidence — but
      neither its mechanism nor its artifact: the production evidentiary trail in
      `164.5.1-PROD-SESSION.md` is genuinely OUTPUT-based throughout and is untouched by this.
      Backlog bookkeeping is neither data-integrity nor user-facing, which is the class this repo
      scopes below the blocking threshold.
      ⚠️ **Why it was not just done inline:** `TODOS.md` is a NON-PLANNING path, so any commit
      touching it pulls a VERSION bump and a CHANGELOG entry with it. That coupling is why the
      disposition was deferred once already; it deserves its own commit rather than a fold-in.
      **Trigger:** the next deliberate `TODOS.md` pass. **Owner: Phase 164.1**, the next phase in
      the agreed order and itself the owner of `CRON-DRIFT-01`'s DETECT half.

### CRON-DRIFT-01 / CRON-OBS-01 — a PROD cron job 401'd hourly for 7 DAYS behind a green cron history (booked 2026-09-01)

**Measured 2026-09-01, live in PROD.** Sentry `QUANTALYZE-18` (169 events, escalating, first seen
2026-08-25T12:49Z) was `config_secret: SERVICE_KEY / config_fault: mismatched` from
`analytics-service/main.py:833`. `net._http_response` ids 3479-3484 showed six consecutive hourly
`401 {"detail":"Unauthorized"}` — while `cron.job_run_details` recorded `succeeded / '1 row'` for
every one of those ticks.

**Root cause.** A Railway `SERVICE_KEY` rotation on 2026-08-25 12:46. Someone created the Vault
secret `analytics_service_key`, described it verbatim as "X-Service-Key for match_engine_cron
(cron.job jobid 1)", and never re-pointed jobid 1 at it. The job kept an INLINE copy of the old
key. First 401 landed 12:49:29 — three minutes after the vault write. Fixed 2026-09-01 by
re-scheduling jobid 1 onto a `DO` block that reads `vault.decrypted_secrets`; verified id 3485
`200 {"status":"ok","processed":14,"skipped":0,"failed":0}`.

Two gaps remain, and neither is closed by that fix:

- **[CRON-DRIFT-01] Nothing compares PROD `cron.job` against the repo's migrations.** PROD jobid 1
  carried a hardcoded `url := 'https://…'` plus an inline key, while
  `supabase/migrations/20260408215026_schedule_match_cron_hourly.sql:70-76` had rebuilt it on
  `current_setting(...)` explicitly so "the secret never lands in `cron.job.command`". That rebuild
  never took effect and nothing noticed for months. This is `VAC-04`'s shape (repo-vs-PROD function
  body diff, shipped in v0.77.0.0) applied to `cron.job` — which has no equivalent.
  ⚠️ **The GUC design in that migration is UNRUNNABLE on Supabase anyway**: `ALTER DATABASE … SET
  app.analytics_service_key` returns `42501 permission denied to set parameter` because a custom
  PLACEHOLDER GUC needs superuser and the `postgres` role is not one. So the migration as committed
  could never have worked here. Any gate must compare against what is ACHIEVABLE, not just what the
  migration says. Vault is the working mechanism.

- **[CRON-OBS-01] Nothing watches `net._http_response`.** `net.http_post` is ASYNC: pg_cron logs
  success for ENQUEUING and never sees the status code. Every other alarm is structurally blind
  here — `/health` stays green (`SERVICE_KEY` skips `/health`, `/internal/*`, `/process-key`), and a
  4xx never trips the 140.2 breaker. The PYAPI-06 Sentry capture was the ONLY instrument that
  spoke, and it fires only for a NON-EMPTY wrong key (`if provided:` at `main.py:830`) — an absent
  header would have been silent too. Needs a periodic check that fails loud on non-2xx in
  `net._http_response`, counted and surfaced (⚠️ not a silent skip — that is `SKIP-01`).

➡️ **ROUTED 2026-09-01 to Phase 164.1 (HARDEN-GUARDS — renamed PROD-OBSERVABILITY in the 2026-09-05 re-partition; the gate-hygiene half moved to 164.5/164.6).** That phase already owns this class — its
title names the PYAPI-06 blind spot that let a production service-key mismatch run silently. NOT
164.3/164.3.1: those own gate integrity (a control that cannot fail), this is production
observability (a service down while every instrument reads green). ⭐ `CRON-OBS-01` and
`MT5-WEDGE-OBS-01` are ONE mechanism with two targets — a periodic prober that fails loud — and
are to be planned as one slice, not two.

⭐ **SHIPPED in Phase 164.1 (2026-09-06, PR #746, v0.77.14.0) — the DETECT half of both.**
`CRON-OBS-01` is the `cron-obs` arm: it joins `cron.job_run_details` to `net._http_response`
and reports `cron-non-2xx`, `cron-no-observation` and `cron-transport-error`, so an async
pg_net result can no longer hide behind a green cron history. It also carries an ATTRIBUTION
FENCE (review WR-01): the join is time-only because `net._http_response` has no jobid, so a run
with more than one response in its window is `measure-fail`, never a verdict — a foreign 200
must not buy a pass for our own missing answer.
`CRON-DRIFT-01` is the `cron-drift` arm, comparing live `cron.job` against the committed
`scripts/prod-prober/cron-manifest.json` with ten secret-hygiene rules, each carrying a RED
fixture proving it fires. The manifest was captured from PROD (run 34018613991) and every one
of its 14 `command` strings was read individually and approved for publication by the founder.
⛔ The REPAIR half of CRON-DRIFT-01 is NOT shipped and stays open below — it belongs to Phase
164.5 item (7). The capture CONFIRMED the drift it describes: live jobid 1 runs a Vault-backed
`DO` block, while migration `20260408215026` still schedules it on
`current_setting('app.analytics_service_key')`, which returns 42501 on this platform. Both arms
read GREEN on live run 34018874984.

⭐ **DATED 2026-09-07 (Phase 164.7 APPSETTINGS) — the GUC half of `CRON-DRIFT-01` is CLOSED; the
LIVE-ROW half stays open for Phase 164.5 item (7).** Phase 164.5 item 7 was SPLIT OUT to
Phase 164.5.1 CRONREPOINT on 2026-09-07 by founder decision — not renamed, not dropped. What
164.7 closed: the repo now DESCRIBES the
mechanism PROD has been running since the 2026-09-01 hand repair — `public.match_engine_cron_tick()`
in `20260907120000_analytics_service_settings_and_vault_tick.sql`, key from `vault.decrypted_secrets`,
URL from `public.system_settings`, a loud `RAISE` on either absence — so a rebuild from migrations
no longer reproduces an unrunnable job, and `20260408113029` / `20260408215026` carry dated
`-- APP-GUC-LINEAGE:` headers naming that successor. A CI gate (`scripts/lint-app-guc.mjs`, wired
into `sql-gate-lint`) now fails any NEW app-GUC reader written into `supabase/migrations/**`.
⛔ What is NOT closed: the live `cron.job` row still runs the hand-written `DO` block rather than
the callable, so repo and PROD agree in MECHANISM but not in TEXT. Repointing it is 164.5 item (7)
— and see the `164.7-VAULT-ABSENT-RULE` entry above (named without its brackets on purpose: the
bracketed form is the entry's unique key and a cross-reference must not create a second one),
because the repoint trips the `vault-absent` hygiene rule unless the rule, the manifest and the
row move in the same change.

⛔ **FLAGGED 2026-09-16 (Phase 164.5.1 plan 08, D1) — the old repoint convention is SUPERSEDED, not
merely superseded implicitly.** Phase 164.5 item 7's old wording — *"Write ONE forward migration
re-scheduling `match_engine_cron` to the achievable Vault-backed command"* — is REPLACED by D1: the
repoint registration lives in the RUNBOOK (`docs/runbooks/match-engine.md` § "Go-live: repoint
`match_engine_cron` + ledger-refresh activation"), never in a migration. The old wording is not
deleted anywhere it survives as lineage; this is an additive flag so both ledgers agree rather than
disagreeing silently.

⭐ **Standing rule until CRON-OBS-01 lands: `cron.job_run_details.status = 'succeeded'` is NOT
evidence that a pg_net-based job worked.** Read `net._http_response`.

- [ ] **[MT5-VERDICT-SINK-01] the MT5 capability verdict has NO durable sink, so an `undetermined` outcome is unverifiable the moment it scrolls out of the log** (booked 2026-09-05) — `_Mt5ValidateTrace.outcome` is carried to `emit_mt5_stage_event` (`analytics-service/services/mt5_client.py:205`), which writes a STRUCTURED LOG EVENT, not a row. There is no table to query for a historical `undetermined`, and Railway retention is short enough that a past occurrence is already gone. ⛔ **This is why Phase 161's first human-verification item has been unclosable for over a week**, and re-measuring it can only ever return "still nothing": measured 2026-09-05, `railway logs --service quantalyze-analytics --environment production` contains ZERO `mt5` lines of any kind. The absence of a sink makes that item permanently *unverifiable*, not merely not-yet-verified — a different and worse thing. ⭐ The verifier recommended exactly this on 2026-08-24 ("worth pairing with a durable sink when it is done") and it was never booked; it lived only inside `161-VERIFICATION.md`, which is the one file nobody planning the fix reads. **Fix:** persist which arm fired — a row, or a counter that survives rotation — so the sentence a founder actually read can be established after the fact. ⚠️ **Adjacent to, NOT the same as, `MT5-WEDGE-OBS-01`**: that arm probes LIVENESS (`-10004` vs `-10005`), this is a CAPABILITY verdict (`tradeapi_disabled` → which remedy sentence). Phase 164.1 is the closest live mechanism and the cheapest place to ride along, but it is a founder call whether it rides or waits — do not silently widen 164.1's scope to absorb it.

### MT5-SWITCH-WEDGE-CAUSE-01 — the mechanism behind the `-10005` account-switch wedge is not named (booked 2026-09-25)

**Why it is open.** Phase 164.6.5 criterion 1 required a named mechanism that PREDICTS the
asymmetry (D-01). On 2026-09-21 a switch at 04:08 completed cleanly in about one second, while
the switches at 11:02 and ~12:52 wedged. The recorded verdicts are in the runbook's Step 2b:

- **Same account vs a different account: REJECTED.** The 2026-09-21 Journal reading shows the
  clean 04:08 event was ALSO a change to a different account. This rests on the 2026-09-21
  reading only, because the 04:08 lines could not be re-read on 2026-09-25.
- **Terminal self-update (D-03a): UNDECIDED.** The only build reading is 6182 (server 5830), taken
  on 2026-09-25 after two restarts. No build reading from before the wedge exists.
- **Same broker server vs a different broker server: UNDECIDED.** Surfaced on 2026-09-25, when
  the window title named a different broker from the Journal's session. The server on each side
  of each switch was never recorded.

**What closes it.** At the next Cause B wedge, BEFORE the terminal restarts, record three things:
the terminal build (and the build at the last clean switch), the broker server on each side of the
wedged switch and of the last clean switch, and the Alerts and Journal state around the
`disconnected`. Keep account numbers and broker server names somewhere private and bring only
the verdicts into the repo. ⛔ Never write an account number or a broker server name here.
⚠️ **The automatic recycle Phase 164.6.5 ships erases this evidence, because the wedge is process
state.** Unless something records the build and the servers before the recycle, the next wedge
heals with no evidence, and this item can never close by waiting.
⛔ **CORRECTED 2026-09-25 (164.6.5 review round 1, SFH-04): what the heal records before the
recycle is narrower than "the build and the servers", and this entry must not read as covered.**
The sentence above is kept as lineage.
- **In-process build and connection state: expected `not_captured` on a true `-10005`.** The
  heal's pre-recycle `terminal_info()` crosses the same terminal IPC the fault names as dead, so
  its evidence line records `not_captured` with the reason. It is kept only because a partial
  wedge may still answer.
- **Build, bridge-side: recorded, never run live.** The recycle's committed remote source reads
  each `terminal64.exe` image's file version before ending it, and logs it as `file_versions` on
  the recycle's lines. It is the file on disk at the running image's path. That equals the
  running build unless a self-update replaced the file after launch, so it answers D-03a only
  when no such replacement happened. This path has never run against the live terminal.
- **Broker server on each side of the switch, and the Alerts and Journal state: recorded by
  nothing automatic.** The pre-recycle `account_info()` needs the same dead IPC and is
  budget-gated. The post-relaunch reads describe the NEW session, not the wedged one. Candidate
  (c) still needs an operator reading taken before the heal's next monitor tick recycles the
  terminal (`MT5_SESSION_POLL_INTERVAL_S`, 600 s by default).

**Owner:** Phase 164.6.8 (OUTAGEALERT). ⛔ **CORRECTED 2026-09-26:** moved from Phase 164.6.6 by the
founder's one-topic-per-phase split, with `MT5-PROBER-WEDGE-CALIBRATION-01`, because both close only on
the same next-wedge capture. The original owner text is kept as lineage: *Phase 164.6.6
(MT5TERMINALISOLATION). It owns the shared-terminal ownership model that makes a switch happen at
all, and the mechanism decides between its isolation options.* The verdict still informs 164.6.6's
isolation choice.
**Trigger:** the next `-10005` that has Journal silence after a `disconnected` line, or the start of
164.6.8 planning, whichever comes first (was: 164.6.6 planning).
⛔ **Not a close:** a retry, a sleep, a serialisation or the automatic recycle making the symptom go
away (D-02). Those are mitigations, not a mechanism.
⚠️ **Also recorded, not reconciled:** on 2026-09-25 the Journal showed the terminal `disconnected`
from 2026-09-21 12:52:04 with no reconnect line until the 2026-09-25 restarts. Read at face value,
the second wedge was not recovered for about four days.

- **Booked as a live-gated human item owned by Phase 164.6.8 (D-12, 2026-10-14); Phase 164.6.8 closes WITHOUT it.** The mechanism is named only from a real wedge. Since v0.131.5.0 the outage page carries the scrubbed pre-recycle wedge evidence snapshot (D-13), so the next real wedge produces the evidence; a hand-written fixture is never a close.
- **2026-10-14 (Phase 164.6.8 plan 09): checked and left OPEN as a live-gated human item (D-12).** No real wedge has occurred since the evidence snapshot went live, so no mechanism has been named. The plan 09 drill used an arrival-test cause and is not evidence here. The snapshot rides on the outage page, whose only live channel is Sentry (D-15).

### MT5-PROBER-WEDGE-CALIBRATION-01 — the prod-prober's `-10005` classification has never been calibrated against a REAL wedge (booked 2026-09-26, Phase 164.6.5 D-11)

**Why it is open.** Phase 164.6.5 criterion 4 required the prober's MT5 arm to actually measure
the terminal AND to be calibrated against a real wedge, "not only a fixture". The two halves
came apart:

- **D-10, measuring: ANSWERED in production.** Scheduled `prod-prober` run 36134914962
  (2026-09-25T12:26Z, head `01dcf1cc`) is the first to print a terminal-measuring mt5 line,
  `mt5: initialize=true last_error=1 connected=true trade_allowed=true`. Every scheduled run
  since reads the same, through run 36212376262 (2026-09-26T02:39Z, head `ecf1ef4e`). The last
  run before it, 36104820751 (2026-09-25T06:52Z), still read `mt5-ssh-transport`. Recorded in
  the 164.6.5 plan 03 SUMMARY.
- **D-11, calibrated against a real wedge: NOT DONE.** `mt5-ipc-timeout` has never fired in
  production. Its red fixture, `scripts/prod-prober/fixtures/mt5/10005.txt`, was constructed, not
  captured from a wedge, and is unchanged since Phase 164.8.3. So the arm's `-10005` branch is proven only against the shape
  we believe a wedge prints, never against one.

**Owner:** Phase 164.6.8 (OUTAGEALERT). ⛔ **CORRECTED 2026-09-26:** moved from Phase 164.6.6 by the
founder's one-topic-per-phase split. It was: *Phase 164.6.6 (MT5TERMINALISOLATION). It already owns
`MT5-SWITCH-WEDGE-CAUSE-01` directly above, whose close needs the same next-wedge capture.* Both
items moved together.
**Trigger:** the next live `-10005` (Journal silent after `disconnected`), captured BEFORE the
heal recycles the terminal. A founder-supervised induced wedge also qualifies.
**Gate (what closes it):** a real-wedge transcript, scrubbed of every account-shaped digit run,
broker server name, machine path and credential, committed under
`scripts/prod-prober/fixtures/mt5/` and registered in the runner's fixture table for the kind
it ACTUALLY produced. Then `node scripts/prod-prober/run.mjs --self-test` exits 0 and
`npx vitest run src/__tests__/prod-prober-wiring.test.ts` passes. If the real transcript
classifies as something other than `mt5-ipc-timeout`, that is a finding about the arm, not a
reason to re-shape the transcript.
⛔ **Not a close:** a hand-written or edited fixture, a renamed existing fixture, or a green
self-test on the fixtures that exist today.
⚠️ **Phase 164.6.5's own heal makes the trigger harder to meet.** The session monitor now
recycles the terminal on `ipc_fault` (plan 05), so a wedge can heal before a scheduled prober
run reads it. Capturing one may need a deliberate, founder-supervised window rather than
waiting.

- **Booked as a live-gated human item owned by Phase 164.6.8 (D-12, 2026-10-14); Phase 164.6.8 closes WITHOUT it.** It closes only on a real `-10005` wedge, not on a hand-written fixture. Since v0.131.5.0 the outage page carries the scrubbed pre-recycle wedge evidence snapshot (D-13), so the next real wedge hands over the capture this entry needs.
- **2026-10-14 (Phase 164.6.8 plan 09): checked and left OPEN as a live-gated human item (D-12).** No real `-10005` wedge has been captured; the plan 09 drill used an arrival-test cause, not a wedge, and is not evidence for this entry. The evidence snapshot rides on the outage page, and the page's only live channel is Sentry (D-15), so the capture will arrive there, not by email.

### Phase 164 (SHARE) — ACCEPTED RESIDUALS, named (booked 2026-08-27)

Source: `.planning/phases/164-share-.../red-team/SYNTHESIS.md` §7 + §8 item 6. The synthesizer's
finding was that these three were **accepted in conversation and written down nowhere** — and
"accepting a residual silently is indistinguishable from missing it." That is the whole reason
this section exists. None of these is a task. Each is a decision with a name against it.

- **[SHARE-RES-R4] PITR / branch-DB restore defeats revocation.** **Still open:** a point-in-time restore or a Supabase branch DB restores `strategy_shares` with its nonce and generation counter, so every token that was live at the snapshot instant becomes live again. Nothing in-database can close this; the per-environment `SHARE_TOKEN_SECRET` bounds it to the restored environment, and the within-environment case is accepted. What is missing is the operational step: a PROD restore is also a share-link un-revoke, whoever runs one must re-revoke, and nothing reminds them.

### Phase 164 (SHARE) — code-review + closure residuals (booked 2026-08-28)

Source: `164-REVIEW.md` (0 critical / 3 warning / 6 info) plus two defects found while running the
closure pipeline. The two user-reachable warnings (WR-02, WR-03) are FIXED and committed; what
follows is everything that was not.


### Phase 164 (SHARE) — /qa on PRODUCTION, post-deploy (booked 2026-08-28)

Ran to close UAT 7 (Plausible) and UAT 9 (Sentry), which were recorded BLOCKED locally.
Neither closed. Both found something better than a pass.

- **[SHARE-QA-06] the scrub still enumerates WHERE to walk, even though it no longer
  enumerates WHAT to scrub.** `scrubSentryEvent` names `request.url`, `transaction`,
  `breadcrumbs`, `spans`, `contexts.trace`, `extra`, `tags`. Two of those were added only
  after a live leak. Nothing proves the list matches what the SDK populates, and the wire
  capture used above is the only thing that ever has. ⭐ Candidate mechanism for 164.3
  (VACUITY): keep the capture harness and assert on transmitted bytes, rather than on a
  fixture that mirrors the implementation's own idea of its surface.

### Phase 164 (SHARE) — browser-UAT findings (booked 2026-08-28)

Source: `164-UAT.md`, 9 checkpoints against localhost pointed at TEST — 7 passed, 2 recorded
BLOCKED. Both defects below were found ONLY by driving the browser, after a code review, a
verifier pass and a green 88-file regression gate had all cleared the phase.

- **[SHARE-UAT-03] ⛔ THE IN-PAGE BUTTON HAS NEVER BEEN SUCCESSFULLY CLICKED.** Both synthetic
  clicks produced **zero network requests**, so checkpoints 1/2/6 (mint, reuse, revoke) were
  exercised against the ROUTES, not through the component's own handler. The route contract is
  proven; the click path is not — and that is exactly where the WR-02 Safari
  transient-user-activation concern would surface. A human click is owed. Not fixable by an agent
  in this environment.

### ⚠️ LANE-FORCERLS-GAP — the pg-lane's `compute_jobs` lacks the FORCE RLS that PROD has (booked 2026-09-07, phase 164.7 red-team)

Measured on a lane: `compute_jobs` has `relforcerowsecurity = f`. PROD sets
`ALTER TABLE compute_jobs FORCE ROW LEVEL SECURITY` (and `compute_job_kinds`) in
`20260516104201_compute_jobs_audit_2026_05_07_residual.sql:209-210`, which is not in every gate's
apply list.

**Why it matters:** under FORCE RLS a table OWNER is *not* exempt. So any gate that reaches
`compute_jobs` by making a role the table owner behaves differently on the lane than it would on
PROD — the lane is more permissive. A gate could pass on the lane for a reason that does not hold
in production.

✅ **Scope checked before booking:** `grep -rn "FORCE ROW LEVEL SECURITY" supabase/migrations/`
shows only `compute_jobs`, `compute_job_kinds` and (guarded) `weight_snapshots`. **`system_flags`
is never FORCEd**, so phase 164.7's own ownership scaffolding IS faithful; this is a pre-existing
gap in the three original tables, not something 164.7 introduced.

**Fix:** add the FORCE-RLS statements to the pg-lane fixtures (or to the affected apply lists) so
the lane's row-security posture matches PROD. Guard fidelity — recorded, not blocking.

### ⚠️ PLANVERIFY-CD-01 — plan `<automated>` blocks hardcode the PRIMARY checkout path, which is wrong under worktree isolation (measured 2026-09-07, phase 164.7 wave 1)

Every `<automated>` verify in this repo's plans opens with an absolute
`cd /Users/<user>/claude-projects/quantalyze`. That is correct when the executor runs in
the primary checkout, and **wrong the moment the phase runs with `isolation="worktree"`** — the `cd`
walks OUT of the agent's worktree and measures the primary tree, which contains none of that
executor's new files.

⛔ **The dangerous half is not the failure, it is the SUCCESS.** A verify that asserts *zero*
occurrences of something (`grep -c … = 0`, "no stray token", "gate reports no findings") PASSES
VACUOUSLY when pointed at a tree where the file does not exist yet. That is the same
cannot-fail class the 164.7 plan-checker already caught twice inside these very plans.

Measured: the 164.7-01 executor hit this and repointed the `cd` at its own worktree, changing only
the path and keeping every other byte (including the `{ …; test $? = 1; }` groups). It reported the
deviation. The two sibling executors were NOT warned, so the orchestrator must RE-RUN their verifies
in the correct tree before accepting any wave-1 result rather than trusting the self-reports.

**Newly exposed, not longstanding:** worktree parallelism was only enabled on 2026-09-07 after a
stale memory claiming worktrees fork from `origin/HEAD` was disproved by measurement. Every prior
phase ran sequentially in the primary checkout, where the hardcoded `cd` was a no-op.

**Fix:** plans should open verifies with a repo-root resolution that works in both
(`cd "$(git rev-parse --show-toplevel)"`) rather than an absolute path. Cheap, and it makes the
verify measure whatever tree it is actually running in.

### ⚠️ GSD-03 — `gsd-tools query init.plan-phase` emits INVALID JSON whenever a prior phase's verify command contains SQL dollar-quoting (booked 2026-09-07, phase 164.7 planning)

**Measured at `14dc1f5e`**, running `node ~/.claude/gsd-core/bin/gsd-tools.cjs query init.plan-phase 164.7`
(gsd-core 1.12.0). The output fails `json.loads` with
`JSONDecodeError: Invalid \escape: line 54 column 242`.

The offending value is a `prior_verify_commands[].command` entry harvested from Phase **164.4.1**
(the pg_cron lane task). That command contains a plpgsql anonymous block written through `printf`,
so the shell text carries `DO \$\$ DECLARE …`. The emitter does not re-escape those backslash
runs for JSON, so the blob it prints cannot be parsed by the very consumer the workflow spec
tells the orchestrator to parse it with ("Parse JSON for: `researcher_model`, …").

⚠️ **This is upstream (`@opengsd/gsd-core`), not ours** — but WE trigger it, and we will keep
triggering it: `prior_verify_commands` (#2401) is deliberately surfaced at every context window,
and this repo's verify commands are full of SQL. Any future phase whose nearest prior phase used a
dollar-quoted block hits the same wall.

**Workaround used during 164.7 planning** (recorded so the next person does not re-derive it):
strip the `prior_verify_commands` array by bracket-matching on the raw text and parse the
remainder. The key is not needed for planning; every other field parses cleanly.

⛔ Do NOT "fix" this by removing dollar-quoting from our verify commands — the commands are
correct and the emitter is wrong. If it needs a local fix, it belongs in the shim, not in our
plans.

**Done when:** either gsd-core escapes the value correctly, or our launcher wrapper strips the key
before the orchestrator parses it. Guard hygiene / tooling, not user-facing or data-integrity — so
recorded rather than blocking, per the stopping rule.

### ⚠️ GSD-01 — `/gsd-plan-phase` cannot add ONE plan to a partly-executed phase (booked 2026-08-28)

`/gsd-plan-phase <N>` replans the **whole** phase. Once some plans carry SUMMARYs, running it risks
regenerating or renumbering executed work, so the only safe path is authoring the new PLAN.md by
hand — which skips the orchestrator-only gates (`plan-phase` step 5.5's VALIDATION.md refresh, and
7.5), and skips `gsd-plan-checker` entirely.

Hit four times in phase 164: `164-06` and `164-07` were hand-authored net-new; `164-03` and
`164-04` were hand-revised. In each case the VALIDATION.md rows had to be written by the
orchestrator to cover the gate that did not fire — see the note at the bottom of
`164-VALIDATION.md`.

⚠️ **This is the same family as `NYQ-01`** (a config-enabled planning gate stopped firing and
nothing noticed). There the gate was silent by accident; here it is silent because the only safe
route around a tool limitation goes past it.

**Fix:** an `--add-plan` mode that appends a single plan to an existing phase and runs the checker
plus the 5.5 refresh over it alone. ⛔ Upstream `gsd-core`, not this repo — same bucket as
`depends_on` yielding `blocked_by: {}` and wave frontmatter drifting from ROADMAP. Phase 164.3
**excludes** this bucket deliberately; do not fold it in.

### NYQ-01 — a config-enabled planning gate stopped firing and nothing noticed (booked 2026-08-26)

⭐ **Founder-ruled 2026-08-26: regenerate, don't waive.** Surfaced while closing Phase 164's
plan-checker gate.

**The mechanism, measured.** `.planning/config.json` sets `workflow.nyquist_validation: true`.
`plan-phase` step 5.5 keys on a `## Validation Architecture` section in the phase RESEARCH.md and
writes `{phase}-VALIDATION.md`. Measured across phases 158–164:

| Phase | RESEARCH has `## Validation Architecture` | VALIDATION.md |
|---|---|---|
| 158, 159, 160, 161, 162 | yes | **present** |
| 161.1, 163, 164 | yes | **absent** |

So the precondition held every time and the artifact simply stopped being written. 163 was planned,
executed, verified and SHIPPED without it. Nothing in the pipeline reported a missing gate —
`gsd-plan-checker` only flags it if something invokes the checker, and on 164 the planner had been
hand-spawned outside the orchestrator, so the checker did not run either until it was invoked by
hand. **Two independent gates were silent at once, and the run still looked clean.**

- **[NYQ-01] Make a skipped step 5.5 loud.** Writing 164-VALIDATION.md by hand fixes one instance;
  it does not fix why five phases' worth of the gate produced nothing. Wanted: a check that fails
  when `nyquist_validation: true` and a phase has `## Validation Architecture` but no VALIDATION.md
  — the same shape as the `sql-tests` anti-SKIP net.
- **[NYQ-01b] Backfill or explicitly waive 163 and 161.1.** Both shipped; the artifact is now
  archival, so a recorded waiver may be the honest close rather than a reconstructed document.

⚠️ Same family as **SKIP-01** and **CI-MIGRATE-01**: a gate whose failure mode is *silence*, where
the green run and the un-run run are indistinguishable from the outside. The standing lesson holds —
**absence of a red is not evidence a gate fired.** Check the artifact, not the exit code.

### ✅ ACCEPTED RISK — Phase 163 / WR-10: the password floor was MEASURED, not RAISED (decided 2026-08-26)

⭐ **DECIDED 2026-08-26 by the founder: the six-character floor is ACCEPTED.** The risk below
was presented in full — including the key-material exposure path — and accepted knowingly.
This is a recorded acceptance, not a deferral and not an oversight: nothing here is waiting on
anyone. Kept in full rather than deleted so the reasoning is auditable, and so that a future
reader who rediscovers the weak floor finds the decision instead of re-opening it.

⚠️ What would REVERSE this: paying clients, a custody or compliance requirement, or any
evidence of credential-stuffing against the platform. At that point the remedy below is still
the remedy — it does not expire.

SEC-01 closed by MEASURING the hosted password policy and mirroring it in one exported
constant. The measurement discipline was right and is not in question: the hosted minimum was
read from the live signup endpoint's own rejection (**6 characters, and `reasons: ["length"]`
alone, so no character-class requirement**), never assumed from the GoTrue default.

**But measuring a weak floor and faithfully mirroring it is not hardening.** The outcome of a
requirement in a phase titled *"HARDEN — fail safe, closed, and loud"* is that a platform
which custodies users' exchange API keys accepts a six-character, all-lowercase password.
Nothing in the phase raised the actual gate — SEC-01's own docblock says the client constant
is UX only and the real gate is hosted GoTrue.

**Why this is a security item and not a preference.** 26^6 ≈ 3×10^8 is trivially searchable
offline and well within online rates, because the observed rate limiting is per-route rather
than per-account. The connected venue keys are decryptable server-side by the platform, so
account takeover is key-material exposure, not just account access.

- **[WR-10] RAISE the hosted minimum and enable leaked-password protection.** Both are
  DASHBOARD-OWNED settings with no repo representation, so a code change alone cannot do it.
  Sequence: raise the hosted minimum (10–12 is the common floor) and switch on GoTrue's
  leaked-password protection, THEN move `MIN_PASSWORD_LENGTH` and its recorded reading in the
  same commit. The procedure is already written down in the constant's docblock.

✅ DONE — the SEC-01 entry in `.planning/REQUIREMENTS.md` now records this acceptance
explicitly. It still does NOT claim the floor was validated: it was observed, accepted, and
says so. Observing a weak floor and accepting it are both legitimate; claiming it was cleared
would not be, and that distinction is the whole point of this phase.

### Phase 163 / OPS-08 (de-strict `_enqueue_compute_job_internal`) — routed onward (added 2026-08-26)

Raised by the three-reviewer gate on `supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql`.
Everything blocking was fixed in that migration and in `supabase/tests/test_enqueue_internal_destrict.sql`;
these four are the deliberate carry-overs, each with the reason it was not fixed there.

- **[OPS-08-F9] `test_enqueue_internal_destrict.sql` has no `ALL N ARMS EXECUTED` sentinel.**
  Any arm can be neutered in place and the file still exits 0, the same as the other ~60
  sentinel-free files in `supabase/tests/`. Declaring one is not free-standing: it requires
  raising `SENTINEL_FLOOR` 7 -> 8 and `ARMS_FLOOR` 63 -> 68 in `.github/workflows/ci.yml`,
  plus the per-file derivation entry that
  `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` reads — and ci.yml is
  outside plan 163-06's declared files and was being edited concurrently by another
  Phase 163 workstream. Fix: add the sentinel and both integers in one diff.

- **[OPS-08-F8] Follow-through on the sql-tests first-failure blast radius.**
  163-06 fixed its own instance (the gate is now a both-or-neither coherence assertion that
  is meaningful pre- and post-apply, instead of knowingly RED). The general problem stands:
  the `sql-tests` loop exits on first failure, so ANY file that is red for an expected
  reason silently suppresses every file sorting after it — for this one, ~40 of ~70. Fix:
  either run every file and aggregate failures at the end, or make the expected-red state
  a first-class, per-file declaration the runner understands.

  ⚠️ **STILL OPEN. Phase 164.3 plan 05 did NOT close this class — read carefully before
  ticking it off.** That plan built a NEW tool, `scripts/mutation-runner/run.mjs`, which
  aggregates across arms by design: it runs every annotated arm, collects defects into one
  table, and only then exits (first-failure identity is asserted WITHIN an arm's run, never
  ACROSS arms). So the run-all-and-aggregate shape now exists in the repo and is proven by
  `--self-test`.

  But that is a *second* runner standing beside the problem, not a fix to it. **The
  pre-existing `sql-tests` loop in `.github/workflows/ci.yml` is untouched and still exits on
  first failure**, so the ~40-of-~70 suppression described above is exactly as live today as
  when this item was written. Converting that loop is a riskier edit to a live gate that
  guards production migrations, and it was deliberately deferred rather than bundled into a
  plan whose subject was the mutation runner.

  Recording this explicitly because the tempting summary — "164.3 added arm aggregation, so
  F8 is handled" — would be a claim about a different artifact than the one this item names.
  That substitution is the precise defect class Phase 164.3 exists to catch, and it would be
  a poor look to commit it in the ledger entry for the phase's own work.

### Phase 163 / OPS-08 — TEST runs an OLDER REVISION of `_enqueue_compute_job_internal` (added 2026-08-26, corrected + root-caused 2026-08-26)

Found while pre-flighting the OPS-08 migration's gate arms against both databases. Three
reviewers independently worried that one gate arm is "meaningful on PROD and vacuous on
TEST". Measuring it explains exactly why, and the cause is broader than that one arm.

| | definition length | line-comment markers | carries the `--` comment naming the strict form |
|---|---|---|---|
| PROD 7-param | 4622 | 23 | yes |
| TEST 7-param | 3093 | **0** | no |

⭐ **CORRECTED 2026-08-26 — "comment-stripped build" was the wrong framing and should not be
repeated.** Re-measured: PROD's 7-param body stripped of comments is **3172** chars; TEST's raw
body is **3093**. Not equal, so TEST is NOT this definition minus its comments — TEST is running
an **older revision** of the function. The observable (0 comment markers vs PROD's 23) is the
same; the explanation is not, and the wrong one implies a stripping mechanism that does not exist.

⭐ **ROOT CAUSE IS NO LONGER UNKNOWN.** TEST's migration ledger explains it. TEST records
`version` as the *application* timestamp with the migration's own timestamp in `name`
(e.g. version `20260826084633` / name `20260826140000`); PROD records the migration timestamp
as `version`, once each. TEST also carries **duplicate applications** — the three
`ledger_refresh_*` migrations and `sync_status_protect_marked_refresh` each appear TWICE, at two
different application times. That is a `db push` re-run over a partially-reset database, not the
`supabase-migrate` workflow. Different mechanism, different history, hence different bodies.

**Why it matters, concretely.** The migration's gate strips comments before matching,
because plpgsql stores `prosrc` verbatim. On PROD that strip is LOAD-BEARING: PROD's
7-param carries `INTO STRICT` inside a comment, and the 7-param parity arm is an ABSENCE
arm, so without the strip the arm would fire and **abort the production deploy**. On TEST
there is nothing to strip, so:

- regressing the comment-strip leaves CI **green on TEST** and **breaks the PROD deploy** —
  first observation would be a failed auto-apply, since merging `supabase/migrations/**`
  applies to PROD;
- removing the block-comment pass (added to close a demonstrated `/* */` evasion) changes
  **zero** TEST results. CI cannot detect the removal of the mechanism CI depends on.

- **[PROC-02] Reviewers must declare execution status, and UNEXECUTED blocks.** `gsd-code-reviewer`
  is read-only by construction, and nothing in the loop says so — three clean reviews of a
  never-executed migration read exactly like three clean reviews of a tested one. One agent-prompt
  field; the cheapest item in the corpus, and the one that would have surfaced PROC-01 at review time
  instead of red-team time. Routed from Phase 164's red-team 2026-08-27. **Owner: Phase 164.6
  GATE-HYGIENE** (2026-09-05 re-partition). Booked 2026-09-05; the ROADMAP had cited a TODOS entry
  that did not exist.

- **[PROC-03] Per-arm `RED-UNDER` annotation — the CONVENTION shipped, its discoverability did not.**
  Phases 164.4 and 164.4.1 annotated every idiom gate file the pg-lane can reach (`files 44/71`,
  `ARMS_FLOOR` 361) and the runner proves each arm bites. What remains: `scripts/mutation-runner/
  GRAMMAR.md` is referenced by nothing a newcomer reads, so the next gate file is not born with the
  convention unless its author already knows it. Link it from `supabase/tests/README` or `CLAUDE.md`'s
  SQL-gate section and add the sql-gate-lint rule that a NEW gate file without `RED-UNDER` is red.
  **Owner: Phase 164.6 GATE-HYGIENE.** Booked 2026-09-05; same missing-entry defect as PROC-02.

- **[DRIFT-01] Re-align TEST's `_enqueue_compute_job_internal` with the repo definition**, or
  record deliberately that TEST is an older mirror. Until then, no CI run can exercise the
  comment-strip, and any change to it must be pre-flighted against PROD by reading
  `pg_get_functiondef` directly — a green TEST run is not evidence.

⚠️ The gate arms were all measured green on BOTH databases on 2026-08-26, so nothing is broken
today. See **SKIP-01** below: the drift is one symptom of TEST never receiving migrations at all.

### ⛔ SKIP-01 — nothing applies migrations to TEST, so the OPS-08 gate SKIPs FOREVER (added 2026-08-26)

✅ **REMEDY CONFIRMED BY MEASUREMENT 2026-08-26 (this instance only).** `20260826150000` was
hand-applied to TEST via MCP (10-param body MD5 `f349af15a256ad00bd31952723ae7b00`, 7674 bytes —
byte-identical to PROD), and PR #720's `sql-tests` lane then printed the *assertion* arm rather
than the skip:

```
test_enqueue_internal_destrict.sql:775: NOTICE:  OPS-08 Part 1+3 OK: the deployed 10-param
body carries no strict lost-race re-read, does raise serialization_failure on an exhausted
one, and its catalog COMMENT still carries the revert-discriminator marker.
```

⚠️ This closes the *instance*, not the class. The green check itself proved nothing — the
`SKIP (Part 3)` arm exits green too, which is what made this invisible. The evidence is the NOTICE
text, read out of the job log. **CI-MIGRATE-01 remains the class fix**; until it lands, every new
migration self-check is born silent on TEST.

Found by live measurement after PR #717 merged, while checking whether the recorded "OPS-08
code-complete, migration unapplied" state was still true. It is true — of the wrong database.

⚠️ **ATTRIBUTION, corrected 2026-08-26.** The core fact was NOT discovered here. It was already
written down in TWO places before this entry existed:
- the migration's own header (`20260826150000:184-186`): *"Nothing applies migrations to the TEST
  project automatically (supabase-migrate.yml targets PRODUCTION only)"*; and
- Phase 163's verification report, which records that the gate prints `SKIP (Part 3)` and that
  `ci.yml`'s whole-file anti-SKIP net keys on a marker STARTING `SKIP:` — which `SKIP (Part 3):`
  does not match — concluding *"the lane is GREEN and no CI signal will ever report the unapplied
  state."*

What THIS entry adds is the **permanence**, which neither source drew out: because nothing applies
migrations to TEST *at all*, the pre-apply state never resolves on its own. Both prior sources
describe a condition that reads as transitional. It is not. That is the finding, and it is
narrower than "SKIP-01 was discovered here".

**The recorded state MOVED rather than went stale.** Measured on both databases 2026-08-26:

| `_enqueue_compute_job_internal` (10-param) | PROD | TEST |
|---|---|---|
| `INTO STRICT` lost-race re-reads | **0** | **present** |
| `serialization_failure` raise | **yes** | **no** |
| OPS-08 marker comment | **yes** | **no** |

So "the deployed function still carries all four `INTO STRICT`" is now FALSE for production and
TRUE for TEST. Any note repeating the old sentence must name which database it means.

**Why no CI signal will ever say so.** Three measured facts compose:

1. **No workflow applies migrations to TEST.** All four migration-touching workflows checked:
   `supabase-migrate.yml` targets `vars.SUPABASE_PROJECT_REF` (the PROD ref);
   `migration-drift-check.yml` runs `db push --include-all --dry-run` — a dry run, also against
   PROD; `migration-policy.yml` documents that no `db push` or other write is ever invoked;
   `mutex-probe.yml` uses `TEST_SUPABASE_DB_URL` only to take a lock. TEST's ledger tops out one
   migration short.
2. `sql-tests` — the ONLY lane that executes real deployed SQL bodies — has five steps: install
   psql, preflight, acquire mutex, run, release. **There is no migration-apply step.**
3. TEST sits in the gate's *true pre-apply* state (pre-fix body AND no marker comment), which is
   the one state `test_enqueue_internal_destrict.sql` deliberately waves through: `exit 0`,
   `SKIP (Part 3)`.

⭐ **The pre-apply tolerance was designed for the window between authoring a migration and it
applying. For the only database CI runs against, that window NEVER CLOSES.** Parts 1+3 SKIP
permanently. The de-stricted body that is live on production has been executed by **no test,
ever, anywhere**.

✅ Credit where due — the gate is not naive. It RAISES on a revert (pre-fix body + marker
present), on a hybrid re-base (some arms moved), and on the marker going dark (post-fix body,
no marker). It goes silent in exactly one state, and TEST is in that state permanently.

- **[SKIP-01] Make the pre-apply SKIP expire, or give TEST the migrations.** Two shapes, and the
  choice is a real decision, not a detail:
  (a) apply `supabase/migrations/**` to TEST as a CI step before `sql-tests` — closes SKIP-01 and
      **DRIFT-01** together, because both are the same root cause; or
  (b) keep TEST as-is and make the pre-apply arm fail once the migration is older than some
      threshold, so a permanent SKIP becomes loud.
  ⚠️ (a) is the root fix but changes what `sql-tests` is allowed to do to a shared database that
  has no worker and is already contended — see the shared-test-db mutex notes. Do not treat it
  as a one-line CI edit.

⚠️ This generalises past OPS-08. ANY migration's self-check that tolerates a pre-apply state is
permanently silent on TEST by the same three facts. OPS-08 is where it was caught, not where it
is confined.

### Phase 163 / WR-01 — hygiene Rule 1 is INACTIVE in CI by design (added 2026-08-26)

Closing WR-01 removed the local username from the tree entirely (940 -> 0 across nine
encodings). The needle is now DERIVED AT RUNTIME rather than stored, which is what makes
that possible — but it has a consequence worth stating plainly rather than discovering
later.

**Rule 1 (bare-username detection) does not run in CI.** The scanner derives the needle
from the home-directory basename; on GitHub Actions that is `runner`, which the scanner
deliberately refuses (measured: `/home/runner` occurs 2800 times across 507 tracked files —
a naive derivation would have turned `frontend-lint` permanently red on a clean tree). When
Rule 1 cannot run, the gate says so and drops the username clause from its success line,
rather than claiming a check it did not perform.

**What still runs in CI:** Rules 2 and 3 are structural absolute-path checks that need no
needle, so every leaked `\/Users\/<anyone>\/` form (spelled escaped, per the scanner's own convention) is caught everywhere. The residual gap is
narrow: a BARE username occurrence with no path prefix, in a file added by someone who
never ran `npm run lint` locally.

**DECIDED 2026-08-26 — not closing it, and why.** The remedy is to wire
`HYGIENE_LOCAL_USERNAME` into the `frontend-lint` job from a repository secret. Declined:
the username is already present in published git history (rewriting history was explicitly
declined by the founder as costing more than it buys), so a secret would add config
coupling and a workflow-run-visible value in order to protect a string that is not
actually secret. The local gate plus the structural rules is the right cost/benefit here.

- **[WR-01-CI]** If a bare-username leak ever DOES reach main, that changes the calculus —
  wire `HYGIENE_LOCAL_USERNAME` into `frontend-lint` from a repository secret and delete
  this note. One env line plus one secret; no scanner change needed, the precedence chain
  already reads it first.

### Phase 163 / SEC-03 — H-0001 census RE-MEASURED, and the debt is bigger than recorded (added 2026-08-26)

- **[H-0001] Bring the six `H_0001_UNCOVERED_ALLOWLIST` routes under the audit law**, one
  per-site decision at a time, shrinking the allowlist as each lands. **Still open (re-measured
  2026-11-14):** the detector half closed 2026-08-29 (Phase 164.3 plan 03), and
  `src/__tests__/audit-coverage.test.ts` pins the six uncovered sites as an exact set in
  `H_0001_UNCOVERED_ALLOWLIST`, so a seventh site goes red on arrival. The six allowlisted routes
  are still unaudited; each needs a per-site compliance judgment (which actor, which event shape,
  which failure mode), not a regex change.

### `secret-scan` is red on `workflow_dispatch` runs — full-history scan, no range (raised 2026-08-23, PR #705 review)

**Priority:** P3 — noisy check, not a merge blocker (dispatch runs are not PR checks).

`ci.yml` triggers on `push`, `pull_request` **and `workflow_dispatch`**, and `secret-scan` has no
`if:` guard. In the pinned action bundle, `Scan()` appends `--log-opts` only for `push` and
`pull_request`; `workflow_dispatch` falls through to a bare `gitleaks detect` — i.e. **full history**.
Measured with the now-correct config: **29 findings** across ~20 non-allowlisted paths
(`src/lib/seam-redaction.test.ts` ×3, `analytics-service/services/job_worker.py`,
`scripts/backfill_funding.py`, …).

Not a regression from the version pin — the same full scan under 8.24.3 + the array config produced
**103**, so the pin improved it 103 → 29. But the workflow has dispatch inputs the team actually uses
(`bake_svg_goldens`, `bake_demo_screenshots`), so a manual dispatch red-lights the check for reasons
unrelated to the dispatch. Close it by either scoping `secret-scan` with an `if:` that skips
`workflow_dispatch`, or triaging the 29 full-history findings and allowlisting the genuine fixtures.

⚠️ Note the scope limit this implies: "the allowlist now works" is true for the two **range-scan**
paths (push, pull_request). The dispatch path scans differently and has never been clean.

✅ **RECONFIRMED LIVE 2026-09-05 — still exactly 29, still only on dispatch.** Run **33985008239**
on `main` at **`ce5d2983`**, event **`workflow_dispatch`**, job `secret-scan` FAILED:
`gitleaks cmd: gitleaks detect --redact -v --exit-code=2 ... --log-level=debug` with **no
`--log-opts`**, `2995 commits scanned`, `leaks found: 29`. The immediately preceding run
**33979505776** at `e01cc2e6`, event **`push`**, passed with `--log-opts=-1`, `1 commits scanned`,
`no leaks found`. Same scanner (`gitleaks version: 8.30.1`, cache hit), same config
(`using gitleaks config from GITLEAKS_CONFIG env var: .gitleaks.toml`). ⛔ So the version pin and the
array-form allowlist are BOTH working — this red is the dispatch-path scope difference this entry
already describes, not a regression and not a new leak.

SARIF breakdown of the 29 (artifact `gitleaks-results.sarif` on that run): **28 `generic-api-key`**
+ **1 `jwt`** (`src/app/api/verify-strategy/route.test.ts:539`), every one of them in a `*.test.ts` /
`*.test.py` fixture path. ⚠️ The path list differs from the 2026-08-23 sample recorded above
(`analytics-client.test.ts`, `ratelimit.test.ts`, `route.test.ts` under several API dirs …), so
triage must be done against a FRESH scan, not against that sample.

⚠️ **Why a `push` run is not as weak as "1 commit" sounds.** `--log-opts=-1` on `main` scans the
squash commit, which carries the PR's whole diff — new code IS scanned. What is never re-scanned on
either range path is OLD history, which is why these 29 pre-existing fixtures surface only under a
full scan. State it that way; "the gate only scans one commit" overstates it.

⛔ **Candidate for Phase 164.6 GATE-HYGIENE** (it is a gate defect, which is that phase's subject) —
but it is NOT in 164.6's ROADMAP scope as written. Adding it is a founder scope call, not an
agent one.

### `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` on `secret-scan` is now a no-op (raised 2026-08-23, PR #705 review)

**Priority:** P4 — dead config, zero behavioral risk.

The env was added when gitleaks-action's latest release was v2.3.9/node20. The step is now pinned to
v3.0.0, whose `action.yml` declares `using: "node24"`, so the forcing var does nothing. Comment
corrected in place; the var itself was left alone to avoid moving two variables in the PR that
changed the scanner pin. Remove it in a standalone change.

### `gitleaks-allowlist.test.ts`'s real-scanner arm is probably skipped in CI (raised 2026-08-23, PR #705 review)

**Priority:** P3 — a coverage claim that may not hold where it matters.

The H-0017 arm (`suppresses a JWT at an allowlisted path…`) is `skipIf`-gated on the `gitleaks` binary
being on `PATH`. It passes locally only because Homebrew installed 8.30.1; gitleaks is **not** in the
`ubuntu-latest` runner image, so the arm is almost certainly skipped in CI. Confirm against a CI log.

Combined with the new version-pin test being a YAML-text assertion, **nothing running in CI exercises
scanner-version-vs-config-form behavior** — the pin guard is a proxy for it, not a measurement of it.
The `npm run secret-scan` script booked above would close both: it puts the pinned binary on PATH, so
the H-0017 arm runs everywhere and local/CI can no longer drift.

### `gstack-version-bump` writes a 3-digit package.json version this repo's own test rejects (raised 2026-08-24)

**Priority:** P4 — caught every time by a committed guard, so it cannot ship silently.

`gstack-version-bump write` writes the npm-valid 3-digit translation (`0.71.2`) into `package.json`,
but `critical-regressions.test.ts` `[CRITICAL-02]` requires `package.json` to equal `VERSION`
**exactly** — and this repo's convention is the full 4-digit form (`0.71.2.0`). Every bump through
the CLI therefore reddens that test until the value is hand-corrected. Surfaced rather than blended
per Rule 7: the repo's committed, enforced invariant wins over the tool's general convention.

Two follow-ups: pin the repo's 4-digit choice somewhere the tool can read (a `.gstack/` setting if
one exists), and note that `package-lock.json`'s root version is **stale at `0.70.0.0`** — it has
been drifting for several releases with nothing enforcing it. `npm ci` tolerates the root-version
mismatch today, so this is hygiene rather than breakage; left untouched here to keep the diff
surgical.

### Money-path correctness (latent / flag-gated / edge cases)
- **Backbone-bypass parity surfaces** — `_compute_portfolio_analytics` (routers/portfolio.py:632)
  and `equity_reconstruction.py` run independent Sharpe/TWR stacks; frontend TS
  (`portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) and matching
  (`match.py`) compute bespoke annualization/Sharpe. Parity-gated but real divergence risk —
  absorb into the unified backbone.
- **Deribit `correction` residual** — a capital-reason row carrying a trading token and no
  capital word still classifies as trading P&L. Tighten the word-boundary classifier.
- **Worker orphaned-`running` purge: DELETE vs reset** (founder decision at FLIP) — same
  migration; TEST wants DELETE, PROD wants reset (a sustained >4h outage would lose live
  jobs). Window already widened 2h→4h.

### Reliability / observability
- **No cron migration in the repo has EVER asserted `cron.job.username`/`database`** (found
  2026-08-19 by the RLS audit of Phase 146.2's R3 migration; INHERITED gap, not introduced —
  logged as a CLASS fix, deliberately not point-fixed into `20260819150000`).
  `cron.job.username` defaults to `current_user` **at `cron.schedule` time**, so re-registration
  is precisely the operation that re-derives a job's privilege. Every cron self-verify in this
  repo reads `command` + `schedule` and never `username`/`database`/`active`. Two undetectable
  drift paths, both requiring a non-`postgres` applier:
  (a) a different superuser (e.g. `supabase_admin`) → the body silently runs with superuser
  rights thereafter, and the `count(*) = 1` gate still passes;
  (b) a non-BYPASSRLS applier → pg_cron's stock `cron.job` RLS (`USING (username = current_user)`)
  HIDES the postgres-owned row → `IF EXISTS` is false → no unschedule → the unique index on
  `(jobname, username)` permits a **SECOND** row → the sweep fires twice hourly (per-tick radius
  25 → 50). ⚠️ **The `v_count <> 1` guard is RLS-BLIND to this and would read 1 and pass green.**
  **Measured 2026-08-19:** owner is `postgres` on both PROD and TEST, so neither path is currently
  reachable via the normal merge pipeline — this is hardening, not a live break.
  **Fix:** add `username = 'postgres'` + `database = current_database()` equality assertions to
  the STEP-2 self-verify of every cron-registering migration going forward, with a
  consequence-naming message. Evidence of the ratified owner: `20260816140000:375`.
- **The readmit ceiling is SILENT at exactly the moment it gives up** (found 2026-08-19 by the
  RLS audit of Phase 146.2 R3; the fix's own new blind spot). At the ceiling the sweep inserts
  nothing → no `compute_jobs` row → no `{"source":"reconcile-sweep"}` metadata → the worker-side
  capture at `analytics-service/main_worker.py:754` never fires. **The alert is keyed on the
  HEAL**, so the transition from "recovering hourly" to "abandoned for ~90 days" emits NO signal,
  and the strategy's owner has no user surface for it. Not a leak and not a data-integrity
  defect — filed against Rule 12 (fail loud). **Founder decision needed:** body-side audit row on
  exhaustion vs. an external exhaustion query/alert. ⚠️ Interacts with the 90-day retention wall,
  which DELETES the marker rows that ARE the counter — so the bound is "3 per retention window",
  and a strategy can silently resume cycling after ~90d with no notification at either edge.
- **Phase-19 hourly cron never decommissioned** (PR-D) — soak gate passed, cron still running.
- **Match-engine cron health check missing** — no `/api/cron/health-check` route; match-engine
  cron failures are invisible (silent data staleness).
- **Cron/email idempotency & budget** — founder-LP cron double-email if lambda dies post-Resend
  (idempotency row on `(cron_name, year_month)`); founder-LP 85s worst-case > 60s maxDuration;
  Resend webhook svix-id idempotency store; email correlation-id fragmentation (per-email not
  per-batch); email retry false-alarm on UNIQUE(23505).
- [ ] Circuit-breaker state/ops dashboard (observability depth; from archived v1.16 v2-requirements).
- [ ] Job-queue depth + age metrics (observability depth; from archived v1.16 v2-requirements).
- [ ] Adaptive/load-aware rate limiting driven by the breaker signal (from archived v1.16 v2-requirements).

### Security
- **`GRANT ALL` residue on `public.api_keys`** (Phase-160 B-M1 census, 2026-08-23). **Still open:** `REFERENCES` on `anon` and `authenticated`, and `DELETE` on `anon`. `TRUNCATE` was revoked by Phase 164.9.7 (`20261009130000`) and `TRIGGER` by Phase 164.9.7.1 (`20261009150000`). Reachability today is none (for `anon`, `auth.uid()` is NULL, so `api_keys_owner` matches zero rows); it is defense in depth, one accidental permissive policy away from live. **Fix:** `REVOKE DELETE, REFERENCES ON public.api_keys FROM anon` and `REVOKE REFERENCES ON public.api_keys FROM authenticated`; the Phase-160 post-verify asserts `DELETE` survives for `authenticated` only, so an anon-scoped revoke will not trip it.
- **⚖️ ARCHITECTURE DECISION OWED: `api_keys` writes have left the RLS-enforced plane entirely** (raised by the Phase-160 RLS audit, 2026-08-23; MEDIUM, no leak today). With UPDATE revoked (`20260810120000`) and now INSERT revoked (Phase 160), **no RLS-subject role can write `api_keys` at all** — so `api_keys_owner`'s `WITH CHECK (user_id = auth.uid())` (`20260405061912_rls_policies.sql:22`) is dead on every path, and the sole writer is a `createAdminClient()` route running BYPASSRLS. That contradicts ADR-0001's "RLS is THE authorization layer". The *current* writer is correctly gated (uid comes only from `withAuth`'s `user.id`; the `...encrypted` spread is closed by a strip-mode Zod schema plus the `quantalyze/no-passthrough-on-ipc` lint rule, with a hostile-`user_id` oracle in `route.test.ts`). The residual is structural: any FUTURE admin-client route inserting `api_keys` with a request-supplied uid would write into another tenant's key list with **nothing in the database** to stop it.
  - ⛔ `FORCE RLS` is NOT the remedy: a service_role insert has no `sub` claim, so `user_id = auth.uid()` is NULL and every connect would fail.
  - The available DB-level backstop is a `BEFORE INSERT` trigger (BYPASSRLS skips RLS, not triggers). The repo already has this exact pattern twice for this exact class: `enforce_strategy_keys_owner_coherence` (`20260710120000:66`) and `check_strategy_api_key_ownership` (`20260410225609`). Decide whether `api_keys.user_id` warrants the same now that the last non-bypassed writer is gone.
- **CSP uses `unsafe-inline`/`unsafe-eval`** — move to nonce-based CSP.
- **VCR cassette over-redaction** — misses token/hmac/digest/nonce (and over-matches
  signal/signedAt/pubkey); replace with per-broker allowlist.

### Phase 164.3.1 review-fix — bounded residuals, deliberately NOT fixed (added 2026-09-02)
- [ ] **`scripts/prod-body-drift-check.sh` — the seven `node "$READER" … || fail` reader sites do not capture the child's exit CODE** (VERIFICATION W1 / READER-STDERR class in `DIAGNOSTIC_FIRST_ALLOWLIST`, gate-family-meta.test.ts). The four READER-STDERR allowlist entries (`node $NORMALIZER --function-names`, `node $NAIVE_NAMES` unqualified, `node $NORMALIZER --function-qualified-names`, `node $NAIVE_NAMES --qualified`) plus the three body/qualifier reads are accepted because the child's own stderr reaches the log un-redirected — but the wrapper's `fail` text carries no exit status, so a reader killed by a signal or an OOM (exit 137) reads identically to a charset refusal (exit 1). Fix: the `set +e; …; _live_rc=$?; set -e` idiom the same script already uses for its verdict-path greps — capture the reader's `rc=$?` and interpolate it into the `fail` message; then drop those four allowlist entries and let the diagnostic-first meta-arm assert it. Booked 2026-09-02 during 164.3.1 UAT item 3 (the allowlist reasons were read and hold; this follow-up was cited there as "recorded, not fixed" and had no tracker row).
- [ ] **`scripts/prod-body-drift-check.sh` — three remaining bare-`grep` sites, all OFF the verdict path.**
      The review-fix pass (`164.3.1-REVIEW-FIX.md`, WR-04, commit `d958e54e`) closed every grep/find
      exit-status site that DECIDES a verdict: the zero-path hit-list test (`textual-hits.txt`), the
      snapshot walk (`find … | grep -c`, now two measurements), and the fetched-body test (`*.live.sql`).
      Three `grep -aqE '[^[:space:]]'` calls keep the bare `if grep`/`grep && … || …` idiom because an
      exit >= 2 at each cannot produce a PASS:
      1. the naive-only names `::warning::` block (`names.naive-only.txt`) — a grep error silences a
         WARNING; the names are already unioned into the index every per-name decision reads;
      2. the two evidence printers inside the [VAC04-C1] BLIND-ZERO `::error::` block
         (`grep … names.lexer.txt && sed … || echo "(none)"`, same for `names.naive.txt`) — the block
         exits 1 regardless; an error there prints `(none)` in place of the list;
      3. `PROD_NAME_COUNT="$(grep -ac … prod-names.txt || true)"` — the file was asserted non-empty by
         the two `|| fail` guards immediately above it, and an empty count fails the absurdity floor
         CLOSED (`0 * 2 < snapshot population`), never open.
      Worth the `set +e; grep; _rc=$?; set -e` idiom for uniformity the next time the file is touched;
      not a fail-open today, so not blocking (stopping rule: blocks only on user-facing / data-integrity).
- [ ] **RED-TEAM — a gate-file `edit`/`insert-after` step can mutate the guard's INPUT, not its condition** (found in the 2026-09-02 /ship review of Phase 164.3.1). A mutation step that sets e.g. `v_raised := false;` inside the arm's own EXCEPTION handler leaves the RAISE on its genuine line, so attribution passes and `biting` rises — while the policy under test was never broken. Rules 3a/3b/3c bound the literal, the branch text and the runtime location, but not the guard's inputs. Proposed: a static rule refusing gate-file edits whose span lies inside the same DO block as the arm's raise AND assigns to an identifier appearing in that arm's failure-branch head; report it as `identity-rewrite`; GRAMMAR rule 3 to state that the guard's INPUTS are part of the condition. Design-level; deliberately not fixed in this ship.
- [ ] **TESTING — drift-check-scripts.test.ts VAC08-JOIN 'DRIVEN' arms echo the test's own computation** (2026-09-02 /ship review). The arms compute the expected missing set in a JS reimplementation (`isMissing`) and feed it to the stub `LEDGER_QUERY_CMD`, so the verdict agrees with the test by construction; the four real SQL join clauses in `default_ledger_query` never execute. Proposed: drive the real SQL on the throwaway pg-lane cluster (`scripts/pg-lane/run.sh`) against a scratch `supabase_migrations.schema_migrations`; keep the JS arm as a text pin only.
- [ ] **ADVERSARIAL F4/F6 (investigate) — run.mjs `judgeBlock` treats any non-ERROR sighting of an identity as forgery, and `attributeIdentities` only MEASURE_FAILs at zero parsed blocks** (2026-09-02 /ship review). A RAISE NOTICE, a `SQL statement "…"` CONTEXT echo or raw stdout that mentions an identity is classified SYNTHESISED and checked FIRST, so a legitimate NOTICE reds the gate with a "forgery" message; and a partially-parseable output (localized `FEHLER:` headers) is diagnosed as forgery rather than as an output-grammar failure. The GRAMMAR / 164.4 authoring rule should say "never echo an identity except from its own RAISE EXCEPTION"; the runner should distinguish grammar failure from forgery when SOME blocks parse.
- [ ] **COVERAGE — cluster-only paths never fired by an automated test** (2026-09-02 /ship coverage audit: 30 of 44 paths = 68%). `restore` and `dirty-checkout` defects (incl. the `gitStatus()==null` MEASURE_FAIL) are exercised by nothing; `judgeBlock`'s sqlstate ≠ P0001 ERROR carrying the literal has no red fixture; `neuterArm`'s "no RAISE precedes" and unterminated-RAISE refusal reasons are unasserted; `invokedDirectly()`'s catch fallback and the naive reader's `--qualified` mode are untested; the `--file`/`--arm` argv error exits are untested.
- [ ] **MAINTAINABILITY (deferred) — three copies of the same substring counter** (2026-09-02 /ship review): `occurrences()` in `src/__tests__/drift-check-scripts.test.ts`, `countOf` in `src/__tests__/gate-family-meta.test.ts` and `countOccurrences` in `scripts/mutation-runner/run.mjs`. Collapse to one helper under `src/__tests__/helpers/` (run.mjs is ESM outside vitest — either import the same module or leave its copy with a pointer).

### CI / test-infra ratchet

- **`[PGLANE-SELFTEST-COUNT-UNPINNED]` The pg-lane self-test's `N/6` denominator is a hand-typed
  literal in NINE places and NOTHING pins it (raised 2026-09-04, Phase 164.4.1 plan 01 Task 3).**
  `scripts/pg-lane/run.sh` spells its arm count at the SP-H01 history comment, the five
  `=== SELF-TEST n/6:` captions, the SP-H01 denominator comment, the `$((6 - st_skipped))/6`
  arithmetic and the final `PASSED (6/6)`. MEASURED at HEAD: adding arm 6 required editing all
  nine by hand, and zero vitest arms read `run.sh`'s captions — so a seventh arm whose caption
  said `7/7` while `PASSED (6/6)` stayed put would print a self-consistent-looking lie, and a
  caption that silently drifted BELOW the real arm count would let a dropped arm read as a full
  run. That is the same class SP-H01 itself was raised for; SP-H01 fixed the SKIP tally, not the
  denominator.
  ⚠️ Contrast `scripts/mutation-runner/run.mjs`, which also uses literal captions (`17/17`) but
  whose coverage is DERIVED and enforced: `src/__tests__/mutation-runner-floors.test.ts:579-605`
  ranges over `DEFECT_KINDS` and fails BY NAME on an unexercised kind. The `run.mjs` side is more
  recent and more tested; the lane side is the laggard.
  **Fix** = a vitest arm that counts the `=== SELF-TEST n/6:` captions in the lane script's bytes
  and asserts the count equals the denominator in the `PASSED (N/N)` literal and in the
  `$((N - st_skipped))/N` arithmetic — three independently-typed numbers forced to agree.
  ⛔ Not fixed in 164.4.1 plan 01 ON PURPOSE (PATTERNS C2): the arm-6 edit follows the local
  convention, and inventing a counting scheme mid-phase would mix a new mechanism into a substrate
  change. Book it, then build it.
  ✅ **BUILT 2026-09-05 (Phase 164.4.1 code review, IN-02).** `src/__tests__/drift-check-scripts
  .test.ts`'s SP-H01 arm now counts the `=== SELF-TEST n/N:` captions in the comment-stripped
  `self_test()` body and requires that count to equal the `PASSED (N/N)` denominator, requires each
  caption's OWN denominator to match it, and (as before) requires the
  `$((N - st_skipped))/N` arithmetic to use the same N — the three independently-typed numbers this
  item asked to be forced to agree. The interim `PASSED \((\d+)\/(\d+)\)` halves-agree check was
  SELF-CONSISTENT only: `totalArms` was read out of the caption, so six arms captioned `(7/7)`
  passed. PROVEN ABLE TO FAIL by neutering exactly that case — `self_test() contains 6 numbered arm
  captions but the verdict claims 7 … expected 6 to be 7` — then restored and confirmed by hash. An
  in-test calibration also proves the caption predicate matches something, so agreement cannot come
  from a regex that matches nothing.
  ⚠️ RESIDUAL, deliberately not pinned: two of the original nine sites are PROSE (the SP-H01 history
  comment at `run.sh:558` and the denominator comment), and the test strips comments before reading
  — by design, since a first version of SP-H01 matched `SELF-TEST PASSED (5/5)` inside the very
  comment explaining its own fix. A stale number in those two comments is a docs drift, not a
  self-consistent lie about the arm count, which is what this item was raised for.

- **`[PGLANE-SELFTEST-NUMERATOR-UNPINNED]` The new self-test caption pin constrains the arm COUNT
  and the DENOMINATOR, never the NUMERATORS (raised 2026-09-05, review of the 164.4.1 fix pass,
  IN-A).** `src/__tests__/drift-check-scripts.test.ts:3289-3300` — the pin
  `[PGLANE-SELFTEST-COUNT-UNPINNED]` above asked for and got — does two things: it counts the
  `=== SELF-TEST n/N:` captions and requires that count to equal the verdict's `N`, and it requires
  each caption to match `=== SELF-TEST [0-9]+/N`. The numerator is `[0-9]+`. Nothing requires the
  numerators to be 1..N, to be distinct, or to be in order.
  ⚠️ MEASURED at `6f9c5172` + this fix pass, by renumbering `scripts/pg-lane/run.sh:703` from
  `=== SELF-TEST 6/6:` to `=== SELF-TEST 7/6:` and running the whole file: **342/342 passed**, both
  new assertions included (`7/6` still matches `[0-9]+/6`, and there are still 6 captions).
  Restored from a byte backup and confirmed by `shasum` equality — deliberately not by a VCS
  restore, which would have taken the pass's uncommitted edits with it.
  So the surviving hole is duplicated or skipped numerators: captions reading `1,2,3,3,5,6` or
  `1,2,3,4,5,7` beside `PASSED (6/6)` print a self-consistent-looking sequence that no arm reads.
  That is smaller than the class the parent item was raised for — the COUNT is now pinned, so an
  arm cannot be added or dropped silently — but it is the same shape.
  **Fix** = extend the same loop to collect the numerators and assert they are exactly the set
  `1..N`. No new mechanism, no new fixture.
  ⛔ NOT fixed in this pass ON PURPOSE: the brief that raised it books it explicitly and forbids
  introducing enforcement, and a pin added in the same pass that measures it would be a pin nobody
  has yet seen fail on real drift.

- **`[PGCRON-INSTALL-GUARD-STRINGCMP]` The macOS pg_cron installer's agreement guard compares path
  SPELLINGS, so a symlinked `pg_ctl` false-refuses (raised 2026-09-05, review of the 164.4.1 fix
  pass, IN-C; PRE-EXISTING and untouched by that pass).**
  `scripts/pg-lane/install-pg-cron-macos.sh:107` is `if [ "$path_bin" != "$PGBIN" ]`, where
  `path_bin` is `dirname "$(command -v pg_ctl)"`. Homebrew's `brew link` puts `pg_ctl` and
  `pg_config` in a shared bin dir as SYMLINKS into the keg, so the two spellings differ while
  naming the same binary — and the guard refuses.
  ⚠️ MEASURED at `6f9c5172` + this fix pass, with PGBIN unset and a scratch dir first on PATH whose
  `pg_ctl` and `pg_config` are symlinks into `/opt/homebrew/opt/postgresql@16/bin`:

  ```
  PATH pg_ctl        : <scratch>/linkbin/pg_ctl
  resolves to        : /opt/homebrew/Cellar/postgresql@16/16.13/bin/pg_ctl
  keg pg_ctl resolves: /opt/homebrew/Cellar/postgresql@16/16.13/bin/pg_ctl
  ERROR: the lane and this script would resolve DIFFERENT PostgreSQL binaries:   (exit 1)
  ```

  Same real binary on both sides, refused anyway. The blast radius is bounded — the refusal is
  LOUD, its remediation text is correct, and `export PGBIN=<keg>` clears it in one command — so
  this costs an operator one confusing message, never a wrong install. It is a false NEGATIVE, not
  a silent degrade, which is why it is booked rather than blocking.
  **Fix** = compare the resolved binaries rather than the directory strings: `readlink -f` (or
  `realpath`) both `pg_ctl` paths and refuse only when THOSE differ; keep printing the two original
  spellings in the message so a genuine mismatch stays legible. ⚠️ macOS `readlink` gained `-f`
  only in Ventura — check before relying on it, or resolve with `cd "$d" && pwd -P`.
  ⛔ Booked, not fixed: the fix-pass brief that raised it scoped it to booking, and loosening a
  safety guard is not a change to make beside four unrelated documentation fixes.

- **`[PGLANE-SELFTEST-NOT-IN-CI]` No CI step runs the pg-lane's OWN self-test — its six arms are
  proven only on the authoring box (raised 2026-09-04, Phase 164.4.1 plan 01 Task 3).**
  MEASURED at HEAD: `.github/workflows/ci.yml`'s `sql-mutation` job runs the RUNNER's self-test
  (`node scripts/mutation-runner/run.mjs --self-test`) before the corpus run, but ZERO steps in the
  whole workflow invoke `bash scripts/pg-lane/run.sh --self-test`.
  So the lane's collision guard (arms 1-2), its orphan-cleanup contract (arms 3-5, the D-04 defect
  that cost 27 orphaned clusters and a disk-exhaustion incident) and now its pg_cron preload
  (arm 6) are asserted on macOS and nowhere else — while every one of them is a property of the
  substrate that CI's throwaway clusters depend on, and ubuntu is the host where the preload's
  provisioning is newest and least measured.
  ⚠️ The cost is real, not hypothetical: arm 6's control half spawns lanes, and arms 3-5 wait on
  signalled runs (~39 s locally before arm 6). A CI step must carry its own measured wall clock
  against the job's `timeout-minutes`, so this is a sized piece of work rather than a one-line add.
  **Fix** = a step in `sql-mutation` (or a job of its own) running the lane self-test, with the
  measured ubuntu wall clock recorded in the same comment. Not fixed in 164.4.1 plan 01: that plan
  pins `timeout-minutes: 15` unchanged, and adding ~40 s of lanes to the job is exactly the kind of
  unmeasured spend that pin exists to prevent.

- **`[REDUNDER-PENDING-UNBOOKED]` The runner's `pending:` class is the only one of five printed
  without a TODO id or a CI assertion (raised 2026-09-04 by the Phase 164.4 verifier, WR-V3).**
  `unreachable:` cites `[REDUNDER-NONIDIOM]`, `lane-blocked:` cites `[REDUNDER-PGCRON]` and is
  MEASURE_FAILed in `.github/workflows/ci.yml` if absent; `pending:` cites nothing and CI asserts
  nothing about it. Today the class holds exactly one file
  (`test_compute_jobs_error_kind_copy_parity.sql`, owed to Phase 164.4.1) and its shape IS pinned
  against real runner output by a vitest arm on every push, so this is bounded, not open.
  ⚠️ **CURRENCY 2026-09-05 (Phase 164.4.1 plan 06). Two of the sentences above have moved; the
  paragraph stays as its dated record and the item stays OPEN.**
  (a) `pending:` is now measured **`pending: 0`** — that one file was annotated by plan 02, so the
  class is EMPTY, and it is pinned as the empty set BESIDE an AIM (`it` title `pending AIM (D-04)`)
  that classifies a stripped copy of a real gate to prove the class is still COMPUTED. An empty-set
  assertion standing alone would be the vacuity this file has already measured once; do NOT
  "restore" the old one-name pin.
  (b) The id `lane-blocked:` cites is now a **RETIRED** one: `[REDUNDER-PGCRON]` was closed the same
  day, and plan 06 rewrote the printed reason so the NON-EMPTY arm cites no id at all (it points at
  the `lane-probe:` line) while the EMPTY arm names the retirement explicitly. The `lane-blocked`
  line's CI MEASURE_FAIL is unchanged.
  ⛔ The item's own thesis is UNAFFECTED by both: `pending:` still cites nothing and CI still
  asserts nothing about it, and an empty class is exactly when an unasserted one is easiest to stop
  noticing. The honest fix below is still the fix.
  ⚠️ **Do NOT close it by hardcoding a TODO id into the line.** `pending:` is a GENERIC class —
  "idiom files that carry no RED-UNDER yet" — so a fixed id would be a lie the moment a second,
  unrelated file lands in it. The honest fix is a gate asserting that every file the runner names
  as pending is accounted for somewhere in `TODOS.md`, which is a new mechanism and was not worth
  building at phase close. Deliberately deferred, not overlooked.

- **`[VITEST-CORPUS-TIMEOUT-01]` A corpus test passes only on an idle box — 5 s budget, ~4 s of work
  (measured 2026-09-04, Phase 164.4 close).** `src/__tests__/drift-check-scripts.test.ts` — the
  `[VAC04-C1] … CORPUS` case scans all 262 `supabase/migrations/**` files against two structural
  readers inside vitest's **default 5000 ms** timeout. MEASURED, same tree, same commit, twice each:
  loaded box ⇒ `Error: Test timed out in 5000ms`, full suite **193.9 s**, 1 failed / 13905 passed;
  quiet box ⇒ **102.7 s**, 13906 passed, exit 0. Isolated, the file is 333/333 green but takes
  42.1 s, so this one case sits close to the budget even with nothing else running.
  ⚠️ It is NOT a flake in the "ignore it" sense — the budget is genuinely too small for the work,
  and the corpus only grows with each migration, so the margin shrinks monotonically. CI has not
  hit it because the vitest shards spread the load, which means the first symptom will be a
  mysterious red shard, not a clear one.
  **Fix = an explicit per-test timeout carrying the measurement** (`it(..., { timeout: 30_000 })`
  with a comment recording 42 s/333 tests and the 262-file denominator), NOT a global
  `testTimeout` bump, which would hide every other near-budget test. Not blocking: unrelated to
  Phase 164.4's subject (its corpus is `supabase/migrations/**`, which the phase does not touch),
  and both the full suite and CI are green.

- Shared test-DB sql/e2e race (fence flake); Railway analytics deploys skip silently on red
  main CI (verify `commitHash` + `/health`); `repro-key-flow.sh` Layer-A leak gate is a CI
  no-op; `cassette-refresh.yml` failed 17/17 with no alerting.
- **`analytics-service/tests/` is entirely untyped — 5,439 `mypy --strict` errors across 182 of
  213 test files** (MEASURED 2026-08-02 from Phase 142; `test_main_worker.py` alone = 59, which
  is typical at ~30/file, NOT an outlier). ⚠️ **This is CONFORMANCE, not drift**: `ci.yml:1130`
  states *"tests/ stays untyped by design"* and the gate is deliberately
  `mypy --strict --follow-imports=silent services/ routers/ models/`. So the open question is a
  **policy** one — should the staged B-mypy program (ingestion → `services/` part g →
  `routers/` part h → `models/` part i) get a part j for `tests/`? — not a bug to fix.
  **No owning phase, and deliberately not given one:** it belongs to none of 143/144/145 (JOB —
  job-state integrity) or 146 (RATE), and it does NOT justify a Phase 147 inside v1.16 — a
  5,439-error program is milestone-scale and orthogonal to "Production Resilience & Reliability"
  money-path plumbing. Route to a future milestone as B-mypy part j, or close as WON'T-FIX if
  the untyped-tests posture is reaffirmed. Surfaced because a Phase 142 executor ran
  `mypy --strict` on a path the gate excludes; **zero errors fell in Phase 142's added ranges.**
  ⛔ **CORRECTED 2026-09-23 — the gate command quoted above is no longer the gate.** As of Phase
  164.6.1 it ALSO names the four top-level modules `main.py`, `main_worker.py`,
  `main_worker_healthz.py` and `sentry_init.py` (100 source files). `tests/` and `scripts/`
  remain outside for the same stated reasons; the policy question is unchanged and is NOT
  carried by 164.6.1. The quoted command is kept as lineage.

### UX / product polish (founder-requested)
- **Header "+ Allocation" lacks a path-to-existing-strategy affordance** (deferred 2026-08-06 at
  Phase-150 plan-check rev-2): the Allocations header button offers no route to allocate an
  already-onboarded strategy; Phase 150's arm-2 "Go to My Strategies →" empty-state link is the
  interim mitigation. A full affordance needs its own UI-SPEC surface before build. See
  150-CONTEXT.md Deferred Ideas.

- **⭐ Expose an MCP server so a client can read their own stored data and analyse it with their own
  AI** (founder-requested 2026-08-03, during `/gsd-plan-phase 142.2`). Once we have ingested and
  derived a client's data, they should be able to point their own AI assistant at it — Claude
  Desktop, Claude Code, ChatGPT, whatever they use — and ask their own questions, rather than being
  limited to the analyses we chose to render. This is a **product** idea, not a refactor: it turns
  Quantalyze from "the dashboard we built" into "your data, queryable", and it is a natural fit for
  the backbone because **dailies are canonical** — one clean series to expose rather than N bespoke
  panels.
  **Not planned, not scoped, not scheduled** — captured so it is not lost. Before it can be planned,
  four things need a decision, and the first two are the ones that make it non-trivial:
  - **Auth.** MCP has no ambient session. This needs a per-user credential (scoped token / OAuth)
    with a revocation story, and it must be **read-only** and **owner-scoped** — the RLS discipline
    that governs every other read path applies here, and a SECURITY DEFINER shortcut would be a
    tenant-leak risk. See the `get_published_trust_signals` SECDEF precedent for how narrow such a
    surface has to be.
  - **What is exposed.** Dailies + derived metrics is the honest answer (canonical, already the
    single source). Raw `trades` is tempting and mostly wrong — it is a partly-redundant
    representation only some venues populate (see Phase 142.2 / D-16). Exposing it would re-teach
    clients the same wrong model the strategy gate just had to unlearn.
  - **Hosting shape.** Remote MCP endpoint on our infra vs. a small local server the client runs
    against an API token. Remote is far easier to support and revoke; local is easier to trust.
  - **Whether it is a paid tier.** Likely yes, but that is a CEO call, not an engineering one.
  ⚠️ Note the adjacent risk: an MCP surface is a **new public read boundary**. Every hardening
  lesson already paid for on the public factsheet path applies to it from day one, not later.

- **⭐ `[TURNOVER-01]` Account turnover calculation — wanted in the NEXT MILESTONE
  (founder-requested 2026-09-04).** Compute and expose how much an account trades relative to its
  own size over a stated window, as a first-class metric alongside the existing risk/return set —
  not a one-off panel. Four things need deciding before it can be planned:
  - **Definition — pick ONE and pin it.** (a) notional traded / average equity, or (b)
    `min(buys, sells) / average equity` (the fund-industry convention, which strips pure
    inflow/outflow). These differ by roughly 2x on a directional book, so it is a product call,
    not an implementation detail.
  - **Source.** ⛔ NOT the `trades` table — it is a partly-redundant representation only some
    venues populate (Phase 142.2 / D-16), so a turnover built on it would read ~0 for every venue
    that does not fill it. Derive from position deltas on the canonical daily series, per the
    standing "dailies are canonical → derive everything" rule.
  - **Window + annualisation.** Turnover is a RETURN-family quantity, so it annualises on the
    CALENDAR (365) per #597 — NOT on trading frequency the way the risk metrics do.
  - **Leverage.** Notional turnover is *not* leverage-invariant (unlike Sharpe and Calmar), so the
    spec must say whether it is measured before or after the allocator's leverage scaling.

### v1.16 Phase-140.1.2 — routed findings (added 2026-07-26)

> Both are **pre-existing** and were deliberately fenced OUT of Phase 140.1.2, whose scope was
> four named artifact items and no general sweep. Routed here per that phase's own CONTEXT rule.

- **`analytics-service/tests/test_mt5_validate.py` carries 8 self-referential detail
  assertions** — `:286`, `:310`, `:328`, `:347`, `:383`, `:404`, `:420`, `:436` are each
  `assert ei.value.detail == <CONSTANT>` where the constant is imported from the module under
  test, so the assertion cannot fail when the copy changes. (All 8 re-read at HEAD
  `2c55ece0`; the file is untouched by 140.1/140.1.1/140.1.2.) 140.1.1's oracle audit found
  zero self-referential oracles *in the 19 files it added* — this is an older file it never
  rewrote, so that audit's verdict is not contradicted. **Do not copy this pattern**; fix by
  typing the expected copy as a literal in the test, the way 140.1.1 fixed the one assertion
  in this file that it did touch.
- **`analytics-service/docs/STATUS_CONTRACT.md` not-seam-reachable coordinate drift beyond the
  item 140.1.2 repaired** — `routers/portfolio.py:2242` is a comment line (`# Audit H-0535 —
  the credential fields are pydantic.SecretStr…`; the 429 raise is at `:2254-2264`, located by
  the text `if not _check_verify_strategy_email_rate(` at `:2253`) and `:2446` is a comment
  line too (`# Vectorized matching: build a DataFrame…`), not a deliberate error arm.
  **Re-derive both by text before fixing — do not trust these numbers either**; the raise
  shifts whenever anything above it in a 2500-line router moves. 140.1.2 plan 04 corrected
  the `exchange.py` and
  `internal.py` coordinates in that bullet plus the S-11 row and the classes heading, and
  deliberately stopped there. *(Same file, same class: `routers/exchange.py:37` and
  `services/error_contract.py:6,8` still say "the four classes" in prose — the table has had
  five rows since 140.1.1 plan 01. One-word comment fix, batch it with the above.)*

### v1.16 Phase-140.1.2 review — findings routed onward (added 2026-07-26)

> From the 140.1.2 code review (0 Critical, 0 High, 7 Medium, 6 Low). The four in-fence items
> (M-02, M-04, M-05, M-06) plus L-03/L-04/L-05 and W-02 were fixed in that phase. These are the
> ones deliberately NOT fixed there, each with the reason and the owner. **Every coordinate
> below was re-derived at HEAD by locating the code text; re-derive again before acting.**

- **→ backlog, beside the four-vocabulary unification.** The provenance channel
  (`ValidationResult.permanent`) has ONE consumer. `routers/process_key.py`'s `_envelope_error`
  `recoverable` derivation and the sync-arm 424 venue-transient pre-gate both still key on
  `_ROUTE_TERMINAL_ERROR_CODES` ∪ `PERMANENT_VALIDATION_ERROR_CODES`, neither of which knows
  `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` or any pandera-minted CSV code. **Unreachable for
  MT5 today** — `process_key.py` admits `mt5` to `onboard`/`resync` only and `_is_long_fetch`
  routes both to the worker — so this is latent, not live. It goes live the moment a second
  adapter states permanence, or `_is_long_fetch` changes: two contradictory verdicts on two
  paths for one rejection. Plumbing exists (`_envelope_error` already takes an explicit
  `recoverable: bool | None`). (Review M-03.)
- **→ backlog. One route, two body shapes for one condition.** After 140.1.2,
  `POST /api/validate-key` answers 400 with `{detail, code, recoverable}` for a ccxt
  `AuthenticationError` but bare `{detail}` — byte-identical `detail`, **no `code` at all** —
  for an sFOX 401 or an MT5 bad password. Same for `MT5_WRONG_SERVER_DETAIL` and
  `MT5_MASTER_PASSWORD_DETAIL`, which carry no machine code anywhere on the HTTP path even
  though the WORKER path now knows they are permanent (PYAPIFIX2-02). A 140.3 consumer
  branching on `body.code` therefore behaves differently per venue for an identical condition.
  Pre-existing class (the permanent 400 arms were never in PYAPIFIX2-01's venue-transient
  scope), but the asymmetry is newly VISIBLE. Close it by giving the permanent 400 arms the
  same flat shape with `recoverable=false`. (Review M-07.)
- **→ backlog, adds to the STATUS_CONTRACT coordinate-drift item above.** A mechanical sweep of
  all 51 `path:line` coordinates in `docs/STATUS_CONTRACT.md` (added while fixing review M-05)
  found three more pointing at a blank line at HEAD, none of them in M-05's scope:
  `services/exchange.py:978` (cited as the range start `:978-1021` in R-2), `routers/exchange.py:96`
  and `routers/exchange.py:215` (the S-02 row). The §7 S-table is a HISTORICAL census — its
  `Site` column records where each site was when the table was built, alongside a `Today`
  column describing the pre-migration shape — so a row's coordinate going stale is expected
  and is not by itself a defect. Prose coordinates outside the table are a different matter.
  **The durable fix is not another sweep**: cite by searchable code text (or an anchor comment
  in the source), so a coordinate cannot rot silently. Until then, re-derive before trusting.

### v1.16 Phase-140.5 (SEAMPROSE) — deferred items (added 2026-07-30)

Full detail: **`.planning/phases/140.5-seamprose-attribution-copy-harness-fidelity-and-prose-citati/140.5-deferred-items.md`** (tracked; the phase's own carry-forward ledger, ~40 sub-items). All items below are **non-blocking** by the founder bar (guard-hygiene, prose/citation, copy, and deferred breadth do not block); logged here so the canonical backlog owns them. The phase's one user-facing defect (**1d**, `permissions/route.ts` KEK "not configured" misattribution) was **FIXED** post-phase at `a89cedbf` and is NOT carried.

- **Copy alignments (non-blocking):** `csv-validate` 503 config-missing arm is a bare heading vs the sibling 502's fuller sentence (§1c); `UNSUPPORTED_EXCHANGE` deserves its own wizard member rather than the honest `UNKNOWN`/500 fallback (§1b).
- **Coverage-law guard widenings (guard-hygiene, §2a–2f):** `.tsx` log-roster class open (two instances scrubbed, roster doesn't cover `.tsx`); wait-threading completeness unguarded; `composite/members` has no `Retry-After` producer (recorded in the guard docblock); docblock-prose rewrites have no guard; purity-needle + wire-vocabulary guards partial-by-construction. Each names its one-line ratchet.
- **Citation/prose harness residuals (§3a–3f):** D/E/F self-relative citations (`line 55`, `(:1027)`) need a second file-scoped predicate; string-literal citations invisible to the comment-scoped census — ⚠️ **NARROWED 2026-07-31 (141.1-02):** `seam-retry-registry.ts` was appended to `SEAM_CITATION_SURFACE` (now 35 files) and given a registry-LOCAL guard that scans all 13 evidence strings and reds on any `file.ext:NN` coordinate, so the registry's own string literals are covered; the residual is now the **other 34 files'** string literals, still comment-scoped only; a marked-quotation-exclusion guard is unbuilt; two RESEARCH offset/count figures (§3.8 `+72`, WP-13 "3+1") are mis-shaped — re-read, don't inherit.
- **Type hazard (§4a):** `AnalyticsUpstreamError`'s positional params — same adjacent-same-typed-argument class as `mintTenantClaim`, more call sites; wants its own scoped plan, not a drive-by.
- **Harness/CI residuals (§5a–5g):** 17 `stripComments` copies unrewired (needs a third string-erasing mode); `ci.yml:1633` left narrow deliberately (subsumed by `spec-disabling.invariant.test.ts`); two PR #108 e2e follow-ups stay skipped; `handleRetrySync` reset is defence for the path 141 adds — ⚠️ **CORRECTED 2026-07-31 (141.1-09): no longer "unreachable today".** 141 shipped that path; it is live and reachable on the five retry-enabled budgets, so this reset is now active defence rather than anticipatory.
- **424 arrival breadth (§7, deferred by decision):** 140.5-06 task 2 landed 1 of 5 arrival routes + 0 of 5 re-homes. Owed to a future plan: 424 arrival cases at `keys/validate-and-encrypt`, `strategies/create-with-key`, `strategies/composite/add-key`, `verify-strategy`; and RE-HOMING (not deleting) five cannot-arrive suites onto an emittable status while keeping their forwarding assertions.
- **Founder-owed (not code — do not plan around, §6):** copy-vs-`DESIGN.md`-§Voice review for the Claude-drafted CSV/KEY copy; **TRAP-4** five-clicks in a real browser (C-4) + **Sentry ingestion** in a preview via an unroutable `ANALYTICS_SERVICE_URL` (C-5); **⛔ D-01 live-Redis lane STILL UNVERIFIED** — `tests/redis/**` needs a live store, registration pins existence not execution.
  - ⚠️ **C-4/TRAP-4 live five-clicks ATTEMPTED in a real browser 2026-07-30 — blocked on key availability, not a defect.** Reaching a gate render (`GATE_NO_DATA_SOURCE` / `GATE_INSUFFICIENT_TRADES` / `COMPOSITE_MEMBERSHIP_UNKNOWN`) requires a read-only key in a valid-but-no/insufficient-data state; none was available, and entering keys is a Claude-prohibited action regardless. Property remains **code-proven** (mutation M103 RED; unconditional `<Link>` escape at `ErrorEnvelope:1609`). Still owed: a human paints it once in a real browser (or a seeded e2e — the PR #108 follow-up).
- **Cosmetic (140.5 verifier/reviewer non-blockers, guard-hygiene):** `SEAMPROSE-01..08` IDs are not in `.planning/REQUIREMENTS.md` (inserted-phase convention, same as SEAMRIM/140.4 — all eight accounted for across the 8 plans); the contracts-registry batch label calls `seam-venue-vocabulary` `SEAMPROSE-05` while plan-02 frontmatter lists `-03/-07` (label drift, no functional effect).

### v1.16 Phase-141 / 141.1 (SEAM / SEAMBACKOFF) — deferred items (added 2026-07-31)

**This section discharges G4** — the obligation that Phase 141 have a deferrals section at all, which every prior v1.16 phase had and 141 did not. All items below are **non-blocking** by the founder blast-radius bar (nothing here is user-facing or data-integrity); they are recorded so the canonical backlog owns them, not scheduled. Verdicts, one per 141 obligation — the other four are closed **in place** rather than restated here, so the original text stays where a reader will look for it:

**Bucket H — recorded, deliberately NOT fixed** (from `141-REVIEW-CONSOLIDATED.md`; each re-verified against HEAD on 2026-07-31 before being written here):

- **H4 — `keys/sync` forwards the upstream status verbatim where the legacy contract promised `'syncing'`, and 200 where it promised 202.** Confirmed: the `WIZARD_DUPLICATE` branch emits `status: typeof upstream.status === "string" ? upstream.status : "syncing"`, so a `'draft'` upstream status reaches a caller documented to receive `'syncing'`. Nobody reads it today — no client branches on that field on this route.
- **H7 — `H-0562` (multi-worker durability) had no ledger target.** It is cited as OPEN inside the registry's `match-recompute` NO-verdict evidence, but appeared nowhere in this file, so a reader asked to confirm "still OPEN" had nowhere to look. **This bullet is that target.** Substance: `match.py`'s `_get_recompute_lock` is process-local (an in-memory `dict[str, asyncio.Lock]`), NOT distributed, and there is no unique constraint on `match_batches` — so it bounds the single-process race but does not serialize across worker instances. Unproven ⇒ no-retry, which is why `match-recompute` is a NO.

**Deferred by decision (own phase, own soak):**

- **D-03 — server-side request cancellation in the analytics service.** A retry on any of the four heavy analytics budgets (`bridge` 15 s, `simulator` 15 s, `portfolio-optimizer` 15 s, `optimize-weights` 30 s) adds a **second concurrent full compute while attempt 1 is still burning Railway CPU**, because nothing on the FastAPI side awaits `request.is_disconnected()`. Accepted as a known consequence of 141 and recorded per-entry in `seam-retry-registry.ts` so it cannot be inherited silently; also written into `docs/runbooks/seam-breaker.md`, because during a degradation it is a live contributor to the CPU saturation rather than a red herring. Closing it is its own phase with its own soak.

**D-16 follow-ups** (the denominator/numerator repair itself LANDED in 141.1-08 — these are its residuals, not a re-booking).
⚠️ **Re-framed 2026-08-01: D-16's DENOMINATOR half no longer exists.** Phase 141.2 / D-02 deleted the distinct-`correlation_id` dedup outright (it was wire-steerable, silently truncated at PostgREST `max_rows`, and collapsed nothing on real traffic — 42/42 production rows carried distinct server-minted ids), replacing it with an attempt-grained server-side COUNT. The three residuals below are kept because **all three are about the NUMERATOR or the release record, not the dedup**; nothing here schedules work on deleted code. Read "D-16" in them as "the 141.1-08 flag-monitor repair", not as the dedup:

- **(ii) Post-repair recovered-retry visibility residual.** Now that the numerator *can* fire, a transient failure that fails then succeeds on attempt 2 emits no Sentry error event — so the repaired alert still under-counts degradation, in the direction of silence. Follow-up: a warning-level capture on retry exhaustion plus a numerator widening to match. (Note this is the *only* form in which the review's original "retries suppress the alert" premise is true; as originally stated it was moot, because the alert had never fired at all.)
- **(iii) Confirm the first real process-key event's `transaction` form.** The scoping term `transaction:/process-key` is **derived** from the FastAPI `APIRouter(prefix="/process-key")` plus its bare mount — not observed in the index (the 90-day probe saw no process-key-shaped transaction at all). When the first process-key-origin error is indexed, verify the SDK's actual transaction string (it may take the `POST /process-key` form) and correct the term. Until then the numerator is correctly scoped but **unproven**.

**Still-open carry-forwards from the phase's own `deferred-items.md`** (all four items;
02-B and 09-A were added here at phase verification, which found this list and that file
disagreed):

- **DEF-141.1-06-A — the counting arm's FALL-THROUGH exit is still unlogged.** 141.1-06 gave the arm's `continue` (retry) exit a voice, deliberately worded "retrying" so it can never be misread. The fall-through covers **two different operator facts** — the D-01 `Retry-After` fail-fast and a last-attempt surrender — and neither is logged, so in production they remain **mutually indistinguishable**. Not a regression (it was silent before too); left rather than half-done, because one sentence covering both would report neither, which is the over-claim class this phase existed to remove. Closing it needs two distinct sentences, and the fail-fast one arguably belongs with the D-01 surface. Recorded in the runbook as a known gap so on-call is not misled by the absence of a line.
- **DEF-141.1-02-B — `teaser`'s NO evidence overstates two of its three named writes.** It says each call writes a new `strategy_verifications` row "plus a NEW `public_token` and a NEW lead". Traced: the SV row is real; `public_token` is an UPDATE onto that **same** row, not a third write; the "lead" is a PostHog event (ADR-0023 §3), explicitly not a DB row — the route's own `@audit-skip` comment says so. Pre-existing text, outside the D-03…D-06 buckets 141.1-02 discharged, and the imprecision errs **conservative** (it overstates the write surface), so it cannot authorise a wrong retry. Verdict unaffected — `teaser` stays NO on the uncontested first item. Prose-only fix.
- **DEF-141.1-09-A — two runbooks are indexed nowhere.** `docs/runbooks/` holds 26 runbooks + README; `sfox-go-live.md` and `flipretry-derived-equity-go-live.md` appear in no index. Both are go-live procedures — the class most likely to be needed under time pressure by someone who does not know the filename — and the README presents itself as the entry point, so a reader who trusts it will not find them. Needs a category call (the README has no "Go-live" section), not just two rows. Documentation discoverability only, not user-facing.

### v1.16 Phase-141.2 (SEAMFIX) — known limitations, residuals and class censuses (added 2026-08-01)

141.2 closed the 13 verified findings of the 141.1 xhigh review. **"Closed per their dispositions", not "all 13 fixed in code":** twelve were remediated in code or prose; **finding 8 was DISPOSITIONED — accepted, documented, booked — and its mechanism is still live** (entry 2 below). The items here are the limitations and out-of-fence classes the phase deliberately did not fix; none is user-facing or data-integrity, so none clears the founder blast-radius bar. Advisory-gate language throughout: the new pins **would have caught** these regressions, nothing in CI *did* stop them.

2. **FINDING 8 RESIDUAL — DISPOSITIONED, NOT REMEDIATED. The retry→limiter amplification is STILL LIVE.** A granted retry spends a second token of both `/process-key` limiters, including the platform-wide ceiling that is one shared bucket for every caller; draining it refuses the anonymous teaser and the CSV path, neither of which retries. The breaker structurally cannot contain it — `seamBreakerVerdict` classifies `429` caller-throttled and non-counting — and **no signal covers a ceiling drain at all**, because a 429 is refused above the audit write, so neither the breaker nor the flag-monitor denominator advances. **No limiter code was written and no constant moved.** What changed is exposure, not mechanism: post-D-01/D-03 the retry-eligible population is `onboard`-with-a-key only, and `resync` — just under half of all `/process-key` traffic ever recorded, per the 2026-08-01 production audit history — no longer retries, so the worst case applies to an order of magnitude less traffic. Recorded in the `retriesForFlow` docblock in `seam-retry-registry.ts`. *Re-raise if:* a new YES flow verdict lands, `resync` is re-granted, or `RetrySafeEntry.retries` widens past one. **Supersedes H1 above**, which named the same mechanism before it had been measured.
3. **D-01 FOLLOW-UP — a CLIENT-MINTED stable idempotency key.** 141.2 made `onboard`'s retry conditional on the key it already had (`retriesForFlow` refuses a retry when `context.wizard_session_id` is falsy, using `Boolean()` to byte-match the Python truthiness gate). The better end state is to make the antecedent unconditionally TRUE rather than conditionally checked — and it is the same key `resync` would need to earn its grant back. Rejected in-phase on blast radius: it changes the cross-seam contract and the `strategy_verifications` uniqueness semantics, which is more than a defect fix should carry. Needs its own decision, not an inference from the registry entry.
4. **CLASS — unbounded `.select()` on unbounded-growth tables (7 remaining sites).** **Still open:** PostgREST caps an unbounded select at 1000 rows and still answers HTTP 200 with `error: null`, so these chains truncate silently once their table passes 1000 rows: the two cron enqueue sweeps (`sync-funding`, `reconcile-strategies`, which would fund-sync or reconcile only the first 1000 strategies while reporting the truncated number as truth), `allocator/scenario/commit`'s holdings recompute, the `queries.ts` discovery aggregates, and the marketing page's headline AUM sum; `cron/cleanup-ack-tokens` caps its DELETE's RETURNING body, so its reported deletion COUNT is wrong (not the deletion). The highest-risk site, `api/benchmark/btc`, was closed by Phase 169.2. The fix is the same three-way choice each time (COUNT / `.range()` pagination / an explicit `.limit()` that says so). The 7 was never itemised site by site, so re-measure the census before relying on it.
8. **`Boolean()` does NOT byte-agree with Python's `bool()` for empty JSON collections — the docblock says it does.** Found by the ship red-team pass. `seam-retry-registry.ts` `retriesForFlow` gates on `Boolean(context?.wizard_session_id)` and its docblock claims "the same truthiness predicate the Python gate uses" (`process_key.py`'s `bool(body.context.get("wizard_session_id"))`). True for `null` / `undefined` / `""` / `0` / `false` — the empty-string case it explicitly names is genuinely correct. **False for `[]` and `{}`**: truthy in JS, falsy in Python. A context carrying `wizard_session_id: []` would grant the retry TS-side while Python falls to `… or str(uuid.uuid4())`, mints a fresh session per attempt, skips the duplicate pre-check, and inserts a second draft `strategy_verifications` row — the exact harm D-03 withdrew resync's grant over. **Unreachable at HEAD**, which is why it is logged and not fixed: `retriesForFlow` short-circuits to 0 for every flow but `onboard`, and `onboard`-through-`postProcessKey` has one producer (`finalize-wizard`), whose context is a hand-listed allowlist of validated scalars plus a `wizardSessionId` read off a uuid DB column. Fix when touched: `typeof context?.wizard_session_id === "string" && context.wizard_session_id.length > 0`. Founder call 2026-08-01: ship as-is, the surface is well tested. *Re-raise if:* a second `onboard` producer appears, or any context field stops being an allowlisted scalar.
9. **`hasContractualWait`'s docblock contradicts itself on the HTTP-date form.** `resilient-fetch.ts` states "A date-form wait is a contractual wait like any other and fails fast; there is no deliberate gap here to work around" two lines after correctly noting that no `Date` header yields null. `retry-after.ts` returns null when `Date` is absent, so a date-form 503 WITHOUT a `Date` header does not fail fast — it retries. Harmless in practice (HTTP/1.1 origins must send `Date`; our own emitter uses delta-seconds), but the gap is real and the sentence denies it. Prose-only, below the bar.
10. **The denominator's "attempt over attempt" caveats miss a third class.** `flag-monitor/route.ts` names attempts refused above the audit write (429/401) and lost fire-and-forget writes. A seam attempt failing at the TRANSPORT layer (deadline, refused connection) can produce a Sentry event with no audit row in the window — numerator up, denominator flat. Same safe direction as the lost-write caveat, but unnamed.

### v1.16 SEAM-group close-out — live-ops items still owed (added 2026-08-01)

Booked when the SEAM group (140 → 141.2) had its phase-close bookkeeping run in one
pass. Everything else from those eleven phases is now closed; these need a human with
live access, so they cannot be planned around.

1. **⚠️ FOUNDER/OPS OWED — Phase 140's only `human_verification` item, never dispositioned.** "Watch Sentry during the next real Railway degradation window: confirm `CIRCUIT_OPEN` 503 envelopes appear and that no cascade-500s occur in the same window." Expected: `breaker:railway` trips against the LIVE Upstash, seam callers receive 503 `CIRCUIT_OPEN` + `Retry-After`, and no route emits a raw 500. **Not closable from the repo** — there is no live Upstash in CI/local (20+ test files delete the env vars) and no controllable Railway failure injection; declared manual-only in `140-VALIDATION.md`. `140-VERIFICATION.md` therefore still reads `human_needed` for this one reason, and that is correct, not a defect. *Close it opportunistically the next time Railway degrades.*

### v1.16 Phase-142 (JOB) — deferred items (added 2026-08-02)

2. **`.claude/agents/migration-reviewer.md` invariant #14 contradicts the repo's actual `BEGIN`/`COMMIT` convention.** The reviewer doc forbids `BEGIN`/`COMMIT` in migrations; **150 of 231 migrations use them, including the repo tip**. Per Rule 11 (conformance over taste inside the codebase) and Rule 7 (pick one, don't blend), Phase 142 followed the repo and pre-documented the deviation in its own migration header so review would not re-litigate it — but that is a per-migration workaround, and every future migration author hits the same contradiction and pays the same cost. The doc is the artifact that is wrong. Fix = update invariant #14 to match the repo (and say what `ROLLBACK` outside `supabase/tests/` still means, which is the part that IS enforced). Documentation-only, no runtime surface.

### v1.16 Phase-142.1 — planning residuals (added 2026-08-02, at plan time — NOT execution findings)

Items 1–5 and 7 were raised by the `gsd-plan-checker` across three verification rounds on 142.1's
plans. **None of those clears the founder blast-radius bar** — all are documentation-rationale or
comment-coverage. Logged here so the next reader does not mistake their absence for oversight. W-1
and W-2 were folded into plan `142.1-05` before execution and are recorded as discharged.

⚠️ **Item 6 (`D-19`) is different in kind and the section heading does not cover it: it is an
EXECUTION finding, not a planning residual** — a real defect found by running the gate against TEST
on 2026-08-02, already fixed on this branch, with a live PROD residual that must be closed at merge.
Read it as such.

1. **⛔ `DEF-142.1-08` — D-08 was CUT from Phase 142.1, and must not be closed by bumping a
   literal.** The finding: `test_main_worker.py:1295`'s `assert len(TIMEOUT_PER_KIND) == 15`
   couples every future job-kind addition to the reaper suite, and the cheapest way to green it is
   to bump the literal WITHOUT the re-derivation the assertion message demands — the trip-wire
   trains the exact behaviour it exists to prevent. It was cut because **no derivation source
   exists for the proposed replacement**: `grep -rn "STRATEGY_SCOPED\|_SCOPED_KINDS\|ALLOCATOR_KINDS"`
   over `analytics-service/` returns **zero hits**, so there is no machine-readable
   strategy-scoped/allocator-scoped partition to assert against. Both remedies are bad — a
   hand-maintained `frozenset` beside `TIMEOUT_PER_KIND` **re-imports D-08's own complaint one
   level up**, and deriving from the `compute_jobs` enqueue surface (which kinds are ever enqueued
   with a non-NULL `p_strategy_id`) is a genuine derivation but materially larger than a
   remediation phase should carry. ⚠️ **There is also a live convention conflict:** the GSD
   VALIDATION template's Oracle Independence checklist requires *"Table/registry sizes are pinned
   to a **literal count**, not to `len(THE_TABLE)`"* — which is precisely the form D-08 argues
   against. That conflict deserves its own decision on the merits, not a drive-by change. ⛔ **Hard
   rule: never close this by bumping the literal to 16.** That is the exact behaviour the trip-wire
   exists to prevent, and it is why the item was raised. Confirmed unchanged at 142.1 execution time
   (`test_main_worker.py:1295` still asserts `len(TIMEOUT_PER_KIND) == 15`) — Phase 142.1
   deliberately implemented no part of D-08.
2. **W-3 — inverted arm D's determinism rests on an unpinned assumption.** The D-11 companion cron
   arm's `LIMIT 25` has no `ORDER BY`, so the inverted arm-D assertion is deterministic only while
   fewer than 25 foreign `(computing, NULL, no-active-job)` rows exist on the shared TEST project.
   Plan 142.1-05 requires the GATE-DETERMINISM NOTE in prose but — unlike plan 03's header
   assumption, which carries an acceptance grep — pins it with none. Add acceptance greps on both
   the migration side and the gate side when either is next touched.
4. **W-5 — gate-file comments owned by no task.** In
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`: the file header (`:5`
   "Guards migration 20260802120000", `:111` "Run order"), the Part-2 arm summary at `:263`, and
   `:380`'s "arm D: the writer-bug skip rule". Plan 05 step 9 names only `:332-336` and `:390`.
   After 142.1 these comments describe a superseded migration and a superseded arm-D semantics.
   Comment rot only.
5. **W-6 — `142.1-RESEARCH.md` § "Architecture Patterns" still carries the superseded
   `BEFORE INSERT OR UPDATE` trigger sketch verbatim.** Every consuming plan carries an inline
   ⚠️ supersession note in `read_first`, and CONTEXT § D-18 Part 1 states the supersession — but
   the research document itself is never annotated, so a reader who opens it first gets the wrong
   shape. One banner line fixes it.
6. **⚠️ `D-19` — the reaper's `LIMIT`-25 bound is restored on THIS BRANCH ONLY; the PROD cron body
   still carries the unbounded shape until it merges.** Found by the first end-to-end run of
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` against TEST (phase 142.1
   plan 07 / D-16). Part 3 arm E: 26 seeded stranded rows, **zero** foreign competitors, one tick
   terminalized **26 of 26** — expected 25. Cause: both arms bound their batch through
   `WHERE strategy_id IN (SELECT … LIMIT 25 FOR UPDATE SKIP LOCKED)`; `FOR UPDATE` makes the subplan
   un-hashable, so the planner attaches it as the inner side of a nested-loop semi-join and
   **re-executes it once per outer row**, applying a fresh `LIMIT` each time — the cap is
   per-rescan, never global (measured on PostgreSQL 17.6). Fixed by
   `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql` (commit `2b8c016f`),
   which forces single evaluation of the bounded batch on **both** arms; verified on TEST before the
   migration was written (`failed=25`, `still_computing=1`, the 26th survives) and the gate re-ran
   green after. ⚠️ **A FROM-clause subquery form was ALSO measured and ALSO reaps 26 of 26** — the
   planner is equally free to nest-loop it, so forcing single evaluation is load-bearing, not
   stylistic; do not "simplify" it away. **Impact is a LOCK-DURATION and BLAST-RADIUS defect, NOT
   data corruption** — the rows are genuinely stranded (>16 h, no active job), but unbounded, one
   `*/15` tick against a backlog of N terminalizes all N in one statement and holds row locks on all
   N, on a table every live analytics write touches. **RESIDUAL / ACTION:** ⛔ the migration is
   applied to **TEST only** (stamped `20260802212852`). PROD's registered cron body is still the
   unbounded shape until `feat/v1.16-142-146-job-rate` merges to `main` and the auto-apply runs.
   **The merge-time PROD verification must re-confirm the deployed body carries the bound as TWO
   single-evaluation batches — one per arm — not just that the `LIMIT` token is present.** That
   token-presence check is exactly what every gate in phases 142 and 142.1 passed over. Class census
   at discovery: of the 8 registered cron jobs, only `reap_strategy_analytics_stuck_computing` puts
   a `LIMIT` inside an `IN (…)` subquery; the other seven carry no `LIMIT` at all — the class is
   closed at one member, so no sweep is owed.
   **✅ CLOSED 2026-08-03 (post-merge QA, PR #659 in `main`):** the merge-time PROD verification ran
   read-only against `khslejtfbuezsmvmtsdn` and the deployed `cron.job.command` carries the bound as
   required — NOT by token presence but by shape: the full body was read and eyeballed; each arm is a
   single-evaluation `WITH batch AS MATERIALIZED (SELECT … LIMIT 25 FOR UPDATE SKIP LOCKED) UPDATE …
   FROM batch`, the `AS MATERIALIZED` count is exactly 2, and no `IN (SELECT … LIMIT` shape remains.
   Job registered `*/15 * * * *`, `active=true`. Bonus: the deployed body includes the non-destructive
   clock-start companion arm for `(computing, NULL-stamp)` rows, which also closes 142-VERIFICATION
   Gap 3's deploy-ordering observability window. PROD stuck-`computing` census at check time: **0**.

8. **WR-01 — a D-19 self-verify guard that provably cannot fire (dead guard, NOT a hole).**
   `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:188` asserts
   `v_command ~* 'IN\s*\(\s*SELECT[^)]*LIMIT'` to ban the un-hashable-subplan shape D-19 removed.
   `[^)]*` cannot cross a `)`, and BOTH arms carry `AND NOT EXISTS ( SELECT 1 … cj.status IN (…) )`
   between `IN (SELECT` and `LIMIT` — measured against the exact superseded body: **no match**. The
   bound is still genuinely guarded by the `v_mat <> 2` MATERIALIZED-count check immediately above
   it (that one fires, and fails closed on formatting drift), so this is redundancy, not exposure.
   ⚠️ **Deliberately NOT fixed in place:** `20260803130000` is already applied to TEST (stamped
   `20260802212852`), and editing an applied migration is itself a tracked invariant violation
   (migration-reviewer #11) — desyncing TEST's applied text from the file to repair a *redundant*
   guard is the worse trade. Close it in the NEXT forward-only migration that touches this job, or
   by asserting something that can actually fire (e.g. `FROM batch` occurring exactly twice).
   Danger if left unread: the guard's `RAISE` text is what the next engineer will read as proof the
   broken shape is banned. Found by migration review, 2026-08-03.

9. **WR-02 — the `awk`-range hazard recurred in the gate file, and a SUMMARY over-claims it closed.**
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:16-18` explains that its final
   part is named descriptively *because* its acceptance gate is an `awk '/Part 6/,0'` range. Plan
   `142.1-05` (a different wave) then mentioned that literal twice in the Part 4 header, so the range
   now starts at `:595` and sweeps Parts 4–6 instead of Part 6 alone. **The measured value is 0
   either way, so there is no false green** — the exposure is that `142.1-08-SUMMARY.md:304` records
   the hazard as closed when it is not. Fix: anchor the criterion on `^-- Part 6 --`, which matches
   exactly once. Worth reading as a pattern rather than a nit: this phase was bitten by `awk` range
   semantics **three separate times** (plans 05, 08, and here), always because prose *about* a gate
   sits inside that gate's blast radius. Found by code review, 2026-08-03.

### v1.16 Phase-142.2 (MT5 on the unified backbone) — deferred items (added 2026-08-04)

Booked at phase close (plan `142.2-08`). ⛔ **Read the boundary first: 142.2 delivered MT5
*reachable and honest* — the connect flow works and its rejections name their true cause. It did
NOT verify that MT5's rendered performance NUMBERS are correct.** That is Phase 142.3 (MT5-06..10,
decisions D-07..D-11), against the live terminal on a trading day. Nothing below, and no artifact
of 142.2, may be read as evidence of MT5 number-correctness.

None of these clears the founder blast-radius bar as blocking. Each names its source decision.

1. **`DEF-142.2-01` — MT5 broker-server typeahead (D-04). ⛔ NOT a simple UI task: there is no data
   source.** The field ships as plain text (now legible rather than dot-masked, MT5-03) plus the
   helper copy at `ConnectKeyStep.tsx:144` ("copy the server name exactly as it appears in your MT5
   terminal") — which is the only reliably correct instruction we can give. **The blocker is data,
   not UI.** `grep` for `broker_server` / `server_name` across `.py`/`.ts`/`.tsx` returns **zero
   hits repo-wide**, and there is no public canonical registry of MT5 broker server names. Three
   candidate sources were considered and rejected: (a) **curated static list** — rots silently as
   brokers add/rename servers, and the field must stay free-text anyway, so the list can only ever
   be a hint; (b) **learn-from-successful-connections** — empty until MT5 has real users, and it
   leaks one user's broker choice to every other user; (c) **public registry** — does not exist.
   ⚠️ A *partial* list is worse than none: it invites picking a near-match that then fails
   validation, which is precisely the confusing-rejection class this phase just closed. Re-open
   only with a named, maintainable data source attached.
4. **`DEF-142.2-04` — ccxt/perp verdict refinement is blocked on the ingestion truncation bugs,
   deliberately.** `combine_realized_and_funding` stamps `fill_derived_unproven` **always — a
   constant, not a computation**. A data-driven refinement (stamp `ledger_complete` when realized
   records provably span the series) would newly **ADMIT** exactly the accounts a silent-truncation
   bug makes look healthy. Fix the known truncating inputs first — the **OKX bills paginator** and
   the **bybit funding cursor**, both already booked under § Money-path correctness — then revisit.
   Order matters: refining first would publish understated track records with a certified verdict.
5. **`DEF-142.2-05` — `_LEDGER_BACKED_SOURCES` → `adapter.fetches_fills` (optional follow-up).**
   `analytics-service/services/ingestion/long_fetch.py:63` still holds a venue literal set. ⚠️ It is
   **NOT** the set MT5-12 deleted and must not be removed: it answers an **adapter-capability**
   question (does this adapter implement `fetch_raw` / `compute_fingerprint` /
   `reconstruct_positions`, or does it raise `NotImplementedError` by design?), which is legitimately
   a venue property. The TypeScript mirror was the trust judgement, and that one is gone. Turning
   the ingestion set into a property on the adapter that already knows the answer would remove the
   last venue literal; it is cheap, and **not required by the MT5-12 invariant**.
7. **`DEF-142.2-07` — Deribit `twr_chain_broken` tightening: FOUNDER DECISION, with the census
   number attached.** Plan 03 shipped the **behaviour-preserving** default — deribit keeps
   `ledger_complete` on **both** return paths even when `meta` carries `twr_chain_broken`.
   Tightening it (stamp a non-admissible verdict when the chain is broken) is a real option, and the
   read-only PROD census that governs it was run in plan 04: **deribit rows carrying
   `twr_chain_broken` = 0 — total AND published** (1 row carries the flag on a non-deribit venue).
   **So tightening would affect nothing today.** ⚠️ Not decided by the phase, on purpose — it is a
   trust-policy call, not an implementation detail. **Remedy rule if it is ever tightened: affected
   series get a RE-DERIVE, never a backfill `UPDATE`** (see item 9 for why).
8. **`DEF-142.2-08` — renaming `csv_daily_returns`.** The table is the canonical daily series for
   **every** producer (keyed derive, composite stitch, CSV upload), so the `csv_` prefix now names
   only one of three producers. Cosmetic relative to the MT5-12 invariant, which is satisfied by the
   verdict column regardless of the table's name. Low value, non-trivial blast radius; do it only if
   the table is being touched for another reason.
9. **`DEF-142.2-09` — the Pitfall-6 healing population. ⛔ NEVER a backfill `UPDATE`.** **Still open
   (PROD read 2026-11-14, marker first):** 19 of 45 `strategy_analytics` rows still carry
   `series_completeness IS NULL`, and the gate (wizard `SyncPreviewStep`, admin approve) is fail-closed on
   NULL, so it refuses each such strategy's next preview or approval until its series is re-produced:
   RE-DERIVE a keyed strategy (`derive_broker_dailies`), RE-RUN `compute_analytics_from_csv` for a keyless
   CSV one (no derive or stitch ever runs for it), RE-STITCH a composite. A NULL cannot un-publish anything
   already live. ⛔ A backfill `UPDATE` would fabricate a trust claim about series whose inputs were never
   examined.
11. **`DEF-142.2-11` — `EquityChart.tsx:1119` `react-hooks/exhaustive-deps` warning
    (`useMemo` missing dep `period`).** Pre-existing, untouched by 142.2, recorded by plans 02, 06
    and 07 as the sole output of `npm run lint` (0 errors, 1 warning). Batch it with the next edit to
    that file.
15. **`DEF-142.2-15` — the six code-review findings deferred by founder scope call (2026-08-04).**
    All six cleared the *stopping rule* bar (none user-facing, none data-integrity), which is why
    they were not fixed alongside the four that were. Recorded here so the deferral is a decision
    with a record, not an omission. Batch them with the next edit to each file:
    - **(a) `analytics_runner.py:1564` — `_stamp_user_supplied` infers "not broker-sourced" from a
      null `api_key_id`, which `ON DELETE SET NULL` also produces.** Delete an API key, and a later
      recompute stamps `user_supplied` on a series that was actually broker-derived — overstating
      how the numbers were obtained. Needs a structural check, not a null test.
    - **(b) `broker_dailies.py:524` — `nav_gap_days` reindexes over the FULL span,** so leading and
      trailing gaps count the same as interior holes. An sFOX account whose NAV history simply
      starts later than the requested span is stamped `sampled_gapped` with no interior holes, and
      is refused. Should count interior-only.
    - **(c) `analytics_runner.py:1500` — the composite exclusion rests on the `existing_flags`
      `'composite'` marker, not structural identity.** If that flag is ever cleared or rebuilt
      without the key, a composite recompute stamps `user_supplied` and erases the
      machine-stitched-vs-human-uploaded distinction.
    - **(e) `broker_dailies.py:91` — only ONE of the three producer paths validates its stamp
      against `SERIES_COMPLETENESS_VALUES`.** The other two can emit an unregistered string. Drift
      direction is fail-closed (an unrecognised verdict refuses), so this is a missing loud signal
      at the producer, not a live money bug.
    - **(f) `broker_dailies.py:91` + `strategyGate.ts` — the verdict list is hand-maintained in
      BOTH Python and TypeScript.** ⚠️ **Do not "fix" this by importing one from the other** — the
      duplication is deliberate (producer set vs admissibility policy) and documented in the
      migration comment. The hygiene item is drift *detection*, not de-duplication.

⚠️ **Cross-reference, do NOT duplicate:** the anon-readable `strategy_analytics` splat that plan
04's A2 check re-confirmed (`anon` holds `SELECT` on `series_completeness`, as it does on every
column of that table) is already booked above under § Security — *"`strategy_analytics (*)` splats
every analytics column to anon on two public paths"* (commit `d935fa61`). The new column adds no
new exposure class: it is an enum carrying no magnitude, and protecting one column while the splat
stands would secure nothing.

### v1.16 milestone human-audit QA sweep — authed-browser + PROD probes (added 2026-08-03)

Run via /qa over the open GSD human-verification items of phases 140→142.1 against live PROD
(authed browser as `qa-demo@quantalyze.app` + read-only Supabase/Upstash probes). Discharged that
day: D-19 PROD cron body (see ✅ on the 142.1 item 6 above), PROD stuck-`computing` census = 0,
TEST reaper cron registered/active, 140.1 index shape on PROD correct
(`strategy_verifications_strategy_wizard_session_uniq` present, old index gone), 141.2 audit
numbers re-confirmed (42/42/0 `wizard:`-prefix; resync 20/42; five breaker keys still ABSENT),
wizard AUTH_FAILED arm renders named+actionable copy with Retry/Diagnostics and clean diagnostics
(`code` + `correlation_id` only, no internals), teaser `/api/verify-strategy` rejection envelope
carries `human_message` end-to-end and the TS-17 client fix (`human_message` read first) is live.
New findings, none clearing the founder blast-radius bar as blocking:

5. **Validation-rejected keys leave no audit trail (observation, decide-only).** A failed wizard
   key validation (AUTH_FAILED) writes no `audit_log` `process_key` row — audit starts only when
   a key enters processing. Consistent with current design; recorded so the 141.2 audit censuses
   are read correctly (they count processed flows, not attempts). No action unless rejected-attempt
   telemetry is wanted beyond Sentry.

### Phase 147 (SCEN-01) class-closure audit — `getPortfolioStrategies` consumers (added 2026-08-05)

Phase 147 fixed FOUR readers that selected only `strategy_analytics.daily_returns` and therefore
saw `null` for every API-ingested strategy (whose track lives in `returns_series` as a cumprod
wealth index). Plan 147-06 T3 ran the class-closure audit over `getPortfolioStrategies` — the
query already selects BOTH columns (`queries.ts:1305`), but a *consumer* reading only
`daily_returns` would still strand the series. **Grep, log, do not fix** (orchestrator ruling —
these are outside the phase's locked scope).

**Audit result: 0 bare consumers.** Commands run against `HEAD`:

```
grep -rn --include="*.ts" --include="*.tsx" "getPortfolioStrategies" src/ | grep -v "\.test\."
  → 3 consumers: portfolios/[id]/page.tsx, .../manage/page.tsx, .../documents/page.tsx
grep -n "daily_returns\|returns_series" <each consumer>
  → zero `daily_returns` reads in all three
```

None of the three touches `daily_returns` at all — they read the scalar metrics
(`cagr`/`sharpe`/`max_drawdown`/`sparkline_returns`) via `extractAnalytics`. The bare-reader class
is closed there. Two adjacent findings were surfaced by the audit and are booked, not fixed:

3. **`DEF-147-C` — `queries.my-allocation.test.ts` mock returns fixtures wholesale instead of
   projecting to selected columns.** The mock (`:267-272`) records the select string but hands back
   the full fixture regardless, so narrowing the `getMyAllocationDashboard` embed back to bare
   `daily_returns` would NOT redden that behavioural file (unlike `returns/route.test.ts:296-308`,
   which projects as PostgREST does). Not a phase gap: the 147-04 SC-1 ledger mutation targeted the
   resolver-call argument (falsifiable in that harness), and the select-width regression is held by
   the phase-147 gate's Layer B (verifier confirmed RED under exactly that mutation). Test hygiene
   only (2026-08-05, booked from 147-VERIFICATION.md).
   **Fix shape:** make the mock's `maybeSingle`/embed resolution project to the columns named in the
   recorded select string, mirroring the returns-route harness.

### Phase 148 (OWN-04) — two in-wizard link-style divergences from the UI-SPEC treatment (added 2026-08-05)

**`DEF-148-B` — the two pre-existing `target="_blank"` links in the wizard tree do not match the
now-authoritative link treatment shipped by OWN-04.** Logged only; deliberately **NOT** fixed in
phase 148 (out of the task's blast radius — Rule 3 / phase-148 orchestrator ruling).

The OWN-04 link (`SyncPreviewStep.tsx`, `ViewFullFactsheetLink`) follows 148-UI-SPEC:122/126:
`underline underline-offset-4` (persistent) + `rel="noopener noreferrer"`. Two older siblings
diverge, each in a different way:

| File:line | Divergence | Why the UI-SPEC treatment is the correct one |
|-----------|-----------|----------------------------------------------|
| `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx:257` | `className="text-accent underline-offset-4 hover:underline"` — underline appears on **hover only** | It is an inline link inside body prose (`<p className="text-caption text-text-muted">Wizard help · …`), distinguished from the surrounding text by the accent teal ALONE until hover. That is the exact `link-in-text-block` shape DESIGN.md's 2026-06-28 decision ruled a WCAG 1.4.1 failure and remediated on `/security`; this instance was not swept in. |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:662` | `rel="noopener"` — no `noreferrer` | `noopener` alone closes the reverse-tabnabbing hole but still leaks the full wizard URL (including the draft strategy id path) as `Referer` to `/security`. Same-origin here, so the exposure is low — which is why this is logged, not escalated. |

Fix shape if taken: one sweep, both files, plus a check for any third instance
(`grep -rn 'hover:underline' src/app/(dashboard)/strategies/new/wizard/` and
`grep -rn 'rel="noopener"' src`) — a point-fix of these two would leave the class open.
⚠️ Scope caveat: DESIGN.md's persistent-underline rule applies to **body-prose links only**; nav
links, button-styled links, and card links keep their existing hover treatment, so a blanket
`hover:underline` purge would be wrong.

### Phase 149 (NAV-01, `/my-strategies`) — deferred items (added 2026-08-05)

All three were routed out of phase 149 by ruling, not by omission. None is user-blocking: the
surface ships fully functional with each of them open.

**`DEF-149-B` — two live surfaces now render an `h1` reading "My Strategies".**
The manager surface `/strategies` and the allocator surface `/my-strategies` share the title. This
is **benign at runtime** — they are role-disjoint (the allocator never sees `/strategies`, gated by
`requireRolePage`) and the sidebar entries differ. It is a TEST-AUTHORING landmine (research
Pitfall 10): any future unit/e2e selector written as a bare `getByRole("heading", { name: /my
strategies/i })` or `page.getByText("My Strategies")` can silently bind to the wrong surface and
still pass. **Convention going forward (not a code change):** scope every selector for either
surface by route, `href`, or `data-testid` — never by bare heading text. The phase-149 Sidebar
cases already do this (`a[href="/my-strategies"]`).

**`DEF-149-C` — `StrategyGrid` card links dead-end for any FUTURE owner-scoped grid consumer.**
`StrategyGrid.tsx:52-53` builds `${basePath}/${categorySlug}/${s.id}`, which resolves through
`getStrategyDetail` (`queries.ts:776`) → `withPublishedOnly` (`queries.ts:833`) → `notFound()`. For an own
unpublished row that is both a dead end and an existence oracle. Phase 149 resolved it by making
grid **unreachable** on the owner surface instead — the `effectiveViewMode` derivation forces
`"table"` and `showViewToggle` hides the toggle (founder ruling; RESEARCH had recommended the prop
instead). Both halves are pinned (gate pin 7 + `StrategyTable.visibility.test.tsx`). **The debt is
latent, not live:** it becomes real the moment any surface passes
`visibility="owner-all-statuses"` *and* wants grid view. **Fix shape then:** a `rowLinkMode` prop
(`"category-detail" | "factsheet"`) threaded from `StrategyTable` into `StrategyGrid`, defaulting
to today's category-detail form, plus a `StrategyGrid.test.tsx` case pinning the `/factsheet/{id}`
href under the owner mode. Note the grid carries a second owner-surface problem that the
toggle-hide also defers: `StrategyGrid.tsx:79-82` renders `VerifiedBadge` with
`trustTier={s.trust_tier}`, which is null by construction for an unpublished row.

### Phase 162 (HONEST) — plan 162-08 filings (added 2026-08-26)

Five items. Two are live data left unrepaired because plan 162-08 could not reach the PROD
write lane; one is a founder scope call; two are hygiene. Evidence for all five:
`.planning/milestones/v1.20-phases/162-honest-what-the-user-sees-is-true/162-CENSUS.md` (§Recompute — NOT
EXECUTED, §str/None follow-through, §Discovery observation).

- [ ] **Two `strategy_analytics` rows still render raw exception prose, and their only
      re-write path is a dead job kind.** `ec722557-7781-44db-8f2c-edbe252957c0`
      (`pending_review`) and `8581f739-1a7b-42a4-a209-3acfa327e259` (**published**) each carry
      the bare 59-character `str`/`None` `TypeError` text in `computation_error`. Plan 162-02
      fixed the *writer*, so no NEW row can leak this shape — but it cannot rewrite these two,
      and plan 162-08's repair enqueue was blocked by the same credential denial above.
      Disposition recorded as *awaiting-next-write*, with the caveat that makes it nearly
      permanent: their only failing kind, `poll_positions`, has not been enqueued anywhere in
      PROD since **2026-06-14**, so there may be no next write. The published one is a live
      surface.
- [ ] **Retired job kinds still carry a live daily enqueue that has fired nothing since
      2026-06-14 — dead code, low priority.** `enqueue_poll_positions_for_all_strategies`
      exists at HEAD (`analytics-service/main_worker.py:1026-1036`) but no `poll_positions` job
      has been created in PROD since 2026-06-14. Same family: `compute_analytics` is *retired*
      (30 PROD rows, 100% `failed_final`, **zero successes ever**), superseded by
      `compute_analytics_from_csv` + `derive_broker_dailies`; its enqueue RPC actively rejects
      the kind (`20260716090000_retire_compute_analytics_kind_rpc_guard.sql`). ⛔ **File this
      as dead code, NEVER as an outage.** ⚠️ Load-bearing consequence, already actioned in the
      census: any decision rule keyed on "0 `compute_analytics` jobs since X" is **VOID** — it
      fires for the entire fleet, every day. One such rule shipped as the derive-gap trigger in
      the HONEST-02 decision table; the correction is now recorded in 162-CENSUS.md itself, not
      only in a sibling SUMMARY.
- [ ] **`StrategyGrid`'s sync-badge gate is one half short of the table's — guard hygiene, NOT
      user-facing.** Table: `mayClaimSyncRecency = hasComputedAnalytics && !s.is_example`
      (`StrategyTable.tsx:982-983`). Grid: `{!s.is_example && (`
      (`StrategyGrid.tsx:117`) — it has the `is_example` half and lacks the
      `hasComputedAnalytics` half. ⚠️ **Two earlier framings of this item are wrong and should
      not be carried forward.** (a) A WINDOWS.md deferral called the grid badge
      "consumer-less" — **false**: `StrategyTable.tsx:1421` renders `StrategyGrid`, and by
      founder ruling (`StrategyTable.tsx:387-398`) grid is **discovery-only**, i.e. exactly the
      public surface HONEST-03 names. (b) A later handoff said the grid badge is *ungated* —
      also false at HEAD: 162-03 landed the `is_example` half. Re-measured 2026-08-26 on the
      assembled phase branch. **Why it is nonetheless not user-visible, which is what sets the
      severity:** discovery rows pass `shapeRowAnalytics` (`queries.ts:470-474`), whose
      non-terminal-success branch returns `{...EMPTY_ANALYTICS, computation_status}` with
      `computed_at: ""` (`utils.ts:181`), so a failed/pending/computing row reaches the grid
      badge with a falsy date and renders nothing. **Guard-hygiene / defence-in-depth asymmetry
      → mid-term, not blocking**, per the founder stopping rule. ⛔ It is *not* dead code and
      *not* unreachable — deleting it on either premise would be wrong. The table's own comment
      (`StrategyTable.tsx:1149-1156`) states the client guard is kept "as well as, not instead
      of" the server blanking, because the component is mounted by three pages, one anonymous,
      "and it must not be capable of printing a sync date it cannot justify no matter who hands
      it rows." The grid is one row-source change away from printing one. **Fix shape:** extend
      the grid gate to `hasComputedAnalytics && !s.is_example` (or lift the single predicate
      into a shared helper both render paths import) and add a grid case for a `failed` row
      carrying a fresh `computed_at` — no such case exists today, so the missing half is
      currently unpinned on the grid side.

- [ ] **`.planning/WINDOWS.md` loses entries under concurrent appends — measured, with data
      already lost once.** `gsd-tools windows append` does read-modify-write over the whole
      file, so parallel wave agents clobber each other. Observed on 2026-08-26: at commit
      `e6c70ca79` the rendered table carried **three** rows numbered `id 16` while the JSON
      block — the source of truth the table is regenerated from — carried only **one**. The
      other two (162-03's `StrategyGrid` entry, 162-04's `ScenarioComposer` entry) had already
      been dropped from JSON by an earlier race and survived only as orphaned table rows; the
      next append regenerated the table and erased them entirely. Both were re-added by 162-08
      as ids 19 and 20, with their original `recorded_at` preserved in the description text —
      so nothing is lost *now*, but the mechanism is live and will bite again on the next
      parallel wave. ⚠️ Duplicate ids are the detectable symptom: `grep -o '"id": [0-9]*'
      .planning/WINDOWS.md | sort -n | uniq -d` should be empty, and the JSON entry count
      should equal the table row count. **Fix shape:** make the append atomic (lock file, or
      `O_EXCL` temp + rename with a re-read/retry loop), and derive the next id from the JSON
      max rather than a cached count. Upstream in the GSD toolchain, not this repo's source —
      but the corrupted artifact is tracked here.

- [ ] **`[164.9-LEDGER-CEILING-COORDINATED-EDIT]` the live-DB execution ledger's `ENTRY_CEILING`
      makes growth IMPOSSIBLE TO DO SILENTLY, not impossible (recorded 2026-09-21, Phase 164.9
      security audit)** — ⭐ **RECORDED AS A KNOWN LIMIT, AND IT DELIBERATELY CARRIES NO PHASE**,
      against the standing rule that only a data-integrity or user-facing gap earns one. Nothing a
      user sees changes and no row is written wrongly; what is at stake is how loudly a gate can be
      widened.
      **Owner:** whoever next edits `scripts/live-db-execution-ledger.txt` or its ceiling.
      **What is PROVEN:** the ledger is bounded from ABOVE by `ENTRY_CEILING` in
      `scripts/live-db-execution-ledger.mjs`, and bounded from BELOW by the staleness arm in
      `src/__tests__/live-db-execution-ledger.contract.test.ts`, which uses `toBe(entries)` and so
      transitively pins the exact total. A ledger that correctly shrank cannot leave the ceiling
      above it handing back room to grow.
      **What is NOT prevented:** growth itself. Appending a ledger line, bumping `# ENTRY_COUNT`
      and bumping `ENTRY_CEILING` in ONE commit passes every arm, and a real live-DB regression can
      be silenced that way. No in-repo constant can stop a determined edit. What changed is the
      COST: three coordinated, individually named lines in a diff a reviewer reads, where before it
      took one.
      **Trigger to revisit:** any commit that RAISES `ENTRY_CEILING`. A raise is the shape this
      entry exists to make visible, and the ledger is SHRINK-ONLY by design — a new failing arm is
      FIXED, not ledgered.
      ⛔ **Forbidden closure: describing this as "the ledger cannot grow".** The contract test's own
      header carries a dated correction saying exactly that, because two paragraphs in it once
      overclaimed in opposite directions. Describe it as "cannot grow by accident, and cannot grow
      without saying so".
      ⛔ **Forbidden closure: deleting the staleness arm to remove the transitive pin.** The pin is
      what makes a shrink honest; removing it re-opens the direction a bound-only-from-above control
      cannot see about itself.

- [ ] **`[164.9-CALIBRATION-NARROWS-NOT-REPLACES]` the three foreign-row calibrations NARROW
      the global assertions and MEASURE THE MARGIN; they do NOT caller-scope the deployed sweep
      (recorded 2026-09-21, Phase 164.9 review round)** — ⭐ **RECORDED AS A KNOWN LIMIT, AND IT
      DELIBERATELY CARRIES NO PHASE.** Founder decision 2026-09-21, taken against the standing
      rule that only a data-integrity or user-facing gap earns its own phase. This is neither:
      nothing a user sees changes, and no row is written wrongly.
      **What is PROVEN, by execution:** a FOREIGN row is seeded and the new assertion stays GREEN
      where the old one would have gone RED for someone else's work. Armed, and observed failing
      before it was observed passing.
      **What is NOT proven:** that the deployed sweep is caller-scoped. It is not. All three
      calibration parts disclose this in their own headers, in their own words — *"it is not, and
      cannot be without a production migration adding a run discriminator column."* No arm
      exercises the OLD assertion to show it would have reddened.
      **If it is ever closed**, the shape is a PROD migration adding a run discriminator column,
      after which the calibrations assert SCOPING rather than margin. ⛔ That authors a migration,
      so it goes through `migration-reviewer` + `rls-policy-auditor` + `silent-failure-hunter`
      before any apply, and its self-verify must be CATALOG-ONLY — a data-reading `RAISE
      EXCEPTION` applies to PROD and REFUSES on TEST, and a refused TEST apply blocks the PROD
      apply (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`).
      ⛔ **Forbidden closure: re-wording ROADMAP criterion 2 to match whatever ships.** The
      criterion carries a dated amendment naming exactly this gap; a silent re-word would erase
      the only record that the replacement half was never measured.

- [ ] **`[164.9-RPC-RETRY-NARROWED-SKIP-REOPENED]` the transport retry covers READS only, so a
      sustained RPC read-timeout reaches `pytest.skip` again on a fence assertion (recorded
      2026-09-21, Phase 164.9 review round 2)** — ⛔ **DATA-INTEGRITY-ADJACENT: the failure mode is
      a GREEN `python` job for a shared-TEST transport fault**, which is the exact outcome
      criterion 11 exists to end.
      **How it arose, and the narrowing itself is CORRECT.** The review round made the retry stop
      at the idempotency boundary: `insert`/`upsert`/`update`/`delete`/`rpc` run their terminal
      `.execute()` exactly once, because replaying a write that may already have committed is
      worse than not retrying it. `rpc` is on that list **fail-closed** — the wrapper cannot read a
      function body, so it cannot know which RPCs are read-only.
      **Why it bites here specifically.** The victims criterion 11 measured are RPC-heavy, so the
      narrowing lands on exactly the files whose 504s are its evidence, and
      `_rpc_retry_timeout`'s own 2-attempt `pytest.skip` grace is reachable again.
      **Shape of the fix:** an explicit allowlist of READ-ONLY RPC names, so a read-only RPC is
      retried and a claim RPC is not.
      ⛔ **Forbidden closure: putting `rpc` back on the retried side.** Replaying a claim RPC can
      corrupt a fence SILENTLY, which is strictly worse than a visible red.
      ⛔ **Forbidden closure: deleting or widening the `pytest.skip`.** A skip there is a green
      reading that measured nothing — the helper's own docstring argues this.
      **Destination:** Phase 164.9.1 JOBRPCTRUTH already owns the compute-job RPC surface and is
      the natural home; it does NOT earn a phase of its own (founder rule: only a data-integrity
      or user-facing gap does, and this is test-transport). Interim owner: the founder.

---

## Phase 167.1.2 (ACCOUNTTRUTH) — founder close-out decisions (logged 2026-10-11)

- **[167.1.2-DRAFT-CLASH-SAYS-SO]** (owner: the next key-connect phase; D-23). A key whose exchange account matches the user's OWN unfinished draft answers 200 `deduped` and drops the new credential without a word. Done when the connect routes refuse with a message naming the existing draft (finish or delete it first), with a test that fails on today's silent dedupe.
- **[167.1.2-ORPHAN-COPY-FIX]** (owner: the next key-connect phase; D-24). KEY_ORPHANED sends an allocator-role owner to email security instead of naming the key to Disconnect, and an owner whose only holder is an archived composite gets KEY_VENUE_ALREADY_CONNECTED while My Strategies offers "Finish setup". Done when every role is told which key to Disconnect and the archived case names the archived strategy.
- **[167.1.2-MT5-FAILING-HOLDER]** (owner: the next MT5 phase; D-25; was IN-R2-01). An MT5 key whose sign-in keeps failing can claim its account's holder slot. Done when a failing key never holds the slot and a working key on the same account takes it, with a test.

## Phase 164.6.6.2.3 (FLOWTIMING) — routed items (logged 2026-10-11)

- **[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]** (owner: a future phase; trigger: FLOWTIMING shipped). Deribit's raw log carries deposit and trade timestamps, but its P&L is not attributed to positions, so D-02's "capital at the position's open" cannot be computed and Deribit runs at FLOWTIMING's day-level rule (D-07). Research measured 9 PROD Deribit keys and 79 flow days on 2026-10-11. Done when Deribit P&L is attributed to positions and its flow days use the timed return. Founder decision FLOWTIMING-Q2, 2026-10-11.
- **[164.6.6.2.3-COMPOSITE-DAYLEVEL-NOTE]** (logged 2026-10-12, FLOWTIMING review round 1, SFH F2, MEDIUM conf 6; owner: ⭐ re-routed 2026-10-15 after NAVBREACH declined it: the next phase touching `run_stitch_composite_job` or the composite factsheet arm. Original owner, kept as lineage: 166.3.1 NAVBREACH, which owns the composite recompute). `run_stitch_composite_job` does not propagate a member's `flow_timing_day_level` (nor `small_base_measured`, nor D-15's large-flow annotation) to the composite, and the composite factsheet arm never carries the note, so a composite with day-level flow days shows neither a warning nor the note. Done when member annotations are OR-ed into the composite flags and surfaced, or the omission is recorded as intended. Round 2 SFH F3 (conf 4) re-found it and added: when both flags are set, the factsheet prints only the small-base text.
  DECLINED 2026-10-15 by Phase 166.3.1 NAVBREACH: propagating FLOWTIMING's member annotations (`flow_timing_day_level`, `small_base_measured`, D-15's large-flow note) into `run_stitch_composite_job` and the composite factsheet is not part of NAVBREACH's SC-1..SC-5. FLOWTIMING's code was not on this phase's branch when SC-5 was planned (2026-10-13), so it was never planned or tested here, and taking it now would widen the composite surface plan 04's recompute measured after that measurement. The owner needs re-routing; the entry stays open.
- **[164.6.6.2.3-INCEPTION-DAY0-PNL]** (logged 2026-10-12, FLOWTIMING review round 1, SFH F3, MEDIUM conf 6; owner: a future phase). The day-level inception skip in `chain_linked_twr` drops day-0 P&L as NaN with no flag (the predicate never looks at P&L), and an MT5 day 0 whose `DayTiming` could not be built falls into that skip before the day-level counter. Done when a day-0 with P&L and no timing is counted, or the docstring states the silent drop as D-12's intent.
- **[164.6.6.2.3-MT5-BASIS-SILENT-NONE]** (logged 2026-10-12, FLOWTIMING review round 1, SFH F4, MEDIUM conf 5; owner: a future phase). `_native_key_usd_writer_basis` returns None silently (a missing close on a quiet day, a first day absent from the P&L map, a None carried level) and the store gate skips the write without a log, so a timed MT5 key composes on the legacy roll with no signal. Done when a timed MT5 key without a basis logs a counted warning or blocks as the holed-key case does.
- **[164.6.6.2.3-EMPTY-COHORT0-REFUND]** (logged 2026-10-12, FLOWTIMING review round 1, review WR-04 conf 5 and SFH F5 conf 5, MEDIUM; owner: a future phase). A timed day that re-funds an emptied account (prev <= 0, a deposit, then a trade) is dropped with `negative_nav_guard`/`dust_nav_guard` because an EMPTY cohort 0 is still judged, and the interior `twr_chain_broken` cuts the headline to the suffix. Done when an empty cohort 0 is skipped whenever a later cohort is judged, with a test that goes RED today.
- **[164.6.6.2.3-DRYRUN-VERDICT-ATTRIBUTION]** (logged 2026-10-12, FLOWTIMING review round 1, WR-05, MEDIUM conf 5; owner: none, the dry-run harness is a one-shot measurement tool). `flowtiming_dry_run.py` classifies every unguarded MT5 row as "confirmed day-0" by construction (day 0 is NaN before and after), so "confirmed flow-only" can never print and the reference row's day-1 flow-dominated cause is attributed to day 0; `offset_s` silently defaults to 0. The founder-approved DRYRUN (2026-10-12) carries this limit. Done when the classifier works per stored flag and day, if the harness is reused.
- **[164.6.6.2.3-D15-THRESHOLD-BAND]** (logged 2026-10-13, FLOWTIMING review round 2, SFH F2, MEDIUM conf 5; owner: a future phase). D-15 annotates a day-level flow day only when `abs(flow) >= prev` (`FLOW_TIMING_LARGE_RATIO = 1.0`), but the inflation factor is about `(prev + F)/prev`, so a flow just under the ratio inflates the day with no flag: prev 1,000 plus an untimed 900 deposit earning 10% publishes +19% against about +10% as a clean `complete`. This follows the founder's D-15 choice. Done when the ratio is lowered with a measured rationale, or the band is recorded as accepted in CONTEXT.
- **[164.6.6.2.3-D17-GUARD-DISCONTINUITY]** (logged 2026-10-13, FLOWTIMING review round 3 R3-01, MEDIUM conf 6; owner: a future phase; accepted by founder D-18). A vanishingly small flow on a day whose carried position lost about 90% or more of the account turns a measured day into a guarded NaN and breaks the chain, dropping earlier history. Flagged by the guard key, never silent. Done when a guard rule exists that is continuous in the flow AND refuses a near-zero base, or the limit is re-decided.
- **[164.6.6.2.3-SOAK-BTC-FLOORS]** (logged 2026-10-13, FLOWTIMING review round 3 R3-02, MEDIUM conf 7; owner: a future phase touching `scripts/mt5_soak.py`). The soak calls `combine_mt5_deal_ledger` with no `floors` and judges guarded days on `USD_FLOORS`, while `job_worker` passes the account unit's floors. A BTC-denominated MT5 account therefore reads `vacuous` and red in the soak for a reason unrelated to reconstruction. Done when the soak resolves the unit with `classify_account_currency` and passes its floors to both calls, with a `currency="BTC"` test.
- **[164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED]** (logged 2026-10-13, FLOWTIMING review round 3 R3-03 conf 7 and SFH M-1 conf 8, MEDIUM; owner: a future phase touching `scripts/mt5_soak.py`). On a timed day the soak's return check rejects only an infinite value: 7.0, NaN or -0.99 on a timed day all read `recon_ok=True`, and there is no floor on the checked share (1 untimed day out of 200 is green). Done when a timed-day NaN must be guard-explained, the timed day is recomputed by an independent D-17 cohort walk from the raw deals, a timed-day 1e-3 nudge goes RED, and a minimum checked share is enforced.
- **[164.6.6.2.3-SOAK-DAY-ATTRIBUTION]** (logged 2026-10-13, FLOWTIMING review round 3 SFH M-2, MEDIUM conf 5; owner: as above). The soak's expected return uses the fold's own per-day P&L, so a deal bucketed onto the wrong UTC day shifts `P_t` and `NAV_{t-1}` together and every check stays green. Done when the soak accumulates an independent per-day trading P&L from the raw deals and compares it day by day.

## Phase 167.1.2.2 (DERIVECRON) — routed items (logged 2026-10-07)

- **[167.1.2.2-SCENARIO-BLANK-SLATE-COPY]** (logged 2026-10-11, DERIVECRON plan 09 browser re-run; owner: 170.6 DISPLAYPOLISH or the next Scenario copy pass). On a blank-slate Scenario with 0 overlapping days, every blend tile reads "Warming up — need 30 more days of synced data" although no strategy is in the scenario (the BTC and Stress panels correctly say to add strategies), and the embedded factsheet renders "0 observations" with the generic thesis "Scenario is a systematic strategy". Done when a blank slate says to add strategies in the tiles and the embedded factsheet shows an honest empty state instead of a thesis.

### 167.1.2.2-MT5-CROSS-SERVICE-TERMINAL — the MT5 terminal lease serializes one process, and the backfill service is a second (booked 2026-10-07, Phase 167.1.2.2 research OQ-5, accepted)

**Why it is open.** The MT5 terminal lease in `analytics-service/services/mt5_concurrency.py`
serializes only within one process's event loop, and the MT5 runbook pins the analytics service to
one replica for that reason. Since 2026-10-02 the backfill service is a second process on the one
job gateway, so a key-mode MT5 derive can overlap the API process's MT5 reads (its session monitor
runs on a roughly five-minute cadence). The login bracket (`assert_expected_login` before and after
the read) fails closed as a transient error, not silent corruption, and the research measured no
login-mismatch failure since the split. Accepted for 167.1.2.2 and booked here.

**Owner:** unrouted; the founder routes it at the next MT5 phase planning.
**Trigger:** the first `derive_broker_dailies` failure whose error names an MT5 login mismatch, or
any MT5 phase touching `mt5_concurrency.py`, whichever comes first.
**Gate (what closes it):** the two processes are proven unable to interleave terminal sessions, by
a test that fails first when the guard is removed.
⛔ **Not a close:** a measurement of zero mismatches so far; the fail-closed bracket is why none
show, and it is not a serialization.

### 167.1.2.2-BYBIT-STATIC-EGRESS — the Bybit key's IP allow-list needs a stable egress address, and the founder step is still pending (booked 2026-10-09, Phase 167.1.2.2 D-17(a))

**Why it is open.** The plan 05 re-rehearsal read the one Bybit owner INCOMPLETE twice, on the
exchange's 'Unmatched IP' refusal: the key is bound to an IP allow-list, and Railway's live config
showed no static outbound IP on `quantalyze-analytics-backfill` or `quantalyze-analytics`, so the
egress address the exchange sees can change. The daily cron was registered anyway under D-18(c)
(2026-10-09), so until this lands that owner's derive ends in error every day and its book stays
rebuilding.

**The act (founder action, pending).** Turn on Railway Static Outbound IPs for both services, add
the resulting address to the Bybit key's allow-list, then re-run one Bybit derive. ⛔ The address
stays out of tracked text: record it only in the Bybit key's settings and the Railway dashboard.

**Owner:** THE FOUNDER. Plan 08's first-scheduled-run reading will show whether that owner still reads `awaiting`.
**Trigger:** now.
**Gate (what closes it):** one Bybit derive reads `done` after the allow-list change, and the owner
reads `ready` in census e on the next scheduled run.
⛔ **Not a close:** a green Railway setting without a Bybit derive that reads `done`.

**Phase 201 (2026-11-11, F-12; UI-SPEC U-29 deferred, A-12).** The wizard's egress link keeps pointing at `/security#egress-ips`, and that anchor now states plainly that there is no static egress address to allowlist yet. When the static egress exists, replace that statement on `/security#egress-ips` with the address list (U-29: a server-only source, tests on RFC 5737 documentation addresses, never a real address in tracked text) and point the sFOX guide's egress step at `#egress-ips` (A-12). This entry stays open and its gate is unchanged: one Bybit derive reads `done` after the allow-list change.

## Phase 167.1.2.2.1 (DERIBITWEDGE) — routed items (logged 2026-10-10)

### 167.1.2.2.1-MATERIALITY-OPTIONS-UPL — the FLOW-04 materiality ratio still uses the combined session UPL, so it overstates by the options session UPL (booked 2026-10-10, RESEARCH 1.5)

**Why it is open.** `unrealized_pnl_in_anchor` in `analytics-service/services/job_worker.py` still
uses the collapsed USD `native_upnl` (the combined session UPL, `open_unrealized_usd`), which now
differs from the cash wedge the writer rolls (`equity - balance`). It overstates by
`options_session_upl`. It feeds a warning heuristic, not returns.

**Owner:** this phase's ROADMAP section as a recorded residual, until the orchestrator names a
phase.
**Trigger:** the first review of a `unrealized_pnl_in_anchor` warning on a Deribit account, or any
phase touching the materiality ratio.
**Gate (what closes it):** the ratio reads the same wedge the writer rolls, with a test that fails
first on an account with a nonzero `options_session_upl`.
⛔ **Not a close:** a note that the warning is "only a heuristic".

### 167.1.2.2.1-CAGR-EMPTY-SPAN — the factsheet CAGR annualizes over calendar days, including emptied stretches (booked 2026-10-10, RESEARCH 3.4)

**Why it is open.** An emptied stretch composes as zero capital with no return (SC-3), but the
factsheet CAGR annualizes over the calendar span, so a book that was empty for long stretches reads
a diluted CAGR. Recorded, not fixed.

**Owner:** this phase's ROADMAP section as a recorded residual, until the orchestrator names a
phase.
**Trigger:** the first allocator-facing factsheet or book whose span contains an emptied stretch
(the options-holding account's two stretches, 695 and 60 days on the scratch replay).
**Gate (what closes it):** the CAGR denominator excludes emptied days, or the factsheet states the
span it annualized over, with a test on a book with an emptied stretch.
⛔ **Not a close:** removing the stretch from the chart.

### 167.1.2.2.1-DISCONNECTED-KEYS-OLD-WEDGE — disconnected Deribit keys cannot be re-derived and keep the old wedge (booked 2026-10-10)

**Why it is open.** A re-derive needs live credentials. A key that is disconnected keeps the returns
the old wedge produced, and no form in the re-baseline runbook reads it by design.

**Owner:** unrouted; the founder routes it if a disconnected key's returns are ever shown.
**Trigger:** a disconnected Deribit key's history reaches a published book or factsheet.
**Gate (what closes it):** the key's returns are either re-derived from stored inputs or hidden
behind a stated basis flag, with a test.
⛔ **Not a close:** reconnecting the key to re-derive it without the owner's consent.

### 167.1.2.2.1-WRITER-BASIS-VALUES — writer-basis mode checks the calendar, never the values (booked 2026-10-10, PR-2 review WR-01, confidence 5)

**Why it is open.** A `key_inputs` row and a returns set from two derives that share the last NAV
day pass the gate: the lagging-row check compares last days only. That happens with a same-day
re-derive after a ledger correction, a retried key or a manual enqueue. Such a pair composes on the
old day P&L and the new returns with no `key_inputs_mismatch`. The review recommended a cross-check
`abs(r[d] * L - w_pnl[d]) <= tol` per day and it was not taken.

**Owner:** unrouted; the founder routes it at the next compose phase planning.
**Trigger:** the first observed same-day re-derive that is followed by a compose, or any phase that
touches `read_writer_basis` or the writer-basis gate in `replay_key_equity`.
**Gate (what closes it):** the gate rejects a pair whose day P&L and returns disagree beyond a stated
tolerance, with a test that fails first when the check is removed.
⛔ **Not a close:** the determinism test (SC-6), which proves two derives of the same inputs agree,
not that a stored row and stored returns come from one derive.

### 167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY — an empty or half-present writer basis reads as a legacy row, including an all-empty stitched account (booked 2026-10-10, SFH-03, SFH-R2-F3)

**Why it is open.** `read_writer_basis` returns `None` for a row that carries no fields, so an
empty-but-present basis behaves like a row written before D-06. In a stitched account whose members
ALL store an empty basis, no `writer_basis_absent_stitched` flag is raised either. The effect is a
quiet fall back to the legacy roll, which is the path D-06 was written to retire.

**Owner:** unrouted; the founder routes it with the next compose phase.
**Trigger:** the first Deribit key whose derive stores an empty basis (a NAV with no rolled bucket),
or any change to `read_writer_basis`.
**Gate (what closes it):** an empty basis is told apart from an absent one and a stitched account
with all-empty members raises its flag, with a test that fails first.
⛔ **Not a close:** noting that the legacy roll is "still correct" for that account.

### 167.1.2.2.1-EMPTIED-CONSTANTS — two constants the fixer chose are not founder-blessed (booked 2026-10-10, PR-2 review round 2 fix scope)

**Why it is open.** The emptied-stretch fixes use `EMPTIED_NEGATIVE_FRACTION = 1e-4` (a level more
than that fraction of the prior peak below zero is a data fault) and `_EMPTIED_LOSS_REL_TOL = 1e-6`
(how closely a stored loss must account for the fall into an emptied stretch). Both were picked by
the fixer to make the founder's D-09 rule testable, and the founder has not seen them as numbers.

**Owner:** THE FOUNDER (bless or change), recorded in this phase's CONTEXT.md as a dated decision.
**Trigger:** the first emptied stretch that refuses on either bound, or plan 08's `d07-verdict-prod`
differing from 755 days in 2 stretches.
**Gate (what closes it):** a CONTEXT decision names each value, and the tests restate it.
⛔ **Not a close:** widening either band to make a PROD replay pass.

### 167.1.2.2.1-KEY-CAPTURE-ORPHAN — `key_capture` rows are not removed when a single key is deleted (booked 2026-10-10, security F1, 03-SUMMARY recorded-not-fixed)

**Why it is open.** The compose's orphan cleanup walks `key_inputs:%` only, and the table cascades
by `allocator_id`, so a `key_capture:<api_key_id>` row lingers until the allocator is deleted. The
row is owner-readable under the same RLS as `key_inputs`, numbers and class names only, so this is
tidiness and not disclosure.

**Owner:** unrouted; the founder routes it with the next `allocator_equity_derived` change.
**Trigger:** a GDPR deletion review of single-key deletes, or any phase touching the orphan cleanup.
**Gate (what closes it):** deleting a key removes its `key_capture` row, with a test.
⛔ **Not a close:** the allocator-level cascade.

### 167.1.2.2.1-RUNBOOK-WRITE-SCAN-DDL — the re-baseline runbook's write scan does not name DDL or `set_config` (booked 2026-10-10, security F3)

**Why it is open.** The renderer refuses `INSERT`, `UPDATE`, `DELETE`, the cron schedule calls and
`enqueue_...(` calls, which is what the threat register declared. It does not name DDL or
`set_config`. Every form was audited as SELECT-only and parameters are quoted and
character-restricted, so there is no live gap. Widening the regex would make the guard match its
own claim only if the list is kept in step with the threat register.

**Owner:** unrouted; the founder routes it if a form is added by someone else.
**Trigger:** any new form added to the runbook.
**Gate (what closes it):** the scan names DDL and `set_config`, with a render test that fails on a
form containing one.
⛔ **Not a close:** a reviewer's reading that the forms are SELECT-only.

## Phase 164.6.6.2.1 (BTCUSDVIEW) — routed items (logged 2026-10-09)

### 164.6.6.2.1-DISCOVERY-RANKING-HONESTY — Discovery ranks a BTC strategy's returns beside USD strategies' returns (booked 2026-10-09, Phase 164.6.6.2.1 D-14)

**Why it is open.** Phase 164.6.6.2.1 labels a native-unit strategy on `StrategyTable` with an
"in BTC" chip (D-05, D-12), but the Discovery ranking, its sort order and its percentile badges
still compare a BTC return with USD returns as if they were one unit. The chip says what the
number is; the rank still treats it as comparable. Out of scope for 164.6.6.2.1 by decision D-14.

**Owner:** unrouted; the founder routes it at the next Discovery or ranking phase.
**Trigger:** the first published native-unit strategy (PROD had 0 published on 2026-10-09), or
the next phase touching the Discovery ranking, whichever comes first.
**Gate (what closes it):** a native-unit strategy is ranked on a like-for-like basis (its USD
series, or a separate unit bucket), by a decision recorded in that phase's CONTEXT, with a test
that fails first on today's mixed ranking.
⛔ **Not a close:** the chip alone.

### 164.6.6.2.1-STITCH-DEPARTED-HOLE-SPLIT — a departed or stitch-source BTC key with an interior price hole is replayed unsplit (booked 2026-10-10, Phase 164.6.6.2.1 review WR-01)

**Why it is open.** The allocator compose job reads a BTC key's interior unpriced days and segment
terminals (`read_native_key_inputs`, mechanism I2) only for counted keys. The departed-key and
stitch-source branches `continue` before that read, so such a key is replayed as one segment
across a stored-close hole, which is the mis-scaling I2 exists to remove, with no
`key_inputs_mismatch`. Review confidence 6, below the fix bar; exposure is low today (PROD's one BTC
key was live on 2026-10-09). No test covers it.

**Owner:** unrouted; the founder routes it at the next allocator-book phase.
**Trigger:** a BTC key departs or is stitched as a source while its stored history holds an
interior hole, or the next phase that touches the compose job's key_inputs read.
**Gate (what closes it):** departed and stitch-source BTC keys are split at their holes exactly
like counted keys (or refuse with `key_inputs_mismatch` when they carry holes), with a test that
fails first on today's code.
⛔ **Not a close:** a comment saying departed keys are rare.

### 164.6.6.2.1-USDVIEW-READFAIL-CACHED — a failed BTC price read disables the factsheet USD toggle for the cache TTL (booked 2026-10-10, Phase 164.6.6.2.1 review SFH-03)

**Why it is open.** `buildUsdView` returns `usdViewUnavailable: "price_read_failed"` as a normal
payload, so the factsheet cache stores it under the payload key for up to an hour although the
next read would succeed. The reason is shown to the user. Confidence 5, below the fix bar.

**Owner:** unrouted; the next phase touching the factsheet payload cache.
**Trigger:** a reported "USD view unavailable" that clears on its own, or that phase starting.
**Gate (what closes it):** a failed price read renders but is not cached (as the builder's
degraded-build path already does), with a test that fails first.
⛔ **Not a close:** a shorter TTL.

### 164.6.6.2.1-HOLDINGS-UNITLESS-QTY — a native holdings row with a missing or malformed unit prints a bare BTC quantity (booked 2026-10-10, Phase 164.6.6.2.1 review SFH-04)

**Why it is open.** `HoldingsTable` and `derivePhase07Fields` parse `quantity_unit`; a null or
malformed value falls back to the plain quantity format, so a BTC count shows with no unit. The
writer always sets the unit today, so this is a defensive-reader gap. `value_usd` is correct.
Confidence 5, below the fix bar.

**Owner:** unrouted; the next phase touching the Holdings table.
**Trigger:** a holdings row reaches the reader with a native mark and no parseable unit.
**Gate (what closes it):** such a row shows a dash or a named reason for the quantity, never a bare
number, with a test that fails first.
⛔ **Not a close:** inferring the unit from the symbol.

### 164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED — an owner's private factsheet shows "Data source —" for their own key-backed strategy (booked 2026-10-15, Phase 164.6.6.2.1 UAT item 2)

**Why it is open.** `src/app/factsheet/[id]/v2/page.tsx` reads the trust tier from
`readPublicVerificationSignals`, which calls `get_published_trust_signals`, an RPC that answers only
for PUBLISHED strategies. On a private strategy it returns nothing, so the Terms panel's "Data source"
(`MandatePanels.tsx`) prints "—", even on the owner's own view of a strategy that is backed by an API
key. Measured 2026-10-15 on PROD's only BTC-unit strategy (private): "—" in both the BTC and USD views.
The two views agree, so the 164.6.6.2.1 CR-02 overlay is not at fault. User-facing, owner-only, and it
withholds a true fact rather than showing a false one.

**Owner:** unrouted; the next phase touching the factsheet trust tier or `get_published_trust_signals`.
**Trigger:** an owner asks why their own factsheet does not say API-verified.
**Gate (what closes it):** an owner viewing their own unpublished strategy sees its real tier,
read through a path that also checks ownership. Anonymous and non-owner readers still get nothing for
an unpublished strategy. A test fails first on the "—".
⛔ **Not a close:** widening `get_published_trust_signals` to unpublished strategies for every caller.

### [167.1.2.2.2-CRON-TICK-RESIDUALS] — four MEDIUM residuals of `public.cron_sync_tick()` that the plan 01 review round recorded and did not fix (booked 2026-10-09, Phase 167.1.2.2.2 plan 01 Task 3)

**Why it is open.** The three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter)
reported the tick migration CLEAN with no CRITICAL or HIGH. The worst finding was MEDIUM, so under the
review rule no fixer round ran. Four of those MEDIUMs are carried here rather than lost:

1. **The destination allow-list is a suffix wildcard.** The allow-list is `https://<host>.up.railway.app`
   for any host. An app-admin, or any `service_role` holder (every Next.js `createAdminClient()` route and
   the Python analytics service write `system_settings`), can point `system_settings.analytics_service_url`
   at another Railway subdomain, and the Vault service key is then posted there. The tick inherits this
   from `match_engine_cron_tick` and from the `system_settings` CHECK constraint, and so does
   `prod_prober_cadence_check`: three spellings of one rule. The exact-origin tightening of all three
   (CHECK constraint, and each in-body re-test) belongs to a later forward migration, not to this tick.
2. **Gate arm P1 never compares the posted key to the Vault secret.** It asserts the `X-Service-Key`
   header is non-blank, not that it equals the secret the Vault holds, so a body that posted some other
   non-blank string would pass.
3. **The blank-key guard trims spaces only.** `btrim(v_key) = ''` leaves a key of tabs or newlines
   through, and the analytics service answers it 401. Already recorded as a comment in the sibling
   `match_engine_cron_tick`; widening it is a decision with its own evidence and touches the sibling too.

Not in the list because it is a runbook item and not a migration edit: the 180000 ms timeout is a plan
figure, not a measurement. The go-live rehearsal (plans 14 and 17, the PGNET-TOO-SLOW and KEY-TIMEOUT
verdicts) measures it.

**Owner:** unrouted; THE FOUNDER routes it. Items 1 and 3 ride one forward migration that tightens the
tick, the cadence check and the match-engine tick together; item 2 rides the next edit of
`supabase/tests/test_cron_sync_tick.sql`; item 4 rides Phase 164.6.8 (OUTAGEALERT) if the founder routes it
there, and otherwise stays the by-hand read in the go-live runbook.
**Trigger:** the first of (a) any migration that touches `system_settings.analytics_service_url` or its
CHECK constraint, or re-bases `match_engine_cron_tick` or `prod_prober_cadence_check`, (b) the first
scheduled `cron-sync-trades` run whose `cron.job_run_details` row reads green while `/api/cron-sync` did
not sync, (c) the start of 164.6.8 planning. Booked 2026-10-09.
**Gate (what closes it):** per item. (1) the CHECK and all three in-body re-tests accept one exact origin,
proven by a gate arm that fails first when a different `*.up.railway.app` host is stored. (2) a P1
assertion that the recorded header equals the Vault secret, observed RED under a mutant posting a fixed
string. (3) a key of a tab or a newline is refused by name, observed RED under the old guard. (4) a
failed or timed-out tick reaches a human without anyone running a query, with a test that fails first when
the reader is removed.
⛔ **Not a close:** the review round's CLEAN verdicts, or a rehearsal that happened to read green once.

- **Shipped in v0.131.5.0 (Phase 164.6.8 OUTAGEALERT, 2026-10-14), live check pending in plan 09, NOT closed.** Item 4 (nothing reads the run) is answered in code by the `cron_sync` heartbeat arm of `public.ops_staleness_check()`. Items 1-3 are untouched. Item 4 closes with `167.1.2.2.2-TRADESYNC-STALENESS-ALARM`, on plan 09's live check.
- ✅ **Item 4 CLOSED 2026-10-14 by Phase 164.6.8 OUTAGEALERT plan 09, with `167.1.2.2.2-TRADESYNC-STALENESS-ALARM`.** The pending line above is kept as lineage. The `cron_sync` heartbeat arm of `public.ops_staleness_check()` is registered at `40 * * * *` (19:54 UTC) and its first tick at 20:40:00 UTC succeeded with an `ok` observer row and no page; the drill reached the Sentry rule "Ops alert: outage (164.6.8)" and the founder confirmed it notified them without opening Sentry (D-15: Sentry is the only live channel, so this closure relies on that delivery; email is booked as `164.6.8-OPS-ALERT-EMAIL-UNCONFIGURED`). The gate's test was seen RED with the reader removed (plan 02). Items 1, 2 and 3 stay OPEN and untouched.

### [167.1.2.2.2-PROVENANCE-GATE-RESIDUALS] — MEDIUM residuals of the `trades_fetched_at` / `series_provenance` column migration and its gate that the plan 02 review round recorded and did not fix (booked 2026-10-09, Phase 167.1.2.2.2 plan 02 Task 3)

**Why it is open.** migration-reviewer, rls-policy-auditor and silent-failure-hunter reported
`20261010130000_strategy_analytics_trade_fetch_provenance.sql` and `test_strategy_analytics_trade_fetch_provenance.sql`
CLEAN with no CRITICAL or HIGH, so no fixer round ran. The MEDIUMs carried here rather than lost:

1. **Arms 1 to 3 have no twin for the `series_provenance` half.** Each arm asserts both columns but its
   twin mutates `trades_fetched_at` only, so a regression that makes `series_provenance` NOT NULL, typed
   `json`, or defaulted is caught by the migration's own verify block at apply time and by no biting twin.
2. **The CHECK is verified by name only.** The verify block proves
   `strategy_analytics_series_provenance_is_object` exists with `contype = 'c'`, not that its definition is
   the object-or-NULL predicate. Arm 4 measures behaviour on the pg-lane and the baseline, which is what
   covers it; the apply-time block does not.
3. **The rollback drops provenance data with no count or backup.** Every recorded legacy range and
   unrecovered gap is lost with the column, and the rollback header says so but takes no copy.
   `series_provenance` is runbook-written by hand, so it does not refill itself the way
   `trades_fetched_at` does.
4. **No gate arm proves the read boundary or the write denial for the new columns.** The RLS audit found no
   live leak (reads go through `analytics_read`, published or owner; writes are service_role only through
   `analytics_insert_deny` and `analytics_update_deny`; no ACL drift), but the gate asserts only that
   `anon` can SELECT. Nothing fails first if `authenticated` could UPDATE `trades_fetched_at`, or if a
   non-owner could read an unpublished row's value.
5. **Arm 5 seeds only a `complete` row, so "no trigger reacts to a `trades_fetched_at`-only UPDATE" is
   unproven for the other states.** On the baseline, a `computing` row with NULL `computing_started_at`
   gets `computing_started_at := now()` from `strategy_analytics_stamp_computing_started_trigger`, and a
   non-computing row with a stale stamp has it cleared. **Routed to plan 05 (the every-tick
   `trades_fetched_at` stamp, SC-4 writer): it must either exclude `computing` rows from the stamp or
   accept and document the trigger's repair stamp, and either way carries a red-first test.**

**Owner:** items 1 to 4 are unrouted; THE FOUNDER routes them, and they ride the next edit of the column
migration's gate or the next migration that touches `strategy_analytics`. Item 5 is owned by plan 05 of
Phase 167.1.2.2.2.
**Trigger:** the first of (a) any migration or gate edit that touches `strategy_analytics.series_provenance`
or `trades_fetched_at`, including OKXHISTORY (167.1.2.2.2.1) adding `reconstructed_ranges`, (b) the first
PROD rollback of `20261010130000`, (c) plan 05 execution (item 5, which cannot wait). Booked 2026-10-09.
**Gate (what closes it):** per item. (1) a twin per arm for the `series_provenance` half, observed RED. (2)
the verify block compares the CHECK's `pg_get_constraintdef` to the expected predicate, observed RED under a
weakened CHECK. (3) the rollback copies the column to a named table or the runbook records a pre-rollback
export step. (4) arms that fail first when `authenticated` can UPDATE either column and when a non-owner
reads an unpublished row's value. (5) plan 05's red-first test on a `computing` row.
⛔ **Not a close:** the review round's CLEAN verdicts, or arm 5 reading green on a `complete` row.

## Phase 167.1.2.2.2 (TRADESYNC) — routed items (logged 2026-10-10)

- **[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]** (logged 2026-10-11, PR-B fix round SFH-H2; owner: Phase 167.1.2.2.2.1 OKXHISTORY). A truncated window is now degraded: nothing stored, no stamp, key `error`. An OKX first window above the page cap (10k bills per inst type over ~157 days) therefore truncates on every tick and reports `error` daily instead of leaving a silent hole. Done when the OKX fetch is chunked or windowed so a large first window completes.
  ⭐ **2026-10-15 (Phase 167.1.2.2.2.1 plan 10, RESEARCH Section 11): measured, not fixed, stays open.** The live
  walk is 100 pages of 100 per instrument type (`OKX_BILLS_PAGE_CAP = 100`); a capped walk drops the oldest days
  and records `daily_pnl_truncated_okx`. Evidence today: the 2026-10-12 rehearsal tick reported no `partial`,
  `fetch_degraded`, `results_truncated` or key `error`; the stored `data_quality_flags` of ordinals 1, 2 and 4
  carry no `daily_pnl_truncated_okx` key; ordinal 4's stored series is flat 2026-06-08 to 2026-08-01; the
  heaviest stored account holds a few thousand fills over several months, far from 10,000 bills per instrument
  type in 90 days. Reading: the first live row of 2026-08-02 for ordinals 1 and 2 is consistent with a flat
  account, not with the page cap. NOT proven until the Q3 archive file shows no activity in 2026-07-17 to
  2026-08-01. The OKXHISTORY reconciliation is the detector (`info.archive_only_in_live_reach` in the job result:
  archive activity on a day inside live reach with no live row). **Trigger (narrowed 2026-10-15):** an OKX
  derive sets `daily_pnl_truncated_okx` or the OKXHISTORY reconciliation reports an archive-only day inside live reach.
- **[167.1.2.2.2-BINANCE-INCOME-PAGINATION]** (logged 2026-10-11, PR-B fix round; owner: the next phase that ships a Binance strategy key). The Binance income call uses `limit=1000` with no pagination and no truncation flag, so a capped Binance window is still invisible. No Binance key on PROD today. Done when it paginates or stamps `daily_pnl_truncated_binance`.
- **[167.1.2.2.2-INCOME-FALLBACK-PRODUCER-PIN]** (logged 2026-10-11, PR-B review round 3 R3-ME-01, MEDIUM, confidence 5; owner: the next phase that ships a Binance strategy key). The cron reads `daily_pnl_binance_income_fallback` through its own string constant in `routers/cron.py`, and the fetcher writes it as a separate literal in `services/exchange.py`. The round-3 tests hand the flag to the cron through a patched buffer, so a rename on the fetcher side would silently reopen R2-ME-01 (Binance spot fills stored over daily P&L). Done when one test runs the real `fetch_daily_pnl` with the income call failing and the spot call succeeding and asserts `_fetch_degradation` names the flag, or when both sides import one constant. Dormant until a Binance strategy key exists on PROD. Also correct the comment beside the cron constant: nothing in the tree reads the flag by name for an admin health card.

Counts and ages only; no ids. Each entry below was recorded by plan 13 rather than fixed, because
fixing it would widen the phase past its six success criteria. The two earlier TRADESYNC bookings
(`[167.1.2.2.2-CRON-TICK-RESIDUALS]` and `[167.1.2.2.2-PROVENANCE-GATE-RESIDUALS]`) sit above, under the
DERIVECRON heading, where plans 01 and 02 appended them.

### 167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED — the user-triggered trade fetch and the queued sync job still seed from `last_sync_at` (booked 2026-10-10, Phase 167.1.2.2.2 SC-3 sibling)

**Why it is open.** Phase 167.1.2.2.2 fixes the cron's resume fallback to start from the strategy's
stored high-water and stops it reading `api_keys.last_sync_at` (D-12), because the daily holdings poll
overwrites that column for every active key (23 of 23 live keys matched the poll's run time within 10
minutes when measured on 2026-10-09). The poll keeps writing it: four other readers depend on that. Two
other readers of the same column as a resume point are left as they were. (a) The user-triggered
`fetch_trades` route in `analytics-service/routers/exchange.py` (the research called it `/sync-trades`;
the route is `POST /fetch-trades`) seeds `since_ms` from `last_sync_at`, guarded only by a "below the
gate threshold, force a full lookback" check. (b) The queued `sync_trades` job
(`run_sync_trades_job` in `analytics-service/services/job_worker.py`) prefers
`api_keys.last_fetched_trade_timestamp` and falls back to `last_sync_at`; it is shielded only while that
preferred column is right, and see `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` for why it may not be.
Neither is on the daily path, so neither blocks this phase's goal.

**Owner:** unrouted; review at the next milestone audit, or the first phase that edits either function.
**Trigger:** any edit to `fetch_trades` or `run_sync_trades_job` that touches its resume point, or a
user-triggered sync that returns fewer trades than the age of the newest stored trade implies.
**Gate (what closes it):** both seed from the strategy's stored high-water, the way the cron fallback
does, with a test that fails first on today's code: a fresh `last_sync_at` beside an old stored trade must
still reach back to that trade.
⛔ **Not a close:** the cron's fix, which lives in `analytics-service/routers/cron.py` only.

### 167.1.2.2.2-CRONOBS-SCOPE — the prober's `cron-obs` arm watches two named jobs and joins pg_net rows by time alone (booked 2026-10-10, Phase 167.1.2.2.2 SC-6)

**Why it is open.** `scripts/prod-prober/arms/cron-obs.mjs` observes the hourly `match_engine_cron` job
and the `ledger_refresh_fanout` job, each selected by `jobname`. It does not observe `cron-sync-trades`,
so no prober arm reads that job's runs or its responses. Its join between a run and its HTTP response is
time-only (`net._http_response` carries no cron job id; a response created within 90 seconds of a run's
start attaches to that run), and the arm already refuses an ambiguous window rather than judge it. The
new tick is at minute 30, so it does not share a 90-second window with the hourly job today. That is a
placement fact, not a guarantee: moving any pg_net caller into the first 90 seconds after an observed
job's start makes the attribution ambiguous. Whether the pg_net request id the tick returns can be
recovered from a `cron.job_run_details` row is unmeasured.

**Owner:** unrouted; it rides Phase 164.6.8 (OUTAGEALERT) if the founder routes it there, otherwise the
next phase that edits `cron-obs`.
**Trigger:** any change to `cron-obs`'s job scope, any schedule change that puts a second pg_net caller
inside 90 seconds after an observed job's start, or the first scheduled `cron-sync-trades` run whose
outcome is read by a human.
**Gate (what closes it):** an arm reads the `cron-sync-trades` runs and attributes their responses
without a time-only join, with a self-test that fails first when that attribution is neutered.
⛔ **Not a close:** the tick sitting at minute 30; or the existing arms reading green for the two jobs
they were written for.

### 167.1.2.2.2-PGNET-HANDLER-CANCEL — whether a pg_net timeout cancels the `/api/cron-sync` handler is unmeasured (booked 2026-10-10, Phase 167.1.2.2.2 research A3)

**Why it is open.** The tick posts with a 180000 ms timeout. Research estimated a filtered tick (4 keys)
at roughly 30 to 90 seconds and an unfiltered one at about 9 minutes, and neither number was measured
(the rehearsal measures the first). Nothing established whether, when `pg_net` gives up on a request, the
FastAPI handler is cancelled mid-write or runs to completion. If it is cancelled, a slow tick dies
between a store and its derive enqueue. Cursors advance only after stores, so a re-run recovers the
trades, but a derive enqueue can be lost until the next tick. Open Question 11 in the research: a test
question, not a founder question.

**Owner:** Phase 167.1.2.2.2 plans 14 and 17 (the rehearsal), which measure the tick's duration; the
cancel behaviour itself is unrouted unless a rehearsal times out.
**Trigger:** the first rehearsal or scheduled tick whose `net._http_response` row reads `timed_out`, or
any change to the tick's timeout or to the route's batch structure.
**Gate (what closes it):** a measured read, recorded here, of whether the handler finished its stores
and its derive enqueues after the client gave up (a deliberately slow request against a handler whose
trailing writes are visible by rows). If it cancels, the timeout budget gets a margin or the tick is made
asynchronous.
⛔ **Not a close:** the arithmetic that a filtered tick fits in 180 seconds, or a rehearsal that finished
inside the timeout (it never exercised cancellation).

### 167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD — `api_keys.last_fetched_trade_timestamp` reads ahead of the data it claims to cover (booked 2026-10-10, Phase 167.1.2.2.2 research section 3)

**Why it is open.** On 2026-10-09 the column read 44.7 days old for one strategy's key while that
strategy's newest stored trade was 50.7 days old, i.e. the cursor sat 6 days ahead of the stored data. A
mark that is ahead of storage tells the next reader to skip days it never stored. Phase 167.1.2.2.2 does
not use it as a resume point for exactly that reason (the cron resumes from the stored high-water), but
the queued `sync_trades` job passes it as its preferred seed, so that job would skip those 6 days. Which
writer put it ahead was not traced; it was measured on one strategy only.

**Owner:** unrouted; review with `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED` at the next milestone audit.
**Trigger:** the same edit as that entry, or a second strategy read more than 1 day ahead of its stored
data.
**Gate (what closes it):** the writer is identified and either keeps the column a stored-through mark or
the queued job stops trusting it, with a test that fails first on a key whose cursor is ahead of its
newest stored trade; and the same read, repeated, finds 0 strategies ahead.
⛔ **Not a close:** the cron ignoring the column, which hides the defect from the daily path and does not
repair it.

## Phase 170.7 (MYSTRATTABLE) — routed items (logged 2026-10-11)

### 170.7-E2E-HEADER-PROBE-COVERAGE — the pinned-header overlap check can pass without probing Status or Created (booked 2026-10-11, Phase 170.7 D-10)

**Why it is open.** `assertPinnedHeaderNotPaintedOver` in `e2e/helpers/geometry.ts` drops any
`underEveryLaterHeader` stop that falls outside the scroll range or has zero width, and the
MYSTRATTABLE wide describe in `e2e/layout-narrow.spec.ts` only logs the probe count. If the stops
for Status and Created fall out of range, the check falls back to Discovery's old single stop and
still passes. Founder D-10 booked this rather than fixing it in round 1.
**Fix.** Return the labels actually probed and assert they include Status and Created.
**Owner:** the next phase that touches `e2e/helpers/geometry.ts`.
**Trigger:** any edit to the pinned-header helpers.

### 170.7-RANK-PAGE-CONTINUITY-TEST — nothing pins that `#n` continues across pages (booked 2026-10-11, Phase 170.7 review round 2 WR-04)

**Why it is open.** Since D-11, `rankOrdinals` in `StrategyTable.tsx` numbers ranked rows over the
full `filtered` list. That is the only thing that makes page 2 start at #21. Every test uses
fewer than `PAGE_SIZE` rows, so changing the loop to `paged` would restart page 2 at #1 and no
test would fail. Round-2 MEDIUM, test-only, so it is booked rather than fixed under the standing rule.
**Fix.** Add two tests: a Discovery mount with 21 or more ranked rows, where clicking Next shows
#21, and a manager Created-sort mount with one unranked row on page 1, where page 2's first ranked
row shows #20. Prove both go RED under the `paged` change.
**Owner:** the next phase that touches `StrategyTable` pagination or ranking.
**Trigger:** any edit to `rankOrdinals`.

### 170.7-E2E-HELPER-SILENT-SKIPS — two geometry helpers return quietly instead of failing (booked 2026-10-11, Phase 170.7 D-10)

**Why it is open.** `assertPinnedCellsMatchHeaders` returns silently when `overflowOf` names no
pinned column, which turns its no-paint-past-the-edge half into a no-op. `settleStrategyTableLayout`
stops at its deadline without failing, and it treats a missing region as stable. Neither is vacuous
today, because the default `overflowOf` matches and the region is asserted visible first.
**Fix.** Throw in both cases.
**Owner / Trigger:** as 170.7-E2E-HEADER-PROBE-COVERAGE.

## Phase 170.4 (ALLOCHOLDINGS) — routed review items (logged 2026-10-11)

### 170.4-WRITER-FALLBACK-SILENT — the 42P10 fallback is visible only as an INFO log line (SFH-2, MEDIUM, conf 6)

**Why it is open.** Until PR 2's per-key index exists, every holdings poll retries on the pre-D10
target, and two keys holding one symbol on one day overwrite each other (D-08 is false in that
window). Nothing reaches Sentry.
**Fix.** Log a warning plus a one-shot Sentry capture per process, with a stable tag, and make the tag
reading zero part of the gate for removing the fallback (`[170.4-HOLDINGS-UPSERT-FALLBACK]`).
**Owner:** 170.4 PR 2 (plan 10).

### 170.4-HOLDINGS-UPSERT-FALLBACK — remove the writer's 42P10 fallback once PR 2 is applied on PROD (booked 2026-10-11, Phase 170.4 plan 10)

**Why it is open.** `persist_allocator_holdings` still retries once on the pre-D10 four-column target
(`HOLDINGS_CONFLICT_TARGET_PRE_D10`) when Postgres answers 42P10. After PR 2's migration
(`20261011120000`) applies on PROD that branch is dead. It was not removed in PR 2 because Railway can
redeploy the worker before the PROD apply finishes, and a worker without the fallback would then fail
every holdings poll with 42P10 in that window.
**Fix.** Remove `HOLDINGS_CONFLICT_TARGET_PRE_D10` and its 42P10 branch from `persist_allocator_holdings`
with its tests (`test_persist_holdings_conflict_target.py`). In the SAME change, update the header of
`supabase/migrations/down/20261011120000-rollback.sql`: that manual rollback relies on the fallback to
keep ingestion alive after it runs, so once the constant is gone the writer must be rolled back FIRST
(review INFO-2). Do `170.4-WRITER-FALLBACK-SILENT` first or with it, so the fallback's use is observable
before it is removed.
**Owner:** Phase 170.4 follow-up.
**Trigger:** PR 2's PROD apply verified: the marker query names PROD, and `pg_indexes` on
`allocator_holdings` shows the five-column unique index and not the four-column one.

### 170.4-IDENTITY-READ-COMPLETENESS — a holdings row whose key is missing from the identity read counts as its own account (SFH, MEDIUM, booked 2026-10-11)

**Why it is open.** `keyAccountOf`'s `key:<id>` fallback gives a holdings row whose `api_key_id` is
absent from the `api_keys` identity read its own account, so a same-account pair could double count.
Reachable only if the foreign key is bypassed. Plan 14 noted that no test seeds the case.
**Fix / done when.** `fetchHoldings` (`src/lib/portfolio-exposure.ts`) and the per-key reader
(`fetchLatestHoldingsPerKey`) throw on a counted row whose key is absent from the identity read, with
a test per reader.
**Owner / Trigger:** the next /allocations data phase.

### 170.4-DASHBOARD-MARKER-READ-SILENT — the dashboard drops `markerReadError` (SFH-3, MEDIUM, conf 6)

**Why it is open.** A failed `native_unpriced:` read keeps an unpriced key's older rows in Holdings,
Exposure and the live total, with no note and no Sentry capture. The commit route does report the same
condition.
**Fix.** Report it to Sentry in `getMyAllocationDashboard`, and carry a degraded flag that renders a
one-line disclosure.
**Owner / Trigger:** the next /allocations data phase.

### 170.4-STRATEGIES-TABLE-CONNECT-COPY — the Holdings tab's Strategies table still says "Connect an exchange API key or upload a CSV" (verification warning 4, booked 2026-10-11)

**Why it is open.** The Strategies table's empty state in `HoldingsTable.tsx` reads "No strategies yet.
Connect an exchange API key or upload a CSV to see your strategies here." It is keyed on
`hasAnyStrategies`, not on the shared `hasConnectedKeys` predicate (D-07), so an allocator with an
eligible key but no strategies is still told to connect one. 170.4's goal and SC 6 were narrowed to
allocator-book prompts, so this copy is outside them.
**Fix.** Branch the copy on `hasConnectedKeys`: with a key, say no strategy is linked to the connected
accounts yet; without one, keep the connect prompt.
**Owner / Trigger:** the next /allocations copy pass (e.g. 170.6 DISPLAYPOLISH).

### 170.4-MATCH-UNPRICED-PER-KEY — the scorer applies the native-unpriced marker per key, not per account (SFH-4, MEDIUM, conf 5)

**Why it is open.** When key A of an account carries a marker for day D and key B's newest rows are on
D-1, the TS reader and the equity refresh drop B's rows, but `match.py` keeps them, so the match AUM
disagrees with Holdings for that account.
**Fix.** Use the group-level marker day (the maximum over the account's keys), as
`equity_reconstruction.py` does. Add a shared case.
**Owner / Trigger:** the next phase touching `routers/match.py`.

## Phase 170.3 (OGPUBLIC) — routed review items (logged 2026-10-11)

### 170.3-OG-NOTFOUND-CACHE — a not-yet-published strategy's blank card is cached for a day or more (booked 2026-10-11, SFH-2, MEDIUM)

**Why it is open.** A genuine not-found (an unpublished or unknown id) renders the generic card under
`LONG_CACHE_CONTROL` (1 day `s-maxage` plus 7 days `stale-while-revalidate`). If a link is shared before
publishing, unfurlers and the CDN keep the blank card after the strategy is published.
**Fix.** Give a not-found a short cache, and keep the long cache for rendered data.
**Owner / Trigger:** the next phase touching `src/app/api/og/`. Phase 209 (2026-11-14) touched it and left this open: the cache policy for a genuine not-found is a separate decision. A malformed id now takes the same not-found path, under the same long cache.

## Phase 164.6.8 (OUTAGEALERT) — routed review items (logged 2026-10-14)

Booked at the release commit from the phase's review rounds (`164.6.8-REVIEW*.md` in the phase directory). Every
item is MEDIUM at confidence 5-6, survived the fix rounds, and is recorded rather than fixed under the founder's
stopping rule. Each names an owner and a trigger and none is routed to a phase of its own. Most share one theme,
the alert path's own failure modes.

### 164.6.8-F3-SENTRY-HALF-NOOP — the Sentry half of a page can no-op silently, leaving the email as the only channel with no signal (booked 2026-10-14, SFH F3, MEDIUM, confidence 6)

**Failure scenario.** `SENTRY_DSN` is unset or `before_send` drops the event: `capture_message` returns None, the
code ignores it, and the page goes out on one hop (email) without any log that it is one hop. A 502 on the email
then loses the page with nothing at ERROR.
**Fix.** Log ERROR when the capture produced no event id, feed that into the window decision, and emit one ERROR at
startup when the DSN is unset in production. Place: `analytics-service/services/ops_alert.py`.
**Owner / Trigger:** the next phase touching `ops_alert.py`; or any page found to have reached nobody.

### 164.6.8-F4-WR03-DEBT-PAGE-NEVER-ENDS — a relaunch debt paid outside the heal tick's check leaves the page open with stale state (booked 2026-10-14, SFH F4 and REVIEW WR-03, MEDIUM, confidence 5-6)

**Failure scenario.** A debt-owed busy tick pages. The debt is later cleared by the validation scrub path, the boot
relaunch, or a heal cancelled by the monitor's `wait_for` before the settle check. The next heal starts with
`debt_owed_at_start == False`, so `note_relaunch_debt_settled` never runs, the founder's last message says the lease
is busy with a relaunch debt, and the next debt episode's page carries the earlier incident's `since` and tick count.
**Fix.** Decide the settled notice from `_DEBT.debt_paged and not mt5_relaunch_debt(terminal_key)` at the top of
every tick, or call the settle from `clear_mt5_relaunch_debt`'s callers. Test: debt cleared between two ticks.
**Owner / Trigger:** the next phase touching `mt5_relogin.py` or `mt5_outage_alert.py`; or a debt page with no end.

### 164.6.8-F5-READER-DELIVERY-UNOBSERVED — `ops_staleness_check()`'s own delivery failure is invisible (booked 2026-10-14, SFH F5, MEDIUM, confidence 6; acknowledged out of scope by D-03)

**Failure scenario.** `net.http_post` is asynchronous and the function never reads `net._http_response`. A rotated
service key (401), a 5xx or a timeout leaves the tick green with the observer row saying `error` and the route
returning `acknowledged`: "sync stopped for 2 days" is then an alert that itself stopped, and nobody is told. The
header comment's "that absence is itself the next tick's evidence" is not read by any code.
**Fix.** Read the previous tick's `net._http_response` status for the request ids stored in the observer row and
RAISE on non-2xx; add `ops_staleness_check` to the prober's cadence list so a missing observer row pages; correct the
comment. **Related, a release gate and not a defect:** the migration schedules nothing, so no staleness page can fire
until plan 09 registers the job.
**Owner / Trigger:** sibling of `PROBER-ALERT-DELIVERY-UNVERIFIED-01` (untouched by D-03); same close. Trigger: any
staleness page that should have fired and did not.

### 164.6.8-F6-SCRUB-READER-NEWEST-ONLY — the scrub-row reader reads one row per tick and hides its own read errors at WARNING (booked 2026-10-14, SFH F6, MEDIUM, confidence 6)

**Failure scenario.** A `failed` or `refused` scrub row followed by a `scrubbed` row inside one monitor interval is
never seen (only the newest row is read), so a client login possibly left on the terminal is never paged. Separately,
a read that raises or times out logs at WARNING, below the Sentry event level, so a dead reader looks healthy.
**Fix.** Select rows newer than the last seen `completed_at` (or limit 10) and page any non-scrubbed one; count
consecutive read failures and page `mt5_terminal_scrub` / `reader_failed` at a small threshold. Place:
`analytics-service/services/mt5_validation_liveness.py`.
**Owner / Trigger:** the next phase touching `mt5_validation_liveness.py`; or a scrub failure found unpaged.

### 164.6.8-N2-OPEN-RECORD-FAILS-AT-WARNING — a failed open-page write is logged at WARNING, so the loss of restart recovery is invisible (booked 2026-10-14, SFH round 2 N2, MEDIUM, confidence 6)

**Failure scenario.** Supabase is down through an incident: no `ops_alert_open` row exists, so a redeploy ends the
incident silently and the founder's last message stays OUTAGE. The only trace is WARNING lines.
**Fix.** Log ERROR from `record_open_page` when the write fails for a page that already went out, or count
consecutive failures per source and raise to ERROR at 2-3. Keep the retry. Place:
`analytics-service/services/ops_alert_open.py`.
**Owner / Trigger:** as `164.6.8-F3-SENTRY-HALF-NOOP`.

### 164.6.8-N3-SCRUB-SECOND-FAILURE-SUPPRESSED — a second failed scrub of the same cause inside an hour is marked paged and dropped (booked 2026-10-14, SFH round 2 N3, MEDIUM, confidence 6)

**Failure scenario.** Scrub row A `failed` pages at T; no `scrubbed` row follows; row B `failed` with the same cause
at T+20m is a new row, the reader marks it paged, and the hourly window drops it. B, possibly a different account,
is never reported. The code delivers one page per cause per hour, not one per row.
**Fix.** Key the window on the row identity for the scrub source, or have `_advance_scrub_state` use a `page` variant
that skips the window. Test: outage A, outage B with no recovery, B captures.
**Owner / Trigger:** fixed together with `164.6.8-F6-SCRUB-READER-NEWEST-ONLY`.

### 164.6.8-WR05-ALERT-PATH-HANDLERS-AT-WARNING — the paging path's own failure handlers log below the Sentry event level (booked 2026-10-14, REVIEW WR-05, MEDIUM, confidence 6)

**Failure scenario.** The tracker, debt, scrub-reader and probe handlers catch failures of the paging path and log
at WARNING. A probe whose outer tick bound always bites never feeds `note_outage_reading`, so a validation terminal
that always hangs that way never reaches the threshold and never pages, leaving a WARNING line every ten minutes
that no rule sees.
**Fix.** Log those arms at ERROR; feed the probe's outer `TimeoutError` to `note_outage_reading` as a
`tick_deadline` reading. Places: `mt5_outage_alert.py`, `mt5_validation_liveness.py`, `mt5_session_monitor.py`.
**Owner / Trigger:** as `164.6.8-F3-SENTRY-HALF-NOOP`.

### 164.6.8-WR06-CRON-SYNC-ERRORS-PAGE-ON-PER-KEY-FAULTS — the `two_consecutive_errors` arm pages on one flaky key and re-pages hourly with no recovery (booked 2026-10-14, REVIEW WR-06, MEDIUM, confidence 5)

**Failure scenario.** The `cron_sync` heartbeat row is `error` when ANY key's status is non-ok (`transient_failure`,
`held`, `partial`, `timeout`). One venue flaky for two days gives two consecutive `error` rows, and
`ops_staleness_check` (hourly) then pages `cron_sync / two_consecutive_errors` by Sentry and email every hour until
an `ok` row lands, with by-design no RECOVERED. That is the alert-fatigue shape that gets a channel muted, and a
muted channel cannot report a real outage either.
**Fix.** Page the arm only on rows that mean the RUN failed (`error LIKE 'cron_sync aborted%'`), and add a recovered
notice or a once-per-episode bound. Place: the `ops_staleness_check` reader (migration) and
`analytics-service/routers/cron.py` `_cron_sync_heartbeat_row`. A migration change, so it needs a new stamp.
**Owner / Trigger:** the first false `two_consecutive_errors` page after plan 09 registers the job.

### 164.6.8-WR-R4-01-SENTRY-CREDIT-INSIDE-RULE-INTERVAL — an outage is credited to Sentry although the rule's 60-minute action interval suppresses the notification (booked 2026-10-14, round-4 review WR-R4-01, MEDIUM, confidence 6)

**Failure scenario.** 10:00 the jobs terminal pages OUTAGE (Sentry notifies, email sent). 10:20 it recovers and the
RECOVERED email is the founder's newest message. 10:40 it relapses with the same cause: the recovery dropped the
window entry so the page is admitted, `capture_message` returns an id on the SAME Sentry issue last notified at
10:00, and the rule's 60-minute action interval suppresses the notification. The email POST fails (a 502 blip). The
outage is credited to Sentry, the window is kept, and for up to an hour the founder's inbox ends on RECOVERED while
the terminal is down, with no ERROR logged that the page reached nobody.
**Fix.** Credit Sentry for an outage only when its rule would notify, that is no notified capture of the same
fingerprint inside the rule's action interval (a per-fingerprint last-credit timestamp in `ops_alert.py`, interval
read from one named constant that cites the rule), or retry the email on a relapse regardless of the Sentry credit.
**Owner / Trigger:** the next phase touching `ops_alert.py`; or a flapping terminal. Needs a relapse with the same
cause inside 60 minutes plus one email failure.

### 164.6.8-R4-SFH-F1-DUPLICATE-RECOVERY — a second healthy reading during the held recovery wait starts a duplicate recovery with false "restarted" wording (booked 2026-10-14, round-4 SFH F1, MEDIUM, confidence 5)

**Failure scenario.** A run ends on a healthy reading; `_send_recovered` sends the notice and holds the delivery wait
in a task for up to 15 s. The next healthy reading for the same role finds no run, calls `_durable_recovery_request`,
finds the source unchecked and the open record not yet closed, and builds a SECOND recovered request whose detail
carries the default "after the analytics service restarted" text. No restart happened, and the founder can get two
RECOVERED messages, one with false wording.
**Fix.** Add the source to an in-flight set when the held task starts (removed in its `finally`), and have
`_durable_recovery_request` return None while the source is in it. Place:
`analytics-service/services/mt5_outage_alert.py`.
**Owner / Trigger:** fixed together with `164.6.8-WR-R4-01-SENTRY-CREDIT-INSIDE-RULE-INTERVAL`.

### 164.6.8-WR-D16-01-PROBE-BOUND-INLINE-CLOSE — a Sentry-credited recovery closes the open page inline, outside the probe tick's budget (booked 2026-10-15, plan 10 review WR-D16-01, MEDIUM, confidence 5)

**Failure scenario.** Before D-16 only the founder email could decide a recovered notice, so `_send_recovered` in
`mt5_outage_alert.py` always closed the open page from a held task. Since D-16 a Sentry event id decides it before
`page` returns, which is the normal case with the DSN set. The `delivery.done()` branch then runs
`_finish_recovered` (and so `close_open_page`, bounded by `ops_alert_open._OPEN_PAGE_TIMEOUT_S`) inline on the
monitor tick. `PROBE_TICK_BOUND_S` in `mt5_validation_liveness.py` budgets ONE open-page call and its comment still
says the recovered wait runs in a held task. After a restart the tracker makes two calls (the read, then the close).
With Supabase slow, the tick bound cancels the probe mid-close: the record is marked stale, the close is retried on
the next tick, and the monitor logs a probe that did not finish. The pinning test checks only the old one-call sum.
**Fix.** Either always run `_finish_recovered` from a held task in `_send_recovered`, or budget
`2 * _OPEN_PAGE_TIMEOUT_S` in `PROBE_TICK_BOUND_S`, correct its comment and raise the pinning test's threshold.
**Owner / Trigger:** the next phase touching `mt5_outage_alert.py` or the probe bound; or a "probe did not finish"
log on a recovery tick.

### 164.6.8-SFH-D16-01-SENTRY-ID-IS-QUEUED-NOT-SENT — a credited recovery closes the one-shot record on a queued event (booked 2026-10-15, plan 10 SFH-D16-01, MEDIUM, confidence 4)

**Failure scenario.** D-16 credits a RECOVERED notice once its Sentry capture returns an event id. In the installed
sentry_sdk (2.71.0) `capture_event` returns the id once the envelope is queued to the transport. A later transport
drop (a 429 rate limit, a full queue, a network failure) never reaches `page`, so the recovery is credited, the
durable open-page record closes, and nothing can re-send the notice. No ERROR is logged. A `before_send` drop, a
sampled-out event and an unset DSN all return None and are correctly not credited. This is D-16's literal wording,
so it is recorded as a residual, not a defect.
**Fix.** Pair the close with an email 2xx once Resend is configured (`164.6.8-OPS-ALERT-EMAIL-UNCONFIGURED`), or
flush the SDK after a credited recovery before closing, or log a WARNING that the credit is queue-only.
**Owner / Trigger:** fixed with `164.6.8-OPS-ALERT-EMAIL-UNCONFIGURED`; or a recovered event missing in Sentry.

### CI-LOCALSTACK-DB-PORT-IN-USE — the local-stack lane's database container fails to bind its port on the runner (booked 2026-10-16)

**Failure scenario.** Main's CI run `38865344350` (merge commit of #1070) failed in `frontend-local-stack` only: `failed to start docker container "supabase_db_quantalyze": … driver failed programming external connectivity on endpoint supabase_db_quantalyze … address already in use`. Every other job, and every later main commit, was green. First occurrence. Suspected cause, not measured: another process or a leftover container on the hosted runner already holds the lane's database port when `scripts/local-stack/run.sh up` starts the stack. A red from this is a runner flake, not a verdict on the SHA.
**Fix (candidates).** Before `up`, have `run.sh` name the process or container holding the port and fail with that name, then decide between a free-port pick and a stop-and-retry from what the second occurrence shows.
**Owner / Trigger:** the second occurrence, or the next phase touching `scripts/local-stack/run.sh`.

## Phase 170.6.1.1 (ANONKEYID) — routed review items, PR-A (logged 2026-10-14)

Five MEDIUM findings from the PR-A review army (plan 03), booked rather than fixed because none is
user-facing today and each sits below the confidence bar for a fixer round. Verdict files:
`03-REVIEW-SFH.md` and `03-REVIEW-SFH-R2.md` in the phase directory.

### 170.6.1.1-CENSUS-STALE-AXES — the static census pin can go stale silently on three axes (booked 2026-10-14, SFH-4, MEDIUM, confidence 6)

**Why it is open.** `src/lib/anon-strategies-projection.test.ts` reads source text from hand-copied lists.
(a) `ANON_ROUTE_DIRS` is a subset of `PUBLIC_ROUTES` in `src/proxy.ts`, and nothing asserts that a new public
prefix is added to it, so an anonymous strategies read under a new public prefix is unscanned and reads clean.
(b) `ANON_READERS` is a closed list of three `queries.ts` functions; `getStrategyDetail` still projects a
wildcard and is correctly out of scope today (authenticated), but nothing records that exclusion, so the day it
gains an anonymous caller the pin stays green. (c) The exemptions are keyed by file path plus an exact hit
count, so the factsheet v2 Lane B exemption would still pass if Lane B were deleted and an anonymous
wildcard added elsewhere in the same file.
**Fix.** Cross-check `ANON_ROUTE_DIRS` against `PUBLIC_ROUTES`; pin Lane B by its select text rather than a
count; name the authenticated wildcard readers (`getStrategyDetail`, `getMyStrategies`) in an allowlist with a
reason so an omission is a decision. Neuter each axis once and see it RED.
**Owner / Trigger:** PR-B of this phase (it moves the census); otherwise the next phase that touches the pin
or adds a public route prefix.

### 170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD — `Strategy.api_key_id` optional removes the compiler's guard on owner reads (booked 2026-10-14, SFH-5, MEDIUM, confidence 5)

**Why it is open.** Making the field optional lets owner-surface code that truth-tests `strategy.api_key_id`
(`strategies/page.tsx`, `edit/page.tsx`) compile against a row that may be a public projection and silently read
"no key". Latent today: those pages select the wildcard as the owner.
**Fix.** A `PublicStrategy = Omit<Strategy, "api_key_id">` for the three public readers, keeping
`Strategy.api_key_id` required so the owner path stays type-checked.
**Owner / Trigger:** the next phase that touches `src/lib/types.ts`'s `Strategy`, or any owner page that
reports "no key" for a connected strategy.

### 170.6.1.1-GATE-HIDDEN-EXEMPTIONS-UNENFORCED — the gate's hidden-column exemption list is not asserted hidden (booked 2026-10-15, PR-B review WR-01, MEDIUM, confidence 7)

**Why it is open.** `supabase/tests/test_strategies_anon_grants.sql`'s `HIDDEN_COLUMN_EXEMPTIONS` only removes
columns from GRANT 3's "every other column is anon-readable" sweep. No arm checks that an exempted column is
actually denied to anon, because GRANT 1 and GRANT 4 hardcode `api_key_id`. Latent: the list is empty today.
Failure: a future column is added to the list to clear GRANT 3, someone runs the rollback and re-applies the
migration (as its header says to), and the migration re-derives "every column except `api_key_id`" from
`pg_attribute`, so the hidden column is granted to anon while the gate stays green. The migration's self-check
would then require that grant, so the two disagree as soon as the list is non-empty.
**Fix.** Add a GRANT 5 arm that fails when an exempt entry is anon-readable or no longer exists, with a biting
RED-UNDER twin, and move the census by one arm.
**Owner / Trigger:** the first change that adds an entry to `HIDDEN_COLUMN_EXEMPTIONS`.

### 170.6.1.1-LANDING-CAPTURE-THROTTLE — the landing social-proof read errors capture up to 3 events per page view (booked 2026-10-14, SFH-R2 R2-2, MEDIUM, confidence 6)

**Why it is open.** `getSocialProofStats` in `src/app/(marketing)/page.tsx` calls `captureToSentry` for each failed
count on every request. Under a column-grant outage on the most-visited anonymous page that burns Sentry quota
and drops other alerts. `shouldCaptureNow` in `src/lib/sentry-capture.ts` exists for this. Related: `null` and `0`
render the same dash, so a visitor cannot tell an outage from a genuine zero; Sentry is the only signal.
**Fix.** Keep the `console.error` unconditional; throttle the remote capture keyed on stat plus code, and make
sure the first event per window is still sent.
**Owner / Trigger:** the next phase touching the landing page's stats, or any Sentry quota alert from it.

### 170.6.1.1-FAILANONREAD-CAPTURE-HELD — `failAnonRead` fires its capture without holding the promise (booked 2026-10-14, SFH-R2 R2-3, MEDIUM, confidence 4)

**Why it is open.** `failAnonRead` in `src/lib/queries.ts` calls `captureToSentry` and throws at once without
holding the returned promise, so on a serverless cold finish the tagged `{op, code}` event can be lost. Low
confidence because the thrown error also reaches `onRequestError`, which captures it with route tags and the
message (but not the `code` tag). The landing helper has the same shape.
**Fix.** Hold the capture the way `scheduleDerivedRowCapture` does (`after()` plus a microtask fallback) in
`failAnonRead` and in the landing helper.
**Owner / Trigger:** fixed together with 170.6.1.1-LANDING-CAPTURE-THROTTLE; or the first Sentry event seen
without its `code` tag.

## Phase 167.1.2.2.2.1 (OKXHISTORY) — routed items (logged 2026-10-15)

- **[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]** (logged 2026-10-15, OKXHISTORY discuss; founder instruction
  to book it). `fetch_daily_pnl` in `analytics-service/services/exchange.py` (OKX branch) sums
  `pnl + fee` per UTC day across every bill regardless of `ccy`, with no currency conversion. A bill in
  BTC (a coin-margined position, a fee charged in the base coin) is added to USDT P&L at face value, so the
  daily P&L, the NAV roll-back and every metric built on it would be wrong for any account with a non-USDT
  bill. Exposure is UNMEASURED for the live strategies. **Owner:** Phase 167.1.2.2.2.1 OKXHISTORY research
  measures whether the in-scope account's bills (live and archive) are all USDT; if they are not, it is a
  planning input of that phase, and the fix owner is routed by founder decision. **Trigger:** the first
  OKX bill with `ccy` other than USDT in any strategy's window, or OKXHISTORY research finding one.
  **Done when** a non-USDT bill is converted at a stated rate or fails loud, with a test that goes RED on
  today's code.
  ⭐ **2026-10-15 (Phase 167.1.2.2.2.1 plan 10): the calibrate census is the measurement step; stays open.** Stored
  OKX rows are all SWAP and USDT (406 OKX-format raw fills, all SWAP, fee currency USDT; 568 funding rows, all
  USDT), which covers fills and funding only. Bill classes stored nowhere (SPOT, MARGIN, FUTURES, OPTION,
  transfers, interest, rebates) are unmeasured. The `calibrate` job over the 2026 Q2 and Q3 files settles it for
  the in-scope account: its `census.by_ccy` is the currency count (runbook `docs/runbooks/okxhistory-go-live.md`,
  Step 2). A non-USD row is the stop class `non_usd_ccy` and a founder STOP; the fix owner is routed by founder
  decision then.
  ⭐ **2026-10-26 (Phase 167.1.2.2.2.1 close-out): measured for the ARCHIVE, stays open.** Calibrate run 5 (label
  `20261022T2325`) ingested 1606 archive bills for the in-scope account and all 1606 are USDT, so `non_usd_ccy` did not
  fire. The trigger (a non-USDT bill in any strategy's window) is not met and the live `fetch_daily_pnl` path is
  still unconverted and unmeasured for bill classes outside the archive window.

## Phase 164.9.3.1 (FANINGRAPH) — routed items (logged 2026-10-15)

Found by the phase research on 2026-10-15 while reproducing the four fan-in defects. None of the four is fixed by
Phase 164.9.3.1; each names an owner and a trigger, and the first is an open founder question.

### 164.9.3.1-REAPER-STRAND — the hourly orphan reaper writes failed_final without mark_compute_job_failed, so a fan-in child of a reaped parent still strands (booked 2026-10-15, FANINGRAPH research, latent)

**Failure scenario.** The inline pg_cron job `retention_compute_jobs_orphaned_running` (last registered by
`supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql`) sets `status = 'failed_final'` directly on
stale `running` rows. It never calls `mark_compute_job_failed`, so the failure cascade this phase adds does not run
for it: a fan-in parent reaped that way leaves its `done_pending_children` child waiting forever, and the child's
strategy reads computing. Latent today: no caller passes `parent_job_ids`, and the PROD census of 2026-10-15 found 0
parented rows among 2292 jobs.
**Fix.** Three options, none discussed with the founder. (i) Book it and leave it (this entry). (ii) Call the cascade
from the cron body through a helper whose name and tokens leave the retention gate's counts alone. (iii) A status
trigger on `compute_jobs` that covers every writer, which departs from D-02's "inside `mark_compute_job_failed`".
Re-registering the cron job gives it a fresh PROD jobid and moves `supabase/tests/test_retention_orphaned_running.sql`
(token counts in `cron.job.command`, and its twins), invariant 7 of
`src/__tests__/retention-orphaned-running-terminalize.test.ts` with its `FIX_TS` constants, and
`scripts/prod-prober/cron-manifest.json`.
**FOUNDER DECISION 2026-10-15** ("Book it, latent"): option (i). The path stays out of Phase 164.9.3.1 and is kept here
as booked, latent work. Recorded in CONTEXT ("Research clarifications") and in the ROADMAP phase section.
**Owner / Trigger:** the first caller that enqueues with parents, or any PROD `compute_jobs` row with parents.

### 164.9.3.1-VOLUNTARY-REMOVE-23514 — deleting a voluntary_remove decision fails 23514 through the same ON DELETE SET NULL cascade (booked 2026-10-15, FANINGRAPH research)

**Failure scenario.** The outcome of a `voluntary_remove` decision has `strategy_id IS NULL`. Deleting the decision
makes the `ON DELETE SET NULL` foreign key null `match_decision_id`, which leaves `strategy_id IS NULL AND
match_decision_id IS NULL` and violates `bridge_outcomes_kind_rejected` / `bridge_outcomes_kind_allocated`. Lane result:
`23514`. The admin decisions route cannot reach it (it requires a strategy id), and the option this phase takes for
the 23505 (re-keying the index on a preserved former decision id) does not change it.
**Fix.** Decide what a voluntary-remove outcome should become when its decision is deleted (keep it with a former
decision id, or refuse the delete with a named error), then make the CHECKs and the cascade agree.
**Owner / Trigger:** the next phase that adds a delete path for voluntary decisions.

### 164.9.3.1-HOLDING-REF-DIRECT-UPDATE — an owner can bypass the md-NULL duplicate guard by updating original_holding_ref directly (booked 2026-10-15, FANINGRAPH research, reasoned and not measured)

**Failure scenario.** `bridge_outcomes_update_own` plus the table-level UPDATE grant let an allocator change
`original_holding_ref` on its own `match_decision_id IS NULL` row. `bridge_outcomes_sync_holding_ref_trigger` fires on
`INSERT OR UPDATE OF match_decision_id` only, so it does not run for that column, and a second born-NULL row with the
same `(allocator, strategy)` then passes the partial unique index under a different holding key. Pre-existing. This
phase makes the NEW column `former_match_decision_id` trigger-owned but leaves `original_holding_ref` as it is.
**Fix.** Measure first. If it reproduces, extend the sync trigger to `UPDATE OF original_holding_ref` (or revoke the
column UPDATE from `authenticated`).
**Owner / Trigger:** the next phase touching the sync trigger.

### 164.9.3.1-FL8-SEAM-RESTORE — the FL8 arm renames the lock helper and restores it in a DO block, so an error before the restore leaves the wrapper installed (booked 2026-10-16, FANINGRAPH round-4 review, accepted by the founder brief)

**Failure scenario.** `supabase/tests/test_fan_in_lock_order_race.sql` arm FL8 renames `_fan_in_lock_rows` and installs a
wrapper to force the 10-attempt bound, then restores the original in a later `DO` block. Three paths leave the wrapper
installed: a `FL8-SETUP` RAISE in the race block, a failed `dblink_connect`, and a failure between the top-level
`ALTER ... RENAME` and the `CREATE FUNCTION` (two separate autocommit statements). `psql -v ON_ERROR_STOP=1` stops the
file at that statement and FL8 is the last arm, so no later arm runs. The file is LANE-ONLY and every lane is a
throwaway cluster, so nothing persists today.
**Fix.** If the file is ever run against a persistent database, wrap rename, wrapper and restore in one transaction or
restore from an `EXCEPTION` handler. Until then there is nothing to fix.
**Owner / Trigger:** the first change that runs `test_fan_in_lock_order_race.sql` against a database that outlives the
lane, or moves it out of the LANE-ONLY set.

### 164.9.3.1-55P03-RECOVERY-LATENCY — a cascade that hits the 10-attempt lock bound leaves the job running until the watchdog reclaims it (booked 2026-10-16, FANINGRAPH round-4 review, latent)

**Failure scenario.** `mark_compute_job_failed` raises 55P03 after 10 consecutive attempts in which an enqueue commits a
new descendant inside the lock window. The worker leaves the job `running` (`_is_lock_bound_failure`, no second mark
call), and `reset_stalled_compute_jobs` reclaims it after the stall window (10 minutes by default). Meanwhile the
strategy reads `computing`. There is no hard cap on reclaim cycles, but only a workload that commits children under the
same closure at sub-millisecond spacing on every cycle can repeat it, and nothing in the tree does. Latent: PROD holds no
parented jobs (census 2026-10-16: 0 of 2332).
**Fix.** A bounded in-worker retry of the same `_mark_failed` call (the claim token is still valid) would recover in
seconds without a re-run. Not worth building before a caller passes parents.
**Owner / Trigger:** the first caller that enqueues with parents, or any `mark_failed_lock_bound` event in the worker logs.

## Phase 167.1.2.1.1 (WRITERRESIDUALS) — routed review items (logged 2026-10-16)

Round-1 review (gsd-code-reviewer and silent-failure-hunter) found 0 HIGH or CRITICAL and 4 MEDIUM. The founder ruled
on 2026-10-16: "no more fix round for mediums". All four are booked here unfixed. Reports:
`.planning/phases/167.1.2.1.1-*/167.1.2.1.1-REVIEW.md` (MR-01) and `167.1.2.1.1-REVIEW-SFH.md` (M-1..M-3).

⭐ **2026-10-19 fix round.** The founder ruled: "you can finalize and phase complete those". All four MEDIUMs went
through one minimal fix round (fix-round rule: "For fix rounds minimal fix only, no new abstractions or defensive
checks"), and the re-review is in `167.1.2.1.1-REVIEW-FIXROUND.md`. Three entries below are closed and one is narrowed.
Three entries are new: one known limit (CONTEXT D-16) and two residuals from the re-review.

### 167.1.2.1.1-NEWBOOK-WAIT-UNBOUNDED — a key that never yields two usable NAV days reads "being rebuilt" with no end (booked 2026-10-19, fix-round review MR-FR-02 + SFH #3, MEDIUM, USER-FACING, KNOWN LIMIT by founder decision)

**Founder decision 2026-10-19 (CONTEXT D-16): "Accept as known limit".** No code.

**Scenario.**
- The MR-01 wait (`compose_empty`, "being rebuilt … recomputed once a day") applies to any book whose keys are all anchored with no return days.
- A brand-new key leaves that state on its next derive.
- A funded key whose venue never yields two usable NAV days does not leave it (the `<2`-day key-mode short-circuit in `run_derive_broker_dailies_job`), so its book reads the wait with no end.
- An idle account that only holds assets still gets daily NAV values and is not affected.
- Before this phase the row was deleted and the same line showed, so this is not a regression.

**Fix if triggered.** Treat the state as a wait only while the key is younger than N days (`api_keys.created_at`), then map it to a line that names the cause.

**Owner / Trigger:** a user report of a permanent "being rebuilt" panel, or the next phase touching the derive's refusal mapping.

## ⚪ DON'T FIX — cosmetic, stale, superseded, speculative, or unsound

- **"Do NOT implement" landmines (keep documented, do not touch):** bridge-scoring precompute;
  optimizer per-candidate `pd.concat` rewrite; `position_reconstruction` OFFSET→keyset /
  page-size raise (data-loss); `funding_fees.raw_data` JSONB retention delete (corrupts funding
  P&L).

## Phase 150 review — non-blocking findings (logged 2026-08-06, founder stopping rule)

- [ ] WR-03: guard-test case 7c auth.uid() occurrence-count runs over pg_get_functiondef incl. comments (4 comment hits ≥ 3 threshold) — vacuous as a live-DB control; vitest pin P4 already covers the invariant comment-stripped. Fix: strip comments in 7c or count against exact === 7 total occurrences. (.planning/phases/150-*/150-REVIEW.md)
- [ ] (WR-02 fix note) `bg-card` is a dead class — no `--color-card` token in globals.css @theme; 7 files repo-wide render transparent notice backgrounds. One cleanup pass wanted.
- [ ] (/code-review high, lens 5) HoldingsTable.tsx D-15 comment cites StrategyTable.tsx:1067-1085; the precedent now lives at :1169-1179 — cite by phrase not line number.

### Phase 162 (HONEST) — composite failure no longer names the offending member (added 2026-08-26)

- [ ] **On a composite onboarding failure the user is told the composite failed, but not WHICH
      member key caused it.** HONEST-01 / UI-SPEC C-2 removed the `computation_error` appendix
      from the wizard error envelope — correctly, because that column carried raw Python
      exception text and server-SCRUBBING is not curation. But that appendix was also the only
      thing naming the offending member ("… (deribit) failed to reconstruct: …"). The envelope
      now renders generic `GATE_ANALYTICS_FAILED` copy, so a user with a 3-key composite learns
      only that something failed.
      **This is the reader half of the gap Phase 164.2 already owns.** 164.2 covers the writer
      half (the status bridge overwrites the runner's curated sentence on both transition
      branches, so `computation_error_copy`'s output reaches no user). Even once the writer is
      fixed, THIS path still will not render it — the appendix is gone by design. The real fix
      is a curated, member-naming field in the envelope, not re-threading the column.
      **Do NOT close by re-threading `computation_error`** — that is precisely the regression
      HONEST-01 closed, and `e2e/composite-onboarding.spec.ts` now asserts its absence.
      **Found:** ship gate for v0.74.0.0 — `e2e-seeded` went red on the stale assertion, which
      is how the information loss surfaced at all.

### Phase 151 (AUM) — deferred by ruling from plan 151-04 (added 2026-08-07)

- [ ] **sFOX holdings: consider the `get_balance_history` `usd_value` NAV anchor instead of per-asset `get_balances`** — deferred from Phase 151, RESEARCH Open Q2. `_fetch_sfox_balance_rows` honours the CONTEXT lock on `get_balances()`, whose rows carry a STRING quantity and NO USD valuation, and whose facade has no ticker endpoint — so a non-stable asset is honestly SKIPPED and named rather than priced at an invented rate. `get_balance_history` returns a daily `usd_value` NAV series: an account-level USD anchor structurally identical to MT5's `account_info().equity`, which would value the whole book with no pricing problem at all. Switching is a CONTEXT amendment (a different method than the one locked), so it belongs to the sFOX go-live phase, not to 151. Until then a live sFOX key with non-stable holdings under-reports its AUM by exactly those assets — visibly, via the `complete_with_warnings` copy that names them.
- [ ] **Overview "your live book" baseline: consider a partial-blend baseline now that the composer shows a partial book** — deferred from Phase 151, RESEARCH Open Q6. The honest-empty baseline is arguably too conservative once a partial-coverage book renders in the composer; 151-05 deliberately left the Overview on the old gate. Revisit as a product call, with an explicit test of what the baseline shows when only some keys contribute.

### Phase 151 (AUM) — code-review residual (added 2026-08-07)

- [ ] **WR-08 residual** `MT5_ENABLED=false` does not stop the preflight's RPyC connect — `Mt5Client.__init__` opens the connection before the kill-switch is consulted; a true pre-connect gate changes disabled-path semantics of two job kinds, deferred deliberately.

### Phase 152 (SCEN composer legibility) — deferred residuals (added 2026-08-07)

- [ ] **Pitfall 6 — a stale persisted draft's factsheet link can 404.** The SCEN-03 row-detail panel emits `href="/factsheet/{id}"` for every added strategy. The link resolves under OWN-02's two-lane access control for the viewer's OWN strategies and for currently-PUBLISHED third-party ones — but a draft persisted weeks ago can still name a third-party strategy that has since been archived or deleted, and that link dead-ends on `notFound()`. Detecting it would require a per-row existence fetch, which Phase 152's CONTEXT explicitly locks out (the panel is an in-memory projection with no loading and no failure state by construction). Acceptance was scoped accordingly. Revisit if/when the composer gains a draft-reconciliation pass — the right fix is to prune or mark unresolvable rows at draft load, not to fetch per row at render.
- [ ] **D-1 residual — same-day own-row duplicates stay indistinguishable in Browse.** The SCEN-05 disambiguation line is `Created {Mon D, YYYY} · {Status}`; the key-count segment was omitted entirely (D-1) because `created_at` alone resolves the founder's real case (two "Alpha Centauri" rows 15 days apart) and a key count costs a second query on the browse path. Two own rows with the same name created on the SAME day therefore render identical lines. Revisit only if the founder treats key count as load-bearing for the choice — the amendment is a wire field plus a segment, not a redesign.

### Phase 151/152 `/ship` review round — deferred residuals (added 2026-08-08)

Context: a `/code-review high` (32 agents) plus 7 specialists + 3 red-team passes produced
48 findings across three fix rounds. 23 CRITICAL and all warnings were fixed. What follows
is what was deliberately NOT fixed, with the reason. Two red-team rounds each found that a
previous round's *remedy* had created a new defect — so the items below were left alone on
purpose, not by omission.

**Founder calls (the first one is the significant one):**

- [ ] **HoldingsTable's Weight denominator lives only in a `title`.** `<StrategySortableHeader label="Weight" title="share of allocated capital" />` — hover-only, invisible on touch and to sighted keyboard users, inconsistently announced. The D-12-B denominator is stated nowhere else on the table (only inside the AllocateDialog modal). Fix is visible text (a second-line caption in the mono micro-label voice, or a table footnote) — a layout/taste call.
- [ ] **The Portfolio AUM form label uses the mono data-eyebrow voice.** DESIGN.md's typography section names this exact inversion as the failure mode ("the mono on a form label reads like a value"). Needs either a move to DM Sans medium or an explicit DESIGN.md amendment blessing mono on composer form labels.
- [ ] **The Portfolio AUM input is 12px type in a ~26px control.** iOS focus-zooms any input under 16px, and DESIGN.md wants ~44px touch targets; every shared input primitive carries `min-h-[44px]`. It matches the composer's existing dense number strip, so this is a class decision — either bump this field or record the dense strip as an accepted exception, noting it now covers a money entry point rather than only fine-tuning controls.

**Repo-wide sweeps:**

- [ ] **~20 files still use `focus-visible:ring-accent/20` or `/50` without `ring-inset`.** A 20%-alpha accent ring is ~1.3:1 against the surface, far under WCAG 1.4.11's 3:1 floor. Four surfaces were fixed this round (AllocateDialog's money input and its "Remove allocation" button, StrategyTable's ghost row actions, FactsheetView's masthead Rename). The rest remain: **`ui/Button.tsx:35` and `ui/Modal.tsx:33`** (shared primitives mounted by every dialog — the Modal close button is icon-only, so its ring is also its entire keyboard affordance), plus `ui/Input.tsx`, `ui/Select.tsx`, `ui/Textarea.tsx`, the `mandate/*` family, `ApiKeyForm.tsx`, `RenameStrategyDialog.tsx`, `MatchQueueIndex.tsx` and several wizard steps. Most have a border or background so the ring is not the sole affordance, but the 1.4.11 argument is identical. ⚠️ `AllocateDialog.test.tsx`'s focus sweep carves the two primitives out **by identity** and asserts the exempted set still carries `ring-accent/50` — so it goes RED the day they are fixed. That is the signal to delete the carve-out.
- [ ] **`job_worker.py:~7183`'s transient arm hardcodes `error_kind="transient"`** and never walks the `raise … from exc` chain, so a classification lost at a call site is unrecoverable by design. This round's fix prevents the specific downgrade (a geo-block being retried forever against a host that will never answer); it does not make that arm defensive.

**Smaller residuals:**

- [ ] A partial-book commit can still trip `server_aum_manual_conflict`: the client narrows its AUM to the contributing keys' toggled-on holdings while the server sums the allocator's whole book. That is a key-SET difference, not a basis error (the basis was fixed); closing it needs the key set on the request.
- [ ] Two stale comments at `ScenarioComposer.tsx:~3806` and `~3943` enumerate a drawdown-USD-scaling consumer of `liveHoldingsSum` that was actually deleted in Phase 38-03.
- [ ] The geo-block's operator-actionable text ("move region or proxy") no longer reaches `api_keys.sync_error` — by design, since that column is end-user copy. It stays in `compute_jobs.last_error`, the audit metadata and the log/Sentry chain. Confirm that is where ops actually looks.

**Found at land time (2026-08-08), not by any review:**

- [ ] **⭐ Stale `file:line` citations live in SOURCE files too, and one class is invisible to any path-based guard.** Found 2026-08-08 while repairing the ledgers. Confirmed stale in shipped code: `src/lib/process-key-onboard-contract.ts:116` cites `process_key.py:680-690` (emitter is now :717-750); `analytics-service/routers/exchange.py:152` cites `wizardErrors.ts:936-1035` (`classifyKeyValidationError` is now :1927-2110); `analytics-service/docs/STATUS_CONTRACT.md:379` cites `routers/internal.py:442`/`:471` (now :488/:517). ⚠️ **The nastiest one is SELF-RELATIVE:** `analytics-service/services/broker_dailies.py:552`'s docstring cites `combine_native_ledger` **(:174)** when it is at **:268** — a coordinate pointing *inside its own file*, which no path-resolving checker would ever flag because there is no path to resolve. Any citation gate must therefore handle bare `:NNN` and same-file references, not just `path:NNN`.
- [ ] **`file:line` citations across `.planning/REQUIREMENTS.md` and `ROADMAP.md` rot silently, and nothing catches it.** ✅ **BOTH LEDGERS REPAIRED 2026-08-08** — ROADMAP: 50 audited / 38 renumbered / 8 anchored / 0 undeterminable. REQUIREMENTS: 91 audited / 60 renumbered / 29 anchored / 2 deliberately left (both are quotations of coordinates *inside another document*, pinned to named commits where the drift IS the argument). Verified: 101 requirement IDs + checkbox states byte-identical, headings identical, independent drift audit 0 problems. **The gate itself is still unbuilt** — that is what remains open below. Audited all **109** distinct code citations on 2026-08-08. Cheap tests found little (1 missing file — `extension.py:506` in ROADMAP.md; 0 out-of-range), because an out-of-range check is far too weak: a citation can be *in range* and still point at unrelated code, which is exactly what WIZFORM-02's `:345` did. A symbol-anchored content check found **~13 high-confidence drifts**, several large: `wizardErrors.ts:967 → classifyKeyValidationError` actually at **:1927** (+960), `allocator_positions.py:154 → _fetch_spot_rows` at **:418**, `ScenarioComposer.tsx:2180 → addedStrategyMetadataLookup` at **:2486**, `wizardErrors.ts:1728 → EXCHANGE_PROBE_FAILED` (symbol no longer in that file at all). **Only the WIZFORM-01..05 + MT5-14 citations were repaired** (phase 153 is about to consume them); the rest stand. ⚠️ **A bare filename is itself the bug in one case: `exchange.py` is ambiguous** — `routers/exchange.py` and `services/exchange.py` both exist and only `routers/` holds `_MT5_PROBE_TIMEOUT_S` / `_validate_mt5_key`. Two candidate fixes: (a) a CI gate that resolves every `path:line` in the ledgers and fails on drift — needs symbol anchoring to be meaningful, and generic anchors (`href`, `ValueError`, `UNKNOWN`, `idempotent`) must be excluded or it is pure noise; (b) drop line numbers from the ledgers entirely in favour of symbol names, which do not rot. Cost of leaving it: every planner and executor that trusts a citation walks to the wrong code, and the reader cannot tell a stale pointer from a correct one without re-deriving.

- [ ] **No gate catches an `e2e/` assertion whose copy no longer exists in `src/`.** Phase 150-03 renamed the MetadataStep heading and updated its own component test; two e2e specs kept waiting 15s for the dead string and only one of them reddened (the other is seed-gated and did not run). Ten specialist review passes, a red team, and 10,193 local tests all missed it, because the phase's own grep never left `src/`. A gate is buildable — extract literals from `getByRole(name:)` / `getByText` / `getByLabel` in `e2e/` and fail when one is absent from `src/` — but a naive version has ~6 false positives today (composed date ranges like `"2026-01-05 → 2026-01-09"`, seeded fixture names like `"E2E Test Key"`, and chart headings built at runtime), so it needs an allowlist to be useful rather than noisy. Same family as the v1.10 lesson that e2e grep-gates scan `src/` only.

### Phase 153.1-02 — deferred open questions from the venue-capability foundation (added 2026-08-09)

Both are explicitly OUT OF SCOPE for phase 153 (RESEARCH §Open Questions Q2 and Q5); logged here so the decision is visible rather than implied by a default.

- [ ] **Should sFOX also opt out of the submit-time scope probe?** `VENUE_CAPABILITIES.sfox` (`src/lib/closed-sets.ts`) asserts NO capability at all, so sFOX's submit path is byte-unchanged — that is D-22, pinned by `closed-sets.test.ts`'s *"sFOX asserts NO capability at all"* assertion. The question stands because sFOX asserts `read_only=True` **structurally** for the same reason MT5 does (`_validate_sfox_key`: the SfoxClient adapter has no order/withdraw/transfer surface, and sFOX exposes no per-key scope endpoint) — the same argument that earned MT5 `scopeProbeSupported: false`. What is unknown: whether the ccxt permissions probe currently *succeeds* for sFOX or has been silently failing on every sFOX submit. ⚠️ This is a SECURITY decision (the scope-broadening probe is ASVS V4) — do not flip it as a tidy-up; measure the probe's current behaviour against a live sFOX key first. Owner: unassigned. Reference: 153.1 D-22, RESEARCH Q2.
- [ ] **`Validating…` (U+2026) at `CsvUploadStep.tsx:751` is the odd one out.** The four other live sites use ASCII `Validating...` (`ConnectKeyStep.tsx:782`, `MultiKeyConnectStep.tsx:1637`, `ApiKeyForm.tsx:199`, `StrategyForm.tsx:356`), and ASCII is the **recorded superseding decision** (`MultiKeyConnectStep.test.tsx:19-21` states it supersedes the UI-SPEC's typographic form). D-21 settles the spelling; a repo-wide copy sweep to apply it is not in phase 153's scope. ⚠️ Before changing any of these strings, grep `e2e/` — `e2e/api-key-flow.spec.ts:212` matches on the prefix regex `/Validating/i` and survives either form, but that is luck, not a guarantee for the next one. Owner: unassigned. Reference: 153.1 D-21, RESEARCH Q5.

### Phase 153.4-03 (the long-wait card) — non-blocking findings, logged per the stopping rule (added 2026-08-10)

Both are recorded rather than fixed: neither is user-facing today and neither is a
data-integrity risk, so both sit below the founder stopping rule. Each is a conflict the
plan resolved by SURFACING it (Rule 7), not by blending.

- [ ] **`ui/Button.tsx:35` cannot be given a full-opacity focus ring by a caller.** It
  hard-codes `focus-visible:ring-2 focus-visible:ring-accent/50` on EVERY variant, and
  `cn` (`src/lib/utils.ts:72`) is a plain `filter(Boolean).join(" ")` — **not**
  tailwind-merge — so a `className` passed in does not override the baked-in utility; it
  merely appends a second, losing declaration. Consequence for this phase: the UI-SPEC
  specifies `Button variant="ghost" size="sm"` for `Stop waiting`, but forbidden item #9
  forbids a `/50` ring on a control this phase creates, so `ValidateWaitCard` renders a
  plain `<button type="button">` carrying the ghost look plus the verbatim focus
  contract. ⚠️ Fixing `Button.tsx` is a CROSS-SUITE change, not a one-line edit:
  `AllocateDialog.test.tsx`'s focus sweep carves `ui/Button.tsx` and `ui/Modal.tsx` out
  **by identity** and asserts they still carry `ring-accent/50`, so the fix reds an
  unrelated suite and the carve-out must be deleted in the same commit. Same item as the
  repo-wide `~20 files still use ring-accent/20 or /50` sweep above — this entry records
  the *mechanism* (plain-join `cn`) that makes the two primitives un-overridable rather
  than merely unfixed. Owner: the focus sweep.
- [ ] **The UI-SPEC's queue-disclosure sentence names `MetaTrader` literally while its
  render condition is the class-shaped `serialized` capability.** Copy (UI-SPEC Surface 1,
  40% rung, shipped verbatim in `ValidateWaitCard.tsx`): *"Still signing in. MetaTrader
  allows one sign-in at a time, so your check may be waiting behind another."* The gate is
  `venueIsSerialized(exchange)` — correctly a class check, so a second serialized venue
  would render this line automatically **and would read wrong**, naming a broker the user
  is not connected to. Not fixed here because the remedy is a copy decision, not a code
  one (`{VenueName} allows one sign-in at a time` loses the concrete, recognisable noun
  that makes the sentence land for the only venue that has it today), and the copy table
  is 153.1's. ⚠️ The trigger is not hypothetical-forever: it fires the day any second
  venue gets `VENUE_CAPABILITIES.<venue>.serialized = true`. Whoever adds that row owns
  this sentence. Owner: unassigned; reference 153.4-03, UI-SPEC Surface 1.

### Phase 153.4-04 (the connect step's honest wait) — non-blocking findings, logged per the stopping rule (added 2026-08-11)

- [ ] **`ui/Button.tsx` accepts no `ref`, so a caller cannot move focus to a shared
  button.** `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`, which carries
  no `ref`, and the component is a plain function — so `<Button ref={…}>` is a compile
  error (measured 2026-08-11: `TS2322: Property 'ref' does not exist on type
  'IntrinsicAttributes & ButtonProps'`). React 19 passes `ref` as an ordinary prop, so the
  fix is one optional prop spread through `...props`; the reason it was not taken here is
  the SAME cross-suite carve-out recorded in the 153.4-03 `Button.tsx` item above
  (`AllocateDialog.test.tsx` asserts that component by identity), plus this phase's
  UI-SPEC ⛔ on editing `Button.tsx`. Consequence today: `ConnectKeyStep`'s cancel path
  holds a ref on the submit ROW and queries `button[type="submit"]` inside it to restore
  focus — correct and asserted, but indirection a `ref` prop would delete. Bundle this
  with the focus-ring sweep; both edits land in the same file. Owner: the focus sweep.

### Phase 153.4-05 (the composite step's honest wait) — non-blocking findings, logged per the stopping rule (added 2026-08-11)

- [ ] **The composite step's `Loading your saved keys…` banner is the file's one remaining
  U+2026.** D-21 settles the busy label as ASCII and this plan added no new typographic
  ellipsis, but the rehydrate banner (a different surface, untouched here) still carries
  one — as does `CsvUploadStep.tsx:751`. Fold into the repo-wide ellipsis sweep already
  logged under 153.4-03. Owner: that sweep.

### Phase 153.4 code review — the findings the fix round consciously did NOT fix (added 2026-08-11)

⚠️ **Logged late, and that is the point.** The stopping rule blocks only on user-facing or
data-integrity defects; everything else gets **logged instead**. The 153.4 fix round closed
4 criticals + 2 warnings and then recorded the other eight findings nowhere — they survived
only in `.planning/phases/153.4-*/153.4-REVIEW.md`. The verifier escalated that as F-4. The
bargain has two halves; this section is the second one. Source: `153.4-REVIEW.md`.

- [ ] **WR-05 — `validatePanel` dereferences `panelsRef.current[idx]` with no guard**, while
  its neighbour `handleStopWaiting` opens with `if (!p) return;`. `panelsRef` lags state by
  one commit, so a click landing between a removal and the sync throws a `TypeError` out of
  an unawaited async callback. **Non-blocking:** a one-commit ref-sync window nobody has hit.
  ⭐ Wider than the review reported — `requestRemove` has the same unguarded shape, so fix the
  CLASS (every `panelsRef.current[idx]` read in this file), not the one line. Owner: unassigned.

### Phase 154-02 (WIZCONT-01 plumbing) — residual recorded while single-sourcing the draft query (added 2026-08-12)

- [ ] **A THIRD latest-wizard-draft read still lives outside the helper** — `src/app/(dashboard)/strategies/page.tsx:41-49`
  issues the same `source='wizard' AND status='draft' ORDER BY created_at DESC LIMIT 1` read that
  `src/lib/wizard/draft-query.ts` now single-sources for the two wizard entry points, but with a
  different column set (`id, name, created_at, review_note`) for a different consumer: the Resume
  CTA + rejected-draft notice on the strategies list. It could not adopt the helper without widening
  `InitialDraft` with `review_note`/`created_at` for a page outside Phase 154's scope. Consequence:
  the /strategies Resume CTA and the wizard's own resume decision can still drift apart. The
  divergence is NOT silent — `src/__tests__/wizard-draft-query-single-source.test.ts` Scan B pins the
  latest-reader set to exactly these two files, so a THIRD one reddens. Fold it in when the helper
  grows a column-set parameter. Owner: unassigned.

### Phase 154 ship review — non-blocking findings (logged 2026-08-12, founder stopping rule)

Raised by the `/ship` pre-landing + adversarial reviews. The four that met the blast-radius bar
(user-facing or data-integrity) were FIXED in v0.59.0.0 and are not listed here. These did not.

- [ ] **C-2 / A-4 — a rotated venue password re-connect reports success and stores nothing.**
  `create-with-key/route.ts` — the dedup arm returns BEFORE `validateKey`, and keys on the MT5
  login alone; `api_secret`/`passphrase` are never consulted. A user re-running the wizard to
  update a rotated investor password is told the account is already connected, while the stored
  ciphertext still holds the OLD password and the key keeps failing to sync with no signal. Same
  shape for a typo'd password. ⭐ Highest-value of this batch: silent, and it is the ordinary
  "I rotated my credentials" path. Needs a product call — update-in-place, or refuse with copy
  that names the remedy (there is no credential-update UI today; the client UPDATE is revoked).
- [ ] **A-3 — `venue_account_id` is the MT5 login alone, but a login is only unique within a broker
  server.** Two accounts at different brokers sharing a login number collide on
  `(user_id, exchange, venue_account_id)` → wrong-account resolution. Server-qualifying the value
  (`<broker_server>:<login>`, already carried as `passphrase`) closes it. ⚠️ NOT a patch: the column
  is live on PROD, so changing what is stored is a migration decision with a backfill question.
  Not declared anywhere before this review.
  ⚠️ **2026-10-03 (167.1.2 plan 08, founder Option B):** the holdings poll now also stamps MT5 keys
  connected before the column existed (2026-08-12), from the login alone. So a cross-server login
  clash between two of one owner's keys surfaces as a `duplicate` marker (a key-card note plus an
  audit event), not as a connect refusal. Re-score this entry if another path ever creates an MT5
  key with a NULL `venue_account_id`.
- [ ] **Orphaned `api_keys` rows from a deleted composite draft are never swept.**
  `cleanup_abandoned_wizard_drafts.sql:19-24,41-49` cannot see them (the draft row is gone, and the
  keys were never in `strategy_keys`). Found while fixing the composite-draft misclassification;
  the deletion path is now closed, but rows already orphaned in PROD stay orphaned.
- [ ] **C-4 — `sync-progress` picks the strictly-newest job of any kind, with no in-flight
  preference.** A short-circuit `process_key_long` answering `done` in seconds can mask a prior
  chain's `compute_analytics_from_csv` still `running`, suppressing the amber block in exactly the
  state the UI-SPEC says must show it. Bounded by the stall backstop. Changing it means revisiting
  154-04's deliberate two-pass selection.
- [ ] **C-5 — SF-3's keep-last-known now pins `jobStatus`, which is newly load-bearing.**
  Composite-only. If a `stitch_composite` row is DELETEd out from under the client (the
  orphaned-running purge does DELETE in prod), `jobStatus` freezes and `showRecomputing` latches.
  Bounded by the stall backstop.
- [ ] **Two copy-honesty nits in `SyncPreviewStep.tsx`.** (a) the lead paragraph still asserts a
  present-tense exchange fetch under the amber/interrupted blocks, where the identical in-card
  claim was just suppressed as false — gate it on `inFlightClaimIsCurrent` too; (b) with the
  in-flight claim withheld, the status panel can collapse to a bordered box containing only an
  unlabeled number.
- [ ] **Residual: a genuinely-empty account still waits out the patience clock if `/sync-progress`
  is dead or sustained-429.** The zero-history refusal needs positive finished-evidence, which that
  route supplies. Closing this needs a threshold, which Phase 154 bans. Declared, not hidden.
- [ ] **`154-03-TEST-APPLY.md` contradicts itself on whether the SQL gate ran.** §2 records a PASS
  on TEST; §5 records a post-hoc migration amendment and says the seeded cases have NEVER executed;
  `154-VERIFICATION.md` says the gate has not been executed. Honest reading: a pre-amendment
  structural subset ran, the shipped file never has. Correct one of the two records.

### Phase 156 (CONNECT) — the two things this phase deliberately did NOT fix (added 2026-08-13)

Both were raised at planning, decided out of scope there (`156-RESEARCH.md` § "Open Questions" 3 and
4), and are logged here rather than patched in passing. Plan `156-05`'s acceptance asserts BOTH
named files are unmodified by the phase, so neither was quietly half-done.

- [ ] **`p_venue_account_id` has no in-database oracle — Phase 156 closed its REACHABILITY half and
  RESTATED the rest** (added 2026-08-13 by `156-10`; the plan assumed this was already logged and it
  was not). `src/app/api/strategies/create-with-key/route.ts` at the `p_venue_account_id` argument,
  and `create_wizard_strategy`'s `COMMENT ON FUNCTION`
  (`20260814120000_wizard_rpcs_revoke_authenticated.sql:536-550`). ⭐ **What Phase 156 DID close:**
  after Migration B only the server can pass the value at all, so "a browser chose this account id"
  is no longer reachable. ⛔ **What it did NOT close, and cannot:** nothing in the database can ask
  MT5 whether a login is real, so the stored value is *"what the server passed"*, never *"what the
  venue confirmed"* — the same CR-01 class as `p_exchange`, at a narrower scope. An oracle means
  calling the venue, which is an application-tier probe; the MT5 gateway already performs one at
  validate time, so persisting *its verdict* alongside the value is the plausible remedy and needs
  its own decision (it is a migration + backfill question on a column that is live on PROD).
  ⚠️ **Distinct from A-3 above:** A-3 is about this value's *shape* (a login is unique only within a
  broker server); this entry is about its *provenance*. Fixing either does not fix the other.

### Phase 153.7 ship gate — one unnamed vitest flake, recorded rather than lost (added 2026-08-14)

- [ ] **`FLAKE-153.7-01` — the full local vitest suite failed exactly one test once, in parallel
  mode, and I could not name it.** ⚠️ **This is a known-unknown on purpose.** Evidence, in order:
  run 1 (`vitest run`, default parallel) → `Test Files 1 failed | 780 passed | 19 skipped`,
  `Tests 1 failed | 11852 passed`; run 2 (identical command, no code change between) → exit 0;
  run 3 (`vitest run --no-file-parallelism`) → `781 passed | 19 skipped`, `11853 passed`, exit 0.
  Two clean full runs against one failure, so the phase gate is green and Phase 153.7 shipped on it.
  ⛔ **Why this is written down instead of shrugged off:** the failing run's output was not captured,
  so the test has no name. An unnamed flake that fires once locally is the shape that later fires in
  a CI shard and reads as a regression in whatever PR happens to be open — costing a bisect against
  an innocent diff. If a single-test failure appears in a vitest shard and does not reproduce under
  `--no-file-parallelism`, check this entry BEFORE bisecting.
  **What would close it:** capture a failing run (`vitest run > /tmp/run.txt 2>&1` in a loop until
  non-zero) and name the test; then either fix the race or pin the file to `--no-file-parallelism`.
  ⚠️ Local is Node 25, CI is Node 22 — reproduce under
  `PATH=/opt/homebrew/opt/node@22/bin:$PATH` before concluding it is local-only.

### v1.17 milestone-audit residuals — logged per the stopping rule (added 2026-08-14)

- [ ] **`PLANNING-PROJECTREF-01` — the PROD and TEST Supabase project refs are written into tracked
  `.planning/` files, against the standing "never record the PROD project ref in `.planning/`"
  rule.** Found 2026-08-14 by a no-allowlist sweep at the v1.17 close (gitleaks itself: **no leaks
  found** — this is below its threshold, which is why the rule exists separately). Occurrences
  include `REQUIREMENTS.md:910,1433`, `STATE.md:1336`, `TODOS.md:584,1477,1554,1641`.
  ⭐ **Assess the actual exposure before spending effort:** a Supabase project ref is the subdomain
  of `NEXT_PUBLIC_SUPABASE_URL` and therefore ships in every browser bundle already — it is not a
  credential and redacting it buys no security. The real issue is that a stated rule and the repo
  state disagree, and an unenforced rule teaches people to ignore the enforced ones.
  **Decide one way:** either scrub + add a CI grep, or amend the rule to name refs as non-secret
  and keep the prohibition for keys/JWTs/connection strings only. ⛔ Do NOT half-do it.

### Branch & worktree adjudication, 2026-08-14 — four survivors with real unmerged work

Context: 37 stale branches and 9 orphaned agent worktrees accumulated. Every one was adjudicated
**by content** (`grep -aF` per added line against `origin/main`), not by branch age or `git cherry`
— ⭐ patch-id is USELESS here because squash-merges give shipped work a different id, so merged
branches read as "62 commits ahead" forever. 33 were verified shipped and deleted. **These four
were NOT, and all four are now pushed to `origin` so they are no longer local-only:**

> ⚠️ Triage 2026-08-20: all four verified superseded/stale at HEAD — branch deletion is the remaining act, pending founder.

- [ ] **`fix/scenario-empty-daily-returns` — 143 of 164 added lines absent from main.** A real bug
  fix: resolves the lazy-returns series through the analytics column-drift resolver, across
  `api/strategies/[id]/returns/route.ts`, `factsheet/allocator-portfolio-payload.ts` and
  `portfolio-math-utils.ts`. Its own comment records the load-bearing fact: **the legacy
  `daily_returns` column has NO production writer** — the real series lives in `returns_series`,
  the `(1+r).cumprod()` wealth curve the analytics service writes (`metrics.py:775-778`).
  ⚠️ Dated 2026-08-04 and never merged. **Decide: land it or close it with a reason.**

- [ ] **`fix/sync-status-superseded-failed` — an entire MIGRATION that never landed.**
  `supabase/migrations/20260705130000_sync_status_supersede_failed.sql` and its gate
  `supabase/tests/test_sync_status_supersede_failed.sql` are **absent from main**.
  ⚠️ A migration sitting unmerged for 5+ weeks is either abandoned-on-purpose or dropped by
  accident, and the branch name does not say which. ⛔ Do NOT merge it blind — merging
  `supabase/migrations/**` AUTO-APPLIES to PROD. Read it first; it is adjacent to Phase 144's
  reaper-status work, so check for conflict before v1.16 Phase 144 lands.

- [ ] **`ci/pytest-xdist-parallel` — 23% of its additions absent from main.** Parallelizes the
  analytics-service Python CI (`pytest.ini`, `Makefile`, `conftest.py`, `requirements-dev.txt`,
  `ci.yml`). Cheap, useful, never merged. ⚠️ Check it against the `-p no:randomly`/VCR-cassette
  constraints before landing — parallel pytest plus cassettes is exactly where LIVE broker calls
  leak in.
  ⭐ 2026-10-14 (Phase 164.9.8.1 PYXDIST) — what was measured:
  - The `shared_test_db` xdist group never formed. The conftest grouping hook ran after xdist's own hook
    had read the markers, so no nodeid received the group suffix until the hook got `tryfirst=True`
    (gate: `analytics-service/tests/test_xdist_group_is_real.py`, seen RED without the decorator).
  - ⭐ 2026-10-28: the group stopped forming again under pytest 9.2.0, for a different reason. pytest
    9.2.0 keeps a node's id in `Node._id` and xdist 3.8.0 still writes the suffix to `item._nodeid`,
    which nothing reads any more, so hook order is not involved. Upstream pytest-dev/pytest-xdist#1386,
    fixed by #1388 on xdist main and not released. `requirements-dev.txt` caps `pytest<9.2` until an
    xdist release carries it; the same gate went RED on 9.2.0 and is GREEN under the cap.
  - The limiter-identity flake was `routers.*` module pollution: fixtures that evicted a module without
    restoring it. Fixed in the polluters through `tests/limiter_stub.py` (`restoring` / `evicted`); the
    victim test is byte-identical. Exhaustive bisect after the fix: 316 of 316 file-level and 452 of 452
    node-level pairs GREEN (0 RED), against 17 RED nodes in one polluter file before it.
  - The VCR concern is ruled out by reading: `tests/conftest_vcr.py` sets `record_mode="once"`, so
    cassettes replay only and nothing re-records under parallel workers.
  - Coverage is combined and enforced under xdist. On the same tree, serial TOTAL 93.57 percent and
    `-n auto --dist loadgroup` TOTAL 93.57 percent (24238 statements both), a delta of 0.00 point; the
    same parallel run with the floor raised to 99 exited 1 with `Coverage failure: total of 94 is less
    than fail-under=99`. The floor of 80 is unchanged.
  - The Phase-97 parallelization TODOS entry no longer exists: tracker consolidation `193afe818`
    dropped it. The pointer in the old `ci.yml` comment was dangling, and the entry is NOT re-created.
  - Parallel pytest reaches main through this phase, not by merging this branch, so this branch's own
    disposition (land it or close it) is unchanged.
  - ⛔ CORRECTED 2026-10-15: the soak and wall-time figures are NOT in the plan 04 SUMMARY. Founder decision D-14 moved both to PR #1054's CI, and the readings are in this phase's VERIFICATION ("Human items resolved"): 20 of 20 green on CI run `38776484715`, and the `python` job at 340 to 497 s against a 654.5 s threshold. Shipped as v0.132.1.6 (#1054).

- [ ] **`wip/v1.16-phase140-fix-archive` — 91% divergent (4,046 of 4,441 added lines absent).**
  Highest divergence of any branch, but **no file it touches is missing from main**, so this reads
  as a superseded WIP approach from the Phase 140 era (2026-07-25) rather than lost work. Kept
  rather than deleted *because* 91% is too high to dismiss on a heuristic. **Decide: skim it once
  and delete, or cherry-pick anything still true.**

⭐ Also rescued: `.claude/worktrees/agent-a06a853e5acc0cdd0` held **264 uncommitted lines** across
`SyncPreviewStep.tsx` and three of its tests. Main already carries the recomputing block so it
looks superseded, but the diff was saved rather than assumed — session scratchpad,
`rescued-worktree-a06a853e-uncommitted.patch`. ⚠️ Scratchpad is session-scoped; if this matters,
move it into the repo.

## Phase 143 — recorded deferrals (logged 2026-08-17)

Both are DELIBERATE non-coverages of the JOB-04 dropped-enqueue sweep
(`supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql`), documented in that
file's header and in `143-CONTEXT.md`. Neither is a bug in the sweep; each needs its own mechanism.

- [ ] **(D-09) Composite strategies stranded without analytics are EXCLUDED from the sweep — they
  need a `stitch_composite` re-run mechanism with its own predicate.** The sweep excludes any
  strategy with a `public.strategy_keys` member row. This is **money safety, not optimization**:
  `run_stitch_composite_job` writes `csv_daily_returns` itself (`job_worker.py:6786-6803`) but
  `JOB_CHAIN_FOLLOW_ON["stitch_composite"]` is the empty tuple (`job_worker.py:527`), so a composite
  is chain-terminal and legitimately never gets a `compute_analytics_from_csv` job. Enqueueing one
  would hand the composite headline to the single-key computation its own handler deliberately
  abandoned — a √252-vs-√365 annualization divergence plus a 0.0 gap-fill that "fabricated flat
  performance" (`job_worker.py:6808-6822`). Silent corruption of a CORRECT row on a money surface is
  strictly worse than the un-healed hole. ⚠️ Not hypothetical: the 143-02 census found **1 composite
  on PROD carrying dailies**, currently protected only by a terminal analytics row — i.e. one failed
  terminal write away from being the exact false positive this conjunct stops.

- [ ] **(D-05) The wizard/API first-hop enqueue drop is NOT covered.** A `finalize-wizard` strategy
  whose `sync_trades` enqueue dropped has **no dailies at all**, and "no dailies AND no jobs" is
  byte-identical to a brand-new strategy that has not synced yet, and to a key whose first sync
  legitimately returned nothing. No predicate catches the drop without also catching those, so the
  sweep would re-enqueue healthy strategies forever. Closing it needs a different signal
  (`api_key_id` present + no job EVER + a longer grace) with its own false-positive analysis — a
  separate mechanism, not a second predicate bolted into this migration.

- [ ] **(follow-on, from the 143-04 live tick) `cron.job_run_details.return_message` does NOT carry
  a pg_cron body's RAISE NOTICE text on this Supabase build — it carries the command tag (`DO`).**
  Observed 2026-08-17. This affects **142's reaper too**, whose header relies on the same premise for
  its operator-observability section; that file was not touched by Phase 143. Either correct
  `20260802120000`'s wording or build a real count surface. Until then, count healed rows with
  `SELECT count(*) FROM public.compute_jobs WHERE metadata->>'source' = 'reconcile-sweep' AND
  created_at >= <tick start>`, not by reading the run log.

### Phase 143 red-team residuals (logged 2026-08-17, deliberate trade-offs)

Both have a SAFE failure direction. Recorded so the trade-off is visible, not so it is forgotten.

## Phase 145 — recorded deferrals (logged 2026-08-17)

Three DELIBERATE deferrals from the JOB-06 csv-finalize atomicity fold
(`finalize_csv_strategy_with_returns`, migration `20260819120000`; 145-CONTEXT.md `<deferred>`).
None is a defect in the fold; each carries the constraint that made it out-of-scope. Census
citations are from `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md`
(taken 2026-08-17: PROD `khslejtfbuezsmvmtsdn`, TEST `qmnijlgmdhviwzwfyzlc`).

- [ ] **(Window E) Enqueue-errored strategies are visible and alerted but never healed — nothing
  re-enqueues them.** Shape: dailies present, the `after()` enqueue errored, `strategy_analytics`
  = `'failed'`, no `compute_jobs` row ever created. The user's poller breaks out on `failed` and
  Sentry fires (`step: csv-analytics-enqueue`), so it is not silent — but Phase 143's sweep
  deliberately excludes it via the terminal-analytics conjunct (`20260816140000:737`), and the
  Phase 145 fold leaves hop 5 (the post-response enqueue) outside the transaction by physical
  necessity (`after()` runs post-commit), so this window survives the fold. Census query (3)
  measured 2026-08-17: **PROD = 1, TEST = 0**. The pre-registered re-rank trigger ("non-zero PROD
  → live cleanup") technically fired, but the single PROD row is the KNOWN composite already
  tracked by the Phase 143 (D-09) entry above — composites are chain-terminal by design and need a
  `stitch_composite` re-run mechanism, not a csv re-enqueue — so there is no genuine window-E
  population today and the item stays mid-term. Any future healer must key on a signal that
  distinguishes "enqueue errored" from "composite, legitimately job-terminal" (the D-09
  false-positive class).

- [ ] **(Wizard first-hop drop) The API/wizard first-hop enqueue drop remains uncovered — ⛔ never
  absorb it into Phase 145's surface by widening a predicate.** Phase 143 filed it as documented
  non-coverage (`20260816140000:259-265`; the D-05 entry above): a dropped first `sync_trades`
  enqueue leaves "no dailies AND no jobs", byte-identical to a brand-new strategy, so no csv-side
  predicate catches it without re-enqueueing healthy strategies forever. It is shape-identical to
  145's pre-fold windows A–C but has an UNSOLVED distinguishing-signal problem — which is exactly
  why 145 dissolved its own windows via the fold instead of sweeping. Census (1)-minus-(2)
  measured 2026-08-17: **PROD = 0** (no wizard first-hop population; PROD's 18 csv no-dailies rows
  are all 2026-05 incident-era fossils), **TEST = 8107** (all non-csv — the e2e-seed residue
  class). Closing it needs its own signal (`api_key_id` present + no job EVER + a longer grace)
  with its own false-positive analysis — a separate mechanism, never a second predicate bolted
  onto `20260816140000` or onto the fold's resolve arm.

- [ ] **(Inert flag cleanup) Delete the dead `feature_flags.process_key_unified_backbone` row and
  the dead `PROCESS_KEY_UNIFIED_BACKBONE` env vars (Vercel Production + Railway
  `quantalyze-analytics`) — respecting the apply-time RAISE trap.** Zero code readers at HEAD
  (145-REPRODUCTION.md arm 2: the token survives only in two comments and one test constant; the
  historical readers named in `106-RATIFICATION.md:29-30` are gone), so row and env vars are dead
  config, not a live switch. Census (4), 2026-08-17: the row is present on BOTH projects — PROD
  reads `'on'` (updated 2026-05-25), TEST reads `'off'` (diverges). ⛔ Constraint, verbatim from
  145-CONTEXT.md: "Do not flip or delete it in this phase —
  `20260620120000_verification_requests_view_shim_apply.sql:86-89` RAISEs at apply time if it
  reads `off`, so a 'cleanup' delete could redden a future migration apply." (Precisely: the gate
  RAISEs when `value = 'off'` AND `updated_by <> 'migration-104-seed'` — the pristine db-reset
  seed is exempt; a DELETE leaves `v_value` NULL, which passes, but a flip to `'off'` trips it,
  and TEST's row ALREADY reads `'off'`, so re-applying that migration on TEST is hazardous today
  unless its `updated_by` is the seed exemption — unverified.) Cleanup order: retire or guard the
  `20260620120000:86-89` check first, then remove the row and both env vars in the same pass.

## Phase 145 ship-review findings (logged 2026-08-18, /ship review army — none blocking per the blast-radius bar)

Fixed at ship time (not listed): the CSV_PERSIST_FAIL retry fence (user-facing dead button)
and the pytest discriminator-suite re-point. Everything below is deliberate deferral —
clean up opportunistically; none is a persistent user-facing defect or data-integrity break.

**→ ABSORBED INTO PHASE 146.1 (2026-08-18):** the v1.19 xhigh milestone review picked this
whole list up as roster item C4 (with overlaps mapped: fold value guards + fmt-blind
empty-rows → A1, copy honesty → A3, 23505 second source → B3, rpc-test re-point → B5).
Items stay open HERE until 146.1 ships; close them here when it does.

- [ ] ⛔ **OPTION `CSV_FINALIZE_MOVED` — a dedicated error code for the tombstone arm.
  GATED ON WIZFORM-02 CLOSING. Do not pick this up before that gate opens.**
  **What it is:** replace the `MISSING_STRATEGY_ID` code on the
  `flow_type='csv' + step='finalize'` arm with a code that names the actual refusal, so a
  caller can branch on the code rather than parse the sentence.
  **Why it is NOT shipped:** a new code must enter the WIZFORM-02 coverage-law population,
  and **WIZFORM-02 is recorded OPEN** — server-classified codes still render as
  `code: UNKNOWN` at the wizard (Phase 153 span verification FAILED 2026-08-13). Minting the
  code today ships it straight into a known-broken classification path, which is strictly
  worse than an honest message under an existing, correctly-rendered code.
  **Cost when the gate opens:** (1) add the code to the coverage-law population and satisfy
  whatever the law requires of a new code; (2) add a wizard-side classification entry so it
  does not render UNKNOWN, and a render test proving it; (3) the honest sentence shipped by
  146.1-07 stays — the code is additive to it, not a replacement, or the message regresses
  to naming only a code.
  **Where:** `analytics-service/routers/process_key.py` (the tombstone branch beside the
  API-6 envelope); the deliberate non-minting is recorded in the comment there.
- [ ] **Residual: `INTERNAL_API_TOKEN` env sets inside csv-validate-route.test.ts.** NOT
  touched by the 146.1-07 batch, deliberately. The file mixes csv-VALIDATE describes (which
  legitimately forward to the Python service with that token, and pin its absence at
  `:808`/`:1883`) with csv-FINALIZE describes (which no longer need it). Separating the ~28
  occurrences requires per-describe analysis, and a wrong removal would make a token-absence
  arm vacuous rather than merely untidy. Cosmetic; do it as its own pass with the suite run
  between each removal, or split the file.
## v1.19 xhigh milestone review (2026-08-18) → Phase 146.1 owns the residue

15 confirmed findings across `43069db9..4e3effb0` (PRs #687–#690). Full roster with file
anchors: `.planning/phases/146.1-review-v1-19-xhigh-close-out-fold-guards-resolve-arm-honesty/146.1-CONTEXT.md`.

**Fixed same-day** (`fix/v1.19-review-easy`): dead CSV_DUPLICATE_SESSION fence + vacuous
predicate test deleted; `TestTerminalizerWindowInvariant` couples the 4h terminalizer
window to `p_batch_size × max(TIMEOUT_PER_KIND)` (RED observed at simulated 5h); three
false "nobody forwards X-User-Access-Token" comments corrected; fold self-verify check (d)
`%5000%` substring → comment-stripped bounded regex (proven on TEST: widen-RAISES,
guard-deleted-comment-kept-RAISES — the old check false-PASSed the latter).

**→ Phase 146.1** (not re-listed item-by-item here; the CONTEXT roster is the working
copy): A1 fold NULL/[] zero-dailies commits · A2 resolve arm ignores private-vs-
pending_review status · A3 "Nothing was saved" copy on unknowable-commit arms · A4
echoed-outcome metadata overwrite + missing re-enqueue · B1 Python rate-limit
bypass-by-omission (route-enumeration gate) · B2 X-User-Access-Token drop-vs-wire
adjudication · B3 any-23505 undiscriminated (pgConstraintName) · B4 terminalizer×sweep
non-composition (widen conjunct — same item as the RESEARCH §6 residual above) · B5
csv-finalize-rpc.test.ts points at a DROPped RPC (nine 22023 assertions coverage-gone) ·
C1 interior-values echo (FOUNDER: hash vs honest copy) · C2 duplicate handler collapse ·
C3 TEST sweep-cron seed residual (mitigated).

### C1 option (a) — content hash over the CSV payload (NOT taken in Phase 146.1)

**Status: filed, not scheduled. Option (b) — honest copy — SHIPPED in Phase 146.1
(plan 146.1-04), and option (b) is what a reader finds in the code today.** The 200
resolve echo in `src/app/api/strategies/csv-finalize/route.ts` now carries a
`human_message` stating that the arm compared the committed series' ROW COUNT and its
FIRST and LAST dates — and explicitly NOT the individual daily values — and the residual
comment beside the series-equality check records this founder call. The predicate did not
change; the envelope stopped implying an observation that was never made.

**The residual that stays open.** The resolve arm makes exactly two reads of the committed
series (count, and [min,max] boundary dates). A resubmit whose payload has the SAME row
count and the SAME first/last dates but DIFFERENT interior values is indistinguishable to
those two reads and is still echoed 200. The identical-retry case dominates by
construction, which is why (b) is defensible; but the hole is real and is not closed.

**What option (a) would cost — filed WITH its price, because an option without its cost is
an option nobody can decide:**

- [ ] **A content hash persisted at CREATE time.** Requires a new column on `strategies`
      (or a field on `strategy_verifications`) holding a digest of the canonicalised
      daily-returns payload, written inside `finalize_csv_strategy_with_returns` so it
      shares the fold's transaction. The resolve arm then compares the resubmit's digest
      against the committed one and refuses on mismatch — a real equality check instead of
      two boundary reads.
- [ ] **Cost 1 — a THIRD migration.** Phase 146.1 already carries two
      (`20260819130000` fold input guards, `20260819130500` sweep readmit), each with its
      own PROD-risk TEST rehearsal. A third means a third rehearsal and a third apply
      window.
- [ ] **Cost 2 — a BACKFILL question for every already-committed row.** Existing CSV
      strategies have no digest. Computing one requires re-reading each strategy's
      `csv_daily_returns` series and canonicalising it exactly as the write path does — and
      any canonicalisation drift between backfill and write silently refuses honest
      retries forever.
- [ ] **Cost 3 — a nullable-hash FAIL-OPEN period.** Between the migration and the
      completed backfill, `hash IS NULL` means "not measured", not "no match". The arm must
      keep the count+boundary behaviour for those rows (absence is not a value), so the
      residual persists for every pre-backfill row until the backfill lands. That window
      needs a decided length and an observable end.

**Re-opening it is a phase of its own, not an amendment to 146.1.** If the founder chooses
(a), the honest-copy sentence shipped by (b) becomes wrong in the other direction (it would
under-claim) and must be revised in the same change.

## Phase 146.1 execution notes (logged 2026-08-18)

- [ ] ⚠️ **Two competing FastAPI route-enumeration helpers now coexist; consolidate on one.**
  `fastapi>=0.139` defers `include_router`, so `app.routes` holds opaque `_IncludedRouter`
  placeholders and a flat `isinstance(r, APIRoute)` scan sees only app-decorated handlers.
  Two independent fixes exist:
  (a) `tests/test_validate_key_venue_transient.py::_effective` — hand-rolled recursion into
      `route.original_router.routes`; yields the ORIGINAL route objects, whose `.path` is
      **UNPREFIXED**. Correct only because every `include_router` in `main.py:811-825` is
      currently bare. **Latent trap:** the first `include_router(..., prefix="/x")` makes its
      path matching silently miss, and that file's lookup then raises "no route registered"
      (loud) — but any future path-based reader of the same helper would go quietly wrong.
  (b) `tests/test_limiter_route_coverage.py` — `fastapi.routing.iter_route_contexts`, the
      flattener FastAPI's own `get_openapi` uses; composes prefixes correctly.
  Prefer (b) and retire (a). Not done here: (a) is green today and is outside this PR's scope.
  ⭐ Process note: (a) already documented this exact behaviour **in-repo** before I began
  debugging it. Grep for `_IncludedRouter` / `original_router` before theorising next time.

- [ ] ⭐ **Comment-blind greps have now failed THREE times in one phase — make it a lint, not
  a habit.** (1) the fold self-verify's `%5000%` substring, satisfied by a widened `50000`
  (fixed, PR #691); (2) my own `BETWEEN -10 AND 100` check, which false-flagged a COMMENT
  explaining the neuter as executable drift; (3) plan 146.1-04's C1 gate,
  `grep -qiE '…checksum…' && fail`, which was **already broken at its own base commit** —
  it matches honest prose at `route.ts:819` ("closing it needs a checksum, not two reads").
  The executor correctly REFUSED to delete truthful prose to make a grep pass and measured
  intent instead (`sha256|createHash|content_hash|digest` → zero, no crypto import;
  orchestrator re-verified with a comment-stripping parse). ⭐ The general rule: a grep over
  source that does not strip comments is unreliable in BOTH directions — vacuous when it
  should fire, false-positive when it should not. Candidate fix: a shared
  `scripts/grep-code.sh` that strips comments, used by every plan `<verify>`.
## Phase 146 — RATE-04 value-parity candidates (logged 2026-08-18, D-146-4: retuning is founder territory)

Source: `.planning/phases/146-rate/146-AUDIT.md` §3 (fresh at HEAD `e912e38b`). Every number
below was re-read from source that session. Standing caveats: Python slowapi storage is
`memory://` PER REPLICA (values are floors ×N, order-of-magnitude only); `userActionLimiter`
backs ~9 surfaces — the remedy for any of its flows is a NEW named limiter, never a resize.

- [ ] **L-9 `/optimize-weights` per-tenant floor out of pattern (post-TS-04 re-look).**
  Measured: Python 20/min/tenant = 1200/h (`optimizer.py:43-45`) vs max legitimate
  Vercel-forwarded 5/min/user = 300/h (`scenario/optimize/route.ts:151`) — 4× headroom where
  the match.py siblings deliberately size 1.5× (30/min over 20/min). No UX harm (Vercel gates
  first); defense-in-depth sizing only, ×N replicas under memory://. Recommendation: tighten
  to 10/minute per tenant (2× headroom, sibling pattern); the literal pin in
  `analytics-service/tests/test_limiter_identity.py` MUST move in the same commit.
- [ ] **verify-strategy teaser: per-IP front door cannot see the shared anon bucket.**
  Measured: Vercel `publicIpLimiter` 10/min per IP = 600/h/IP (`ratelimit.ts:117`;
  `verify-strategy/route.ts:59`) vs Python `/process-key` anon tier 30/h in ONE platform-wide
  shared bucket (`rate_limit.py:107`, `:148` "Everything anonymous shares ONE bucket",
  `:337`). A handful of concurrent anonymous visitors exhaust the platform's teaser capacity;
  it is also a growth ceiling (~30 verifications/h total). The shared bucket is a deliberate
  anti-abuse control (docblock: one anon IP once drained the whole platform window,
  `rate_limit.py:89-91`) — founder call required. Recommendation: key the anon tier per-IP
  (30/h per IP) to preserve the anti-abuse intent while removing the shared ceiling, or raise
  the shared tier when teaser traffic warrants.
- [ ] **csv-validate: 12× over the shared `/process-key` tenant tier + stale docblock
  citation.** Measured: Vercel `csvValidateLimiter` 20/min/user = 1200/h (`ratelimit.ts:206`)
  vs `/process-key` tenant 100/h (`rate_limit.py:100`) SHARED with keys/sync and
  finalize-wizard. The docblock's own 3-5/min iteration estimate sustained = 180-300/h >
  100/h — plausible legitimate exhaustion mid-iteration (softened ×N replicas). Also the
  `csvValidateLimiter` docblock (`ratelimit.ts:195-206`) still justifies its value against
  "the upstream 30/hour cap" in `routers/csv.py`, but the route rides `/process-key` at HEAD
  (`csv-validate/route.ts:6` imports `postProcessKey`; `/csv/validate` has no TS caller).
  Recommendation: founder call between raising `_PROCESS_KEY_TENANT_LIMIT` or adding a
  csv-scoped tier; fix the stale docblock citation in the same commit as whichever lands.

## Phase 146 close-out notes (logged 2026-08-18)

- [ ] **`analytics-service/tests/` are outside the mypy --strict gate — test_match_router.py
  alone carries 274 strict errors.** The canonical gate (`python3 -m mypy --strict
  --follow-imports=silent services/ routers/ models/`, clean at 91 files) deliberately
  excludes tests/; measured 2026-08-18 while verifying the limiter-flake fix: running strict
  on tests/test_match_router.py reports 274 errors (untyped fixtures/mocks — pre-existing,
  not introduced by Phase 146). Decide: either annotate the test tree incrementally and
  widen the gate directory-by-directory (start with the limiter/parity test files, which are
  newest), or record tests/ as permanently out of strict scope in a mypy config comment so
  the next session doesn't re-derive this. Never widen the gate in the same commit as a
  behavior change.
  ⛔ **CORRECTED 2026-09-23 — the gate command quoted above is no longer the gate.** As of Phase
  164.6.1 it ALSO names the four top-level modules `main.py`, `main_worker.py`,
  `main_worker_healthz.py` and `sentry_init.py` (100 source files). `tests/` and `scripts/`
  remain outside for the same stated reasons; the policy question in this entry is unchanged
  and is NOT carried by 164.6.1. The quoted command is kept as lineage.

- [ ] **`[164.6.3-PLANNING-SUBJECT-DEFERRED-DETECTION]` two assertions whose SUBJECT is real
  `.planning/**` content are hosted by `frontend-test` — the job the docs-only filter now skips on
  exactly the PR class that can move that subject (logged 2026-09-13, Phase 164.6.3 wave 3).**
  MEASURED at the `164.6.3` branch HEAD, by reading both the assertions and the job's new
  condition. `src/__tests__/lint-sql-gates.test.ts` reads `.planning/milestones/v1.20-REQUIREMENTS.md` and
  `.planning/ROADMAP.md` from disk — its `G3` arm, *"the PLANNING DOCUMENTS do not claim more shapes
  than the linter ships"* — and reddens on a planning sentence that still claims FIVE vacuity shapes
  while VAC-03 ships four. `src/__tests__/verify-plan-anchors.test.ts` reads Phase 159's real
  `.planning/milestones/v1.20-phases/159-rank-public-ranking-integrity/159-VERIFICATION.md` and reddens on a
  falsified closing recipe. Both are hosted by `frontend-test`, which now carries
  `needs: [changed-paths]` and `if: needs.changed-paths.outputs.docs_only != 'true'`.
  **CONSEQUENCE.** A `.planning/`-only PR that reintroduces the forbidden five-shapes sentence, or
  deletes or moves that VERIFICATION file, is not caught by its own check board.
  ⭐ **BOTH HALVES, and the second is why this is an entry rather than a blocker: the detection is
  DEFERRED, never LOST.** It still fires twice — on the UNFILTERED merge push to `main` (the
  `push: branches: [main]` trigger is deliberately not filtered, because every commit to main must
  produce its own recorded green run), and on the next code PR. The exposure window is between a
  docs-only PR opening and either of those, and inside it a red arrives LATE, not never. ⛔ Do not
  restate this as "the gate was lost", and do not restate it as "nothing changed" — both halves are
  load-bearing and stating only one of them misroutes whoever picks this up.
  ⛔ **CORRECTED 2026-10-02 (Phase 164.9.4 review round 2, WR-01): the merge push to `main` is no
  longer unfiltered.** Since 164.9.4 a `.planning/`-only push is classified by its pushed range
  (`scripts/classify-changed-paths.mjs` `classifyPushRange`) and takes the short path. To keep the
  first backstop above, the founder decided on 2026-10-02 that a push range touching a `.planning/`
  file a `frontend-test` assertion reads is CODE: `TEST_READ_PLANNING_PATHS` lists the seven measured
  entries (`config.json`, `REQUIREMENTS.md`, `ROADMAP.md`, `159-VERIFICATION.md`, and Phase 164.3's
  `164.3-07-DEFERRED.md`, `164.3-07-PLAN.md` and absent `164.3-07-SUMMARY.md`), so the merge push of
  a docs-only PR that touches one of them still runs `frontend-test`. (Round 3, CR-01, same day:
  `config.json` was added after a whole-tree derivation found `critical-regressions.test.ts` reading
  it; the earlier "six" was measured from two named test files only. The founder confirmed the list
  may grow beyond the original three.) A docs-only push also takes the short path only when Railway's
  own gate would pass on its predecessor: every GitHub Actions check run on `before`, all workflows
  and events, non-red (`docs/runbooks/railway-worker.md`, Recovery step 2). So a docs merge can no
  longer turn `main` green over a red predecessor either. Both halves above therefore
  still hold for those files. The paragraph above is kept as lineage.
  ⛔ **CORRECTED 2026-10-02 (Phase 164.9.4 review round 4, CR-01):** "every Actions check run
  non-red" alone was not proof CI ran on the predecessor (a scheduled workflow's green checks
  passed it). The predecessor must now also carry a successful `frontend` check run, and every
  GitHub Actions check suite on it must be completed and non-red (D-16 in `164.9.4-CONTEXT.md`).
  ⛔ **TWO REMEDIES WERE CONSIDERED AND BOTH REFUSED, recorded so neither is re-proposed as new.**
  (1) Widen the always-on set to include `frontend-test` — REFUSED: that job is most of the saving
  the filter exists to produce, so buying two deferred assertions back at that price undoes the
  phase. (2) Move the two assertions into an always-on job — REFUSED: that changes WHICH gates exist
  and where they live, which Phase 164.6.3's boundary forbids by name.
  Candidate direction, deliberately NOT chosen here: a cheap always-on job whose subject is exactly
  the planning corpus — narrower than `frontend-test` and honest about what it covers. That is a
  decision for the owning phase, not something to improvise at the next merge.
  **OWNER 2026-09-13: Phase 164.6 GATE-HYGIENE.** Routed there for three stated reasons: "when is a
  gate invoked, and can I prove it still bites" is precisely that phase's declared competence, and
  this is a gate that still bites but is invoked LATER than its subject can change; it is the phase
  Phase 164.6.3 was split OUT of on 2026-09-12; and it is still UNPLANNED (`**Plans:** 0 plans`), so
  the item can be entered before breakdown rather than amended into an already-authored plan set.
  ⚠️ Entering the matching ROADMAP criterion is a SEPARATE action this entry does not perform:
  run `/gsd-phase --edit 164.6`. ⛔ A deferral is entered that way and NEVER hand-written into
  `.planning/ROADMAP.md`; naming the destination here is what stops it being blank, and it is not a
  substitute for making the entry.
  Source: `.github/workflows/ci.yml`'s `frontend-test` job header, which carries this same record so
  the ledger and the workflow say the same thing — until now only the workflow did; and
  `.planning/milestones/v1.20-phases/164.6.3-cidocspath-a-docs-only-pr-stops-running-the-code-gates-and-a/164.6.3-02-SUMMARY.md`.

- [ ] **`[PLANANCHOR-SUMMARY-FILTER-01]` the `-pr` filter strips SUMMARY files, so every COMPLETED
  plan reads as PENDING on `main` forever — and `plan-anchor-verify` keeps its `file:line` anchors
  live against a tree that has moved on (logged 2026-09-09, at the PR #767 merge gate).**
  MEASURED on PR #767. `plan-anchor-verify` treats a PLAN.md with no sibling SUMMARY.md as pending
  and re-resolves every anchor it asserts. `/gsd-pr-branch` filters `.planning/phases/` out of the
  PR head **by design**, so a plan's SUMMARY never reaches `main` while the PLAN itself — written
  in an earlier, unfiltered commit — is already there. The pair is split permanently.
  ⛔ **This is not cosmetic and not a PR-only artifact.** `164.8-05-PLAN.md` claimed
  `supabase-migrate.yml:1-251` contains the `Push migrations to production` step. True on `main`
  (:211). Phase 164.8 plan 05 and its review added ~870 lines to that workflow and moved the step
  to :1038 — so the claim went stale ON `main` the moment the PR landed, and `plan-anchor-verify`
  would have been RED on `main`, not merely on the PR. It was caught only because the filtered
  branch happened to surface it first.
  ⚠️ The blast radius is every future renumbering of any file a landed PLAN cites, and it GROWS:
  each shipped phase adds more permanently-pending plans. The one-off fix applied at #767 was to
  correct that single anchor and carry the corrected PLAN through the filter as a named exception
  — which is a workaround, not a resolution, and it needs a filter exception every time.
  Candidate directions, none chosen here: let the filter carry SUMMARY files (they are the
  completion marker the gate reads); or mark a plan complete by something the filter preserves;
  or have the gate treat a plan whose phase is `COMPLETE` in ROADMAP.md as not pending. ⛔ Do NOT
  "fix" it by weakening `plan-anchor-verify` — a gate that stops resolving anchors is the silent-
  gate class this milestone exists to remove.
  **OWNER 2026-09-09: Phase 164.6 GATE-HYGIENE.** Routed there because "when is a gate invoked,
  and can I prove it still bites" is exactly 164.6's competence, and it already owns the sibling
  `[CI-DOCSPATH-01]`.
  Source: measured live at the PR #767 merge gate; the corrected anchor and its dated reason are
  in `.planning/milestones/v1.20-phases/164.8-testpreprod-test-becomes-a-real-pre-prod/164.8-05-PLAN.md`.

## Phase 146.2 — recorded deferrals (logged 2026-08-19)

*The founder rule: an item ABSORBED into a phase is deleted from this file, but an item the
phase deliberately does NOT fix must be re-recorded here. Silent drop is forbidden. The FIRST
FOUR below were re-verified against HEAD on 2026-08-19 before being written down. The fifth
(WR-01, the `createAdminClient()` request-path throw) was appended on 2026-08-20 from the
Phase 146.2 code review and is verified as of that date — it was NOT part of the 2026-08-19
sweep. Recorded because appending it silently left this preamble asserting "all four", which
was then false: the same scope-amendment class this file exists to prevent.*

- [ ] **`20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql:283-288` — the performance
  note cites the WRONG index.** It says the scalar subquery runs "over compute_jobs indexed by
  strategy_id (20260808120000 and the table's own FK index)". Neither citation holds:
  `20260808120000` creates `idx_strategies_user_id` on `strategies(user_id)` (`:127`), which is
  a different table and a different column; and PostgreSQL does **not** auto-create indexes for
  foreign keys, so there is no "table's own FK index". The index that actually supports the
  subquery is `compute_jobs_strategy_id ON compute_jobs (strategy_id) WHERE strategy_id IS NOT
  NULL`, created by `20260412094454_sync_strategy_analytics_status.sql:68-70`.
  ⚠️ **The SUBSTANCE of the performance claim survives** — a supporting index does exist and no
  new one is needed; only the provenance is wrong. Prose-only, non-blocking (the stopping rule
  keeps citation defects off the blocking path). **Fix:** re-point the citation to
  `20260412094454:68-70` and delete the FK-index phrase, in whatever commit next touches that
  migration's header. Do NOT edit the migration solely for this — it is already applied.
- [ ] **`20260819150000_...:283-288` — the same note asserts an execution ORDER the planner does
  not promise.** It says the subquery runs "only AFTER the three cheaper NOT EXISTS conjuncts
  have already discarded the corpus". PostgreSQL gives no guarantee about conjunct evaluation
  order; cost estimates normally place the `NOT EXISTS` semi-joins first, but that is a
  tendency, not a contract. **Reword to:** "the planner is free to order these conjuncts; cost
  estimates normally place the NOT EXISTS semi-joins first." No behavioural impact — the
  candidate set is bounded by `LIMIT 25` downstream and the sweep runs hourly. Prose-only,
  non-blocking; same commit as the citation fix above.
- [ ] **`process-key-client.ts` transport catch: a TRAP-1-shaped error could inline BODY
  credentials into a seam-level CONSOLE line.** The catch scrubs via `scrubSeamError(err)` whose
  per-request secret set is DERIVED from the OUTGOING HEADERS
  (`resilient-fetch.ts` `CREDENTIAL_HEADER_NAMES` → `credentialHeaderValues`, documented at
  `process-key-client.ts:505-509`). That is a deliberate class fix for header-borne credentials,
  and it is strictly better than the caller-declared list it replaced — but a credential carried
  in the request BODY is not in the derived set, so an upstream error message echoing it back
  would survive the scrub into the console line. **Sentry is unaffected: verified 2026-08-19,
  the file contains zero `captureToSentry` call sites**, so the exposure is Vercel function logs
  only. Not a live leak — no known body-borne credential crosses this seam today; recorded so
  the next credential added to a `/process-key` body is not added blind. **Fix direction:** widen
  the derived secret set to include body values of known credential-shaped keys, or assert at the
  seam that no credential-shaped key appears in the body.

## Phase 146.2 — recorded deferrals, SECOND PASS (logged 2026-08-20)

*Why a second pass: the PR #694 body reported the Phase 146.2 code review as closing with
"5 INFO (recorded)". That was false — not one of IN-01…IN-05 had ever been written into this
file — and four further items the phase knowingly did not fix were also missing. A red team
caught it on 2026-08-20; every entry below was re-measured against HEAD (`181eed3b`) before
being written down, and route.ts line numbers are paired with symbol anchors because that
file moves. The founder rule stands, with a sharpened edge: "recorded" is a claim about THIS
FILE, so grep it before you type it.*

- [ ] **`supabase/tests/test_csv_finalize_atomic_fold.sql:565-574` — Part 3e's trailing
  "committed nothing" count block CANNOT FAIL.** The fold call sits inside the probe's own
  `BEGIN … EXCEPTION WHEN OTHERS` (`:545-553`). A plpgsql exception block is an implicit
  SUBTRANSACTION, so any rows the fold wrote are rolled back when it raises — BEFORE `n_strat`
  / `n_sv` / `n_dl` are read at `:565-571`. They are 0/0/0 for a healthy body AND 0/0/0 for the
  exact defect the RAISE at `:572-574` names ("GUARD 1 ran AFTER a write instead of as the
  FIRST statement"). ⚠️ **The Part is NOT vacuous as a whole** — its first three assertions
  (`:555` raised-at-all, `:558` SQLSTATE is 22023, `:561` the message names `p_terminal_status`)
  each discriminate, and the un-provable placement property is separately pinned by the new
  Part 1d no-handler check (`:256-267`). This is guard hygiene, not a live break. ⚠️ **The same
  shape is copied from PRE-EXISTING Part 3d (`:475-481`) — fix both or neither**; removing one
  and leaving the other tells the next reader the shape was reviewed and blessed. ⭐ The sibling
  file states these exact semantics as MEASURED fact —
  `supabase/tests/test_csv_finalize_double_submit.sql:246-253`: a catch-write-and-re-raise
  handler is "NOT caught, and not catchable by ANY row count" because the subtransaction rolls
  the handler's own writes back too. Part 3e was written after that note and did not apply the
  lesson to itself. **Fix:** delete both count blocks and replace them with a comment pointing
  at Part 1d as the real pin, rather than leaving two assertions that read like coverage.
- [ ] **Phase 146.2's own close-out made two completeness claims that were false when
  written.** (a) The PR #694 body reports "5 INFO (recorded)" — the five entries above ARE that
  record, first written 2026-08-20. (b) `146.2-VERIFICATION.md:176-177` states "all appear in
  plan `requirements-completed` fields"; measured 2026-08-20, that field exists in five
  SUMMARYs only (01→R1, 02→R2, 03→R4, 06→R7, 07→R6+W1), while `146.2-04-SUMMARY.md` (R3) and
  `146.2-05-SUMMARY.md` (R5, W2, W3) carry NO such field — so **R3, R5, W2 and W3 appear in no
  plan's `requirements-completed` at HEAD even though all four shipped**. ⚠️ Why this is more
  than tidiness: that frontmatter is what a later milestone audit reads to decide a requirement
  was delivered, so four silently-absent entries make shipped requirements look dropped — the
  precise failure the field exists to prevent, and the inverse of the failure this section
  exists to prevent. **Fix:** add `requirements-completed` to the 04 and 05 summaries, correct
  the PR body, and treat "recorded" / "all appear" as claims to be grepped before typing.
- [ ] **The audit-coverage window is stated as 60 lines; the mechanism is brace-balanced with a
  200-line cap.** `src/app/api/strategies/csv-finalize/route.ts:708-711` warns "⚠️ THE EMISSION
  MUST STAY WITHIN 60 LINES BELOW THIS CALL. That is the law's own coverage window
  (audit-coverage.test.ts `isCovered`)". Measured at HEAD: `isCovered`
  (`src/__tests__/audit-coverage.test.ts:374-424`) walks forward brace-balanced from the
  mutation and stops at the close-brace of the ENCLOSING FUNCTION, with
  `AUDIT_WINDOW_MAX_LINES = 200` (`:331`) only as a hard fail-safe. The flat 60-line window is
  the PRE-P694 behaviour the brace walk deliberately replaced — a flat window let a mutation in
  `POST()` be "covered" by a `logAuditEvent` inside `PATCH()` in the same file. Three lines of
  `146.2-06-SUMMARY.md` (`:52`, `:235`, `:538`) repeat the 60. ⚠️ **The SUBSTANCE survives**:
  the emission sits inside the same function body, 39 lines below the `.rpc(`, so the coverage
  law does hold and the placement warning is still the right warning — only the integer and the
  rule it names are wrong. The failure mode of leaving it: someone "safely" moves the emit 80
  lines down (still same function, still covered) and, believing they broke the law, contorts
  the code instead. **Fix:** restate the route docblock as "the emission must stay inside the
  SAME FUNCTION BODY as the `.rpc(` call — brace-balanced walk, 200-line fail-safe" next time
  that file is touched. Leave the SUMMARY as-is (a shipped artifact is history), but do not
  re-copy the 60 into new prose.
- [ ] **FOLLOW-UP PHASE CANDIDATE — make the FILL arm's recompute actually guaranteed instead
  of refusing when it cannot be.** Phase 146.2 closed the classification gap by REFUSING the
  fill when a recompute is already in flight. That is honest, but it is a NARROWING, not a
  repair: those users get a 409 instead of their classification. Root cause, measured at HEAD:
  `_enqueue_compute_job_internal`
  (`supabase/migrations/20260420073003_allocator_holdings.sql:330-402`) dedupes onto any job
  for the same target + kind with `status IN ('pending','running','done_pending_children')`
  (`:370-376`) and RETURNS the existing id (`:400-402`) — so a fill arriving mid-compute is
  ABSORBED into the running job, and that job already snapshotted the OLD classification. The
  worker reads `asset_class` once at job start
  (`analytics-service/services/analytics_runner.py:1212-1219`, into `_strategy_row` at `:1231`)
  and consumes it far later at `:1399-1401` via `periods_per_year_for_asset_class`, so the
  annualization basis for the whole run is fixed before the fill's UPDATE lands. The route's
  enqueue passes no idempotency key
  (`src/app/api/strategies/csv-finalize/route.ts:1776-1780` sends `p_strategy_id`, `p_kind`,
  `p_metadata` only), so it cannot opt out of the dedupe. ⚠️ **Residual sliver even WITH the
  shipped refusal**: the snapshot at `:1212-1219` runs BEFORE the job marks
  `computation_status='computing'` (`:1238-1242`), so a guard keyed on 'computing' closes the
  dominant window but leaves a millisecond gap between the two. **Fix direction:** either force
  a follow-on job rather than letting the enqueue be absorbed (a distinct idempotency key, or a
  supersede arm), or have the worker RE-READ `asset_class` at write time and compare-and-set.
  Both change the job/worker contract and the queue's dedupe invariant ⇒ **own phase, not a
  point fix.**

## v1.19 milestone audit — integration findings (logged 2026-08-20, audit status: tech_debt; none blocking per the blast-radius bar)

All four were found by the milestone-close integration check at HEAD `00e73aa5`, re-measured by
the orchestrator (code greps + PROD counts) before filing. None blocks the close: the affected
populations measured ZERO on PROD, the failure direction is fail-safe (under-healing, not
runaway), and every v1.19 requirement is satisfied as written.

- [ ] **INT-1 — the 144→143 readmit composition is unreachable for real terminalized orphans
  (and its SQL gate arms pass for the wrong reason).** The sweep's `strategy_analytics`
  exclusion (`20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql:397-402`, list
  includes `'computing'` and `'failed'`) drops any worker-started orphan before the B4 marker
  exemption (`:387-388`) or the `< 3` ceiling (`:390-396`) ever evaluates:
  `analytics_runner.py:1275` runs the unconditional `_mark_computing()` upsert on entry, and
  142's reaper (`20260802120000`) later flips that `computing` → `failed`. Both values are in
  the exclusion list, so a mid-compute orphan terminalized by 144 is never readmitted — it
  settles at a visible `failed` with no auto-retry. The only population that DOES reach the
  ceiling is the claim→mark window (seconds). MEASURED 2026-08-20 on PROD: terminalizer
  markers = **0** (population has never existed); silent under-healed candidates = **0** (the
  one census hit is an honest May-2026 enqueue-failure row). ⚠️ The milestone goal ("detected
  and terminates VISIBLY") is met — readmit was defensive hardening from 146.1-B4, not a
  requirement. TWO sub-items if this is ever picked up: (a) any widening of the analytics
  conjunct must respect that it is THE protection against mass re-enqueue of the
  retention-aged corpus (`test_reconcile_dropped_enqueue_sweep.sql:371-372` gates on exactly
  this); (b) arms C4/C5/C5b seed NO `strategy_analytics` row
  (`test_reconcile_dropped_enqueue_sweep.sql:705-746`), so they prove the ceiling's predicate
  arithmetic, not reachability — seeding analytics at `computing`/`failed` in a NEW arm would
  make the gap executable (and RED until (a) is decided). Migration-header prose at
  `20260819150000:15-26` overstates the readmit path's reach; migrations are immutable, so the
  correction belongs in the successor migration if one is ever written.
- [ ] **INT-2 — no whole-surface limiter coverage law on the Next side (RATE-05 residue).**
  `src/lib/api/limiter-ordering.test.ts:232-234` derives its population from routes that
  ALREADY consume a limiter; `seam-ratelimit-posture.invariant.test.ts:167` derives from seam
  imports only. A new limiterless non-seam Next route is invisible to both. The Python side
  has the wanted shape (`analytics-service/tests/test_limiter_route_coverage.py:407-442`:
  whole-surface derivation ∪ quarantine ∪ `in_neither` anti-vacuity arm) — port that
  partition to `src/app/api`. Phase 146's verification scoped this honestly (D-146-1); this
  item is the widening, not a regression.
- [ ] **INT-3 — RATE-05's requirement text names an artifact that does not exist in source.**
  `withRateLimit` appears in ~15 `.planning/` files and ZERO source files; the shipped
  mechanism is `src/lib/api/withAuthLimited.ts` + `withAdminAuth({rateLimitKey})` (locked
  D-146-1: VERIFIED-EXISTING, no second wrapper). Re-point the REQUIREMENTS.md RATE-05 text
  (and any future grep-gates) at the real symbols so the ledger stops asserting a
  ungreppable name.

## Phase 158 — recorded deferrals (logged 2026-08-20)

- [ ] **[158-OPS-03/SEC] ⛔ ROTATE the two leaked demo accounts — NOT done, and only a human can
  do it (158-REVIEW CR-03).** ⚠️ **The two email/password pairs are DELIBERATELY NOT QUOTED in
  this entry.** This file is tracked in a **PUBLIC** repository, so quoting them here would
  re-publish them on a *more* discoverable surface than the history they already sit in — which
  is the opposite of what this ticket asks for (158-REVIEW iteration-3 CR-01 caught exactly that
  regression: the scrub commit pasted both pairs back in while writing this entry). Identify the
  accounts by ROLE, not by value:
  - **Pair A — the shared e2e login identity** (a gmail address), formerly hardcoded in
    `e2e/for-quants-onboarding.spec.ts`, `e2e/discovery-watchlist.spec.ts` and
    `e2e/match-queue.spec.ts`; see commit `11041327` for the values.
  - **Pair B — the `seed-full-app-demo` allocator identity**, formerly hardcoded in
    `scripts/seed-full-app-demo.ts` and quoted in `docs/demos/2026-04-09-full-app-walkthrough.md`
    + the `CHANGELOG.md` entry; see commit `65e1cc52` for the values.

  Both pairs were committed in plaintext and remain in git history, so they **must be treated as
  published**: removing the text is *not* remediation — **disabling or rotating the accounts on
  every project they exist in (TEST, preview, and PROD) is the only step that actually remediates
  this.** No agent can perform it; do not mark this closed on the basis of the scrub commits below.
  **Done in-pass (text surfaces only):** `scripts/seed-full-app-demo.ts` now reads
  `DEMO_SEED_ALLOCATOR_EMAIL` / `DEMO_SEED_ALLOCATOR_PASSWORD` and refuses without them;
  `docs/demos/2026-04-09-full-app-walkthrough.md` and the `CHANGELOG.md` entry are redacted;
  `.gitleaks.toml` no longer blanket-exempts `.planning/`. Live-surface grep for both pairs
  outside `.planning/` now has exactly **one** tracked hit:
  `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:71-72`, where pair A is the needle
  of an absence-assertion and is retained deliberately (that guard cannot be written without
  naming what must be absent; see the docblock there). A prose backlog entry needs no needle,
  which is why that exception does not extend to this file.
  **Still open beyond rotation:** pair A also remains quoted in
  `.planning/milestones/v0.17.0.0-phases/13-*` and `.planning/milestones/v0.16.0.0-phases/11-PATTERNS.md`.
  Those are historical artifacts and were deliberately left untouched in this pass; the full
  `.planning/` sweep belongs to **v1.20's SEC-02 requirement**, which owns it end to end.

- [ ] **[158-OPS-04] eligibility flip deferred: MODE 2 never measured (same missing
  credentials).** `scripts/drain-test-compute-backlog.ts --flip-eligibility` reduces tomorrow's
  fan-out by narrowing the job's own eligibility predicate on `api_keys` (never by touching the
  schedule), but neither the eligible-key population nor the proposed flip set was measured, so
  no key was flipped. Without it, MODE 1 is a decaying fix: the daily fan-out refills `pending`
  at roughly one row per eligible key. The allowlist is already settled in code (parsed from
  `scripts/seed-full-app-demo.ts`'s `API_KEY_IDS`, plus `is_example`/`published` strategies'
  keys, plus a 7-day age cutoff covering the per-run e2e fixtures), so this is a run, not a
  design. **Fix:** step 4 of the evidence file's protocol, then step 5 if step 4's output reads
  unambiguous.
- [ ] **[158-OPS-04] the two stamped fencing tests did not execute locally.** `python3 -m pytest
  tests/test_compute_jobs_fencing.py -q` from `analytics-service/` reports `16 passed, 28
  skipped`, and `test_defer_compute_job_token_fence` + `test_defer_compute_job_null_token_backcompat`
  are among the skips (`test Supabase project not configured (local dev)`). The stamps were
  verified by region-scoped grep only (falsifiable: the same grep returns 0 against the
  pre-change revision). CI carries the `TEST_SUPABASE_*` secrets and hard-fails rather than
  skipping, so the first real execution of the stamped payloads is the phase's CI run — watch
  it rather than assuming.
- [ ] **[158-OPS-04] e2e specs leak 2 `auth.users` rows per CI run, by convention (158-REVIEW
  WR-11).** `seedTestAllocator` mints users that nothing ever deletes: `seed-test-project.ts`
  calls `auth.admin.createUser` in **four** places and `deleteUser` in **none**, and the
  `cleanup*` helpers it does export delete strategies, not users. Specs affected today:
  `my-strategies` (new this phase, 2 users/run), plus the pre-existing `composer-axe`,
  `composite-onboarding` and `axe-app-wide`. This is exactly the unbounded TEST-artifact
  accumulation OPS-04's drain script exists to mop up, arriving through a second door that the
  drain does **not** cover (it targets `compute_jobs` and `api_keys`, not `auth.users`).
  ⚠️ Do **not** point-fix this in a single spec — that forks the convention in one file and
  leaves the class open. **Fix:** add user teardown to the shared helper (register minted ids,
  `admin.auth.admin.deleteUser` in a `cleanupSeededUsers`), audit the FK cascade for every
  caller, then adopt it across all four specs. Its own reviewed change.
  Counted first: `select count(*) from auth.users where email like '<seed pattern>%'` on TEST,
  so the close is measured rather than asserted.

## Phase 158 — OPS-03 orphan e2e spec dispositions (logged 2026-08-20)

OPS-03 closes as a CLASS, not a partial fix. Census re-derived at HEAD this session (not
carried forward from the dated research table): **53 spec files in `e2e/`, 20 referenced by no
workflow batch list.** Plan 158-06 wired 5 of them (`api-key-flow` + `sync-analytics-flow` →
unseeded batch; `full-flow` + `csv-upload-flow` + `my-strategies` → seeded MA-8 batch), each
run-and-repaired first by plan 158-05. The remaining 15 get a recorded disposition below, one
line each, plus a 16th correcting the `portfolio-pdf-demo` row and a 17th for the DB-types
residual found while recording the decision.

**The class-level finding — read this before wiring any of them.** These specs are not
orphaned individually by accident. Between them they reach for **four mutually incompatible
identity mechanisms**, none of which any CI job provisions: `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`,
`QUANTALYZE_E2E_PASSWORD`, `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, and hardcoded in-file
credential literals — plus a fifth, `PLAYWRIGHT_TEST_STRATEGY_ID`, for fixture identity. They
also use **two different seed-gate constant names** (`HAS_SEED_ENV`, which the MA-8 joining rule
keys on, and `HAS_SEEDED_SUPABASE`, which it does not). The real blocker is therefore ONE
missing convention, not 15 wirings: the seed-helper identity contract (`seedTestAllocator` /
`loginViaForm`, the pattern `wizard-resume` and the new `my-strategies` spec use, and the one
plan 158-05 converted `csv-upload-flow` onto). ⚠️ Wiring any spec below **before** converting it
produces an all-skip run, which is the SAME false-coverage state as orphanhood — a green batch
proving nothing. Verify ≥1 executed, non-skipped case per spec before calling it wired.

Dispositions are one of **wire-later** (belongs in a batch; needs a run-and-repair pass first),
**defer** (blocked on env/identity nobody provisions; tracked, low value until unblocked), or
**delete-candidate** (surface gone — deletion would need its own reviewed change, not done here).
No spec below is a delete-candidate: every route they target still exists (verified against
`src/app/` this session), so deletion would destroy coverage intent rather than dead weight.

- [ ] **[158-OPS-03] ⚠️ two of the five wired specs are ADVISORY, not gating (158-REVIEW WR-06).**
  `api-key-flow.spec.ts` and `sync-analytics-flow.spec.ts` went into the **unseeded `e2e` job**,
  which cannot fail a merge for two independent reasons: its test step carries
  `continue-on-error: true` (kept deliberately for the unfixed
  `getaddrinfo ENOTFOUND placeholder.supabase.co` flake), and the `e2e` job is in **no**
  aggregator's `needs:` — `frontend` gates on `e2e-seeded`, not on `e2e`. In the required form:
  after 158-06 these two **would surface** a regression in a run log; they **would not** have
  stopped it merging or deploying. The other three (`full-flow`, `csv-upload-flow`,
  `my-strategies`) went to `e2e-seeded`, which IS in `frontend`'s `needs:` — that half is
  genuinely blocking. Do not describe the OPS-03 wiring as "now gated".
  **To close:** promote the two contract describes into a lane that can fail. They are pure
  `request.post` contract assertions against localhost and do **not** touch the
  `placeholder.supabase.co` DNS path that motivated the tolerance, so either a
  no-`continue-on-error` step in the `e2e` job or the `e2e-seeded` batch would work.
  ⚠️ Requires a MEASURED run in the target env first — 158-05 measured them green under the
  unseeded job's placeholder env, which is **not** evidence about the seeded job's env, and
  promoting an unverified spec into a blocking gate is how a required check reddens on an
  innocent PR. The ci.yml comment at the unseeded batch list carries the same warning.
  ⛔ **CORRECTED 2026-11-11 (Phase 200 gap closure, plan 13):** the edit page's one-key panel
  tests these two specs carried (Resync, the syncing and failure lines, `Change key…`, the
  Profile link) moved to `e2e/manager-keys.spec.ts`, which runs seeded and logged in in the
  **blocking** `e2e-seeded` list and carries no env self-skip
  (`src/__tests__/manager-keys-e2e-wiring.test.ts` pins it). What is still advisory is the
  unauthenticated contract describes in both specs, `sync-analytics-flow`'s env-gated analytics
  describe and its retired-URL case, so this entry stays open and its **To close** paragraph
  still applies to them.

- [ ] **[158-OPS-03] `admin-csv-status-axe.spec.ts` — wire-later (seeded list).** Already
  conforms to the seeded contract (`HAS_SEED_ENV` present, uses the seed helpers) and
  `/admin/csv-status` still exists, so it is a list-membership change plus one run-and-repair
  pass; it is a single axe case, so the cost of proving it is small.
- [ ] **[158-OPS-03] `discovery-sparkline-regression.spec.ts` — wire-later (seeded list).**
  Seed-contract-conformant and pins a DESIGN.md rule (DIFF-05 single-accent sparklines) that
  nothing else asserts; its 4 cases read live seeded rows, so it needs the seeded batch and a
  run against the shared TEST DB before it can gate PRs.
- [ ] **[158-OPS-03] `discovery-watchlist.spec.ts` — wire-later (seeded list), HIGHEST value of
  the 15.** 544 lines including two genuine RLS proofs (unauthenticated `PUT /api/watchlist`
  → 401, and user-B cannot read user-A's favorites) plus an anon `/browse/[slug]` chrome
  check — security assertions currently running nowhere. Prioritize this one.
- [ ] **[158-OPS-03] `for-quants-landing.spec.ts` — wire-later (seeded list).**
  Seed-contract-conformant; most of its 11 cases are anon (`/for-quants`, `/security`,
  `security.txt`) but one describe is logged-in-gated, so the seeded batch is the right home.
  ⚠️ When wiring, dedupe against `security-page.spec.ts` below — both assert `/security`.
- [ ] **[158-OPS-03] `discovery.spec.ts` — wire-later (unseeded list).** 9 lines, one
  placeholder-safe assertion (unauthenticated `/discovery/crypto-sma` redirects to login) that
  no wired spec covers — checked `auth`, `smoke` and `route-redirects`, none of which touch
  discovery. Cheap to prove, cheap to wire; it just has never been run.
- [ ] **[158-OPS-03] `security-page.spec.ts` — wire-later (unseeded list).** Fully anon
  (`/security` and `/`), no seed env, no identity — genuinely placeholder-safe, so the unseeded
  batch fits with no conversion work. ⚠️ Overlaps `for-quants-landing`'s `/security` describe;
  wire one of them, not both, or the assertion runs twice under different owners.
- [ ] **[158-OPS-03] `simulator-flow.spec.ts` — defer.** Gated on `QUANTALYZE_E2E_PASSWORD`, an
  identity env name used by this spec alone and set in no workflow, so wiring it today yields
  an all-skip batch entry. Unblocks by converting to the seed-helper identity contract.
- [ ] **[158-OPS-03] `strategy-detail-tabs.spec.ts` — defer.** Gated on
  `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`, which this phase recorded a decision NOT to provision
  (see 158-05); it would self-skip every case in CI. Same unblock: convert to seed helpers,
  which mint their own users and need no repo secret.
- [ ] **[158-OPS-03] `match-queue.spec.ts` — defer.** Gated on
  `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and targets `/admin/match`, so it needs an ADMIN
  identity; the seed helpers mint allocator/manager roles only, so this needs an admin-seeding
  path that does not exist yet — a real piece of work, not a list edit.
- [ ] **[158-OPS-03] `sync-flow-queue.spec.ts` — defer.** Gated on
  `PLAYWRIGHT_TEST_STRATEGY_ID`, which no workflow sets, so all 3 cases would skip. This is the
  same never-run env gate that keeps `api-key-flow`'s and `sync-analytics-flow`'s UI describes
  dormant even now that those two are wired — a fixture-identity problem, not a spec-rot one.
- [ ] **[158-OPS-03] `wizard-sync-regression.spec.ts` — defer.** Same
  `PLAYWRIGHT_TEST_STRATEGY_ID` gate, same all-skip outcome; wire it in the same change that
  provisions a seeded strategy id, not before.
- [ ] **[158-OPS-03] `mandate-form.spec.ts` — wire-later (seeded list), after renaming its seed
  gate.** It IS seed-gated and mints its own user via the service role (the acceptable
  pattern), but its gate constant is `HAS_SEEDED_SUPABASE`, not `HAS_SEED_ENV`. ⚠️ The MA-8
  joining rule keys on `HAS_SEED_ENV`, so adding this spec to the list would satisfy the
  documented contract's list half while the in-spec half silently does not apply. Rename the
  constant in the same change that wires it.
- [ ] **[158-OPS-03] `wizard-hydration-probe.spec.ts` — defer, blocked on removing in-file
  credentials.** Carries a hardcoded demo email + password literal at `:38-39` — the same class
  plan 158-05 removed from `csv-upload-flow` (whose hardcoded login was additionally MEASURED
  not to authenticate against the TEST project). Convert to the seed-helper contract and drop
  the literals; do not wire it with them in place.
  2026-08-20: credential blocker RESOLVED — the `:38-39` literals are scrubbed to env-sourced
  `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` with a visible `test.skip` (same commit as the
  `for-quants-onboarding` scrub below). Seed-helper conversion + wiring still open.
- [ ] **[158-OPS-03] DB-types residual — defer (fix in its own reviewed change):
  `scenario_shares` lost its hand-patch tripwire comment.** Found while recording
  `158-DB-TYPES-DECISION.md`. `database.types.ts:2326` is a
  hand-patched block per its own test docblock (`database.types.test.ts:75-81`, migration
  `20260622120000`) but carries NO in-file `HAND-PATCHED` warning comment, unlike its two
  siblings `for_quants_leads` (`:1072`) and `scenarios` (`:2375`). Its type-level pins are
  intact so the load-bearing control still holds; what is missing is the warning to the next
  person who regenerates — and `:1080-1081` records that a prior regen stripped exactly such a
  comment and a human re-applied it by hand. **Fix:** re-apply a tripwire comment above the
  block. Not done in plan 158-06: it edits a generated file outside that plan's declared scope.

---

## Phase 161.1 — recorded deferrals (logged 2026-08-25)

Filed from the phase's own review rounds (migration-reviewer r3, rls-policy-auditor r2,
`/code-review high`). Everything **blocking** from those rounds was fixed in-phase; what
follows is what was deliberately left, with the reason.

161.1-D3. **⚠️ `test_weight_snapshot_seed_secdef.sql:202-214` carries both defects 161.1 just fixed
  one file over.** It pins `NOT r.rolbypassrls` with no `rolsuper` alternative (false-reddens for a
  superuser owner — the flag is only the *explicitly granted* attribute; superuser RLS bypass is
  implicit), and its `IF EXISTS (...)` shape **passes vacuously when the function is absent** —
  measured on a throwaway cluster during this phase, not inferred. Its `OR p.proowner <> v_owner`
  escape makes a false fire less likely but does not close the vacuity. Not in the findings and not
  in scope; the two 161.1 arms deliberately did NOT copy that shape.

161.1-D5. **⛔ `run_stitch_composite_job._stamp_failed` carries the IDENTICAL defect the phase just
  fixed twice.** `analytics-service/services/job_worker.py` (~:5760) reads `computation_status`
  LIVE at stamp time, in the same "ONE select, BOTH columns" as the M-2 flags merge — i.e. its
  guard's oracle is a column the SQL bridge writes, which is exactly the root cause closed on
  hop 1 and hop 2 this phase.
  - **Why it is narrower:** the composite stamp is chain-terminal, so there is no hop-2
    amplification. Its exposure is the F2 shape only — a sibling job's bridge call moving
    `computation_status` mid-crawl and disarming the guard.
  - **Not fixed in 161.1:** it was outside the five findings' file scope, and splitting the read
    touches gate-10/gate-11 territory that a concurrently-edited migration also pins. Fixing it
    blind, in parallel, was the higher risk.
  - **Fix shape:** take the publish snapshot at handler entry and carry it forward, mirroring
    `run_csv_strategy_analytics`'s `refresh_publish_status` / `refresh_publish_warned` keywords.

161.1-D6. **Residual window on the hop-1 oracle — closing it needs the fan-out migration.** The
  fan-out enqueues the derive in SQL, so the earliest oracle Python can take is at handler entry.
  A sibling transition landing between the SQL enqueue and that read still bounces a plain
  `complete` row to `computing`, and the entry read sees it. **The residual fails LOUD, not
  silent** — which is why it did not block. Full closure means minting `publish_status` into the
  job metadata inside `20260825130000` at enqueue time. Documented in-code at the read site.

161.1-D7. **`HealthScore` on grid cards scores a failed row's stale metrics.** `computeHealthScore`
  always returns a number; before the stale-analytics gating a failed row carrying a stale sharpe
  scored ≈93 (green). With the metric cells withheld it now scores ≈33 (muted) — substantially
  better without the component being touched. The residual question is a public-surface UI
  decision: should the badge hide entirely when nothing is computed, rather than score the
  absence? Founder call, not a defect.

161.1-D9. **⚖️ FOUNDER CALL — D-15 publishes a MIXED-VINTAGE factsheet that did not exist before
  this phase.** Raised by the red team (reasoned, not executed); the mechanism is a direct read.
  - `run_derive_broker_dailies_job` is **not** read-only before it hands off. Before
    `_enqueue_csv_analytics` it has already COMMITTED, for the NEW crawl: `csv_daily_returns`
    rewritten, `persist_basis_series` for all three bases, and `_prestamp_payload` upserted with
    `data_quality_flags` **wholesale-replaced** and `metrics_json_by_basis` authoritative.
  - Hop 2 owns `metrics_json` / `returns_series` / `daily_returns` — the cash headline and the
    chart the factsheet actually reads.
  - So under D-15, a hop-2 failure now leaves a PUBLISHED row holding **new** dq flags + **new**
    by-basis scalars + **new** persisted series, beside **old** `metrics_json` / `returns_series`.
    The guard's `payload.pop("data_quality_flags")` reasons "the live row's flags are still the
    truth" — but hop 1 already replaced them, so the flags describe data the headline does not
    reflect. `computed_at` is correctly not advanced, so the freshness chip advertises the OLD
    vintage over partly-NEW content.
  - **Before this phase that state was never published** — hop 2's failure wrote `failed` and the
    factsheet went dark. **The phase trades "dark" for "showing numbers it cannot justify".** Both
    are top-severity classes here; the trade is nowhere acknowledged.
  - The nearest existing comment calls the fresh-series/stale-scalar direction "benign … the next
    re-derive lands the matching scalar and heals it" — reasoning that ASSUMED the analytics hop
    would follow, which is exactly what D-15 removes. With a ~20h cooldown and a chronically
    failing hop 2, the mismatch is durable, not transient.
  - **This is a founder decision, not a defect:** D-15 was chosen deliberately. The options are
    (a) accept mixed-vintage as better than dark, and say so in the header; (b) have hop 1 defer
    its committed writes until hop 2 succeeds; (c) widen the guard to restore hop 1's writes too.

161.1-D10. **The `v_protect_hold` scoping is narrower than its own comments claim — it misses the
  resync path's first and longest hop.** Arm I3 seeds the resync as a `derive_broker_dailies` job.
  A real resync does not start there: `_is_long_fetch` sends `flow_type in {onboard,resync}` to
  `enqueue_compute_job(p_kind='process_key_long')`. `has_live_successor` requires
  `r.kind = f.kind`, so for the WHOLE duration of the `process_key_long` hop — the slowest in the
  system — the protected failure has no successor, the hold stays TRUE, branch (a) stands down,
  and the row keeps advertising its pre-resync terminal status. The hold releases only when the
  TAIL derive is enqueued, i.e. at the end of hop 1 of 3.
  - The migration's residual note frames what is still suppressed as "an in-flight job of some
    OTHER kind", illustrated with a cron poll. It does not say the user's own resync spends most
    of its wall clock in exactly that state. **Correct the note.**
  - Severity capped: for `complete_with_warnings` rows (the entire live cohort) branch (a) never
    advertised `computing` anyway, so the incremental harm is on plain-`complete` rows.

161.1-D11. **⛔ THE REAL CLOSURE for the reuse-collision class: `enqueue_compute_job` needs a
  metadata MERGE arm.** `_enqueue_compute_job_internal` dedupes on `(target, kind)` and on a hit does
  `RETURN v_existing_id`, **discarding `p_metadata` entirely**. Phase 161.1 closed the consequence in
  Python (the resync tail retracts an inherited refresh marker; both honour-sites re-ask the row),
  but the RPC still silently drops every caller's metadata on every collision, system-wide.
  - **Not attempted same-day, deliberately:** that RPC is on every enqueue path in the system. A
    merge arm changes what every caller's metadata means on collision and needs its own review and
    its own blast-radius check — not a ride-along on a phase fix.
  - A merge arm would also remove the read-modify-write in the retraction helper (see D12).

161.1-D12. **Read-modify-write residual in the marker retraction, measured harmless.** The retraction
  reads then writes `compute_jobs.metadata`; a claim committing inside that window loses
  `unified_backbone_at_claim`. Measured harmless — nothing re-reads that key from the row (the drain
  check takes it from the claim's own returned metadata). Recorded because "measured harmless today"
  is a dated claim: re-check if any reader of that key from the ROW is ever added. Disappears
  entirely once D11 lands.

161.1-DEC (founder decisions, 2026-08-25). Two are still not implemented.

  **DEC-1 — Retire frozen-spine gates 1 and 2, KEEP gate 3.** `src/__tests__/phase-29-frozen-spine-guards.test.ts`
  still carries gate 1. Retire gate 1 (no new scenarios/share migration) and gate 2 (`scenario.ts` frozen vs
  baseline), which fenced v1.2's scope only. KEEP gate 3, the `scenarios`/`scenario_shares` RLS honesty
  tests, the sole proof the `get_shared_scenario` SECURITY DEFINER read path was never loosened, and reword
  it as a standing RLS invariant. It unblocks a real `scenario-share` fix (stale legs in a shared blend).
  **Acceptance:** gate 3 must still FAIL when those RLS tests are edited (neuter, observe RED, restore
  byte-identically).

  **DEC-2 — D9: WIDEN THE GUARD to restore hop 1's writes.** The founder chose widening over making the
  refresh atomic; it is not shown implemented. Hop 1 overwrites `data_quality_flags`, the by-basis scalars
  and the persisted basis series before hop 2 runs, so widening needs (a) a snapshot at hop-1 entry of
  everything hop 1 touches and (b) a restore of all of it on the hop-2 failure path. If the snapshot turns
  out large or awkward, revisit atomicity before growing the failure path.

161.1-D4. **Prose/derivation nits, non-blocking.**
  - `analytics-service/tests/test_computing_started_at_stamp.py:649` — census docstring
    self-contradicts: says "the 7 in analytics_runner.py are unchanged in COUNT" and "7 of those 11"
    while asserting 8 and 12.
  - `supabase/tests/test_ledger_refresh_composite_arm.sql:82` — "having executed ZERO of arms A-I"
    left as-is deliberately: it is a dated record of a measurement taken when the file had arms A–I.
    Editing it to A–J would misstate what was measured.

- [ ] **[DRIFT-06] PROD runs an EARLIER revision of three function bodies than the migration chain renders** — ⭐ **SURFACED 2026-09-07 BY THE BASELINE REGENERATION ITSELF, and it is a finding the regeneration was expected to ERASE rather than expose.** All eight `CONTENT_DRIFT_ALLOWLIST` rows in `scripts/baseline-content-drift-check.mjs` were booked on 2026-09-07 with one shared diagnosis — *"the committed dump was taken from PROD on 2026-08-29; the chain has since been re-rendered from migrations that redefine this body"*, i.e. the dump is stale — and one shared `clearedBy`: *"A regeneration of supabase/schema/baseline.sql from PROD."* That regeneration has now been performed. **Five rows cleared and were deleted. Three did not clear, and their `snapshotHash` values did not move by a single bit** — meaning PROD's bodies were never stale, so the shared diagnosis was FALSE for them. The three are `check_fan_in_ready/1` (5 hunks), `reject_sentinel_writes/0` (9 hunks) and `retention_delete_guard/0` (2 hunks). ⚠️ **WHAT WAS MEASURED, per function.** `check_fan_in_ready` is defined by two migrations (`20260411144407`, then `20260510180226`) and PROD runs the EARLIER: the chain declares `v_row_found BOOLEAN` and `SELECT`s `true` into it to distinguish "no parent row" from "a parent row of NULLs"; PROD has neither, so this one is **executable, not cosmetic**. `reject_sentinel_writes` is likewise defined twice (`20260513073518`, then `20260515114310`) with PROD on the earlier: its three `RAISE EXCEPTION` messages carry the short 2026-05-13 wording rather than the 2026-05-15 wording that adds "by user-originated writes (sentinel reserved for sanitize_user)" and the "red-team Finding 4" citation — the guard LOGIC (which sentinel values are refused, on which three tables) is identical on both sides, so this one is message text only. `retention_delete_guard` is the cleanest specimen and the one that rules out the innocent explanation: **exactly ONE migration in this repository defines it** (`20260515113853_retention_crons_safe`), so there is no later revision for PROD to be behind — yet PROD's `RAISE` message omits the clause "This indicates an unbounded DELETE (missing WHERE) — aborting." that this single defining migration contains. A live catalogue cannot lag a migration it is the only definition of. ⛔ **THE TWO CANDIDATE CAUSES ARE NOT DISTINGUISHABLE FROM A READ-ONLY DUMP, and neither is assumed here:** either those migrations never reached PROD, or their FILES were retro-edited after being applied (the class `[⭐Re-base SQL fn before CREATE OR REPLACE]` and the "Drift = OLDER REVISION, not comment-stripped" memory both name). `retention_delete_guard` can only be the second. Settling it needs `pg_stat_statements`-independent evidence — the applied-migration ledger on PROD, or `git log -p` on each migration file looking for an edit dated after its apply. **NOT fixed here, deliberately:** every repair path writes to PROD or rewrites migration history, and this session was read-only by instruction. This is the DRIFT-04 family (production surface that no reviewed artifact describes), one step less severe: the functions ARE defined by migrations, just not by the revision PROD is running. Route any repair through the three-reviewer rule (`migration-reviewer` + `rls-policy-auditor` + `silent-failure-hunter`) before asking to apply. The three allowlist rows are RETAINED with corrected `reason`/`clearedBy` text naming this entry — ⛔ they must NOT be deleted to make the gate green, and a further regeneration will never clear them.

      ⭐ **FIRST ACTUAL READING OF PRODUCTION, 2026-09-19 — and it FALSIFIES the "executable drift"
      half. Every reading in this entry before this line was REASONING FROM DATES; this one is not.**
      Read via the Supabase MCP against the project whose `COMMENT ON DATABASE` marker reads
      `⛔ PRODUCTION — real customer data`. The marker query was run FIRST; `current_database()`
      returned `postgres`, which proves nothing, exactly as CLAUDE.md warns. Read-only —
      `pg_get_functiondef` only, no write of any kind.

      ⛔ **ALL THREE ARE BEHAVIOURALLY IDENTICAL:**
      - `check_fan_in_ready` — the chain declares `v_row_found` and PROD does not, which is TRUE and
        is where the "executable" reading came from. But `v_row_found` is **written and never read**:
        the next statement branches on `IF NOT FOUND`, plpgsql's BUILT-IN, and no later line
        references it. The "no parent row vs a parent row of NULLs" distinction is carried by `FOUND`
        plus the separate `IF v_parent_ids IS NULL` guard — both present in PROD, identically.
        ⭐ A dead local is precisely the shape that reads as executable drift in a text diff and is
        not one. That is the argument for measuring bodies over diffing them.
      - `reject_sentinel_writes` — `RAISE` wording only, as this entry already said. Same predicate,
        same `current_user NOT IN ('authenticated','anon')` gate, same `invalid_parameter_value`.
      - `retention_delete_guard` — `RAISE` wording missing one clause. Same `COUNT(*) FROM old_table`,
        same `> 100000`, same `raise_exception`, same `RETURN NULL`.

      ⭐ **The retro-edit conclusion from 2026-09-08 is CONFIRMED and now has its commit.** All three
      defining migrations entered the repo in ONE commit, `eaaed7e0` (2026-05-15), *"backfill
      audit-2026-05-07 schema + rename migrations to timestamp convention"*. The files are a
      RECONSTRUCTION written after the functions existed in PROD, and written slightly richer than
      what they described — which is why `retention_delete_guard`, with exactly one defining
      migration, can differ without PROD being "behind" anything.

      ⚠️ **THE ONE REAL COST:** PROD's messages are LESS informative, so an operator debugging a
      sentinel rejection or a retention abort sees less context. DIAGNOSTICS, not data integrity —
      fix-or-drop under the founder's 2026-09-15 scoping rule, never blocking.

      ⛔ **CONSEQUENCE FOR THE REPAIR — do NOT write PROD for this.** The contemplated repair applies
      a migration to production function bodies. Measured, that migration would lengthen three error
      strings and add a variable nothing reads. Reconcile in the REPO direction instead: the files are
      already a reconstruction, so matching them to what actually ran costs nothing, needs no PROD
      write, and makes the chain truthful. Then record the trio as MEASURED-BENIGN beside this
      reading. ⛔ Do NOT delete the allowlist rows and do NOT silence VAC-04 — the detector worked
      correctly; what it found is benign, which is a different thing.

      ⭐ **ARCHAEOLOGY DONE 2026-09-08 — TWO OF THE THREE ARE SETTLED, AND THE ANSWER IS THE
      RETRO-EDIT BRANCH.** The entry above named two candidate causes and refused to pick. PROD's
      applied-migration ledger settles it, because `supabase_migrations.schema_migrations` on this
      project carries a **`statements text[]` column holding the SQL text that actually ran** —
      the evidence the entry said was needed. All reads, marker re-confirmed PRODUCTION first.

      **Cause #1 ("never reached PROD") is REFUTED for all three.** Every defining migration is in
      the ledger — `20260411144407`, `20260510180226`, `20260513073518`, `20260515113853`,
      `20260515114310` — and all 265 rows are in the post-rename 14-digit form (`oldform_count=0`).
      The 2026-05-15 rename commit `eaaed7e0` is **R100 on every one of these files**: a pure
      rename, zero content change, so it is not the mechanism.

      **The closed loop, for two functions:** repo file (newer) ≠ ledger's applied text (older)
      **==** live PROD body.

      | function | repo file | ledger applied text | live PROD |
      |---|---|---|---|
      | `retention_delete_guard` (needle `unbounded DELETE`) | PRESENT | **ABSENT** | **ABSENT** |
      | `check_fan_in_ready` (needle `v_row_found`) | PRESENT | **ABSENT** | **ABSENT** |
      | `reject_sentinel_writes` (needle `sentinel reserved for sanitize_user`) | PRESENT | *no usable row* | **ABSENT** |

      The ledger rows were checked to be the functions' OWN definitions, not mere mentions:
      `20260515113853`'s recorded statement contains **exactly one** `CREATE OR REPLACE FUNCTION`
      head and it is `retention_delete_guard`; `20260510180226`'s contains five heads, one of them
      `check_fan_in_ready`, and the string `v_row_found` appears nowhere in the whole recorded
      statement. So PROD is **not lagging a later revision it never received** — it faithfully ran
      an EARLIER TEXT OF THE SAME FILE, and the file was edited afterwards. That also dissolves the
      `retention_delete_guard` paradox the entry called its cleanest specimen: a live catalogue
      indeed cannot lag a migration it is the only definition of, and it isn't — the FILE moved.

      ⛔ **`reject_sentinel_writes` is NOT settled and must not be written up as if it were.**
      Its two definers give no usable evidence: `20260513073518` is one of **9 stub rows (of 265)
      carrying 0 statements**, and `20260515114310`'s recorded fragment is 1,326 chars of a
      24,858-char file and belongs to a different function (`guard_wizard_draft_updates`, "127a").
      Live PROD lacks the newer wording, and `git log --follow` shows no content commit on either
      file after creation — so if a retro-edit happened there it is invisible in git. Open.

      ⚠️ **STATE THE INSTRUMENT'S LIMIT.** `statements[]` is NOT a faithful full record for every
      row. Recorded-vs-repo character counts: `20260411144407` 44,654 / 44,858 (65 statements,
      essentially complete) but `20260510180226` 8,994 / 30,268, `20260515113853` 5,425 / 11,791,
      `20260515114310` 1,326 / 24,858 — each a **single** statement. The two conclusions above
      survive that limit because they rest on what a recorded statement CONTAINS (its own CREATE
      head) versus what it demonstrably LACKS, not on the row being complete. Any further use of
      this column must re-establish that per row; an ABSENT needle in a partial row proves nothing
      on its own, which is why `reject_sentinel_writes` stays open.

      **This does not change the disposition.** Repair still writes to PROD or rewrites migration
      history, still goes through the three-reviewer rule, and the three
      `CONTENT_DRIFT_ALLOWLIST` rows are still RETAINED — a further regeneration will never clear
      them, and deleting them to make the gate green remains forbidden.

      ⭐ **ORCHESTRATOR MEASUREMENT 2026-09-07 — one of the two candidate causes is now RULED OUT for `retention_delete_guard`, by git archaeology rather than by a dump.** The entry above correctly refuses to choose between "never reached PROD" and "the file was retro-edited after being applied". For THIS function the second is now FALSIFIED:
      • `supabase/migrations/20260515113853_retention_crons_safe.sql` has ONE commit at its current path (`eaaed7e0`, 2026-05-15).
      • Following renames, it was `supabase/migrations/121_retention_crons_safe.sql`, created 2026-05-13 in `0f3872c7`.
      • The clause `unbounded DELETE (missing WHERE) — aborting` is present **2 times in the ORIGINAL `0f3872c7` file**, still 2 after the docstring commit `3be19f71`, and 2 today. **The body text never changed** — only the filename did, in the 129-file timestamp rename.
      ⛔ So the file was NOT retro-edited, and PROD's `retention_delete_guard` was therefore **not produced by the only migration that defines it**. The remaining cause is that this body never reached PROD in this form — applied under an earlier revision, created by hand, or overwritten afterwards. That is a stronger and more troubling reading than the entry's original wording, because it means the repo's sole definition of a DELETE-safety guard does not describe the guard production actually runs.
      ⚠️ NOT yet established for `check_fan_in_ready` or `reject_sentinel_writes` — each has TWO defining migrations, so the same archaeology must be done per file before either is characterised. Do not generalise this finding to them.
      ⚠️ `check_fan_in_ready` remains the one with EXECUTABLE consequence: PROD lacks the `v_row_found BOOLEAN` tracking that distinguishes "no parent row" from "a parent row of NULLs".
- [ ] **[SEC-DRIFTPATHS-01] `migration-drift-check.yml` runs PR-head script content with the PROD database password, and the `Production` environment has no required reviewers.** **Still open:** the founder removed the `Production` reviewers on 2026-09-23 (CLAUDE.md), so the question this entry asked is answered "no". Fork PRs are excluded by the workflow's same-repo `if:`, so today the blast radius is push-access collaborators, which is the founder alone. The day a non-founder committer is added it is arbitrary code execution with the production DB password: configure required reviewers (or another gate) before that. ⚠️ Do NOT fix it by removing the gate's own script paths from the workflow's `paths:` filter.

## Phase 164.3 round-4 residuals — ⚠️ SUPERSEDED 2026-08-29: 9 of 11 are now OWNED BY PHASE 164.3.1

### [SECRETSCAN-FULLHISTORY-01] gitleaks full-history scan surfaces fixture secrets a PR scan never sees

**Measured 2026-09-05** on `workflow_dispatch` run 33938272686 (branch `phase-164.4.1-pgcron-lane`,
head `f04ce51b`). `secret-scan` FAILED with findings in ~15 pre-existing files —
`analytics-service/tests/test_*.py`, `scripts/backfill_funding.py`, several
`src/**/route.test.ts` — flagging `SERVICE_KEY`, `EXCHANGE_SECRET`, `api_key`,
`_SERVICE_KEY_CANARY`, `investor_password` literals in test fixtures.

**Why it was green on every PR:** the job checks out with `fetch-depth: 0`, and on a non-PR
event `gitleaks-action` scans the WHOLE HISTORY; on a `pull_request` event it scans only the
PR's commits. Every flagged commit is historical — none belongs to the branch under test.

**Why this is booked, not fixed here:** it is pre-existing, it is not user-facing, and a
pg_cron lane phase is the wrong provenance for a repo-wide fixture-secret sweep (same
reasoning as `[REDUNDER-WINDOWS-COUNTS]` below). It is also NOT nothing: it means a real
secret committed historically would be invisible to the PR gate that everyone reads as
authoritative.

**What to do:** decide whether these fixtures should carry obviously-fake values, be covered
by a reviewed `.gitleaks.toml` allowlist (⚠️ an allowlist is a permanent blind spot — prefer
changing the fixtures), and whether a scheduled full-history scan should run so the gap is
visible on a cadence rather than only when someone dispatches CI by hand.
⚠️ Pin `GITLEAKS_VERSION` when touching this: 8.24.3 silently drops `[[allowlists]]`, and
gitleaks auto-loads `.gitleaks.toml` from cwd, so omitting `-c` tests nothing.

## Phase 164.7 (APPSETTINGS) — SQL-fixer + three-reviewer residuals (logged 2026-09-07)

- [ ] **`[164.8-APPLYTEST-CANNOT-TELL-SEEDED-FROM-APPLIED]` `apply-test`'s affirmative guard refuses on a CORRECT state, and the documented escape routes the migration to PROD without TEST. → Phase 164.9 TESTISOLATION.**
      Booked 2026-09-12, MEASURED while trying to close Phase 164.8's *"land the next real
      migration PR and read the applied-set group"* item. That item is STILL OPEN — the attempt
      to close it is what found this.
      **What happened.** On the Phase-164.8.6 merge push (run **34684247933**, head `ce7ac08a`),
      `apply-test` FAILED in 32 s at step `Push migrations to TEST` with, verbatim:
      *"the TEST push applied ZERO migrations on a push-to-main run … The likeliest cause is a
      schema_migrations row that RECORDS a version whose SQL never executed on TEST … Refusing to
      green-light the PROD apply on a stage nothing crossed."* `apply-test-verdict` then failed as
      designed and `apply` was CANCELLED — the TEST-first gate blocking PROD, which is the gate
      WORKING.
      ⭐ **BUT THE REFUSAL WAS A FALSE POSITIVE, measured directly against TEST 2026-09-12**
      (marker query first: `✅ TEST (shared with other CI)`). Both versions are present AND their
      SQL genuinely ran: `20260911120000` carries **6 real statements** and `20260911130000`
      carries **10**, i.e. actual migration SQL — NOT the seeded provenance sentence that
      `20260907130000` carries (*"SEEDED 2026-09-09 by scripts/restore-test-from-baseline.sh …"*).
      Confirmed by EFFECT rather than by the ledger alone: `match_engine_cron_tick` on TEST
      contains both `INTO STRICT` and `btrim`, the two things `20260911120000` exists to add.
      So the migrations HAD crossed TEST, `db push --include-all` correctly found nothing to do,
      and the guard read a correct empty set as evidence of a poisoned ledger.
      **The root cause is that the guard cannot distinguish two states it treats as one:**
      (1) a version RECORDED but never executed — the real hazard the 266-row re-seed created —
      and (2) a version recorded AND genuinely applied, where empty is the right answer. It
      infers (1) from an empty set on a push, and on a repo where migrations can reach TEST
      outside the push path that inference is unsound.
      ⛔ **THE CONSEQUENCE IS THE SERIOUS PART.** The error message's own remedy is to re-run via
      `gh workflow run supabase-migrate.yml --ref main`, *"where an empty set is tolerated"* — and
      that is what happened: run **34686331921** (`workflow_dispatch`, `756469e6`) applied both
      migrations to **PROD** (`Applying migration 20260911120000_vault_tick_hardening.sql...`,
      `Applying migration 20260911130000_ledger_fanout_grantees_and_dormancy.sql...`,
      `planned 2 migration version(s); push reported 2`) while its own `apply-test` printed
      `planned 0 … push reported 0`. ⚠️ **In THIS instance nothing was harmed — the migrations
      really had crossed TEST.** But the escape is generic: a genuinely-never-applied migration
      produces the SAME red, and the SAME documented remedy sends it to production having crossed
      nothing. The phase premise — *"every migration is proven on a real Postgres before it
      reaches a customer"* — is one false positive away from being bypassed, and the bypass is in
      the error text.
      **Deliverable:** make the guard DISTINGUISH the two states instead of guessing — compare the
      ledger row's `statements` against the repo file (a seeded row carries the provenance
      sentence, an applied row carries SQL), or probe the migration's own effect, before refusing.
      ⛔ Do NOT fix this by loosening the refusal: the empty-set refusal is correct for the hazard
      it was built for, and weakening it re-opens the hole Phase 164.8 closed.
      **Owner:** Phase 164.9 TESTISOLATION, which already owns TEST's ledger shape and the
      `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` sibling.

None of these is blocking under the stopping rule (no user-facing or data-integrity
blast radius). All were surfaced while the fixer grew
`supabase/tests/test_analytics_service_settings_and_vault_tick.sql` from 7 arms to 11
and the three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter)
read the result.

- [ ] **[MATCHCRON-500-INTERMITTENT] `match_engine_cron` is answering HTTP 500 on most hourly ticks, live and unfixed.** MEASURED on PROD 2026-09-12 from `net._http_response`: 09:00 **500**, 10:00 **500**, 11:00 **500**, 12:00 200, 13:00 **500**, 14:00 200, 15:00 **500** — 5 of 7. The 200s return `{"status":"ok","processed":0,"skipped":14,...}` in ~27-28 s; the 500s return a bare `Internal Server Error`. ⚠️ The Railway worker LOOP is healthy (`claim_compute_jobs_with_priority` returning 200 every 30 s), so this is the match-engine cron ROUTE, not the worker. ⛔ Not caused by the deploy churn: the 500s start at 09:00Z, before the day's 13:44Z and 14:39Z deploys. ⚠️ **Blocks nothing today but gates the ledger fan-out**: `enqueue_ledger_refresh_for_strategies` feeds the SAME analytics service, so activating Phase 164.5.1's `ledger_refresh_fanout` into a service failing two thirds of its ticks would manufacture an incident. ⚠️ Root cause NOT established — the current deployment post-dates the failures so its logs do not cover them. ⭐ Side observation while looking: the service logs EVERY line at `severity: error`, including `httpx INFO ... 200 OK`, so a real error is indistinguishable from routine traffic in Railway's log view. **Owner: Phase 164.6 GATE-HYGIENE.**

- [ ] **[LINT-CACHE-MASKS-WARNINGS] `npm run lint` uses `eslint --cache`, so a warning can stop being reported and the job's verdict depends on cache warmth.** ⛔ MEASURED 2026-09-12: `frontend-lint` FAILED on PR #785 — a **planning-only** PR, 56 files all under `.planning/phases/`, **zero `src/` changes** — with `✖ 2 problems (0 errors, 2 warnings)` and exit 1 (lint runs at zero-warning tolerance). The same two warnings were GREEN on `main` and on PR #784 at the same time. Reproduced on an unmodified checkout of `main`'s `src/`: `npx eslint --no-cache` reports both, `--cache` on a warm `node_modules/.cache/.eslintcache` reports neither. So `main` was latently RED and every green `frontend-lint` was a cache hit, not a measurement. ⚠️ The two instances are fixed in v0.77.37.0 (`EquityChart.tsx` exhaustive-deps `period`; an `eslint-disable-next-line` in `ContributionWizardOverlay.tsx:121` that suppressed nothing) — **the MECHANISM is what this entry owns**, not those two. **THE CLASS:** a control whose report depends on a cache is a control that can go quiet without anything changing — the absence-reads-as-a-pass shape this milestone is named for, same family as the `pg_net` green-cron lesson. **Fix options, to be decided rather than assumed:** (a) drop `--cache` from the CI invocation only (keeps the local dev speed-up, makes the gate a real measurement), (b) key the cache on config+lockfile so a stale entry cannot survive, or (c) a dedicated `--no-cache --max-warnings 0` CI step. ⛔ Do NOT 'fix' this by raising the warning tolerance — the tolerance is not the defect. **Owner: Phase 164.6 GATE-HYGIENE.**
- [ ] **[PHASEDIR-ORPHAN-GITKEEP] An empty orphan phase directory makes `gsd-tools` BLIND to the phase, and the `-pr` filter recreates it after it is fixed.** ⛔ MEASURED 2026-09-12: `.planning/phases/` held TWO directories matching `164.1-*` — the live `164.1-prod-observability-…` and a stale `164.1-harden-guards-…` containing nothing but a `.gitkeep` (the phase's ORIGINAL name, before it was renamed). `find-phase` cannot disambiguate two prefix matches, so `query init.phase-op 164.1` returned `phase_found: false`, `roadmap analyze` reported the phase as **`empty` with `plan_count: 0`** despite 6 PLANs and 6 SUMMARYs tracked on `main`, and `roadmap.update-plan-progress 164.1` refused with `"No plans found"`. **Consequence, and it is the reason this is not cosmetic:** Phase 164.1's ROADMAP line sat at `5/6 plans executed` with `164.1-06` unchecked for six days while the plan was `status: complete` and fully shipped to `main` — the bookkeeping could not be corrected by the tool that exists to correct it. ⚠️ This was ALREADY FIXED ONCE and REGRESSED: commit `46daa47c` *"drop the empty 164.1-harden-guards orphan dir that broke find-phase"* removed it, and `22a5fe96` *"strip transient .planning/phases artifacts from the review diff"* put a `.gitkeep` back — the `-pr` filter empties a phase directory but keeps the directory, which is exactly the orphan. So this recurs on every future rename-then-filter, silently. **Fix:** the filter must drop an emptied phase directory entirely rather than leave a `.gitkeep`, AND `find-phase` must FAIL LOUD on an ambiguous prefix match naming both candidates instead of returning `phase_found: false` (a not-found answer for a phase that exists is the absence-reads-as-a-pass shape this milestone is named for). ⚠️ The filter lives in GLOBAL gsd-core (`~/.claude/gsd-core/workflows/pr-branch.md`), which `/gsd-update` overwrites — so per this repo's own precedent the durable backstop is a REPO-OWNED check that fails when two directories share a phase-number prefix. **Owner: Phase 164.6 GATE-HYGIENE.**

- [ ] **[164.7-PLAN03-EVIDENCE-01] Plan 03's lane evidence is not re-derivable from the artifacts it left.** The SUMMARY cites a lane result without the workdir, the apply list, or the exit code that would let a later reader reproduce it. Nothing is known to be WRONG — this is a provenance gap, not a contradicted claim. Recorded because "measured" with no re-derivable trace is exactly the shape that let a false stated-reason survive review twice in this milestone (see `[GATE-COMMENT-D2-FALSE]`). **Fix:** when re-touching plan 03's area, re-run the lane and record the invocation verbatim beside the number.

## Phase 164.7 (APPSETTINGS) — post-merge `gsd-code-reviewer` deep audit (logged 2026-09-10)

- [ ] **[164.7-MIGRATION-COMMENT-DRIFT] ⚠️ **STILL OPEN 2026-09-12, and the attempted fix was DELIBERATELY REVERTED.** Phase 164.8.6 plan 04 made the two blocks agree; a round-1 reviewer graded that **CRITICAL** because it was a comment-only edit to an **ALREADY-APPLIED** migration, and it was reverted — the corrections were carried into the sibling `20260911130000`'s header instead. MEASURED at HEAD: the file is byte-identical to its Phase 164.7 state and still carries BOTH `:7-11` (the two-hash pragma) and `:141-146` ("DELIBERATELY ABSENT from this file today") with unfilled `<measured in plan 06>` placeholders, and NO forward pointer. ⛔ The remedy is NOT to re-apply the edit. Routed to **Phase 164.5.1 CRONREPOINT**, to be corrected FORWARD as header prose in the next migration that legitimately touches this ground. (⚠️ An interim routing to a Phase 164.8.6.1 POSTAPPLY was written here on 2026-09-12 and is VOID — that phase was dissolved the same day rather than opening a third level of sub-iteration; the ROADMAP entry for 164.5.1 carries the item.)
  ↳ ORIGINAL ENTRY: `20260907130000` carries two contradictory VAC-04 acknowledgement blocks** — the second says the pragma is absent while the first *is* the pragma — and `20260907130000`'s comment-strip false-pass analysis is inverted for its own check 6 (WR-03 + WR-08). Comment-only, on APPLIED migrations. ⚠️ Blocked on the same open question as 164.5.1's criterion 6: *does a comment-only edit to an applied migration change what the CLI plans?* No such reading has ever been taken (recorded as PATTERNS TRAP A in `164.7-06-SUMMARY.md`). **Take that reading before editing either file.** **Owner: Phase 164.8.6 VAULTTICKFIX.**

## Phase 164.8.3 (PROBERAUTH) — residuals (logged 2026-09-13)

- [ ] **`[164.8.3-CAPTURE-MANIFEST-ERREXIT]` One step in `prod-prober.yml` still carries the pre-`604d655f` status-capture shape — a latent trap, not a live defect (booked 2026-09-13)** — **The anchor, BY SYMBOL:** the step whose `- name:` key is `Capture the cron manifest (read-only; artifact, never a commit)` in `.github/workflows/prod-prober.yml`. ⛔ Cited by its `- name:` and not by a line number on purpose — this file carries a recorded `[164.7-CITATION-DRIFT-01]` class about re-numbering prose that then drifts, and it has already bitten once in `CLAUDE.md`.
  **MEASURED 2026-09-13 at this branch's HEAD.** That step's `run:` block is `set -uo pipefail`, then a bare `node scripts/prod-prober/run.mjs --capture-manifest --out "$RUNNER_TEMP/cron-manifest.json"`, then `status=$?` on the NEXT line, then `exit $status`. The workflow declares no `defaults:` and no step-level `shell:` key, so GitHub's default `/usr/bin/bash -e {0}` applies and `set -uo pipefail` does not turn `-e` off. It is the EXACT shape `604d655f` removed from the two probe branches after 10 of the last 12 scheduled runs concluded `failure` with zero stdout between `##[endgroup]` and `##[error]Process completed with exit code 1`.
  **Why it is harmless TODAY, stated so nobody reads this as a live bug.** `-e` terminates the step with the same exit status the next line would have captured, and there is NOTHING between the call and the capture — no `cat`, no step-summary write, no posture line. The observable outcome of a failing capture is therefore identical either way. That is precisely what makes it a TRAP rather than a defect: inserting any line between the two silently changes the step's behaviour, and whoever inserts it will be reading a `status=$?` that looks like it works.
  **Why no existing gate sees it.** `src/__tests__/prod-prober-wiring.test.ts`'s branch scan filters candidate lines on `l.startsWith("node scripts/prod-prober/run.mjs") && l.includes("$RUNNER_LOG")`. This step writes to `--out "$RUNNER_TEMP/…"`, never to `$RUNNER_LOG`, so it falls outside the filter by construction. The same file's criterion-8 pin counts `|| status=$?` matches and expects exactly 2 — the two probe branches — so widening that count without widening the scan would red the pin for the wrong reason.
  **Remedy shape (NOT taken here).** Exactly what `604d655f` did for the two `$RUNNER_LOG` branches: a `status=0` initialiser above the call, and `|| status=$?` appended to the call ON THE SAME LINE, so the invocation becomes part of a TESTED compound — the one condition `-e` exempts. Then widen the wiring test's branch scan past its `$RUNNER_LOG` filter so a pin can actually cover this step, and move the criterion-8 count from 2 to 3 in the same edit. ⛔ Do not widen the count alone: a count that rises without a scan that reaches the new site is a gate claiming coverage it does not have, which is this milestone's own named defect class.
  **Destination: Phase 164.8.4 GATERESIDUE — as a NOMINATION, not a silent insertion**, because that phase's goal carries an explicit *"⚠️ **NOT A PRECEDENT.** A second outside item may be admitted only by the same explicit decision, recorded the same way"* fence, and its one widening (`[164.8.5-HYGIENE-RESIDUALS]`, founder decision 2026-09-12) was admitted on the merits and recorded in the ROADMAP entry itself; ✅ **THAT DECISION WAS TAKEN 2026-09-13 (founder): ADMITTED to Phase 164.8.4 as ADMISSION 2**, entered through `/gsd-phase --edit 164.8.4` and recorded in that entry's goal, its merits block, its group (d), success criterion 9 and its Requirements list — the same way ADMISSION 1 was. ⛔ The fence there is re-armed, not removed: a THIRD outside item still needs its own explicit decision. ⛔ **Read criterion 9 before planning** — it names the forbidden half-fix (widening the criterion-8 count without widening the branch scan past its `$RUNNER_LOG` filter). It fits 164.8.4 on subject — "a control narrower than the sentence beside it" is that phase's stated defect class and is exactly what the `$RUNNER_LOG` filter is here. ⛔ `.planning/ROADMAP.md` was NOT hand-edited to route it: roadmap phase CRUD goes through `/gsd-phase --edit`.
  **Found by:** Phase 164.8.3 RESEARCH, whose verdict was *"Dead code, not a defect — book it, do not fix it here."* ⛔ `.github/workflows/prod-prober.yml` is byte-unchanged by that phase; fixing it there would have been scope the phase's own fence excludes.

- [ ] **`[164.8.2-R3-META-WINDOW-UNFALSIFIED]` the tightened `findThresholdSites()` justification
      window has NO fixture that can tell it from the old one (booked 2026-09-18, Phase 164.8.2
      round-3 review WR-01; fix-or-drop — structural predicate, not data-integrity).**
      **MEASURED.** Reverting the adjacent-comment-block walk in `src/__tests__/gate-family-meta.test.ts`
      back to `lines.slice(Math.max(0, idx - JUSTIFICATION_WINDOW), idx + 1)` leaves the suite GREEN
      (21/21). Both existing fixtures put their measurement DIRECTLY above the site, so neither
      distinguishes the two windows. The tightening is real — it reddened a live site the day it
      landed — but nothing in the corpus holds it in place, so a future revert is invisible.
      **Remedy shape.** One fixture whose measurement sits inside an UNRELATED comment block
      separated from the site by a line of CODE: green under the old window, red under the new.
      ⛔ Do not close this by asserting the walk's source text; that pins the implementation, not
      the behaviour, and is satisfied by a comment.
      ⚠️ **Related, same review (WR-04):** the walk traverses BLANK lines, so an unrelated comment
      block separated from the site only by blanks still justifies it. Narrower than intended but
      strictly tighter than the 80-line window it replaced. Close both in one edit or neither.

## Phase 164.8.4 (GATERESIDUE) — residuals (logged 2026-09-19)

Two items the phase's two review rounds surfaced and deliberately did NOT fix. Both were
re-measured at HEAD on the branch rather than carried over as dated claims.

- [ ] **`[164.8.4-REDACT-NO-POSITIVE-SCAN]` the redaction is never CONFIRMED — `sed` exits 0
      whether or not anything matched, and no positive post-substitution scan exists for the
      `.err`/`.log`/`.out` channels (booked 2026-09-19; STAYS IN TODOS by founder decision — see DISPOSITION).**
      **DATA-INTEGRITY, and the highest-value item this phase leaves open.** The published `.sql`
      path has a positive control — `refuse_credential_in_published_sql` asserts the *absence* of a
      credential shape in the file that is about to be published, and refuses. The diagnostic
      channels have no equivalent. Their only protection is that a `sed` script ran; a `sed` whose
      expressions all missed exits 0 exactly like one that redacted everything.
      **WHY IT IS NOT MERELY THEORETICAL.** This phase's own scope was mis-measured twice by
      counting invocation SITES instead of CHANNELS, and the union `.sed` script was assembled by
      hand from previously hand-copied inline blocks. A shape nobody enumerated — a psql or CLI
      error naming a host in wording none of the six expressions match — redacts to itself, exits
      0, and is staged and published to a 90-day world-readable artifact on a PUBLIC repo.
      **FIX SHAPE:** a positive scan between redaction and staging, modelled on the `.sql` path's
      refusal rather than invented fresh — assert the redacted text no longer carries a
      credential-shaped token, and WITHHOLD on a hit. ⛔ Not a `sed` change and not a seventh
      expression: adding expressions is what produced the current hand-maintained union.
      ⛔ The scan must record a VERDICT, never a specimen — a control that logs what it found
      publishes the very thing it exists to suppress.
      ⭐ **DISPOSITION (founder, 2026-09-19): NO PHASE. This stays a TODO.** A phase was briefly
      inserted as 164.8.7 REDACTCONFIRM and then REMOVED on the founder's call, once the blast
      radius was stated plainly rather than assumed.
      **THE SIZING THAT CHANGED THE DECISION — record it so nobody re-escalates this from the
      severity word alone.** No user is affected by this defect: nothing on any end-user path
      touches it, and there are no paying clients. What a miss actually exposes is what the
      workflow's own refusal text names — the TEST pooler host, its IP and the DB user in a
      connect/auth failure. That is RECONNAISSANCE value on SHARED TEST. It is **not** a password,
      **not** PROD, and nothing breaks for anyone when it happens.
      It also requires three things to coincide: a connect/auth failure, wording outside all six
      redaction expressions, and someone hostile fetching the artifact.
      ⚠️ **This is an explicit, recorded OVERRIDE of the standing rule that a data-integrity
      deferral must name an owning phase.** The override is the founder's, it is deliberate, and
      it is written here rather than left silent so the next reader does not "fix" the missing
      phase reference by re-creating one.
      **WHEN TO DO IT:** when it is the cheapest thing on the list, not next. The machinery
      already exists — `refuse_credential_in_published_sql` does this for the four published
      `.sql` files (class list, rc-bounded scan, MEASURE_FAIL on an unreadable file, prints the
      class NAME and never the match, exemptions that must resolve or fail). The work is to
      generalise its hardcoded file list to the derived channels and add calibration arms to the
      existing harness. Roughly one phase of two plans when it comes up.
      ⚠️ **What it buys, stated honestly:** a positive scan is still an ENUMERATED class list, not
      an oracle. It swaps "did we phrase six rewrite patterns to match this error's wording?" for
      "does anything credential-shaped survive?". Detection classes are broader than rewrite
      patterns and both would have to miss together, so it is a real improvement — not a
      guarantee. The honest driver is the ASYMMETRY: same artifact, same 90-day retention, same
      PUBLIC repo, and `.sql` files get refused over while `.err` files do not.

- [ ] **`[164.8.4-LIVEDB-GUARD-LANE-GAP]` two vitest lanes never load the live-DB inheritance
      guard, so neither would fail loud on inherited credentials (booked 2026-09-19).**
      **MEASURED at HEAD, twice independently.** `src/test-setup.ts` carries the guard
      (`assertLiveDbWasIntended`) and is reached through `setupFiles`. Of the four `vitest*.config.ts`
      files in the repo — and they are the only four — `vitest.config.ts` and
      `vitest.local-stack.config.ts` declare it; `vitest.redis.config.ts` and
      `scripts/vitest.config.ts` declare no `setupFiles` at all and are standalone root configs.
      A run through either of those two inherits live-DB credentials silently, which is the exact
      class `[164.8.2-EVIDENCE-DOTENV-LEAK]` booked: a wrapper that injects `.env.local` turns
      SKIPPED live-DB suites into real writes against SHARED TEST.
      **FIX SHAPE:** wire the guard into both lanes. ⛔ Not by relaxing the guard, and ⛔ not by
      touching the skip gates, which are correct. ⚠️ Confirm first whether either lane has a
      legitimate reason to run against a live database; if one does, the guard's sentinel is the
      mechanism for saying so explicitly, not a reason to leave it uncovered.
      ⚠️ The phase's in-file scope comment states this gap. If the gap is closed, that comment
      becomes false and must move with it.

---

## Phase 164.9 (TESTISOLATION) — closing residue (logged 2026-09-21, plan 11)

⚠️ **Booked as the phase CLOSES, because the phase's own standing rule applies to its own
residue first: an item two places disagree about is owned by NEITHER until someone decides, and a
destination left blank is not a destination.** The matching statements live in the
`### Phase 164.9` ROADMAP entry's CLOSING RESIDUE block; the two ledgers are meant to say the same
thing, and a divergence between them is a defect in whichever was edited last.
⛔ Three of the four entries below name a PROPOSED phase rather than a numbered one, because the
executor is not permitted to number a phase. `/gsd-phase --insert` is the act that turns each
proposal into a real destination; **until it runs the owner is the founder** — never blank, never
a prose id. The fourth is owned by the founder outright and needs no phase.
⚠️ **`[164.9-FANIN-STATUS-NEVER-SET]`, the confirmed PRODUCTION defect this phase surfaced, is
deliberately NOT here — it is in `## 🔴 FIX NOW`**, because a live data-integrity defect filed in
a tail residual section is the same disappearance this residue exists to prevent.

## Phase 164.4.2 (SUBSETSPLIT) — closing residue (logged 2026-09-24, plan 10)

⚠️ **What this phase did NOT do, booked as decisions rather than left implied.** The phase closed
`[REDUNDER-SUBSET-SPLIT]` (above, in place) and moved `sql-tests` off the shared-TEST key. The
entries below are what it knowingly left. None is data-integrity or user-facing on current
evidence, so none earns a phase by that rule; each is fix-or-drop here, with an owner, a trigger
and a date. The one exception to watch is `[164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH]`: if
its measurement confirms the crash on PROD, it moves to `## 🔴 FIX NOW` and gets a phase.

- [ ] **`[164.4.2-LANE-ONLY-REASON-STALE]` The one `-- LANE-ONLY:` marker in the gate corpus
      argues from shared TEST, but the job that reads it no longer runs there (booked 2026-09-24,
      Phase 164.4.2 plan 10; found by plan 05, Findings 2).**
      `supabase/tests/test_prod_prober_cadence.sql` carries a marker whose `reason` says shared
      TEST "carries the real pg_net", so running the file there would send real outbound HTTP.
      Since plan 05, `sql-tests` runs on a local-stack lane private to its runner, not shared TEST.
      The exclusion still holds on the lane, for a DIFFERENT reason: the file asserts against
      `net._lane_posts`, a pg-lane stand-in that no Supabase stack has. `sql-tests`' job header in
      `ci.yml` states the new reason. The marker's `reason` text and the matching `why` string in
      `LANE_ONLY_SITES` (`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`) were
      deliberately NOT edited: `supabase/tests/` is pin-counted, and a text edit there moves pins
      this phase had no reason to move.
      **Trigger:** the next edit to that file or to `LANE_ONLY_SITES`, or the first reader who
      takes the marker's stated reason at its word.
      **Owner:** THE FOUNDER. Fix (re-word both strings together, in the same commit as any pin
      they move) or drop (accept the divergence, recorded here).

- [ ] **`[164.4.2-LANE-REPLAY-REFUSES-ON-EMPTY-DB]` D-F's known consequence: a migration newer
      than the dump that refuses on an empty or unidentified database reddens EVERY lane-booting
      job until the dump is regenerated after its PRODUCTION apply (booked 2026-09-24, Phase
      164.4.2 plan 10).**
      This is the lane analogue of `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`, and it does not
      duplicate that entry: read the escape entry for the house style (a data-reading `DO` block
      that `RAISE EXCEPTION`s on an unexpected count) and for its candidate shapes. The lane
      replays every migration the committed marker says the dump does not carry, in filename
      order, as authored, and a replayed migration that errors is FATAL by design. So a migration
      that reads PROD-populated rows, or checks which database it is on, applies on PROD, refuses
      on the lane, and turns `sql-tests`, `frontend-local-stack` and `frontend-live-db-lane` red on
      every run until a founder re-dump (with its marker, in the same commit) takes it off the
      replay set.
      ⚠️ **What the lane's reference data is.** The lane's reference-data rows come ONLY from
      CARRIED migrations, through the FILTERED allowlist plan 06 hands the extractor. A replayed
      migration's own reference INSERTs run once, inside its replay. Anything that reasons about
      "the lane's reference data" must not assume the full allowlist.
      **Interim remedy:** revert the merge or re-dump, the same as the escape entry. ⛔ Never make
      the replay tolerate a failing migration: a replay that skips an error is a lane that no longer
      matches what PROD applied.
      **Trigger:** the first lane boot that prints `FATAL: replayed migration <file> failed` on a
      migration PROD applied cleanly.
      **Owner:** THE FOUNDER; the same decision as the escape entry's candidate shapes.

- [ ] **`[164.4.2-WIZARD-ARMS-SEED-AS-AUTHENTICATED]` Six `wizard-rpcs-live-db` arms set up their
      data as `authenticated`, which PROD correctly refuses; re-point them or retire them (booked
      2026-09-24, Phase 164.4.2 plan 10; found at plan 08's ledger reconciliation).**
      After plan 08 reset the lane's default ACLs, the lane holds exactly the dump's grants. The
      dump grants `create_wizard_strategy` to `service_role` only, as PROD does since Migration B
      (`20260814120000`) withdrew `authenticated` EXECUTE. The six arms now fail at the GRANT
      layer (`permission denied for function create_wizard_strategy`). The lane is right and the
      arms are stale, as the test module's own header predicted. They are ledgered as **K3** in
      `scripts/live-db-execution-ledger.txt` (re-kinded from K2 by plan 08, `ENTRY_CEILING` 18 →
      10), so the lane stays green only because the failing set matches the ledger exactly.
      This supersedes the K2 reading of these six in `[164.9-LIVEDB-LANE-EXECUTION-CENSUS]`.
      **The decision owed:** re-point the six arms' setup at a `service_role` seed, keeping what
      each arm asserts, or retire them in favour of the SQL gate that already covers the grant.
      ⛔ Not closed by widening the ledger or granting `authenticated` EXECUTE back.
      **Trigger:** the next edit to `src/__tests__/wizard-rpcs-live-db.test.ts` or to the ledger.
      **Owner:** THE FOUNDER.

- [ ] **`[164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH]` PROD may run a Postgres image whose
      supautils kills a backend on a function EXECUTE denial after SET ROLE; UNMEASURED on PROD
      (booked 2026-09-24, Phase 164.4.2 plan 10; found at plan 08's checkpoint).**
      Measured on the LANE: `supabase/postgres` images `17.6.1.104` through `.112` ship supautils
      3.2.0. On those images, a `postgres` session that `SET ROLE`s to a role named in
      `supautils.hint_roles` and is refused EXECUTE on a function ends with
      `terminated by signal 11: Segmentation fault`. Postgres then restarts every connection.
      Emptying `hint_roles` removed the crash, which confirms the cause. supautils 3.2.2 fixed it
      upstream, and `17.6.1.113` is the first image that ships 3.2.2. The lane now pins `.113` and
      probes the crash shape at every boot. PostgREST-shaped traffic (`authenticator` plus
      `set_config('role', …)`) did NOT crash on the same image.
      ⚠️ **Why it may concern PROD:** migration-drift-check's log showed the linked project pulling
      `17.6.1.104`. Whether hosted PROD's supautils configuration matches the image default was
      NOT measured, and no remote was touched.
      **The act:** check PROD's Postgres logs for `terminated by signal 11`, and consider upgrading
      PROD's Postgres to `17.6.1.113` or later. On a confirmed crash, move this entry to
      `## 🔴 FIX NOW` and give it a phase.
      **Trigger:** now. It is a measurement, and only the founder can take it.
      **Owner:** THE FOUNDER.

### TRUNCREVOKE-ADMIN-DETECTOR-01 — a read-only PROD check for the `supabase_admin` TRUNCATE, TRIGGER and MAINTAIN residual (booked 2026-10-08, founder D-05 of 164.9.7; widened 2026-10-09, founder D-09 of 164.9.7.1)

**Why.** Phase 164.9.7 revoked TRUNCATE, and Phase 164.9.7.1 TRIGGERREVOKE then revoked TRIGGER and MAINTAIN, from `anon` and `authenticated` on every `public` relation and in the `postgres` default privileges. Neither can touch the platform admin role's default-ACL row on `public`, which still grants `arwdDxtm` (TRUNCATE, TRIGGER and MAINTAIN included) to anon and authenticated on any table that role creates. Measured on PROD 2026-10-08 18:16 UTC: that role owns 0 `public` relations, so the grant is latent. The founder accepted the residual on 2026-10-07 on condition that a PROD check exists ("Accept, add a PROD check"), and on 2026-10-08 accepted the same residual for TRIGGER and MAINTAIN (D-09 of 164.9.7.1).
**2026-10-09, Phase 164.9.7.1 measured the same row.** The PROD BEFORE reading (`164.9.7.1-PROD-READINGS.md`, read through `aclexplode(...).privilege_type`) shows the platform admin role's table row granting both `TRIGGER` (`t`) and `MAINTAIN` (`m`) to anon and authenticated, exactly as it grants TRUNCATE. `postgres` is not a member of that role and cannot alter the row, so the migration does not name it.
**What to build.** A read-only check, run on the existing prober cadence or the nightly, that fails loud when either of these holds:
- (a) any relation in `public` is not owned by `postgres`;
- (b) any non-`postgres` `pg_default_acl` row on `public` grants TRUNCATE, TRIGGER or MAINTAIN to anon or authenticated **and** that role owns at least one `public` relation.

It runs the marker query first and reports counts only.
**Owner:** the next phase that touches the prod prober (the detector is not built by 164.9.7 or 164.9.7.1; neither phase scopes prober work).

### MAINTAIN-LANE-PG17-01 — move the sql-mutation pg-lane to PostgreSQL 17 so the gate's MAINTAIN half can be twinned (booked 2026-10-09, founder D-07 of 164.9.7.1)

**Why.** `MAINTAIN` exists only from PostgreSQL 17. The `sql-mutation` pg-lane boots PostgreSQL 16 (`/usr/lib/postgresql/16/bin` on the CI runner), where `GRANT MAINTAIN` raises `unrecognized privilege type`, so none of the gate's MAINTAIN half (`test_truncate_revoke_anon_authenticated.sql`, the `v_verbs` branch behind `server_version_num >= 170000`) can carry a `RED-UNDER-M` twin: the mutation corpus cannot show a MAINTAIN regression RED. The half runs on the PG17 local-stack lane (image pinned `17.6.1.113`, `LANE_PG_VERSION` in `scripts/local-stack/run.sh`), which asserts but does not mutate.
**What to build.** Move the pg-lane to PostgreSQL 17: install `postgresql-17` and its pg_cron package on the runner, point `PGBIN` at it, re-prove every annotated gate file on the new major (an arm that bit on 16 may not bite on 17), then add the missing twins for the MAINTAIN branches of VERB 1 to VERB 5 and read the new floor from one full run.
**Until then (D-07 compensating controls).** The migration's own self-check raises on any remaining MAINTAIN holder on every PG17 apply; one manual PG17 RED was recorded in the 164.9.7.1 plan 02 SUMMARY; `src/__tests__/local-stack-lane-wiring.test.ts` pins that the gate lists MAINTAIN in its PG17 branch and that the local-stack lane stays at major 17 or newer; and this booking.
**Owner:** whoever next touches `scripts/pg-lane` or the `sql-mutation` job in `.github/workflows/ci.yml`. **Trigger:** the runner image resolving PostgreSQL 17 for the pg-lane, or the next MAINTAIN-related gate edit.

### TRIGGERREVOKE-LOCKHOLD-01 — a client role can still hold a table-wide ACCESS EXCLUSIVE lock through UPDATE or DELETE (booked 2026-10-09, founder D-08 of 164.9.7.1)

**Why.** Phase 164.9.7.1 revokes MAINTAIN, but `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` is also permitted to a holder of UPDATE, DELETE or TRUNCATE (PostgreSQL 17 `LOCK` documentation). Measured on PG 17.6: `authenticated` holding UPDATE and DELETE and no MAINTAIN took an ACCESS EXCLUSIVE lock; `VACUUM` and `ANALYZE` as that role only warned and skipped, and `REFRESH MATERIALIZED VIEW` raised `permission denied`. So the phase closes the TRIGGER attach vector and VACUUM, CLUSTER, REINDEX and REFRESH MATERIALIZED VIEW as a client, and does NOT close the lock-hold outage the 164.9.7 review and the ROADMAP goal sentence described. A client connection that opens a transaction, takes the lock and idles blocks every other reader and writer of that table until it ends. Row-level policies cannot stop it: they never evaluate `LOCK`.
**What to build.** A role-level `statement_timeout` and `idle_in_transaction_session_timeout` on `anon` and `authenticated`, bounding how long any client transaction can hold a lock. This is an **unmeasured assumption** (RESEARCH A5): measure that the PostgREST path honours a role-level setting and that no legitimate client request needs longer, on TEST first, before relying on it. Revoking UPDATE and DELETE is not an option (they are the product's write path).
**Owner:** the next phase that touches client-role session settings or the database hardening backlog. **Trigger:** any report of a lock stall on a client-facing table, or the first phase that sets role-level timeouts.

### TRUNC4-DEFAULT-WITHDRAWAL-01 — the gate's TRUNC 4 asserts client SELECT on a fresh probe table, which the 2026-10-30 platform default withdrawal removes (booked 2026-10-09, 164.9.7.1 RESEARCH Pitfall 6)

**Why.** Arm `TRUNC 4` of `supabase/tests/test_truncate_revoke_anon_authenticated.sql` creates a probe table as `postgres` and asserts that `anon` and `authenticated` still hold SELECT on it (the positive control that the revoke did not widen into a blanket withdrawal). The Supabase default-grant withdrawal dated 2026-10-30 stops new tables from inheriting S/I/U/D for the client roles. After the first re-dump of `supabase/schema/baseline.sql` taken after that date, `TRUNC 4` is expected to go RED on the lane although nothing in the revoke regressed. How the platform applies the change to each project's `pg_default_acl` is not documented (RESEARCH A2), so the exact moment is unmeasured. The 164.9.7.1 arms VERB 1 to VERB 5 avoid the shape on purpose: their positive controls read EXISTING tables.
**What to build.** Re-point `TRUNC 4`'s positive control at an existing table (as `VERB 4` does with `cron_runs`), or assert the default-ACL row the project actually has, keeping the twin biting.
**Owner:** the next edit of that gate after the first re-dump taken after 2026-10-30. **Trigger:** `sql-tests` going RED on `TRUNC 4` after that re-dump; read it as this entry, not as a regression of the revoke.

## Phase 164.6.6.1 (MT5SCRUB) — booked at close 2026-10-14

### MT5SCRUB-L3-JOBS-TERMINAL-READING-01 — take the jobs terminal's L-3 reading (heal timing and launch command line) at the next natural ipc_fault (booked 2026-10-14, founder decision D-16 "Close, book L-3")

**Why it is open.** Phase 164.6.6.1 closed `passed` without ever observing a jobs-terminal `ipc_fault`: `L-3: NOT OBSERVED (no ipc_fault in 2026-10-05..2026-10-14; Railway logs only cover the deploy booted 2026-10-14, so a fault cannot be ruled out either)`. So criterion 2's live half is booked, not proven: nobody has measured the jobs terminal's kill-to-authorized time against `_RELAUNCH_SETTLE_S`, or read its credentialed-launch command line after a real scrub relaunch (the 2026-10-05 baseline booleans exist, the post-fault ones do not).
**Failure scenario.** The first real `ipc_fault` takes longer to relaunch than the settle window, or leaves an argument on the command line beyond `/portable`. Nothing in the unit gates would show it, because they run against an in-memory double.
**What to do.** At the next natural `ipc_fault` on the jobs terminal, read-only: the escalation line ("escalated to a terminal-process recycle with a saved-account scrub"), its `relaunch_elapsed_s`, whether it fit inside `_RELAUNCH_SETTLE_S`, that no VNC session was used, the Journal `logs` count against the 2026-10-05 baseline, and the four process booleans (count, `/portable`, anything beyond it, parent pid 1). Counts, kinds and booleans only; never print an argument line. Record it in `164.6.6.1-CONTEXT.md` and close this entry.
**Never induce a fault** to take the reading. Railway retains analytics logs for the current deployment only, so look soon after the fault.
**Owner:** founder/ops. **Trigger:** the next `ipc_fault` escalation log line. Related, not this entry: `MT5-RELAUNCH-DEBT-LEASE-WAIT-01`, `MT5-JOB-TERMINAL-TRADES-SCRUB-01`, Phase 164.6.8 OUTAGEALERT criterion 2 (WR-02).

## Shared UI — booked 2026-10-14 (ShareableLink flake fix, v0.131.5.3)

### SHARED-MODAL-CLOSE-FRAME — the shared Modal can paint one empty frame before its native close (booked 2026-10-14)

**Failure scenario.** `src/components/ui/Modal.tsx` calls the dialog's native `close()` from a passive `useEffect([open])`. When `open` turns false in a commit that is not a sync lane (for example after an `await`, as on a successful share revoke), React schedules that effect as a separate task. A browser can then paint one frame where the dialog shows its title and Close button with its body already unmounted. Nothing gets stuck: close always runs once, and the top layer and inert state clear when it does.
**Fix.** Run the close in `useLayoutEffect`, so it lands in the same commit, and re-run every Modal consumer's tests.
**Owner:** the next phase touching `Modal.tsx`.

## Phase 167.1.2.1.2 (HISTORYREADER) — routed items (logged 2026-10-20)

### 167.1.2.1.2-DEPARTED-UNLINKED-KEY — a departed key with no account identity can show older rows beside a live key on the same exchange (booked 2026-10-20, 167.1.2.1.2 D-01, USER-FACING, KNOWN LIMIT by founder decision)

**Founder decision 2026-10-20 (CONTEXT D-01): "Close by decision + TODO (Recommended)".** No code.

**Scenario.**
- A departed key that was never stamped with `venue_account_id` and never marked is not grouped with its account by `accountIdentityTokens` (`src/lib/departed-history.ts`).
- So a live key's newer reading on the same account does not supersede that key's rows, and both can show.
- Counts-only reading, 2026-10-20: 5 departed Bybit keys carry no identity and still have `allocator_holdings` rows; 0 of them have a live key of the same owner on the same exchange; 2 sit beside another departed Bybit key with rows.
- What already discloses them: the rows are struck through with the key's disconnected chip, held out of the totals as untrusted, derivative rows are dated by the read-day note, and spot rows are dated by this phase's D-05 line.

**Fix if triggered.** Group the key (stamp or mark it) or hide its rows as superseded. Any grouping change moves Python `account_groups`, TS `accountIdentityTokens`/`keyAccountOf`, `one_key_per_account_day`/`oneKeyPerAccountDay` and the `queries.ts` reader together (167.1.2.1 WR-03).

**Owner / Trigger:** a departed key with no identity beside a live key on the same exchange (re-measure with a counts-only read before acting).

## Phase 166.5.1 (SENTRYTRIAGE) — routed items (logged 2026-10-21)

### 166.5.1-DERIVE-BATCH-RESET-RESIDUAL — a derive_allocator_equity run behind slow batch-mates can still pass 20 minutes and be reset (booked 2026-10-21, 166.5.1 D-05 / code review WR-01, DATA INTEGRITY)

**Reading.** Phase 166.5.1 gave `derive_allocator_equity` a 20-minute watchdog override (`WATCHDOG_PER_KIND_OVERRIDES` in `analytics-service/main_worker.py`). The claim RPC stamps one `claimed_at` on a whole batch of 5 (`p_batch_size` in `_claim_priority`) and `dispatch_tick` runs the batch one job after another, so a job's staleness clock includes its batch-mates' runtime. On the backfill worker the batch-mates are `derive_broker_dailies` jobs, each with a 15-minute handler timeout. A derive job behind two slow ones can pass 20 minutes. The watchdog then returns the row to `pending`, its runner's `mark_compute_job_done` / `mark_compute_job_failed` is refused (P0002, QUANTALYZE-2A / A), and the job can run twice. PROD measurement, read-only 2026-10-21, last 14 days: 110 `derive_allocator_equity` jobs, median claim age 5.8 s, max 604 s; whole 5-job batches containing one finished within 606 s; 2 jobs had attempts=2, both re-runs (2026-10-15 and 2026-10-18). That 606 s is capped by the old 10-minute reset, so it is a floor, not the tail.

**SC-3 status.** ROADMAP 166.5.1 SC-3 ("a finished job is never lost or run twice") is PARTLY met (founder D-05, "Keep 20 min, book gap"): the common case is fixed and its tests can fail, the slow-batch-mate case is not.

**Fix.** A lease or heartbeat that renews `claimed_at` while a runner works, so the staleness clock measures silence and not batch position. The deferred heartbeat/lease work owns it; a batch size of 1 for the backfill role would also close the mechanism but was not chosen.

**Owner / Trigger:** the deferred heartbeat/lease work. Trigger: QUANTALYZE-2A or QUANTALYZE-A fires again after the 166.5.1 deploy, or the 48 h Sentry read (D-04) shows a P0002 on `derive_allocator_equity`. Closed when a long run's claim age is renewed and a test reproduces a batch-mate wait past 20 minutes without a reset.

⭐ **2026-10-26 (Phase 166.5.1 close-out): the trigger was read and is NOT met; stays open.** The post-deploy Sentry readout (T_DEPLOY 2026-10-22T06:32:30Z, read 2026-10-26 about 06:20Z, about 96 h later) found 0 events since T_DEPLOY for all nine groups, QUANTALYZE-2A and A included, and all nine were resolved in Sentry. The slow-batch-mate case is latent, not fixed: no P0002 means it has not fired in that window, not that it cannot.

## Phase 167.2.1.1 (UPNLVENUES) — routed items (logged 2026-10-22)

### 167.2.1.1-DERIVE-USDT-ONLY-ANCHOR — the Bybit derive anchor reads the USDT coin only while the reconstruct anchor and the holdings poll read every coin (booked 2026-10-22, 167.2.1.1 plan 01 decision PD-E, DATA INTEGRITY)

**Reading.** The derive anchor (`fetch_usdt_balance_with_status`) reads only the USDT coin. The reconstruct anchor and the holdings poll sum every stable coin. For an account holding a non-USDT coin the three paths disagree by that coin's balance. Pinned by `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin`. Exposure is unmeasured until the D-01 live read.

**Owner / Trigger:** founder routing. Trigger: the D-01 probe reports `non_usdt_coins_present` true for any key. Closed when the derive anchor covers every coin as the reconstruct does, or the restriction is decided and documented, with the pinning test flipped.

2026-11-02 (Phase 176 LEGACYRETIRE): unaffected. `_fetch_current_equity` survives for the Binance mark, so `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin` still compares the derive anchor with it. **Stays open.**

### 167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY — Bybit positions are read for USDT-settled linear contracts only, so other settle categories carry uPnL the anchor does not add (booked 2026-10-22, 167.2.1.1 RESEARCH, DATA INTEGRITY)

**Still open (narrowed 2026-11-02 by Phase 176).** The holdings poll still lists USDT-settled linear Bybit positions only (ccxt `fetch_positions()` with no symbols, and the raw-V5 fallback asks for settleCoin USDT), so USDC-settled perps and inverse positions, and their uPnL, are missing from holdings. The reconstruct anchor that shared the gap was deleted by Phase 176, and the Bybit mark reads the Unified Trading Account totals. **Closed when:** the holdings poll reads every settle category, with a test.

### 167.2.1.1-BINANCE-FUTURES-WALLET-UNREAD — Binance is read with ccxt's default spot type, so a futures account's collateral never reaches any path (booked 2026-10-22, 167.2.1.1 plan 02 decision PD-D, DATA INTEGRITY)

**Still open (narrowed 2026-11-02 by Phase 176).** Binance is read with ccxt's default spot type, so a futures account's collateral never reaches the derive anchor or the holdings spot rows, while `fetch_positions()` returns USD-M futures positions. If Binance is ever read with a futures type, `total` already includes uPnL. No Binance key existed at the 2026-10-22 census. **Trigger:** the first active Binance key, or `test_binance_tripwire_repo_reads_the_spot_wallet_only` going red. **Closed when:** the futures wallet is read and the skip set and the derive wedge change together, with real-parser tests.

## Phase 167.2.1.1.1 (NAVMTM) — routed items (logged 2026-10-26)

### 167.2.1.1.1-REFUSAL-TOKEN-REDACTED — the worker's nav-mark refusal log line never shows its token (booked 2026-11-02, NAVMTM plan 14 SC-4 reading, DIAGNOSTIC)

**Reading.** `derive_broker_dailies` logs a refused mark as `nav mark refused (token=%s venue=%s api_key=%s)`. The service's own log scrubber (`scrub_freeform_string`, applied by `analytics-service/services/logging_config.py`) treats `token` as a credential key, so every such line reaches Railway as `token: [REDACTED]`. Plan 14's week reading found 29 refusal lines over 2026-10-27..11-02 (MT5 22, OKX 7) and could not read a single token, so the weekly per-token counts are UNREADABLE. `key_inputs` keeps only the latest token per key, so it cannot replace the log. Plan 14 Task 1's "refusals by token: none found" was this same defect: the first night did have refusals.

**Owner / Trigger:** founder routing (founder 2026-11-02, "Correct the record, book the fix (Recommended)"), the next phase that touches the derive's mark writer or the log scrubber. Trigger: any reading that needs refusal counts by token. Closed when the refusal line names its token under a key the scrubber leaves alone (for example `refusal=`), with a test that runs the line through the scrubber and asserts the token survives.

### 167.2.1.1.1-COMPOSITE-NOT-REDERIVED-ON-MARKS — no composite has been re-derived since marks started, so the composite marks path is unexercised on PROD (booked 2026-11-02, NAVMTM plan 14 SC-4 reading, DATA INTEGRITY)

**Reading.** On 2026-11-02 both PROD composites had every member key marked 7 of 7 days, but neither had a compute job since 2026-10-27 (last computed 2026-10-20 and 2026-10-21), so neither publishes `marks_since`. Plan 09's composite application of marks has not run on PROD.

**Owner / Trigger:** founder routing (founder 2026-11-02, "Book a re-derive check (Recommended)"). Trigger: now. First find out why no composite job was enqueued after marks started (which path is meant to re-stitch a composite when its members' series change), then confirm a composite re-derive reads its members' marks and publishes `marks_since`. Closed when a PROD composite carries `marks_since` from a re-derive, or the missing enqueue path is fixed with a test.

## Phase 167.2.1.1.2 (ACCTREBUILD) — routed items (logged 2026-10-22)

### 167.2.1.1.2-WEALTH-RETURNS-CAPLOG-FLAKE — a wealth-returns test counts every WARNING on its worker, so a stray urllib3 retry reds the python job (booked 2026-10-23, CI)

**Reading.** `test_malformed_records_are_skipped_with_one_warning_naming_the_series` in `analytics-service/tests/test_wealth_returns.py` asserts exactly one WARNING record from `caplog`, without filtering by logger. On PR #1119 (2026-10-23) a `urllib3.connectionpool` "Retrying" WARNING from another test's background connection on the same xdist worker landed inside its capture: `assert 2 == 1`. The re-run was green. The PR changed no Python.

**Owner / Trigger:** unowned; the next phase that touches `services/wealth_returns.py` or its tests, or a second occurrence. Minimal fix: count only records from the logger the code under test uses.

## Phase 167.2.1.1.2.1 (TRADEPAGES) — routed items (logged 2026-10-23)

### 167.2.1.1.2.1-STRATEGY-BYBIT-7DAY — the strategy trade sync sends a Bybit start and no end, so an old start may read only its first 7 days (booked 2026-10-23, 167.2.1.1.2.1 RESEARCH, DATA INTEGRITY, candidate, not measured)

**Reading.** `_fetch_raw_trades_bybit` in `analytics-service/services/exchange.py` sends `startTime` on the first page and never `endTime`. Bybit documents a start-only execution-list request as answering the start through the start plus 7 days (RESEARCH Q8, assumption A7), so a strategy backfill whose start is more than 7 days old may read only its first week. Whether the cursor continues past that week is not shown by the documentation and is unmeasured. The daily sync, whose start is recent, is not affected. Phase 167.2.1.1.2.1 fixed the allocator rebuild's own Bybit read with 7-day windows and an explicit end; CONTEXT deferred this loop, and that fix does not touch it.

**Owner / Trigger:** unowned. Trigger: a read-only, counts-only probe of one strategy Bybit key with an old start, or a strategy whose stored trades stop 7 days after a gap. Closed when it is measured and either fixed with 7-day windows and an explicit end, with a test, or disproved.

## Phase 167.2.1.1.1.1 (MARKSOURCE) — routed items (logged 2026-10-27)

### 167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW — OKX open profit stays counted twice in the stored rows no product path can rewrite (booked 2026-10-27, Phase 167.2.1.1.1.1 MARKSOURCE D-05, DATA INTEGRITY, user-facing)

**Still open (narrowed 2026-11-02 by Phase 176).** Before the Phase 167.2.1.1.1.1 poll fix, the holdings poll stored an OKX-holding allocator's USDT row from OKX's `eq`, which already contains open profit, while the refresh added that profit again. Two stores keep the double count because no product path rewrites them: every `allocator_holdings` history row of an OKX-holding allocator (point-in-time venue reads that the Exposure-over-time charts show), and the append-only scenario-commit audit sizes. The `allocator_equity_snapshots` store went with its table. `docs/runbooks/marksource-okx-history-correction.md` names both under "What this cannot reach". **Trigger:** a founder request to correct them, or a reader that starts presenting past `allocator_holdings` levels as measured. **Closed when:** those rows age out of every reader, or the founder rules them corrected by another path.

### 167.2.1.1.1.1-OKX-OPTION-READ-429-MASKED — a 429 on the OKX option-positions read is masked as `option_value_unreadable` with no cooldown stamp (booked 2026-10-28, Phase 167.2.1.1.1.1 MARKSOURCE final review round, OBSERVABILITY)

**Reading.** MARKSOURCE re-raises `ccxt.RateLimitExceeded` on the other NAV-mark reads (Binance positions, Bybit balance and account info, Binance options) so a 429 reaches `_stamp_429` in `job_worker._read_marked_equity_once_per_day`. The OKX option-positions read was outside that fix: the broad `except Exception` in `equity_reconstruction.read_okx_option_exposure` and the matching one in `job_worker._read_okx_option_refusal_once_per_day` turn a 429 into the refusal `option_value_unreadable`, logged by exception class only, and no per-exchange cooldown is recorded. The mark refuses either way, so no stored figure is wrong; the cost is a misnamed refusal and sibling jobs not parked behind the circuit breaker. Minimal fix: an `except ccxt.RateLimitExceeded: raise` arm ahead of the broad arm in `read_okx_option_exposure`, and an `except ccxt.RateLimitExceeded` arm in `_read_okx_option_refusal_once_per_day` that calls `_stamp_429` and returns `option_value_unreadable`, mirroring the 429 arm in `_read_marked_equity_once_per_day`.

**Owner / Trigger:** no phase (orchestrator decision 2026-10-28: the mark refuses either way). Trigger: the first `option_value_unreadable` on an OKX key that coincides with a 429. Closed when both arms exist with a test that a 429 on the OKX option read stamps the cooldown.

## Phase 180 (BYBITFUNDING) — routed items (logged 2026-10-29)

### 180-BYBIT-LIVE-FLOW-KINDS — the live NAV / composite derive and broker-dailies Bybit readers keep their on-chain deposit and withdrawal kinds (booked 2026-10-29, Phase 180 D-02, DATA INTEGRITY)

**Still open (re-measured 2026-11-14).** `run_derive_broker_dailies_job` now reads Bybit capital flows through `fetch_bybit_unified_flows` (Phase 186), but `run_stitch_composite_job` still reads only the on-chain deposit and withdrawal pair through `fetch_ccxt_transfers`, so a Bybit account funded off-chain (sub-account / universal transfers, as account a6 is) is read from different flows on the composite path. **Closed when:** the composite path reads the same kinds, with its own measurement, or the founder rules otherwise.

## Phase 176 (LEGACYRETIRE) — routed items (logged 2026-10-31)

### 176-INERT-LEFTOVERS — the managerSide* plumbing and the equityCurveSource "legacy" value are inert after Phase 176 (booked 2026-10-31, Phase 176 plans 03 and 05, CLEANUP)

**Reading.** Since D-01 (Phase 176 plan 03) `allocatorEligibleApiKeyIds` equals `eligibleKeyIds` in `getMyAllocationDashboard`, so `managerSideKeyIds` (`src/app/(dashboard)/allocations/lib/live-holdings-summary.ts`) is always empty and `excludedManagerSide` is always zero. The composer's partial-book note still reads both. `equityCurveSource` keeps its two-value type because `equityChartWidgetDataSchema`'s enum pins it; since Phase 176 its `"legacy"` value means "no trustworthy derived curve", and no legacy source is read. Nothing is wrong on screen, and no number depends on either.

**Owner / Trigger:** unowned. Trigger: the next change to the composer's partial-book note or to EquityChart's freshness stamp. Closed when `managerSideKeyIds`, `excludedManagerSide` and the `"legacy"` value are deleted together with their tests.

### 176-PR1-REVIEW-RESIDUALS — four below-the-bar residues of the PR 1 review rounds, none user-facing at the time of writing (logged 2026-10-31, Phase 176 PR 1, DATA INTEGRITY and TEST)

**Reading.** Counts-only, four items, all in migration `20261102120000` and its gate `test_bridge_outcome_deltas_derived.sql`: (a) `compute_bridge_outcome_deltas` `failed_count` counts immature and refill rows, which is noise, and nothing reads or alerts on it; the batch raises no `RAISE WARNING` for it (silent-failure review round 2, MEDIUM-3, booked as non-user-facing). (b) The gate pins the stored-wins order only for +30d: mutants that flip the +90d or +180d stored-wins order, or the +30d `needs_recompute` branch, stay green (code review round 3, note 1). (c) A digit-shaped impossible date such as 9999-99-99 still extends the coverage test, and the migration header claims otherwise; the compose cannot write such a date (round 3, note 2). (d) An outcome upsert sets `needs_recompute`, so a note-only edit re-measures a stored outcome after a curve restatement; this matches D-05 (round 3, note 3).

**Owner / Trigger:** Phase 176. Trigger: PR 2 of the phase, or any change to the holding branch of `compute_bridge_outcome_deltas`. Closed when (a) has a reader or a warning, (b) has +90d, +180d and +30d `needs_recompute` arms that bite, and (c) the header claim or the date check is corrected; (d) is recorded behaviour and closes by decision only.

### 176-RECONSTRUCT-CAP-MARKER-INERT — the history reconstruct's cap and marker machinery and what the crawl's deletion orphaned are inert; their removal is booked (booked 2026-10-31, Phase 176 plan 11, D-04)

**Reading.** Phase 176 plan 11 deleted the legacy equity writers (`persist_equity_snapshots`, `_purge_allocator_equity_snapshots`, `_allocator_has_equity_snapshots`, `replace_equity_snapshots`, `replace_equity_snapshots_window`), both job bodies (`run_reconstruct_allocator_history_job`, `run_refresh_allocator_equity_daily_job`) and the bootstrap gate's Python twin (`_owed_reconstructs_for_zero_snapshot_book`) from `analytics-service/services/equity_reconstruction.py`. The founder chose `go` on 2026-11-01, so the history crawl only those bodies used went with them: 114 symbols in all (5,892 lines of definitions, 6,104 with the comment blocks above them), and the module fell from 8,122 lines to its survivors. The scripts `allocator_history_probe.py` and `e2_allocator_ground_truth.py` were deleted with it. The founder's decision is recorded as D-08 in `176-CONTEXT.md`.

Per D-04, what stays inert on purpose, byte-identical and pinned by `test_the_d04_inert_helpers_stay` in `analytics-service/tests/test_legacy_allocator_jobs_retired.py`: the ten cap and marker helpers in `services/equity_reconstruction.py` (`_reconstruct_outcome_completes_the_key`, `_mark_api_key_history_reconstructed`, `_account_marker_key_ids`, `_ACCOUNT_ZERO_CONTRIBUTION_VENUES`, `_key_venue`, `_api_key_already_reconstructed`, `_RECONSTRUCT_IN_FLIGHT_STATUSES`, `HISTORY_RECONSTRUCT_ATTEMPT_CAP`, `_NON_RETRYABLE_SYNC_STATUSES`, `_fanout_would_still_retry`); the dispatch cap hook `_capture_history_reconstruct_capped`; `report_orphaned_capped_reconstructs` and its watchdog call; `TIMEOUT_PER_KIND`'s two entries for the retired kinds and the `main_worker` watchdog override; the `api_keys.history_reconstructed_at` and `history_reconstruct_attempts` columns with their CHECK and grants; `backfill_api_keys_history_reconstructed_at`; and on the TS side `reconstructCappedKeyIds`, `historyReconstructFailed`, and `RECONSTRUCT_JOB_KIND` (the `HistoryReconstructFailedNote` component and its render arm in `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` were removed in PR 2 review fix round 1, MD-01, because the note was false once the job retired), with the Python and TS cap and note twin tests.

**Completed-phase tooling this removed or orphaned.** Removed with the crawl (`go`): ACCTREBUILD 167.2.1.1.2 (the forced whole-account rebuild `_crawl_whole_account`, `_forced_refusal_result`, `_job_requests_force_rebuild`, the `force_rebuild` metadata contract and the refusal vocabulary `FORCED_REBUILD_ANCHOR_REASONS` and `FORCED_REBUILD_ACCOUNT_REASONS`); TRADEPAGES 167.2.1.1.2.1 (the paged and two-year Bybit trade reads `_read_bybit_window`, `_read_bybit_trades_resumable`, `_fetch_trades_with_pagination`, `_fetch_okx_inst_type_trades`); READCEILING 171 (`TruncatedTradeRead`, `TRUNCATED_READ_SITES`, `_validated_claim_budget`); OKXANCHOR 172 (`_okx_forced_opening_check`); OKXREWRITE 178 (`_select_account_crawl_keys`); the MT5 backfill arm (164.5.4) and MT5OFFSET 175 (`_mt5_fetch_window`). Removed with the scripts: the REBUILDGATES 173 and BYBITFUNDING 180 gate readings in `allocator_history_probe.py`, and the Phase 115 E2 harness. Orphaned, kept: `services/trade_read_store.py` and its tables (only `main_worker`'s `trade_read_store.purge_expired` still calls it; its `begin_claim`, `claim_deadline`, `current_trade_read_scope`, `deadline_passed`, `job_too_old`, `load_window`, `purge_keys`, `record_progress` and `save_window` have no production caller left); `services/okx_opening_balance.py` and `services/okx_bills_chain.py` (OKXBILLSCHAIN 179; only `scripts/okx_chain_record.py` and each other import them; `read_okx_opening` and `opening_agrees` have no production caller); `fetch_bybit_unified_flows` in `services/bybit_unified_flows.py` (no production caller; the module stays because `job_worker` imports its `BybitUnifiedFlowReadError`, and it was kept on purpose, ready for the Bybit Unified-transfer gap the founder's pre-delete check found in the new path, which a separate fix phase handles); and these helpers with no production caller left: `perp_quote` (`services/closed_sets.py`), `sort_events_stable` (`services/dateday.py`), `is_price_gap_holding` (`services/holding_equity.py`), `close_on_or_before` and `gap_holds_the_day` (`services/price_rule.py`). Not orphaned: `services/okx_archive_job.py` (`job_worker` dispatches it). No services module lost its last importer. Update 2026-11-03 (Phase 186 plan 10, D-02): `fetch_bybit_unified_flows` has a live caller since Phase 186: the per-key Bybit derive in `job_worker` reads it for the account's capital flows (it is no longer in this list of orphans).

**Compute job kinds.** `reconstruct_allocator_history` and `refresh_allocator_equity_daily` have never had a Python enqueue site; the Python literal sites left are `job_worker` (dispatch, cap hook) and `main_worker` (watchdog). Their SQL enqueuers (`enqueue_refresh_allocator_equity_for_all`, newest definer `20261021120000_refresh_fanout_owed_key_reconstruct.sql`) stay for the later migration plans of Phase 176 to retire; both `compute_job_kinds` rows stay while a queued row can still exist.

**Owner / Trigger:** unowned. Trigger: the next phase that touches `api_keys` or the job registry. Closed when every item listed above is removed or given a live caller.

## Phase 184 (WALLETOFFSET) — routed items (logged 2026-11-01)

### [184-BINANCE-SFOX-OFFSET-WAIT] — Binance and sFOX keep the wallet base until a key is marked and its first-mark offset is measured (booked 2026-11-01, Phase 184 D-02, DATA INTEGRITY)

**Reading.** The Phase 184 re-run (184-07, 2026-11-01) found no Binance key and no sFOX key (`binance_state` and `sfox_state` both `no_keys`), so neither venue's first-mark offset was measured. The founder's Q4 answer was "Wait for their own measurement (Recommended)". Asked how the wait should be tracked, the founder answered (2026-11-01, AskUserQuestion "How should the wait be tracked?"): "TODOS entry with a trigger (Recommended)": "A TODOS item: when a Binance or sFOX key first gets a mark, measure its offset with the existing probe. It doesn't hold the milestone open." Both venues keep the wallet base until then. Nothing is built, and no published number changed.

**Owner / Trigger:** unowned. Trigger: a Binance or sFOX key gets its first stored mark (marked `key_inputs`). Action: re-run the read-only walletoffset probe (`analytics-service/scripts/walletoffset_probe.py`) for that venue, then bring the per-key ratios to the founder under the Phase 184 D-02 rules (decide on the P&L part, 0.1% of NAV, a venue moves if any key is material). For sFOX, define the offset first: its chain links the venue's own daily NAV and books no realized P&L, so the probe prints `reader_not_built` for a marked sFOX key (184-RESEARCH A7), and the founder decides the definition before a reading. Closed when each venue has a measured reading and a founder decision recorded, or the founder rules otherwise.

### [186-COMPOSITE-MEMBER-READ-GAPS] — the composite member derive does not get Phase 186's read refusal or Bybit Unified flow source (booked 2026-11-03, Phase 186 plan 04 gate, DATA INTEGRITY)

**Reading.** Phase 186 makes the per-key derive refuse a truncated or failed realized or funding read by name and count Bybit Unified-edge transfers as flows. The composite strategy's member read is a separate path. The 186-01 PROD count found 0 composite strategies with a ccxt (OKX, Bybit or Binance) member (`composite_strategies_with_ccxt_member` 0, `composite_strategies_with_bybit_member` 0), so the gate booked it (`q-composite: book (no PROD exposure)`) instead of asking.

**Owner / Trigger:** unowned. Trigger: a composite strategy gains an OKX, Bybit or Binance member on PROD. Action: give the composite member read the same refusal and, for Bybit members, the same flow source, or ask the founder. Closed when the member path carries both, or the founder rules otherwise.

### [186-SHARED-ACCOUNT-NO-WORKING-KEY] — a shared exchange account whose keys all fail still follows the D-18 (2026-09-27) path, not the "a dead key affects only itself" rule (booked 2026-11-03, Phase 186 plan 04 gate, USER-VISIBLE)

**Reading.** The 2026-10-28 founder rule "a dead key affects only itself" is newer than D-18 of 2026-09-27. Phase 186 applies it to failing keys in the compose. A shared account with no working key keeps the older path. The 186-01 PROD count found 0 stored curves carrying `shared_account_no_working_key`, so the gate booked it (`q-shared: book (no PROD exposure)`) instead of asking.

**Owner / Trigger:** unowned. Trigger: a stored `equity_curve` row carries `shared_account_no_working_key` on PROD. Action: bring the case to the founder with the count (include it under the 2026-10-28 rule, which needs a plan). Closed when decided and built, or the founder rules otherwise.

### [186-REALIZED-MALFORMED-COUNT] — count the production keys whose realized trade history carries a malformed row, before refusing on one is reconsidered (booked 2026-11-04, Phase 186 fix round 2, founder D-12, DATA INTEGRITY)

**Reading.** Review R2-04 found that refusing a key on one unparseable realized row would keep the key out of the book on every daily derive for as long as the row stays in the walk (OKX reads back to the account's start), and that no one had counted how many production keys carry such a row. Founder 2026-11-04, AskUserQuestion, D-12: "Flag it, don't refuse (Recommended)": "The key keeps publishing, as it does today. The dropped row is recorded as a data-quality flag rather than only a log line, and a TODO books a production count. Refusing can be switched on later once the count shows it is safe." So a malformed realized row is stamped `daily_pnl_malformed_<venue>` in the realized read's data-quality buffer (and logged at WARNING), and the derive no longer refuses on it. Fix round 3 (review R3-03) persists the flag: the derive drains the buffer and writes it where a SELECT can count it. Strategy mode: `strategy_analytics.data_quality_flags->>'daily_pnl_malformed_<venue>'` (a bool, present only while the latest read dropped a row; a clean re-read clears it; never a guard key, so it does not promote `complete_with_warnings`). Key mode: `allocator_equity_derived.payload->'daily_pnl_malformed'` on the key's `key_inputs:<api_key_id>` row (a list of the `daily_pnl_malformed_<venue>` names; owner-only, rewritten whole on every derive). The production count is therefore a read-only SELECT over those two places, and needs no new realized read.

**Owner / Trigger:** unowned. Trigger: the next read-only probe run of the realized read (`analytics-service/scripts/derivegaps_probe.py`), or the next phase that touches `daily_pnl_read_verdict`. Action: count, per key, the `daily_pnl_malformed_<venue>` flag in the two places above once the fix has run through a daily derive (read-only; no probe run is needed), bring the per-key counts to the founder, and only then decide whether a refusal (or an uncomputable day, SC-6) is safe. Closed when the count is recorded and the founder has ruled, or the founder rules otherwise.

### [186-OTHER-FUNDING-CALLERS-DROP] — three funding callers keep dropping a malformed funding row with a warning (booked 2026-11-04, Phase 186 fix round 1 review, DATA INTEGRITY)

**Reading.** Phase 186 asks the per-key derive's funding read for `on_malformed="raise"` and refuses the key by name when a funding row is dropped (`funding_rows_malformed`). Three other callers of the same fetchers keep the default `on_malformed="drop"`: `run_sync_funding_job`, the composite member read path, and `okx_archive_job`. A malformed funding row there is dropped with a WARNING and the series is stored as complete. Round 1 left them unfixed because each is a separate job with its own retry and recovery behaviour. The composite member path is the same gap as `[186-COMPOSITE-MEMBER-READ-GAPS]` for funding.

**Owner / Trigger:** unowned. Trigger: a funding row is reported dropped by `fetch_funding_okx`, `fetch_funding_bybit` or `fetch_funding_binance` in the worker log of one of those three callers, or the next phase that edits `services/funding_fetch.py`. Action: decide per caller whether it refuses by name (as the derive does) or keeps dropping, with the founder where a published number changes. Closed when each of the three has a recorded decision, or the founder rules otherwise.

### [186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED] — Bybit on-chain deposits that do not appear as Unified TRANSFER rows are unverified, so replace versus union was not decided on evidence (booked 2026-11-04, Phase 186 fix round 1 review, DATA INTEGRITY)

**Reading.** Phase 186 reads Bybit Unified-edge transfers as flows (D-02) and the 186-04 gate set the flow source to `replace` (the Unified rows stand in for the on-chain reader). That verdict rested on the one measured Bybit key having no on-chain rows (`g2-flow-verdict: replace (no on-chain rows on PROD)`). With zero on-chain rows, replace and union give the same flows today, so the probe could not tell them apart. Whether a Bybit on-chain deposit also appears as a Unified TRANSFER row is therefore unverified: if it does not, `replace` would drop it from the flows and book the deposit as P&L.

**Owner / Trigger:** unowned. Trigger: a Bybit key on PROD shows an on-chain deposit or withdrawal (the probe's `bybit_onchain_rows` above 0). Action: re-run the read-only probe (`analytics-service/scripts/derivegaps_probe.py`), read `bybit_paired_rows`, `bybit_unpaired_onchain_rows` and `bybit_near_miss_rows`, and bring the replace-versus-union question to the founder with those counts. Closed when the pairing is measured and the flow source is decided, or the founder rules otherwise.

## Phase 190 (FACTSHEETQUEUED) — routed items (logged 2026-11-03)

### [190-RERUN-SURFACES-NOT-HOLDING] — surfaces outside D-05's reach still withhold a strategy's figures during a re-run (booked 2026-11-03, Phase 190 D-05, USER-FACING)

**Reading.** Phase 190 holds a strategy's last computed figures during a pending or computing re-run (D-02) on the factsheet, on every lane through the resolve stage, on the approval gate, on the discovery and owner lists and on /compare. The founder kept the reach there (D-05, 2026-11-03). Every other surface keeps its own terminal-success gate and so still withholds or blanks a re-running strategy: the share card image (`/api/og/factsheet/[id]`), the tear sheet and the two PDF routes (`/api/factsheet/[id]/pdf`, `/api/factsheet/[id]/tearsheet.pdf`), the returns API (`/api/strategies/[id]/returns`), recommendations, portfolios (`StrategyBreakdownTable` and the portfolio PDF) and the scenario composer. Three more items do not hold either. The strategy page's own panels (`getStrategyDetailV2`) keep a terminal-status gate and live data-quality chips. Three detail reads that share `PUBLIC_ANALYTICS_COLUMNS` carry no series and no marker alias, so they withhold during a re-run by design: `getPublicStrategyDetail`, `getFactsheetDetail` (the tear sheet read) and `getStrategyDetail` (the discovery page's own read; its factsheet does admit through the resolve stage). Composite approval during a re-stitch still answers 409 (PUB-01, plan 06 left it unchanged). In the derive-to-success window these surfaces show what they showed before the phase: the withheld or not-computed state while the row reads pending or computing, and the stored panels of a terminal-held row beside live data-quality chips. The ship PR for this phase merged before this entry was written, so the entry rides the records PR; the release notes name the same surfaces as known limits.

**Owner / Trigger:** unowned. Trigger: the next phase that changes any listed surface's analytics gate, or a report of one of them going blank or mixing generations during a re-run. Closed when each listed surface follows plan 03's rule (`hasStoredAnalyticsResult` with `isRecomputeOverStoredResult`, plus `hasUnboundDerivePrestamp` where it reads the flags blob), or the founder rules it out.

### [190-SC5-POSTDEPLOY-REREAD] — the Phase 190 post-deploy finalize reading, the no-analytics check and the 390 px check are still unmeasured on PROD (booked 2026-11-03, Phase 190 SC-5, USER-FACING)

**Reading.** Phase 190 closed with three SC-5 items unmeasured. No wizard contribution finalized after the deploy, and the controlled run needs a pasted key and secret that the session may not type. The founder decided on 2026-11-03 (AskUserQuestion, answer "Read it from real use later (Recommended)"): "Close 190 with the finalize check recorded as VOID. The post-deploy query is already saved, so it gets re-run after the next real contribution and the result added. The TODO already tracks it." No entry tracked it at that time, so this one does. The code and tests for all three are in place; the missing piece is a reading on PROD. SC-3 (a re-compute never hides computed figures) has a valid PROD reading and is not listed here.
- **SC-2 PROD re-read.** After the next real wizard finalize, re-run `190-MEASUREMENT-postdeploy.sql` (read-only; run the marker query first, as always) and add the result to the phase's SUMMARY. It counts only if `wizard_contributions_finalized_after_deploy` is at least 1; a window with no finalize stays VOID. Expected: `finalize_jobs_after_deploy_after_first_compute_done` is 0.
- **SC-4 on PROD.** Open a new draft strategy before its first computation completes. Expected: the existing queued or computing line shows and the `factsheet-analytics-updating` line does not.
- **The updating line at 390 px.** View a re-running factsheet at 390 px. Expected: the line wraps inside the header with no sideways scroll (the UI-SPEC overflow row). Today only a component test covers it.

**Owner / Trigger:** unowned. Trigger: the next wizard contribution finalized on PROD. Closed when the SC-2 reading is recorded with `wizard_contributions_finalized_after_deploy` at least 1, SC-4 is observed on PROD, and the 390 px rendering is observed, or the founder rules otherwise.
## Phase 194 (FIGURETRUTH) — routed items (logged 2026-11-07)

### [194-ENGINE-CONSTANTS] — the stored, factsheet and Scenario engines still annualise with different year lengths and standard-deviation conventions (booked 2026-11-07, Phase 194 RESEARCH Open Question 2, DATA INTEGRITY)

**Reading.** The stored engine (`analytics-service/services/metrics.py`) annualises CAGR on 365 days and Sharpe with ddof 1. The factsheet's narrowed-range engine (`compute.ts`) uses 365.25 and ddof 0, and Scenario (`scenario.ts`) uses 365.25 and ddof 1. At full history the stored overlay makes the factsheet's seven headline scalars agree with the stored values (D-01); a narrowed range and a blend are computed by their own engine and are labelled as different engines, not reconciled. The D-14 residual (A-194-D14-02) is the same family: the factsheet's 126- and 30-row rolling windows use the population standard deviation (ddof 0) while the 365-day window uses the producer's sample standard deviation (ddof 1). Aligning the constants is not decided by any D-0x.

**Owner / Trigger:** unowned. Trigger: a reading that shows a narrowed-range or blend figure beside a stored figure for the same period and the gap is traced to the year length or ddof, or the next phase that edits `compute.ts` `years`, `sharpeRatio` or `scenario.ts` `calendarYears`. Closed when one year length and one ddof are chosen for every engine and a parity test pins them, or the founder rules the difference intended.

### [194.1-CENSUS-HOLDINGDETAIL-REASON] — the figure-gate census excludes `HoldingDetail.tsx` as "dead: no importer", which is false, and its detector is import-only (booked 2026-11-08, Phase 194.1 VERIFICATION advisory)

**Reading.** `HoldingsTable.tsx` imports `HoldingDetail.tsx` inside `DesignHoldingsTable`, and `HoldingDetail.tsx` prints `formatNumber(row.sharpe)` raw. It is dead only transitively: `DesignHoldingsTable` mounts when a `rows` prop is passed, and no non-test caller passes one. The census also counts `HoldingsTable.tsx` as gated because `StrategyRowsTable` in the same file imports the gate, while `DesignHoldingsTable` there prints a raw Sharpe. Nothing reaches a user today.

**Owner / Trigger:** Phase 194.2 (FIGURERESIDUALS), which touches Holdings. Closed when the dead `DesignHoldingsTable` / `HoldingDetail` path is deleted or gated and the exclusion reason is true.

### [194.1-CENSUS-NO-FORWARD-CHECK] — nothing stops a later edit moving a live 194.1 site into the census exclusions (booked 2026-11-08, Phase 194.1 security audit advisory on T-194.1-28)

**Reading.** Plan 13 deleted the pending map, and the assertion that no live 194.1 site sits in `EXCLUDED` went with it. Today every live site imports a gate and none is excluded, and the census header forbids it, but a later edit could add a live site to `EXCLUDED` as "no render" and the census would stay green.

**Owner / Trigger:** unowned. Trigger: the next phase that edits the census's `EXCLUDED` map. Closed when the census pins the live 194.1 site files as never excluded.
## Phase 197 (SCREEN) — routed items (logged 2026-11-08)

### [197-SYNCBADGE-SERIES-LADDER] — `SyncBadge` judges the series on one 3/7-day ladder for every asset class, so it can disagree with the discovery stale chip (booked 2026-11-08, Phase 197 plan 06, UI-SPEC A-4, RESEARCH Pitfall 10)

**Reading.** `SyncBadge` judges the track record's last date on one 3/7-day ladder for every asset class. A stale crypto row can therefore show its red series dot beside the amber stale chip, and a traditional row 8 to 10 days old shows the red dot while it still ranks as current under D-03's 10 days. `SyncBadge` is shared with the portfolio tables, so Phase 197 left it unchanged.

**Owner / Trigger:** unrouted, needs a phase (SyncBadge is shared with the portfolio tables). Closed when the badge and the discovery verdict agree per asset class, or the founder records the difference as intended.

### [197-PERCENTILE-COHORT-STALE] — percentile cohorts still include stale peers (booked 2026-11-08, Phase 197 plan 06, RESEARCH Pitfall 9)

**Reading.** `getPercentiles` still ranks current rows against cohorts that include stale peers, so a current row's percentile is partly relative to dormant records. Phase 197 left the cohort unchanged on purpose (orchestrator resolution 3).

**Owner / Trigger:** unrouted. Closed when the cohort excludes stale rows or the founder records the cohort rule.

## Phase 199 (MANAGERHOME) — routed items (logged 2026-11-10)

### [199-DEPARTED-HISTORY-NAME-THE-KEY] — the "this curve leaves out a disconnected account's history" note cannot say which key (booked 2026-11-10, Phase 199 plan 18, CD-09, D-05; user-facing)

**Reading.** When an allocator disconnects an exchange key, the My allocation equity curve can leave that key's history out, and a note says so. The note (`DepartedHistoryNote` in `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`, registry entry `allocation.departed-history`) can only say "at least one disconnected account", with no key and no day, because the stored derive result carries a count of departed keys with no usable history (`departed_history_unavailable_keys`, written by the allocator-equity derive in `analytics-service/services/job_worker.py`) and not their ids. Phase 199 accepted that (CD-09, D-05, founder 2026-11-09): the note is a count-pinned `whole_history` line with the contact-form action, so it is honest but vague. Every other degrade warning now names its key or day.

**What closes it.** The analytics-service derive emits the departed key ids (not only their count) into the derive result; the My allocation read carries them to the note; the note then reads `{key label}: this curve leaves out its history, because the balance that history is measured from is no longer available. Use the contact form to have it checked.` with one line per key, sorted by label, and its registry entry moves from `whole_history` scope to key scope (the `WHOLE_HISTORY_IDS` pin in `src/lib/degrade-warnings.test.tsx` drops from 10 to 9). The Python change is an analytics-service change: mypy strict and pytest from `analytics-service/` belong in its brief.

**Owner / Trigger:** unrouted, needs a phase (it touches the analytics-service derive and the My allocation read). Trigger: the next phase that edits the allocator-equity derive or `DepartedHistoryNote`. Closed when the note names each departed key by its key label.
