# Phase 183: DUPCOUNT — a book whose marked duplicate key is already counted once draws its equity curve - Context

**Gathered:** 2026-11-01
**Status:** Ready for planning
**Source:** the founder's booking decision of 2026-10-31 (no discuss-phase was run; nothing below is a founder decision unless it says so)

<domain>
## Phase Boundary

A book whose marked duplicate key is already counted once by the derive's account-group resolution draws its equity curve instead of refusing it. A real double count, with two counted keys reading one account, still refuses (ROADMAP Phase 183 Goal, SC-1..SC-4).

Data integrity and user-facing: the book renders the "rebuilding, duplicate account" panel instead of a curve, and after Phase 176 LEGACYRETIRE the derived curve is the only curve it has.

</domain>

<decisions>
## Implementation Decisions

### Founder decision
- **D-01 — Count once, draw the curve** (founder 2026-10-31, AskUserQuestion: "Count once, draw the curve (Recommended)"): a marked duplicate whose account the derive's account-group resolution already counts once no longer refuses the book. A real double count (two counted keys on one account, `account_identity_collision`) still refuses. Writer and reader agree: the writer is the identity gate `duplicate_keys` in `analytics-service/services/job_worker.py`; the reader is `countsAsDuplicate` / `untrustworthyRebuildReason` in `src/lib/queries.ts`.
- **D-02 — Say "counted once" on the per-key note** (founder 2026-11-01, AskUserQuestion: "Say 'counted once' (Recommended)" — "Replace the note with a neutral line saying the account is shared and counted once. Under your rule, one account behind several logins is intended, so telling the user to disconnect a key is wrong."): the Exchanges page per-key account-share note for a marked duplicate key no longer tells the user to "Disconnect one of them"; it says the key reads the same exchange account as its holder and that the account is counted once.
- **D-03 — Leave the panel's `duplicate_account` line as is** (founder 2026-11-01, AskUserQuestion: "Leave as is (Recommended)" — "It is rare now and its wording still describes a double count. Revisit it if it ever appears on PROD."): the rebuilding panel line in `AllocationDashboardV2` keeps its current copy. Revisit only if it appears on PROD.
- **D-04 — No "counted once" note on the Overview** (founder 2026-11-01, AskUserQuestion: "No (Recommended)" — "Nothing in the UI needs it. The book draws its curve either way."): no UI reads the writer's `duplicate_shared_account_counted_once` flag in this phase.
- **D-05 — Recompose inside the running job when a marker changed during it** (founder 2026-11-01, AskUserQuestion: "Fix it in 183 (Recommended)" — "Minimal fix: just before the compose saves its curve, it re-reads the keys' duplicate markers. If one changed during the run, it queues one more compose, so the double count is replaced within one job instead of a day. Adds a test that fails without it."): when a second login is marked a duplicate while the book's compose is running, that compose read the keys before the marker and writes a curve counting the account twice; the stamper's recompose enqueue is absorbed by the running job (enqueue dedup on pending/running/done_pending_children), so the wrong curve would stay until the next day's derive. Implemented as a re-read of the markers before the save and one redo of the compose inside the same job (a queued follow-up would be absorbed the same way).

### Founder rule carried (not re-asked)
- One exchange account under several logins is intended (founder memory). A marked duplicate is a normal state of a book, not an error to refuse over.

### Claude's Discretion
- Whether `DeriveRefusal.ACCOUNT_DUPLICATE` stays in the closed refusal vocabulary (for any case the group resolution does NOT count once) or is retired; research must show which cases, if any, still reach it, and the choice goes in the plan with its evidence. The vocabulary is pinned by `analytics-service/tests/fixtures/derive_refusal_rows.json` and the census, so either choice moves those pins.
- The exact shape of the reader change in `equityHistoryReadiness` / `countsAsDuplicate`, as long as it applies the writer's rule.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` — `### Phase 183: DUPCOUNT` (goal, evidence, SC-1..SC-4)
- `analytics-service/services/job_worker.py` — the derive's account-group loop (`account_groups`, `excluded_shared`, `counted_ids`, `duplicate_counted_once`) and the identity gate after it (`duplicate_keys`, `account_identity_collisions`, `_persist_refusal`, the Sentry `capture_message` that is QUANTALYZE-2H)
- `analytics-service/services/allocator_equity_derive.py` — `account_groups`, `DeriveRefusal.ACCOUNT_DUPLICATE`
- `src/lib/queries.ts` — `countsAsDuplicate`, `equityHistoryReadiness`, `untrustworthyRebuildReason`, `identityStillPending`
- `analytics-service/tests/fixtures/derive_refusal_rows.json` — the token-to-line table both runtimes and the census assert

