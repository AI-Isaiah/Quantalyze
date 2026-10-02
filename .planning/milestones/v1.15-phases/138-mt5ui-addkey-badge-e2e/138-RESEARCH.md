# Phase 138: MT5UI — Flag-gated add-key wizard + api_verified badge + setup guide + all-roles e2e - Research

**Researched:** 2026-07-24
**Domain:** Frontend flag-gated venue clone (Next.js App Router client component) + seeded Playwright all-roles e2e; reuses shipped 135/136 seams
**Confidence:** HIGH (every claim is a codebase grep against the shipped sFOX precedent; no external packages, no training-data reliance)

## Summary

Phase 138 is a **verbatim clone of the shipped sFOX add-key UX** for MT5, riding seams already landed in Phase 135 (server gate `isMt5EnabledServer`, `KEY_MT5_*` error codes, three-credential validate carve-out, worker `_make_mt5_session` slot mapping) and Phase 136 (`api_verified` derive, `mt5` excluded from `CRYPTO_EXCHANGES`). The DB CHECK constraints already admit `mt5` at every key-saving boundary (migration `20260723172032`). **Nothing in 138 requires new backend, new migration, new badge, or new error copy.** It is pure UI surfacing + tests, shipping DARK behind `NEXT_PUBLIC_MT5_ENABLED` (client) with `MT5_ENABLED` (server) confirmed fail-closed. [VERIFIED: codebase grep]

The single most important finding is the **flag-name reconciliation** (Q1): REQUIREMENTS' `NEXT_PUBLIC_MT5_ENABLED` and UI-SPEC's `MT5_UI_ENABLED` are **NOT in conflict** — they name two different things at two different layers, exactly as the sFOX precedent does. `NEXT_PUBLIC_MT5_ENABLED` is the **environment variable** (set on Vercel); `MT5_UI_ENABLED` is the **exported TS const** in `closed-sets.ts` that reads it (`export const MT5_UI_ENABLED = process.env.NEXT_PUBLIC_MT5_ENABLED === "true"`), mirroring `SFOX_UI_ENABLED = process.env.NEXT_PUBLIC_SFOX_ENABLED === "true"` at `src/lib/closed-sets.ts:75`. The executor uses BOTH names, each at its own layer. [VERIFIED: src/lib/closed-sets.ts:75]

**Primary recommendation:** Clone the sFOX card append in `ConnectKeyStep.tsx:82-97` (NOT `ApiKeyForm.tsx`), add `MT5_UI_ENABLED` to `closed-sets.ts` next to `SFOX_UI_ENABLED`, extend `ExchangeOption` with a passphrase-label override, add a `#mt5-readonly` SubAnchor to `security/page.tsx` gated on `isMt5EnabledServer()`, and add TWO test surfaces — a vitest `ConnectKeyStep.test.tsx` block (flag byte-identity + three distinguishable `KEY_MT5_*` envelopes) and a seeded Playwright `mt5-badge.spec.ts` mirroring `sfox-badge.spec.ts` for all roles. Do NOT touch the badge components, `TRUST_TIER_TOKENS`, or `wizardErrors.ts` copy.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Flag-gated add-key wizard (MT5UI-01):** Expose MT5 in the add-key wizard (`+ Strategy` Browse → onAddOwn → ContributionWizardOverlay API path → WizardClient exchange/venue selector) behind `NEXT_PUBLIC_MT5_ENABLED` (strict `"true"`; anything else = OFF). **OFF = byte-identical** to today — no MT5 option renders — and a test proves it.
- Collect the THREE MT5 credentials: **login** (account number), **investor password**, **broker server**. Broker server is REQUIRED, with inline "find it in your terminal" guidance. Map to the existing `{api_key, api_secret, passphrase}` slots (the 135 chokepoint) — the form is a thin MT5-labeled variant of the existing form.
- Mirror the sFOX flag mechanics: enable = set `NEXT_PUBLIC_MT5_ENABLED` (+ server `MT5_ENABLED`) on Vercel + redeploy (Phase 139).
- **Investor-password setup guide (MT5UI-01):** A read-only onboarding/setup guide surfaces the server-enforced Guest-Mode trust signal with an EXPLICIT, prominent instruction: **"use your INVESTOR password, never your master password."** Follow DESIGN.md for tone/placement.
- **api_verified badge + all-roles e2e (MT5UI-02):** The `api_verified` badge (reuse the shipped `VerifiedBadge`/`TrustTierLabel`) renders on an MT5-backed factsheet across ALL roles (alloc/sm/admin). MT5 already earns `api_verified` (136 via process_key) — 138 confirms it SURFACES.
- **All-roles e2e** asserts the badge + the connect flow; invalid-key, wrong-server, and master-password attempts each show HONEST, DISTINGUISHABLE copy (the 135 wizardErrors codes `KEY_AUTH_FAILED` / `KEY_MT5_WRONG_SERVER` / `KEY_MT5_MASTER_PASSWORD`).
- **Server gate `MT5_ENABLED`** (strict `"true"`, fail-closed when unset) confirmed to admit the live MT5 read at BOTH the key routes (135 `isMt5EnabledServer`) AND the worker derive branch (136 `mt5_enabled_server`) — a test pins fail-closed-when-unset.
- **DESIGN.md compliance (MANDATORY):** All visual/UI decisions follow DESIGN.md. No net-new aesthetic direction — MT5 rides the existing wizard/badge/factsheet design.

