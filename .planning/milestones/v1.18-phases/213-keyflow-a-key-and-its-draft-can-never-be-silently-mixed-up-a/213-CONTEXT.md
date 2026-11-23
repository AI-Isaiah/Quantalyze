# Phase 213: KEYFLOW - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A wizard draft is never resumed onto a different key without the user seeing it, and every key state the product can reach has a control that gets the user out. Four founder decisions, taken 2026-11-14 and recorded in the ROADMAP `### Phase 213:` entry, fix the behaviour: (a) Refuse when unknown, (b) Add Disconnect, (c) Block it (MT5 cannot be a composite member), (d) Hold and show pending. This phase implements those four and nothing else. No migration is expected (success criterion 5).

</domain>

<decisions>
## Implementation Decisions

### Founder decisions (from ROADMAP, 2026-11-14 — locked, quoted not paraphrased in plans)
- (a) Refuse when unknown: an unknown incoming key meeting a stored key does not resume the draft, and create-with-key returns a `deduped` flag whenever it returns an existing draft. Supersedes Phase 164.2.1 D-01 and D-02 for the unknown case only. The CSV branch's literal `null` stays load-bearing.
- (b) Add Disconnect: a Disconnect control (disconnect, never delete) on the "No strategy yet" row, with the `KEY_ORPHANED` copy pointing at it.
- (c) Block it: MT5 cannot be a composite member. The wizard's MT5 composite card is removed and `composite/add-key` refuses `mt5` with a named code.
- (d) Hold and show pending: basis-dependent metrics in the scenario composer show as pending until every leg's asset class resolves.

### (a) Refuse when unknown — how
- The distinction between "provably keyless" and "unknown" is carried by `source`, which already reaches `deriveWizardResumeOverrides`: on `source === "csv"` an incoming `null` stays permissive (unchanged); on `source === "api"` an incoming `null` meeting a stored string `apiKeyId` declines. Incoming `null` with no stored key stays permissive (nothing to conflict with). No new parameter.
- "Does not resume" means the decline withholds what the key-mismatch arm already withholds — the `wizardSessionId` (and the burn that rides with it) — so the submission cannot hit the create-with-key session fence for key A. Any other locally-restored field that belongs to key A's draft on the API branch (for example a restored step that presumes key A's connect) is withheld too; the planner measures which fields and records them.
- The Phase 164.2.1 three-argument pins and the arity contract's docblock are evidence for D-01. Pins that encode the superseded unknown-case behaviour are UPDATED with the supersession stated in the test text (founder 2026-11-14, decision (a)), never deleted. The arity guard (every production call passes the key) stays.
- create-with-key: `deduped: true` is added on the F6 session-fence arm, and the planner checks every other arm that returns an existing draft (the RPC select-existing path, the 23505 collision re-read) so "whenever it returns an existing draft" holds on all of them. The venue-fence and reuse arms already carry it.

### (b) Add Disconnect — how
- Reuse the existing owner-scoped RPC `disconnect_allocator_api_key` (auth.uid() ownership, idempotent, sets `disconnected_at`). No migration, no new route unless the RPC is shown to be unsuitable; read its LIVE definition before relying on it.
- Success criterion 2 says "a manager can disconnect an orphaned key". Today `/strategies` reads placeholder keys only for allocator and `both`. Phase 199 D-02 ("everything from both") gives no reason for excluding manager-only accounts, so the placeholder row and its Disconnect render for every role that can create a key through the wizard (manager, allocator, both). This supersedes the `isAllocator` gate on the placeholder read; recorded as a supersession in code and the plan.
- The Disconnect must reach every key the create-with-key venue fence refuses as `KEY_ORPHANED`. The placeholder list filters on `is_active` and not-revoked while the fence filters only on `disconnected_at`, so a revoked-but-not-disconnected orphan is refused and listed nowhere. Close that mismatch so such a key is listed with Disconnect (it may offer no "Finish setup").
- For allocator and `both`, a strategyless key may feed holdings. The new control reuses the existing feeds-aware Disconnect confirm from `AllocatorExchangeManager` rather than a second confirm.
- The test for criterion 2 asserts the way out actually opens: after Disconnect, connecting the same account again is not refused as `KEY_ORPHANED`. The key row is kept (disconnected_at set, never deleted).
- `KEY_ORPHANED` copy: the fix lines name the Disconnect control on the "No strategy yet" row; the conditional "if your account includes the Strategies page" and "releasing the stored key is not something you can do from this page" sentences are rewritten to match what is now reachable.