</canonical_refs>

<specifics>
## Evidence (copied from the ROADMAP Phase 183 entry)

Evidence (PROD 2026-10-31, read-only, counts only): Sentry QUANTALYZE-2H recurs nightly since 2026-10-20 (14 events, last 2026-10-31 01:35Z). Exactly 1 `allocator_equity_derived` `equity_curve` row carries a refusal, token `account_duplicate`. That book holds 2 keys with `account_share_kind='duplicate'` (one Deribit, one MT5), each marked against a healthy sibling holder.

Root cause: in `analytics-service/services/job_worker.py` the derive's account-group loop (`account_groups`, building `excluded_shared` and `counted_ids`) already counts each shared account once. The identity gate after it (`duplicate_keys`: an eligible key marked `duplicate` whose holder is working) then refuses the whole book with `DeriveRefusal.ACCOUNT_DUPLICATE` regardless. The reader (`untrustworthyRebuildReason` and `countsAsDuplicate` in `src/lib/queries.ts`) maps the token to the `duplicate_account` line. `TODOS.md` records these refusals as expected since 167.1.2.1.1 WRITERRESIDUALS; that line changes with this phase.

⚠️ Measured 2026-11-01 at `8c8edc452`: `grep -n "account_duplicate" TODOS.md` returns 0 hits. The "expected since 167.1.2.1.1 WRITERRESIDUALS" line found is in `.planning/ROADMAP.md` (an out-of-scope bullet naming QUANTALYZE-23 and 2H). Research must locate the line this phase changes before planning edits to it.

⚠️ The reader blocks in two places: `equityHistoryReadiness` returns `duplicate_account` from the key list alone (`countsAsDuplicate`, before the series is read), and `untrustworthyRebuildReason` maps the stored token. Fixing the writer alone leaves the panel on screen.

## Success Criteria (copied from the ROADMAP)

1. A marked duplicate whose account the group resolution already counts once no longer refuses the book. Two counted keys on one account (`account_identity_collision`) still refuse.
2. Writer and reader apply the same rule (`job_worker.py` and `countsAsDuplicate` in `queries.ts`).
3. Tests go RED on the current refusal.
4. After deploy, a PROD reading shows 0 `account_duplicate` refusal rows, the book has a trustworthy curve, and QUANTALYZE-2H stops recurring.

</specifics>

<deferred>
## Deferred / Related

- The DUPCOUNT book also breached the NAVMTM zero-start band. That is fixed by NAVMTM G-01 (#1166, deployed 2026-10-31), not here. The book reads trustworthy only once both land, so SC-4's "trustworthy curve" reading depends on G-01 as well as this phase.
- SC-4 is a post-deploy PROD reading run by the orchestrator only, never by a dispatched executor.

</deferred>

<open_questions>
## Open questions for the founder

✅ **CLOSED 2026-11-01.** The founder answered all three (AskUserQuestion): question 1 is D-02, question 2 is D-03, question 3 is D-04 (see `<decisions>`). The questions are kept below as lineage.

1. **Per-key "duplicate" note.** Once the book draws its curve, should the Exchanges page and key list still show the marked duplicate key's note (it reads one account with another key), as information only, or should that note change? Today the panel's `duplicate_account` line (`countsAsDuplicate`) and the Exchanges page note share the working-holder rule (`isWorkingHolder`, per the `countsAsDuplicate` doc comment). This phase changes the book's readiness; whether the per-key note changes with it is a product call. Not decided here. (Research 2026-11-01: the Exchanges-page note reads "Disconnect one of them" and does not call `countsAsDuplicate`; the plans leave it untouched by default.)
2. **Panel line copy for a collision.** After this phase the `duplicate_account` panel line is reachable only through a real double count (`account_identity_collision`, or a stale `account_duplicate` row). Two live keys cannot share a venue id (unique index), so a collision typically involves a departed key, where the line's remedy may not fit. Whether the copy changes is a product call. Not decided here.
3. **A "counted once" note.** The writer already emits the benign flag `duplicate_shared_account_counted_once`, and no UI reads it. Whether the Overview should say a key is counted once is a product call. Not decided here.

</open_questions>
