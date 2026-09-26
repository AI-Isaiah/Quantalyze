# Roadmap: Quantalyze

## Shipped Milestone: v1.17 MT5 — ingested, wizardable, surfaced (Phases 147–154, 156) ✅ CLOSED 2026-08-14

⚠️ **SCOPE AMENDED 2026-08-14, and the amendment is the point.** This milestone originally ran
147–155 and its title claimed *"usable end-to-end, not merely ingested"*. Phase 155 (MT5-VERIFY —
the live trading-day parity run against the terminal's own figures) was **REMOVED from scope and
carried to v1.18**. It was neither silently dropped nor ticked unmet. With it went MT5-06, MT5-07,
MT5-08, MT5-09, MT5-10, MT5-15 and the umbrella acceptance MT5-GOAL-01.

**Founder decision (2026-08-14).** A bounded alternative — move 155 to TODOS.md and tick v1.17
complete — was offered and **declined**, on the grounds that it would leave every ledger reading
"MT5 usable end-to-end" while our numbers had never once been compared to the broker's.

⛔ **CLOSED but NOT ARCHIVED, and MT5 is NOT advertised.** What v1.17 actually earns: MT5
*ingests*, is *declarable in the wizard*, *projects in a scenario*, has a *viewable factsheet*,
and the wizard's write is the server's alone. What it does NOT earn: any claim that the
performance we render matches the terminal's. Nobody has compared them.

⭐ **MT5-GOAL-01 was written as a tripwire against exactly this reading** — it exists, in its own
words, "so 'MT5-05 ✅' can never again be mistaken for 'MT5 works'." Carrying it into v1.18 keeps
the tripwire armed. Discharging it by relocation would have disarmed it, which is precisely
v1.15's failure mode: shipped 6/6 green with both open items intact.

---

## Current Milestone: v1.20 Backlog Burndown (Phases 158+)

**Goal:** Close the largest relevancy-ranked, agent-deliverable slice of the verified-open
backlog — public-trust correctness, money-path honesty, founder-hit error surfaces, CI/deploy
integrity, small security hardening, and the booked dependabot campaign — and leave TODOS.md
telling the truth.

**Scope:** 50 requirements — RANK-01..09, SHARE-01..04, WIZERR-01..13, HONEST-01..06,
OPS-01..11, SEC-01..06, DEPS-01 — per `.planning/REQUIREMENTS.md`. Every one is a verified-open
TODOS.md item re-measured at HEAD `ca3f0c5c` (17-agent triage, 2026-08-20). Research: TARGETED
(`.planning/research/SUMMARY.md`) — and in three places TODOS.md's own recorded remedy is
measured WRONG (#686 "bisect", #606's booked claims, the concurrency "shrink the group"); the
phases below carry the corrections, not the bullets.

**Ordering rationale (BINDING — measured dependencies, not preferences):**

- **Phase 158 (OPS — CI/deploy integrity) FIRST.** The `shared-test-db` concurrency eviction
  makes a main-branch run conclude `cancelled` (grey — nobody triages grey) and Railway then
  silently SKIPS the analytics deploy (issue #616). Every later phase merges PRs through this
  pipeline, and the 9-PR DEPS campaign against the unfixed group *guarantees* at least one
  silently-skipped deploy. ⚠️ Research correction is binding: shrinking the group does NOT fix
  this (eviction is cross-run) — the fix is an external FIFO mutex for DB-touching jobs plus a
  `cancelled`-conclusion watcher.

- **Phase 159 (RANK) EARLY** — pure read-path, zero DDL, trivially revertible, observable on
  PROD; it must precede new publications so the percentile population delta is measured against
  a stable cohort, and it front-loads the cheapest owed census (C-M1).

- **RANK → provenance → SHARE arc:** Phase 160's write-path REVOKE needs a full
  deploy-first / revoke-second cycle with soak time, so it cannot be late; Phase 164 (SHARE) is
  the ONLY new anonymous public surface and lands alone, late, in its own PR — ⛔ never branched
  from `feat/phase-156-connect-refactor` (its Migration B is pending against `strategies`; two
  concurrent migrations on one table on an auto-apply-to-PROD path is an ordering surprise
  waiting to happen).

- **Phase 163 (hardening) before Phase 164:** SEC-03's RPC audit-coverage decision must be
  standing when SHARE mints its new mint/revoke RPCs — two REQ groups, one edit
  (`MUTATING_RPC_NAMES`).

- **Phase 165 (DEPS) LAST, strictly after OPS-01.** Dependency churn before the correctness
  work makes every red ambiguous, and #685 is 100% `analytics-service/` — exactly the PR that
  would sit undeployed behind a grey main.

- **Owed measurements and decisions are EARLY TASKS inside their phases, never separate
  phases:** C-M1 + the percentile before/after snapshot in 159; B-M1 + B-D1/B-D2 in 160; A-D1
  (URL shape), A-D2 (private-status revoke home), A-D3 (tearsheet/PDF scope) + the token model
  in 164.

### Phases (v1.20)

- [x] **Phase 158: OPS-CI — A merge means a deploy** - External FIFO mutex + `cancelled`-conclusion watcher close the shared-test-db eviction (#616); `sql-tests` gated by an aggregator; orphaned e2e specs run; TEST stale-`pending` drained; MultiKeyConnectStep flake root-caused (completed 2026-08-21)
- [ ] **Phase 159: RANK — Public-ranking integrity** - Failed/stale-computation KPIs out of published percentiles on BOTH engines; anon `(*)` splats become explicit projections; quantstats sign-flip + blend-annualization default closed; FILL-arm CAS; uid shape validated
- [ ] **Phase 160: PROVENANCE — The server's venue is the venue that annualizes** - `api_keys.exchange` server-authoritative at every INSERT; the `asset_class` √365/√252 stamp derives from the attested venue WITH the null-attestation guard; B-M1 PROD census first
- [ ] **Phase 161: WIZERR — Honest error surfaces** - The recorded WIZFORM-02 class residue: thirteen surfaces stop rendering `UNKNOWN`, false sentences, or unwinnable "try again"
- [ ] **Phase 162: HONEST — What the user sees is true** - No raw Python exceptions as copy, no FRESH badge on a dead series, real equity curves, metrics on drawer rows, the clicked key preselected
- [x] **Phase 163: HARDEN — Fail safe, closed, and loud** - structlog redaction closed at BOTH failure modes, post-commit `createAdminClient` 500 class, flag-monitor honesty, deterministic worker plumbing, password policy, `.planning` username scrub, RPC audit gate, `bridgeComputeLimiter`
- [ ] **Phase 164: SHARE — Copy Link always works, and never discloses** - Revocable share-token lane on the factsheet; the id-keyed public cache is NEVER poisoned (ordered adversarial acceptance); revoke; the affordance class honest at all three sites
- [ ] **Phase 165: DEPS — The 9-PR dependabot campaign** - pandas `requirements.in` prerequisite commit FIRST, then one PR at a time in the research-verified order, full suite between each; #614 and #606 CLOSED with reasons

### Phase 158: OPS-CI — A merge means a deploy

**Goal**: A merged PR always produces an honestly-reported CI verdict and a deployed analytics service — main CI can no longer conclude `cancelled` and silently skip the Railway deploy, no gate is present-but-ungating, and the two known deterministic false-reds are gone
**Depends on**: Nothing (first phase of v1.20; hard prerequisite of Phase 165)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-11
**Success Criteria** (what must be TRUE):

  1. A PR opened mid-run can no longer evict a queued main-branch run: three SIMULTANEOUS DB-touching runs serialize through an external FIFO mutex (with a TTL/steal path and a documented manual-unlock runbook — a requirement of adoption, not a follow-up), and a forced `cancelled` main-run conclusion raises a loud signal (issue or rerun) instead of a silently-skipped Railway deploy — GitHub issue #616 closed on the MECHANISM, not on symptom convergence. ⚠️ Shrinking the concurrency group is NOT an acceptable fix (eviction is cross-run); ⚠️ do NOT "finish the chain" with more `needs:` edges (the `if:` conditions diverge on `workflow_dispatch` and it would disable `e2e-seeded` on every manual run).
  2. A failing `sql-tests` job blocks an aggregator via `needs:` — the only gate that executes the deployed cron bodies can no longer be present-and-failing with nothing gating on it.
  3. The orphaned e2e specs (incl. the NAV-01 surface) execute in a CI batch, and DB-types drift has a regeneration gate OR an explicitly recorded decision not to.
  4. The TEST stale-`pending` `compute_jobs` backlog is drained TEST-only (⛔ never a migration, never `cron.unschedule(9)`) so the deterministic exactly-10 claim-path red is gone, and `test_compute_jobs_fencing.py` stamps `claimed_at` in its two direct UPDATEs.
  5. `MultiKeyConnectStep` passes under any test ordering — the unrestored `vi.stubGlobal`/`vi.mock` root cause is fixed, not retried away.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 158-01-PLAN.md — Tracer mutex probe (session-mode go/no-go, 3-contender RED→GREEN) + ci.yml advisory-lock adoption + `sql-tests` aggregator gating (OPS-01, OPS-02) [Wave 1]
- [x] 158-02-PLAN.md — `cancelled`-conclusion watcher (issue-only, exit-0 doctrine) + shared-test-db mutex runbook (OPS-01) [Wave 1]
- [x] 158-03-PLAN.md — `claimed_at` stamps in the two fencing UPDATEs + guarded TEST-only backlog drain closed on measured row counts (OPS-04) [Wave 1]
- [x] 158-04-PLAN.md — MultiKeyConnectStep flake: reproduce-first sweep, then leak-source fix or mechanism closure with evidence (OPS-11) [Wave 1]
- [x] 158-05-PLAN.md — Repair the 4 named orphan specs + author e2e/my-strategies.spec.ts (NAV-01 surface) (OPS-03) [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 158-06-PLAN.md — Batch-list wiring + 15-orphan triage into TODOS + DB-types recorded decision (OPS-03) [Wave 2]

**Research note:** mechanism understood — skip a research phase; the repo already carries the dedup'd-issue pattern to copy (`analytics-deploy-verify.yml`). Verification must simulate THREE concurrent runs, not two.

### Phase 159: RANK — Public-ranking integrity

**Goal**: Published percentile ranks and anonymous public reads reflect only computed, honestly-annualized analytics — and a resubmit race cannot corrupt a session's classification
**Depends on**: Phase 158 (attributable CI reds; a stable cohort measured before anything else moves)
**Requirements**: RANK-01, RANK-02, RANK-05, RANK-06, RANK-07, RANK-08, RANK-09
**Success Criteria** (what must be TRUE):

  1. A strategy with a failed/stale computation neither contributes to nor receives a published percentile rank — gated on `isComputedAnalytics` SEMANTICS (⚠️ a literal `complete` filter wrongly drops `complete_with_warnings`, a terminal SUCCESS), implemented as a separate `PERCENTILE_GATE_COLUMN` at the projection site with `PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged (the csv-finalize mirror prose depends on it), ONE shared filter helper for both TS callers, and the `get_verified_cohort_rank` SQL RPC moved in lockstep or its exclusion explicitly recorded (its prose claims parity-by-construction).
  2. The C-M1 PROD census (per-category published-with-analytics counts before/after the filter, against the <5 badge floor and the RPC's min-N 20) plus a per-strategy percentile before/after snapshot exist as phase artifacts BEFORE the filter lands — a rank that disappears is the HONEST outcome, but it must be a decided one (C-D1), surfaced in UAT, never a surprise; no test may assert "ranks improve" (direction is not uniform).
  3. Anonymous readers receive explicit column projections at both `strategy_analytics (*)` splat sites (`queries.ts:218`, `compare/page.tsx:68`) — `daily_returns`/`metrics_json`/`data_quality_flags` are absent from anon responses.
  4. The two money-math defects are closed on the strategy-analytics path: an all-non-negative return series with a >100% day is never re-read as prices (no sign-flipped Sharpe), and a blend leg with unknown `asset_class` is treated as crypto for RISK (a sole crypto leg no longer inflates Sharpe via √252).
  5. Two concurrent same-session resubmits cannot both take the FILL arm (compare-and-set on `category_id IS NULL`); the classification-conflict 409's own remedy can mint a fresh session (the re-mint fingerprint accounts for classification, or the exclusion is documented at the fingerprint); and `withPublishedOrOwner` validates the uid's shape before interpolating it into the PostgREST `.or()` filter.

**Plans**: 7 plans

Plans:
**Wave 1**

- [ ] 159-01-PLAN.md — C-M1 PROD census artifact `159-CENSUS.md` (checkpoint: ORCHESTRATOR runs the read-only SQL against PROD and commits results — the D-01 gate) (RANK-01) [Wave 1]
- [x] 159-05-PLAN.md — quantstats price-guess closed across `compute_all_metrics`: kwarg arm + P114 inline mirror for headline sharpe/sortino, benign-parity oracles, golden adjudication (RANK-05) [Wave 1]
- [x] 159-06-PLAN.md — FILL-arm CAS `.is("category_id", null)` + observed row count + honest `raced` refusal on the real POST harness (RANK-07) [Wave 1]
- [x] 159-07-PLAN.md — Re-mint fingerprint includes classification (both call sites + both dep arrays) + `withPublishedOrOwner` strict-UUID fail-closed validation (RANK-08, RANK-09) [Wave 1]

**Wave 2** *(blocked on the 159-01 census — D-01 hard ordering)*

- [x] 159-02-PLAN.md — Percentile gate: `PERCENTILE_GATE_COLUMN` + one shared helper for BOTH TS callers, `get_verified_cohort_rank` lockstep re-base migration, first CI SQL gate for the RPC (RANK-01) [Wave 2]

**Wave 3** *(blocked on 159-02 — file overlap on queries.ts / closed-sets.ts)*

- [x] 159-03-PLAN.md — Splat-class closure: three explicit projections + owner exemption comment + repo-wide class inventory (RANK-02) [Wave 3]
- [x] 159-04-PLAN.md — `blendPeriodsPerYear` unknown-leg-as-crypto for RISK + production call-site wiring pin (RANK-06) [Wave 3]

**Research note:** fix locations and predicates read directly from source — skip a research phase; only the cheap C-M1 census remains. `StrategyTable`'s ungated KPI cells are OUT of scope, logged (C-D2).

### Phase 160: PROVENANCE — The server's venue is the venue that annualizes

**Goal**: No client-supplied venue can differ from the venue the server validated, and the √365/√252 annualization stamp derives from the server's attestation — without ever stamping √252 onto a crypto strategy through a NULL attestation
**Depends on**: Phase 159 (the RANK → provenance → SHARE arc; deliberately NOT late — the REVOKE needs deploy-then-soak time before Phase 164)
**Requirements**: RANK-03, RANK-04
**Success Criteria** (what must be TRUE):

  1. The B-M1 PROD census (un-attested `api_keys` rows since 2026-08-11, split by exchange, strategy linkage, and `wizard_session_id` carriage) is measured and committed as an EARLY phase artifact — it gates the stamp swap and decides B-D1 scope (all of B-1..B-4, or B-4-alone-with-null-guard as the minimal correct cut). Copy the count-pinned, abort-on-drift census discipline from `20260811210000`.
  2. Every INSERT path into `api_keys` writes the server-validated exchange — the Phase-156 service-role-writer pattern extended (`validate-and-encrypt`, which already knows the canonical venue, writes the row and returns `{ api_key_id }`; the client components stop inserting; then REVOKE INSERT) — with deploy-first / revoke-second discipline, ⚠️ never migration-first, and every `.from("api_keys")` mutation grepped before the REVOKE (DELETE is also a live client path).
  3. The `asset_class` stamp at `finalize-wizard` derives from the attested venue, and the swap MOVES WITH the null-attestation extension of the `skipAssetClassWrite` guard — a NULL attestation SKIPS; it never stamps `traditional`/√252 onto a crypto strategy (⚠️ TODOS.md's "one-identifier change" framing is measured WRONG; `isCryptoExchange(null) === false` is the trap).
  4. The B-D2 oracle pins the ECONOMICS (a null attestation annualizes on nothing — it skips), never the implementation's own expression; if the census finds affected strategies, their re-annualization gets golden-parity treatment.

**Plans**: 7 plans (6 executed + 1 gap closure)

Plans:
**Wave 1**

- [x] 160-01-PLAN.md — B-M1 PROD census artifact `160-CENSUS.md` (checkpoint: ORCHESTRATOR runs the read-only SQL against PROD, fills the mechanical B-D1 decision, commits) (RANK-03, RANK-04) [Wave 1]

**Wave 2** *(blocked on the 160-01 census — it gates everything downstream)*

- [x] 160-02-PLAN.md — TRACER: `validate-and-encrypt` persist arm (admin INSERT stamps exchange + attested_venue from `exchangeNormalized`, returns `{ api_key_id }`, strict `persist: true` skew discriminator) + ApiKeyManager conversion end-to-end (RANK-03) [Wave 2]
- [x] 160-04-PLAN.md — RANK-04 stamp swap + `skipAssetClassWrite` null-attestation extension in ONE change + B-D2 economics oracles observed RED under neuters; create-with-key confirmed unchanged (RANK-04) [Wave 2]

**Wave 3** *(blocked on 160-02 — the persist contract)*

- [x] 160-03-PLAN.md — StrategyForm + AllocatorExchangeManager conversions (the THIRD insert site) + state-adaptive SQL gate `test_api_keys_insert_not_client_writable.sql` (A1 retention positive armable now) (RANK-03) [Wave 3]

**Wave 4** *(PR-2 — the second landing; blocked on PR-1 merged + deployed + soaked)*

- [x] 160-05-PLAN.md — Soak checkpoint (prod smoke of wizard + all three converted surfaces, census re-measure addendum) → blocking-human go/no-go → census-guarded `REVOKE INSERT` migration + whole-repo write-surface re-grep + legacy ciphertext arm retired (RANK-03) [Wave 4]

**Wave 5**

- [x] 160-06-PLAN.md — Golden-parity re-annualization for census-identified strategies (`160-PARITY.md`; RISK ×≈1.203 / RETURN unmoved adjudication) or the recorded no-op (RANK-04) [Wave 5]

**Wave 6** *(gap closure, 2026-08-23 — from 160-VERIFICATION.md; the STALE_CLIENT retirement itself already landed at `2fe28b89`)*

- [ ] 160-07-PLAN.md — Gap closure: independent gsd-verifier re-adjudication of the retired-legacy-arm must_have at HEAD + human PROD smoke of the persist arm (the writer's first real exercise) + honest record and TODOS hygiene (RANK-03) [Wave 6]

**Research note:** ARCHITECTURE confidence is LOW without B-M1 — the census is this phase's first task, not a nicety.

### Phase 161: WIZERR — Honest error surfaces

**Goal**: Every founder-hit wizard, key, and CSV error surface names the actual blocker in truthful copy — no `code: UNKNOWN`, no false sentence, no "try again" that can never succeed
**Depends on**: Phase 158 (attributable CI; the curated-message test fence is exercised heavily here)
**Requirements**: WIZERR-01, WIZERR-02, WIZERR-03, WIZERR-04, WIZERR-05, WIZERR-06, WIZERR-07, WIZERR-08, WIZERR-09, WIZERR-10, WIZERR-11, WIZERR-12, WIZERR-13
**Success Criteria** (what must be TRUE):

  1. The MT5 "gateway misconfigured" copy names the actual blocker derived from the `terminal_info` flags the probe already holds (`tradeapi_disabled` vs `trade_allowed`), fixed as a CLASS across all six carrier sites, within the curated-message test fence.
  2. Key-lane remedies are safe and truthful: "Try another key" never destroys the draft or cascades away composite members; an orphaned live key surfaces an honest remedy instead of a false `DRAFT_ALREADY_EXISTS` 409; the `KEY_INVALID_FORMAT` one-code-many-causes split lands on the remaining 2 routes / 9 sites honoring their internal-vs-public copy contracts; wizard `AUTH_FAILED` copy names the venue the user actually selected — never Deribit while Binance is selected.
  3. The coverage law reaches every surface the class regrew on: the `keys/[id]/permissions` private `PROBE_*` cascade gets a derived-population coverage law (and `KEY_UNDECRYPTABLE`'s remedy says "reconnect the key", not "try again"); `AllocateDialog`, `RenameStrategyDialog`, and `MarkOwnershipDialog` stop minting `code: UNKNOWN`; the five 5xx→`UNKNOWN` terminal arms (admin match/eval, simulator) forward recognized `seamCode`s; `MT5_GATEWAY_UNREACHABLE`'s server-advertised `Retry-After` threads end-to-end through both key-route catches.
  4. CSV verdicts tell the truth: the 7-row floor is evaluated on the wizard composite arm AND `INSUFFICIENT_CSV_HISTORY` renders its own copy (landed together or not at all); examined-but-refused verdicts render a truthful fourth outcome replacing the false "only 0 trade(s)" sentence (D-15's oracle re-cut deliberately, the TOCTOU re-check wording following); the csv-finalize A2 409 sentence describes the actual case (same track record, different flow); and the per-row CSV breakdown renders its data half without leaking `'nan'` or echoing untrusted cell contents.

**Plans**: 10/10 plans executed
**UI hint**: yes

Plans:

- [x] 161-01-PLAN.md — WIZERR-04: KEY_UNDECRYPTABLE honest remedy + derived-population PROBE_* coverage law (wave 1, tracer)
- [x] 161-02-PLAN.md — WIZERR-01: MT5 flag→cause builder across both raise sites, inside the curated fence (wave 1)
- [x] 161-03-PLAN.md — WIZERR-12/-13: csv-finalize A2 sentence + per-row breakdown nan-guard and no cell echo (wave 1)
- [x] 161-04-PLAN.md — WIZERR-02: "Try another key" becomes a pure, non-destructive step transition (wave 1)
- [x] 161-05-PLAN.md — WIZERR-03/-11: KEY_ORPHANED honest refusal + venue-parameterized AUTH copy (wave 2)
- [x] 161-06-PLAN.md — WIZERR-05: Retry-After threads end-to-end + parity law over the five local error doubles (wave 3)
- [x] 161-07-PLAN.md — WIZERR-09/-10: 7-row composite floor with its copy (atomic) + truthful fourth CSV verdict (wave 3)
- [x] 161-08-PLAN.md — WIZERR-06: five 5xx terminal arms forward the recognized code + shape law (wave 4)
- [x] 161-09-PLAN.md — WIZERR-08: KEY_INVALID_FORMAT split on 2 routes / 9 sites + 4th ROUTES row (wave 5)
- [x] 161-10-PLAN.md — WIZERR-07: three dashboard dialogs stop minting UNKNOWN + first dashboard coverage law (wave 4)

### Phase 161.1: LEDGER-REFRESH — Recurring strategy refresh for ledger-backed venues, shipped dormant behind a founder-gated schedule (INSERTED)

**Goal**: Every ledger-backed venue (mt5/sfox/deribit) has a recurring path that refreshes
`strategy_analytics` after onboarding — shipped DORMANT, with activation a founder-gated live op.
**Depends on:** nothing. Independent of Phase 161 (that phase is error copy; this is data flow).
Inserted after 161 for roadmap ordering only — it MAY be pulled ahead, and it is the more urgent
of the two because it is a live, founder-reported data-integrity defect.
**Requirements**: LEDGER-01, LEDGER-02, LEDGER-03, LEDGER-04
**Plans:** 5/5 plans executed

**Root cause (measured on PROD 2026-08-24; ⚠️ CORRECTED 2026-08-25 by re-measurement at HEAD
`57a407ea` — two claims below were false as originally written):**

No recurring enqueuer reaches `strategy_analytics` for a ledger-backed venue. Both daily strategy
crons gate on ccxt-only closed sets excluding mt5 (`reconcile-strategies` 03:30 →
`RECONCILABLE_EXCHANGES`; `sync-funding` 04:00). Measured: 4 MT5 strategies with
`strategy_analytics` between 2026-08-04 and 2026-08-21, versus okx at 2h old.

⚠️ **CORRECTION 1 — the three ledger venues are ASYMMETRIC, not uniform.** The original text said
`cron_sync` "defers anything outside `EXCHANGE_CLASSES`", implying all three are deferred.
`deribit` IS in `EXCHANGE_CLASSES` (`analytics-service/services/exchange.py:812`). Only **mt5** and
**sfox** hit the `routers/cron.py:182` deferral. Deribit takes the ccxt branch and is then filtered
by `stored > 0` (`routers/cron.py:471-472`) — a fill-count predicate that is structurally wrong for
a settlement-ledger venue. **A fix scoped as "venues absent from `EXCHANGE_CLASSES`" silently drops
deribit.** Scope the cohort off `_LEDGER_BACKED_SOURCES` (`long_fetch.py:63`), not off absence.

⚠️ **CORRECTION 2 — `process_key_long` is the wrong recurring unit, and re-enqueuing it is a
provable no-op.** The original text said it is "enqueued in exactly one place — strategy creation
(`api/strategies/finalize-wizard`)". At HEAD it is enqueued at two Python sites
(`routers/process_key.py:1517`, `:765`), not from that route. More importantly
`long_fetch.py:154` returns `DONE` on `status == "published"` and `:193` returns `DONE` on the whole
`advanced_statuses` set — every onboarded strategy is `published`. A recurring enqueue against the
existing `verification_id` therefore yields a GREEN job, a new `compute_jobs` row, and
`strategy_analytics` UNTOUCHED. The recurring unit must be the chain **tail** —
`derive_broker_dailies` strategy-mode, which is `JOB_CHAIN_FOLLOW_ON["process_key_long"][0]` — or a
newly minted verification row, the way the user-triggered resync does it.

⛔ **A7 — LOAD-BEARING UNKNOWN.** The recurring mt5 `derive_broker_dailies` → `strategy_analytics`
path **has never actually run end-to-end**. The plan's FIRST verification must be one manual enqueue
for one MT5 strategy, observed to completion, BEFORE anything is scheduled. Do not schedule an
unproven path.

⛔ **No TS mirror of the venue set.** `_LEDGER_BACKED_SOURCES` (`long_fetch.py:63`) is the sole
authority. A hand-copied mirror previously drifted (TS at 1 venue, Python at 3) and cost a funded
MT5 account its publish path. This rules out a Vercel-cron / TS-route implementation unless a drift
gate is explicitly accepted. **This fence is the authority for the rule.**

⚠️ **Corrected 2026-08-25 — do not restore the earlier justification.** This entry previously said
`src/lib/strategyGate.invariant.test.ts` "BANS venue literals in TS". Measured: `:64` scopes
`BANNED_VENUE_LITERALS` to `GATE_PATH = src/lib/strategyGate.ts` **only** — a venue set added to
`src/lib/closed-sets.ts` would NOT trip it. The rule stands on this fence and the measured drift
incident, NOT on a repo-wide mechanical gate that does not exist. Never cite that test as the
enforcement mechanism: a stated reason that is falsifiable-and-false teaches the next reader a rule
they will correctly discover is untrue, and then discard along with the real constraint.

**Success Criteria** (what must be TRUE):

  1. A recurring enqueuer exists that reaches `strategy_analytics` for every ledger-backed venue,
     via the strategy-keyed `process_key_long` chain — never the ccxt fill path.

  2. It ships DORMANT: the schedule is NOT registered, activation is a documented founder-executed
     live op, matching the SFOX_ENABLED / WORKER-03 pattern. Merging changes no prod behavior.

  3. The staleness is observable before it is user-visible: a check that fails on a timestamp
     that advances ONLY when new analytics data actually lands — never on `last_sync_at` (advanced
     daily by key-scoped jobs; this is what hid the bug), and never on `strategy_analytics.computed_at`.

     ⚠️ **This criterion's original wording named `computed_at` and was WRONG — corrected 2026-08-25
     by measurement at HEAD.** The SQL status bridge re-stamps `computed_at = now()` on EVERY job
     transition (`20260802120000_strategy_analytics_stuck_computing_reaper.sql:342,398,421`), so it
     reproduces the `last_sync_at` lie one column over. That migration says so itself at `:82` and
     `:230`, and RAISES at `:678` if the reaper body so much as references `computed_at` — it names
     this "the Phase 106 janitor bug". This same ROADMAP already warns against the identical mistake
     at line ~1811 ("never the 106-janitor-revert `updated_at`/`computed_at` mistake").

     The planner MUST pick the column, and MUST prove the choice by writing a test that advances the
     rejected timestamps WITHOUT new data and shows the check still fails. Recommended starting
     candidate: the latest date present in `strategy_analytics_series` (a status transition cannot
     move it). `computing_started_at` is NOT the answer either — it is the stuck-row reap anchor,
     not a freshness signal.

  4. A regression pin fails if any ledger venue is dropped from the refresh set — proven
     falsifiable by neutering and observing RED.

**⛔ SCOPE FENCES — two approaches already investigated and REJECTED. Do not re-enter:**

  - **Do NOT add mt5 to `RECONCILABLE_EXCHANGES`.** `run_reconcile_strategy_job` calls
    `fetch_raw_trades` (ccxt). mt5 is in `_LEDGER_BACKED_SOURCES`; this is the BYB-02 corruption
    class that "crashed EVERY onboard in prod" when sfox fell into it.

  - **Do NOT re-register the `derive-allocator-key-dailies` cron.** It is key-mode and never
    stamps `strategy_analytics`; it was DELIBERATELY unscheduled at the v1.11 recovery; and
    `docs/runbooks/flipretry-derived-equity-go-live.md:171` forbids scheduling it from a migration
    (auto-apply + a silently-skipped worker deploy recreates the v1.11 wedge verbatim). A migration
    doing exactly this was written and deleted unmerged on 2026-08-24.

**⚠️ Risk shape:** fanning jobs at a fixed hour carries the v1.11 worker-wedge shape — MT5
serializes on ONE shared terminal (`services/mt5_concurrency.py`) at a 15-min timeout per key.

Plans:

- [x] 161.1-01-PLAN.md — LEDGER-03 tracer: staleness view keyed on the returns-series date (not `computed_at`, not `last_sync_at`) + the A7 PROD tracer + the D-COMP founder decision (wave 1)
- [x] 161.1-02-PLAN.md — LEDGER-01/-02/-04: the dormant, staleness-gated, bounded single-key fan-out on the chain tail + matched-pair SQL gate + venue-drift/no-schedule static gates (wave 2)
- [x] 161.1-03-PLAN.md — LEDGER-02: the founder go-live runbook (two ordered LIVE ops, two rollback levels incl. detect/repair/verify remediation for rows a failed tick downgraded) + TODOS filings (wave 3)
- [x] 161.1-05-PLAN.md — LEDGER-02/-04: the static drift / dormancy / bound gates, sliced out of plan 02 (wave 3)
- [x] 161.1-04-PLAN.md — LEDGER-01: the composite arm on `stitch_composite` so deribit has real coverage — CONDITIONAL on D-01 (wave 4)

### Phase 162: HONEST — What the user sees is true

**Goal**: Every number, badge, and affordance a user sees reflects the data underneath it — no raw exceptions as copy, no freshness claim a dead series contradicts, no missing metric where data exists
**Depends on**: Phase 158 (attributable CI)
**Requirements**: HONEST-01, HONEST-02, HONEST-03, HONEST-04, HONEST-05, HONEST-06
**Success Criteria** (what must be TRUE):

  1. A computation failure renders mapped user copy, never a raw Python exception string — mapped at the WRITER, with the underlying str/None compare root-caused.
  2. Freshness claims are true: a strategy whose return series ended 89 days ago cannot read FRESH (⚠️ investigated FIRST — flat account vs derive gap — before any fix is chosen), and example strategies advertise no stale "Synced Nd ago" badges on discovery.
  3. `buildEquityCurveSeries` serves real per-strategy equity curves now that `returns_series` is selected (the hard-coded `equityCurve: null` and its false comment are gone), and drawer-added strategies render CAGR/Sharpe like book rows.
  4. "Finish setup →" opens the wizard with the clicked key preselected.

**Plans**: 9/9 plans executed (2 waves)

> ⚠️ **162-08 Task 1 was SUPERSEDED, not completed as written.** It planned a recompute of the
> 15 example rows. Measured 2026-08-26: `csv_daily_returns` held **0 rows for all 15** while the
> handler needs ≥2, so the recompute arm was structurally impossible — an enqueue would have
> fired the fence 15 times. The executor correctly halted (its PROD credential lane was also
> blocked by the harness) and touched nothing. Founder ruled: unpublish AND delete. Executed and
> verified on PROD the same day — 15 strategies deleted, 0 examples remain; cascades took 1470
> match_candidates, 29 portfolio memberships, 5 favourites and 3 contact_requests; 28
> allocation_events and 3 match_decisions were cleared first as FK blockers. Full backup retained
> outside the repo. HONEST-03 therefore closes on measurement rather than on recompute.

Plans:

- [x] 162-01-PLAN.md — Diagnostics census: HONEST-02 flat-vs-derive-gap verdict + HONEST-01 str/None root cause, read-only vs PROD (wave 1)
- [x] 162-02-PLAN.md — HONEST-01 curated copy at every writer (classify_exception arms, 18-site stamp choke point, portfolio _fail) + wizard Details-appendix removal, D-162-4 strict (wave 1)
- [x] 162-03-PLAN.md — HONEST-04 gated real equity curves + C-3 coverage caption + HONEST-03 is_example SyncBadge class guard (wave 1)
- [x] 162-04-PLAN.md — HONEST-05 widened /returns co-serves gated cagr/sharpe + addedMetricsById composer fallback, C-4 five-state contract (wave 1)
- [x] 162-05-PLAN.md — HONEST-06 server use-existing-key path (D-162-3): decision gate + tracer RPC/route arm + state-adaptive SQL gate — service-role boundary (wave 1, checkpoint)
- [x] 162-06-PLAN.md — HONEST-06 client preselect thread + C-5 saved-key summary, all three key populations pinned (wave 2)
- [x] 162-07-PLAN.md — HONEST-02 verdict fix: D-162-2 "Track record through {date}" recency line (flat arm) or recorded pipeline routing (gap arm) (wave 2)
- [x] 162-08-PLAN.md — HONEST-03 D-162-1 recompute of the 15 example rows (unpublish fallback, never synthesize) + HONEST-01 follow-throughs + TODOS filings (wave 2)
- [x] 162-09-PLAN.md — KeyPermissionBadge: scope chips/caption gated on probe_error — a failed probe can no longer render scope facts (PROD QA finding 2026-08-25, phase-goal class) (wave 1)

**UI hint**: yes

### Phase 163: HARDEN — Fail safe, closed, and loud

**Goal**: The backend fails safe, closed, and loud — secrets cannot reach logs, monitors cannot report false health, committed work cannot 500, and every mutating or compute-heavy surface is limited and audited
**Depends on**: Phase 158 (attributable CI). ⛔ Must complete before Phase 164 — SEC-03's audit-gate decision polices SHARE's new mint/revoke RPCs (two REQ groups, one edit)
**Requirements**: OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, HONEST-08
**Success Criteria** (what must be TRUE):

  1. The structlog frozen-proxy class is closed at BOTH failure modes — a source-scan gate for module-scope `.bind()` (Mode A) AND a behavioral redaction test for first-use-before-`configure_logging()` (Mode B) — each demonstrated RED when neutered. ⚠️ Fixing one and closing the audit is false closure; the leak class is ccxt HMAC signatures and MT5 passwords.
  2. Failure paths are honest: `createAdminClient()` cannot throw on the request path after an irreversible commit (the class closed at all three known sites); `checkStuckNotifications` distinguishes "nothing stuck" from "could not tell"; a failed denominator read PAGES instead of logging success; and the integration test actually falsifies both.
  3. Worker/request plumbing is deterministic and bounded: the 10-param `_enqueue_compute_job_internal` drops `INTO STRICT` on its lost-race branches (parity with the de-STRICT-ed 7-param overload); the resync draft pre-check is deterministic (`ORDER BY created_at DESC` + bounded window); the retry loop cancels abandoned response bodies (`body.cancel()`).
  4. The security floor is measured, not assumed: the server-side password policy backing client `minLength={6}` is verified, enforced, and documented; the tracked `.planning/` docs pass a NO-ALLOWLIST scan (MEASURED 2026-08-26: **80** files carry the username, 57 carry `\/Users\/` paths — the "~50" estimate was low) for the macOS username / local absolute paths (the gitleaks allowlist is path-based and blind here); the tenth IP-keyed route (`simulator.py`) is repaired along with the concealing wrapper-check test (equality assertion, quarantine shrinks to 0); and removing a panel mid-validate aborts the in-flight credential-carrying POST.
  5. Coverage gates close their gaps: `add_wizard_composite_key` is policed by the audit-coverage gate with the pragma-vs-real-emission decision RECORDED, and the bridge + portfolio-optimizer flows get a named `bridgeComputeLimiter` sized to backend reality (closing the 30× front/back mismatch) ⛔ without resizing the shared `userActionLimiter`.
  6. A freshness claim is not surface-local: the public discovery table's "Synced Nd ago" badge buckets on the **staler** of sync- and series-recency, exactly as `FreshnessChip` already does on the factsheet (HONEST-08). ⚠️ MEASURED ON PROD 2026-08-26 — `Phoenix Protocol` advertises "Synced 7h ago" on `/browse/crypto-sma` over a series that ended 2026-05-06, **112 days** earlier, while its own factsheet reads `Track record · old`. The rule HONEST-02 wrote ("a series dead 89 days cannot read FRESH") is violated on the most public surface in the product. ⛔ Do NOT close by deleting the badge, and ⛔ do NOT rely on the `is_example` gate — HONEST-03 scoped that to example rows and all 15 were deleted, so it now guards nothing here. The test must use a REAL published row with a stale series and be demonstrated RED when the staler-of-two logic is neutered.

**Plans**: 9/9 plans executed (2 waves)

Plans:

- [x] 163-01-PLAN.md — OPS-05 structlog frozen-proxy closed at BOTH modes; Mode B is LIVE on the worker (`main_worker.py` never configures) — planned first as the phase's highest-risk item (wave 1)
- [x] 163-02-PLAN.md — SEC-04 `bridgeComputeLimiter` sized from a MEASURED PROD backend number (measurement is an explicit early task); ⛔ `userActionLimiter` untouched; roster pin moves in the same commit (wave 1)
- [x] 163-03-PLAN.md — SEC-02 username/absolute-path scrub across the measured **94** tracked files (87 `.planning/` + 5 docs/ + 2 applied-migration comment headers, exception recorded — 87 is the `.planning/`-only figure, not the total) + NEW no-allowlist scanner wired into `npm run lint` (wave 1)
- [x] 163-04-PLAN.md — HONEST-08 discovery "Synced Nd ago" badge buckets on the staler of sync- and series-recency via ONE shared resolver mirroring FreshnessChip; regression test on a real published fixture row, RED under neutering (wave 1)
- [x] 163-05-PLAN.md — OPS-06 createAdminClient hoisted above the commit at the measured FOUR occurrences in three files + OPS-07 monitor honesty (discriminated union; denominator failure PAGES non-200; integration falsifiers) (wave 1)
- [x] 163-06-PLAN.md — OPS-08 forward-only migration de-stricting the 10-param enqueue overload's four lost-race branches + pg_get_functiondef SQL gate (expected RED until TEST hand-apply); blocking three-reviewer checkpoint before apply (wave 1)
- [x] 163-07-PLAN.md — OPS-09 deterministic resync draft pre-check (ordered + bounded, prose debts settled) + SEC-05 simulator tenant-keyed with the concealing quarantine/carve-out removed (equality at 0, class size 10) (wave 1)
- [x] 163-08-PLAN.md — OPS-10 capability-checked `body.cancel()` on the single abandoning retry arm + SEC-06 panel removal aborts the in-flight credential POST by identity, reason "user" (wave 1)
- [x] 163-09-PLAN.md — SEC-01 hosted password policy READ, unified `MIN_PASSWORD_LENGTH`, documented + SEC-03 `add_wizard_composite_key` under the audit law with the pragma decision RECORDED (wave 2, serialized on REQUIREMENTS.md after 163-03)

### Phase 164: SHARE — Copy Link always works, and never discloses

**Goal**: "Copy Link" on a strategy its owner can view yields a URL its recipient can view — a revocable per-strategy share token — and the token lane can never disclose an unpublished strategy through the id-keyed public cache
**Depends on**: Phase 160 (provenance REVOKE soaked), Phase 163 (RPC audit gate standing). ⛔ Its own phase, its own PR, shares a PR with NOTHING; ⛔ never branched from `feat/phase-156-connect-refactor`
**Requirements**: SHARE-01, SHARE-02, SHARE-03, SHARE-04
**Success Criteria** (what must be TRUE):

  1. The owed decisions are argued and RECORDED as early tasks before implementation: A-D1 URL shape (`?s=<token>` on the id route vs `/factsheet-share/[token]` — the two research files disagree DELIBERATELY; surface to the founder, never defaulted by a planner), the token model (raw-at-rest vs HMAC + stored generation counter — the deviation from `scenario-share-token.ts`'s hash-only discipline argued, and model B's new required Vercel env var named as a prod-only failure mode), A-D2 (where revoke lives for `status='private'`, whose `StrategyActions` falls through to `return null` — ⛔ no publish flow grows inside this phase), and A-D3 (tearsheet/PDF routes in or out, decided explicitly).
  2. Copy Link on an unpublished strategy yields a URL an anonymous recipient can view, mint-or-REUSE across sessions (⚠️ a verbatim `/scenario-share` port cannot deliver reuse — it stores only the hash and unconditionally revokes on mint, regenerating the original bug in slow motion); the bare `/factsheet/<id>` URL stays owner-only and the id stays a non-secret.
  3. ORDERED adversarial cache isolation: after a token-lane render of an unpublished strategy, an anonymous request for `/factsheet/<id>` STILL 404s — the token lane calls the payload builder directly with ZERO reads and ZERO writes at the id key (⛔ never a token in `cacheKey`/`keyParts`, never a token-aware `/api/og/factsheet/[id]`), and the acceptance test is demonstrated RED with the bypass neutered.
  4. Revoke is immediate and convergent: regeneration kills previously-copied links; a revoked/unknown token renders a content-free `410` + `no-store` on the TOKEN lane only (the bare-id lane keeps its uniform 404 or the id becomes an existence oracle); soft-revoke, never DELETE; double-revoke converges; the owner can see whether a live link exists.
  5. The share affordance is honest as a CLASS: no "Link copied!" for a link that cannot work, ONE predicate across all three affordance sites (`FactsheetView`, strategies page, discovery detail), a token-link RECIPIENT never sees a Copy-Link control that rebuilds the URL without the token, and `OwnerUnpublishedNotice`'s "anyone else sees a 404" sentence is corrected in this same phase.

**Plans**: 7/7 plans executed
**UI hint**: yes

Plans:

- [x] 164-01-PLAN.md — TRACER: builder seam extracted to `src/lib/factsheet/` + phase-148 guard re-pointed to pin the MODULE; HMAC+generation token module (loud at module load); `/factsheet-share/[token]` recipient route + 410 `gone` sibling + proxy/route-contract wiring + structural recipient mode (wave 1)
- [x] 164-02-PLAN.md — phase-29 guard narrowed to the scenario locked set (never a migration rename) + `strategy_shares` migration (generation model, no token at rest, two INVOKER RPCs) + SKIP-01-clean SQL gate; blocking three-reviewer + TEST hand-apply checkpoint (wave 1)
- [x] 164-05-PLAN.md — leak-channel closure (Sentry path scrub net-new, per-route no-referrer, Plausible exclusion, recipient analytics suppression) + the ORDERED adversarial cache test, RED-demonstrated (wave 2 — MOVED UP 2026-08-27, gate condition 5)
- [x] 164-06-PLAN.md — **N1 ONLY** (founder ruling 2026-08-27: N2 dropped): `BEFORE INSERT` trigger forcing `generation = 1`, a **bounded-increment** rule on UPDATE so an owner cannot PATCH `generation` toward the bigint ceiling, and `sanitize_user`'s Art.17 arm made provably non-abortable. ⛔ Do NOT add `SELECT … FOR UPDATE`, and do NOT touch STEP 6 arm (i-b) — see gate row 3 (wave 2 — NEW 2026-08-27, gate condition 2)
- [x] 164-07-PLAN.md — F6: the cache guard pinned over the TRANSITIVE import graph rather than one file's bytes (wave 2 — NEW 2026-08-27, gate condition 4)
- [x] 164-03-PLAN.md — mint-or-reuse + atomic-revoke API routes under the audit law; byte-identical-reuse regression pin; 404-as-convergence (wave 3 — DEMOTED 2026-08-27; ⛔ its merge is the gate)
- [x] 164-04-PLAN.md — SHARE-04 honesty class: status-aware Copy Link (published lane byte-unchanged), factsheet revoke with inline confirm, OwnerUnpublishedNotice corrected, ONE predicate across three affordance sites (wave 3 — DEMOTED 2026-08-27, follows 164-03)

**⛔ Wave restructure 2026-08-27 — 164-03's merge is a gate, not a step.** Six red teams plus a
synthesizer established that the moment `164-03` merges, the mint route makes `strategy_shares`
writable by owners — and **N1 becomes reachable by any owner, on their own row, with a single
PATCH, unrecoverably without DDL, aborting that data subject's own Art.17 erasure.** That is a
regulatory failure mode the data subject can trigger themselves with no operator remedy, and the
synthesizer named it the single worst item in the corpus. It is harmless *only* while the table has
zero rows, which is exactly the window that closes at 164-03.

So the phase is now three waves, and the six conditions at `SYNTHESIS.md:270-287` must ALL hold at
the moment 164-03 merges:

| # | Condition | Where it lands | State at 2026-08-27 |
|---|---|---|---|
| 1 | Nonce in the MAC pre-image **plus** `REVOKE INSERT(nonce), UPDATE(nonce) FROM authenticated`, with a test proving neither RPC names the column | 164-02 | ✅ shipped (`a48b8bf6d`) |
| 2 | N1 closed at the root: `BIGINT` **plus** `BEFORE INSERT` forcing `generation = 1` **plus** a bounded-increment rule; `sanitize_user`'s Art.17 arm provably non-abortable | 164-02 + **164-06** | ✅ **CLOSED 2026-08-28 (164-06), verified by the orchestrator on a fresh cluster.** Trigger widened to `BEFORE INSERT OR UPDATE`; INSERT forces 1 (closing R3 for BYPASSRLS roles grants never reach); rule (6) bounds every UPDATE to +1, so overflow is unreachable BY CONSTRUCTION and the Art.17 arm needs no handler. The N1 reproduction now rejects at **step 2** — yesterday it ended `Art.17 ERASURE ABORTED 22003`. Gate **103** arms, floors ARMS_FLOOR=166 / SENTINEL_FLOOR=8 (the 106/169 pair written here on 2026-08-27 was a forecast that the final arm count undershot; the file, its closing sentinel roster and ci.yml are mutually consistent at 103 and were re-counted 2026-08-28) |
| 3 | ~~N2 race in `revoke_strategy_share`~~ | ~~164-06~~ | ✅ **CLOSED AS NOT-A-DEFECT — founder ruling 2026-08-27.** Measured: 3 interleavings × 2 concurrent sessions, all converge; both RPCs are single statements so there is no read-then-write window. ⛔ AND THE PRESCRIBED FIX WAS THE HAZARD — `revoked_at IS NULL` is the convergence CONTRACT, and rewriting arm (i-b) *so the fix could land* would have removed the guard and created the counter-inflation bug. **Nobody may re-open this by adding `FOR UPDATE` or editing arm (i-b) without new measured evidence.** `EXECUTION-EVIDENCE.md` §6 |
| 4 | F6: cache guard pinned over the transitive graph, `page.cache-isolation.test.tsx` written and demonstrated RED first | **164-07** + 164-05 | ✅ **CLOSED 2026-08-28.** Static half (164-07): the builder's 38-module closure pinned against `next/cache`, RED proven at depth 3. Behavioural half (164-05): the ORDERED spec written and RED-first. ⚠️ 164-05 MEASURED that the plan's claim of two detectors was FALSE — phase-148 stayed green under the poison (it counts `unstable_cache(` in one file; its repo-wide walks ban two symbols the neuter never used), and 164-07 does not cover it either because the page imports the builder, not the reverse. Gap was unowned; closed with a third file. Two detectors is now true BY MEASUREMENT |
| 5 | F1/F2/F4 shipped (Plausible exclusion, Sentry path scrub, per-route `no-referrer`) | 164-05 | ✅ **CLOSED 2026-08-28.** ⚠️ Two plan errors corrected by measurement: Plausible's `data-exclude` is REMOVED from the current script and its exclusion is gated behind `pageview` while `location.href` rides every event — mitigated by not loading the script on the lane at all; and the `Referrer-Policy` justification was my error (cross-origin sends origin ONLY, so path-vs-query is Referrer-neutral) — the header stands on the SAME-ORIGIN gap, and the false mechanism is now recorded as false in all four files that carried it |
| 6 | Every one of the above **executed against a real PostgreSQL instance**, run output in the plan — not asserted in prose | all | 🟡 **discharged for what exists today** — 2026-08-27, PostgreSQL 16.13 throwaway cluster: both migrations APPLIED, `test_strategy_shares_rls.sql` **ALL 101 ARMS EXECUTED** exit 0, sequence `{1,1,2,2,2,3}`; arms proven able to fail (3 mutations on 130000, a `USING (true)` tenant leak caught by TENANT 4a). See `EXECUTION-EVIDENCE.md` + `pg-harness/run.sh`. ⛔ Re-arms for 164-06/164-07 |

⚠️ Wave 2 is now `164-05` + `164-06` + `164-07`; wave 3 is `164-03` + `164-04`. `164-06` and
`164-07` are net-new and unplanned. ⛔ **`20260827130000_sanitize_user_revoke_strategy_shares.sql`
is BLOCKED on `DRIFT-02`** (root `TODOS.md`) — it was re-based on a repo file that PROD superseded
via a surgical in-place patch, and shipping it as written would revert a mandatory GDPR repoint,
pointing Art.17 erasure at a VIEW. Re-base it on `pg_get_functiondef` output from PROD before it
moves. The three residuals accepted rather than closed (`SHARE-RES-R4`, `SHARE-RES-R2g`,
`SHARE-RES-F5`) are named in root `TODOS.md`.

**Research note:** the payload-builder seam is the one un-measured integration (extracting the build half of `fetchAndBuildPayload` touches the composite arm AND the single-key basis arm — MEDIUM confidence, wider than it looks). Budget a research pass at plan time; don't discover it. Token-leak channels: Sentry `beforeSend` scrub verified against a REAL captured event, `Referrer-Policy: no-referrer` per-route, generic metadata (link-unfurl dullness accepted explicitly — a private link SHOULD be dull in a chat preview). *(Planning update 2026-08-26: the seam measurement is now done — the composite/basis arms moved to `src/lib/factsheet/` in July, so the extraction in 164-01 is a one-function verbatim move per the founder's final D-06 ruling.)*

### Phase 164.7: APPSETTINGS — every app.* GUC reader moves to a mechanism this platform actually grants, because ALTER DATABASE and ALTER ROLE both return 42501 here (INSERTED)

**Goal:** Every `current_setting('app.…')` reader in `supabase/migrations/**` moves to a configuration mechanism this platform actually grants, and a machine stops the next one being written. ⛔ **MEASURED ON PROD 2026-09-05, not inferred from docs** — all three forms, in the Supabase SQL editor as `postgres`:

| Form | Result |
|---|---|
| `ALTER DATABASE postgres SET app.ledger_refresh_enabled = 'true'` | **`ERROR: 42501: permission denied to set parameter`** |
| `ALTER ROLE postgres SET app.ledger_refresh_enabled = 'true'` | **`ERROR: 42501: permission denied to set parameter`** |
| `SET app.ledger_refresh_enabled = 'true'` (session) | ✅ returns `true` |

So the value can only be set per-session, which no out-of-band operator action can do. **12 read sites across 4 settings depend on a mechanism that cannot be configured here**, in five migrations: `20260407164606_perfect_match.sql:31` (`app.admin_email`), `20260408113029_cron_heartbeat.sql:144,145,167,170` and `20260408215026_schedule_match_cron_hourly.sql:45,46,70,73` (`app.analytics_service_url` ×4, `app.analytics_service_key` ×5), and `20260825130000_ledger_refresh_fanout_dormant.sql:275` + `20260825140000_ledger_refresh_composite_arm.sql:220` (`app.ledger_refresh_enabled` ×2).

⭐ **This is a THIRD independent discovery of one defect.** `CRON-DRIFT-01` found it in the match-engine cron (booked, PROD hand-fixed onto Vault 2026-09-01, repo never updated — Phase 164.5.1 item (7) repairs that ONE job). Phase 161.1 then shipped an entire fail-closed activation switch on the same mechanism and it was never exercised, because the phase shipped dormant by design — so the switch has never once been thrown and **cannot be**. Two phases independently designed operator controls on a Postgres feature this platform does not grant, a year apart, and neither found out until someone tried. The pattern, not the instance, is this phase's subject.

⛔ **The blast radius is a shipped, blocked deliverable.** Phase 161.1 LEDGER-REFRESH is complete, verified 4/4, merged as v0.73.0.0, and **cannot be turned on**. Four PROD mt5 strategies carry `strategy_analytics` days stale against okx at hours, which is the exact gap 161.1 was built to close.

⛔ **The available workaround is REJECTED, and the rejection is the point.** Setting the flag inside the cron command (`$$SET app.… = 'true'; SELECT enqueue_…();$$`) works and was offered to the founder on 2026-09-05. **Founder chose the proper fix over shipping it.** It would hold a fail-closed guard permanently open by its own caller, and it would silently invalidate `docs/runbooks/ledger-refresh-go-live.md`'s FAST rollback ("reset the activation setting; the schedule keeps firing, the function returns 0") — a documented incident procedure that would then succeed while changing nothing. A kill switch that reports success and does not stop the thing is worse than no kill switch.

**Two mechanisms, chosen per setting rather than one-size-fits-all:** `app.analytics_service_key` is a SECRET and belongs in Vault (`vault.decrypted_secrets` — the mechanism PROD's jobid 1 was hand-repaired onto and the only one PROVEN working here); `app.analytics_service_url`, `app.admin_email` and `app.ledger_refresh_enabled` are non-secret configuration and belong in a table an operator can UPDATE, which restores the out-of-band kill switch 161.1's design depends on.

⛔ **SCOPE FENCE vs Phase 164.5.1 item (7).** 164.5.1 repairs the LIVE `match_engine_cron` `cron.job` row to match a committed manifest. THIS phase changes what the MIGRATIONS READ. They are not the same act and must not be merged: 164.5 fixes one production row, 164.7 fixes the class. 164.7 runs FIRST so 164.5's repair migration is written against the settled mechanism rather than inventing a second answer to the same question.

⭐ **CARRIED IN 2026-09-05 — `VAC04-ARMS-OBSERVE`, an OBSERVATION obligation, not a work item.** `[VAC04-ARMS-UNRUN]` (TODOS.md) records that VAC-04's three behavioural arms have never executed against the real PROD credential: the D-13 legitimate-zero branch (`scripts/prod-body-drift-check.sh:448`), the normal compare verdict, and the absurdity floor (`:608+`). PR #730 carried the credential but changed no `supabase/migrations/**` file, so the script exited at its EARLIEST short-circuit (`:198`, *"this PR changes no migration files — nothing to compare against PROD"*). ⛔ That entry FORBIDS manufacturing a migration PR to tick this off, which is why the obligation had no owner. This phase writes a genuine forward migration anyway, and in the queued order (164.1 → 164.2 → **164.7** → 164.5 → 164.6) its PR is the FIRST real chance for those arms to fire — so the obligation is to READ the result, not to create the occasion. ⚠️ If this phase's migration turns out not to change a function BODY (it may touch only cron rows and GUC readers), that is a legitimate outcome: say so explicitly and ROLL THE OBLIGATION FORWARD to Phase 164.5, whose DRIFT-04 `DROP FUNCTION` and CRON-DRIFT-01-REPAIR migrations are the backstop. Either way `.planning/WINDOWS.md` entry 25 gets its disposition from a MEASUREMENT, never an assertion. ✅ **RESOLVED 2026-09-07 — the roll-forward branch did NOT fire and this obligation is DISCHARGED.** Phase 164.7's migration `20260907130000` DID change function bodies, and VAC-04's DRIFT branch fired against the real PROD credential on BOTH ledger arms (`enqueue_ledger_refresh_for_strategies` and `enqueue_ledger_composite_refresh`), with real hashes and 15-line counts, each acknowledged by an earned `prod-body-ack:` pragma. Nothing rolls forward to Phase 164.5, and the CRON-DRIFT-01-REPAIR backstop named above has since moved to Phase 164.5.1 anyway. `WINDOWS.md` entry 25 has its measurement. ⛔ NOT in scope: `[VAC-04-ROLE]` (the zero-grant credential swap) stays unowned in TODOS by its own instruction — it changes WHICH credential is used, not whether the control works, and its entry says not to let it gate a phase.

**Success Criteria**:

1. Zero `current_setting('app.` occurrences remain in `supabase/migrations/**` outside a dated, commented lineage block — proven by a grep in CI, with a RED fixture showing the gate fires when one is reintroduced. A gate that cannot fire is this milestone's named defect.
2. Each of the 4 settings is dispositioned BY NAME with its chosen mechanism and a migration that moves it: `analytics_service_key` → Vault, `analytics_service_url` → the settings table, `ledger_refresh_enabled` → the EXISTING `system_flags` table. No setting is silently dropped.

   ⚠️ **SCOPE AMENDMENT 2026-09-07 (phase 164.7 discuss, D-04) — `app.admin_email` is ANNOTATED, not "either migrated or DELETED".** The original wording offered exactly those two dispositions; measurement at `14dc1f5e` says neither is correct. `20260407164606_perfect_match.sql:31` is not a live reader — it sits inside a one-shot `DO $$ … END $$` block that ran ONCE when the migration applied on 2026-04-07 and can never run again (no function body, no cron command, no view; `grep -rln 'perfect_match\|v_admin_email' supabase/migrations/` returns that one file). **Migrating it** would re-point code that will never execute. **Deleting it** would edit an APPLIED migration so the repo no longer describes the statements that ran against PROD — a cosmetic grep win paid for with a false permanent record. Disposition: a dated, commented lineage block, which is the exemption criterion 1 already defines, carrying the evidence that nothing reads it. ⚠️ Criterion 1's gate is a grep and a grep cannot tell a comment from a statement, so `20260408113029_cron_heartbeat.sql:113` — an `app.analytics_service_key` mention inside a `--` comment, which the ROADMAP's original "12 read sites / key ×5" census counted as a read site and which is NOT one — gets a lineage block on the same grounds. The executable census is **11 sites**, not 12.
3. ⭐ **The 161.1 activation switch is THROWN on PROD and observed working** — this phase is not done when the code changes, it is done when `enqueue_ledger_refresh_for_strategies` returns a non-zero count on a real tick and `ledger_refresh_staleness.days_since_last_return` goes DOWN for the mt5 cohort. ⚠️ A green `compute_jobs` row is NOT success: the defect 161.1 fixes wore a green badge for weeks (`process_key_long` returns DONE and leaves `strategy_analytics` untouched). Check the view, not the job.
4. The out-of-band kill switch is REAL and proven by measurement: with the schedule still registered and firing, flipping the setting makes the next tick enqueue 0 — observed, not asserted. This is the property the rejected workaround would have destroyed.
5. `docs/runbooks/ledger-refresh-go-live.md` is corrected at every step whose privilege claim was falsified — Step 1a/1b/1c and the Rollback section — and records the 2026-09-05 measurement that closes its own open question OQ-3. ⚠️ The runbook currently instructs an operator to run two statements that BOTH 42501, then verify in a new session; anyone following it today stalls at step one.
6. Three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any migration applies, per project rule. Merging `supabase/migrations/**` to `main` auto-applies to PROD.
7. `VAC04-ARMS-OBSERVE`: the SUMMARY quotes the `VAC-04 — repo-vs-PROD function body drift` step's OWN output from this phase's migration PR verbatim and names, by line reference, which branch it took. If that branch was again the `:198` short-circuit, the SUMMARY says exactly that and records the roll-forward to Phase 164.5 — it does NOT claim the arms ran. ⚠️ A green `migration-drift-check` job is not evidence: the whole point of `[VAC04-ARMS-UNRUN]` is that the job was green while the arms never executed.

⭐ **CARRIED OUT 2026-09-07 — `BASELINE-CONTENT-DRIFT`, a MEASUREMENT this phase makes and a
HAND-OFF it does not fix.** ⛔ Deliberately NOT an eighth success criterion: this phase's seven plans
were already written, checked and executing when it was found, and a criterion no plan delivers is a
phase that fails its own bar. It is recorded here because 164.7 is where it was measured and 164.7 is
what makes it worse.

**Measured at `14dc1f5e`:** `supabase/schema/baseline.sql` still contains the SUPERSEDED Lock B —
`grep -c ledger_refresh_enabled` returns **4** — and `grep -rn baseline.sql .github/workflows/*.yml`
returns **0**. Nothing in CI reads that file today. This phase's `20260907130000` migration replaces
both ledger bodies, so the committed baseline becomes staler the moment 164.7 lands.

⚠️ **Phase 164.5 criterion 2 does NOT catch this, and that is the point of the hand-off.** That gate
fails "on a one-byte change to `baseline.sql` without a matching `BASELINE.md` update" — a CO-EDIT
gate. 164.7 changes no byte of `baseline.sql`, so no `BASELINE.md` update is owed and the co-edit gate
stays GREEN while the content silently diverges from the migration chain. Co-editedness and
correctness are different properties. Booked as 164.5 criterion 8.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries CRON-DRIFT-01 (the GUC half only — the LIVE-row repair is 164.5.1), `VAC04-ARMS-UNRUN` (the OBSERVATION half only — the credential swap `[VAC-04-ROLE]` is NOT this phase's), and the 161.1 ACTIVATION human-verification item in `161.1-VERIFICATION.md`, which this phase exists to unblock — read each before planning, do not re-derive
**Depends on:** Phase 164. ⛔ **MUST run BEFORE Phase 164.5.1**, whose repair should consume this phase's settled mechanism rather than inventing a parallel one.
**Plans:** 7 plans

Plans:

- [x] 164.7-01-PLAN.md — Criterion-1 gate: `scripts/lint-app-guc.mjs` (hermetic, raw-text, exact-count lineage header + script-side allowlist), red/green fixtures, vitest pin, two steps in `sql-gate-lint`; corpus reads 12 findings / 5 files by design until plan 05 (wave 1)
- [x] 164.7-02-PLAN.md — `20260907120000`: `system_settings` (D-03) + `match_engine_cron_tick()` reading Vault + the table (D-02 as DRIFT-02), schedules nothing; vault stand-in fixture 32; 7-arm gate; types block (wave 1)
- [x] 164.7-03-PLAN.md — `20260907130000`: both ledger fan-outs re-based with Lock B as a fail-CLOSED `system_flags` read (D-01/C-03), seed FALSE; fixture 31; snapshots regenerated; pytest gates re-anchored (wave 1)
- [x] 164.7-04-PLAN.md — Re-point all 28 edit-kind twins at the superseding migration, table activation, arms A/K/L (missing row / FALSE / raising read ⇒ 0) in both ledger gates, 17/17 RED each (wave 2)
- [x] 164.7-05-PLAN.md — Floors separated both directions and pinned (46 files); five dated lineage headers + allowlist → gate 0 findings (D-04/D-05); ledger + match-engine runbooks corrected (two live ops, manifest re-capture, OQ-3 closed, #747 note); CLAUDE.md/TODOS currency (wave 3)
- [x] 164.7-06-PLAN.md — Three reviewers before the PR (D-07); ship checkpoint; VAC-04 output READ and branch named by line, ack EARNED via `--diff-bodies` (D-08); dry-run + expected `sql-tests`/VAC-08 reds read; WINDOWS 25 dispositioned (wave 4, checkpoint)
- [x] 164.7-07-PLAN.md — PROD activation as a founder `checkpoint:decision` (D-06): measured pre-flight, two live ops + view-based observation + kill-switch proof + manifest re-capture, or DEFER with the blocker named; closes the 161.1 ACTIVATION item (wave 5, checkpoint)

### Phase 164.3: VACUITY — a control that cannot fail must be caught by machine, not by red team (INSERTED)

**Goal**: A control that cannot fail is detected by a machine, on every push, instead of by a six-team red team once per milestone.
**Depends on:** Phase 164 (its measured corpus is this phase's specification).
⛔ **RESEQUENCED 2026-08-28 — this phase now runs FIRST, before 164.1 and 164.2.** Founder-approved.
The previous line read "ordered after 164.1 and 164.2 — numeric order only, no dependency on either",
and that "no dependency" is exactly what makes the move free. The direction was backwards: criterion 2
builds a real disposable PostgreSQL lane and criterion 1 builds a mutation runner, and those two ARE
the substrate on which 164.1's gate work would otherwise be hand-tested. Doing 164.1 first means
building gate machinery twice.
**Requirements**: VAC-01, VAC-02, VAC-03, VAC-04, VAC-05, VAC-06, VAC-07, VAC-08 (defined in
REQUIREMENTS.md by the 2026-08-28 discuss pass; the line previously read `TBD`)

+ **absorbed from 164.1:** SKIP-01, DRIFT-01, OPS-08-F9, OPS-08-F8, H-0001 (see the DEDUP table

under Phase 164.1 for the reasoning per item).
⚠️ SKIP-01's premise FAILED re-measurement — see the VERIFIED CORRECTIONS block in
`164.3-CONTEXT.md`. It is now VAC-08 (a drift check that joins on `name`), NOT a migration-apply lane.

**Why this exists — measured, not felt.** Phase 164 produced **five distinct vacuity mechanisms**,
and the DRIFT family alongside them. ⛔ Every single one was **GREEN in CI**, survived code review,
and was found only by executing adversarially after a red team. That is the finding: not "we write
weak tests", but **nothing in the pipeline can tell a control that holds from one that cannot fail.**
Detection currently costs a red team.

| # | Mechanism | Where it hid |
|---|---|---|
| 1 | Post-rejection probe inside a PL/pgSQL `BEGIN…EXCEPTION` — an implicit subtransaction, so the arm reads its own rollback | Found twice: removed at TRIGGER 1, survived undeclared at TENANT 5d-5g. A genuine cross-tenant write placed inside the handler moved the victim's counter **and the file went green** |
| 2 | `pg_get_functiondef` regex satisfiable by an in-body `--` comment | Migration STEP 2 arms |
| 3 | A diagnostic computing `pre + 1`, which overflowed in exactly the state it was diagnosing — the arm aborted on its own arithmetic | N1 3a / N1 1c |
| 4 | Partial bitmask: `tgtype & 16` only, so a trigger narrowed back to `BEFORE UPDATE` satisfied every remaining term and the INSERT pin could be deleted invisibly | Fixed in the migration, **still blind in the durable gate** |
| 5 | An arm made structurally unreachable by an earlier arm covering the same state — the reachable one then reported the defect as its **exact opposite** ("row is STILL LIVE" when the row was deleted) | SANITIZE 1c / 1e |

Plus the **drift** half, same root — *the claim and the thing are never compared*: `DRIFT-02`
(repo vs PROD, which nearly shipped a GDPR regression), `DRIFT-01` (TEST vs repo), `SKIP-01` (a gate
that SKIPs forever and reads as PASS), and stale comments that **argued away** the coverage which
would have caught a token-resurrection bug.

**Success Criteria** (what must be TRUE):

  1. **A mutation runner exists and runs in CI.** Arms carrying a
     `RED-UNDER: <the exact mutation that makes me fail>` annotation are machine-mutated by the
     runner, which asserts the file goes RED and then restores it. ⭐ This alone would have caught
     mechanisms 1, 4 and 5 with no human involved. It is the highest-value item in the phase by a
     distance.
     ⛔ **CORRECTED 2026-08-28 — this criterion previously read "Every arm in `supabase/tests/*.sql`
     already carries" one. MEASURED at HEAD, that is 1 file of 71** (**30** arm-anchored
     annotations, all in `test_strategy_shares_rls.sql`; a naive `grep -c "RED-UNDER"` says 33 because
     it counts the file's own header documenting the syntax at :46/:48 plus a prose reference at
     :1541 — re-measured 2026-08-29). The sentence was a claim never compared to the thing — the
     exact defect this phase exists to catch, sitting in its own spec. Do NOT plan against the old
     wording: the runner covers the annotated corpus, and **Phase 164.4 (REDUNDER-BACKFILL)** closes
     the remaining 70 files using this runner as the oracle.
     ⭐ This phase stays shippable regardless: all five measured mechanisms (`TENANT`, `TRIGGER`,
     `SANITIZE`, `STEP 2`, `N1`) live in the already-annotated file, so criterion 6 is reachable with
     the 33 annotations that exist today.
     ⚠️ The runner MUST print its coverage (files annotated / files total) on every run. A runner
     reporting PASS while silently covering 1.4% of the corpus is the same shape as `SKIP-01`, which
     is on this phase's own list.

  2. **The throwaway-PostgreSQL lane is real** — `PROC-01`'s implementation. Today it is a script under `.planning/`, written mid-phase, whose own two defects (reusing another agent's cluster then `DROP SCHEMA public CASCADE`; RLS enabled on nothing but the table under test) were found by reviewers using it.
  3. **A static linter rejects the four statically-decidable measured shapes** on new gate files (mechanisms 1, 2, 4 and a narrow 3), so a further mechanism of those kinds is a lint failure rather than a red-team finding. Mechanism 5 is **delegated** to the mutation runner's first-failure identity per D-16 — it is not decidable in SQL text, and a rule that cannot fire is the defect this phase exists to remove. Machine-pinned via the linter's `DELEGATED_MECHANISMS` export. ⭐ **UPDATE 2026-09-04 (Phase 164.4, review finding WR-03):** the linter now ships **seven** rules, not four — R5/R6/R7 close a SIXTH mechanism (a pg-lane stand-in that SHADOWS the object under test) found by hand twice during the 164.4 backfill. ⛔ This does NOT touch the mechanism-5 delegation above, and R5/R6/R7 are not "a fifth rule to round the count up": mechanism 5 is still delegated to first-failure identity, and each new rule was proven to make live contact with the real corpus by DISABLING its repair escape and counting the reds (R5=1, R6=3, R7=5 real gate files), pinned as a per-rule floor. *(Corrected 2026-08-29, gap G3 — this criterion said "five" after D-16 narrowed it; the plan line at :538 already said four.)*
  4. **No whole-body `CREATE OR REPLACE` merges without a repo-vs-PROD diff** (`DRIFT-02b`). A function that has ever been surgically patched has no true body in the repo, and "re-base on the latest definition" is unsatisfiable from files alone.
  5. **A plan's claims about the codebase are verified, not trusted.** A PLAN.md asserts line
     anchors, function signatures and RPC return shapes — and NOTHING compares them to the tree.
     Both wave-3 plans were stale when execution reached them: `164-03` specified a two-argument
     `deriveShareToken` that would have minted links failing verification (the token gained a third
     input mid-phase), and `164-04` anchored edits at `v2/page.tsx:563-573` in a file that had
     shrunk to 423 lines. Neither is catchable by review — a reviewer reads the plan against the
     plan. Both were caught by grepping the plan for what the phase had learned and re-resolving
     its anchors, which is mechanisable: resolve every `file:line` and every named symbol in a
     PLAN.md at execute time, and fail loud on a miss.

  6. ⛔ **Each of the five is demonstrated against the phase-164 corpus** — re-introduce each historical mechanism and show the new machinery catches it. A vacuity detector that has never caught a vacuity is the joke that writes itself.

**Explicitly OUT of scope:** the GSD-machinery gaps — `depends_on` yielding `blocked_by: {}` so plan
ordering is unenforced, wave frontmatter drifting from ROADMAP, and `NYQ-01`. Same smell, different
system (upstream `gsd-core`, not this repo). Mixing them in makes this unshippable. Book them
separately.

**Plans:** 9/10 plans executed

Plans:

- [x] 164.3-01-PLAN.md — Disposable-PG lane promoted (trap cleanup, PGBIN chain, free port) + SHAPE 1c tracer proof (VAC-02) [wave 1]
- [x] 164.3-02-PLAN.md — Drift family: shared normalizer, VAC-04 PROD-body step in migration-drift-check.yml (D-12/D-13/D-17), VAC-08 name-join ledger check + body assertion, OPS-08-F9 verify-and-record (VAC-04, VAC-08, SKIP-01, DRIFT-01) [wave 1]
- [x] 164.3-03-PLAN.md — H-0001: findMutations single-line detection fixed, un-skipped, re-censused, counted allowlist [wave 1]
- [x] 164.3-04-PLAN.md — VAC-07 SPIKE: 263-migration replay measured + local-stack lane with trapped teardown (D-15) [wave 1]
- [x] 164.3-05-PLAN.md — Mutation runner core: RED-UNDER-M grammar + parser + first-failure identity + both exit-1 modes + aggregation (VAC-01, OPS-08-F8) [wave 2]
- [x] 164.3-06-PLAN.md — Static vacuity linter, mechanisms 1/2/4 + narrow 3, red fixtures per rule, NO mechanism-5 rule (VAC-03, D-16) [wave 2]
- [ ] 164.3-07-PLAN.md — Phase 159 closure spec: two concurrent csv-finalize POSTs, one 2xx + one honest 409, winner holds (VAC-07, D-08) [wave 2]
- [x] 164.3-08-PLAN.md — Corpus annotation backfill (30 arm-anchored markers, measured), full run green, ARMS_FLOOR pinned, sql-mutation CI job + aggregator row (VAC-01) [wave 3]
- [x] 164.3-09-PLAN.md — Plan-anchor verifier: range + quote re-resolution over pending plans, CI seam + execute-time convention (VAC-05, D-06 own wave) [wave 4]
- [x] 164.3-10-PLAN.md — All five mechanisms re-introduced and demonstrated caught, durable via vitest pin + every-push runner (VAC-06) [wave 5]

### Phase 164.3.1: SOUND-PRIMITIVES — all FOUR cycling primitives closed by construction: neuter scan, mutation identity, VAC-04, self-referential oracle (INSERTED)

**Goal:** SOUND-PRIMITIVES — four control primitives on this branch have each re-opened FOUR times, every round closing the reviewer's EXAMPLE and then declaring the CLASS closed in code comments, in GRAMMAR.md and in the fix report. Each must now be sound BY CONSTRUCTION, not by which files happen to be annotated or which spelling happens to be in the corpus today. Scope covers all four (founder decision 2026-08-29, widened from the original two). PRIMITIVE A — an accepted neuter leaves privileged state live. Lineage WR-07 -> R2-C01 (a `--` comment containing EXCEPTION) -> R3-C01 (keyword in a string literal, block comment, dollar-quoted body) -> R4-C01, where `isBranchHead` (scripts/mutation-runner/run.mjs:322-329) has two UNANCHORED arms, so the compound line `SET ROLE postgres; IF NOT ok THEN` is accepted as structurally a branch head, the backward scan breaks, and `neuterArm` returns found:true with `SET ROLE postgres;` still live; a leaked superuser then makes every downstream GRANT arm pass for a reason unrelated to its grant. SEVEN lines of exactly this shape ALREADY EXIST in supabase/tests/test_profiles_privileged_columns_locked.sql (96/101/106/111/116/121/132), the directory phase 164.4 backfills. The round-3 fixer's disclosed line-local residual was NOT the hole; the predicate is, and a fifth regex pass will not close it. Carries [MUT-I01]: `neuterArm`'s forward scan and `statementEndLine` walk raw characters tracking only `'`, so a legal multi-line RAISE with an apostrophe inside a `--` comment returns a spurious neuter-missed, and the even-parity case over-neuters SILENTLY. PRIMITIVE B — an arm counts toward `biting` without executing. Lineage WR-03 -> R2-W04 -> R3-C02 (a split literal) -> the runtime identity nonce -> R4-C02, where the nonce is forgeable with NO file read and NO superuser: the stamped text sits in the query text of the statement the gate is running, and Postgres hands it to server-side code via current_query(). MEASURED — an AFTER INSERT trigger installed by a `sql` step scored RED (identity ok) and biting: 1 for an arm guarded by IF FALSE; the control with a constant scored NO-IDENTITY, biting 0. The real corpus already ships CREATE OR REPLACE FUNCTION RETURNS TRIGGER plus CREATE TRIGGER `sql` steps, so the capability cannot be revoked without refusing a legitimate arm; this needs a DESIGN decision about where the identity lives, not another guard. PRIMITIVE C — a gate's VERDICT is not bounded by what it actually measured, in EITHER direction. Originally scoped as "VAC-04 reports PASS having compared nothing"; widened 2026-08-30 after the mirror case shipped and was caught in this branch's own CI. VAC-08's first real run reported "253 of 262 repo migrations are not present in the TEST ledger" against a database e2e-seeded was passing on in the SAME run — a finding the gate never really measured, phrased so confidently it pointed a reader at hand-applying 253 migrations to a SHARED database. Same root cause as the PASS direction: the gate held every number needed to know its own verdict was absurd (repo total, missing count) and never compared them. VAC-08 now carries an ABSURDITY FLOOR; VAC-04 and the mutation runner do not, and that is this phase's work. Lineage WR-01 ("absent -> new function, pass" with no floor on `checked`) -> R2-W03 (the `accounted != NAME_COUNT` floor was tautological) -> ship-stage SP-C05 (the name index and the body fetcher were one code path, so `sanitize_user$v2` vanished from both) -> round 4. Members, all measured at HEAD: [VAC04-C1] the two readers' blind spots COMPOSE (the naive reader cannot see a definition that does not START a line; the lexer cannot see `$` in an identifier), so three shapes return the empty set from BOTH and the gate exits 0 printing "Two independent readings agree"; [VAC04-C2] the main-module guard `import.meta.url === file://${process.argv[1]}` no-ops on any symlinked path or path containing a space, so `main()` never runs, stdout is empty and the script exits 0 — measured with a PASSING CONTROL (plain path true, symlink false, space false) — and BOTH union members carry the identical guard, so the two "independent" derivations fail together through one mechanism; [VAC04-C3] `grep -aqxF` exit 2 (unreadable index) and exit 1 (not in index) both land in the else that prints "measured absent — Treated as a NEW function (pass)", turning the fail-CLOSED arm into a fail-OPEN one; [VAC04-C4] a non-ASCII identifier is TRUNCATED by one reader and dropped by the other, so the gate compares the WRONG function body and can report MATCH for a different subject. The unifying defect: the gate's "nothing to compare" path exits 0, so every blindness in any reader converts directly into a green gate over PRODUCTION function bodies. PRIMITIVE D — a control whose own oracle or fixture agrees with it BY CONSTRUCTION. Instances: the four vacuity mechanisms found in round 1 (including a five-row table named INDEPENDENT ORACLE whose values never reached the system under test, proven by neuter — replacing all five with garbage left 63 tests green); SP-C04, removed from local-stack-teardown-assertion.test.ts; [VAC-SELFREF-01], the SAME shape reintroduced within that same fix round at src/__tests__/lint-sql-gates.test.ts:182-186, where two assertions describe a string constant defined two lines above and cannot fail for any change to lintFile, the fixtures or the rule set; [AUDCOV-01], where all three shipped SP-I01 arms use single-line strings so the fixture agrees with the claim by construction and cannot catch the multi-line case; and [MUT-W02], where the per-job tolerance pin asserts ONE literal spelling so an equivalently-written tolerance arm widens the aggregator unseen. This primitive recurs through hand-authored test code written fast to close vacuity findings, which is why it needs a MACHINE check, not another careful pass. [AUDCOV-01] additionally carries a LIVE REGRESSION and is the one item here that must not merge as-is: the SP-I01 fix deleted the comment justifying line-leading `/*` entry and widened `unmatchedBlockOpen`, which tracks quote state per line reset at every newline, so a multi-line template literal containing `/*` opens a phantom block and blanks the rest of the file. MEASURED against the file's own real bytes: A) multi-line template with `/*` -> sites [] ; B) control without the `/*` -> sites [line 5] ; C) the shipped single-line arm -> sites [line 3]. The PRE-FIX code found site A. This makes main's H-0001 audit-coverage gate blinder than it was, unlike the rest of the branch which is incomplete-but-new. DELIVERABLES. (1) Replace the line-and-regex neuter classifier with a SQL-aware tokenizer carrying quote, dollar-quote and block-comment state ACROSS lines and classifying STATEMENTS rather than lines, and route `neuterArm`'s forward scan and `statementEndLine` through it so the file has ONE definition of what is code. (2) Move the arm identity somewhere the executing SQL cannot observe, or PROVE no server-side construct can reach it, and record which. (3) Make VAC-04's ZERO path fail closed rather than trusting agreement between readers with overlapping blind spots, and fix the three concrete members: the realpath idiom already at scripts/check-banned-packages.mjs:446 in BOTH union members, explicit exit-code branching on the name-index grep with >= 2 a hard fail, and refuse-rather-than-truncate on any identifier leaving the unquoted charset. (4) Fix the audit-coverage stripper by carrying string state across lines with quoteAtEnd forced to null for `'` and `"`, and add the three-arm table with B as the calibration control. (5) Add a MACHINE check for primitive D that flags an assertion whose subject is a constant defined in the same block, and re-express [MUT-W02] as a parse of the aggregator's branch conditions with its own non-vacuity floor. (6) A REGRESSION CORPUS carrying every measured instance across all four primitives as EXECUTABLE arms, so instance five reds in CI rather than in a review. (7) Re-derive ARMS_FLOOR and the biting count under the sound primitives and record any movement, because today's 30/30/0 is correct by SCOPE, not by mechanism. (8) DIAGNOSTIC-FIRST — every gate in this family must PRINT WHAT IT SAW when it fails, not only its conclusion. This is the strongest measured result of the 2026-08-29/30 ship: adding a shape diagnostic to VAC-08 surfaced two further ledger conventions in two CI cycles that FOUR review rounds of reasoning had missed, and reasoning is what produced the wrong join key in the first place. A failure that asserts a conclusion without showing its evidence is another unchecked claim. (9) Carry the VAC-08 instances into the REGRESSION CORPUS of deliverable (3) as executable arms — the 253-of-262 verdict and the three-convention join — so instance four of the Primitive C family reds in CI rather than in a review. Extend the absurdity floor to VAC-04 (which can still report "every function is new — pass" when its name reader breaks) and to the mutation runner (which can report arm counts it did not execute). Pick every threshold the way VAC-08's was picked — by measurement with wide separation (9/262 fires, 232/262 silent), never by taste. ⚖️ RULE, deliberately NOT a fifth primitive: where a gate's key, threshold or join is justified by a measurement, record that measurement's SAMPLE SIZE and COVERAGE beside it, and carry an arm asserting it against the FULL corpus. VAC-08's join key was validated on 12 rows and applied to 262; it was wrong for 253 of them and nothing caught it for four rounds because the gate had never executed. This shape has exactly ONE measured instance, and A-D each reopened FOUR times — promoting one instance to a primitive would inflate the taxonomy to look thorough, which is a species of the same disease. If it reopens, promote it then, with evidence. HARD DEPENDENCY: must complete BEFORE 164.4 REDUNDER-BACKFILL, which annotates ~70 files each asserting a machine proved the arm bites — against unsound primitives those are not 70 bugs but 70 FALSE ATTESTATIONS. EXCLUDES only two prose items, which stay in TODOS.md: [MUT-I02], a header denominator saying 114 migrations where there are 262, and [MUT-I03], a one-line note that concurrent agents editing the tree redden the runner's own dirty-checkout gate.
**Requirements**: TBD
**Depends on:** Phase 164.3
**Success Criteria**:

1. Every one of the measured instances across all four primitives is an EXECUTABLE arm in the regression corpus, and each is proven to RED by neutering its fix and observing the failure — a corpus entry that cannot fail is itself a primitive-D instance.
2. The neuter classifier is statement-based: the seven compound lines already in supabase/tests/test_profiles_privileged_columns_locked.sql are classified correctly, and no accepted neuter leaves `SET ROLE postgres;` live on any corpus file.
3. The arm identity cannot be produced by any SQL the gate executes — demonstrated by re-running the R4-C02 `current_query()` trigger and observing NO-IDENTITY — or the reachability proof is recorded with the constructs it covers.
4. VAC-04 cannot exit 0 having compared nothing: the zero path fails closed, and each of [VAC04-C1]..[VAC04-C4] is driven end-to-end through the real gate and observed to exit non-zero on its own measured input.
5. `stripBlockComments` finds the multi-line-template site (case A) while the B control still passes, and the machine check for primitive D flags the `lint-sql-gates.test.ts:182-186` shape at HEAD before it is fixed.
6. ARMS_FLOOR and the biting count are re-derived under the sound primitives, and any movement from today's 30/30/0 is recorded with the reason.
7. Every gate in the family PRINTS ITS EVIDENCE on failure, demonstrated by driving each one to its failure path and reading the output: the failure names what was measured (counts, keys, samples), not only the conclusion. An arm asserts this so a future gate cannot ship a bare conclusion.
8. The absurdity floor exists on VAC-04 and on the mutation runner as well as VAC-08, each proven able to fire AND proven silent on a legitimate finding — a two-directional neuter, because a floor that fires unconditionally also passes its own RED arm. Every threshold records the measurement that set it and the separation it achieves.
9. Every gate whose key, threshold or join rests on a measurement carries that measurement's SAMPLE SIZE and COVERAGE beside it, plus an arm asserting the key against the full corpus. Verified by grepping the family for justifying measurements and finding no bare ones.

**Plans:** 13/13 plans complete

Plans:
**Wave 1**

- [x] 164.3.1-01-PLAN.md — TRACER + Primitive A: statement tokenizer, neuter path routed through it (Wave 1) [SC-2]
- [x] 164.3.1-02-PLAN.md — Primitive-D AST rule REPORT-ONLY + calibration at HEAD on lint-sql-gates.test.ts:182-186 (Wave 1) [SC-5]
- [x] 164.3.1-03-PLAN.md — [AUDCOV-01] before-state calibration: A/B/C = []/[5]/[3] via extracted real bytes (Wave 1) [SC-5]
- [x] 164.3.1-04-PLAN.md — VAC-04 union readers hardened: realpath guards (C2) + charset refusal (C4) (Wave 1) [SC-4, SC-7]
- [x] 164.3.1-13-PLAN.md — GAP CLOSURE: [VAC04-C2]/[VAC04-C4] driven THROUGH THE REAL GATE (symlink/space reader paths; `fúnc_é` refusal), standing calibration legs + recorded neuters, registry `also:` gate-level bindings (Wave 1, gap_closure) [SC-4]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 164.3.1-05-PLAN.md — Primitive B: source-location attribution replaces the nonce; single-frame chain rule; verbose pg-lane (Wave 2) [SC-3, SC-7]
- [x] 164.3.1-06-PLAN.md — [AUDCOV-01] fix: cross-line quote state; A finds its site, B/C controls hold (Wave 2) [SC-5]
- [x] 164.3.1-07-PLAN.md — VAC-04 gate: grep exit branching (C3), fail-closed zero path + reopen pin, absurdity floor (Wave 2) [SC-4 PARTIAL, SC-7, SC-8, SC-9]
- [x] 164.3.1-08-PLAN.md — Primitive-D rule BLOCKING with measured allowlist; :182-186 fixed; [MUT-W02] structural parse (Wave 2) [SC-5, SC-9]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 164.3.1-09-PLAN.md — Measure-first: ARMS_FLOOR + biting re-derived under sound primitives, movement recorded (Wave 3) [SC-6, SC-9]

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 164.3.1-10-PLAN.md — Mutation-runner absurdity floor: armsExecuted vs lane invocations, printed + CI-asserted (Wave 4) [SC-7, SC-8, SC-9]

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 164.3.1-11-PLAN.md — Regression corpus A+B: four lane-driven selftest fixtures, recursive RED proofs (Wave 5) [SC-1]
- [x] 164.3.1-12-PLAN.md — Regression corpus C+D + VAC-08 instances, instance→arm registry, SC-7/SC-9 meta-arms (Wave 5) [SC-1, SC-7, SC-9]

### Phase 164.4: REDUNDER-BACKFILL — every SQL gate arm gets a RED-UNDER annotation that a machine PROVES bites (INSERTED)

**Goal**: Every arm in **the 39 idiom files the pg-lane can reach** (4 more are printed by the
runner as lane-blocked every run and a 5th under `pending:` — SCOPE AMENDMENT #2 and its 2026-09-04
ARITHMETIC CORRECTION, 100 sections owed to `[REDUNDER-PGCRON]`) of `supabase/tests/*.sql` carries a
`RED-UNDER` annotation naming the exact mutation that makes it fail, and the Phase 164.3 mutation
runner PROVES each one bites — red under its own mutation, green when restored. ✅ ACHIEVED
2026-09-04, MEASURED: `coverage: files 39/71`, `arms: 262/262/0`, `biting: 262`, 0 waivers, exit 0.
Coverage moved from 1 file to those 39 reachable files,
behind a floor that cannot regress, with the **27 excluded non-idiom files and the 4 deferred
lane-blocked files each printed by name on every run**. (Scope narrowed from "all of them" by
founder decision 2026-09-02, and again 2026-09-03 — see both SCOPE AMENDMENTs below; the rename of
the 27 is booked as `[REDUNDER-NONIDIOM]` and the 4 as `[REDUNDER-PGCRON]` in `TODOS.md`.)
**Depends on:** ⛔ **Phase 164.3 — HARD, not ordering.** 164.3 builds the mutation runner, and the
runner is the only thing that makes this phase safe to do at all.
**Requirements**: SC-1, SC-2, SC-3, SC-4 — the four success criteria below stand in for requirement IDs (no `REQUIREMENTS.md` IDs exist for this inserted phase; RESEARCH § Phase Requirements). Discussed 2026-09-02 (`164.4-CONTEXT.md`).

**Why this is its own phase, and why it CANNOT come first.** MEASURED at HEAD 2026-08-28:
`grep -rl RED-UNDER supabase/tests/` returns **1 file of 71** — 33 annotations, all in
`test_strategy_shares_rls.sql`, the file Phase 164 wrote. 164.3's criterion 1 asserts that "every arm
in `supabase/tests/*.sql` **already carries**" one. That is false by a factor of 71, and it is
false in exactly the way 164.3 exists to catch: **a claim and the thing were never compared.**

⭐ **The ordering is load-bearing, not tidiness.** A hand-written `RED-UNDER` is itself a CLAIM —
"this mutation reddens this arm". Authoring ~166 such claims at speed, by hand, is a vacuity
mechanism manufactured at scale: an annotation that does not actually redden its arm passes
silently and reads as coverage. Doing the backfill BEFORE the runner exists would be the phase
group defeating its own thesis. With the runner in CI the claim is machine-checked — a
`RED-UNDER` that fails to redden its arm **fails the build**. That single fact converts this work
from faith-based to verified, and it is why this phase waits.

⚠️ 164.3 remains shippable without this phase, and deliberately so: all five measured vacuity
mechanisms (`TENANT`, `TRIGGER`, `SANITIZE`, `STEP 2`, `N1`) live in the already-annotated file,
so 164.3's criterion 6 is reachable with the 33 annotations that exist today. This phase closes the
corpus gap; it is not a prerequisite for 164.3 being real.

⚖️ **SCOPE AMENDMENT — founder decision 2026-09-02, criterion 1 NARROWED. Read this before
planning.** Criterion 1 below originally read "every arm in `supabase/tests/*.sql`". MEASURED at
HEAD (164.4-RESEARCH.md): the corpus holds **1398 `RAISE EXCEPTION` sites across all 71 files —
zero files have none** — but only **890** use the `TEST FAILED (<arm>)` idiom the runner keys on
(`run.mjs:544`, the one identity definition at `run.mjs:947`). **27 files / 334 raises assert
through their own message prefixes** (`'MT5SRC-03 (1a): …'`, `'FLIPRETRY-02: …'`) and are
structurally unreachable by the runner.

Three options were measured and put to the founder. **Option (c) was chosen:** scope this phase to
the **39 idiom files the pg-lane can reach** (of 44 — 4 lane-blocked plus 1 `pending:`, SCOPE
AMENDMENT #2 as corrected 2026-09-04, founder 2026-09-03, `[REDUNDER-PGCRON]`), and have the runner
**PRINT the 27 excluded files BY NAME on every
run** so the gap is emitted by the gate itself rather than asserted in a ledger. Rejected: **(a)** renaming
the 27 files into the idiom — not an assertion edit (nothing external reads those strings; the
sentinel gate counts `RAISE EXCEPTION` lines at `ci.yml:2360` and `sql-tests` uses `ON_ERROR_STOP`)
but genuine *authoring*, since the 321 no-idiom raises carry only **139 distinct prefixes** (`B5b:`
heads 28) so identities must be INVENTED, not transformed; **(b)** generalising the runner's
identity grammar to a declared per-file prefix — the literal is spelled in ~150 places, it weakens
primitives 3a/3b that Phase 164.3.1 just closed, and it buys no precision because prefixes are
SHARED across arms.

⚠️ **Why this is not the v1.17 trap.** The v1.17 refusal was of a reduction that would have left
every ledger reading "usable end-to-end" while untrue. Here the exclusion is PRINTED by the gate on
every run, so no ledger can drift from what is measured. The successor rename is booked in
`TODOS.md` as `[REDUNDER-NONIDIOM]`.

⚖️ **SCOPE AMENDMENT #2 — founder decision 2026-09-03, criterion 1 NARROWED AGAIN (count, not
standard).** Of the 44 idiom files, **4 probe `pg_extension` for pg_cron** and the pg-lane
(`scripts/pg-lane/run.sh`) has none — the founder decided on 2026-09-03 NOT to install it there.
MEASURED at HEAD, and this corrects the record: `test_reconcile_dropped_enqueue_sweep.sql:268` (39
sections) and `test_retention_orphaned_running.sql:212` (25) **RAISE EXCEPTION** on the absent
extension, so their lane baseline can never be GREEN and the runner judges no arm in a red-baseline
file; `test_strategy_analytics_stuck_computing_reaper.sql:282/326/483` (29) and
`test_derive_allocator_keys_fanout.sql:159/169` (7) baseline **GREEN** but withhold whole Parts
behind a pg_cron-conditional `RAISE NOTICE`, so those arms are un-falsifiable on the lane. (The
earlier record said all of them RAISE; two do not.) CONTEXT's batch rule — *each plan lands its
files FULLY proven, no file left half-annotated* — defers all four together: **40 files / 255
sections are reachable; 100 sections are owed to `[REDUNDER-PGCRON]`.** ⛔ That 40 / 255 is
SUPERSEDED — see the ARITHMETIC CORRECTION below; the paragraph stays as the dated record of the
amendment itself.

This is criterion 4 applied, not criterion 4 waived. The runner DERIVES the four from the corpus
and prints them every run as `lane-blocked: 4 file(s) … (deferred 2026-09-03, TODOS
[REDUNDER-PGCRON])`, `sql-mutation` MEASURE_FAILs when that line is absent or when its count
disagrees with the names beside it, and — because "the pg-lane cannot host pg_cron" is a claim about
the LANE that no derivation measures — **every lane-spawning run probes the lane itself** and exits
1 with `lane-blocked-stale` the day pg_cron is available while the class is non-empty. The deferral
can therefore expire; it cannot outlive its cause. (Plan 164.4-03.)

⚖️ **SCOPE AMENDMENT #2 — ARITHMETIC CORRECTION, 2026-09-04 (plan 164.4-11).** #2's count was
**40 files / 255 sections reachable**. MEASURED at the phase's end state, it is **39 files / 252
sections / 262 twins**. Its STANDARD is unchanged and no new decision is taken here: this records
the arithmetic consequence of a founder decision already made in plan 09. A FIFTH idiom file,
`test_compute_jobs_error_kind_copy_parity.sql`, is equally un-baselineable without pg_cron — its
blocker is migration `20260826140000` in its APPLY LIST rather than its own text, so
`gateNeedsPgCron` cannot see it and the runner prints it under `pending:` instead of
`lane-blocked:` (TODOS `[REDUNDER-LANEBLOCKED-BLIND]`). The founder chose to retire
`[REDUNDER-PGCRON]` by putting pg_cron ON the lane as its own phase (164.4.1 PGCRON-LANE) rather
than work around it, so that file is owed there too. ⛔ The runner's `pending:` line therefore
names exactly ONE file at the end of this phase and must NOT be read — or made — empty;
`src/__tests__/mutation-annotation-parser.test.ts` pins it as a one-name SET for that reason.
Measured 2026-09-04: `coverage: files 39/71`, `arms: 262/262/0`, `biting: 262`, 0 waivers, exit 0.

⚠️ **The arm unit is the SECTION** (founder decision 2026-09-02): one `RED-UNDER-M` per NAMED
assertion group (`"arm":"NAME"`), NOT one per raise. Under option (c) as amended that is
**252 sections / 262 twins** across the 39 reachable idiom files (MEASURED at the phase's end
state 2026-09-04; the projection was 255 / ~265 over 40 files); the 100 sections in the 4
lane-blocked files, plus the sections of the 5th `pending:` file, are owed to `[REDUNDER-PGCRON]`
(SCOPE AMENDMENT #2 as corrected 2026-09-04). The identity unit would
have been 516 and would have pushed CI past the 20-minute split threshold.

⚠️ **The reference file does NOT meet criterion 1 today.** `test_strategy_shares_rls.sql` is one
2,602-line `DO $$` block holding 103 identities in **35 sections with only 30 twins — 15 sections
have no twin.** The "1 file fully annotated" baseline was never true. Closing those 15 is part of
this phase, not a precondition of it.

**Success Criteria** (what must be TRUE):

  1. **Every arm in the 39 REACHABLE idiom files carries a `RED-UNDER`** naming the exact mutation
     that makes it fail — arm = section, per the amendments above. The 27 non-idiom files are OUT of
     scope, the 4 lane-blocked files are DEFERRED and a 5th is printed under `pending:` (SCOPE
     AMENDMENT #2, 2026-09-03, as corrected 2026-09-04, `[REDUNDER-PGCRON]`); **the runner names ALL
     THREE sets in its output every run**;
     a silent exclusion fails this criterion just as a missing annotation does.
  2. **The 164.3 runner executes ALL of them** — each demonstrated RED under its own mutation and
     GREEN when restored. An annotation that never reddens its arm is a FAILURE, not a pass.

  3. **The coverage figure is CI output and floor-ratcheted.** A runner reporting PASS while covering
     a fraction of the corpus is the same shape as a gate that SKIPs forever and reads as PASS —
     which is on 164.3's own defect list. No silent caps: the number is printed every run.

  4. ⛔ **Any arm that cannot be given a falsifying mutation is RECORDED with its reason, never
     silently skipped.** An arm nobody can make fail is the finding, not an exception.

**Explicitly OUT of scope:** writing new gate coverage. This phase annotates and proves what already
exists; it does not add arms. New coverage is a different phase with a different risk profile.

**Plans:** 12/12 plans executed (REPLANNED 2026-09-03 after the Plan 00 spike: four pg_cron files DEFERRED by founder decision — see `[REDUNDER-PGCRON]`; end state on today's lane is **39** of 44 idiom files annotated + 4 printed as `lane-blocked:`, the 40th having been deferred to Phase 164.4.1 in plan 09)

Plans:

- [x] 164.4-00-PLAN.md — Fixture-strategy spike: stand-ins vs stubbed real chain decided BY MEASUREMENT (timeboxed to 8 stub iterations, 4.0 s/lane rule); largest file's apply list proven GREEN; F1 residual closed
- [x] 164.4-01-PLAN.md — Wave 0 runner/CI: `unreachable:` line naming the 27 excluded files, per-file `judged/annotated/waived/biting` breakdown, ci.yml MEASURE_FAIL assertions, GREEN/RED log fixtures, parse-time refusal of fixture targets with red self-test fixture (arm unit = SECTION, 355 sections / ~365 twins stated on the record)
- [x] 164.4-02-PLAN.md — Reference file: the 15 un-twinned sections of test_strategy_shares_rls.sql; ARMS_FLOOR 30 → measured (≈45); full lockstep-pin choreography rehearsed
- [x] 164.4-03-PLAN.md — Runner: DERIVED `lane-blocked:` line naming the 4 deferred pg_cron files (reconcile 39, reaper 29, retention 25, derive 7 = 100 sections) with reason + TODO id every run, CI MEASURE_FAIL + exact-set pin; `[REDUNDER-PGCRON]` mechanism corrected per file; floors unchanged
- [x] 164.4-04-PLAN.md — Batch 1: the three ledger_refresh gates (15 + 15 + 11 = 41) starting from Plan 00's PROVEN apply list; FILES_FLOOR 1 → 4, ARMS_FLOOR → ≈86
- [x] 164.4-05-PLAN.md — Batch 2: wizard_composite_members, capital_ownership_allocation_guard, create_wizard_strategy_for_key, scenario_shares_rls, strategy_keys_rls (48); FILES_FLOOR → 9, ARMS_FLOOR → ≈134
- [x] 164.4-06-PLAN.md — Batch 3: strategies_private_owner_isolation, api_keys_venue_identity_uniq, capital_ownership_column, csv_daily_returns_perkey_rls (29); FILES_FLOOR → 13, ARMS_FLOOR → ≈163
- [x] 164.4-07-PLAN.md — Batch 4: csv_finalize_atomic_fold, funding_fees_rls, allocator_equity_derived_rls, user_notes_dashboard_scope (26; derive_allocator_keys_fanout deferred); FILES_FLOOR → 17, ARMS_FLOOR → ≈189
- [x] 164.4-08-PLAN.md — Batch 5: six five-section files (30); FILES_FLOOR → 23, ARMS_FLOOR → ≈219; sql-mutation timeout re-justified from measured ubuntu wall clocks
- [x] 164.4-09-PLAN.md — Batch 6: six files (23); FILES_FLOOR → 29, ARMS_FLOOR → ≈242
- [x] 164.4-10-PLAN.md — Batch 7: the last four non-mixed files (8); FILES_FLOOR → **32**, ARMS_FLOOR → **247** (MEASURED 2026-09-04, exit 0, `arms: 247/247/0`, 0 waivers); `pending:` names **8** files — the 7 mixed ones plus test_compute_jobs_error_kind_copy_parity.sql, deferred to Phase 164.4.1. ⚠️ The 33 / ≈250 / 7 this row used to project came from an assumed six-file wave 10 that landed five. ✅ LANDED PR #742 → `75e58cb1` (v0.77.11.0), **23/23 SHA-bound green** at head `4591b17d`, `sql-mutation` run 33882082307 **464 s** on ubuntu. ⏱️ That wall clock confirms the LEGS model and not the arms model: 247 arms but 311 legs (247 + 32 baseline + 32 restore), so ≈334 s of lane time at ≈1.07 s/leg plus ≈130 s job overhead. Projected phase end — 262 arms / 340 legs ≈ **470 s ≈ 7.8 min**, inside `timeout-minutes: 15`. Plan 11 owes ci.yml the corrected formula (legs, not arms).
- [x] 164.4-11-PLAN.md — Batch 8: the seven ⚠️ mixed files (15), waivers only via founder checkpoint; end state FILES_FLOOR **39**, ARMS_FLOOR **262** (MEASURED 2026-09-04, exit 0, `coverage: files 39/71`, `arms: 262/262/0`, `biting: 262`, tallies agree, **0 waivers** — cumulative 0 across all eight arms moves), `pending: 1` naming exactly test_compute_jobs_error_kind_copy_parity.sql, 27 non-idiom + 4 lane-blocked files printed by name, final prose sweep done. ⚠️ 39 / 262 / 1, NOT the 40 / ≈265 / 0 of SCOPE AMENDMENT #2 — that predates plan 09's founder-decided pg_cron deferral, and the amendment is now corrected in ROADMAP+STATE. ci.yml's timeout projection re-derived on a LEGS model (arms + 2 × files); `timeout-minutes` stays 15. ✅ LANDED PR #743 → `3ed6919e` (v0.77.12.0), **24/24 SHA-bound green** at head `e0d05068` (`frontend`, `secret-scan`, `sql-mutation`, `sql-gate-lint`, `plan-anchor-verify` all success). Merged 2026-09-04T19:50:39Z via `/land-and-deploy`.

### Phase 164.4.2: SUBSETSPLIT — `sql-mutation` runs only the CHANGED gate files on a PR, with a scheduled full-corpus run that still enforces the floors, because `timeout-minutes` has taken its ONE allowed raise and 20 is a declared CEILING. Owner of TODOS `[REDUNDER-SUBSET-SPLIT]`, booked 2026-09-05 by Phase 164.4.1 and unowned since. NOT hygiene: when `sql-mutation` times out the job dies and EVERY SQL gate stops being enforced — those gates pin RLS, tenant isolation and ledger correctness, so the failure mode is the controls silently stop firing, which is this milestone whole subject. MEASURED TREND moving the wrong way: run 33961609382 @ 1aa8bb70 = 363 arms / 451 legs / 567 s (9.45 min); run 33973362161 @ ab0d5644 = 361 arms / 449 legs / 646 s (10.8 min) — FEWER legs, SLOWER run, ~80 s of pure runner variance. Phase 164.1.1 then added arms twice more: plan 01 measured 491 legs / ~975 s and plan 02 measured 496 legs / ~1020 s locally, both flagged in ci.yml as closer to the ceiling than any prior reading. SCOPE: (1) a runner subset mode (--changed against a base ref) in scripts/mutation-runner/run.mjs; (2) the .github/workflows/ci.yml wiring that selects it on PRs; (3) a scheduled full-corpus job that still enforces FILES_FLOOR/ARMS_FLOOR, since the subset cannot. LOCKED (164.4-CONTEXT.md): 20 minutes is the CEILING — if a MEASURED ubuntu run reaches it, the answer is this phase, NEVER a third timeout-minutes value. The split MUST BE PRINTED on every run, never silent: a subset that does not say it is a subset is the same defect class as a gate reporting PASS having measured nothing. (INSERTED)

**Goal:** `sql-mutation` stops being a job that can only get slower, and it is split BEFORE the ceiling is reached rather than under the merge pressure that would make raising it tempting. The job mutates the whole annotated SQL gate corpus on every push; `timeout-minutes` has already taken its ONE permitted raise and 20 is a DECLARED CEILING, not a dial. On a PR it must mutate only the gate files that PR CHANGED; a scheduled full-corpus run keeps enforcing the floors, because a subset cannot.

⛔ **MEASURED 2026-09-18, on CI rather than locally, and it is the reason this is booked rather than watched.** The last five green `sql-mutation` jobs ran **9m13s, 10m29s, 10m32s, 10m42s and 13m5s** against the 20-minute ceiling. That is roughly seven minutes of headroom on a corpus that grows with every phase: read by SYMBOL from `scripts/mutation-runner/run.mjs` on the same day, `FILES_FLOOR = 47`, `ARMS_FLOOR = 402`, `WAIVED_CEILING = 0`. ⛔ **THOSE TWO NUMBERS ARE STALE AS OF 2026-09-21 — re-measured BY SYMBOL: `FILES_FLOOR = 48`, `ARMS_FLOOR = 423`, `WAIVED_CEILING` still 0.** Kept above as the dated 2026-09-18 reading, because the TREND is the argument. ⛔ Do not plan against either figure: read all three by symbol at planning time, which is this file's own standing rule and which a restated constant beside it breaks four times over. Phase 164.1.1 alone added seven arms. The 13m5s reading is the one that matters — the spread between the fastest and slowest green run is nearly four minutes of pure variance, so the effective margin is smaller than the median suggests, and a timeout arrives as a RED that took 20 minutes to tell you nothing.

⛔ **THE PROPERTY THAT MUST SURVIVE THE SPLIT — it is the whole risk, and it is this milestone's own subject.** A PR-scoped subset run must never be able to report PASS having measured nothing. Two shapes, each closed by construction with a test observed RED first: **(1)** a PR touching NO gate file must emit an explicit `0 files in scope — floors enforced by the scheduled run` verdict, never a green indistinguishable from a full pass; **(2)** `FILES_FLOOR` / `ARMS_FLOOR` / `WAIVED_CEILING` must stay enforced somewhere on every merge path — a subset comparing a 3-file tally against a 47-file floor must neither fail nor be "fixed" by lowering the floor. Read all three BY SYMBOL, never from a number restated in prose, including the ones above.

**Also in scope:** whether the scheduled full-corpus run's red is ATTRIBUTABLE — it lands on no PR, so who sees it, and what makes it impossible to ignore. And whether `src/__tests__/mutation-runner-floors.test.ts` — the vitest ratchet that catches a STALE-LOW floor, the direction the runner is blind to by construction — needs a second arm for the subset path.

⭐ **SCOPE ADDED 2026-09-21 BY FOUNDER DECISION — THE SHARED-TEST MUTEX, WHICH IS A BIGGER SAVING THAN THE SUBSET SPLIT AND SHARES ITS GOAL.** Folded in here rather than opened as its own phase, deliberately: both halves are "make CI stop being slow on purpose", both edit `.github/workflows/ci.yml`, and splitting them would serialise two phases over one heavily-pinned file.

⛔ **MEASURED 2026-09-21 on real runs, not reasoned from the workflow file.** Typical green run `35576114257` (18.2 min wall), the three DB-touching jobs:

| job | WAITING on the mutex | actually working |
|---|---|---|
| `sql-tests` | **8.02 min** | 0.78 min |
| `e2e-seeded` | **6.83 min** | 7.07 min |
| `python` | 0.08 min | 7.03 min |

`sql-tests` spends **91% of its life waiting to do 47 seconds of work.** And the tail is far worse: run `35519287524` (62.2 min wall) burned **81.6 minutes of pure acquire-wait** across the three jobs — `python` 36.27, `e2e-seeded` 29.68, `sql-tests` 15.68 — because the advisory key is global across every workflow AND every run, so concurrent runs serialise against each other, not merely their own jobs.

⭐ **ROOT CAUSE, and it is not the lock.** Each job acquires the key as an early step and releases at job end, so `e2e-seeded` holds it through 7 minutes of spec execution and `python` through 7 minutes of pytest, while the genuinely exclusive work is seconds (seeding is 9s, the SQL self-tests 47s). It was written that way because the assertions were GLOBAL — "no stuck jobs exist", "the table is empty" measure other people's rows — so excluding everyone for the whole job was the only safe option. **Phase 164.9 TESTISOLATION converting those to own-row assertions is what unblocks this**, and 164.9 did NOT itself shrink the critical section.

**ORDER OF ATTACK — founder decision, and it is an ORDER, not a menu:**
1. ⭐ **PRIMARY — STOP SHARING.** Give the DB-touching jobs their own database (`scripts/pg-lane/run.sh` and the `frontend-local-stack` job are both already in this repo) so the mutex disappears and cross-run contention ends permanently, rather than being made smaller.
   ⛔ **ITS PRECONDITION IS A MEASUREMENT, NOT AN ASSUMPTION: can an ephemeral instance host the schema these jobs need?** `164.9-CONTEXT.md` flagged exactly this question and refused to answer it by assumption. Measure it FIRST; if the answer is no, that is not a reason to bend the phase, it is the trigger for (2).
2. **FALLBACK — SHRINK THE CRITICAL SECTION.** Hold the key only around seed/DDL instead of around test execution. Smaller change, attacks the measured cause, keeps the shared database.
⛔ Do NOT do (2) first because it is easier. It leaves cross-run contention — the 81.6-minute case — untouched.

⚠️ **WHAT THIS BUYS, stated so it can be FALSIFIED rather than admired:** on the typical run the critical path is `e2e-seeded` at 15.8 min, of which 6.83 is waiting; removing that contention should land the run near **11–12 min**, bounded by `sql-mutation` at 10.8 — which is the OTHER half of this phase. ⛔ If a measured post-change run does not move, the change did not work; say so and re-measure, do not re-describe.

**Requirements**: TBD — no v1.20 requirement IDs. The binding obligation is TODOS `[REDUNDER-SUBSET-SPLIT]`, booked 2026-09-05 by Phase 164.4.1 and unowned until this phase. ⛔ `WAIVED_CEILING` is 0 and has stayed 0 through two founder decisions that each took the root-cause fix over an exception — this phase must not be the one that adds a waiver.
**Depends on:** Phase 164.4
**Plans:** 5/10 plans executed

Plans:

- [x] 164.4.2-01-PLAN.md — Area E BEFORE: acquire-wait vs useful-work captured from >=5 concluded merge-push runs, with the refutation condition written down before the change exists
- [x] 164.4.2-02-PLAN.md — Area A: ONE currency implementation (`scripts/check-baseline-currency.mjs`, `--self-test` observed RED), `refuse_stale_baseline()` re-pointed at it; the gate run for real at HEAD and its refusal recorded
- [x] 164.4.2-03-PLAN.md — Area A wiring: founder regenerates the stale baseline (blocking-human), `load_baseline()` refuses a stale dump, `fetch-depth: 0` on both lane-booting jobs
- [x] 164.4.2-04-PLAN.md — Area B precondition MEASURED on a real runner: corpus DEMAND vs lane SUPPLY (`pg_net`/vault/auth/roles/pg_cron), then a blocking decision — proceed, or take DECISION C on the written refutation
- [x] 164.4.2-05-PLAN.md — Area B tracer: `sql-tests` onto the ephemeral lane with no mutex; VAC-08 rehomed to a new `test-db-drift` job that keeps the key, the wait and the gate; aggregator arms and comment currency (also completed the pre-replan plan 06's pin tasks)
- [ ] 164.4.2-06-PLAN.md — Area F (DECISION F): committed carried-migrations marker bound to the dump's sha256; the currency gate's `--replay-set` mode ("bound and name"); `run.sh up` replays the migrations newer than the dump with ledger rows, fails loud on an undeterminable set or a failing replay; lane pins and BASELINE.md re-argued
- [ ] 164.4.2-07-PLAN.md — Area D machinery (same wave as 06, file-disjoint): runner `--subset-from` mode that CAN exit 0 while `--file` still cannot, the `scope:` line, one merge-base diff exported and re-used by `scripts/sql-gate-subset.mjs`, and the floors ratchet's subset arms
- [ ] 164.4.2-08-PLAN.md — Area F CI surface + Area B close-out: currency steps renamed for the replay, clone depth by measured consumer, mutex runbook and dated CLAUDE.md corrections, then an orchestrator-read COUNTED SHA-bound green covering plan 05's PENDING criteria and plan 06's lane lines
- [ ] 164.4.2-09-PLAN.md — Area D wiring: `changed-paths` publishes the subset, `sql-mutation` narrows only on a pull request, the assert step's fence arms driven RED and GREEN on synthetic logs, and the real run's `scope:` line read by the orchestrator
- [ ] 164.4.2-10-PLAN.md — ship: the AFTER protocol for four jobs against the CORRECTED refutation clauses (a)-(d), `[REDUNDER-SUBSET-SPLIT]` closed by its mechanism with follow-ons booked (incl. the restore path's epoch-based currency), VERSION + CHANGELOG cross-checked commit by commit
- [ ] 164.4.2-11-PLAN.md — Area G (DECISION G): the lane replays the PROD objects outside `public` that the dump lacks (the `auth.users` trigger and the pg_cron registrations), extracted from the migrations, with a drift gate that fails the boot; the 8 SQL files that failed on the lane pass unedited

⭐ **Replanned 2026-09-23 for DECISION F** (plans 06–10 replace the pre-replan 06–09): the pre-replan 06's Tasks 1–2 were already done inside plan 05 and are not repeated; the pre-replan 09's AFTER protocol restated the refutation condition CONTEXT Area E struck on 2026-09-21 and now uses the corrected clauses. ⚠️ Plan 06 has a precondition: the phase branch must carry every migration the committed dump carries — merge `origin/main` (which holds `20260922120000_api_keys_sync_status_sign_in_failed.sql`) into the phase branch before wave 5.

⭐ **SCOPE ADDED 2026-09-23 BY FOUNDER DECISION (DECISION F in `164.4.2-CONTEXT.md`):** the ephemeral lane REPLAYS the migrations newer than `baseline.sql` on top of it, and prints which ones it replayed, so that a migration landing after the dump is the normal case and not a red. Without it, every migration merge would leave the lane red until the founder re-dumped from PROD, and a PR could never test its own migration on the lane. Realised by a replan of the remaining plans before plan 06 executes. Plan 05 was mid-execution and is left to finish.

⭐ **SCOPE ADDED 2026-09-23 BY FOUNDER DECISION (DECISION G in `164.4.2-CONTEXT.md`):** the lane replays the PROD objects that live OUTSIDE `public`, which the schema-only dump does not carry: the trigger on `auth.users` and the `pg_cron` job registrations (24 migrations). They are extracted from the migration files, and a check fails the boot if the lane's set drifts from what the migrations declare. Measured by plan 08's SHA-bound CI read: once the lane ACL defect was fixed, 8 of 76 SQL files still failed on the lane for exactly this reason. Plan 04's probe measured that the lane HOSTS these schemas, not that it carries the objects registered in them. Realised as a new plan, executed before plan 08's CI checkpoint is re-read.

### Phase 164.4.2.1: DRIFTOFFMUTEX — `test-db-drift` stops waiting on the shared-TEST advisory lock to do seconds of VAC-08 work, so a merge push's critical path falls back inside its BEFORE band (INSERTED)

**Goal:** A merge push to `main` is no slower than before Phase 164.4.2. `test-db-drift` (VAC-08, read-only against shared TEST's migration ledger and function bodies) stops queueing behind `python` and `e2e-seeded` for the advisory key, without weakening VAC-08's verdict and without breaking the ordering against `supabase-migrate.yml`'s `apply-test`.
**Requirements**: the Phase 164.4.2 speed goal, clauses (a) and (c) of `164.4.2-MEASUREMENT.md`.
**Depends on:** Phase 164.4.2
**Plans:** 3 plans

⭐ **Founder decision, 2026-09-24 (AskUserQuestion): "Book the phase if it holds."** It held.

⭐ **Founder decision, 2026-09-26 (AskUserQuestion): "Accept it."** On `pull_request` runs, VAC-08 in `test-db-drift` is no longer ordered against a concurrent `apply-test` or a dispatched restore (round-1 finding SFH-01 / WR-01; accepted risk AR-164.4.2.1-01 in SECURITY.md). An overlap can only produce a loud RED on a PR, never a false GREEN on real drift; merge pushes keep the schema-apply wait. Ratified as asked by the verifier's human item 2.

⭐ **Founder decision, 2026-09-25 (AskUserQuestion, Q1): "Judge by the goal."** SC-3's clause (a) is graded as a non-degenerate run-total inside or below 16m18s–18m50s; the strict below-16m18s reading is recorded per run as evidence for Phase 164.9, not as this phase's pass/fail (`164.4.2.1-CONTEXT.md` D-01).

**Evidence.** `164.4.2-MEASUREMENT.md` `## AFTER`, merge-push runs 1–5 (CI `35939061930`, `35943402509`, `35943407413`, `35957479474`, `35958026743`):
- (a) critical path: FAIL. Non-degenerate run-totals were 18m26s, 32m32s and 32m30s, against a band of 16m18s–18m50s.
- (b) `sql-tests` job: PASS, about 2m20s.
- (c) combined lock-wait: FAIL. It was 13m26s, 39m51s and 27m17s, against a band of 12m05s–14m56s.

`test-db-drift` waited up to 20m31s to hold the key for seconds of work. Phase 164.4.2 moved the wait off `sql-tests` without removing it.

## Success Criteria
1. `test-db-drift` no longer holds, or waits for, advisory key `61616158` for its read-only VAC-08 reads. Alternatively, it waits in a way that is off the merge push's critical path. The choice is recorded with its reason.
2. VAC-08's verdict is unchanged: it still reads shared TEST after `apply-test`'s schema apply, a red stays red, and a missing credential still exits 1.
3. The five non-degenerate merge-push runs after the merge meet 164.4.2's clauses (a) and (c), measured with that file's own method and bands.
4. No timeout is raised, no gate is skipped and no job leaves the `frontend` aggregator.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.4.2.1 to break down)

### Phase 164.4.1: PGCRON-LANE — put pg_cron on the throwaway pg-lane and retire the REDUNDER-PGCRON deferral (INSERTED)

**Goal:** The pg-lane can host pg_cron, so the `[REDUNDER-PGCRON]` deferral is RETIRED
rather than grown — five gate files and ~100 sections become provable, and the runner's
`lane-blocked:` class goes to 0.

**Requirements**: SC-1, SC-2, SC-3, SC-4, SC-5 — the five success criteria below stand in for requirement IDs (no `REQUIREMENTS.md` IDs exist for this inserted phase, same convention as 164.4). Planned 2026-09-04 (`164.4.1-CONTEXT.md`, `164.4.1-RESEARCH.md`, `164.4.1-PATTERNS.md`).
**Depends on:** Phase 164.4 (must COMPLETE first — 164.4's floors ratchet sequentially
across its remaining waves, and pg_cron changes lane startup cost for EVERY arm)
**Mode:** RESEARCH-FIRST
**Plans:** 6/6 plans executed

### Why this is a phase and not a plan inside 164.4

Phase 164.4 **SCOPE AMENDMENT #2** (founder) deferred 4 idiom gate files / 100 sections
because `scripts/pg-lane/run.sh` spins throwaway PostgreSQL clusters that cannot host
pg_cron: `test_derive_allocator_keys_fanout.sql`, `test_reconcile_dropped_enqueue_sweep.sql`,
`test_retention_orphaned_running.sql`, `test_strategy_analytics_stuck_computing_reaper.sql`.

Wave 10 then hit a **FIFTH** file blocked by the same substrate for a different reason.
`test_compute_jobs_error_kind_copy_parity.sql` can only be baselined with migration
`20260826140000` — the sole migration widening `compute_jobs_error_kind_check` to admit
`'orphaned'` — and that migration **hard-RAISEs `0A000` at lines 206-208** when
`pg_extension` has no pg_cron. Founder decision 2026-09-04: retire the deferral, do not
grow it.

Retiring a recorded founder scope amendment is a phase-level act, not a plan-level one;
adding it to 164.4 would silently reverse an amendment that is true as written. It also
needs its own research (below) and perturbs a timing model that was only just stabilised.

### Success criteria

1. The pg-lane loads pg_cron on **BOTH** macOS (authoring box, PostgreSQL 16.13) and
   ubuntu CI. If the two disagree, the CI job and the authoring box measure different
   corpora — which is the failure this whole phase family exists to prevent.
2. The 5 unblocked gate files are annotated and machine-proven; `FILES_FLOOR` and
   `ARMS_FLOOR` ratchet to the MEASURED values.
3. `lane-blocked:` reaches **0**, and the runner's `lane-blocked-stale` tripwire is
   EXERCISED, not merely left green. That probe MEASURE_FAILs when pg_cron is AVAILABLE
   while files remain classified — so making pg_cron available is exactly the condition
   that must be shown to fire and then be cleared.
4. `[REDUNDER-LANEBLOCKED-BLIND]` is closed deliberately. `gateNeedsPgCron`
   (`scripts/mutation-runner/parse.mjs:1043`) reads a gate file's executable text and is
   blind to its `RED-UNDER-SETUP` apply list. The defect stops MATTERING once nothing is
   lane-blocked, but the classifier is still wrong; its tripwire test must be resolved on
   purpose rather than allowed to lapse.
5. The lane stays a throwaway cluster under a scratch `--workdir`. ⛔ It must NEVER point
   at a Supabase database.

### Research first (do not plan from assumption)

- pg_cron requires `shared_preload_libraries`, which requires a cluster restart, and the
  extension must match the server major version. Availability differs between the macOS
  box and `ubuntu-latest`.
- **Measure per-lane cost before and after.** The timing model was only just stabilised at
  `mean 1.0s/lane` (ubuntu run 33854344121: 219 arms in 333 s). Every arm pays lane
  startup, so any preload cost multiplies across ~265+ arms against `timeout-minutes: 15`.
- If the measured cost is prohibitive, the fallback is a pg_cron **SHIM** providing only
  the `cron` schema and the catalog rows these five gates actually probe. Decide that from
  measurement, not assumption.

Plans:

- [x] 164.4.1-01-PLAN.md — Substrate: pg_cron preloaded on the lane's single `pg_ctl -o` start (+ `cron.max_running_jobs=0`), fail-loud when absent, scripted macOS build, ubuntu apt provisioning step, `--self-test` 6/6, and the `lane-blocked-stale` tripwire OBSERVED firing on the real corpus (committed log)
- [x] 164.4.1-02-PLAN.md — File move 1: `test_compute_jobs_error_kind_copy_parity.sql` (3) + `test_derive_allocator_keys_fanout.sql` (7) annotated and proven; floors ratcheted to the printed values; the one-name `pending:` pin re-measured as its own task
- [x] 164.4.1-03-PLAN.md — File move 2: `test_retention_orphaned_running.sql` (25); floors; lane-blocked pinned at 2
- [x] 164.4.1-04-PLAN.md — File move 3: `test_strategy_analytics_stuck_computing_reaper.sql` (29, NOTICE-skip shape — zero skip lines measured); floors; lane-blocked pinned at 1
- [x] 164.4.1-05-PLAN.md — File move 4: `test_reconcile_dropped_enqueue_sweep.sql` (39); `lane-blocked: 0`, tripwire CLEARED (full run exit 0 with probe AVAILABLE); end-state floors; empty sets pinned with AIMs
- [x] 164.4.1-06-PLAN.md — Closure: `[REDUNDER-LANEBLOCKED-BLIND]` closed deliberately (text-only classifier documented + calibrated), honest runner prints, ubuntu measurement via `workflow_dispatch` (apt source, version, wall clock), ci.yml DECISION block updated by the MEASURED rule, docs currency

✅ **PHASE COMPLETE 2026-09-05.** End state MEASURED on BOTH platforms, identically:
`coverage: files 44/71`, `arms: 361/361/0`, `biting: 361`, `lane-invocations: 361`
(the two independent tallies agree), `pending: 0`, `lane-blocked: 0`,
`lane-probe: pg_cron AVAILABLE`, `No defects`, exit 0. `FILES_FLOOR` 44, `ARMS_FLOOR` 361,
`WAIVED_CEILING` **0** with ZERO waivers corpus-wide — the record survived four separate
opportunities to break it. ubuntu proof: run **33973362161** @ `ab0d5644`, `sql-mutation`
success in 646 s, `PGBIN the lane will boot: /usr/lib/postgresql/16/bin`, pg_cron 1.6.2-1 from
noble/universe. Verification: PARTIAL -> PASS once SC-1 was re-measured at the shipping tree
(`164.4.1-VERIFICATION.md`).

⚠️ **THE SECTION COUNTS IN THE PLAN ROWS ABOVE ARE THE AS-PLANNED FIGURES AND ARE NOW WRONG.**
Measured at close: plan 03's file is **24** sections (not 25), plan 04's **28** (not 29), plan 05's
**37** (not 39). The rows stay as dated lineage. Three arms were RECLASSIFIED — their
`TEST FAILED (` identity removed, kept as named INVARIANTs — after being MEASURED to have no
first-failure mutation, and two more had gate-self twins replaced by production ones. None was
waived. `ARMS_FLOOR` therefore moved DOWN twice, 363 -> 361, because those arms were never
proven against a production regression.

⚠️ **`test_reconcile_dropped_enqueue_sweep.sql` is the most contested file in the phase** — its
twins were revised in THREE successive review rounds, each finding real defects in the previous
round's work (one Critical, then two more arms of the same class, then a step-count pin). Treat any
"no production mutation can reach this" sentence in a gate as UNPROVEN until a lane says otherwise;
that exact sentence was refuted three times here.

⚠️ Execution shape (planner, 2026-09-04): plans run strictly sequentially (one wave each — the floors ratchet). Between plan 01's commit and plan 05's, every full runner invocation on a pg_cron-equipped host exits 1 with exactly one defect, `lane-blocked-stale` — that IS success criterion 3's tripwire firing, each such commit carries a `TRIPWIRE-RED:` line, and the branch must not be pushed or shipped until plan 05 lands (main only receives the squash-merged PR head). `CREATE EXTENSION pg_cron` comes from the real migration `20260513094906_enable_pg_cron.sql` in each gate's apply list, never from a fixture or a lane bootstrap. Section counts above are the runner's own derivation (103 total); every floor is written from the run's printed lines, never from these numbers.

### Phase 164.1: PROD-OBSERVABILITY — one periodic prober, four targets: the analytics service-key mismatch (PYAPI-06), the async cron HTTP result (CRON-OBS-01), PROD cron-job drift (CRON-DRIFT-01) and the MT5 round-trip (MT5-WEDGE-OBS-01) — every silent production failure in scope becomes loud (INSERTED)

**Goal:** One periodic prober that fails loud on the four places production has been MEASURED broken while every instrument read green. (1) PYAPI-06, BOTH halves: `src/lib/analytics-client.ts:466` omits the service-key header silently when the env var is absent, and `analytics-service/main.py:825` discards the absent-header case instead of rejecting it — a production key mismatch ran with every guarded route refusing and nothing alarming. (2) CRON-OBS-01: `net.http_post` is ASYNC, so `cron.job_run_details` reads `succeeded` for ENQUEUING; PROD jobid 1 returned 401 hourly for 7 days behind a green history. The result lives in `net._http_response` and nothing reads it. (3) CRON-DRIFT-01: nothing compares PROD `cron.job` against the repo; the oracle must be what is ACHIEVABLE on Supabase (Vault), not the `20260408215026` GUC design, which returns 42501 and could never have run here. (4) MT5-WEDGE-OBS-01: a probe that round-trips MT5 (not a port check, not `/health`) and distinguishes `-10004` (bridge not attached) from `-10005` (bridge attached, terminal not answering — the modal-dialog wedge that survives redeploys via the persistent volume). One mechanism, four targets; plan it as one prober, not four slices. A probe that SKIPs on an absent credential is the defect, not the fix.

⛔ RE-PARTITION 2026-09-05 (founder-selected, `.planning/164-FAMILY-REPARTITION.md`): this phase LOST its gate-hygiene half. Frozen-spine gate retirement is DROPPED (the 164-02 `/scenario/i` narrowing is the done slice). The advisory-lock concurrency test → **164.5 BASELINE-SNAPSHOT** (it is VAC-07's spec on the new lane). Composite-stamp twin (TS half), OPS-08-TS, OPS-08-F2, OPS-08-F8, OPS-08-F9, PROC-02, PROC-03 residual, H-0001 residual → **164.6 GATE-HYGIENE**. 161-ERRPREFIX → **164.2 CURATED-COPY** (it is a sentence a user reads). PROC-01 and PII-01 are closed/decided and leave the roadmap. SKIP-01, DRIFT-01 were 164.3's and shipped there. The DEDUP tables and carried-in item statements below are retained as dated lineage; the owner column above supersedes them where they disagree.

**Success Criteria**:

1. ONE prober covers all four targets and exits NON-ZERO on: a missing or mismatched analytics service key (PYAPI-06), a non-2xx row in `net._http_response` for a pg_cron-issued request (CRON-OBS-01), PROD `cron.job` drift from the repo's achievable configuration (CRON-DRIFT-01), and MT5 `-10004` or `-10005` (MT5-WEDGE-OBS-01). Proven PER ARM by removing that arm's credential or injecting that arm's fault and observing the non-zero exit — never a SKIP. A SKIP on an absent credential fails the criterion.
2. PYAPI-06 is closed at BOTH halves, each with a test that fails when its guard is removed: `analytics-client.ts` refuses to send a guarded request without the header (loud, not silent omission), and `main.py` rejects an absent header with a code distinct from a wrong header.
3. The MT5 arm reports `-10004` and `-10005` as DIFFERENT failures with different remedies, tested per state. An arm that reports them as one failure has not met this.
4. CRON-DRIFT-01's oracle is what is achievable on Supabase (Vault-backed `cron.job` command), not the 42501 GUC design; drift fails loud; the comparison is recorded so the next reader knows which side moved.
5. No item that was listed in this phase before 2026-09-05 is silently dropped: each is either closed here with measured evidence or named in the re-partition block above with its new owning phase (164.2 / 164.5 / 164.6) or its DROPPED reason.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries PYAPI-06, CRON-OBS-01, CRON-DRIFT-01, MT5-WEDGE-OBS-01 — read each entry before planning, do not re-derive
**Depends on:** Phase 164, and now **Phase 164.3** (see DEDUP below — 164.3 builds the substrate this phase's gate work is tested on)
**Plans:** 6/6 plans complete

⛔ **DEDUP 2026-08-28 — five carry-overs LEFT this phase, three MOVED to 164.2, one DECIDED inline.**
Founder-approved. Before this, ten items were listed here and five of them were ALSO claimed by
164.3's success criteria — the second such overlap in this phase group (the 164.1↔164.2 one is
flagged below). An item claimed by two phases gets built twice or by neither.

| Carry-over | Now owned by | Why |
|---|---|---|
| SKIP-01, DRIFT-01 | **164.3** | 164.3's own thesis names both in its "drift half", and its criterion 2 (throwaway-PostgreSQL lane, `PROC-01`) removes the pre-apply state and the older mirror at the root. |
| OPS-08-F9, OPS-08-F8 | **164.3** | Criterion 1's mutation runner walks every `RED-UNDER` arm in `supabase/tests/*.sql`; a sentinel-free file and a first-failure-truncated loop are the same defect it exists to catch. |
| H-0001 | **164.3** | A coverage gate blind to an idiom IS one of the five measured vacuity shapes (criterion 3). |
| WR-06-UTC, HONEST-08-RESIDUAL | **164.2** | Both are user-facing rendered truth, which is 164.2 CURATED-COPY's subject, not gate integrity. |
| WIZFORM-02 (`code: UNKNOWN`) | **164.2** | Same reason — a failure sentence the user reads. |
| PII-01 | **decided inline** | `13-REVIEWS/` deleted forward; history retains them and that limit is recorded. No build work, so it needs no phase. |

⛔ **SKIP-01 shape ruled 2026-08-28: NOT option (a).** TODOS offers (a) apply `supabase/migrations/**`
to TEST in CI or (b) expire the pre-apply SKIP. (a) was recommended and is **WITHDRAWN**: it changes
what `sql-tests` may do to a shared database that has no worker and is already contended, and 164.3's
disposable per-run cluster replaces that machinery anyway. Building (a) first means building it twice
and taking shared-database risk in between.

⭐ **ADDED 2026-09-01 — two production-observability blind spots, both measured live.** Routed
here rather than to 164.3/164.3.1 on purpose: those own **gate integrity** (a control that cannot
fail), these are **production observability** (a service that is down while every instrument reads
green). This phase already owns that class — its title names the PYAPI-06 blind spot that let a
production service-key mismatch run silently. Full statement, measurement, and root cause for each
live in root `TODOS.md`; read the entry before planning, do not re-derive.

- ⛔ **[CRON-OBS-01] Nothing watches `net._http_response`.** `net.http_post` is ASYNC, so pg_cron
  logs `succeeded` for ENQUEUING and never sees the status code. Measured live: PROD jobid 1
  returned **401 hourly for 7 days** (ids 3479-3484) behind a green `cron.job_run_details`. Every
  other alarm is structurally blind — `/health` skips `SERVICE_KEY`, and a 4xx never trips the
  140.2 breaker. Needs a periodic check that fails loud on non-2xx, counted and surfaced.
  ⚠️ Ships with **CRON-DRIFT-01** (nothing compares PROD `cron.job` against the repo's
  migrations — `VAC-04`'s shape applied to `cron.job`, which has no equivalent). ⛔ The GUC design
  in `20260408215026` is UNRUNNABLE on Supabase at all (`ALTER DATABASE … SET` on a custom
  placeholder GUC needs superuser, returns 42501), so any gate must compare against what is
  ACHIEVABLE, not what the migration says. Vault is the working mechanism.

- ⛔ **[MT5-WEDGE-OBS-01] Nothing probes MT5.** A user-facing key-connect outage ran with Railway
  reporting the service healthy, `/health` green (it never touches MT5), and the gateway logging
  `accepted … welcome … goodbye` with no ERROR line. The only instrument was a human clicking
  connect, and it told them `KEY_NETWORK_TIMEOUT` — "your broker is slow". Needs a probe that
  actually round-trips MT5 (not a port check, not `/health`) and fails loud on `-10005`/`-10004`.
  ⚠️ Root cause 2026-09-01 was a **modal login dialog** blocking `terminal64.exe`'s message loop;
  it survives redeploys because the Wine prefix is on a persistent volume. The probe must therefore
  distinguish "bridge not attached" from "bridge attached, terminal not answering" — the two states
  have different remedies and `-10005` alone identifies neither.

⭐ **These two are ONE mechanism with two targets** — a periodic prober that fails loud — and should
be planned as such, not as two unrelated slices.

⚠️ **Both inherit this phase's anti-silent-skip discipline (`SKIP-01`'s):** a probe that SKIPs when
its credential is absent is the defect, not the fix. Absent credential must go loud.

**Cross-phase note from Phase 164 planning (2026-08-26):** the phase-29 frozen-spine migration
guard's `FORBIDDEN_MIGRATION_RE` is narrowed IN PHASE 164 (plan 164-02, founder ruling) from the
two-alternative substring to `/scenario/i` — the guard's own locked set (`scenario_shares`,
`get_shared_scenario`, `create_scenario_share`) all match it, and the second alternative
false-positived on `strategy_shares`. When 164.1 retires frozen-spine gates, treat that narrowing
as the already-done 164 slice — do not edit the same guard a second time with a second rationale.

**Carried in from Phase 163 (routed 2026-08-26).** Each item's full statement, measurement, and
the reason it was NOT fixed in 163 live in root `TODOS.md` — the single source of truth. Do not
re-derive them here; read the entry before planning.

- ⛔ **[SKIP-01] Nothing applies migrations to TEST, so the OPS-08 SQL gate SKIPs permanently.**
  Measured live 2026-08-26: `supabase-migrate.yml` targets the PROD ref only; `sql-tests` has no
  migration-apply step; TEST therefore sits in the gate's *true pre-apply* state (pre-fix body,
  no marker comment) — the one state the gate deliberately waves through. **The de-stricted body
  live on PROD is executed by no test, anywhere.** Fix (a) apply migrations to TEST before
  `sql-tests` — this closes **DRIFT-01** too, same root cause — or (b) make the pre-apply arm
  expire so a permanent SKIP goes loud. ⚠️ (a) touches a shared, contended, worker-less database;
  not a one-line CI edit. ⚠️ Generalises: ANY migration self-check that tolerates pre-apply is
  permanently silent on TEST.

- **[OPS-08-TS]** The SQL half of OPS-08 raises `serialization_failure` (40001); nothing in `src/`
  branches on it. Measured at HEAD 2026-08-26: zero non-test hits. A lost race still answers a
  blanket 500. Fix: retry once at the enqueue call sites (allocator holdings sync, csv-finalize).

- **[OPS-08-F2]** Both pg_cron fan-out paths catch `WHEN OTHERS` around the enqueue and report
  success, so a tick UNDER-COUNTS silently. Pre-existing. Fix: surface a non-zero failure count.

- **[OPS-08-F9]** `test_enqueue_internal_destrict.sql` has no `ALL N ARMS EXECUTED` sentinel — any
  arm can be neutered and the file still exits 0. ⚠️ Not free-standing: needs `SENTINEL_FLOOR`
  7→8 and `ARMS_FLOOR` 63→68 in `ci.yml` plus the derivation entry in
  `ci-anti-skip-gate.contract.test.ts`, in ONE diff.

- **[OPS-08-F8]** The `sql-tests` loop exits on first failure, so one expected-red file suppresses
  ~40 of ~70 others. Fix: aggregate failures, or make expected-red a per-file declaration.

- **[WR-06-UTC]** `series_end` is day-granular; a row stamped with a future UTC date renders
  "ends in the future". ⛔ Must fix `bucketSeriesAge` (`src/lib/freshness.ts`) and `bucketByAge`
  (`FactsheetView.tsx`) in ONE commit — half-fixing manufactures a new two-surface contradiction.
  ⚠️ The VIEWER's timezone is irrelevant (both sides are absolute instants); the offset enters on
  the write side. LATENT on PROD — census 2026-08-26: 20 strategies with a series, **0**
  future-dated. The regression test must SEED the future-dated row; a browser sweep proves nothing.

- **[DRIFT-01]** TEST runs an **older revision** of `_enqueue_compute_job_internal` (corrected
  2026-08-26 — not a comment-stripped copy: PROD stripped = 3172 chars vs TEST raw = 3093), so no
  CI run exercises the migration gate's comment-strip. Root cause is now known: TEST is
  `db push`-ed, with duplicate applications in its ledger. Subsumed by **SKIP-01** fix (a).

- **[H-0001]** `findMutations`' single-line `from(...).insert(...)` regex is blind at **6** known
  call sites (re-measured 2026-08-26 — the count grew, it was not just stale line numbers). Fix
  the detection, un-skip the intended-behavior test in `audit-coverage.test.ts`, re-run the census.

- **[161-ERRPREFIX]** (founder ruling 2026-08-26) `KeyPermissionBadge.tsx:140` renders
  `err.code ? `${err.code}: ${message}` : message`, so a founder with a broken key reads
  `KEY_UNDECRYPTABLE: This stored key can no longer be decrypted…`. RULED: **split** — prose to the
  user, structured code to the log and Sentry breadcrumb. ⚠️ CLASS change: the same site emits other
  codes (PROBE_BACKEND_UNAVAILABLE…), so branch the class, not the one string. The prefix was
  deliberate (comment at :137-138, support-ticket greppability) — preserve that property in the logs.

- **[HONEST-08-RESIDUAL]** The shipped staler-of-two badge is verified live on PROD, but both
  visible rows bind to the series arm, so "correct staler-of-two" and "always binds to series"
  are not yet distinguished. `FreshnessChip`'s own comment warns over-binding would delete the
  sync copy everywhere. Prove the sync arm still renders, using a published row with a fresh
  series (one exists — newest series end is 1 day old — but not on the `crypto-sma` cohort).

- **[PII-01]** Decide whether the `13-REVIEWS/` AI-review payload artifacts stay tracked (5
  occurrences of a personal address, public repo, no ongoing consumer). Deleting forward does not
  remove them from history — that limit is deliberate and stands. If kept, record the decision.

**Carried in from Phase 164's red-team (routed 2026-08-27).** Six red teams plus a synthesizer
found that ~13 of 17 items in the 164 corpus were **caused by the workflow, not by the domain**
(`SYNTHESIS.md` §7). The founder adopted three of the eight proposed process changes and declined
the fourth (a `gsd-plan-checker.md:752` change — upstream gsd-core, not ours to fork). These are
the adopted three. They are **process standards, not features**: each one is a gate that would have
caught defects this phase spent 39 commits and three fix rounds failing to close.

- ⭐ **[PROC-01] A runnable throwaway PostgreSQL instance BEFORE authoring, and its run output in
  the plan.** Root cause of every `[M]`-severity finding in the corpus (R1, R2a, R2b, R2b′, R3, N1,
  N2). A 456-line migration and a 536-line SQL gate were authored, committed, declared done, and
  reviewed by three specialists with **zero executions** — the executor's own words were "NOT RUN
  — no local psql run was attempted", and the plan's `<automated>` block was English prose. Every
  one of those seven defects was later found on an ad-hoc cluster that exists in no plan, no skill
  and no CI lane. Fix: an `initdb`/docker script plus one CI lane, and a PLAN rule that a migration
  task's `<automated>` block must be a **command**, not a sentence. ⛔ Do not conflate with
  **SKIP-01** — that is about applying migrations to TEST; this is about executing them *anywhere*
  before review. Both are needed; neither substitutes for the other.

- ⭐ **[PROC-02] Reviewers must declare execution status, and UNEXECUTED blocks.** `gsd-code-reviewer`
  is read-only **by construction**, and nothing in the loop ever said so out loud — so three clean
  reviews of a never-executed migration read exactly like three clean reviews of a tested one. This
  is the cheapest item in the corpus (one agent-prompt field) and it is what would have surfaced
  PROC-01 at review time instead of at red-team time.

- **[PROC-03] Per-arm `RED-UNDER` annotation in SQL gate files.** Every assertion arm states, inline,
  the single mutation that makes it fail. Already applied by hand across
  `test_strategy_shares_rls.sql`'s 101 arms during 164's fix rounds — this routes the *convention*
  so the next gate file is born with it. Directly serves the founder rule that **a test that cannot
  fail is worse than none**: two structurally-unfailable arms were found and deleted in 164 (a
  post-rejection mutation probe inside a PL/pgSQL `BEGIN…EXCEPTION` implicit subtransaction, and a
  `pg_get_functiondef` regex satisfiable by an in-body `--` comment).

⚠️ **Explicitly NOT adopted** (founder, 2026-08-26): the "paths not facts" change to
`gsd-plan-checker.md:752`, and Team 6's remedy #9 (redesign `strategy_shares` as an insert-only
generations table with the current state as a view). #9 would close R1/R2a/R2b/R3/N2 *by
construction* and is recorded as the better design — it was declined on cost, and because the
per-row nonce buys ~90% of its benefit today on an empty table. If this table is ever redesigned,
start from `SYNTHESIS.md` §6 remedy 2.

Plans:

- [x] 164.1-01-PLAN.md — TRACER: prober skeleton (run.mjs + seams.mjs), ARMS_FLOOR=4, credential-absent gate, absurdity floor, PYAPI-06 arm, --self-test 13/13 (wave 1)
- [x] 164.1-02-PLAN.md — PYAPI-06 both halves: SeamConfigError before the fetch (TS) + SERVICE_KEY_ABSENT 401 (Python), vocabulary disposition, neuter→RED→restore proofs (wave 1)
- [x] 164.1-03-PLAN.md — CRON-OBS-01 + CRON-DRIFT-01 arms: psql seam, net._http_response time-window join, committed-manifest compare with both readings, --capture-manifest, --self-test 32/32 (wave 2)
- [x] 164.1-04-PLAN.md — MT5-WEDGE-OBS-01 arm: railway ssh seam, committed read-only probe, -10004 ≠ -10005 with distinct remedies, floor met at 4/4, --self-test 42/42 (wave 3)
- [x] 164.1-05-PLAN.md — prod-prober.yml (hourly, own workflow, hard-fail credentials, self-test-then-live, pinned Railway CLI, dedup'd issue, capture-manifest mode) + vitest wiring pin (wave 4)
- [x] 164.1-06-PLAN.md — SHA-bound dispatches: capture + commit the PROD cron manifest, live four-arm read, D-20/D-18 measurements, TODOS closure, criterion-5 ledger, founder posture decision (wave 5, checkpoints)

### Phase 164.1.1: PROBERCADENCE — the prober's detection latency is measured and alarmed from a scheduler that cannot silently drop it (INSERTED)

**Goal:** Give the prod-prober a detection latency that is MEASURED and ENFORCED, rather than declared and silently not delivered.

⭐ **The prober is not broken. It is LATE, and nothing measures its lateness.** Phase 164.1's five success criteria are all independently verified, its two PYAPI-06 guards are calibration-tested (neutered, observed RED, restored byte-identically), and the instrument has already caught two real production defects — an MT5 `-6` auth failure and a real cron 500 (GitHub issue #773). What follows is about WHEN it looks, never about WHETHER it can see.

⛔ **MEASURED 2026-09-18, twice independently (verifier and orchestrator, identical figures).** `.github/workflows/prod-prober.yml:65` declares `cron: "0 * * * *"`. Over a 273.4 h window GitHub delivered **75 of 273 expected runs — 27 %**:

| | value |
|---|---|
| delivery | 75 / 273 = **27 %** |
| median gap | **3.28 h** |
| max gap | **7.13 h** |
| gaps over 6 h | **2** |

⭐ **The number that makes this a defect and not a grumble** is in the workflow's own header comment, three lines above that cron, written by Phase 164.1 to justify choosing hourly: *"a 401 is caught within one tick. A 6-hourly cadence would leave a 6h blind window on the exact defect that ran 401 for seven days behind a green cron history."* The delivered worst case is **7.13 h** — the phase is running the cadence it explicitly ruled out as unacceptable, and worse. Nothing in the repo noticed, because nothing looks.

⛔ **A GitHub-hosted watchdog cannot close this, BY CONSTRUCTION.** If GitHub drops the prober run it drops the watchdog run too; the observer would share the failure mode of the observed. The observer must live where a scheduler that actually fires does — **PROD's own `pg_cron`**, which is hourly, reliable, and is the very thing the prober exists to watch.

⚠️ **Do not "fix" this by shortening the cron.** `*/15 * * * *` under the same throttling yields more attempts, not a bounded gap, and it buys a louder claim rather than a measured one. The deliverable is a CEILING that fails loud when crossed, not a hopeful interval.

**Success Criteria**:

1. PROD records last-prober-contact on every arm run, and the record is written by the PROBER itself — not inferred from GitHub's API, which is the surface that already lies about cadence.
2. A PROD-side check fails loud when the contact gap exceeds a stated ceiling. The ceiling is a MEASURED number with its sample and date written beside it, never a round one chosen because it looks tidy.
3. The alarm is proven to fire: observed RED with a stale/absent contact row and GREEN with a fresh one. ⛔ A staleness gate that has never been seen red is exactly the vacuity class this milestone ranks above ordinary correctness.
4. `.github/workflows/prod-prober.yml`'s header comment stops claiming "within one tick". It states the measured delivery rate, the date, and points at this phase — the false claim is corrected at the site that makes it, not only in planning prose.
5. The alarm's own reachability is stated honestly: name what happens if PROD `pg_cron` itself stops, and either cover it or record it as an accepted, named residual. ⛔ Do not leave an unexamined turtle at the bottom.

**Requirements**: TODOS entry `[PROBER-CADENCE-UNDELIVERED-01]` — this phase is its named owner.
**Depends on:** Phase 164.1 (the prober it observes), Phase 164.7 (the settled Vault-backed `cron.job` mechanism any new PROD cron row must consume rather than invent a second answer to)
**Plans:** 4/6 plans executed

⛔ **Criterion 4 is ALREADY MET** by commit `126517a8`, which corrected the workflow header at its own
site. Plan 03 pins it with a calibrated test and does NOT re-edit it — re-deriving the figures would
risk stomping correct language with a restatement that drifts.

⚠️ **Two findings the research surfaced that the plans dispose of explicitly, per criterion 5's
spirit.** (1) The stale-alert sentence on `public.cron_runs` describes an automated alert nothing
implements: `latest_cron_success()` has ZERO programmatic callers and one real MANUAL reader. Plan 01
keeps the function and corrects the claim at its own site, so the schema carries one automated monitor
and one documented admin point query rather than two unexplained answers. (2) Nothing in this
repository watches PROD `pg_cron`'s own liveness, so the observer shares one level up the failure mode
it guards. Plan 05 books that as an ACCEPTED, NAMED residual (`[PGCRON-LIVENESS-UNWATCHED-01]`),
reachable from both TODOS.md and the runbook.

⛔ **The live `cron.schedule(...)` is a runbook-driven, founder-gated op, never a migration** — this
repo's settled convention (Phase 164.5.1's PROD session is the precedent). The
`scripts/prod-prober/cron-manifest.json` re-capture is a STEP OF THAT SAME SESSION: a job registered
without the manifest moving makes the prober's own `cron-drift` arm correctly report a fresh
regression this phase caused.

Plans:

- [x] 164.1.1-01-PLAN.md — TRACER: one prober run's contact reaches a PROD-side ceiling verdict end to end. The forward migration creating `public.prod_prober_cadence_check()` with the derived ceiling and the corrected table comment, the prober's unconditional contact write, a lane `net` stand-in so the alarm's post is OBSERVED rather than inferred, the matched pair (stale ⇒ posts / fresh ⇒ silent), and both mutation floors moved from a measured run. (wave 1)
- [x] 164.1.1-02-PLAN.md — The five arms a green pair can hide: an ABSENT contact row read as healthy, a fresh row under another `cron_name` masking the prober's silence, the observer's own liveness row, the second destination layer, and a post built over a NULL key. `ARMS_FLOOR` re-measured. (wave 2)
- [x] 164.1.1-03-PLAN.md — CHECKPOINT: is `SENTRY_DSN` set on the Railway analytics-service? The alarm's last hop is decided by measurement, not inference. Plus the calibrated criterion-4 pin. (wave 1, `autonomous: false`) — DONE 2026-09-18: `SENTRY_DSN` IS set (option `a-sentry-already-set`, founder-measured), criterion 4 pinned with an observed-RED calibration twin, `.github/workflows/prod-prober.yml` byte-unchanged. Commits `9a1b0a8b`/`3ce0d461`.
- [x] 164.1.1-04-PLAN.md — The alarm's far end: one guarded `/api` route in analytics-service implementing the escalation the checkpoint recorded, with every load-bearing behaviour observed RED under a neuter. (wave 2)
- [x] 164.1.1-05-PLAN.md — `docs/runbooks/prod-prober-cadence-go-live.md` (blast radius, blocking pre-flight, the statement, the same-session manifest re-capture, rollback) and criterion 5's named residual. (wave 3)
- **SHIPPED 5/6 as v0.77.51.0 (2026-09-18).** Two workflow deviations taken and recorded in `164.1.1-CONTEXT.md` `<deviations>`: **D-SHIP-01** the ship-note omits the CI skip trailer `ship.md`'s `track_shipping` step would have written (CLAUDE.md forbids it; a squash carries it into `main`), and **D-SHIP-02** the `verification.status` gate was WAIVED, not satisfied — VERIFICATION.md needs Plan 06, Plan 06 needs this migration applied, and the migration applies on merge. VERIFICATION.md is owed the moment Plan 06 executes.
- ⛔ **PLAN 06 IS BLOCKED ON A BASELINE REGENERATION, not just on the merge.** `sql-gate-lint` is blocking in the `frontend` aggregator and `baseline-content-drift` reports `SNAPSHOT_MISSING prod_prober_cadence_check` until `baseline.sql` is regenerated from PROD after the apply. Main CI therefore stays red, and `ci.yml:2205` records what that costs: Railway SKIPS the analytics-service deploy when main CI is red — so the alarm's last hop route does not reach PROD. Required order: merge → migration applies → regenerate baseline → main green → route deploys → THEN plan 06. Booked as `[BASELINE-REGEN-164.1.1]`.
- [ ] 164.1.1-06-PLAN.md — The live PROD session behind a decision checkpoint: register, re-capture the manifest in the same act, observe the first tick, record it auditably, close `[PROBER-CADENCE-UNDELIVERED-01]`. (wave 4, `autonomous: false`)

### Phase 164.1.1.1: LANEONLYGATES — sql-tests must not run gates that require a pg-lane-only fixture, and the exclusion must be impossible to grow silently. MEASURED DEFECT shipped in PR #815 and RED ON MAIN (run 35347643700, merge eec8a659): supabase/tests/test_prod_prober_cadence.sql fails under sql-tests with ERROR relation net._lane_posts does not exist at :645. That table is the pg-net stand-in from scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql, whose own header says NEVER APPLIED TO TEST OR PROD — it exists only inside the throwaway pg-lane cluster. But sql-tests globs supabase/tests/test_*.sql unconditionally, so the gate passes on the lane (sql-mutation SUCCESS, mutation-covered there) and CANNOT pass on shared TEST, permanently. NOT hygiene: sql-tests is BLOCKING in the frontend aggregator and ci.yml:2205 records that Railway SKIPS the analytics-service deploy while main CI is red, so this red is what prevents POST /api/prober-cadence-alert (shipped in #815) from reaching production. SAFETY, and it forbids the lazy fix: shared TEST carries the REAL pg_net, so a gate that worked there would make genuine outbound HTTP from shared infrastructure every run — it must be EXCLUDED from that lane, never accommodated into it. LOCKED: do NOT weaken WR-03. sql-tests is built on A PRINTED SKIP IS NOT A PASS and fails the step on a whole-file RAISE NOTICE SKIP bail-out, so the fix must be a FILE-LEVEL EXCLUSION (never executed by this job, coverage asserted by sql-mutation instead), NOT an in-file skip, and that distinction must be argued in the artifact rather than assumed. SCOPE: (1) a machine-readable LANE-ONLY declaration in the gate file naming the fixture it requires; (2) the sql-tests loop honouring it and PRINTING every exclusion on every run, since a silent exclusion is the same defect class as a gate reporting PASS having measured nothing; (3) the excluded SET pinned as SITES NOT A COUNT per the B3 convention in drift-check-scripts.test.ts, re-derived from the corpus by a contract test so a one-for-one swap or a new exclusion cannot land unseen; (4) evidence the excluded file is still mutation-covered. Check whether any OTHER gate references a scripts/pg-lane/fixtures/** object — the vault stand-in vault.decrypted_secrets is the near-miss: it EXISTS on both sides (stand-in table on the lane, real view on TEST) so it is explicitly NOT this class and must not be swept in. (INSERTED)

**Goal:** `sql-tests` executes only gates that CAN run against shared TEST. A gate that requires a
pg-lane-only object declares so in its own text, is excluded by the JOB before `psql` is ever
invoked — never by an in-file bail-out, which WR-03 exists to fail — and every exclusion is printed
on every run. The excluded SET is pinned as SITES, not a count, and bound to the object the file's
own assertion bodies query, so neither a new exclusion nor a one-for-one swap can land unseen.
⛔ The floors do NOT move: the exclusion skips EXECUTION and the `"$out"`-derived checks only, and
the whole static-analysis half of the anti-skip block keeps running for the excluded file.

**Requirements**: PROBER-CADENCE-UNDELIVERED-01 (this red is what keeps `POST /api/prober-cadence-alert`, shipped in #815, off production — `sql-tests` blocks the `frontend` aggregator and Railway skips the analytics-service deploy while main CI is red)
**Depends on:** Phase 164.1.1
**Plans:** 2/2 plans executed

Plans:

- [x] 164.1.1.1-01-PLAN.md — the `-- LANE-ONLY:` marker, the ci.yml exclusion (computed and printed before the loop, execution and every `"$out"`-derived check skipped inside it, static accounting untouched), an honest summary line, and a stub-psql invocation log that measures non-execution rather than inferring it (wave 1)
- [x] 164.1.1.1-02-PLAN.md — the SITES-not-a-count register, the forward and reverse object cross-checks, the vault near-miss guard, and four calibrations including the count-unchanged swap (wave 2)

### Phase 164.2: CURATED-COPY — the curated failure sentence must reach the user (INSERTED)

**Goal:** Every failure sentence a user reads is the true, specific one. Two mechanisms, one
thesis:

- **(a) The curated sentence survives the write.** A computation failure shows what its writer
  produced — "Insufficient CSV history. At least 2 data points required." — instead of a generic
  per-kind sentence that replaces it seconds later.

- **(b) The wizard's refusals stop misattributing.** Four copy falsehoods enumerated below name a
  cause the code never tested, or blame a party that did not cause the failure.

The status bridge (`sync_strategy_analytics_status`) overwrites `strategy_analytics.computation_error`
on BOTH branches, so D-162-4's curation reaches no user on any path where a `compute_jobs` row
transitions. Measured 2026-08-26 while closing Phase 162; it PRE-DATES v1.20 — Phase 162 did not
introduce it, and the red-team claim that 162 caused a regression here was refuted (the retired
COALESCE read `last_error`, which is non-NULL on all 103 PROD `failed_final` rows, so its left arm
always won).

⚠️ NOT soundly fixable inside SQL. The bridge cannot tell a curated sentence from a stale one
because the column carries no provenance. Needs a writer/generation marker on `computation_error`
that the Python writers set and the bridge respects. Recorded as owed work in migration
`20260826120000`'s header — deliberately, as owed, not as an accepted trade.

**Also in scope — four wizard-copy falsehoods surfaced 2026-08-26.** Same thesis (the sentence a
user reads must be true); different mechanism and different files from the SQL bridge above. Each
was found by the fixer that closed the preselect-refusal class and deliberately left open because
it lived outside that fixer's files — named, not silently dropped:

1. **`KEY_MISSING_REQUIRED_FIELD`'s title and cause stay credential-shaped on the preselect
   screen** ("One of the required fields is empty.") where there are no fields. `fixRequires`
   gates `fix[]` only, so the surface-split fix could not reach them. The real fix is at the
   emitter in `src/app/api/strategies/create-with-key/route.ts`, whose own guard comment already
   says that arm "may not wear a `KEY_*` verdict that blames a credential". Minting a new copy
   member moves `EXPECTED_TABLE_SIZE` plus three roster/coverage laws — do it deliberately.

2. **`KEY_RATE_LIMIT` blames the exchange for OUR limiter.** The 429 comes from
   `userActionLimiter`, but the copy says "The exchange asked us to slow down… exchange-side
   throttle", and `fix[1]` "try a different exchange account" cannot clear a per-USER bucket.
   Identical on the credential arm; `route.ts:891` already records it ("our outage, blamed on
   their exchange") and accepted it. This is a misattribution class with an existing owner.

3. **`DRAFT_ALREADY_EXISTS`'s cause says "with the same API key"** — false on the stale-session
   path, where the collision is on `(user_id, wizard_session_id, source)` and not the key. True
   on the TOCTOU path and on the credential arm, so the shared `cause` needs splitting, not
   replacing.

4. **The stale-`wizardSessionId` ROOT CAUSE is still open** (functional, not copy).
   `deriveWizardResumeOverrides` restores `wizardSessionId` from localStorage unconditionally on
   the API branch, so an abandoned draft over key A lends its session id to a preselect for key B
   and 23505s forever — `resolveStrategiesForKey` looks up by `api_key_id` and never finds B.
   Re-pressing Continue can never win. Fix belongs in `WizardClient`/`localStorage.ts` (mint a
   fresh session id when a preselect is supplied) or in the route (re-resolve on 23505). Phase 162
   shipped honest copy describing this dead end; it did not remove the dead end.

5. **The public "still computing" factsheet placeholder speaks to a DEVELOPER, on production, to an
   anonymous reader** (added 2026-09-05, found while re-measuring Phase 159's composite-render item
   in a real browser). MEASURED on PROD at `/factsheet/8581f739-1a7b-42a4-a209-3acfa327e259`
   (`Fibonacci Ghost`, published, uncomputed) — the anonymous page ends with the sentence
   **"See the dev-server console for the exact gate the request fell through."** There is no
   dev-server console for a production visitor and an anonymous reader has no console to open, so
   the one actionable-sounding instruction on the page is inert. The same paragraph also volunteers
   an internal gate detail ("insufficient observations inside the bundled benchmark window
   (2023-04-26 onward)") to an unauthenticated reader. Same thesis as (a) and (b): the sentence a
   user reads must be true and must be addressed to them. ⚠️ This is COPY scope only — whether
   `Fibonacci Ghost` should be published-but-uncomputed at all is a separate question and is NOT
   claimed here.

✅ **Overlap RESOLVED in the 2026-08-28 dedup — do NOT re-open at planning time:** WIZFORM-02's
`code: UNKNOWN` class and items 1–3 above are wizard error-surface work and belong to THIS phase.
164.1's title no longer claims them (amended 2026-09-03; the dedup had updated 164.1's DEDUP table
and this section's Absorbed line, but left 164.1's title and this note contradicting both).

⛔ RE-PARTITION 2026-09-05 (founder-selected, `.planning/164-FAMILY-REPARTITION.md`): **161-ERRPREFIX moves here from 164.1** — `KeyPermissionBadge.tsx:140` renders a sentence a user reads, which is this phase's subject, not gate integrity. WR-06-UTC is BOTH bucketers, not one: `src/lib/freshness.ts:207-213` has only a 5-MINUTE clock-skew allowance (not day granularity) and `FactsheetView.tsx:1108-1115` has none. The provenance column of criterion 2 is still OWED WORK — `20260826120000:907` records it and no later migration adds it. The stale-`wizardSessionId` root cause (old criterion 6) is DROPPED from scope: already satisfied, verify by reading the preselect path rather than re-planning it.

**Success Criteria**:

1. A computation failure shows the sentence its WRITER produced, on every path where a `compute_jobs` row transitions — proven by a test that performs the transition and asserts the curated sentence survives it. Inspection of the bridge is not evidence.
2. `computation_error` carries writer/generation provenance and `sync_strategy_analytics_status` respects it. A SQL-only fix is NOT accepted as closing this — the column cannot today tell a curated sentence from a stale one, and that debt is recorded as owed in migration `20260826120000`'s header.
3. WIZFORM-02 is closed by MEASUREMENT, not inspection: for every server-classified error code the wizard can surface, a test asserts the rendered surface shows THAT code and never `code: UNKNOWN`. The test must be shown to fail when the classification is neutered. Phase 153's span verification FAILED on 2026-08-13 — inspection is why this was believed closed once already.
4. No refusal blames a party that did not cause the failure. `KEY_RATE_LIMIT` stops attributing `userActionLimiter`'s 429 to the exchange, and `KEY_MISSING_REQUIRED_FIELD` stops wearing a credential-shaped title on the preselect screen where there are no fields.
5. `DRAFT_ALREADY_EXISTS`'s cause is SPLIT, not replaced — it stays true on the TOCTOU and credential arms while telling the truth on the stale-session path, where the collision is on `(user_id, wizard_session_id, source)` and not on the key.
6. 161-ERRPREFIX per the 2026-08-26 founder ruling — SPLIT: `KeyPermissionBadge.tsx:140` renders prose only to the user (no `CODE: ` prefix), while the structured `err.code` goes to the log and the Sentry breadcrumb so support-ticket greppability (the reason the prefix existed, `:137-138`) is preserved. CLASS change, not one string: the same site emits `PROBE_BACKEND_UNAVAILABLE` and others, so the branch covers every code. Proven by a rendering test that fails when the prefix returns AND a test that fails when the code stops reaching the log.
7. WR-06-UTC: BOTH bucketers — `freshness.ts` and `FactsheetView.tsx` — carry a day-granularity allowance for a future-dated `series_end`, each proven by a test that fails with the allowance removed; fixing one bucketer does not close this.
8. HONEST-08-RESIDUAL: the sync arm of the staler-of-two badge is PROVEN to still render — `FreshnessChip` shown binding to the sync copy on a published row whose series is fresh (one exists off the `crypto-sma` cohort) — so "correct staler-of-two" and "always binds to series" are distinguished by measurement, not inspection.
9. The public uncomputed-factsheet placeholder addresses the reader it actually has: no dev-only instruction (`dev-server console`) and no internal gate detail on the anonymous path, proven by a rendering test over the uncomputed branch that FAILS when the developer-facing sentence is restored. Inspection of the string is not evidence — the test must bind to the anonymous render, since that is the surface where it was measured.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries WIZFORM-02, WR-06-UTC, HONEST-08-RESIDUAL, 161-ERRPREFIX — read each entry before planning, do not re-derive
**Depends on:** Phase 164 (ordered AFTER 164.1 — no dependency between them, numeric order only)
**Absorbed from 164.1 in the 2026-08-28 dedup:** WR-06-UTC, HONEST-08-RESIDUAL, and WIZFORM-02's
`code: UNKNOWN` class — all three are sentences a user reads, which is this phase's subject.
**Plans:** 10 plans

Plans:

- [x] 164.2-01-PLAN.md — 161-ERRPREFIX split: KeyPermissionBadge renders prose, code goes to console.error + Sentry breadcrumb (wave 1)
- [x] 164.2-02-PLAN.md — WR-06-UTC one constant for both bucketers + joint two-surface test; HONEST-08-RESIDUAL FreshnessChip twin + live observation (wave 1)
- [x] 164.2-03-PLAN.md — anonymous factsheet placeholder addresses its reader; V2b test over the anonymous render (wave 1)
- [x] 164.2-04-PLAN.md — mint PRESELECT_REQUEST_INVALID + DRAFT_SESSION_COLLISION, create-with-key emitters, RATE_LIMITED on its limiter arms, five roster laws (wave 1)
- [x] 164.2-05-PLAN.md — RATE_LIMITED across the other three userActionLimiter routes + rosters; bare-upstream-status map on validate-and-encrypt (wave 2)
- [x] 164.2-06-PLAN.md — provenance columns + re-based sync_strategy_analytics_status, three-reviewer gate, human checkpoint (wave 2)
- [x] 164.2-07-PLAN.md — pg-lane gate that performs the transition through the RPC, RED-UNDER-M twins, coupled apply lists, floors, runner to No defects (wave 3)
- [x] 164.2-08-PLAN.md — Python writers stamp provenance in the same statement; AST census (wave 3)
- [x] 164.2-09-PLAN.md — WIZFORM-02 roster-driven render test over every server-classified code, observed RED under neuter (wave 3)
- [x] 164.2-10-PLAN.md — TODOS closes by citation, gate marker down, serial full-suite run (wave 4)

### Phase 164.2.1: SESSIONID-FENCE — the stale wizardSessionId root cause: a preselect for key B must never inherit an abandoned draft's idempotency token from key A (INSERTED)

**Goal:** Close the FUNCTIONAL dead end that Phase 162 shipped honest copy about but did not
remove: an abandoned wizard draft over key A lends its `wizardSessionId` to a preselect for
key B, and the resulting 23505 can never be cleared by re-pressing Continue.

⛔ **WHY THIS PHASE EXISTS AT ALL — a dropped criterion resting on a false claim.** The
2026-09-05 re-partition DROPPED this from Phase 164.2 (old criterion 6) with the instruction
"already satisfied, verify by reading the preselect path rather than re-planning it". That was
never verified. MEASURED FALSE 2026-09-06: the preselect path that would satisfy it does not
exist.

**THE MECHANISM, measured — an asymmetry inside ONE function.**
`deriveWizardResumeOverrides` (`src/lib/wizard/localStorage.ts:493`) takes
`(loaded, source, initialDraftId)` and has ZERO preselect awareness — grepping that file for
`preselect`, `apiKeyId` or `api_key_id` returns nothing, and its only call site
(`WizardClient.tsx:443`) passes no key. Inside it:

- the **session-id** restore is gated on SOURCE ONLY, with no pointer check (`:538-539`)
- the **API-branch step** restore IS pointer-gated — `initialDraftId && loaded.strategyId === initialDraftId` (`:563`)

So on a preselect for key B with an abandoned key-A draft still in localStorage, both sides are
`source: "api"`, the source gate passes, and key A's idempotency token is handed to key B's
submission. The STEP is correctly not restored (the user gets the resume banner); the TOKEN
silently carries across. `clearWizardState` fires only on submit / delete-draft / start-fresh,
so an ABANDONED draft leaves the payload intact — the file says so itself at `:519-522`.

`create-with-key` then takes 23505 on `strategies_user_wizard_session_source_uniq`, falls
through the constraint dispatch at `route.ts:1300` to the `DRAFT_ALREADY_EXISTS` 409 — "A
wizard session with this key is already in progress" — which is FALSE, the colliding row
belongs to key A. `resolveStrategiesForKey` looks up by `api_key_id` (key B) and never finds
it. The stored id is stable, so re-pressing Continue can never win.

⭐ **The file predicted this.** `localStorage.ts:524-530`: "THIS IS TRIGGER REMOVAL, NOT THE
GUARANTEE. The guarantee is the partial unique index … This line removes the one known trigger;
if a second one is ever found, the DB still holds." This IS that second trigger, and the index
holding is exactly why it presents as a permanent 23505 rather than as corruption.

**DELIVERABLE — remove the trigger, leave the index as the guarantee** (the file's own
doctrine, applied literally): persist the draft's `api_key_id` in the localStorage payload,
give `deriveWizardResumeOverrides` a fourth parameter for the incoming preselect key, and
DECLINE the session-id restore when they differ. Declining is already documented safe at
`:534-536` — `WizardClient` seeds from `newWizardSessionId()` on mount, so key B keeps its own
fresh token, which is what a distinct submission should carry anyway.

⚠️ A server-side re-resolve on 23505 is the SECOND choice, not the first: it means the server
rewriting a client-owned idempotency token, and it fixes the symptom one route at a time.
Record the reasoning if it is chosen anyway.

⛔ NOT in scope: the `DRAFT_ALREADY_EXISTS` COPY split — that is Phase 164.2's criterion 5 and
stays there. This phase removes the dead end; 164.2 makes the sentence describing it true. They
are deliberately separable and each ships alone.

**Success Criteria**:

1. A preselect for key B does NOT inherit an abandoned key-A draft's `wizardSessionId` —
   proven by a test that seeds localStorage with key A's payload, mounts the wizard with a key
   B preselect, and asserts the emitted session id is neither A's nor equal across the two.
   ⛔ INSPECTION IS NOT EVIDENCE: this exact item was declared "already satisfied" once on a
   read, and the read was wrong.
2. The test is SHOWN to fail with the fix neutered — remove the new pointer gate, observe RED,
   restore byte-identically (`shasum -a 256` before == after, never `git checkout --`). A test
   that passes with the gate removed has not closed this.
3. The SOURCE gate at `localStorage.ts:538` is NOT narrowed or removed in the process — it
   closes a DIFFERENT trigger (the cross-source api→csv carry, Phase 140.4 / SEAMRIM-03) and
   its own comment forbids reading it as permission to narrow the index. A change that fixes
   the preselect case by loosening the source case trades one dead end for another.
4. The partial unique index `strategies_user_wizard_session_source_uniq` (migration
   `20260728120000`) is UNTOUCHED. It is the guarantee, not the bug; the fix removes a trigger
   that reaches it, and a phase that "fixes" this by widening the index has removed the
   guarantee instead.
5. The existing `localStorage.test.ts` pins for the source gate still pass unmodified — if any
   must change, the change is an INVERSION with its history stated, never a deletion.

**Requirements**: TBD (no v1.20 requirement IDs) — this phase carries NO TODOS entry, because
the item was never in TODOS: it lived as Phase 164.2's old criterion 6 and was dropped from the
ROADMAP on 2026-09-05. ⚠️ Read `.planning/164-FAMILY-REPARTITION.md` and Phase 164.2's
RESEARCH.md (Open Question 2) before planning — RESEARCH is what refuted the drop, and its
verdict is the reason this phase exists.
**Depends on:** Phase 164.2 (ordering only — 164.2 owns the copy half of the same bug and
should land first so the sentence and the dead end are fixed in a legible order; no code
dependency)
**Plans:** 2/2 plans executed

Plans:

- [x] 164.2.1-01-PLAN.md — Key fence: `incomingApiKeyId` 4th param + `sessionKeyMatches` gate, `apiKeyId` payload field + validator (absent-or-null OK), wired call site, `persistPointer` explicit key arg + all 14 save sites, unit + component proofs with positive control
- [x] 164.2.1-02-PLAN.md — Neuter → RED → byte-identical restore at helper AND call site (SEAMRIM pins green under neuter), then full-suite / tsc / migration-untouched / append-only-pins gates

### Phase 164.5: BASELINE-SNAPSHOT — the committed PROD schema baseline becomes the local stack's source and a gate, and the one production object no migration owns is dispositioned under review (INSERTED)

**Goal:** `supabase/schema/baseline.sql` (committed 2026-08-29, WR-04) becomes load-bearing instead of decorative, in this order: (1) repoint `scripts/local-stack/run.sh:50` at `supabase/schema/baseline.sql` and drop the `.gitignore:138` exclusion (`REPLAY-SPIKE.md:135` records that the current path makes `run.sh up` exit FATAL); (2) a baseline STALENESS gate — sha256 of the file against the hash recorded in `BASELINE.md`, failing loud on mismatch (WINDOWS 29: "committed with NO staleness gate AND NO consumer"); (3) **DRIFT-04** — `create_allocator_connected_strategy` exists in PROD under NO migration, is `SECURITY DEFINER` with `GRANT ALL … TO authenticated`, and writes encrypted credential material. FOUNDER DECISION 2026-08-29: DROP it — `DROP FUNCTION public.create_allocator_connected_strategy(<exact 11 arg types>)` with **NO `IF EXISTS` and NO `CASCADE`**, pre-flight asserting (a) live body == `baseline.sql`, (b) zero dependents, (c) `pg_stat_statements` read for call evidence and ABORT when it is unavailable — never infer zero calls from an absent measurement. Three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply; the drop is production DDL on a credential surface. (4) **DRIFT-05** as TWO gates, not conflated: (a) hermetic name-set diff, both directions, `baseline.sql` vs `supabase/schema/functions/*.sql`, a third assertion inside `dump-sql-functions.ts --check`; (b) baseline-vs-LIVE staleness on the credentialed job VAC-04 already rides. (5) **VAC08-LEDGER-32** — **31** repo migrations have no TEST ledger row (the entry ID keeps its original `-32` suffix as a stable identifier; the COUNT is 31 as of 2026-09-07, after `20260823120000_revoke_api_keys_insert` reached TEST); disposition each by name. (6) **VAC-07** — Phase 159's two blocked items as ONE spec on the pg-lane: two concurrent `csv-finalize` POSTs on one never-classified `wizard_session_id`; this is also where the advisory-lock concurrency test that left 164.1 lives. ⚠️ VAC-07 stays `Pending` in REQUIREMENTS until its spec is observed RED with the fence removed and GREEN with it — `[VAC-07-DEFER]` forbids scoring it earlier. Substrate: the pg-lane with pg_cron (164.4.1); nothing here touches shared TEST or PROD except the reviewed DRIFT-04 migration. ⛔ **SCOPE AMENDMENT 2026-09-07 (founder): item (7) CRON-DRIFT-01-REPAIR was SPLIT OUT to Phase 164.5.1.** It was the only item touching the migration-vs-runbook conflict that Phase 164.7 opened, and it is not built on an unresolved convention. See Phase 164.5.1 for the item and the conflict.

**Success Criteria**:

1. `scripts/local-stack/run.sh up` boots from `supabase/schema/baseline.sql`; the old path is gone from the script and `.gitignore` no longer excludes the file. Proven by running it.
2. The staleness gate FAILS on a one-byte change to `baseline.sql` without a matching `BASELINE.md` update, and passes when both move — proven by mutation, not inspection.
3. DRIFT-04: the DROP migration reaches PROD only after all three pre-flight assertions pass and PRINT their measurements; a signature mismatch, a dependent object, or an unavailable `pg_stat_statements` ABORTS the deploy. Afterwards the function is absent in PROD and `database.types.ts` is regenerated without it.
4. DRIFT-05 (a) is a hermetic assertion in `dump-sql-functions.ts --check` that fails when a function name is present on one side and not the other — proven with a red fixture in each direction; (b) runs on the credentialed job and exits 1 when its credential is absent, never skips.
5. VAC08-LEDGER: every one of the **31** unledgered migrations is applied to TEST or dispositioned by name, and VAC-08's next credentialed run prints **`0 NEW drift`** with all 31 carrying a named disposition. ⚠️ **AMENDED 2026-09-07 by founder decision.** It previously read "every one of the **32** … VAC-08 reports **zero unledgered migrations**". BOTH halves were wrong. (a) The count is 31, not 32 — `20260823120000_revoke_api_keys_insert` was applied to TEST on 2026-09-07. (b) "zero unledgered migrations" is UNSATISFIABLE on the disposition route and always was: the gate's seam is `sed 's/#.*//'` (`scripts/test-ledger-drift-check.sh:361`), which STRIPS comments before comparing, so a disposition is invisible to it by construction. It can print `0 NEW drift`; it can never print "zero unledgered". Only APPLYING all 31 to shared TEST yields that, and TODOS `[VAC08-LEDGER-32]` explicitly forbids an agent doing so. The criterion is now pinned to what the tool actually PRINTS. ⛔ The stronger goal — TEST genuinely holding these migrations — is NOT abandoned; it moves to **Phase 164.8 TESTPREPROD**, which exists to make TEST a real pre-prod. MEASURED: adding the 31 dispositions left the gate's own name-parse BYTE-IDENTICAL (`087de909…` before and after), so this weakens nothing VAC-08 detects. ✅ **CLOSED 2026-09-09 — and the STRONGER goal deferred to 164.8 is met, not merely the weakened criterion.** Phase 164.8 restored shared TEST from the PROD dump (`test-restore-from-baseline.yml` run **`34274355596`**, head **`88581b8bc66415bfa86b7d5a019741b1cbd0ff49`**, COMMITTED), re-seeding the ledger to one row per repo migration file (243 → 266), so TEST GENUINELY HOLDS these migrations rather than carrying 31 named dispositions for their absence. `scripts/vac08-ledger-baseline.txt` therefore went **31 → 0 entries**, emptied BESIDE AN AIM with a dated lineage header (commit `776c4dbb`, `ENTRY_COUNT = 0`). The SHA-bound reading, from `sql-tests` job `102416204141` in CI run **`34335526540`** at head **`b895113264af79858f77682b20d539595df582b0`** (conclusion `success`), verbatim: `ledger presence: 0 absent, all 0 baselined (see scripts/vac08-ledger-baseline.txt); 0 NEW drift.` ⚠️ That exact wording is itself dated: PR #767 (`06db9958`, Phase 164.8.1) added a ledger-frontier exemption and the line now reads `ledger presence: 0 absent — 0 baselined (see scripts/vac08-ledger-baseline.txt), 0 exempt as above the ledger frontier; 0 NEW drift.` — measured on run **`34367061423`** at head **`dbd1324690eb05f3d4a567e93eaca2323513ef3b`**. Both readings are `0 absent`; quote the one that matches the sha you are reading. ⛔ **AMENDED 2026-09-09 — TWO corrections to the attribution above, found by the Phase 164.8 verifier and confirmed independently by the orchestrator. Neither weakens the closure; both make it attributable.** (a) Run **`34274355596` concluded `failure`**, not success (`gh run view 34274355596` → `conclusion=failure`): it COMMITTED the transaction — which is why the ledger really did move 243 → 266 — and then exited 1 on the post-COMMIT extension guard, a guard that fires on a legitimate GAIN and is itself booked as Phase 164.9's routed item 1. The bare `COMMITTED` parenthetical above was carrying that whole story alone. (b) **It is NOT the run that left shared TEST in its present state.** A second, complete destructive rebuild ran the next morning at head `a622df27`, actor `AI-Isaiah`: **`34329459044`** (preflight, 08:30Z) and **`34330741339`** (`mode=restore`, confirm token enforced, 08:44Z, conclusion `success`). Measured 2026-09-09: `grep -rn "34330741339\|34329459044" .planning/` returned **zero hits** before this amendment, so for a database other people's CI depends on, "who rebuilt it, from what, and when" was not answerable from the planning record at all. Both run ids are now in `164.8/164.8-04-RESTORE.log` with their readings.
6. VAC-07: the concurrent csv-finalize spec exists on the pg-lane, was observed RED with the advisory lock removed and GREEN with it restored, and only then does REQUIREMENTS flip VAC-07 to Complete.
7. ⭐ **BASELINE-CONTENT-DRIFT (carried in from Phase 164.7, 2026-09-07): the baseline is pinned to the MIGRATION CHAIN, not merely to its own changelog.** Criterion 2 above is a CO-EDIT gate — it fires on a byte change to `baseline.sql` with no `BASELINE.md` update. It cannot fire when a migration changes a function body and `baseline.sql` is left untouched, which is exactly what Phase 164.7 does. MEASURED at `14dc1f5e`: `baseline.sql` still carries the superseded Lock B (`grep -c ledger_refresh_enabled` = **4**) and **zero** workflows in `.github/workflows/` reference the file at all. **Done when** a gate compares the committed baseline against the applied migration chain and FAILS on a body that disagrees — proven by mutation in BOTH directions (regenerate the baseline and observe GREEN; revert one function body and observe RED naming that function), never by inspection. ⛔ This must land BEFORE any squash: collapsing 263 migrations onto an unpinned, already-drifted baseline freezes the drift into the new floor permanently. ⚠️ 44 function names in `supabase/migrations/**` carry more than one definition (`mark_compute_job_done` × 9), which is the weight a squash would reclaim and the reason the ordering matters.

**Requirements**: VAC-07 (deferred here from 164.3) + TODOS entries DRIFT-04, DRIFT-05, VAC08-LEDGER-32, `[VAC-07-DEFER]` — read each before planning, do not re-derive
**Depends on:** Phase 164.4.1 (the pg-lane with pg_cron is the substrate), Phase 164.3 (VAC-04/VAC-08 credentialed jobs that (4b) and (5) ride), **Phase 164.7** (item (7) must consume 164.7's settled `app.*` replacement mechanism, not invent a second answer — the `20260408215026` GUC design is exactly what 164.7 retires)
**Plans:** 1/8 plans executed

Plans:

- [x] 164.5-01-PLAN.md — crit 1: repoint the local-stack lane at the committed `supabase/schema/baseline.sql`, drop the `.gitignore` exclusion, retire `BASELINE.md`'s NOT WIRED YET claim, prove by RUNNING `run.sh up` (wave 1, tracer)
- [x] 164.5-02-PLAN.md — crit 2: hermetic baseline staleness (co-edit) gate + CI placement in `sql-function-snapshot.yml`, mutation-proven in three arms (wave 1)
- [x] 164.5-03-PLAN.md — crit 7: BASELINE-CONTENT-DRIFT gate over the existing `sql-body-normalize.mjs --diff-bodies`, hash-pinned ratchet for the measured 6 DRIFT + 2 SNAPSHOT_MISSING, wired into `ci.yml`'s aggregator-blocking `sql-gate-lint` (wave 1)
- [x] 164.5-04-PLAN.md — crit 4: DRIFT-05 as TWO gates — (a) hermetic name-set diff inside `dump-sql-functions.ts --check` with a red fixture in each direction, (b) baseline-vs-LIVE on VAC-04's credentialed job, exit 1 on an absent credential (wave 1)
- [x] 164.5-05-PLAN.md — crit 5: disposition all 31 unledgered migrations by name, pin them with an independent vitest, and amend criterion 5's wording to the `0 NEW drift` reading the gate can actually print (wave 1)
- [x] 164.5-06-PLAN.md — crit 3 / DRIFT-04: **APPLIED AND SHIPPED 2026-09-08**, in the revised two-PR sequence exactly as specified: PR 1 the DROP only (CHANGELOG `[0.77.20.0]` — "DRIFT-04: the unowned PROD function is dropped"), PR 2 the baseline regeneration plus the `NAME_SET_RATCHET` row deletion together (`[0.77.21.0]` — "DRIFT-04 closed: baseline regenerated, ratchet row retired"). The migration is `supabase/migrations/20260908120000_drop_create_allocator_connected_strategy.sql`; `create_allocator_connected_strategy` now appears ZERO times in `supabase/schema/baseline.sql`, and the row is in TEST's ledger.
  ⛔ **CORRECTED 2026-09-09.** This line read `[~] … NOT APPLIED … the pre-flight SCRIPT must run against PROD first` for a full day after the apply landed. A ROADMAP that under-reports finished work sends the next reader to redo it, or makes the queue look longer than it is — the same record-vs-reality class this milestone exists to remove, in the planning artifacts rather than the database. Re-measure a status line before trusting it; three independent sources (CHANGELOG, the migration file, the TEST ledger) disagreed with this one.
- [x] 164.5-07-PLAN.md — crit 6 / VAC-07: two-client concurrent csv-finalize race spec on the local-stack lane (NOT the pg-lane), observed RED-then-GREEN, made to EXECUTE in CI, then VAC-07 flips to Complete (wave 2, depends on plan 01)

### Phase 164.8: TESTPREPROD — TEST becomes a real pre-prod: every migration is proven on a real Postgres before it reaches a customer (INSERTED)

**Goal:** The shared TEST project stops being a stale bystander and becomes the stage every migration crosses BEFORE production. Two halves: (1) bring TEST current — the migration backlog it has accumulated while nothing applied to it; (2) apply on merge to TEST FIRST, then PROD, so a migration that cannot apply is caught against a real Postgres instead of against customers.

⚖️ **FOUNDER DECISION 2026-09-06**, in the founder's own framing: *"Make TEST a real pre-prod — bring it current, then apply on merge before PROD. This is what you'd expect, and it's the only thing that fixes e2e running against a stale schema."*

⛔ **The defect this closes is that NOTHING applies migrations to TEST today.** `sql-tests` has no apply step and the migrate workflow is PROD-only, so every pre-apply gate SKIP is PERMANENT and deployed function bodies are tested nowhere. Read TODOS `[NOTHING-APPLIES-MIGRATIONS-TO-TEST]` and `[164.2-TEST-APPLY-PROVENANCE]` before planning — the second is the concrete, dated instance: Phase 164.2's PR went RED on `sql-tests` for exactly two named arms purely because its provenance migration had not reached TEST, and was resolved by a HAND apply through the Management API. That hand apply is the thing this phase automates.

⚠️ **Constraints that are not negotiable and are already measured:**

| Constraint | Consequence for this phase |
|---|---|
| TEST is **SHARED** with other people's CI | A write there is not private and a global assertion there is not reliable (`FANOUT-GLOBAL-01`). Per-run isolation, not global truncation. |
| This checkout's Supabase CLI is linked to **PRODUCTION** | `supabase db push`, `db reset --linked`, `--project-ref` and `--db-url` from this directory all target PROD. The link is deliberate (the pre-flight gates diff against PROD on purpose) — do NOT "fix" it by unlinking. |
| `current_database()` is `postgres` on BOTH projects | It proves nothing. Verify via the hand-set `shobj_description(oid, 'pg_database')` marker before ANY write; a NULL marker means STOP, not proceed. |
| Pre-flight migration gates run against PROD, not TEST | A TEST-first pipeline does NOT de-risk them — measured: a PROD-only `INTO STRICT` would have aborted the deploy while TEST had none. |

**Downstream consequence, NOT a goal of this phase:** per-run isolation on TEST is the precondition for raising Playwright workers above 1 in the `e2e-seeded` job (`playwright.config.ts`, the `workers: process.env.CI ? 1 : undefined` line). Today the MA-8 batch shares ONE test database across all specs, which is why serialisation is load-bearing rather than sloppy. ⛔ Do NOT plan parallelism as an objective here: measured on main run `34059839696`, `e2e-seeded` sits behind `sql-mutation` (503s), so parallelism buys ~1-2 min of wall clock and is worth nothing on its own. It is a thing that becomes SAFE, not a thing to chase.

⛔ **SCOPE ADDED 2026-09-08 — `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]`, AND IT IS A HOLE IN THIS PHASE'S OWN DESIGN, not a bolt-on.** Migration `20260908120000_drop_create_allocator_connected_strategy.sql` (Phase 164.5, PR #758) is a bare `DROP FUNCTION` with an exact 11-argument signature and deliberately **no `IF EXISTS`**, so that a moved signature aborts loudly instead of dropping nothing quietly. TEST carries **ZERO** overloads of that function (measured 2026-09-08 against TEST's own `pg_database` marker). Therefore:

- **Half (1) "bring TEST current"** replays the accumulated backlog, which now contains this migration → `42883`, abort.
- **Half (2) "apply on merge to TEST FIRST, then PROD"** applies it to TEST on merge → `42883`, abort.

⭐ **So the pipeline this phase exists to build FAILS CLOSED on a migration that is CORRECT for PROD.** Planning must settle this before either half is built, not after. ⚠️ The three wrong answers, each already refused with its reason in the TODOS entry — read it rather than re-deriving: adding `IF EXISTS` (reintroduces the vacuous no-op the migration's own STEP 1 exists to refuse, on PROD as well as TEST); adding it to `scripts/vac08-ledger-baseline.txt` (that file's header says it is "a RATCHET, not a mute button" whose purpose is stopping a KNOWN gap from masking a NEW one, and every existing entry means *"should reach TEST, hasn't yet"* while this one means *"can never reach TEST"* — two meanings in one list); and hand-applying (there is nothing there to drop).

⛔ **THE DELIVERABLE IS A DISPOSITION, AND ITS ANTI-VACUITY BAR IS THE WHOLE DIFFICULTY.** A rule classifying "repo migration DROPs object X and TEST has zero of X" as not-applicable has exactly the shape of a gate silently not running — the defect class this milestone exists to remove. It ships only with a fixture PAIR: one proving the disposition FIRES on this shape, and one proving it does **NOT** swallow a genuine missing apply (a migration that should have reached TEST and did not must still go RED). A disposition proven only in the first direction is worse than the red it replaces.

✅ **SETTLED 2026-09-09 by plan 06, and the answer is NOT the one this paragraph anticipated. Read TODOS `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]`'s closure for the verdict in full; it is in two parts and neither half stands alone.** **(1) NARROW — CLOSED.** No disposition was built and none was needed for `20260908120000`. The restore (run `34274355596`, head `88581b8b`) rebuilt TEST's `public` from the 2026-09-08 PROD dump, which `BASELINE.md` records as a **pure deletion of 91 lines, zero added** — the deleted block being `create_allocator_connected_strategy` itself. The object is therefore in neither PROD, nor the dump, nor TEST, while the ledger row for `20260908120000` IS present, so VAC-08 prints `0 absent` with no pragma anywhere in the repo. `supabase db push --include-all` never selects a migration the ledger already holds, so the `42883` batch abort predicted above has no occasion to occur. All three wrong answers stayed refused and not one was needed. **(2) GENERAL — OPEN, and it is a DIFFERENT hole than the one this paragraph names.** The restore was SCHEMA-ONLY (`BASELINE.md`: 0 data statements), so TEST reproduces PROD's CATALOGUE and never its ROWS. A migration in this repo's house style — a data-reading `DO` block that `RAISE EXCEPTION`s on an unexpected count — applies cleanly to PROD and REFUSES on an empty TEST, and Area 1 Q2 makes that refusal block the production deploy. The retired pragma was the declared escape hatch for exactly that. It is booked as `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` with a trigger condition, an interim remedy (revert the merge — never a workflow edit under deploy pressure) and two candidate shapes, and routed to **Phase 164.9 TESTISOLATION**.

⚠️ **COST OF NOT DOING THIS FIRST, measured 2026-09-08:** VAC-08 enumerates EVERY repo migration against the TEST ledger on every `sql-tests` run — it is not scoped to a PR's diff. `main` is red at `78cfaef4` for exactly this, and every PR opened until this lands inherits a red `sql-tests` + `frontend` that a human must triage by hand as "the known one" before each merge. That is a control that has quietly stopped controlling.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries `CI-MIGRATE-01`, `[164.2-TEST-APPLY-PROVENANCE]`, `[164.5-TEST-VAC08-DROP-UNAPPLIABLE]` — read each before planning, do not re-derive. ⚠️ **CORRECTED 2026-09-08:** this line previously cited `[NOTHING-APPLIES-MIGRATIONS-TO-TEST]` and `FANOUT-GLOBAL-01` as TODOS entries. **Neither ID exists in `TODOS.md`** (measured: 0 hits each). The substance of the first is under `### CI-MIGRATE-01` (`TODOS.md:2362`); the second exists only as ROADMAP/CLAUDE.md prose about shared-TEST assertion reliability. Citing a phantom ID sends a planner looking for a spec that was never written.

**Depends on:** nothing outstanding. ⭐ **RE-ORDERED 2026-09-08 — PULLED FORWARD, runs NEXT.** ⚠️ **The SECTION was physically MOVED on 2026-09-08 to sit here, immediately after Phase 164.5 and ahead of 164.5.1.** For several hours it was pulled forward in this prose only while the section still sat after 164.6 — which meant `roadmap.analyze`, which walks FILE ORDER and returns the first incomplete phase, would have handed the next session 164.6. Prose is not the queue; position is. If a phase is re-ordered, MOVE IT. This SUPERSEDES the 2026-09-06 founder decision that queued it LAST; that decision is preserved verbatim in the next sentence because it was taken deliberately and its reasoning still reads correctly for the world before 2026-09-08. It said: *"Queued LAST in the 164.x series by founder decision 2026-09-06, in full knowledge of the counter-argument: Phase 164.7 and Phase 164.5 each write forward migrations and will therefore each hit the hand-apply path this phase automates. That cost is accepted, not overlooked."* What changed is that the accepted cost stopped being a per-PR inconvenience and became a PERMANENTLY RED `main` (see the scope block below), and that the phase's own design was found to break on the migration that caused it. The former dependency on Phase 164.6 was documented as "ordering only — no code dependency", so nothing technical resisted the re-order.

**Status**: ✅ **COMPLETE 2026-09-09.** 6/6 plans with SUMMARYs. `gsd-verifier`: **7/9 must-haves**, 1 present-but-behaviour-unverified, 2 failed — and it proved the ENGINEERING holds: eight mutations of the shipped controls (`apply.if` without the success clause, `apply-test.if` on `always()`, the pre-fix applied-set scrape, a `push:` trigger on the restore workflow, the PROD-marker refusal on `if false`) each observed RED, plus `self-test OK (26/26 arms)` on a real PostgreSQL 16 cluster. **Both failures were record defects, not shipped controls, and both are closed** (`2832e139`): two destructive rebuilds of shared TEST were recorded nowhere while the ROADMAP credited a run that concluded `failure`; and five places asserted the CLI post-verify had never executed when run `34330741339` step 24 concluded `success` under the pinned 2.98.2 — one of them scoping Phase 164.9's work on a false sentence. `gsd-code-reviewer`: **0 Critical, 6 Warning, 7 Info**. WR-01 was fixed here (`ec94788b`) because it was proven-live command substitution inside the script that assembles `DROP SCHEMA public CASCADE` — a fixture carrying a backticked echo came out of bash with the echo already executed; arm 26 gained legs (f) and (g) and goes RED under the old matcher. The other five Warnings are routed to **Phase 164.8.2 GATEHARDENING**, inserted for them. ⚠️ **ONE ITEM IS OPEN AND THIS PHASE CANNOT CLOSE IT:** the applied-set comparison has never run on a NON-EMPTY set — both dispatch proofs (`34354619770`, `34367135073`) ran at 266/266 on both ledgers, so `planned` and `applied` were both empty and equality held trivially. It is carried as `blocked` in `164.8-UAT.md` test 5 and `human_judgment: true` in two coverage blocks, never as a pass. The verifier's judgement, kept verbatim: *"Sufficient to call the applied-set check wired and falsifiable; not sufficient to call the pipeline proven."*
**Plans:** 6/6 plans executed

Plans:

⚠️ **RE-SYNCED 2026-09-08 by the 164.8-01 executor.** The five bullets that stood here described
the PRE-SPLIT plan set and had been stale since `fbb18c98` ("164.8 plan count 5 -> 6"), which moved
the count but not the list: every entry from 02 down named the plan one slot BELOW it on disk, and
06 was missing entirely. Each bullet below is now taken from that plan file's own `<objective>`.

- [x] 164.8-01-PLAN.md — `scripts/restore-test-from-baseline.sh`: the one-transaction drop+replay+survivors+ledger-seed mechanism with SEVEN pre-write refusals, a search_path-independent census (B1) and a derived `pg_depend` closure (B2), plus the `--self-test` SKELETON carrying the two GREEN arms. Writes NO byte to TEST or PROD
- [x] 164.8-02-PLAN.md — finish the proof: every RED path observed on a throwaway Postgres, `EXPECTED_ARMS` introduced ONCE at its final value, the constants pinned in vitest, the header written
- [x] 164.8-03-PLAN.md — `test-restore-from-baseline.yml`: dispatch-only, ref-guarded, `mode=preflight|restore` + `confirm` token, `environment: Test`, backup artifact BEFORE the script, whole-act mutex, CLI post-verify; line-exact wiring pins
- [x] 164.8-04-PLAN.md — WAVE 1 EXECUTION, the one-way door: founder merges the wave 1-3 PR → preflight → **activity gate** (mutex-first probe; `idle in transaction` counts as active; non-zero aborts to the founder — founder delegation 2026-09-08 superseding CONTEXT safety rule 4) → restore → SHA-bound readings → `vac08-ledger-baseline.txt` emptied BESIDE AN AIM with `ENTRY_COUNT` 31 → 0 in the same commit
- [x] 164.8-05-PLAN.md — WAVE 2 PIPELINE: `apply-test` (`environment: Test`, mutex, marker, `db push --include-all --db-url`) + `apply-test-verdict` (`if: always()`, skipped = fault) gate PROD `apply`; pins; SHA-bound dispatch proof
- [x] 164.8-06-PLAN.md — WAVE 3 CLOSURE: record the verdicts and the SHA-bound readings, TODOS closures with run ids (incl. the `TEST-NOT-APPLICABLE` pragma verdict), first SHA-bound VAC-08 `0 absent` reading, CLAUDE.md + mutex runbook currency
  ⛔ **CORRECTED 2026-09-09.** This bullet read "the `TEST-NOT-APPLICABLE` pragma recorded as DEAD SCOPE by measurement" — the verdict the plan-checker's B4 finding REVERSED on 2026-09-08, before plan 06 ran. The shipped verdict is two-part: unnecessary for `20260908120000` (narrow, evidenced), general case OPEN and routed to Phase 164.9 as `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`. A ROADMAP bullet still carrying the superseded half would send the next reader to close a hole that is open.

### Phase 164.8.6: VAULTTICKFIX — the forward migration Phase 164.7 earned: the verification check that cannot fail is re-run correctly, the Vault read becomes single-row-safe, the whitespace-key guard learns btrim, and the SECURITY DEFINER grant set is asserted whole instead of two names deep (INSERTED)

**Goal:** One forward migration repairs every SQL-side finding Phase 164.7's post-merge audit produced, including a verification check that CANNOT FAIL — shipped through this repo's full migration discipline, not around it.
**Requirements**: [164.7-CR05-VACUOUS-MIGRATION-CHECK], [164.7-WR01-VAULT-NOT-STRICT], [164.7-WR02-SERVICE-ROLE-EXECUTE], [VAULTTICK-EMPTYKEY-01], [164.7-MIGRATION-COMMENT-DRIFT], [APPGUC-WARNING-UNINSTRUMENTED-01] + [164.7-DORMANCY-UNINSTRUMENTED] (⛔ RE-ROUTED from 164.8.5 on 2026-09-10: ONE instrument closes both, and it is SQL in `20260907130000` — a phase whose fence forbids `supabase/**` cannot hold them. A prober-side `system_flags` read-back was considered and REJECTED by measurement: it cannot distinguish WR-10's third dormancy cause, so it would be a control that reports 'fine' for a case it cannot see) + `[164.8.5-HYGIENE-RESIDUALS]` + `[164.8.5-MANIFEST-SIDE-LOOP-DEAD]` (⚠️ ROUTED HERE 2026-09-11 by founder decision, from Phase 164.8.5's three review rounds and its SECURITY audit. ⛔ **THEMATIC MISMATCH, RECORDED SO IT IS A DECISION AND NOT A DRIFT:** this phase's own goal is *'one forward migration repairs every SQL-side finding'*, and it absorbed `[APPGUC-WARNING-UNINSTRUMENTED-01]` precisely BECAUSE those are SQL. These two are pure JavaScript — `scripts/prod-prober/arms/cron-drift.mjs` and its fixtures — so a planner opening this phase will find a `supabase/**` migration brief beside two prober-lexer items. Plan them as a separate wave, or split them out; do not let the migration's discipline (3 reviewers, TEST before PROD) be read as applying to them, nor its fence be read as excluding them. **HYGIENE-RESIDUALS** = five credential shapes still unreported: the `||`-split value outside a header region, a non-`BUILDERS` wrapper, an alphabetic-only 32+ token, a `MIGRATION_FILENAME_RE`-shaped token in a comment, and a credential in a too-deeply-nested `DO` body (that last one returns `command-unjudgeable` — LOUD, not silent). ⭐ The honest remedy is a WHOLE-TOKEN MEASURE rather than a sixth exemption, and that is a DECISION about what the arm is for: every further narrowing risks the zero-false-positive budget the whole instrument depends on, and that budget is why the one true positive is still readable. **MANIFEST-SIDE-LOOP-DEAD** is ALSO listed in Phase 164.5.1 — deliberately, not by duplication: 164.5.1 owns the RE-CAPTURE that silently re-animates the loop, this phase would own the ORDERING fix that stops the loop sitting below `compareManifest`'s early returns. Whichever lands first should say so in its SUMMARY)
**Depends on:** Phase 164.8
**Plans:** 8 plans

**Success Criteria**:

1. `20260907120000`'s check 6 is re-run in a form that CAN fail: deleting the settings read while keeping the `RAISE EXCEPTION` text must make it RED. ⭐ The correct idiom is already in the repo at `20260907130000:766` — match the sibling rather than inventing one.
2. `match_engine_cron_tick()`'s Vault read is single-row-safe (`STRICT` or an explicit cardinality check), so a duplicate secret name RAISEs by name instead of posting an arbitrary key.
3. The whitespace-key guard tests `btrim(v_key) = ''`, with a gate arm that stores a single space and asserts the function RAISEs by name — ⚠️ that arm moves `ARMS_FLOOR`, so separate the floor in BOTH directions on a real full-corpus lane run before pinning, per the runner's own derivation block.
4. Both migrations' verification blocks assert the WHOLE grantee set of all three SECURITY DEFINER functions, not the `anon`/`authenticated` subset — `service_role`'s EXECUTE is the grant that survived precisely because it was never checked.
5. ⛔ Before ANY comment-only edit to an applied migration, take the reading nobody has taken: does a comment-only edit change what `supabase-migrate`'s plan job plans? (PATTERNS TRAP A, recorded in `164.7-06-SUMMARY.md`; Phase 164.5.1 criterion 6 is blocked on the same question.) If the answer is yes, annotate BESIDE the file rather than editing it.
6. ⛔ The three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) run BEFORE the PR exists, and their findings are fixed — not after, and not in the PR body.
7. ⚠️ Read `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` first: a data-reading `DO` block that RAISEs on an unexpected count can apply to PROD and REFUSE on the empty TEST, and a failed TEST apply BLOCKS the PROD apply. The interim remedy is to revert the merge, never to edit `supabase-migrate.yml`.

Plans:

⛔ **TWO migration files, not one — measured (RESEARCH §Q4), and it contradicts this phase's own goal sentence.** The tick gate's lane lacks the ledger stack and the fan-out lanes lack the vault stand-in, so a single file cannot apply on either lane. One PR, two files: "one shipped repair" is satisfied, "one forward migration" is not, and that is recorded here rather than silently satisfied. Waves 1-4 are the SQL wave (one PR); waves 5-6 are the JS wave (a second PR, opened after the first lands — founder decision, thematic mismatch recorded above).

- [x] 164.8.6-01-PLAN.md — WAVE 1 TRACER: `20260911120000_vault_tick_hardening.sql` (count+max Vault read, `IF v_cnt > 1 THEN`, `btrim`, four-role REVOKE, variable-bound needles, aclexplode whole set) + the tick gate re-pointed (V1/U1/C1/C2/C3) with arms V2 (mirror twin) and G1; narrowed lane run clean
- [x] 164.8.6-02-PLAN.md — WAVE 1: lane fixture `33-fixture-cron-runs.sql` + `20260911130000_ledger_fanout_grantees_and_dormancy.sql` (both fan-outs re-based with the `cron_runs` dormancy instrument for causes 1 and 3, four-role REVOKEs, catalogue-only verify)
- [x] 164.8.6-03-PLAN.md — WAVE 2: both ledger gates — 14 + 12 body-editing twins re-pointed, arms S1/M1/M2 per gate, rosters 15; narrowed lane runs clean
- [x] 164.8.6-04-PLAN.md — WAVE 2: the check-6 FALSIFIER (three neuters RED on scratch copies, source proven intact), the `20260907130000` ack-block reconciliation (comment-only, line-count-neutral, bundled — criterion 5's reading applied), snapshots regenerated and three VAC-04 acks EARNED from origin/main
- [x] 164.8.6-05-PLAN.md — WAVE 3: `ARMS_FLOOR` separated both ways on full-corpus lane runs and pinned with a dated derivation + `164.8.6-05-FLOORS.log`; every quick gate green at a named sha; the three reviewers BEFORE any PR exists (criterion 6)
- [x] 164.8.6-06-PLAN.md — WAVE 4: release commit v0.77.34.0 (VERSION/package.json/CHANGELOG via the commit checklist) → checkpoint:decision (the one-way door: merge auto-applies to PROD) → open the SQL PR
- [x] 164.8.6-07-PLAN.md — WAVE 5 (JS): hoist `compareManifest`'s manifest-side hygiene loop above every early return + three one-lever vitest cases with a cp-swapped RED control (164.8.5-MANIFEST-SIDE-LOOP-DEAD, ordering half; re-animated earlier by PR #776)
- [x] 164.8.6-08-PLAN.md — WAVE 6 (JS): `tokenMeasure` whole-token measure, red rows for hygiene shapes 2/3/4 with green/bypass corpora intact, `[164.8.6-08]` describe, release commit v0.77.34.1 and the JS PR after the SQL PR lands (164.8.5-HYGIENE-RESIDUALS)

### Phase 164.8.5: PROBERPARSE — the prod-prober hygiene rules stop being dodgeable and its parser stops dropping rows silently: the ||-split service key and the dollar-quoted literal both go RED, an unreadable oracle no longer disables the live credential scan, a malformed cron.job record becomes a measure-fail instead of a continue, and the app-GUC linter successor check stops accepting any readable file (INSERTED)

**Goal:** Every control this phase touches is one a machine can DODGE today, and each fix ships with a red fixture proving the dodge now fails. The reviewer's verdict on Phase 164.7 is the brief: *"the SQL in this phase is careful and genuinely fail-closed; the verification code shipped alongside it is not."*
**Requirements**: ⛔ [164.7-REPAIR-REVERTED] (FIRST WORK — the five prober repairs were written, measured as a net regression, and reverted on 2026-09-10; re-do them with a red control each, hoisting PROD hygiene above every early return BEFORE re-applying anything), [164.7-CR03-HYGIENE-BYPASS], [164.7-WR04-HYGIENE-BELOW-ORACLE], [164.7-WR05-PARSER-DROPS-ROWS], [164.7-APPGUC-SUCCESSOR-VACUOUS], [164.7-REVIEW-INFO-FOUR], [APPGUC-DETECT-DOUBLEQUOTE-01], [APPGUC-UTF16-01]
**Depends on:** Phase 164.8
**Plans:** 7/7 plans complete

**Success Criteria**:

1. ⛔ **Before ANY of the below:** the PROD-side hygiene loop runs at the TOP of `compareManifest`, above every `return`, and a test proves a `cron-secret-in-command` on the PROD side STILL fires when the oracle is absent, stale, hand-edited and marker-mismatched. This is the precondition the 2026-09-10 revert exists to enforce — re-applying the repairs without it re-introduces a measured suppression of credential detection.
2. ⛔ **The redesigned `vault-absent` admits `SELECT public.match_engine_cron_tick();` AND rejects a command naming the table only in a comment or a literal.** These are the two directions Phase 164.5.1 and this phase respectively need, they are the SAME rule, and satisfying only one re-breaks the other. The test is "does this command reach a Vault read that EXECUTES" — an executable read shape on masked text, OR a call to a function whose committed body contains one. ⚠️ This phase owns the redesign and lands FIRST; 164.5.1 consumes it. See `[164.7-VAULT-ABSENT-RULE]`.
3. `hygieneViolations` returns a NON-EMPTY list for a command whose service key is split across a `||` concatenation, and a red fixture in `fixtures/cron-drift/` proves it — neutering the fix must turn the self-test RED naming that fixture. ⛔ NOT by lowering `HEADER_LITERAL_MIN`: the docstring explains why the threshold exists and lowering it fires on the green Vault-backed shape.
4. The literal scanner skips `$tag$ … $tag$` regions wholesale, so `$q$don't$q$` and `$q$dont$q$` in the headers list produce the SAME verdict. Both spellings ship as fixtures.
5. A live `cron.job` command carrying a credential is reported as `cron-secret-in-command` EVEN WHEN the oracle is missing, unparseable, or has a bumped `schema_version` — the property the file header already claims and does not have.
6. A malformed `cron.job` record raises a `measure-fail` naming the count instead of `continue`. A row the parser could not read is not a row that is not there.
7. `lint-app-guc`'s successor check rejects a successor that is not a real successor, and `DETECT_RE` matches all four missed spellings — each with a red fixture in the gate's own `--self-test`. ⚠️ The corpus stays at 0 findings: a fix that moves that number is matching something else.
8. The four Info findings are swept in the same pass (`--files` allowlist enforcement, `sqlFilesUnder` symlinks + `.SQL` case, `parseLineageHeader`'s first-marker-wins, `pg-password`'s plpgsql assignment forms).
9. `node scripts/prod-prober/run.mjs --self-test` exits 0 with `SELF_TEST_SCENARIOS` bumped in the SAME edit as any added scenario, and `src/__tests__/prod-prober-wiring.test.ts` agrees.

Plans:

- [x] 164.8.5-01-PLAN.md — Prober structure: section (0) PROD hygiene above every return in `compareManifest` (positional gate), `run()` never returns before it, mandatory + compared live marker, `{ rows, malformed }` parser with a measure-fail naming the count, `captureManifest` fourth refusal + its scenario; HOIST scenarios (absent / stale / marker-mismatched); individual neuter matrix
- [x] 164.8.5-02-PLAN.md — The four reverted repairs re-applied with a red control each: CR-01 username/database, CR-04 totality loop (three fields neutered ALONE), WR-11 sha binding + the HAND-EDITED hoist state, SR-05/07/08/09 comment fixes; eight-row individual neuter matrix
- [x] 164.8.5-03-PLAN.md — Hygiene lexer: import `scanSql`, `codeSpans()` DO-body recursion, header rules on masked text with derived-length sum (anchored ids at `HEADER_LITERAL_MIN`, every header argument at `HEADERS_LITERAL_MAX` — bypasses a–g, the non-anchored split, `$q$don't$q$` pair), `headerRegions` as a list with an unparseable state → `header-unparseable` measure-fail, IN-04 pg-password forms, `hygiene-bypass.json`, the committed-manifest zero-FP scenario
- [x] 164.8.5-04-PLAN.md — Individual neuter matrix for Plan 03's lexer-era controls (eleven rows) + the CR-03 reproduction
- [x] 164.8.5-05-PLAN.md — `vault-absent` = "reaches an executing Vault read" (executable shape on spans OR resolvable committed callable, injectable snapshot dir, fixture snapshot, real-snapshot 164.5.1 collision scenario) + `long-token-anywhere` with `TOKEN_MIN` DERIVED from `HEADERS_LITERAL_MAX` and pinned (bypasses h, i; zero-FP budget inherited from Plan 03)
- [x] 164.8.5-06-PLAN.md — Individual neuter matrix for Plan 05's controls incl. the `TOKEN_MIN` pin (twelve rows) + the CR-03/SR-02 reproductions and phase-level prober checks
- [x] 164.8.5-07-PLAN.md — `lint-app-guc`: `DETECT_RE` widened in BOTH files with FIVE single-spelling `--self-test` red fixtures, four-arm successor check (T-164.7-02; type and separator as separate predicates), IN-01 banner, IN-02 symlink/case, IN-03 multi-marker, UTF-16 BOM and NUL measureFail (separate tests); corpus stays 0 / 12; sixteen-row individual neuter matrix + the nine-criteria proof table

### Phase 164.8.4: GATERESIDUE — every deferral Phase 164.8.2's four review rounds produced: the shared-TEST credential channels that still reach a public log, the artifact that publishes the file it refuses over, and the gate-integrity leftovers each below the bar that blocked the ship (INSERTED)

**Goal:** Discharge every deferral Phase 164.8.2 produced, and — by founder decision 2026-09-12 — Phase 164.8.6's `[164.8.5-HYGIENE-RESIDUALS]` and — by founder decision 2026-09-13 — Phase 164.8.3's `[164.8.3-CAPTURE-MANIFEST-ERREXIT]`, both of which are the same defect class. Nothing else. Four review rounds over that phase's own fixes found ten items that were each, individually, below the bar that would have blocked the ship (⭐ **2026-09-18: FOUR of those ten are now CLOSED** — two by the 2026-09-17 SCOPE PRUNE and two by branch `chore/164.8.2-verification`; the live scope is group (a)'s three credential-channel items plus group (b)'s ONE) — and the reason they are one phase rather than ten TODOS lines is that **eight of them are the same defect**: a control narrower than the sentence beside it. 164.8.2 proved three times over that fixing the instance a reviewer named, rather than the class, produces a half-class that the next round finds again.

⭐ **THE FENCE HAS BEEN WIDENED TWICE, DELIBERATELY — THIS IS THE RECORD.** The goal read *"and nothing else"* and that phrasing was meant. It now admits exactly TWO further items, each on the merits and never as a convenient parking space.

**ADMISSION 1 — `[164.8.5-HYGIENE-RESIDUALS]`, routed out of Phase 164.8.6 (founder decision, 2026-09-12):**

- **It is "a control narrower than the sentence beside it".** `tokenMeasure`'s printed rule asserted *"No prose is written that way"* into a PUBLIC Actions log while firing on prose.
- **It is the half-class recurrence this phase exists to stop.** TWO fix rounds, each closing the instance a reviewer named and each producing a class the next round found: the whitespace split closed the wide false positive, opened a FALSE-NEGATIVE band (an assembled credential whose whitespace-free segment is 28-31 characters is now SILENT where it previously fired), and left a residual false positive that two independent reviewers then re-found.
- ⛔ **The measurement that says REDESIGN, not a third repair:** `8 of the 14` committed PROD cron commands ALREADY carry the rule's positive signal — a ≥32-char digit-free whitespace-free token (`public.compute_bridge_outcome_deltas();`, `enqueue_poll_allocator_positions_for_all_keys(`, `retention_notification_dispatches:` …). The ONLY thing separating them from an hourly `cron-secret-in-command` is the `fromConcat` waiver, which is the mechanism both reviewers found broken: it is set per CHAIN and inherited by every whitespace token, so a token lying wholly inside ONE operand receives a waiver it never earned.
- **Carry these forward rather than re-deriving them:** the per-token-vs-per-chain distinction; the 31/32 boundary (NO fixture pins it); `BUILDERS` joining arguments with NO separator, fusing seam words into a token the split cannot see; and that the four green prose rows added as controls have longest words of 9/9/10/17 characters, so they cannot reach `TOKEN_MIN` on a single token BY CONSTRUCTION.

**ADMISSION 2 — `[164.8.3-CAPTURE-MANIFEST-ERREXIT]`, routed out of Phase 164.8.3 (founder decision, 2026-09-13):**

- **It is "a control narrower than the sentence beside it" — this entry's own stated defect class, verbatim.** `src/__tests__/prod-prober-wiring.test.ts`'s branch scan filters candidate lines on `l.startsWith("node scripts/prod-prober/run.mjs") && l.includes("$RUNNER_LOG")`. The capture-manifest step writes to `--out "$RUNNER_TEMP/…"`, never to `$RUNNER_LOG`, so it sits outside that gate's coverage **by construction** while the gate's own criterion-8 pin reads as though the workflow's status-capture shape is policed.
- ⛔ **It is a TRAP, not a live defect, and must not be planned as a bug fix.** GitHub's default `/usr/bin/bash -e {0}` terminates the step with the same status the next line would have captured, and nothing sits between the call and the capture — so the observable outcome is identical today. Inserting any line between them silently changes the step's behaviour, and whoever inserts it will be reading a `status=$?` that looks like it works.
- ⛔ **The forbidden half-fix, named in advance:** widening the criterion-8 `|| status=$?` count from 2 to 3 WITHOUT widening the branch scan past its `$RUNNER_LOG` filter. A count that rises without a scan that reaches the new site is a gate claiming coverage it does not have — which is this milestone's own named defect class and the exact shape 164.8.2 produced three times.
- **Found by** Phase 164.8.3 RESEARCH, whose verdict was *"Dead code, not a defect — book it, do not fix it here"*; `.github/workflows/prod-prober.yml` is byte-unchanged by that phase. Its measurement, its by-symbol anchor and its remedy shape live in the TODOS entry and are NOT restated here.

⚠️ **STILL NOT A PRECEDENT.** A THIRD outside item may be admitted only by the same explicit decision, recorded the same way. Two admissions is a pattern worth watching, not a policy: if a fourth candidate appears, the right answer is a new phase, not a third widening.

⛔ **The evidence, the measurements and the forbidden remedies live in each TODOS entry and are NOT restated here.** Every id below carries its own dated measurement, and several carry an explicit *do not close it this way* — read them before planning.

**What this phase owns, grouped by the sweep that discharges it:**

**(a) Credential channels that still reach a PUBLIC log** — plan as ONE sweep over every psql site, never site by site; that is how this became a half-class twice.

- `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]` — the `missing`-direction ledger read has no redirect at all, so psql's connect and auth failures put the shared-TEST pooler host and user into a world-readable Actions log, against that file's own NON-NEGOTIABLES. The correct idiom (capture, count, WITHHOLD) already exists three screens below in its sibling read.
- `[164.8.2-REDACT-HOSTNAME-01]` — a routing WORD that was never a routing RECORD: cited in comments and the changelog as booked, measured 2026-09-10 as **0 hits** in TODOS and the ROADMAP. The gap behind it is real — four psql sites can still print a DNS-failure hostname.
- `[164.8.2-EVIDENCE-DOTENV-LEAK]` — a local wrapper's `bun` shebang auto-loads `.env.local` into the child `vitest`, flipping `HAS_LIVE_DB` true and turning 16 SKIPPED live-DB suites into real INSERTs against shared TEST. ⛔ Not closable by editing the skip gates; they are correct.

**(b) The artifact publishes what it refuses over** — a founder decision with a real cost on both sides, not a patch.

- ✅ **`[164.8.2-REFUSAL-STILL-PUBLISHES]` — CLOSED 2026-09-18 on branch `chore/164.8.2-verification`. NOT work for this phase any more.** The artifact-staging step is now DEFAULT-DENY: the four script `.sql` files stage only when `refuse_credential_in_published_sql` wrote `credential-scan.ok`, and `ledger.csv`/`schema-before.sql` only when the backup scan wrote `backup-scan.ok`. Six files, one rule.
  ⛔ **The entry framed this as a binary and the binary was false** — withhold the file vs lose the reversal recipe (`T-164.8-21`). The third option costs neither side: the scan sits between `build_transaction` and `run_transaction`, so every path the gate denies is a path on which the transaction NEVER RAN, the database is untouched, and no reversal is owed. The file is not deleted; it is simply not published.
  **Verified three times independently** — the orchestrator (neutering `backup_ok=0` to `1` reds a named arm), `/gsd-secure-phase`'s auditor (SECURED, 24/24), and the phase re-verification (`passed`, 6/6).
- `[164.8.2-CHANNEL-ALLOWLIST-STALE]` — **the ONE item group (b) still owns.** Replacing a glob with an enumerated list was the right direction and bought a new failure mode: a channel added later is silently ABSENT. Fix by DERIVATION (channels the script can write ⇔ channels the step stages), not a second hand-maintained list.
  ⚠️ **Measured CLEAN 2026-09-18 by `/gsd-secure-phase`'s auditor — 6 writer names = 6 staged names — and that changes nothing.** It is clean by coincidence of what the two lists happen to hold today, not by construction, which is precisely what the entry says. A hand-maintained list that agrees with its source right now is the state this defect always passes through on its way to disagreeing.

**(c) Gate-integrity leftovers** — controls narrower than their own claims.

- `[164.8.2-SENTINEL-GREP-NUL-BLIND]` — the ancestry sentinel is read with a NUL-blind `grep -q`, and the check is NEGATIVE, so it **fails OPEN**, letting through the false "is not an ancestor" that three fixes exist to delete. ✅ Already held as a CEILING: it is the `-a` rule's ONE dated exemption and the rule reds if the site is fixed without deleting the entry.
- `[164.6-SOURCE-ANCHOR-ROT]` — `plan-anchor-verify` guards PLAN.md anchors; NOTHING guards `file:line` anchors in source comments, which rot faster. ~30 across the touched files, several dead, one already dead on `main`. ⭐ Deliverable is a GATE, and its message should say to prefer a SYMBOL over a re-pinned number.
- `[164.8.2-GATE-RESIDUE]` — seven small items in one sweep over one file family: two assertions bound to text this repo does not control, a softening allowlist that is still a COUNT, hand-copied marker regexes pinned to nothing, a computed-but-never-compared floor, a README describing files the denial path does not stage, a dead local and a misdirected message.

**(d) Carried in, because leaving it unowned a second time is the failure this phase exists to end.**

- `[164.8.3-CAPTURE-MANIFEST-ERREXIT]` — NOT 164.8.2 residue; admitted 2026-09-13 (ADMISSION 2 above). One step in `.github/workflows/prod-prober.yml` — the one whose `- name:` key is `Capture the cron manifest (read-only; artifact, never a commit)` — still carries the pre-`604d655f` status-capture shape that `-e` makes unreachable, and no gate can see it because the wiring test's branch scan filters on `$RUNNER_LOG`. ⛔ Cited BY SYMBOL, never by line number: `[164.7-CITATION-DRIFT-01]` is owned by this same phase.
- `[WINDOWS-LEDGER-DRIFT]` — NOT 164.8.2 residue. Logged 2026-09-02 in Plan 164.4-00 and carried with **no owner, no date and no gate for eight days**. `.planning/WINDOWS.md` refuses every append while its frontmatter counts and its entries disagree. It fits here because a ledger that rejects writes because its own header is stale is a control disagreeing with the thing it describes.

⛔ **SCOPE PRUNE 2026-09-17 (founder decision) — this phase keeps groups (a) and (b), and drops
group (c) and the two items in (d).**

**The rule applied** (founder, 2026-09-15): a deferral earns a phase ONLY when it pins
DATA-INTEGRITY or USER-FACING behaviour; a structural predicate, a log line's wording, a comment's
accuracy or an internal counter is fix-or-drop. *"Otherwise we will always find something."*

**KEPT — (a) and (b) are not hygiene by any reading:**

- (a) is credential disclosure into a WORLD-READABLE Actions log, plus
  `[164.8.2-EVIDENCE-DOTENV-LEAK]`, which turns 16 SKIPPED live-DB suites into **real INSERTs
  against shared TEST** — other people's CI database. That is data-integrity, not gate hygiene.
- (b) publishes the `.sql` file the restore REFUSED over, on exactly the run whose restore was
  refused.

**DROPPED — (c) "gate-integrity leftovers", by the group's own description:**
`[164.6-SOURCE-ANCHOR-ROT]` (≈30 `file:line` anchors in SOURCE COMMENTS rot; the deliverable is a
gate over comment accuracy), and `[164.8.2-GATE-RESIDUE]`'s seven items (two assertions bound to
text this repo does not control, a softening allowlist that is still a count, hand-copied marker
regexes pinned to nothing, a computed-but-never-compared floor, a README describing files the
denial path does not stage, a dead local, a misdirected message). Every one is a structural or
prose predicate.
✅ **`[164.8.2-SENTINEL-GREP-NUL-BLIND]` — CLOSED 2026-09-18 BY ITS OWN SELF-EXPIRY, which is the
outcome the ceiling was built for and is no longer a live carve-out.** The paragraph here used to
read "NOT dropped and needs no work here", holding it as the `grep -a` rule's one dated exemption
that would red if the site were fixed without deleting the entry. The site gained `-a`; the ceiling
arm went RED with `STALE EXEMPTION (matched 0 bare grep(s))`; the entry was DELETED rather than
waived. `BARE_GREP_EXEMPTIONS` is now EMPTY and the `-a` rule is unconditional workflow-wide
instead of post-verify-scoped. An exemption that expired exactly as designed is the mechanism
working, not a deferral.

**DROPPED — (d), both items:**

- `[164.8.3-CAPTURE-MANIFEST-ERREXIT]` — its own text settles it: *"⛔ It is a TRAP, not a live
  defect, and must not be planned as a bug fix… the observable outcome is identical today."*
  Keep the WARNING in place (inserting a line between the call and the capture silently changes
  the step), but a warning is prose, not a phase.
- `[WINDOWS-LEDGER-DRIFT]` — `.planning/WINDOWS.md` refusing appends on a stale header is a
  planning-ledger bookkeeping fault. Fix it when it next blocks a write; do not carry a phase for
  it. It is the same item Phase 164.6 carries as criterion 14, now dropped there too.

**DROPPED — Success Criterion 5**, the four `[164.8.4-PROSE-OVERCLAIM]` sentences: correcting
prose to match what the code does is the definition of the fix-or-drop side. Criterion 6 (verify
by MEASUREMENT, not by reading) stays as a METHOD for the surviving work.

**Success Criteria**:

1. The class-lint's file set is DERIVED from its own scope sentence, or the sentence is derived from the set — one of the two, so a fourth axis (depth, extension, location, symlink) cannot open without something going red. ⛔ A third hand-widening that closes only the depth axis does NOT satisfy this.
2. A calibration proves the mechanism by opening a new axis on a scratch tree and observing RED — not by asserting today's count.
3. The two inline degeneracy demonstrations are routed through `degenerateNarrow`, and an arm asserts no NEW inline demonstration can be added outside it without being reported.
4. Either the helper file is policed again, or a stated, dated reason records why one 79-line single-function file does not need it — ⛔ not silence.
5. Every one of the four `[164.8.4-PROSE-OVERCLAIM]` sentences is corrected to what its code actually does, with its regenerating command beside any number.
6. Each correction is verified by MEASUREMENT at HEAD, not by reading — six rounds on this branch established that a restated claim is the defect class itself, and two of them were corrections that were themselves wrong.
7. ⛔ Nothing in this phase widens `WAIVED_CEILING`, relaxes a floor, or adds an exemption to make a gate pass. Every item here is closed by making a claim true, never by narrowing what is claimed — except where narrowing IS the honest answer, in which case the narrowing is dated and reasoned in-code.

1. Every psql site in `test-ledger-drift-check.sh`, `test-restore-from-baseline.yml` and their shared redaction is swept in ONE pass, with a test that FAILS on a new unredirected site — not a fix to the three known ones.
2. The `gstack-evidence` credential inheritance is closed at the wrapper, with the skip gates untouched, and proven by a run whose skip counts match a plain `npx vitest run` at the same commit.
   ⭐ **DEVIATION, RECORDED 2026-09-19 — shipped at the BOOTSTRAP, not at the wrapper.** The literal
   wording above is not what landed, and the reasoning lives in `164.8.4-CONTEXT.md`; it is repeated
   here because this repo requires a deviation to be recorded in BOTH places, and a criterion whose
   text disagrees with what shipped is how a future reader concludes the phase missed.
   **WHY:** `gstack-evidence` has NO repo-local copy — it exists only under the global skills
   directory and `/gstack-upgrade` overwrites it, so a wrapper edit is un-reviewable, un-testable
   and erased by the next upgrade. The guard instead sits in the vitest bootstrap
   (`src/test-setup.ts`, `assertLiveDbWasIntended`), which is repo-owned, covered by tests and
   survives an upgrade. The skip gates were left untouched as the criterion requires, and the
   skip-count parity proof was taken as written. ⚠️ The guard is loaded by `vitest.config.ts` and
   `vitest.local-stack.config.ts` only; the two lanes it does not cover are booked in TODOS.md as
   `[164.8.4-LIVEDB-GUARD-LANE-GAP]`.
3. The refuse-vs-withhold tradeoff is DECIDED by the founder and the decision is recorded with its cost on both sides — not silently patched either way.
4. The channel allowlist is DERIVED, and a calibration proves a newly written channel reaches the artifact without anyone editing a list.
5. A source-comment anchor gate exists, fails loud on a dead anchor, and its message names the symbol-over-line-number preference.
6. `[164.8.2-SENTINEL-GREP-NUL-BLIND]`'s exemption entry is DELETED, and the `-a` rule goes red if it is re-added.
7. `.planning/WINDOWS.md` accepts an append, and the mechanism that made its counts drift is closed rather than the counts hand-corrected.
   ⚠️ **HAND-OFF 2026-09-10 (Phase 164.7 plan 06) — part of the mechanism was already removed, so do NOT go looking for it.** Two things happened to this file that day and they are DIFFERENT in kind:
   (a) ⭐ **A REAL DEFECT, already fixed:** the frontmatter carried **TWO `last_updated:` keys**, and the LATER timestamp came first. A YAML parser takes the LAST occurrence, so the ledger reported a value OLDER than its true last edit — a duplicate key that silently loses the newer write is a plausible member of "the mechanism that made its counts drift". Collapsed to one key. ⛔ A planner re-deriving this criterion must READ the frontmatter at HEAD rather than assume the duplicate is still there; it is not, and hunting it will waste a round.
   (b) **NOT a drift correction, and must not be counted as one:** `open_count` 37 → 36 and `fixed_count` 11 went with entry 25 being dispositioned `open` → `fixed` from measurement (VAC-04's first real-PROD execution, run 34146946050). That is the ledger's normal bookkeeping working, not a count being hand-repaired to match reality. `total_count` stayed 47.
   ⛔ **The criterion still stands as written.** Nothing above closes it: whether an APPEND is accepted without a rewrite, and whether the counts can drift by any other route, is unmeasured. What changed is only that one candidate cause is gone and one apparent count change has an innocent explanation on record.
8. Every one of the seven `[164.8.2-GATE-RESIDUE]` items is either fixed or has a recorded, dated reason for staying — ⛔ an unaddressed item silently dropped from the list is this phase's own defect class.
9. The prober wiring test's branch scan REACHES the capture-manifest step, and the criterion-8 status-capture count moves in the SAME edit that widens the scan. ⛔ Neither alone satisfies this: a widened count over an unwidened scan is the coverage overclaim this phase exists to end, and a widened scan whose count still reads 2 goes red for the right reason and must not be cleared by narrowing the scan back. A calibration reverts the fixed step to its `-e`-unreachable shape and observes RED.
10. ⭐ **ROUTED IN from Phase 164.6.2 plan 04's decision checkpoint (founder, 2026-09-14): `[164.6.2-PLAN04-GATE-INTENT-DRIFT]` — THREE verify instruments whose literal predicate diverges from the property they claim to hold, all MEASURED by running them, none worked around.** (a) **`PROBER-OBSERVATION-RECORDED` counts CITATIONS, not the OBSERVATION.** It requires two or more run references and exists to prove a POST-RESTART prober dispatch was taken; the record carried four legitimate references (one baseline dispatch, two scheduled baselines, one prior-outage citation) and NO post-restart run at all, so the leg printed `OK (7 run refs)` while its stated intent was unmet. ⛔ A gate for an observation must count the observation. (b) **The prober self-test leg cannot pass at its own stated green baseline.** The leg is `grep -qE 'SELF-TEST PASSED: N/N' && ! grep -qi 'FAILED'`; MEASURED on byte-unmodified files the self-test is GREEN (`SELF-TEST PASSED: 80/80`, exit 0) yet `grep -ci 'FAILED'` returns **3**, every hit an `ok — ` PASSING assertion label quoting `initialize() failed` / `a failed psql` — two of the three being Phase 164.8.3's own (h1)/(h3) legs, whose text must contain the word. The negative predicate must key on a FAILURE MARKER the harness emits, not on an English word its passing labels quote. (c) **A documented exit code that does not match the shipped one:** 164.6.2-04-PLAN.md's `<measured_baseline>` states a narrowed `-f arm=<name>` dispatch "exits 2 BY DESIGN"; MEASURED it exits **1**. The prohibition (never read the exit code as the verdict) is unaffected and stays — the documented NUMBER is simply wrong, and a reader checking for a `2` will not find one. ⛔ All three are in this phase's declared kind — gate-integrity leftovers — and none is a regression: the instruments were `cmp`-proven byte-identical to their pre-edit backups when measured.

⭐ **FOLDED IN 2026-09-10 — Phase 164.8.5 SCOPEAXIS was created for these five and then withdrawn.** It was opened on a misreading of the founder's stopping rule: that rule was CONDITIONAL on the terminal review round still finding cardinal errors, and it found none. The every-deferral-names-a-phase rule still applied, but the home it required had been created twenty minutes earlier — THIS phase. Two phases for one set, split on a line between "deferrals" and "review-round findings" that does not survive inspection: both are unfinished work from 164.8.2. Recorded rather than quietly deleted, because an over-applied rule is worth the same note as a skipped one.

**(e) What SIX review rounds left behind — none CARDINAL.** The terminal round (2026-09-10, red team + silent-failure-hunter, both re-deriving the shipped logic over all 874 test files rather than reading it) found no control that cannot fail, no assertion vacuous today, no gate green over an empty corpus. These are what it DID find.

- `[164.8.4-SCOPE-DEPTH-AXIS]` — LATENT. 144 test files under `src/__tests__`, 139 scanned. Zero offenders in the 5 unscanned files TODAY, so today's green is true.
- `[164.8.4-DEMOS-OFF-HELPER]` — LATENT. This branch planted two fresh copies of the offending expression, as deliberate calibration subjects, in exactly the two files the docblock names as the next widening step — and neither routes through `degenerateNarrow`, which exists precisely so demonstrations live outside the surface. ⛔ When the widening lands and reds them, the reflex will be to restore the tolerance this branch just deleted. Route them through the helper INSTEAD.
- `[164.8.4-HELPER-UNPOLICED]` — LATENT. `src/test/helpers/degenerate-narrow.ts` left the scanned surface entirely; a second exported helper added there would be policed by nothing. 79 lines, one function, so the blast radius is small — but the deletion that removed the tolerance also removed the only thing watching the rest of that file.
- `[164.8.4-PROSE-OVERCLAIM]` — COSMETIC, four sentences that describe more than the code does: a seam docblock naming a relaxation that would NOT red (its self-test pins a different, genuinely load-bearing property, verified); a sentence stale by one commit on the same branch; a tautological illustration beside three load-bearing legs; and a `SCAN_FILES.length > 130` floor over an actual 139 that would let nine files be deleted silently.
- `[164.8.4-COMMENTISH-FALSE-RED]` — REACH. The whole-directory floor's `commentish` test would false-RED on a legitimately blanked docblock continuation line not starting with `*`. Measured 0 across all 139 files, and it fails in the LOUD direction.

⭐ **`[164.8.4-SCOPE-DEPTH-AXIS]` is the one worth planning first, because it is the THIRD recurrence of one shape on one branch:** a scope sentence outrunning the filter beneath it. 2 files while claiming a class; then 137 while skipping 346 `.test.tsx`; now 139 while `readdirSync` — non-recursive — skips 5 by directory depth. Each fix closed the axis it was SHOWN and left the next. ⛔ **The deliverable is NOT a third widening** but a mechanism making the scope claim and the file set agree by construction, proved by opening a new axis on a scratch tree and observing RED.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries `[164.7-MARKER-GREP-VACUOUS]`, `[164.7-PLAN03-EVIDENCE-01]` (plan 03's lane evidence is not re-derivable from the artifacts it left — a provenance gap, not a contradicted claim), `[164.7-CITATION-DRIFT-01]` (⭐ close it by CONVENTION — cite by SYMBOL, not by line — not by re-numbering prose that will drift again), `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]`, `[164.8.2-REDACT-HOSTNAME-01]`, `[164.8.2-EVIDENCE-DOTENV-LEAK]`, `[164.8.2-REFUSAL-STILL-PUBLISHES]`, `[164.8.2-CHANNEL-ALLOWLIST-STALE]`, `[164.8.2-SENTINEL-GREP-NUL-BLIND]`, `[164.6-SOURCE-ANCHOR-ROT]`, `[164.8.2-GATE-RESIDUE]`, `[WINDOWS-LEDGER-DRIFT]` and `[164.8.3-CAPTURE-MANIFEST-ERREXIT]` — read each before planning, do not re-derive.
**Depends on:** Phase 164.8.2 (this is its residue). ⚠️ **Cross-phase coupling, deliberate:** `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` is NOT owned here — it stays with Phase 164.9's `[164.8-PUSH-RACE-VAC08]` because they share one root (two jobs contending for advisory key `61616158` on shared TEST) and splitting them would produce exactly the sequential-ratchet-patched-in-one-place hazard this repo has already paid for once.
**Plans:** 5 plans

Plans:
**Wave 1**

- [ ] 164.8.4-01-PLAN.md — the shared psql-stderr redaction definition (union of all six expressions), wired end-to-end at the one call site whose job runs with a non-root working-directory, with a per-expression falsifier (wave 1)
- [ ] 164.8.4-03-PLAN.md — `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]`: capture, count and WITHHOLD the `missing`-direction ledger stderr, reusing the sibling arm's idiom verbatim (wave 1)
- [ ] 164.8.4-04-PLAN.md — `[164.8.2-EVIDENCE-DOTENV-LEAK]`: a fail-loud repo-side `HAS_LIVE_DB` inheritance guard in the vitest bootstrap, skip gates untouched, plus the SC-2 skip-count parity measurement (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 164.8.4-02-PLAN.md — convert the remaining seven inline blocks, close the third leak shape (the two `sql-tests` capture-then-`cat` sites), and ship the survivor / capture-ordering / marker-collision gates (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 164.8.4-05-PLAN.md — `[164.8.2-CHANNEL-ALLOWLIST-STALE]`: derive the diagnostic-channel set from both producers' declared write targets and delete the hand-typed list (wave 3)

### Phase 164.8.3: PROBERAUTH — the prod-prober names MT5 `-6` as what it is (the terminal has no authorized account) instead of collapsing it into the catch-all `mt5-terminal-error` whose remedy sends the operator to an error table (INSERTED)

**Goal:** The prober's MT5 arm gives a dedicated defect kind to `-6`, so the five consecutive red `prod-prober` runs since 2026-09-07 say what is wrong and what to do. Today only `-10004` and `-10005` get their own kinds; everything else falls into `mt5-terminal-error`, whose remedy tells the operator to "read the reported code against the MT5 error table". `-6` has exactly one cause and exactly one remedy, so that instruction is the whole defect.

⛔ **This phase does NOT clear the live outage.** The terminal has no authorized account; restoring it needs a VNC session and broker credentials and is a founder action. This phase makes the NEXT occurrence self-explanatory. Do not treat a green prober as this phase's acceptance signal — it is not in this phase's gift.

✅ **NAMED OWNER OF THE `-6` VOCABULARY — founder decision 2026-09-13.** Phase 164.6.2 MT5RELOGIN carried a duplicate "-6 is named as itself" criterion and a matching line in its title and goal; all three were struck and **deferred here**, with 164.8.3 recorded as the owner. ⭐ **Why this direction:** this phase depends on Phase 164.1, which the ROADMAP states "owns the prober's MT5 arm and its defect vocabulary", and — decisively — **this phase is closeable without the founder while 164.6.2 is not** (164.6.2's load-bearing criterion 2 is an OBSERVED restart self-heal after the founder sets Railway variables). Parking the naming there would have held a code-only fix behind a human gate. ⛔ **The first reading got this backwards** and proposed folding this phase INTO 164.6.2, having read only criteria 1-2 of the eight below; the six beyond them — registered red fixture, the catch-all surviving as a meaningful bucket, the `mt5-diag.sh` READ-ONLY fence, the falsifier observed RED, `terminal_info()` as two booleans, and `--arm` publishing its own output — would have been buried in a login phase. Recorded so the reversal is a decision and not drift.

⚠️ **STILL FIRING, MEASURED 2026-09-13** — `prod-prober` run [`34758502223`](https://github.com/AI-Isaiah/Quantalyze/actions/runs/34758502223) at repo `f10b0e2`: `arms: 4/4/0` (none credential-blocked), exactly one defect, `kind: mt5-terminal-error`, `subject: -6`, remedy *"Read the reported code against the MT5 error table … neither IPC remedy applies here."* That is this phase's target sentence, printing six days after the cause was identified and three days after the 2026-09-10 resolution — so the terminal has **lost its session again**, which is the recurrence 164.6.2 exists to stop. ⭐ **The prober is behaving correctly**: it refused to implicate IPC and said so explicitly, which is Phase 164.1 criterion 3 doing its job. The defect is the remedy text, not the detection.

⚠️ **MEASURED LIVE 2026-09-09 from this checkout, quoted so nobody re-derives it:**

```
$ ./scripts/mt5-diag.sh
PROBE {"initialize": false, "last_error": [-6, "Terminal: Authorization failed"], "terminal_info": null}
```

`-6` is `RES_E_AUTH_FAILED`. The rpyc bridge answered (a dead bridge gives `-10004`), so the terminal is up and un-authorized — not a transport fault. The `mt5-gateway` deploy log at the minute of each failing prober run (`34387586781`, `34366806167`, `34340209991`, `34315451286`, `34296899495`) contains ONLY VNC session lines (`SLAVE/8001 accepted/welcome/goodbye`) and no MT5 login attempt at all — the absence is the evidence.

**Success Criteria**:

1. **`-6` reports as its own kind, never as `mt5-terminal-error`.** The kind's detail states what was measured (the bridge answered; no account is authorized), not a code the reader must look up.
2. **The remedy names the action.** VNC to the gateway service, log the terminal back into the investor account with "Save password", and re-check the two Expert-Advisors options a login re-clears. ⛔ It must NOT route the operator to the MT5 error table — that instruction is what this phase removes.
3. **The new kind ships with a red fixture, registered in the arm's `kinds` list**, exactly as `10004.txt` and `10005.txt` are. ⛔ A remedy without a fixture is the vacuity class this repo ranks above correctness: the registry asserts kind coverage, so an unregistered kind is a control that measures nothing.
4. **`mt5-terminal-error` survives and keeps meaning something.** `terminal-info-null.txt` still maps to it — "the bridge answered and the terminal is the problem, cause not enumerated". Splitting `-6` out must not leave the catch-all empty, and the arm's own by-name absence assertions must still discriminate the two.
5. ⛔ **Scope fence — `scripts/mt5-diag.sh` stays READ-ONLY.** It calls `initialize()` + `terminal_info()` and never `login()`, because a login is an "account change" and MT5 re-clears `[Experts] Enabled` on every account change while `Account=1` is armed — a probe that authenticated would re-break the thing it measures (the recorded 2026-08-13 incident, where each diagnostic round re-disabled algo trading). ⛔ Do not close this phase by making the probe log in.
6. **Falsifier observed RED.** Neuter the `-6` branch, watch the fixture fall back to `mt5-terminal-error`, restore from pristine bytes. ⛔ Never `git checkout --` in the harness — it restores to HEAD and silently destroys uncommitted work.

7. ⛔ **`terminal_info()` is recorded as `connected` and `trade_allowed`, two separate booleans — not as present/absent.** MEASURED 2026-09-10: `scripts/prod-prober/arms/mt5.mjs:113-117` sets `out["terminal_info"]` to the string `"present"` or to `None`, and nothing else. Those are precisely the **two fields `docs/runbooks/mt5-go-live.md` Step 2 names as the verification** (*"`terminal_info()` must report **`connected: true` AND `trade_allowed: true`** — both, not either"*), and precisely the two that separate "the terminal is not connected to the broker" from "the terminal is connected but the account is not authorized". Because the probe collapses them, a `-6` cannot be attributed from the prober's output at all. ⛔ This is the gate weaker than the sentence beside it: the runbook states a two-field criterion and the instrument that is supposed to check it records neither field.

8. ✅ **MET BEFORE THE PHASE BEGAN — no code is owed. Restated 2026-09-13 rather than deleted, because the way this criterion was WRONG is worth more than the criterion was.** The requirement stands as written: the narrowed `--arm` diagnostic must PUBLISH what it measured. It already does.
   ⛔ **The original diagnosis named the wrong cause on the day it was written.** It said `--arm mt5` printed nothing "because the step redirects the runner into `$RUNNER_LOG` and the narrowed path neither prints it nor uploads it." But `cat "$RUNNER_LOG"` runs UNCONDITIONALLY outside both branches and `git log -L` dates that line to `42868a9b`, **2026-09-06 — four days before the measurement**. The cause was **errexit**: `set -uo pipefail` does not cancel the `-e` GitHub passes via `shell: /usr/bin/bash -e {0}`, so the untested `node … > "$RUNNER_LOG" 2>&1` terminated the step, taking `status=$?`, the `cat`, the `^❌` summary and the POSTURE LINE with it. The OBSERVATION (`no arm output`) was correct; the mechanism was not.
   ⭐ **Settled from the run LOG ARCHIVE, never `gh run view --log`** — that view TRUNCATES and returned every step as `UNKNOWN STEP`. Archive of run `34497471175` shows the step's complete runtime output as two lines: the `NARROWED DIAGNOSTIC dispatch of arm mt5` echo, then `Process completed with exit code 1`.
   ✅ **Fixed by `604d655f` (PR #774, Phase 164.8.5, 2026-09-11) in BOTH branches**, and proven by narrowed dispatch `34706551355` on 2026-09-12, which printed the full arm output including `mt5: initialize=true last_error=1 connected=true trade_allowed=true build=6182`. A regression pin for the `--arm` branch already exists at `src/__tests__/prod-prober-wiring.test.ts:349-363` and `:391-408`.
   ⛔ **Do NOT add the artifact upload this criterion offered as an alternative.** Shipping a change whose justifying defect was fixed two days earlier is the vacuity class this milestone exists to remove. **The phase ships SEVEN live criteria.**

⚠️ **DATED 2026-09-10 — the second time this remedy cost real debugging time, and the root cause is now on record.** The founder hit `-6` again and worked it with the assistant. What the remedy sent them to (the MT5 error table, "the fault is inside MT5 itself") was not where the answer was. The answer was in the terminal's own **Journal**, and it was unambiguous:

```
2026.09.07 04:05:03  '26547876': disconnected from VantageMarkets-Live 5
2026.09.07 04:05:08  '<key A>': authorization on VantageMarkets-Live 14 failed (Invalid account)
2026.09.10 15:48:25  '<key A>': authorization on VantageMarkets-Live 14 failed (Invalid account)
```

The terminal dropped a working session and re-attached to an account it could not authorize, then failed identically for three days. Resolved 2026-09-10 ~16:10Z by re-entering valid credentials — `authorized on VantageMarkets-Live 14 through AS05 (ping: 6.97 ms)`, `investor mode` on both trading and balance management. Verified by prober run `34500455961`, whose `Open or update the prod-prober issue` step was **skipped** (that step is gated on a `^❌` line, so skipped ⇒ zero defects); issue #753 closed. ⭐ **Criterion 2's remedy text should name the Journal explicitly** — it is the one place that distinguishes "invalid account" from "no connection", and neither the prober nor `mt5-diag.sh` can currently tell them apart.

**Requirements**: TBD (no v1.20 requirement IDs) + GitHub issue #753 (`prod-prober` red since 2026-09-07) + ⭐ **ROUTED HERE 2026-09-11 — `-6` is CONFIRMED LIVE, with the instrument now trustworthy.** The first prod-prober run after Phase 164.8.5 landed (run `34609247983`, head `62d2af8b`) reported `mt5-terminal-error / mt5 / -6` with exactly the remedy this phase exists to remove: *"Read the reported code against the MT5 error table."* ⚠️ **What changed is the EVIDENCE, not the finding.** Before 164.8.5 the probe STEP was dying — 5 of the 6 hourly runs to 2026-09-11T10:16 concluded `failure` without a defect table, so a `-6` in that window could not be distinguished from the prober falling over. That run printed `self-test 78/78`, `arms: 4/4/0` (none credential-blocked) and `seam-invocations: 9` BEFORE the table, so the `-6` is now a MEASURED live reading rather than an inference from a red check. ⛔ Do not re-derive the five-red-runs claim from the run list alone: those reds and this one have different causes.
**Depends on:** Phase 164.1 (owns the prober's MT5 arm and its defect vocabulary)
**Plans:** 4/4 plans complete

⛔ **FULLY SEQUENTIAL — waves 1→2→3→4, no parallelism, and that is a finding rather than a default.** Every plan touches at least one of `scripts/prod-prober/arms/mt5.mjs`, `scripts/prod-prober/run.mjs` or `src/__tests__/prod-prober-wiring.test.ts`, and the scenario-count pair (`run.mjs:149` ↔ `prod-prober-wiring.test.ts:1822`) moves twice, so any two plans sharing a wave would race on the same literal. Plan 04 additionally carries a NON-FILE coupling: its recorded neuter MUTATES `arms/mt5.mjs` on disk and restores it, so it must never share a wave with plan 03, which owns that file — file-disjointness in frontmatter is not isolation when a harness temporarily edits the tree.

Plans:
**Wave 1**

- [x] 164.8.3-01-PLAN.md — TRACER: the `mt5-not-authorized` kind wired end-to-end (fixture `6.txt` → branch (6b) → remedy → five registrations → counters), plus the auto-issue dedup-key proof and criterion 8's MET-at-HEAD pin (C1, C2, C3, C4, C8; D-01, D-02, D-03, D-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 164.8.3-02-PLAN.md — the criterion-2 row scenario (four required words + the calibrated negative + the account-number scan) and both by-name ABSENCE lists extended (C2, C4; D-03, D-04)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 164.8.3-03-PLAN.md — `terminal_info()` recorded as two booleans exactly, the `"present"` sentinel retired, `build=` dropped from the info line, `ok.txt` rewritten (C5, C7; D-05)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 164.8.3-04-PLAN.md — the falsifier: a durable tmp-dir mutant that re-runs every shard, plus two on-disk levers observed RED alone and restored from bytes, plus one booked deferral with a named owner (C6)

### Phase 164.8.2: GATEHARDENING — the five code-review warnings Phase 164.8 shipped: the VAC-08 frontier exemption gets a ceiling, the ledger drift-check gets an arms ratchet, the reverted-grep stops being NUL-blind, the destructive restore's artifact stops carrying unredacted policy text, and the softening-token scan reaches the workflow that can drop a schema (INSERTED)

**Goal:** Close the five Warnings `gsd-code-reviewer` raised against Phase 164.8's own gates. Every one is a control that is weaker than it reads, and two of them are the SAME shape: the phase hardened one half of a twin pair and left the other. None was user-facing or data-integrity, so none blocked the ship — they are booked here rather than fixed under merge pressure.

⛔ **INSERTED 2026-09-09 at Phase 164.8's review gate.** The sixth Warning, WR-01, is NOT here: it was a proven-live command substitution in a script that assembles `DROP SCHEMA public CASCADE`, so it was fixed in 164.8 itself (`ec94788b`) with arm 26 legs (f) and (g). The five below are real but not acutely exploitable.

⚠️ **Read the review before planning, do not re-derive:** `.planning/phases/164.8-testpreprod-test-becomes-a-real-pre-prod/164.8-REVIEW.md` carries each finding with its file:line, its failure scenario and the reviewer's own measurements. Seven Info findings are in the same file and are in scope for whoever plans this.

**Success Criteria:**

1. **WR-02 — the VAC-08 frontier exemption gets a ceiling.** `scripts/test-ledger-drift-check.sh:425-476`. Today the exemption is unbounded: one failed TEST apply (the booked `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`) leaves every later migration above the tip, so every one is exempted and the ledger-presence ratchet prints `0 NEW drift` indefinitely. Branch protection is deferred, so the bad merge stands. The fix needs a bound whose breach is LOUD.
2. **WR-03 — the same script gets an arms ratchet.** `:815-819` has no `EXPECTED_ARMS`, so deleting an arm reads as a smaller PASSED. The three frontier arms are exactly the ones a cleanup would take, which would leave criterion 1 unarmed. ⭐ The sibling `restore-test-from-baseline.sh` already carries the correct shape — conform to the neighbour, do not invent a second one.
3. **WR-04 — the reverted-grep stops being NUL-blind.** `.github/workflows/supabase-migrate.yml:858` is a NEGATIVE check without `-a`. This repo has a MEASURED rule that grep goes silently blind on a file the locale calls binary and that exit 1 then reads as clean. One byte from `supabase migration list` and `apply` pushes to PROD on a check that never read the file.
4. **WR-05 — the destructive restore's artifact stops carrying unredacted text.** `.github/workflows/test-restore-from-baseline.yml:1407-1411`. Seven script-written files reach the world-readable artifact through neither the secret scan (which runs BEFORE they are written) nor the redaction (whose globs are `*.err/*.log/*.out`). `pre-census.txt` carries reconstructed `CREATE POLICY … USING (<qual>)` and owner-named rows read off live shared TEST. ⛔ The step comment currently states the opposite scope — fix the comment with the code, or the next reader inherits the same false assurance. ⛔ **AMENDED 2026-09-09, and this was not foreseen when the area was decided:** `survivors.sql` IS the reversal recipe AND carries the policy DDL — it is `awk '$1=="survivor" {print $4}'` of `pre-census.txt`, and column 4 is `pg_get_triggerdef(...)` plus a reconstructed `CREATE POLICY … USING (<qual>)`. Founder decision: the DDL appears exactly ONCE, in the file that needs it. `survivors.sql` STAYS; `pre-census.txt`, `post-census.txt` and the two `*-rollback-view.txt` files leave. That is the intent the script already booked as threat `T-164.8-21`. ⚠️ The review's count is wrong: **10 of 18** files pass through neither control, not seven — regenerate the list, do not carry either number.
5. **WR-06 — the softening-token scan reaches the workflow that can drop a schema.** `src/__tests__/test-restore-workflow-wiring.test.ts:210`. Phase 164.8 widened the scan 5 → 9 tokens for `supabase-migrate.yml` and left the DESTRUCTIVE workflow on the 5-token list. The asymmetry is backwards: the restore workflow is the one that cannot be undone by a re-run. ⛔ **SCOPE AMENDED 2026-09-09 — it is a TRIPLET, not a pair.** The pattern-mapper measured a third byte-identical 5-token copy at `src/__tests__/prod-prober-wiring.test.ts:93`, outside the review's file list. Fixing two of three members leaves the class intact, so the third is in scope. Taken without a new founder question because it is measured FREE: `prod-prober.yml` contains **0** occurrences of all four extra tokens, so no allowlist is needed there. The cost that does exist is `test-restore-from-baseline.yml`'s **11** `2>/dev/null` sites — that triage IS this criterion's work and was always in scope. (`supabase-migrate.yml` carries 6 and already ships the 9-token list; read how its twin tolerates them before copying.) ⚠️ Counts measured 2026-09-09 with `grep -cF` — regenerate, do not trust.
6. **Every fix carries a falsifier that was observed RED.** ⛔ Not negotiable here: four of these five findings are controls that pass while measuring nothing, so a fix without an arm that bites reproduces the exact defect class. Neuter, observe RED, restore from pristine bytes — never `git checkout --`.

**Requirements**: TBD (no v1.20 requirement IDs) + the five Warnings and seven Info findings in `164.8-REVIEW.md`
**Depends on:** Phase 164.8
**Plans:** 5 plans

Plans:

- [x] 164.8.2-01-PLAN.md — WR-03 arms ratchet then WR-02 `FRONTIER_EXEMPT_CEILING` in `scripts/test-ledger-drift-check.sh`, with vitest second layer + SC-9 registration (wave 1)
- [x] 164.8.2-02-PLAN.md — WR-04 `grep -a` on both C-0331 sites of `supabase-migrate.yml` with an executed NUL-fixture arm; IN-03, IN-04 (wave 1)
- [x] 164.8.2-03-PLAN.md — WR-05 artifact narrowing by an enumerated staging step (founder-amended set), four truthful comments, WR-04's two post-verify greps, IN-07 (wave 1)
- [x] 164.8.2-04-PLAN.md — WR-06 nine-token scan across the TRIPLET with an exact-set `2>/dev/null` allowlist (wave 2, after 02 and 03)
- [x] 164.8.2-05-PLAN.md — IN-06 MEASURE_FAIL wrap with a sourced-copy falsifier; IN-01, IN-02, IN-05 record corrections pinned by derivation (wave 2, after 03)

### Phase 164.5.1: CRONREPOINT — the live `match_engine_cron` row is repointed at the mechanism the repo actually describes, and the migration-vs-runbook rule is settled first (INSERTED)

⛔ **CARRIED IN 2026-09-12 BY FOUNDER DECISION — `[164.7-ACTIVATION-OWNED-HERE]`: this phase now OWNS the 161.1 ledger-refresh ACTIVATION, i.e. Phase 164.7 success criteria 3 and 4 AND Phase 161.1's ACTIVATION item, which are ONE live PROD operation named from two sides.** Until today it was routed from NEITHER side: 164.7 deferred it to its own plan 07 and 161.1 left it founder-gated with no owning phase, so the founder rule that every deferral names a PHASE was unmet in both ledgers at once. The founder was offered re-route / activate-now / a dedicated phase and chose **re-route, with the kill switch fixed FIRST**.

⛔ **ORDER IS LOAD-BEARING AND IS THE WHOLE REASON FOR THE ROUTING — do not reorder these three.**

1. **FIX THE KILL SWITCH FIRST.** `_engine_is_enabled()` (`analytics-service/routers/match.py:306`) is fail-OPEN **by documented design**: it returns `True` on ANY exception, and its own comment gives the rationale — *"Fail-closed would silently disable the engine on transient DB blips, which is a worse failure mode for a manual founder kill switch."* ⭐ **That rationale was written WITHOUT RETRY, and retry is what dissolves it**: with retry-with-backoff around the Supabase reads the guard can fail **CLOSED** after exhausting retries, which is no longer a blip. The same 504s from Supabase's API layer are the established root cause of the `match_engine_cron` 500s (`cron_recompute()` at `:1965`), so ONE change closes both. ⭐ **AND THE 504s ARE NOT RARE — MEASURED IN CI, 2026-09-12, while closing this very sweep.** PR #789 changes ZERO Python files and its `python` job still went RED: `tests/test_transition_rpc.py::test_legal_transition_succeeds` raised `postgrest.exceptions.APIError: {'message': 'JSON could not be generated', 'code': 504, …}` against shared TEST. Coverage was fine on the same run (`Required test coverage of 80% reached. Total coverage: 90.98%`), and the suite passes locally (5436 passed, 0 failed). ⚠️ It then CASCADED, exactly as `ci.yml`'s own comment predicts: `python` red made `sql-tests` **skip**, and the `frontend` aggregator correctly refused the skip — ONE transient 504 produced TWO red checks on a documentation-only PR. ⛔ This is the same failure mode as the fail-open kill switch, seen from the other side: the guard's rationale calls a 504 a *"transient DB blip"* and treats surviving it as the goal, but a blip that reddens unrelated CI and silently disables the only stop control is not something to survive by ignoring — it is something to RETRY and then fail CLOSED on. Treat this measurement as the motivating evidence, not as background. ⚠️ The closed state must carry a **DISTINCT status** — not a silent `disabled` — or a database outage becomes indistinguishable from a founder pressing the switch, which is a new silent failure in place of the old one.
2. **THEN ACTIVATE**, alongside this phase's own `match_engine_cron` repoint — the activation rides a PROD write this phase makes anyway. ⛔ It is NOT permitted to manufacture a PROD write for it; that is the same prohibition `VAC04-ARMS-OBSERVE` was held to, and it was honoured there.
3. **THEN PROVE** criterion 4. Proving a kill switch while it is fail-open verifies nothing.

⚠️ **Re-entry brief, carried verbatim so it is not re-derived from a stale sentence.** (a) **Read `strategy_analytics.computed_at`, NEVER `api_keys.last_sync_at`** — the mt5 keys report a recent `last_sync_at` while their analytics are days stale, and that lie is what Phase 161.1 was written against. (b) The dormancy is the **designed** end state of 161.1 (LEDGER-02), not an omission — `cron.job` on PROD holding no call to `enqueue_ledger_refresh_for_strategies` is correct until this phase acts. (c) ⭐ **The all-candidates-failed branch of the ledger fan-out is UNREACHABLE while the fan-out is dormant and becomes reachable AT ACTIVATION** (stated by Phase 164.8.6 and carried forward) — exercise it **deliberately**, do not assume it works; it is a branch that has never run. (d) The P0 marker query is run FIRST and **its OUTPUT is recorded**, not its text: `164.7-07-PLAN.md:149`'s verify leg was found to be satisfied by pasting the QUERY, which is the `[164.7-P3C-PRESENCE-ORACLE]` vacuity booked below. (e) `164.7-ACTIVATION-PREFLIGHT.md` holds P3-C; re-run it rather than re-inventing it. (f) ⛔ **ORDERING HAZARD — RE-CAPTURE THE CRON MANIFEST IN THE SAME ACT AS THE ACTIVATION.** Carried in 2026-09-12 from `161.1-UAT.md`'s gap list, where it had sat as a `failed` truth owned by nobody. Phase 164.1's CRON-DRIFT-01 commits a manifest of the achievable PROD `cron.job` configuration and fails loud when live PROD drifts from it — over ALL rows, not just jobid 1, which is a LOCKED CONTEXT decision. Registering the ledger-refresh job is, by that arm's definition, drift. So the activation WILL turn the prober red, and the red will be **CORRECT**: PROD really will hold a job the committed manifest does not. ⭐ That is the arm working, not failing — but only if the operator re-captures the manifest in the same act. If they do not, the first reading is an alarm that looks like a bug in the new prober, in its first week, which is the fastest way to teach people to ignore it. ⚠️ This phase ALREADY mutates `cron-manifest.json` for its own `match_engine_cron` repoint, so the re-capture is one act, not two — which is part of why the activation was routed here.

⭐ **CARRY-FORWARD, folded in 2026-09-12 (this phase is the next one that WRITES A MIGRATION, so it is the natural carrier — a separate phase was created for these and then dissolved as over-booking).** When you write this phase's migration, carry BOTH corrections in its HEADER PROSE. ⛔ Do NOT edit the applied files to fix them — a comment-only edit to an ALREADY-APPLIED migration was Phase 164.8.6's one reviewer Critical, and it also gives `supabase-migrate.yml`'s "applied ZERO migrations" guard something to fire on.

- **`[164.7-MIGRATION-COMMENT-DRIFT]`** — `20260907130000` contradicts itself: `:7-11` carries the two `prod-body-ack` pragmas while `:141-146` says the pragma is *"DELIBERATELY ABSENT from this file today"* with unfilled `<measured in plan 06>` placeholders. Comment-only (MEASURED: 0 non-comment lines in both regions) and NO live gate risk, but `-- prod-body-ack:` is a machine-read token, so the file tells a human the opposite of what a gate can grep.
- **Three `prod-body-ack` pragmas now name SUPERSEDED PROD bodies** (in `20260906120000`, `20260907130000`, `20260911120000`, `20260911130000`), because the 2026-09-12 apply moved PROD. MEASURED INERT twice over: `scripts/prod-body-drift-check.sh:1300` reads the ack ONLY inside its `DRIFT)` branch (those bodies now `MATCH`), and it greps only `CHANGED_FILES`.

**Goal:** Close `CRON-DRIFT-01`'s LIVE-ROW half: PROD's `cron.job` jobid 1 runs a hand-repaired 2026-09-01 command that exists in no migration, so a rebuild from migrations does not reproduce it. ⛔ **CORRECTED 2026-09-09 — this sentence used to say the rebuild "reproduces the *unrunnable* GUC-reading job"; that is FALSIFIED, see DECIDED D2 below.** `20260408215026_schedule_match_cron_hourly.sql` reads `app.analytics_service_url` / `app.analytics_service_key` and, when either is empty, takes a skip branch: `RAISE NOTICE`, one `cron_runs` row `status='error', error='GUC unset at migration 015'`, `RETURN` — it never reaches its `cron.schedule`. Those GUCs cannot be set on this platform (`ALTER DATABASE`/`ALTER ROLE` → 42501, measured on PROD 2026-09-05, `scripts/lint-app-guc.mjs:429`: *"this read resolves to NULL wherever it runs"*), so the skip branch is the ONLY branch here. ⛔ **This phase was SPLIT OUT of Phase 164.5 on 2026-09-07 by founder decision, because it is the ONLY item that sits on an unresolved conflict — and nothing should be built on one.**

**⛔ THE CONFLICT — settle it BEFORE writing anything.** Two authoritative sources disagree, and they must not be averaged:

- **Phase 164.5's old criterion 7** said: "Write ONE forward migration re-scheduling `match_engine_cron` to the achievable Vault-backed command."
- **Migration `20260907120000_analytics_service_settings_and_vault_tick.sql:14-21`**, merged 2026-09-07, says: it "REGISTERS NO SCHEDULE and REMOVES NONE … **A migration that schedules is a scope violation**, and the runbook rule it would break is stated in `docs/runbooks/ledger-refresh-go-live.md`: the registration statement lives THERE and never in a migration."

The 164.7 rule is the more recent, shipped and tested convention, and `docs/runbooks/ledger-refresh-go-live.md:412` already carries a live `cron.schedule` registration as its established pattern. ~~⚠️ But honoring it alone does NOT close the reproducibility gap: a fresh apply of `20260408215026` still WRITES the broken job.~~ ⛔ **FALSIFIED 2026-09-09, struck and kept as lineage — the migration takes a skip branch and writes NO job. See D2.** What remains true is that the phase must STATE what a rebuild produces; D2 states it. ~~**Decide this in discuss/plan, record it, do not let an executor pick.**~~ ⛔ **ANSWERED 2026-09-09 — struck, kept as lineage. There is nothing left to decide; see DECIDED below. Do not re-open it in discuss.**

⭐ **NARROWED 2026-09-09 — the convention half is settled by precedent; only the rebuild half is still open.** When this phase was split out, migration-vs-runbook read as a live two-way conflict. It no longer does: the 164.7 rule is shipped AND the tree now carries **two** independent runbook registrations following it (`ledger-refresh-go-live.md:412`, `flipretry-derived-equity-go-live.md:162`). Under this project's own rule — on a contradiction take the more recent and more tested convention, never average them — the answer is determined. ⛔ What is NOT determined, and is the real content of criterion 1, is the SECOND half: `20260408215026` still writes the GUC-reading job on a fresh apply, and the 164.7 rule forbids a migration from removing a schedule as firmly as from adding one (*"REGISTERS NO SCHEDULE and REMOVES NONE"*). So a rebuild-from-migrations produces a job that only the runbook step then replaces. That has to be STATED, with its window named. Settling it is a sentence, not a decision — do not re-litigate the convention.

⭐ **DECIDED 2026-09-09 — nothing in this phase is left to choose.**

⛔ **This block exists so the phase can be planned and executed without a single judgement call. Each entry is an ANSWER with the measurement or precedent it rests on. A planner records these; it does not re-derive them. The ONE thing that is still a gate is D4 — and it is a human gate on purpose, not an open question.**

- **D1 — Registration lives in the RUNBOOK, never in a migration.** Basis: the 164.7 rule shipped in `20260907120000` (*"A migration that schedules is a scope violation"*), plus two in-tree precedents already following it (`ledger-refresh-go-live.md:412`, `flipretry-derived-equity-go-live.md:162`). The losing convention — Phase 164.5's old criterion 7 — is flagged for cleanup, not left to disagree silently.
- **D2 — What a rebuild-from-migrations produces: NO `match_engine_cron` job at all, plus one loud row.** MEASURED, not assumed: `20260408215026` skips scheduling whenever the two `app.*` GUCs are empty, and they are ALWAYS empty here because setting them returns 42501 on this platform. So a rebuilt database has no hourly job and one `cron_runs` row reading `error = 'GUC unset at migration 015'`, and the runbook registration is what creates the job. ⭐ This is the runbook convention working as designed — the migration fails CLOSED and leaves a trace — not a gap to be patched. ⛔ Therefore **no forward migration is written by this phase**, neither to schedule nor to unschedule. The window to name in the runbook is: *from a rebuild until the registration step is run, the hourly recompute does not fire, and `cron_runs` says why.*
- **D3 — The manifest re-capture is a SCRIPT, not hand work.** `scripts/prod-prober/` has no capture tool today. Criterion 3 already demands a pre-flight that ABORTS on a live-vs-manifest mismatch, which is code either way; the capture is the same read plus a write, and the drift arm compares by `command_sha256` and refuses a row without a valid one — so a hand-edited manifest is a defect waiting to happen. Write the small script, use it for the re-capture, commit both.
- **D4 — The PROD apply stays a HUMAN gate, and this block does not weaken it.** Criterion 5 is unchanged: three reviewers (`migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter`) before any production statement, and the founder runs or approves the live `cron.schedule`. Everything above removes *guesswork*, not *oversight*.

⚠️ **D2 vs criterion 7 — RECORDED 2026-09-16, not averaged.** D2 says *"no forward migration is written by this phase"*; criterion 7, added later on 2026-09-13, REQUIRES one (`ALTER ROLE service_role SET statement_timeout`). Under this project's own rule the more recent and more tested convention wins, and the two do not actually collide: D1/D2 forbid a migration that SCHEDULES or UNSCHEDULES (`20260907120000`: *"REGISTERS NO SCHEDULE and REMOVES NONE"*), which an `ALTER ROLE` does neither of. D2's sentence is left VERBATIM above because criterion 1 transcribes it; this note is the scope, so no reviewer reads the two as a conflict and no executor averages them. Mirrored in `164.5.1-CONTEXT.md`.

**⚠️ MEASURED 2026-09-07 — two clauses of the old criterion 7 are FALSIFIED, do not re-derive:**

1. The ROADMAP claimed `grep -rn decrypted_secrets supabase/ scripts/ src/` "returns ZERO hits". It now returns **3 migration files** — `20260408215026`, `20260408113029` and `20260907120000`. The first two are `-- APP-GUC-LINEAGE:` annotation comments **Phase 164.7 itself added** in commit `14b3b6c3`. The claim was true when written and our own work falsified it, so the old scoring clause ("`grep …` returns the new migration") **no longer discriminates** and must be replaced with a real oracle.
2. **Manifest-oracle collision.** `scripts/prod-prober/cron-manifest.json` jobid 1 (captured 2026-09-06) carries `decrypted_secrets` and does **NOT** carry `match_engine_cron_tick`. PROD matches it TODAY, so Phase 164.1's cron-drift arm reads ZERO drift right now. Repointing the row makes that arm RED unless the manifest is re-captured in the SAME phase. The re-capture is therefore part of this phase, not a follow-up.

**⭐ MEASURED 2026-09-09 — THE GATE IS LIFTED, and three of the four remaining pieces are mechanical.** ⛔ These are dated readings bound to a run or a session, not constants; regenerate rather than trust.

1. **`[A1]` HELD — it no longer gates the repoint.** `docs/runbooks/match-engine.md` carried it as NOT measured and as *"it gates the 164.5 repoint"*: whether a `SECURITY DEFINER` function owned by `postgres` may read the real encrypted `vault.decrypted_secrets` on a hosted Supabase project. Read by the founder in the **shared TEST** SQL editor: `has_schema_privilege('postgres','vault','USAGE')` → **true**, `has_table_privilege('postgres','vault.decrypted_secrets','SELECT')` → **true**. The hosted constraint was genuinely present in that same session — `vault.decrypted_secrets` owned by **`supabase_admin`** (not `postgres`), `postgres` **NOT** a superuser, `supabase_vault` installed — so the reading is load-bearing rather than an artefact of an over-privileged role. `SECURITY DEFINER` executes as the OWNER, so those two privileges are what the callable needs. Corroborated by a different instrument: PROD's jobid 1 already performs this same Vault read hourly as `username: postgres` and succeeds (`net._http_response` id 3485 → 200, 2026-09-01). Recorded in `docs/runbooks/match-engine.md` by commit `e2645ebf`.
   ⚠️ **Still NOT proven, and the phase must not upgrade it by retelling:** no `SECURITY DEFINER` wrapper was EXECUTED against the real Vault — the ACL was read, the function was not called, because calling the shipped `match_engine_cron_tick()` fires a real `net.http_post` at the production analytics service. The wrapper is expected to be a role no-op (definer `postgres`, caller `postgres`); that is an argument, not a measurement. ⛔ The pg-lane cannot answer this class at all — its vault is a plaintext stand-in. Do not "confirm" A1 from a lane run.
2. **The callable already EXISTS on both projects.** `public.match_engine_cron_tick()` is present on shared TEST (`to_regprocedure` non-null, measured in the same session) and its migration `20260907120000` is merged, so it is live on PROD too. This phase does not build the replacement — it points the live row at one that is already there.
3. **The registration statement does NOT exist yet.** `grep -n "cron.schedule" docs/runbooks/*.md` finds `ledger-refresh-go-live.md:412` and `flipretry-derived-equity-go-live.md:162` — two in-tree precedents for the runbook convention — and **nothing for `match_engine_cron`**. Writing that section is this phase's work.
4. ⛔ **FALSIFIED 2026-09-12 — THE SCRIPT NOW EXISTS; DO NOT WRITE A SECOND ONE.** This read *"There is no manifest re-capture script … decided in D3: write the script"* and was true when written. RE-MEASURED: `export async function captureManifest({ seams, outPath, log, functionsDir })` at **`scripts/prod-prober/run.mjs:4230`** (the line number drifts — resolve the SYMBOL, not the line). D3's decision is therefore already DISCHARGED; criterion 2's re-capture CONSUMES this tool instead of building one. ⚠️ Phase 164.8.5's review recorded this same staleness and it survived here anyway, which is why this entry now names the symbol. The drift arm compares by `command_sha256` and refuses a row without a valid one, so the sha must be regenerated, not edited.
5. **The dependencies are shipped**, despite `roadmap analyze` reporting 164.1 and 164.7 as `empty` — that is the known under-report for phases whose `.planning/phases/` artifacts the `-pr` filter stripped from `main`, NOT an unfinished phase. The code is present: `scripts/prod-prober/{run.mjs,cron-manifest.json}` + `.github/workflows/prod-prober.yml` (164.1), `20260907120000` + `scripts/lint-app-guc.mjs` + `supabase/schema/functions/match_engine_cron_tick.sql` (164.7), and 164.4.1 reports `complete`.

⭐ **CARRIED IN 2026-09-13 BY FOUNDER DECISION — `[164.5.1-GATEWAY-CEILING-INVERSION]`. The Supabase 504s that item 1 above calls "the established root cause" were MEASURED on PROD on 2026-09-12, and the measurement changes what the fix has to be.** Item 1 is written as though the 504s were weather to be survived by retrying. They are not — they are a CONFIGURATION INVERSION, and retry alone leaves it in place.

⛔ **These are dated readings bound to a session, not constants. Regenerate rather than trust.** Marker query run first; it returned the PRODUCTION marker.

- ⭐ **THE INVERSION.** `pg_roles.rolconfig` on PROD: `anon` = `statement_timeout=3s`, `authenticated` = `8s`, `authenticator` = `8s`, and **`service_role` = NULL**, i.e. it inherits the database default of **120000ms**. Supabase's API gateway gives up at **60s**. So the ceiling that actually bites a service-role request sits BELOW the one Postgres enforces: a query crossing 60s is answered `504 Gateway Timeout` by the gateway while Postgres keeps working toward 120s. The analytics service authenticates as `service_role`, so every one of its reads runs under the only role in the project with no timeout of its own.
- **It is NOT database contention, and NOT a slow statement.** Measured the same session: 17 of 60 connections, 1 active, 0 `idle in transaction`, 0 waiting on a lock, longest active client query 0s. `pg_stat_statements` returns **ZERO** rows with `max_exec_time > 20s`. No individual statement is slow; the cron's AGGREGATE work is what approaches the wall.
- **The cron is brushing the ceiling now.** The one run in the observed window that SUCCEEDED — 19:00Z, `net._http_response` id 3758 — reported `duration_s: 44.67` against a 60s gateway limit. Of the 6 runs still inside pg_net's retention window, **5 returned 500** (ids 3755, 3756, 3757, 3759, 3760), all with `timed_out: false` and `error_msg: null` — so pg_net reached the service and the service itself errored. An 83% failure rate that is run-to-run variance crossing a fixed line, and it worsens monotonically as allocator and strategy counts grow.
- ⛔ **THE SAFETY CONTROL IS THE THING DEGRADING, IN PRODUCTION, RIGHT NOW.** Sentry `QUANTALYZE-1D` is titled *"match_engine: kill switch check FAILED (fail-open, engine still running)"* — 5 events on 2026-09-12. This is no longer the hypothetical item 1 describes; it is a dated production sighting of the guard failing open. Treat it as the motivating evidence.
- **Blast radius is wider than the cron.** The same 504s hit `main_worker in _claim_priority` (Sentry `QUANTALYZE-11`, 14 events) and `main_worker in _reset` (`QUANTALYZE-X`, 3 events). The compute worker is degraded too, so a fix scoped to `cron_recompute()` alone leaves the larger surface untouched.
- ⚠️ **Retry-with-backoff — item 1's remedy — is necessary and NOT sufficient.** Retrying a request that will be cut off at 60s produces three 60-second waits and then the same failure. The retry makes the guard able to fail CLOSED, which is item 1's actual goal; it does not make the underlying request complete. Criteria 7-9 below are what make it complete, and they do not replace item 1 — they sit under it.

**Success Criteria**:

1. **D1, D2 and D3 above are TRANSCRIBED into CONTEXT.md verbatim with their measurements, not re-derived and not re-opened.** ⛔ This criterion used to read *"the conflict is settled EXPLICITLY"*; it was settled on 2026-09-09 and the criterion is now a recording step. The runbook text names D2's window — from a rebuild until the registration runs, the hourly recompute does not fire and `cron_runs` says why. The losing convention (Phase 164.5's old criterion 7) is flagged for cleanup, not silently left to disagree.
2. After the repair, Phase 164.1's cron-drift arm reports ZERO drift for `match_engine_cron` against the committed manifest, and the manifest re-capture is part of this phase.
3. The pre-flight ABORTS non-zero WITHOUT writing when the live jobid 1 command does not match the manifest — proven by running it against a deliberately mismatched manifest, not by inspection. Never infer from an absent measurement.
4. A rebuild-from-migrations no longer produces the unrunnable GUC-reading job, and the phase states plainly what it DOES produce.
5. ⛔ Production DDL on a credential-bearing cron row: three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply.
6. Every "Phase 164.5 item 7" reference in the tree is repointed at this phase — 5 source files (`20260408215026`, `20260408113029`, `20260907120000`, `scripts/lint-app-guc.mjs`, `docs/runbooks/match-engine.md`) plus `TODOS.md`. ⚠️ `lint-app-guc.mjs` carries a count-pinned `LINEAGE_ALLOWLIST`; a comment edit must not move those counts.
   ⭐ **SCOPE AMENDMENT 2026-09-16 — criterion 6 as written demands something this repo forbids; amended rather than averaged.** Three of the five named source files (`20260408215026`, `20260408113029`, `20260907120000`) are APPLIED migrations. PROD's migration ledger stores the APPLIED SQL, comments included, and `scripts/prod-body-drift-check.sh` compares against it — so a comment-only edit there creates a MEASURABLE repo-vs-ledger divergence. The no-edit rule has mechanism behind it; a stale prose pointer does not. **Amended criterion 6:** repoint the three LIVE files only — `scripts/lint-app-guc.mjs` (allowlist `reason:` strings; ⚠️ the count pins must not move), `docs/runbooks/match-engine.md`, and `TODOS.md` — and leave the three applied migrations BYTE-IDENTICAL, because their text is correct for their date. The redirect is written into the live docs IN THE EXACT WORDS a reader would grep (`Phase 164.5 item 7`), so the historical mentions and the correction surface in one result set. ⛔ Deliberately NOT done, and recorded so it is a decision rather than an omission: (a) no forward pointer in this phase's own migration header — that migration is `ALTER ROLE service_role SET statement_timeout` and has no lineage relationship to the cron files, so a pointer there is misfiled; (b) no CI gate against future dead pointers — anti-vacuity is scoped to data-integrity and user-facing behaviour, and a prose-pointer gate is the unbounded tail that scoping exists to cut. Mirrored in `164.5.1-CONTEXT.md`.
7. ⛔ **WITHDRAWN 2026-09-16 at the plan-09 D4 gate — this criterion ships NOTHING, and that is a measured outcome rather than a descope.** It required `service_role` to carry an EXPLICIT `statement_timeout` below the gateway's 60s ceiling ("45s unless a measurement argues otherwise"), by forward migration. A measurement argued otherwise TWICE OVER, and the migration `20260916120000_service_role_statement_timeout.sql` plus its static gate are removed from the branch (recoverable from commit `5acfb710`; ⛔ nothing was ever applied — the file never reached `origin/main`). **(a) The mechanism cannot do the job.** `statement_timeout` bounds ONE STATEMENT; the gateway's 504 bounds ONE REQUEST. `cron_recompute()` issues many short statements per request and the measured `44.67s` is a request duration, so a request slow by composition is still cut at 60s with the identical opaque 504. The Sentry sightings being 504s and never `57014` corroborates it. **(b) The inversion this criterion is named after does not exist as described.** MEASURED read-only on PROD 2026-09-16 (marker query first): `pg_db_role_setting` has `anon` 3s, `authenticated` 8s, `authenticator` 8s and **no row at all for `service_role`**; the `postgres` database sets no timeout. PostgREST logs in as `authenticator` (8s onto the session) and `SET ROLE service_role` finds nothing to override it — so the effective ceiling is **8s, not the 120s** this criterion and `164.5.1-CONTEXT.md` asserted from `rolconfig = NULL`. An ABSENCE was read as a VALUE. `164.5.1-RESEARCH.md:441` had it right from the start, citing Supabase's own docs. Setting 45s or 55s would have LOOSENED the real ceiling, not tightened it. ⭐ **Where the intent goes instead:** a REQUEST-level deadline plus explicit 504 classification — which criterion 9's batching already builds, so nothing is lost by withdrawing this one. ⛔ Do not re-open this criterion by proposing a different number; the number was never the problem.

⛔ **SHIP OVERRIDE 2026-09-17 — Wave A was shipped with `verification.status: missing`, by explicit founder decision, and this is recorded rather than dressed up as a green gate.** `/gsd-ship`'s `ship:pre` gate admits only `passed`. It cannot be satisfied here and never could: this phase's GOAL is literally a production state — *the live `match_engine_cron` row is repointed* — so no repo-side verifier reaches `passed` before the repoint happens, the repoint is **plan 09**, and plan 09's own runbook Step 0 requires this branch to be **merged and deployed** first. The gate sits behind the act it gates. Founder directed ship → `/land-and-deploy`; the deploy is what unblocks plan 09, and `/health`'s `git_sha` against Wave A's merge commit is the Step 0 abort check.
**What was NOT overridden**, because the distinction is the whole point: pytest 5867 passed / 89 skipped; vitest 14823 passed / 2 failed (both pre-existing, both files 0 diff on this branch); prod-prober self-test 82/82; `verify-plan-anchors --pending` 24 claims; `check-planning-hygiene` 6448 files; and the `ship:pre` **SECURITY** gate, which passes on its own evidence (`164.5.1-SECURITY.md`, `threats_open: 0`, re-evaluated by the orchestrator rather than taken from the auditor). There is **no `supabase/` diff** on this branch, so no `apply-test` and no PROD apply gate were bypassed — there was nothing to apply.
⚠️ **Plan 09's nine threats stay PENDING, not closed.** `T-164.5.1-09-02` (three-reviewer sign-off plus the post-act jobid verify-back) and `T-164.5.1-09-07` (exercising the never-run ledger fan-out branch at activation) are unverifiable before the live act. Re-run `/gsd-secure-phase 164.5.1` when plan 09 executes; the SECURITY sign-off carries that as an open box. Tracked as `.planning/WINDOWS.md` entry **60**, which closes when `164.5.1-VERIFICATION.md` reports `passed`.

8. ⭐ **The kill switch FAILS CLOSED after exhausting retries, proven by an INJECTED failure that is OBSERVED — never by argument.** Per this repo's anti-vacuity doctrine: neuter → observe the engine actually stop → restore, and prove the neuter APPLIED before believing the result. A guard that cannot be shown to close is indistinguishable from the fail-open guard it replaces. The closed state carries a DISTINCT status per item 1's own ⚠️, so a database outage is never mistaken for the founder pressing the switch. ⛔ Criterion 4's proof of the kill switch is NOT satisfiable until this lands — proving a kill switch while it is fail-open verifies nothing, which item 1 already says and this criterion makes checkable.
9. **No single analytics request performs its whole unit of work inside one gateway-bounded call.** `cron_recompute()` (`analytics-service/routers/match.py:1965`) is batched so no request approaches the ceiling, and the post-change duration is RECORDED against the measured `44.67s` baseline. ⚠️ The fix is scoped to the surface the blast-radius reading names, not to the cron alone: `_claim_priority` and `_reset` in `main_worker` take the same 504s and are in scope or explicitly deferred to a NAMED phase — never silently left out.

**Superseded criterion, kept verbatim for lineage (was Phase 164.5 criterion 7):**

> CRON-DRIFT-01-REPAIR: after the migration applies, Phase 164.1's cron-drift arm reports ZERO drift for `match_engine_cron` against the committed manifest, and `grep -rn decrypted_secrets supabase/migrations/` returns the new migration. The pre-flight ABORTS non-zero WITHOUT writing when the live jobid 1 command does not match the manifest — proven by running it against a deliberately mismatched manifest, not by inspection.

⚠️ PROD is currently CORRECT (verified 2026-09-01, `net._http_response` id 3485 returned 200). **This closes a REPRODUCIBILITY gap, not an outage** — there is no time pressure, which is exactly why settling the convention first is affordable.

**Requirements**: TODOS entries CRON-DRIFT-01 (the REPAIR/LIVE-ROW half only — the DETECT half is Phase 164.1's), `[164.7-VAULT-ABSENT-RULE]`, `[VAULTTICK-EMPTYKEY-01]`, `[164.7-ACTIVATION-DEFERRED]` (⚠️ a DISTINCT operation — registering `ledger_refresh_fanout` and flipping `system_flags.ledger_refresh_enabled` — routed here ONLY because it mutates the SAME `scripts/prod-prober/cron-manifest.json` this phase re-captures; 164.7-07-SUMMARY names the coupling: whichever lands second MUST re-capture or the cron-drift arm reports drift on every hourly run. Re-entry gate is P3-C after the 04:00Z/05:00Z ticks) (⚠️ added 2026-09-10: the whitespace-key hole is IN the callable this phase repoints jobid 1 at — `match_engine_cron_tick()` tests `v_key = ''` not `btrim(v_key) = ''`, and a whitespace secret is sent as the `X-Service-Key` header, producing the 401 that `CRON-DRIFT-01` exists because of) (⚠️ added 2026-09-11 from Phase 164.8.5's review loop: `[164.8.5-MANIFEST-SIDE-LOOP-DEAD]` — `compareManifest`'s MANIFEST-side hygiene loop sits BELOW all three early returns and is DEAD on every production run today, because the committed manifest declares `normalization: ws-collapse-v1` while the arm computes `ws-collapse-v2`. ⭐ THE RE-CAPTURE THIS PHASE PERFORMS CLEARS `manifest-invalid` AND THEREBY SILENTLY RE-ANIMATES THAT LOOP — a check that has not run for weeks starts running again as a side effect of an unrelated action, so expect manifest-side `cron-secret-in-command` findings that nobody has seen before and do not read them as new leaks. Measured: valid manifest → 1 manifest-side credential defect; v1 / wrong schema_version / marker mismatch → 0. NOT graded Critical because decision D1 hoisted the PROD-side loop above every `return`, so a credential LIVE IN PROD is still reported on all those paths) (⚠️ added 2026-09-11 — Phase 164.8.5's SECURITY audit routes TWO MORE open threats here, both closed by the SAME re-capture this phase already performs: **T-OPEN-04** — the committed manifest declares `normalization: ws-collapse-v1` while the arm computes `ws-collapse-v2`, so `manifest-invalid` fires on every production run; and **T-OPEN-03** — `retention_compute_jobs_orphaned_running` is committed with 0 newlines and lexes to a pure comment, so `visible = 0 of 1791` characters. ⭐ T-OPEN-03 was DOWNGRADED to `low` on measurement rather than accepted as booked: a spliced key in that row still fires `long-token-anywhere` via the comment producer, and `jwt-shape` / `service-role` / `pg-password` all still fire — only the header-anchored rules and `vault-absent` are lost, so it is an ATTRIBUTION gap, not a credential blind spot. ⛔ The newline fold happened at CAPTURE time, so no code change restores it; only a re-capture does. Together with `[164.8.5-MANIFEST-SIDE-LOOP-DEAD]` above, this phase's re-capture closes three of the five threats Phase 164.8.5 left open) + ⛔ **ROUTED HERE 2026-09-11 — RE-MEASURE BEFORE PLANNING: THE RE-CAPTURE ALREADY HAPPENED.** `scripts/prod-prober/cron-manifest.json` was re-captured on 2026-09-11 at `ws-collapse-v2` (capture run `34611594511`, landed by PR #776), because the first prober run after Phase 164.8.5 reported `manifest-invalid`: the arm computed `ws-collapse-v2` while the committed oracle still declared `ws-collapse-v1`, and two normalizations produce two shas for identical text, so **the cron-drift arm was performing NO comparison at all.** ⚠️ Consequences for THIS phase's plan, both MEASURED at capture: (a) **the newline fold named above is ALREADY RESTORED** — v2 preserves line breaks — so the sentence *"only a re-capture does"* is now history, not a live blocker; verify against the committed file rather than re-deriving it. (b) **Zero real production drift was absorbed**: 10 of 14 commands differ textually and all 10 are whitespace-only (`v1(old) === v1(new)` for every row), so the repointing baseline is unchanged. ⭐ **The RESIDUAL this phase should own is the GATE, not the data:** nothing in CI fails when the arm's exported `NORMALIZATION` and the manifest's `normalization` key disagree. The mismatch was caught by an hourly PRODUCTION probe an hour after it shipped — a control that silently stopped being able to find anything, which is the anti-vacuity class this repo ranks above ordinary correctness. Any future normalization bump re-opens it identically + ⭐ **`[164.5.1-GATEWAY-CEILING-INVERSION]` — ADDED 2026-09-13, see the dated measurement block above.** `service_role` is the only role on PROD with no `statement_timeout` of its own (inherits 120s) while the API gateway cuts at 60s, so a slow service-role read returns an opaque 504 rather than a catchable timeout; the cron's successful run measured `44.67s` against that 60s wall and 5 of 6 retained runs returned 500. ⚠️ The fail-open kill switch was OBSERVED failing open in PROD on 2026-09-12 (Sentry `QUANTALYZE-1D`, 5 events), which converts item 1 from a hypothesis into a dated sighting. ⛔ A matching `TODOS.md` entry is still OWED — it was not written in the same act because `TODOS.md` is a non-planning path and would have pulled a VERSION bump into a ROADMAP-only edit while Phase 164.6.3 held the working tree. Write it when 164.6.3's plan 03 next touches that file, or as this phase's own first act; do NOT let it stay ROADMAP-only prose, which is the `FANOUT-GLOBAL-01` failure mode this milestone already records
**Depends on:** Phase 164.1 (its committed cron manifest is this phase's oracle), Phase 164.7 (the settled `app.*` replacement mechanism — `system_settings` + Vault — which this MUST consume rather than invent a second answer), Phase 164.4.1 (pg-lane with pg_cron)
**Plans:** 9/9 plans complete

Plans:

- [x] 164.5.1-01-PLAN.md — wave 1 · the phase's FIRST act: write the three missing `TODOS.md` entries (`[164.5.1-GATEWAY-CEILING-INVERSION]`, `T-OPEN-03`, `T-OPEN-04` — the `FANOUT-GLOBAL-01` failure mode), then discharge criterion 6 as amended across the three LIVE files, leaving the applied migrations byte-identical
- [x] 164.5.1-02-PLAN.md — wave 1 · **TRACER** · criterion 8: `_is_gateway_timeout` + `db_read_with_retry` in `services/db.py`, `_engine_is_enabled` becomes async and tri-state, the kill switch fails CLOSED with the DISTINCT `kill_switch_unavailable` status, proven by an INJECTED failure observed RED under a neuter
- [x] 164.5.1-03-PLAN.md — wave 1 · criterion 7: ⛔ **its output was WITHDRAWN** — the `ALTER ROLE service_role SET statement_timeout` forward migration and its static gate are removed (see criterion 7 above; the plan RAN correctly, the criterion it served was built on a false measurement) (`20260916120000`) + a static gate failing in both directions. Schema-push gate ANSWERED by the recorded no-local-push override
- [x] 164.5.1-04-PLAN.md — wave 1 · criterion 3: `preflightCronRepoint` beside `captureManifest`, aborting non-zero WITHOUT writing, proven against a deliberately mismatched manifest fixture
- [x] 164.5.1-05-PLAN.md — wave 2 · criterion 9 blast radius: `_claim_priority` and `_reset` consume the same retry seam, with the 42883 permanent latch proven unable to fire on an availability failure
- [x] 164.5.1-06-PLAN.md — wave 2 · criterion 9: `cron_recompute()` batched with a `system_settings`-persisted cursor (the FIRST Python consumer of that table), returning `status="partial"` + `next_cursor`, with the status vocabulary documented and gated
- [x] 164.5.1-07-PLAN.md — wave 2 · the `T-OPEN-04` / `T-OPEN-03` / `[164.8.5-MANIFEST-SIDE-LOOP-DEAD]` RESIDUAL (the GATE, not the data): a CI contract test pinning the committed manifest's `normalization` to the arm's exported constant, plus a fourth broken-oracle self-test scenario
- [x] 164.5.1-08-PLAN.md — wave 3 · criteria 1 and 4: repair P3-C (`completed_at` → `updated_at`, both copies plus the two later diagnostics — it aborts 42703 today), then write the `docs/runbooks/match-engine.md` go-live section with the D1/D2/D3 transcription, D2's window verbatim, and a DEFER branch
- [x] 164.5.1-09-PLAN.md — wave 4 · **NOT autonomous** · criteria 2, 5 and 7's read-back: the D4 three-reviewer `checkpoint:decision`, the founder's live PROD session recording every OUTPUT, then ONE manifest re-capture and the backlog dispositions

### Phase 164.5.1.4: SYNCCURSOR — the sync cursor is per-KEY while stores are per-STRATEGY, so a partial fan-out permanently strands the failed strategies trade window (INSERTED)

**Goal:** Stop a partial fan-out in `cron_sync` from permanently stranding the trade window of the strategies whose `sync_trades` RPC failed, by persisting the per-strategy breakdown the code already computes and reading it back when the fetch window is chosen — while `should_advance_cursor` and the key-level `api_keys.last_sync_at` write stay byte-identical.

⛔ **PRE-EXISTING AND DELIBERATE — never report this as a regression.** `_sync_single_key` stores per STRATEGY (one RPC per linked id) but resumes from a cursor held per KEY. On a key backing N strategies where one RPC succeeds and another raises, `synced_count > 0` holds, the cursor advances, and the failed strategy's window is never seen again. Phase 164.5.1.2 neither introduced nor widened it; its D-03 fix is a different cause and stands.

⛔ **NOT fixable by tweaking the key-level gate.** Holding the whole key's cursor on any partial failure starves the SUCCEEDING strategies into permanent re-fetch — the symmetric defect, and exactly why C-0198 chose to advance. Both candidate existing homes were MEASURED and rejected: `api_keys.last_fetched_trade_timestamp` (migration 045) is per-KEY, which is the granularity that causes this defect; `advance_sync_cursor` is per-KEY and fenced to a job — right mechanism, wrong axis. No per-strategy sync state exists anywhere in the schema, so the remedy is new state keyed on `strategy_id` alone.

⭐ **This phase is the gate in front of Phase 164.5.1.3 SYNCADMIT**, which is queued immediately behind it. If this phase ships only a partial remedy it must say plainly that SYNCADMIT stays blocked rather than letting the next phase discover it.

**Requirements**: TODOS entry `SYNC-CURSOR-PER-KEY-STRANDS-STRATEGY-01` (the whole entry; this phase is its named owner) + seven phase-local success criteria, derived from `164.5.1.4-CONTEXT.md` because no `REQUIREMENTS.md` entry exists for a defect-fix phase inserted directly into the roadmap:

- **SYNCCURSOR-C1** — a recorded verdict on whether the per-KEY cursor is replaced, supplemented, or deliberately kept, with evidence.
- **SYNCCURSOR-C2** — a calibrated gate proving a partial fan-out no longer strands, pinning the CONSEQUENCE (the next tick's fetch window) and not the implementation's own formula: neuter → observe RED → restore → `cmp` byte-identical → record the OBSERVED failure text. ⛔ Anti-vacuity blocks here; this is data integrity.
- **SYNCCURSOR-C3** — all three `TestC0198CursorOnlyAdvancesWhenStored` members pass with their bodies unchanged.
- **SYNCCURSOR-C4** — the recompute-enqueue stranding path is covered, on its own injected failure axis. The advance condition is NOT a per-strategy mirror of the key-level formula: a strategy advances only when the tick was idle, or when it stored AND its `derive_broker_dailies` enqueue did not fail — computed AFTER both loops.
- **SYNCCURSOR-C5** — `SYNC-CURSOR-PER-KEY-STRANDS-STRATEGY-01` ends ACCURATE: closed by making the claim TRUE, or re-scoped with a named owner. ⛔ Never a false closure.
- **SYNCCURSOR-C6** — nothing widens a ceiling, relaxes a floor, or adds an exemption.
- **SYNCCURSOR-C7** — a stated verdict on whether Phase 164.5.1.3 SYNCADMIT is unblocked, and on what measured evidence.

⛔ **OUT of scope, by CONTEXT decision:** harmonising the two sync-cursor disciplines (`job_worker`'s fenced advance vs `cron.py`'s direct write) — named deliberately and NOT absorbed; admitting `private` to `ALLOWED_STRATEGY_STATUSES` (that is 164.5.1.3, blocked on this); `enqueue_ledger_composite_refresh`.
**Depends on:** Phase 164.5.1
**Plans:** 4/4 plans complete

Plans:

- [x] 164.5.1.4-01-PLAN.md — wave 1 · the migration: a `strategy_sync_cursors` table keyed on `strategy_id` alone (no `api_key_id`, which is mutable and `ON DELETE SET NULL`), deny-all RLS on the `compute_jobs` precedent rather than a column on the publicly-readable `strategies`, and a catalog-only self-verify block — proven by applying it TWICE on the disposable pg-lane cluster. Records the two shape decisions the brief left open: the RLS form, and why no dedicated `supabase/tests/*.sql` gate.
- [x] 164.5.1.4-02-PLAN.md — wave 2 · **TRACER** · the per-strategy resume path end to end, table to fetch window, gated by a TWO-TICK test that reads the `since_ms` the next tick actually asks the venue for, with a control proving the window does advance on full success. ⭐ A held strategy's PRE-TICK resume point is PERSISTED, and absent-row is told from present-NULL by membership — without both, the fix is inert on the first failure, because the failed strategy would fall back to the key cursor that just advanced past it. Calibrated by neutering the marker READ while leaving the WRITE intact.
- [x] 164.5.1.4-03-PLAN.md — wave 3 · criterion 4 on its own failure axis (the enqueue RPC raises while BOTH storage RPCs succeed), calibrated by deleting the recompute conjunct and recording that plan 02's gate stayed green; the shared `cron_sync` mock helper extended to SERVE the marker table, so the production wiring stops being green-and-unexercised behind its own fail-open branch; a named `strategy_cursors_held` signal for the accepted, precedented fetch-window growth; and the three measured pieces of stale prose corrected.
- [x] 164.5.1.4-04-PLAN.md — wave 4 · the closure: `SYNC-CURSOR-PER-KEY-STRANDS-STRATEGY-01` disposed of accurately with its own stale migration-045 question answered rather than left open, both verdicts recorded (C1, and C7 with the condition that decides it — the fix is inert until the migration has APPLIED to PROD, because both new Supabase paths fail open), a mechanical check that no floor, ceiling, waiver or baseline moved, and the three-reviewer handoff in front of the merge.

### Phase 164.5.1.3: SYNCADMIT — admit the owner-only status to the trade-sync constant, or prove it must not be: 5 of 5 private keys are never synced and their trades are never stored (INSERTED)

**Goal:** Decide, on evidence, whether `ALLOWED_STRATEGY_STATUSES` must admit the owner-only (`private`) status — and if so, ship that widening with its blast radius traced. ⭐ **Phase 164.5.1.2 already did the measuring and REFUSED to ship the change inside its own budget**; this phase exists because admitting `private` alters production sync behaviour for five live keys, which is its own work and deserves its own reviewers.

⭐ **THE MEASUREMENT, taken on PRODUCTION 2026-09-19 by the founder (marker read FIRST: `⛔ PRODUCTION`), recorded in `164.5.1.2-PROD-SESSION.md`:**

| reading | value |
|---|---|
| `private` strategies, total | **6** (agrees with the independent 2026-09-17 table) |
| …carrying an API key | **5** |
| …carrying NO key | **1** |
| keyed ones sharing that key with an in-set sibling | **0** |
| keyed ones on a key with NO in-set sibling | **5 of 5** |

⛔ **THE SIBLING HYPOTHESIS IS FALSIFIED.** The ROADMAP handed the question *"does an owner-only strategy share an `api_key` with a sibling whose status IS in the set?"* to Phase 164.5.1.1 plan 04, where it was never run. Phase 164.5.1.2 ran it: **not one does.** So the comforting reading — that trades still arrive via a sibling row and the gap is narrower than it looks — is dead. **Five real, live, key-bearing production strategies have their trades never stored.**
⛔ **The one keyless strategy must NOT be counted against the harm** — it is unsyncable by ANY widening, and counting it overstates what this phase could deliver.
⚠️ **A limit recorded BEFORE the read and now load-bearing:** the read is forward-looking and cannot distinguish a currently-shared key from a sync predating the transition to `private`. The `ever synced = 2` in the 2026-09-17 table therefore has a pre-transition sync as its ONLY remaining explanation — consistent, but NOT measured, and unmeasurable without a `status_changed_at` column.

⛔ **WHAT THIS PHASE MUST NOT ASSUME — inherited from 164.5.1.2 and NOT to be re-derived:**

- ⛔ **Widening this constant does NOT start polling anything.** A `private` strategy is excluded from `enqueue_poll_positions_for_all_strategies` by its OWN lifecycle conjunct AND by an `EXISTS` keyed on its own id. Phase 164.5.1.2 REFUSED that poll widening as inert and that refusal stands. Anyone proposing this phase will fix the missing position snapshots has misread it.
- ✅ **The `last_sync_at` cursor defect is already CLOSED** (Phase 164.5.1.2, plan 02). It was data LOSS, not merely a stale timestamp: trades were fetched, no strategy was eligible, and the cursor advanced past them so the next tick skipped that window permanently. It was live on all five of these keys. ⛔ Do not re-fix it; DO check that admitting `private` interacts correctly with the shipped gate.

**Success Criteria:**

1. A recorded verdict: widen, or prove it must not be widened. ⭐ "Must not" is a valid outcome and is recorded as explicitly as a change.
2. If widened: the blast radius is TRACED before the change ships — new `/cron-sync` RPC load, newly stored trades for five keys, `enqueue_compute_job` follow-ons, and the interaction with the shipped `should_advance_cursor` gate.
3. A calibrated gate proving the new behaviour: neuter → observe RED → restore byte-identically verified with `cmp` → record the OBSERVED failure text. ⛔ Anti-vacuity BLOCKS here — this is user-facing and data-integrity.
4. ⛔ Nothing widens a ceiling, relaxes a floor, or adds an exemption. Close by making a claim TRUE.
5. ⚠️ The apply path is decided by WHAT CHANGES: a `cron.py`-only change ships via the ordinary CI path; any SQL takes 3 reviewers → `apply-test` → the PROD apply behind the `Production` human reviewer gate.

**Requirements**: `TODOS.md` `FANOUT-COHORT-SYNC-CONSTANT-01` (widening half; routed here by Phase 164.5.1.2 on the founder's `leave-book-future-phase` decision, 2026-09-19).
**Depends on:** Phase 164.5.1.2 FANOUTSIBLINGS — which supplied the production measurement above and deliberately left the change unshipped.
**Plans:** 1/1 plans complete

Plans:

- [x] 164.5.1.3-01-PLAN.md — widen `ALLOWED_STRATEGY_STATUSES` to admit `private` (RED→GREEN, calibrated), prove it composes with 164.5.1.4's SYNCCURSOR marker without reopening `SYNC-CURSOR-PER-KEY-STRANDS-STRATEGY-01`, add the mechanical ordering gate, and close/re-scope the TODOS ledger against a live PROD-apply re-check. Code-complete and VERIFIED on branch `feat/164.5.1.3-syncadmit` (SUMMARY: `.planning/phases/164.5.1.3-syncadmit-admit-the-owner-only-status-to-the-trade-sync-cons/164.5.1.3-01-SUMMARY.md`; VERIFICATION `passed`; SECURITY 3/3 closed, 0 open). ⭐ **The merge precondition is MET** — 164.5.1.4's PROD-apply gate read `waiting` at execution time on 2026-09-20 (run 35478916418), and after the founder approved the `Production` environment that same run reports `success` overall with its `apply` job `success`. `strategy_sync_cursors` exists on PROD, so the fail-open paths resolve against a real table. Remaining: merge + deploy, then the post-deploy PROD read of the `held` counter (⛔ founder-only, credentials).

### Phase 164.5.1.1: FANOUTCOHORT — the ledger-refresh fan-out admits the `private` status, so it stops enqueuing nothing for every strategy that exists (INSERTED)

**Goal:** The ledger-refresh fan-out enqueues work for the strategies that actually exist in production. ⛔ **MEASURED on PROD 2026-09-17, on the FIRST tick after Phase 164.5.1 activated it** (cron `runid 11159`, jobid 40, `08:25:00.371Z`): the job ran, was **not** dormant (`ledger_refresh_enabled = true`, and **zero** `cron_runs` rows with `cron_name = 'ledger_refresh_fanout'` — that row is the dormant branch's own instrument, read from the INSERT literal in the function body), ran through to candidate selection and selected **ZERO** strategies. `compute_jobs` gained no `derive_broker_dailies` row and `ledger_refresh_staleness` stayed BYTE-IDENTICAL to the P4 BEFORE census: 6 strategies, `min 23 / avg 52.50 / max 141` days. ⚠️ `return_message: "1 row"` on that cron row is NOT "one job enqueued" — the function returns an INTEGER and `SELECT f()` always returns one row; `return_message` carries the ROW COUNT, never the return value.
**The cause, per strategy, one conjunct at a time:** `cooldown_jobs = 0` and `inflight = 0` for all six, so neither the 20-hour attempt cooldown nor the in-flight guard excludes anything — the orchestrator's stated backlog hypothesis was FALSIFIED. The single binding conjunct is `s.status IN ('published','pending_review')` in `enqueue_ledger_refresh_for_strategies()` (`supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql`), and **every production strategy carries `status = 'private'`** — an owner-only terminal status added by `20260716130000_strategies_status_private.sql` (CONTRIB-02, Phase 110, 2026-07-16) for allocator-contributed strategies, which are real live strategies with real keys and real ledgers. `ledger_refresh_staleness` does not filter on `status`, so **view and fan-out disagree about the cohort totally: 6 stale rows, 0 eligible.** The string `private` appears **0 times** in the fan-out migration and **0 times** in the staleness-view migration — the case was never considered, not considered and rejected.
**Root cause of the omission:** the fan-out's own comment says the pair mirrors `ALLOWED_STRATEGY_STATUSES` (`analytics-service/routers/cron.py:148`) minus `draft`; that set is `{draft, pending_review, published}` and was never widened when `private` shipped. The sibling recurring fan-out (`20260412094449:239`, April 2026) carries the same pair.
⭐ **FOUNDER DECISION 2026-09-17: admit `private`.** One forward migration widening the eligibility set, behind the three reviewers (`migration-reviewer` + `rls-policy-auditor` + `silent-failure-hunter`) BEFORE any apply, then merge -> `apply-test` -> the PROD `apply` behind the `Production` environment's human reviewer gate.
**Projected, stated BEFORE it is built so it can be checked afterwards:** 4 of the 5 mt5 strategies become candidates (`87bb2086…` stays excluded on `ak.disconnected_at IS NOT NULL`, which is the exclusion working); the per-venue cap `venue_rank <= 2` still admits only 2 per tick; the 20-hour cooldown still bounds the backlog at the cohort size; and the deribit composite `081f2912…` at 141 days stays excluded by D-01 by design and ⛔ must NOT be reported as fixed by this phase.
**Also in scope:** whether `ALLOWED_STRATEGY_STATUSES` and the April sibling fan-out carry the same gap, and whether a gate should pin the view's cohort and the fan-out's cohort to each other so a future status can never again be surfaced as stale by one and refused by the other.
⛔ **MEASURED AT PLANNING TIME 2026-09-17, and it narrows one sentence above.** `s.status IN ('published', 'pending_review')` appears **TWICE** in `20260911130000` — at `:611` in `enqueue_ledger_refresh_for_strategies` and at `:1059` in `enqueue_ledger_composite_refresh`. This phase's own `164.5.1.1-RESEARCH.md` and `164.5.1.1-PATTERNS.md` both assert the composite function "has no status conjunct at all", and all three of RESEARCH/PATTERNS/VALIDATION therefore instruct that `supabase/tests/test_ledger_refresh_composite_arm.sql`'s foreign-candidate precondition be widened in lockstep. **That instruction is refused by the plans and the refusal is recorded here rather than only in a plan:** that precondition mirrors the conjunct of the function it guards, that conjunct is NOT widened here, and widening the guard alone would make it abort on a foreign candidate the guarded function would itself refuse — a false abort, not a tighter gate. `164.5.1.1-01-PLAN.md` carries the full finding; `164.5.1.1-03-PLAN.md` annotates the composite gate and books the composite function's own `private` blindness as a separate, measured deferral with a named destination phase. The "one site" framing above stays TRUE of the function being widened and is now explicit about which function that is. Canonical-snapshot count, for the record: **three** bodies under `supabase/schema/functions/` carry that literal — the two above plus `enqueue_poll_positions_for_all_strategies` (the April sibling, scoped out by decision).
**Requirements**: TBD — no REQUIREMENTS.md ids are declared for this phase. The binding obligation set is `164.5.1.1-CONTEXT.md`'s `<decisions>` block, labelled `CTX-01`..`CTX-12` in the plans, plus TODOS entry `FANOUT-COHORT-PRIVATE-01` and `T-164.5.1-09-07`, which this phase unblocks. ⛔ The plans deliberately do NOT number these `D-01`..`D-12`: `D-01` in this codebase already means the composite/membership deferral, and reusing it would collide with the very exclusion CTX-10 locks.
**Depends on:** Phase 164.5.1 — and it BLOCKS that phase's closure: `T-164.5.1-09-07` (the fan-out's all-candidates-failed branch) cannot be exercised while the candidate set is empty for an unrelated reason, so `164.5.1-VERIFICATION.md` cannot report `passed` and `WINDOWS.md` entry 60 cannot close until this lands. ⚠️ Placed AHEAD of 164.5.2 BRIDGELOCK, 164.5.3 MT5CREDS and 164.5.4 MT5RECON-GAP deliberately: this is a SQL migration on a venue-agnostic conjunct, not MT5 work — the five mt5 rows are what PROD happens to hold, and the deribit composite carries the same `private` status.
**Plans:** 4 plans

Plans:

**Wave 1** — no dependencies; the tracer.

- [x] 164.5.1.1-01-PLAN.md — wave 1, tracer. The forward migration widening the single-key fan-out's lifecycle conjunct, re-based on the committed snapshot with the VAC-04 body acknowledgement earned rather than pasted; the regenerated canonical snapshot; the `private`-admits `RED-UNDER` arm with its apply list re-pointed at the new migration; `ARMS_FLOOR` raised to the corpus's own printed count; the arm neuter-verified.

**Wave 2** *(blocked on Wave 1)* — shares `test_ledger_refresh_fanout.sql` and `scripts/mutation-runner/run.mjs` with plan 01, and its arm must come SECOND or plan 01's twin reports a wrong first failure.

- [x] 164.5.1.1-02-PLAN.md — wave 2. The cohort-agreement arm, deriving the status domain from `pg_get_constraintdef` and the admitted set from a comment-stripped `pg_get_functiondef` so neither can rot the way the literal being repaired did; the real status-domain migration added to the lane's apply list so the class neuter can ride a mutable file; neuter-verified against a genuinely NEW sixth status.

**Wave 3** *(blocked on Wave 2)* — ⚠️ NOT forced by a `files_modified` overlap (02 ∩ 03 = ∅). It is forced one level down: plans 01 and 02 both assert `git diff --quiet -- supabase/tests/test_ledger_refresh_composite_arm.sql`, and plan 03 edits exactly that file, so running them together false-fails plan 02's verify. Re-slicing this phase by file disjointness alone would dissolve a real constraint.

- [x] 164.5.1.1-03-PLAN.md — wave 3. Enumerate every production site of the literal and every reader of `ALLOWED_STRATEGY_STATUSES` without changing either; annotate — never widen — the composite gate's precondition; book the three sibling-cohort findings with an owner, a trigger and a destination phase.

**Wave 4** *(blocked on Waves 1-3)* — `autonomous: false`; carries the one-way door (the PROD apply) behind a blocking-human checkpoint.

- [x] 164.5.1.1-04-PLAN.md — wave 4, checkpoints (`autonomous: false`). Three reviewers before any apply is requested; the ship and the apply via `apply-test` then the PROD `apply` behind the human reviewer; then the NATURAL `25 * * * *` tick measured against the BEFORE census, and `T-164.5.1-09-07` exercised by plan 08's already-recorded mechanism.

**Cross-cutting constraints** — locked decisions cited by two or more plans, so a change to any one of them reaches more than the plan that names it first:

- **CTX-10** (plans 01, 03, 04) — the deribit composite `081f2912…` at 141 days stays excluded by D-01 and ⛔ must NOT be reported as fixed by this phase. Guarded by an automated polarity-aware check in plan 04 task 3.
- **CTX-07 / CTX-08** (plans 01, 02) — both new arms are neuter-verified, and `ARMS_FLOOR` is read from the runner's own printed count, never from a raw `grep -c` (403 ≠ 392) and never cleared by a waiver (`WAIVED_CEILING` is 0).
- **CTX-03 / CTX-04** (plans 01, 03) — the sibling April fan-out and `ALLOWED_STRATEGY_STATUSES` are MEASURED, not changed, by this phase.
- **CTX-06** (plans 01, 02) — the cohort-agreement arm derives both sets from the catalogue, so neither can rot the way the literal being repaired did.
- **CTX-09 / CTX-11 / CTX-12** (plans 01, 04) — the natural `25 * * * *` tick is the oracle, the composite and disconnected-key exclusions stay out of scope by name, and `T-164.5.1-09-07` is exercised here.

### Phase 164.5.1.2: FANOUTSIBLINGS — the daily position poll never runs for a single real strategy, and the sync constant lets the cursor lie: measure, then decide (INSERTED)

**Goal:** Phase 164.5.1.1 widened ONE lifecycle predicate because there was a PROD measurement for exactly one predicate. This phase asks, for each of the two remaining sites it deliberately left alone, whether leaving it alone is still right — and answers each with its own evidence. ⛔ **It does NOT pre-commit to a widening.** Two of the three may be correct as they stand, and one of them interacts with a founder-locked exclusion that widening would reverse as a side effect.

⛔ **MEASURED 2026-09-17 by Phase 164.5.1.1 plan 03, from the canonical bodies under `supabase/schema/functions/` (the replayed current definitions — a migration-by-migration search answers a different question and can be fooled by a later redefinition). THREE bodies carry the two-value lifecycle literal; this phase inherits the two that were not widened:**

- ⛔ **`enqueue_ledger_composite_refresh` — OUT OF SCOPE, founder decision 2026-09-17.** It was a third site here until the scope was cut back. It is **NOT SCHEDULED and not called by anything**, so no user observes it; D-01 already decided the composite deliberately and CTX-10 guards that decision with an automated polarity check. Re-litigating a settled decision about a dormant function is not what the deferral gate is for — only user-facing and data-integrity work earns a phase. ⚠️ Reopening it needs its own evidence and its own decision, never a side effect of this phase.
  📜 Original finding, kept as lineage: (`supabase/schema/functions/enqueue_ledger_composite_refresh.sql:266`) — NOT SCHEDULED, and not called by anything. Zero matching rows in the captured production cron manifest (`scripts/prod-prober/cron-manifest.json`, captured `2026-09-17T08:05:56Z` against the PROD marker), no caller in `analytics-service/` or `src/`, and `20260825140000_ledger_refresh_composite_arm.sql` applied it DORMANT in its own `RAISE NOTICE` (*"no schedule registered"*). **What a user observes today:** nothing this conjunct does is observable, because the function never runs — so widening it alone would change nothing at all. ⛔ **The 141-day composite factsheet is NOT fixed by Phase 164.5.1.1 and must never be reported as such (CTX-10).** It is excluded from the SINGLE-KEY fan-out by that function's `is_composite` conjunct (D-01, by name and by design) and from the composite fan-out by the absence of any schedule. Reversing D-01 is a separate decision with its own evidence, and this phase is where it is taken — or refused.
- **`enqueue_poll_positions_for_all_strategies`** (`supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql:44`) — **LIVE, but not via pg_cron.** ⛔ Its absence from the cron manifest does NOT mean dormant, and reading the manifest alone gets this exactly backwards: the Railway worker's `daily_enqueue_tick` (`analytics-service/main_worker.py:1110-1121`) calls it once per UTC day. ⛔ **CORRECTED 2026-09-19: this entry previously said that call was made under `pg_try_advisory_lock('daily_position_polling')`. THAT LOCK DOES NOT EXIST.** Measured at HEAD: zero occurrences of the lock name anywhere in `analytics-service/`, and zero `pg_try_advisory_lock` / `advisory_lock` calls of ANY name in `main_worker.py`. The real guard is `_daily_enqueue_already_ran_today()`'s UTC-day check plus `enqueue_compute_job`'s idempotent dedup. ⚠️ The same false sentence is carried by the SQL comment in `enqueue_poll_positions_for_all_strategies` itself, which is the likely origin — a comment asserting a concurrency control that was never implemented is worse than no comment, because it invites someone to rely on it. Correcting that one costs a migration and is left to this phase to weigh. **What a user observes today:** every production strategy carries the owner-only terminal status, so the daily loop's candidate set should be empty and no `poll_positions` job should be created for any of them — the SAME class of defect as the measured ledger one, on a different job kind. ⚠️ Stated as an INFERENCE from two measurements (the predicate, and that the loop runs), NOT as a production reading: counting `poll_positions` rows needs PROD and belongs to a session, not to a grep.
  ⭐ **AND IT CARRIES A SECOND EXCLUSION THAT HIDES BEHIND THE FIRST.** The same `WHERE` also requires `EXISTS (a sync_trades job done in the last 30 days)`. `sync_trades` is issued only by `/cron-sync`, whose own `ALLOWED_STRATEGY_STATUSES` filter ALSO omits the owner-only status. An owner-only strategy therefore fails BOTH conjuncts, and **widening the lifecycle one ALONE would change nothing observable.** This is the measured reason this phase must decide rather than widen, and it is invisible to anyone who reads only the literal.
- **`ALLOWED_STRATEGY_STATUSES`** (`analytics-service/routers/cron.py:148` = `{draft, pending_review, published}`) — ONE declaration, ONE reader (`:658`). A strategy failing the filter is dropped from `strategy_ids`, so `/cron-sync` issues it no `sync_trades` RPC, stores it no trades, and enqueues it no `derive_broker_dailies` re-entry from that path. ⚠️ **And the cursor still advances:** with every strategy on a key filtered out, `any_trades_to_store` is False, so `should_advance_cursor` is True and `last_sync_at` is bumped on a tick that stored nothing — the `last_sync_at` LIES class, on a new path.
- ⛔ **A CORRECTION THIS PHASE MUST INHERIT, because the phase that produced the finding also disproved half of it.** `164.5.1.1-RESEARCH.md` frames the constant's gap as starving the ledger refresh of trade data. **That premise is FALSE, measured:** `run_derive_broker_dailies_job` (`analytics-service/services/job_worker.py:2624`) runs its OWN venue crawl (realized-PnL ledger + funding + equity) and, over its WHOLE body (`:2624-5956`, bounded to the next top-level statement — ⚠️ a partial line range is exactly the error that produced RESEARCH.md's wrong composite claim, and it was nearly repeated here), touches three tables through PostgREST — `strategy_analytics`, `csv_daily_returns`, `allocator_equity_derived` — and issues one RPC, `enqueue_compute_job`. **`trades` appears ZERO times.** The constant's gap costs the `trades` table and the daily recompute re-entry; it does **not** starve the ledger refresh. Do not re-derive the original framing from RESEARCH.md.

**The one open question that cannot be settled from code, and is NOT this phase's to answer first:** whether an owner-only strategy shares an `api_key` with a sibling strategy whose status IS in the set — in which case `/cron-sync` still syncs the key and trades still arrive via the sibling row, and the constant's gap is narrower than it looks. That needs a production read and is handed to Phase 164.5.1.1 plan 04's PROD session, where a read is already happening.

⭐ **PROD MEASUREMENT 2026-09-17 — this replaces TWO INFERENCES this entry previously carried, and it sharpens one of them into a harder finding.** Taken in a live session against production (marker read first: `⛔ PRODUCTION`), which is exactly where the entry said this reading belonged: *"counting `poll_positions` rows needs PROD and belongs to a session, not to a grep."*

| lifecycle status | strategies | ever polled | ever synced | with position snapshots |
|---|---|---|---|---|
| archived | 20 | 0 | 0 | 0 |
| **private** | **6** | **0** | 2 | **0 — never, not once** |
| pending_review | 5 | **0** | 0 | 1 (newest 2026-06-05) |
| published | 3 | 1 | 1 | 3 (newest 2026-09-17 07:02Z) |

⛔ **CORRECTION — the prose above was WRONG in its wording, and the correction matters.** It said the daily loop's *"candidate set should be empty and no `poll_positions` job should be created for any of them"*. The candidate set is **NOT empty**: 23 `poll_positions` jobs exist in the last 30 days, the newest from 2026-09-17 07:02Z. They all belong to ONE strategy, `fc1b4014…`, which is `published`. The predicate does exactly what it says. The true statement is narrower and worse: **no `private` strategy has ever been polled, and none has a single position snapshot** — while every `published` one is current to today.

⭐ **AND THE SECOND EXCLUSION IS NOW MEASURED, not read out of the code.** This entry inferred from the source that a lifecycle widening alone would be inert because of the `sync_trades`-in-30-days conjunct. **PROD proves it:** the five `pending_review` strategies ALREADY PASS the lifecycle conjunct and have still never been polled. A status that is admitted and still yields zero is the direct evidence that the lifecycle set is not the binding constraint here — the opposite of what Phase 164.5.1.1 found for the ledger fan-out, where it was the only one. ⛔ Widening this predicate alone would therefore change nothing observable, and shipping it as a fix would be a change that cannot be falsified by its own outcome.

**What a user loses today, stated as an effect and not as a mechanism:** `run_poll_positions_job` fetches open positions from the venue and persists snapshots. For all six real, live, key-bearing strategies there are none, ever. That is the user-facing half of this phase; the `last_sync_at` advance on a tick that stored nothing is the data-integrity half. ⛔ Those two are why this is a phase at all — the scope was cut from three sites to two on 2026-09-17 precisely because the third was neither.

**Success Criteria** (each is a DECISION with evidence, not a change):

1. For each of the TWO sites, a recorded verdict — widen, leave, or retire — with the measurement that justifies it. A verdict of "leave" is a valid outcome and must be recorded as explicitly as a change.
2. If the poll-positions conjunct is widened, the `sync_trades`-in-30-days conjunct is addressed in the SAME decision or the widening is refused as inert. ⛔ Shipping one without the other is a change that cannot be observed.
3. Any change to `ALLOWED_STRATEGY_STATUSES` names what it does to the `last_sync_at` advance, since that is the path a widening newly exposes.
4. ⛔ Any SQL change follows this repo's apply path: three reviewers (`migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter`) BEFORE any apply, then merge → `apply-test` → the PROD `apply` behind the `Production` environment's human reviewer gate.

**Requirements**: `TODOS.md` entries `FANOUT-COHORT-SIBLING-COMPOSITE-01`, `FANOUT-COHORT-SIBLING-POLL-01`, `FANOUT-COHORT-SYNC-CONSTANT-01` — all three booked 2026-09-17 by Phase 164.5.1.1 plan 03 with their measurements.
**Depends on:** Phase 164.5.1.1 FANOUTCOHORT — its plan 04 PROD session answers the shared-key question above, and its migration is the precedent any widening here re-bases on.
**Plans:** 3/3 plans executed

Plans:

- [x] 164.5.1.2-01-PLAN.md — the one PROD sibling-key read, then close FANOUT-COHORT-SIBLING-POLL-01 and the widening-verdict half of FANOUT-COHORT-SYNC-CONSTANT-01
- [x] 164.5.1.2-02-PLAN.md — fix the `last_sync_at` cursor-advance defect (D-03), calibrated RED→GREEN
- [x] 164.5.1.2-03-PLAN.md — close D-03's half of FANOUT-COHORT-SYNC-CONSTANT-01, record the advisory-lock comment decision, and the phase-wide falsifiability guard

### Phase 164.5.2: BRIDGELOCK — the per-strategy advisory lock 161.1-D1 asked for, in its own phase as DEC-4 required (INSERTED)

**Goal:** Close `161.1-D1`: `mark_compute_job_done` and `mark_compute_job_failed` both fan into the bridge without serializing per strategy, so two concurrent terminal marks on one strategy can interleave. Add a per-strategy advisory lock to BOTH RPCs, with a real concurrency test observed RED without the lock and GREEN with it.

⛔ **SPLIT OUT of Phase 164.5 on 2026-09-07 by founder decision, honoring `TODOS.md` DEC-4** — *"the D1 advisory lock gets its OWN phase, with a real concurrency test."* Phase 164.5's criterion 6 had folded it into a single clause, which is exactly the compression DEC-4 refused. Its plan was written to lift without rework, is file-disjoint from every 164.5 sibling, and does NOT contribute to VAC-07's scoring fence — so lifting it blocked neither criterion 6 nor VAC-07.

**⚠️ MEASURED before planning, do not re-derive:**

- **`mark_compute_job_done` is redefined NINE times across `supabase/migrations/**`.** The new body MUST be re-based on the LATEST definition, or nine migrations' worth of change is silently reverted by a `CREATE OR REPLACE`. This is the single largest risk in this phase.
- It is DIFFERENT work from Phase 164.5's VAC-07 spec: different objects (`compute_jobs` mark RPCs vs `wizard_session` csv-finalize) and different substrates (bare pg-lane here, the local-stack lane there).
- Scope: ONE migration `CREATE OR REPLACE`ing TWO RPCs, plus a new `RED-UNDER`-annotated SQL gate on the pg-lane, plus a move of BOTH mutation-runner floors.

**Success Criteria**:

1. Both `mark_compute_job_done` and `mark_compute_job_failed` take a per-strategy advisory lock, each body re-based on its LATEST definition — proven by showing the pre-edit body was read from the newest migration defining it, not an older one.
2. The concurrency test is observed RED with the lock removed and GREEN with it restored. ⛔ Two connections with genuinely separate sessions — a single-client `Promise.all` CANNOT produce a race and is a test that cannot fail.
3. The new SQL gate carries `RED-UNDER` annotations the mutation runner PROVES bite, and both `FILES_FLOOR` and `ARMS_FLOOR` move. ⚠️ Read those constants BY SYMBOL from `scripts/mutation-runner/run.mjs` — CLAUDE.md's prose has already drifted from them once.
4. Arm failures print `TEST FAILED (X):`, not `ARM x FAILED` which the runner's identity regex cannot see. An arm no production mutation can redden is labelled an INVARIANT rather than counted.
5. ⛔ Production DDL: merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD, so three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before any apply, and the apply is a founder gate.

**Requirements**: TODOS entries `161.1-D1`, DEC-4
**Depends on:** Phase 164.4.1 (pg-lane with pg_cron). ⚠️ NOT Phase 164.5 — the plan is file-disjoint from it and was lifted whole.
**Routed here 2026-09-25 (from 164.9.1 review round 1), both latent or loud, both on the terminal-mark / bridge surface this phase owns:** (1) a fan-in child whose parent is still open at enqueue and later ends `failed_final` stays in `done_pending_children` forever (no caller passes parents today); (2) a second `match_decisions` delete can raise 23505 through the ON DELETE SET NULL cascade onto `bridge_outcomes_legacy_per_strategy_holding_when_md_null` (pre-existing, fails loudly, the admin decisions route issues these deletes). (3) the fan-in parent lock `FOR SHARE ... ORDER BY id` can deadlock (40P01) against `mark_compute_job_done` in a diamond (a child whose parents include another waiting child); latent, recorded in M1's header — whoever passes parents must treat 40P01 as retryable on both the enqueue and the worker's mark path. (4) **Routed 2026-09-25 from the 164.9.1 pre-push silent-failure-hunter (MEDIUM, pre-existing, NOT introduced by 164.9.1): one `failed_retry` + `pending` pair on the same `(kind, api_key_id)` wedges the WHOLE claim.** `claim_compute_jobs` and `claim_compute_jobs_with_priority` rank `pending` and `failed_retry` candidates together, and their C39 / NEW-C39-01 `NOT EXISTS` guard excludes a partition only when it already holds a `running` or `done_pending_children` row — never a `pending` one. The enqueue look-up (`_enqueue_compute_job_internal`) treats only `pending`/`running`/`done_pending_children` as in-flight, so it inserts a fresh `pending` beside a `failed_retry`. When the `failed_retry` wins `rn_k` (earlier `next_attempt_at`, or the `pending` is not yet due), the batch `UPDATE ... SET status = 'running'` puts two rows into `compute_jobs_one_inflight_per_kind_api_key` and raises 23505 — and because it is ONE statement, no job of ANY kind is claimed until the pair clears. Loud, not silent: every claim call errors. The same guard shape exists for the portfolio, strategy and allocator partitions against their sibling indexes; audit all four. **Suggested fixes (not decided):** (a) add `'pending'` to each guard's `x.status` list with `x.id <> ranked.id`, in BOTH claim RPCs — a `pending` candidate can have no `pending` sibling under the index, so this only removes the colliding `failed_retry`; (b) and/or make the enqueue look-up fold into, or supersede, an existing `failed_retry` for the partition instead of inserting beside it; (c) whichever is chosen, a `RED-UNDER`-annotated SQL gate on the lane must pin it. **Measured repro, local-stack lane only (`scripts/local-stack/run.sh up`, loopback DSN from its `.stack-env`, then `down`):** in one transaction that ends in `ROLLBACK`, with `SET LOCAL session_replication_role = replica` so a synthetic `api_key_id` needs no FK rows, insert two `poll_allocator_positions` rows sharing one `api_key_id` — a `failed_retry` with `next_attempt_at = now() - 10 min` and a `pending` with `next_attempt_at = now() + 10 min` — reset the role to `origin`, then call `claim_compute_jobs(10, 'repro-worker')` (and, after a savepoint rollback, `claim_compute_jobs_with_priority(10, 'repro-worker', NULL::boolean, NULL::text[], NULL::text[])`; the two-arg call is ambiguous across its overloads). Both raised `duplicate key value violates unique constraint "compute_jobs_one_inflight_per_kind_api_key"` on 2026-09-25 at the 164.9.1 release head.
⛔ **RE-ROUTED 2026-09-26 by founder decision (AskUserQuestion, "Re-route, don't start") — this phase owns NONE of the four items above any more.** The paragraph above is kept as lineage. Item (4), the claim wedge, went to Phase 164.9.3 CLAIMPAIR, which already owns C39 and the same 23505 class. Items (1) stranded fan-in child, (2) `match_decisions` delete 23505 and (3) 40P01 diamond deadlock went to the new Phase 164.9.3.1 FANINGRAPH, booked but NOT started under the new-phase freeze. This phase's scope is back to `161.1-D1` and DEC-4 only.
**Plans:** 1 plan (lifted from Phase 164.5 plan 08, unmodified)

Plans:

- [ ] 164.5.2-01 — the advisory lock in both mark RPCs + the concurrency gate (lifted from 164.5-08)

### Phase 164.5.3: MT5CREDS — show the MT5 account number on the key card and add a credential-update path (INSERTED)

**Goal:** A founder (and a first-time client) can tell which MT5 account a key card belongs to, and can correct a wrong password without deleting the key. Two measured gaps (2026-09-16): `src/app/api/` has ONLY create routes — no update/rotate path — so a wrong password is fixable only by Delete + Add Key; and the MT5 login lands in `api_key`, whose SELECT migration `20260410225608_api_keys_column_revoke.sql` revokes from `authenticated`, so `API_KEY_USER_COLUMNS` (`src/lib/constants.ts:171`) cannot expose it and the card shows only `label` — sourced from the OPTIONAL "Key nickname" field (`ConnectKeyStep.tsx:1188`, fallback `"mt5 key"`). Several MT5 accounts therefore render indistinguishably. ⭐ The MT5 login is NOT a secret (the password is): expose it via a READABLE display column rather than by decrypting the existing one, and add a card action that re-encrypts `api_secret` ONLY, leaving the row and its sync history intact.
**Requirements**: D-01-PRIME, D-02-PRIME, D-03, D-04, D-05, D-06, D-07 (from `164.5.3-CONTEXT.md`'s locked decisions — no `REQUIREMENTS.md` entries exist for this inserted phase, so the decision IDs are the requirement set, per `164.5.3-RESEARCH.md`'s own framing).
**Depends on:** Phase 164.5.1 — placed AFTER its go-live; neither blocks the other.
**Plans:** 5 plans

Plans:

- [ ] 164.5.3-01-PLAN.md — Wave 1: GRANT-extend migration (reuse `venue_account_id`, no new column) + three-way sync + render the identifier on both key cards
- [ ] 164.5.3-02-PLAN.md — Wave 1: populate `venue_account_id` at the non-wizard "Add Key" create chokepoint (`validate-and-encrypt`), with the new venue-identity 23505 arm
- [ ] 164.5.3-03-PLAN.md — Wave 1: new analytics-service internal endpoint — decrypt, re-validate the new password against the live broker, re-encrypt; plaintext never leaves Python
- [ ] 164.5.3-04-PLAN.md — Wave 1: new `PATCH /api/keys/[id]/rotate-secret` route — password-only, validate-before-persist, admin-client write, D-05 status-clear
- [ ] 164.5.3-05-PLAN.md — Wave 2 (depends on 01, 04): the "Update password" dialog wired into both key cards

### Phase 164.5.4: MT5RECON-GAP — the MT5 backfill path and the login-error classifier both fail silently (INSERTED)

**Goal:** Two MEASURED defects on the MT5 path, both live in PROD on 2026-09-16, both of the same class — MT5 is routed down a path that does not know about it, and the failure degrades to an endless silent retry instead of a verdict anyone can read. (1) **The full-backfill job has no MT5 branch.** `run_reconstruct_allocator_history_job` (`analytics-service/services/equity_reconstruction.py`) branches on `venue == "deribit"` and otherwise falls into the generic ccxt crawl, which calls `exchange.fetch_my_trades(...)` at `:620`. MEASURED: `Mt5Session` has NONE of the six ccxt methods that module calls (`fetch_my_trades`, `fetch_balance`, `fetch_ohlcv`, `fetch_ticker`, `fetch_positions`, `fetch_mark_prices` — 0/6), because its deal-ledger equivalent is `history_deals_get` (`mt5_client.py:822`). The existing guard `except ccxt.NotSupported` cannot catch the resulting `AttributeError`, so the job ends `failed (unknown)` — PROD log 2026-09-16 20:18:13, `'Mt5Session' object has no attribute 'fetch_my_trades'`, allocator 4d2b92f3, venue=mt5. ⭐ The correct MT5 path ALREADY EXISTS but only for the sibling job kind: `combine_mt5_deal_ledger` / `history_deals_get` under `venue == "mt5"` at `job_worker.py:4082` (MT5RECON-01/03). This phase gives the backfill job the branch its sibling already has. ⚠️ Same defect CLASS as the already-fixed `'Mt5Session' object has no attribute 'fetch_balance'`, named as a past PROD defect in `allocator_positions.py:129` — the sibling method was fixed, this one was not; close the CLASS, not the instance. (2) **`classify_mt5_login_error` stamps a PERMANENT, CONFIDENT, WRONG verdict on a working credential.** Its `_WRONG_SERVER_TOKENS` / `_AUTH_TOKENS` tables in `analytics-service/services/mt5_validation.py` are marked `[ASSUMED] pending the live spike` and were never validated. ⛔ **CORRECTED 2026-09-20 — THIS ENTRY PREVIOUSLY DESCRIBED THE DEFECT BACKWARDS, and the correction changes both its severity and its remedy.** It said the broker text `Invalid account` *"matches NEITHER table, so it degrades to `transient` and is retried forever; the founder never sees an account verdict."* **Measured at HEAD by executing the function** (`Mt5ClientError(0, 'Invalid account')` → `classify_mt5_login_error`): it returns **`auth`**, not `transient`. `_AUTH_TOKENS` contains BOTH `invalid` AND `account`, so the text matches twice over and can never reach the `transient` default. ⭐ **And the real consequence is WORSE than the one that was written.** `auth` routes to `_auth_failed()` in `services/ingestion/mt5.py`, and `services/mt5_concurrency.py`'s own docstring names the outcome: *"a PERMANENT user-attributed `failed` stamp"*. So for an account that is on the CORRECT server with a WORKING password, the founder is not left without a verdict — they are given a confident, permanent one that blames their credentials, and they will go change a password that was fine while the real cause goes uninvestigated. A silent retry is recoverable; a wrong user-blame stamp sends someone down the wrong path. ⚠️ **The prescribed remedy changes with it.** "Replace `[ASSUMED]` with measured tokens" does NOT fix this: the table already matches. The defect is OVER-matching — `account`, `invalid` and `login` are broad enough to swallow almost any message and land it on `auth`. ⛔ A live spike that only ADDS tokens makes over-matching worse. The open question this phase must answer is whether three classes (`auth` / `wrong_server` / `transient`) are even sufficient: `Invalid account` is neither a wrong password nor a wrong server, and the honest answer may be a fourth class, or a precedence rule that REFUSES to guess rather than defaulting to blame. Keep the fail-CLOSED ordering (a server/bridge signal must still win over an auth signal) and add a rule that an unrecognised message must never produce a user-attributed permanent stamp. ⚠️ The live spike the comments defer to is still needed — ⛔ but no agent may drive it, because the founder enters credentials and no agent ever does; the phase must design that hand-off rather than plan a task nothing can execute. (3) **`KEY_UNDECRYPTABLE` is discarded at the language seam, so the founder is told to retry something that can never work.** Both `get_key_permissions` and `rotate_key_secret` in `analytics-service/routers/internal.py` raise `KEY_UNDECRYPTABLE` (500, `retryable=False`, detail *"This stored key could not be decrypted. It must be reconnected."*) when `decrypt_credentials` fails — Python KNOWS the remedy. TypeScript throws it away: the code has NO row in `VENUE_WIRE_CODE_TO_VERDICT` (`src/lib/wizardErrors.ts`), so `classifyKeyValidationError`'s substring cascade falls through to `UNKNOWN`/500, whose copy says we could not classify the failure and which renders a Retry control. A ciphertext that will never decrypt cannot be fixed by retrying. ⭐ **WHY THIS IS ROUTABLE NOW AND WAS NOT BEFORE — the load-bearing part.** The code is not merely unrostered; it carries an entry in `VENUE_WIRE_CODES_WITHOUT_VERDICT` whose stated justification reads verbatim *"That is a real gap, it belongs to the permissions route's own vocabulary, and a row in this table cannot close it because that route never calls this function."* ⛔ **Phase 164.5.3 FALSIFIED that premise:** `src/app/api/keys/[id]/rotate-secret/route.ts` emits the SAME code via the SAME decrypt failure AND calls `classifyKeyValidationError`, so a verdict row IS now reachable and the exemption's own reason no longer holds. That same table already concedes the user impact in its own words — *"today the PROBE_FAILED envelope tells them to 'try again' — which cannot work for a ciphertext that will never decrypt."* **Why it belongs HERE rather than in 164.5.3:** it is the same defect CLASS as (2) — MT5 produces a signal carrying a real verdict and the classifier degrades it into something the founder cannot act on. 164.5.3 deliberately left it open rather than force a `WizardErrorCode` mint into a fix round scoped to one roster row, and documented it at BOTH sites rather than dropping it: the `⚠️ RESIDUAL, not closed by this fix` comment at the rotate-secret route's seam-failure throw site, and the `⚠️ NOT rostered: KEY_UNDECRYPTABLE` note in `DASHBOARD_DIALOG_ROUTE_CODES`. ⚠️ **Closing it needs a DECISION, not just a row — the options are recorded, NOT pre-decided:** (a) a `VENUE_WIRE_CODE_TO_VERDICT` row, which forces picking an honest verdict member — ⛔ NOT `KEY_PROBE_FAILED` (recoverable ⇒ renders the same useless Retry), ⛔ NOT `SEAM_MISCONFIGURED` (an operator cannot fix a corrupted per-row ciphertext); (b) a dedicated pre-classifier arm mirroring the one `src/app/api/keys/[id]/permissions/route.ts` already carries; or (c) minting a real `WizardErrorCode` whose copy states the actual remedy — reconnect this key. ⚠️ Option (c) moves the copy-table `EXPECTED_TABLE_SIZE` pins, which are hand-typed in more than one place — ⛔ do NOT count them, GREP, and move each in the assertion AND in any test TITLE restating it.
**Requirements**: TBD
**Depends on:** Phase 164.5.1 — placed AFTER its go-live. Defects (1) and (2) remain independent of Phase 164.5.3 (that one is the key-card UI, this one is the ingest path). ⚠️ Defect (3) is ROUTED FROM Phase 164.5.3 and presupposes its rotate-secret route has landed — that route is what makes a verdict row reachable at all, so this third half cannot start before 164.5.3 merges.
**Plans:** 6/6 plans complete

Plans:
**Wave 1**

- [x] 164.5.4-01-PLAN.md — defect (2): the login classifier refuses to guess — anchored phrases replace the over-matching token tables, an executable fail-CLOSED precedence pin, the four production-copy gates re-pointed at the classifier itself, and the live-spike hand-off landed as an empty synthetic fixture (wave 1)
- [x] 164.5.4-02-PLAN.md — defect (3), rotate-secret route: mint the `WizardErrorCode`, add the `VENUE_WIRE_CODE_TO_VERDICT` row that routes to it, retire the exemption entry, roster it for the dialog, move both `EXPECTED_TABLE_SIZE` pins with their reasoning re-run (wave 1)
- [x] 164.5.4-03-PLAN.md — defect (3), permissions route: gate `KeyPermissionBadge`'s re-check control on the route's own error code, and bind the dead `retryClearsIt` roster judgement to that gate (wave 1)
- [x] 164.5.4-05-PLAN.md — defect (1), A-01 resolved: one shared MT5 deal fold plus a NAV-LEVELS sibling of `combine_mt5_deal_ledger` built on `nav_twr.reconstruct_nav` (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 164.5.4-04-PLAN.md — defect (1): extract the MT5 deal-ledger read into the leaf module `services/mt5_read.py` so the backfill job and its derive sibling share ONE fetch (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 164.5.4-06-PLAN.md — defect (1), TRACER: the `venue == "mt5"` branch in `run_reconstruct_allocator_history_job`, end to end — kill-switch, shared read, levels conversion, row contract, shared persist (wave 3)

⚠️ **Two open questions were RESOLVED at plan time on measured evidence, not left to execution.**
**A-01** (returns→levels): a private fold plus a levels sibling in `broker_dailies.py` using
`nav_twr.reconstruct_nav` — the same core `reconstruct_nav_and_twr` calls internally and discards, so
levels and returns agree by construction rather than by re-inverting the returns.
`allocator_equity_derive.replay_key_equity` was measured and REJECTED (it inverts, it refuses the
NaN days the DQ-01 guards exist to mark, and it demands a different index shape). Reasoning in
`164.5.4-05-PLAN.md` `<decision_a01>`.
**A-04** (backfill `wrong_server`): **TRANSIENT**, only `auth` is permanent — ⛔ the OPPOSITE of the
researcher's recommendation. The job is enqueued against an EXISTING active `api_keys` row, so
`validate_key` already proved the server at connect; the sibling derive branch chose the same on the
same reasoning; and CONTEXT.md's D-01 forbids this path stamping permanent-and-blamed. Reasoning in
`164.5.4-06-PLAN.md` `<decision_a04>`.

### Phase 164.6: GATE-HYGIENE — every gate-hygiene item that left 164.1: the OPS-08 residue, the composite-stamp twin, the reviewer execution-status rule, the RED-UNDER convention's discoverability and the audit allowlist (INSERTED)

**Goal:** Close the gate-hygiene half that the 2026-09-05 re-partition removed from 164.1, each with a test that is observed to fail when its guard is neutered. (1) **OPS-08-F9**: `test_enqueue_internal_destrict.sql` gets its `ALL N ARMS EXECUTED` sentinel AND the two `ci.yml` integers (`SENTINEL_FLOOR`, `ARMS_FLOOR` — read the LIVE values off `ci.yml`; the `7→8` / `63→68` in the TODOS entry are 2026-08 figures) move in ONE diff with the per-file derivation entry `ci-anti-skip-gate.contract.test.ts` reads. (2) **OPS-08-F8**: the `sql-tests` loop stops exiting on first failure — every file runs, every red file is named, exit is non-zero once. (3) **OPS-08-TS**: nothing in `src/` retries a 40001 — `csv-finalize/route.ts:2044` is a COPY branch, not a retry, and `allocator/holdings/sync/route.ts:73-86` has no 40001 arm; add the retry at BOTH call sites. (4) **OPS-08-F2**: both pg_cron fan-out paths catch `WHEN OTHERS` and report success; record the failed target id and surface a non-zero failure count from the tick. (5) **Composite-stamp twin (161.1-D13), TS half**: Python honours the marker (`long_fetch.py:66`); the two TS enqueue sites have zero `retract`. (6) **PROC-02**: reviewers declare execution status and UNEXECUTED blocks — one agent-prompt field, the cheapest item in the corpus. (7) **PROC-03 residual**: the per-arm `RED-UNDER` convention SHIPPED in 164.4/164.4.1; what remains is discoverability — `scripts/mutation-runner/GRAMMAR.md` is referenced by nothing a newcomer reads. (8) **H-0001 residual**: shrink the `H_0001_UNCOVERED_ALLOWLIST` — it has SEVEN entries while both ledgers still say six; fix the count and the routes. Also carries WINDOWS 23 (the FALSE "Referrer-Policy does not strip" claim still at `gone/route.ts:93` and `route.test.ts:66` — a one-line correction pass). (10) **PROBER-CALIBRATION-01** — the calibration arm named `CALIBRATION: an UNGUARDED exit 0 on the probe path is still caught` (`src/__tests__/prod-prober-wiring.test.ts:292`, shipped in PR #748 / v0.77.15.0) does NOT demonstrate catching. It mutates the schedule guard to `if true; then`, then asserts only that the text changed and that the mutant no longer contains the guard string — it never re-runs the assertion it claims to calibrate (the `guardAt` / `exitZeroAt` ordering check at `:279-281`) against the mutant and observes it FAIL. ⭐ The arm would still pass with `:279-281` deleted outright, so it certifies nothing about that assertion's power. ⚠️ NOT vacuous in effect — removing the guard from the workflow IS caught, by the `toContain` at `:277` — but the arm's NAME promises a proof it does not perform, which is precisely the 'a test that cannot fail' shape this milestone exists to remove, sitting inside the prober that Phase 164.1 built to make silent failure loud. FOUND at the #748 merge gate 2026-09-06 by hand, not by a gate; booked here by founder instruction rather than into TODOS. DELIVERABLE: make the calibration EXERCISE the assertion — run the guard-position check against the mutant inside an `expect(...).toThrow()` (or the equivalent shape the file already uses for its other calibration arms, e.g. the phase-19-stability splice arm immediately below it), so the arm goes RED if `:279-281` is weakened or removed. (13) **PROGRESS-COUNT-UNDERIVED** — the `progress:` block in `STATE.md` and the `### v1.20 Progress` table in this file were BOTH wrong on 2026-09-12, in the same direction and for the same reason: every figure either was hand-set or came from a handler that counts `.planning/phases/**` ON LOCAL DISK, where the `-pr` filter has stripped four COMPLETE phases (164.2, 164.5, 164.8.2, 164.8.5 = 29 finished plans). MEASURED: the stored values read 31/15/141/137 against a true 33/19/163/160, the table said `0/? Queued NEXT` for a phase shipped in v0.77.15.0 (164.1) and `3/6 Queued 5th` for one that is 6/6 (164.8), and it carried NO ROW AT ALL for eight phases, three of them complete. ⭐ The correction shipped as prose with a stated method and no mechanism, which is the `[CHANGELOG-NO-MECHANISM]` shape this repo has a dated record of — a step that cannot fail did not fail, it was simply never run again. DELIVERABLE: `scripts/planning-progress.mjs`, printing the four integers by enumerating PLAN/SUMMARY paths across ALL REFS, dropping deletions, and EXEMPTING deletions made by the `-pr` filter commit (a filtered artifact is stranded, not withdrawn) — plus a test that the printed integers match the `progress:` block, so a stale ledger is a red check rather than a sentence nobody re-runs. ⚠️ Withdrawn plans must stay excluded from denominators and each one named: 162-10 (`3fa26831`), 164.4-12 (`9b83b064`), 164.5-08 (`7910f614`, lifted into Phase 164.5.2). ⛔ NOT in scope: changing what `gsd-tools query roadmap.analyze` does — it is upstream and `/gsd-update` overwrites it; this is a repo-owned reading that does not depend on it. ⛔ **SPLIT 2026-09-12 BY FOUNDER DECISION — items (9) MYPY-MAINPY-01, (11) MT5-GATEWAY-LOGIN-01 and (12) CI-DOCSPATH-01 MOVED OUT of this phase into THREE phases of their own — `164.6.1 MYPYSTRICT`, `164.6.2 MT5RELOGIN`, `164.6.3 CIDOCSPATH` — and their success criteria moved with them.** The founder was offered three scopings (split / keep all 13 and fix the criteria / narrow to the OPS-08 residue only), chose the split, and then chose ONE PHASE PER ITEM over a single combined GATEINFRA phase — they share nothing: different languages, different blast radii, and only the CI-path one can wedge branch protection. ⭐ The reason is KIND, not size: those three change the Python type gate, a production gateway's login path, and WHEN CI gates fire — the last being the riskiest change possible in a milestone about controls that cannot fire — while what remains here is lint rules, tests and prose corrections. Folding them together would have given the riskiest items the lightest review posture, which is the same argument that kept Phase 164.5.1's production DDL out of this phase. ⚠️ Items are NOT renumbered: the original numbering is load-bearing in `TODOS.md` cross-references and in Phase 164.1's deferral records, so (9), (11) and (12) are absent by design rather than missing. (13) **PROGRESS-COUNT-UNDERIVED** stays here and now has a criterion of its own (criterion 11 below), which it did not have when it was routed in.

**Success Criteria**:

⛔ **SCOPE PRUNE 2026-09-17 (founder decision) — this phase is reduced to criteria 2, 3 and 4.**
Criteria **1, 5, 7, 10, 11, 12, 13, 14, 15 and 17 are DROPPED**: fix-or-drop, never a phase.
They are struck from this phase's scope but their text is kept below as the record of what was
examined and why it was let go — deleting it would leave the next reader re-deriving the same
call.

**The rule applied** (founder, 2026-09-15, scoping the anti-vacuity and deferral rules): a gate
or deferral earns a phase ONLY when it pins DATA-INTEGRITY or USER-FACING behaviour. A structural
or AST predicate, a log line's wording, a comment's accuracy, an internal counter nothing reads,
a refactor-detection fence — those are fix-or-drop. *"Otherwise we will always find something."*

**What survives, and why each one is not hygiene:**

- **(2) OPS-08-TS** — nothing in `src/` retries a `40001`. A serialization failure reaches the
  USER as an error today, at `csv-finalize` and `allocator/holdings/sync`.
- **(3) OPS-08-F2** — both pg_cron fan-out paths catch `WHEN OTHERS` and **report success**. That
  is a silent production failure, and it is the same class that produced Phase 164.5.1.1: a green
  cron row over a job that did nothing.
- **(4) Composite-stamp twin, TS half** — the two TS enqueue sites carry zero `retract`, so a
  marker Python honours is not honoured on the TS path.

**What was dropped, by criterion:** 1 (sentinel + two `ci.yml` integers + a first-failure-exit
test loop), 5 (a reviewer-prompt field, `GRAMMAR.md` discoverability, an allowlist count of seven
against two ledgers saying six), 7 (`PROBER-CALIBRATION-01` — its own entry records
*"NOT vacuous in effect — removing the guard IS caught"*; the defect is that the arm's NAME
promises a proof it does not perform), 10 (`plan-anchor-verify` reading a shipped plan as
pending), 11 (`PROGRESS-COUNT-UNDERIVED` — now also filed upstream as
`Werbelow/get-shit-done#5`, since the recompute is gsd-core's, not this repo's), 12 (a durable
sink for the MT5 capability verdict — observability), 13 (`PHASEDIR-ORPHAN-GITKEEP`), 14
(`WINDOWS-LEDGER-COUNT-DRIFT`), 15 (two planning-subject assertions), 17
(`164.6.2-KILLSWITCH-COMMENT`).

⚠️ **ONE dropped item is a judgement call and is named rather than buried: criterion 16,
`[SERVICEKEY-MISMATCH-UNATTRIBUTED]`** — a rejected `X-Service-Key` naming WHO presented it. It
is security ATTRIBUTION, not secret DISCLOSURE, so the scoped rule puts it on the fix-or-drop
side; but it is the one dropped item whose absence would be felt during an incident. Re-admit it
on the merits if that matters more than the line.

1. OPS-08-F9 + F8: the sentinel is present, both integers moved in the same commit and the contract test passes; `sql-tests` runs every file and names every red one in a single run — proven with two deliberately red fixtures in one invocation.
2. OPS-08-TS: both TS call sites retry on 40001, each with a test that fails when that site's retry is removed. A test that passes with the retry gone at either site does not count.
3. OPS-08-F2: a failed fan-out target produces a non-zero failure count from the tick, proven on the pg-lane with one target forced to raise.
4. The composite-stamp twin's TS half is closed with a test that fails when the `retract` is removed at either enqueue site.
5. PROC-02, PROC-03, H-0001: the reviewer prompt carries an execution-status field and a review of an unexecuted change is BLOCKED by it (proven once on a fixture); `GRAMMAR.md` is linked from a file a newcomer actually reads (`supabase/tests/README` or `CLAUDE.md`'s SQL-gate section); the allowlist is ≤ 6 entries and both ledgers state the same number.
6. ~~MYPY-MAINPY-01~~ — ⛔ **MOVED 2026-09-12 to Phase 164.6.1 MYPYSTRICT** — criterion text travelled with the item; kept as a numbered stub so the original numbering stays stable for the `TODOS.md` and Phase 164.1 cross-references that cite it.
7. PROBER-CALIBRATION-01: the prober's UNGUARDED-exit-0 calibration arm is proven to have power over the assertion it names — the arm runs the `guardAt`/`exitZeroAt` check against the mutated workflow text and asserts that check FAILS. ⛔ Proven by DELETING `prod-prober-wiring.test.ts:279-281` and observing the calibration arm go RED (it is GREEN today with those lines gone, which is the whole defect), then restoring byte-identically — `shasum -a 256` before == after, never `git checkout --`. An arm that still passes with its subject deleted has not been fixed.
8. ~~MT5-GATEWAY-LOGIN-01~~ — ⛔ **MOVED 2026-09-12 to Phase 164.6.2 MT5RELOGIN** — criterion text travelled with the item; kept as a numbered stub so the original numbering stays stable for the `TODOS.md` and Phase 164.1 cross-references that cite it.
9. ~~CI-DOCSPATH-01~~ — ⛔ **MOVED 2026-09-12 to Phase 164.6.3 CIDOCSPATH** — criterion text travelled with the item; kept as a numbered stub so the original numbering stays stable for the `TODOS.md` and Phase 164.1 cross-references that cite it.

10. `[PLANANCHOR-SUMMARY-FILTER-01]`: a plan that has SHIPPED stops reading as pending on `main`, so `plan-anchor-verify` no longer holds its `file:line` anchors live against a tree that has moved on. ⛔ **The gate must NOT be weakened to achieve this** — the fix belongs in how "pending" is decided, never in how anchors are resolved; a change that makes the gate resolve FEWER anchors fails this criterion by definition, because that is the silent-gate class this milestone exists to remove. BOTH halves are required and the second is the one that can go missing silently: (a) a landed phase's PLAN.md, whose SUMMARY the `-pr` filter stripped, no longer appears in `--pending`; (b) a genuinely unfinished plan still does, and its stale anchor is still caught.

⛔ **ROUTED HERE 2026-09-09, out of the PR #767 merge gate — `[PLANANCHOR-SUMMARY-FILTER-01]`.** `/gsd-pr-branch` filters `.planning/phases/` out of the PR head by design, so a plan's SUMMARY never reaches `main` while the PLAN — written in an earlier, unfiltered commit — is already there. The pair is split permanently, and `plan-anchor-verify` treats a PLAN with no SUMMARY as pending.

⚠️ **NOT hypothetical, and not a PR-only artifact.** `164.8-05-PLAN.md` claimed `supabase-migrate.yml:1-251` contains the `Push migrations to production` step — true on `main` (:211). Phase 164.8 plan 05 and its review added ~870 lines and moved it to :1038, so the claim went stale ON `main` the moment the PR landed. `plan-anchor-verify` would have been RED on `main`, not merely on the PR; it surfaced early only because the filtered branch happens to make more plans read as pending. The one-off remedy at #767 — correct that anchor and carry the corrected PLAN through the filter as a named exception — is a workaround that needs repeating every time. **The evidence and the candidate directions are in the TODOS entry; they are not restated here.**

11. `[PROGRESS-COUNT-UNDERIVED]`: `scripts/planning-progress.mjs` prints `total_phases`, `completed_phases`, `total_plans` and `completed_plans` derived across ALL REFS — not from local disk, where the `-pr` filter strips `.planning/phases/**` for complete phases — and a test asserts the printed integers match the `progress:` block in `STATE.md`, so a stale ledger is a RED CHECK rather than prose nobody re-runs. ⚠️ Withdrawn plans must stay excluded from denominators and each named: `162-10` (`3fa26831`), `164.4-12` (`9b83b064`), `164.5-08` (`7910f614`, lifted into Phase 164.5.2). ⛔ Anti-vacuity: neuter the `progress:` block by one and observe the test go RED before trusting it. ⛔ NOT in scope: changing `gsd-tools query roadmap.analyze` — it is upstream and `/gsd-update` overwrites it.

12. `[MT5-VERDICT-SINK-01]`: the MT5 capability verdict gets a durable sink — a row, or a counter that survives log rotation — so an `undetermined` outcome can be READ AFTER THE FACT instead of only while it scrolls past. ⭐ This is what currently makes Phase 161's human item unclosable: re-measured 2026-09-05, `railway logs` returns ZERO matching lines, so there is nothing to look at and no amount of looking fixes that. ⚠️ ADJACENT to `[MT5-GATEWAY-LOGIN-01]` (now Phase 164.6.2 MT5RELOGIN) and they must not be confused: that one is SESSION ESTABLISHMENT, this one is a CAPABILITY verdict with nowhere to land.

13. `[PHASEDIR-ORPHAN-GITKEEP]`: an empty orphan phase directory stops making `find-phase` return `phase_found: false` for a phase that is in fact complete. ⚠️ MEASURED: this is what hid Phase 164.1 (6/6, shipped v0.77.15.0) behind a `164.1-*` twin directory, and the `-pr` filter leaves exactly this shape behind — it strips `.planning/phases/**` but leaves a `.gitkeep`, so the emptied directory merges while the artifacts do not.

14. ⭐ `[WINDOWS-LEDGER-COUNT-DRIFT]`: `gsd-tools windows append` stops failing closed on `.planning/WINDOWS.md`, and the counts are RE-DERIVED from the entries rather than hand-matched. MEASURED 2026-09-12 during Phase 164.6.3 wave 1: the verb refuses every append with `frontmatter open/waived/fixed/total=36/0/11/47 but entries yield 40/0/10/50`. ⛔ **THE CONSEQUENCE IS THE POINT, not the error message.** That register is what blocks `/gsd-ship` while defects are open, and the drift predates this phase — `WINDOWS.md` last moved in `604d655f` (Phase 164.8.5) — so **every phase since that commit has been silently unable to book a broken window**. A ledger that refuses writes reads as empty, which is this milestone's named defect class wearing a ledger's clothes: Phase 164.6.3's own `[164.6.3-MW02-DOCSONLY-BLIND]` could not be entered into it. ⛔ Hand-editing the frontmatter integers to match the entries is EXACTLY the silent absorption this criterion exists to prevent — establish WHICH of the two numbers is wrong before changing either. ⛔ Anti-vacuity: after the fix, append a throwaway entry and observe the counts move, then confirm a deliberately corrupted count still REFUSES; a verb that accepts everything is not a repair. ⚠️ Routed here rather than into `TODOS.md` because this is the third item of the same shape already owned by this phase — a planning ledger whose stored counts disagree with the artifacts they claim to count, alongside criterion 11 `[PROGRESS-COUNT-UNDERIVED]` and criterion 13 `[PHASEDIR-ORPHAN-GITKEEP]`.

15. ⭐ `[164.6.3-PLANNING-SUBJECT-DEFERRED-DETECTION]`: two assertions whose SUBJECT is real `.planning/**` content stop being hosted by a job that the docs-only filter skips on exactly the PR class able to move that subject. MEASURED 2026-09-13 at the `164.6.3` branch HEAD: `src/__tests__/lint-sql-gates.test.ts` reads `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` from disk (its `G3` arm — *"the PLANNING DOCUMENTS do not claim more shapes than the linter ships"*), and `src/__tests__/verify-plan-anchors.test.ts` reads Phase 159's real `159-VERIFICATION.md`. Both are hosted by `frontend-test`, which now carries `needs: [changed-paths]` and `if: needs.changed-paths.outputs.docs_only != 'true'`. **Consequence:** a `.planning/`-only PR that reintroduces the forbidden five-shapes sentence, or deletes or moves that VERIFICATION file, is not caught by its own check board.
   ⭐ **BOTH HALVES ARE LOAD-BEARING — the detection is DEFERRED, never LOST.** It still fires twice: on the UNFILTERED merge push to `main`, and on the next code PR. The exposure window is between a docs-only PR opening and either of those, and inside it a red arrives LATE, not never. ⛔ Do not restate this as "the gate was lost", and do not restate it as "nothing changed" — stating only one half misroutes whoever picks it up.
   ⛔ **TWO REMEDIES WERE CONSIDERED AND BOTH REFUSED — recorded so neither returns as a new idea.** (1) Widen the always-on set to include `frontend-test` — REFUSED: that job is most of the saving the filter exists to produce, so buying two deferred assertions back at that price undoes Phase 164.6.3. (2) Move the two assertions into an always-on job — REFUSED: that changes WHICH gates exist and where they live, which 164.6.3's boundary forbids by name. A candidate direction deliberately NOT chosen there, and left to this phase: a cheap always-on job whose subject is exactly the planning corpus — narrower than `frontend-test` and honest about what it covers.
   ⛔ Anti-vacuity: whatever is built, prove it by making a `.planning/`-only change that SHOULD redden it and observing the red on that PR's own board — not on a later merge push. A remedy that only fires where detection already worked has fixed nothing.

16. ⭐ `[SERVICEKEY-MISMATCH-UNATTRIBUTED]`: a rejected `X-Service-Key` names WHO presented it, not only which path it hit. ⚠️ **MEASURED 2026-09-13 on PROD while the fault was live, and the fault is still OPEN — this criterion is written from an unresolved incident, not a retrospective.** Sentry `QUANTALYZE-18` ("Platform secret SERVICE_KEY is mismatched") has fired **221 times since 2026-08-25** and is marked `regressed` — it was closed once as Phase 160's TODOS 0.05. `analytics-service/main.py`'s `verify_service_key` logs `event="service_key.mismatch" path="/api/match/eval"` and captures a Sentry event whose only culprit is the receiving pod's own internal URL (`http://10.222.227.193:8080/...`). **Neither carries the caller.**
   ⛔ **THE MEASUREMENT THAT MAKES THIS UNARGUABLE.** Railway deployment `f7fa9e50` logs, one burst at `07:49:16Z`: `100.64.0.8:61618 → 200 OK`, `100.64.0.11:54654 → 401`, `100.64.0.8:61618 → 401` — the SAME path, the SAME query string (`?lookback_days=1`), the same second, and the same proxy source port serving BOTH a 200 and a 401. Two callers with different keys are hitting this endpoint simultaneously and **nothing recorded which was which**. `100.64.0.0/10` is carrier-grade NAT (Railway's proxy), so the source address cannot discriminate them either. `lookback_days=1` is human-driven — `src/components/admin/MatchEvalDashboard.tsx` builds it — which matches the irregular 2-5h event spacing.
   ⚠️ **A FALSE FIX WAS ATTEMPTED AND IS RECORDED SO IT IS NOT RE-ATTEMPTED.** `ANALYTICS_SERVICE_KEY` was rotated on Vercel production to Railway's value and redeployed on 2026-09-12; **the 401s continued at 23:35Z, 02:13Z and 07:49Z.** The rotation was motivated by a digest comparison that was INVALID: `vercel env pull` returns an 11-character redaction placeholder for this variable, not the value — proven because the identical digest came back across a delete-and-recreate from a provably different value. ⛔ Do not re-run that comparison and do not rotate again on its evidence. Railway's last deploy predates the rotation and its `SERVICE_KEY` was never changed, so the running container and `railway variables` agree — **the failing caller is NOT Vercel production**, and the two open candidates are a Preview-scoped `ANALYTICS_SERVICE_KEY` (153 days old, never rotated) and an unidentified third caller.
   **DELIVERABLE:** the rejection path records a caller discriminator that survives the proxy — e.g. the presented key's first bytes or a non-reversible fingerprint (⛔ never the key), plus `Referer`/`Origin`/`X-Vercel-Deployment-Url` when present — so "which deployment is sending the wrong key" is READ, not guessed. ⛔ Anti-vacuity: prove it by presenting a deliberately wrong key from a known origin and observing that origin named in the record; a field that is always empty in production has fixed nothing.
   ⚠️ **Routed HERE, not to Phase 164.6.2 MT5RELOGIN** — considered and rejected on subject: 164.6.2 is the MT5 terminal's broker session (VNC, the Wine prefix, absent `MT5_LOGIN`), which shares nothing with the analytics seam. It belongs beside criterion 12 `[MT5-VERDICT-SINK-01]`, whose defect is identical in KIND: a verdict that can only be seen while it scrolls past.
17. ⭐ **ROUTED IN from Phase 164.6.2 plan 04's decision checkpoint (founder, 2026-09-14): `[164.6.2-KILLSWITCH-COMMENT-DRIFT]`.** MEASURED in 164.6.2 wave 2: `analytics-service/services/closed_sets.py` claims in THREE comment blocks that a value of `"TRUE "` reads the kill switch OFF, while the shipped code calls `.strip()` BEFORE `.lower()`, so `"TRUE "` and `" true"` both read ON. The drift spans `mt5_enabled_server` AND `sfox_enabled_server` — two INDEPENDENT shipped kill switches, three sites. ⛔ **Correct the COMMENTS, never the code:** a reader who "fixes the code to match the comment" would make a trailing space fail-CLOSE a live go-live flag. The semantics are pinned by `test_the_kill_switch_tolerates_surrounding_whitespace_MEASURED`, which reds if they ever move. ⭐ It lands here because it is exactly this phase's remaining kind — prose corrections and lint — and it was deliberately NOT fixed from inside an unrelated execution.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entries OPS-08-F9, OPS-08-F8, OPS-08-TS, OPS-08-F2, PROC-02, PROC-03, H-0001, 161.1-D13, `[PHASEDIR-ORPHAN-GITKEEP]` (routed here 2026-09-12 — an empty orphan phase directory left behind by the `-pr` filter's `.gitkeep` made `find-phase` unable to disambiguate two `164.1-*` directories, so `roadmap analyze` reported a fully-shipped 6-plan phase as `empty` and `roadmap.update-plan-progress` refused with `"No plans found"`; Phase 164.1's line sat at `5/6` for six days as a result. ⚠️ Fixed once before in `46daa47c` and REGRESSED by `22a5fe96`, so it recurs on every rename-then-filter. The filter is GLOBAL gsd-core that `/gsd-update` overwrites, so the durable backstop is a REPO-OWNED check — same reasoning this repo already applied to the CHANGELOG rule and the version gate. ⛔ `find-phase` returning `phase_found: false` for a phase that EXISTS is this milestone's named shape: an absence reading as a clean answer), `[PLANANCHOR-SUMMARY-FILTER-01]` (routed here 2026-09-09 out of the PR #767 merge gate — see criterion 10 and its ROUTED HERE block), VAC08-COUNT-SPM01, MT5-VERDICT-SINK-01 (added 2026-09-05 — the MT5 CAPABILITY verdict reaches only `emit_mt5_stage_event` (`analytics-service/services/mt5_client.py:205`), a structured LOG EVENT, so an `undetermined` outcome is unverifiable once it rotates out; this is what has kept Phase 161's first human-verification item unclosable for over a week. ⛔ Routed HERE, not to 164.1, deliberately: 164.1's plans are authored, its criterion-5 ledger was verified to match the RE-PARTITION block EXACTLY, and its `ARMS_FLOOR` is pinned at 4 — adding a fifth target now would break both. ⚠️ ADJACENT to MT5-WEDGE-OBS-01, not the same: that arm probes LIVENESS (-10004/-10005), this is a CAPABILITY verdict (`tradeapi_disabled` → which remedy sentence a founder reads). Fits this phase because "an instrument whose reading cannot be checked afterwards" is the same class as the gate-integrity items it already owns) (added 2026-09-05 — VAC-08's ledger ratchet reads its TWO GATING counts, `new_count`/`stale_count` at `scripts/test-ledger-drift-check.sh:372-373`, with the `grep … || true` + `${:-0}` shape the SAME file documents as a false-clean at `:304-318`, where the fix idiom already exists; a grep error on either temp file reads as zero and the gate prints "clean" over unread NEW drift. ⭐ Ship the fix with a test that makes the grep actually fail and asserts MEASURE_FAIL — a fix with no failing test is the defect class 164.3 exists to remove), `MYPY-MAINPY-01` (added 2026-09-06 from Phase 164.1-02's `deferred-items.md` — the `ci.yml` B-mypy comment claims running-service coverage the invocation does not have; `analytics-service/tests/` stays OUT of scope and its policy question stays open), `PROBER-CALIBRATION-01` (added 2026-09-06 at the PR #748 merge gate — a calibration arm in `src/__tests__/prod-prober-wiring.test.ts:292` whose name promises a proof it does not perform; it passes with its own subject at `:279-281` deleted. Non-blocking by the stopping rule — neither user-facing nor data-integrity — so #748 landed at v0.77.15.0 with this booked rather than fixed. ⚠️ Read the arm and the two calibration arms beside it before planning: the file already contains the correct shape, so this is a conform-to-the-neighbour fix, not a new pattern), `CI-DOCSPATH-01` (added 2026-09-06 while merging PR #750, the Phase 164.8 insertion — measured there, not estimated: 21 jobs / ~50 job-minutes on a four-file `.planning/` diff, two of them holding the shared-TEST-DB mutex against other people's CI. ⚠️ Read criterion 9 before planning: the deliverable is NOT "make docs PRs fast", it is "make docs PRs fast WITHOUT making code PRs skip anything", and only the second half is hard) , `[164.5-STALE-GENERATED-TYPES]` (added 2026-09-08 while closing DRIFT-04 — `src/lib/database.types.ts` carries a generated declaration for `create_allocator_connected_strategy`, dropped from PROD by `20260908120000`. ⭐ The stale entry is NOT the item; the ABSENCE OF ANY MECHANISM is. Measured: `grep -rn 'database.types' .github/workflows/` returns NOTHING and `package.json` carries no `gen:types`-shaped script, so nothing regenerates that file and no gate would notice it drifting from the schema it claims to describe. ⛔ Do NOT resolve this by hand-editing the file to match — that fakes a currency no process maintains, which is this phase's own named defect class, the same shape as `MYPY-MAINPY-01`'s false coverage comment and `PROBER-CALIBRATION-01`'s arm that promises a proof it does not perform. DELIVERABLE: a regeneration step plus a freshness gate, so the file is either provably current or loudly stale) , `DRIFT-05B-FIRST-RUN` (added 2026-09-08 by founder instruction that a deferral must find a phase — gate (b), `bash scripts/prod-body-drift-check.sh --baseline-live`, SHIPPED in Phase 164.5 plan 04 and has **never run against the real credential**; its own entry records it as EXPECTED RED on that first run. ⭐ An unexercised control is not a control: until it has fired once against PROD nobody knows whether it measures what it claims. DELIVERABLE: run it on a credentialed migration PR, READ its output, and record the branch it took by line reference — a green job is NOT evidence, exactly as `VAC04-ARMS-UNRUN` taught), `WR-D-DUMP-SCOPE` (added 2026-09-08, same instruction — a stated scope limit on the repo-vs-PROD dump comparison that is documented in the gate header but pinned by nothing, so the limit can widen without anything noticing) — read each before planning, do not re-derive
➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.6-SOURCE-ANCHOR-ROT]`.** Source-comment `file:line` anchors are unguarded where PLAN.md anchors are not. Still gate-hygiene in kind; owned there because 164.8.2 is what measured it.

**Depends on:** Phase 164.5 (ordering — the substrate work lands first), Phase 164.4.1 (pg-lane with pg_cron)
**Plans:** 2/5 plans executed

Plans:

**Wave 1** *(three file-disjoint plans, parallel worktrees)*
- [x] 164.6-01-PLAN.md — OPS-08-TS: retry a 40001 exactly once at csv-finalize and allocator holdings sync (criterion 2)
- [x] 164.6-02-PLAN.md — 161.1-D13 TS half: keys/sync and finalize-wizard retract an inherited ledger-refresh marker (criterion 4)
- [x] 164.6-03-PLAN.md — OPS-08-F2: both fan-outs record failed targets and a failure count in a cron_runs row; one migration plus gate arms and twin re-points in one commit (criterion 3)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 164.6-04-PLAN.md — OPS-08-F2: move every floor, census and sentinel pin to its MEASURED value

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 164.6-05-PLAN.md — runbooks read the failure row, the composite-schedule BLOCKING precondition `[164.6-COMPOSITE-CLAIMTIME-SNAPSHOT]`, and the phase-level full-suite pass

### Phase 164.6.7: COMPOSITECLAIMSNAPSHOT — the composite run reads the live job marker, not its claim-time snapshot (INSERTED)

**Goal:** A composite (`stitch_composite`) run decides whether it is a background ledger refresh from the job row as it stands when the decision is made, not from the metadata snapshot taken when the worker claimed the job. Found by Phase 164.6 plan 02 (`[164.6-COMPOSITE-CLAIMTIME-SNAPSHOT]`, founder queue 164.6 item a): the TS routes now retract an inherited refresh marker from a reused composite job, but Python's composite guard reads the claim-time snapshot, so a retraction that lands after the claim does not stand down that run's guard, while the SQL `is_protected` check does see it. The two layers disagree about the same job. **Data-integrity.** Latent today (the composite fan-out has no schedule, and a runbook precondition blocks scheduling it); this phase removes the precondition's reason to exist. Inserted 2026-09-24 under the founder's authorization to add phases.
**Success criteria:** (1) the harm is shown on the local lane first (claim, then retract, then observe the run's decision), or the phase shrinks; (2) the composite guard and `is_protected` reach the same verdict for a marker retracted after the claim, proven by execution; (3) a regression test observed RED when the fix is neutered; (4) the runbook precondition is removed or restated to match.
**Requirements**: TBD
**Depends on:** Phase 164.6
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 164.6.7 to break down)

### Phase 164.6.5: MT5VALIDATEWEDGE — MT5 key validation stops destroying the shared terminal, and the terminal self-heals (INSERTED)

**Goal:** A client can add an MT5 key, repeatedly, without taking MT5 validation down for
everyone — and if the terminal does wedge, it recovers WITHOUT a human.
**Requirements**: 164.6.5-C1 (root cause named or honestly open), 164.6.5-C2 (supervision +
IPC liveness + auto-login-preserving restart), 164.6.5-C3 (the heal ACTS on `ipc_fault`),
164.6.5-C4 (the prober actually measures the terminal), 164.6.5-C5 (the wizard stops promising a
retry that cannot work), 164.6.5-C6 (`correlation_id` per request), 164.6.5-C7 (the algo-trading
settings landmine is PINNED, not ticked)
**Depends on:** Phase 164.6 (nothing blocking; the fault is live in PROD today)
**Plans:** 8/8 plans executed (verification `gaps_found`; the phase is NOT transitioned to complete)

⛔ **BOOKED FROM A LIVE PRODUCTION INCIDENT, measured end-to-end 2026-09-21 by the founder and the
orchestrator together.** Everything below is a reading, not an inference. Founder's words:
*"This should really get fixed."*

⭐ **THE DEFECT, REPRODUCED TWICE — a validate against a HEALTHY terminal FAILS AND WEDGES IT.**
One shared MT5 terminal (`mt5-gateway`) serves every client's key validation, and a validate makes
it drop its current broker session and log in as the client being validated.

- **#1** — session monitor `already_authorized` at 10:14 / 10:24 / 10:34 / 10:44 / 10:54 (healthy
  ~50 min) → validate 11:02:38 → the terminal's OWN Journal logs `disconnected` at 11:02:38.263 and
  **nothing after** → analytics `login` stage **45,335 ms** → `-10005` IPC timeout →
  `outcome="transient"`, HTTP 424.
- **#2, after a successful manual recovery** — monitor `already_authorized` 12:48:12 in **33 ms** →
  validate ~12:52 → `-10005` → monitor `not_healed:ipc_fault` 12:58:32. ⭐ Between healthy and
  wedged the ONLY event was a validate.

⭐ **MECHANISM — THE ACCOUNT SWITCH, not a bad password.** The monitor calls
`initialize_with_credentials` every 10 min against the HOUSE account and returns
`already_authorized` in 33 ms because nothing must change. A validate calls the SAME verb against a
CLIENT account, forcing a session tear-down and re-login. That tear-down is where it dies.
⛔ **THE WRONG-PASSWORD THEORY IS REFUTED — do not re-adopt it.** Correct credentials failed
identically (`duration_ms=55514`, same `-10005`), and MT5 writes a Journal line for EVERY login
attempt INCLUDING failures; there were none. ⛔ `classify_mt5_login_error` is NOT at fault and this
is NOT the Phase 167 CREDTRUST residual — the classifier correctly refused to blame a credential for
an answer the broker never gave (the D-02 refusal rule working as designed): no rejection, because
no answer.
**Once wedged, EVERYTHING fails until a human intervenes** — correct credentials, any client, any
attempt. ⭐ **MT5 onboarding is currently self-inflicted-broken: the act of adding a key breaks the
thing needed to add a key.**

**RECOVERY, PROVEN:** restart `terminal64.exe` under the SAME Wine prefix, container and volume →
Journal `12:41:44 started` → `12:41:46 authorized` (2.0 s, UNATTENDED) → analytics `12:48:12
already_authorized` in 33 ms. **Outage 11:02:38Z → 12:41:46Z = 1h39m.**

⛔ **FOUR CORRECTIONS TO RECORDED BELIEF, each measured, each changes a remedy:**

1. **The wedge is PROCESS state, not PERSISTED state.** `MT5-WEDGE-OBS-01` says a redeploy cannot
   fix `-10005` because the Wine prefix lives on the persistent volume — TRUE for its modal-dialog
   cause, FALSE for this one. `-10005` has at least TWO causes with DIFFERENT remedies.
   ⛔ Cross-link and refine that entry; do NOT reopen it — its mechanism is proven to work.
2. **It is NOT a modal dialog here.** Live VNC console: no dialog, Alerts tab empty. ⭐ And the
   terminal could not log in BY HAND — the founder clicked OK on its own Login dialog three ways
   and the Journal wrote NOTHING each time. A responsive UI proves only that the window loop is alive.
3. **The terminal DOES auto-login after a restart** when the password is saved (2.0 s, unattended).
   The recorded expectation that a restart lands on `-10004` needing an operator is wrong here, and
   that belief is what makes this fault look operator-only.
4. ⭐⭐ **`terminal64.exe` IS NOT SUPERVISED — this is why a 2-second recovery took 1h39m.** s6
   supervises the desktop, VNC, nginx, cron and audio (`/run/service/`); the terminal is started
   ONCE by `/Metatrader/start.sh` from the openbox session autostart and NOTHING watches it.

**Success criteria (to be derived properly at planning; these are the measured subjects):**

1. ⭐ The root cause of the switch wedge is **found and named**, not worked around. ⛔ Sleeping or
   retrying around it is not a fix. ⚠️ A switch DID succeed cleanly the same day (`04:08:06
   disconnected` → `04:08:07 authorized`, ~1 s), so the switch is not universally broken — the phase
   must explain what differs.
2. `terminal64.exe` runs under supervision with a liveness check, so an unresponsive terminal
   restarts without a human. ⚠️ The restart must preserve the auto-login proven today.
3. The heal **acts** on `ipc_fault` instead of reporting `not_healed`. ⭐ This is Phase 164.6.2's
   heal finally getting a production verdict and it is NEGATIVE: five consecutive
   `not_healed:ipc_fault`, because it cannot drive a terminal whose IPC is dead — it never reaches a
   login attempt.
4. ⚠️ The prod-prober's MT5 arm **actually measures the terminal**. It reported `mt5-ssh-transport`
   ("the terminal was never reached and nothing about it was measured") while `railway ssh` into the
   same container worked fine with a WORKSPACE-scoped token — so `mt5-ipc-timeout`, the
   classification `MT5-WEDGE-OBS-01` was closed on, has **never once fired in production**.
   ⛔ REQUIRED HERE, not deferred: without it this phase cannot honestly prove criterion 1 held.
   ⭐ **Founder ruling 2026-09-26 (AskUserQuestion, "Ratify: move to 164.6.6"):** the calibration half is routed to Phase 164.6.6 as `MT5-PROBER-WEDGE-CALIBRATION-01`; the sentence above is kept as lineage. D-16/D-17 founder-confirmed the same day (CONTEXT D-19).
   ⛔ **CORRECTED 2026-09-26 (founder split, one topic per phase):** the calibration half is now owned by Phase 164.6.8 OUTAGEALERT, not 164.6.6; `MT5-SWITCH-WEDGE-CAUSE-01` moved with it. The ruling above is kept as lineage.
   Calibrate against a REAL wedge, not only a fixture.
5. The wizard stops telling the user to retry when retry cannot work. Shipped copy claims a
   *"temporary exchange issue or a network blip"* and says *"Try again in a moment"* — measured
   false across two retries 45 s and 55 s apart, one with correct credentials. ⭐ The server already
   knows (`ipc_fault`). ⛔ Do NOT delete the honest `KEY_NETWORK_TIMEOUT` arm — it is correct for a
   genuine transport failure; mint a DISTINCT arm, the pattern `KEY_SCOPE_CHECK_UNREADABLE` exists for.
6. ⚠️ `correlation_id` is minted PER WIZARD SESSION, not per request — measured identical across
   attempts HOURS apart, so two different failures are indistinguishable in support. That undercuts
   the "email us with the correlation id" instruction in the same copy.

**Inherited success criteria — routed here by founder decision 2026-09-24 (AskUserQuestion).** Both
need a live MT5 validate against a terminal this phase makes trustworthy, so they close with it,
not in their source phases. Each source VERIFICATION marks its item resolved-by-routing to here.

7. **(from Phase 161, human item 1: the live MT5 `undetermined` verdict.)** One live MT5 validate
   that lands an `undetermined` capability verdict is read, and its sentence names *"Allow
   algorithmic trading"* (arm 1) when the Experts setting is off, or the external-Python-API option
   (arm 2) only when `terminal_info` reports `tradeapi_disabled`. It must never name the
   external-Python-API option while that flag is off. ⚠️ The verdict has no durable sink today (it
   is a structured log event only), so the reading must be captured when it happens.
8. **(from Phase 164.5.3, human item 2: the end-to-end live MT5 credential update.)** On an MT5 key
   whose status the worker has already set to `revoked` or `error` by a wrong password, the
   founder uses "Update password" with the correct password. The PATCH returns 200, the card drops
   the revoked pill at once, and on the next ledger-refresh or allocator-poll tick the automated
   fan-out picks the key up again. A row reading `sync_status = 'idle'` alone does not close it.
   Founder-only: no agent enters or drives a real credential.

⚠️ **PIN, DO NOT FIX — a settings landmine:** the terminal's Experts tab has *"Disable algorithmic
trading when the account has been changed"* UNCHECKED. Validation IS an account change, so ticking
it would silently disable algo trading on the shared terminal. Correct today only by default;
nothing in the repo asserts it.

⛔ **THIS PHASE DOES NOT FIX THE EVICTION** — that is Phase 164.6.6. Do not let "MT5 is back" read
as "the finding is closed": the outage was the symptom, the shared mutable terminal is the defect.

⭐ **D-05 IS CLOSED BY THE PLANNER, with the reason it beat the other candidates (plan 02 task 1 is
the founder's ratification gate).** The remedy is **external supervision over the rpyc channel the
analytics-service already holds**: the liveness DECISION is taken by the credential-free IPC
detector that already exists, and the ACTION is a process-level recycle of the Wine-hosted terminal
inside the same container, under the same Wine prefix and the same named volume.
⛔ **Wrapping the image was refused for a measured reason, not a cost one:** an s6 `longrun`
supervises EXIT, and there was NO exit — the process ran and its UI answered a human for the whole
1h39m. A bare longrun would have stayed quiet through the entire outage, so Option 1 only works if
it ALSO builds Option 2's IPC detector, inside an image we would then own. ⛔ A Railway healthcheck
was refused because the image exposes no HTTP surface and the rpyc bridge may never be exposed, so
it cannot satisfy the IPC-probe fence at all.
⚠️ **The cost is real and is booked here, not buried:** this makes a documented unauthenticated
arbitrary-remote-code channel (Phase-134 `T-134-03`) a load-bearing production recovery path. It is
paid for with ONE narrow verb over a COMMITTED, non-interpolated remote-source constant — the shape
`_REMOTE_MATERIALIZE_SRC` already ships in the same file — plus a threat model and
`/gsd-secure-phase`.

⭐ **D-09 IS CLOSED AS "BROADEN THE REMEDY", NOT "SPLIT THE CLASSIFIER", for three measured
reasons:** both `-10005` causes produce the identical `initialize()` code and the probe is
read-only by hard constraint; the arm is pinned IMPORT-FREE by the mutation harness, so external
correlation cannot live in it; and the runner requires every declared kind to carry a RED FIXTURE
that fires it, so with no discriminator a new kind would need a fabricated fixture — the vacuous
gate this milestone exists to remove.

⭐ **D-12/D-13's STAGE IS THE INITIAL VALIDATE**, picked on evidence: the measured incident answered
**HTTP 424**, and on this seam only the flat venue-transient shape raised inside
`_validate_mt5_key_probe` emits a 424. The finalize-time scope arm answers 502 from the Next route
and never reaches that seam.

⭐ **D-14 IS CLOSED AS KEEP-ALONGSIDE, NOT REPLACE**, and the subject was corrected: the rendered id
is `getWizardCorrelationId()` in `src/lib/wizard/wizard-correlation.ts` (a per-PAGE-LOAD memo), not
the localStorage session id CONTEXT.md and PATTERNS.md pointed at. The page-load id keeps its name
and its telemetry join; a fresh per-REQUEST id is what the server logs and what the user is shown.

⛔ **A CONTRADICTION IN THE RECORD, FOUND AT PLANNING TIME AND OWNED BY PLAN 06.** Five places in
this repo state the gateway re-clears *"Allow algorithmic trading"* on EVERY account change
(founder-measured 2026-08-13), and one of them is USER-FACING copy. CONTEXT.md D-15 states,
measured 2026-09-22, that the box is UNCHECKED. Both cannot be true of the same checkbox. ⛔ Plan 06
reconciles them against a live reading and corrects whichever side is stale — it does NOT average
them.

⭐ **OUTCOME, PER CRITERION — recorded 2026-09-26 by plan 08 from the plan SUMMARYs and
`164.6.5-VERIFICATION.md` (`gaps_found`, 5/7), not from intent.** MET means the criterion's own
wording holds. OPEN means it does not yet, and names who closes it and when. ⛔ No criterion
below was reworded to read as met.

| req | criterion | outcome | routed residual (owner · trigger) |
|---|---|---|---|
| C1 | root cause of the switch wedge found and named | **OPEN** (D-03 success path: recorded open, never claimed) | `TODOS.md` `MT5-SWITCH-WEDGE-CAUSE-01` · Phase 164.6.8 (moved from 164.6.6 on 2026-09-26) · the next `-10005` with Journal silence after `disconnected`, read BEFORE any restart |
| C2 | the terminal restarts without a human, auto-login preserved | **OPEN, live half.** Shipped: `Mt5Client.recycle_terminal_process`, driven by the credential-free IPC detector. Never run live over the bridge. | `.planning/WINDOWS.md` entry 68 (widened 2026-09-26 to name the first live `Mt5Client.session_snapshot` read as well as the terminate step) · founder, post-deploy · the first live recycle |
| C3 | the heal ACTS on `ipc_fault` | **MET** (offline behaviour tests; its live run is C2's residual) | none |
| C4 | the prober's MT5 arm actually measures the terminal, calibrated against a REAL wedge | **OPEN, calibration half.** D-10 (measuring) is answered: scheduled `prod-prober` run 36134914962 (head `01dcf1cc`) onward reads the terminal. D-11 (real-wedge calibration) was not done. | `TODOS.md` `MT5-PROBER-WEDGE-CALIBRATION-01` (D-11) · Phase 164.6.8 (moved from 164.6.6 on 2026-09-26) · the next live `-10005`, captured before the heal recycles it |
| C5 | the wizard stops promising a retry that cannot work | **MET** | none. ⚠️ D-16/D-17 (the merge with Phase 167) await founder confirmation: under D-16 the first, wedge-causing validate still answers `SIGN_IN_FAILED` |
| C6 | `correlation_id` per request | **MET** | none |
| C7 | the algo-trading settings landmine is PINNED, not ticked | **MET** | none |
| inherited 7 | (Phase 161) a live `undetermined` MT5 verdict names the right option | **OPEN** | founder UAT · the next live MT5 validate that lands `undetermined`; there is still no durable sink, so the reading must be captured as it happens |
| inherited 8 | (Phase 164.5.3) the end-to-end live MT5 credential update | **OPEN** | founder UAT · the next MT5 key the worker marks `revoked` or `error`; founder-only, no agent enters a real credential |

⚠️ **Also open and named, outside the criteria:** a Sentry alert rule for the hourly ERROR
re-raise and the capped-recycle ERROR (review finding R2-SFH-05), and a copy read-through of
`KEY_MT5_TERMINAL_UNRESPONSIVE` on the connect step and the rotate dialog.

⛔ **THE SCOPE FENCE, restated so it survives the close.** This phase did NOT fix the eviction:
that is Phase 164.6.6. "MT5 is back" must not read as "the finding is closed". The outage was
the symptom; the shared mutable terminal is the defect. ⛔ `[MT5-VERDICT-SINK-01]` stays deferred
and named under its own owner (Phase 164.6 criterion 12). This phase did not absorb it.

Plans:

- [x] 164.6.5-01-PLAN.md — C1: the asymmetry, named or honestly open; the runbook's `-10005`
      differential procedure; `MT5-WEDGE-OBS-01` refined (⛔ not reopened). Owns `TODOS.md` and
      `docs/runbooks/mt5-go-live.md` for the whole phase. [wave 1, has checkpoints]
- [x] 164.6.5-02-PLAN.md — ⭐ THE TRACER. C2: the D-05 ratification gate, the live A1 spike, and the
      narrow credential-free recycle verb on `Mt5Client`. [wave 1, has checkpoints]
- [x] 164.6.5-03-PLAN.md — C4: the `-10005` remedy stops asserting one cause; a CI gate ties the
      arm's declared environment to the workflow's supplied environment; live proof + real-wedge
      calibration. [wave 1, has checkpoints]
- [x] 164.6.5-04-PLAN.md — C5: mint a distinct MT5 wire code and wizard code, honest
      non-recoverable copy, and the arrival/roster gates that keep both vocabularies agreeing.
      ⛔ `KEY_NETWORK_TIMEOUT` is neither deleted nor widened. [wave 1]
- [x] 164.6.5-05-PLAN.md — C3: the heal ESCALATES on `ipc_fault` — five readings, ONE recovery
      attempt — inside the module's one lease, structurally unable to raise. [wave 2, depends 02]
- [x] 164.6.5-06-PLAN.md — C7: reconcile the five-place recorded belief against a live reading, and
      make the observable consequence fail LOUDLY. ⛔ Never ticks the box. [wave 2, depends 04,
      has checkpoints]
- [x] 164.6.5-07-PLAN.md — C6: a per-request correlation id on the wire and on the screen, the
      per-page-load id preserved beside it, closed as a class across every wizard envelope
      surface. [wave 2, depends 04]
- [x] 164.6.5-08-PLAN.md — close: per-criterion outcomes (MET or OPEN with a routed residual) in
      both ledgers, then ONE release commit carrying the version bump and the CHANGELOG entry.
      [wave 3, depends on all]

⭐ **Merge with Phase 167, 2026-09-23 (D-16/D-17 in `164.6.5-CONTEXT.md`, orchestrator decisions
awaiting founder confirmation):** 167's sign-in refusal check runs BEFORE this phase's IPC check,
so a `-10005` at the sign-in step stays `SIGN_IN_FAILED`. Other IPC faults move from a retryable
424 to the non-retryable `MT5_TERMINAL_UNRESPONSIVE` 500. `KEY_MT5_TERMINAL_UNRESPONSIVE` joins
`DASHBOARD_DIALOG_ROUTE_CODES` (in scope).

### Phase 164.6.6: MT5TERMINALISOLATION — one client's MT5 validation cannot evict, disturb or expose another client's broker session (INSERTED)

**Goal:** A client's key validation cannot evict, disturb or expose another client's broker session
on the shared terminal.
**Requirements**: TBD
**Depends on:** Phase 164.6.5 (availability first: this phase changes the terminal's ownership model,
which is only safe once validation stops wedging it)
**Split 2026-09-26 by founder decision: one topic per phase.** Sibling: Phase 164.6.8 OUTAGEALERT
took the goal's outage clause ("and a shared-terminal outage reaches a human without one clicking
a button") and the former criterion 3 verbatim. This phase keeps the former criteria 1, 2 and 4;
the former 4 is renumbered 3 below, text unchanged.
**Owns — MOVED 2026-09-26 to Phase 164.6.8 OUTAGEALERT (after PR #863 merged):** PR #863 routed
`MT5-PROBER-WEDGE-CALIBRATION-01` (dated 2026-09-26, from 164.6.5 plan 08) and `MT5-SWITCH-WEDGE-CAUSE-01`
(dated 2026-09-25, from 164.6.5 plan 01) here. Both close only on the next live wedge captured before
any restart or heal, which is 164.6.8's evidence, so both `**Owns**` lines now live under Phase
164.6.8, carried verbatim. This phase owns neither.
**Plans:** 0 plans

⛔ **SAME INCIDENT AS 164.6.5, DIFFERENT DEFECT.** 164.6.5 makes validation stop breaking the
terminal; this phase makes the terminal stop being a shared mutable resource. 164.6.5 is
independently shippable; this is the architecture.

**Success criteria (to be derived properly at planning):**

1. ⭐⭐ **THE EVICTION — and the NORMAL path is the defect, not the failure path.** Measured
   2026-09-21: `04:08:06 '<account A>': disconnected` → `04:08:07 '<account B>': authorized` — a
   clean ONE-SECOND handover. Account A was serving a live session with **11 open positions** and
   was evicted by an unrelated client's onboarding, with no error, no signal and no record against
   it. ⛔ The outage in 164.6.5 must not overshadow this: a validate that SUCCEEDS still silently
   destroys another client's session.
2. ⚠️ **CLIENT ACCOUNTS ACCUMULATE IN THE SHARED TERMINAL, and that is a DISCLOSURE surface.** Its
   Navigator tree holds registered accounts across SEVERAL broker servers — one per client who has
   ever validated. Anyone with VNC access to the gateway container can read the full list of client
   account numbers and their brokers. ⛔ This does NOT go away by fixing the wedge.
3. ⚠️ **A founder decision, not to be taken silently:** per-validation isolation (ephemeral or
   pooled terminals) vs serialize-and-restore on one terminal. Both have real cost; record the
   reasoning wherever this repo tracks decisions.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.6.6 to break down)

### Phase 164.6.8: OUTAGEALERT — a shared-terminal MT5 outage reaches a human without one clicking a button (INSERTED)

**Goal:** A shared-terminal outage reaches a human without one clicking a button.
**Requirements**: TBD
**Depends on:** Phase 164.6.5 (the salience work sits on 164.6.5's terminal-measuring prober arm, and
a real-wedge capture has to beat 164.6.5's own heal, which can recycle a wedge before a scheduled
prober run reads it). It does NOT depend on Phase 164.6.6: alerting on an outage does not need the
terminal's ownership model changed.
**Split 2026-09-26 by founder decision: one topic per phase.** Sibling: Phase 164.6.6
MT5TERMINALISOLATION, whose former criterion 3 moved here verbatim as criterion 1 below, with the
outage clause of its goal.
**Owns (routed 2026-09-26, founder decision):** `MT5-PROBER-WEDGE-CALIBRATION-01` — Phase 164.6.5
D-11, the calibration half of 164.6.5 criterion 4: the prod-prober's `-10005` classification
(`mt5-ipc-timeout`) has never been calibrated against a REAL wedge; its fixture was constructed, not
captured.
**Owns (moved 2026-09-26 from Phase 164.6.6, orchestrator decision):** `MT5-SWITCH-WEDGE-CAUSE-01` —
why some account switches on the shared terminal wedge it (`-10005`, Journal silent after
`disconnected`) and others do not. It moved with the calibration item because both close only on the
same evidence: the next live wedge, captured BEFORE any restart or heal recycles the terminal.
⚠️ **Neither item is on `main` at the time of this split.** Their `TODOS.md` entries, the 164.6.5
founder-ruling note and the two `**Owns**` lines under Phase 164.6.6 all arrive with PR #863
(164.6.5, open), which routes BOTH items to 164.6.6. The re-homing is deferred until #863 merges:
then both `**Owns**` lines move here, both `TODOS.md` `Owner:` lines point at Phase 164.6.8, and the
164.6.5 routing sentence is corrected.
⭐ **DONE 2026-09-26, after PR #863 merged (`ea4167a3f`).** The paragraph above is kept as lineage. Both
`TODOS.md` `Owner:` lines now name Phase 164.6.8, the 164.6.5 routing sentence and its C1/C4 outcome rows
name 164.6.8, and the two `**Owns**` lines #863 wrote under Phase 164.6.6 are carried here verbatim:
- *(as #863 wrote it, 2026-09-26, from 164.6.5 plan 08)* `TODOS.md` `MT5-PROBER-WEDGE-CALIBRATION-01` — Phase 164.6.5 D-11, OPEN: the prod-prober's `-10005` classification (`mt5-ipc-timeout`) has never been calibrated against a REAL wedge; its fixture was constructed, not captured. Trigger: the next live `-10005`, captured BEFORE the heal recycles the terminal (a founder-supervised induced wedge also qualifies). Gate: a scrubbed real-wedge transcript committed under `scripts/prod-prober/fixtures/mt5/`, registered for the kind it actually produced, self-test and wiring suite green. ⛔ A hand-written fixture is not a close. ⚠️ 164.6.5's own heal can recycle a wedge before a scheduled prober run reads it.
- *(as #863 wrote it, 2026-09-25, from 164.6.5 plan 01)* `TODOS.md` `MT5-SWITCH-WEDGE-CAUSE-01` — why some account switches on the shared terminal wedge it (`-10005`, Journal silent after `disconnected`) and others do not. Verdicts so far: same-vs-different account REJECTED, terminal self-update and same-vs-different broker server UNDECIDED. Closes only on evidence captured at the next wedge BEFORE any restart; a restart clearing the symptom is not a close.
**Plans:** 0 plans

**Success criteria (to be derived properly at planning):**

1. **A shared-terminal outage reaches a human.** Measured across the 1h39m total outage: `/health`
   returned `"status":"ok"` throughout; the escalation at `consecutive_not_measured=6` flipped log
   level INFO→WARNING and set `blind=True`, which NOTHING outside its own module reads; the
   prod-prober run concluded `success` BY DESIGN (status-class defects exit 0 so Railway's
   wait-for-CI does not skip the deploy). ⭐ **Detection and filing DID work** — the prober filed on
   the P1 issue within 80 seconds — so this is a **SALIENCE** problem, not a detection one: the
   issue dedups by label so its title still carries a defect date from 2026-09-10, and the Actions
   view reads green. ⛔ Do NOT reopen `MT5-WEDGE-OBS-01`; cross-link instead.
   ⭐ **The way this incident was actually found was a founder clicking a button.** That is the
   finding this criterion exists to answer.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.6.8 to break down)

### Phase 164.6.1: MYPYSTRICT — the strict gate claims to cover all running-service code and does not cover the module that IS the service (INSERTED)

**Goal:** `analytics-service/main.py` is **930 lines of RUNNING-SERVICE code** (`uvicorn main:app`) sitting OUTSIDE the `mypy --strict` gate, while that gate's own comment at `ci.yml:3209-3216` states the strict floor *"now covers ALL running-service code — `services/` (part g), `routers/` (part h), and `models/` (part i)"*. ⭐ **THE FALSE COMMENT IS THE ITEM, not the five annotations.** Nothing under those three packages imports `main.py`, so `--follow-imports=silent` never reaches it, and `python3 -m mypy --strict main.py` reports 5 errors: `:255` `lifespan(_app: FastAPI)`, `:309` `_crash_handler` (missing `Task[None]`), `:741` ×2 `verify_service_key(request, call_next)`, `:891` `health()`. ⚠️ MEASURED on BOTH sides of Phase 164.1-02 — the identical five, one line number shifted by the +34 lines that plan added — and recorded in that phase's `deferred-items.md`. ⚠️ **TWO of the five sit on the service-key middleware Phase 164.1 hardened for PYAPI-06, and one on the `/health` endpoint 164.1's own prober arm polls**, so the untyped surface is exactly where this milestone has been working. A gate that ASSERTS complete coverage while blind to the service's entry module is this milestone's named defect class, which is why it is a phase rather than a typing backlog item. DELIVERABLE: annotate the three functions, add `main.py` to the `ci.yml` mypy invocation, and CORRECT the comment to name the real surface. ⛔ NOT in scope: `analytics-service/tests/` (5,439 strict errors across 182 files) — `TODOS.md:3263` and `:5197` already hold that as an OPEN POLICY question ("B-mypy part j, or record tests/ as permanently out of strict scope"), and folding it in would smuggle a milestone-sized decision into a hygiene item.

**Success Criteria**:

1. `mypy --strict` covers `main.py` in `ci.yml`, and `python3 -m mypy --strict main.py` reports **0 errors** where it reported 5.
2. The comment above the invocation names the REAL surface, with no remaining claim of coverage the command does not deliver. ⛔ The comment is checked as carefully as the code: a corrected gate under a still-false comment does not close this phase.
3. ⭐ **PROVEN BY NEUTERING, not by a green run**: re-introduce one of the five error shapes (drop the `Task[None]` on `_crash_handler`, say) and OBSERVE the `python` job go RED naming `main.py`. A gate added without that observation is the very defect this phase exists to remove, and a green CI run does not distinguish "covered" from "not reached".
4. No other file silently enters or leaves strict scope — the before/after file set of the invocation is stated explicitly.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS `MYPY-MAINPY-01`

**Depends on:** Phase 164.6 (ordering only — no code dependency)
**Plans:** 2/2 plans executed

Plans:
**Wave 1**

- [x] 164.6.1-01-PLAN.md — wave 1: annotate `main.py`/`main_worker.py`/`sentry_init.py`, name and widen the ci.yml mypy step and the Makefile to the four top-level modules (96 → 100 files), correct every surface claim, local scratch-copy neuter proof (D-06b CI observation carried OPEN to ship)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 164.6.1-02-PLAN.md — wave 2: `ci-mypy-strict-surface.contract.test.ts` pins CI set == disk set == Makefile set with calibration legs; registry floor 60 → 61; TODOS `[MYPY-MAINPY-01]` closed in code with D-06b OPEN

### Phase 164.6.2: MT5RELOGIN — the MT5 gateway re-establishes its broker session without a human (INSERTED)

**Goal:** The MT5 terminal's broker session is established **ONCE, BY HAND, over VNC**, and **NOTHING re-establishes it**. MEASURED 2026-09-06 while diagnosing issue #747: the prober's credential-less `mt5.initialize()` (`scripts/prod-prober/arms/mt5.mjs:112`; `initialize()` carries no credentials, `mt5_client.py:984`) returned **-6, authorization failed**, while the RPYC bridge was HEALTHY — gateway logs show `accepted`/`welcome`/`goodbye` cycles including the prober's own `127.0.0.1` probe. So the IPC remedies do NOT apply and the fault is the terminal's SAVED SESSION being refused by the broker. `railway variables --service mt5-gateway` carries **no** `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` — only the VNC `CUSTOM_USER`/`PASSWORD`, `mt5server_port` and a `Vantage_investor_password_26547876`. The session lives solely in the Wine prefix on the `/config` volume, exactly as `docs/runbooks/mt5-go-live.md:146` Step 2 (MT5GW-01) prescribes: a ONE-TIME VNC login with "save account / auto-login". ⭐ **THE CREDENTIALS ARE NOT THE ROOT CAUSE — THE ABSENCE OF ANY RE-ESTABLISHMENT IS.** Any rotation, expiry or volume event takes MT5 down SILENTLY, and it stayed silent until Phase 164.1's prober went looking, which is that phase's whole argument. DELIVERABLE: make login env-driven — `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` as Railway variables, with **the analytics WORKER** calling the EXISTING `Mt5Client.login()` from them on session open and at its own startup, so the session is re-established without a human; investor credentials suffice (only equity and positions are read). ⛔ **CORRECTED 2026-09-13 — this sentence said "with the gateway performing `login()` at startup" and that is not implementable.** The Railway gateway is the PREBUILT third-party image `gmag11/metatrader5_vnc:2.3` pulled from Docker Hub; it reads only `CUSTOM_USER`, `PASSWORD` and `mt5server_port`, has no auto-login hook, and there is no build of ours to add one to. Founder decision 2026-09-13 took the worker-side shape over forking the image — see criterion 1 for the measurement and criterion 2 for the timing window it costs. ⛔ **The former SECOND deliverable — giving `-6` its own defect kind and remedy in the mt5 arm — was DEFERRED 2026-09-13 to Phase 164.8.3 PROBERAUTH** and is no longer part of this phase; see the resolution note below. What the prober SAYS about a lost session is 164.8.3; what the gateway DOES about one is here.

⛔ **NO AGENT ENTERS CREDENTIALS — FOUNDER DECISION 2026-09-12.** The agent builds the login path, the `-6` defect kind and the restart-self-heals proof, then hands the founder the exact `railway variables --set` commands. The founder sets them. Criterion 2 closes ONLY on an OBSERVED restart self-heal, never on the code alone — the founder was offered "close on the code, verify later" and REJECTED it, on the grounds that it is exactly the proven-locally-never-observed shape this milestone removes.

✅ **OVERLAP RESOLVED 2026-09-13 — DEFERRED, and the NAMED OWNER is Phase 164.8.3 PROBERAUTH.** This line used to say "fold or defer explicitly with a named owner"; that instruction is now discharged as a DEFER. **The `-6` naming leaves this phase entirely** — old criterion 3 is struck and does not reappear below. ⛔ **The direction was reversed after a measurement**, and the reversal is recorded rather than tidied away: the first reading folded 164.8.3 INTO this phase, having seen only its first two criteria. 164.8.3 carries **eight**, and six are nothing to do with naming — a registered red fixture, the catch-all surviving as a meaningful bucket, the `mt5-diag.sh` READ-ONLY fence, the falsifier observed RED, `terminal_info()` recorded as two booleans, and the narrowed `--arm` mode publishing what it measured. Folding those into a login phase would have buried them.
⭐ **Two reasons the ownership sits there and not here.** (1) 164.8.3 depends on Phase 164.1, which this ROADMAP states "owns the prober's MT5 arm and its defect vocabulary" — the naming is that vocabulary. (2) **164.8.3 is closeable WITHOUT the founder** and this phase is not: criterion 2 below is founder-gated on an observed restart self-heal, so keeping the naming here would hold a purely code-side fix behind a human gate. ⚠️ **This phase must not re-acquire the naming at planning time.** If a planner finds `-6` classification work in scope here, that is the overlap regrowing — route it to 164.8.3.
⚠️ **ADJACENT but DIFFERENT: `[MT5-VERDICT-SINK-01]`** (Phase 164.6, criterion 12) is a CAPABILITY verdict with no durable sink; this phase is SESSION ESTABLISHMENT. They are not the same item and neither closes the other.

**Success Criteria**:

1. Login is env-driven: **the analytics WORKER** re-establishes the terminal's session from `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` **once at its own startup, in `main.lifespan`**, and the code path is exercised by a test that fails when the call is removed.

   ⛔ **AMENDED TWICE, 2026-09-13, both times because a measurement contradicted the text. Do not restore either earlier form.**

   **(a) NOT `Mt5Client.login()` — that method CANNOT heal a `-6`.** MEASURED at HEAD: its first statement is a CREDENTIAL-LESS `initialize(timeout=...)` followed by `if not inited: self._raise_last()`. A credential-less `initialize()` is exactly the call that returns `-6` when the terminal has no authorized account, so the method RAISES before reaching the credentialed `login()` below it — the deliverable as first written was a no-op against its own target fault. Probed live against production with the repo's own READ-ONLY `scripts/mt5-diag.sh`: `PROBE {"initialize": false, "last_error": [-6, "Terminal: Authorization failed"], "terminal_info": null}`. The heal is the CREDENTIALED form, `initialize(login=…, password=…, server=…)`. ⭐ Founder decision 2026-09-13: it lands as a NEW method, not as a change to `login()`, whose four per-account callers are shipped and working.

   ⛔ **SECURITY PRECONDITION, and it is ORDERED — the redaction lands BEFORE any credential flows.** `mt5linux` f-string-interpolates arguments into remotely-eval'd code (T-134-01), and the by-value redaction loop (`for literal in (str(login), password, server)`) exists TODAY only in the `login` arm; the `initialize` arm carries `scrub_freeform_string` alone. Routing credentials through `initialize()` without moving that loop REGRESSES A SHIPPED SECURITY CONTROL. A test must fail if a credential value reaches an unredacted error.

   **(b) Startup-only — the "whenever it opens an MT5 session" half is STRUCK.** MEASURED: `Mt5Client._epoch` binds on FIRST TOUCH and `_make_mt5_session` runs in preflight OUTSIDE the lease, so a login there lets any unrelated lease release in that window refuse a LEGITIMATE derive read with `Mt5SessionAbandoned` — manufacturing a failure on live job processing. ⚠️ This lengthens the healing window, which criterion 2 already requires to be MEASURED rather than guessed.

   ⛔ **`main.lifespan` is the production path, NOT `main_worker.main`** (`main_worker`'s own docstring, Phase 143, 2026-08-20 incident). A heal added only to `main_worker` would never run in production AND would pass every test. `main.py` carries ZERO MT5 references today, so this is all-new surface there.

   ⛔ **The boot heal must never take the service down.** `rpyc.classic.connect` carries NO timeout (`MT5_REQUEST_TIMEOUT_S` applies only after the socket is up), and the service runs `restartPolicyType ON_FAILURE` with 3 retries — so a RAISING heal and a BLOCKING heal each kill it, by different routes. Gate before constructing the transport.

   ⛔ **Do NOT add the MT5 names to `main.REQUIRED_PLATFORM_SECRETS`** — Railway's `healthcheckPath` is `/health`, so reddening `config_ok` on an unset OPTIONAL variable converts a human-only config gap into a pod restart loop (T-140.1-24). Any MT5 signal on `/health` is a separate key that moves neither `status` nor `config_ok`. ⛔ **CORRECTED 2026-09-13 — this criterion said "the GATEWAY performs `login()` at startup" and that is NOT IMPLEMENTABLE.** MEASURED: the Railway gateway is a PREBUILT THIRD-PARTY image, `gmag11/metatrader5_vnc:2.3`, deployed straight from Docker Hub (`deploy/mt5-gateway/railway-gateway.md:21`); the only environment variables it reads are `CUSTOM_USER`, `PASSWORD` (both VNC) and `mt5server_port`, and its `start.sh` launches only the RPyC bridge. There is no auto-login hook and no build of ours to add one to. ⭐ The re-login therefore lives where the credentials and the tests already are: `Mt5Client.login(login, password, server)` EXISTS at `analytics-service/services/mt5_client.py` (by symbol, not line — `[164.7-CITATION-DRIFT-01]`), already does `initialize()` → `login()` with scrubbing and per-call millisecond ceilings, and is already called from `job_worker`, `allocator_positions` and `mt5_probe` with PER-ACCOUNT credentials. This phase adds the ENV-CREDENTIAL caller, it does not build a login path from nothing.
2. ⭐ **The session is re-established WITHOUT a human — proven by RESTARTING the mt5-gateway service and OBSERVING the prober's mt5 arm return no defect afterwards, with NO VNC session in between.** ⛔ This is the phase's load-bearing criterion and it closes on that observation alone. ⚠️ **AMENDED 2026-09-13 — the timing claim is narrowed, and the narrowing is the honest part.** With the worker-side shape chosen in criterion 1, a gateway restart leaves the terminal accountless until the worker next opens a session, so there is a WINDOW in which the prober can still report `-6`. The criterion closes when the prober returns no defect **without any human action** — not necessarily on the first probe after the restart. ⛔ **The window must be MEASURED and recorded, never left implicit:** state how long it was and what closed it (a scheduled job, the worker's own startup, or a keepalive). If that window is judged too long to accept, the answer is a KEEPALIVE or a reconnect hook in this phase — ⛔ never a re-litigation of criterion 1's shape, which was a founder decision taken on the measurement above.
3. ⛔ **NOT in scope — no credential is entered by an agent.** `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` are set as Railway variables BY THE FOUNDER. Investor credentials suffice: only equity and positions are read. The phase can be BUILT and its tests run against doubles without any real credential; it CLOSES only after the founder sets the variables and criterion 2 is observed.
4. ⛔ **NOT in scope — DEFERRED to Phase 164.8.3 PROBERAUTH (named owner, 2026-09-13) — ✅ THAT PHASE SHIPPED 2026-09-13 in v0.77.42.0 (PR #796), so the `-6` vocabulary now EXISTS and this phase still does not own it:** naming `-6` as its own defect kind, its remedy text, its fixture, and the `terminal_info()` two-boolean recording. This phase changes what the gateway DOES about a lost session; 164.8.3 changes what the prober SAYS about one. ⚠️ A reader who wants the `-6` vocabulary must open 164.8.3 — it is not here and its absence is deliberate.
5. ⛔ NOT in scope: changing what the gateway READS. This phase removes the need to repeat a hand login; it does not widen access.
6. ⛔ **CRITERION 2 IS HELD OPEN ON OUTCOME 0, AND ITS PRECONDITION IS NOW EXPLICIT — founder decision, 2026-09-14, taken at plan 04's decision checkpoint on a measured premise failure (`[164.6.2-CRITERION2-NEEDS-DEPLOY]`).** Criterion 2 is UNCHANGED; what changed is that it can only be satisfied AFTER this phase's branch ships. MEASURED (`164.6.2-MEASUREMENT.md`): the founder set the three variables and the redeploy fired and SUCCEEDED — ⭐ RESEARCH assumption A5 is now a measured FACT — but the deployed analytics sha was `5dead88a` (= `main`), at which `services/mt5_relogin.py` does not exist, `heal_mt5_terminal_session` has ZERO occurrences, and the deployed `lifespan` starts FOUR tasks where the branch has FIVE; **20 of the last 20** analytics deployments carry `branch: main`. ⛔ The gateway was therefore deliberately NOT restarted: the restart had exactly one possible outcome, entailed by the absence of the code, so recording it as outcome 3 would have named RESEARCH assumption A3 (a broker-side block) as the live suspect against a state nobody measured. ⛔ **Rejected alternatives, and why:** `window-acceptable` presupposes a measured window that does not exist; `hold-open-outcome-3` blames the broker for our own absent code. ⛔ **The keepalive is deliberately NOT booked** — no window was measured, and choosing an interval now is precisely the guess D-06 exists to prevent; it becomes bookable only once wave 5 produces a number.
7. ⭐ **WAVE 5 — the post-ship measurement, and it is the wave that closes criterion 2.** Preconditions, in order: (1) the branch is MERGED to `main`; (2) ⛔ the merge is OBSERVED to have DEPLOYED — confirm the `git_sha` reported by the analytics service's `/health` **CONTAINS** the merge commit BEFORE restarting anything or reading `trade_allowed`, because Phase 164.11 DEPLOYGATE measured **five SKIPPED analytics deployments in three days** and a green merge with a skipped deploy leaves production exactly as it was. ⛔ **AMENDED 2026-09-15 (founder decision at wave 5's checkpoint) — this clause said MATCHES, i.e. string EQUALITY, and equality REDS A CORRECT DEPLOY. Do not restore it.** The check is CONTAINMENT, asserted two ways: `git merge-base --is-ancestor <merge commit> <deployed_sha>` exits 0 AND `git ls-tree <deployed_sha> -- analytics-service/services/mt5_relogin.py` is non-empty — i.e. the deployed commit DESCENDS from the merge and the heal module is present in the tree the running process was built from. ⭐ **Equality was only ever a PROXY for that property, and wave 5 measured the case where the proxy breaks:** Railway SKIPPED the merge commit `1f938d6d`'s own deployment at `2026-09-14T12:54:46Z`, and what actually deployed and ran was `f901e4da` (PR #798), a DESCENDANT of it. An equality check would have failed a deploy that genuinely contained the heal, and the phase would have stalled on a false premise failure. ⚠️ Amended here because a reader of the ROADMAP alone would otherwise judge a CORRECT record non-compliant — a scope amendment that touches only the plan and not this file leaves the refused claim alive in the other file. Only then: restart the gateway, poll the diagnostic at ~2-minute granularity requiring a SECOND consecutive reading before recording any state, take the POST-RESTART narrowed prober dispatch and read its verdict from the PUBLISHED RUNNER LOG (⛔ never the exit code), and record the delta and WHAT CLOSED IT. ⛔ Still no VNC session and still no login by any instrument — that prohibition is the criterion.
8. ⛔ **QUESTION THREE IS UNSETTLED AND RIDES ON WAVE 5 — it is NOT closed and it was NOT edited against.** The contested claim (D-09) is that a login is an account change and MT5 re-clears the Expert-Advisors options on every one. MEASURED 2026-09-14: `verdict: UNSETTLED` — `terminal_info()` returns null while the `-6` is in force, so `trade_allowed` has NO readable value and neither R1 nor R2 exists. ⭐ Plan 04 task 2 therefore edited NOTHING and all FOUR copies of the stale sentence still ship unchanged, `cmp`-proven byte-identical to their pre-edit backups — *"no change needed until the reading exists"* is the planned outcome, not a failure. ⚠️ Wave 5 carries plan 04 task 1(e)'s EXACT procedure so it is not re-derived: read `trade_allowed` immediately after the FIRST reading that shows the terminal authorized (R1), then again after a REAL per-account login (R2), recording WHICH event produced R2 — a second boot heal is the credentialed-initialize form and is only a PROXY for the event the sentence is about. ⛔ Do not trigger a login by logging in yourself and do not make either instrument log in.
9. ✅ **AND NOW CLOSED THERE, 2026-09-15 by `4f1963fd` (Phase 164.6.4 plan 01).** Nothing is owed by this phase for it — see Phase 164.6.4 criterion 5 for the close. ⛔ **`[164.6.2-RAISE-LAST-SHAPE-ONLY]` HAS MOVED TO PHASE 164.6.4 MT5KEEPALIVE (founder decision, 2026-09-15) — it is NO LONGER a post-ship plan of this phase.** `Mt5Client.login`'s falsy arm goes through the shared `_raise_last`, which scrubs by SHAPE only, so a bare broker-server literal echoed back by the terminal survives into the message. **PRE-EXISTING on every shipped call site and NOT a regression**, and MEASURED rather than asserted — `test_CREDENTIAL_REDACTION_the_falsy_arm_asymmetry_is_measured_not_assumed` pins the contrast in both directions and will red loudly when 164.6.4 closes it. ⭐ **Why it moved, and it is a DEPENDENCY not a convenience:** `_raise_last` is SHARED — `login()` reaches it and so does `initialize_with_credentials()`, the verb 164.6.4's keepalive drives (MEASURED at `f901e4da`: `services/mt5_client.py` calls `self._raise_last()` from both). Today the unscrubbed path fires at analytics boot only; a keepalive calls the credentialed initialize ON A SCHEDULE and so multiplies how often it can fire. Shipping the keepalive without it would knowingly increase exposure of a known disclosure path on a PUBLIC repo. ⚠️ **The 2026-09-14 reasoning is NOT reversed, it is completed:** that decision argued only *why not 164.6* — kind mismatch against a phase of lint rules and prose. 164.6.4 is the opposite case, same file and same live path, which is why it lands there rather than staying here. See Phase 164.6.4 criterion 5, which now OWNS it.
10. ⭐⭐ **CRITERION 2 IS CLOSED — MEASURED 2026-09-15, wave 5 (`164.6.2-MEASUREMENT-WAVE5.md`, which SUPERSEDES the OUTCOME 0 record).** `outcome: CLOSED`. The `mt5-gateway` service was restarted at `2026-09-15T10:46:35Z`; the terminal was observed authorized on two consecutive diagnostic readings from `2026-09-15T10:50:18Z`; and the POST-RESTART narrowed prober dispatch, run 34960346817 (created `10:53:20Z`, strictly after the restart, distinct from the baseline dispatch and absent from the OUTCOME 0 record), reported **no defects in the narrowed scope** for the mt5 arm — read from its PUBLISHED LOG ARCHIVE's execution-anchored region and independently re-measured from that archive by the closure gate. ⛔ **No VNC session was opened before, during or after, and no login was performed by any instrument or agent.** Both preconditions were re-asserted at execution time, the deployed sha by CONTAINMENT per the amended criterion 7.
    ⭐ **D-06's number, with its cause and class, all MEASURED:** `delta: 00:03:43`, `window class: BOUNDED`, and `what closed it:` **the MT5 terminal's OWN saved-session re-authorization when the gateway container restarted** — attributed on four facts, not inferred: the container's `X connection to :1 broken` at `10:46:44Z` and fresh `server started on [0.0.0.0]:8001` at `10:46:55Z` (the rpyc worker-thread counter reset from `Thread-342` to `Thread-1`, so it is a new PROCESS and not a reconnect); NO analytics deployment on 2026-09-15 at all; NO new `mt5 boot heal:` line; and the ONLY rpyc client between the bridge coming up and the first authorized reading was the read-only diagnostic's own loopback probe, which never calls `login()`.
    ⚠️ **THREE LIMITS, recorded so nobody reads more into the closure than it holds.** (a) The delta is an **UPPER BOUND** — `railway restart` held the executor's shell for its first 180 s so no probe could be issued across the event; the true recovery could be as short as ≈23 s, and the honest gap in the poll log is stated rather than smoothed over. (b) ⛔ **The boot heal NEVER RAN** — it was deployed, armed and idle, so this phase's own mechanism is STILL UNVALIDATED in production and RESEARCH assumption **A3 remains untested**. (c) The closure does NOT establish that a gateway restart always recovers a session: this one recovered a **LAPSED** session from a still-usable saved credential, which is a different state from the **UNUSABLE**-credential case the mt5 arm's shipped remedy addresses, and the two are not distinguishable from outside the terminal.
    ⭐ **The finding that actually motivates the follow-up, and it inverts the naive reading:** the window class is `BOUNDED`, NOT RESEARCH's expected `UNBOUNDED-WITHOUT-ANALYTICS-RESTART`. Recovery is fast; **nothing TRIGGERS it.** Supplementary measurement from the hourly prober's own archives: the session was authorized at `2026-09-15T02:34:53Z` and dark at `10:40:13Z`, so it was lost inside a **≈8 h 05 m** span having survived ≈11 h 39 m since the previous heal, with nothing in the system able to notice or act. ⛔ The `08:12Z` scheduled run is recorded as **NOT-READ**, never as a `-6`: a scheduled run carries no `NARROWED DIAGNOSTIC dispatch of arm mt5:` execution anchor, and its log is polluted by the self-test step, which prints `mt5-not-authorized` by name and even prints `No defects in the narrowed scope.` for its own fixtures. **The exposure is the dark window, not the recovery.**
    ⚠️ **Question THREE is STILL UNSETTLED and now has HALF its reading.** `R1: true` (the first time R1 has had any value in this phase — `terminal_info()` was null throughout OUTCOME 0), `R2: UNAVAILABLE`, `R2 event: none within the bounded wait`, `verdict: UNSETTLED`, `r2 pending`. The 30-minute wait was waited out to `11:23:32Z` and the absence MEASURED: the only rpyc client in that span was the prober's own credential-less arm. ⛔ All FOUR copies of the stale account-change sentence remain byte-unchanged; both D-09 sites stayed hash-pinned on every gate of every task.
11. ⛔ **THE PHASE DOES NOT CLOSE YET — founder decision 2026-09-15 at wave 5's checkpoint, option `book-keepalive`.** Criterion 2 is closed, but ONE item remains open in this phase and `phase_closes: false`: **plan 06**, which takes question THREE's R2 after the next REAL per-account login (evidenced in the analytics log) and only THEN decides whether it edits the four stale-sentence copies, carrying plan 04 task 2's gates verbatim but licensed by the WAVE-5 record's verdict line rather than OUTCOME 0's; ⚠️ `[164.6.2-RAISE-LAST-SHAPE-ONLY]` is NO LONGER one of them — it moved to Phase 164.6.4 on 2026-09-15 (see criterion 9), so **plan 06 is now the ONLY thing holding this phase open**. ✅ It was CLOSED there the same day by `4f1963fd`, which changes nothing about plan 06. ⭐ **The keepalive is BOOKED as a NAMED PHASE OF ITS OWN (Phase 164.6.4 MT5KEEPALIVE) and ⛔ ITS INTERVAL IS DELIBERATELY NOT CHOSEN HERE.** Wave 5 produced exactly ONE observation of each quantity, and an interval set from n=1 is still the guess D-06 exists to prevent; the new phase owns designing it against more than one measurement. ⚠️ `[164.6.2-PLAN04-GATE-INTENT-DRIFT]` stays routed to Phase 164.8.4 GATERESIDUE — no new deferral — with wave 5's exact exit-code semantics recorded in `164.6.2-05-SUMMARY.md` instead.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS `MT5-GATEWAY-LOGIN-01`

**Depends on:** Phase 164.6 (ordering only). ⚠️ Founder-gated at criterion 2 — it can be BUILT without the founder and cannot be CLOSED without them, so it must not block Phase 164.6.3.
**Plans:** 5/5 plans executed

Plans:

- [x] 164.6.2-01-PLAN.md — wave 1: the credentialed-initialize verb on `Mt5Client` plus the by-value credential redaction that must travel with it, and a derived class-level gate proven able to fail on two levers. ⛔ FIRST BY ORDERING, not by convenience: criterion 1's security precondition forbids any plan routing a credential through `initialize()` before the redaction exists.
- [x] 164.6.2-02-PLAN.md — wave 2: `services/mt5_relogin.py` (kill-switch-gated, leased, off-loop, bounded, structurally incapable of raising), the re-cut lease roster, a new "preflight touches nothing" pin, one `create_task` in `main.lifespan`, and criterion 1's falsifier observed RED on two levers.
- [x] 164.6.2-03-PLAN.md — wave 3: the founder handover (exact `railway variables --set`, placeholders only) plus a runbook subsection, then a BLOCKING human-action gate — ⛔ criterion 3, no agent enters a credential.
- [x] 164.6.2-04-PLAN.md — wave 4: criterion 2's observation and D-06's measured window, question THREE's `trade_allowed` falsification riding along, the gated correction of the stale account-change sentence, and a BLOCKING decision routing every deferral to a named phase.
- [x] 164.6.2-05-PLAN.md — wave 5 (gap closure, post-ship): re-assert the two preconditions at execution time (merge on `main`; `/health` `git_sha` CONTAINS the heal — descendant + blob, never equality), restart `mt5-gateway`, poll to a second consecutive reading, take the POST-RESTART narrowed prober dispatch read from the log ARCHIVE, record D-06's delta and what closed it, carry question THREE's R1/R2, and a BLOCKING decision on the measured window. Instruments stay READ-ONLY; four enumerated outcomes (CLOSED / OPEN / UNREADABLE / PREMISE-FAILED) enforced by a consistency gate. ⭐ **EXECUTED 2026-09-15 → `outcome: CLOSED`, criterion 2 closed on the observation (criterion 10).**
- [ ] 164.6.2-06-PLAN.md — (post-ship, ROUTED from wave 5's checkpoint, founder 2026-09-15) question THREE's R2: take `trade_allowed` after the next REAL per-account login — evidenced by an analytics log line, ⛔ never by triggering a login and ⛔ never by making either instrument log in — then decide whether the D-09 correction is licensed. Carries plan 04 task 2's gates VERBATIM (`STALE-LICENCE`, `FOUR-COPIES-CORRECTED`, `VERBATIM-PAIR`, `DIAG-NONEXEC-ONLY`, `BLAST-RADIUS`, the fence calibration) but licensed by the WAVE-5 record's `verdict:` line, ⛔ not by the OUTCOME 0 record's UNSETTLED. ⚠️ A second boot heal is the credentialed-initialize form and is only a PROXY — an R2 from one keeps the verdict UNSETTLED.
  ⭐ **R2 WAS TAKEN 2026-09-16 ~19:50Z — the reading exists; whether it CLOSES this item is a founder call.** A founder-performed re-login on the gateway terminal (⛔ no instrument triggered it, as this item requires) produced a REAL per-account authorization at `19:50:16.567`. The Expert-Advisors options were read immediately BEFORE and immediately AFTER and are unchanged in all five checkboxes, and `scripts/mt5-diag.sh` then returned `trade_allowed: true` AND `connected: true`. ⭐ So D-09's UNCONDITIONAL claim — a login re-clears the options on EVERY account change — does NOT hold; the hazard is gated by the `Disable … when the account has been changed` checkbox, which is OFF on this terminal. ⚠️ TWO LIMITS: one login on one terminal refutes an "every one" claim but does not assert the converse; and the EVIDENCE FORM DIFFERS from the "evidenced by an analytics log line" this item names — what exists is the terminal's own Journal plus the before/after options reading, arguably the stronger oracle but not the named artefact. Full transcript, with the four pre-login ticks that also resolve the `ok=true stage="session_authorized"` contradiction, is in Phase 164.6.4's UAT under "A3 IS CLOSED, AND R2 IS TAKEN".

### Phase 164.6.3: CIDOCSPATH — a docs-only PR stops running the code gates, and a code PR is proven to still run every one of them (INSERTED)

**Goal:** A PR that changes NO code runs the entire gate corpus. ⭐ MEASURED on PR #750 (2026-09-06), whose diff is FOUR `.planning/` markdown files and zero code, zero SQL, zero migrations: **21 jobs, ~3,001 job-seconds (~50 min)**, and that total EXCLUDES `e2e-seeded` and `sql-tests`, which were still running when the census was taken. The expensive ones all ran in full — `sql-mutation` 559s, `python` 494s, `e2e` 405s, `frontend-test` 368s+344s, `lighthouse-mobile` 305s. ⚠️ **WORSE THAN WASTED MINUTES:** `e2e-seeded` and `sql-tests` each take the shared-TEST-DB advisory mutex (`61616158`), so a roadmap typo fix QUEUES BEHIND and DELAYS real code PRs on a database shared with other people's CI. DELIVERABLE: a `paths-ignore`/path-filter so a diff touching only `.planning/**` (and other pure-docs paths) skips the code-gate jobs.

⛔ **ANTI-VACUITY IS THE WHOLE RISK, AND IT IS WHY THIS IS ITS OWN PHASE.** A path filter that skips jobs has exactly the shape of a gate silently not running — this milestone's named defect class. It is **NOT** shippable on the evidence that a docs PR went fast; it is shippable ONLY on evidence that a CODE PR still runs everything. ⚠️ Beware the GitHub trap that `paths-ignore` on a REQUIRED check reports *pending forever* rather than *passed*, wedging branch protection; whichever mechanism is chosen (a job-level `if:` on a changed-files step is usually safer than workflow-level `paths-ignore`) must be demonstrated NOT to wedge the `frontend` aggregator. ⛔ NOT in scope: changing WHICH gates exist, or their contents — this is about WHEN they are invoked, nothing else.

⚠️ **RUNS LAST OF THE THREE, DELIBERATELY.** It moves the gate corpus underneath everything else, so Phases 164.6.1 and 164.6.2 land against a stable CI surface first. This is the same ordering argument Phase 164.6 used to keep production DDL out of a hygiene phase.

**Success Criteria**:

1. A docs-only PR (diff entirely under `.planning/**`) no longer runs the code-gate jobs.
2. ⭐ **A code PR still runs EVERY one of them — and THIS is the real criterion.** ⛔ Proven on TWO REAL PRs, not on a dry run and not on a workflow-syntax argument.
3. **The before/after job set is compared explicitly and any difference is named.** ⛔ A shorter job list on a CODE PR is a REGRESSION, not an optimisation, and closes nothing.
4. The `frontend` aggregator is demonstrated NOT to wedge — no required check left reporting *pending forever*.
5. The shared-TEST mutex is no longer taken by a docs-only PR, measured by the absence of a `61616158` acquire in that PR's run.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS `CI-DOCSPATH-01`

**Depends on:** Phase 164.6 (ordering), and runs AFTER 164.6.1 and 164.6.2 so it does not move the gate corpus underneath them.
**Plans:** 5/5 plans executed

Plans:

- [x] 164.6.3-01-PLAN.md — (wave 1, TRACER) `scripts/classify-changed-paths.mjs` with its fixture self-test, the `changed-paths` job with no `if:` of its own, `sql-gate-lint` filtered end to end, the ONE uniform aggregator arm placed FIRST behind a declared `ALWAYS_ON` list, and a contract test that EXTRACTS and EXECUTES the aggregator's own shell — plus the guard's registration and shrink-floor bump in the same commit
- [x] 164.6.3-05-PLAN.md — (wave 2, INSERTED mid-phase) repair the MW02 executed-tolerance oracle, which wave 1 made blind to its own subject by hoisting `docs_only`/`ALWAYS_ON` above the slice it executes. Runs BEFORE the filter is widened: `extractResultLoopScript` slices from `fail=0`, the spawned bash treats an unset variable as an error, and `TOLERANCE_BEARING_JOBS` becomes a three-set partition
- [x] 164.6.3-02-PLAN.md — (wave 3) the remaining fifteen filtered job keys, the exact-set partition pinned in BOTH directions against a population re-derived from `ci.yml`, scenarios S1–S8, and the anti-vacuity neuter OBSERVED red in a tempdir copy with a non-vacuity control, left running as a durable calibration arm
- [x] 164.6.3-03-PLAN.md — (wave 4) `[CI-DOCSPATH-01]`'s owner re-pointed from Phase 164.6 item (12) to this phase with the dated reason, its two-mutex claim corrected to THREE with `python` named, `[164.6.3-PLANNING-SUBJECT-DEFERRED-DETECTION]` booked to Phase 164.6 GATE-HYGIENE, and the byte-equal VERSION bump with one unified CHANGELOG entry cross-checked commit by commit
- [x] 164.6.3-04-PLAN.md — (wave 5, checkpointed) criteria 1–5 closed on TWO REAL PRs: the code-PR census with its three-acquire positive control, a blocking-human MERGE GATE, then the `.planning/`-only PR's skipped set, GREEN aggregator and zero-acquire absence. The `supabase/migrations/**` probe PR is REFUSED and replaced by a byte argument

### Phase 164.6.4: MT5KEEPALIVE — nothing TRIGGERS a recovery, so the terminal sits dark for hours while recovery itself takes minutes (INSERTED)

**Goal:** Give the MT5 terminal's broker session something that NOTICES it has lapsed and ACTS, so the session is not dark for hours waiting on an unrelated event. ⭐ **BOOKED ON A MEASUREMENT, founder decision 2026-09-15 at Phase 164.6.2 wave 5's checkpoint (option `book-keepalive`)** — it became bookable only once a number existed, which is exactly what D-06 deferred it for.

⛔ **THE INTERVAL IS NOT CHOSEN HERE AND WAS DELIBERATELY NOT CHOSEN AT THE CHECKPOINT.** Wave 5 produced exactly ONE observation of each quantity, and an interval set from n=1 is still the guess D-06 exists to prevent. **This phase owns designing the interval against MORE THAN ONE measurement.** ⚠️ A planner who picks a number from the single wave-5 reading has reproduced the failure this phase was created to avoid.

⭐ **THE TWO FINDINGS THAT MOTIVATE IT, because the naive reading picks the wrong number.**

1. **Recovery is FAST; nothing TRIGGERS it. The exposure is the dark window, not the recovery.** MEASURED (`164.6.2-MEASUREMENT-WAVE5.md`): once the gateway was restarted the session came back in `00:03:43` — and that is an UPPER BOUND, the true figure possibly ≈23 s. But the session had been lost inside a **≈8 h 05 m** span (authorized `2026-09-15T02:34:53Z`, dark `10:40:13Z`) having survived ≈11 h 39 m, with nothing in the system able to notice or act. ⛔ Sizing a keepalive against the 3-minute recovery is sizing it against the wrong quantity.
2. **The boot heal NEVER RAN — it is deployed, armed and idle, and a keepalive is NOT a duplicate of it.** `heal_mt5_terminal_session` fires at ANALYTICS startup and nowhere else (D-08), and analytics startup is **not correlated with the terminal losing its session** — wave 5 measured no analytics deployment at all on the day the session lapsed. What recovered the session was MT5's OWN saved-session re-authorization when the gateway container restarted, attributed on four measured facts (the container's shutdown and fresh-boot log lines with the rpyc thread counter resetting; no analytics deployment; no new heal line; and the only rpyc client before the first authorized reading being the read-only diagnostic itself). ⛔ **Consequence: this phase's own heal is STILL UNVALIDATED in production and RESEARCH assumption A3 is STILL UNTESTED.** A keepalive covers the case the heal structurally cannot — a session that lapses while nothing restarts.

⚠️ **A design constraint inherited, not to be rediscovered:** a periodic terminal touch shares ONE terminal with live job processing, so it must be designed against the lease and the `MT5CONC-02` account bracket. ⛔ And it must not itself become a login: criterion 2's prohibition (no VNC, no login by any instrument) is what makes the phase's observations worth anything, and Phase 164.6.2's diagnostic is READ-ONLY for the same reason.

**Success Criteria**:

1. ⭐ **THIS PHASE STARTS THE DATASET; IT DOES NOT CHOOSE THE INTERVAL** (founder decision `book-keepalive` 2026-09-15, D-3 in CONTEXT.md; ⚠️ AMENDED 2026-09-15 after the phase researcher found this criterion's original wording contradicted that decision). Each `authorized → dark` episode is recorded durably with its stamps and how it resolved, **per transition and never per tick**, so that n grows in production and a LATER decision can choose the keepalive interval against **MORE THAN ONE** measured session lifetime. ⛔ The keepalive interval is NEVER chosen here and NEVER carried over from wave 5's single observation — that is the guess D-06 exists to prevent. ⚠️ The DETECTION poll cadence is a DIFFERENT number and IS in scope; name the two distinctly so no reader conflates them. ⚠️ The open episode must be RE-READ AT BOOT, or every analytics deploy biases the lifetimes SHORT. ⛔ The rows must carry the ATTRIBUTION LIMIT with them, not only the prose: the detector cannot tell WHOSE account is authorized — the allocator and derive paths `login()` with per-customer credentials on the same terminal and `close()` never calls `shutdown()`, so an "authorized" reading may be a customer login rather than the env account.
2. Something in the system NOTICES a lapsed session without a human and without waiting on an unrelated restart, and the detection latency is MEASURED rather than assumed.
3. ⛔ The mechanism never logs in as a side effect of measuring, and never re-clears the Expert-Advisors options — question THREE (Phase 164.6.2 criterion 8) is UNSETTLED with `R1: true` and `r2 pending`, so the account-change hazard is neither confirmed nor refuted and must be treated as live.
4. The periodic touch is proven not to steal the terminal from live job processing — designed against the lease and the `MT5CONC-02` account bracket, with a test that fails if it can.
5. ✅ **CLOSED 2026-09-15 by `4f1963fd` (Phase 164.6.4 plan 01, wave 1).** `Mt5Client._raise_last` now takes an OPTIONAL KEYWORD-ONLY credential triple and redacts BY VALUE at all THREE of its raise points through the shipped `_redact_credential_values`; `login`'s two falsy arms and `initialize_with_credentials`' falsy arm pass it, the five credential-free callers are unchanged, and `initialize_with_credentials`' `removeprefix` unwrap collapsed to one call (the MT5 code now survives by construction, and `Mt5SessionAbandoned` escapes untouched structurally — D-42). ⛔ D-07's freeze was NOT broken: the close parameterised the SHARED helper, never `login()`'s body. The pin below did red exactly as predicted and was converted into a SYMMETRY gate rather than deleted; the signature-derived transport gate was WIDENED to both arms, so a third credentialed verb is fenced on both for free. Derived rosters unchanged either side of the edit (`_DRIVABLE` = `_ESCAPE_AWARE` = `['initialize_with_credentials', 'login']`, `_RESIDUAL` = `{}`). **The original criterion, for lineage:** ⭐ **ROUTED IN from Phase 164.6.2 criterion 9 (founder decision 2026-09-15): `[164.6.2-RAISE-LAST-SHAPE-ONLY]` is CLOSED HERE, not there.** `Mt5Client.login`'s falsy arm goes through the shared `_raise_last`, which scrubs by SHAPE only, so a bare broker-server literal echoed back by the terminal survives into the message. ⛔ **Why it MOVED, and the reason is a DEPENDENCY rather than convenience:** `_raise_last` is SHARED — `login()` reaches it and so does `initialize_with_credentials()`, the verb this phase's keepalive drives. MEASURED at `f901e4da`: `services/mt5_client.py` calls `self._raise_last()` from BOTH. Today that unscrubbed path fires at analytics boot only; **a keepalive calls the credentialed initialize on a schedule, so it MULTIPLIES how often the defect can fire, forever.** Shipping the keepalive without the fix knowingly increases the exposure of a known disclosure path on a PUBLIC repo with Sentry attached. ⚠️ This does NOT contradict criterion 9's original reasoning, which argued only *why not 164.6* — kind mismatch against a phase of lint rules and prose. Here the kind MATCHES: same file, same function, same live path. ⛔ **PRE-EXISTING on every shipped call site and NOT a regression**, and it is MEASURED rather than asserted — `test_CREDENTIAL_REDACTION_the_falsy_arm_asymmetry_is_measured_not_assumed` pins the contrast in both directions and will red loudly when this phase closes it. ✅ **IT DID, on 2026-09-15** — it was the ONLY red in the run that closed this (137 passed, 1 failed), and its own message named the remedy. It is now `test_CREDENTIAL_REDACTION_the_falsy_arm_is_SYMMETRIC_across_both_drivable_verbs`: the disclosure half was replaced by the positive form (server absent, login absent, marker present, `code == -6`), both password legs kept. ⚠️ It is its OWN criterion, deliberately not folded into the keepalive's own plans, so that if it turns out to be what holds the keepalive back it can be dropped to a successor without re-opening this phase's scope.
6. ⛔ NOT in scope: re-litigating Phase 164.6.2 criterion 1's worker-side shape (a founder decision taken on a measurement), and changing what the gateway READS.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS `MT5-GATEWAY-LOGIN-01` (successor work)
**Depends on:** Phase 164.6.2 (it supplies the measurement this phase sizes against; 164.6.2 need not be CLOSED first — criterion 2 already is).
**Plans:** 5/5 plans executed

Plans:

- [x] 164.6.4-01-PLAN.md — (wave 1) criterion 5: `_raise_last` parameterised by an optional keyword-only credential triple and redacting BY VALUE at the one shared site; the falsy-arm asymmetry gate becomes a SYMMETRY gate and the derived transport gate widens to BOTH arms; a new structural fence keeps the credential-free detector credential-free; `[164.6.2-RAISE-LAST-SHAPE-ONLY]` ✅ CLOSED 2026-09-15 by `4f1963fd` at every occurrence in `ROADMAP.md` (4 lines / 4 occurrences) and `STATE.md` (5 lines / 6 occurrences), counts re-measured before and after; there is no TODOS row — measured 0 hits at HEAD
- [x] 164.6.4-02-PLAN.md — (wave 2, TRACER) `services/mt5_session_episodes.py` records one row per session-state TRANSITION into `public.cron_runs` under a new `cron_name` (D-5, no migration), driven first by the already-wired boot heal; then `services/mt5_session_monitor.py` — a never-raising one-shot plus a thin loop — becomes the SIXTH `main.lifespan` task on a DETECTION POLL CADENCE, with `_LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2` re-cut 5 → 6
- [x] 164.6.4-03-PLAN.md — (wave 3) the loop's two safety properties made structural and calibrated: P-outer (the shared never-raises predicate WIDENED, never copied) and P-inner (a new loop-survival predicate — a keepalive that dies silently on tick 3 behind a green worker is this phase's own defect class), plus per-call validation of the one cadence knob and a `services/`-scoped fence that reds if a KEEPALIVE interval ever appears
- [x] 164.6.4-04-PLAN.md — (wave 3) the dataset is honest: per-transition-never-per-tick asserted on an EMPTY write list, the open episode re-read from the database so a deploy cannot truncate a lifetime, `not_measured` closing nothing, `code=0` recorded `unattributed` (IN-02), the ATTRIBUTION LIMIT in every row (researcher C-6), no secret in any field, and a cadence-derived blind-window escalation
- [x] 164.6.4-05-PLAN.md — (wave 3) criterion 4: an interleave falsifier with an embedded neutered-lock control proving a tick cannot steal the terminal from live job processing; the tick asserted to SKIP with an empty round-trip list on a BOUNDED acquire; `_PRODUCTION_LEASE_SITES` stays SIX because the monitor delegates and takes no lease of its own, asserted positively; the now-periodic abandoned-thread hazard shown still fenced by the epoch delta

### Phase 164.8.1: REFDATA — a schema-only restore destroys migration-seeded reference data while the ledger swears those migrations applied (INSERTED)

**Goal:** Make the TEST restore reproduce the reference rows that migrations INSERT, and fail loud when it does not. After Phase 164.8 Plan 04's restore, TEST's ledger holds all 266 migrations while the rows several of them exist to insert are GONE — and `supabase db push` will never replay them, because it skips applied versions.

⛔ **INSERTED 2026-09-09, founder decision, on MEASUREMENT not review.** Restore run `34274355596` committed; CI run `34280468314` then went red in two independent places, both tracing to the same cause:

* `python` — `insert or update on table "compute_jobs" violates foreign key constraint "compute_jobs_kind_fkey"`, `Key (kind)=(sync_trades) is not present in table "compute_job_kinds"`.
* `e2e-seeded` — `[seed] discovery_categories row for slug='crypto-sma' not found. The initial schema migration (20260405061911_initial_schema.sql) seeds this row — if it's missing the migration didn't run.` ⚠️ That seeder's inference is now FALSE and misleading: the migration DID run, and is in the ledger.

⭐ **Why this is not "e2e will re-seed it".** Phase 164.8 Plan 04's threat table accepted `T-164.8-09` (irreversible data loss on TEST) on exactly that compensating control. The control does not exist: the e2e seeder is itself one of the two failing jobs, and it fails because it EXPECTS migration-seeded rows. `T-164.8-09` is reopened.

⭐ **Why it is tractable, measured before planning:** the reference INSERTs are already idempotent — `compute_job_kinds` is written by 14 migrations, all `ON CONFLICT (name) DO NOTHING` — and every value is a LITERAL in the repo, not PROD data. So a replay carries no public-repo disclosure risk. `supabase/schema/baseline.sql` currently carries **0** data statements (562 GRANT/REVOKE, zero INSERT/COPY), which is why nothing puts them back.

⛔ **The hard part is the ALLOWLIST, not the replay.** 39 distinct tables receive an INSERT somewhere in `supabase/migrations/`, and most are data backfills inside DO blocks rather than reference seeding. Deciding which are reference tables is per-table judgment and must not be done with a regex. Two are already established: `compute_job_kinds`, `discovery_categories`.

⛔ **NOT in scope:** re-seeding shared TEST by hand to go green. Phase 164.8 Plan 06 already says such a failure must be NAMED rather than hand-seeded, and TEST is shared with other people's CI.

**Requirements**: the reference-data half of `164.2-TEST-APPLY-PROVENANCE`, the reopened `T-164.8-09`, and TODOS `[164.8-TEST-DATA-RESEEDED]` (which Phase 164.8 Plan 06 owns creating — measured 2026-09-09: it does not exist in `TODOS.md` yet).
**Depends on:** Phase 164.8 Plan 04 (its restore is what exposed this; the fix targets the same script).
**Blocks:** a green `main`. Until this lands, `e2e-seeded` — the go-live badge gate — and `python` are red on every branch.
**Plans:** 4 plans
**Status**: ✅ **COMPLETE** — 4/4 plans; `gsd-verifier` **13/13 must-haves, no gaps**. `gsd-code-reviewer` found **1 blocker + 10 warnings, all fixed**; the verification then found **3 further gaps + 4 record items, all closed**. ⭐ The blocker (CR-01) was on the phase's own instrument: this phase added mutable `refdata:<table>=<count>` rows to the census that `--mode preflight` compares BYTE-FOR-BYTE to prove its rollback — but `auth.users` is outside `public` so `DROP SCHEMA public CASCADE` never locks it, and shared TEST runs other people's CI, so a PERFECT rollback could report `Treat this database as modified.` ⛔ Two anti-vacuity defects were found INSIDE this phase's own new code and are the reason it took two review rounds: the count-aware SHORT branch shipped with **no falsifier at any layer** (reverting it turned nothing red), and the arm ratchet's calibration mutation had become a silent no-op while `EXPECTED_ARMS` moved on. Both are now armed — `EXPECTED_ARMS` 21 → 26, extractor kinds 16 → 19. Separately, bash was **command-substituting SQL comment prose** inside the unquoted `TXN_*` heredocs while assembling the destructive restore; refusal 9 + arm 26 close that, including four delimiter spellings that walked past the guard's first cut.

Plans:

- [x] 164.8.1-01-PLAN.md — (wave 1) the (file, table, count)-keyed allowlist, the refuse-by-default extractor with `--audit`/`--self-test`, the AIM-first contract test, and the audit wired self-test-first into `sql-gate-lint` and the restore workflow
- [x] 164.8.1-02-PLAN.md — (wave 2) the replay + fail-loud gate inside the restore transaction under a `SET LOCAL search_path` bracket, `refdata:` census rows, arms 22-24 (gate proven to bite on a scratch copy), `EXPECTED_ARMS` 21 → 26 with every vitest pin re-measured (arm 23 gained leg (d), the SHORT branch's falsifier, and arm 25 the rollback view's, both at phase review; arm 26 and refusal 9 came out of the phase verification, which found bash command-substituting comment prose inside the unquoted TXN heredocs)
- [x] 164.8.1-03-PLAN.md — (wave 1) the seeder's false "migration didn't run" inference corrected; the TEST-points-at-PROD-compute hazard booked as `[164.8.1-TEST-ANALYTICS-URL-PROD]` routed to Phase 164.9
- [x] 164.8.1-04-PLAN.md — (wave 3, checkpointed) first real run is `--mode preflight` on `main`; founder decides the restore on its `refdata:` readings; SHA-bound green `python` + `e2e-seeded` recorded

### Phase 164.9: TESTISOLATION — a run's assertions against the shared TEST project stop being unreliable: per-run isolation replaces global truth (INSERTED)

**Goal:** Close `FANOUT-GLOBAL-01`. TEST is shared with other people's CI, so a GLOBAL assertion there ("no stuck jobs exist", "the table is empty") is measuring other people's rows as well as ours and is unreliable by construction. Replace global truth with per-run isolation, so a run asserts about its OWN rows and nothing else.

⛔ **INSERTED 2026-09-08 by founder instruction — *"it is important to me, that all things that you defer find a phase"*, narrowed to *"if they belong structurally to what we are currently doing, which is hardening."*** This phase exists because TWO hardening items were deferred to NOWHERE during Phase 164.8's discuss: per-run TEST isolation and `FANOUT-GLOBAL-01`. They are one problem, not two — the second is the symptom, the first is the fix — so they get one phase.

⚠️ **`FANOUT-GLOBAL-01` IS NOT A `TODOS.md` ID.** Measured 2026-09-08: zero hits. It exists only as prose in `CLAUDE.md` ("a global assertion there is not reliable") and in the Phase 164.8 constraints table. Part of this phase's work is to write the entry that should have existed, or to retire the name in favour of one that does.

⭐ **Why this runs AFTER 164.8 and not before:** 164.8 restores TEST from the PROD dump. Designing an isolation scheme against a ledger and schema that are about to be replaced would be work done twice, and the restore changes what "a clean starting state" even means.

⛔ **NOT in scope:** raising Playwright workers above 1. Phase 164.8's ROADMAP entry already states that per-run isolation is the PRECONDITION for it and that parallelism must NOT be chased as an objective — measured, `e2e-seeded` sits behind `sql-mutation` so parallelism buys 1-2 min of wall clock. Isolation is worth doing for ASSERTION RELIABILITY; the parallelism it unlocks is a consequence, not a goal.

**Success Criteria**:

1. ⛔ **`FANOUT-GLOBAL-01` gets a REAL TODOS entry first.** CLAUDE.md records that it is NOT a TODOS id (measured 2026-09-08: 0 hits) and exists only as prose here and in the ROADMAP, and that THIS phase owns writing it. Planning starts by making the phase's own subject a booked item — everything below depends on it having one.
2. A CI run asserts only about the rows IT created on shared TEST. A global assertion ("no stuck jobs exist", "the table is empty") is replaced, not narrowed — and a calibration proves it by seeding a foreign row and showing the assertion stays GREEN where the old one would have gone red for someone else's work.
   ⛔ **CORRECTED 2026-09-21 (Phase 164.9 review round, `[164.9-CALIBRATION-NARROWS-NOT-REPLACES]`).** This criterion as written above is NOT what shipped, and the difference is the criterion's own subject. What shipped **NARROWS the assertions and MEASURES THE MARGIN**; it does not caller-scope the deployed sweep. All three calibration parts say so in their own headers, and the wording is theirs, not a reviewer's gloss: *"It does NOT prove the deployed sweep is caller-scoped — it is not, and cannot be without a production migration adding a run discriminator column."*
   - **PROVEN, by execution:** a FOREIGN row is seeded and the new assertion stays GREEN where the old one would have gone RED for someone else's work. That calibration is real, is armed, and was observed failing before it was observed passing.
   - **NOT PROVEN:** that the deployed sweep is caller-scoped. It is not, and cannot be without a PROD migration adding a run discriminator column. No arm exercises the OLD assertion to show it would have reddened, so the replacement half of this criterion is unmeasured.
   ⚠️ **Read as AMENDED, not as closed.** A verifier reading only the sentence above would mark this criterion closed; the in-code headers and the ROADMAP disagreed until this correction, and the ROADMAP is what the verifier reads. ⛔ The discriminator column is recorded as a KNOWN LIMIT in `TODOS.md` and deliberately carries NO phase — founder decision 2026-09-21, taken against the standing rule that only a data-integrity or user-facing gap earns its own phase. ⛔ Do not re-open it as a phase without that threshold being met, and do not silently re-word this criterion to match whatever ships next.
3. `[164.8-PUSH-RACE-VAC08]` and `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` are planned as ONE unit: they share one root (two jobs contending for advisory key `61616158` with nothing ordering them). ⛔ Splitting them creates the sequential-ratchet-patched-in-one-place hazard this repo has already paid for once.
4. ⛔ `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` is NOT closed by restoring the `|| echo ""`. That collapse IS the defect: it made the absurdity floor silently inert. If flakiness is MEASURED rather than feared, the answer is a bounded retry or the isolation this phase builds — both keep an unreadable input distinguishable from a clean one.
5. `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` has a mechanism, not a pragma. A data-reading migration that applies to PROD and refuses on an empty TEST must not block a production deploy — and ⛔ the interim remedy stays REVERT THE MERGE; `supabase-migrate.yml` is never edited to get a deploy out.
6. `[164.8.1-TEST-ANALYTICS-URL-PROD]` is closed by measurement: shared TEST's cron demonstrably no longer reaches PROD compute, shown by reading the live row rather than the migration that set it.
7. `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]` gains a THIRD gate leg pinning expected column VALUES, beside the emptiness and count-floor legs — both existing legs measure `count(*)` and neither can see a row restored in the wrong STATE.
8. The two restore-workflow items routed from Phase 164.8 Plan 04 are discharged by ONE green `mode=restore` dispatch, and its run id is recorded.

   ⭐ **DECIDED 2026-09-21 — OPTION A: SHIP, THEN DISPATCH, THEN RECORD (founder call, plan 11 Task 1).** The restore workflow refuses any dispatch that is not from the default branch, deliberately, and the guard's own comment gives the reason: a branch dispatch would restore shared TEST from an unreviewed dump. This phase's new restore guards therefore CANNOT be exercised against shared TEST until this phase has merged — **criterion 8 is POST-MERGE BY CONSTRUCTION**, and that is recorded as a decision rather than discovered at ship time. The falsification is already done: plan 07 proved both directions of the schema-scoped extension guard RED on a disposable cluster, and the value-pinning gate leg with it. What a dispatch adds is the shared-TEST EXECUTION, not the falsification. Option B (re-home criterion 8 to a successor) was declined because it would put a routed item back into precisely the ownerless state this phase exists to end.
   ⛔ **THE FOUNDER'S BINDING CONDITION, and it is the load-bearing half of the decision: Option A is honest ONLY BECAUSE THE RECORDING ACT IS ITSELF BOOKED, BEFORE THE MERGE, WITH A NAMED OWNER.** It is `[164.9-CRIT8-RESTORE-DISPATCH-RECORD]` in `TODOS.md` (booked 2026-09-21), **owner: the founder — the human who merges this phase**; trigger: this phase's restore-script changes reaching the default branch; closed only by two run ids, both conclusions, the committing run's printed summary line verbatim, and evidence the guards ran. A phase that closes on an unbooked promise is the ownerless-prose-id defect this phase exists to eliminate, reproduced one entry further down.
   ⭐ **AMENDED 2026-09-21 — THE FOUNDER DELEGATED THE DISPATCH AND THE BASELINE RE-DUMP TO THE AGENT**, in session and in their own words: *"I authorize you to do this: the post-merge test-restore-from-baseline.yml dispatch for criterion 8, and the baseline re-dump."* ⛔ Recorded here AND in `[164.9-CRIT8-RESTORE-DISPATCH-RECORD]` AND in `164.9-CONTEXT.md`, because an override that lives in one file is how a one-off becomes a precedent nobody voted for. ⚠️ **It is a dated, single-occasion delegation, NOT a standing rule** — a later session reading this has not been authorized by it. ⚠️ **NOTHING ELSE MOVES:** the dispatch stays post-merge by construction, the preflight is still read before the committing mode, the confirm token is still derived at the MERGED ref, and ⛔ DATA IS STILL NOT RECOVERABLE — the backup artifact carries schema and ledger only.

   ⛔ **UPDATE 2026-09-21, POST-MERGE — THE PREFLIGHT RAN AND REFUSED. Criterion 8 stays OPEN, and this is a REFUSAL rather than a restore.** Run `35662948549`, `mode=preflight`, dispatched from `main` at merge commit `594e5471`: conclusion **failure**. The restore script refused with *"the baseline dump is STALE … A migration landed after the last dump regeneration, so this dump does not describe PROD. Regenerate the baseline first."* ⭐ **The refusal is CORRECT and the guard ORDER is the lesson:** the sha256 check PASSED first — the dump matches its own recorded row — and the CURRENCY check is what bit. Measured: dump taken 2026-09-18T13:51Z, migrations last moved 2026-09-20T14:48Z, with `20260919120000_strategy_sync_cursors.sql` and `20260920120000_api_keys_venue_account_id_grant.sql` landing inside the gap. A committing run would have rebuilt shared TEST's `public` schema from a snapshot missing both. ⛔ **The committing mode was NOT dispatched** — the booked act permits it only on a green preflight. ⚠️ **The remedy is founder-owned by construction:** the re-dump is `supabase db dump --linked` against PRODUCTION and authenticates with the production database password; no agent enters or reads a credential, ever. Full record in `164.9-11-SUMMARY.md`.

   ⚠️ **STATUS: PENDING, NOT DISCHARGED — criterion 8 stays OPEN until that entry closes.** Plan 11 PREPARED the dispatch (preflight first, then the committing mode; the confirm token derived at dispatch time from the tracked baseline record at the dispatched ref, never copied out of a planning document; the exact strings to read) and deliberately did NOT run it: a committing restore drops and rebuilds the `public` schema of a database other people's CI uses, and that is a human act. The prepared recipe and its refusals live in `164.9-11-SUMMARY.md`.
   ⛔ **WHAT A GREEN RUN ID WILL NOT CLAIM — written now so a later reader cannot read it in.** The extension guard runs AFTER its transaction commits, so in `mode=restore` it LABELS an outcome and never PREVENTS one; no dispatch changes that. ⚠️ And MEASURED by plan 11 while preparing the recipe: **`check_extension_guard` is not reached in `mode=preflight` at all** — the preflight branch returns at its byte-for-byte rollback comparison, which covers the extension class incidentally and never names the guard. So a green preflight does NOT evidence that guard; only the committing run does. A run recorded as a discharge whose log does not show the guard would be a green that is not measuring what it claims — the family this whole phase exists to remove.
   ✅ **DISCHARGED 2026-09-26 by Phase 164.9.2 criterion 4 — criterion 8 is MET.** The PENDING status above is kept as lineage. Preflight run `36235362126` at `06cbe2030`: **success**, restore self-test 41/41 arms, marker names TEST; restore attempt run `36237060668`: **refused by the activity gate** (2 non-idle sessions besides the holder); nothing was written; restore run `36242946174` at `ea4167a3f`: **success**, marker names TEST, activity gate quiet (holder only, idle x16), printing `restore: tables=63 policies=155 functions=121 ledger_rows=277 survivors=2/2 filtered=1 mode=restore`. Both committing dispatches were made by the founder with the confirm token. The committing run reached the summary line, which `restore_mode` prints only after `check_extension_guard` and the ownership comparison pass. That is the "reached the point past it" reading this block requires, since both guards are silent when clean.
9. Every assertion this phase adds or changes is proven able to fail: neutered, observed RED, restored from a **byte backup** — ⛔ never `git checkout --`, which silently destroys concurrent uncommitted work.
10. ⛔ Nothing here is closed by widening an exemption, relaxing a floor, or asserting a smaller scope. Where narrowing IS the honest answer, it is dated and reasoned in-code.

11. `[164.9-SHARED-TEST-TRANSPORT-FLAKE]` — the shared-TEST transport flakiness criterion 4 asked to be MEASURED rather than feared IS now measured, so its named answer (bounded retry, or the isolation this phase builds) is owed. ⛔ Proven by THREE attempts of ONE run at ONE commit — run `34763669052` at `e64b0811` on `main`, 2026-09-13. **Attempt 1** (concluded 15:05:02Z): `python` RED on `tests/test_compute_jobs_fencing.py` with `postgrest.exceptions.APIError … 504 Gateway Timeout` (1 failed, 2 errors) while `5449 passed, 71 skipped` and coverage held at 90.98% against the 80% floor. **Attempt 2** (15:21→15:28Z): RED again, but a DIFFERENT signature on a DIFFERENT test set — `httpx.ConnectError: [Errno 104] Connection reset by peer`, now including `tests/test_drain_semantics.py` (2 failed, 4 errors). **Attempt 3** (15:30→15:39Z): GREEN, same code. ⭐ Non-deterministic victims across attempts is the proof that this is TRANSPORT, not logic. ⚠️ It is NOT the wedged-pool mechanism: a live probe at 15:30Z returned three 200s in 0.78s / 0.42s / 0.25s on `/rest/v1/profiles?select=id&limit=1`, and `pg_stat_activity` showed 11 `application_name='postgrest'` backends ALL idle — so the recorded `pg_terminate_backend` remedy was correctly NOT fired at infrastructure shared with other people's CI. ⛔ The remedy is NEVER a bare re-run: a re-run is what made it green and it taught nothing. DELIVERABLE: a bounded retry at the transport boundary that keeps a transient fault DISTINGUISHABLE from a clean run, or per-run isolation — and the retry must be observed to EXHAUST (neuter → RED → restore from a byte backup), never assumed.
    ⛔ **PARTIALLY DELIVERED, CORRECTED 2026-09-21 (review round 2) — READ THIS BEFORE MARKING IT CLOSED.** The bounded retry EXISTS, is observed to exhaust, and is visible on a green run (a counter printed unconditionally at session teardown, calibrated on a PASSING run that retried). **But it covers READS ONLY.** The retry stops at the idempotency boundary — `insert`/`upsert`/`update`/`delete`/`rpc` run their terminal `.execute()` exactly once — and `rpc` is there FAIL-CLOSED because the wrapper cannot read a function body to know which RPCs are read-only. ⚠️ **The victims criterion 11 actually measured are RPC-heavy** (`test_compute_jobs_fencing.py`, `test_transition_rpc.py`, `test_drain_semantics.py`), so the narrowing lands on exactly the files whose 504s are the evidence above, and `_rpc_retry_timeout`'s 2-attempt `pytest.skip` grace is reachable again. ⛔ Do NOT close this criterion as fully delivered, and ⛔ do NOT "fix" it by putting `rpc` back on the retried side — replaying a claim RPC can corrupt a fence silently, which is worse than a visible red. The residue is `[164.9-RPC-RETRY-NARROWED-SKIP-REOPENED]`; its shape is an explicit allowlist of READ-ONLY RPC names.

12. `[164.9-MUTEX-HOLDER-DIED-UNSERIALIZED]` — a run whose advisory-lock holder dies mid-job must not be able to report its DB assertions as trustworthy. MEASURED 2026-09-13 in that same run `34763669052`: the `python` job's release step printed verbatim `mutex holder pid <n> died BEFORE this release step — the DB work after its death ran UNSERIALIZED. Do not trust this run's DB assertions; investigate.` ⚠️ That sentence is the ONLY signal; it is advisory prose in a log nobody re-reads, and the job's verdict is unaffected by it — so a run can go GREEN on assertions its own harness has just declared untrustworthy. ⭐ That is `FANOUT-GLOBAL-01` in its purest form: a green reading that is not measuring what it claims, which is why it belongs here and not in a hygiene phase. DELIVERABLE: the dead-holder condition produces a NON-ZERO verdict (or the run's DB assertions are re-run under a live holder), proven by killing the holder mid-job on the throwaway lane and observing the job go RED. ⛔ NOT closed by deleting, softening or re-wording the warning.

13. `[164.9-CREDENTIALED-TESTS-RED-AND-UNGATED]` — the live-DB test class that executes ONLY when TEST credentials are present is RED, and the first task is to establish whether any CI gate can see it. MEASURED 2026-09-13 at `f915bf49` on a recorded full run: `16 files / 38 tests FAILED, 14948 passed, 94 skipped` — against the SAME tree's plain `npx vitest run`, which reported `855 files passed, 0 failed, 280 skipped`. ⭐ The tell is the SKIP COUNT, 280 → 94: the delta IS the class, and it skips when credentials are absent. Failure signatures are shared-TEST schema drift, not logic — `PGRST203` (TWO live overloads of `public.claim_compute_jobs_with_priority`, a 2-arg and a 5-arg, so PostgREST cannot choose between them), `PGRST205` (table absent from the schema cache), `PGRST204` (`key_hash` column of `api_keys` absent), `Invalid schema: cron`, and `42501`. ⚠️ PRE-EXISTING, not introduced: all 15 failing files plus `vitest.config.ts` are byte-identical to `main`. ⛔ **UNVERIFIED and to be measured FIRST, not assumed:** whether CI's vitest shards run this class at all. This entry was written from a LOCAL run; the claim "CI never runs them" was deliberately NOT made, because it was not measured. Establish it by reading the shards' env and skip counts, then act. DELIVERABLE: the class runs somewhere it can go RED, or its drift is fixed with a gate proven to bite. ⛔ NOT closed by deleting the tests, by skipping them permanently, or by arguing CI's green is sufficient.

⛔ **CLOSING RESIDUE — FIVE items booked or re-homed 2026-09-21 as this phase closes (plan 11 Task 3). Each carries an id, a date, a trigger, a named owner and a statement of what would NOT close it, and each has a matching `TODOS.md` entry so the two ledgers say the same thing.** ⚠️ The standing rule this phase exists to enforce applies to its own residue first: an item two places disagree about is owned by NEITHER, and a destination left blank is not a destination.

1. **`[164.9-CRIT8-RESTORE-DISPATCH-RECORD]` — the criterion 8 recording act.** The binding precondition of the Option A decision above. **Owner: the founder** (the human who merges this phase). Trigger: this phase's restore-script changes reaching the default branch. ⛔ NOT closed by a run id alone: the committing run's log must show the guards it was dispatched to exercise, and a run that concluded successfully without exercising them has discharged nothing.
2. ⛔ **`[164.9-FANIN-STATUS-NEVER-SET]` — A CONFIRMED PRODUCTION DEFECT, DATA INTEGRITY, and the most serious item in this residue.** `enqueue_compute_job` routes all three of its modes to the TEN-ARG `_enqueue_compute_job_internal`, whose `INSERT` column list omits `status`, so the row takes the column DEFAULT `'pending'`. Only the SEVEN-ARG overload carries migration 109's `done_pending_children` branch, and nothing reaches it — **so a job enqueued through the public wrapper WITH `parent_job_ids` never enters the fan-in state in production**, and the fan-in advance can never see it. ⚠️ The ten-parameter migration's own comment says the function "computes the status … and INSERTs it"; the code does not. Surfaced by the live-DB lane (plan 08 fix round, g10b P12) and **verified independently by the orchestrator, not merely reported**. ⛔ It needs a MIGRATION and is NOT 164.9 work — no migration was authored here. ⛔ A fix re-bases on the LATEST definition after grepping ALL migrations for both overloads BY SYMBOL, and goes through `migration-reviewer` + `rls-policy-auditor` + `silent-failure-hunter` before any apply. **Destination: a new phase, proposed JOBRPCTRUTH — surfaced in `164.9-11-SUMMARY.md` for `/gsd-phase --insert`; interim owner the founder until it exists.**
3. **`[164.9-BASELINE-PRIVILEGES-ABSENT]` — the F1 live-DB residue, with the correction that changes its remedy.** 15 lane failures remain that are not fixture defects. Plan 08 read all 15 as "the schema-only baseline omits column- and function-level privileges" — but for `wizard-rpcs-live-db` (6 of the 15, the largest single file) the MEASURED message is the function BODY's own role gate, and the baseline DOES carry the REVOKE/GRANT pair for that function, **so a baseline re-dump may NOT close those six**. Book the split, not the aggregate: **9 likely closed by a re-dump, 6 a separate question.** ⚠️ The re-dump is a HUMAN-RUN command against PRODUCTION per `supabase/schema/BASELINE.md`, and `baseline.sql` is what the restore rebuilds shared TEST from, so that work carries the three migration reviewers in full. **Destination: a new phase, proposed RESTOREFIDELITY — surfaced in `164.9-11-SUMMARY.md` for `/gsd-phase --insert`; interim owner the founder until it exists.**
4. **`[164.9-LIVEDB-RESIDUE-RPC-AND-INTENT]` — two more lane failures needing a production change, distinct from F1.** (a) The `already_inflight` branch of `request_allocator_holdings_sync` is UNREACHABLE: `_enqueue_compute_job_internal` does an optimistic look-up first and RETURNS the existing in-flight id instead of raising `unique_violation`, so the `EXCEPTION WHEN unique_violation` handler that produces the Queued shape never fires. Needs an RPC change. (b) `match-decisions-xor-rls` asserts `bridge_outcomes_unique_per_strategy_holding`, which migration **081 REPLACED** with a per-decision key (`bridge_outcomes_allocator_match_decision_unique`) — so this is an INTENT question about what the arm should assert under the CURRENT invariant, not fixture drift. ⛔ Neither is closed by rewriting the assertion to accept today's behaviour: that encodes a defect as the contract. **Destination: the same proposed JOBRPCTRUTH phase as item 2; interim owner the founder until it exists.**
5. ⚠️ **`[164.9-TEST-ANALYTICS-URL-REARM]` — RE-HOMED, because its `Owner:` named THIS phase.** Booked by plan 10 against Phase 164.9 itself, which is the phase now closing; plan 10's own SUMMARY flagged it as "one phase-close away from being exactly the ownerless prose id this phase exists to eliminate". Its real subject is **restore-workflow hardening** — a post-restore step in `test-restore-from-baseline.yml` that runs the remediation inside the held shared-TEST mutex, after the reference-data replay — which is why it belongs with item 3 and not here. ⛔ Its forbidden closures are unchanged and still binding: never by editing the reference-data allowlist, never by a migration. **Destination: the same proposed RESTOREFIDELITY phase as item 3; interim owner the founder until it exists.**

⛔ **WHAT PLAN 11 DID NOT DO, recorded rather than left to inference:** it authored no migration, ran no database command, dispatched no workflow, and hand-numbered no phase. Items 2–5 name PROPOSED phases because the executor is not permitted to number one; `/gsd-phase --insert` is the act that turns each proposal into a real destination, and until it runs the owner is the founder — never blank, and never a prose id.

**Requirements**: TBD (no v1.20 requirement IDs) + `FANOUT-GLOBAL-01` (prose only — see the warning above), the per-run isolation item deferred out of Phase 164.8's `<deferred>` block, and TODOS entry `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]` — read `164.8-CONTEXT.md` before planning, do not re-derive, plus the two restore-workflow items routed here from Phase 164.8 Plan 04 (see the ROUTED HERE block below), and `[164.8.1-TEST-ANALYTICS-URL-PROD]` plus `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]` routed here from Phase 164.8.1, and `[164.8-PUSH-RACE-VAC08]` routed here from Phase 164.8 plan 05, plus `[164.8.2-VAC08-FATAL-ON-TRANSIENT]` routed here 2026-09-10 out of Phase 164.8.2's round-three review (⛔ `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]` was in this list until the security audit caught it: the body below says MOVED to 164.8.4 while this line still claimed it, and an item two phases name is owned by NEITHER — it is 164.8.4's) — ⚠️ the second is the same root as `[164.8-PUSH-RACE-VAC08]` and must be planned WITH it (see their ROUTED HERE blocks below). Plus `[164.9-SHARED-TEST-TRANSPORT-FLAKE]`, `[164.9-MUTEX-HOLDER-DIED-UNSERIALIZED]` and `[164.9-CREDENTIALED-TESTS-RED-AND-UNGATED]`, all three routed here 2026-09-13 out of the PR #795 land-and-deploy (see the ROUTED HERE block below) — ⚠️ the first is the MEASUREMENT criterion 4 asked for before prescribing a remedy, so it must be planned WITH criterion 4 and not as a separate ratchet.

⛔ **ROUTED HERE 2026-09-08 by Phase 164.8's plan-checker (B4).** 164.8 restores TEST from a SCHEMA-ONLY dump (`BASELINE.md`: 0 data statements), so TEST mirrors PROD's CATALOGUE, never its DATA. A migration whose DO block reads a PROD-populated table and RAISEs on an unexpected count applies cleanly to PROD and refuses on an empty TEST — and 164.8 Area 1 Q2 makes that BLOCK the PROD apply. The retired `TEST-NOT-APPLICABLE` pragma was the declared escape hatch, and 164.8 retires it. Interim remedy is revert-the-merge, never a YAML edit under deploy pressure. Phase 164.10 was considered and rejected as the home: it is function-body scope only.
⛔ **ROUTED HERE 2026-09-08 by founder instruction, out of Phase 164.8's Plan 04.** Two items were found by RUNNING the restore (run `34274355596`, head `88581b8b`) rather than by review, and neither belongs in a ratchet PR. Both are discharged by ONE green `mode=restore` dispatch, so they are one unit of work:

1. **The post-COMMIT extension guard is defective in three ways** — `scripts/restore-test-from-baseline.sh:1090`. It asserts strict equality on a WHOLE-DATABASE `count(*) FROM pg_extension` while its own comment reasons about extensions "in `public`"; it therefore fired on a **gain** (6 → 7, the dump correctly creating `pg_net`, which PROD had and TEST lacked) and phrased that gain as a loss — *"An extension that lived in public was CASCADE-dropped and the dump did not put it back."* And it runs AFTER the transaction commits, so in `mode=restore` it can only mislabel an outcome, never prevent one. ⚠️ The naive fix (`post_ext -ge pre_ext`) reintroduces the same one-sidedness pointing the other way: the remedy must be TWO-DIRECTIONAL and scoped to the schema it reasons about, with both directions observed RED before it is believed. Full measurement in `164.8/deferred-items.md` item 6.

2. ~~**The Supabase CLI post-verify has NEVER executed**~~ — ✅ **DISCHARGED 2026-09-09. IT EXECUTED AND PASSED; this item is closed and must not scope work here.** The paragraph below is kept as lineage and was TRUE when written on 2026-09-08. It ended "do not close that claim on anything but a run" — and a run then happened: **`34330741339`**, head **`a622df27`**, `mode=restore`, 2026-09-09T08:44Z, step 24 → `success`, printing verbatim `post-verify: the pinned CLI parses the seeded ledger and reports nothing pending — ledger SHAPE is consistent.` Both asserted strings held under the **pinned 2.98.2**, which was the exact uncertainty the item existed to name. Found by the Phase 164.8 verifier on 2026-09-09 and confirmed independently by the orchestrator (`gh run view 34330741339` → `conclusion=success`). ⚠️ It stayed shipped as OPEN for ~8 hours across plan 06's book-closing because nothing re-measured it — the record-vs-reality class this milestone exists to remove, caught here by a verifier that re-ran the claim instead of reading it. `164.8/deferred-items.md` items 4 and 6 and `164.8-04-SUMMARY.md` `coverage.D4b` carry the same correction. **Item 1 above is NOT discharged** and remains this block's work.
   <br>*Superseded text, 2026-09-08:* It was skipped by item 1's exit 1, and was already recorded as never-run before that (`164.8/deferred-items.md` item 4). Its two asserted strings were measured against the LOCAL CLI **2.84.2**; CI pins **2.98.2**, where the wording is INFERRED, not executed. Phase 164.8 Plan 04 marks the must_have it serves (`coverage.D4b`) **UNMET** rather than claiming it passed — do not close that claim on anything but a run.

⚠️ **These two are topically about the RESTORE WORKFLOW, not per-run isolation.** They live here because this phase is the hardening deferrals' home and depends on 164.8's restore, not because they share its subject. Do not let them dilute `FANOUT-GLOBAL-01`, which remains this phase's reason to exist.

⛔ **ROUTED HERE 2026-09-09, out of Phase 164.8.1's plan — `[164.8.1-TEST-ANALYTICS-URL-PROD]`: shared TEST's cron points at PROD compute.**

`system_settings.analytics_service_url` is seeded with the PROD Railway host (`supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql:295`, the literal taken verbatim from `scripts/prod-prober/cron-manifest.json` jobid 1) and that row feeds `public.match_engine_cron_tick()`, a `pg_net` tick. So a TEST cron tick can POST to the PRODUCTION analytics service.

⚠️ **PRE-EXISTING, NOT INTRODUCED — and that is the reason it is routed rather than fixed in 164.8.1.** The restore drops only `public` (the `DROP SCHEMA public CASCADE` in that script's TXN_DROP heredoc — cited by symbol, because the `:861` written here on 2026-09-09 had drifted to an unrelated line inside the same PR), so TEST's `cron.job` schedule was never touched; whatever TEST was doing before the restore, it still does. Phase 164.8.1 therefore replays the statement FAITHFULLY (founder call, 2026-09-09): omitting it would leave TEST missing a setting its own ledger claims applied, and the migration's own guard already requires an allowlisted https host.

⛔ **Do NOT resolve this by editing 164.8.1's allowlist.** That would make the restore silently normalise the hazard, which is the failure class this whole line of work exists to remove. The fix belongs here, with per-run isolation, because "which service does a TEST tick talk to" is the same question as "whose rows is a TEST run asserting about".

⚠️ Two traps for whoever takes it: `pg_net` is ASYNC, so a green cron row proves nothing about the HTTP result — seven days of 401s once hid behind one. And the marker check confirms which DATABASE you are on, never which SERVICE the tick calls.

⛔ **ROUTED HERE 2026-09-09, out of review of Phase 164.8.1's PR — TODOS `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]`: the restore's replay reproduces INSERTs, never the UPDATEs that followed them.**

A migration seeds a row, a LATER migration UPDATEs it, and after a restore the row is PRESENT but in the wrong STATE — while the ledger holds rows for both. Both legs of 164.8.1's in-transaction gate measure `count(*)`, so neither can see it. **The evidence, the worked case and the five measured UPDATEs are in the TODOS entry; they are not restated here.**

✅ **Why THIS phase.** Same family as `FANOUT-GLOBAL-01`: a green reading that is not measuring what it claims. "In what STATE is a restored TEST row" is the same question as "whose rows is a TEST run asserting about", so it belongs with per-run isolation rather than with 164.8.1's criterion.

⚠️ **Bounded, which is why it was routed rather than allowed to block 164.8.1.** All five UPDATEs land on the teaser trio (`profiles`, `strategies`); none touch the FK- and CHECK-bearing reference tables. The fix is a THIRD gate leg pinning expected column VALUES, beside the emptiness and count-floor legs 164.8.1 ships.

⛔ **ROUTED HERE 2026-09-09, out of Phase 164.8 plan 05's review — `[164.8-PUSH-RACE-VAC08]`: `sql-tests` (VAC-08) and `supabase-migrate.yml`'s `apply-test` share ONE advisory lock on the merge push, so their order is undefined.**

MEASURED 2026-09-09: advisory key `61616158` appears 7× in `supabase-migrate.yml` and 26× in `ci.yml`. On a merge both workflows start, both take that key, and nothing orders them. Plan 05 shipped a frontier exemption that makes VAC-08's VERDICT order-independent and stops every migration-adding PR from being red by construction — but it removed the CONSEQUENCE, not the coupling. **The evidence, the three residuals it did not close, and the candidate fixes live in the TODOS entry and are not restated here.**

✅ **Why THIS phase.** Two jobs contending for one lock on a database shared with other people's CI is literally the `FANOUT-GLOBAL-01` family, and the fix shape — distinct keys plus explicit ordering — is the same work as isolating TEST lanes. Two of the three residuals are gate-integrity riders that would sit equally well in a hygiene phase, but they are cheap alongside the first, and splitting them would create the sequential-ratchet-patched-in-one-place hazard this repo has already paid for once.

⛔ **Do not close this by widening the exemption.** It is already the widest thing in that gate.

➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.8.2-LEDGER-STDERR-PUBLIC-LOG]`.** The `missing`-direction ledger read still puts the shared-TEST pooler host and user into a PUBLIC Actions log. It left this phase because it is one of THREE credential channels 164.8.2 produced and they must be swept together, not because it stopped being a shared-TEST problem.

⛔ **ROUTED HERE 2026-09-10, same review — `[164.8.2-VAC08-FATAL-ON-TRANSIENT]`: an unreadable ledger row count now reds the WHOLE VAC-08 gate, where it used to cost only the absurdity floor.**

This is a CONSEQUENCE of a fix that was correct and must NOT be reverted, recorded so that the next person to see VAC-08 flake looks in the right place. Before 164.8.2 the read was `… 2>/dev/null || echo ""` and an unreadable count silently disabled the absurdity floor — the control that tells a wrong join key from real drift, and whose absence sends a reader to hand-apply migrations to shared TEST. It is now three named MEASURE_FAILs that exit 1.

⚠️ **The exposure this creates.** A transient pooler blip on shared TEST that previously cost one control now fails the entire gate — on a gate that ALREADY contends for advisory key `61616158` with `apply-test` on every merge push (see `[164.8-PUSH-RACE-VAC08]` above; the two are the same root and should be planned together).

⛔ **The remedy is NEVER to restore the `|| echo ""`.** That is the defect, not the mitigation. If flakiness is measured rather than feared, the answer is a bounded retry around the read, or the per-run isolation this phase exists to build — both of which keep an unreadable input distinguishable from a clean one.

✅ **Why THIS phase.** It is the same advisory-key contention on the same shared database as `[164.8-PUSH-RACE-VAC08]`, and the durable fix for both is isolation rather than tolerance.

➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.8.2-REFUSAL-STILL-PUBLISHES]`.** The published-`.sql` scan refuses without withholding, so the flagged file ships anyway. Founder decision, cost on both sides; it sits with the rest of 164.8.2's artifact residue.

➡️ **MOVED 2026-09-10 to Phase 164.8.4 GATERESIDUE — `[164.8.2-REDACT-HOSTNAME-01]`.** A routing word that was never a routing record, over a psql-redaction gap that is still open. Swept with the other two credential channels.

⛔ **ROUTED HERE 2026-09-13, out of the PR #795 land-and-deploy — three shared-TEST findings measured while landing an unrelated one-line documentation fix.**

All three were found by RUNNING a merge, not by review, which is why they carry run ids rather than file references. Run `34763669052` at `e64b0811` needed THREE attempts to go green on identical code, and its first two failures had different signatures on different tests — `504 Gateway Timeout`, then `[Errno 104] Connection reset by peer`. The pool was NOT wedged (probed live: three 200s under a second), so this is not the 2026-08-05 mechanism and must not be triaged as it.

⚠️ **Why this matters beyond a flaky suite, and why it is booked rather than shrugged off.** The `python` failure cascaded — `sql-tests` SKIPPED on `needs: python`, the `frontend` aggregator went RED on that skip — and a red check-suite on `main`'s head made Railway SKIP the analytics deployment (`aa9accb8`). So a transient PostgREST blip against shared TEST silently withheld a production deploy. That coupling is NOT this phase's work (it has its own phase), but it is the reason these three are worth fixing rather than tolerating.

⛔ **Do not close criterion 11 with a re-run, criterion 12 by softening the warning, or criterion 13 by deleting tests.** Each of those is the tolerance-instead-of-isolation move this phase exists to replace.

**Depends on:** Phase 164.8 (its restore settles the schema and ledger this phase isolates against).
**Plans:** 11/11 plans executed

Plans:

- [x] 164.9-01-PLAN.md — wave 1 — Book the four backlog ids (`FANOUT-GLOBAL-01` + the three `164.9-*`) and correct the two drifted facts in `CLAUDE.md` (criterion 1)
- [x] 164.9-02-PLAN.md — wave 2 — TRACER: the dead-holder condition becomes a job-reddening verdict, falsified by killing a real holder on the disposable lane (criterion 12)
- [x] 164.9-03-PLAN.md — wave 2 — Measure the credentialed live-DB class as a credential-free static census gate, with a dated shrink-only ledger (criterion 13, first half)
- [x] 164.9-04-PLAN.md — wave 2 — Foreign-row calibration for the three cron-body-sweep gates, each armed and proven able to fail (criterion 2)
- [x] 164.9-05-PLAN.md — wave 2 — Python transport boundary: census the call sites, add a bounded retry observed to EXHAUST and to discriminate (criterion 11, Python half)
- [x] 164.9-06-PLAN.md — wave 3 — Two keys for two units + an explicit cross-workflow ordering wait + the bash bounded retry (criteria 3, 4, 11 bash half)
- [x] 164.9-07-PLAN.md — wave 2 — Restore gates: two-directional schema-scoped extension guard + the third refdata leg pinning column VALUES (criterion 7)
- [x] 164.9-08-PLAN.md — wave 4 — Repair the census findings and stand up the credentialed-test lane on the local stack, blocking in both aggregator places (criterion 13, second half)
- [x] 164.9-09-PLAN.md — wave 5 — `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`: an author-time refusal over the migration corpus — a mechanism, not a pragma (criterion 5)
- [x] 164.9-10-PLAN.md — wave 5 — `[164.8.1-TEST-ANALYTICS-URL-PROD]` closed by measuring the LIVE row, plus a TEST-only remediation that refuses everywhere else (criterion 6)
- [x] 164.9-11-PLAN.md — wave 6 — The single restore dispatch, its post-merge sequencing constraint surfaced as a founder decision, and the ledgers reconciled (criterion 8)

### 📜 Phase 164.10 (ORIGINAL ENTRY, superseded): BODYDRIFT — PROD runs an EARLIER revision of three function bodies than the migration chain renders (INSERTED)

**Goal:** ⚠️ **RE-SCOPE THIS GOAL BEFORE PLANNING — see the 2026-09-19 measurement below; the premise is narrower than written.** Close `DRIFT-06`. Three PROD function bodies do not match what the migration chain renders, and the shared "the dump is stale" diagnosis was FALSIFIED for them by the 2026-09-07 regeneration: their `snapshotHash` values did not move by a single bit. They are `check_fan_in_ready/1` (5 hunks), `reject_sentinel_writes/0` (9 hunks) and `retention_delete_guard/0` (2 hunks), retained as the last three rows of `CONTENT_DRIFT_ALLOWLIST` in `scripts/baseline-content-drift-check.mjs`.

⛔ **INSERTED 2026-09-08 by the same founder instruction as Phase 164.9.** `DRIFT-06` was booked in `TODOS.md` on 2026-09-07 and had no phase, no date and no gate for a full day while the milestone worked on its sibling `DRIFT-04`.

⛔ **MEASURED ON PROD 2026-09-19 — THE CAUSE IS SETTLED AND ONE BULLET BELOW IS WRONG. Read this
before planning anything.** Queried via the Supabase MCP against the project whose
`COMMENT ON DATABASE` marker reads `⛔ PRODUCTION — real customer data` (the marker query was run
first; `current_database()` returned `postgres`, which proves nothing, exactly as CLAUDE.md warns).
Read-only: `pg_get_functiondef` only, no write of any kind.

⭐ **THE CAUSE IS #2, and `git log` names it.** All THREE defining migrations
(`20260510180226`, `20260515113853`, `20260515114310`) entered the repository in a SINGLE commit,
`eaaed7e0` (2026-05-15): *"backfill audit-2026-05-07 schema + rename migrations to timestamp
convention"*. These files are a RECONSTRUCTION written after the functions already existed in PROD,
not the source that created them — and the reconstruction was written slightly richer than what it
described. That is why `retention_delete_guard`, with exactly one defining migration, can still
differ: PROD is not "behind" it, it was never applied from it.

⛔ **ALL THREE ARE BEHAVIOURALLY IDENTICAL. The heading below said "THIS IS NOT COSMETIC"; measurement
says it IS cosmetic**, and the correction matters because the repair this phase contemplates WRITES
PROD FUNCTION BODIES. Applying a migration to production to lengthen three error strings and add a
variable that is never read is real risk for zero behavioural gain.

| function | measured difference | behavioural? |
|---|---|---|
| `check_fan_in_ready` | repo declares `v_row_found`, assigns it, and **never reads it** | **NO** |
| `reject_sentinel_writes` | `RAISE` wording only; same predicate, same `invalid_parameter_value` | **NO** |
| `retention_delete_guard` | `RAISE` wording missing one clause; same `COUNT`, `> 100000`, `raise_exception`, `RETURN NULL` | **NO** |

⚠️ **The ONE real cost, stated so it is not lost:** PROD's messages are LESS informative than the
repo's, so an operator debugging a sentinel rejection or a retention abort sees less context. That is
DIAGNOSTICS, not data integrity — fix-or-drop under the founder's 2026-09-15 scoping rule, never a
blocking item.

⭐ **RECOMMENDED RESOLUTION — reconcile in the REPO direction, not the PROD direction.** The files are
already a reconstruction; making them match what actually ran costs nothing, needs no PROD write, and
makes the chain truthful. Then record these three as MEASURED-BENIGN in VAC-04's allowlist with this
measurement beside them. ⛔ Do NOT delete the allowlist rows (the fence below still stands) and do NOT
silence VAC-04 — the detector worked; what it found is benign, which is a different thing.

📜 **THE ORIGINAL THREE-WAY SPLIT, kept as lineage. The first bullet is FALSIFIED; the other two hold:**

- ⛔ ~~**`check_fan_in_ready` is EXECUTABLE drift** — the chain declares `v_row_found BOOLEAN` and SELECTs `true` into it to distinguish "no parent row" from "a parent row of NULLs". PROD has neither. Behaviour differs.~~ **FALSIFIED 2026-09-19.** The chain does declare it and PROD does not — that half is true. But `v_row_found` is **written and never read**: the very next statement branches on `IF NOT FOUND`, plpgsql's BUILT-IN, not on `v_row_found`, and no later line references it. The "no parent row vs a parent row of NULLs" distinction is made by `FOUND` and by the separate `IF v_parent_ids IS NULL` guard, both of which PROD has, identically. It is a vestigial variable, not a behaviour. ⭐ A dead local is exactly the shape that reads as executable drift from a text diff and is not — which is the argument for measuring bodies rather than diffing them.
- **`reject_sentinel_writes` is MESSAGE TEXT only.** The guard logic — which sentinel values are refused, on which three tables — is identical on both sides; PROD carries the shorter 2026-05-13 `RAISE` wording.
- ⭐ **`retention_delete_guard` is the specimen that rules out the innocent explanation.** EXACTLY ONE migration in this repository defines it (`20260515113853_retention_crons_safe`), so there is no later revision for PROD to be behind — yet PROD's `RAISE` omits a clause that single defining migration contains. **A live catalogue cannot lag a migration it is the only definition of.**

⛔ **TWO CANDIDATE CAUSES, NOT DISTINGUISHABLE FROM A READ-ONLY DUMP, and neither may be assumed:** either those migrations never reached PROD, or their FILES were retro-edited after being applied. `retention_delete_guard` can only be the second. ⭐ **Settle it by reading, not dating:** PROD's `supabase_migrations.schema_migrations.statements[]` stores the APPLIED SQL text — argue from what a stored statement CONTAINS versus what the repo file contains. Some rows are partial or stubbed, so argue per row from its own `CREATE` head.

⚠️ **The three allowlist rows must NOT be deleted to make the gate green**, and a further baseline regeneration will never clear them — their own `reason`/`clearedBy` text says so and names this entry.

⛔ **THE THREE-REVIEWER RULE APPLIES IN FULL.** Any repair writes PROD function bodies, so it goes through `migration-reviewer` + `rls-policy-auditor` + `silent-failure-hunter`, findings fixed, BEFORE asking to apply. This is why it is its own phase rather than an item inside Phase 164.6 GATE-HYGIENE — that phase's other twelve items are lint rules and comment corrections, and folding production DDL in would give the riskiest item the lightest review posture.

**Requirements**: TBD (no v1.20 requirement IDs) + TODOS entry `DRIFT-06` — read it before planning, do not re-derive.
**Depends on:** nothing outstanding. ⚠️ Ordering is DELIBERATE: queued after 164.9 because the milestone's gate work should be finished before another PROD apply is attempted.
⛔ **CORRECTED 2026-09-09.** This sentence claimed 164.10 was "the only remaining 164.x item that writes PRODUCTION". It is not: **Phase 164.5.1 CRONREPOINT also writes PROD**, and on a more sensitive surface — production DDL on `cron.job` jobid 1, which carries `decrypted_secrets` and whose own success criterion 5 already demands three reviewers before any apply. The ordering principle is unchanged and now applies to BOTH: gate work (164.9) precedes every remaining PROD apply, not just this one.
**Plans:** 0 plans

Plans:

### Phase 164.9.1: JOBRPCTRUTH — the compute-job RPC surface does what its own comments say (INSERTED)

**Goal:** The compute-job RPC surface does what its own comments and migrations say it does — a fan-in job actually reaches the fan-in state, and an in-flight collision is distinguishable from a fresh enqueue.

⛔ **A CONFIRMED PRODUCTION DEFECT, DATA INTEGRITY. Verified by the orchestrator at HEAD 2026-09-21, not merely reported by an agent.**
`enqueue_compute_job` routes all three modes to the **TEN-ARG** `_enqueue_compute_job_internal`. That function's `INSERT` names `strategy_id, portfolio_id, allocator_id, api_key_id, kind, parent_job_ids, idempotency_key, exchange, metadata, next_attempt_at` — **`status` is not among them**, so the row takes the column DEFAULT `'pending'`. Only the **SEVEN-ARG** overload carries migration 109's `done_pending_children` branch, and nothing reaches it.
⭐ **CONSEQUENCE: a job enqueued through the public wrapper with `parent_job_ids` NEVER ENTERS THE FAN-IN STATE IN PRODUCTION.**
⭐ **The ten-param migration's OWN COMMENT says the function "computes the status ('done_pending_children' when p_parent_job_ids is non-empty) and INSERTs it."** The code does not. Every other live mention of that status in the file is a read predicate (`status IN (...)`), never a write. The documentation and the behaviour disagree, and the documentation is the one that is right about the intent.

⚠️ **WHY IT SURVIVED THIS LONG, which is the part worth designing against.** It is invisible to a static census BY CONSTRUCTION — a missing column in an `INSERT`, inside one of two same-named overloads — and it was masked by an error raised earlier in the same call. It survived a green suite, `mypy --strict` and a purpose-built fixture-drift census. It was found only when Phase 164.9's live-DB lane enqueued a LIVE kind and execution reached the statement. ⛔ A fix proven by reading is not proven.

## ⛔ SECOND ITEM, SAME SURFACE — `[164.9-LIVEDB-RESIDUE-RPC-AND-INTENT]`
1. **The `already_inflight` branch is UNREACHABLE.** `_enqueue_compute_job_internal` RETURNS the existing in-flight id instead of raising `unique_violation`, so a caller cannot tell a collision from a fresh enqueue. That is an RPC change, not a test change. ⛔ Do NOT close it by teaching the test to accept the current return.
2. **An INTENT question, not fixture drift.** `match-decisions-xor-rls` asserts `bridge_outcomes_unique_per_strategy_holding`, which migration **081 replaced** with a per-decision key — the catalogue's own `COMMENT` says so. The phase must decide what the arm should assert under the CURRENT invariant. ⛔ Deleting the assertion is not an answer.

## ⛔ FOLDED IN 2026-09-21 — `[164.9-TEST-ANALYTICS-URL-REARM]`
Phase 164.9 plan 10 normalised shared TEST's `analytics_service_url` row to a loopback discard sink — run by the founder 2026-09-21, confirmed on two independent connections (shape: 54 chars `https` -> 18 chars `http`, sink true). ⛔ **NOTHING RE-ARMS IT.** A future restore rebuilds `public` from the baseline and the row silently returns to whatever the migration seeds, after which a tick on that database POSTs the Vault-held service key to a real host again. The recorded remedy is a post-restore step in `test-restore-from-baseline.yml`.
⚠️ **This was briefly booked as its own phase (RESTOREFIDELITY) and that was over-booking** — it is one step in a workflow, not a phase. Folded here by founder decision, against the standing rule that only a data-integrity or user-facing item earns a phase.
⚠️ Its sibling, `[164.9-BASELINE-PRIVILEGES-ABSENT]`, was deliberately NOT folded in and is NOT a phase: it is CI fidelity on TEST, invisible to any user, and its 15 failures are already held honestly by the live-DB lane's shrink-only execution ledger. ⛔ Do not promote it to a phase without a new argument.

## Success Criteria
1. ⭐ **THE HARM IS PROVEN OR THE PHASE SHRINKS.** Before any fix, enqueue a job through the public wrapper WITH `parent_job_ids` against a real database and observe what actually happens to the parent. The DEFECT is confirmed (the `INSERT` omits `status`; the migration's own comment says it must not); the HARM — a parent claimed and run before its children finish — is INFERRED and has not been observed. ⛔ If no harm is observable, this drops to fix-or-drop and stops being a phase. Do not skip this to get to the fix.
2. **A job enqueued through the public wrapper with `parent_job_ids` lands in the fan-in state**, proven by EXECUTION against a real database in the live-DB lane — not by reading the migration.
3. **The two overloads agree, or one of them stops existing.** ⚠️ Name them BY SYMBOL AND ARITY; a fix that edits the wrong arity changes nothing and reads as done.
4. **An in-flight collision is distinguishable from a fresh enqueue** at the caller.
5. **The migration-081 invariant question is answered in writing** and the arm asserts the current invariant.
6. ⭐ **A regression gate that would have caught this**, living where the defect was found — the live-DB lane — and calibrated by neutering it and watching it go red.

## ⛔ Constraints
- ⛔ **This phase AUTHORS MIGRATIONS. THREE REVIEWERS BEFORE ANY APPLY:** `migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter`.
- ⛔ **Re-base before `CREATE OR REPLACE`** — grep ALL of `supabase/migrations/**` and re-base on the LATEST definition.
- ⛔ **Never a data-reading `RAISE EXCEPTION` in a migration** (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`): TEST holds PROD's CATALOGUE and never its DATA, so such a migration applies to PROD and REFUSES on TEST, and a refused TEST apply BLOCKS the PROD apply. Self-verify must be CATALOG-ONLY. ⚠️ Phase 164.9 shipped a linter that refuses this shape at author time — conform to it, do not exempt yourself from it.
- ⛔ `cron.schedule(...)` is a LIVE OP, never in a migration.
- ⛔ This checkout's Supabase CLI is linked to PRODUCTION — the disposable pg-lane and the local stack are the only permitted DB paths.

**Requirements**: `[164.9-FANIN-STATUS-NEVER-SET]` (`TODOS.md`, `## FIX NOW`), `[164.9-LIVEDB-RESIDUE-RPC-AND-INTENT]`, `[164.9-TEST-ANALYTICS-URL-REARM]`
**Depends on:** Phase 164.9
⭐ **Founder decision 2026-09-24 (AskUserQuestion): D-23 "Restore it"** — migration 075's `api_key_disconnected` refusal (409) is restored. FC-3's blocker (the baseline re-dump) cleared with v0.90.0.1 (#855).
**Amended 2026-09-25 (review round 1):** D-04 now departs from strict seven-arg parity: M1 refuses a NULL/missing/failed parent (22023) and starts a child `pending` when its parents are all done (164.9.1-CONTEXT D-04). The normalize self-test runs in the dispatch-only restore job, not on PRs — accepted: that job runs it before every live restore, which is where it guards. A ci.yml PR job for it needs PostgreSQL server binaries and is not in this phase.
**Plans:** 14 plans (10 waves; planned 2026-09-24, plan-checker passed after 3 revision rounds, 1 info advisory open)

Plans:

⚠️ 164.4.2 pins (ledger counts, lane image, job names, mutex-key counts) are re-measured by whichever of 164.4.2 / 164.9.1 merges second; 164.4.2 is already on `main` as #842, so plan 01 re-measures them after bringing `main` in.

- [ ] 164.9.1-01-PLAN.md — wave 1 — bring `main` (incl. 164.4.2) in, re-measure pins, record the pre-fix harm verdict on the local lane (criterion 1)
- [ ] 164.9.1-02-PLAN.md — wave 2 — tracer: M1 (ten-arg `_enqueue_compute_job_internal` computes and inserts the initial status), P12 green by execution (criteria 2, 3)
- [ ] 164.9.1-03-PLAN.md — wave 3 — P12 calibrated neuter -> RED -> restore; dedupe-gate twins re-pointed (criterion 6)
- [ ] 164.9.1-04-PLAN.md — wave 2 — single-sourced analytics-URL normalisation emitter (REARM)
- [ ] 164.9.1-05-PLAN.md — wave 3 — restore transaction concatenates the emitter output, identical in both modes (REARM)
- [ ] 164.9.1-06-PLAN.md — wave 4 — restore static pins re-measured (REARM)
- [ ] 164.9.1-07-PLAN.md — wave 4 — M2: `request_allocator_holdings_sync` regains 067's in-flight prefetch and 075's disconnected refusal (criterion 4)
- [ ] 164.9.1-08-PLAN.md — wave 5 — sync route maps the disconnected refusal to 409 (D-23)
- [ ] 164.9.1-09-PLAN.md — wave 5 — M3 catalog comments + XOR arm asserts the current bridge_outcomes invariant (criterion 5)
- [ ] 164.9.1-10-PLAN.md — wave 6 — live-DB ledger shrinks by three, ceiling lowered in the same commit; whole-phase gate sweep
- [ ] 164.9.1-11-PLAN.md — wave 7 — three-reviewer gate round 1 (orchestrator dispatches; not autonomous)
- [ ] 164.9.1-12-PLAN.md — wave 8 — three-reviewer gate round 2 + gate re-run (not autonomous)
- [ ] 164.9.1-13-PLAN.md — wave 9 — ⛔ FOUNDER CHECKPOINT FC-2 (merge order) + re-sync onto `main`
- [ ] 164.9.1-14-PLAN.md — wave 10 — release record; ⛔ FOUNDER CHECKPOINTS FC-1 (merge = auto-apply TEST then PROD) and FC-3 (live restore dispatch, not a completion gate)

### Phase 164.9.2: REFDATAUPDATES — the shared-TEST restore replay also replays migration UPDATEs on the public tables it just filled, so rebuilt reference rows match PROD (INSERTED)

**Goal:** A shared-TEST restore rebuilds its reference rows in the state PROD holds them. The reference-data replay also replays a migration's top-level `UPDATE` when it targets a `public` table the replay has just filled. Those tables are empty after `DROP SCHEMA public CASCADE`, so such an UPDATE can reach only rows the replay itself wrote, never anyone's live data.
**Requirements**: TODOS `[164.8.1-REPLAY-INSERT-ONLY-SCOPE]` (owned here); unblocks Phase 164.9 criterion 8 (`[164.9-CRIT8-RESTORE-DISPATCH-RECORD]`).
**Depends on:** Phase 164.9
**Plans:** 5 plans

⭐ **Founder decision, 2026-09-24 (AskUserQuestion): "Yes, new phase".**

**Evidence.** `test-restore-from-baseline.yml` preflight run `36003106273` (2026-09-24, `main` at `71697364`) is the first run to execute the replay on shared TEST. It replayed 23 statements into 8 tables, passed the empty and short-count checks, then aborted on Phase 164.9 plan 07's wrong-state check (`v_wrong_state` in `scripts/restore-test-from-baseline.sh`): the sentinel profile's `manager_status` came back at the column default instead of `verified`. The replay (`scripts/extract-reference-inserts.mjs`, criteria C1–C4 in `scripts/restore-test-refdata-allowlist.txt`) emits only literal INSERTs, so the later `manager_status` UPDATE in `20260521150000_universal_signup_approval_gate.sql` never runs. Plan 07 added the check without closing the gap, so criteria 7 and 8 of Phase 164.9 contradict each other until this phase lands. The preflight rolled back, and TEST is unchanged.

## Success Criteria
1. A new, separately pinned extractor class for top-level `UPDATE`s whose target is a `public` table already in the replay; never `auth.*`. It gets its own criterion id, pinned counts, an audit census, and red+green self-test arms.
2. Replayed statements interleave in migration filename order, inside the same transaction as the INSERTs.
3. ⛔ The wrong-state check and its `verified` default stay exactly as they are: no waiver, no relaxed default, no widened allowlist.
4. A green `mode=preflight` run, then a green `mode=restore` run on shared TEST, both recorded by run id. That closes Phase 164.9 criterion 8.
   ⭐ **RECORDED 2026-09-26 — criterion 4 MET on shared TEST.** Both committing dispatches were made by the founder with the confirm token.
   - preflight run `36235362126` at `06cbe2030`: **success**, restore self-test 41/41 arms, marker names TEST.
   - restore attempt run `36237060668`: **refused by the activity gate** (2 non-idle sessions besides the holder); nothing was written.
   - restore run `36242946174` at `ea4167a3f`: **success**, marker names TEST, activity gate quiet (holder only, idle x16). It printed the C5 replay (6 UPDATE statements replayed in migration filename order inside the transaction), a post-census equal to the dump's expected shape, and `restore: tables=63 policies=155 functions=121 ledger_rows=277 survivors=2/2 filtered=1 mode=restore`.
   The summary line is printed only after `check_extension_guard` and the ownership-list comparison pass (`restore_mode` in `scripts/restore-test-from-baseline.sh`), and the value-pinning leg runs inside the transaction that committed. Phase 164.9 criterion 8 and `TODOS.md` `[164.9-CRIT8-RESTORE-DISPATCH-RECORD]` are closed by this record.

**Rejected:** hand-seeding the value after the replay (hand-seeding shared TEST is forbidden); editing the applied teaser migration (PROD's ledger stores the SQL that ran).

Plans:

- [ ] TBD (run /gsd-plan-phase 164.9.2 to break down)

### Phase 164.9.3: CLAIMPAIR — a due failed_retry job and a pending twin of the same (kind, allocator) never wedge the compute-job claim (INSERTED)

**Goal:** A due failed_retry job and a pending twin of the same (kind, allocator) never wedge the compute-job claim.
**Requirements**: TODOS `[164.9.3-CLAIM-PAIR-23505]` (owned here)
**Depends on:** Phase 164.9.1
**Plans:** 0 plans

⭐ **Inserted 2026-09-26 by orchestrator decision** (routed from the Phase 167.1.2 PR B review). It is a separate topic from 164.9.1 JOBRPCTRUTH and 164.9.2 REFDATAUPDATES.

**Evidence, measured 2026-09-26 on the pg-lane by the 167.1.2 PR B fixer.**
- **Repro:** seed a `failed_retry` `derive_allocator_equity` row whose `next_attempt_at` is in the past, plus a `pending` row for the same allocator. All three claim entry points then raise `23505` on `compute_jobs_one_inflight_per_kind_allocator`:
  - `claim_compute_jobs_with_priority`, 6-arg overload;
  - `claim_compute_jobs_with_priority`, 2-arg overload;
  - `claim_compute_jobs`.
- **The claim guard:** C39 skips a candidate only when a `running` or `done_pending_children` sibling exists, not when a `pending` one does.
- **The enqueue side:** `_enqueue_compute_job_internal`'s dedup and that unique index both cover `pending`, `running` and `done_pending_children`, but not `failed_retry`. So any enqueue made while a retry is outstanding creates the pairing.
- **Class:** this is the 2026-04-28 worker-spin class.
- **Latent, not observed live.** Sentry shows 0 matching issues over 90 days and 0 matching logs over 30 days.
- **Not fixed by 167.1.2.** PR B's new owner RPC is being fixed so that it never creates the pairing (it reuses the failed_retry job). That closes one caller, not the class. The root fix belongs here.

## Success Criteria
1. A red-first lane test reproduces the `23505` on the pre-fix tree and goes green after the fix.
2. The claim never raises on that pairing. Either the enqueue refuses the pending twin or folds it into the `failed_retry` job, or the claim skips it. The planner decides which, with evidence.
3. The fix ships as a migration, reviewed before merge by the three migration reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter), because merging a migration auto-applies it to PROD.
4. *(added 2026-09-26 with the scope merge below)* The fix covers every partition the claim guard protects, not only the allocator one: `api_key_id`, portfolio, strategy and allocator, each against its sibling `compute_jobs_one_inflight_per_kind_*` index, in BOTH claim RPCs. Each partition gets its own red-first lane arm.

⭐ **SCOPE MERGED 2026-09-26 by founder decision (AskUserQuestion, "Re-route, don't start"):** item (4) of Phase 164.5.2's routed list moves here. It is the same defect on a different partition, found independently on 2026-09-25 by the 164.9.1 pre-push silent-failure-hunter.
- **The pairing:** one `failed_retry` plus one `pending` job for the same `(kind, api_key_id)`. A `poll_allocator_positions` `failed_retry` with `next_attempt_at` 10 minutes in the past, beside a `pending` twin due 10 minutes in the future.
- **The result:** `claim_compute_jobs` and `claim_compute_jobs_with_priority` both raise 23505 on `compute_jobs_one_inflight_per_kind_api_key`. The batch `UPDATE ... SET status = 'running'` is ONE statement, so no job of ANY kind is claimed until the pair clears. Loud, not silent.
- **Measured:** 2026-09-25 on the local-stack lane at the 164.9.1 release head, in one transaction ending in `ROLLBACK`. The full repro recipe is kept verbatim as lineage in Phase 164.5.2's section and in `TODOS.md` `[164.9.3-CLAIM-PAIR-23505]`.
- **Fix options recorded there, not decided:** (a) add `'pending'` to each guard's `x.status` list with `x.id <> ranked.id`; (b) fold the enqueue into, or supersede, the outstanding `failed_retry`. Criterion 2 above already leaves that choice to the planner.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.9.3 to break down)

### Phase 164.9.3.1: FANINGRAPH — a fan-in child never strands when its parent fails, a match_decisions delete never raises 23505 through its cascade, and a fan-in diamond never deadlocks on the parent lock (INSERTED)

**Goal:** The compute-job fan-in graph and the bridge's decision cascade never strand a job, raise a spurious 23505, or deadlock: a fan-in child whose parent fails reaches a terminal state, a `match_decisions` delete cascades without a unique violation, and a fan-in diamond cannot deadlock on the parent lock.
**Requirements**: TODOS `[164.9.3.1-FANIN-GRAPH-RESIDUALS]` (owned here)
**Depends on:** Phase 164.9.3 (the same compute-job RPC surface; CLAIMPAIR's migration re-bases `_enqueue_compute_job_internal` and the claim RPCs first, and this phase re-bases on it)
**Plans:** 0 plans

⛔ **BOOKED 2026-09-26 UNDER THE NEW-PHASE FREEZE — NOT STARTED.** Founder decision (AskUserQuestion, "Re-route, don't start"): items (1), (2) and (3) of Phase 164.5.2's routed list leave 164.5.2 and land here. This phase gets no discuss, plan or execute step until the founder lifts the freeze for it.

**Evidence.** Routed on 2026-09-25 from the Phase 164.9.1 review round 1. Items (1) and (3) are recorded in the header of M1, `20260924230827_fanin_initial_status_10param.sql`. All three are latent or loud, none silent:
- (1) and (3) are latent because no caller passes `parent_job_ids` today.
- (2) is pre-existing and fails loudly. The admin decisions route issues these deletes.

## Success Criteria

1. **The stranded child.** A fan-in child whose parent is still open at enqueue and later ends `failed_final` no longer stays in `done_pending_children` forever. It reaches a terminal state that names the failed parent. A red-first lane test reproduces the strand on the pre-fix tree and goes green after the fix.
2. **The cascade 23505.** A second `match_decisions` delete no longer raises 23505 through the `ON DELETE SET NULL` cascade onto `bridge_outcomes_legacy_per_strategy_holding_when_md_null`. A red-first lane test reproduces it on the pre-fix tree. ⛔ Dropping or narrowing the index to silence the error is not a fix unless the planner shows the invariant it enforces no longer holds.
3. **The diamond deadlock.** A diamond, meaning a child whose parents include another waiting child, cannot deadlock (40P01) between the fan-in parent lock `FOR SHARE ... ORDER BY id` and `mark_compute_job_done`. The alternative, if the planner shows the deadlock is inherent, is that every caller passing parents retries 40P01 on both the enqueue and the worker's mark path. Proven with two genuinely separate sessions; ⛔ a single-client `Promise.all` cannot race.

⛔ **Constraints:** every fix here is a migration, so the three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) review it before merge, because a merge auto-applies to PROD. Re-base each `CREATE OR REPLACE` on the LATEST definition, found by a grep of all `supabase/migrations/**`.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.9.3.1 to break down)

### Phase 164.9.4: CIOFFMUTEX — `python` and `e2e-seeded` no longer queue on the shared-TEST advisory lock; each runs against a database private to its runner (INSERTED)

**Goal:** `python` and `e2e-seeded` no longer queue on the shared-TEST advisory lock; each runs against a database private to its runner.
**Requirements**: TODOS `[164.9.4-CI-MUTEX-QUEUE]` (owned here)
**Depends on:** Phase 164.9.1
**Plans:** 0 plans

⭐ **Founder decision, 2026-09-26 (AskUserQuestion).**

**Evidence, measured 2026-09-26 on CI run `36229959820` (PR #864, 52 min wall clock).**

| Job | Total | Waiting on the mutex | Actual work |
|---|---|---|---|
| `python` | 50 min | 36 min in "Acquire shared-test-db mutex" | 13 min of pytest |
| `e2e-seeded` | 36 min | 28 min | 5 min of specs |
| every other job | 12 min or less | — | — |

The wait grows with the number of open PRs, because every one of them contends for the same key.

**Precedents:**
- Phase 164.4.2 moved `sql-tests` to `scripts/local-stack/run.sh`.
- Phase 164.4.2.1 took `test-db-drift` off the key.

## Success Criteria
1. Neither job acquires advisory key `61616158`.
2. Each job boots its own local-stack or pg-lane database, behind a loopback-DSN guard.
3. Coverage and test counts do not drop: no skipped test, and no lowered `--cov-fail-under`.
4. A measured CI run records the new wall clock.
5. Any test that genuinely needs shared TEST is named, stays on the key, and states why.

Plans:

- [ ] TBD (run /gsd-plan-phase 164.9.4 to break down)

### Phase 164.9.5: AUTOREDUMP — after a migration applies to PROD, the committed baseline is re-dumped and proposed automatically (INSERTED)

**Goal:** After a migration applies to PROD, the committed baseline is re-dumped and proposed automatically, so main never sits red on baseline-content-drift waiting for a manual dump.
**Requirements**: TODOS `[164.9.5-MANUAL-BASELINE-REDUMP]` (owned here)
**Depends on:** Phase 164.9.1
**Plans:** 1/9 plans executed

⭐ **Founder decision, 2026-09-26 (AskUserQuestion).**

**Evidence, 2026-09-26.**
- **The manual step:** PR #864 needed a founder-run `supabase db dump --linked`.
- **The cost:** main was red on `sql-gate-lint` from the Phase 164.9.1 PROD apply (run `36221903717`) until that dump landed, and Railway skips deploys while main is red.
- **The procedure being automated:** `supabase/schema/BASELINE.md`, section "## Regenerating".

⛔ **Security-sensitive workflow.** It reads PROD's schema with a repository secret and opens PRs on a PUBLIC repo. The plans must include a security review (`/gsd-secure-phase` or equivalent) before merge.

## Success Criteria
1. **Trigger and dump:** a workflow runs after `supabase-migrate.yml`'s PROD `apply` job succeeds, and takes a read-only schema dump with the existing repository secret. No agent enters a new credential.
2. **Scan and refuse:** it runs the five-class secret scan and gitleaks, and refuses to open a PR on any hit.
3. **Carried-migrations marker:** it regenerates `supabase/schema/baseline-carried-migrations.txt` from the tree of the merge that was applied.
4. **Currency checks:** it runs `scripts/local-stack/run.sh --check-currency` and baseline-content-drift.
5. **The PR:** it opens a PR carrying the VERSION bump, the CHANGELOG entry and the BASELINE.md provenance. It never auto-merges.
6. **Credential handling:** the dump credential is never echoed, the workflow has least-privilege `permissions:`, and it is ref-guarded to `main`.

Plans:

**Wave 1**

- [x] 164.9.5-01-PLAN.md — wave 1: base sync onto #864 (D-29), then the thin end-to-end tracer: `scripts/baseline-redump.mjs` with its frozen CLI, one dump through `--gate-dump` and `--compose` to six staged paths and a bot commit

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 164.9.5-02-PLAN.md — wave 2: gate-side refusals (five-class scan with counts and lines only, gitleaks with the empty-file trap closed, integrity, shape counts, MERGE-tree marker, D-10 no-op)
- [ ] 164.9.5-04-PLAN.md — wave 2: the `redump-dump` and `redump-pr` jobs in `supabase-migrate.yml`, ghcr roster, softening scan

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 164.9.5-07-PLAN.md — wave 3: writer refusals, the `## Provenance`-scoped BASELINE.md writer on the real file, the D-16 CHANGELOG and `### Regenerated` composers and the D-23 PR body
- [ ] 164.9.5-09-PLAN.md — wave 3: the calibrated wiring test for both jobs

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 164.9.5-03-PLAN.md — wave 4: compose-side refusals (child-gate line judges, staged set, skip-token guard) and the real-file `--compose` run after the last refusal

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 164.9.5-08-PLAN.md — wave 5: `--check-bot-branch` naming the open PR token-free (D-24), the D-10 no-op notice naming an open bot PR, `--open-or-edit-pr`

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 164.9.5-05-PLAN.md — wave 6: `BASELINE.md` `## Regenerating` automation paragraph, TODOS closure, post-merge human-verification items

**Wave 7** *(blocked on Wave 6 completion)*

- [ ] 164.9.5-06-PLAN.md — wave 7: pre-merge security review (actionlint, injection checklist, threat map for `/gsd-secure-phase`, optional zizmor behind a human checkpoint)

### Phase 166: QSTATS-TRUTH — every quantstats-derived number reflects the returns it was given

⭐ **Founder answers, 2026-09-24:** D-15, D-16 and D-17 are APPROVED. OPEN-2: after merge, run plan 10's read-only census, then queue a recompute of the affected PROD rows.

**Goal:** No metric persisted to `metrics_json` or rendered in a chart is the output of quantstats'
price-detection heuristic misreading a return series as prices. RANK-05 (Phase 159) closed that
heuristic in `compute_all_metrics` only; this phase closes the rest of the surface and settles
whether the library stays.

**Depends on:** Phase 164.6 (ordering only — no code dependency). ⭐ RE-ORDERED 2026-09-05: this phase now runs BEFORE 165, restoring 165's own "dependency churn lands last, never before" invariant that appending 166 after it had broken. ⚠️ **RESEARCH-FIRST phase:** the
shape of the work is not decidable from the codebase alone (see criterion 1), so `/gsd-plan-phase 166`
must run its research step, and the discuss step must not be skipped.

**Why this is a phase and not a TODO.** ⚠️ **Not hypothetical — measured.** `.planning/WINDOWS.md`
entries 5 and 9 (both `open`) record wrong values already persisted: on the phase's own trigger
fixture, a 60-day all-winning series whose `max_drawdown` correctly reads `0.0` wrote
`ulcer_index=0.9947`, `common_sense_ratio=0.0`, `recovery_factor=2.0737`, `upi=2.9999`,
`serenity_index=0.3204` into the same `metrics_json` Phase 159 was guarding. The residual is live in
three places:

- `compute_qstats_scalars` — 8 scalars (`analytics-service/services/metrics.py:1771`), dispatched
  through `getattr(qs.stats, qs_attr)` at `:1826`;
- `_rolling_alpha_beta`'s `rolling_greeks` call (`:2071`) — which **feeds rendered chart series**,
  so this one reaches the user's eyes, not just the row;
- the greeks benchmark leg.

Four of the eight (`ulcer_index`, `ulcer_performance_index`, `probabilistic_ratio`, `serenity_index`)
reach `_prepare_prices` **transitively** via `to_drawdown_series` and **cannot** be closed with
`prepare_returns=False`. Measured at HEAD 2026-09-03: 30 `qs.stats.*` call sites in `metrics.py`,
only 8 carrying a `prepare_returns=False` closure; quantstats is pinned at `0.0.81`.

⛔ **The gate that should catch this is blind to it.** The RANK-05 region gate matches LINES, so it
cannot see the `getattr(qs.stats, attr)` dispatch at `:1826` nor `_rolling_alpha_beta` at all — it
reports clean over the exact surface that is still open. That is a Phase 164.3-class vacuity: a
control that cannot fail. Fixing the metrics without fixing the gate leaves the next regression
equally invisible.

**Thesis inherited from Phase 162 (HONEST):** every number a user sees reflects the data underneath
it. A wrong Sharpe is not an error surface — it is a confident lie, which is why 164.2 (error copy)
is the wrong home for it.

**Success Criteria** (what must be TRUE):

1. **The upgrade-vs-mirror decision is made on evidence, not assumption.** Research establishes
   whether `0.0.81` is still current, whether a maintained fork exists, and whether any newer release
   fixes `_utils._prepare_returns`' price detection — and the phase picks its shape from that answer.
   Hand-writing inline mirrors for the transitive four is a fallback, not the default.
2. **Every one of the 30 `qs.stats.*` call sites is either closed or recorded as out of scope with a
   reason** — the same printed-exclusion discipline Phase 164.4 established. A silent omission fails
   this criterion exactly as a wrong value does.
3. **The region gate AST-walks `qs.stats.*` calls** instead of matching lines, sees the `getattr`
   dispatch shape and `_rolling_alpha_beta`, and is PROVEN able to fail: reintroduce an unclosed call
   site, observe the gate go RED naming it, restore.
4. **The measured wrong values are shown to be gone on the same fixture that produced them.**
   The 60-day all-winning series with `max_drawdown == 0.0` yields defensible values for all five
   named scalars — asserted against economic invariants, never against the implementation's own output.
5. **No metric silently changes without being recorded.** Any persisted value this phase corrects is
   named in the SUMMARY with its before and after, since these numbers are already in users' rows.

**Requirements**: TBD — set at planning time from research. Carries `[159-SIMPLIFY-DEFER]` (TODOS 0f):
extract `_downside_rms` / `_annualized_vol_sharpe` as module-level primitives BEFORE a third
hand-copy is added, and derive `PERCENTILE_ANALYTICS_COLUMNS` + csv-finalize's
`CLOCK_SAFETY_KPI_COLUMNS` from one exported KPI array. TODOS 0f explicitly says to do this extraction
as part of the scalars closure, not before.

**Plans:** 10 plans (planned 2026-09-24; decisions in `166-CONTEXT.md` D-01…D-19)

Plans:

**Wave 1**
- [ ] 166-01-PLAN.md — D-04: extract the shared money-math primitives from `compute_all_metrics`, byte-neutral (zero golden movement)
- [ ] 166-02-PLAN.md — D-12/D-18: byte-pin, then derive `PERCENTILE_ANALYTICS_COLUMNS` and `CLOCK_SAFETY_KPI_COLUMNS` from `PERCENTILE_METRICS` (TS, file-disjoint from 01)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 166-03-PLAN.md — drawdown-family scalar mirrors (recovery_factor, ulcer_index, ulcer_performance_index, serenity_index) and the dispatch table retyped off `getattr(qs.stats, …)`

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 166-04-PLAN.md — kelly_criterion, probabilistic_ratio, common_sense_ratio, cpc_index mirrors; D-16 PSR kurtosis fix (golden PSR moves, disclosed)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 166-05-PLAN.md — r_squared and scalar greeks on the benchmark leg (D-05); D-15 NaN-greeks: complete pairs, None never 0.0

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 166-06-PLAN.md — rolling greeks on both legs (D-06); D-17 windowed rolling alpha (golden rolling_alpha moves, disclosed)

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 166-07-PLAN.md — D-14 AST gate over every production quantstats importer, printed census; the line gate deleted

**Wave 7** *(blocked on Wave 6 completion)*
- [ ] 166-08-PLAN.md — per-shape red/green needles, behavioural kwarg pins with calibration rows, neuter drills on the real module

**Wave 8** *(blocked on Wave 7 completion)*
- [ ] 166-09-PLAN.md — D-10 measured before/after table, D-11 read-only census SQL, closes WINDOWS 5 and 9 and TODOS 0f

**Wave 9** *(blocked on Wave 8 completion)*
- [ ] 166-10-PLAN.md — full gate sweep, the one release commit, OPEN-2 recorded as a founder `checkpoint:decision` (no production write)

**Cross-cutting constraints:**

- the SUMMARY passed the planning-hygiene check while staged, before it was committed

### Phase 166.1: QSTATSRECOMPUTE — PROD rows computed before Phase 166 are recomputed, and the last exact-zero dispersion guards go (INSERTED)

**Goal:** Every persisted `strategy_analytics` row that Phase 166 changes is recomputed on PROD, so stored numbers match what the fixed code would produce. The same fabricated-ratio class is also closed outside quantstats: exact `== 0` / `> 0` standard-deviation guards.
**Requirements**: Phase 166 OPEN-2 (founder answer 2026-09-24: "Recompute affected rows after merge", AskUserQuestion). The round-2 fixer measured the non-quantstats sites.
**Depends on:** Phase 166
**Plans:** 0 plans

## Success Criteria
1. **Census first.** The five read-only census SELECTs in `166-09-SUMMARY.md` run on PROD. The founder runs them, or they run read-only and are recorded as counts only. The recompute set is derived from them.
2. **Normal job path.** Affected rows are recomputed through the normal compute-job path, never by a hand-written UPDATE. Each is verified against the D-10 before/after rows, and the rendered rolling alpha/beta chart and greeks table show the new values.
3. **Exact-zero guards close.** They exist today in `portfolio_optimizer.py`, `csv_validator.py`, `allocated_capital.py`, `equity_reconstruction.py` and `optimizer.py`. They move to the relative dispersion floor (`_dispersion_is_residue` semantics), and each gets a red test built from a compounding-NAV constant yield.

Plans:

- [ ] TBD (run /gsd-plan-phase 166.1 to break down)

### Phase 167: CREDTRUST — an invalid venue credential is named to the customer as the reason their factsheet stopped updating, instead of going quietly stale behind a transient-sounding error

**Goal:** A customer whose venue credentials stopped working is TOLD — in the product, on the surface where they notice the symptom — that the credential is the reason their factsheet stopped updating, and is nudged to reconnect. Key rotation is a NORMAL, recurring customer action, not an incident: the system must treat "your key no longer works" as an expected state it reports plainly, rather than a silent stall the customer discovers weeks later.
**Requirements**: TBD (no v1.20 requirement IDs) + ⛔ **MEASURED ON PROD 2026-09-11, read these before planning:** (1) An invalid credential is reported today as `MT5 terminal unreachable — sync will retry automatically.` with `error_kind: transient` — the message names the WRONG CAUSE and promises a retry that can never succeed. Mechanism: a wrong password makes the MT5 terminal raise a MODAL LOGIN DIALOG, which blocks IPC, which the gateway reports as a transport failure (the `-10005` class). (2) Key `<key A>` / `<key A label>` sat at `sync_status: error` with `is_active: true`, `disconnected_at: null` and NO alert for **17 days** (last good sync 2026-08-25, founder confirmed the password had been changed). (3) The `bybit` key has been failing since 2026-08-14 with `retCode 33004 "Your api key has expired."` — a SECOND venue, same class, also unsurfaced, so scope this off the venue-agnostic credential-failure shape and not off mt5. ⭐ The freshness substrate ALREADY EXISTS and should be consumed rather than reinvented: `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql`, keyed on the max date inside `returns_series` — "a signal no status transition can advance".
**Depends on:** ⛔ **The 161.1 ledger refresh — HARD, and the ordering is the whole point. ⛔ ATTRIBUTION CORRECTED 2026-09-22 (Phase 167 plan 05, D-01): it was NOT activated by Phase 164.7, and this line said it was.** 164.7 plan 07 reached its gate and took the DEFERRED path — the founder declined on a failed pre-flight, `20260907130000` reported `applied DORMANT (system_flags.ledger_refresh_enabled = false; NOTHING scheduled)`, and the manifest it committed held 14 jobs with `ledger_refresh_fanout` ABSENT. The activation was taken later, by **Phase 164.5.1 plan 09** on 2026-09-17 (commit `d6607a88`), and the live evidence in this repo is `scripts/prod-prober/cron-manifest.json`, captured from PRODUCTION with a `database_marker` naming it: jobid 40, `ledger_refresh_fanout`, `25 * * * *`, `active: true`, `SELECT public.enqueue_ledger_refresh_for_strategies();`. ⚠️ **The correction is not cosmetic and the dependency IS met on the substance:** a reader who checked 164.7's status and found it Complete was reaching the right answer for the wrong reason, while a reader who read 164.7 plan 07 in full concluded the dependency was NOT met and would have stalled this phase. Both readings were wrong. Until the refresh is LIVE there is NO recurring recompute for ledger venues at all (`[LEDGER-BACKED VENUES HAVE NO RECURRING STRATEGY REFRESH]`, TODOS.md), so a stale ledger factsheet does NOT imply a bad credential. Measured 2026-09-11: strategy `<strategy X>` has PERFECT credentials and syncs cleanly every 04:00Z, yet its `computed_at` is frozen at `2026-09-01 12:09:59` — 3m49s after onboarding, never since. Shipping this phase first would tell that customer to fix a key that is not broken. ⚠️ Adjacent but NOT the same phase: **164.8.3 PROBERAUTH** splits MT5's error vocabulary for the OPS-facing prober; this phase owns the CLIENT-facing surface. Same root, two audiences — do not merge them. ⭐ **MEASURED 2026-09-20 by Phase 164.5.4's review (SF-H2) — the WIZARD surface carries the same defect as the factsheet surface, and the traffic onto it just GREW.** 164.5.4 removed `classify_mt5_login_error`'s over-matching, which was the right fix: a working credential is no longer stamped with a false permanent blame. The consequence is that genuine credential rejections now land on the TRANSIENT arm, and `routers/exchange.py::validate_key` answers that arm with `424 NETWORK_UNAVAILABLE` / `NETWORK_ERROR_DETAIL` / `recoverable=True`. Verified by EXECUTING the shipped classifier: all 7 `_AUTH_PHRASES` members classify `auth` and the 1 `_WRONG_SERVER_PHRASES` member classifies `wrong_server` (so `auth` IS reachable — an earlier reviewer claim that it is not was measured FALSE), but seven plausible generic rejection shapes all classify `transient`. ⛔ A Python-side detail change is USER-INVISIBLE and must not be attempted as a shortcut: the wizard renders its OWN copy table, where `NETWORK_UNAVAILABLE` maps to `KEY_NETWORK_TIMEOUT` ("We could not reach the exchange… a network blip") whose `actions` include `clear_and_retry`, and `clear_and_retry` is in `RECOVERABLE_ACTIONS` — so the Retry is rendered by TypeScript, not by the detail string. The honest fix is the FULL cross-language treatment plan 02 used for `KEY_UNDECRYPTABLE`: a new wire code, a `VENUE_WIRE_CODE_TO_VERDICT` row (⛔ without the row the minted code routes to the `UNKNOWN` terminal and closes nothing — the A-05 lesson), a minted `WizardErrorCode` carrying NEITHER `RECOVERABLE_ACTIONS` member so no Retry renders, both wizard rosters, and BOTH hand-typed `EXPECTED_TABLE_SIZE` pins (⛔ grep them, never count). ⚠️ Deliberately NOT fixed inside 164.5.4's fix round: it is a plan's worth of cross-language contract work, and a fix round is where regressions enter. ⚠️ The A-04 classification itself is a LOCKED decision and is NOT to be reverted — refusing to guess is correct; the defect is the copy the refusal lands on.
**Decision amendment 2026-09-22 (code review round 2) — D-17:** a login-stage MT5 `-10005` counts as a sign-in refusal; the IPC-infrastructure codes `-10000…-10004`, `initialize()` failures, transport raises and post-login read failures keep the pre-167 transport answer. Recorded in `167-CONTEXT.md` D-17 with its reason and accepted cost.
**Plans:** 6 plans (5 + 1 gap-closure)

Plans:

- [x] 167-01-PLAN.md — wave 1 · the wizard cross-language mint: a new Python wire code and a new `WizardErrorCode` whose copy is honest about uncertainty and whose action set renders no Retry (D-05…D-09)
- [x] 167-02-PLAN.md — wave 1 · make the retry PROMISE a function of the retry DISPOSITION across the whole venue-agnostic copy family, by finishing the classifier guard this repo already half-applied (D-09/D-10) — see 167-02-SUMMARY.md, commits `5c48916a` + `26c83dc3`
- [x] 167-03-PLAN.md — wave 2 · **D-11 closed: arm B.** A new `api_keys.sync_status` value, its CHECK-constraint migration and CI gate, and the amber pill + authored owner helper — style map and migration in ONE commit (`checkpoint:decision` + three-reviewer gate)
- [x] 167-04-PLAN.md — wave 3 · the write side: the daily holdings poll stops stamping a wrong cause and an impossible promise, and writes the new state instead. ⭐ No new strategy-level write boundary — PROD cron jobid 15 already polls every active non-revoked key daily
- [x] 167-05-PLAN.md — wave 4 · release gate: both full suites, the one release commit (VERSION + CHANGELOG), and the D-01 ROADMAP `Depends on:` correction
- [x] 167-06-PLAN.md — wave 4 · **gap closure** (re-verification gap 1): a MANAGER's untrusted key shows the existing amber pill + authored helper on its own card on `/strategies/[id]/edit`, with rules R1–R6 so the local sync panel never contradicts it (D-18); goal truth 1 closed by D-19

### Phase 167.1: AUMTRUST — the headline AUM says when it includes holdings from keys needing attention (INSERTED)

**Goal:** The allocator KPI strip's headline AUM stops presenting a number as current when part of it comes from keys whose sync is untrusted (`isUntrustedKeySyncStatus`: `revoked`, `sign_in_failed`), while the holdings table on the same page already strikes those rows through as not current.
  ⛔ **CORRECTED 2026-09-23 (Phase 167.1 D-01/D-13).** The Goal sentence above is kept as lineage and its premise is false. The allocator KPI strip has had NO AUM cell since Phase 64 PRESENT-01, and `liveBaselineMetrics.aum` is rendered nowhere, so there is no "headline AUM" to mark. The holdings-derived dollar totals an allocator actually sees are the Scenario composer's PORTFOLIO AUM field and its override note, and the Open Positions footer "Total unrealized P&L (equity contribution)" (D-16, added by research). Both now carry the disclosure (`scenario-aum-untrusted-note`, `open-positions-untrusted-note`). `ExposureByClass` is out of scope: it reports exposure, not a holdings dollar total, and flagging it would need a new projection (D-17).
**Requirements**: TBD. Source: Phase 167 silent-failure review M2 (2026-09-22); booked as `.planning/WINDOWS.md` entry 66. ⛔ A money-number change — the math in `src/lib/queries.ts` (`emptyLiveBaselineMetrics`, `liveBaselineMetricsFromPerKeyDailies`) is NOT to be changed silently; ⭐ **FOUNDER DECISION 2026-09-22: keep the total and FLAG it** — the headline shows the full number with a marker naming how much comes from keys needing attention (e.g. "includes $X from keys needing attention"). Excluding them was rejected: a password rotation would read as an AUM loss. Nothing silently disappears, and the headline stays reconcilable with the holdings table.
  ⛔ **CORRECTED 2026-09-23 (Phase 167.1 D-03).** The "money-number change" framing above is lineage, not current. This phase changes NO money number: every total keeps its value and discloses the untrusted part. `src/lib/queries.ts`, the scenario commit route, `supabase/` and `analytics-service/` were byte-unchanged on the branch when plan 04 measured them (plan 06 re-measures after the D-06 answer).
**Depends on:** Phase 167
**Founder decisions 2026-09-24:** D-06 answered (b) — the composer says what it excludes from keys needing attention; D-18 REOPENED — the marker shows whenever the on-screen figure includes untrusted dollars, including a live total ≤ 0 (review WR-04) and a manual value equal to the live total (review IN-06). Both land in plan 05. Recorded in `167.1-CONTEXT.md`.
  ⭐ **2026-09-24: plan 05 implemented both** (`943e72d9f`). The composer's one marker now says "excludes $Y from keys needing attention" when the modelled-book narrowing leaves untrusted holdings out, and it shows in state 6 (State A) and state 4 (State C, in the "Required to size and commit." hint). The total is unchanged (D-03).
**Plans:** 6 plans

Plans:
**Wave 1**

- [x] 167.1-01-PLAN.md — composer AUM marker tracer: single-pass `summarizeLiveHoldings`, State A "Includes $X from keys needing attention" beside the field, unit pins (wave 1) — DONE 2026-09-24 (`7eff1d43a` feat, `197bd3bf0` test; `167.1-01-SUMMARY.md`)
- [x] 167.1-02-PLAN.md — Open Positions footer qualifier on "Total unrealized P&L (equity contribution)" (wave 1, D-16) — DONE 2026-09-24 (`73d18979f` feat, `762187821` test; `167.1-02-SUMMARY.md`)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 167.1-03-PLAN.md — composer marker State B inside the override note, every absence state, tone and the component D-06 pin (wave 2) — DONE 2026-09-24 (`56fa60397` feat, `fa2a77460` test; `167.1-03-SUMMARY.md`)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 167.1-04-PLAN.md — premise corrections (closed-sets prose, this entry) and the interim byte-identity gate (wave 3) — DONE 2026-09-24 (`7e3360f11` docs; `167.1-04-SUMMARY.md`)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 167.1-05-PLAN.md — D-06 founder decision (`checkpoint:decision`, recommended option b) and its implementation; execution stops here for the answer (wave 4) — DONE 2026-09-24: founder answered (b) and reopened D-18 (`943e72d9f` feat; `167.1-05-SUMMARY.md`)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 167.1-06-PLAN.md — WINDOWS 66 closed, final byte-identity gate, and the ONE release commit carrying the D-06 outcome (D-14: the last plan releases) (wave 5) — DONE 2026-09-24 (`3bba699b1` docs, `7c0e57f7a` chore(release) v0.89.0.0; `167.1-06-SUMMARY.md`). Phase stays human_needed until the three browser checks

### Phase 167.1.1: HOLDINGKEYSCOPE — two accounts on one venue holding the same asset never merge into one holding (INSERTED)

**Goal:** Every holdings consumer keeps two keys' positions apart. `holdingScopeKey` (`holding:venue:symbol:type`) carries no `api_key_id`, so the latest-as-of holdings collapse in `src/lib/queries.ts` merges two accounts on the same venue holding the same asset into one row, and one key's position silently vanishes from the headline AUM, the Open Positions total and Phase 167.1's untrusted-key marker. Found by Phase 167.1's silent-failure-hunter (founder queue item 11); the defect predates 167.1. **Data-integrity.** Inserted 2026-09-24 under the founder's authorization to add phases.
**Success criteria:** (1) a test with two keys holding the same asset on one venue shows both positions surviving the collapse, in AUM, in Open Positions and in the 167.1 marker, observed RED against today's key; (2) every consumer of `holdingScopeKey` is enumerated by symbol and each is either re-keyed or shown not to need it; (3) the discuss step records how a soft-disconnected key's holdings are counted (founder queue item 11's second question); (4) no change to the analytics service's own math unless the collapse lives there too.
**Requirements**: TBD
**Depends on:** Phase 167.1
⚠️ **2026-09-24 correction (read-only root-cause trace at `96b5db4c`):** the collapse also lives in the analytics-side unique index `(allocator_id, venue, symbol, asof)` on `allocator_holdings`, and for ONE account behind several keys it merges CORRECTLY but attributes the row to whichever key polled last. Adding `api_key_id` to the key as framed above would triple-count that case. Phase 167.1.2 ACCOUNTTRUTH decides account identity first (founder: refuse a second key on the same account); re-scope this phase against it before planning.
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 167.1.1 to break down)

### Phase 167.1.2: ACCOUNTTRUTH — one exchange account is counted once, and the allocator equity curve shows only what the data supports (INSERTED)

**Goal:** An allocator's book counts each exchange ACCOUNT exactly once, and "My Allocation" never shows an equity curve, return or ratio that the data does not support. A second key on an account that is already connected is refused. The equity history is rebuilt as one series per account from per-key returns and flows, and hidden until that series exists.
**Requirements**: TBD. Source: founder browser UAT 2026-09-24 on the founder's own allocator book ("completely wrong, obviously"), with a read-only root-cause trace at `96b5db4c`.
**Depends on:** Phase 167.1
**Plans:** 0 plans

⭐ **Founder decisions, 2026-09-24 (AskUserQuestion):**
- (1) Several keys on the SAME exchange account: **"Refuse a second key."**
- (2) The broken curve: **"Hide it until correct."**

**Evidence (root cause, by symbol; measured in code, not yet on PROD rows):**
- **Equity writes.** `allocator_equity_snapshots` holds one row per `(allocator_id, asof)`, written first-writer-wins (`persist_equity_snapshots`, `ignore_duplicates=True`) by the daily refresh (`run_refresh_allocator_equity_daily_job`, which sums only holdings with `asof = today`, so a key that did not poll today counts as $0) and by the per-key backfill (`run_reconstruct_allocator_history_job`). The history is therefore a patchwork of writers. It produces a +100% jump, a flicker in May, and a −50% "crash" on the day two revoked keys stopped polling.
- **Returns.** `equityCurveToDailyReturns` (`src/lib/factsheet/resolve-series.ts`) turns those level jumps into returns with no flow or key-set adjustment. That is why the page showed Sharpe 1.44 beside −42.8% cumulative.
- **Holdings attribution.** The `allocator_holdings` unique index `(allocator_id, venue, symbol, asof)` attributes a shared account to the last-polling key. The Scenario composer then gets zero weight mass: `computeScenario` normalises to 0 instead of returning an honest empty, so it shows all +0.00% over 100 days. `summarizeLiveHoldings` silently drops a trusted but non-contributing key's dollars ("live-holdings total is $0").
- **Account identity.** `api_keys.venue_account_id` is NULL for every ccxt venue, so "same account" cannot be detected today.

## Success Criteria
1. **Detect and refuse duplicates.** Connecting a key reads the exchange's account identity (for example the OKX/Bybit uid) into `venue_account_id`. A key whose account is already connected for this user is refused with a clear message. Existing duplicate keys get a named cleanup path; nothing is silently deleted.
2. **Hide the broken curve now.** Until criterion 3 ships, "My Allocation" shows an honest "history is being rebuilt" state instead of the legacy snapshot curve and its KPIs. There are no invented numbers. This lands first, as its own plan.
3. **Rebuild the history.** It is rebuilt as one series per account: carried forward over missing polls, never read as $0, and flow-adjusted so that deposits, withdrawals and keys joining or leaving are not returns. The KPIs derive from that series. There is a test for each: a revoked key's stop, a duplicate-writer date, and a deposit.
4. **No fabricated zeros or silent drops.** `computeScenario` returns an honest empty on zero weight mass. `summarizeLiveHoldings` never drops trusted dollars silently; every excluded dollar sits in a disclosed part.
5. **Small fixes on the same surface.**
   - The Scenario UI shows no raw key id: `buildPerKeyStrategyForBuilderSet` names a key through `apiKeyLabelById`, and so do the correlation headers.
   - `MetricsColumn`'s years derive from `periodsPerYear`, not `/252`.
   - A tab switch on /allocations does not re-run the whole server render.
6. **Recompute on PROD.** Affected rows are recomputed after the merge, behind a read-only census first.

Plans:

- [ ] TBD (run /gsd-plan-phase 167.1.2 to break down)

### Phase 167.2: KEYCARDSYNC — the key card never shows one key's sync result as another key's (INSERTED)

**Goal:** On a manager's key card (`ApiKeyManager`), a sync result is only ever shown about the key it came from, and a success the card withheld beside a "Sign-in failed" pill cannot reappear through a re-read. ⭐ **Widened 2026-09-22 (167 D-19):** the `/strategies` list, where a manager lands, marks each strategy row whose feeding key is untrusted (`isUntrustedKeySyncStatus`) with the same key-level pill — no causal claim, no D-04 path. ⭐ **Widened 2026-09-23 (founder decision, folded in as a second surface): the owner's "still computing" factsheet says what is actually happening.** Observed live on a freshly created three-key composite strategy: while its first sync job was actively fetching trades (key 2 of 3, progress rows being written), the owner's factsheet (`src/app/factsheet/[id]/v2/page.tsx`, the `!payload` placeholder branch) showed fixed copy — "still computing … once the analytics service finishes the first compute pass" and "This factsheet has not been computed yet. Some strategies stay in this state, and this page is all there is until one has been computed." Founder verdict: *"This is very confusing. It should clearly say what is happening."* The placeholder cannot tell running from queued, failed, stalled or never-enqueued, although the worker already writes `set_compute_job_progress` and the wizard already reads it via `/api/strategies/[id]/sync-progress` (`SyncPreviewStep`). **In scope:** on the OWNER lane only, the pending factsheet reads the strategy's latest compute job and states its real state in authored copy — queued, fetching trades (key N of M for a composite), computing, failed (the authored reason for its error kind, never raw exception text), or stalled / never started (with what the owner can do) — and the "Some strategies stay in this state" sentence goes. **Fenced:** the PUBLIC lane stays neutral and names no internal state (Phase 164.2 criterion 9's reasoning still holds there), and no new job states are invented. Read DESIGN.md before any copy decision. ⭐ **Widened again 2026-09-23 (founder-approved): the SHARE LINK for a strategy whose compute failed or stalled must say so too.** Observed the same day: the owner could create a share link while the first compute job was running; that job then failed permanently (Phase 168's Deribit `assignment` refusal), yet the share page (`src/app/factsheet-share/[token]/page.tsx`) keeps saying "This factsheet isn't ready yet — The link works — the strategy's performance data is still being computed. Try again in a few minutes." That is a promise that will not come true. Founder: *"weird that i can already post or copy a link but cant see it."* **In scope:** the share page and the owner's share affordance tell a compute that is genuinely running apart from one that failed or stalled, and never promise "a few minutes" for a terminal failure. The viewer-facing copy stays neutral about internal causes (Phase 164.2 criterion 9) but must not claim the data is being computed when it is not. **Open, for this phase's discuss step (record it, do not assume it):** whether creating a share link should be allowed before the first successful compute at all.
**Requirements**: TBD. Source: Phase 167 plan 06 residuals, recorded in `167-CONTEXT.md` D-18 (2026-09-22). (1) The post-add sync bypasses the component's one tracked sync slot. ⭐ NARROWED 2026-09-22 (167 plan-06 fix round, D-18): `handleAddKey` no longer moves `lastAttemptedKeyId` while a tracked attempt is live, so the mislabel and the "success beside Sign-in failed" variant are closed; what remains is that a post-add sync FAILURE during another key's live attempt reaches only the console. Closing it routes the post-add sync through the tracked slot, which changes the add flow the `SEAMUX-05` tests pin. (3) A poll that lands AFTER the enqueue returns but BEFORE the worker marks the job `computing` can still end an attempt with the previous run's result — ⚠️ NOT narrow: the analytics row flips to `computing` only when a job handler runs, so this is likely on MOST resyncs of a strategy with a prior terminal row (a stale "Up to date", or a false "Sync failed" after a prior failure). Pre-existing, not worse after 167. Real fix: accept a terminal only once this attempt has seen `computing`, or when the row's `computed_at` differs from the value read before the enqueue (no client/server clock comparison); the poller already selects `computed_at` but does not pass it on. (4) An enqueue that never returns spins until the sync route's `maxDuration = 300` ends the request: since the plan-06 fix round the poller does not run before the enqueue answers (it polls only in `computing`), and the link update ahead of it has no bound of its own. (2) A change made in another tab can surface a withheld success through a re-read (the load-error Retry or the terminal-success re-read); closing it means retiring the success at the moment of withholding, a redesign of 167-06's R2.
**Depends on:** Phase 167
**Deviation 2026-09-24 (review round 1, WR-05; rule replaced in review round 2, WR-02):** KCS-23's "`Delete` behaves as before" was amended. Rule: delete allowed after a named warning (founder decision 2026-09-24). The `Delete` confirm names every composite the key belongs to and says what deleting does. The owner can still confirm. If the membership read fails, the confirm says it could not check, and it does not block. Recorded in `167.2-CONTEXT.md` KCS-23.
**Plans:** 10 plans (6 waves: W1 01, 02 · W2 03, 07, 08, 09 · W3 10 · W4 04 · W5 05 · W6 06)

Plans:
**Wave 1**

- [x] 167.2-01-PLAN.md — one compute-state derivation (chain-kind selection, done_pending_children in flight), the sync-progress route on it, the locked S4-S9 copy module and the one strategy-shape predicate (KCS-07/08/19/20/21)
- [x] 167.2-02-PLAN.md — the post-add sync runs as the tracked attempt; Add Key blocked while an attempt is live and Resync blocked while an add is in flight (KCS-01/05)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 167.2-03-PLAN.md — a terminal is accepted only with this attempt's server-written evidence (KCS-02)
- [x] 167.2-07-PLAN.md — the owner pending factsheet states the real compute state with a shape-true remedy; the public placeholder is one neutral sentence; the owner share panel says what a recipient sees (KCS-09/10/12/21)
- [x] 167.2-08-PLAN.md — the share page's two neutral arms over a bounded compute_jobs read (KCS-11)
- [x] 167.2-09-PLAN.md — the /strategies row key pill over every feeding key, and the recipient note beside each uncomputed row's share control (KCS-06/12)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 167.2-10-PLAN.md — a success is shown only when no factsheet-chain job is in flight; an unreadable job state never forwards one (KCS-18)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 167.2-04-PLAN.md — a poll give-up says the panel stopped checking, never a timeout or failure; a failure carries the server's reason (KCS-22)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 167.2-05-PLAN.md — the link update and the enqueue are bounded; expiry says the sync could not be confirmed (KCS-03)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 167.2-06-PLAN.md — a composite's key card offers no link control; a withheld success is retired at the applied re-read (KCS-23/04)

### Phase 167.2.1: FACTSHEETBUILDABLE — a strategy is called computed only when its factsheet can actually build (INSERTED)

**Goal:** The owner's `/strategies` list and every "has a factsheet" signal agree with what a share-link recipient actually sees. Today a strategy whose `strategy_analytics.computation_status` reads computed, but whose series cannot build (`fetchAndBuildPayload` in `src/lib/factsheet/fetch-and-build-payload.ts` returns no payload), is shown on the list as having a factsheet with no share note, while its recipient lands on the pending page. Only the service-role builder can decide buildability (the series sit behind deny-all RLS) and no owner-readable field records the outcome, so Phase 167.2 could not fix it without a migration or an admin read (167.2 review WR-02, recorded UNFIXABLE-IN-PHASE 2026-09-24). **User-facing.** Inserted 2026-09-24 under the founder's authorization to add phases.
**Success criteria:** (1) the mismatch is reproduced first (a computed row whose payload does not build) on the local lane, or the phase shrinks; (2) buildability is recorded where the owner lane can read it (e.g. a bridge-maintained column written by the compute path), or decided server-side for the list; (3) the list, the share note and the share page agree for that row, proven by a test observed RED against today's code; (4) any migration passes the three reviewers (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before merge, because merge auto-applies to PROD. **Added 2026-09-24 (167.2 review R2-L4(b), data-integrity):** (5) the key-card Delete warning cannot be silenced by an RLS-filtered membership read — a `strategy_keys` read that comes back empty with no error because of a policy regression shows no composite warning, and the delete then cascades a composite's member away; the guard belongs server-side (a migration), so it lands here with WR-02.
**Requirements**: TBD
**Depends on:** Phase 167.2
**Note 2026-09-25 (planning, 167.2.1-CONTEXT.md D-01):** criterion 5's "(a migration)" is superseded. The guard is a server route, `GET /api/keys/[id]/memberships`, which checks ownership with an explicit equality and reads on the service role. It needs no migration, so criterion 4 is vacuous. The SECURITY DEFINER RPC in `167.2.1-RESEARCH.md` stays the recorded fallback. Reversible.
**Plans:** 4 plans

Plans:

- [ ] 167.2.1-01-PLAN.md — BUILDPROBE: reproduce on the local lane, split resolve from build, export hasBuildableSeries + probeFactsheetBuildable with a parity table (wave 1)
- [ ] 167.2.1-02-PLAN.md — MEMBERSGUARD: GET /api/keys/[id]/memberships on the service role after an explicit owner check; the key card fails closed to KCS-DELETE-UNCHECKED (wave 1)
- [ ] 167.2.1-03-PLAN.md — LISTTRUTH: /strategies probes computed rows and shows the D-02 unbuildable note, RED first (wave 2)
- [ ] 167.2.1-04-PLAN.md — OWNERNOTE: the owner factsheet's S7 note uses the same derivation, and the D-03 TODOS entry (wave 3)

### Phase 168: DRBOPTIONS — a Deribit options account ingests end to end

**Goal:** Classify Deribit's `assignment` transaction-log type **against a captured row census rather than a guess**, so an options account ingests end to end and the realized-cash series it feeds is neither silently dropped nor double-counted.

⛔ **MEASURED IN PRODUCTION 2026-09-12 — a live customer-visible failure, not a hypothetical.** A real Iron Condor failed with `unknown Deribit transaction-log type 'assignment' carries nonzero change (-1.5e-05); it is in neither CASH_BEARING nor INFORMATIONAL` (job `0c5ad574`, `failed_final`/`permanent`). The customer saw `GATE_ANALYTICS_FAILED`. ⚠️ **The wizard's Retry button CANNOT clear it** — the ledger still holds the row, so every retry re-reads it and refuses identically.

⭐ **THE DECIDING QUESTION, and NO DOCUMENT CAN ANSWER IT:** does Deribit ALSO emit a `delivery` row for the same instrument/expiry? `delivery` is already `CASH_BEARING` and books option expiry cash — if BOTH fire, summing `assignment` **DOUBLE-COUNTS realized cash** in customer-facing return series; if only `assignment` fires, it carries the settlement and MUST be summed. MEASURED 2026-09-12: Deribit does **not** enumerate the `type` enum in its published docs, and the repo's own `analytics-service/docs/evidence/drb-options-semantics-2026-07.json` covers `assignment`/`delivery`/`settlement` **zero** times.

⛔ **DO NOT CLASSIFY IT FROM THE MAGNITUDE.** `-1.5e-05` looks fee-sized; acting on that is precisely the guess the guard exists to refuse, and it is wrong in a way that corrupts money **silently, in both directions**.

✅ **THE EVIDENCE CHANNEL ALREADY EXISTS — this phase SPENDS it, it does not build it.** PR #783 made the refusal self-evidencing: it now prints the row's redacted shape plus a same-instrument `delivery`/`settlement`/`trade` census at BOTH refusal sites. So the next occurrence supplies the deciding measurement by itself. ⛔ Do not re-derive that mechanism; read its output.

⚠️ **WHY IT HAD NEVER BEEN HIT, so nobody concludes the ingester was fine:** MEASURED — `derive_broker_dailies` has completed **7 times for mt5, once for okx, and ZERO times for deribit**. This was the first deribit options account ever put through it, and `assignment` is the defining event of a short-options strategy. ⚠️ A **zero-`change`** unknown type passes SILENTLY (only nonzero is loud), so this is the first **FAILURE**, not necessarily the first **occurrence** — do not treat prior green runs as evidence of absence.

⚠️ **EXPOSURE IS WIDER THAN ONE KEY, BUT IT IS NOT WHAT BLOCKS 161.1 — and the difference was MEASURED, not reasoned.** The composite `Alpha Centauri` holds **three** deribit keys and `deribit_ingest.py` imports the same classifier, so the same refusal is reachable there. ⛔ **This entry originally read that Phase 161.1's go-live step was "likely blocked by THIS, not by scheduling". That was a GUESS and PROD refutes it (2026-09-12).** Alpha Centauri (`081f2912`) last computed 2026-08-25 `complete_with_warnings` with 272 return points; its one failed job (`978e2d20`, `stitch_composite`, `failed_final`) reports `run_stitch_composite_job: member ledger unrecoverable — native_nav inception reconciliation breached venue=deribit currencies=[BTC] breach_ratio=436` — a NAV reconciliation breach that never reached the classifier. ⭐ **Consequence for planning: settling THIS phase will NOT by itself unblock 161.1's go-live step.** `assignment` is a latent exposure sitting behind the reconciliation breach; the breach is a separate defect and needs its own owner. Do not read this phase as a prerequisite for that step, and do not read that step's failure as either a scheduling problem or an `assignment` problem until the breach is dispositioned.

**Requirements**: TODOS entry `[DERIBIT-ASSIGNMENT-UNCLASSIFIED]` — read it before planning; it carries the dated measurements and the forbidden remedies. Do not re-derive them. ⭐ **THE WAITING DEPENDENCY IS MET — MEASURED 2026-09-23 (founder-approved edit), read-only from the production analytics log.** A three-account Deribit composite created 2026-09-23 failed its first stitch job (`run_stitch_composite_job`) permanently at 06:50 UTC on exactly this refusal: one `assignment` row, currency BTC, change `-1.5e-5`, instrument a BTC put expiring 28 Aug 2026, side `close buy`. The refusal's own same-instrument census for that batch read **`delivery=0 settlement=0 trade=1`**. For this occurrence that answers the deciding question: Deribit emitted NO separate `delivery` or `settlement` row for the assigned instrument, so there is no second cash row the `assignment` change could be double-counted against. ⚠️ One occurrence, one instrument — the plan decides whether n=1 is enough to classify, and must say so. **Consequence:** the strategy's analytics were stamped terminal (composite member reconstruction failed structurally), and its owner factsheet and share link still read "still computing" (that copy defect is Phase 167.2's). Phase 159 UAT #2 (render a composite on the public factsheet) now has a real composite waiting on THIS phase.
**Depends on:** PR #783 merged (the evidence channel), and ONE observed occurrence carrying the census. ⚠️ The second is a WAITING dependency, not a code one — nothing in the repo produces it; a deribit options account must hit the refusal again.
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 168 to break down)

### Phase 169: PAGETRUTH — every number agrees across pages and with its own record length

⭐ **ROUTED HERE 2026-09-26 (Phase 167.2.1 CONTEXT D-07, verifier warning):** a composite whose `csv_daily_returns` read fails transiently is cached as a null payload on the public factsheet until the `unstable_cache` TTL, because `readCompositeFactsheet` cannot tell a read error from an empty composite. 167.2.1 fixed the single-key half (WR-02, `FactsheetReadError`). The composite half needs a distinguishable read error from `readCompositeFactsheet` and a throw in the public cache callback, with a red-first test. After the 2026-09-26 split of Phase 169 it belongs to the factsheet-truth phase.

**Goal:** Every number a page shows agrees with the same number on every other page and with the length of the record it describes. Each contradiction below is traced to ONE source of truth and fixed there, not patched per page.
**Founder decision, 2026-09-25 (AskUserQuestion):** the session QA sweep and the 2026-09-24 layout notes book as TWO phases; this numbers phase ships FIRST, Phase 170 PAGECOPY second. Phase 167.1.2 ACCOUNTTRUTH already owns the Allocations equity curve, Sharpe beside a negative return, the Scenario zero weights/UUID/$0 total, and the holdings total; they are EXCLUDED here.
**Evidence:** the 2026-09-25 in-depth QA sweep of every page in the logged-in account (14 data-integrity findings) and the 2026-09-24 visual UAT. Counts only here; the reports hold no identifiers and are not tracked.
**Requirements**: TBD (phase-local SC ids)
**Depends on:** none in code. Plan after 167.1.2 plan 01 (HIDE) so the two do not edit the same Allocations widgets at once.
**Routed in, 2026-09-25 (Phase 167.2.1 D-03):** the discovery detail page (`src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`) assembles the factsheet builder a second time. It calls `resolveDailyReturnSeries`, `readCompositeFactsheet`, `readSingleKeyBasisOpts` and `buildFactsheetPayload` itself instead of `fetchAndBuildPayload`. That is a drift risk on a factsheet number surface, not a false claim today: it serves published rows only and falls back to the honest KCS-10 sentence. Phase 167.2.1 splits the builder into one shared resolve stage (its D-04); folding this page onto it belongs here, beside SC4. Backlog entry: `[167.2.1-DISCOVERY-DETAIL-DOUBLE-ASSEMBLY]` in `TODOS.md`, written by Phase 167.2.1 plan 04.

## Success Criteria

1. `/admin` Compute Jobs: the list request no longer returns HTTP 500, and the tab never says "No compute jobs found" while the header counts a job in progress. A failed load says it failed.
2. The Allocations Risk tab and the Overview / Scenario tabs read VaR, alpha/beta and correlation from the same series; one never says "insufficient data" while another shows a value.
3. The BTC benchmark is current: MTD and 3-month returns, win rate, volatility and drawdown come from a benchmark series that is refreshed, and a stale benchmark is shown as stale rather than as +0.00%.
4. A strategy's CAGR and Sharpe are identical on discovery, recommendations, my-strategies and its factsheet (one computation, one stored value), or a surface that must differ says why.
5. A factsheet's header date, its "track record through" date and its stated record length agree, and record length is stated one way.
6. 3-year and 5-year rows are not shown for a record shorter than that period.
7. `/profile` Exchanges counts only live keys as connected and never repeats one balance across keys.
8. `/recommendations` does not say "set your mandate" while listing "fits your mandate", and does not recommend a record that ended long ago without saying so.
9. Every fix carries a test that fails on the old behaviour (neuter → RED → restore), and each page is re-checked in the logged-in browser after deploy.

**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 169 to break down)

### Phase 170: LAYOUT — page layout reads clean and holds on every page

**Goal:** Pages read as a finished product: no stacked look-alike panels, and the layout holds at 320 px and 200% zoom.
**Founder decision, 2026-09-25 (AskUserQuestion):** the second of the two QA phases; ships after Phase 169 PAGETRUTH.
**Evidence:** the founder's 2026-09-24 layout notes ("too many similar layers stacked", the "get private link" control too dominant and overlapping) and the 2026-09-25 QA sweep (4 user-facing broken, 14 cosmetic findings). Counts only here.
**Requirements**: TBD (phase-local SC ids)
**Depends on:** Phase 169
**Split 2026-09-26 by founder decision: one topic per phase.** Sibling: Phase 170.1 COPY. This phase was 170 PAGECOPY and keeps the former criteria 1 and 5 (renumbered 1 and 2 below) plus its own copy of the former criterion 7 (now 3), text unchanged. The former criteria 2, 3, 4 and 6 and the goal's copy clauses ("no raw ids or internal labels, no test text, no typos") moved to 170.1 verbatim. The phase directory keeps its original `170-pagecopy` slug.

## Success Criteria

1. Factsheet and Allocations panels no longer stack as near-identical layers; the private-link control is secondary and never overlaps content.
2. `/security` and the legal pages show the signed-in header when signed in; the floating tweaks control never covers the bottom navigation; `/compare` does not point to controls that do not exist; `/admin/match` on mobile is read-only in fact, not only in words; no page scrolls horizontally at 320 px.
3. Each page is re-checked at 320 px and 200% zoom in the logged-in browser after deploy.

**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 170 to break down)

### Phase 170.1: COPY — page copy reads clean on every page (INSERTED)

**Goal:** Pages read as a finished product: no raw ids or internal labels, no test text, no typos.
**Founder decision, 2026-09-25 (AskUserQuestion):** the second of the two QA phases; ships after Phase 169 PAGETRUTH.
**Evidence:** the 2026-09-25 QA sweep (4 user-facing broken, 14 cosmetic findings). Counts only here.
**Requirements**: TBD (phase-local SC ids)
**Depends on:** Phase 169
**Split 2026-09-26 by founder decision: one topic per phase.** Sibling: Phase 170 LAYOUT (formerly 170 PAGECOPY). The former 170 criteria 2, 3, 4 and 6 moved here verbatim (renumbered 1–4 below) with the goal's copy clauses, and this phase carries its own copy of the former criterion 7 (now 5). It does not depend on Phase 170: the two touch different concerns and either may ship first after Phase 169.

## Success Criteria

1. No page shows a short id where a name exists, or a raw internal value as a label (strategy type, allocator type, event kinds, roles).
2. No production page carries QA, test or internal-phase text, including strategy descriptions and the placeholder Referral page.
3. The recorded typos are fixed and pages that share a title are distinguished.
4. The wizard's post-Submit copy says "submitted" on success, not "already submitted".
5. Each page is re-checked at 320 px and 200% zoom in the logged-in browser after deploy.

**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 170.1 to break down)

---

### Phase 165: ACTIONSDEPS — the four GitHub Actions dependabot PRs land first, in the verified order

**Goal**: The four GitHub Actions dependabot PRs (#643, #627, #626, #612) are RESOLVED — landed or deliberately closed — one at a time in the research-verified order with the full suite green between each, so CI's own behaviour is settled before any library bump is judged by it
**Depends on**: Phase 158 (⛔ HARD: OPS-01 — nine CI runs against the unfixed group guarantees a silently-skipped Railway deploy, and #685 is 100% `analytics-service/`). LAST phase of the milestone — dependency churn lands after the correctness work, never before
**Requirements**: DEPS-01 (shared by 165, 165.1 and 165.2; satisfied when 165.2 closes)
**Ordering (2026-09-05):** runs AFTER Phase 166 — dependency churn lands LAST in the milestone. Carried decision: when v1.21 is created and 165 is still open, it moves there.
**Split 2026-09-26 by founder decision: one topic per phase.** Phase 165 DEPS ("The 9-PR dependabot campaign") became three phases, one per ecosystem, in criterion 2's verified order — 165 ACTIONSDEPS (#643, #627, #626, #612) → 165.1 PIPDEPS (the pandas prerequisite commit + #685, now #755) → 165.2 NPMDEPS (#686, now #836; #645; #646; #614's closure; the #606 issue; `[165-NIGHTLY-AUDIT-RED]`). A two-way Python/JS split was rejected because the actions PRs sit BEFORE the pip PR in that order, and `.planning/research/STACK.md`'s ordering rationale makes actions-first load-bearing (they "change *how CI runs*, and you want that settled before you start trusting CI's verdict on library bumps"). Old criteria → new homes: 1 → 165.1; 2 → all three, verbatim (each phase lands its own slice of the order); 3 → 165.2; 4 → 165.2 (the campaign's close criterion); 5 → 165.2. 165 and 165.1 each carry a new criterion, added at the split, that their own PRs are landed or closed. The former goal was: "All 9 open dependabot PRs are RESOLVED — landed or deliberately closed — in the research-verified order with the full suite green between each, and production pandas is never downgraded".
**Measured 2026-09-26, recorded here rather than rewritten into the criteria below (their text is kept verbatim):** #685 (pip group) and #686 (npm group) were CLOSED on 2026-08-24 and replaced by the open group PRs #755 (pip) and #836 (npm); #606 is an ISSUE (the 2026-07-10 nightly npm-audit report), not a PR. Ecosystems read from `gh pr view <n> --json files`: #643, #627, #626, #612 touch only `.github/workflows/*`; #685 only `analytics-service/requirements{.in,.txt,-dev.txt}`; #686, #645, #646, #614 only `package.json` + `package-lock.json`.
**Success Criteria** (what must be TRUE):

  1. PRs land ONE at a time in the verified order — #643 → (#627, #626) → #612 ALONE (validated on `migration-drift-check.yml` first, `supabase --version` == 2.98.2 confirmed in the plan-job log; it rides the PROD auto-migrate workflows) → #685 → #686 (rebased + `npm install`, ⚠️ never bisected — its nine reds are ONE mis-materialised lockfile) → #645 @ 7.0.1 → #646 @ jsdom 30.0.1 not 30.0.0 (⚠️ jsdom 30's `engines` excludes local Node 25; decide CI-Node-22-as-authority vs `PATH=/opt/homebrew/opt/node@22/bin` explicitly, don't discover it as a flake) — full local suite between each, every merge asserted `conclusion == "success"`, never "not failure" (with no branch protection, a grey run merges).
     *(Slice owned by this phase: #643 → (#627, #626) → #612 ALONE. The whole order is kept verbatim so each phase lands against it.)*
  2. *(added 2026-09-26 at the split)* This phase's own PRs — #643, #627, #626, #612 — are each landed or closed with a reason at phase close, and no Railway deploy was silently skipped across them (the Phase-158 watcher observed quiet or loud, never grey). Zero-open-dependabot-PRs is the campaign's close criterion and lives in Phase 165.2.

**Plans**: TBD

**Research note:** STACK.md is effectively the plan — every verdict registry- or log-measured. ⚠️ The whole campaign is predicted, not executed: no PR was rebased, no lock regenerated, no suite run. Run `mypy --strict` before shipping any `analytics-service/` change (the GSD flow runs pytest only). If #686 stays red after a clean `npm ci`, `knip` (6.25 → 6.32, seven minors, changelogs unread) is the prime suspect and its findings may be LEGITIMATE, not regressions. Update each action's SHA AND its version comment together (C-0293).

### Phase 165.1: PIPDEPS — the pip dependabot work lands with production pandas never downgraded (INSERTED)

**Goal**: The pandas prerequisite commit lands on `main`, then the pip dependabot group (#685, now superseded by #755) is RESOLVED in the verified order with the full suite green, and production pandas is never downgraded
**Depends on**: Phase 165 (criterion 2's verified order puts every GitHub Actions PR before the pip group)
**Requirements**: DEPS-01 (shared by 165, 165.1 and 165.2; satisfied when 165.2 closes)
**Ordering:** stays LAST in the milestone with Phase 165 and Phase 165.2.
**Split 2026-09-26 by founder decision: one topic per phase.** Phase 165 DEPS ("The 9-PR dependabot campaign") became three phases, one per ecosystem, in criterion 2's verified order — 165 ACTIONSDEPS (#643, #627, #626, #612) → 165.1 PIPDEPS (the pandas prerequisite commit + #685, now #755) → 165.2 NPMDEPS (#686, now #836; #645; #646; #614's closure; the #606 issue; `[165-NIGHTLY-AUDIT-RED]`). A two-way Python/JS split was rejected because the actions PRs sit BEFORE the pip PR in that order, and `.planning/research/STACK.md`'s ordering rationale makes actions-first load-bearing (they "change *how CI runs*, and you want that settled before you start trusting CI's verdict on library bumps"). Old criteria → new homes: 1 → 165.1; 2 → all three, verbatim (each phase lands its own slice of the order); 3 → 165.2; 4 → 165.2 (the campaign's close criterion); 5 → 165.2. 165 and 165.1 each carry a new criterion, added at the split, that their own PRs are landed or closed. The former goal was: "All 9 open dependabot PRs are RESOLVED — landed or deliberately closed — in the research-verified order with the full suite green between each, and production pandas is never downgraded".
**Measured 2026-09-26, recorded here rather than rewritten into the criteria below (their text is kept verbatim):** #685 (pip group) and #686 (npm group) were CLOSED on 2026-08-24 and replaced by the open group PRs #755 (pip) and #836 (npm); #606 is an ISSUE (the 2026-07-10 nightly npm-audit report), not a PR. Ecosystems read from `gh pr view <n> --json files`: #643, #627, #626, #612 touch only `.github/workflows/*`; #685 only `analytics-service/requirements{.in,.txt,-dev.txt}`; #686, #645, #646, #614 only `package.json` + `package-lock.json`.
**Success Criteria** (what must be TRUE):

  1. A prerequisite commit on `main` (not a PR) fixes `requirements.in` `pandas==2.2.3` → `3.0.3` with its comment corrected and `requirements.txt` untouched, BEFORE #685 is touched at all; #685 then lands rebased with pandas OUT of its diff and `make lock` re-run — production pandas stays 3.0.3. ⚠️ A green pytest is NOT proof of safety here; the pin itself is the assertion.
  2. PRs land ONE at a time in the verified order — #643 → (#627, #626) → #612 ALONE (validated on `migration-drift-check.yml` first, `supabase --version` == 2.98.2 confirmed in the plan-job log; it rides the PROD auto-migrate workflows) → #685 → #686 (rebased + `npm install`, ⚠️ never bisected — its nine reds are ONE mis-materialised lockfile) → #645 @ 7.0.1 → #646 @ jsdom 30.0.1 not 30.0.0 (⚠️ jsdom 30's `engines` excludes local Node 25; decide CI-Node-22-as-authority vs `PATH=/opt/homebrew/opt/node@22/bin` explicitly, don't discover it as a flake) — full local suite between each, every merge asserted `conclusion == "success"`, never "not failure" (with no branch protection, a grey run merges).
     *(Slice owned by this phase: #685 (now #755). The whole order is kept verbatim so each phase lands against it.)*
  3. *(added 2026-09-26 at the split)* This phase's own PRs — the pandas prerequisite commit and #685 (now #755) — are each landed or closed with a reason at phase close, and no Railway deploy was silently skipped across them (the Phase-158 watcher observed quiet or loud, never grey). Zero-open-dependabot-PRs is the campaign's close criterion and lives in Phase 165.2.

**Plans**: TBD

**Research note:** see Phase 165's research note (it is STACK.md-wide). The `mypy --strict` rule there applies to this phase's `analytics-service/` change.

### Phase 165.2: NPMDEPS — the npm dependabot work lands and the nightly audit goes green (INSERTED)

**Goal**: The npm dependabot PRs (#686, now superseded by #836; #645; #646) are RESOLVED in the verified order with the full suite green between each, #614 and the #606 issue are closed with reasons, the nightly audit is green, and zero dependabot PRs remain open
**Depends on**: Phase 165.1 (criterion 2's verified order puts the pip group before the npm PRs)
**Requirements**: DEPS-01 (shared by 165, 165.1 and 165.2; satisfied when 165.2 closes)
**Ordering:** the LAST phase of the milestone; it closes the dependabot campaign.
**Split 2026-09-26 by founder decision: one topic per phase.** Phase 165 DEPS ("The 9-PR dependabot campaign") became three phases, one per ecosystem, in criterion 2's verified order — 165 ACTIONSDEPS (#643, #627, #626, #612) → 165.1 PIPDEPS (the pandas prerequisite commit + #685, now #755) → 165.2 NPMDEPS (#686, now #836; #645; #646; #614's closure; the #606 issue; `[165-NIGHTLY-AUDIT-RED]`). A two-way Python/JS split was rejected because the actions PRs sit BEFORE the pip PR in that order, and `.planning/research/STACK.md`'s ordering rationale makes actions-first load-bearing (they "change *how CI runs*, and you want that settled before you start trusting CI's verdict on library bumps"). Old criteria → new homes: 1 → 165.1; 2 → all three, verbatim (each phase lands its own slice of the order); 3 → 165.2; 4 → 165.2 (the campaign's close criterion); 5 → 165.2. 165 and 165.1 each carry a new criterion, added at the split, that their own PRs are landed or closed. The former goal was: "All 9 open dependabot PRs are RESOLVED — landed or deliberately closed — in the research-verified order with the full suite green between each, and production pandas is never downgraded".
**Measured 2026-09-26, recorded here rather than rewritten into the criteria below (their text is kept verbatim):** #685 (pip group) and #686 (npm group) were CLOSED on 2026-08-24 and replaced by the open group PRs #755 (pip) and #836 (npm); #606 is an ISSUE (the 2026-07-10 nightly npm-audit report), not a PR. Ecosystems read from `gh pr view <n> --json files`: #643, #627, #626, #612 touch only `.github/workflows/*`; #685 only `analytics-service/requirements{.in,.txt,-dev.txt}`; #686, #645, #646, #614 only `package.json` + `package-lock.json`.
**Success Criteria** (what must be TRUE):

  1. PRs land ONE at a time in the verified order — #643 → (#627, #626) → #612 ALONE (validated on `migration-drift-check.yml` first, `supabase --version` == 2.98.2 confirmed in the plan-job log; it rides the PROD auto-migrate workflows) → #685 → #686 (rebased + `npm install`, ⚠️ never bisected — its nine reds are ONE mis-materialised lockfile) → #645 @ 7.0.1 → #646 @ jsdom 30.0.1 not 30.0.0 (⚠️ jsdom 30's `engines` excludes local Node 25; decide CI-Node-22-as-authority vs `PATH=/opt/homebrew/opt/node@22/bin` explicitly, don't discover it as a flake) — full local suite between each, every merge asserted `conclusion == "success"`, never "not failure" (with no branch protection, a grey run merges).
     *(Slice owned by this phase: #686 (now #836) → #645 → #646. The whole order is kept verbatim so each phase lands against it.)*
  2. #614 (TypeScript 7) and #606 are CLOSED with reasons written on the PRs (the `exports`-map read + the typescript-eslint `<6.1.0` peer range; #606's stale claims) so the next Dependabot reopen is pre-answered; the `fast-uri` override is bumped `^3.1.4` → `^3.1.5`; NO audit-allowlist file is added.
  3. Zero dependabot PRs remain open at phase close, and no Railway deploy was silently skipped across the campaign (the Phase-158 watcher observed quiet or loud, never grey).

  4. `[165-NIGHTLY-AUDIT-RED]` — the `npm-audit` advisory set that has held `nightly.yml` RED on `main` for FIVE consecutive days is resolved, and the nightly is green on that job. MEASURED 2026-09-13 from run `34758789452` (head `f10b0e23`): `10 vulnerabilities (3 moderate, 6 high, 1 critical)`, with failures also in `preflight`. ⛔ **The critical is `next` itself and it must be named, not folded into a count:** `next 9.5.6-canary.0 - 10.0.7 || 14.3.0-canary.0 - 15.5.23 || 15.6.0-canary.0 - 16.3.2` — GHSA-p293-qw3h-jr36 (unauthenticated RCE on windows-hosted servers) and GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE in the Image Optimization API when AVIF files are used). This repo runs `next@16.2.11`, which is INSIDE that range. ⚠️ **Exposure was assessed, and the assessment is why this sits here rather than pre-empting the milestone (founder decision, 2026-09-13):** the Windows arm is N/A (prod is Vercel/Linux); the AVIF arm needs AVIF in `images.formats`, and `next.config.ts` has no `images` block at all, so the default (webp) applies and AVIF is not opted into; there are no `remotePatterns`, so only same-origin images optimize; and no component imports `next/image` (the only repo hits are `src/proxy.ts` and its test, which EXCLUDE `_next/image` from the auth matcher at `proxy.ts:184`). ⛔ **But the optimizer endpoint IS live and unauthenticated** — measured on prod: `GET /_next/image?url=%2Ffavicon.ico&w=64&q=75` → `200`, and it returned `image/x-icon` even under `Accept: image/avif`, consistent with AVIF being off. So the finding is: vulnerable VERSION, no demonstrated path, `npm audit fix` available. The other named highs are `brace-expansion` (GHSA-rgw5-rvv9-x895), `browserslist` (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g), `fast-uri`, `ip-address` and `nanoid`. ⚠️ `fast-uri` already carries a repo override (criterion 3 bumps it `^3.1.4` → `^3.1.5`) — re-measure before assuming that closes it. ⛔ Closing this by adding an audit-allowlist file is FORBIDDEN by criterion 3 and stays forbidden here.

**Plans**: TBD

**Research note:** see Phase 165's research note (it is STACK.md-wide). The `knip` suspicion there applies to this phase's npm group.

### v1.20 Progress

⛔ **Regenerate, do not trust.** Every count below is derived from PLAN/SUMMARY artifacts
across ALL REFS, not from this checkout — the `-pr` filter strips `.planning/phases/**`, so
four complete phases (164.2, 164.5, 164.8.2, 164.8.5 — 29 finished plans) read `empty` on
local disk and `gsd-tools query roadmap.analyze` under-reports them by construction. Measured
2026-09-12 at `733a55f5`. A withdrawn plan is excluded from its phase's denominator and the
withdrawal is named in the Status cell — a re-routed plan is not an unfinished one.

**Totals: 19 of 33 phases fully executed; 160 of 163 live plans carry a SUMMARY.**
The three without one are named in their rows; none is unfinished work.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 158. OPS-CI merge=deploy | 6/6 | Complete    | 2026-08-21 |
| 159. RANK ranking integrity | 6/7 | Complete — plan 01 shipped its deliverable (`159-CENSUS.md` is on disk); its SUMMARY was never written. `159-VERIFICATION.md` closed 2026-09-12 (`status: passed`): its one open item, the concurrent same-session CAS race, is discharged by `src/__tests__/csv-finalize-concurrent-never-classified.test.ts` on the blocking `frontend-local-stack` lane — green in main run 34712535912 at `733a55f5` | v0.70.0.0 |
| 160. PROVENANCE venue/annualization | 6/7 | 🟡 Arm proven, 1/3 surfaces. Plan 07 is `gap_closure: true` and writes `160-VERIFICATION.md`, which reads `status: passed` / `previous_status: gaps_found` — it ran; its SUMMARY was never written | Persist arm smoked via ApiKeyManager 2026-08-25; StrategyForm un-smoked, AllocatorExchangeManager unmounted |
| 161. WIZERR honest errors | 10/10 | Complete | v0.72.0.0 |
| 161.1 LEDGER-REFRESH (shipped dormant) | 5/5 | Complete | v0.73.0.0 |
| 162. HONEST visible truth | 9/9 | Complete — plan 10 WITHDRAWN in `3fa26831` ("its premise was false, credentials ARE trimmed"), so the denominator is 9, not 10 | v0.74.0.0 |
| 163. HARDEN reliability + security | 9/9 | Complete | v0.75.0.0 |
| 164. SHARE revocable links | 7/7 | Complete | v0.76.0.0 |
| 164.1 PROD-OBSERVABILITY (one prober: PYAPI-06, CRON-OBS-01, CRON-DRIFT-01, MT5-WEDGE-OBS-01) | 6/6 | Complete — PR #746 `42868a9b` + PR #748 `d679f638`; VERIFIED 2026-09-18, `passed` 5/5. ⚠️ The cadence residual is NOT closed: booked `[PROBER-CADENCE-UNDELIVERED-01]`, owner Phase 164.1.1 | v0.77.15.0 · 2026-09-18 |
| 164.2 CURATED-COPY (+ WIZFORM-02, WR-06-UTC both bucketers, HONEST-08-RESIDUAL, 161-ERRPREFIX) | 10/10 | Complete — PR #749 merged `05994f1d`, main CI green, PROD verified by effect. All 21 artifacts stripped from main by `22a5fe96` | v0.77.16.0 |
| 164.2.1 SESSIONID-FENCE | 2/2 | Complete | v0.77.17.0 |
| 164.3 VACUITY (+ SKIP-01, DRIFT-01, OPS-08-F9/F8 routed on, H-0001 routed on) | 9/10 | Complete — plan 07 (VAC-07) DEFERRED to 164.5 by founder decision 2026-08-29, stays unchecked | v0.77.0.0 |
| 164.3.1 SOUND-PRIMITIVES (four cycling primitives) | 13/13 | Complete | v0.77.1.x |
| 164.4 REDUNDER-BACKFILL (39 idiom files annotated; 5 pg_cron-blocked files handed to 164.4.1) | 12/12 | Complete — the phase was planned as 13 and replanned to 12 against the Plan 00 spike (`9b83b064`); plan 12 was dropped there, not left undone | v0.77.12.0 |
| 164.4.1 PGCRON-LANE (pg_cron on the lane; 5 deferred gates annotated; lane-blocked 0; ARMS_FLOOR 361) | 6/6 | Complete — PR #744 merged `e01cc2e6`, ubuntu-measured | v0.77.13.0 |
| 164.5 BASELINE-SNAPSHOT (baseline.sql load-bearing, DRIFT-04 drop, DRIFT-05, VAC08-LEDGER, VAC-07) | 7/7 | Complete — DRIFT-04 applied and shipped 2026-09-08 in the two-PR sequence. Plan 08 was LIFTED into new Phase 164.5.2 BRIDGELOCK (`7910f614`), so the denominator is 7 | v0.77.21.0 |
| 164.5.1 CRONREPOINT (the live `match_engine_cron` row repointed; migration-vs-runbook rule settled first) | 9/9 | Complete    | 2026-09-17 |
| 164.5.2 BRIDGELOCK (the per-strategy advisory lock 161.1-D1 asked for) | 0/? | Queued — created 2026-09-08 by lifting 164.5 plan 08, as DEC-4 required | - |
| 164.6 GATE-HYGIENE (OPS-08 residue, composite-stamp twin, PROC-02/03, H-0001, PHASEDIR-ORPHAN-GITKEEP) | 0/? | Queued (created 2026-09-05) | - |
| 164.7 APPSETTINGS (every `app.*` GUC reader moves off ALTER DATABASE/ROLE — both 42501 on PROD) | 7/7 | Complete — finalized v0.77.32.1; its 33 stranded artifacts restored to main by PR #785. Row said `0/? Queued 2nd` until 2026-09-12 | v0.77.32.1 |
| 164.8 TESTPREPROD (TEST becomes a real pre-prod: apply on merge to TEST before PROD) | 6/6 | Complete. Row said `3/6 Queued 5th` until 2026-09-12 | v0.77.31.2 |
| 164.8.1 REFDATA (a schema-only restore destroys migration-seeded reference data) | 4/4 | Complete — PR #767. ⚠️ `164.8.1-04-SUMMARY.md` is still stranded off main; local disk reads 4/3 | - |
| 164.8.2 GATEHARDENING (the five code-review warnings 164.8 shipped) | 5/5 (+4 FIX) | Complete — four review rounds; residual deferrals routed to 164.8.4 | v0.77.32.0 |
| 164.8.3 PROBERAUTH (MT5 `-6` named as "no authorized account", not the catch-all) | 4/4 | Complete    | 2026-09-13 |
| 164.8.4 GATERESIDUE (164.8.2's four review rounds + the withdrawn `tokenMeasure` redesign) | 0/? | Queued (created 2026-09-10) | - |
| 164.8.5 PROBERPARSE (prober hygiene rules stop being dodgeable; the parser stops dropping rows) | 7/7 (+4 FIX) | Complete — PR #774 | - |
| 164.8.6 VAULTTICKFIX (the forward migration Phase 164.7 earned) | 8/8 | Complete — PR #778, follow-ups #779/#781/#782. ⛔ Plan 08 WITHDRAWN not shipped (`tokenMeasure` fired the credential rule on credential-free prose); redesign routed to 164.8.4 | v0.77.34.0 |
| 164.9 TESTISOLATION (per-run isolation replaces global truth on shared TEST) | 0/? | Queued — owns `[164.8-PUSH-RACE-VAC08]`, `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`, and writing the real `FANOUT-GLOBAL-01` entry | - |
| 164.10 BODYDRIFT (PROD runs an EARLIER revision of three function bodies) | 0/? | Queued (created 2026-09-11) | - |
| 166. QSTATS-TRUTH | 0/? | Queued (re-ordered ahead of 165, 2026-09-05) | - |
| 167. CREDTRUST (an invalid venue credential is named to the customer) | 0/? | Queued | - |
| 168. DRBOPTIONS (a Deribit options account ingests end to end) | 0/? | Queued — Alpha Centauri is blocked by a `native_nav` inception reconciliation breach (`breach_ratio=436`), NOT by `[DERIBIT-ASSIGNMENT-UNCLASSIFIED]` | - |
| 165. DEPS dependabot campaign | 0/? | Queued LAST (after 166 — dependency churn lands last) | - |

### Requirement Coverage (v1.20)

| Phase | Requirements |
|-------|--------------|
| 158 | OPS-01, OPS-02, OPS-03, OPS-04, OPS-11 |
| 159 | RANK-01, RANK-02, RANK-05, RANK-06, RANK-07, RANK-08, RANK-09 |
| 160 | RANK-03, RANK-04 |
| 161 | WIZERR-01, WIZERR-02, WIZERR-03, WIZERR-04, WIZERR-05, WIZERR-06, WIZERR-07, WIZERR-08, WIZERR-09, WIZERR-10, WIZERR-11, WIZERR-12, WIZERR-13 |
| 162 | HONEST-01, HONEST-02, HONEST-03, HONEST-04, HONEST-05, HONEST-06 |
| 163 | OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, HONEST-08 |
| 164 | SHARE-01, SHARE-02, SHARE-03, SHARE-04 |
| 164.3 | VAC-01, VAC-02, VAC-03, VAC-04, VAC-05, VAC-06, VAC-08 |
| 164.5 | VAC-07 (deferred from 164.3, `[VAC-07-DEFER]`) |
| 165 | DEPS-01 |

**49/50 v1.20 requirement IDs mapped, each to exactly one phase. ONE deliberately unassigned: HONEST-07 (root cause of a retired job kind with no site at HEAD — REQUIREMENTS marks it Deferred, reassess at the milestone audit; it is not silently counted as mapped). The eight VAC-* IDs were added 2026-08-28 and were missing from this table until 2026-09-05.**
(Per-requirement traceability: `.planning/REQUIREMENTS.md` § Traceability.)

## Parked Milestone: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157) — founder-gated

**Goal:** The numbers Quantalyze renders for the live funded MT5 account are proven true against
the terminal's own figures — and the handful of observations only the founder can make are made.

⛔ **EVERY phase in this milestone is founder-gated. That is its defining property, not an
accident of sequencing.** Nothing here can be delivered by an agent. The milestone was created on
2026-08-14 so that the agent-deliverable work in v1.17 could close without waiting on a calendar.

**Blocked on, both required:**

1. ⛔ **New MT5 investor passwords.** The founder changed the account passwords on/around
   2026-08-14, so the stored credentials are stale and will not authenticate. MEASURED on PROD
   that day: three `mt5` keys exist (labels `FX-AI_V`, `MM2`, `MM3` — ⚠️ **there is NO key
   labelled `MM1`**, so the founder's "MM1 and MM2 are erroring" does not map 1:1 onto stored
   rows; **re-verify ALL THREE at reconnect**), all `disconnected_at IS NULL`, all
   `sync_status='complete'` with `last_sync_at` 04:01–04:07 UTC — those are the last *successful*
   syncs, taken **before** the change.
   ⛔ **When these flip to `error`, that is EXPECTED. Do not investigate it as a code defect.**

2. ⛔ **The founder physically at the MT5 terminal, on a TRADING day**, with the live funded
   account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run
   does not satisfy it.

**Settled inputs — do not re-litigate:**

- Parity tolerance **1%, INCLUDING open P&L** (founder call 2026-08-14). Adjustable later; keep it
  a named test constant, never a hardcoded literal.

- ⭐ **The measurement window MUST end before the day of the run.** `broker_dailies` anchors to
  today — initial capital is derived as `current_equity − total_pnl` — so reconstruction error
  accrues *backward into the past*. Comparing today's equity is therefore near-tautological, and a
  historical window is the only one that can actually fail.

**Requirements:** MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)

⛔ **Do not advertise MT5 until Phase 155 passes.** Carried verbatim from v1.17.

---

## Shipped Milestone: v1.19 JOB/RATE — job-lifecycle reliability and the rate limits that hold (Phases 143–146 + 146.1, 146.2) ✅ CLOSED 2026-08-20

**Closed 2026-08-20** at v0.68.1.0 (`00e73aa5`), PRs #687–#695. 6/6 phases passed, 9/9
requirements satisfied (JOB-04/05/06/08, RATE-01..05). Audit: `.planning/v1.19-MILESTONE-AUDIT.md`
— `tech_debt`: INT-1..4 filed to TODOS.md (cross-phase readmit reachability + Next-side limiter
coverage law; measured-ZERO populations on PROD, fail-safe direction, none blocking under the
stopping rule). Full section + phase detail archived at
`.planning/milestones/v1.19-ROADMAP.md`; requirements extract at
`.planning/milestones/v1.19-REQUIREMENTS.md`.

**What v1.19 earns:** a dropped compute-job enqueue is detected by absence and healed (sweep LIVE
on PROD, hourly tick observed); an orphaned `running` job terminates VISIBLY (terminal `failed`,
never DELETE — WR-02 resolved); csv-finalize is ONE SECURITY DEFINER transaction (mid-fold fault
proven to leave ZERO rows); every authed route that reaches the Python service carries a limiter
enforced by a coverage law (Python whole-surface; Next seam-scoped — widening filed as INT-2).
Rider: local analytics-service now defaults to TEST and hard-stops before becoming a PROD worker
(#695).

## v1.19 phase detail, retained (Phases 143–146; 146.1/146.2 under Phase Details below)

### Phase 143: JOB — Dropped-enqueue reconciliation sweep

**Goal**: "`after()` never ran at all" enqueue drops — architecturally invisible from inside the route handler — are detected by absence and healed
**Depends on**: Phase 142 (same three-table triangle; scheduled as one non-racing mechanism)
**Requirements**: JOB-04
**Success Criteria** (what must be TRUE):

  1. A strategy with persisted daily-returns data but NO `compute_jobs` row of ANY status and no terminal `strategy_analytics` row, past a grace window, is re-enqueued by a pg_cron sweep and a Sentry alert fires — the hole the in-closure `writeFailedStrategyAnalyticsPlaceholder` guard structurally cannot catch.
  2. Running the sweep twice in a row produces no duplicate job. ⚠️ MECHANISM CORRECTED 2026-08-16 (Phase 143-02, falsified by an observed neuter): the operative guard is the sweep's `FOR UPDATE SKIP LOCKED` — an INSERT into `compute_jobs` key-share-locks its parent `strategies` row — NOT the partial unique index. Sequential double-execution cannot conflict at all, because tick 1's INSERT removes the strategy from the zero-jobs conjunct. The index only redeems a genuine READ COMMITTED race with `SKIP LOCKED` also removed. Corollary: a gate that runs the body twice in one session CANNOT FAIL and must not be written.
  3. A strategy inside the grace window, or with any existing job row, or with a terminal analytics row, is never touched by the sweep.

**Plans:** 4/4 plans executed

Plans:
**Wave 1**

- [x] 143-01-PLAN.md — Worker alert path: init_sentry() into main_worker.main() + reconcile-sweep marker capture on claim (the D-11 correction; RED-first pytests)
- [x] 143-02-PLAN.md — Census (TEST+PROD, STOP rules) + the sweep migration (inline pg_cron body, MATERIALIZED LIMIT 25, hourly at :35, composite-excluded) + throwaway-Postgres end-to-end tracer proof

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 143-03-PLAN.md — CI gates: SQL gate Parts 1-4 (deployed-body oracle), TS migration-content gate, pytest cross-language marker contract; nine observed neuter REDs

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 143-04-PLAN.md — [BLOCKING] Apply to TEST via Supabase MCP, sql-tests RED→GREEN, ONE real tick heals a seeded orphan (the FORCE-RLS/L-2 proof), worker SENTRY_DSN verdict, TODOS deferrals, human gate

**Note**: Constrained by JOB-07 (Phase 142) — sweep runs in pg_cron, never the worker loop. The "what counts as orphaned" design pass is settled in 143-CONTEXT.md + 143-02-PLAN.md's decision map (source-agnostic dailies anchor; ANY-kind/ANY-status job conjunct; terminal-analytics safety conjunct; composites and the wizard first-hop drop excluded as documented non-coverage).

### Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence

**Goal**: An orphaned `running` compute job terminates VISIBLY — pollers break out, the audit trail survives — resolving the founder's open WR-02 DELETE-vs-reset call
**Depends on**: Phase 143 (JOB sequence; independent mechanism on `compute_jobs`)
**Requirements**: JOB-05, JOB-08
**Success Criteria** (what must be TRUE):

  1. An orphaned `running` `compute_jobs` row (past the UNCHANGED 4h `claimed_at` threshold) transitions to a terminal `failed` status instead of being DELETEd — so a wizard poller sees a real outcome and the row survives for audit until the existing 30/90-day retention crons delete it.
  2. Detection latency drops from ~24h to the tightened cadence (e.g. hourly) while a legitimate batch-tail job under 4h is never touched — the threshold, not the frequency, is what protects live jobs (the WORKER-04 2h→4h lesson).
  3. The change ships as a NEW migration layered on `20260720120000` (the shipped migration is never edited), reconciling the TEST-DELETE / PROD-reset split into ONE behavior.
  4. A committed measurement of the stale-`pending` `compute_jobs` population **on PROD** exists BEFORE any stale-`pending` sweep is scoped, and the gap is closed EITHER by adding `pending` as a fourth swept status (using SC 1's terminal-UPDATE pattern, never `DELETE`) OR by an explicit WON'T-FIX carrying that measurement — "zero on prod" is a valid, budget-saving outcome. The retention family covers `done` (jobid 4), `failed_*` (jobid 8) and orphaned `running` (⚠️ jobids are per-project and NOT stable across a re-registration — measured 2026-08-17: TEST moved 11 → 19 when Phase 144's terminalizer applied, and PROD has always been 29, never 11. Identify these jobs by JOBNAME; that is what the SQL gates anchor on); stale `pending` is the one status an undrained enqueue cron produces and the only one nothing sweeps.

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 144-01-PLAN.md — The terminalizer migration (two-arm bounded terminal UPDATE, `'50 * * * *'`, 4h claimed_at arm + derived-48h NULL-claim arm) + throwaway-Postgres tracer proof + the SAME-COMMIT rewrite of test_retention_orphaned_running.sql (B1 DELETE-oracle, B2 hour-band cast, B3 next_attempt_at) + neuter-RED matrix

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 144-02-PLAN.md — TS migration-content gate (occurrence counts recalibrated for the two-arm body, word-bounded LIMIT, later-migration re-registration scan) + JOB-08 WON'T-FIX-with-measurement in REQUIREMENTS.md + three TODOS deferrals

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 144-03-PLAN.md — [BLOCKING, orchestrator-session-only] Pre-apply re-census + §3 NULL-claim confirming query + live slot check, apply to TEST via Supabase MCP, sql-tests RED→GREEN, ≥2 successive real :50 ticks observed against the live 402-row fixture proving the per-arm `LIMIT 100` bound HOLDS and PROGRESSES (exactly 100 arm-A rows per tick, oldest-first, disjoint id sets) — draining the backlog is explicitly NOT the goal and NOT a merge gate; conservation + B3 verified row-by-row; human gate before the one-way merge

**Note**: The "fence flake also clears" claim is observation-only, NOT an acceptance criterion (research correction #4). Constrained by JOB-07 (pg_cron only).
**Note (SC 4 / JOB-08, added 2026-08-03)**: routed here from `TODOS.md` § CI / test-infra ratchet — same table, same cron family this phase already edits, and SC 3's TEST-vs-PROD split is the same gap. Full evidence and the two ⛔ traps (never `DELETE` pending; never `cron.unschedule(9)`) are in `REQUIREMENTS.md` § JOB-08. ⚠️ The gap is CERTAIN on the TEST project and UNMEASURED on prod — that asymmetry is why SC 4 is measure-first rather than build-first.

### Phase 145: JOB — csv-finalize atomicity (reproduce-first)

**Goal**: A mid-request csv-finalize failure leaves no orphan strategy row — and no budget is spent re-fixing the likely-stale 42501 bug
**Depends on**: Phase 144 (JOB sequence; order-independent within JOB — last because its scope needs the reproduction result first)
**Requirements**: JOB-06
**Success Criteria** (what must be TRUE):

  1. A documented reproduction attempt of the 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim against current `main` exists (committed pass/fail) BEFORE any fix is scoped — "could not reproduce" is a valid, budget-saving outcome.
  2. A fault injected between `finalize_csv_strategy`, `persist_csv_daily_returns`, and the `after()` enqueue leaves no orphan strategy row — either the steps share one SECURITY DEFINER transaction, or explicit compensating cleanup runs + Sentry alerts (the choice recorded per the reproduction outcome and the CONTRIB-02 `p_terminal_status` owner-only variant's survival).
  3. Happy-path csv-finalize behavior is unchanged — including the CONTRIB-02 owner-only private-finalize path if the RPCs are folded.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 145-01-PLAN.md — SC#1 repo-side arms: 42501 auth-guard SQL CI gate (arm 1, neuter-RED proven on throwaway Postgres against the REAL 20260728120000 body) + fresh arm-2 grep + arm-3 pytest recorded verbatim + 145-REPRODUCTION.md draft + PITFALLS/SUMMARY anchor corrections, ONE commit

**Wave 2** *(blocked on Wave 1; orchestrator-session-only, BLOCKING)*

- [x] 145-02-PLAN.md — [BLOCKING] Census (4 queries × 2 projects, per-row, STOP rules pre-registered) + arm-4 live TEST finalize (doubles as SC#3 baseline) + (i-a) seam latency measurement Steps A/B/C + final CANNOT-REPRODUCE verdict + TODOS 42501 bullet closed + founder decision checkpoint (i-a)/(i-b) recorded in 145-DECISION.md

**Wave 3** *(blocked on Wave 2 — verdict committed before any SC#2 code)*

- [x] 145-03-PLAN.md — The caller-agnostic fold migration (`finalize_csv_strategy_with_returns`, ONE SECDEF transaction, no exception-handler clause, 20260624120000 table shape, guards verbatim, DROP old RPCs + re-grant) + SAME-COMMIT re-point of test_csv_finalize_double_submit.sql (Part 3 widened to 3 tables) and the auth-guard gate + new atomicity-oracle gate + throwaway-Postgres tracer proof + 8-neuter SQL RED matrix

**Wave 4** *(blocked on Wave 3 + the recorded decision)*

- [x] 145-04-PLAN.md — Caller wiring per 145-DECISION.md (both arms specified; exactly one executed) + read-only 23505 resolve arm with CR-01 name/range checks BEFORE metadata (fixes the 409 lie) + three honest copy sentences + finalize-fold-fail / finalize-resolve-refused Sentry captures + SAME-COMMIT re-point of the five CR-01 tests (each observed RED) + pytest/mypy --strict

**Wave 5** *(blocked on Wave 4)*

- [x] 145-05-PLAN.md — Delete the vacuous RED-TEAM-M1 block + replacement gates that CAN fail (3 observed neuter-REDs) + three TODOS deferrals with constraints (window E, wizard first-hop, inert flag cleanup w/ 20260620120000 RAISE trap) + consolidated TS neuter-RED table

**Wave 6** *(blocked on Waves 3-5; orchestrator-session-only, BLOCKING)*

- [x] 145-06-PLAN.md — [BLOCKING] Apply fold to TEST via Supabase MCP (never db push), sql-tests observed RED→GREEN, live finalize + SC#3 measured before/after diff vs the arm-4 baseline, one-time human-reviewed TERMINALIZE of the census list (UPDATE-only: analytics 'failed'+reason then status='archived'; founder ruling β), human gate before the one-way merge

**Note**: Constrained by JOB-07 (any cleanup mechanism stays off the worker loop). Founder rulings locked 2026-08-17: (1) orphan disposition = TERMINALIZE reading (β) — deletion arms out of scope; (2) the (i-a)/(i-b) caller choice is measure-first and founder-reserved — Plan 02 executes the measurement and stops at a decision checkpoint. ⛔ 20260816140000 (143) and 20260817120000 (144) untouched by every plan.

### Phase 146: RATE — Audit + close the two verified gaps

**Goal**: Every authed route hitting the Python service has the RIGHT rate limit — and a newly-added route can't silently ship with none
**Depends on**: Nothing upstream (mechanical; sequenced last so its gap list comes from a fresh grep)
**Requirements**: RATE-01, RATE-02, RATE-03, RATE-04, RATE-05
**Success Criteria** (what must be TRUE):

  1. A committed kickoff re-grep artifact lists every `src/app/api` route calling either seam client × its `checkLimit` status — the authoritative gap list, replacing the stale `TODOS.md` route list (which named seven routes that were already limited).
  2. Burst requests to `admin/match/eval` beyond a per-`user.id` limit sized to real eval-tooling cadence receive `429` + `Retry-After`.
  3. Requests hitting Railway's `routers/match.py` (`/recompute`, `/eval`) directly — bypassing Vercel with a leaked `X-Service-Key` — are rejected `429` by server-side slowapi limits mirroring `portfolio.py`'s pattern (defense-in-depth).
  4. A committed audit of the seven existing limiter VALUES against real Python-side cost exists, with adjustments applied where a value was wrong — the substantive remaining RATE question. *(Disposition locked D-146-4, 146-CONTEXT.md: the audit RECORDS each mismatch with a measured-numbers recommendation (146-AUDIT.md §3, full 14-route surface); value ADJUSTMENTS are founder-queued via TODOS.md "Phase 146 — RATE-04 value-parity candidates" — retuning live limits is founder territory, zero values changed in-phase; reversal point = ship gate.)*
  5. A `withRateLimit(handler, limiter)` HOF exists and composes alongside `withAuth`/`withRole`, wired on the routes this phase touches — so the no-CI-gate hand-wiring weakness has a structural successor. *(Disposition locked D-146-1, 146-CONTEXT.md: satisfied VERIFIED-EXISTING by `withAuthLimited` + `withAdminAuth({rateLimitKey})` + the two CI gates, with a fresh-grep receipt — no second wrapper; reversal point = ship gate.)*

**Plans:** 3/3 plans executed

Plans:
**Wave 1**

- [x] 146-01-PLAN.md — RATE-02 eval limiter (mirror recompute, 3 rosters same-commit) + RATE-01 fresh census + RATE-05 VERIFIED-EXISTING receipt into 146-AUDIT.md; retire stale TODOS bullet

**Wave 2** *(blocked on Wave 1)*

- [x] 146-02-PLAN.md — RATE-03/TS-21 match.py slowapi limiters (5 gates same-commit, tripwire deleted) + TS-23-remainder 429→service_error w/ Retry-After preserved + TS-36 parity pytest; pytest+mypy --strict from analytics-service/

**Wave 3** *(blocked on Waves 1-2)*

- [x] 146-03-PLAN.md — RATE-04/TS-22 value parity audit (fresh tables at HEAD, per-mismatch recommendations, value candidates → TODOS per D-146-4) + phase close w/ checkbox discipline

---

## v1.17 phase detail, retained (Phases 147–156)

**Goal:** MT5 *works* in the founder's sense rather than the wizard's — it ingests (done), it
projects in a scenario, and its factsheet is viewable by the allocator who uploaded it.

**Founder verbatim (2026-08-04, minutes after MT5-05 was discharged on PROD):**
> *"The goal is that MT5 works. And at the moment, maybe it ingests the data, but I cannot use it
> in the scenario, and I can still not produce a factsheet."*

**Scope:** 30 in-scope requirement IDs — SCEN-01..05, AUM-01..05, NAV-01, OWN-02..05, MT5-06..10,
MT5-14, MT5-15, WIZFORM-01..05, WIZCONT-01..02, STALE-01, plus the umbrella acceptance requirement
MT5-GOAL-01 — per `.planning/REQUIREMENTS.md`. ⛔ OWN-01 excluded (already met — CONTRIB-03,
verified in code 2026-08-04; do not re-implement). ⛔ SEAM / JOB / RATE / PYAPI* / SEAMCORE /
SEAMUX remain v1.16 (PARKED below) and appear in NO v1.17 phase. Research SKIPPED (zero new
external features; every requirement is an already-root-caused defect carrying PROD evidence and
file:line citations in REQUIREMENTS.md). Phase numbering continues from 147 (v1.16 ended at 146).

⭐ **Defining constraint: almost NONE of this is an MT5 defect.** MT5 is the first venue to
traverse the whole path from a cold start, so it is exposing pre-existing holes in the surfaces
AFTER ingestion. SCEN-01 affects every real strategy at every venue; OWN-02 blocks every
unpublished strategy; AUM-05 will hit sFOX the day its flag flips. **A fix scoped to
`exchange === 'mt5'` is the wrong fix for nearly all of it.**

**Ordering rationale (non-negotiable — these are real dependencies, not preferences):**

- **SCEN-01 (147) FIRST** — a silent money-path correctness bug
  (`strategy_analytics.daily_returns` has NO production writer: 0 of 27 real strategies populated
  vs 15/15 demo seeds) AND it blocks meaningful verification of every other scenario surface —
  you cannot judge a composer whose engine receives an empty series.

- **OWN-02 (148) before NAV-01 (149), OWN-04 (same phase, strictly after) and SCEN-03 (152)** —
  all three link to a factsheet that today 404s; shipping them first builds the exact dead-end the
  previous milestone existed to delete.

- **148/149/150 split (revision 2026-08-04, superseding the approved single Phase 148):** the
  approved roadmap carried OWN-02 + OWN-03 + OWN-04 + NAV-01 as one phase. NAV-01 was then
  SHARPENED by the founder from "an overview" to a full **ranking at discovery parity** over every
  uploaded key incl. `private`/`draft` rows, and the bundled phase would have mixed three review
  profiles that dilute each other: a cache-disclosure fix with an adversarial acceptance test
  (OWN-02), a parity/no-invented-data UI surface (NAV-01), and the OWN set's first money-path
  WRITE (OWN-03, founder-mandated money-path review). Split so each gets the review it needs;
  every ordering constraint is unchanged and now structural (149 cannot start before 148).

- **AUM (151) after SCEN-01** — its symptom (zeros on screen) is entangled with SCEN-01's and
  would otherwise appear unfixed. ⚠️ AUM-01 does NOT fix the 0.00 metrics — that is SCEN-01.

- **MT5-06..10 (155) LAST** — they need a live funded account on a real trading day and a stable
  surface to measure; running them earlier means re-running them.

## Phases

- [x] **Phase 147: SCEN-01 — The scenario engine receives the real series** - Fix the READER (never the writer): every added strategy contributes its actual daily returns via the existing `resolveDailyReturnSeries`; wealth-index `returns_series` is differenced, never forwarded raw (completed 2026-08-05)
- [x] **Phase 148: OWN — Owner factsheet without cache disclosure** - The owner views the full factsheet of their own unpublished strategy; adversarial anon-404 acceptance on the public `unstable_cache`d route; wizard-preview link that can never dead-end (OWN-04 strictly after OWN-02) (completed 2026-08-05)
- [x] **Phase 149: NAV — "My strategies": a ranking at discovery parity** - Sidebar entry showing every uploaded key + derived strategy incl. `private`/`draft` rows, ranked with the SAME component/query as the external ranking (visibility predicate is the only difference); honest pending states, never zeros (completed 2026-08-05)
- [x] **Phase 150: OWN-03 — The wizard asks whose capital this is** - Own-capital-with-allocation vs verifying-a-team question at allocator finalize; (b) stays the default and a no-op; only an explicit (a) creates the portfolio position (money-path reviewed) (completed 2026-08-06)
- [x] **Phase 151: AUM — A book you can reach and a size you can set** - Direct AUM input, non-ccxt holdings-sync crash fixed as a CLASS (MT5 + latent sFOX), all-or-nothing book gate fixed incl. cross-role contamination, honest refusal copy (completed 2026-08-07)
- [x] **Phase 152: SCEN — Composer legibility** - Ownership marker, clickable rows with a working factsheet link, labelled numbers, no duplicate browse entries (completed 2026-08-07)
- [x] **Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable)** ✅ **GOAL MET 2026-08-14 — via the INSERTED Phase 153.7, not by the original span.** Inline field validation, honest error codes from emitting sites, transient infra absorbed not surfaced, venue-appropriate copy, MT5 preselected in metadata. ⭐ **The mechanism is named on purpose and a bare tick would erase it:** the 153.1→153.6 span verdict REMAINS `failed` 5/6 in `153-VERIFICATION.md` and must not be rewritten — that file is the historical record that the span shipped short on WIZFORM-02. Phase 153.7 closed all four of its `missing` items, re-derived from source by the v1.17 milestone audit (router-vocabulary disposition at `wizardErrors.ts:3081`; population root widened at `seam-venue-vocabulary.invariant.test.ts:89` plus the `service_error` callee family at `:318`; boundary decision with per-exclusion reasons and count pins at `SCAN_EXCLUSIONS:134`; `KNOWN_CODELESS_FINALIZE_REJECTIONS = 0`), with both invariants executed at this tree — 2 files / 60 tests passed
- [x] **Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens** - Draft-aware entry chooser, stale-screen root cause investigated BEFORE fixed (verdict M2(ii)), token-less credential dedup toward the existing row (completed 2026-08-12)
- [x] **Phase 153.7: WIZFORM-02-CLASS — every code that can reach a user is covered** ✅ **COMPLETE 2026-08-14** (INSERTED 2026-08-14) - The coverage law's population is DERIVED from every user-reachable code (`analytics-service/**`, positional `service_error(...)` as well as `error_code =`), and a code absent from BOTH halves reds CI; closes the one requirement the 153 span failed. 3/3 plans: population 17 → 37, all 37 dispositioned, and the last three code-less `finalize-wizard` rejections coded (ledger 3 → 0 with `EXPECTED_FINALIZE_REJECTION_SITES` never edited). **WIZFORM-02 ticked.** ⛔ NOT "add two rows" — see TODOS.md FIX NOW #6
- [→] **Phase 155: MT5-VERIFY — The numbers are true, live on a trading day** — ➡️ **CARRIED OUT OF v1.17 TO v1.18 on 2026-08-14.** Not started, not dropped, not ticked. Server-UTC offset measured, external-oracle parity on the live funded account, five surfaces agree, discrepancies fixed (uncapped), warnings explained; MT5-GOAL-01 acceptance gate. ⛔ Founder-gated twice over: new investor passwords AND the founder at the terminal on a trading day. Detail block below is retained in place; the milestone header at the top of this file owns its blockers
- [→] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make** — ➡️ **v1.18** (CREATED 2026-08-14). Discharges the human-verification items Phases 153.7 and 154 left open: the resume banner, the amber recomputing block, the four new copy members rendering (with NO Retry on `SEAM_INTERNAL_FAULT`), and the `MT5_SPIKE_INVESTOR_PASSWORD` rotation
- [x] **Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes** ✅ **COMPLETE 2026-08-13** - `attested_venue` written by a service-role writer from the venue this server observed a successful read-only authentication at; `authenticated` EXECUTE withdrawn from both wizard RPCs; closes the PARITY-04 deferred control (CR-01, was live on PROD). Shipped as TWO PRs with a live PROD gate between them. ⛔ The pull-forward-ahead-of-155 trigger (sFOX go-live) is now moot — the residual it protected against is closed

## Phase Details

### Phase 146.1: REVIEW: v1.19 xhigh close-out — fold guards, resolve-arm honesty, rate-gate completeness (INSERTED)

**Goal:** The 15-finding v1.19 xhigh review (2026-08-18) is closed: the fold refuses
NULL/empty/poisoned series (22023), the resolve arm refuses cross-flow and
constraint-mismatched echoes, failure copy never claims rollback it cannot observe, the
Python rate-limit surface has a route-enumeration gate a new route cannot silently bypass,
and the terminalizer's failed_final rows no longer exclude their strategies from the
reconciliation sweep — plus the v1.19-topical TODOS deferrals absorbed into one pass.
**Requirements**: A1-A4, B1-B5, C1-C4 — full roster with file anchors in `146.1-CONTEXT.md`. Four easy findings already fixed and merged as v0.66.0.1 (76adf961).
**Depends on:** Phase 146
**Plans:** 7 plans (plan 08 lifted to Phase 164.5.2 on 2026-09-07) across 6 waves. ⛔ Sequencing is MEASURED, not stylistic: five roster items
(B3/A2/A4/A3/C2) all edit `csv-finalize/route.ts` and run SERIAL in one agent; A1+B5+the new
fold-gate arms all edit `test_csv_finalize_atomic_fold.sql` and share ONE plan. Only the three
CONTEXT-named lanes are parallel (wave 1). ⚠️ Both migrations AUTO-APPLY to PROD on merge —
`146.1-08` is a blocking pre-merge gate and cannot be delegated to a worktree agent.

Plans:

- [x] 146.1-01-PLAN.md — wave 1 · A1 fold input guards (NULL / empty-non-trades / NaN·Inf·magnitude / absurd-date / duplicate-date) as a `CREATE OR REPLACE` forward migration `20260819130000`, its self-verify, the regenerated snapshot, the new fold-gate Parts, B5's re-homed 22023 guards, C4's Part 3d and the `service_role` REVOKE
- [x] 146.1-02-PLAN.md — wave 1 · B1 Python route-enumeration gate over `main.app.routes` with an empty-by-equality quarantine roster — RATE-03's "a new route cannot silently bypass" made true on the Python side, zero runtime change
- [x] 146.1-03-PLAN.md — wave 1 · B4 sweep readmits terminalizer-produced orphans via the NARROW marker predicate (migration `20260819130500`) + new must-heal arm C4; ⛔ the roster's blanket widening is refused — it reddens shipped arms C2/C3. Plus C3 documented
- [x] 146.1-04-PLAN.md — wave 2 · route cluster part 1 (serial): B3 constraint-name discrimination → A2 terminal-status refusal → C1 honest echo copy, plus C4's two resolve-arm fail-closed pins
- [x] 146.1-05-PLAN.md — wave 3 · route cluster part 2 (serial): A4 required `fresh` discriminator gating the metadata UPDATE → A3 commit-agnostic copy on the transport / lost-id classes → C2 handler collapse with its source-shape gates rewritten, not deleted
- [x] 146.1-06-PLAN.md — wave 4 · B2 founder call: STOP forwarding `X-User-Access-Token` from both routes, add a zero-emitter equality gate, and AMEND the Phase 140.2 obligation repo-wide in the SAME commit
- [x] 146.1-07-PLAN.md — wave 5 · C4 remainder: types regen + cast-through-unknown deletion + the audit-law consequence (coupled, one commit); RT-3 burned-signature persistence in the signed envelope; Python tombstone message-only (no new code — WIZFORM-02 is OPEN); the stale-comment batch
- [x] 146.1-08-PLAN.md — wave 6 · ORCHESTRATOR-ONLY pre/post-merge migration gate: PROD+TEST census, TEST rehearsal of both migrations, both SQL gate files EXECUTED on TEST, 14 named neuters observed RED and restored, blocking merge checkpoint, then post-merge PROD verification including one real `cron.job_run_details` tick

### Phase 146.2: REVIEW: 146.1 post-merge close-out — the echo path must not silently drop a strategy's classification, and the passphrase must not reach Sentry (INSERTED)

**Goal:** A CSV finalize that recovers via the resubmit path A3's own copy instructs lands the user's classification instead of silently defaulting it, and no raw exchange credential reaches Sentry.

**Success criteria:**

1. A resubmission that takes the 23505 echo path applies the submitted `category_id`/`asset_class` when the committed row has none, and REFUSES (409 `CSV_SESSION_REUSED`) when a present classification conflicts — the A2 identity rule extended to the second identity field.
2. `passphrase` is scrubbed from every Sentry capture site on the verify-strategy route, and the docblock's enumeration matches the array.
3. The B4 readmit predicate cannot drive an unbounded reaped-orphan retry loop.
4. RT-3's re-mint persists the NEW session id — a reload in the re-mint window cannot resume a spent id with the burn cleared.
5. Each fix carries a regression test that is observed RED under a named neuter.

**Requirements**: R1 (blocker), R2 (security), R3–R7 (correctness/honesty), W1–W3 (carried from the 145/146.1 verifications)
**Depends on:** Phase 146.1 (PR #692, squash `a6a2dee8`) — this phase reviews ITS output
**PROD exposure:** re-measured 2026-08-19 at plan time — `suspect_and_visible = 0`, zero csv strategies created since A4 ⇒ forward-fix only, NO backfill in scope
**Plans:** 8 plans across 3 waves. ⛔ Sequencing is the file-collision map: `csv-finalize/route.ts` is
SINGLE-OWNER SERIAL (plan 01 wave 1, plan 06 wave 2); the two migrations are one-way doors with
in-plan decision checkpoints, and plan 08 is the ORCHESTRATOR-ONLY 146.1-08-pattern migration gate
(TEST rehearsal → blocking merge checkpoint → PROD census) — it cannot be delegated to a worktree
agent. THE CRUX is ratified in plan 01: `category_id IS NULL` is the never-classified discriminator
(asset_class is NOT NULL DEFAULT 'traditional' — indistinguishable from a user choice), and the
trades-echo FILL-safety hole is settled with evidence (trades strategies structurally carry no
stored KPIs: enqueue gate + sweep dailies conjunct, both self-verify-pinned).

Plans:

**Wave 1**

- [ ] 146.2-01-r1-echo-classification-fill-refuse-PLAN.md — R1 BLOCKER: resolve-arm tri-state FILL/REFUSE/no-op on `category_id IS NULL`, A2-residual fail-closed status echo, economic oracle survives unchanged
- [ ] 146.2-02-r2-passphrase-sentry-scrub-PLAN.md — R2 SECURITY: passphrase joins the scrub array via a shared credential tuple; TRAP-1 seam test RED-first
- [ ] 146.2-03-r4-remint-persists-new-id-PLAN.md — R4: mint-first ordering, one save carries new id + cleared burn
- [ ] 146.2-04-r3-readmit-ceiling-migration-PLAN.md — R3: sweep readmit ceiling via marker-row count (zero DDL), migration `20260819150000`, gate arm C5 + the carried B4-BLANKET neuter actually RUN (checkpoint: ceiling N)
- [ ] 146.2-05-r5-fold-guard1-null-safe-w3-pins-PLAN.md — R5+W3+W2: fold GUARD 1 `IS NULL OR` migration `20260819151000` + snapshot regen, standing prosrc no-handler + service_role pins, double-submit prose re-cut (checkpoint: one-way door)

**Wave 2** *(blocked on plan 01)*

- [ ] 146.2-06-r7-resolve-pins-audit-event-PLAN.md — R7 date lower-bound mirror; undriven fail-closed arms pinned by step tag; c14 echo discrimination restored; `strategy.csv_finalize` audit event (absorbed item, decided IN SCOPE); two TODOS deferrals re-recorded
- [ ] 146.2-07-r6-echo-copy-render-w1-fixtures-PLAN.md — R6: echo `human_message` renders in-step with explicit continue (product call taken); W1 provenance constants re-typed from HEAD

**Wave 3** *(blocked on plans 04+05; ORCHESTRATOR-ONLY)*

- [ ] 146.2-08-migration-gate-orchestrator-PLAN.md — 146.1-08 pattern: TEST rehearsal of both migrations with all gate arms armed, blocking merge checkpoint, post-merge PROD census (ceiling body, one cron tick, GUARD 1 arm, ACLs, exposure still 0)

### Phase 147: SCEN-01 — The scenario engine receives the real series

**Goal**: A strategy added to a scenario contributes its actual return series — never silent zeros
**Depends on**: Nothing (first phase of v1.17)
**Requirements**: SCEN-01
**Success Criteria** (what must be TRUE):

  1. Adding any REAL (non-demo) strategy to a scenario — MT5, OKX, Bybit, CSV — projects non-zero metrics with an overlapping-days count matching its stored `csv_daily_returns` span (the founder's MT5 strategy contributes its 136 days, not "0 overlapping days" / 0.00 everywhere).
  2. The series the composer blends for a strategy equals the series that strategy's own detail pages render — both resolved through the ONE existing `resolveDailyReturnSeries`, with no third resolution mechanism minted (structurally asserted, not just observed).
  3. A wealth-index `returns_series` is never forwarded raw: a regression test feeds a series starting at exactly 1.0 and proves it is DIFFERENCED (day one is not +100%).
  4. A strategy with genuinely no stored series renders an honest empty/degraded state — never 0.00 metrics with no error, no warning, no empty-state.

**Plans**: 6 plans, 4 waves
Plans:
**Wave 1**

- [x] 147-01-PLAN.md — Foundation: resolve-series leaf extraction + SeriesState/deriveEmptySeriesState (16h age bound) (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 147-02-PLAN.md — Returns route (the SCEN-01 bug proper) + OG route: widen, resolve, series_state (wave 2)
- [x] 147-03-PLAN.md — Share path: Phase-84 sibling read + pure-layer resolver, zero DDL (wave 2)
- [x] 147-04-PLAN.md — Book path (`src/lib/queries.ts` — `getMyAllocationDashboard` defined :3323, its `portfolio_strategies` read :4217; the 4th reader): server-side resolution + derived series_state (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 147-05-PLAN.md — Composer UI: chip states syncing/no-series, tolerance, notes, SC4 matrix (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 147-06-PLAN.md — P6 reopen/refresh hydration fetch + SC2 structural grep-gate + audit/ledger closure (wave 4)

**Notes (binding traps)**:

- ⛔ **The READER is wrong, not the writer.** `strategy_analytics.daily_returns` has NO production writer at all (only the two demo/e2e seed scripts write it); the composer's returns route (`src/app/api/strategies/[id]/returns/route.ts` — the `strategy_analytics` `.select(` at :251-255) selects only that column. Do NOT backfill the column — that fights migration 087 (`20260428120919`, decision D-02), which deliberately moved heavy series off `strategy_analytics` (1MB TOAST ceiling).
- ⚠️ `returns_series` is a WEALTH INDEX — `_drop_nonfinite(cumprod(1+returns))`, verified on PROD for `4eab92b0`: starts at exactly 1.0, ends 0.7196. Shape-identical to `DailyPoint[]`, semantically inverted. It must be differenced.
- ⭐ Reuse `resolveDailyReturnSeries(daily_returns, returns_series)` — it already backs BOTH strategy-detail surfaces (`src/app/factsheet/[id]/v2/page.tsx` — `resolveDailyReturnSeries` call :121, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — same call :65), has its own tests, and its docstring names this exact bug. Rule 7: do not mint a third mechanism.

### Phase 148: OWN — Owner factsheet without cache disclosure

**Goal**: The allocator who uploaded a strategy can view its full factsheet from that account — while it stays invisible to everyone else, and publication stays admin-only
**Depends on**: Phase 147 (sequencing; OWN-02 is itself the hard prerequisite for every factsheet link shipped later — NAV-01 in 149, SCEN-03 in 152, and OWN-04 within this phase)
**Requirements**: OWN-02, OWN-04
**Success Criteria** (what must be TRUE):

  1. The owner, from the account that uploaded it, views the FULL factsheet of their own unpublished (private/draft) strategy — today `withPublishedOnly` at `src/app/factsheet/[id]/v2/page.tsx` — the public arm `fetchAndBuildPayload(id, withPublishedOnly)` :296, whose miss reaches `notFound()` :454 — 404s them.
  2. **Adversarial, not happy-path:** AFTER an owner has viewed their draft, an anonymous request for the same id still 404s — the public `unstable_cache`d factsheet route never serves a cache entry populated by an owner render. Proven by a test.
  3. The wizard preview links to the full factsheet, and no link shipped in this phase can land on `notFound()` (OWN-04 — strictly after OWN-02 within the phase).
  4. Nothing shipped here widens visibility beyond the owner: anonymous and non-owner authed requests still see published-only on every surface the gate change touches, and publication remains admin-only.

**Plans:** 5/5 plans complete

Plans:
**Wave 1**

- [x] 148-01-PLAN.md — viewerNotice banner capability in FactsheetView (additive prop, byte-neutral, UI-SPEC verbatim)
- [x] 148-02-PLAN.md — DI seam: fetchAndBuildPayload(id, visibility) required param; cached wrapper stays visibility-free with the withPublishedOnly literal; false cache-key comment corrected; force-dynamic pin

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 148-03-PLAN.md — Lane B owner lane (probe-first, uncached build) + page.owner-lane.test.tsx with unstable_cache SPY (SC1/SC2-A/SC4)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 148-04-PLAN.md — SC2-B structural CI invariant (147-guards clone) + Rule-9 mutations at two sites

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 148-05-PLAN.md — OWN-04 wizard link, both success branches, structurally absent pre-success + phase gate & VALIDATION sign-off

**UI hint**: yes
**Notes (binding traps)**:

- ⛔ **OWN-02 is NOT a one-line `withPublishedOnly` → `withPublishedOrOwner` swap.** The route is PUBLIC and `unstable_cache`d keyed on `${id}::${computedAt}`, and its own header justifies the cache as safe *because "the only fields we cache come from the published row."* An owner-inclusive gate without cache work is a disclosure bug (same class as the `strategy_analytics (*)` anon splat in TODOS). Criterion 2 is the acceptance test.
- ⛔ OWN-04 must not land before OWN-02 within the phase — a link to `notFound()` is the dead-end class Phase 142.2 existed to delete.
- ℹ️ NAV-01 (the "my strategies" ranking) moved to Phase 149 in the 2026-08-04 revision; it consumes this phase's cache-safe `withPublishedOrOwner` gate and MUST NOT be pulled forward into this phase.

### Phase 149: NAV — "My strategies": a ranking at discovery parity

**Goal**: The allocator side stops being write-only — a sidebar entry shows every key they uploaded and every strategy derived from them as a ranking at parity with the external/discovery ranking, and every row opens its factsheet
**Depends on**: Phase 148 (OWN-02 — both the cache-safe visibility predicate and a factsheet that resolves; a ranking whose rows link to `notFound()` is the dead-end class Phase 142.2 existed to delete)
**Requirements**: NAV-01
**Success Criteria** (what must be TRUE):

  1. A sidebar "my strategies" entry (MY WORKSPACE) opens a ranking covering **every key the allocator uploaded AND the strategies derived from them — including `private` and `draft` rows**, which are exactly what every existing ranking surface filters out. Proof case: the founder's account (8 active keys — bybit, okx, deribit ×3, mt5 ×3), none of which appears on any ranking today, all present here.
  2. The ranking is at **PARITY with the external/discovery ranking** — same metric columns, same sort affordances, same `#n` + percentile presentation per DESIGN.md — so the allocator judges their own uploads on the same axes they judge third-party strategies.
  3. **Structural reuse, asserted not merely observed:** the surface is the EXISTING ranking component/query, and the visibility predicate is the only genuine difference (own-including-unpublished via OWN-02's `withPublishedOrOwner`, vs published-only). No second ranking implementation exists to drift.
  4. Metrics for `private`/`draft` rows come from the same analytics the factsheet renders — never a placeholder or a reduced column set for unpublished rows; a row whose analytics have not computed yet shows an honest pending state, never zeros (no-invented-data).
  5. Clicking any row — including a `private`/`draft` one — opens its factsheet (via OWN-02), never `notFound()`.

**Plans**: 5 plans in 4 waves (planned 2026-08-05)

Plans:
**Wave 1**

- [x] 149-01-PLAN.md — StrategyTable `visibility` parameterization (Pitfall 1) + grid-toggle suppression + published-gated Simulate button (Wave 1)
- [x] 149-02-PLAN.md — getMyStrategies (own-only predicate, documented deviation) + strategy-less-keys anti-join (both key links) + Badge `private` fix (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 149-03-PLAN.md — status marker + honest pending chip + Delta-5 placeholder rows (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 149-04-PLAN.md — /my-strategies page + comparison-set line + sidebar entry + role wiring (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 149-05-PLAN.md — phase-149 structural CI gate + Rule-9 mutation campaign + phase gate (Wave 4)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **Reuse cuts both ways.** Parameterize the visibility predicate; do NOT globally widen the shared query — the published-only predicate on discovery/public surfaces must be provably unchanged, or this phase ships the leak OWN-02's cache work exists to prevent. An unpublished row's metrics must never reach any anon or non-owner surface through the shared path.
- ⚠️ **Percentile population is a deliberate plan-time decision** (own rows ranked against the published universe vs among themselves) — decide it explicitly at plan/discuss time, do not let it fall out of whichever query is handy. Whatever is chosen must be honest about its comparison set.
- ⛔ Do not start before Phase 148 lands — the dependency is structural, not stylistic.

### Phase 150: OWN-03 — The wizard asks whose capital this is

**Goal**: When an allocator adds a key the product asks the question it never asked — own capital, or a trading team's key being verified — stores the answer as a persistent ownership mark, and lets ONLY marked own-capital strategies be added to the allocation from the Holdings tab
**Depends on**: Phase 148 (soft — keeps the OWN cluster contiguous, and the created position's strategy is then visible via factsheet/ranking so the write can be verified end-to-end; no hard code dependency)
**Requirements**: OWN-03, OWN-05
**Success Criteria** (what must be TRUE):

  1. At allocator key-add, the wizard ASKS which of two things this is — (a) a key with my own capital in it, or (b) a trading team's key I am verifying (the DEFAULT) — and stores the answer as a persistent ownership mark. The wizard writes NO position and asks NO amount (2026-08-05 refinement: mark in wizard, allocate in Holdings — supersedes the 2026-08-04 finalize-form reading). Copy is CRISP and the question lives in the categorization step.
  1b. The categorization/profile step is culled to essentials: AUM, strategy-size, strategy-type and similar questions are removed or collapsed behind an optional disclosure (founder 2026-08-05, "just essentials, especially for the allocator") — with every culled answer's downstream consumer checked (hide per no-invented-data, never fabricate).
  1c. An allocator can rename their OWN private/draft strategies to a proper name (OWN-05); owner-authz only; the public codename/disclosure redaction contract stays byte-untouched; all owner surfaces (my-strategies, Browse own rows, owner factsheet, holdings alias) render the new name coherently.

  2. In the HOLDINGS tab, a strategy marked own-capital can be ADDED to the allocation (explicit action + amount — the money-path review applies to THIS write). Choosing (b) — or any path that never reaches the question — changes nothing: `status='private'`, portfolio untouched, behaviour-compatible with today.
  2b. ⛔ HARD INVARIANT: a team-review-marked strategy can NEVER become a position — no code path creates an allocation from it (an allocator cannot put money into a trading team's account). Asserted structurally, like the visibility gates. The retro path (marking pre-existing own strategies such as Black Swan so they become allocatable) is part of this phase.

  3. Auto-add remains refused: no code path adds to the portfolio without the explicit (a) answer — the founder has refused auto-add TWICE.
  4. Adding the same strategy twice has a defined, reviewed behaviour — never a silent duplicate position or a double-count.

**Plans**: 8 plans in 4 waves

Plans:
**Wave 1**

- [x] 150-01-PLAN.md — DB: capital_ownership column + D-03 BEFORE INSERT trigger + atomic flip RPC + pgTAP; [BLOCKING] MCP apply to TEST (wave 1)
- [x] 150-02-PLAN.md — Shared contracts: isAllocatable predicate, type widening, OwnershipTag, CapitalOwnershipRadioGroup, dollar-validator lift (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 150-03-PLAN.md — Wizard: capital question first + cull-to-disclosure + asset-class hoist + post-finalize mark persistence (wave 2)
- [x] 150-04-PLAN.md — Routes: PATCH ownership (retro mark + 409/confirm/RPC flip) + PATCH name (OWN-05 rename) + audit actions (wave 2)
- [x] 150-05-PLAN.md — Holdings data: allocation route (upsert, allocated_amount ONLY), getOwnCapitalStrategies, adapter + owner-name carve-out (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 150-06-PLAN.md — my-strategies + factsheet UI: tag, row actions, Mark/Rename dialogs, owner-lane thread (wave 3)
- [x] 150-07-PLAN.md — Holdings UI: rows, AllocateDialog, three-arm empty state, unsigned-weight fix + contract pin (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 150-08-PLAN.md — Structural D-03 gate with mutation ledger + full regression + VALIDATION close (wave 4)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **OWN-03 is the first WRITING requirement in the OWN set** → it needs its own money-path review (weights, allocation basis, what happens when the same strategy is added twice). That review is WHY this is its own phase rather than a rider on 148 — do not fold it back.
- ⛔ The deliverable is a WIZARD QUESTION, not an auto-add; (b) must stay the default and stay a no-op.
- ⚠️ Coordinate with AUM-04 (Phase 151): a position created from an owned strategy must not re-introduce cross-role gate contamination or double-count against live holdings.
- ⚠️ **DISCUSS-PHASE DECISION (founder-hit 2026-08-05): the retro path.** SC1's question fires at wizard FINALIZE — but the founder's already-contributed strategies (Black Swan, Alpha Centauri, Arctic Fox) finalized BEFORE the question existed, so they can NEVER be allocated without re-onboarding. Decide the allocate-existing-own-strategy affordance (e.g. an "Allocate…" action on the /my-strategies row or the owner factsheet) — same money-path review, same no-auto-add rule. Related observed confusion: the header "+ Allocation" button on non-Scenario tabs opens the connect-key wizard (Phase 116 design) with no path to an existing strategy, and the Holdings STRATEGIES panel says "No strategies onboarded yet" while contributed strategies exist — copy/affordance both belong to this phase's surface once positions become creatable.

### Phase 151: AUM — A book you can reach and a size you can set

**Goal**: An allocator can always reach their live book, size a hypothetical one directly, and no venue crashes the holdings sync
**Depends on**: Phase 147 (AUM's zeros-on-screen symptom is entangled with SCEN-01's and would otherwise appear unfixed)
**Requirements**: AUM-01, AUM-02, AUM-03, AUM-04, AUM-05
**Success Criteria** (what must be TRUE):

  1. The allocator sets AUM directly in the composer and weights/dollar sizes follow — a blank-slate scenario holding only added strategies can size and commit ("allocate $500k to this strategy" becomes expressible) (AUM-01).
  2. An MT5 account's equity contributes a holdings row, and no key ever again stamps a raw Python `AttributeError` into the user-visible `sync_error` column — fixed at the non-ccxt venue CLASS: the same test shape passes for sFOX (`get_balances`, not `fetch_balance`) BEFORE its go-live flip (AUM-02, AUM-05).
  3. The founder's own book (~$460k, 8 active keys of which 3 deribit + 3 mt5 carry zero per-key dailies) reaches "From my book" — the gate is no longer all-or-nothing over every eligible key, and MANAGER-side MT5 keys no longer pin the ALLOCATOR's book gate false permanently (cross-role contamination) (AUM-04).
  4. The AUM-zero refusal copy names only affordances that actually exist — never the deliberately-never-built live-holding toggle (AUM-03).

**Plans**: 7 plans

Plans:

- [x] 151-01-PLAN.md — Extract MT5 terminal-concurrency machinery into services/mt5_concurrency.py (leaf; the ONE lock registry)
- [x] 151-02-PLAN.md — Split the book gate SSR-side: deriveStrategyLinkedKeyIds + 3 additive payload fields on both branches
- [x] 151-03-PLAN.md — Non-ccxt venue dispatch + MT5 account-equity branch (kill switch, shared lock, honest skips, transient human copy)
- [x] 151-04-PLAN.md — sFOX branch + parametrized class-closure proof (mt5+sfox+unknown) + non-collapse oracle
- [x] 151-05-PLAN.md — Composer gate repoint: partial book reaches "From my book"; contributing-only rows + partial-book note
- [x] 151-06-PLAN.md — manualAumUsd draft field + Portfolio AUM input + AUM-03 refusal copy
- [x] 151-07-PLAN.md — Per-strategy dollar input via handleWeightChange + manual_aum_usd commit persistence (client_manual_aum sentinel)

**UI hint**: yes
**Notes (binding traps)**:

- ⚠️ **Fix the non-ccxt venue CLASS, not the MT5 instance** — sFOX carries the identical latent crash, invisible only because its flag is off with zero keys; it must be closed BEFORE the sFOX go-live flip, not discovered by it.
- ⚠️ MT5 holdings fetch is a SECOND job kind contending for the ONE shared Windows terminal — reuse `_mt5_terminal_lock_for`, the login bracket, the bounded-restart helper and the read-timeout discipline (MT5CONC class). Per-symbol MT5 holdings is a SEPARATE decision guarded by a deliberate client-facade pin — do not quietly widen it.
- ⚠️ AUM-01 does NOT cause or fix the 0.00 metrics (that was SCEN-01, closed in 147) — do not let it be planned as that fix.

### Phase 152: SCEN — Composer legibility

**Goal**: The composer is legible: rows say whose they are, what the numbers mean, open detail on click, and browse never presents an unresolvable duplicate
**Depends on**: Phase 147 (rows must carry real series to be worth inspecting), Phase 148 (SCEN-03's factsheet link needs OWN-02 or it is a dead end)
**Requirements**: SCEN-02, SCEN-03, SCEN-04, SCEN-05
**Success Criteria** (what must be TRUE):

  1. In the composition list, a strategy the allocator uploaded themselves is visually distinguishable from a third-party published one — the ownership bit (already computed server-side and discarded at `src/app/api/strategies/browse/route.ts` — `isOwnRow` :264) is wired through additively; this is a persisted-schema decision (`AddedStrategy` is zod-validated at `SCENARIO_SCHEMA_VERSION = 4`), not a client derivation (SCEN-02).
  2. Clicking a scenario row opens richer detail, including a working link to the strategy's factsheet (SCEN-03).
  3. The numbers on a row are labelled — weight, mode, leverage, notional — and a non-derivable notional reads as "not applicable", not as a broken em-dash (SCEN-04).
  4. The strategy browser never shows two indistinguishable rows for the same strategy — the two identical "Alpha Centauri" entries become distinguishable or resolved (SCEN-05; prevention of future duplicates is WIZCONT-02 in Phase 154 — this is the presentation half).

**Plans**: 6 plans in 4 waves (planned 2026-08-07)

Plans:

- [x] 152-01-PLAN.md — Browse-route wire: isOwn on every row + own-only created_at/status through a two-arm H-0300 fence
- [x] 152-02-PLAN.md — Draft-schema wire: isOwn on the NESTED addedStrategySchema, populated-fixture strip guard
- [x] 152-03-PLAN.md — SCEN-04: header label li (WEIGHT USD MODE LEV NOTIONAL) + cause-accurate honest notional
- [x] 152-04-PLAN.md — Drawer: isOwn through handleAdd, own-vs-own dedup line (Created date · Status), shared YoursChip + browse parity
- [x] 152-05-PLAN.md — Composer: isOwn at both twin seams (Bridge deliberately absent) + Yours chip on the added row
- [x] 152-06-PLAN.md — SCEN-03: inline detail expansion + factsheet link + axe expanded-panel coverage + phase-final gates

**UI hint**: yes

### Phase 153: WIZFORM — Form errors belong on the form (+ MT5 declarable)

**Goal**: The wizard stops costing submits — errors land inline on the offending field, transient infrastructure never becomes a user decision, copy never advises the impossible, and an MT5 strategy can declare its venue
**Depends on**: Nothing hard (sequenced after the money-path phases; before 155 so the wizard surface is stable for verification)
**Requirements**: WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, WIZFORM-05, MT5-14
**Success Criteria** (what must be TRUE):

  1. A field the user can get wrong (e.g. a 2-character description) is refused inline at the field, red-highlighted, BEFORE submit — never a terminal full-page envelope after it, and never an error that sends users to corrupt unrelated fields (WIZFORM-01).
  2. No wizard failure renders `code: UNKNOWN` when the server DID classify it — every `finalize-wizard` `validatePayload` 400 arm carries a `code`, and the closing sweep is driven from the emitting sites, not a hand-listed set (the 142.2 plan-07 sweep missed this validator) (WIZFORM-02). SECOND LIVE INSTANCE (founder-hit 2026-08-05, correlation `wizard:0320530a-…`): the client rosters `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) are missing `SERVICE_UNREACHABLE`, `KEY_MISSING_READ_SCOPE`, `KEY_PERMISSION_DENIED` — the server's honest verdict is downgraded to `UNKNOWN` client-side, invisible to Sentry. The derived-roster + coverage-assertion fix MUST cover these rosters, not only `validatePayload`. (A 3-member stopgap may land earlier via hotfix — the CLASS fix still belongs here; see REQUIREMENTS WIZFORM-02.)
  3. A transient seam failure on submit is absorbed: FIRST answer whether the per-submit permissions re-validation is needed at all (a recent successful validation + a live synced series is already evidence), and only then add bounded retry — respecting the seam-budget invariant and the `breaker:railway` (never retrying into an open breaker) — surfacing an error only after genuine exhaustion, with copy naming an action the user can take (WIZFORM-04).
  5. The MT5 validate-key deadline inversion is reconciled — an MT5 validation's honest verdict always arrives inside the budget the client grants: today `SEAM_ROUTE_BUDGETS["validate-key"].timeoutMs` (30s — `src/lib/resilient-fetch.ts`, key at :537 and `timeoutMs: 30_000` at :538) loses to `_MT5_PROBE_TIMEOUT_S` (35s) applied SEPARATELY to three stages (`analytics-service/routers/exchange.py` — `_MT5_PROBE_TIMEOUT_S` defined :62, applied :328/:380/:456 inside `_validate_mt5_key` :222), so a slow MT5 login can never report in time. Venue-aware budget or bounded Python probe — either way under this phase's existing seam-budget trap warning (WIZFORM-05, added 2026-08-05).
  4. No venue-shaped error copy renders for venues it cannot apply to — an MT5 user never sees "switch to a different exchange" (WIZFORM-03).
  5. MT5 is declarable in the supported-exchanges metadata step AND preselected from the key the founder already connected — do not ship the widening without the preselect (MT5-14).

**Plans**: TBD
**UI hint**: yes
**Notes (binding traps)**:

- ⛔ **MT5-14: the `closed-sets.mt5-flag` no-widening pin WILL go red — that is the guard working, not a regression to route around.** The pin must be re-cut deliberately, with its reasoning updated, in the same commit. This is NOT the MT5-11 drift class; the exclusion was a deliberate decision that is now outgrown.
- ⚠️ WIZFORM-04: a naive retry loop multiplies the budget `src/lib/seam-budgets.invariant.test.ts` recomputes, and retrying into an open breaker is how one slow venue takes down every other user's submits. The fix starts with "is the call needed", not "add a loop".
- ⚠️ The allocation-amount form Phase 150 (OWN-03) adds is IN SCOPE for the inline-validation criterion — a freshly-shipped wizard step must not re-introduce the terminal-envelope class this phase deletes.

⛔ **PARENT CHECKBOX STAYS UNTICKED — retroactive SPAN verification FAILED 2026-08-13** (`153-VERIFICATION.md`, 5/6 requirements). All six children shipped and 153.6 verified `passed_with_concerns`, but the PARENT goal was not met: **WIZFORM-02 closed two instances, not the class.** The derived-roster coverage law roots on 3 Next route files (`NextResponse.json({code,error},{status})`) and on `analytics-service/services/**` (`error_code =` assignments); `analytics-service/routers/exchange.py:866` matches **neither** — wrong root AND wrong emission shape — so the whole mt5-gateway fault family renders `code: UNKNOWN`. Third live instance hit on PROD 2026-08-12. ⛔ Do NOT tick this phase by adding the two missing codes; the boundary decision and its scope are **TODOS.md FIX NOW #6**. ✅ WIZFORM-01/03/04/05 and MT5-14 all verified (WIZFORM-03 is closed *further* than `REQUIREMENTS.md:1366` admits — that row contradicts `:1368`).

> ⛔ **PHASE 153 IS SPLIT FOUR WAYS (founder-approved 2026-08-08).** The planner measured 15–16 plans across two runtimes against a 3–5 plan budget and returned `## PHASE SPLIT RECOMMENDED` rather than thin the tasks. **Nothing is dropped or deferred** — all 6 requirements and all 34 locked decisions are assigned. Cut lines follow **file ownership**, so every co-commit constraint (D-14, D-15, D-16, D-26, and the admit-a-code-in-the-commit-that-emits-it rule) stays *inside* one sub-phase. Execute 153.1 → 153.2 and 153.3 → 153.4; the Python chain (153.3) is file-disjoint from the TypeScript chain and may run in parallel. Shared artefacts (RESEARCH, PATTERNS, UI-SPEC, VALIDATION, both EVIDENCE files) live in the parent `153-` directory and are read by every sub-phase.

### Phase 153.1: WIZFORM-CODES — Honest codes + the venue-capability foundation (INSERTED)

**Goal**: No wizard failure renders `code: UNKNOWN` when the server did classify it, and the copy layer gains a per-venue capability record so venue-shaped remedies are filtered by a class rule rather than by stacked instance checks
**Depends on**: Nothing (foundation for 153.2 and 153.4)
**Requirements**: WIZFORM-02, WIZFORM-03
**Decisions**: D-08, D-09(a/b), D-10, D-17, D-21, D-22, D-23, D-34 (D-18/D-28 referenced as superseded)
**Owns**: `src/lib/closed-sets.ts`(+test), `src/lib/wizardErrors.ts`(+test, +invariant test), `finalize-wizard/route.ts` (validatePayload only), `SubmitStep.tsx` (roster only), `seam-constants.pin.test.ts` (Wave-0 A-25 assertion only)
**Plans**: 6 plans in 5 waves

Plans:

- [x] 153.1-01-PLAN.md — Wave-0 scanner + A-25 gates: hardened `deriveRoster`, per-route status predicate, interpolation-safe error body, four SELF-TESTs, derived A-25 assertion (all green at HEAD)
- [x] 153.1-02-PLAN.md — `VENUE_CAPABILITIES` + the three predicates (fail-toward-probing on null) + `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS`, pinned
- [x] 153.1-03-PLAN.md — WIZFORM-03 class filter: `FixRequirement` + `fixRequires` + ONE filter in `formatKeyError`; the three venue bullets and the surface bullet tagged; three whole-table sweeps
- [x] 153.1-04-PLAN.md — Ten new `WizardErrorCode` members (seven field-level, `SEAM_DEADLINE_EXCEEDED`, and the two live UNKNOWN residuals); `EXPECTED_TABLE_SIZE` moved at BOTH sites
- [x] 153.1-05-PLAN.md — `finalize-wizard`: 14 emitters reordered code-first, 11 `validatePayload` arms coded, `MIN_DESCRIPTION_CHARS` re-pointed, roster admitted in the same commit
- [x] 153.1-06-PLAN.md — Third `ROUTES` entry, per-route site literals, alias-aware coverage law (`CIRCUIT_OPEN`), vacuity floor sized against the reordered total, SC-2 mutations RUN

**UI hint**: no

- ⚠️ **PLANNER CORRECTION (2026-08-09, verified at `0c4f01d8`): the D-34 reorder is FOURTEEN sites, not six.** The six below are the SINGLE-LINE `{ error, code }` occurrences; eight more put `error:` on its own line inside a multi-line literal — same defect, invisible to a single-line grep (`:605-608`, `:625-628`, `:637-640`, `:952-955`, `:1007-1010`, `:1087-1093`, `:1754-1758`, `:1778-1782`). A THIRD blindness class was also measured: `EMITTER_RE`'s `error:[^}]*\}` cannot cross a `${…}` interpolation, so four bodies stay invisible even after the reorder. And `deriveRoster` returns `[]` for `KNOWN_FINALIZE_CODES` today (`indexOf("([")` → `-1`). All three are closed by 153.1-01 as Wave-0 gates.
- ⛔ **D-34: reordering is not cosmetic.** Six PRE-EXISTING arms (`:573 :617 :767 :1293 :1310` written `{ error, code }`, plus `:1319` lowercase) are invisible to `EMITTER_RE`. They are out of scope only because it gates on `status: 400`; the moment the third `ROUTES` entry lands **and** the predicate widens, the coverage assertion goes blind on them. Size the vacuity floor against the **reordered total**, never against the nine.
- ⚠️ The A-25 **derived** assertion lands here as a Wave-0 gate (green at HEAD) so that 153.4's budget raise cannot pass a pin that cannot fail.

### Phase 153.2: WIZFORM-FIELD — The form refuses at the field; MT5 declarable *and* submittable (INSERTED) ✅ COMPLETE 2026-08-10

**Status**: ✅ **COMPLETE** — 5/5 plans; `gsd-verifier` **25/25 must-haves, no gaps** (`human_needed` only for 5 browser items); `gsd-code-reviewer` found **1 blocker + 6 warnings, all fixed**. ⭐ The blocker (CR-01) was a live security defect: the scope-broadening probe's gate branched on `api_keys.exchange`, a column the key's own owner could rewrite — so the beneficiary could switch an ASVS V4 control off for their own key. Closed by migration `20260810120000` (table-level `REVOKE UPDATE` + a `SECURITY INVOKER` backstop trigger), **verified on TEST**: the exploit succeeded pre-fix and returns `42501` post-fix, with the worker sync path, `service_role` writes, user `SELECT` and user `DELETE` all confirmed intact. Residual (client-supplied `exchange` at INSERT) is self-defeating rather than harmful and is logged in TODOS.md with its real remedy.

**Goal**: A field the user can get wrong is refused inline, at the field, before submit — and an MT5 strategy can both declare its venue and actually complete a submit
**Depends on**: Phase 153.1 (copy members, `VENUE_CAPABILITIES`, `MIN_DESCRIPTION_CHARS`)
**Requirements**: WIZFORM-01, WIZFORM-04, MT5-14
**Decisions**: D-06, D-07, D-11, D-12, D-13, D-14(a+b), D-15, D-16, D-20, D-22
**Owns**: `MetadataStep.tsx`(+test), `AllocateDialog.tsx`(+test), `SubmitStep.tsx` (routing), `finalize-wizard/route.ts` (probe gate + catch-all), `closed-sets.mt5-flag.test.ts`, the wizard chip set — ⚠️ **PLUS `WizardClient.tsx`, added at planning time**: routing a field-level code back to its field requires a step change, and `WizardClient` is the sole owner of `step`. No other 153.x plan touches it.
**Plans**: 5 plans in 4 waves. Wave 1 runs 153.2-01 and 153.2-03 in parallel (disjoint files); waves 2-4 are forced sequential because four plans contend on `MetadataStep.tsx`. **MT5-14 + WIZFORM-04 are ONE plan (153.2-04)** per D-14, with the chip-set widening and the pin re-cut in the SAME task.

Plans:

- [x] 153.2-01-PLAN.md — ⛔ FLAG-3 as ONE indivisible task: the description client mirror reads `MIN_DESCRIPTION_CHARS`, becomes the `handleSubmit` predicate, the `:491` `disabled` and both stale comments go, the `:334` focus ring is upgraded — then the hint / `.title` / live-clear message states (D-11, D-13, D-23)
- [x] 153.2-02-PLAN.md — the rest of the form: category / AUM / capacity refuse through `Field` with aria-derived borders (AUM+capacity import the SERVER's own `isValidDollar`), and submit-with-errors opens the collapsed `<details>` before focusing the first invalid control, with a visible summary line `LiveRegion` re-states (D-11, D-13)
- [x] 153.2-03-PLAN.md — D-12: `AllocateDialog`'s money field converts from the JS ternary to `aria-[invalid=true]:border-negative` and clears live; the two rows that can tell the mechanisms apart (D-12, D-13)
- [x] 153.2-04-PLAN.md — ⛔ MT5-14 + WIZFORM-04 in ONE ship: `WIZARD_EXCHANGE_CODES`/`WIZARD_EXCHANGES` (Option B) with the `closed-sets.mt5-flag` pin re-cut + POSITIVE assertion in the SAME task; the pinned-`<span>` detected-venue chip, its mono provenance eyebrow and a payload that cannot omit the venue; `venueSupportsScopeProbe` gating BOTH probe call sites (fail-toward-probing on `null`) and the catch-all split so a parse miss and a missing internal token stop reading as network blips (D-06, D-07, D-14a+b, D-15, D-16, D-20, D-22)
- [x] 153.2-05-PLAN.md — a field-level server rejection routes back to the field: `FIELD_BY_CODE` + a totality assertion with a vacuity floor in `SubmitStep`, the handoff through `WizardClient`, and `MetadataStep` revealing + focusing the named field with its values intact (D-13, D-17 boundary)

**UI hint**: yes

- ⛔ **FLAG-3 is ONE indivisible task.** Deleting `MetadataStep.tsx:491`'s `disabled` without widening the `.trim()`-only `handleSubmit` guard at `:222-233` lets a 2-character description POST — re-shipping the very defect this phase deletes.
- ⛔ **INHERITED FROM 153.1-03 — WIZFORM-03 does not close without you.** The `fixRequires` class filter is live and correct in `wizardErrors.ts`, but **no `buildEnvelope` call site passes `context.venue` or `context.surface`** (verified across all 14 sites, 2026-08-09), and venue-absence deliberately preserves incumbent copy. **An MT5 user still reads "switch to a different exchange" in production until a call site names its venue.** `SubmitStep.tsx:414` is yours; `ConnectKeyStep.tsx:609` and `MultiKeyConnectStep.tsx` are 153.4's. **No further change to `wizardErrors.ts` is needed** — just pass the context.
  - 💡 **Free with the same edit: `charCount`.** `formatKeyError` grows the sentence to `Add at least 10 characters — you have 2.` when `context.charCount` is present (`wizardErrors.ts:2379`), and **no production emitter supplies it**, so the count never renders. Absence is correct-by-design, not a bug (TRAP-3 — never name a count you did not receive), so this is an upgrade, not a fix. Pass `charCount: description.length` in the same `buildEnvelope` argument you are already adding `venue`/`surface` to. Confirmed live on a TEST dev server 2026-08-09 — see `153.1-HUMAN-UAT.md` item 1.
- ⚠️ **A true sentence is temporarily hidden**: `SERVICE_UNREACHABLE`'s `/strategies` bullet now renders **nowhere** until a call site names its surface.
- ⛔ **INHERITED FROM 153.1-06 — WIZFORM-02 does not close without you either.** 153.1 closed the *named root cause* (the `validatePayload` arms; `deriveEmittedCodes` moved 0 → **25 sites / 19 distinct**), but the requirement's criterion is broader than its root cause. A derived sweep found **five live rejections that still render "We could not classify this failure"** — HTTP **429, 503, 500, 500, 502** — fenced in `src/lib/wizardErrors.invariant.test.ts` as `KNOWN_CODELESS_FINALIZE_REJECTIONS = 5`, with a sixth reddening by name. **Code those five and drive the literal to 0**; that is what ticks WIZFORM-02. ⚠️ Do NOT raise the fence to make a test pass — the fence exists to make the debt visible, and raising it would launder an open requirement into a green suite.
- ⛔ **INHERITED — two `npm test` failures are YOURS to clear.** ⚠️ **`seam-citations` is SELF-CAUSED by 153.1, not pre-existing** (corrected 2026-08-09 by the 153.1 verifier). The earlier "verified unchanged since `aff52516`" claim here was a proof that could not fail: `aff52516` is a 153.1-05 **docs** commit dated after all the source edits, so that diff was empty by construction. `git log -S` attributes all nine to `712c01a9`/`aeea5455`/`3011c659`. It reds on **9 bare `file:line` citations in `src/lib/wizardErrors.ts`, 3 of them already stale** — you are editing that file anyway, so re-derive from HEAD rather than patching the integers (this milestone has burned two full sessions on citation drift). The sibling `seam-venue-vocabulary` failure (`mt5.py:242`) is **Phase 153.3's**, not yours — leave it. That is the UI-SPEC's "fail toward saying less" working as designed, but it is a real loss on the one surface where the bullet applies — restored the moment you pass `surface`.
- ⛔ **MT5-14 and WIZFORM-04 ship together.** Widening the chip set without the probe skip leaves MT5 a HARD BLOCKER — declarable but still unsubmittable.
- ⚠️ The `closed-sets.mt5-flag` pin re-cut and the widening are the SAME commit, and the re-cut ADDS the positive flag-ON assertion the pin lacks today.

### Phase 153.3: WIZFORM-GW — MT5 gateway honesty (Python; file-disjoint) (INSERTED)

**Goal**: An MT5 validation's honest verdict can physically arrive — the nested-timeout inversion is removed, the terminal is shared through the lease that already exists instead of raced, and a key we cannot classify is refused rather than stamped read-only
**Depends on**: Nothing (independent of the TypeScript chain; sequenced BEFORE 153.4 per D-24)
**Requirements**: WIZFORM-05 (server leg)
**Decisions**: D-02, D-03, D-24, D-25, D-27, D-29, D-30, D-31, D-32, D-33 (D-28 superseded)
**Owns**: `analytics-service/services/mt5_client.py`, `services/mt5_validation.py`, `services/mt5_concurrency.py`, `routers/exchange.py`, `tests/test_mt5_*.py`, `docs/runbooks/mt5-go-live.md` — ⚠️ **PLUS `services/ingestion/mt5.py` (+ `tests/test_ingestion_mt5.py`), added at planning time**: it is the SECOND of the two callers of `is_trade_capable` (`:221`), so D-31 cannot be a class-level fail-closed fix without it. Python-only; file-disjoint from 153.1/153.2/153.4.
**Plans**: 6 plans in 6 waves (strictly sequential — every plan contends on `mt5_client.py` and/or `routers/exchange.py`). Wave 6 = **D-35**, the `shutdown()` class closure, added after gating: an `ast` scan measured **three** `Mt5Client.close()` callers (`routers/exchange.py`, `services/exchange.py`'s `aclose_exchange` mt5 arm, and `services/ingestion/mt5.py`'s validate `finally`) reaching exactly **two** `shutdown()` sites (`mt5_client.py:384` `close`, `:436` `restart`). Fixed at the **sink** — the teardown leaves `close()` entirely — so all three callers are fixed with zero call-site edits.

Plans:

- [x] 153.3-01-PLAN.md — 🔒 D-31: `terminal_info()` guard; tri-state `classify_trade_capability`; both call sites refuse what they cannot classify (SECURITY, sequenced FIRST so it is not blocked behind the refactors)
- [x] 153.3-02-PLAN.md — D-24/D-25: bind `initialize()`'s missing `timeout=`; extend the ordering guard to EVERY timeout-carrying call with a source-derived completeness floor; per-instance chain (`MT5_REQUEST_TIMEOUT_S` byte-unchanged)
- [x] 153.3-03-PLAN.md — D-02/D-03/D-30: ONE end-to-end deadline replacing three 35 s stages; `Mt5Client.release()` takes `shutdown()` off the request path; the `finally` survives the deadline and stays outside it (Pitfall 6)
- [x] 153.3-04-PLAN.md — D-29: the validate path takes the terminal lease it is the one caller to skip, with a bounded acquisition wait distinct from the operation timeout (batch keeps queueing patiently; NO account cap)
- [x] 153.3-05-PLAN.md — D-32/D-27/D-33: `stage` + `duration_ms` on every MT5 call and on the lease wait; runbook single-replica invariant, terminal trade-permission step, provisional-budget note

**UI hint**: no

- 🔒 **D-31 is a SECURITY fix, not a refactor.** `is_trade_capable` infers investor mode from two signals that are BOTH false for a MASTER account under the terminal's default-ON "Disable automatic trading through the external Python API". `terminal_info()` is called nowhere and does not exist on `Mt5Client` — it must be ADDED. Fail **CLOSED**: refuse what we cannot classify.
- ⛔ **D-25: `MT5_REQUEST_TIMEOUT_S` stays byte-unchanged.** The validate path takes its own longer chain via the existing `request_timeout_s` ctor arg. Moving the module constant reopens the v1.11 WEDGE-01 wedge class.
- ⭐ **D-29: the lease already exists and this path is the one caller that skips it.** `_mt5_terminal_lock_for` (`mt5_concurrency.py:126-134`) is taken by `job_worker.py:364`/`:3572` and `allocator_positions.py:656`, and by `routers/exchange.py` **zero** times. Add a BOUNDED acquisition timeout distinct from the operation timeout — today `wait_for` sits inside the lock, so a queued caller waits unbounded. No account cap: accounts are unlimited, concurrency is one.

### Phase 153.4: WIZFORM-BUDGET — Venue-aware budget + the honest long wait (INSERTED)

**Goal**: The client grants an MT5 validation a budget its honest verdict fits inside, and a long wait is legible and abortable rather than a silent stall
**Depends on**: Phase 153.1 (`SEAM_DEADLINE_EXCEEDED`, `serialized`); best AFTER 153.3 (a budget cannot fix a structurally censored verdict — D-24)
**Requirements**: WIZFORM-05 (client leg)
**Decisions**: D-01, D-04, D-05, D-19, D-21, D-26, D-27 (D-18 superseded)
**Owns**: `resilient-fetch.ts`, `analytics-client.ts`, `seam-constants.pin.test.ts`, `seam-budgets.invariant.test.ts`, `seam-retry-registry.ts`(+tests), `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` — ⚠️ **PLUS two NEW files added at planning time**: `src/lib/wizard/validate-budget.ts` (a client-safe duplicate of the two budget figures, pinned equal to `SEAM_BUDGETS`) and `src/app/(dashboard)/strategies/new/wizard/ValidateWaitCard.tsx` (the ONE long-wait card both connect steps consume). `resilient-fetch.ts` imports `next/server` and `@upstash/redis`, so a `"use client"` step can never read the budget it must quote in copy — the duplicate + equality pin is the repo's own convention for exactly that.
**Plans**: 5 plans in 3 waves

Plans:

- [x] 153.4-01-PLAN.md — the `validate-key-serialized` 120 000 ms row + `BREAKER_LOCK_TOMBSTONE_S` 60→90 in ONE commit, plus every pin site in `seam-constants.pin.test.ts` and the retry registry (wave 1)
- [x] 153.4-02-PLAN.md — `budgetKeyFor(exchange)` selecting by the `serialized` capability, the three validate routes re-branched, and `seam-budgets.invariant.test.ts` re-derived (wave 2)
- [x] 153.4-03-PLAN.md — the client-safe budget module + its equality pin, and `ValidateWaitCard` with the budget-fraction escalation ladder (wave 2)
- [x] 153.4-04-PLAN.md — `ConnectKeyStep` waits honestly: abortable validate, `Stop waiting`, client deadline → `SEAM_DEADLINE_EXCEEDED` (wave 3)
- [x] 153.4-05-PLAN.md — `MultiKeyConnectStep` gets the same wait, strictly PER PANEL (wave 3, parallel with 04)

**UI hint**: yes

- ⛔ **D-26: the `120_000` budget row and `BREAKER_LOCK_TOMBSTONE_S` 60 → 90 are the SAME commit.** A-25 then holds exactly: `(30 + 90) × 1000 = 120 000`.
- ⚠️ **`budgetKeyFor` must diverge from its analog deliberately.** `process-key-client.ts:123-134` throws on `default:` via a `never` assignment; this one takes a caller-supplied string, so `default:` **returns `"validate-key"` and never throws**. Write the divergence down or a reviewer will "fix" it back. Never interpolate a wire value into a breaker key (T-140-01).
- ⚠️ 16 pin sites (RESEARCH Table C) must move together, including the prose restatements that stay green while their premise breaks.

### Phase 153.5: WIZFORM-ABANDON — Work that outlives its timeout

**Goal**: No `asyncio.to_thread` work can keep touching the MT5 terminal after its `wait_for` fired and its caller released the lease
**Depends on**: Phase 153.3 (complete) — this closes findings its `/code-review high` deliberately deferred
**Requirements**: ABANDON-05, ABANDON-06, ABANDON-07 (minted at planning 2026-08-11 from the three findings below: ABANDON-05 = finding #5, ABANDON-06 = findings #6a/#6b, ABANDON-07 = finding #7)
**Owns**: `analytics-service/services/mt5_client.py` (the sink), `services/mt5_concurrency.py`, `routers/exchange.py`, `services/ingestion/mt5.py`, `services/job_worker.py` + `services/allocator_positions.py` (raw-lock→lease conversions found at planning), `routers/process_key.py` (two uncovered `adapter.validate` sites), `analytics-service/tests/**`
**Plans**: 5 plans in 3 waves
**UI hint**: no

Plans:

- [x] 153.5-01-PLAN.md — epoch registry + Mt5SessionAbandoned + occupancy ContextVar + 6-method fence + lease bump + shared test reset (wave 1)
- [x] 153.5-02-PLAN.md — restart's TWO checks w/ three-invariant fenced cleanup + __init__ construction fence (#5, #6) + rationale re-cuts (wave 2)
- [x] 153.5-03-PLAN.md — ONE release point: convert the 3 raw-lock worker acquisitions to mt5_terminal_lease; re-point neuter patches; ast class pin (wave 2, parallel with 02)
- [x] 153.5-04-PLAN.md — D-40 classification arms at all five caller surfaces incl. process_key's uncovered sites (wave 3)
- [x] 153.5-05-PLAN.md — the two guards: ast abandon-roster + D-37 runtime barrier/spy; shutdown-roster docstring re-cut (wave 3, parallel with 04)

⭐ **ONE defect, three faces — fix it at the SINK, not three times.** Work handed to `to_thread` outlives its `wait_for`; the caller unwinds, releases the terminal lease, and the abandoned thread keeps driving the same process-global MT5 session.

📌 **Anchors below are SYMBOLS, not line numbers** — the original 153.3-era line citations had already
rotted before this phase was planned (#6 and #7 were off by ~30 and ~130 lines respectively; #5 still
held). Line hints are `as of 2026-08-11` only: **if a hint disagrees with its symbol, the symbol wins.**

| # | Site (symbol anchor; line hint as of 2026-08-11) | Symptom |
|---|---|---|
| 5 | `services/mt5_concurrency.py` › `_mt5_bounded_restart` — the `wait_for(to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S)` (~L118) | `_mt5_bounded_restart` abandons at its 10s bound; the one permitted `mt5.shutdown()` can fire **after** the lease is released, under the next holder |
| 6 | `routers/exchange.py` › `_validate_mt5_key_probe` › nested `_connect_and_probe`, **STAGE 1 — connect** (~L513) (+ `services/ingestion/mt5.py` › `Mt5Adapter.validate`, the `wait_for(to_thread(_build_client))` inside the lease, ~L207) | a connect-stage timeout orphans an `Mt5Client` the thread then constructs — `client` was never assigned, so the Pitfall-6 `finally` releases nothing and the rpyc session leaks |
| 7 | `routers/exchange.py` › `_validate_mt5_key_probe` — **THE ONE END-TO-END DEADLINE (D-03)**, `wait_for(_connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S)` (~L817) | the end-to-end deadline fires; the abandoned probe keeps issuing rpyc calls, so D-29's serialization does not hold on the timeout path |

- ⛔ **Patching three call sites is the instance-not-class mistake this milestone has paid for sixteen times.** Candidate designs (a real decision, not a fixer's improvisation): a cancellation-aware wrapper; a generation/epoch counter the terminal checks before each call; or refusing to release the lease until the worker thread confirms it stopped.
- ⚠️ **The AST lease-roster CANNOT catch this.** Its enclosure proof is *lexical* — it reads the `shutdown` as inside the `async with` and passes while the runtime escapes. The fix needs a **runtime** assertion (observe the abandoned thread touching the session after release), never a second static pin. Guard #16 of Phase 153 lives here.
- 📌 Deferred to **Phase 155**, not here (both need the live latency data D-32 made collectable — do NOT guess): the 60s per-stage ceiling wrapping six round-trips of 45 000ms/55s each, and the 20s interactive lease wait being smaller than the worker's 40s read + 10s restart hold.

### Phase 153.6: PARITY — the fixes that only landed on one path (INSERTED)

**Goal**: Every fix the 153 span made on one path exists on its twin, and no broad `except` re-absorbs a refusal the fence was built to surface
**Depends on**: Phase 153.3 (the router fixes whose twins are missing), Phase 153.5 (the fence whose refusals are being swallowed), Phase 153.4 (the budget figure being corrected)
**Requirements**: PARITY-01, PARITY-02, PARITY-03, PARITY-04, PARITY-05 (minted at planning 2026-08-11; defined + traced in `.planning/REQUIREMENTS.md` — the W-153.5-1 debt is NOT repeated)
**Owns**: `analytics-service/services/ingestion/mt5.py`, `analytics-service/routers/exchange.py`, `analytics-service/services/mt5_client.py`, `src/lib/wizard/validate-budget.ts`, `src/lib/seam-budgets.invariant.test.ts`, `src/app/api/strategies/finalize-wizard/route.ts`, `supabase/migrations/**`, `analytics-service/tests/**`
**UI hint**: no
**Plans**: 6 plans

⭐ **Raised by `/code-review xhigh` over the whole 153→153.5 span (2026-08-11, 40 agents, 29 verified findings → 13 distinct defects).** Nine come here; two were fixed unplanned; two are deliberately out (see the bottom).

⛔ **THE SHAPE OF THIS PHASE IS "the fix landed once, not twice."** Three of the four root causes are the same failure: a correct fix applied to one path while its duplicate went untouched, with no guard asserting the two agree. That is the instance-not-class mistake — found *inside the span whose own charter said "fix it at the SINK, not three times."* Do not close these as N point patches; the question each cluster must answer is **what makes the two paths unable to diverge again**.

**A — Adapter parity (3 findings, ONE cause).** `services/ingestion/mt5.py` never received Phase 153.3's `routers/exchange.py` fixes:

| # | Site | Missing twin |
|---|---|---|
| A1 | `ingestion/mt5.py` › `_probe` | the terminal short-circuit that stops `order_check` running when the verdict is already `undetermined` — without it `_WRONG_SERVER_TOKENS` (which carry "terminal") turn an operator-side refusal into a 400 accusing the user their BROKER SERVER is wrong. **This is the exact documented incident the router-side fix was written to prevent.** |
| A2 | `ingestion/mt5.py` › `_read_terminal` | the broad `except Exception` around netref materialization — without it a transport failure escapes as a raw, unscrubbed rpyc exception. ⚠️ `mt5linux` f-string-interpolates the password into remotely-eval'd source, so exception TEXT is a credential-disclosure surface (T-134-01 / T-153.3-23). Only the exception CLASS is safe. |
| A3 | `ingestion/mt5.py` (D-31 arm) | raises a bare `RuntimeError` documented PERMANENT, which escapes `Mt5Adapter.validate` into `job_worker.classify_exception`'s `("unknown", str(exc))` fall-through — **so the worker RETRIES a fault that can never clear**, re-running the whole serialized probe against the ONE shared terminal each time, queueing ahead of every other user's validate, and finally showing the user raw internal copy naming investor/master passwords. |

**B — Absorption: broad `except` re-swallowing the fence (2 findings + 1 telemetry split).** D-42 made absorption structurally impossible *for the classify arms*; pre-existing catch-alls upstream reintroduced it.

- B1 `routers/exchange.py` › `_read_terminal`'s `except Exception` swallows `Mt5SessionAbandoned` → an operator triaging in Railway reads a gateway materialization fault **that never happened**, and the probe continues on a "terminal unreadable" premise that is false.
- B2 `routers/exchange.py` connect stage: the construction fence's `Mt5SessionAbandoned("connect")` is caught by the broad `except Exception as connect_err` before the dedicated D-40 arm, returning a **503 that counts toward the mt5-gateway breaker** — our own abandoned thread driving the breaker toward opening against a healthy gateway.
- B3 `mt5_client.py` › `restart()` check 2 raises from INSIDE `_timed`, which emits an `mt5.stage restart ok=False` event for a restart that was deliberately REFUSED. (Wording corrected per 153.6 D-16: the reconnect round-trip DID happen by the time check 2 fires, so `duration_ms` is real elapsed time — the defect is that a refusal enters the D-32 recovery-latency population Phase 155 reads, under a stage name real round-trips also use; that pollution is the exact thing check 1 was deliberately placed outside `_timed` to avoid, 153.5 RESEARCH §Q-4.) The two checks disagree about the telemetry contract.

**C — The budget correction, and the oracle that cannot see it (1 finding, 2 halves).** `connectAbortDeadlineMsFor` was sized against the branch table's **closed**-breaker column (~158 500 ms) when the governing figure is the **failing** column (175 500 ms serialized / 85 500 ms default) — the failing state being exactly the state a stalling seam is in when a client deadline fires. So CR-01's "nothing was saved" lie is reachable again ~10.5 s before the route finishes writing the key. ⛔ **Fixing the number alone is half the job: `seam-budgets.invariant.test.ts`'s oracle pins the wrong column and so is structurally unable to red on this.** A guard that cannot fail when the behaviour it names changes is the defect class this span shipped repeatedly.

**D — The venue lock is bypassable (1 finding, SECURITY, live on PROD).** Phase 153.2's CR-01 remedy `REVOKE UPDATE ON api_keys` does not hold: `authenticated` retains table-level **INSERT and DELETE**, and the browser already holds the server-minted ciphertext (`/api/keys/validate-and-encrypt` returns it; `ApiKeyManager.tsx` performs the INSERT), so an owner can DELETE and re-INSERT the same row under a different `exchange`. A `BEFORE UPDATE OF exchange` trigger never fires on that path — **neither the primary gate nor the backstop sees it** — and that same client-writable column is the sole authority for skipping `finalize-wizard`'s ASVS V4 scope-broadening probe. The migration header asserts the opposite ("the mislabelled row can never be corrected back"), which is the premise its own "self-defeating forgery" residual argument rests on; `supabase/tests/test_api_keys_exchange_not_user_writable.sql` proves DELETE survives but never tests the round trip.
⚠️ **Calibrate honestly: this is a SELF-targeted control bypass, not a tenant leak** — an owner mislabelling their own key to dodge a probe on their own key. What is lost is the assurance that a key read-only at Connect was not broadened to trade. Serious for a product selling verified performance; not a 3am page.
⚠️ **The migration is already on `main`, and `supabase/migrations/**` auto-applies to PROD on merge — so the hole is live.**
⛔ **This one needs a real design decision, not a patch** (revoke DELETE too? move the INSERT server-side? stop trusting a client-writable column as the probe gate? a trigger comparing against a server-held record?). The options differ materially in blast radius. Decide it in discuss.

**E — Retry affordance (1 finding).** A probe parse miss was moved off `KEY_NETWORK_TIMEOUT` onto `KEY_SCOPE_CHECK_UNAVAILABLE`, removing the Retry control for a condition that is **not** always permanent — a 2xx body the schema cannot read is also what a rolling analytics deploy produces. Belongs here rather than in an ad-hoc fix because touching a wizard error code ripples into 153.1's pinned code tables (`EXPECTED_TABLE_SIZE` and friends), which must be **re-cut, never deleted**.

📌 **Explicitly OUT of this phase:**

- **MT5 as a composite member** — the 153.4 CR-03 fix made an MT5 composite panel reachable for the first time, and `run_stitch_composite_job` has no `mt5` arm, so it `_stamp_failed`s the whole job as permanent (`venue 'mt5' is not a supported exchange`). That is a **product decision** (teach the stitch worker MT5, or block MT5 in the composite wizard), not a bug fix. Natural neighbour: Phase 155.
- **The epoch never re-binds** (`mt5_client.py` `_assert_live` binds on first touch only), so one `Mt5Client` is usable under exactly one lease for its life. No production path does this today — all five lease blocks were ast-verified — and Phase 153.5 already pinned the constraint with a named future fix (rebind on lease entry). Latent, documented, not scheduled.
- Two trivial findings (compare-route skeleton padding + its blind test oracle; the `as unknown as` composite-embed cast in `finalize-wizard`) were fixed unplanned in the same session.

Plans:

- [x] 153.6-01-PLAN.md — Cluster A + B1: extract `services/mt5_probe.py`, rewire both paths, A3 permanent classification (wave 1)
- [x] 153.6-02-PLAN.md — Cluster C: failing-column deadline on BOTH arms + the state-quantified economic oracle (wave 1)
- [x] 153.6-03-PLAN.md — Cluster D (DB): `attested_venue` migration, INVOKER trigger, count-pinned backfill, RPC re-bases, SQL round-trip test (wave 1)
- [x] 153.6-04-PLAN.md — Cluster D (route): the probe gate reads the attestation, never `exchange`; class sweeps re-pointed (wave 1)
- [x] 153.6-05-PLAN.md — Cluster B remainder (B2 connect-stage arm, B3 `_timed` suppression) + the ast parity roster (wave 2)
- [x] 153.6-06-PLAN.md — Cluster E: `KEY_SCOPE_CHECK_UNREADABLE` recoverable code + pin re-cuts 74→75, 32 UNMOVED (wave 2)

### Phase 153.7: WIZFORM-02-CLASS — every code that can reach a user is covered (INSERTED)

**Goal**: WIZFORM-02's CLASS closes — the coverage law's population is derived from every code that can reach a user-facing surface, so a server-classified failure can never again render `code: UNKNOWN`; and a newly-minted `service_error(...)` code with no disposition reds CI by name instead of arriving on a user's screen
**Depends on**: Phase 153.1 (the pinned code tables being re-cut), Phase 153.6 (the `VENUE_WIRE_CODE_TO_VERDICT` / `VENUE_WIRE_CODES_WITHOUT_VERDICT` halves this widens)
**Requirements**: WIZFORM-02 (the ONE requirement the 153 span failed — see `153-VERIFICATION.md`, status `failed`, 5/6)
**Owns**: `src/lib/seam-venue-vocabulary.invariant.test.ts`, `src/lib/wizardErrors.invariant.test.ts`, `src/lib/wizardErrors.ts`, `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/strategies/finalize-wizard/route.ts`
**UI hint**: no — copy members only, no new surface
**Plans**: 3 plans in 3 waves (strictly sequential: 02 greens 01's designed red; 03 contends with 02 on `wizardErrors.ts` / `wizardErrors.test.ts`)

⛔ **Raised by the retroactive Phase 153 SPAN verification (2026-08-13, `failed`, 5/6).** THIRD live instance, hit by the founder on PROD 2026-08-12 while dogfooding MT5. The server classified the failure completely and the wizard rendered *"We could not classify this failure, so we cannot tell you what happened or whether your last action took effect."*

⭐ **BOUNDARY DECISION (2026-08-13, autonomous — reversible).** The coverage law's boundary becomes **"every code that can reach a user-facing surface"**, not "codes emitted in a particular directory in a particular syntactic shape". The current boundary is an artifact of how the scanners were written, not a product rule: no one decided a 500 from `routers/` deserves less honesty than a 400 from a Next route, and the user cannot tell the difference. Full rationale + scope: **TODOS.md FIX NOW #6**.

⛔ **THE SHAPE OF THIS PHASE IS "the guard's REACH was wrong, not its mechanism."** The derived-roster remedy was genuinely built and genuinely works (falsified: mutating an emitted code literal reds two assertions by name). It misses `routers/exchange.py` for **two structural reasons, either sufficient alone** — wrong root (`routers/`, not `services/`) AND wrong shape (a **positional** arg to `service_error(...)`, not an `error_code =` assignment). Fixing either alone leaves the file invisible.

⛔ **The fix is NOT "add two rows."** Landing `MT5_GATEWAY_UNCONFIGURED` and `MT5_GATEWAY_UNREACHABLE` as verdict rows *without* widening the scanner and adding the both-halves assertion is exactly the fourth instance of this defect.

⭐ **The actual defect is an ASYMMETRY, above any individual missing code.** Both codes are absent from **both halves** of the coverage law — no verdict row *and* no recorded no-verdict — so their absence could never have been loud. The phase does not close until a code missing from both halves is a CI failure.

⚠️ **Do NOT re-open WIZFORM-05 as part of this.** The 45,169/45,159/45,177 ms figures from the same incident are `_MT5_VALIDATE_INITIALIZE_TIMEOUT_MS = 45000` — the innermost, deliberately-first-firing layer. The verdict arrived at 45 s against a 120 s budget; the 30 s inversion is genuinely gone. What failed *after* arrival is WIZFORM-02. Lengthening the budget fixes nothing.

📌 **On completion, Phase 153's parent checkbox may finally tick** — it is unticked today because the span did not meet its own goal, not because a child is outstanding.

**Plans**:

- [x] 153.7-01-PLAN.md — Mechanism: parameterised root + call-shape matcher (AST cross-checked) + pin re-cuts + reach/both-shapes assertions + tmpdir falsifier — ENDS RED BY DESIGN naming the 20 undisposed codes (wave 1) — ✅ 2026-08-14, `153.7-01-SUMMARY.md`. Population 17 → **37**; the file ends with **exactly one** failing test naming exactly the 20 predicted codes, and the AST cross-check earned its keep by catching a real matcher bug (a `class` definition head read as a call). ⛔ **Do NOT "fix" the red** — greening it is Plan 02's whole job.
- [x] 153.7-02-PLAN.md — The 20 dispositions: 8 verdict rows (replay-tested through classifyKeyValidationError) + 12 individually-measured WITHOUT_VERDICT rows — greens 01's red (wave 2) — ✅ 2026-08-14, `153.7-02-SUMMARY.md`. ⭐ **01's designed red is GREEN**: the disposition assertion passes over all 37 codes, and the 8×UNKNOWN/500 replay red was recorded first. One member MINTED (`SEAM_INTERNAL_FAULT`, `EXPECTED_TABLE_SIZE` 76 → 77 in lockstep) because `SEAM_MISCONFIGURED`'s "we stopped before sending the request" is measurably FALSE at `INTERNAL`'s emitter and at one of `MT5_GATEWAY_UNCONFIGURED`'s four. Neuter-proof (FL-1) performed and recorded: deleting the `MT5_GATEWAY_UNREACHABLE` row reds BOTH the disposition assertion and its replay test, by name.
- [x] 153.7-03-PLAN.md — Three coded finalize rejections (ledger 3→0, sites 29→32, total pinned 32) + twin regression on BOTH key routes + prose re-cuts + TODOS.md deferral (wave 3) — ✅ 2026-08-14, `153.7-03-SUMMARY.md`. ⭐ **The ledger is EMPTY and its assertion has collapsed into "every rejection carries a code"** — the constant is KEPT, because at 0 it states the property outright. `EXPECTED_FINALIZE_REJECTION_SITES` was **never edited** and the derived count agreed at every run: 32 − 32 = 0. Three copy members, one per ARM rather than per subject, because each may claim a different amount about server state — `DRAFT_LOOKUP_FAILED` (a SELECT that errored, so "nothing was changed" is observable; the token is REUSED from `keys/sync`, not a synonym), `DRAFT_FINALIZE_FAILED` (the generic tail also catches a transport failure that can lose the answer to a write that landed, so it may NOT say nothing was saved), `SEAM_RESPONSE_UNREADABLE` (upstream answered 2xx — the submission was accepted and only the result is unreadable, so it may claim NEITHER outcome, and it is non-recoverable because a retry there is unpredictable rather than futile). `EXPECTED_TABLE_SIZE` 77 → 80 in lockstep; 3 roster rows. **Twin regressions on BOTH key routes, neuter-proven**: deleting the shared `MT5_GATEWAY_UNREACHABLE` verdict row reds both (503 → 500) plus the classifier replay naming UNKNOWN — zero production route edits. A second falsifier: neutering ONE finalize arm reds three independent oracles while the 32 total holds. Prose re-cuts landed (REGISTRY ×2, the `resilient-fetch` census — where `_validate_mt5_key` was a WRONG symbol that still exists, and the completeness pin was under-counted 13 → **15**, both arrivals inert 500s — and the alias docblock whose "correctly answers UNKNOWN" premise 02 deleted). **TWO** TODOS.md deferrals recorded separately.

✅ **PHASE COMPLETE — WIZFORM-02 TICKED.** All four `missing` items from `153-VERIFICATION.md` are closed across the three plans, and the sweep is driven from EMITTING SITES (falsified three ways). ⚠️ The honesty check that could have stopped the tick was run: `keys/[id]/permissions` **is** reachable from a wizard surface (`SyncPreviewStep` → `KeyPermissionBadge`), but that component never builds a `wizardErrors` envelope — it renders the route's own `{ code, error }` as text — so no `UNKNOWN` card is rendered there. Its defect is a remedy sentence, recorded in TODOS.md as its own item. 📌 **Phase 153's parent checkbox may now tick.**

### Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens

**Goal**: Re-entering the wizard continues where the founder left off, screens never show a state the backend has already left, and a token-less credential re-connect cannot mint duplicates
**Depends on**: Nothing hard (sequenced before 155 so the wizard surface is stable for verification)
**Requirements**: WIZCONT-01, WIZCONT-02, STALE-01
**Success Criteria** (what must be TRUE):

  1. Re-entering "add a strategy" with an existing wizard draft resumes at the draft's step — the entry point BEFORE the wizard (`/strategies/new` branch chooser) becomes draft-aware, with the exact entry path established by observation FIRST (WIZCONT-01 — resume is NOT missing: `WizardClient` already resumes when `initialDraft` is present; fix the chooser, not the state machine).
  2. STALE-01's root cause is investigated and documented BEFORE any fix is planned — the poll loop should have terminated at 11:39:35 and did not; why is the open question. After the fix: the wizard never sits on "Fetching trades…" after the job chain has finished, and never renders a refusal computed from a stale analytics row while a re-derive is in flight.
  3. Re-connecting the same credentials from a context that has LOST the wizard-session token (different browser/profile, cleared localStorage, incognito) fails TOWARD the existing row — identity from a stable non-secret venue value where one exists, never uniqueness on ciphertext, and never a silent overwrite of a key whose `strategy_keys` membership other strategies depend on (WIZCONT-02 — LOW priority within the phase; the common case is already safe).

**Plans**: 8 plans in 3 waves

Plans:

- [x] 154-01-PLAN.md — STALE-01 investigation gate: Q1/Q2 PROD discriminator + T1/T2/T3 RED (wave 1)
- [x] 154-02-PLAN.md — WIZCONT-01 plumbing: single-sourced draft query + wizard-draft route + REQUIREMENTS correction (wave 1)
- [x] 154-03-PLAN.md — WIZCONT-02 DB: venue_account_id column, partial UNIQUE, scrub trigger, RPC re-base, TEST apply (wave 1)
- [x] 154-04-PLAN.md — STALE-01a shared fix: poller absent-row honesty (TWIN-3) + sync-progress widening (wave 2)
- [x] 154-05-PLAN.md — WIZCONT-01 resume UX: overlay deferred mount + CSV short-circuit truth table + e2e (wave 2)
- [x] 154-06-PLAN.md — WIZCONT-02 app: one-fence-two-keys, 23505 discrimination (TWIN-8), dedup notice (wave 2)
- [x] 154-07-PLAN.md — STALE-01 supplier arm (CONTINGENT on 154-01 verdict): Python/SQL root-cause fix or recorded NO-OP (wave 2)
- [x] 154-08-PLAN.md — STALE-01 honest screens: un-gated backstop, R2-5 twin, amber state, ledger closure (wave 3)

**UI hint**: yes

### Phase 155: MT5-VERIFY — The numbers are true, live on a trading day

**Goal**: The performance Quantalyze renders for the live funded MT5 account is proven true against the terminal's own figures on a trading day, on every surface that renders it — and the milestone's umbrella acceptance (MT5-GOAL-01) closes
**Depends on**: Phases 147–154 (needs a stable surface to measure — running earlier means re-running). ⚠️ Human- and calendar-gated: a founder at the MT5 terminal, on a trading day, with the live funded account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run does not satisfy it.
**Requirements**: MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)
**Success Criteria** (what must be TRUE):

  1. The MT5 server-UTC offset is MEASURED live at connect and asserted on — never hardcoded (breaks at the next DST transition, wrong for every other broker) — and a near-midnight deal lands on the day the terminal shows, pinned by a regression test (MT5-06; the one failure MT5-07's oracle cannot see unaided).
  2. Rendered performance matches an EXTERNAL oracle — the terminal's own equity/balance or the broker statement — over a fixed window within a founder-stated tolerance, run against the LIVE funded account on a TRADING day (MT5-07, MT5-08). ⛔ Internal consistency does not satisfy this (the self-referential-oracle shape that let three money bugs survive six passes). ⛔ No tolerance number exists anywhere yet — founder call at /gsd-discuss-phase; do not invent one.
  3. Strategy detail, public factsheet, scenario composer, portfolio PDF and browse all show the same, correct MT5 numbers — the backbone-bypass surfaces (`_compute_portfolio_analytics`, `equity_reconstruction.py`, `portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) are checked, and any divergence is a finding (MT5-09).
  4. Every surfaced discrepancy is fixed WITHIN this phase wherever its root cause lives, including shared backbone money-math affecting every venue (UNCAPPED by founder decision — a bounded alternative was offered and declined; the phase does not close while the terminal and the UI disagree) — and the `complete_with_warnings` carried by ALL THREE PROD MT5 strategies is explained: eliminated, or understood and accepted in writing (MT5-10, MT5-15; ⛔ MT5-07 does NOT close MT5-15 — external parity is not "why did our own pipeline flag itself").
  5. **MT5-GOAL-01 — umbrella acceptance gate, no implementation work of its own:** an MT5 strategy is usable end-to-end by the allocator who uploaded it — it ingests (done), it projects in a scenario (SCEN-01, Phase 147), and its factsheet is viewable (OWN-02, Phase 148) — confirmed live by the founder. It exists so "MT5-05 ✅" can never again be mistaken for "MT5 works".

**Plans**: TBD
**Notes**: Re-homed from v1.16 Phase 142.3 (which was split out of 142.2 at the D-14 valve on 2026-08-03 and will NOT run as a v1.16 phase). ⛔ Do not archive the milestone or advertise MT5 until this phase passes — v1.15's failure mode was shipping 6/6 green with both open items intact.
⚠️ **PRECONDITION — REPLACED 2026-08-14. Read this before re-deriving anything.**

**The blocker is stale credentials, not broken code.** The founder changed the MT5 account
passwords on/around 2026-08-14, so the stored credentials will no longer authenticate. Only the
founder can supply the new read-only investor passwords. See the v1.18 milestone header for the
measured PROD state and the ⚠️ `MM1` label mismatch (three keys exist: `FX-AI_V`, `MM2`, `MM3` —
**no key is labelled `MM1`**, so re-verify all three at reconnect).
⛔ **When the three keys flip to `sync_status='error'`, that is EXPECTED. Do not open an
investigation.**

~~PRECONDITION (found 2026-08-05): all 3 PROD MT5 keys sit at `sync_status='error'` —
`'Mt5Session' object has no attribute 'fetch_balance'`...~~ — ⭐ **STALE, and it was a trap.** That
hotfix **landed** as `e0493913` (PR #667, "MT5 key-sync routing for Mt5Session + wizard roster
stopgap"). MT5 sync has worked since: PROD synced all three keys at 04:01–04:07 UTC on 2026-08-14,
`sync_error` empty on every row. The note is struck through rather than deleted because a red MT5
key plus a roadmap note pointing at `Mt5Session.fetch_balance` is a near-perfect way to send the
next session bisecting a bug that was fixed nine days earlier.

### Phase 157: FOUNDER-CONFIRM — the observations only the founder can make

**Goal**: The handful of checks no test can perform are performed, so the requirements resting on
them stop resting on an assumption
**Depends on**: Nothing. Can run in any order relative to 155, in the same sitting.
**Requirements**: none of its own — it discharges human-verification items left open by Phases
153.7 and 154
**Success Criteria** (what must be TRUE):

  1. **The 2026-08-04 wizard restart is confirmed gone.** Open `+ Strategy` with a live wizard
     draft present: the resume banner appears, and Resume lands on the draft's step rather than
     step 1. ⚠️ The MECHANICS are already covered — `e2e/wizard-resume.spec.ts` ran **green on main
     at `5d43df6b`** (2026-08-13 22:32, `e2e-seeded`; the job asserts its seed secret is non-empty
     and fails loud otherwise, so the `HAS_SEED_ENV` skip predicate was false and the test really
     executed). What no test can cover: the founder is the only person who witnessed the original
     restart, so only they can say it is gone.

  2. **The amber `wizard-sync-recomputing` block is seen on screen.** Heading *"Recomputing this
     strategy's analytics"*; no red envelope, no metric numbers; contrast and spacing per
     `154-UI-SPEC.md`. No browser pass has ever been run on this block.

  3. **The four copy members Phase 153.7 minted are seen rendering in a real wizard** —
     `SEAM_INTERNAL_FAULT`, `DRAFT_LOOKUP_FAILED`, `DRAFT_FINALIZE_FAILED`,
     `SEAM_RESPONSE_UNREADABLE`. ⭐ `SEAM_INTERNAL_FAULT` must render with **NO Retry control** —
     that single check doubles as the regression catch for the classifier→roster hop
     (`W-153.7-1`), where a missing roster member leaves the whole suite green while the wizard
     offers a Retry against a permanent fault.

  4. **`MT5_SPIKE_INVESTOR_PASSWORD` is rotated.** It sits in plaintext in Railway env and was
     printed to a session scrollback. Founder-only: they hold the credential.

**Plans**: TBD
**Notes**: ⚠️ Criterion 3 shrinks to a glance if the component render tests land first — they are
agent-deliverable and tracked outside this milestone. Criterion 2 likewise: a localhost browser
pass can pre-verify the block, leaving the founder only a confirmation.

### Phase 156: CONNECT-REFACTOR — the venue the server validated is the venue the server writes ✅ COMPLETE 2026-08-13

**Goal**: `api_keys.attested_venue` becomes what its name claims — the venue **the server itself validated**, not a parameter the caller chose. The wizard's `api_keys` INSERT moves behind a service-role writer that passes the venue it validated at mint time, and `authenticated` EXECUTE is withdrawn from `create_wizard_strategy` and `add_wizard_composite_key`. This is CR-01 remedy **(a)** — the "connect-flow refactor" that both `20260810120000` and `20260811210000` defer.

**Depends on**: Nothing. ⭐ **PULLED FORWARD AHEAD OF 155 — founder call 2026-08-13.** The 2026-08-12 call sequenced this after MT5-VERIFY; the trigger below then fired. Phase 155 is blocked on three gates none of this phase's work can clear (a founder at the terminal on a trading day, a working MT5 validate — the `[Experts] Account=1` trap is still open — and a tolerance number that does not exist and must not be invented), while sFOX go-live is already booked. Since the block itself states MT5 work **cannot** arm this residual, waiting buys nothing and leaves a live-on-PROD deferred control open for longer. 155 does not depend on this phase, so its ordering is unaffected.

⛔ **PULL-FORWARD TRIGGER — sFOX go-live.** Phase 153.6 shipped remedy **(b)**: a `CHECK` pins `attested_venue = exchange`, so the probe-skip forgery drags the ingestion label with it and the key never syncs. **That defence is a property of the current venue set, not a control.** It holds only while every probe-exempt venue is unsyncable. `mt5` is the sole member today and cannot sync ccxt credentials — which is exactly why MT5 work (153.x, 154, 155) cannot arm this. The moment a **syncable** venue joins `scopeProbeSupported: false` in `src/lib/closed-sets.ts`, the forgery becomes FREE. Phase 153.6 RESEARCH names **sFOX** as the plausible next member, and sFOX go-live is already booked (TODOS 🔴 item 3). **If sFOX is scheduled before 155 completes, this phase moves ahead of it.**

**Requirements**: CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05 — ✅ **all five complete 2026-08-13** (minted at planning the same day; the PARITY-04 deferred-control threat flag is CLEARED). Sub-clauses `-01b`/`-01c`/`-02b`/`-03b` are parts of their parent ID, not separate IDs.

**Success Criteria** (what must be TRUE):

  1. A caller holding a valid session and the server-minted ciphertext **cannot** set `attested_venue` by any route — not by client INSERT (already closed by the scrub trigger in 153.6), and not by calling the wizard RPCs directly over PostgREST. Proven by a SQL assertion that calls the RPC as `authenticated` and is REFUSED, replacing 153.6's assertion 5d, which today passes *because* it asserts the door is open.
  2. `attested_venue` is written from a venue the server **verified against the live venue API at mint time**, not from a request parameter — traced from `/api/keys/validate-and-encrypt` through to the INSERT.
  3. The wizard still works end to end for every venue, single-key and composite. ⚠️ Both RPCs currently need the **user-scoped** client because their `auth.uid()` guards demand it; moving to a service-role writer must not lose that ownership check — the row must still be provably the caller's.
  4. The `CHECK (attested_venue IS NULL OR attested_venue = exchange)` from 153.6 is **kept**, not removed as redundant. It is the fence that stops a future writer letting the two columns diverge, independent of who does the writing.
  5. Every prose claim that 153.6 had to weaken is re-strengthened to match: the `attested_venue` column comment, `20260811210000`'s section 1b, `REQUIREMENTS.md` PARITY-04, and the deferred-control threat flag is cleared.
     ⚠️ **SC5 amended in flight:** `20260811210000` §1b was **NOT** edited — it is an applied migration and `migration-reviewer` invariant 11 makes any edit a CRITICAL. It is superseded **by name** in Migration B's header ⛔ (ii). The criterion is met by supersession, not by amendment; a future reader diffing §1b against the current system is not looking at a regression.

**Plans:** ✅ **10/10 executed** — 10 plans in 8 waves, shipping as **TWO PRs** (`156-RESEARCH.md` "Deploy order": both
single-migration orderings produce a total connect-a-key outage window, so Migration A grants
`service_role` while leaving `authenticated`'s grant standing, and Migration B withdraws it only
after PR A's route is verified live on PROD). ⛔ **SC1 does not close until PR B.**

Plans:

- [x] 156-01-PLAN.md — Wave 0: measure A1/A2/A3/A4 against TEST (does a service-key client really reach `auth.role() = 'service_role'` with `auth.uid()` NULL?) — the whole privilege design rests on two facts RESEARCH could not settle
- [x] 156-02-PLAN.md — [PR A] Re-cut both route test files to the post-156 contract and observe them RED (admin-client receiver, `p_user_id === user.id`, 503 `SEAM_MISCONFIGURED`) — incl. the composite twin's missing admin mock
- [x] 156-03-PLAN.md — [PR A] Migration A: transitional two-arm role gate (branched, never unioned) + `GRANT EXECUTE … TO service_role` on both RPCs; applied to TEST, PR-Y2 renamed, snapshots regenerated
- [x] 156-04-PLAN.md — [PR A] Swap both wizard routes onto `createAdminClient()`, fail-closed on a missing service key, pragma moved with the mutation
- [x] 156-05-PLAN.md — [PR A] CONNECT-02b structural guard (a second user-scoped writer reds a normal test run) + TODOS entries for the two logged-not-fixed items + version bump
- [x] 156-06-PLAN.md — ⛔ **THE HARD BOUNDARY**: ship PR A, then verify the service-role writer live on PROD in a real browser (single-key AND composite) before PR B is authored
- [x] 156-07-PLAN.md — [PR B] Migration B: `REVOKE … FROM authenticated`, both bodies narrowed to `auth.role() = 'service_role'` with **zero** `auth.uid()`, column comment re-stamped ⛔ preserving the `20260811210000` gate marker
- [x] 156-08-PLAN.md — [PR B] Invert assertion 5d (42501 + nothing minted) and mint its missing composite twin 5f/5g, plus the two marker cross-checks that stop the block SKIPping green
- [x] 156-09-PLAN.md — [PR B] Flip G1/G2, re-shape the six direct RPC call sites whose `authenticated` role claim the new gate refuses, replace Part 3b's now-vacuous guarantee, twin the stale-re-base canary
- [x] 156-10-PLAN.md — [PR B] Re-strengthen the five prose sites to exactly what is true, clear the PARITY-04 `threat_flag: deferred-control`, full-suite phase gate

**Notes**: Raised by `gsd-code-reviewer` as blocker **CR-01** during Phase 153.6 and shipped as an accepted residual in PR #675 (v0.58.0.0). Full reasoning: `.planning/phases/153.6-parity-the-fixes-that-only-landed-on-one-path/153.6-REVIEW.md` (CR-01, both remedies stated) and `153.6-07-SUMMARY.md` (why (b) was chosen and what it does NOT buy). ⚠️ The residual was **live on PROD** from 2026-08-12; **closed 2026-08-13**.

⭐ **THE WORKED EXAMPLE — copy this shape for the next privilege change.** The phase shipped as **TWO PRs with a live PROD gate between them**, because both single-migration orderings produce a total connect-a-key outage window:

  · **PR A (#680, v0.60.0.0, merged `25e28d3a`)** — Migration A grants `service_role` and keeps a **transitional two-arm role gate (BRANCHED, never unioned)**, because a `service_role`-only body would have refused the still-live old deploy. Both routes swap onto `createAdminClient()`.
  · **THE GATE** — `156-LIVE-ACCEPTANCE.md`, `status: pass`, rows 1–5 (+ optional row 6, MT5). A real browser against real PROD: a single-key connect at 19:02:40 UTC and a 2-member Deribit composite whose SECOND member was minted by `add_wizard_composite_key`. ⭐ The gate sits **between** the landings so PR B cannot convert a working-but-open state into a broken-and-closed one, and so that the REVOKE removes a path our own code was **observed** no longer taking rather than inferred not to take from a unit suite that mocks the very client under test.
  · **PR B** — Migration B revokes `authenticated`, deletes the transitional arm, and lands the SQL gates + prose in the SAME PR (merging the migration alone reddens `sql-tests`).

⚠️ **The most transferable defect of the phase, which recurred THREE times independently:** `pg_get_functiondef` returns `prosrc` VERBATIM **including comments**, so any assertion matching a function body must strip `--` comments first. It bit Migration B's own post-verify (which would have aborted its apply on its own Trap B documentation), plan 08's assertion 5h (permanently un-armed and silently green on exactly the database it guards), and plan 09's state-adaptive arming (armed one twin and not the other — measured end-to-end as letting a re-granted `authenticated` EXECUTE exit 0 green).

⚠️ **The related class: assertions that pass for the WRONG reason.** Migration A shipped a canary that passed on precisely the stale re-base it existed to catch; `test_wizard_composite_fence.sql` Parts 3b/3c would have passed VACUOUSLY after Migration B (catching the role refusal, never reaching the cross-user condition they name) and were **re-cut rather than left reporting safety they no longer provided**; plans 08 and 09 each shipped a provably unreachable assertion and each caught it with their own mutation battery.

⛔ **`REVOKE` is not durable, and that is a CLASS.** Supabase's `pg_default_acl` re-grants `anon` and `authenticated` on any `DROP`+`CREATE`. Nothing in a migration can close this — a post-verify runs once, at apply, and the migration that reopens the door is one nobody has written yet. The durable enforcement is **assertion 5h**, armed from the function body and the live ACL rather than from a comment marker, proven on a PG16 fixture by an actual DROP+CREATE where it was the ONLY assertion that reddened.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 147. SCEN-01 engine series | 6/6 | Complete   | 2026-08-05 |
| 148. OWN owner factsheet | 5/5 | Complete   | 2026-08-05 |
| 149. NAV my-strategies ranking | 5/5 | Complete   | 2026-08-05 |
| 150. OWN-03 portfolio question | 8/8 | Complete    | 2026-08-07 |
| 151. AUM book + sizing | 7/7 | Complete    | 2026-08-07 |
| 152. SCEN composer legibility | 6/6 | Complete    | 2026-08-07 |
| 153. WIZFORM + MT5-14 | span complete | Goal met via inserted 153.7 (span verdict stays `failed` 5/6) | 2026-08-14 |
| 153.7. WIZFORM-02-CLASS (INSERTED) | 3/3 | Complete (shipped v0.62.0.0, merge `c4555fd0`) | 2026-08-14 |
| 154. WIZCONT + STALE | 8/8 | Complete   | 2026-08-12 |
| 155. MT5-VERIFY + acceptance | 0/? | ➡️ **CARRIED to v1.18** | - |
| 156. CONNECT-REFACTOR | 10/10 | Complete (2 PRs, live PROD gate between them) | 2026-08-13 |

**v1.17 closes at 10 phases delivered** (147, 148, 149, 150, 151, 152, 153, 153.7, 154, 156).
⚠️ Phase 153's own SPAN verdict is still the verifier's to issue — every one of its `missing`
items is closed and WIZFORM-02 is ticked in REQUIREMENTS.md, but the box at line 122 is
deliberately left for `gsd-verifier` rather than self-ticked. That re-verification is
agent-deliverable and does not gate the milestone close.

### v1.18 Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. MT5-VERIFY + acceptance | 0/? | ⛔ Blocked — founder at terminal + new passwords | - |
| 157. FOUNDER-CONFIRM | 0/? | ⛔ Blocked — founder observations | - |

## Requirement Coverage (v1.17)

| Phase | Requirements |
|-------|--------------|
| 147 | SCEN-01 |
| 148 | OWN-02, OWN-04 |
| 149 | NAV-01 |
| 150 | OWN-03 |
| 151 | AUM-01, AUM-02, AUM-03, AUM-04, AUM-05 |
| 152 | SCEN-02, SCEN-03, SCEN-04, SCEN-05 |
| 150 | OWN-05 |
| 153 | WIZFORM-01, WIZFORM-02, WIZFORM-03, WIZFORM-04, MT5-14 |
| 153.x | WIZFORM-05 (the validate-budget split; ⛔ explicitly FENCED OUT of 153.7) |
| 154 | WIZCONT-01, WIZCONT-02, STALE-01 |
| 155 | ➡️ MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella) — **CARRIED TO v1.18 on 2026-08-14. Not delivered in v1.17.** |
| 156 | CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05 ✅ (all five complete 2026-08-13; also closes PARITY-04, whose deferred control 153.6 could not take inside its own phase) |

**31 in-scope requirement IDs mapped (30 work + 1 umbrella), each to exactly one phase.**
⚠️ **Corrected 2026-08-14 — this table said "29/29 mapped, no orphans" while omitting TWO
requirements** (`OWN-05` and `WIZFORM-05`, both added after it was written). Milestone-audit
warning **W2**. A completeness claim that predates the last two additions is worse than no claim:
it reads as a checked invariant when it is a stale count. ⭐ **24 of the 31 were DELIVERED in
v1.17; the 7 on the Phase 155 row were CARRIED to v1.18** and are not v1.17 gaps.
No duplicates. OWN-01 excluded (already met — CONTRIB-03, verified in code 2026-08-04).
⛔ Everything in SEAM / JOB / RATE / PYAPI* / SEAMCORE / SEAMUX remains v1.16 (PARKED below).
Revised 2026-08-04 after NAV-01 was sharpened: the approved Phase 148 (OWN-02/03/04 + NAV-01)
split into 148/149/150; later phases renumbered +2 (149→151 … 153→155) with dependencies intact.

---

## ✅ CLOSED Milestone: v1.16 Production Resilience & Reliability (Phases 140–142) — CLOSED 2026-08-14

⚠️ **SCOPE AMENDED ON CLOSE, and the amendment is dated on purpose.** This milestone ran 140–146
and sat ⏸️ PARKED at 13/19 phases for weeks. Phases **143, 144, 145 and 146 were CARRIED to the new
milestone v1.19 JOB/RATE** on 2026-08-14 — not dropped, not ticked, and not renumbered. With them
went JOB-04, JOB-05, JOB-06, JOB-08 and RATE-01..05.

**Why carried rather than resumed:** GSD models ONE current milestone, and v1.18 already held that
slot. Working four phases under a header reading PARKED is precisely the ledger-vs-reality drift
that produced four blockers in the v1.17 milestone audit. Fifteen phases that shipped weeks ago
also should not share a milestone with four that have never been planned.

⛔ **What v1.16 actually earns:** the shared resilience core and breaker, the Python service
contract, the wizard/client seam surface, retry-with-backoff, and the stuck-computing reaper.
⛔ **What it does NOT earn:** dropped-enqueue detection, orphaned-`running` visible termination,
csv-finalize atomicity, or a rate limit a new route cannot bypass. Those are v1.19's, and none has
been started.

⛔ **PARKED 2026-08-04 at 68% — NOT shipped, NOT complete.** 13/19 phases complete, 119/127
plans (68%). Outstanding: **Phase 143** (dropped-enqueue reconciliation sweep), **Phase 144**
(WR-02 orphaned-running DELETE→terminal UPDATE — ⚠️ carries a LIVE founder decision: the current
purge DELETEs orphaned-`running` rows rather than resetting them; TEST wants DELETE, PROD wants
reset, and both must be reconciled in the SAME migration), **Phase 145** (csv-finalize atomicity,
reproduce-first) and **Phase 146** (RATE audit). **Resume at Phase 143 after v1.17 delivers.**
All 29 phase directories were deliberately preserved (the workflow's `phases.clear` was skipped
by founder call) so this milestone resumes without reconstruction.

⚠️ **Re-homed into v1.17 (2026-08-04):** Phase 142.3's entire scope — MT5-06..10, the live
trading-day numeric verification — now lives in **v1.17 Phase 155**, and MT5-14 (wizard metadata:
MT5 declarable + preselected) in **v1.17 Phase 153**. Phase 142.3 will not run as a v1.16 phase.

**Goal:** Give the live money-bearing plumbing failure handling — so a hung Railway request, a
silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real investor
factsheet on a spinner that never resolves.

**Scope:** 18 v1 requirements (SEAM-01..06, JOB-01..07, RATE-01..05) per
`.planning/REQUIREMENTS.md` (written against the research-CORRECTED scope in
`.planning/research/SUMMARY.md`, not the original milestone prose). CRON + MONEY groups deferred
(founder 2026-07-25). Phase numbering continues from 140 (v1.15 ended at 139).

**Ordering rationale (non-negotiable, from research):**

- **Breaker (140) ships BEFORE retry (141)** — fail-fast alone carries zero double-execution risk
  and can land while the SEAM-05 idempotency audit is still being written; retry without a breaker
  actively amplifies an outage.

- **SEAM before JOB** — JOB's sweeps use SEAM's timeout-vs-upstream-vs-network error taxonomy to
  decide re-enqueue vs terminal-fail.

- **Every JOB reaper/sweep lands in pg_cron** — never the worker loop (same failure domain as the
  crash it backstops; re-exposes WEDGE-01) and never Vercel cron (plan cron-slot ceiling, a
  documented past cause of prod going dark).

- **142 before 143** — both sweep the same `strategies`/`strategy_analytics`/`compute_jobs`
  triangle; built in sequence as one non-racing mechanism, not two competing crons.

- **RATE last** — mechanical, and its gap list must come from a fresh kickoff grep, not from
  anything upstream.

## v1.16 Phases (PARKED)

- [x] **Phase 140: SEAM — Shared resilience core + circuit breaker** - Both Vercel→Railway chokepoints fail fast through one Upstash-backed breaker with unified timeout budgets and a clean 503 envelope (no retry yet) (completed 2026-07-25)
- [x] **Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity** (INSERTED) - Tenant-scope the wizard-session leak, make 4xx/5xx attributable at the source, per-tenant `/process-key` throttling, complete idempotency (completed 2026-07-26)
- [x] **Phase 140.1.1: PYAPI-FIX — close Phase 140.1's own review findings** (INSERTED) - Cross-language duplicate-reply contract incoherence (a live 502 arm, but no caller reaches it today); 4 Python High findings; `error_contract.py`'s two remaining guard gaps that no downstream phase can reach; and every test the review's 36 injected mutations proved toothless (12 survived) (completed 2026-07-26)
- [x] **Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route** (INSERTED) - The class 140.1.1 closed on teaser/csv is still open on `/api/validate-key`, where a venue blip renders as `UNKNOWN`/500 "team notified"; plus MT5 permanent-code misclassification (reproduce-first), the raw 429, four 429s missing `Retry-After`, the `_SHAPES` corpus fence, and artifact corrections (completed 2026-07-30; VERIFICATION **passed** 6/6; shipped to main @ 4f45dcab)
- [x] **Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity** (INSERTED) - Record on attributability not `>=500`, cover the body read, bound the store, pin every constant to a literal, verify against real Redis (completed 2026-07-27; 12/12 plans; 7/7 success criteria SATISFIED, SC4 with a named residual; 56 ledger rows re-run at the final tree, 55 RED + 1 GREEN with its replacement RED)
- [x] **Phase 140.3: SEAMUX — Client & wizard seam error surface** (INSERTED) - One source of truth for codes/copy, observe every HTTP outcome, never blame the user for our outage, non-destructive retry (shipped 2026-07-30, PR #651; VERIFICATION **gaps_found** 15/16 — 2 named residuals accepted as tracked tech-debt: **SEAMUX-03** (9 of 15 seam-importing routes still emit bare `{error}` not the typed `{code}` envelope — ⚠️user-facing error attribution) + poll-disjointness pin blind to `wizardFetch` (test-hygiene). See TODOS "v1.16 carried-forward residuals". ⏳ **G4–G8 gap-closure series is coding these arms route-by-route; G7 (2026-07-31) wire-audited `/api/strategies/csv-validate` and found per-arm machine codes ALREADY on the wire — 0 codeless arms — the VERIFICATION `grep -cE 'code:\s*"'` counted 0 only because this route carries `code` positionally through `csvErrorBody`; receipt is the extended `src/__tests__/csv-validate-route.test.ts` (arm-agnostic `json.code` sweep + SENTINEL_PII guard). G8 (2026-07-31) coded both admin match routes — `admin/match/eval` 0→6 coded arms, `admin/match/recompute` 0→10 incl. 2 coded deny bodies; TS-19 4xx forwards now carry `err.seamCode` with `dependency` intact; T-140-12 ordering preserved. G9 (2026-07-31) coded the TENTH route the VERIFICATION nine-route list MISSED — `/api/admin/strategy-review`, 0→27 coded arms (13 `REVIEW_SOURCE_READ_FAILED` byte-identical 503s, 5 `REVIEW_RECHECK_FAILED` 409s incl. a plan-missed status-pin 409, 2 `UNKNOWN` write-fault 500s, plus the auth/validation/gate tokens); arm-agnostic source-scan fence added; RED-on-neutering observed. Its only seam import is `scrubSeamError` (in-class by definition, no analytics call). **✅ SEAMUX-03 aggregate CLOSED 2026-07-31** — opus verifier PASSED (16/16 seam routes carry typed `{code}` on every reachable route-emitted arm; 817/817 tests; RED-on-neuter confirmed on 4 routes); `140.3-VERIFICATION.md` SEAMUX-03 → `resolved`. Non-blocking residuals → TODOS: 2 codeless `rateLimitDenyJson` deny bodies (SEAMRIM-05-pinned, rate-limiter boundary) + poll-disjointness pin (test-hygiene) + SC2 `COMPOSITE_UNSUPPORTED_UNIFIED` residual.**)
- [x] **Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open** (INSERTED) - Fabricated observations, destructive controls, our-fault-rendered-as-theirs, and the guards that cannot fail (shipped 2026-07-30, PR #652 + CR-01; VERIFICATION was `gaps_found` 39/43 but its user-facing gap is **STALE/RESOLVED** — verified 2026-07-31 that the `SEAM_MISCONFIGURED`→`UNKNOWN` translate hop IS present in current code at `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:538` + `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:851` (`recogniseSeamErrorCode`); the fix landed after the VERIFICATION was written. Only a non-blocking `analytics-client` scrub-test ledger-row residual (doc-hygiene) remains. See TODOS)
- [x] **Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth** (INSERTED) - What the codebase says about itself is true; ⭐carries `Retry-After` travels, a HARD PREREQUISITE for 141 (completed 2026-07-30)
- [x] **Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit** - Committed retry-safety audit, then bounded retry ONLY for allowlisted calls; teaser provably never retried (completed 2026-07-31)
- [x] **Phase 141.1: SEAMBACKOFF — Retry-After-aware backoff, breaker recalibration, and SEAM-05 evidence re-derivation** (INSERTED) - Scope from the 8-agent review campaign over 141; **zero user-facing and zero data-integrity defects found**, so no retry verdict changed and no budget row was un-flipped. 9/9 plans (completed 2026-07-31). VERIFICATION was `gaps_found` 19/20 and is now **passed** 20/20 on re-verification 2026-08-01 — all three gaps had been closed in the tree by post-verification work and the file was simply never re-run: D-06's last stale coordinate became a symbol anchor at `22332e34` (the whole self-relative-citation class is now absent from `resilient-fetch.ts`), the two deferred ledgers were reconciled so TODOS.md and `deferred-items.md` both carry all four `DEF-141.1-*` ids, and the Falsifiability Ledger closed at 20/20 observed with `nyquist_compliant: true`
- [x] **Phase 141.2: SEAMFIX — close the 141.1 code-review findings: duplicate onboard verification write, flag-monitor denominator integrity, breaker re-arm** (INSERTED) - 25 findings from the xhigh review (30 agents) deduped to 13; outcome is **twelve remediated, one dispositioned** — finding 8's retry↔limiter amplification is ACCEPTED, not fixed, and is stated as STILL LIVE everywhere it is summarised. Closes the duplicate `strategy_verifications` write on the money path (onboard's retry is now refused unless the call carries a truthy `wizard_session_id`, decided at the single chokepoint) and the three monitoring-integrity regressions D-16 shipped (unbounded `.select()` → `head: true` count, attacker-movable dedup deleted outright, read error now a distinct `denominator_read_failed` outcome rather than zero traffic). 6/6 plans (completed 2026-08-01). VERIFICATION was `human_needed` 17/17 and is now **passed** — three of its four production probes were discharged read-only on 2026-08-01 (42 rows / 42 distinct `correlation_id` / 0 `wizard:` prefix, flow_type resync 20 · csv 20 · onboard 2; unbounded `.select()` returned exactly 1000 rows at HTTP 200 with `error: null` against 7351 total, reproducing the silent truncation; all five breaker keys ABSENT, keeping finding 10 framed as hardening). The fourth — a real Railway-edge 503 carrying a malformed `Retry-After` — stays **Manual-Only and is not a gap**: it cannot be induced, and the only contract-bound 503 emitter we own structurally cannot emit one. ⏳ On PR #656, **not yet merged**
- [x] **Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL** - Writer-stamped transition timestamp + pg_cron reaper to terminal `failed` + threshold-math CI invariant + WEDGE-01 regression test (completed 2026-08-02)
- [→] **Phase 143: JOB — Dropped-enqueue reconciliation sweep** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 145: JOB — csv-finalize atomicity (reproduce-first)** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged
- [→] **Phase 146: RATE — Audit + close the two verified gaps** — ➡️ **CARRIED to milestone v1.19 on 2026-08-14.** Never started; charter moved intact to the v1.19 section at the top of this file, number unchanged

## v1.16 Phase Details (PARKED)

### Phase 140: SEAM — Shared resilience core + circuit breaker

**Goal**: A hung or dying Railway fails fast at BOTH seam chokepoints with a clean typed error — never a lambda held until platform kill, never a cascade-500
**Depends on**: Nothing (first phase of milestone)
**Requirements**: SEAM-01, SEAM-02, SEAM-03, SEAM-04
**Success Criteria** (what must be TRUE):

  1. With Railway mocked to hang, a `keys/sync` request (via `postProcessKey()`) AND an `admin/match/*` request (via `analyticsRequest()`) each return a typed error within their documented timeout budget instead of holding the lambda open — both chokepoints route through the ONE shared `resilient-fetch` core.
  2. After repeated Railway failures, a seam call from a DIFFERENT module context (simulating a second Fluid Compute instance) short-circuits with the typed `503 CIRCUIT_OPEN` envelope + human message without touching Railway — breaker state lives in the shared Upstash store (`breaker:railway`), never per-instance memory.
  3. When Upstash itself errors, seam calls still attempt the real Railway request — the breaker fails OPEN, so a broken breaker can never itself become the outage (deliberate divergence from the rate limiter's fail-closed).
  4. A CI test asserts `timeout × (1 + retries) < maxDuration` for every route calling either chokepoint, driven from ONE exported per-call-site budget table (replacing the divergent 30s / hardcoded-60s ad-hoc budgets).
  5. No route handler calling either client surfaces a raw fetch/breaker error as a 500 — every failure arrives as the typed envelope (the cascade-500 escape in `analytics-client.ts` callers is retrofitted shut).

**Plans**: 7 plans, 4 waves
Plans:

- [x] 140-01-PLAN.md — resilient-fetch core: SEAM_BUDGETS table + Upstash breaker (fail-OPEN) + full unit contract (wave 1)
- [x] 140-02-PLAN.md — both clients through the ONE core + CIRCUIT_OPEN envelope + SC-1c wiring test (wave 2)
- [x] 140-03-PLAN.md — admin/match Class-1: typed arms, err.message leak closed, SC-1b seam test (wave 3)
- [x] 140-04-PLAN.md — wizard Class-2: type-checked SERVICE_UNAVAILABLE_RETRY before substring cascade (wave 3)
- [x] 140-05-PLAN.md — Class-3 five routes: CIRCUIT_OPEN arms + optimizer refund + dormant fetch through core (wave 3)
- [x] 140-06-PLAN.md — third seam (permissions) through core + B-route maxDuration pins + SC-1a seam test (wave 3)
- [x] 140-07-PLAN.md — SC-4 budget invariant test + no-raw-analytics-fetch ESLint rule + phase gate (wave 4)

> **Phases 140.1–140.3 repair the surface Phase 140 shipped.** Five review rounds against the
> verified Phase 140 tree found 46 + ~120 original-code defects; five ad-hoc fix batches were
> **discarded wholesale** (`wip/v1.16-phase140-fix-archive`) because repairs without the
> plan→plan-check gate ran ~1:1 fix-to-defect. Evidence per finding:
> `.planning/phases/140-seam-shared-resilience-core-circuit-breaker/140-FINDINGS-CONSOLIDATED.md`.
> **PART 2 ("TRAPS") is binding on every plan in these three phases** — it is what survives of the
> discarded batches and it documents how each naive fix breaks.
>
> **They must land before Phase 141.** 141 builds retry on top of the breaker; retry over a breaker
> that under-counts (SEAMCORE-02) or trips on caller faults (SEAMCORE-01) amplifies outages.
>
> **Contract between the three:** 140.1 owns what the service EMITS (status codes, body shapes,
> limiter identity) · 140.2 owns the error TYPES · 140.3 owns how they RENDER. They share almost no
> files, which is what makes independent planning safe — the coupling is what produced the fix-batch
> collisions.

### Phase 140.1: PYAPI — Python service contract, status attributability & limiter identity (INSERTED)

**Goal**: The analytics service tells the truth about whose fault a failure is, cannot leak one tenant's verification to another, and cannot be denied platform-wide by an anonymous caller
**Depends on**: Phase 140 (the seam core exists; this phase fixes what it consumes)
**Requirements**: PYAPI-01..10
**Success Criteria** (what must be TRUE):

  1. Two tenants submitting a colliding `wizard_session_id` each see only their own verification — an RLS/SQL gate under `supabase/tests/` fails if the uniqueness constraint is not tenant-scoped, and the duplicate pre-check cannot return a foreign row.
  2. An exchange-side fault (maintenance, revoked key, IP-allowlist change) and a bad-credential fault each answer **4xx**; only a genuine service-side fault answers 5xx — so a single user's broken key can no longer contribute to a platform-wide breaker trip.
  3. An anonymous caller hammering the public teaser cannot exhaust the `/process-key` allowance for authenticated tenants — throttling is bounded per tenant, not by one bucket keyed on the shared internal token.
  4. On `/process-key`, an unauthenticated request is rejected before validation and before throttling — it can neither enumerate feature flags nor consume throttle budget.
  5. No replay can return "duplicate" for work that was never enqueued, and no state exists from which the client is told to retry with no path to success.
  6. A missing or stale platform secret produces an operator signal; no response body echoes caller credentials; validation detail and throttle responses arrive machine-readable (`Retry-After`, structured `detail`).

**Plans**: 9 plans, 5 waves
Plans:

- [x] 140.1-01-PLAN.md — PYAPI-01 SQL half: tenant-scoped composite unique index + RED-first supabase/tests gate (wave 1)
- [x] 140.1-02-PLAN.md — PYAPI-01 query half + PYAPI-09: pre-check move/scoping/ownership, enqueue-aware duplicate path, RPC dedupe fence (wave 1)
- [x] 140.1-03-PLAN.md — PYAPI-05 contract artifact + R-2 helper; remap exchange.py S-01..S-07 + internal.py S-08..S-12 (wave 1)
- [x] 140.1-04-PLAN.md — PYAPI-05 remap match/simulator/portfolio S-13..S-20 + main.py S-23 JSONResponse literal (wave 2)
- [x] 140.1-05-PLAN.md — PYAPI-10: ok discriminator on all six 200 shapes; scope rejection 200→403 (wave 2)
- [x] 140.1-06-PLAN.md — PYAPI-04 auth-first middleware + PYAPI-02 HMAC tenant-claim limiter + TS mint (wave 3)
- [x] 140.1-07-PLAN.md — PYAPI-03: delete 3 private limiters, rekey all 9 IP-keyed routes, flow-cost table (wave 4)
- [x] 140.1-08-PLAN.md — PYAPI-07 scalar-detail 422 handler + PYAPI-08 machine-readable 429 + PYAPI-06 operator signal (wave 4)
- [x] 140.1-09-PLAN.md — Phase gate: CI-mirror runs, M1-M8 mutation ledger, TS-obligations artifact, PROD wedge count (wave 5)

### Phase 140.1.2: PYAPI-FIX2 — close the venue-transient class on the live route + the surviving 140.1.1 review findings (INSERTED)

**Goal**: The venue-transient class is closed on the route real users actually hit, and every finding that survived adversarial refutation is closed or explicitly, reasonedly deferred
**Depends on**: Phase 140.1.1 (closes findings against its 25 commits)
**Requirements**: PYAPIFIX2-01..06
**Evidence**: `140.1.1-STAGE1-FINDINGS.md` (5 lenses) + `140.1.1-STAGE2-FINDINGS.md` (5 red teams) + `140.1.1-REVIEW.md` (36 mutations, 30 caught, 6 survived). **An adversarial refutation pass refuted 4 of 10 findings outright and reduced 3 more — this scope is only what survived.**
**Success Criteria** (what must be TRUE):

  1. **A venue-transient fault answers a typed, classifiable error at EVERY consumer of `validate_key_permissions` — including `/api/validate-key`, the live key-connect route.** Today `analytics-service/routers/exchange.py` (the C6 site — `if result["error"]:` :596) and `analytics-service/routers/portfolio.py` (the C7 site — `if validation.get("error"):` :2338) collapse `RATE_LIMITED`/`DDOS_PROTECTION`/`EXCHANGE_UNAVAILABLE`/`NETWORK_UNAVAILABLE`/`PROBE_FAILED` into an opaque 400 with no `code` and no `retryable`. **The arm 140.1.1 fixed serves teaser/csv/internal_report; the unfixed one carries strictly more real traffic.** A test must prove that a Binance-maintenance-shaped failure during key-connect no longer renders as `UNKNOWN`/500 *"our team has been notified"* with no retry affordance. ⚠️ **DISPOSITION (140.1.2 plan 04): PYTHON HALF CLOSED (7/7 sites carry code+recoverable); RENDER HALF → OB-1, owner 140.3** (ledger row `TS-35`) — the *renders* assertion in this criterion is a TypeScript assertion (`create-with-key/route.ts` returns the classifier-computed status and discards the upstream one, RESEARCH C-1), so this criterion is HALF met by this phase, deliberately and on the record.
  2. **A permanent MT5 credential fault is never retried as a transient venue fault** — or the phase records, with evidence, that the path is unreachable. `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` are absent from both `PERMANENT_VALIDATION_ERROR_CODES` and `analytics-service/services/ingestion/long_fetch.py`'s local `permanent_codes` set (:406), so the live worker path burns 3 gateway-serialised retries on a credential that can never succeed — while TypeScript already calls both 400 client faults. **Reproduce-first: "could not reproduce" is a valid outcome** (one red team held MT5 never reaches `validate_key_permissions`).
  3. **`/internal` throttling emits the service's own envelope**, giving the 429 builder arm added in 140.1.1 its first call site — today `analytics-service/routers/internal.py`'s `_consume_rate_limit` throttle (guard :231, emit :251) raises a raw `HTTPException(429)` one line away from it, so the arm has zero callers and the response carries no `code`.
  4. **Every user-facing 429 carries a `Retry-After`** — `analytics-service/routers/match.py:1742`, `analytics-service/routers/portfolio.py:1964`, `analytics-service/routers/simulator.py:249` currently do not.
  5. **The 200-discriminator corpus cannot silently shrink.** Deleting a `_SHAPES` row was OBSERVED to survive (141→140 passed) after 140.1.1 correctly removed a self-referential guard that was *also* the only corpus fence.
  6. **The phase's artifacts state only what they can support**: `140.1.1-VERIFICATION.md` reads `gaps_found` (its "no already-correct test was removed" claim is false, and PYAPIFIX-02's carve-out was evidenced by a `grep -c` that proves a marker exists, not that a list is complete); and in `analytics-service/docs/STATUS_CONTRACT.md` the "not seam-reachable" list no longer points at a **live 424 arm** (`analytics-service/routers/exchange.py` — `service_error(424, "EXCHANGE_PROBE_FAILED", …)` :565), S-11's line ref is correct, the "four classes" heading matches its five-row table, and the dependency census is right. ⚠️ **No general comment sweep** — the "refs off by the inserted-line count" diagnosis was **refuted**; most drift pre-dates the phase, so any number recomputed as old+18 would be wrong.

**Plans**: 4 plans / 3 waves
Plans:

- [x] 140.1.2-01-PLAN.md — PYAPIFIX2-02: gated reproduce-first MT5 permanence (adapter-provenance fix or NOT-REPRODUCIBLE exit) (wave 1)
- [x] 140.1.2-02-PLAN.md — PYAPIFIX2-03 /internal 429 → service_error + PYAPIFIX2-04 Retry-After ×4 + the fenced census-comment exception + TS-34 (wave 1)
- [x] 140.1.2-03-PLAN.md — PYAPIFIX2-01: venue-transient class closed 7/7 via flat scalar-detail shape + machine code; TS-32 corrected + TS-35 added (wave 2)
- [x] 140.1.2-04-PLAN.md — PYAPIFIX2-05 _SHAPES↔AST fence + PYAPIFIX2-06 artifact truth + phase gate (wave 3)

### Phase 140.1.1: PYAPI-FIX — H-5 duplicate-reply contract break + close the 12 surviving mutations (INSERTED)

**Goal**: Phase 140.1's own review findings are closed — nothing it shipped breaks a live consumer, and every test the review's mutations proved toothless now bites
**Depends on**: Phase 140.1 (closes findings against its 41 commits)
**Requirements**: PYAPIFIX-01..06
**Evidence**: `.planning/phases/140.1-.../140.1-REVIEW.md` — `issues_found`, 0 critical / 24 warning / 12 info, **36 mutations injected, 12 SURVIVED**. Each survivor is proof of a toothless test, not an inference.
**Success Criteria** (what must be TRUE):

  1. **The `/process-key` duplicate reply and its consumer agree on ONE contract.** ⚠️ *De-escalated 2026-07-26 — this is NOT a live break.* Source-verified: **no live caller can trigger the 502 today** — `finalize-wizard/route.ts` and `keys/sync/route.ts` contain ZERO `wizard_session_id`; the duplicate path requires a caller-supplied one (`analytics-service/routers/process_key.py` — `idempotent_by_session` :1033-1035); csv arms return before the pre-check; `create-with-key`/`composite/add-key` use it only in direct SQL RPCs. It is **contract incoherence with a live 502 arm** — a trap for the next caller, and 140.2/140.3 add callers. Fix it for coherence, not urgency. `analytics-service/routers/process_key.py` — `_wizard_duplicate_reply` :717, body :737-747 — emits `queued:true` WITH `code`/`idempotent`; the guard at `src/lib/process-key-onboard-contract.ts` — `isProcessKeyOnboardResponse` :97, imported by `src/app/api/strategies/finalize-wizard/route.ts:31` — rejects exactly that shape (`if ("code" in r || "idempotent" in r) return false;` — "mixed envelope = bug"), and the miss arm emits Sentry + **HTTP 502**. A test must exercise the REAL Python reply against the REAL TS guard — today both suites are green **because each mocks the other**, which is precisely how this landed. *(Verified at source: the guard is Phase 140's own commit `57b11813` on this SAME unmerged branch — NOT deployed, and 140.1 never touched that file. So there is no rollout-ordering constraint; pick the fix direction on contract quality. At base `43449cc6` both duplicate arms hardcoded `"queued": False`, which the guard's `queued=false` branch accepts — that branch permits `code`/`idempotent`. The regression is solely that PYAPI-09 made `queued` sometimes true while keeping them.)*
  2. **Venue-transient faults are 424/retryable, not 403** — via a **permanent-code ALLOW-LIST**, never a transient denylist. No response body may say `recoverable:false` beside "Try again in a moment." *(Corrected 2026-07-26 at source: (a) the claim that `/exchange/validate-key` "already gets this right" is **FALSE** — `read_only is False` appears exactly twice repo-wide, `analytics-service/routers/process_key.py:1597` (in `_scope_rejected`) and `analytics-service/services/ingestion/long_fetch.py:331`; that route never evaluates it. The real analog is `analytics-service/services/ingestion/long_fetch.py` — `permanent_codes` :406-409 feeding `_is_permanent` :432-438. (b) The research's proposed **transient denylist fails unsafe — it is literally the existing bug's shape**; `long_fetch` uses a permanent allow-list, follow that. (c) `MISSING_SCOPE` **must** be in the allow-list — `analytics-service/services/exchange.py:1103-1116` (the deribit `scope_detail` branch inside `validate_key_permissions`) sets `read_only=False` + `error_code="MISSING_SCOPE"` and returns without `valid=True`, and it is absent from `long_fetch`'s `permanent_codes`, so a permanent scope fault would otherwise become a retryable 424. (d) The review both over- and under-counted: its "two sites" are one predicate + its single return, and it **missed `analytics-service/routers/process_key.py`'s `recoverable` derivation (:405-412)**, which omits `PROBE_FAILED`/`DDOS_PROTECTION` — no status-code change fixes that.)*
  3. **`create_exchange` failures are 500, not 424 — at all THREE sites.** `analytics-service/routers/internal.py` — `create_exchange` :485 and its `except Exception:` arm :488-522 (S-11) — classifies them as "problem at the venue", but that function performs **no network I/O** — every real failure (ccxt `TypeError`, `ImportError`, OOM) is ours. As 424 it is breaker-inert AND 4xx, so **nobody is ever paged**. *(Corrected 2026-07-26: the pattern-mapper found this is a **3-site class, not 1** — `analytics-service/routers/portfolio.py:2283` is a third, and the **same function's second `create_exchange` at `:2373` already answers 500**, which is in-repo proof the class is real. This is exactly the instance-not-class defect the mapper exists to catch; a point-fix would have shipped.)*
  4. **The `body.detail.detail` scalar guarantee is ENFORCED, not documented.** `analytics-service/services/error_contract.py` — `service_error_body` :230, its C1 scalar guard :245-256 — is what Phase 140.2 renders from; today lists and dicts emit verbatim (proven by execution). Every other class rule in that module is a hard guard.
  5. **Every one of the 12 surviving mutations turns a test RED**, re-run and observed first-hand. Named in the review; they include S-06's split pinned by a single ccxt subclass (narrowing `except ccxt.BaseError` survived **twice**, and under it `RateLimitExceeded` answers 500 — the exact A-01/C-12 defect this programme exists to fix), `RETRY_AFTER_SECONDS["supabase"]` (15→900 survived), `default_platform_key` returning `""` (**makes slowapi skip limiting entirely** and ships green), and the 429's `Retry-After` value.
  6. **`error_contract.py`'s remaining guard gaps are closed — the circular deferral is broken.** *(Added 2026-07-26 from two red teams; no downstream phase can fix these — 140.2/140.3 are TypeScript-only by their own CONTEXTs and 146 is a rate-limit phase, so they currently have NO reachable owner.)* **(a)** A `429` carrying `Retry-After` is **constructable**: today `retry_after` requires `retryable:true` while the CALLER arm raises on `retryable:true` (`analytics-service/services/error_contract.py` — `_validate` defined :100, its generic-CALLER arm :218-227, the `retry_after`-implies-`retryable` rule :118-119) — yet `140.1-VERIFICATION.md` gap 1 and obligation TS-23 both MANDATE migrating the two in-handler 429 sites onto that envelope. **(b)** The `>=500` arm rejects a venue `dependency`: today `service_error(500, "X", dependency="binance", retryable=False)` validates, and **Phase 140.2 keys the breaker on `dependency`** — a venue name on a 500 poisons a breaker key.

**Plans**: 7 plans / 4 waves
Plans:

- [x] 140.1.1-01-PLAN.md — PYAPIFIX-04+06: all 4 error_contract guard gaps (429 arm, 500-dep membership, scalar detail, retry_after source) + doc reconciliation (wave 1) — **DONE** 2026-07-26, 5 commits `0a195a5f..7454330c`; criteria 4 + 6a/6b observably true; 48 new tests, all RED-first; suite 4668/96 skipped, mypy 89 files clean
- [x] 140.1.1-02-PLAN.md — PYAPIFIX-02: permanent-code allow-list, 424 pre-gate + recoverable fix, TRAP-9 fence unedited, M-4 carve-out BLOCKED-BY: TS-05 (wave 1)
- [x] 140.1.1-03-PLAN.md — PYAPIFIX-01 Python half: predicate extraction to src/lib leaf + committed fixture proven equal to real TestClient bodies (wave 1) — **DONE** 2026-07-26, 2 commits `82f84f28` (extraction, 59 route tests green UNEDITED) + `0c45da2c` (fixture + 6 contract tests). `src/lib/process-key-onboard-contract.ts` has **0 imports**, both symbols exported, one implementation repo-wide; fixture **tracked in git** (5 cases, 2 positive / 3 negative), positives proven equal to REAL full-stack `main.app` TestClient replies on BOTH duplicate arms; falsifiability probe RED observed → reverted → GREEN. No Python production file touched. Suite 4704/96 skipped, mypy 89 files clean, tsc 0, lint 0 errors. **Wave 1 COMPLETE — `wave_0_complete: true`, plan 05 unblocked.**
- [x] 140.1.1-04-PLAN.md — PYAPIFIX-03: create_exchange class 3/3 sites -> 500 retryable:false + M-14 log companions (wave 2) — **DONE** 2026-07-26, 6 commits `9adbedae..6b754def` (3 RED/GREEN pairs). **Class closed at 3/3, not the review's 1 or RESEARCH's 2**: `analytics-service/routers/internal.py:517` (B1), `analytics-service/routers/exchange.py:541` (B2), `analytics-service/routers/portfolio.py:2309` (B3 — named by NOBODY, found only by the pattern-mapper because British "initialise" defeats the grep). All three raise `service_error(500, "ADAPTER_INIT_FAILED", retryable=False)` with ONE shared copy; **no `dependency` on any** (plan 01's C3 guard makes the old shape unconstructable); no `Retry-After`. `EXCHANGE_INIT_FAILED` retired at **0** raise sites; `grep "Failed to initiali" routers/` → **0**. `ValueError` → 400 preserved and newly pinned at all three. B4 (`analytics-service/routers/portfolio.py:2550` — the `500 "Strategy verification failed"` arm) and B5–B8 byte-unchanged. **M-14 closed at 2/2** (`analytics-service/main.py:777` `service_key.secret_unset` + `:804` `service_key.mismatch`), with the absent-header 0-event fence proved falsifiable by a neuter probe (dedent → 1 failed / 3 passed, reverted). 2 new test files, +12 tests. Suite **4716/96 skipped/0 failed**, mypy 89 files clean, 0 new `type: ignore`.
- [x] 140.1.1-05-PLAN.md — PYAPIFIX-01 TS half: widen guard + 3 new invariants, parity test, both-direction neuter proof, TS-OBLIGATIONS reconciliation, M-11 record (wave 2) — **DONE** 2026-07-26, 3 commits `8865400c` (RED parity test) → `2f776271` (GREEN widening + TS-03 comment inversion, same commit per the ledger's own warning) → `58441952` (route.test rewrite). **PYAPIFIX-01 CLOSED.** The mixed-envelope rejection is deleted and the union widened, with THREE compensating invariants (non-empty `code`; `idempotent` ⇒ `true` AND `code === "WIZARD_DUPLICATE"`, one-directional by design; `verification_id` string retained), each pinned by a negative fixture case in BOTH languages. **RED observed first (3 failed / 6 passed) — and richer than predicted: N2 (`code:""`) was ACCEPTED pre-widening, proving invariant 1 is genuinely new teeth, not a trade.** ⭐ **The oracle is BIDIRECTIONAL, both directions observed first-hand:** neutering `_wizard_duplicate_reply` (`"code"`→`"codes"`) ⇒ pytest **2 failed** (*"only in reply: ['codes']; only in fixture: ['code']"*); neutering the predicate (`return true` first) ⇒ vitest **4 failed** (every negative wrongly accepted). Both restored from scratch copies OUTSIDE the repo, tree clean, `grep -rn MUTANT` → 0. `grep -c "vi.mock"` on the parity test → **0**. `src/app/api/strategies/finalize-wizard/route.test.ts:1819` (the "PYAPIFIX-01 — the INVERTED contract" test) **REWRITTEN not deleted** (59 → 61, 0 deleted) with TWO retained negatives. Coverage gate (OQ-6) settled by measurement: 84.36/78.37/81.43/86.49 vs 80/72/74/82; full frontend suite **8878 passed / 0 failed**; tsc 0; lint 0 errors. Python re-verified after the cycles: **4716/96/0**, mypy 89 files clean. Ledger reconciled: TS-01/TS-03 **DONE-IN-140.1.1**, TS-02 sharpened, TS-23 **UNBLOCKED**, TS-32 (M-4 ↔ TS-05 pairing) + TS-33 (M-11) added, 31→33, TS-04..22/24..31 byte-unchanged. **M-11 DECIDED, not implemented.** **WAVE 2 COMPLETE.**
- [x] 140.1.1-06-PLAN.md — PYAPIFIX-05 batch 1: survivors #1/#2/#6/#7/#12 + M-15 AST fence, mutation re-runs observed RED (wave 3) — **DONE** 2026-07-26, 3 commits `33f03757` (ccxt family) → `803198ec` (#6/#7/#12) → `0ff9446e` (M-15 AST fence). **6 mutation cycles / 8 runs, EVERY result OBSERVED FIRST-HAND — zero "asserted only" rows.** #1 `except ccxt.BaseError`→`NetworkError` ⇒ **3 failed / 5 passed** (`PermissionDenied must answer 424, got 500`); #2 →`ExchangeNotAvailable` ⇒ **6 failed / 2 passed** (`RateLimitExceeded must answer 424, got 500`) — both `assert 500 == 424`. The parametrisation straddles BOTH ccxt roots (7 subclasses) so no single narrowing satisfies it, with the non-ccxt `RuntimeError` control INSIDE the table so an `except Exception` widening also fails. #6 `"supabase": 15`→`900` ⇒ **4 failed / 0 passed** `assert '900' == '15'` at all four sites (≥1 red per file, targeted node ids only); the verbatim mt5-gateway idiom is now applied 4×. #7 `_KEK_ALERT_WINDOW_S 300.0`→`1e18` ⇒ **1 failed** `assert 1 == 2` — the test is now a **driven three-phase clock** (1 inside / still 1 inside / **2 after the LITERAL 300 s expires**), because the old free-running-clock count assertion was satisfied by any window longer than the test. #12 junk copy ⇒ **1 failed** — the human sentence is pinned by EQUALITY against a literal, the `!= AUTH_FAILED_DETAIL` guard kept. **M-15 DELETED** (`len(_SHAPES) == 6` against a same-file list literal, plus its false docstring) and replaced by an **AST-fingerprint SET** derived from `routers/process_key.py`'s own source — 8 fingerprints, never a count (C-20: the six was a coincidence of one collapse cancelling one expansion) — with a 200-capable filter (no `status_code=` or literal 200) that excludes the 401/403/422/**424** arms, asserted from both sides. **All three probes observed:** (a) a 7th 200 return ⇒ **1 failed / 16 passed** naming `dict:code,mutant,ok`; (b) 3 blank lines above the handler ⇒ **17 passed**; (c) `return JSONResponse(status_code=418, …)` ⇒ **17 passed**. Every restore from a `cp` scratch copy under `/tmp` — **zero** `git stash`/`git checkout`/`git clean`. Wave-3 gate: **4724 passed / 96 skipped / 0 failed** (4716 + 7 + 1, reconciles exactly), mypy --strict 89 files clean, **0** new `# type: ignore`, `grep -rn MUTANT` → 0, **zero production files modified**. **WAVE 3 COMPLETE.**
- [x] 140.1.1-07-PLAN.md — PYAPIFIX-05 batch 2: slowapi #3/#4/#5 on 0.1.10 + claim-parser #8-#11 (both #11 sites) + phase-wide gates (wave 4) — **DONE** 2026-07-26, 3 commits `b7e7023c` (#3/#4 behavioural) → `d5a49fef` (#5 tight band) → `39688d69` (#8-#11 new file). **8 mutation runs, EVERY RED OBSERVED FIRST-HAND — zero "asserted only", zero non-reddening findings. With batch 1 this is 13/13 phase-wide = ROADMAP criterion 5 COMPLETE.** ⭐ **slowapi synced 0.1.9 → the CI pin `0.1.10` BEFORE any #3/#4/#5 cycle** and both dependent internals re-confirmed on it (`if all(args)` empty-key skip at `slowapi/extension.py:506-527` — the pinned dependency's own source, `analytics-service/.venv/.../site-packages/slowapi/extension.py`, not a repo file; `view_rate_limit` = `(limit, [key, scope])` at `:530`); env left at 0.1.10. #3 `default_platform_key` → `return ""` ⇒ **3 failed / 65 passed** incl. **`never answered 429 within 4 calls`**; #4 → per-request `uuid4().hex` ⇒ **3 failed / 65 passed** incl. the stability assertion + the same missing 429. The old oracle was `assert _key_func is default_platform_key` — object IDENTITY, true for any body — so the new gate drives **real HTTP requests** through a throwaway app whose route declares NO `key_func` (no production route exercises the singleton default at all), decorated ONCE at module scope, bounded-and-driven; the identity assertion (`analytics-service/tests/test_limiter_identity.py:495`) is RETAINED. #5 `_retry_after_seconds` → `return 1` ⇒ **2 failed** — `0 < 1 <= 3600` passed the old bound, so a `> window * 0.9` band was added at **BOTH** weak sites (route A `/api/verify-strategy` AND route B `/api/csv/validate`, different routers), derived from the test-declared limit string, never from the function under test; mutation hits the computation (`analytics-service/main.py` — `_retry_after_seconds` :461-490), oracle reads the header (`:529`). **New file `tests/test_tenant_claim_parsing.py` (14 tests) — the four guards had NO test at all, not weak tests.** #8 drop the 512 bound ⇒ **2 failed** (`a 513-char claim was ACCEPTED` + `ran hmac.new 1 time(s)`) — ⚠️ the fixture is a **correctly-minted, VALID, merely oversized** 513-char claim because 513 chars of junk would NOT redden (rsplit raises, the never-raise except swallows it, `is None` holds either way); the spy substitutes rate_limit's `hmac` MODULE attribute, with a negative control asserting an ordinary claim reaches the MAC exactly once. #9 `rsplit`→`split` ⇒ **3 failed**; #10 drop the empty-payload guard ⇒ **3 failed**, mutant bucket literally `'claimtest:t:'`. **#11 closed 2 of 2**: `:333` ⇒ **1 failed** (the `:417` test GREEN), `:417` ⇒ **1 failed** (the `:333` test GREEN) — the asymmetry is the proof of independent coverage. Zero symbols imported from the module under test except the 3 functions under test; every expectation a literal or stdlib-minted. **PHASE-WIDE GATE (all five, first-hand):** pytest **4743 passed / 96 skipped / 0 failed** (4724 + 5 + 0 + 14, reconciles exactly) · collection **4837**, 0 errors, and the 4837-vs-4839 delta traced to 2 PRE-EXISTING module-level `allow_module_level` skips rather than assumed · `mypy --strict` **89 files clean** · `npx tsc --noEmit` **0** · full `npm run test:coverage` **8878 passed / 0 failed** (697 files) with all four thresholds clear · `npm run lint` **0 errors** · **0** new `# type: ignore` phase-wide · `grep -rn MUTANT` → 0 · **zero production files modified**. **WAVE 4 COMPLETE — PHASE 140.1.1 EXECUTION COMPLETE (7/7 plans).**

### Phase 140.2: SEAMCORE — Seam core & breaker correctness + harness integrity (INSERTED)

**Goal**: The breaker counts the failures it exists for, ignores the ones it must not, and every constant governing it is falsifiable
**Depends on**: Phase 140 (the core), Phase 140.1 (consumes its status contract — do not ship a discriminator against a contract 140.1 is changing)
**Requirements**: SEAMCORE-01..11
**Success Criteria** (what must be TRUE):

  1. A stalling upstream that returns headers fast and the body slow **records a failure** — the recording window covers the body read, and the deadline surfaces as a typed seam error, not a raw `DOMException`.
  2. A caller fault (malformed service URL, bad timeout override) and an exchange-attributable upstream error each record **zero** breaker failures; a genuine service fault records one — including when the body is `text/plain`.
  3. Mutating any breaker constant or any per-route timeout budget turns a test **RED**. Today 10 simultaneous semantic mutations produce a byte-identical pass; this criterion is the direct inversion of that.
  4. The breaker's Redis-side semantics (sliding-window decay, weighted carry-over, `nx` trip idempotency) are verified against **real Redis**, not a fixed-window fake that cannot execute the deployed Lua.
  5. A degraded or hung breaker store cannot hold a lambda past its declared budget, and the budget invariant accounts for store round trips in the closed, open and failing states.
  6. Adding an import to the shared error leaf, swapping a call site's budget key, or routing a health warmer through the core each fail a test — the structural invariants are enforced, not documented.
  7. **`analytics-client.ts` mints the `X-Tenant-Claim` header, flipping the SIX rekeyed Python routes reachable from that client — five live, one dead — from `platform:<path>` to genuine per-tenant throttling.** ⚠️ *Corrected 2026-07-27 by plan 140.2-09, which delivered it.* This criterion previously read **"flipping all nine rekeyed Python routes"**, which is false and was false when written. The behaviour-derived answer comes from a reproducible sweep — `grep -rn "key_func=partial(tenant_or_platform_key" analytics-service/routers/` → 9 sites, each route path then grepped across `src/` and the hit READ: **6 reachable** from `analytics-client` (`validate-key`, `encrypt-key`, `optimize-weights`, `portfolio-optimizer`, `portfolio-bridge` **live**; `portfolio-analytics` reachable but its wrapper `computePortfolioAnalytics` has **zero production callers**, so it flips a dead path) and **3 unreachable from that client by construction**: `fetch-trades` is reached only by an eslint-allowlisted debug raw fetch, and `csv/validate` and `verify-strategy` have their TS routes re-targeted to `/process-key` (which was already per-tenant since 140.1), leaving the Python routes of those names with zero TS callers. Those three are **unaffected** by TS-04 and need a separate owner if they are ever to be flipped. (Inherited obligation **TS-04** from Phase 140.1, which completed the Python half — the same key function provably returns `optimize_weights:t:<user>` the instant a claim appears, and the cross-language HMAC link is proven end-to-end. Until this lands, PYAPI-02's per-tenant guarantee holds for `/process-key` ONLY. ⚠️ *Corrected 2026-07-26:* the claimless arm at `analytics-service/services/rate_limit.py` — `_platform_bucket` :169-188 — is `platform:<path>` **per route**, so the nine sit in **nine separate** platform-wide buckets, not one shared one — exhausting `/api/optimize-weights` does not touch the other eight. Also **not a merge regression**: pre-phase these routes were IP-keyed behind Vercel egress NAT, i.e. already effectively platform-wide. TS-04 makes them better; its absence does not make them worse.) A test must prove a request from tenant A cannot consume tenant B's allowance on at least one of the nine. *Satisfied on all FIVE live routes, not the minimum one, by `src/lib/analytics-client.test.ts` — which drives each wrapper twice with two server-derived identities and reproduces the Python bucket decision (`verify_tenant_claim` + `tenant_or_platform_key`, transcribed by hand) to show `<scope>:t:tenant-a` vs `<scope>:t:tenant-b` rather than one shared `platform:<path>`. It also refuses the payload-splice forgery. The zero-signature-change shortcut — satisfying the clause via `runPortfolioOptimizer`/`findReplacementCandidates` alone, both of which already carried an actor id — was available and deliberately NOT taken: it would have left the two busiest key-connect endpoints and the 20/minute optimizer on a platform bucket.*

**Plans**: 12 plans / 12 waves (`workflow.use_worktrees=false`, so waves order the work sequentially on the main tree rather than parallelising it)

> ⚠️ **Was 14 plans / 14 waves.** On 2026-07-26, during the plan-checker review, the developer re-homed
> two consumer-surface plans to Phase 140.3: `140.2-12` → `140.3-01` (TS-05/08/09) and `140.2-13` →
> `140.3-02` (TS-02/11–15). Old plan 14 became plan 12 (wave 12). **This is a re-home, not a scope
> cut** — the work and its six Falsifiability Ledger rows (M51–M56) moved intact and are recorded in
> `140.3-CONTEXT.md`'s handover note. The 140.2 ledger is correspondingly **55 rows**, not 57.

Plans:

- [x] 140.2-01-PLAN.md — SRH spike, then the real-Redis lane + `frontend-seam-redis` CI gate, and the six mutation rows only that lane can observe (SEAMCORE-09 / SC4)
- [x] 140.2-02-PLAN.md — the literal-pinned constant + budget oracle, the route-row deep compare, **and cutting the self-referential fake at all 4 `fakeRatelimitFor` sites** (SEAMCORE-07 / SC3) — ✅ **both oracle layers closed; `opts.limiter.tokens` → 0 in src/; M14b measured 1-failed → 7-failed across the cut; 20/20 rows OBSERVED RED**
- [x] 140.2-03-PLAN.md — 13/13 budget-key pins **+ a roster mechanism that fails on a 14th**, leaf purity, warmer exclusion (SEAMCORE-08 / SC6)
- [x] 140.2-04-PLAN.md — fixed-point alias taint in `no-raw-analytics-fetch` + all four URL shapes (SEAMCORE-08)
- [x] 140.2-05-PLAN.md — the try block in ONE pass: body-read window, URL/deadline hoist, `redirect: "error"`, override validation (SEAMCORE-02, SEAMCORE-11 / SC1)
- [x] 140.2-06-PLAN.md — attributability discriminator + per-dependency breaker keying + OB-8 (SEAMCORE-01 / SC2)
- [x] 140.2-07-PLAN.md — bounded store, the A-09 sentinel, single-read breaker state, no-re-arm, store-aware budget arithmetic (SEAMCORE-03/04/05 / SC5)
- [x] 140.2-08-PLAN.md — the redaction leaf at 15 log sites + 10 Sentry captures, and the breaker transition event (SEAMCORE-06)
- [x] 140.2-09-PLAN.md — `X-Tenant-Claim` minted from `analytics-client`, five live routes flipped (SC7 / TS-04)
- [x] 140.2-10-PLAN.md — composite fan-out capped at the query; the budget table models the branch actually taken (SEAMCORE-10)
- [x] 140.2-11-PLAN.md — one defined outcome for non-JSON 2xx / 204 / 205 / 304 across both clients; `CircuitOpenError` validation (SEAMCORE-11)
- [x] 140.2-12-PLAN.md — the Falsifiability Ledger re-run at the final tree, phase gates, artifact reconciliation — **DONE** 2026-07-27. **56 rows re-executed at `48e6e3e2` (55 as planned + M19R), 55 RED and 1 GREEN.** ⚠️ **M19 (`nx: true → nx: false`) NO LONGER REDDENS** — wave 7's `existing.expiresAtMs > now` early return now fires ahead of the lock write, so a sequential second trip never reaches `set(..., nx)` and the flag became unobservable by R-3. The property (trip idempotency) is still enforced and is still falsifiable via the replacement row **M19R**, which was OBSERVED RED; the `nx` flag ITSELF is now unfalsified and is handed to Phase 141. **M14b's two-test receipt reconfirmed at the final tree** (pin + the behavioural trip-count case, 8 failures total) and all four `fakeRatelimitFor` sites re-verified by code text as taking the hand-typed default — the wave-2 cut held. Gates: coverage 84.57 / 78.52 / 81.78 / 86.68 vs 80 / 72 / 74 / 82 on 9303 passed / 287 skipped (724 files); `tsc` 0; `lint` 0 errors (cache cleared); real-Redis lane 7/7 with its executed-case fence matching; **zero `.py` in the phase diff**; zero new type suppressions; `SEAM_RETRIES` still 0.

*(Re-homed to Phase 140.3 on 2026-07-26: the former 140.2-12 → `140.3-01`, the former 140.2-13 → `140.3-02`. **This is a re-home, not a scope cut** — recorded here so the 14 → 12 drop is not read as work that was dropped.)*

#### Success-criterion adjudication — plan 140.2-12, 2026-07-27

Each verdict is backed by a named receipt observed first-hand at the final tree, or by an explicit
reason. A phase that reports 7/7 by softening a criterion is the failure this programme exists to end.

| SC | Verdict | Evidence |
|---|---|---|
| **SC1** | **SATISFIED** | `resilient-fetch.test.ts > headers arrive, the body then aborts ⇒ exactly ONE recorded failure and a typed SeamBodyReadError`. Falsifier **M26** RED at the final tree — 12 cases across 4 files, incl. `expected DOMException{…} to be an instance of SeamBodyReadError`. |
| **SC2** | **SATISFIED** | Six attributability-class cases in `resilient-fetch.test.ts` + 65 cases in `seam-discriminator.test.ts`. **Both** `text/plain` readings covered (500 ⇒ ZERO, 503 ⇒ ONE on the residual global key). Falsifiers **M25** (3 RED), **M38** (3 RED), **M35** (3 RED), **M39** (4 RED). |
| **SC3** | **SATISFIED** | 69 cases in `seam-constants.pin.test.ts`. **M1–M13 each RED individually**; **M14/M14b/M15/M16/M17** RED; **M24** RED. "Any breaker constant" verified by MEASUREMENT, not by reading the pin file: five supplementary probes beyond the ledger — `BREAKER_LOCK_TOMBSTONE_S`, `BREAKER_STORE_RETRIES`, `BREAKER_STORE_BACKOFF_MS`, `BREAKER_KEY`, `SEAM_RETRIES` — were each mutated and each reddened (3 / 6 / 4 / 3 / 16 cases). **All ten exported breaker and store constants are falsifiable.** |
| **SC4** | **SATISFIED — with one named residual, and adjudicated on evidence rather than on plan 140.2-01's memo.** | The SRH verdict was PASS-EVALSHA, so the PASS arm applies, and it was re-verified first-hand rather than inherited: the lane ran 7/7 against the two digest-pinned containers, its anti-vacuity fence (`EXPECTED_CASES = 7`) matched the 7 cases executed, and **seven mutations were OBSERVED RED against real Redis executing the deployed Lua** — M14 (R-2), M15 (R-5), M16 (R-7), M18 (R-4), M19R (R-3), M20 (R-1), M20R (R-1). Decay and weighted carry-over (M15/M16) and trip idempotency (M19R) are all falsified. ⚠️ **RESIDUAL, stated rather than absorbed: the `nx` flag named in the criterion's own wording is NOT itself falsified any more** (see M19 above). Trip idempotency is; the `nx` mechanism is NOT redundant and is NOT a second layer — it is ORTHOGONAL. The wave-7 early return requires the read to have SEEN a live lock; `nx` guards the case that return structurally cannot reach, namely two Fluid Compute instances that both read `null` and both write. (Wording corrected post-review per W-1: `140.2-VALIDATION.md` §8 called it "a real behavioural difference and a real open falsifier gap" and the ledger was right. **Closed in the review-fix pass** — the `staleReadOnce` hook in `resilient-fetch.test.ts` makes the concurrent read reachable and M19 (`nx: true → nx: false`) was OBSERVED RED again; the same pass also closed HI-01, the tombstone branch that had no exclusion at all, and W-2's `written`-gates-the-emit property.) ⚠️ **Also outside this phase's control:** the 140.1 review recorded `rulesets: []` on this repo — i.e. **possibly no branch protection at all**, which would make `frontend-seam-redis` a gate in the workflow that nothing enforces at merge, along with every other CI gate. **Recorded for the founder; not acted on.** |
| **SC5** | **SATISFIED** | 45 SC-4b cases (15 routes × 3 breaker states), each against the route's **on-disk** `maxDuration`. Falsifiers **M27** (1 RED — the A-09 sentinel), **M29** (1), **M30** (4), **M40** (2), **M41** (24 RED **including the OPEN state**, `expected 360750 to be less than 300000`). |
| **SC6** | **SATISFIED — and two clauses were ADDITIVE work, not tightenings.** | (a) leaf purity — **M21** RED; (b) warmer exclusion — **M23** RED (3 cases); (c) budget-key bindings — **M22** ×3 RED plus **M22b**, which reddens EXACTLY ONE assertion (the roster-completeness mechanism) while all thirteen individual pins stay green. ⚠️ **SC6's health-warmer clause had NO existing guard to extend** — ESLint sets `no-raw-analytics-fetch` to `"off"` on both warmer paths, so this phase BUILT that guard rather than tightening one. The phase is not credited with tightening something that did not exist. |
| **SC7** | **SATISFIED at the CORRECTED scope — 6 reachable / 5 live, not "all nine".** | The corrected wording is in place above (criterion 7), placed by plan 140.2-09 which delivered it, with the reproducible sweep recorded. Delivered scope is the honest one: **five live routes**, not the zero-signature-change shortcut via `runPortfolioOptimizer`/`findReplacementCandidates` that the literal wording would have permitted. Falsifiers **M28** (16 RED), **M44** (48 RED), **M45** (17 RED), **M46** (4 RED), including `two different tenants land in two DIFFERENT per-tenant buckets` and `a claim minted with the WRONG secret degrades to the platform bucket`. |

**Also stated rather than implied:** **SEAMCORE-06's "every Sentry capture" clause is ADDITIVE.** The
seam captured NOTHING to Sentry before this phase — `captureException` / `captureMessage` across the
core, both clients and the three seam routes is zero. Ten `captureToSentry` calls became safe by one
edit at the chokepoint. **No leak was plugged; a mechanism was built.** Falsifiers **M34** (6 RED),
**M33** (3 RED), **M42** (1 RED), **M43** (2 RED).

### Phase 140.3: SEAMUX — Client & wizard seam error surface (INSERTED)

**Goal**: When the seam fails, every surface says something true, offers a way forward that isn't destructive, and tells us it happened
**Depends on**: Phase 140.2 (renders the error TYPES that phase owns), Phase 140.1 (codes originate there)
**Requirements**: SEAMUX-01..09
**Success Criteria** (what must be TRUE):

  1. With the breaker open, every seam-touching surface renders the breaker's own copy — not "our team has been notified", not "we fetched your trades", not "check your credentials", not "validation failed" with zero rows. No surface asserts work happened, or didn't, that the client cannot know.
  2. Drift between any two production copies of a seam error string fails a test; a code emitted by a route is a code the wizard classifier recognises.
  3. Every seam call site fails on an unrecognised or unparseable body rather than treating it as success — in particular, an unrecognised 200 never starts a poll for a job that was never enqueued.
  4. A recoverable seam error always offers a retry; that retry is never the only route to a destructive control (**TRAP-4** — five clicks of our own copy must not destroy a composite draft); `Retry-After` is honoured for the breaker's 503, not only for 429.
  5. A publish or permission gate fed by a drifted analytics response **fails closed** — a key holding trade/withdraw scope can never publish as read-only-verified.
  6. Funnel events carry the specific error code (an outage is distinguishable from a bad file) from every wizard variant, and failures reach Sentry wherever the copy claims they do.
  7. **A failed recompute never leaves the previous result on screen as if it were current.** With suggestions already loaded and the seam then failing, no ranked allocation, weight set or candidate list remains rendered with live action controls — the money-decision hazard B-26 documents, whose fix shape already exists in `WeightOptimizerSection.tsx`.

**Plans**: 17 plans / 16 waves (waves are sequential — `use_worktrees` is false, so they express dependency order, not parallelism). Plans 01 and 02 were re-homed from 140.2 on 2026-07-26; 03–16 planned 2026-07-27. Plan 13 was split into **13a + 13b** at revision round 2 (both wave 13, sequential) — a context measure, never a scope reduction. ⚠️ **This phase's own planning pass must start numbering at `140.3-03`** — slots 01 and 02 are taken. See `140.3-CONTEXT.md`'s handover note for the six ledger rows (M51–M56) and the two hard cross-phase prerequisites that arrived with them.

Plans:

- [x] 140.3-01-PLAN.md — the three Class-5 `typeof body.detail` sites × two contracts; two `WizardErrorCode` union members (TS-05/08/09) — *re-homed from 140.2-12; needs `seam-discriminator.ts` from 140.2-06.* ⚠️ **AMENDED 2026-07-27 at the planning gate:** the membership was a DIFFERENT 3 — `ScenarioCommitDrawer.tsx` dropped (correction C-2: gated on `409/portfolio_fingerprint_stale`; its route imports no seam module), `PortfolioImpactPanel.tsx` added (C-3: a real member, and the file the plan wrongly cited as the safe template). `STATUS_CONTRACT.md` §2.1 corrected in the same task; M51 re-pointed.
- [x] 140.3-02-PLAN.md — `/process-key` consumers branch on `ok`; `X-User-Access-Token` forwarded and scrubbed (TS-01/02/11/12/13/14/15) — *re-homed from 140.2-13; needs `seam-redaction.ts` from 140.2-08 (a SAFETY ordering: the token is a live user JWT)*
- [x] 140.3-03-PLAN.md — the fail-CLOSED publish gate at **both** members of the unchecked-cast class (`finalize-wizard` + `keys/[id]/permissions`, which caches its unvalidated verdict for 60 s) — SEAMUX-07. *Scheduled at the earliest free wave: a security gate, not error rendering.*
- [x] 140.3-04-PLAN.md — `src/lib/seam-copy.ts` leaf + purity guard + cross-copy pin; all 10 production emitters re-pointed; **the 12 test literals deliberately untouched (C-1 / TRAP-9)** — SEAMUX-01
- [x] 140.3-05-PLAN.md — `CIRCUIT_OPEN` becomes a first-class code at `SubmitStep`; `classifyKeyValidationError` reads `body.code` above the cascade; the S-5 parity test (TS-35) — SEAMUX-01/02/08
- [x] 140.3-06-PLAN.md — **THE PHASE'S ONLY PYTHON EDIT.** `400 → 424` at all 7 `VenueTransientHTTPException` sites + fixture + `EXPECTED_STATUS` in one commit (TS-32). Gated by `mypy --strict` + `pytest`.
- [x] 140.3-07-PLAN.md — discard the invalidated result at **both** live B-26 members (`PortfolioOptimizer`, `KeyPermissionBadge`) + `ReplacementPanel` pinned negatively — SEAMUX-09
- [x] 140.3-08-PLAN.md — observe the HTTP outcome at every seam call site (`ApiKeyManager` ×2, `AllocatorMatchQueue`, `WeightOptimizerSection`); kill the `SUPABASE_SERVICE_ROLE_KEY` copy — SEAMUX-05
- [x] 140.3-09-PLAN.md — **PLUMBING first**: a wait field on `WizardErrorContext` and `ErrorEnvelope` (SC4 is unrepresentable today); `Retry-After` honoured for the breaker's 503; TS-34's status half — SEAMUX-06
- [x] 140.3-10-PLAN.md — **the C-8 unit as ONE task**: codes on `keys/sync`'s five arms + the TRAP-3-live transport split + TRAP-4's confirmation. Table-wide TRAP-4 guard — SEAMUX-03/06
- [x] 140.3-11-PLAN.md — TS-19 (both admin routes stop flattening) then TS-18 (render the 424 as a named, recoverable venue state) — SEAMUX-03/04
- [x] 140.3-12-PLAN.md — the copy honesty pass: **7 false-claim strings across 5 codes** (2 more than any source document listed) + TS-09's real copy + TS-17 — SEAMUX-04
- [x] 140.3-13a-PLAN.md — funnel specificity at every wizard variant (`MultiKeyConnectStep` emits nothing today) + **decides the ONE capture policy** + Sentry at 4 of 9 routes (admin/match ×2, `keys/[id]/permissions`, `verify-strategy`) — SEAMUX-08
- [x] 140.3-13b-PLAN.md — the SAME policy applied verbatim at the remaining 5 routes (strategies ×3, `portfolio-optimizer`, `scenario/optimize`) + the **joint 9-of-9 audit** and the mutations — SEAMUX-08. *(13a+13b are a CONTEXT split of one plan, both at wave 13, sequential via `depends_on`; the 9-of-9 obligation is held jointly and neither half may close SEAMUX-08 alone. ⚠️ `csv-validate`'s test lives at `src/__tests__/csv-validate-route.test.ts`, not beside its route.)*
- [x] 140.3-14-PLAN.md — TS-37 (1 of 4 `COMPOSITE_MEMBERSHIP_UNKNOWN` arms gets a permanent code, `KNOWN_FINALIZE_CODES` same commit) + TS-33 (`wizard_session_id`, ONE field) — SEAMUX-03/04
- [x] 140.3-15-PLAN.md — TS-38 (`SEAM_MISCONFIGURED` stops wearing the upstream's envelope) + TS-20 (`correlation_id` reaches the render slot) — SEAMUX-03/04
- [x] 140.3-16-PLAN.md — **phase gate**: negative pins on the four already-strong properties; all 26 ledger rows re-run at the FINAL tree; 7 criteria / 9 requirements / 19 obligations adjudicated. Has a blocking human checkpoint (copy vs DESIGN.md; the destructive path proven in a real flow).

**Gap-closure series** *(added post-VERIFICATION, `gap_closure: true`; these 8 plans were executed and summarised but had no rows here until the 2026-08-01 close-out — the work itself is described in this phase's milestone-list entry above. There is no G3.)*

- [x] 140.3-G1-PLAN.md — poll-disjointness re-tiering + guard registration
- [x] 140.3-G2-PLAN.md — SC2 residual adjudication + the stale-count class
- [x] 140.3-G4-PLAN.md — SEAMUX-03 coded arms on the key-verification route surface
- [x] 140.3-G5-PLAN.md — SEAMUX-03 coded arms on `scenario/optimize` + simulator
- [x] 140.3-G6-PLAN.md — `/api/bridge` (9 arms) + `/api/portfolio-optimizer` (9 `code:` sites), incl. the B-26 money-bearing arm
- [x] 140.3-G7-PLAN.md — `/api/strategies/csv-validate` **wire audit**: found ZERO codeless arms (already coded positionally via `csvErrorBody`) — measurement, not a rewrite
- [x] 140.3-G8-PLAN.md — both admin match routes: `admin/match/eval` 0→6 coded arms, `admin/match/recompute` 0→10 incl. 2 coded deny bodies
- [x] 140.3-G9-PLAN.md — `/api/admin/strategy-review`, the TENTH route the VERIFICATION's nine-route list MISSED (instance-not-class): 0→27 coded arms

### Phase 140.4: SEAMRIM — close the wizard/client rim the core fix left open (INSERTED)

**Goal**: The surfaces stop asserting things we did not measure, stop offering a destructive control as the way forward, and stop attributing our own faults to the user or their venue — and the guards that claim these classes are closed can actually fail.
**Depends on**: Phase 140.3 (renders the error types; this phase closes the rim 140.1-140.3 left open)
**Requirements**: SEAMRIM-01..NN (to be derived at planning from `.planning/reviews/140-SYNTHESIS.md`)

**Why this phase exists**: the end-of-milestone review (14 registers, 5 specialists + 7 red teams + 2 mutation samples, `.planning/reviews/`) adjudicated all 94 original Phase-140 findings at HEAD: **58 CLOSED / 26 PARTIAL / 8 OPEN / 2 SUPERSEDED**. Cluster A (seam core) has **zero OPEN**; cluster B (wizard/client) is 10 CLOSED against **14 PARTIAL + 4 OPEN**. Two independent mutation samples (28 mutations) measured **93% of sampled CLOSED verdicts genuinely guarded** — so the core is real and the rim is where the work is.

⚠️ **The coverage law governs planning** (measured across everything since Phase 140):
| fix mechanism | measured coverage |
|---|---|
| forced through a shared artefact (chokepoint / leaf / table / component) | **100%** |
| hand-typed roster or allow-list | 9/37 codes · 8/15 files · 2/3 codes |
| per-site edit, no artefact | 1/8 · 2/56 · **0/32** |
Any remedy landing in row 2 or 3 is **partial by construction** and must say so.

**Plans:** 14 plans in 4 waves

Plans:

- [x] 140.4-01-PLAN.md — C-3a: `strategyGate` refuses an unrepresentable span (row 1, both consumers) + the admin publish route's 7 unchecked reads — SEAMRIM-01 *(wave 1)*
- [x] 140.4-03-PLAN.md — C-2: the CSV double-submit — a `(user_id, wizard_session_id, source)` partial index, the CSV writer, the SQL receipt with its cross-source control, the 23505 arm, the copy — SEAMRIM-03 *(wave 1)*
- [x] 140.4-04-PLAN.md — the raw-5xx `ast` census (12 sites / 9 triples) against a multiplicity-preserving quarantine; re-runs the mutation that was GREEN — SEAMRIM-09 *(wave 1)*
- [x] 140.4-05-PLAN.md — a visually-inert `<LiveRegion>` primitive + the 3 measured-regressing surfaces (3 of 27, partial by construction) — SEAMRIM-10 *(wave 1)*
- [x] 140.4-02-PLAN.md — C-3b: the wizard's 7 unchecked gate reads + a runtime receipt that read-failed ≠ genuinely-empty — SEAMRIM-02 *(wave 2)*
- [x] 140.4-06-PLAN.md — C-5a: `captureToSentry` returns its promise (copy `audit.ts`), `after()` at the breaker's three sinks, the limiter's timeout sentinel recorded — SEAMRIM-04 *(wave 2)*
- [x] 140.4-07-PLAN.md — scrub tail A: `keys/sync` (6), `csv-finalize` (6), `verify-strategy` (3) = 15 sites — SEAMRIM-06 *(wave 2)*
- [x] 140.4-08-PLAN.md — scrub tail B: the remaining 6 import-edge routes (12 sites) + `ratelimit.ts`'s Upstash-token log — SEAMRIM-06 *(wave 3)*
- [x] 140.4-09-PLAN.md — C-1 (LOW): `csv-validate`'s static 502 + the text-carrying-channel alias rule + the thrown twin — SEAMRIM-06 *(wave 3)*
- [x] 140.4-11-PLAN.md — C-4: the destructive control must be EARNED — invert the roster into a property (verified count is 1, not 9) — SEAMRIM-07 *(wave 3)*
- [x] 140.4-14-PLAN.md — the `no-unchecked-supabase-read` ESLint ratchet, scoped to the proven-clean glob — SEAMRIM-11 *(wave 3)*
- [x] 140.4-10-PLAN.md — derive `SEAM_FILES` from the IMPORT EDGE + `derived == SEAM_ROUTE_BUDGETS` + registry rows and floor — SEAMRIM-06 *(wave 4)*
- [x] 140.4-12-PLAN.md — the wire↔render vocabulary: translation becomes authoritative; the nested envelope is read — SEAMRIM-08 *(wave 4)*
- [x] 140.4-13-PLAN.md — C-5b: adopt `rateLimitDenyJson` at the 12 seam call sites + a derived-population posture guard — SEAMRIM-05 *(wave 4)*

### Phase 140.5: SEAMPROSE — attribution copy, harness fidelity, and prose/citation truth (INSERTED)

**Goal**: What the codebase SAYS about itself is true — in user copy, in comments, in citations, and in the tests that stand in for the contract — so the next phase can trust what it reads.
**Depends on**: Phase 140.4 (SEAMRIM closes the behavioural rim; this closes the descriptive one)
**Requirements**: SEAMPROSE-01..NN (derive at planning from `.planning/reviews/140-SYNTHESIS.md` WP-3, WP-10, WP-12, WP-13, WP-14, WP-15)

**Why this phase exists**: 140.4's planner audited its own source coverage and found six in-scope items it could not fit without recreating the context pressure that forced 140.3's 13a/13b split. **Not a difficulty judgement** — none lacks information or has a dependency conflict. They share almost no files with 140.4's waves, and file-disjointness is what made 140.1–140.3 independently plannable.

**Carried scope:**

1. **The comment/citation-rot class** (CONTEXT §6 of 140.4 named it IN SCOPE; moved here deliberately) — 881 citations, 18 provably past-EOF (15 in two files outside these phases); `keys/[id]/permissions` documents *"5 minutes"* vs `revalidate: 60`; `sentry-capture.ts` claims *"the seam captures nothing to Sentry"* when it is **41 sites across all 15 routes**; the contract registry says *"exactly three predicates"* (five) and *"the six seam files"* (eight, and the guard's own docblock says EIGHT). ⚠️ **7 of 17 comment findings were 140.2 comments falsified by 140.3 commits in the same range** — no phase re-measures what its predecessor wrote down.
2. ⭐ **`Retry-After` travels** — honoured at **1 of 4** surfaces; chokepoint is `process-key-client`, then 5 `buildEnvelope` threads. **HARD PREREQUISITE FOR PHASE 141** — retry-with-backoff consumes `Retry-After`, so 141 must not land on plumbing that reaches one surface in four.
3. `SERVICE_UNREACHABLE` at the three transport catches; the dead `"timed out"`/`"timeout"` branch (**B-02, a confirmed OPEN finding** — the commonest Railway outage still renders `UNKNOWN`); `fetchLivePermissions` carrying `{status, code, retryAfterSeconds}`; `PERMISSION_DENIED` + scope codes in `VENUE_WIRE_CODE_TO_VERDICT`.
4. Harness fidelity: `vi.unstubAllGlobals()` + env snapshot in `src/test-setup.ts`; `ci.yml`'s skip regex; `/\bimport\s*\(/` in the four purity pattern sets.
5. `mintTenantClaim(payload: string, secret: string)` — two adjacent same-typed strings (**latent type hazard, NOT a live attacker path** — orchestrator-resolved); `probe_error: z.boolean()`; `SeamBreakerVerdict` as a discriminated union.
6. Test fidelity: the six wrong 429 shapes, the `500 + retryable:true` body `_validate` refuses to construct, the 424 tested where it cannot arrive.
7. ⭐ **DEF-140.4-C — forwarded upstream 4xx renders as "your CSV is invalid"** (`.planning/phases/140.4-*/deferred-items.md`). Found in a **live browser QA pass** (2026-07-29) uploading a real founder CSV, and independently rediscovered server-side by 140.4's code reviewer as CR-02. The fix round closed the **502** arm and the duplicated title/body (`src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx` — heading render :162-166, cause render :167-168 — rendered `human_message` as heading AND cause when `errors.length === 0`). **Still live: the `!result.ok` arm forwards upstream verbatim, so a 401 — and equally 403/404/409 — lands on `CSV_VALIDATION_FAILED`.** Deliberately not point-fixed in 140.4: this is the instance-not-class shape that phase exists to stop. Close it as ONE rule over every forwarded upstream status. Also open on the same panel: the copy promises a per-row breakdown that does not render when there are no row-level errors.
8. **The plan-to-plan hand-off hole, twice in 140.4** — a defect class this phase should consider guarding, not just fixing. `SEAM_MISCONFIGURED` reached two wizard clients as `UNKNOWN` because plan 12's GREEN landed before plan 13's and neither plan's `## OPEN` named it; `eslint.config.mjs:175-181` still cited a blocker plan 12 had already removed (measured 0 violations). Both are "plan A's premise falsified by plan B in the same phase, with no re-measurement." Note the fixer's own residual: **no guard asserts that every wizard client consuming a `rateLimitDenyJson` route consults the shared wire→wizard table**, so the hole reopens at whichever client lacks the hop.

**Binding inheritance**: 140.4's CONTEXT §2 (coverage law) and §3 (a grep proves a state; only a guard proves it is held) apply unchanged.

⚠️ **Two false premises 140.4 left corrected — do not re-derive them from stale docblocks**: (a) the wire→wizard table and the client rosters are **NOT disjoint** — `KNOWN_KICKOFF_CODES` shares `RATE_LIMITED` — so the safety property is **agreement**, not disjointness; (b) `VALIDATION.md`'s "no guard to falsify" claim for the thrown twin was false (row M109), and the surviving "no row possible" count is **two**, not three.

**Plans:** 8/8 plans complete

Plans:

- [x] **W1** · 01 — harness fidelity flip + `source-scan.ts` + purity needles *(lands ALONE: the leak closure is TRAP-8 sequence-sensitive, and it creates the comment-handling module every later guard imports)*
- [x] **W2** · 02 — `wizardErrors` vocabulary owner + B-02 + venue codes *(publishes the §4a interface plan 05 consumes)*
- [x] **W2** · 03 — `Retry-After` travels + `SERVICE_UNREACHABLE` at all five transport catches ⭐ *HARD PREREQUISITE FOR 141*
- [x] **W2** · 04 — citation/prose corrections, repo-wide
- [x] **W3** · 05 — the CSV class fix ⭐ *DEF-140.4-C and the §6 hand-off hole closed as ONE defect at row 1*
- [x] **W3** · 06 — test fidelity + spec-disabling guard
- [x] **W3** · 07 — type invariants
- [x] **W4** · 08 — seam-surface conversion remainder + the citation guard + ALL guard registrations + phase gate *(guard lands AFTER conversions — "fix before guard"; single owner of `contracts-registry.test.ts`, which kills the same-wave floor-bump conflict that made plans 10 and 13 collide in 140.4)*

### Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit

**Goal**: Transient Railway blips self-heal — but ONLY for calls with a traced idempotency proof, so a retry can never double-execute a side effect
**Depends on**: Phase 140 (retry must respect the breaker and use the unified budgets)
**Requirements**: SEAM-05, SEAM-06
**Success Criteria** (what must be TRUE):

  1. A committed in-repo audit artifact maps every seam function and `/process-key` `flow_type` to retry-safe yes/no with traced server-side side-effect evidence — including the previously-unaudited `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge set — and resolves whether `_get_recompute_lock` is distributed or process-local. Everything unproven defaults to no-retry.
  2. Under an injected single transient failure, an allowlisted call (e.g. `flow_type: resync`) succeeds on retry with exactly ONE server-side effect — proven against the real `compute_jobs` partial-unique-index + `WIZARD_DUPLICATE` contract.
  3. `flow_type: teaser` is provably never retried, and a regression test pins the contract (two identical teaser calls → TWO `strategy_verifications` rows) so a future refactor can't quietly start retrying it and minting duplicate verifications/`public_token`s/leads.
  4. With the breaker open, zero retry attempts fire — no bypass path exists, so retries cannot amplify an outage.

**Plans:** 4/4 plans complete

Plans:

- [x] **W1** · 141-01-PLAN.md — Python resync draft-SV dedup + DB proofs (SQL compute_jobs/SV-index gate, teaser two-rows pytest pin) ⭐ *the LOCKED precondition for allowlisting resync*
- [x] **W1** · 141-02-PLAN.md — retry loop + `retriesOverride` in `resilientFetch` (dormant: all rows stay 0), dual breaker gates, SC-4 mutation observed
- [x] **W2** · 141-03-PLAN.md — `seam-retry-registry.ts` leaf: the SC1 audit = the runtime allowlist (13 evidenced verdicts, absence ⇒ no-retry), SC-1 mutation observed
- [x] **W3** · 141-04-PLAN.md — wire both clients (flow_type-keyed, explicit `?? 0` belt), flip 5 rows + edit pins SAME commit, SC-4b charges backoff+jitterMax, SC-2/SC-3 mutations + phase gate

### Phase 141.1: SEAMBACKOFF — Retry-After-aware backoff, breaker recalibration, and SEAM-05 evidence re-derivation (INSERTED)

**Goal:** The retry honours the upstream's own `Retry-After` contract (built by 140.5, never consumed), the breaker threshold is a decided number under per-attempt counting, and the SEAM-05 audit artifact's evidence is re-derived from traced source so the documented audit and the runtime allowlist cannot drift. Scope from the 8-agent review campaign over 141 — see `141-REVIEW-CONSOLIDATED.md`. **Zero user-facing and zero data-integrity defects were found; no retry verdict changes and no budget row is un-flipped.**
**Requirements**: SEAM-05, SEAM-06 (evidence + guard repair; coverage tracked by decision ID D-01…D-20 from 141.1-CONTEXT.md)
**Depends on:** Phase 141
**Plans:** 9 plans

Plans:

- [x] **W1** · 141.1-01-PLAN.md — D-01 `Retry-After` fail-fast (SC-C/SC-C′) + D-02 threshold ratified (docblock + derived pin)
- [x] **W1** · 141.1-02-PLAN.md — D-03/D-04/D-05 evidence re-derived from traced source + D-06 both citation guards (SC-G/G′/H/H′, roster 34→35)
- [x] **W1** · 141.1-03-PLAN.md — D-14c `status='draft'` behaviour pin in Python tests (SC-P; OQ-2 decided: tests outside the fence)
- [x] **W2** · 141.1-04-PLAN.md — D-08 required `retriesOverride: 0 | 1`, fallback dropped (SC-E) + D-07 false prose corrected post-D-08
- [x] **W2** · 141.1-05-PLAN.md — D-11 frozen `as const satisfies` maps + real exhaustiveness + never-defaulted `budgetKeyFor` (SC-I)
- [x] **W3** · 141.1-06-PLAN.md — D-17 logging both silent arms (SC-M/M′ credential-negative) + G2 decodeBreakerLock bounds + D-12/D-13/D-10/D-14d headline mutations (SC-A/B/D/O)
- [x] **W3** · 141.1-07-PLAN.md — D-09 census retry axis (SC-F) + D-14a/b class-γ 3/3 + pins (SC-J/K) + D-15 per-leg SC-4b recharge (SC-L, 56,000ms)
- [x] **W1** · 141.1-08-PLAN.md — D-16 flag-monitor repair: numerator was structurally DEAD (OQ-1 resolved by probe) — rebuild on indexed fields + distinct-correlation_id denominator + anti-`path:` recurrence guard (SC-N strengthened)
- [x] **W4** · 141.1-09-PLAN.md — D-18 seam-breaker runbook + D-19 TODOS ledger (G1–G4 explicit, H1–H7) + D-20 ship-time 0.51.0.0 bump

### Phase 141.2: SEAMFIX — close the 141.1 code-review findings: duplicate onboard verification write, flag-monitor denominator integrity, breaker re-arm (INSERTED)

**Goal:** Close the 13 verified findings from the xhigh code review of 141.1 (30 agents, 25 findings deduped to 13). Two are the priority. **(A) A duplicate WRITE on the money path:** `onboard`'s retry grant rests on `idempotent_by_session`, but `finalize-wizard` omits `wizard_session_id` when `strategies.wizard_session_id` is NULL — nullable by design — so the Python side mints a fresh `uuid4()` per attempt, the unique constraint cannot collide, and ONE user submit inserts TWO `strategy_verifications` rows on a flow the registry marks retry-safe. **(B) The D-16 flag-monitor denominator rewrite shipped three monitoring-integrity regressions in one change** — an unbounded `.select()` PostgREST silently truncates at `max_rows=1000` (HTTP 200, `error: null`); dedup keyed on the attacker-controllable inbound `X-Correlation-Id` reachable via the UNAUTHENTICATED `/api/verify-strategy`; and a dedup that collapses nothing on the only two retry-eligible flows, because the service re-mints a uuid4 whenever the inbound id is not a bare UUID and `wizardFetch` sends `wizard:<uuid>`. 141.1 repaired an alert that never fired and replaced it with one that can be silenced, saturated, or falsely triggered.
**Requirements**: SEAM-05, SEAM-06 (defect closure — the audit's retry verdicts and the alert that watches them; ⚠️ unlike 141.1, this phase DOES change a retry verdict or add a guard, see findings 1 and 6)
**Depends on:** Phase 141.1
**Plans:** 6 plans

⚠️ **Evidence:** `141.2-FINDINGS.md` in the phase dir holds all 13 with per-finding
failure scenarios (inputs → wrong outcome). Two scoping notes there are SUPERSEDED:
research proved findings 10–11 were INTRODUCED by 141.1 (`f308b460`, single-commit
`git log -S`) — finding 10 is the phase's top priority — and the founder ordered all
13 fixed in code, including 12–13 (`141.2-CONTEXT.md` D-05 + ⚠️ RESEARCH CORRECTIONS).

⚠️ **That sentence records the INSTRUCTION, not the outcome.** As shipped: **twelve
remediated, one dispositioned.** Finding 8 (retry → limiter amplification) was accepted
rather than fixed — no limiter code changed, and the amplification is still live; the
re-raise conditions are on `retriesForFlow` and in `TODOS.md`. Do not restate this phase
as "all 13 fixed in code".

Plans:

- [x] 141.2-01-PLAN.md — breaker cluster: corrupt-lock write path arms (f10, REGRESSION), absolute epoch bound (f11), per-attempt admission (f5)
- [x] 141.2-02-PLAN.md — resync verdict map move to NO (f6) + pin surgery + Python comment-only DEF-141.1-02-A
- [x] 141.2-03-PLAN.md — flag-monitor denominator: counting form, attempt grain, fail-loud read error (f2,f3,f4,f7,f12)
- [x] 141.2-04-PLAN.md — Retry-After parsed, not presence-tested (f9)
- [x] 141.2-05-PLAN.md — onboard retry conditional on idempotency-key presence at the chokepoint (f1)
- [x] 141.2-06-PLAN.md — delete the unfalsifiable pin (f13), runbook rewritten once, D-07 recorded, D-08 changelog corrected

### Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL

**Goal**: A mid-job worker crash can no longer strand a `strategy_analytics` row on `computing` forever — a wizard poll or page refresh sees a real terminal outcome
**Depends on**: Phase 141 (SEAM error taxonomy informs re-enqueue-vs-terminal decisions; JOB sequenced after SEAM)
**Requirements**: JOB-01, JOB-02, JOB-03, JOB-07
**Success Criteria** (what must be TRUE):

  1. A `strategy_analytics` row stuck in `computing` past the derived threshold with NO active `compute_jobs` row is transitioned by a recurring pg_cron reaper to a TERMINAL `failed` state carrying a user-recoverable message — superseding the one-off `reset_stuck_computing_rows.py` script.
  2. A row with a fresh `updated_at` but an old `computing_started_at` IS reaped, and a row with an old `updated_at` but a fresh `computing_started_at` is NOT — proving the reaper keys on the dedicated writer-stamped `computing_started_at` (set in the SAME statement that sets `computation_status='computing'`), never the 106-janitor-revert `updated_at`/`computed_at` mistake.
  3. A CI invariant (mirroring `test_every_kind_has_watchdog_headroom`) fails if any relevant handler's batch-inclusive worst case exceeds the reaper threshold — the threshold is re-derived from `strategy_analytics`'s own batch-tail math, never copied from the `compute_jobs` 4h number.
  4. A large synthetic backlog does not stall worker `healthz` past `STALE_THRESHOLD` — the JOB-07 regression test proving no reaper/sweep work runs on the worker's shared asyncio event loop (the WEDGE-01 crash class this janitor exists to clean up after).

**Plans**: 6 plans

Plans:
**Wave 1**

- [x] 142-01-PLAN.md — JOB-03 Python side: JOB_CHAIN_FOLLOW_ON topology (enqueue sites read it) + canonical reap-threshold constant + TestReaperThresholdInvariant (wave 1)
- [x] 142-02-PLAN.md — JOB-07 structural gate + healthz blocking-vs-yielding control pair; delete broken reset_stuck_computing_rows.py + stays-absent gate (wave 1)
- [x] 142-06-PLAN.md — JOB-01 row type: StrategyAnalytics.computing_started_at (string | null, never optional) + EMPTY_ANALYTICS + 7 fixture files — the checker-measured 8-file compile blast radius (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 142-03-PLAN.md — JOB-01 app writers: stamp W1 + clear 11 Python & 4 TS exit sites, D.10 census, two-runtime stamp CI gate (wave 2)
- [x] 142-04-PLAN.md — migration 20260802120000: DDL + backfill + index + re-based bridge (conditional stamp) + inline pg_cron reaper; SQL↔Python drift gate (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 142-05-PLAN.md — SQL gate (ungated structural + behavioral arms), [BLOCKING] MCP apply to TEST, ledger mutations SC-1/1b/2/2b, phase gate (wave 3)

**Note**: JOB-07 is a cross-cutting constraint — Phases 143/144/145 must also keep their mechanisms off the worker loop (pg_cron by construction), but the REQ-ID and its regression test land here only.

### Phase 142.1: Close 142 review findings: chain-start stamp preservation, deploy sequencing, terminal-writer parity (INSERTED)

**Goal:** Close the 16 items raised by three independent passes over Phase 142 (high-effort workflow review, blind `gsd-code-reviewer`, and the `gsd-verifier` goal-backward pass that had never run) — so that the reap clock genuinely measures the whole job chain, no terminal writer can launder a failure into a green factsheet, the `sql-function-snapshot` CI gate is green again, and Phase 142's own falsifiability evidence is complete rather than 4/11.
**Requirements**: JOB-01, JOB-02, JOB-03 (remediation of Phase 142 delivery; no new REQ IDs)
**Depends on:** Phase 142
**Plans:** 8/8 plans complete

**Scope + per-item failure scenarios:** `.planning/STATE.md` § "Phase 142.1 scope".
**Evidence:** `142-VERIFICATION.md` (status `gaps_found`, 9/10), `142-REVIEW.md` (0 blockers, 4 warnings).

⚠️ **Phase 142's goal IS achieved** — all four of its ROADMAP success criteria hold behaviourally, proven by executing the real cron body against a throwaway PostgreSQL 16. 142.1 is remediation, not a rescue.
⚠️ **Item 12 is a hard-red CI gate** (`npx tsx scripts/dump-sql-functions.ts --check` exits 1) and is a one-command fix — do it first.
⚠️ **Items 1, 2 and 16 are orchestrator-only** — they need TEST-DB access, and MCP tools are stripped from subagents.

Plans:
**Wave 1**

- [x] 142.1-01-PLAN.md — D-12 run 1 (FIRST commit, clears the hard-red snapshot gate) + D-13 JOB-03 text + D-14 ledger backfill + DEF-142.1-08 deferral

**Wave 2**

- [x] 142.1-02-PLAN.md — test hygiene: D-10 shared _scan_helpers (union surface), D-06 wall-clock deletion, D-09 backlog=0, D-15 arity hoist + new pytest
- [x] 142.1-03-PLAN.md — CI hardening: D-05 neutralizers DELETED — isolation by construction (D-18) + shared-test-db group + one-rule grep gate; D-02/R1 fail-loud migrate + YAML pins

**Wave 3**

- [x] 142.1-04-PLAN.md — stamp-gate rework: D-07 soften raise arms, D-04 widen TS census, D-03 terminal-warned parity + csv-finalize one-line fix
- [x] 142.1-05-PLAN.md — migration 20260803120000: D-17 BEFORE UPDATE trigger (D-18) + D-11 companion arm (arm D inverted + Part 4 retrofit + drift gate/comments re-pointed SAME commit) + D-12 run 2

**Wave 4**

- [x] 142.1-06-PLAN.md — D-01 comment correction + D-02/R2 PGRST204 fallback in _mark_unrecoverable (after D-07, per C-12)
- [x] 142.1-08-PLAN.md — SQL gate Part 6 (G1 trigger sentinel, seeds at INSERT per D-18; grep-gate pin 0→3)

**Wave 5**

- [x] 142.1-07-PLAN.md — [BLOCKING, orchestrator-only, autonomous:false] MCP apply to TEST + D-01/D-02 TEST confirmations + D-16 end-to-end gate run + ledger consolidation

### Phase 142.2: Get MetaTrader 5 running end to end on the unified backbone (INSERTED)

**Goal:** A founder can connect a real MetaTrader 5 account through the wizard and reach a rendered strategy — key → dailies → backbone → UI — with no step requiring a human to know an internal error code, a server name, or a flag, and with admissibility decided by the canonical daily series rather than a hand-maintained venue list.
**Requirements**: MT5-01..05, MT5-11, MT5-12 (set at /gsd-discuss-phase 2026-08-03; see `142.2-CONTEXT.md` for the sixteen decisions behind them). ⚠️ MT5-11/MT5-12 were added AFTER the discussion, from live dogfood: the gate is not on the unified backbone. MT5-01/02 are already complete.
**Depends on:** Phase 142
**Plans:** 8/8 plans complete — ✅ **SHIPPED TO PRODUCTION as `v0.53.0.0` (PR #660, squash `8b327594`, 2026-08-04).** ⚠️ **STILL NOT CLOSED.**

Migration `20260803150000` applied to PROD via the auto-apply path; verified there read-only as
**text / nullable / no default, 0 CHECK constraints, 0 of 40 rows stamped** (no backfill, as designed).
Vercel Production is on `8b327594`; `quantalyze.xyz` returns 200 with `/api/health` `ok`.

⛔ **MT5-05 is an OUTSTANDING blocking human gate — and the deploy that blocked it has now happened,
so it is RUNNABLE.** `142.2-HUMAN-UAT.md` carries `status: pending` / `gate: blocking-human`: a founder
must complete the MT5 connect flow on **production**, without needing to know an internal error code,
a server name, or a flag. It is deliberately **not** approved — it has not been run.
⛔ **And even once MT5-05 passes, this phase means MT5 is REACHABLE, not CORRECT.** The numbers are
Phase 142.3's gate (D-17). Do not archive the milestone or advertise MT5 on the strength of 142.2 —
that is precisely how v1.15 shipped 6/6 phases green with both open items intact.

⚠️ **SPLIT 2026-08-03 at the D-14 valve, on the researcher's sizing finding (`142.2-RESEARCH.md`).** The original scope (MT5-01..12) was two phases, and the second was unbounded *by construction*: MT5-10 is uncapped by founder decision, and MT5-06/07/08 are human- and calendar-gated on a live trading-day session at the terminal. **MT5-06..10 moved to Phase 142.3.** This is the founder's pre-authorised valve (D-14) — a follow-up phase, **not** a scope cut. The dependency graph across the cut is one-directional: 142.2 makes MT5 *reachable and honest*, 142.3 proves it *correct*.

**Known inputs (do NOT re-derive at plan time):**

- v1.15 shipped MT5 and is ARCHIVED at tag `v1.15`. Live config: worker `MT5_ENABLED=true` + `MT5_GATEWAY_HOST=mt5-gateway.railway.internal:8001`, Vercel `NEXT_PUBLIC_MT5_ENABLED=true`. N accounts serialize through ONE gateway lock.
- ⚠️ v1.15 closed with two OPEN items, both live: **server-UTC offset**, and **confirm on a TRADING day** (a weekend run proves nothing).
- Founder-observed dogfood defects are already recorded in `TODOS.md` § "MT5 wizard — founder-observed on live UI": the Broker-server field is password-masked and should be plain text + searchable typeahead, and the connect-failure copy renders a generic `KEY_INVALID_FORMAT` that names Binance/OKX/Bybit at an MT5 user.
- "Unified backbone" here means the ONE pipeline (`key → dailies → backbone → UI`), not a second MT5-specific path. Dailies are canonical; derive metrics/charts/coverage from them.

⚠️ **A green unit suite is not evidence that MT5 is correct** — v1.15 shipped with 6/6 phases green and both open items survived it. That evidence is Phase 142.3's job. What 142.2 *can* prove offline is its own safety property: **a fills-gapped perp fixture must still be REFUSED.** MT5 passing is not the test; that perp still failing is.

Plans:

- [x] 142.2-01-PLAN.md — series_completeness migration (additive nullable, self-verifying) + the CI-counting SQL gate
- [x] 142.2-02-PLAN.md — MT5-03: per-venue passphraseSecret flag; MT5 broker-server plain text, OKX byte-identical (SC-7)
- [x] 142.2-03-PLAN.md — Python producers: SeriesCompleteness registry + all EIGHT combiner return paths accounted for (5 stamped; 3 empty-series early returns exempted **in writing**, justified by the `analytics-service/services/job_worker.py:4365` (`int(returns.notna().sum()) < 2`) non-NaN short-circuit) + the D-15 economic oracle (SC-1 py)
- [x] 142.2-04-PLAN.md — [BLOCKING, orchestrator-only, autonomous:false] MCP apply to TEST + A1/A2 executed evidence + read-only PROD censuses (A6, Pitfall-6)
- [x] 142.2-05-PLAN.md — worker enforcement: fail-loud assert BEFORE the reconcile-delete + composite_stitched stitch stamp + keyless user_supplied in the runner (SC-5, SC-6; covers all THREE csv_daily_returns producers)
- [x] 142.2-06-PLAN.md — TS gate consolidation: isLedgerBackedExchange DELETED, verdict allow-list, one exported predicate at all three former sites, composites stay approvable (SC-1 ts, SC-2, SC-3, SC-4)
- [x] 142.2-07-PLAN.md — MT5-04: KEY_INVALID_FORMAT split across the 24 emitting sites (12+12), copy honesty fix, registry-drift invariant (SC-8, SC-9, SC-10)
- [x] 142.2-08-PLAN.md — [autonomous:false] TODOS deferrals + falsifiability ledger backfill + MT5-01/02 delivered-record + MT5-05 founder checkpoint (reachable, NOT correct — 142.3 gates correctness)

### Phase 142.3: Prove the MT5 numbers correct against the live terminal on a trading day (INSERTED)

**Goal:** The performance Quantalyze renders for a live funded MT5 account matches the MT5 terminal's own equity and balance figures on a trading day, on every surface that renders it, with the broker-server-to-UTC offset measured rather than assumed — and any discrepancy found is fixed, wherever its root cause lives.
**Requirements**: MT5-06..10 (split out of Phase 142.2 on 2026-08-03 at the D-14 valve; the decisions behind them are D-07..D-11 in `142.2-CONTEXT.md`).
**Depends on:** Phase 142.2 (MT5 must be reachable through the gate before its numbers can be checked)
**Plans:** 0 plans

**Known inputs (do NOT re-derive at plan time):**

- ⚠️ This phase is **human- and calendar-gated**. It cannot be completed by an agent alone or on a weekend: it needs a founder at the MT5 terminal, on a trading day, with the live funded account's read-only investor password.
- ⚠️ **MT5-10 is uncapped by explicit founder decision** (D-10). A bounded alternative — split shared-cause fixes into their own phase — was offered and **declined**. Shared-backbone money-math root causes are IN scope. Size for the unbounded case; do not treat it as an escape hatch.
- `MT5_SERVER_UTC_OFFSET_S=10800` is **already live** on the worker. The open problem is **DST and multi-broker**, not the base offset. The last-deal offset estimator was already built and already failed (the −810 stale-deal artifact), and `analytics-service/tests/test_mt5_client_contract.py` — `test_read_only_surface_no_trade_methods` :735, its `forbidden` parametrize :720-734 — explicitly forbids `symbol_info_tick` on `Mt5Client` — read `142.2-RESEARCH.md` before proposing a measurement mechanism.
- ⛔ **No tolerance number exists anywhere for MT5-07.** "Matching within a stated tolerance" with no stated number is unverifiable. This needs a founder call before MT5-07 can have an acceptance criterion — surface it at /gsd-discuss-phase 142.3, do not invent one.
- The residual risk MT5-09 exists to test is the **backbone-bypass surfaces** logged in `TODOS.md`: `_compute_portfolio_analytics` (`analytics-service/routers/portfolio.py:628`), `equity_reconstruction.py`, and the bespoke TS stacks — they re-derive metrics rather than reading them. One daily series checked five ways; a divergence is a finding.

⛔ **This phase is the gate on any "MT5 is done" claim.** 142.2 closing does not mean MT5 is verified — it means MT5 is reachable. The v1.15 failure mode was exactly this: ship green, open items survive. Do not archive the milestone or advertise MT5 until 142.3 passes.

Plans:

- [ ] TBD (run /gsd-plan-phase 142.3 to break down)

## v1.16 Progress (PARKED)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 140. SEAM core + breaker | 7/7 | Complete   | 2026-07-25 |
| 140.1. PYAPI contract/status/limiter (INSERTED) | 9/9 | Complete | 2026-07-26 |
| 140.1.1. PYAPI-FIX (INSERTED) | 7/7 | Complete    | 2026-07-26 |
| 141. SEAM retry (audit-gated) | 4/4 | Complete    | 2026-07-31 |
| 142. JOB reaper + DDL | 6/6 | Complete   | 2026-08-02 |
| 143. JOB dropped-enqueue sweep | 0/? | ➡️ **CARRIED to v1.19** | - |
| 144. JOB WR-02 terminal UPDATE | 0/? | ➡️ **CARRIED to v1.19** | - |
| 145. JOB csv-finalize atomicity | 0/? | ➡️ **CARRIED to v1.19** | - |
| 146. RATE audit + close | 0/? | ➡️ **CARRIED to v1.19** | - |

## Requirement Coverage (v1.16)

| Phase | Requirements |
|-------|--------------|
| 140 | SEAM-01, SEAM-02, SEAM-03, SEAM-04 |
| 141 | SEAM-05, SEAM-06 |
| 142 | JOB-01, JOB-02, JOB-03, JOB-07 |
| 143 | JOB-04 |
| 144 | JOB-05 |
| 145 | JOB-06 |
| 146 | RATE-01, RATE-02, RATE-03, RATE-04, RATE-05 |

18/18 v1 requirements mapped, each to exactly one phase. No orphans.

---

## Shipped Milestones

> Collapsed index — one line per shipped milestone. Full per-milestone detail
> lives in `.planning/MILESTONES.md` and the `.planning/milestones/` archives.
> (Rebuilt 2026-07-25 from MILESTONES.md after a truncation accident; the prior
> inline v1.12/v1.13 detail sections were duplicative of their archives.)

- ✅ **v0.14.0.0 — Sprint 8: Bridge V2**
- ✅ **v0.15.0.0 — Sprint 9: Demo-to-Production**
- ✅ **v0.16.0.0 — Phase 11: Onboarding & Security Readiness**
- ✅ **v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2**
- ✅ **v1.0.0 — API-Key Rewrite** (Diagnose → Fix → Unify → Ship to LPs)
- ✅ **v1.1.0 — Scenario Analysis** (Surface → Honesty → Persist → Read → Quant)
- ✅ **v1.2 — Allocator Cohesion** (tag `v1.2` @ `11775460`)
- ✅ **v1.2.1 — scenario-tab-hardening** (tag `v1.2.1` @ `e5e4f3d2`)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** (tag `v1.2.2` @ `43e57dd0`)
- ✅ **v1.3 — Mobile & Adaptive UI** (2026-06-28)
- ✅ **v1.4 — Frontend Excellence** (tag `v1.4` @ `4c4ca537`)
- ✅ **v1.5 — Scenario Coverage-Window Blend** (tag `v1.5` @ `f8b502e7`)
- ✅ **v1.6 — Scenario Series-Space Purification** (tag `v1.6` @ `f78f036b`)
- ✅ **v1.7 — Deribit Exchange Coverage & Carry-Forward Burn-Down** (tag `v1.7` @ `9a1e7b8e`)
- ✅ **v1.8 — Flow-Aware Time-Weighted Returns + Native-Unit NAV** (tag `v1.8` @ `eb8e357e`)
- ✅ **v1.9 — Multi-Key Composite Strategy** (tag `v1.9` @ `044bee50`). Archive: `milestones/v1.9-ROADMAP.md`.
- ✅ **v1.9.1 — Composite Onboarding Hardening** (tag `v1.9.1` @ `be215b15`). Archive: `milestones/v1.9.1-ROADMAP.md`.
- ✅ **v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification** (2026-07-15). Archive: `milestones/v1.10-ROADMAP.md`.
- ✅ **v1.11 — Scenario Composer v2** (tag `v1.11` @ `a42f4bcf`, Phases 109–117). Every source is a daily-series constituent under a coherent manager/allocator role model. Archive: `milestones/v1.11-ROADMAP.md`.
- ✅ **v1.12 — sFOX Verified Integration (Foundation, flag-OFF)** (tag `v1.12` @ `92be47af`, Phases 118–123). Live sFOX `api_verified` foundation shipped dormant; go-live re-homed to v1.13. Archive: `milestones/v1.12-ROADMAP.md`.
- ✅ **v1.13 — Infra: sFOX go-live foundation + worker rebuild** (tag `v1.13`, Phases 125–130, shipped FLAG-OFF 2026-07-19, closed 2026-07-22). Railway static-egress + worker rebuild + trust-tier SECDEF. Archive: `milestones/v1.13-ROADMAP.md`.
- ✅ **v1.14 — Smoothed options MTM (third factsheet basis)** (tag `v1.14` @ `0adde939`, v0.48.0.x, Phases 131–133, shipped + flipped LIVE 2026-07-23; PRs #633 + #635). Additive third `pnl_basis` `smoothed_mtm` (daily ΔMTM redistribution, total-preserving; cash/MTM byte-identical). Archive: `milestones/v1.14-ROADMAP.md`. Review: `v1.14-BIG-REVIEW.md` (SHIP).
- ✅ **v1.15 — MetaTrader 5: live api_verified account sync** (tag `v1.15`, v0.49.0.0→v0.49.4.0, Phases 134–139, shipped DARK 2026-07-24 + flipped LIVE 2026-07-25; PRs #636 + #637/#640/#641/#642). Self-hosted Wine gateway + `mt5linux` net client → deal-ledger equity reconstruction → the ONE backbone with `api_verified`; √252 traditional; 3-field creds. Prod gateway private+live, Vantage acct 26547876 soaked green, flags flipped LIVE. Archive: `milestones/v1.15-ROADMAP.md` + `v1.15-REQUIREMENTS.md`. Audit: `v1.15-MILESTONE-AUDIT.md`.

## Current position

⭐ **CURRENT: v1.20 Backlog Burndown (Phases 158–165)** — roadmap created 2026-08-20. Eight
phases over the 50 verified-open requirements (RANK / SHARE / WIZERR / HONEST / OPS / SEC /
DEPS). Next: `/gsd-plan-phase 158`. ⛔ **Ordering is load-bearing:** 158 (OPS — CI/deploy
integrity) FIRST — the shared-test-db eviction silently skips Railway deploys (#616) and every
later phase merges through that pipeline; 165 (DEPS) LAST, hard-blocked on OPS-01; 160
(provenance) before 164 (SHARE) so the REVOKE gets deploy-then-soak time; 164 lands ALONE in
its own PR, ⛔ never branched from `feat/phase-156-connect-refactor`.

⏸️ **v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157)** — PARKED 2026-08-20,
founder-gated twice over: new MT5 investor passwords AND the founder at the terminal on a
trading day. Phase numbers 155/157 stay reserved; v1.20 continues from 158. See the parked
milestone header above.

✅ **v1.17 MT5 — ingested, wizardable, surfaced** — CLOSED 2026-08-14, 10 phases delivered
(147–154, 156), shipped through v0.62.0.0. ⚠️ Its original title said *"usable end-to-end, not
merely ingested"*; Phase 155 was carried to v1.18 and the title was amended to match what was
actually delivered. ⛔ **MT5 is NOT advertised** — nobody has compared our numbers to the
terminal's.

✅ **v1.19 JOB/RATE** — CLOSED 2026-08-20 (tag `v1.19`, audit `tech_debt`, 9/9 requirements,
PRs #687–#695, v0.68.1.0). The "resume v1.16 at Phase 143" pointer that lived here is
DISCHARGED: Phases 143–146 became v1.19 and shipped; v1.16 proper closed 2026-08-14 at Phases
140–142.

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