### Claude's Discretion
Exact copy wording, guide placement (inline vs modal), and the MT5 form's field labels are engineering-discretion within DESIGN.md + the sFOX-UX precedent. (The 138-UI-SPEC has already exercised this discretion and pins concrete copy + INLINE-deep-link placement — treat the UI-SPEC as the design contract.)

### Deferred Ideas (OUT OF SCOPE)
- The actual flag FLIP + prod gateway + real-broker soak → Phase 139.
- Live badge render against a real MT5 account → depends on 139 go-live; 138 e2e uses seeded fixtures.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5UI-01 | Flag-gated add-key wizard exposes MT5 (`NEXT_PUBLIC_MT5_ENABLED`, strict "true"; OFF = byte-identical) collecting login / investor password / broker server, with a read-only onboarding/setup guide surfacing the server-enforced Guest-Mode trust signal. | Q1 (flag), Q2 (card append), Q3 (slot mapping), Q4 (setup guide). All edit sites mapped file:line below. |
| MT5UI-02 | The `api_verified` badge renders on an MT5-backed factsheet across all roles; e2e (all user groups) asserts the badge + connect flow. Server gate `MT5_ENABLED` (strict "true") admits the live MT5 read at the key routes AND the worker derive branch. | Q5 (badge, no change), Q6 (all-roles e2e harness), Q7 (server gate already landed — test-only). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MT5 venue card visibility | Frontend (client build) | — | `NEXT_PUBLIC_MT5_ENABLED` is inlined into the client bundle at build time; card show/hide is a pure client concern. |
| MT5 connect admission | API / Backend | Worker | `isMt5EnabledServer()` (server env `MT5_ENABLED`) gates the three key routes; the Python worker `mt5_enabled_server()` is the mirror defense-in-depth gate. Both already landed. |
| Credential slot mapping | Worker | API | The login→api_key / investor-pw→api_secret / server→passphrase reuse is authoritative in `job_worker.py::_make_mt5_session`; the UI form just submits into the existing `{api_key, api_secret, passphrase}` payload. |
| `api_verified` trust derive | Worker | Database | Phase 136 `process_key` writes `trust_tier='api_verified'`; the factsheet query projects it. UI is provenance-blind. |
| Setup guide (`#mt5-readonly`) | Frontend Server (SSR) | — | `security/page.tsx` is a Server Component reading `isMt5EnabledServer()` at render time (server env). |
| All-roles badge proof | e2e (Playwright, seeded) | Database (test project) | Seeded fixtures insert an api_verified MT5 strategy; roles sweep owner/allocator/admin/anon factsheet surfaces. |

## Standard Stack

No external packages are introduced by this phase. Every dependency is already in the repo (`react`, `next`, `@playwright/test`, `vitest`, `@supabase/*`). **Package Legitimacy Audit is therefore N/A — no install step exists.** [VERIFIED: codebase grep — Surface Map touches only existing files]

## Architecture Patterns

### System Data Flow (MT5 add-key, flag ON in 139; wired dark in 138)

```
User → +Strategy (Browse) → onAddOwn
     → ContributionWizardOverlay (API path)
     → WizardClient → ConnectKeyStep.tsx  ← [MT5 card appended iff MT5_UI_ENABLED]
          │ selects "MT5" card (data-testid="wizard-exchange-mt5")
          │ fills: MT5 login / Investor password / Broker server
          ▼
     POST /api/strategies/create-with-key
          │ { exchange:"mt5", api_key:login, api_secret:investorPw, passphrase:server }
          ▼
     validate-and-encrypt route  ← isMt5EnabledServer() gate (fail-closed 400 in 138; admits in 139)
          ▼
     Railway worker  ← mt5_enabled_server() gate → _make_mt5_session(api_key,api_secret,passphrase)
          │ parse_mt5_credentials(login, investor_pw, server) → RPyC Mt5Client probe
          │ success → process_key writes trust_tier='api_verified'
          ▼
     Factsheet query projects trust_tier → VerifiedBadge / TrustTierLabel render "api_verified"
```

