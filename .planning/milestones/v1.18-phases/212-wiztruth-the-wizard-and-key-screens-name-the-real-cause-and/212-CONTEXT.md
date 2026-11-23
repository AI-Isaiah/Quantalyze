# Phase 212: WIZTRUTH — the wizard and key screens name the real cause, and every remedy they offer can work - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Every refusal the wizard and the key screens show names the cause that was actually established, and every remedy it offers can succeed. Scope is exactly the ROADMAP `### Phase 212:` entry: the composite arm of `SyncPreviewStep` branches on the real verdict; `MT5_GATEWAY_MISCONFIGURED_DETAIL` names no cause; the three `keys/validate-and-encrypt` consumers render from `code` and a bare upstream 401/403 answers a named code; an MT5 connect that meets a running derive waits long enough or says it is busy with a measured retry time; an orphaned MT5 key is refused before the 120 s validate where its identity is known first; every remaining "contact support" pointer names a real next step. No migration. Closes TODOS `0.07` (`D-161-07-A`), `0.09`, `0.012` (`D-161-05-B`), `0.51` (Phase 153.5 finding #10), `0.013` (WIZFORM-02 §D), `WIZFORM-02-VE-CODECHANNEL`, `164.2-WIZARD-BARE401`, `CONTACT-SUPPORT-POINTERS-01`.

</domain>

<decisions>
## Implementation Decisions

### MT5 cause-unknown copy (SC2) — founder decision 2026-11-14
- `MT5_GATEWAY_MISCONFIGURED_DETAIL` becomes, byte for byte: "The MT5 gateway would not let us prove read-only capability, and it did not report why. This needs an operator, not a retry — see docs/runbooks/mt5-go-live.md." This is the founder approval SC2 requires. The arm-3 contract in `.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/161-UI-SPEC.md` is amended to this sentence in the same change. The constant stays the generic fallback AND the `curated_gateway_detail` degradation target, keeps the `Mt5GatewayMisconfigured()` default-argument property, and must pass the MT5 curated-message fence (token lists in `mt5_validation.py`) unrelaxed. Arms 1 and 2 are unchanged. Comment-prose carriers that restate the old parenthetical as arm 3's meaning are corrected in the same pass.

### Contact-support pointers (SC6) — founder decision 2026-11-14
- Server strings shown to users (csv-finalize `ENQUEUE_LOST_RACE_USER_COPY`, finalize-wizard composite `computation_error`, the two `account/export` messages) say "use the contact form" as plain text, so they become links wherever the rendering screen already goes through `ContactPointerText`, and read as a real next step where it does not. No new response field.
- The two admin-only `audit_warning` strings (`admin/match/send-intro`, `admin/partner-import`) name the admin's actual action instead of a support pointer, e.g. "Add the audit entry by hand; do not re-send." (partner-import keeps its "Do NOT re-run the import" meaning).
- Every in-app string (ProfileForm, SignupForm x2, ScenarioCommitDrawer x2, WeightOptimizerSection, ApiKeyManager and any other census hit) renders through `ContactPointerText` with a `contactHref` topic.
- Census is regenerated at HEAD with the TODOS entry's command (`grep -rni 'contact support' src ... | grep -v wizardErrors.ts | grep -v test`); the 2026-11-14 reading was 13 strings + 2 comments, not the entry's 15. Closing means the regenerate command returns only comments and fixtures, the pinning tests move, and the 164.6.6.3.5 no-email-in-copy sweep extends to the touched modules.

