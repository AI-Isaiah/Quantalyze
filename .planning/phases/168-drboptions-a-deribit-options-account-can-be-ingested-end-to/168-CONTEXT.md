# Phase 168: DRBOPTIONS — a Deribit options account ingests end to end - Context

**Gathered:** 2026-09-26
**Status:** Ready for planning
**Decided at sha:** 096671f2d
**Mode:** Autonomous (orchestrator, no founder present). There was no discuss step. Every decision
below is derived from the `### Phase 168` ROADMAP entry, the root `TODOS.md` entry
`[DERIBIT-ASSIGNMENT-UNCLASSIFIED]`, and the code at the sha above. No founder prompt was issued.

<domain>
## Phase Boundary

Deribit's transaction-log type `assignment` is in neither `CASH_BEARING_TYPES` nor
`INFORMATIONAL_TYPES` (`analytics-service/services/deribit_txn.py`). Every options account whose
ledger carries a nonzero-`change` `assignment` row therefore fails ingestion with the unknown-type
refusal, at both refusal sites (`txn_rows_to_daily_records`, the USD twin, and
`txn_rows_to_native_daily`, the native twin). The wizard's Retry cannot clear it, because the
ledger still holds the row.

This phase classifies `assignment` against the captured census, not against its magnitude, and
makes every consumer of the Deribit type sets treat it consistently. It then observes one real
Deribit options account ingesting end to end.