### Pattern 1: NEXT_PUBLIC flag const (client-inlined, fail-closed)
**What:** A module-scope const doing a **single static** `process.env.NEXT_PUBLIC_X` member access with strict `=== "true"`.
**When to use:** Client-bundle visibility gates. Next.js inlines the full static member expression at build; dynamic `process.env[...]` indexing breaks the inlining and reads `undefined` in the browser.
**Example:**
```typescript
// Source: src/lib/closed-sets.ts:75 (SFOX precedent — clone verbatim for MT5)
export const SFOX_UI_ENABLED = process.env.NEXT_PUBLIC_SFOX_ENABLED === "true";
// 138 adds, adjacent:
export const MT5_UI_ENABLED = process.env.NEXT_PUBLIC_MT5_ENABLED === "true";
```

### Pattern 2: Spread-append a venue card behind the flag
**What:** `...(FLAG ? [{card}] : [])` in the wizard's local `EXCHANGES` array so flag-OFF is a byte-identical empty spread.
**Example:**
```typescript
// Source: src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:82-97
...(SFOX_UI_ENABLED ? [{ id:"sfox" as const, name:"sFOX", caption:"…", requiresPassphrase:false, requiresSecret:false, credentialLabels:{…}, credentialPlaceholders:{…} }] : []),
```

### Anti-Patterns to Avoid
- **Adding `mt5` to `UI_EXCHANGE_CODES`** (closed-sets.ts:179-189): that would auto-widen the manager-surface `ApiKeyForm`/`StrategyForm` `<Select>` (OQ4) and ship an **unlabeled** MT5 option there. Keep MT5 out of `UI_EXCHANGE_CODES` this phase (UI-SPEC §MT5-Manager-Parity recommendation). [VERIFIED: closed-sets.ts:187-189]
- **Editing the badge components or `TRUST_TIER_TOKENS`**: MT5 is provenance-blind at the badge layer; the drift gate `trust-tier-tokens.test.ts` must stay untouched.
- **Authoring new envelope strings**: all three `KEY_MT5_*`/`KEY_AUTH_FAILED` envelopes already exist in `wizardErrors.ts` (Phase 135). 138 only wires the branch that surfaces them.
- **Gating the setup guide on the CLIENT flag**: the sFOX `#sfox-readonly` block gates on the **server** flag `isSfoxEnabledServer()` (security/page.tsx:499). Mirror with `isMt5EnabledServer()`, NOT `MT5_UI_ENABLED`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MT5 credential form | A new `Mt5KeyForm` component | The existing `ConnectKeyStep` + a `credentialLabels`/passphrase-label override on `ExchangeOption` | sFOX/Deribit already proved the labeled-variant pattern; a fork duplicates submit/error/telemetry wiring. |
| Distinguishable error copy | New envelope strings | `buildEnvelope(KEY_MT5_MASTER_PASSWORD \| KEY_MT5_WRONG_SERVER \| KEY_AUTH_FAILED)` | All authored in Phase 135 `wizardErrors.ts:214-260`. |
| api_verified badge | An MT5 badge variant | `VerifiedBadge` / `TrustTierLabel` as-is | They render for ANY `api_verified` tier; MT5 is just another source. |
| Seed an api_verified strategy | Ad-hoc inserts | Clone `seedSfoxVerifiedStrategy` → `seedMt5VerifiedStrategy` | The 3-insert (api_keys/strategies/strategy_verifications) + fail-loud precondition idiom is proven and prod-safe. |

**Key insight:** 138 is a *surfacing* phase. The temptation is to "build the MT5 integration"; the correct move is to reuse five shipped seams and add two test surfaces.

## Research Questions — Answers (file:line)

### Q1 — Client flag name RECONCILIATION → NO CONFLICT
- **sFOX env var:** `NEXT_PUBLIC_SFOX_ENABLED`. **sFOX reader const:** `SFOX_UI_ENABLED` at `src/lib/closed-sets.ts:75` (`export const SFOX_UI_ENABLED = process.env.NEXT_PUBLIC_SFOX_ENABLED === "true"`), re-exported from `@/lib/utils` (`src/lib/utils.ts:161-167`) so consumers import it from `@/lib/utils`. `ConnectKeyStep.tsx:12` imports `SFOX_UI_ENABLED` from `@/lib/utils`. [VERIFIED: closed-sets.ts:75, utils.ts:164, ConnectKeyStep.tsx:12]
- **There is NO sFOX `isSfoxEnabled()` client helper** — it is a plain const, not a function. (The function form `isSfoxEnabledServer()` at closed-sets.ts:124 is the SERVER gate, distinct.)
- **Authoritative resolution:** REQUIREMENTS' `NEXT_PUBLIC_MT5_ENABLED` = the **environment variable** (set on Vercel in 139). UI-SPEC's `MT5_UI_ENABLED` = the **TS const identifier** that reads that env var. They are the same two-layer pattern as sFOX and do NOT conflict. The executor:
  1. defines `export const MT5_UI_ENABLED = process.env.NEXT_PUBLIC_MT5_ENABLED === "true"` in `closed-sets.ts` adjacent to `SFOX_UI_ENABLED`,
  2. re-exports it from `@/lib/utils` alongside `SFOX_UI_ENABLED` (utils.ts:161-167),
  3. imports `MT5_UI_ENABLED` into `ConnectKeyStep.tsx`.
