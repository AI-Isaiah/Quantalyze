# Phase 93: Composite Data-Path Correctness - Research

**Researched:** 2026-07-11
**Domain:** Composite strategy data-path (wizard window capture → strategy_keys → stitch worker → factsheet read-path). Next.js route handlers + React wizard (TS) and the Python analytics worker (`run_stitch_composite_job`).
**Confidence:** HIGH on HARD-03/HARD-05 root causes and fix seams (exact file:line, verified against the current tree). MEDIUM on the *precise* HARD-02 loss branch — the write path is verified correct at the code level, so the live "window –/Days 0" symptom needs the preserved repro to pick between two candidate branches (documented below).

> **No CONTEXT.md exists for this phase** (standalone research, phase dir was empty). No locked user decisions to honor beyond REQUIREMENTS.md / ROADMAP.md success criteria and the standing invariants (parity, no-invented-data, fail-loud, worker-only decrypt).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HARD-02 | First member key's data window captured & persisted end-to-end; never `window "–"/Days 0` when entered; regression test fails without fix. | §HARD-02 — verified write path (`set-members` → `set_wizard_composite_members` RPC), the client mapping, the offline regression seam, and two candidate loss branches. |
| HARD-03 | Composite persists `cumulative_method` in `data_quality_flags` at stitch; factsheet chart prefers persisted over live re-derive. Closes #69 / Phase-90 LOW-2. | §HARD-03 — exact stitch decision site (job_worker.py:3312-3317), persist site (merged_flags block :3549-3587), read re-derive site (composite-read-path.ts:103), and the prefer-persisted mechanism + fallback + parity argument. |
| HARD-05 | ccxt (Bybit/OKX/Binance) composite members reconstruct honestly OR degrade with visible DQ reason — never fail-loud PERMANENT. Closes #78. | §HARD-05 — exact rejection site (job_worker.py:3154-3175), the derive path that honest reconstruction must reuse (:2340-2520), and the degrade mechanism (member_warn_flags / merged_flags DQ). |
| SC-4 | Existing composites + single-key stay byte-identical (parity pin). | §Parity — `test_composite_headline_parity.py`, `test_stitch_composite_job.py`, `test_golden_parity.py`, `composite-read-path.test.ts`, `compositeAttribution.test.ts`. |
</phase_requirements>

## Summary

Three independent composite data-path defects, each on a different layer. **HARD-03** and **HARD-05** have clean, verified root causes with additive/persisted-preferred fixes. **HARD-02**'s write path is verified correct at the code level, so the live symptom likely lives in a client-state edge or a per-key display read — flagged as needing the preserved repro to disambiguate.

**HARD-03 (drift):** The composite factsheet read-path re-derives the cumulative method **live** from `returns_denominator_config` (`composite-read-path.ts:103` → `attributionBasisFromConfig`), while the headline scalars were persisted at stitch time under the method chosen at `job_worker.py:3312-3317`. Editing the config after publish (without re-stitching) makes the chart's running-cumulative curve disagree with the frozen headline. Fix: persist `cumulative_method` into `merged_flags` at the stitch persist block (`job_worker.py:3549-3587`, following the exact `mtm_gated_reason`/`insufficient_window` drop-stale pattern already there) and have `readCompositeFactsheet` **prefer** the persisted value, falling back to the live re-derive only when absent (older composites). This changes **no persisted scalar** → parity holds.

**HARD-05 (ccxt fail-loud):** `run_stitch_composite_job` hard-rejects any non-Deribit member at `job_worker.py:3154-3175` with a PERMANENT `_stamp_failed`. The comment there and STATE [86-03] name the exact reason: honest ccxt reconstruction needs the derive path's flow-valuation + DQ-02 retention-terminus machinery (`job_worker.py:~2340-2520`), which the stitch loop never invokes (it only calls the Deribit-native `_reconstruct_deribit`). Phase 92's `2c4753a9` fixed `transforms._merge_status_meta` to carry all `NAV_TWR_GUARD_KEYS` by-construction — so the broker path's DQ meta now round-trips cleanly, removing one blocker to reusing it. Smallest honest paths: (A) add a `_reconstruct_ccxt_member` sibling that reuses `combine_realized_and_funding` + terminus per member, or (B) degrade — stamp a visible DQ reason and exclude/flag the member instead of failing the whole composite. §HARD-05 recommends A as the honest fix with B as the fallback for unreconstructable members.

**HARD-02 (first-key window):** The window WRITE path is `MultiKeyConnectStep.handleContinue` (`:502-507`) → `POST /api/strategies/composite/set-members` (`route.ts:111-115`) → `set_wizard_composite_members` RPC (migration `20260710180000:208-220`) — **not** `/api/keys/sync` as REQUIREMENTS.md states (that route only enqueues jobs + does a membership count probe; it never writes windows). This path is structurally sound: a panel cannot validate without a window (`canValidate`, MultiKeyConnectStep.tsx:718), the window is sent for every panel, and the RPC writes it directly. The offline regression seam is `set-members/route.test.ts:173-183`, which today asserts only property *existence* and the last member's null — it does **not** pin the first member's `window_start` *value*.

