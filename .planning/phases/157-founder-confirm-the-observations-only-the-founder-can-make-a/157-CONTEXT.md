# Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

⭐ **Deferred to the next milestone, 2026-11-23 (founder decision; recorded here and in `ROADMAP.md` per the deviation policy).** Founder: "delay 157 into next milestone. Cannot do that now". The phase leaves v1.18 with FCONF-01..04. Phases 221–225 moved with it on the same day: "Move them too (Recommended)". State at the move: plan 01 done (staging kit, smoke test, founder script, reviewed); plans 02 and 03 not started, each a founder checkpoint. Nothing in this file is reversed. The decisions below stand. Two things change: 157 no longer rides in the 155.2 founder sitting, and the FCONF-04 rotation still waits for 155.2's last live read with MM2's investor password. When the next milestone starts, re-measure the kit against the shipped wizard before plan 02, because the routes it stubs may have moved by then.

<domain>
## Phase Boundary

The phase delivers founder observations of shipped wizard behaviour, plus one credential rotation. It does not deliver product code. ROADMAP `### Phase 157` says: "UI hint: no (it observes shipped UI; a failed observation is a finding, not a new design)".

- FCONF-01: with a live draft, `+ Strategy` shows the resume banner, and Resume lands on the draft's step.
- FCONF-02: the amber `wizard-sync-recomputing` block renders with its heading, no red envelope and no metric numbers.
- FCONF-03: the four 153.7 copy members (`SEAM_INTERNAL_FAULT`, `DRAFT_LOOKUP_FAILED`, `DRAFT_FINALIZE_FAILED`, `SEAM_RESPONSE_UNREADABLE`) render in a real wizard, with no Retry control on `SEAM_INTERNAL_FAULT`.
- FCONF-04: `MT5_SPIKE_INVESTOR_PASSWORD` is rotated after the last live read that needs it. Gate 1 is then re-checked: all three keys (MM2, MM3, FX-AI_V) sync `complete` on a sync that ran after the rotation.

The agent prepares everything: a staging kit, a founder script, and the gate-1 re-read. The founder makes the observations and does the rotation. The phase agent ran without the founder, so every decision below is a recorded default. It was not a founder answer.

</domain>

<decisions>
## Implementation Decisions

### Staging FCONF-02 and FCONF-03 (how a failure state is shown on a real wizard)
- Stage each state on the real, deployed PROD wizard in the founder's signed-in browser. A browser-side response stub (a `window.fetch` wrapper) answers only the named routes, with the exact status, body and headers the route emits at HEAD. The stubbed request never leaves the browser, so staging writes nothing to PROD. — **Reversibility:** costly. Rationale: the alternatives are destructive or dishonest. Truly provoking `SEAM_INTERNAL_FAULT` means unsetting the MT5 gateway env on PROD, which breaks MT5 for every key. Truly provoking the amber state means deleting a strategy's trades while a job runs, and hand-staging PROD rows is fake data presented as real. 153.7's own human item names "stubbing the route response" as an acceptable method (`.planning/milestones/v1.17-phases/153.7-*/153.7-VERIFICATION.md`, `human_verification[0].test`).
- Interception is proven by reading the code, not by a vitest run. `wizardFetch` (`src/lib/wizard/wizard-correlation.ts`) calls the global `fetch` per call. `@supabase/ssr`'s `createBrowserClient` passes no custom fetch. supabase-js `resolveFetch` returns `(...args) => fetch(...args)`, a lazy global lookup. The overlay's draft read (`ContributionWizardOverlay.tsx`) also calls global `fetch`. So a wrapper installed after page load intercepts every call made after it. A vitest check cannot settle this, because that test mocks the client module.
- The stub fails closed. While it is active, every same-origin `/api/` request and every Supabase REST request is answered by a stub or refused, unless it is an explicit pass-through read the target state needs. A refused write never goes out, so a stub miss can never become a real finalize, key creation or draft delete.
- While the stub is active, a fixed, visible marker reads "STAGED RESPONSES ACTIVE — FCONF-0x". The founder script says: no marker, do not click. A reload drops the stub and the marker together. The marker also keeps the staging honest: nothing staged poses as a real answer.
- Injection: the preferred path is the main session running the kit through the claude-in-chrome `javascript_tool` in the founder's tab. The fallback is the founder pasting it into the DevTools console. Chrome asks for `allow pasting` the first time.
- What the founder should see comes from `WIZARD_ERROR_COPY` in `src/lib/wizardErrors.ts` at HEAD, and from the amber block's literal JSX in `SyncPreviewStep.tsx`. It is never taken from 153.7's prose.