### (c) Block MT5 composite membership — how
- Remove the MT5 card from `MultiKeyConnectStep`'s roster. The UAT/F-4 carry-over in `enterMulti` is the one other route an MT5 key reaches a member panel (153.4 CR-03); it must also refuse MT5 (no multi-mode entry from an MT5 single-key draft), so removing the card cannot reopen CR-03.
- `composite/add-key` refuses `mt5` with a new named code BEFORE the `MT5_ENABLED` gate, so the answer does not depend on the flag. The code joins the `wizardErrors` union with copy, and the step's admitted-code list.
- `composite/set-members` also refuses a member whose key is `mt5` (TS read of the owned key's exchange, same named code), so an existing MT5 key cannot be attached by id. No SQL change.
- PROD measured 2026-11-14 via MCP (marker query first): 0 MT5 keys are composite members, so no data repair is needed.

### (d) Hold and show pending — how
- `blendPeriodsPerYear` treats a nullish `asset_class` as crypto (365). A leg is "resolved" when its asset-class probe has SETTLED — answered with a class, answered null, or failed. A settled null or failure keeps the existing conservative rule (nullish ⇒ 365); this phase does not change that rule. Pending is therefore always terminal: no leg can hold the composer in pending forever.
- While any leg is unresolved, every basis-dependent figure (annualized vol, Sharpe, Sortino, and any other consumer of the blend basis the planner enumerates) renders the composer's existing pending treatment, never a number on the interim basis. Basis-invariant figures (for example CAGR on the calendar clock) are not held.
- The planner enumerates every consumer of the blend basis and checks that save, commit and share cannot persist a figure computed while a leg is pending.

### Decided autonomously
- [Decision a] Q: "Which value distinguishes unknown from keyless?" → Selected: "the existing `source` argument" — internal function contract, one call site.
- [Decision a] Q: "Show a notice when the stored session is declined?" → Selected: "no new notice; the wizard simply starts without key A's token" — there is no draft on screen in the unknown case, so nothing is hidden from the user.
- [Decision b] Q: "New endpoint or existing RPC for Disconnect?" → Selected: "existing `disconnect_allocator_api_key` RPC" — no schema change, swappable later.
- [Decision c] Q: "Where else must MT5 be refused?" → Selected: "add-key, set-members, and the enterMulti carry-over" — TS-only guards.
- [Decision d] Q: "What ends pending on a failed probe?" → Selected: "settled-with-null counts as resolved, existing nullish rule applies" — keeps the existing RANK-06 contract.

### Post-research clarifications (phase agent, 2026-11-14 — founder review pending in hand-back)
These refine the "how" above after `213-RESEARCH.md` measured it. None changes a founder decision. Each is the reversible choice, flagged for the founder to confirm.
- (a) F1: an incoming `null` is "unknown" only when no draft matching the stored pointer is on screen. Decline iff `source === "api"`, incoming `null`, stored `apiKeyId` a string, AND NOT (`initialDraftId !== null` and `loaded.strategyId === initialDraftId`). Without this clause every reload of a composite draft would lose its session id and the next add-key would create a second composite draft. Uses only existing arguments. It matches the ROADMAP's own description of the unknown case ("`initialDraft` was nulled … and no preselect exists").
- (a) F2: `deduped: true` is added on every route-owned arm that returns an existing draft (F6 session fence, venue fence, 23505 race re-read, reuse resolver). The RPC-internal replay inside `create_wizard_strategy` / `create_wizard_strategy_for_key` cannot be told apart from a fresh mint without changing the RPCs' `RETURNS TABLE` shape (a migration). It is reachable only on an F6-read fault or a true concurrent double-submit of the same session, and after (a) a same-session submit is the same key. So the residual is a missing notice, not a cross-key mix-up. No migration in this phase. The residual is named in the plan and in CHANGELOG `### Notes`.
- (d) F5: a failed probe is terminal for the hydration effect. The effect must not re-fetch a leg whose probe failed; re-adding the leg is the retry. Without this, a figure could render, blank, and return on a different basis. The pending predicate also keeps the in-flight set as a belt.
- (b) F3: Profile → API keys renders for every role, but a manager gets Delete only and a polled manager key with holdings cannot be deleted. (b) stands as locked. The `KEY_ORPHANED` copy must not add a "use Profile → API keys" remedy, and the stale `allocatorOnly` docblock sentence is corrected.
- (b) The placeholder row adds Disconnect only. "Finish setup" keeps its current behaviour, and no new finalize path is offered on the row.

### Founder answers to the hand-back (2026-11-14, via the coordinator)

- **CR-02, option (1), honest copy, client only.** When create-with-key returns `deduped: true` with the same `strategyId` this wizard session already held, the wizard shows: "We kept the strategy this setup already created, on its original key. To connect different credentials, delete this draft first." The existing "These credentials are already connected…" sentence stays on every other dedup path (venue fence, 23505 re-read, reuse). The route is unchanged. Required test: draft on key A, then "Try another key", then submit key B, shown RED without the fix.
- **Accepted defaults.** F1, F2, F3 and F5 above, UI-SPEC review items 1-7, the "No strategy yet" row rules (manager Finish setup finalizes to private; no Finish setup on revoked orphans), IN-07 (kept unreachable MT5 tripwire) and T-213-08 (named in the CHANGELOG Notes) stand as decided.

### Claude's Discretion
- Exact wording of the new MT5 composite refusal copy and of the rewritten `KEY_ORPHANED` fix lines, written under the repo's existing wizard copy principles (161-UI-SPEC § Copy Principles: name only remedies that are reachable). Flagged for founder review in the hand-back.
- Whether the existing "These credentials are already connected…" notice (`wizard-dedup-notice`) shows when the session-fence arm now answers `deduped: true`. Default: it shows — the user did not get a new strategy, which is exactly what the notice says. Cheap to reverse (one condition); flagged for founder review in the hand-back.
- Visual form of the Disconnect control and of the pending state: reuse existing components (the row's existing action styling, the composer's existing pending treatment) per DESIGN.md.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/wizard/localStorage.ts` — `sessionKeyMatches`, `deriveWizardResumeOverrides` (one production caller: `WizardClient.tsx`).
- `src/lib/wizard/derive-resume-overrides-arity.contract.test.ts` — production-arity guard.
- `src/app/api/strategies/create-with-key/route.ts` — F6 session fence (no `deduped` today), venue fence / reuse arms (carry `deduped`).
- `disconnect_allocator_api_key(uuid)` RPC (migration `20260422101911_api_keys_disconnected_at.sql`; check later redefinitions).
- `src/components/exchanges/AllocatorExchangeManager.tsx` — Disconnect handler and feeds-aware confirm.
- `src/lib/queries.ts` `getStrategylessActiveKeys`; `src/app/(dashboard)/strategies/page.tsx` (placeholder read gated on `isAllocator`); `src/components/strategy/StrategyTable.tsx` ("Finish setup →" row).
- `src/lib/wizardErrors.ts` — `KEY_ORPHANED` entry and the code union.
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` — MT5 card (gated on `MT5_UI_ENABLED`), `enterMulti` carry-over, admitted-code list.
- `src/app/api/strategies/composite/add-key/route.ts`, `composite/set-members/route.ts`.
- `src/lib/closed-sets.ts` `blendPeriodsPerYear`; `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (`addedAssetClassById`, `AddedMetricsState` pending/settled/unavailable).

### Established Patterns
- Very dense in-code rationale comments citing phase/decision ids; supersessions are recorded in place, not by deleting lineage.
- Tests that must be shown able to fail (neuter → RED → restore from byte backup).
- Error codes flow route → `wizardErrors` entry → step admitted-code list.

### Integration Points
- `WizardClient.tsx` resume overrides and `dedupedExisting` notice.
- `/strategies` page placeholder rows.
- Scenario composer metric tiles and its save/commit/share paths.

</code_context>

<specifics>
## Specific Ideas

- TODOS entries `164.2.1-INCOMING-NULL-CONFLATION`, `0.08` (`D-161-05-A`), the Phase 153.6 MT5-composite OUT line and `0e` (`159-BASIS-FLIP`) appear already removed from `TODOS.md` by #1267 (re-homed into this phase). Confirm per id with `grep -aF` at ship and say so in the CHANGELOG; fix any code or doc pointer that still cites them.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