**Primary recommendation:** Land HARD-03 and HARD-05 as verified additive fixes. For HARD-02, treat the plan as "lock the value-level round-trip with an offline regression test + close the two candidate branches," and require the preserved live repro (or a seeded e2e) to confirm which branch fired before claiming closure.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Member window capture | Frontend wizard (`MultiKeyConnectStep`) | — | User enters windows in panels; `canValidate` gates on `windowStart`. |
| Member window persistence | API route + DB RPC (`set-members` → `set_wizard_composite_members`) | — | Wholesale delete-then-insert into `strategy_keys`; seq server-derived. |
| Composite stitch + metric persistence | Python worker (`run_stitch_composite_job`) | DB (`strategy_analytics`, `csv_daily_returns`) | Reconstructs each member, clips to window, stitches, computes ONE canonical metrics object, persists headline + by-basis + DQ flags. |
| Cumulative-method decision | Python worker (`job_worker.py:3312-3317`) | DB (`data_quality_flags`, to be added) | Method chosen from `returns_denominator_config` at stitch; must be frozen into DQ so read-path can't drift. |
| Factsheet chart method resolution | Frontend read-path (`composite-read-path.ts`) | shared by v2 + discovery detail | Currently re-derives live; must prefer persisted. |
| ccxt member reconstruction | Python worker (derive path `:2340-2520`) | services (`broker_dailies.py`, `transforms.py`, `nav_twr.py`) | The honest flow-valuation/terminus machinery lives here; stitch must reuse it, not fork. |

## Standard Stack

No new packages. All fixes are in existing modules using existing helpers.

| Module | Role in this phase |
|--------|--------------------|
| `analytics-service/services/job_worker.py` | `run_stitch_composite_job` — HARD-03 persist site, HARD-05 rejection site. |
| `analytics-service/services/broker_dailies.py` + `transforms.py` + `nav_twr.py` | The ccxt derive machinery HARD-05 reuses (`combine_realized_and_funding`, `_merge_status_meta`, `NAV_TWR_GUARD_KEYS`). |
| `analytics-service/services/stitch_composite.py` | Pure `clip_to_window`/`coverage_mask`/`stitch_clipped_series` (unchanged; consumed). |
| `src/lib/factsheet/composite-read-path.ts` | HARD-03 read-path — prefer persisted method. |
| `src/lib/composite/compositeAttribution.ts` | `attributionBasisFromConfig` — the live re-derive to be superseded when persisted present. |
| `src/app/api/strategies/composite/set-members/route.ts` + migration `20260710180000` | HARD-02 write path. |
| `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` | HARD-02 client capture + mapping. |

**Installation:** none.

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. All changes reuse in-repo modules and existing dependencies (pandas, ccxt, supabase-js, zod) already pinned in the lockfiles. Package Legitimacy Gate skipped (nothing to verify).

---

## HARD-02 — First member key's window dropped

### Verified write path (this is what actually persists windows)

1. **Capture (client).** `MultiKeyConnectStep.tsx` panels. A panel cannot be validated until a window is entered:
   - `canValidate` requires `!!p.windowStart` — `MultiKeyConnectStep.tsx:714-719`.
   - `allValidated` requires every panel `status==="validated" && !!p.windowStart` — `:452-454`. `canContinue` gates on it (`:457`).
2. **Map to payload (client).** `handleContinue` builds `keys[]` with `window_start: p.windowStart`, `window_end: p.stillLive ? null : p.windowEnd || null` — `MultiKeyConnectStep.tsx:502-507` — and POSTs to `/api/strategies/composite/set-members` (`:508-512`). `onSuccess` reports `first = current[0]` as the api_key handoff (`:522-527`).
3. **Server re-validate + write.** `set-members/route.ts`:
   - Re-validates with the SAME `keyWindowsSchema` (`:71`); requires every member minted (`:82-89`).
   - Builds `p_members` with `window_start`/`window_end` (seq intentionally omitted) — `:111-115`.
   - Calls `set_wizard_composite_members` RPC (`:119-123`).
4. **DB write.** RPC `set_wizard_composite_members` (migration `supabase/migrations/20260710180000_wizard_composite.sql:208-220`): `DELETE` all members then `INSERT ... SELECT (elem->>'window_start')::date, (elem->>'window_end')::date, row_number() OVER (ORDER BY window_start ASC, api_key_id)`. Windows written directly from each element; **seq is re-derived from window_start order** (client seq ignored).