- **Where the flag is read to show/hide the card:** `ConnectKeyStep.tsx:82` (`...(SFOX_UI_ENABLED ? [sfoxCard] : [])`). MT5 appends identically. [VERIFIED: ConnectKeyStep.tsx:82-97]
- **Confidence:** HIGH.

### Q2 — ConnectKeyStep venue-card append
- **Exact location:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:82-97` — the sFOX `ExchangeOption` is spread-appended to the local `const EXCHANGES: ExchangeOption[]` (declared 52-98) behind `SFOX_UI_ENABLED`. Add the MT5 object identically behind `MT5_UI_ENABLED`. [VERIFIED]
- **What renders the credential fields:** ONE `ConnectKeyStep` form (no per-venue form component). Fields are driven by `ExchangeOption` metadata:
  - key input: `ConnectKeyStep.tsx:345-352`, label from `credentialLabels.key` (default "API Key", resolved at :201).
  - secret input: `:358-386`, gated by `requiresSecret` (default true), label from `credentialLabels.secret` (:202).
  - passphrase/third field: `:388-404`, gated by `requiresPassphrase`, **label hardcoded `"OKX Passphrase"`** and helper hardcoded (:391, :399-402).
- **The MT5 delta needs a per-venue passphrase-LABEL override.** Today the third field's label/helper are hardcoded to OKX. Extend `ExchangeOption` with an optional passphrase-label + passphrase-helper field (the same minimal extension pattern `credentialLabels` used at :40-46), and read it at render like `keyLabel`/`secretLabel`. Set the MT5 card `requiresPassphrase: true` so the third field renders and gates submit (submit predicate `ConnectKeyStep.tsx:435` already includes `(requiresPassphrase && !passphrase)`). [VERIFIED: ConnectKeyStep.tsx:388-404, 435]
- **Per-card testid:** the render loop emits `data-testid={`wizard-exchange-${ex.id}`}` at `:324` → MT5 gets `wizard-exchange-mt5` for free. [VERIFIED]
- **Setup-guide deep-link:** `:335` `href={`/security#${exchange}-readonly`}` → resolves to `/security#mt5-readonly` automatically for the mt5 selection. [VERIFIED]
- **Trust-atom swap ("What we reject"):** the sFOX honest-atom swap is `SFOX_REJECT_ATOM_BODY` (:103-104) applied at `:193-197` (keyed on `!requiresSecret`). MT5 requires a secret, so the executor must add an **mt5-keyed** swap (key on `activeExchange?.id === "mt5"`, NOT on `requiresSecret`) to inject the MT5 master-password rejection body from UI-SPEC Delta 2. [VERIFIED: ConnectKeyStep.tsx:190-197]
- **Second wizard surface:** `MultiKeyConnectStep.tsx:108` ALSO spread-appends the sFOX card behind `SFOX_UI_ENABLED` (imports it at :19). MT5 is single-key; UI-SPEC scopes 138 to `ConnectKeyStep` only. See Open Questions #1 — planner should confirm MT5 stays out of `MultiKeyConnectStep`. [VERIFIED: MultiKeyConnectStep.tsx:108]

### Q3 — Field→slot mapping (135 chokepoint)
- **Authoritative mapping** (docstring): `analytics-service/services/job_worker.py:916-917` — *"login -> api_key, investor password -> api_secret, broker server -> passphrase."* Parsed by `parse_mt5_credentials(api_key, api_secret, passphrase)` at `job_worker.py:925` (built in `_make_mt5_session`, invoked at `:967`). [VERIFIED: job_worker.py:916-917, 925, 967]
- **UI form must submit** (into the existing create-with-key payload, `ConnectKeyStep.tsx:223-233`):
  - `api_key` ← MT5 login (account number)
  - `api_secret` ← investor password
  - `passphrase` ← broker server
- The payload keys and storage columns are UNCHANGED — only the rendered labels differ (the Deribit/sFOX label-only precedent). [VERIFIED]
- **Confidence:** HIGH.

### Q4 — Setup guide (`#mt5-readonly`)
- **sFOX `#sfox-readonly` SubAnchor:** `src/app/(marketing)/security/page.tsx:500-528`, nested inside the `<Section id="readonly-key">` (:412), rendered ONLY when `isSfoxEnabledServer()` (:499). The page imports `isSfoxEnabledServer` from `@/lib/closed-sets` (:2) and is a Server Component reading server env at render. [VERIFIED]
- **How to add `#mt5-readonly`:** add a `<SubAnchor id="mt5-readonly" title="MT5">` block inside the same `readonly-key` Section, gated on `isMt5EnabledServer()` (import it alongside `isSfoxEnabledServer` from `@/lib/closed-sets`). **Gate on the SERVER flag** `MT5_ENABLED`, mirroring sFOX — NOT the client `MT5_UI_ENABLED`. [VERIFIED: security/page.tsx:2, 499]
- **Test precedent:** `src/app/(marketing)/security/page.test.tsx:183-298` — asserts the sfox block renders when `process.env.SFOX_ENABLED="true"` (:205), is ABSENT when unset (:277-279), and stays absent for non-exact values (:293-298). Clone this describe block for `MT5_ENABLED`/`#mt5-readonly`. Anchor stability contract noted at page.tsx:15. [VERIFIED]
- **Confidence:** HIGH.

