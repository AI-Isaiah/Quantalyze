# Phase 23 Deferred Items

Out-of-scope discoveries logged during execution (NOT fixed — pre-existing or unrelated).

- **[23-05 Task 3]** `AllocationsTabs.tsx:33` pre-existing unused import `trackUsageEventClient` (eslint warning, present on HEAD before this plan). Out of scope per SCOPE BOUNDARY — not introduced by Plan 05.
- **[observation]** A foreign WIP git stash `stash@{0}` ("FOREIGN-WIP-on-main-not-mine") is present and NOT owned by this plan; left untouched per destructive-git-prohibition.

## DI-23-01 — readonly version-ahead draft substitutes live book (fix at next SCENARIO_SCHEMA_VERSION bump)

**Status:** deferred — UNREACHABLE today. Logged from the red-team FIX C pass (LOW, defer-with-rationale). NOT code-fixed.

**Where:** `src/app/(dashboard)/allocations/lib/scenario-state.ts`, `scenarioDraftCodec.decode` — the `version_ahead` branch (~lines 545–554, the `Number.isInteger(rawVersion) && rawVersion > SCENARIO_SCHEMA_VERSION` guard).

**The landmine:** when a blob carries a schema_version HIGHER than the running build's `SCENARIO_SCHEMA_VERSION` AND its shape fails `scenarioDraftSchema.safeParse`, the codec returns `{ value: defaultDraft, outcome: "readonly", reason: "version_ahead" }`. The `defaultDraft` here is the CURRENT LIVE BOOK (`defaultDraftFromHoldings(...)`), not the saved scenario. Both consumers then treat that live-book default as if it were the user's saved scenario:
- `ScenarioComparePanel.decodeDraft` — renders a fabricated comparison column that is actually the live book, mislabeled as the saved scenario.
- `ScenarioComposer` Open — opens the live book while presenting it as the reopened saved scenario.

So a version-ahead blob whose shape diverged silently substitutes the live portfolio for the user's saved scenario (a fabricated column / mislabeled composer), rather than honestly reporting "this scenario was written by a newer build and can't be shown."

**Why it is unreachable now:** every save goes through schema_version 2 (`SCENARIO_SCHEMA_VERSION === 2`), and the POST/PUT routes validate the draft shape with `scenarioDraftSchema` before persisting. So no v2 blob with a v>2 version + shape-mismatch can be written via the save path today. The branch only becomes reachable once a FUTURE schema bump (phases 26/27/28) changes the persisted shape, at which point an older build reading a newer blob can hit the safeParse-fail arm.

**Correct fix (apply at the NEXT `SCENARIO_SCHEMA_VERSION` bump):** on `version_ahead` + safeParse FAILURE, return an undecodable / null result (honest absence — "newer build, can't show") instead of `defaultDraft`. The `safeParse.success` arm (shape still compatible) may keep returning the parsed data read-only; only the failure arm must stop substituting the live book. Update `ScenarioComparePanel.decodeDraft` and `ScenarioComposer` Open to render the honest-absence state rather than a silent live-book substitution.

**Planning-doc note only** — `.planning/` is gitignored; no code change and no commit for this item.

## DI-23-02 — drifted saved-scenario reopen shows the DEFAULT, not the saved composition (product decision)

**Status:** deferred — TESTED, DOCUMENTED, INTENTIONAL contract today. Logged from the /ship whole-branch red-team (INFORMATIONAL, conf 7). NOT code-changed (changing it would revert a pinned test on a product guess).

**Where:** `src/app/(dashboard)/allocations/hooks/useScenarioState.ts:194` — `const draft = storedMismatch ? defaultDraft : value;`, plus the `dismissFingerprintMismatchBanner` path (lines 252-254). The `hydrateFromSaved` reopen seam (256-271) deliberately does NOT special-case the banner (documented in the 256-264 comment).

**The behavior:** reopening a saved scenario whose `init_holdings_fingerprint` drifted from the current book sets `value` to the saved draft, but the `draft` ternary then discards it and renders `defaultDraft` (the current live book, `addedStrategies: []`). The fingerprint-mismatch banner fires, but clicking "Keep my draft" only flips `mismatchDismissed` — it does NOT change the `draft` ternary, so the saved composition (weights/toggles/added strategies) is never displayed, and the first edit rebases to default via `baseOf`. The banner copy ("keep your draft") arguably implies the saved draft is preserved when the displayed draft is the live book.

**Why deferred, not fixed:** the drift→default fallback is an explicit, pinned contract — commit `6f8be0c0 test(23): pin drift-reopen working draft falls back to the DEFAULT` (T_HYD2) — designed so a scenario built against a stale book (whose scope-refs may no longer exist) isn't shown with dangling references. Faithfully rendering a drifted saved scenario while handling stale scope-refs is a genuine product/UX decision (and a non-trivial change), not a ship hotfix.

**Correct fix (product call, a later phase):** decide the reopen-after-drift semantic — either (a) on "Keep my draft" for a freshly-HYDRATED drifted scenario, surface `value` (the saved composition, reconciled against current holdings) instead of `defaultDraft`; or (b) block the drifted reopen with an honest "this scenario was built for a different book" notice (mirroring the codec `reset` path) rather than silently showing the live book. Either way, align the banner copy with what is actually displayed.

**Planning-doc note only** — no code change, no commit for this item.

## DI-23-03 — compare panel shows a stale pre-edit snapshot after an in-place Update (low)

**Status:** deferred — defensible point-in-time-snapshot semantics. Logged from the /ship red-team (INFORMATIONAL, conf 5). NOT code-changed.

**Where:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (`handleCompare` → `compareSelection`) + `refetchSaved`. `compareSelection.rows` (each carrying its draft JSONB) is captured at Compare-click time; a later composer Update (PUT → `refetchSaved`) updates `savedRows` but does NOT re-seed `compareSelection`, so the mounted `ScenarioComparePanel` keeps re-deriving columns from the pre-edit draft with no staleness indication.

**Why deferred:** a comparison is reasonably read as a snapshot taken at Compare-click; this is not a fabricated-number / honesty leak (the metrics are correctly computed from the captured drafts). Low confidence, edge interaction (edit-while-compared).

**Correct fix (if pursued):** after a mutation, re-resolve `compareSelection.rows` from the freshly fetched `savedRows` by id, or surface a "comparison reflects pre-edit drafts — re-run Compare" hint, or clear the panel. 

**Planning-doc note only** — no code change, no commit for this item.
