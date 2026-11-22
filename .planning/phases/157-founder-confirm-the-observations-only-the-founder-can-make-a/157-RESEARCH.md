# Phase 157: FOUNDER-CONFIRM - Research

**Researched:** 2026-11-23
**Domain:** browser-side `window.fetch` staging kit for the shipped wizard, founder observation script, MT5 credential rotation (no product code)
**Confidence:** HIGH for every request/response fact (all read at HEAD `f494bd05a` in this session); MEDIUM for FCONF-04 sync-after-rotation behaviour (one `[ASSUMED]`, see A1)

All paths are relative to the repo root. Public repo: no ids, logins, servers or amounts are written here, and none may be written in the kit or script.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(Copied from `157-CONTEXT.md` `## Implementation Decisions`; the phase agent ran without the founder, so each is a recorded default, not a founder answer.)

**Staging FCONF-02 and FCONF-03**
- Stage each state on the real, deployed PROD wizard in the founder's signed-in browser. A browser-side response stub (a `window.fetch` wrapper) answers only the named routes, with the exact status, body and headers the route emits at HEAD. The stubbed request never leaves the browser, so staging writes nothing to PROD. Reversibility: costly. 153.7's own human item names "stubbing the route response" as an acceptable method.
- Interception is proven by reading the code, not by a vitest run (`wizardFetch` calls global `fetch` per call; `@supabase/ssr` `createBrowserClient` passes no custom fetch; supabase-js `resolveFetch` is a lazy global lookup; the overlay's draft read calls global `fetch`).
- The stub fails closed. While active, every same-origin `/api/` request and every Supabase REST request is answered by a stub or refused, unless it is an explicit pass-through read the target state needs. A refused write never goes out.
- While the stub is active, a fixed visible marker reads "STAGED RESPONSES ACTIVE — FCONF-0x". No marker, do not click. A reload drops stub and marker together.
- Injection: preferred is the main session running the kit via claude-in-chrome `javascript_tool` in the founder's tab; fallback is the founder pasting it in the DevTools console.
- What the founder should see comes from `WIZARD_ERROR_COPY` in `src/lib/wizardErrors.ts` at HEAD and from the amber block's literal JSX in `SyncPreviewStep.tsx`, never from 153.7's prose.

**Reaching each surface without losing data**
- FCONF-03 connect step: open the wizard overlay with `GET /api/strategies/wizard-draft` stubbed to `{ draft: null, kind: null }`; fresh `connect_key`; founder's live draft untouched. `/strategies/new/wizard` resumes onto `sync_preview` and "Start fresh" DELETES the draft, so neither is used for this leg. `POST /api/strategies/create-with-key` stubbed with `{ code: "SEAM_INTERNAL_FAULT" }`, status 500, headers `keyRouteFailureHeaders` emits for a non-breaker error. Founder types placeholder text (not a credential).
- FCONF-03 submit step (`DRAFT_LOOKUP_FAILED` 500, `DRAFT_FINALIZE_FAILED` 500, `SEAM_RESPONSE_UNREADABLE` 502): resume the live draft and walk to Submit. `POST /api/strategies/finalize-wizard` stubbed with one envelope at a time, re-armed between clicks. Finalize is ALWAYS stubbed, never passes through.
- Writes on the way to Submit are stubbed when their success shape can be mirrored faithfully, otherwise they pass through and the kit lists them by route. Zero PROD writes is the preference; any pass-through write is named in kit and script.
- FCONF-02 amber block: resume the live draft onto `sync_preview`; stub the inputs the AMBER case in `SyncPreviewStep.stale-refusal.runtime.test.tsx` drives (trades count 0, CSV row count 0, an analytics row in that test's terminal state, `GET /api/strategies/{id}/sync-progress` with in-flight `jobStatus` "running"). Any kickoff POST is stubbed or refused, never sent.

**FCONF-01**
- NOT treated as done. The founder script carries a short private-window step: banner, Resume, and the draft's step. SC-1's wording and the founder's same-browser ruling differ, so this phase records both and does not tick SC-1 on the agent's word.

**FCONF-04 rotation**
- Rotate MM2's investor password at the broker, then update every PROD key on MM2's account through the product's own path (profile, exchanges, "Update password", `UpdateMt5SecretDialog` -> `rotate-secret`). One-way. The agent, before the rotation, re-reads the key set by `venue_account_id` and checks Railway variables for any `MT5_SPIKE_*` value (both read-only).
- Ordering: the rotation waits until Phase 155.2's last live read with MM2's investor password and any further 155.1 spike run. It is the last step; it cannot run in this pass.
- Gate-1 re-check (agent, read-only PROD via MCP, marker query first): MM2, MM3 and FX-AI_V show `sync_status = 'complete'` with `last_sync_at` later than the rotation time; any other key on MM2's account must also come back `complete`.

**Plan shape and completion**
- Plan 01 (autonomous) builds the staging kit and founder script. Plan 02 (founder checkpoint) = FCONF-01..03 observations. Plan 03 (founder checkpoint, gated on 155.2's last live read) = FCONF-04. The agent executes only Plan 01. No SUMMARY for a plan whose founder step has not happened. Verification ends `human_needed`, recorded as deferred, not passed.

**Decided autonomously:** kit lives in the phase directory (`157-STAGING-KIT.js` + `157-FOUNDER-SCRIPT.md`), not under `src/` or `scripts/`; no render tests for the four copy members; kit matches routes by path pattern only (no strategy/key/user id, login, server or amount in tracked text); no rehearsal in the founder's Chrome.

### Claude's Discretion
- The exact stub shapes for the Metadata and Review draft saves, and the kickoff or poll requests on `sync_preview`, are derived by the executor from the route code at HEAD.

### Deferred Ideas (OUT OF SCOPE)
- Render tests for the four 153.7 copy members (would be its own phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FCONF-01 | With a live draft, the add-strategy entry shows the resume banner and Resume lands on the draft's step | `## FCONF-01` below: entry label is "Add a strategy" (no literal "+ Strategy" at HEAD), banner conditions, `sync_preview` landing, and the kickoff-POST side effect of Resume |
| FCONF-02 | The amber `wizard-sync-recomputing` block renders (heading, no red envelope, no metric numbers) | `## FCONF-02` request set, PostgREST mapping, timings |
| FCONF-03 | The four 153.7 copy members render in a real wizard, no Retry on `SEAM_INTERNAL_FAULT` | `## FCONF-03 connect` and `## FCONF-03 submit` envelopes, exact copy, and the finding that `request_call`/`expand_log` are not discrete controls |
| FCONF-04 | Spike investor password rotated after last live read; gate 1 re-checked | `## FCONF-04`: `rotate-secret` validates live, writes `sync_status='idle'`, does NOT enqueue a sync |
</phase_requirements>

## Summary

Three findings change the plan and should be read before anything else.

1. **There is no "+ Strategy" button at HEAD, and `/strategies` does not open the overlay for a manager.** `grep -rnE '\+ ?Strategy' src --include='*.tsx'` returns only code comments. The manager's `/strategies` header control is `Add a strategy` as a `Link` to `/strategies/new/wizard` (`src/app/(dashboard)/strategies/page.tsx:1358-1362`: `<Link href="/strategies/new/wizard"><Button>Add a strategy</Button></Link>`), a full-page route whose draft is read **server-side** (`wizard/page.tsx:97`, not interceptable). The overlay (`ContributionWizardOverlay`) is opened by the sidebar/mobile nav action `Add a strategy` (`Sidebar.tsx:168-172`, `action: "add-strategy"`, allocator branch only, wired in `DashboardChrome.tsx:84-90,191`), by `StrategiesSection`'s "Finish setup" (which carries a preselect, so it shows the saved-key summary instead of the credential form, `WizardClient.tsx:266`), and by `StrategiesEmptyState`. The FCONF-03 connect leg therefore needs the founder's role to include the allocator workspace (sidebar "Add a strategy"). Whether the founder's account has it is `[ASSUMED]` (A2). Fallback if not: from the page route resume onto `sync_preview`, click "Try another key" (pure `setStep("connect_key")`, no delete, `WizardClient.tsx:1560`), then the connect form renders over the live draft id (the kit must then answer the extra `GET /api/strategies/composite/members?strategy_id=` with `{"members":[]}` or pass it through).
2. **`request_call` and `expand_log` are not discrete controls.** `ErrorEnvelope` (`src/components/error/ErrorEnvelope.tsx:145-262`) never reads `envelope.actions`; the action list only feeds `recoverable` (`src/lib/envelope.ts:54-57`: `RECOVERABLE_ACTIONS = new Set(["clear_and_retry","try_another_key"])`). What renders: `role="alert"` box with `data-testid="error-envelope"` and `data-error-code=<code>`, the title (`human_message`), the cause paragraph, the fix list as bullets (the "contact form" phrase is a link via `ContactPointerText`), a `Retry` button only when `recoverable && onRetry`, and a collapsed `Diagnostics` `<details>` holding `code:` and `correlation_id:` plus "Copy diagnostics". 153.7's human item expects "`request_call` and `expand_log` controls" and that wording has no matching element; the founder script must describe what is actually there, and a "missing controls" reading is a spec-wording finding, not a regression (A3).
3. **Metadata, Review and the sync_preview "Use this key and continue" step make no writes.** Grep of `wizardFetch(`, bare `fetch(` and `supabase.from/rpc` across `MetadataStep.tsx`, `ReviewStep.tsx`, `SubmitStep.tsx`, `SyncPreviewStep.tsx`, `WizardClient.tsx` finds only: Metadata `GET /rest/v1/discovery_categories` (read, `MetadataStep.tsx:628-633`), SyncPreviewStep reads and `POST /api/keys/sync` (kickoff/retry), `GET .../sync-progress`, SubmitStep `POST /api/strategies/finalize-wizard` (`SubmitStep.tsx:265`), and WizardClient `DELETE /api/strategies/draft/{id}` (`WizardClient.tsx:1213`, only behind Start fresh / Delete draft). Everything else on those steps is React state and `localStorage`. So "zero PROD writes" is achievable with a router that stubs finalize and kickoff, passes reads, and **refuses every non-GET/HEAD on same-origin `/api/` and on `/rest/v1/`** except explicit stubs.

A fourth finding for FCONF-04: `PATCH /api/keys/[id]/rotate-secret` re-validates the new password live against the broker before writing and, on success, sets `sync_status: "idle"` and `sync_error: null`; it enqueues **no** sync (`rotate-secret/route.ts:122-127, 514`). After a rotation the keys read `idle`, never `complete`, until a sync runs, so gate 1 cannot be read straight after the rotation.

**Primary recommendation:** Build the kit as one self-contained IIFE with a method-aware, fail-closed router (table below), a visible marker, a `__fconf` control object (`arm("..."), mode, refused`), and a jsdom-free smoke test that runs the router against canned `Request`s in plain Node; drive FCONF-02 and FCONF-03 submit from a resumed live draft, FCONF-03 connect from the sidebar overlay with the draft read stubbed to none.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Failure-state staging (response stubs) | Browser / Client | — | The wrapper lives in the founder's tab; nothing leaves the browser for stubbed routes. |
| Draft read for resume | API / Backend (overlay: `GET /api/strategies/wizard-draft`) and Frontend Server (page route reads via server Supabase client) | — | Page route read is RSC/server-side and cannot be stubbed; only the overlay read is a client `fetch`. |
| Sync progress + analytics reads | Database / Storage via PostgREST (browser Supabase client) + API (`sync-progress`) | — | Amber state is driven by client-side reads; both are interceptable. |
| Finalize / key creation / kickoff | API / Backend | — | These are the writes the stub must always answer. |
| Password rotation validation | API / Backend -> Python seam -> broker | Database (`api_keys` ciphertext + `sync_status`) | Validation happens server-side against the live broker. |
| Gate-1 evidence | Database (`api_keys.sync_status`, `last_sync_at`) | — | Read-only PROD query by the agent. |

## Standard Stack

No packages are installed. The kit is hand-written browser JS (ES2020, no imports) and its smoke test uses Node's built-ins.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) | — | Kit = one plain JS file run as a console / `javascript_tool` snippet | A paste-able snippet cannot import; CONTEXT locks the kit to the phase directory |
| Node built-ins (`node:test`, `node:assert`, global `Request`/`Response`/`Headers`) | Node v25.8.1 (`node --version` in this session) | Kit smoke test | Global Fetch API classes exist in Node >= 18, so no jsdom needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `window.fetch` wrapper | Service worker / Playwright route mocking / MSW | Service worker needs registration and scope; Playwright/MSW cannot attach to the founder's signed-in tab. The wrapper is the only option that keeps the founder's session and the deployed bundle. |

**Installation:** none. **Version verification:** not applicable (no registry packages).

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Audit not applicable. **Packages removed due to SLOP:** none. **Packages flagged SUS:** none.

## Architecture Patterns

### System Architecture Diagram

```
founder tab (signed in, PROD bundle)
   |
   |  kit installed by IIFE: window.fetch = router(originalFetch)  + visible marker
   v
app code --fetch(input, init)--> router
   input normalised: Request | URL | string -> {method, path, search, sameOrigin, host}
   |
   |-- same-origin /api/*
   |      |- matches a STUB row for the ARMED mode ........ -> new Response(stub)   (never leaves browser)
   |      |- GET/HEAD in the explicit PASS list ........... -> originalFetch (read)
   |      `- anything else (any non-GET/HEAD, unknown GET) . -> REFUSE: Response 599 + push to __fconf.refused
   |
   |-- */rest/v1/<table>  (Supabase REST, any origin)
   |      |- STUB row (HEAD count / GET select) ........... -> new Response(stub)
   |      |- GET in PASS list (reads the state needs) ..... -> originalFetch
   |      `- non-GET/HEAD or unknown table ................. -> REFUSE
   |
   `-- everything else (Supabase /auth/v1/*, PostHog, Sentry, Next RSC `_rsc`, static assets)
          ............................................... -> originalFetch   (auth refresh MUST pass)
```

Stub table by mode (the executor arms one mode per leg; all facts below are verified, sections follow):

| Mode | Route | Response |
|------|-------|----------|
| `connect` (FCONF-03a) | `GET /api/strategies/wizard-draft` | 200 `{"draft":null,"kind":null}` + `Cache-Control: private, no-store` |
| `connect` | `POST /api/strategies/create-with-key` | 500 `{"code":"SEAM_INTERNAL_FAULT"}` + `Cache-Control: private, no-store` (no `Retry-After`) |
| `submit` (FCONF-03b) | `POST /api/strategies/finalize-wizard` | armed envelope A/B/C (below), never passthrough |
| `submit` | `POST /api/keys/sync` (only if the mount would kick off) | 200 `{"ok":true,"queued":true}` |
| `amber` (FCONF-02) | `GET /api/strategies/{id}/sync-progress` | 200 `{"jobStatus":"running","stalled":false,"memberProgress":[],"degraded":false}` |
| `amber` | `HEAD /rest/v1/trades?select=id&strategy_id=eq.*` and `HEAD /rest/v1/csv_daily_returns?select=strategy_id&strategy_id=eq.*` | 200, empty body, `Content-Range: */0` |
| `amber` | `GET /rest/v1/strategy_analytics?select=computation_status,computation_error&...` | 200 `[{"computation_status":"complete_with_warnings","computation_error":null}]` |
| `amber` | `GET /rest/v1/strategy_analytics?select=computation_status,computed_at&...` | 200 `[]` |
| `amber` | `POST /api/keys/sync` | 200 `{"ok":true,"queued":true}` |
| all | `DELETE /api/strategies/draft/*`, any `/rest/v1` write, any other non-GET `/api/` | REFUSE |

### Recommended Project Structure
```
.planning/phases/157-founder-confirm-.../
├── 157-STAGING-KIT.js        # IIFE; exports router for the test via `globalThis.__FCONF_TEST__ ? module-less hook`
├── 157-STAGING-KIT.smoke.mjs # node --test: router vs canned Requests (no network)
└── 157-FOUNDER-SCRIPT.md     # one founder step at a time: URL, click, expected
```

### Pattern 1: method-aware fail-closed router
**What:** normalise `input` (string | URL | `Request`) to `{method, url}` before matching; `wizardFetch` calls `fetch(input, {...init, headers})` with a string input and `init.method` (`wizard-correlation.ts:158-165`), supabase-js passes a `Request`-less `(url, init)` pair, and the overlay read passes `(string, {headers})` (`ContributionWizardOverlay.tsx:158-160`). Method comes from `init.method ?? (input instanceof Request ? input.method : "GET")`.
**When to use:** always; it is the only layer that makes "a stub miss can never become a real finalize".
**Example:** (sketch, not a final implementation)
```javascript
// Source: derived from src/lib/wizard/wizard-correlation.ts:158-165 and node_modules/@supabase/supabase-js/dist/index.cjs:257-260
(function install() {
  const orig = window.fetch.bind(window);
  const refused = [];
  function parts(input, init) {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = (init && init.method) || (input instanceof Request ? input.method : "GET");
    return { u, method: method.toUpperCase() };
  }
  window.fetch = async function (input, init) {
    const { u, method } = parts(input, init);
    const isApi = u.origin === location.origin && u.pathname.startsWith("/api/");
    const isRest = u.pathname.startsWith("/rest/v1/");
    if (!isApi && !isRest) return orig(input, init);        // auth, RSC, telemetry, assets
    const hit = route(method, u);                            // table lookup, returns Response or null
    if (hit) return hit;
    if ((method === "GET" || method === "HEAD") && passes(method, u)) return orig(input, init);
    refused.push(method + " " + u.pathname);
    return new Response(JSON.stringify({ code: "FCONF_REFUSED" }), { status: 599 });
  };
})();
```

### Anti-Patterns to Avoid
- **Matching by `window.location` page or by strategy id literals:** ids differ per run and must not be in tracked text; derive ids from the live URL at runtime (`/rest/v1/...?strategy_id=eq.<id>` and `/api/strategies/<id>/sync-progress`) and match `eq.*` / `[^/]+`.
- **Clicking "Start fresh" / "Delete draft" / confirm dialog:** `WizardClient.tsx:1213` issues `DELETE /api/strategies/draft/{id}`; the router refuses it, but the script must still say never click it.
- **Stubbing HEAD count responses with a body:** postgrest-js skips the body for `HEAD` (`index.cjs` `processResponse`: `if (_this2.method !== "HEAD") { ... }`) and reads only `content-range`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deriving the exact failure bodies | New envelope literals | The route's literals at HEAD (quoted below) | Drift between stub and route would stage a state the product cannot produce |
| Expected on-screen copy | Prose from 153.7 | `WIZARD_ERROR_COPY` (`src/lib/wizardErrors.ts:4286, 4314, 3501, 3518`) and the JSX at `SyncPreviewStep.tsx:3339-3355` | CONTEXT decision; the table is the rendered source |
| Count semantics for the amber inputs | Custom count logic | Mirror postgrest-js: `count = parseInt(content-range.split("/")[1])` | Verified in `postgrest-js/dist/index.cjs` (`processResponse`) |
| Detecting whether a stub fired | Console eyeballing | `__fconf.hits` / `__fconf.refused` arrays read back by the executor | Gives the founder script a checkable "stub fired, nothing refused" line |

**Key insight:** the value of this phase is the exactness of the staged inputs; the router is small, and every constant in it must come from a line quoted here.

## Findings by question

### 1. FCONF-03 connect step (verified, with citations)

**Entry.** See Summary finding 1. The overlay is `ContributionWizardOverlay` (`src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx`), mounted by `DashboardChrome.tsx:84-90`; the nav action is `Sidebar.tsx:168-172` (`{ label: "Add a strategy", icon: PlusIcon, action: "add-strategy" }`), allocator-only, and `DashboardChrome` wires `onNavAction={openContribute}` (lines 191, 203, 229, 270, 285).

**Requests from open to submit (fresh wizard).**
1. On open: `fetch("/api/strategies/wizard-draft", { headers: { Accept: "application/json" } })` (`ContributionWizardOverlay.tsx:158-160`). Reads `json?.kind`, `json?.draft`; on `!res.ok` or a throw it degrades to `{draft:null,kind:null}` (lines 161-186), so even a refused read starts fresh. While unsettled it shows `data-testid="overlay-draft-pending"` ("Checking for a saved draft…"). Real route success shape is `{draft:{id,name,description,category_id,strategy_types,subtypes,markets,supported_exchanges,leverage_range,aum,max_capacity,api_key_id,asset_class},kind}`; no-draft shape is `{ draft: null, kind: null }` (`src/app/api/strategies/wizard-draft/route.ts:80-110`).
2. `WizardClient` mounts (`key={source:new:none}`), `step` initialiser returns `"connect_key"` when `initialDraft` is null and `preselectKey` is null (`WizardClient.tsx:257-276`). `MultiKeyConnectStep` renders State A, which delegates to `ConnectKeyStep` (`WizardClient.tsx:1459-1474`). With no `draftStrategyId` the members rehydration effect returns immediately (`MultiKeyConnectStep.tsx:754-756`: `if (!draftStrategyId) return;`), so the step makes **no mount request**.
3. Post-mount: `loadWizardState()` then `deriveWizardResumeOverrides(loaded, "api", null, null)` (`WizardClient.tsx:466-507`). Telemetry (`trackForQuantsEventClient`) goes cross-origin to PostHog (`for-quants-analytics.ts:40-41`, `api_host` default `https://us.i.posthog.com`), so it is outside `/api/` and `/rest/v1/` and passes through.
4. Submit: `wizardFetch("/api/strategies/create-with-key", { method:"POST", signal, headers:{Content-Type:application/json}, body: JSON.stringify({exchange, api_key, api_secret, passphrase, label, wizard_session_id}) })` (`ConnectKeyStep.tsx:1139-1155`).

**`deriveWizardResumeOverrides` with a stale pointer and `initialDraftId = null`** (`src/lib/wizard/localStorage.ts:772-931`): it never touches the server and never changes the step on the API branch. The only step assignment is inside `else if (initialDraftId && loaded.strategyId === initialDraftId) { ... out.step = loaded.step }` (lines 907-924), which cannot run with a null draft id. `showResumeBanner` is set only by `if (initialDraftId && loaded.strategyId !== initialDraftId)` (line 926), also false. The one effect: `unknownMeetsStoredKey` (lines 864-868: `source === "api" && incomingApiKeyId === null && typeof loaded.apiKeyId === "string" && !sameDraftOnScreen`) makes it decline the stored `wizardSessionId`, which logs `console.warn("[wizard] session_id_not_restored: incoming_key_unknown — ...")` and fires a PostHog event (`WizardClient.tsx:527-559`). Harmless, but the console line will appear and the script should tell the founder it is expected. If the pointer lacks a string `apiKeyId`, the session id IS restored (the live draft's own idempotency token); create-with-key is stubbed, so it is never sent.

**Simplest venue form.** `ConnectKeyStep` defaults to Binance: `useState<ExchangeId>(preselectKey?.exchange ?? "binance")` (`ConnectKeyStep.tsx:627-629`). The Binance card has `requiresPassphrase: false` and no `requiresSecret: false` flag (`ConnectKeyStep.tsx:109-114`), so two inputs are needed: API key and API secret. The submit button is `disabled={submitting || !apiKey || (requiresSecret && !apiSecret) || (requiresPassphrase && !passphrase)}` (line 1929); there are **no client-side min lengths or formats** (the only gate is non-empty). Any non-empty placeholder text in both fields passes. Button: `data-testid="wizard-connect-submit"`, label "Validate key and continue" (lines 1927-1935). Heading "Connect your exchange". MT5 and sFOX cards exist only when `MT5_UI_ENABLED` / `SFOX_UI_ENABLED` are on and add fields; do not use them.

**Status and headers for `SEAM_INTERNAL_FAULT`.** The create-with-key catch tail is `const { code, status } = classifyKeyValidationError(err); ... const headers = keyRouteFailureHeaders(err); return NextResponse.json({ code }, { status, headers });` (`create-with-key/route.ts:1909, 1970-1971`). The classifier rows resolving to this code are all status 500: `["MT5_GATEWAY_UNCONFIGURED", { code: "SEAM_INTERNAL_FAULT", status: 500 }]` (`wizardErrors.ts:5144`), `["ADAPTER_INIT_FAILED", { code: "SEAM_INTERNAL_FAULT", status: 500 }]` (5161), `["INTERNAL", { code: "SEAM_INTERNAL_FAULT", status: 500 }]` (5162). `keyRouteFailureHeaders` for a non-`CircuitOpenError` without an integer `retryAfterSeconds > 0` returns `NO_STORE_HEADERS` (`src/lib/api/seam-retry-after.ts:127-141`), and `NO_STORE_HEADERS = { "Cache-Control": "private, no-store" }` (`src/lib/api/headers.ts:13-15`). So the stub is **status 500, body `{"code":"SEAM_INTERNAL_FAULT"}`, one header `Cache-Control: private, no-store`, no `Retry-After`**. Content-Type is `application/json` (what `NextResponse.json` sets); the stub should set it.

**How ConnectKeyStep reads the body.** `readCreateWithKeyBody(res, "credential")` does `res.json().catch(() => PARSE_FAILED)` and returns `{}` on failure (`ConnectKeyStep.tsx:331-346`); then `if (!res.ok || !data.strategy_id || !data.api_key_id)` it calls `recogniseCreateWithKeyCode(data)` (lines 1179-1182), which is translate-first: `recogniseSeamErrorCode(seamErrorCode(data))` and only if that is `"UNKNOWN"` the membership check `KNOWN_CREATE_WITH_KEY_CODES.has(data.code)` (lines 287-294). `SEAM_INTERNAL_FAULT` is "deliberately NOT in" the wire table (`wizardErrors.ts:5141`), so it takes the roster arm; `KNOWN_CREATE_WITH_KEY_CODES` is `new Set([...CLASSIFIER_RETURNED_CODES, ...CREATE_WITH_KEY_OWN_CODES])` (`wizardKeyRosters.ts:149-153`) and `SEAM_INTERNAL_FAULT` is a classifier-returned code (`wizardErrors.ts:6045`, listed with the other classifier codes). A flat `{code}` body is therefore sufficient; no `error` field is needed. `setRetryAfterSeconds(parseRetryAfterSeconds(res.headers))` yields null with no `Retry-After`.

**What renders (`WIZARD_ERROR_COPY.SEAM_INTERNAL_FAULT`, `wizardErrors.ts:4286-4305`).**
- title (`human_message`): `Something failed on our side while we checked this key.`
- cause: `The check stopped on a fault in our own service — not in your key, your exchange or your data. We never store a key we could not check, so no key was stored. We cannot tell you whether a second attempt would get further, so we are not offering one here.`
- fix[0]: `Send the correlation id below through the contact form. A fault in our own service is ours to fix, whether or not it repeats.`
- fix[1]: `Nothing needs undoing on your side. Your key was not stored.`
- `docsHref: "/security"`, `actions: ["request_call", "expand_log"]` -> `recoverable: false` -> **no Retry button** (`ErrorEnvelope.tsx:145`: `const showRetry = envelope.recoverable && Boolean(onRetry)`).
- DOM: `[data-testid="error-envelope"][data-error-code="SEAM_INTERNAL_FAULT"]`, a collapsed `Diagnostics` `<details>` with `code: SEAM_INTERNAL_FAULT` and a `correlation_id:` of the form `wizard:<uuid>` (the id `wizardFetch` put on `X-Correlation-Id`).
- Correspondence to the 153.7 words: "request_call" -> the "contact form" link inside fix[0]; "expand_log" -> the `Diagnostics` disclosure. There is no separate button for either (Summary finding 2).
`buildEnvelope` may filter `fix` lines through a venue-capability filter (`fixRequires`); these four entries carry plain strings, but compare the screen by substring, not by exact equality of the whole card.

### 2. FCONF-03 submit step

**Path from resume to Submit.** Resume (or silent resume in the same tab) sets `step = "sync_preview"` (`draftResumeStep`, `WizardClient.tsx:254-255, 1262`). `SyncPreviewStep` must reach `phase === "passed"` and call `onComplete` so `syncSnapshot` is non-null; `metadata` renders only `step === "metadata" && strategyId && syncSnapshot` and `submit` only with `syncSnapshot && metadataDraft` (`WizardClient.tsx:1569, 1629`). Buttons: `wizard-use-this-key` ("Use this key and continue", `SyncPreviewStep.tsx:3047/3126`), Metadata form, Review "continue", then `wizard-submit-for-review` ("Add to Strategies" in the overlay/contribution context, "Submit for review" in the manager context, `SubmitStep.tsx:862-877`).

**Requests on the way (exhaustive grep, this session).**

| Step | Request | Kind | Kit action |
|------|---------|------|-----------|
| sync_preview mount | `GET /rest/v1/strategy_analytics?select=computation_status,computed_at&strategy_id=eq.<id>` (maybeSingle, `SyncPreviewStep.tsx:906-911`) | read | pass |
| sync_preview mount (if stale/none) | `GET /rest/v1/strategies?select=api_key_id&id=eq.<id>` then `GET /api/strategies/<id>/sync-progress` (`:818-835`) | read | pass |
| sync_preview mount (if none in flight) | `POST /api/keys/sync` body `{"strategy_id":"<id>"}` (`:1055-1063`) | **WRITE (enqueues a sync)** | stub `{"ok":true,"queued":true}` |
| waiting poll | `GET /rest/v1/strategy_analytics?select=computation_status,computation_error&strategy_id=eq.<id>` (`useStrategySyncPoller.ts:289-290`) + `GET /api/strategies/<id>/sync-progress` (`SyncPreviewStep.tsx:1347`) | read | pass |
| passed phase | `GET /api/keys/<apiKeyId>/permissions` (`KeyPermissionBadge.tsx:139-142`, `cache: "no-store"`) | read (route file has no insert/update/upsert/rpc by grep, `permissions/route.ts`); probes the venue | pass (do not fake a security verdict) |
| Metadata mount | `GET /rest/v1/discovery_categories?select=id,name&order=sort_order` (`MetadataStep.tsx:628-633`) | read | pass |
| Metadata / Review / "Use this key" | none (state + `localStorage` only) | — | — |
| Submit click | `POST /api/strategies/finalize-wizard` | **WRITE (publishes)** | ALWAYS stub |
| Start fresh / Delete draft (confirmed) | `DELETE /api/strategies/draft/<id>` (`WizardClient.tsx:1213`) | **WRITE (destroys)** | REFUSE |

So the FCONF-03 submit leg has **no pass-through write**; the only candidate is the kickoff POST, which is stubbed.

**Request the client sends on Submit** (`SubmitStep.tsx:265-300`): `POST /api/strategies/finalize-wizard`, `Content-Type: application/json`, body `{strategy_id, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, asset_class, entry_context, [capital_ownership]}` (the stub needs none of it).

**Exact finalize envelopes (route literals at HEAD).**
- `DRAFT_LOOKUP_FAILED`: `NextResponse.json({ code: "DRAFT_LOOKUP_FAILED", error: "Could not load draft" }, { status: 500, headers: NO_STORE_HEADERS })` (`finalize-wizard/route.ts:1150-1153`).
- `DRAFT_FINALIZE_FAILED`: `{ code: "DRAFT_FINALIZE_FAILED", error: "Could not finalize wizard draft" }`, `{ status: 500, headers: NO_STORE_HEADERS }` (`:2022-2025`).
- `SEAM_RESPONSE_UNREADABLE`: `{ code: "SEAM_RESPONSE_UNREADABLE", error: "Upstream service returned unexpected response" }`, `{ status: 502, headers: NO_STORE_HEADERS }` (`:2882-2888`).
All three: header `Cache-Control: private, no-store`, no `Retry-After`.

**How SubmitStep reads them.** `res.json().catch(() => ({}))`; on `!res.ok` it computes `wireCode = seamErrorCode(data)`, `translated = recogniseSeamErrorCode(wireCode)` and, when translated is `"UNKNOWN"`, accepts `wireCode` if it is in `KNOWN_FINALIZE_CODES` (`SubmitStep.tsx:346, 569-577`); the three codes are listed in that set (`:511-513`). None of the three has a row in the wire table (grep of `wizardErrors.ts` found them only in the union type, the copy table and comments), so they take the roster arm, as `SEAM_INTERNAL_FAULT` does on the connect step. The envelope is `WizardErrorEnvelope envelope={errorEnvelope} contactDraftId={strategyId} onRetry={() => setErrorCode(null)}` (`SubmitStep.tsx:825-831`).

**Expected copy and controls (from `WIZARD_ERROR_COPY`).**
| Code | Title | Retry? | Notes (read at HEAD) |
|------|-------|--------|----------------------|
| `DRAFT_LOOKUP_FAILED` (`:3501`) | `We could not read this draft.` | **Yes** (`actions: ["clear_and_retry","request_call"]`) | cause: `A read of your draft failed on our side before anything else ran. Nothing was submitted and nothing was changed — the fault is in our database, not in your key, your exchange or your data. Reads like this usually succeed on the next attempt.` |
| `DRAFT_FINALIZE_FAILED` (`:3518`) | `We could not finish submitting this strategy.` | **Yes** (`["clear_and_retry","request_call"]`, `:3541`) | cause must NOT say nothing was saved: `The last write failed, and the database's answer was not one we have a specific reply for. We cannot confirm from here whether anything was recorded, so we are not going to claim either way. The fault is on our side, not in your key or your exchange.` |
| `SEAM_RESPONSE_UNREADABLE` (`:4314`) | `We could not read the service's answer to your submission.` | **No** (`["leave_and_return","request_call","expand_log"]`, `:4334`) | claims neither outcome; fix[0] `Open your strategies list first. If the submission went through, the strategy is there with its review status.` |
The Retry on the first two only clears the envelope (`onRetry={() => setErrorCode(null)}`): it does not re-send, so the founder must click Submit again, and the kit must be re-armed (or auto-advance through a configured sequence) between clicks. `leave_and_return` has no rendered control either (grep of `src/**/*.tsx` finds the strings `request_call`/`expand_log` only in a comment); the "open your strategies list" step is fix text.

### 3. FCONF-02 amber block

**What SyncPreviewStep requests on resume onto `sync_preview`** (single-key arm; `SyncPreviewStep.tsx` lines as cited):
1. `strategy_analytics` `select=computation_status,computed_at` (maybeSingle). If complete AND `computed_at` within `SYNC_FRESHNESS_WINDOW_MS = 5 * 60 * 1000` (`:98`) it goes straight to `waiting_for_complete` (no POST); a composite flag (second read `data_quality_flags`) also skips the POST (`:913-952`).
2. Otherwise `probeExistingChain` (first mount, `kickoffNonce === 0`): `GET strategies?select=api_key_id`, and if `api_key_id` is a string, `GET /api/strategies/<id>/sync-progress`; `jobStatus` in flight or `otherJobInFlight === true` -> `"in_flight"` -> `waiting_for_complete` **without any POST**; both reads have a 5 s timeout (`MOUNT_PROBE_TIMEOUT_MS = 5_000`, `:184`). A missing/unreadable answer returns `"none"`.
3. Only on `"none"`: `POST /api/keys/sync` `{strategy_id}`; the client reads only `composite` and `queued` from a 2xx body (`:1139-1150`). Failures are mapped to `gate_failed`.
4. Poll (ladder `POLL_BACKOFF_MS = [3000, 3000, 5000, 5000, 10_000]`, then held, `:197`, `useStrategySyncPoller.ts:257-277`): `GET strategy_analytics?select=computation_status,computation_error&strategy_id=eq.<id>`, and per poll `GET /api/strategies/<id>/sync-progress` (`:1347`; requires `memberProgress` to be an array or the body is ignored, `:1349-1353`).
5. On a terminal status (`complete` or `complete_with_warnings` per `isComputedAnalytics`, `closed-sets.ts:808-812`) the heavy arm runs. **Single-key arm** reads eight things in one `Promise.all` (`:1907-1984`): `strategy_analytics` (cagr..series_completeness), `trades` HEAD count (`select=id`, `count: "exact", head: true`), `trades` GET earliest/latest `timestamp`, `trades` GET `symbol` (`neq.PORTFOLIO`, `limit=50`), `csv_daily_returns` HEAD count (`select=strategy_id`), `api_keys?select=exchange`, `strategies?select=asset_class`. `seriesMayBeMidReDerive = tradeCount === 0 && csvRowCount === 0 && !jobsHaveFinished(syncProgressRef.current?.jobStatus ?? null)` (`:2157-2160`) -> `setSeriesRecomputing(true)` and `return "repoll"` (`:2161-2166`). **Composite arm** (when the draft is composite, `dq.composite === true`): reads `strategy_analytics`, `strategy_keys?select=api_key_id,window_start,window_end,seq,api_keys(exchange,label)&order=seq.asc`, a paged `csv_daily_returns?select=id,date,daily_return&...&order=id.asc&limit=N` drain and `strategies`; `series.length === 0` -> `setSeriesRecomputing(true)`, `"repoll"` (`:1636-1639`). Which arm the live draft is on is not recorded in tracked text (A4); the kit should stub both the HEAD counts and the empty `csv_daily_returns` GET so either arm lands in the amber state.

**`showRecomputing`** (`:3194-3195`): `seriesRecomputing && isJobInFlight(syncProgress?.jobStatus ?? null)`; `isJobInFlight` is `jobStatus !== null && !FINISHED_JOB_STATUSES.includes(jobStatus)` with `FINISHED_JOB_STATUSES = ["done","failed_final"]` (`:284-291`), so `"running"` qualifies. The block (`:3339-3355`): `data-testid="wizard-sync-recomputing"`, `role="status"`, classes `border-warning/40 bg-warning/5`; heading text `Recomputing this strategy's analytics`; body `The previous result is out of date and is being recalculated. This screen updates when it finishes — your draft is saved.` The h2 above it (`id="wizard-sync-heading"`) reads `Computing your verified factsheet` (single-key) or `Stitching your composite track record` (composite).

**Oracle mapping (AMBER case, `SyncPreviewStep.stale-refusal.runtime.test.tsx:662-707`, helpers `installClient`/`installFetchMock` at ~`:229-400`).** The test mocks, in `installClient(0, ...)`: `strategy_analytics` + `"computation_status, computed_at"` -> null row; `"computation_status, computation_error"` -> `{computation_status:"complete_with_warnings",computation_error:null}`; `"data_quality_flags"` -> `{data_quality_flags:null}`; any other `strategy_analytics` select -> a heavy row with null metrics; `trades` `"id"` -> count 0, `"timestamp"` -> `[]`, `"symbol"` -> `[]`; `csv_daily_returns` `"strategy_id"` -> count 0, other -> `[]`; `api_keys` -> `{exchange:"mt5"}`; `strategies` -> `{returns_denominator_config:null}`; and `fetch` mocked so `/sync-progress` returns `{jobStatus:"running", stalled:false, memberProgress:[], degraded:false}` and every other URL `{ok:true, composite:false}`. PostgREST equivalents (postgrest-js 2.118.0: `select` strips whitespace, `head: true` -> method `HEAD`, `count` -> `Prefer: count=exact`, `maybeSingle()` keeps `Accept` JSON and reads an **array** body: `[]` -> `data: null`, one element -> object; `count = parseInt(content-range.split("/")[1])`, `index.cjs` `processResponse` + `select`):

| Test answer | HTTP request the real client makes | Stub response |
|-------------|------------------------------------|---------------|
| `okCount(0)` on `trades` `id` | `HEAD /rest/v1/trades?select=id&strategy_id=eq.<id>`, `Prefer: count=exact` | `200`, no body, `Content-Range: */0` |
| `okCount(0)` on `csv_daily_returns` `strategy_id` | `HEAD /rest/v1/csv_daily_returns?select=strategy_id&strategy_id=eq.<id>`, `Prefer: count=exact` | `200`, no body, `Content-Range: */0` |
| `okRow(null)` on `computation_status, computed_at` | `GET /rest/v1/strategy_analytics?select=computation_status,computed_at&strategy_id=eq.<id>` | `200` `[]` |
| terminal row on `computation_status, computation_error` | `GET .../strategy_analytics?select=computation_status,computation_error&strategy_id=eq.<id>` | `200` `[{"computation_status":"complete_with_warnings","computation_error":null}]` |
| `okList([])` on `trades` `timestamp` / `symbol` | `GET /rest/v1/trades?select=timestamp&...&order=timestamp.asc|desc&limit=1`, `GET .../trades?select=symbol&...&symbol=neq.PORTFOLIO&limit=50` | `200` `[]` (or pass through: the arm repolls before using them) |
| `okList([])` on `csv_daily_returns` other select | `GET /rest/v1/csv_daily_returns?select=id,date,daily_return&...` | `200` `[]` |
| `/sync-progress` mock | `GET /api/strategies/<id>/sync-progress` | `200` `{"jobStatus":"running","stalled":false,"memberProgress":[],"degraded":false}` |
| kickoff mock | `POST /api/keys/sync` | `200` `{"ok":true,"queued":true}` |
Other reads (`api_keys`, `strategies`, the analytics heavy row) may pass through; they cannot change the outcome while the counts are 0 and the job is in flight. Unstubbed pass-through reads are PROD reads of the founder's own rows only.

**Timing / how long the amber block stays up.** With sync-progress continuously answering `running` the in-flight evidence refreshes every poll, so none of the interrupted-banner conditions fires: `stallBackstop` needs `!inFlightEvidence && statusFrozenMs >= RETRY_THRESHOLD_MS (900_000)`; `settledPastGrace` needs `notInFlightSince` set (`SETTLED_WITHOUT_COMPLETE_GRACE_MS = 60_000`); `IN_FLIGHT_EVIDENCE_TTL_MS = 60_000` (`:132, 143, 151`; 1 s tick `:1217-1243`). The remaining exit is `inFlightTrustExpired`: in-flight evidence present AND the status unchanged for `IN_FLIGHT_TRUST_CEILING_MS = 3_600_000` (`:170, 1233-1237`), so **about one hour**, far longer than an observation. The failure mode to guard against is the kit going quiet: if sync-progress stops being answered `running` (a refusal, or a reload), the screen falls to the interrupted banner after the 60 s grace, which is exactly the state the founder must not mistake for the amber one. `showInterruptedBanner` also includes `syncProgress?.stalled === true`, so the stub's `stalled:false` is load-bearing. The elapsed counter keeps running; "no metric numbers" holds because no metrics render in this phase (the oracle's `NUMBERS` case).

### 4. Interception claim (verified) and RSC/server actions

- `wizardFetch` resolves the global at call time: `return fetch(input, { ...init, headers });` (`wizard-correlation.ts:164`).
- Overlay draft read: bare `await fetch("/api/strategies/wizard-draft", ...)` (`ContributionWizardOverlay.tsx:158`). `KeyPermissionBadge` also uses bare `fetch` (`:139`).
- `src/lib/supabase/client.ts` is `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)` with no options; `grep fetch @supabase/ssr/dist/main/createBrowserClient.js` returns nothing (read from the main checkout's `node_modules`, read-only).
- supabase-js `resolveFetch`: `if (customFetch) return (...args) => customFetch(...args); return (...args) => fetch(...args);` (`@supabase/supabase-js/dist/index.cjs:257-260`) and `const fetch$1 = resolveFetch(customFetch)` at `:287`. The lazy arrow reads `globalThis.fetch` at each call, so a wrapper assigned after page load is seen. Auth refresh (`POST /auth/v1/token?grant_type=refresh_token`) and `GET /auth/v1/user` also go through this fetch, are outside `/api/` and `/rest/v1/`, and so pass through the router untouched. **The fail-closed rule must never extend to `/auth/v1/`.**
- No Next server actions: `grep -rln "use server" src` returns only `src/lib/seam-ssr-exposure.pin.test.ts` (a test). All wizard routes are plain route handlers. The strategies page route (`wizard/page.tsx`) reads the draft with the server Supabase client during RSC render (`readLatestWizardDraft(supabase, user.id)`, line 97), which no browser wrapper can see; RSC navigations issue `?_rsc=` fetches that the router passes through (unmatched, and not under `/api/`). `[ASSUMED]` (A5): Next's own client `fetch` call sites read the global at call time; the pass-through default makes this irrelevant for correctness.
- PostHog is cross-origin (`api_host` default `https://us.i.posthog.com`); Sentry/other telemetry is likewise cross-origin or outside `/api/`.
- `next.config` rewrites only `/security.txt` (`next.config.*:269-276`); no `/api` proxy.

### 5. FCONF-01

- UI path: from any dashboard page the nav action `Add a strategy` (allocator workspace) opens the overlay; from `/strategies` the manager's `Add a strategy` Link goes to `/strategies/new/wizard`. Both mount `WizardClient` with the live draft (overlay: via the wizard-draft read, `offeredRead`, `ContributionWizardOverlay.tsx:210-218`; page: `initialDraft` from the RSC read).
- Banner visibility: `showResumeBanner` is set when `loadWizardState()` returns null (no pointer or an unverifiable one) and a draft exists (`localStorage.ts:788`: `if (!loaded) return initialDraftId ? { showResumeBanner: true } : {};`), or when the pointer names a different draft (`:926`). While a choice is pending the step is held: `stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner)` (`WizardClient.tsx:300`), so the banner is the only content.
- **A private window is not required for the banner; any new tab suffices.** The pointer's HMAC key is a per-tab `sessionStorage` nonce and "A cross-tab replay ... verifies false because the new tab has a fresh sessionStorage nonce" (`localStorage.ts:21-27`). The 2026-11-19 silent resume happened in the same tab that saved the pointer. The founder's private-window step is still fine (and is the strongest reading), but a new normal tab is sufficient and keeps the founder signed in.
- Text (`WizardClient.tsx:1412-1438`): `We saved your progress.` then `resumeBannerBody({source:"api", secretKind, resumeStep: "sync_preview"})` = `A draft from an earlier session is ready.` (`resume-banner.ts:20, 43-52`: the secret-re-entry sentence appears only when `resumeStep === "connect_key"`); for a CSV draft `A CSV upload draft from an earlier session is ready. Re-select the file and continue.` Buttons: `Resume draft` (`data-testid="wizard-resume"`) and `Start fresh` (`data-testid="wizard-start-fresh"`, which opens the delete confirm; never click).
- Resume lands on `draftResumeStep = draftKind === "csv" ? "csv_upload" : "sync_preview"` (`WizardClient.tsx:254-255`; `handleResume` `:1254-1288`). For the founder's API draft that is `sync_preview` (heading "Computing your verified factsheet" while it works, or the factsheet preview with "Use this key and continue" if passed).
- ⚠️ **Resume mounts `SyncPreviewStep`, which can POST `/api/keys/sync` for real** when the analytics row is not complete-and-fresh (<5 min) and no job is in flight (Findings 3, steps 1-3). The 2026-11-19 draft's analytics are certainly older than 5 minutes, so an un-staged Resume in a private window will very likely enqueue a real sync for the founder's own draft (a product-path write on the founder's own data, and the very recompute that produces a real amber window). It deletes nothing. The script must state this; alternatively run the FCONF-01 banner leg in a **normal new tab with the kit armed in `amber` mode** (the kit cannot be injected into a private window by the claude-in-chrome path, A6), which also yields the FCONF-02 observation in the same click path.

### 6. FCONF-04

- `UpdateMt5SecretDialog` (`src/components/strategy/UpdateMt5SecretDialog.tsx`) is mounted from `AllocatorExchangeManager.tsx:2272-2276` and opened by the per-key `Update password` buttons (`:1864, 1978`); it `PATCH`es `/api/keys/${apiKeyId}/rotate-secret` with only `new_secret` (`:111`), and calls `onUpdated()` (a `router.refresh()`) on success (`:151`, `:2276`).
- **Live validation: yes.** The route's step 8 is the Python seam call that "decrypts the stored row, re-validates the NEW password against the live broker, re-encrypts on success. NEVER retried" (`rotate-secret/route.ts` header, step 8); a failed validation "mutates nothing". So the broker password must already be changed before the dialog is used, and one key's failure leaves the others untouched.
- **No sync is enqueued.** On success the admin write sets `sync_error: null, sync_status: "idle"` (`:122-127`, `:523, 536-537`), and the "Known limits" block says "no recompose is enqueued" (`:514`). A key that the worker had set to `'revoked'` or `'error'` (never written back by the worker) is returned to `idle` here, which is what makes it eligible again (`enqueue_derive_broker_dailies_for_allocator_keys` filters `sync_status IS DISTINCT FROM 'revoked'`, `baseline.sql:5077`).
- **Gate-1 evidence columns.** `api_keys.last_sync_at` (timestamptz), `api_keys.sync_status` (text, default `'idle'`), `api_keys.sync_error` (`supabase/schema/baseline.sql:12995-13001`). Values seen in the repo: `'idle' | 'syncing' | 'computing' | 'complete' | 'complete_with_warnings' | 'error'` (migration `20260406065011_security_hardening.sql:66`; `'revoked'` is written by the worker per the route comment; the CHECK may have moved since, so the agent must not assume this list is closed). Gate-1 text requires `complete`; a `complete_with_warnings` reading is not `complete` and needs a founder judgement (Open Question 2).
- **Triggering the post-rotation sync.** (a) the scheduled derive: the 2026-11-13 and 2026-11-22 baselines show `last_sync_at` at 01:02-01:10 UTC (`ROADMAP.md:80-82`; CONTEXT specifics), and the 155.1 runbook names a derive window of 00:30-07:30 UTC; (b) `Sync now` on `/profile` -> `POST /api/allocator/holdings/sync {api_key_id}` -> RPC `request_allocator_holdings_sync`, which enqueues a `poll_allocator_positions` job and sets `api_keys.sync_status='syncing'` (`src/app/api/allocator/holdings/sync/route.ts:13-25`, RPC call `:99`; client button `AllocatorExchangeManager.tsx:1388`). Whether that job path ends an MT5 key in `complete` (versus the derive job) is not established by code read here: `[ASSUMED]` A1. The safe reading is therefore the **first scheduled derive after the rotation** (`last_sync_at` > rotation time and `sync_status='complete'`), with Sync now as an optional faster attempt whose result is read, not presumed.
- Rotation ordering/timing hazard: between the broker password change and the last `rotate-secret` for a key, any sync of that key fails auth and may set it `revoked`/`error`; `rotate-secret` resets it to `idle`, but a derive cron tick in that gap is wasted. Do the rotation outside the 00:30-07:30 UTC window and, for MT5, not while a `mt5` `compute_jobs` row is `running` (the shared terminal switches account, `155.1-SPIKE-RUNBOOK.md:14-17`).
- **Where else the spike password lives.** `grep -rln "MT5_SPIKE_" .github` -> no output (no workflow). Tracked hits are only `analytics-service/scripts/mt5_spike.py`, `analytics-service/scripts/mt5_soak.py`, `analytics-service/docs/mt5-spike-gonogo.md`, `docs/runbooks/mt5-go-live.md:873` (prose "Set the `MT5_SPIKE_*` credential env"), analytics tests with dummy values, `.planning` prose, and the runbook's `read -rs -p "investor password: " MT5_SPIKE_INVESTOR_PASSWORD` (`155.1-SPIKE-RUNBOOK.md:28, 86`), which never stores it. No `railway.*`/`nixpacks`/`Dockerfile` hit. Railway service variables are not visible from the repo; the pre-rotation agent step must read them through the Railway MCP (names only, never values) and report any `MT5_SPIKE_*` it finds. The soak script reads the same names, so a Railway-held copy would also need rotating (Open Question 3).

## Common Pitfalls

### Pitfall 1: a stub miss becomes a real write
**What goes wrong:** the first `POST /api/keys/sync` on a resumed stale draft, or the first finalize, goes to PROD. **Why:** `SyncPreviewStep` kicks off on mount when analytics are stale and nothing is in flight. **How to avoid:** method-aware router refuses all non-GET/HEAD on `/api/` and `/rest/v1/` except stubs; arm the mode BEFORE the wizard resumes (install the kit first, then trigger the open). **Warning signs:** `__fconf.refused` non-empty, marker missing.

### Pitfall 2: installing after the resume already fired
**What goes wrong:** the kit is injected after `SyncPreviewStep` mounted, so the kickoff already went out. **How to avoid:** the script order is: open `/strategies` (or any dashboard page) -> inject kit with the mode armed -> click the entry. The overlay re-reads the draft on every open and `SyncPreviewStep` mounts only after Resume/entry, so the wrapper is in place first.

### Pitfall 3: amber state collapses into the interrupted banner
**What goes wrong:** after a reload or a refused sync-progress, the 60 s grace expires and the amber block is replaced. **How to avoid:** keep sync-progress stubbed continuously; read the screen within the first minute; the kit's marker states the mode.

### Pitfall 4: Retry on the DRAFT_* envelopes does not re-send
**What goes wrong:** the founder clicks Retry expecting a second envelope. **Why:** `onRetry={() => setErrorCode(null)}` only clears. **How to avoid:** script tells the founder to click Submit again; the kit advances an armed sequence (`__fconf.arm("DRAFT_LOOKUP_FAILED")` etc.) per finalize call.

### Pitfall 5: the amber needs `memberProgress` to be an array
**What goes wrong:** a sync-progress stub without `memberProgress: []` is ignored (`SyncPreviewStep.tsx:1349-1353`) so `jobStatus` is never recorded and the amber block never shows. **How to avoid:** use the full body in the table.

### Pitfall 6: HEAD count stub with a JSON body, or a `Content-Range` that does not parse
**What goes wrong:** `count` stays null and the arm throws "returned no count" (`SyncPreviewStep.tsx:2068-2076`), showing the red `SYNC_FAILED`. **How to avoid:** `Content-Range: */0`, status 200, null body.

### Pitfall 7: wrong entry point for the founder's role
**What goes wrong:** `Add a strategy` on `/strategies` navigates to the page route (no overlay), so the connect-step stub (`wizard-draft` -> none) does nothing. **How to avoid:** the script's first check is which control exists (sidebar vs header); see Summary finding 1 for the fallback.

### Pitfall 8: expected-copy mismatch read as a regression
**What goes wrong:** the founder looks for `request_call`/`expand_log` buttons. **How to avoid:** the script lists what is on screen (contact-form link in the fix text, Diagnostics disclosure) and states the 153.7 wording mismatch.

## Code Examples

### Route literals to mirror (all read at HEAD)
```ts
// Source: src/app/api/strategies/create-with-key/route.ts:1970-1971
const headers = keyRouteFailureHeaders(err);
return NextResponse.json({ code }, { status, headers });
// Source: src/app/api/strategies/finalize-wizard/route.ts:1150-1153, 2022-2025, 2882-2888
{ code: "DRAFT_LOOKUP_FAILED", error: "Could not load draft" }                 // 500
{ code: "DRAFT_FINALIZE_FAILED", error: "Could not finalize wizard draft" }    // 500
{ code: "SEAM_RESPONSE_UNREADABLE", error: "Upstream service returned unexpected response" } // 502
// all with headers: { "Cache-Control": "private, no-store" }   (src/lib/api/headers.ts:13-15)
```

### HEAD count stub
```javascript
// Source: node_modules/@supabase/postgrest-js/dist/index.cjs processResponse (count from content-range after "/")
new Response(null, { status: 200, headers: { "Content-Range": "*/0" } });
```

## Runtime State Inventory

Not a rename/refactor/migration phase; omitted. (FCONF-04 is a credential rotation; its stored-state inventory is in Findings 6: `api_keys` ciphertext, `sync_status`, `last_sync_at`; no Railway-held copy proven or disproven.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "+ Strategy" header button | Sidebar/nav action `Add a strategy` (allocator) and `Add a strategy` Link to `/strategies/new/wizard` (manager) | Phases 110, 199, 200 (comments in `Sidebar.tsx`, `strategies/page.tsx:1356`) | FCONF-01/03 entry text in CONTEXT/ROADMAP is stale |
| Per-page-load correlation id | Fresh `wizard:<uuid>` per `wizardFetch` call | 164.6.5-07 / D-14 | Diagnostics shows a different id per attempt; not a bug |

**Deprecated/outdated:** the 153.7 expectation of discrete `request_call`/`expand_log` controls.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Sync now` (`poll_allocator_positions`) or the next derive ends an MT5 key in `sync_status='complete'` (not `complete_with_warnings`) | FCONF-04 | Gate-1 re-check could read a different terminal value and need a founder judgement; plan must read, not presume |
| A2 | The founder's account has the allocator workspace (sidebar `Add a strategy`) | Summary / Pitfall 7 | If manager-only, the connect leg needs the page-route fallback ("Try another key") and the extra members GET |
| A3 | The 153.7 "controls" wording is imprecise, not a regression (no component renders `request_call`/`expand_log`) | Findings 1 | If the founder reads it as missing UI, a finding must be booked; script must show the actual elements |
| A4 | The live draft is a single-key (non-composite) draft | FCONF-02 | Composite arm needs the `csv_daily_returns` GET stub; the kit stubs both, so risk is only a missed oracle row |
| A5 | Next.js client code reads global `fetch` at call time | Finding 4 | Irrelevant to correctness (pass-through default) |
| A6 | The claude-in-chrome injection path cannot reach a private window | FCONF-01 | If it can, the private-window leg can be staged too |
| A7 | PostgREST answers an empty exact-count HEAD with `200` and `Content-Range: */0` | FCONF-02 | Only the stub's realism; postgrest-js needs `res.ok` and the `/`-split, both satisfied |

## Open Questions

1. **Founder role / entry control.** What we know: overlay only via sidebar `Add a strategy` (allocator) or "Finish setup"/empty state. Unclear: which the founder's account shows. Recommendation: first script step is "which control do you see"; keep the page-route fallback in the kit and script.
2. **Gate-1 terminal value.** What we know: gate text says `complete`; code also writes `complete_with_warnings`. Recommendation: the Plan 03 read reports the exact value; treat anything but `complete` as a founder call, not a silent pass.
3. **Railway-held spike copy.** The repo shows none; Railway variable names are unreadable from here. Recommendation: Plan 03's pre-read lists `MT5_SPIKE_*` names via Railway MCP (names only) and the founder decides whether any must be rotated or deleted.
4. **Real analytics on the submit leg.** Passing the live draft's real analytics through to "passed" assumes `checkStrategyGate` passes on it (a red gate would stop the walk to Submit). Unverifiable without PROD data; the script needs a "gate red -> record and stop" branch.
5. **FCONF-01 write side effect.** Whether the founder prefers the staged normal-tab banner leg (no real sync) or the private-window leg (likely real sync). Recommendation: offer the staged leg as primary, the private-window leg as the stricter optional reading.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | kit syntax check, smoke test | yes | v25.8.1 | — |
| claude-in-chrome `javascript_tool` | kit injection (preferred) | not probed (deferred tool, needs the founder's tab) | — | founder pastes the kit in DevTools (`allow pasting`) |
| Supabase MCP (PROD read) | gate-1 reads, `venue_account_id` set | MCP server listed in session; not exercised in research | — | CLI one query per call |
| Railway MCP | `MT5_SPIKE_*` name check | MCP server listed; not exercised | — | `railway variables` CLI |
| `node_modules` in the worktree | none needed (kit has no imports) | no | — | read-only from the main checkout |
| jsdom | not needed (router test uses Node's global Fetch classes) | n/a | — | — |

**Missing with no fallback:** none for Plan 01.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` + `node:assert` (no install; Node v25.8.1). The repo's vitest/jsdom suite is NOT touched (CONTEXT: no render tests, no product code). |
| Config file | none. The kit file lives under `.planning/`, which `eslint src/` and `tsc` do not scan (`package.json` `lint` script targets `src/` plus four `scripts/*` checkers; `vitest.config.ts` has no `.planning` include) |
| Quick run command | `node --check .planning/phases/157-*/157-STAGING-KIT.js && node --test .planning/phases/157-*/157-STAGING-KIT.smoke.mjs` |
| Full suite command | same, plus the greps below |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FCONF-03 | create-with-key stub is status 500, body exactly `{"code":"SEAM_INTERNAL_FAULT"}`, header `cache-control: private, no-store`, no `retry-after` | node smoke | `node --test ...smoke.mjs` (case: router vs `new Request(.../api/strategies/create-with-key, {method:"POST"})`) | Wave 0 |
| FCONF-03 | each finalize envelope has the exact status (500/500/502) and body | node smoke | same | Wave 0 |
| FCONF-02 | HEAD trades/csv counts parse to 0 via the postgrest-js rule (`parseInt(cr.split("/")[1])`), sync-progress body has `memberProgress` as an array | node smoke | same | Wave 0 |
| all | fail-closed: `DELETE /api/strategies/draft/<x>`, `POST /rest/v1/...`, unknown `PATCH /api/...` are refused (599) and recorded; `/auth/v1/token` POST and cross-origin telemetry pass to the original fetch | node smoke (spy on injected `orig`) | same | Wave 0 |
| all | method normalisation: `Request` input vs `(string, init)` vs `URL` give the same decision | node smoke | same | Wave 0 |
| all | marker element text equals "STAGED RESPONSES ACTIVE — FCONF-0x" for the armed mode | node smoke with a minimal fake `document` | same | Wave 0 |
| (hygiene) | no ids/logins/servers/amounts in tracked text | grep | `! grep -nE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|@[A-Za-z0-9.-]+\.[a-z]{2,}\|[0-9]{7,}' .planning/phases/157-*/157-STAGING-KIT.js .planning/phases/157-*/157-FOUNDER-SCRIPT.md` (patterns are illustrative; the executor tunes them and records the pattern set) | Wave 0 |
| (hygiene) | route literals in the kit equal the route source | grep | `grep -c 'Could not load draft' ...kit && grep -c 'Could not load draft' src/app/api/strategies/finalize-wizard/route.ts` (and the other two strings, and `private, no-store`) | Wave 0 |
| (hygiene) | founder script contains no CHANGELOG-skip token and no `[skip ci]`-class text | grep | per `CLAUDE.md` CI-gate rule (do not write the token in any commit message either) | Wave 0 |

The kit must be structured so the test can import its router: the file is an IIFE for the console but exposes `globalThis.__FCONF_ROUTER__` when `globalThis.__FCONF_TEST__ === true`, and the smoke test sets that flag, installs a fake `window`/`document`/`location`, and calls the router with canned Requests. This tests the same code the founder runs, not a copy.

### Sampling Rate
- **Per task commit:** `node --check` + `node --test` on the kit (under 5 s).
- **Per wave merge:** the same, plus hygiene greps.
- **Phase gate:** Plan 01 green; Plan 02/03 are founder checkpoints, so the phase verification ends `human_needed` (CONTEXT).

### Wave 0 Gaps
- [ ] `157-STAGING-KIT.js` and `157-STAGING-KIT.smoke.mjs` (new)
- [ ] `157-FOUNDER-SCRIPT.md` (new, one step at a time: URL, click, expected text from the tables above)
- No framework install needed.

*Not testable by the agent (stays founder-only):* that the deployed bundle's global `fetch` is in fact the wrapper (CONTEXT rules out a rehearsal in the founder's Chrome); the script's first founder step ("marker visible; run `__fconf.mode`") is the in-situ check and the live refusal log is read back after each leg.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (the `grep security` returned nothing), so it applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (kit runs inside a signed-in session; FCONF-04 touches broker credentials) | Never enter or log credentials; the kit must not read cookies, tokens or request bodies; `/auth/v1/*` passes untouched |
| V3 Session Management | yes | Kit never stores tokens; reload drops it |
| V4 Access Control | yes | Kit adds no capability beyond the founder's own session; refusing writes only narrows it |
| V5 Input Validation | limited | Router normalises `input`; no `eval`, no `innerHTML` with request data (marker text is a constant) |
| V6 Cryptography | no | none hand-rolled; rotation uses the product's seam |

### Known Threat Patterns for a browser fetch wrapper
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stub miss lets a destructive request reach PROD | Tampering | Method-aware fail-closed router; stubs for finalize/kickoff; refuse `DELETE /api/strategies/draft/*` and every `/rest/v1` write |
| Credential or id leaks into tracked text/logs | Information disclosure | Match by path pattern only, ids from runtime URL; `__fconf.refused` records `METHOD path` with ids replaced by `:id`; grep gate on tracked files |
| Kit left active and mistaken for real state | Repudiation / spoofing | Fixed visible marker; reload clears; script: "no marker, do not click" |
| Stubbed security verdict presented as real | Spoofing | Do not stub `GET /api/keys/<id>/permissions`; pass it through |
| Gitleaks trip on credential-shaped literals | Information disclosure | Do not write credential-shaped placeholder strings in the script (type obviously fake words, no key-like patterns); CLAUDE.md gitleaks rule |
| Spike password stored in Railway | Information disclosure | Plan 03 pre-rotation Railway name check; rotate or delete per founder |

## Project Constraints (from CLAUDE.md)

- `AGENTS.md` heading: this Next.js has breaking changes; read `node_modules/next/dist/docs/` before writing Next code. This phase writes no Next code (kit is standalone JS), so no docs read was needed; if the plan adds any route/component code, that rule applies.
- Public repo with `.planning/` tracked: no secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence (the greps above are recorded as greps, not as proofs of absence).
- CHANGELOG discipline: every ship writes a CHANGELOG entry and bumps `VERSION` and `package.json` as byte-equal 4-digit strings; a ship branch must change nothing under `.planning` (memory: ship planning guard); the kit lives in `.planning/`, so the code-bearing ship (if any) contains no kit change. Phase 157 itself delivers no product code, so the records PR is the carrier.
- Never write the CI skip trailer tokens in a commit message or PR body, even to deny them.
- PROD: marker query first (`SELECT shobj_description(oid,'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`); PROD reads via MCP first, one query per call; ask before PROD writes. No PROD write is planned here; FCONF-04's rotation is the founder's act.
- No AI authorship attribution trailers in commits (memory), notwithstanding the harness reminder; follow the user instruction.
- Delete the `TODOS.md` entries this phase closes in the same PR and name them in the CHANGELOG (none identified here).
- Verification files use `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`; `drift_subjects` must not include `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json`.
- Founder sessions are one step at a time; no mention of context budget.
- Data-integrity/user-facing gates must be able to fail (neuter, see RED, restore): applies to the kit smoke test, e.g. temporarily remove the refuse arm from the router and see the fail-closed case go RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work).

## Sources

### Primary (HIGH confidence; read this session)
- `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` (whole file)
- `src/app/(dashboard)/strategies/new/wizard/{page.tsx, WizardClient.tsx (196-340, 455-700, 1195-1290, 1328-1660), WizardErrorEnvelope.tsx}`
- `src/app/(dashboard)/strategies/new/wizard/steps/{ConnectKeyStep.tsx (56-420, 620-640, 1096-1335, 1596-1660, 1775-1830, 1925-1945), MultiKeyConnectStep.tsx (725-800), SubmitStep.tsx (255-360, 560-600, 700-740, 820-880), SyncPreviewStep.tsx (98-200, 284-320, 780-1215, 1217-1470, 1470-1660, 1895-2170, 3100-3360), MetadataStep.tsx (600-700), SyncPreviewStep.stale-refusal.runtime.test.tsx (1-470, 640-740)}`
- `src/lib/wizard/{localStorage.ts (18-52, 690-931), wizard-correlation.ts, resume-banner.ts}`, `src/lib/wizardErrors.ts` (4286-4335, 3501-3541, 5138-5182, 6040-6050, 6178-6183), `src/lib/wizardKeyRosters.ts`, `src/lib/envelope.ts:54-57`, `src/components/error/ErrorEnvelope.tsx:100-262`, `src/lib/api/{seam-retry-after.ts, headers.ts}`, `src/hooks/useStrategySyncPoller.ts`, `src/lib/closed-sets.ts:808-812`
- `src/app/api/strategies/{create-with-key/route.ts (1893-1972), finalize-wizard/route.ts (1145-1156, 2016-2025, 2460-2486, 2876-2890), wizard-draft/route.ts}`, `src/app/api/keys/[id]/rotate-secret/route.ts (1-150, 440-540)`, `src/app/api/allocator/holdings/sync/route.ts (1-110)`
- `src/components/layout/{DashboardChrome.tsx, Sidebar.tsx}`, `src/app/(dashboard)/strategies/{page.tsx:1335-1375, StrategiesSection.tsx}`, `src/lib/supabase/client.ts`, `src/lib/for-quants-analytics.ts`
- `@supabase/supabase-js@dist/index.cjs:257-287`, `@supabase/postgrest-js@2.118.0 dist/index.cjs` (`select`, `processResponse`, `maybeSingle`), `@supabase/ssr` (no fetch option) from the primary checkout's `node_modules` (read-only)
- `supabase/schema/baseline.sql:12995-13001`, `supabase/migrations/20260406065011_security_hardening.sql:66`
- `.planning/phases/157-*/157-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 157, gate-1 notes), `.planning/phases/155.1-*/155.1-SPIKE-RUNBOOK.md`, `.planning/milestones/v1.17-phases/153.7-*/153.7-VERIFICATION.md` (`human_verification`)

### Secondary / Tertiary
- None. No web or Context7 lookups were needed; every claim is an in-repo read. (The research-plan/classify-confidence seams were not run: the questions are all codebase-internal, and no provider fetch applies.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no packages)
- Architecture / request sets: HIGH (every route and step read at HEAD)
- Pitfalls: HIGH for 1-6 (derived from read code), MEDIUM for 7-8 (depend on founder role and wording)
- FCONF-04 post-rotation sync: MEDIUM (A1)

**Research date:** 2026-11-23
**Valid until:** 2026-12-07 or until `SyncPreviewStep.tsx`, `ConnectKeyStep.tsx`, `SubmitStep.tsx`, `wizardErrors.ts` or the two routes change (re-read the cited lines; they drift)