### Q5 — api_verified badge (NO CHANGE)
- **`VerifiedBadge.tsx:25-26`** renders the "Verified" chip only when `trustTier === "api_verified"`, else returns nothing (fails closed on `undefined`). **`TrustTierLabel.tsx:77,89-90`** renders from `TRUST_TIER_TOKENS[trustTier]` and exposes `data-testid="trust-tier-label"` + `data-trust-tier={trustTier}`. **NO change required.** [VERIFIED]
- **What the factsheet query must project:** `trust_tier`. The verification's `trust_tier` is projected onto `strategy.trust_tier` by `getStrategyDetail`/`getPublicStrategyDetail` (`queries.ts:303-324`, cited in seed helper comment). This projection is **already present** for sfox/deribit (the sfox-badge spec passes today across owner/allocator/admin/anon). MT5 rides the same projection — provenance-blind. The only 138 risk is a dropped projection on a new factsheet path, which the e2e catches (VerifiedBadge fails closed → assertion fails RED). [VERIFIED: seed-test-project.ts:1222-1226; sfox-badge.spec.ts]
- **Confidence:** HIGH.

### Q6 — All-roles e2e harness
- **Seed helper:** `e2e/helpers/seed-test-project.ts:1130-1250` `seedSfoxVerifiedStrategy()` (+ `SeededSfoxVerifiedStrategy` iface :1084, `cleanupSfoxVerifiedStrategy` :1263). It:
  1. seeds owner (`role:"both"`) + a separate `isAdmin:true` user via `seedTestAllocator` (:76-165), (:1138-1139),
  2. inserts `api_keys{exchange:"sfox"}` (:1149),
  3. inserts published `strategies{source:"sfox", api_key_id, supported_exchanges:["sfox"]}` (:1173-1187),
  4. inserts `strategy_analytics{computation_status:"complete", returns_series…}` (:1205),
  5. inserts `strategy_verifications{source:"sfox", trust_tier:"api_verified", status:"validated", flow_type:"onboard"}` (:1227-1238).
  Clone → `seedMt5VerifiedStrategy` with `exchange/source:"mt5"`, `supported_exchanges:["mt5"]`. **All three boundary CHECKs already admit `mt5`** (migration `20260723172032` widens api_keys.exchange, strategies.source, strategy_verifications.source — lines 17-20). MT5 is `asset_class` traditional but the seed doesn't set asset_class; the sfox seed omits it too — fine for badge rendering. [VERIFIED]
- **Roles swept (mirror sfox-badge.spec.ts:110-214):**
  - OWNER (`both`): manager `/strategies/[id]/edit` (exchange tag) + factsheet `/strategy/[id]` (badge) + `/browse/<slug>/<id>` (badge).
  - ADMIN (is_admin session): non-owner reads `/strategy/[id]` badge (the FACTSHEET-01 anti-mask net).
  - ANON (no login): public `/strategy/[id]` badge.
  - Login idiom: inline `loginViaForm` (sfox-badge.spec.ts:63-75); creds via test-project seed (not the macOS-Keychain roles — seeded users). Badge locator: `apiVerifiedBadge(page)` = `getByText("Verified", {exact}).or(locator('[data-trust-tier="api_verified"]'))` (:82-86). One `buildAxe()` pass on the badge-bearing factsheet (:149). [VERIFIED]
- **Where the connect-flow + distinguishable-error assertions go:** Two surfaces —
  - **Distinguishable `KEY_MT5_*` envelopes → vitest component test** in `ConnectKeyStep.test.tsx` (NOT Playwright). The proven idiom stubs `wizardFetch`/`fetch` to return `{code: "KEY_MT5_WRONG_SERVER"}` etc. and asserts `screen.findByTestId("error-envelope")` has `data-error-code` = that code (`ConnectKeyStep.test.tsx:317-336`). Add three cases (KEY_AUTH_FAILED / KEY_MT5_WRONG_SERVER / KEY_MT5_MASTER_PASSWORD) each asserting its own envelope title/code — this is the realistic path because a live connect fails-closed while `MT5_ENABLED` is unset (dark). Flag byte-identity test mirrors `ConnectKeyStep.test.tsx:207-215` (flag OFF → `queryByTestId("wizard-exchange-mt5")` is null) and the flag-ON block at :234-311 (stubEnv `NEXT_PUBLIC_MT5_ENABLED="true"`, assert card + labels + setup-guide href `/security#mt5-readonly` + trust-atom swap). Plus a `closed-sets.mt5-flag.test.ts` mirroring `closed-sets.sfox-flag.test.ts` (dynamic-import, `vi.unstubAllEnvs` afterEach). [VERIFIED: ConnectKeyStep.test.tsx:207-336, closed-sets.sfox-flag.test.ts]
  - **All-roles badge → seeded Playwright** `e2e/mt5-badge.spec.ts` mirroring `sfox-badge.spec.ts`.