**The captured census (the deciding measurement).** The ROADMAP `### Phase 168` Requirements
paragraph records it: on 2026-09-23 a three-account Deribit composite failed its first
`run_stitch_composite_job` on this refusal, read-only from the production analytics log. The
refusal printed its own evidence (the channel PR #783 built, `describe_unclassified_row`):
- one `assignment` row, currency BTC, nonzero `change`, on a BTC put that had already expired,
  side `close buy`;
- same-instrument census in that batch: **`delivery=0 settlement=0 trade=1`**.

For that occurrence, Deribit emitted no separate `delivery` or `settlement` row for the assigned
instrument. So there is no second cash row the `assignment` change could be double-counted
against. It is one occurrence on one instrument (n=1). D-01 and D-02 say how n=1 is used.

**Out of scope (fences, not deferrals):**
- The native_nav inception reconciliation breach on the older Deribit composite is a separate
  defect with its own owner. Settling this phase does NOT unblock Phase 161.1's go-live step. Do
  not widen scope to it, and do not describe this phase as a prerequisite for it.
- The factsheet and share-link "still computing" copy on a terminally failed strategy belongs to
  Phase 167.2.
- The silent pass of a zero-`change` unknown type is recorded under Deferred Ideas. It is not
  fixed here.
</domain>

<decisions>
## Implementation Decisions

- **D-01: `assignment` is classified CASH-BEARING (summed as realized cash) on both twins, and
  only in the shape the census measured.** The evidence is the 2026-09-23 census
  (`delivery=0 settlement=0 trade=1`). When no `delivery` or `settlement` row exists for the
  assigned instrument, the `assignment` row is the only cash event of the expiry. Skipping it would
  silently drop realized cash, and the native balance roll would not close. **Whether n=1 is
  enough: it is enough for THIS shape and no other.** One observation can show what Deribit
  emitted when it emitted no sibling. It cannot show that Deribit never emits both. D-02 therefore
  keeps the unobserved shape refused instead of assuming it. The row's magnitude is never cited
  as justification, in code comments, tests or docs.
  — **Reversibility:** reversible. It is a Python type-set edit with no persisted schema, and
  recompute re-derives the series.

- **D-02: The unobserved shape stays loud (fail-closed co-occurrence guard).** If an `assignment`
  row shares its `instrument_name` with a `delivery` or `settlement` row in the batch being
  classified, ingestion refuses with a `LedgerValuationError`. The message names the
  double-count hypothesis and carries the `describe_unclassified_row` evidence. It must neither
  sum nor skip. **The guard must be sound against the batch's actual scope.** The researcher
  establishes what "this batch" is at each call site: the USD twin runs per currency/scope inside
  `_crawl_deribit_ledger`, and the native twin runs over the full `raw_rows` crawl. If a site's
  batch can be a window that does not cover the instrument's expiry, the guard on that site must
  also refuse, or the classification must be decided on the full-history rows. It must never
  pass silently.
  — **Reversibility:** reversible.

- **D-03: The census is committed as a dated evidence file, counts only.** Add
  `analytics-service/docs/evidence/drb-assignment-census-2026-09.json`, following the repo's
  `docs/evidence/*.json` convention. It holds the type, the currency, the option kind (put), the
  side, and the sibling counts. It holds no job id, correlation id, account, instrument
  strike/expiry string, strategy name or `change` value. The tests and the classification comment
  cite this file, not a ROADMAP paragraph.
  — **Reversibility:** reversible.

- **D-04: Every consumer of the Deribit type vocabulary treats `assignment` consistently.**
  Adding to `CASH_BEARING_TYPES` flows automatically into `_NATIVE_CASH_BEARING_TYPES` and into
  `services/deribit_ingest.py`. The researcher must also enumerate every place that lists option
  event types by name, and the plan must decide each one explicitly. That includes the
  smoothed-MTM option-book replay, which reconstructs positions from `trade`/`delivery` rows (an
  `assignment` with side `close buy` closes a short position); the option-activity gate; and
  `_NATIVE_OPTIONS_SUMMARY_TYPES`. Each disjointness assert at import (the USD pair, the native
  pair, and the options-summary asserts) must still hold. The type-table comment above
  `CASH_BEARING_TYPES` is updated to list `assignment` with its evidence citation. Cite by symbol.
  — **Reversibility:** reversible.

- **D-05: Tests encode why, and each is proven able to fail.**
  `tests/test_deribit_unclassified_evidence.py` currently asserts that `assignment` is NOT
  classified. It is re-pointed, not deleted: the refusal-evidence tests keep a still-unknown
  type, and new tests pin D-01 (the census shape is summed on both twins) and D-02 (the co-occurring
  shape refuses). The fixture reproduces the census shape from D-03 with synthetic identifiers.
  Every new data-integrity assertion goes through neuter → observe RED → restore.
  — **Reversibility:** reversible.

- **D-06: No migration, no live broker read by any agent, and the end-to-end observation is
  founder-owned.** This is a pure Python change under `analytics-service/`. If a plan finds it
  needs SQL, the migration timestamp must sort after everything on origin/main and after
  `20260925120000`, and migration-reviewer, rls-policy-auditor and silent-failure-hunter must run
  before merge (merging auto-applies to PROD). No agent reads Deribit, reads, logs or echoes a
  Deribit credential, or writes to PROD. The close condition ("a deribit options account is
  observed to ingest end to end") is a **founder-owned post-deploy checkpoint**. After the fix is
  deployed, the founder retries the Deribit options strategy that failed on 2026-09-23. They
  report counts and statuses only: job terminal status, return-point count, and whether any
  `assignment` refusal recurred. A live census read is NOT planned. D-01/D-02 make n=1 safe
  without one, so it is not needed.
  — **Reversibility:** reversible.

### Amendments after research (2026-09-26, orchestrator, autonomous)

These amendments supersede the clauses they name. Evidence: `168-RESEARCH.md` Q1–Q3 and
`## Conflicts with CONTEXT`.

- **D-02 amended: the batch is full history, and the guard gets a structural backstop.** Every
  production caller of `build_deribit_native_ledger` passes `since_ms=None`. That includes the
  stitch-composite reconstruct path, which is the one that raised on 2026-09-23. The crawl
  therefore reaches inception, and each (scope, currency) batch holds the instrument's whole
  history. That makes the census sound. The co-occurrence check is one shared pure helper, called
  in both twins. It fails closed when `instrument_name` is absent. It is backed by a refusal in
  `_crawl_deribit_ledger` when `since_ms is not None` and an `assignment` row is present,
  modelled on the existing smoothed-MTM full-history refusal. The backstop is inert on every
  production path. The D-02 message carries a discriminator phrase that the unknown-type message
  does NOT contain. The phrase "double-count" does not qualify, because the unknown-type message
  already contains it. The re-pointed evidence tests assert that the discriminator is absent,
  which closes the pass-for-the-wrong-reason trap.

- **D-07: Six sites name option events literally instead of reading the type sets. They move to
  one shared constant.** The sites are `_pre_coverage_option_days`,
  `_option_activity_after_coverage`, `_assert_smoothed_summary_cross_check`,
  `replay_option_positions`, the option arm of `txn_rows_to_native_daily`, and that arm's
  delivery-names-spot guard. Each is a literal `("trade", "delivery")` tuple. They move to a
  single constant (research name: `_OPTION_BOOK_EVENT_TYPES` = trade, delivery, assignment),
  with an import-time assert that it is a subset of `CASH_BEARING_TYPES`. Without this,
  `mark_to_market` double-counts `assignment` against the options settlement summary, and the
  smoothed-MTM replay never zeroes the assigned short. So "summed as realized cash" in D-01 is
  basis-dependent in exactly the way `delivery` already is: inside summary coverage an
  `assignment` contributes `-commission`, just as `delivery` does. An `assignment` row missing a
  field the existing guards need (`commission`, `position`) must fail loud through those guards,
  never default to zero.
  — **Reversibility:** reversible.

- **D-08: The founder's post-deploy report covers ANY terminal error, not only a recurring
  `assignment` refusal.** It reports the job's terminal status, the return-point count, and the
  class of any refusal or error that appears, named by type only. That class could be `exercise`,
  `expiry`, or a missing-field guard. This is an observation of ingestion. It is NOT a live
  census read, and no census read is planned.
  — **Reversibility:** reversible.

- **[informational] `exercise` and `expiry` stay refused (not classified here).** Deribit's
  current `private/get_transaction_log` documentation lists `expiry`, `assignment` and
  `exercise`. `exercise` is the long-side counterpart of `assignment`. No captured census exists
  for either, so classifying them here would be the guess this phase exists to refuse. Both keep
  the loud unknown-type refusal. If the founder's D-08 report shows one of them, that is a new
  topic for its own phase via `/gsd-phase --insert`, per the phase-size rule below. The refusal's
  shape whitelist (`_SHAPE_FIELDS`) may add `commission` and `position`, so that the next refusal
  answers the open field question. That is Claude's discretion and stays inside this topic.
- **[informational] The ROADMAP/TODOS sentence "Deribit does not enumerate the `type` enum" is
  stale as of the research date.** The TODOS entry is closed or updated at ship time, not in
  these plans.

**Phase-size rule (founder, 2026-09-26), relayed by the orchestrator.** A phase is one logical
topic that fits one reviewable PR. ⛔ CORRECTED the same day by the founder: there is NO plan
cap, and the earlier "about 5 plans at most" is withdrawn. A cap only makes each plan bigger.
Plans are sized naturally to the smart-zone budget and are never merged to hit a count. This
phase's topic is the
`assignment` census and its classification. A founder-owned live census read and any follow-on
for the NAV reconciliation breach stay OUT of this phase. A second topic gets its own phase via
`/gsd-phase --insert`. If more than 3 plan-check rounds are needed, stop and propose a split.

### Claude's Discretion
- Exact wording of the D-02 refusal message and the evidence-file field names.
- Whether the co-occurrence guard is a helper shared by both twins or inlined at each site.
  Prefer one helper, matching how `describe_unclassified_row` is shared.
- Test file layout: extend the existing Deribit test files, or add one new file.
- The CHANGELOG entry and VERSION bump happen at ship time (`/gsd-ship`), not in these plans.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` `### Phase 168` — goal, deciding question, forbidden remedies, the
  2026-09-23 census.
- `TODOS.md` `[DERIBIT-ASSIGNMENT-UNCLASSIFIED]` — dated measurements and close condition.
- `analytics-service/services/deribit_txn.py` — `CASH_BEARING_TYPES`, `INFORMATIONAL_TYPES`,
  `_NATIVE_CASH_BEARING_TYPES`, `_NATIVE_INFORMATIONAL_TYPES`, `_NATIVE_OPTIONS_SUMMARY_TYPES`,
  `describe_unclassified_row`, `_SIBLING_TYPES`, `txn_rows_to_daily_records`,
  `txn_rows_to_native_daily`.
- `analytics-service/services/deribit_ingest.py` — `_crawl_deribit_ledger`, the native adapter
  that calls `txn_rows_to_native_daily`, and the smoothed-MTM replay.
- `analytics-service/tests/test_deribit_unclassified_evidence.py` — the evidence-channel tests
  from PR #783.
- `analytics-service/docs/evidence/drb-options-semantics-2026-07.json` — prior options evidence,
  which covers `assignment` zero times.
</canonical_refs>

<code_context>
## Existing Code Insights

- The refusal is raised at two sites, both of which append `describe_unclassified_row(row, rows)`.
- `_NATIVE_CASH_BEARING_TYPES = CASH_BEARING_TYPES | _NATIVE_INTERNAL_REBALANCE_TYPES`, so one
  edit reaches both twins.
- The native path reconciles Σ`change` over cash-bearing rows against balance (inception gate). A
  cash-bearing `assignment` is therefore consistent with that identity.
- pytest runs ONLY from `analytics-service/` with its `.venv`, under
  `env -u TEST_SUPABASE_DB_URL -u SUPABASE_TEST_DB_URL -u SUPABASE_TEST_URL -u SUPABASE_TEST_SERVICE_KEY`.
  Running from the repo root causes cassette misses and LIVE broker calls.
</code_context>

<deferred>
## Deferred Ideas

- A zero-`change` unknown Deribit type passes the classifier silently (only nonzero is loud).
  Noted in the TODOS entry. Not fixed here, per the scope fence.
</deferred>