**The `add-key` POST vs `set-members` POST distinction (per the task):**
- `POST /api/strategies/composite/add-key` (`MultiKeyConnectStep.tsx:394`) → `add_wizard_composite_key` RPC → mints an `api_keys` row and returns `(strategy_id, api_key_id)`. **It does NOT write `strategy_keys` and carries NO window.** Windows only ever enter via `set-members`.
- `ConnectKeyStep` (State A, single mode) posts to `/api/strategies/create-with-key` and **has no window field at all** (`ConnectKeyStep.tsx:154-159` state; `:200-211` payload). `enterMulti` carries the single-key draft creds into panel 1 but explicitly leaves windows empty — "the single-key form has no window field, so the user fills them in multi mode" (`MultiKeyConnectStep.tsx:307-320`).

### Root-cause assessment (honest)

At the code level the multi-key write path is **correct and complete**: window is required to validate, sent for every panel, and persisted verbatim. The requirement's stated route (`/api/keys/sync`) is imprecise — that route only enqueues `stitch_composite`/`sync_trades` and does a `strategy_keys` **count** probe; it never writes `window_start/window_end` (verified: `keys/sync/route.ts:1-70`, and the only `strategy_keys` refs there are the count probe at `:406`).

Therefore the live "first key window `–`/Days 0" symptom is **one of two branches** — the plan must close both, and the preserved repro picks which fired:

- **Branch A (display / read-back — most likely given the write path is sound).** The factsheet's per-member "window / Days" is driven by `per_key` in `data_quality_flags`, computed at stitch by `coverage_mask` over the **reconstructed, window-clipped** series — NOT by `strategy_keys.window_start` directly. See `job_worker.py:3226` `clip_to_window(returns, m["window_start"], m.get("window_end"))` and the mask at `:3272`; the wizard renders `first_day/last_day/n_days` from `per_key` (`SyncPreviewStep.tsx:1041-1055`, `:694-696`). A member whose entered **declared** window does not overlap its reconstructed data (or a member that reconstructed 0 days) shows `n_days:0` → "window –/Days 0" even though `strategy_keys` holds the entered window. For a first member on a ccxt venue this **collapses into HARD-05** (that member never reconstructs → whole stitch fails today; once HARD-05 lands, a degraded member could surface as Days 0). This is the strongest hypothesis.
- **Branch B (client-state edge).** A panel-0 state path where `windowStart` is present at `canValidate` time but cleared/replaced before `handleContinue` (e.g., a validated panel switches to the read-only summary chip at `MultiKeyConnectStep.tsx:794-809` and a subsequent edit/reorder path drops it). Not reproduced in the current read of the component, but it is the only place a *persisted-empty* first window could originate.

### Fix + regression seam

- **Offline regression seam (primary):** `src/app/api/strategies/composite/set-members/route.test.ts:173-183`. Today it asserts each member `toHaveProperty("window_start"/"window_end")` and `members[2].window_end === null`. **Strengthen to assert the FIRST member's `window_start` VALUE** round-trips into `p_members` (currently only existence is pinned) — this is the "route/unit test that fails without the fix, offline" the requirement asks for. Add a companion pure test on `MultiKeyConnectStep.handleContinue`'s panel→payload mapping (offline, no Supabase) asserting panel[0].windowStart survives into `keys[0].window_start`.
- **If Branch A is confirmed:** the fix is display honesty — render the per-member declared window from `strategy_keys` (already read at `SyncPreviewStep.tsx:602-608` / factsheet path) as the "window" label, and treat `per_key.n_days` as coverage, so an entered window never shows "–". No persistence change.
- **If Branch B is confirmed:** guard the panel-edit/reorder path so a validated panel's `windowStart` cannot be nulled while still in the `keys[]` payload; the strengthened route+mapping tests pin it.

**Migration:** **none** for HARD-02 (the column + RPC already exist; the fix is client/display + test, or at most a display read of an already-persisted column).

---

## HARD-03 — Chart vs headline method drift (Phase-90 LOW-2, #69)

### Drift root cause (exact sites)

- **Stitch-time method decision (authoritative for the headline):** `job_worker.py:3312-3317`:
  ```
  if denominator_config is not None:
      cumulative_method = denominator_config.cumulative_method   # "geometric" | "simple"
      day_basis = metrics_day_basis(denominator_config.metrics_basis)
  else:
      cumulative_method = "geometric"; day_basis = "calendar"
  ```
  This `cumulative_method` feeds the ONE canonical compute (`_metrics_result_for` → `compute_all_metrics(..., cumulative_method=...)`, `:3355-3361`) whose scalars are persisted as the headline (`:3606`) and `metrics_json_by_basis.cash_settlement` (`:3506`).