- **The green e2e gate:** the seed-gated Playwright specs run in the `e2e-seeded` CI job (`.github/workflows/ci.yml:1299`), which is **BLOCKING** and feeds the `frontend` aggregator (branch protection). The seeded batch is invoked via an EXPLICIT spec list (ci.yml:1544-1563, `sfox-badge.spec.ts` at :1557). **Register `e2e/mt5-badge.spec.ts` in that explicit list.** Specs self-skip cleanly when `TEST_SUPABASE_URL`/`TEST_SUPABASE_SERVICE_ROLE_KEY` are absent (green pre-secrets; run once wired) — the `test.skip(!HAS_SEED_ENV,…)` pattern at sfox-badge.spec.ts:89-93. [VERIFIED: ci.yml:1299, 1557; memory: `frontend` aggregator = real e2e gate]
- **Confidence:** HIGH.

### Q7 — Server gate confirmation (already landed; 138 test-only)
- **TS key-route gate:** `isMt5EnabledServer()` at `src/lib/closed-sets.ts:151-153` (`process.env.MT5_ENABLED === "true"`). Wired in `validate-and-encrypt/route.ts:77` (fail-closed 400 "MT5 integration is not yet available." when unset), imported at :15. The same fail-closed arm exists at the other two key routes (create-with-key, composite/add-key) per the comment at :70-76 and the sfox precedent. [VERIFIED]
- **Worker derive gate:** `mt5_enabled_server()` at `analytics-service/services/closed_sets.py:107-109` (`(os.getenv("MT5_ENABLED") or "").strip().lower() == "true"`), mirroring `sfox_enabled_server` (:66). [VERIFIED]
- **138 does NOT add new gate code.** It adds a **test pinning fail-closed-when-unset** at both layers (a TS test asserting `isMt5EnabledServer()` is false for unset/"1"/"TRUE"/"on"/"" and the route returns 400; a py test asserting `mt5_enabled_server()` is false for the same). [VERIFIED]
- **Confidence:** HIGH.

## Already Done (135/136) — 138 MUST NOT Duplicate

| Landed | Where | 138 relationship |
|--------|-------|------------------|
| `SUPPORTED_EXCHANGES` incl. `mt5`, `EXCHANGE_DISPLAY.mt5="MT5"` | closed-sets.ts:39,54 | Reuse; do NOT re-add. |
| `isMt5EnabledServer()` server gate + route wiring | closed-sets.ts:151, validate-and-encrypt/route.ts:77 | Test-only in 138. |
| `mt5_enabled_server()` worker gate | closed_sets.py:107 | Test-only in 138. |
| `KEY_MT5_MASTER_PASSWORD` / `KEY_MT5_WRONG_SERVER` envelope copy | wizardErrors.ts:41-42, 227-260 | Wire the branch to surface; author NO new copy. |
| Credential slot mapping + `_make_mt5_session` | job_worker.py:916-967 | Reuse; UI submits into it. |
| DB CHECK constraints admit `mt5` (api_keys/compute_jobs/strategies/strategy_verifications) | migration 20260723172032 | Seed relies on it; NO new migration. |
| `mt5` excluded from `CRYPTO_EXCHANGES` (√252) | closed-sets.ts:253-259 | Untouched. |
| `VerifiedBadge`/`TrustTierLabel`/`TRUST_TIER_TOKENS` | components | ZERO change. |

## Common Pitfalls

### Pitfall 1: Coloring the investor-password steer amber/red
**What goes wrong:** Treating the preemptive "use your investor password" instruction as a warning event.
**How to avoid:** DESIGN.md semantic-color gate — the steer is muted neutral (`text-text-muted`). Red (`--color-negative`) appears ONLY inside the Error Envelope after a real `KEY_MT5_MASTER_PASSWORD` rejection. (UI-SPEC Color gate, DESIGN.md §Semantic-color gates.)

### Pitfall 2: Widening `UI_EXCHANGE_CODES` to add mt5
**What goes wrong:** Auto-widens every EXCHANGES-derived chip surface AND the manager `ApiKeyForm`/`StrategyForm` `<Select>` (OQ4), shipping an unlabeled MT5 option on the manager form.
**How to avoid:** Keep `mt5` out of `UI_EXCHANGE_CODES`; the wizard MT5 card lives ONLY in `ConnectKeyStep`'s local `EXCHANGES` array. (UI-SPEC §MT5-Manager-Parity.)