### MT5 connect during a running derive (SC4) — founder decision 2026-11-14
- Measure, then decide. Read the `mt5.stage` hold times (derive read + restart, and the interactive validate's own duration) from Railway logs, read-only. If p95 derive hold plus our own check fits inside the 120 s client budget (D-26), raise `_MT5_LEASE_WAIT_S` via its `MT5_LEASE_WAIT_S` env default to cover it. Otherwise keep the `KEY_MT5_TERMINAL_BUSY` refusal and change its copy to state the measured retry time instead of "a minute". The measured numbers, their source and window are recorded in the phase artifacts; no number is guessed (if logs cannot yield a measurement, stop and report rather than invent one).

### Decided autonomously
- [Composite verdict] Q: "How does the composite arm pick its code?" → Selected: "Branch on the real verdict through the same discrimination as the single-key arm and `gateFailureToWizardError`, so `sampled_gapped` and `fill_derived_unproven` render `GATE_SERIES_EXAMINED_REFUSED`; unstamped/null keeps `GATE_SERIES_PROVENANCE_UNVERIFIED`; the 142.2 pin moves with it" — a local branch in one component plus test.
- [Code channel] Q: "How do the three validate-and-encrypt consumers render?" → Selected: "Read `code` and look up `WIZARD_ERROR_COPY` via a roster, following `ConnectKeyStep`'s `recogniseCreateWithKeyCode`; add the fifth surface to `wizardErrors.roster-render.test.tsx` and raise `EXPECTED_POPULATION_MIN` off the new measurement" — client render change, no contract change.
- [Bare 401/403] Q: "Where does a bare upstream 401/403 get its code?" → Selected: "One shared status→seam-code lookup (`UPSTREAM_STATUS_TO_SEAM_CODE`, 401/403 → `SEAM_MISCONFIGURED`) consulted in the classifier's null-`seamCode` branch, so `create-with-key`, `composite/add-key` and `validate-and-encrypt` agree; route tests on both twins with `new AnalyticsUpstreamError('Unauthorized', 401)`" — internal mapping, existing code.
- [Orphan refusal] Q: "When is an orphaned MT5 key refused?" → Selected: "Run the existing two-read orphan resolver before the 120 s validate wherever the key's identity is known before validation, returning the existing `KEY_ORPHANED` refusal" — reorder within one route.
- [Scope] Q: "Migration?" → Selected: "None (SC7)" — none written.
- [Tests] Q: "Proof standard" → Selected: "Each fix has a test shown RED when the fix is reverted (neuter, observe RED, restore from byte backup)" — test-only.

- [Post-research, SC3] Q: "Which code-channel consumers?" → Selected: "The two live consumers at HEAD (StrategyForm, AllocatorExchangeManager via ApiKeyForm); ApiKeyManager stopped calling the route in Phase 200; the stale docblock is corrected" — measured, no third consumer invented.
- [Post-research, SC3] Q: "Recogniser shape" → Selected: "Status-aware (wire RATE_LIMITED at 429 is our limiter, at 424 the venue's throttle); a 5xx keeps its specific static sentence where one exists (the persist-INSERT 500); a 4xx with an unrecognised code renders its curated sentence as the envelope cause" — client render detail.
- [Post-research, SC3] Q: "Add SEAM_MISCONFIGURED to OUR_DEFECT_KEY_ERROR_CODES?" → Selected: "No; record that the Next-side Sentry page for a stale service key stops while the Python middleware still captures it" — one roster line to flip later.
  - ⛔ **CORRECTED 2026-11-14 (212 review round 1, WR-04) — flipped.** The premise ("the Python middleware still captures it") holds for the service-key hop only; on `keys/[id]/rotate-secret` a stale `INTERNAL_API_TOKEN` raises a bare 403 with no source capture, so the Next-side page was the only one and it had stopped. `SEAM_MISCONFIGURED` is now in `OUR_DEFECT_KEY_ERROR_CODES`. Cost: it also pages the forwarded `KEK_UNAVAILABLE`, `SERVICE_KEY_UNCONFIGURED` and `EGRESS_PROXY_MISCONFIGURED` rows on all three key routes (our operator configuration), and the service-key hop produces two events per fault. The selection above is kept as lineage. ROADMAP carries no restatement of it that this fix edited.
- [Post-research, SC5] Q: "Scope of the early refusal" → Selected: "MT5 credential arm of create-with-key only (the only arm that knows identity before validation); the two tests pinning Phase 161-05's credentials-first order are inverted, as ROADMAP SC5 requires; held latency is out of scope and recorded" — reorder within one route.
- [Post-research, SC4] Q: "Lease wait" → Selected: "Keep _MT5_LEASE_WAIT_S at 20 s (raising it would break D-26's 120 s client ceiling, and no p95 exists); add a behavioural pin that validate and job leases use different keys, with an equal-config RED control" — env default plus test.

### Pending founder questions (raised 2026-11-14 after research; plans carry the default until answered) — ANSWERED 2026-11-14, see below; the two items are kept as lineage
- SC4 busy copy: `KEY_MT5_TERMINAL_BUSY` says "Try again in a minute." Research found no truthful static number: wizard-only holders bound about 285 s at code defaults, the worker validate path up to the 30-minute `process_key_long` ceiling, the owed-scrub refusal unbounded while a scrub keeps failing. Default in plans: keep the bytes; the copy change is isolated in its own plan so it can change without replanning.
- SC6 csv-finalize `ENQUEUE_LOST_RACE_USER_COPY`: it byte-copies the SQL `computation_error_copy` ELSE arm, and the WR-07 test uses that SQL as its oracle; changing the SQL needs a migration, which SC7 forbids. Default in plans: rewrite the TS string, re-cut the oracle to a hand-typed sentence, and book the SQL arms plus the Python "contact support" strings outside the `src` census as survivors.

### Founder answers (2026-11-14, AskUserQuestion via the coordinator)
- **SC4 busy copy: keep.** `KEY_MT5_TERMINAL_BUSY` keeps "Try again in a minute." No truthful static number exists (see the question above), so the shipped bytes stand.
- **WR-04: keep the paging.** `SEAM_MISCONFIGURED` stays in `OUR_DEFECT_KEY_ERROR_CODES`, with the widened paging cost the round-1 CORRECTED note above records.
- **SC6 csv-finalize copy: accept the divergence.** The csv-finalize `ENQUEUE_LOST_RACE_USER_COPY` differs from the SQL `computation_error_copy` ELSE arm until TODOS `[212-CONTACT-SUPPORT-SURVIVORS]` restores parity.

### Claude's Discretion
- Exact code names, file splits and test placement within the above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gateFailureToWizardError` (`src/lib/wizardErrors.ts`) already maps `SERIES_EXAMINED_REFUSED` → `GATE_SERIES_EXAMINED_REFUSED`.
- `isDailyReturnsSourced` / `strategyGate.ts` own the verdict allow-list.
- `ContactPointerText` (`src/components/contact/ContactPointerText.tsx`) links the first "contact form" phrase; `contactHref` (`src/lib/contact.ts`) is the one encoder.
- `KEY_MT5_TERMINAL_BUSY` copy and `Mt5TerminalBusyError` exist; `mt5_terminal_lease(wait_s=...)` bounds acquisition (`analytics-service/services/mt5_concurrency.py`); `emit_mt5_stage_event` emits `mt5.stage` with `stage` + `duration_ms` (`services/mt5_client.py`).
- Orphan resolution: the two-read discipline and `ORPHANED` resolution in `src/app/api/strategies/create-with-key/route.ts`.
- `recogniseCreateWithKeyCode` in `ConnectKeyStep.tsx` is the code→copy pattern to copy.

### Established Patterns
- New `WizardErrorCode` members move `EXPECTED_TABLE_SIZE` at both pins plus `KNOWN_*` rosters (STALE_CLIENT worked example). 5xx bodies stay static; only the CODE is forwarded.
- MT5 curated constants pass the fence in `test_mt5_validate_parity.py`, `test_job_worker.py`, `test_ingestion_mt5.py`.

### Integration Points
- `SyncPreviewStep.tsx` composite arm (`setErrorCode("GATE_SERIES_PROVENANCE_UNVERIFIED")` near the `compositeAdmissible` check).
- `ApiKeyManager.tsx`, `StrategyForm.tsx`, `AllocatorExchangeManager.tsx`; `src/app/api/keys/validate-and-encrypt/route.ts`; `create-with-key/route.ts`; `composite/add-key/route.ts`.

</code_context>

<specifics>
## Specific Ideas

The MT5 arm-3 sentence is founder-approved verbatim (see decisions). Analytics-touching changes must pass CI's mypy strict.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