- **Read-time LIVE re-derive (the drift):** `src/lib/factsheet/composite-read-path.ts:103`:
  ```
  const cumulativeMethod = attributionBasisFromConfig(returnsDenominatorConfig);
  ```
  `attributionBasisFromConfig` (`compositeAttribution.ts:49-60`) maps a `returns_denominator_config` whose `cumulative_method === "simple"` → `"arithmetic"`, else `"geometric"`. Because it reads **live config** (passed from `strategies.returns_denominator_config` at `v2/page.tsx:106` and discovery `[strategyId]/page.tsx:96-97`), an owner editing the config after publish flips the chart's cumulation basis while the persisted headline scalars stay frozen → chart disagrees with headline. **Both surfaces route through the SAME `readCompositeFactsheet`** (v2: `page.tsx:102-107`; discovery: `[strategyId]/page.tsx:92-98`), so ONE fix covers both. The wizard preview (`SyncPreviewStep.tsx:1089`) also re-derives live, but it runs on a fresh stitch (pre-publish) so drift can't occur there — lower priority; can be aligned for consistency.

### Stitch-persist site + prefer-persisted mechanism

- **Persist site:** `job_worker.py:3549-3587`, the `merged_flags` read-modify-write block. Add `merged_flags["cumulative_method"] = cumulative_method` here, mirroring the exact additive/drop-stale idiom already used for `mtm_gated_reason` (`:3560-3563`) and `insufficient_window` (`:3571-3574`). Since `cumulative_method` is always defined at this point, a plain unconditional set is correct (no drop-stale branch needed) — it self-heals on every re-stitch.
- **Read prefer-persisted:** in `readCompositeFactsheet` (`composite-read-path.ts:101-103`), prefer `dqf.cumulative_method` when present, mapping it with the SAME predicate `attributionBasisFromConfig` encodes so there is ONE mapping rule:
  ```
  const persisted = dqf?.cumulative_method;
  const cumulativeMethod =
    persisted === "simple"    ? "arithmetic"
    : persisted === "geometric" ? "geometric"
    : attributionBasisFromConfig(returnsDenominatorConfig);   // fallback: older composites
  ```
  Add `cumulative_method?: unknown` to the `dqf` input type (`composite-read-path.ts:50-59`) and the two page-level dqf casts (`v2/page.tsx:86-89`, discovery `[strategyId]/page.tsx:84-88`). Strict-literal coercion (only the exact strings `"simple"`/`"geometric"` are honored) mirrors the `=== true` server-truth discipline already in this file (T-92-05).

  **Vocabulary note (load-bearing):** the worker's `cumulative_method` is `"geometric"|"simple"`; the read-path's `cumulativeMethod`/`buildOpts.cumulativeMethod` is `"arithmetic"|"geometric"`. Persist the RAW worker string (`"geometric"|"simple"`) and map on read with the identical `"simple"→"arithmetic"` rule — do NOT persist the resolved basis, so the persisted value and the live-fallback value share one translation and can't diverge.