### Pitfall 3: Gating the setup guide on the client flag
**What goes wrong:** `#mt5-readonly` would render on a build where `NEXT_PUBLIC_MT5_ENABLED` was inlined but `MT5_ENABLED` server env is off — a guide pointing at a connect that fails closed.
**How to avoid:** Gate on `isMt5EnabledServer()` (server flag), exactly as sFOX (security/page.tsx:499).

### Pitfall 4: Env-stub leak across vitest cases (Node22 lesson)
**What goes wrong:** `MT5_UI_ENABLED` is a module-scope const; a leaked `vi.stubEnv` bleeds into sibling tests → CI-only failure.
**How to avoid:** `vi.resetModules()` + dynamic import per case, `vi.unstubAllEnvs()` in `afterEach` — the exact `closed-sets.sfox-flag.test.ts` idiom. (Memory: CI Node22 vs local Node25 stub-leak.)

## State of the Art

No moving external ecosystem here — this is an internal-precedent clone. The only "state of the art" is: **the sFOX seam (Phase 122) is the canonical template**, refined by the Phase 126 FACTSHEET-01 fix (badge read via `get_published_trust_signals` SECURITY DEFINER RPC so non-owners see it), which the sfox-badge admin/anon legs already prove and the mt5-badge spec inherits for free.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The MT5 factsheet uses the SAME `getPublicStrategyDetail`/`getStrategyDetail` `trust_tier` projection as sfox (no MT5-specific factsheet path exists that could drop it). | Q5 | LOW — if a new path exists, the seeded e2e fails RED (VerifiedBadge fails closed), catching it before merge. Not a silent risk. |
| A2 | The create-with-key + composite/add-key routes carry the same `isMt5EnabledServer()` fail-closed arm as validate-and-encrypt (confirmed for validate-and-encrypt:77; inferred for the other two from the shared comment + sfox precedent). | Q7 | LOW — verify the two other routes during planning with a 2-line grep; if missing, that's a 135 gap the 138 test would surface, not new 138 scope. |

## Open Questions

1. **Does MT5 need a card in `MultiKeyConnectStep.tsx` too?** It has the sfox spread at :108. MT5 is a single-key venue and UI-SPEC scopes 138 to `ConnectKeyStep`. Recommendation: **NO** — keep MT5 out of MultiKeyConnectStep this phase (composites are multi-key crypto stitching; MT5 forex single-account has no composite use case yet). Planner should confirm as an explicit non-goal.
2. **Does the manager-surface `ApiKeyForm` get MT5 (via the `isMt5` carve-out)?** UI-SPEC §MT5-Manager-Parity recommends NO (keep the phase tight). Planner decision — if wanted, it's an explicit extra task, never a silent `UI_EXCHANGE_CODES` widening.

## Environment Availability

Skipped — this phase is code + tests only, no new external tooling. Playwright/vitest/Supabase test-project wiring already exist and gate on `TEST_SUPABASE_URL`/`TEST_SUPABASE_SERVICE_ROLE_KEY` GH secrets (self-skip when absent).

## Validation Architecture