### Reaching each staged surface without losing data
- FCONF-03 connect step (`SEAM_INTERNAL_FAULT`): open the wizard overlay (`+ Strategy` on the strategies list) with `GET /api/strategies/wizard-draft` stubbed to `{ draft: null, kind: null }`. The overlay then mounts a fresh `connect_key` step, and the founder's live draft is untouched. `/strategies/new/wizard` resumes onto `sync_preview`, and "Start fresh" DELETES the draft, so neither is used. `POST /api/strategies/create-with-key` is stubbed with the route's `{ code: "SEAM_INTERNAL_FAULT" }` envelope, status 500 and the headers `keyRouteFailureHeaders` emits for a non-breaker error. The founder types placeholder text (not a credential) into the form so the client-side validation passes. — **Reversibility:** costly. Rationale: the path must keep the founder's only live draft, which FCONF-01 and the Submit staging both need.
- FCONF-03 submit step (`DRAFT_LOOKUP_FAILED` 500, `DRAFT_FINALIZE_FAILED` 500, `SEAM_RESPONSE_UNREADABLE` 502): resume the live draft and walk to Submit. `POST /api/strategies/finalize-wizard` is stubbed with one of the three envelopes at a time, re-armed between clicks. Finalize is ALWAYS stubbed and never passes through. — **Reversibility:** one-way. Rationale: a real finalize publishes the founder's draft on PROD.
- Writes on the way to Submit (Metadata and Review saving the draft's own fields) are stubbed when their success shape can be mirrored faithfully. Otherwise they pass through as the founder's own draft fields saved through the product path, and the kit lists them by route. Zero PROD writes is the preference. Any pass-through write is named in the kit and in the founder script.
- FCONF-02 amber block: resume the live draft onto `sync_preview`. Stub the inputs the AMBER case in `SyncPreviewStep.stale-refusal.runtime.test.tsx` drives: the trades count 0, the CSV row count 0, an analytics row in the terminal state that test uses, and `GET /api/strategies/{id}/sync-progress` answering an in-flight `jobStatus` ("running"). Any kickoff POST is stubbed or refused, never sent.

- ⛔ CORRECTED 2026-11-23 after 157-RESEARCH.md, before planning; the bullets above are kept as lineage. (1) At HEAD there is no `+ Strategy` button that opens the overlay for a manager. `/strategies` has `Add a strategy` as a link to `/strategies/new/wizard`, which reads the draft server-side, so the kit cannot stub it there. The overlay opens only from the allocator-branch sidebar or mobile-nav `Add a strategy`. The connect leg uses that overlay entry when the founder's account shows it. Otherwise it resumes onto `sync_preview` and uses "Try another key", a pure step change that deletes nothing, with `GET /api/strategies/composite/members` answered `{"members":[]}`. (2) The Metadata, Review and Submit walk writes nothing until finalize. The kit stubs `POST /api/keys/sync`, always stubs `POST finalize-wizard`, and refuses `DELETE /api/strategies/draft/*` and every other non-GET/HEAD on `/api/` and `/rest/v1/`. `/auth/v1/*` passes through. (3) An unstaged Resume can enqueue a real sync on the founder's draft. So the kit is armed BEFORE Resume in every leg, including the FCONF-01 leg. A new tab shows the banner (the pointer's HMAC uses a per-tab sessionStorage nonce), so the FCONF-01 banner leg runs in a new tab with the kit armed. A private window is optional. (4) `request_call` and `expand_log` render no discrete controls. The script describes what is actually on screen: the alert box, title, cause, fix bullets with the contact-form link, a collapsed Diagnostics disclosure, and Retry only when recoverable.

### FCONF-01
- FCONF-01 is NOT treated as done. The 2026-11-19 capture notes record the same-browser silent resume and the founder's ruling "(a) the silent return is fine". They say the private-window banner leg was "pending", while STATE.md says the banner showed in a fresh browser. Neither records Resume being clicked and landing on the draft's step. The founder script carries a short private-window step: `+ Strategy`, banner, Resume, and the draft's step. SC-1's wording ("sees the resume banner") and the founder's same-browser ruling differ, so this phase records both and does not tick SC-1 on the agent's word.

### FCONF-04 rotation
- The rotation is MM2's investor password. `155.1-SPIKE-RUNBOOK.md` uses MM2's investor login for the spike, and the password is typed at runtime (`read -rs`) in a Railway shell, not stored as a variable. Rotating it means the founder changes MM2's investor password at the broker, then updates every PROD key on MM2's account through the product's own path (profile, exchanges, "Update password", `UpdateMt5SecretDialog` going to `rotate-secret`). — **Reversibility:** one-way. Rationale: an old investor password cannot be restored once changed at the broker, and any stored key left on the old password fails its next sync.
- A PROD read on 2026-11-23 found more than one PROD key on MM2's account, by matching `venue_account_id`. Every one of them is updated, and gate 1 is read after that. Before the rotation, the agent re-reads that set by `venue_account_id` and checks the Railway variables for any `MT5_SPIKE_*` value. Both checks are read-only.
- Ordering: the rotation waits until Phase 155.2's last live read with MM2's investor password, and any further 155.1 spike run. 155.2 has not started, so the rotation plan cannot run in this pass. It is the last step.
- ⭐ 2026-11-23 (from 157-RESEARCH.md): `rotate-secret` validates the new password live against the broker, so the broker change comes first. On success it sets the key to `idle` and enqueues no sync. Gate 1 is therefore read on the first scheduled derive after the rotation, or after a sync the founder starts. `complete_with_warnings` is NOT `complete`. If a gate-1 key ends there, that is recorded as a finding for the founder to rule on. The agent does not tick it.
- Gate-1 re-check (the agent's job, read-only on PROD through MCP, marker query first): all three keys MM2, MM3 and FX-AI_V show `sync_status = 'complete'` with `last_sync_at` later than the rotation time. Any other key on MM2's account must also come back `complete`.

### Plan shape and completion
- Plan 01 (autonomous) builds the staging kit and the founder script. Plan 02 (founder checkpoint) covers the FCONF-01..03 observations. Plan 03 (founder checkpoint, gated on 155.2's last live read) covers the FCONF-04 rotation and the gate-1 re-read. The agent executes only Plan 01. No SUMMARY is written for a plan whose founder step has not happened.
- Verification ends `human_needed` and is recorded as deferred. It is not passed.
- ⛔ CORRECTED 2026-11-23 (after Plan 01 executed; the bullet above is kept as lineage): with Plans 02 and 03 unrun, there is NO verification yet. No VERIFICATION.md and no `## Deferred Verification` STATE row is written, because that row would drop 157 from the autonomous queue. The honest state is "stopped at Plan 02's founder checkpoint, 1/3 plans". Verification runs after Plans 02 and 03.

### Decided autonomously
- [Kit location] Q: "Where does the staging kit live?" → Selected: "In the phase directory (`157-STAGING-KIT.js` plus `157-FOUNDER-SCRIPT.md`), not under `src/` or `scripts/`" — it is a one-shot observation aid, no product code changes, and it is moved or deleted with one commit.
- [Tests] Q: "Add render tests for the four copy members?" → Selected: "No" — the phase observes shipped UI, and a test would turn it into a code ship. A failed observation is booked as a finding.
- [Public repo] Q: "How does the kit match routes?" → Selected: "By path pattern only, with no strategy, key or user id, login, server or amount in tracked text" — the pattern is local to two files.
- [Rehearsal] Q: "Rehearse the staging in the founder's Chrome?" → Selected: "No" — another session has UAT pending in that browser, and a miss there would be a real write. Interception is proven by reading the code.

### Claude's Discretion
- The exact stub shapes for the Metadata and Review draft saves, and the kickoff or poll requests on `sync_preview`, are derived by the executor from the route code at HEAD.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/wizardErrors.ts`: `WIZARD_ERROR_COPY` (the four 153.7 members, with title, cause, fix and actions). `SEAM_INTERNAL_FAULT.actions` is `["request_call", "expand_log"]`, so `recoverable` is false and no Retry renders.
- `src/app/api/strategies/create-with-key/route.ts`: the error tail `NextResponse.json({ code }, { status, headers: keyRouteFailureHeaders(err) })`.
- `src/app/api/strategies/finalize-wizard/route.ts`: `DRAFT_LOOKUP_FAILED` (500), `DRAFT_FINALIZE_FAILED` (500), `SEAM_RESPONSE_UNREADABLE` (502), each with `NO_STORE_HEADERS`.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`: the `showRecomputing` gate and the `wizard-sync-recomputing` block.
- `SyncPreviewStep.stale-refusal.runtime.test.tsx`: the AMBER case's exact inputs.
- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx`: the overlay draft read through global `fetch`.
- `src/components/strategy/UpdateMt5SecretDialog.tsx`, mounted from `AllocatorExchangeManager.tsx` on `/profile`: "Update password".

### Established Patterns
- Founder sessions are one step at a time, with a URL, what to click and what they should see.
- PROD reads go through the Supabase MCP, marker query first.

### Integration Points
- The strategies list `+ Strategy` opens `ContributionWizardOverlay`, which mounts `WizardClient`.

</code_context>

<specifics>
## Specific Ideas

- The live draft as of 2026-11-23 is the one the founder created on 2026-11-19 on the test key that shares FX-AI_V's login. Its ids are not recorded here.
- Gate 1 read on 2026-11-23 (PROD, MCP): MM2, MM3 and FX-AI_V all `complete`, with `last_sync_at` on 2026-11-22 around 01:06–01:10 UTC. This is the baseline. It is not the post-rotation reading.

</specifics>

<deferred>
## Deferred Ideas

- Render tests for the four 153.7 copy members, if the founder wants the 153.7 human items to become regression-guarded. That would be its own phase.

</deferred>