- **Fallback for older composites:** absent `dqf.cumulative_method` → fall back to the existing live re-derive. Existing published composites keep byte-identical behavior until their next re-stitch stamps the key (self-heal, exactly like HARD-04's `insufficient_window`).

### Parity confirmation

This changes **no persisted scalar** — it adds one boolean-adjacent string to `data_quality_flags` (JSONB) and changes only which *source* the read-path trusts for the chart basis. When config is unchanged (the only state existing published composites are in), persisted `cumulative_method` equals what `attributionBasisFromConfig` would derive, so the rendered curve is identical. Pins: `test_composite_headline_parity.py` (headline↔by-basis byte-identity, `:323`,`:399`), `composite-read-path.test.ts`, `compositeAttribution.test.ts`.

**Migration:** **none** — additive key on the existing `data_quality_flags` JSONB (same pattern as HARD-04 `insufficient_window`, which shipped with no migration). Self-heals on re-derive.

---

## HARD-05 — Non-Deribit composite members fail-loud PERMANENT (#78)

### Exact rejection site

`job_worker.py:3154-3175`, inside `_reconstruct_all`'s per-member loop:
```
venue = str(ctx.key_row["exchange"])
if venue != "deribit":
    await aclose_exchange(ctx.exchange)
    await _stamp_failed(f"Composite member on venue {venue!r} is not yet supported (Deribit-only this phase).")
    return DispatchResult(outcome=FAILED, ..., error_kind="permanent")
```
This is a **hard rejection**, not a missing adapter per se and not an over-strict guard — it is a deliberate Phase-86 scope fence. STATE [86-03] confirms: "ccxt (binance/okx/bybit) composite members fail LOUD PERMANENT this phase — honest ccxt reconstruction needs the derive path's full flow-valuation + DQ-02 retention-terminus machinery (`job_worker.py:2363-2413`); composing it partially = silently-wrong series (no-invented-data)." The Deribit-only path is served by `_reconstruct_deribit` (`:3083-3102`), which calls the native ledger (`build_deribit_native_ledger` → `combine_native_ledger`).

### The machinery honest reconstruction must reuse

The ccxt reconstruction the stitch loop lacks lives in `run_derive_broker_dailies_job` (`job_worker.py:~2340-2520`):
- Flow fetch bounded by venue retention (`fetch_ccxt_transfers`, `:2369-2374`), same-UTC-day flow valuation (`_resolve_ccxt_flow_price_index` + `ccxt_rows_to_dated_flows`, `:2382-2400`, fail-loud on unpriceable non-stable flow).
- `combine_realized_and_funding(realized, funding, account_balance=equity, external_flows=..., open_unrealized_usd=...)` → `(returns, meta)` (`:2452-2457`) via `services.nav_twr` (DQ-01/DQ-02 guards, terminus segmentation).
- **Phase 92 dependency (factor in):** `2c4753a9` replaced `transforms._merge_status_meta`'s hand-maintained allowlist with a by-construction loop over `NAV_TWR_GUARD_KEYS`, so every guard flag (incl. `pnl_dominated_guard`) now round-trips through the broker boundary. This removes the "silent DQ-flag drop" that made partial ccxt composition unsafe — the meta a reused ccxt reconstruction would return now carries all guard keys the composite's `member_metas` union (`:3517-3533`) already expects.

### Smallest honest path (recommendation)

**Option A — reconstruct properly (recommended primary):** add a `_reconstruct_ccxt_member(ctx, basis)` sibling to `_reconstruct_deribit` that reuses the derive path's crawl→value→`combine_realized_and_funding`→terminus flow per member and returns `(returns, has_option_activity=False, member_meta)` in the SAME shape. Route on `venue` at `:3154`: Deribit → native, ccxt-crypto (`_COMPOSITE_CRYPTO_VENUES`, referenced at `:3279`) → the new path. The clip/stitch/coverage_mask/compute machinery downstream is venue-agnostic and unchanged (`:3226`, `:3240`, `:3272`). Member guard flags already union into `merged_flags` and promote `complete_with_warnings` (`:3517-3589`) — so a ccxt member's honest DQ caveats surface by construction. The MTM gate already turns OFF for any non-Deribit venue (`mark_to_market_available`), so a ccxt member correctly ships cash-only. This is the "no-invented-data" honest reconstruction.

**Option B — degrade with a visible DQ reason (fallback for genuinely unreconstructable members):** where a ccxt member cannot be honestly reconstructed (e.g., retention gap the terminus can't cover), do NOT fail the whole composite PERMANENT. Instead stamp a member-scoped DQ reason into `merged_flags` (new key, e.g. `member_degraded_reason` / reuse the `member_warn_flags` channel at `:3517-3533` + `complete_with_warnings`) and either exclude the member from the stitch or surface it as an explicit gap — visible to the user via the existing DQ-caveat surfaces (wizard amber block `SyncPreviewStep.tsx`, factsheet hero strip `FactsheetView.tsx`). This mirrors the `mtm_gated_reason` precedent exactly.

**Recommended shape:** A for reconstructable ccxt members (removes the limitation), B as the honest fallback so a partial/short member degrades visibly rather than blowing up the whole composite. Both preserve fail-loud for genuinely structural errors (already typed: `_PERMANENT_LEDGER_ERRORS` at `:3074-3081`, rate-limit transient at `:3192`, geo-block transient at `:3211`).

### Scope + risk

- The derive path is large and I/O-heavy; factoring a clean per-member seam without forking is the main effort. The rate-limit/geo-block/close-exchange handling in `_reconstruct_all` (`:3192-3225`) already covers ccxt error taxonomy — reuse it.
- `has_option_activity=False` for ccxt keeps the MTM gate OFF (correct — no options book signal on ccxt spot/perp here).
- Parity: existing all-Deribit composites (Zavara) never touch the new branch → byte-identical. Pin: `test_stitch_composite_job.py` + the live Zavara acceptance (STATE [86-04]).

**Migration:** likely **none** if Option B reuses the existing DQ channel; if a new named DQ key is introduced it's additive on the JSONB (no schema change). **Flag:** if the plan adds a distinctly-named member-degrade key, confirm no `data_quality_flags` CHECK constraint rejects it (the by-basis object has a Phase-85 CHECK, but `data_quality_flags` is free-form JSONB — verify at plan time).

---

## Parity (SC-4) — tests that must stay green

| Test | Layer | Pins |
|------|-------|------|
| `analytics-service/tests/test_composite_headline_parity.py` | Python | Headline scalars byte-identical to `metrics_json_by_basis.cash_settlement` (`:323`, `:399`); geometric convention. HARD-03 must not move these. |
| `analytics-service/tests/test_stitch_composite_job.py` | Python | Worker orchestration (fan-out, clip, stitch, persist ordering, DQ merge). HARD-03 (persist `cumulative_method`) + HARD-05 (new venue branch) both touch here — extend, don't break. |
| `analytics-service/tests/test_stitch_composite.py` | Python | Pure `clip_to_window`/`coverage_mask`/overlap. Unchanged (consumed). |
| `analytics-service/tests/test_golden_parity.py`, `test_metrics_parity.py`, `test_metrics_minigolden.py` | Python | Single-key + metrics goldens. Must stay byte-identical (no single-key path touched). |
| `src/lib/factsheet/composite-read-path.test.ts` | TS | Read-path behavior incl. C-1 method resolution. HARD-03 prefer-persisted + fallback pinned here. |
| `src/lib/composite/compositeAttribution.test.ts` | TS | `attributionBasisFromConfig` mapping. The fallback path must keep this rule. |
| `src/app/api/strategies/composite/set-members/route.test.ts` | TS | HARD-02 write payload — strengthen first-member value assertion. |

**Parity argument per requirement:** HARD-03 = additive DQ key + read prefers-persisted (identical to live when config unchanged) → no scalar moves. HARD-05 = new venue branch never entered by existing all-Deribit composites → byte-identical. HARD-02 = display/test only (or a display read of an already-persisted column) → no scalar moves.

## Runtime State Inventory

Not a rename/refactor/migration phase — this is a correctness-fix phase on existing code paths. No stored-string rename, no OS-registered state, no secret-key rename. **None found in all categories — verified: no string rename or datastore key change is in scope; all three fixes are additive code/DQ changes on existing columns.** The only persisted-data consideration is the self-heal-on-re-stitch behavior (HARD-03/HARD-05 DQ keys appear on the next derive; existing rows keep working via fallback) — this is a *forward* self-heal, not a migration.

## Common Pitfalls

### Pitfall 1: Persisting the resolved basis instead of the raw method (HARD-03)
**What goes wrong:** persisting `"arithmetic"/"geometric"` (the read-path vocabulary) while the worker thinks in `"geometric"/"simple"` creates two translation points that can drift.
**How to avoid:** persist the raw worker string (`cumulative_method` ∈ `{"geometric","simple"}`) and apply the SAME `"simple"→"arithmetic"` map on read that `attributionBasisFromConfig` already encodes. One rule, two consumers.

### Pitfall 2: Forgetting the fallback breaks existing composites (HARD-03)
**What goes wrong:** if the read-path requires `dqf.cumulative_method`, every already-published composite (no key yet) renders wrong until re-stitched.
**How to avoid:** absent → fall back to the live re-derive (current behavior). Self-heals on next derive, exactly like HARD-04's `insufficient_window`.

### Pitfall 3: Forking the derive machinery instead of reusing it (HARD-05)
**What goes wrong:** re-implementing ccxt flow valuation inside the stitch loop produces a subtly-different series than the single-key derive → silent divergence (the exact reason the Phase-86 fence exists).
**How to avoid:** reuse `combine_realized_and_funding` + the terminus helpers verbatim via a thin per-member wrapper; keep `transforms._merge_status_meta` (now by-construction, `2c4753a9`) as the meta boundary.

### Pitfall 4: Claiming HARD-02 closed on reasoning alone
**What goes wrong:** the write path looks correct, so "fixed by adding a test" without the live repro may pin the wrong branch (display vs client-state) and leave the real defect.
**How to avoid:** require the preserved live repro (or a seeded e2e) to reproduce "window –/Days 0" first, then confirm which branch (A display / B client-state) the fix closes. Mirrors ROADMAP's HARD-01/04 "must NOT close on reasoning alone" gate.

### Pitfall 5: Composite `computation_status` promotion blast radius (HARD-05)
**What goes wrong:** a new member DQ flag added inside `NAV_TWR_GUARD_KEYS` promotes status factsheet-wide.
**How to avoid:** decide deliberately whether a degraded ccxt member should be `complete_with_warnings` (it should — `member_warned` already does this at `:3589`) vs a non-status DQ annotation (HARD-04's choice). Reuse `member_warn_flags` for warnings; keep any pure annotation outside the guard-key set.

## Validation Architecture

`workflow.nyquist_validation` is enabled (config.json). Both suites are blocking CI gates.

### Test Framework
| Property | Value |
|----------|-------|
| Frontend framework | Vitest (`"test": "vitest run"`, package.json). Coverage gate: lines 82 / stmts 80 / fns 74 / branches 72 (vitest.config.ts). |
| Backend framework | pytest (`analytics-service/pytest.ini`, `testpaths = tests`). Coverage gate `--cov-fail-under=80` (Makefile:73). |
| Quick run (TS) | `npx vitest run src/lib/factsheet/composite-read-path.test.ts src/lib/composite/compositeAttribution.test.ts src/app/api/strategies/composite/set-members/route.test.ts` |
| Quick run (Py) | `.venv/bin/python -m pytest tests/test_stitch_composite_job.py tests/test_composite_headline_parity.py -q` (run under the pinned 3.12 venv, not local 3.14 — pandas SIGSEGV) |
| Full suite (Py) | `.venv/bin/python -m pytest -q` (expect ~3584 pass / 92 skip baseline) |
| Full suite (TS) | `npx vitest run` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| HARD-02 | First member `window_start` value forwarded into `p_members` | unit (route) | `npx vitest run src/app/api/strategies/composite/set-members/route.test.ts` | ✅ (strengthen assertion — value not just property) |
| HARD-02 | Panel[0].windowStart survives into keys[0] (offline mapping) | unit | new test on `handleContinue` mapping (no Supabase) | ❌ Wave 0 |
| HARD-02 | Display never shows "–" for an entered declared window | render/e2e | `SyncPreviewStep` render test / seeded e2e (if Branch A) | ❌ Wave 0 (branch-dependent) |
| HARD-03 | Stitch persists `cumulative_method` into `data_quality_flags` | unit | `pytest tests/test_stitch_composite_job.py -k cumulative_method -q` | ❌ Wave 0 |
| HARD-03 | Read-path prefers persisted over live re-derive; fallback when absent | unit | `npx vitest run src/lib/factsheet/composite-read-path.test.ts` | ✅ (extend) |
| HARD-03 | Headline byte-identity unchanged | parity | `pytest tests/test_composite_headline_parity.py -q` | ✅ |
| HARD-05 | ccxt member reconstructs (or degrades with DQ) — no PERMANENT | unit | `pytest tests/test_stitch_composite_job.py -k ccxt -q` | ❌ Wave 0 |
| HARD-05 | All-Deribit composite unchanged (branch not entered) | parity | `pytest tests/test_stitch_composite_job.py -q` | ✅ |
| SC-4 | Goldens byte-identical | parity | `pytest tests/test_golden_parity.py tests/test_metrics_parity.py -q` | ✅ |

### Sampling Rate
- **Per task commit:** the relevant quick-run command above.
- **Per wave merge:** full Python suite + `npx vitest run` on `src/lib/factsheet` + `src/lib/composite` + the wizard/route dirs.
- **Phase gate:** both full suites green + goldens/parity byte-identical + mypy clean before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Python test: stitch persists `cumulative_method` in `data_quality_flags` (`test_stitch_composite_job.py`).
- [ ] TS test: `readCompositeFactsheet` prefers persisted `cumulative_method`; falls back when absent (`composite-read-path.test.ts`).
- [ ] Python test: ccxt member reconstructs / degrades honestly (no PERMANENT) (`test_stitch_composite_job.py`).
- [ ] TS test: offline `handleContinue` mapping — panel[0].windowStart → keys[0].window_start (new).
- [ ] HARD-02 display/e2e coverage — branch-dependent, gated on the live repro.

## Security Domain

`security_enforcement` not set to false → included, but attack surface is minimal (no new endpoints, no new auth paths).

| ASVS | Applies | Standard Control (already in place) |
|------|---------|-------------------------------------|
| V5 Input Validation | yes | `keyWindowsSchema` re-validated server-side in `set-members` (`route.ts:71`); zod one-spec shared with client. |
| V4 Access Control | yes | RPCs are SECURITY DEFINER with `auth.uid()=p_user_id` guards; `strategy_keys` owner-coherence trigger; worker-only decryption (decrypt sole-site in `_allocator_key_preflight`). No change. |
| V6 Cryptography | no (unchanged) | HARD-05 must keep decryption worker-only — reuse `_allocator_key_preflight`, never read secrets from the job payload (T-86-09). |

**Leak discipline (carry-over, applies to HARD-05):** member DQ reasons and error messages must stay account-size-safe — scrub freeform strings (`scrub_freeform_string`, already used at `:3179`,`:3242`), emit booleans/reasons only, never raw USD/NAV (T-73-02/T-76-03-LEAK/T-92-04). A ccxt degrade reason must not carry balances.

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Headline via divergent single-key recompute | ONE canonical composite compute reused for headline + by-basis | Phase 86 | HARD-03 persists the method that compute used. |
| ccxt broker DQ meta via hand-maintained allowlist | by-construction loop over `NAV_TWR_GUARD_KEYS` | Phase 92 `2c4753a9` | Unblocks HARD-05 reuse of the broker path. |
| Short-window over-annualization silent | `insufficient_window` DQ flag (additive, drop-stale) | Phase 92 `2cd7425f` | The exact additive/drop-stale pattern HARD-03 should copy. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | HARD-02's live symptom is Branch A (per-key display) rather than Branch B (client-state persist gap). `[ASSUMED]` — the write path is verified correct, but the exact failing branch is not reproduced in this session. | HARD-02 | If Branch B, a display-only fix leaves a real persist bug. **Mitigation:** plan closes both + requires the live repro. |
| A2 | `data_quality_flags` has no CHECK constraint that would reject a new named key (e.g. a HARD-05 member-degrade reason). `[ASSUMED]` — the by-basis object has a Phase-85 CHECK; the DQ flags column is free-form JSONB but not exhaustively verified for constraints this session. | HARD-05 | A rejected key fails the upsert. **Mitigation:** verify at plan time (`\d strategy_analytics` / migration grep). |
| A3 | Option A (reuse `combine_realized_and_funding` per member) produces a series byte-consistent with the single-key derive for the same key. `[ASSUMED]` from code structure, not run. | HARD-05 | A divergent series would violate no-invented-data. **Mitigation:** live ccxt canary + parity assertion before closure. |

## Open Questions

1. **HARD-02 exact branch.**
   - Know: write path (client→set-members→RPC) is correct; `/api/keys/sync` in the requirement is imprecise; display reads `per_key` (reconstructed) for "Days".
   - Unclear: whether the live "–/Days 0" was a display artifact (Branch A) or a persisted-empty first window (Branch B).
   - Recommendation: reproduce with the preserved live composite (or seed an e2e owned by the logged-in user — MEMORY Ph91 lesson) before choosing the fix; strengthen the offline route+mapping tests regardless.

2. **HARD-05 A vs B split per venue.**
   - Know: the derive machinery exists and is reusable; Phase 92 fixed the meta boundary.
   - Unclear: which ccxt members are honestly reconstructable end-to-end vs need degrade (retention-limited histories).
   - Recommendation: implement A; wire B as the fallback for members the terminus can't cover; gate closure on a live ccxt canary (Bybit/OKX/Binance), mirroring the Zavara Deribit acceptance.

3. **`data_quality_flags` constraint check (HARD-05).** Verify no CHECK/whitelist blocks a new member-degrade key before naming one (A2).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 pinned venv | Running the analytics suite (pandas SIGSEGV on local 3.14) | ✓ (`.venv`, STATE) | 3.12.13 | none — MUST use the pinned venv |
| Live ccxt exchange creds (Bybit/OKX/Binance, read-only) | HARD-05 live reconstruction canary | ✗ locally | — | Railway-injected read-only creds (STATE [86-04] pattern: `railway run -- <3.12-venv-python> ...`) |
| Live Deribit creds | Parity canary (Zavara) | ✗ locally | — | Railway-injected (existing acceptance script) |
| Shared Supabase test DB | e2e/SQL for HARD-02 display branch | ✓ (test project qmnijlgmdhviwzwfyzlc) | — | Prefer offline route/unit seams; e2e only if Branch A display needs it |

**Missing with fallback:** live exchange creds → Railway-injected canary (HARD-05 honest-reconstruction proof genuinely needs a live crawl; unit tests mock the crawl).
**Blocking:** none for the code+unit-test work; HARD-05 closure evidence needs the Railway canary.

## Sources

### Primary (HIGH confidence — read this session, current tree @ branch `gsd/v1.9.1-composite-onboarding-hardening`)
- `analytics-service/services/job_worker.py` — `run_stitch_composite_job` (:2837-3636): HARD-05 rejection (:3154-3175), method decision (:3312-3317), merged_flags persist (:3549-3587), derive path (:2340-2520).
- `src/lib/factsheet/composite-read-path.ts` (:46-154) + `src/lib/composite/compositeAttribution.ts` (:49-60) — HARD-03 read re-derive.
- `src/app/api/strategies/composite/set-members/route.ts` (:50-163) + `.../route.test.ts` (:154-186) + migration `20260710180000_wizard_composite.sql` (:154-232) — HARD-02 write path + RPC + seam.
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` (:307-533, :685-859) + `ConnectKeyStep.tsx` (:153-247) — HARD-02 capture/mapping.
- `src/app/api/keys/sync/route.ts` (:1-70) — confirms it does NOT write windows.
- `src/app/factsheet/[id]/v2/page.tsx` (:80-120) + `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` (:84-114) — both read-path consumers.
- `git show 2c4753a9` — Phase-92 `_merge_status_meta` by-construction fix.
- `.planning/STATE.md` [86-03]/[86-04]/[92-*], `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`.

### Secondary (MEDIUM)
- `analytics-service/tests/test_composite_headline_parity.py`, `test_stitch_composite_job.py` (headers/intent read) — parity pins.

## Metadata

**Confidence breakdown:**
- HARD-03: HIGH — exact drift site, persist site, prefer-persisted mechanism, and parity argument all verified against the tree.
- HARD-05: HIGH on the rejection site and the reuse target; MEDIUM on the A-vs-B split (needs live-crawl evidence per member).
- HARD-02: MEDIUM — write path verified correct; the failing branch of the live symptom needs the preserved repro.
- Parity/SC-4: HIGH — test files enumerated and their intent confirmed.

**Research date:** 2026-07-11
**Valid until:** ~2026-08-10 (stable internal code; re-verify line numbers if `job_worker.py`/`composite-read-path.ts` change before planning).