*(nyquist_validation: true)*

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit/component, jsdom) + Playwright (e2e, seeded) + Python pytest (worker gate) |
| Config file | `vitest.config.ts`, `playwright.config.ts`, `analytics-service` pytest (`--cov-fail-under=80`) |
| Quick run command | `npx vitest run src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx src/lib/closed-sets.mt5-flag.test.ts` |
| Full suite command | `npm run test` (vitest) + seeded `npx playwright test e2e/mt5-badge.spec.ts` (CI `e2e-seeded`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5UI-01 | Flag OFF → no MT5 card (byte-identical) | unit | `npx vitest run ...ConnectKeyStep.test.tsx -t "flag OFF"` | ❌ Wave 0 (add case, mirror :207-215) |
| MT5UI-01 | Flag ON → MT5 card + 3 labeled fields + `/security#mt5-readonly` link + trust-atom swap | component | `npx vitest run ...ConnectKeyStep.test.tsx -t "MT5 card"` | ❌ Wave 0 (mirror :234-311) |
| MT5UI-01 | `MT5_UI_ENABLED` strict-"true" gate | unit | `npx vitest run src/lib/closed-sets.mt5-flag.test.ts` | ❌ Wave 0 (mirror closed-sets.sfox-flag.test.ts) |
| MT5UI-01 | `#mt5-readonly` present iff `MT5_ENABLED` on, absent otherwise | unit | `npx vitest run src/app/(marketing)/security/page.test.tsx -t mt5` | ❌ Wave 0 (mirror :183-298) |
| MT5UI-02 | 3 distinguishable `KEY_MT5_*`/`KEY_AUTH_FAILED` envelopes | component | `npx vitest run ...ConnectKeyStep.test.tsx -t "MT5 envelope"` | ❌ Wave 0 (mirror :317-336) |
| MT5UI-02 | api_verified badge across owner/allocator/admin/anon | e2e (seeded) | `npx playwright test e2e/mt5-badge.spec.ts` | ❌ Wave 0 (mirror sfox-badge.spec.ts) |
| MT5UI-02 | `MT5_ENABLED` fail-closed-when-unset (TS + py) | unit | vitest route test + `pytest analytics-service/.../test_*mt5*` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant quick vitest file(s).
- **Per wave merge:** full `npm run test` (+ `npm run lint` pre-push per land discipline).
- **Phase gate:** full vitest green + `e2e-seeded` green (the `frontend` aggregator) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `e2e/mt5-badge.spec.ts` — clone `sfox-badge.spec.ts`; covers MT5UI-02 all-roles badge.
- [ ] `e2e/helpers/seed-test-project.ts::seedMt5VerifiedStrategy` (+ cleanup + iface) — clone `seedSfoxVerifiedStrategy`.
- [ ] `src/lib/closed-sets.mt5-flag.test.ts` — clone `closed-sets.sfox-flag.test.ts`.
- [ ] New describe blocks in `ConnectKeyStep.test.tsx` (flag byte-identity, flag-ON card/fields/link/atom, three envelopes) and `security/page.test.tsx` (#mt5-readonly gate).
- [ ] Register `e2e/mt5-badge.spec.ts` in the `e2e-seeded` explicit spec list (ci.yml ~:1557).
- [ ] Server-gate fail-closed tests: TS route test + Python `mt5_enabled_server` test.

## Security Domain

*(security_enforcement assumed enabled)*

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (credential auth is worker-side, already landed 135) | — |
| V4 Access Control | yes | Setup guide + connect admission gated server-side (`isMt5EnabledServer`, RLS-scoped trust signals via `get_published_trust_signals` SECDEF for the badge). No client-only gate is load-bearing. |
| V5 Input Validation | yes | Server-side in the validate route (135 three-slot presence check + worker `parse_mt5_credentials` fail-closed offline parse). UI adds NO trusted validation. |
| V6 Cryptography | no (AES-256-GCM envelope encryption already handles credential storage) | — |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client flag flipped without server flag (card shown, connect works, or vice-versa) | Elevation/Info | Two-gate design: `NEXT_PUBLIC_MT5_ENABLED` (card) + `MT5_ENABLED` (server) — either alone is a SAFE half-state (card hidden but gated, or card shown but fail-closed 400). 138 pins fail-closed with tests. |
| Master password (trade-capable) submitted | Elevation | Worker refuses + `KEY_MT5_MASTER_PASSWORD`; UI steers to investor password up front; nothing stored. |
| Badge shown to non-owner via RLS leak | Info disclosure | Badge reads published trust signals via SECURITY DEFINER RPC (Phase 126); anon/admin legs of the e2e prove correct public-provenance visibility without over-exposure. |

## Sources

### Primary (HIGH confidence) — codebase (all file:line VERIFIED this session)
- `src/lib/closed-sets.ts` (:39,54,75,124,151,187,253) — flags, gates, exchange sets
- `src/lib/utils.ts` (:161-167) — SFOX_UI_ENABLED re-export
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` (:12,52-98,190-197,324,335,388-435)
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx` (:207-336)
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` (:19,108)
- `src/app/(marketing)/security/page.tsx` (:2,412,499-528) + `security/page.test.tsx` (:183-298)
- `src/lib/wizardErrors.ts` (:41-42,214-260)
- `src/components/ui/VerifiedBadge.tsx` (:25-26), `src/components/strategy/TrustTierLabel.tsx` (:77,89-90)
- `src/lib/closed-sets.sfox-flag.test.ts`
- `src/app/api/keys/validate-and-encrypt/route.ts` (:15,57-90)
- `analytics-service/services/job_worker.py` (:916-967), `analytics-service/services/closed_sets.py` (:66,107-109)
- `e2e/sfox-badge.spec.ts`, `e2e/helpers/seed-test-project.ts` (:76-165,1084-1263)
- `.github/workflows/ci.yml` (:1299,1544-1563)
- `supabase/migrations/20260723172032_mt5_exchange_boundary_checks.sql`

## Metadata

**Confidence breakdown:**
- Flag reconciliation (Q1): HIGH — exact sFOX two-layer precedent found.
- Edit sites (Q2/Q3/Q4): HIGH — every file:line grep-confirmed against the shipped sFOX/OKX code.
- Badge (Q5): HIGH — components fail-closed on undefined; projection proven by passing sfox-badge spec.
- e2e harness (Q6): HIGH — seed helper + spec + CI list all read directly.
- Server gate (Q7): HIGH — both TS and py gates + route wiring confirmed.

**Research date:** 2026-07-24
**Valid until:** ~2026-08-24 (stable internal codebase; re-verify only if the wizard/security page or CI spec list is refactored before execution)
