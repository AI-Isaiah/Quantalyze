# Phase 138: MT5UI — Flag-gated add-key UI + api_verified badge + setup guide + all-roles e2e - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (frontend phase — flag-gated sFOX-UX clone reusing shipped components; DESIGN.md governs; engineering-discretion only)

<domain>
## Phase Boundary

MT5 becomes a first-class, flag-gated add-key experience with the `api_verified` trust distinction
visible and e2e-proven across ALL roles — DARK until Phase 139 flips it. Mirrors the shipped sFOX
add-key UX + reuses the existing `api_verified` badge components; adds the MT5-specific 3-credential
form + an investor-password setup guide. Ships behind `NEXT_PUBLIC_MT5_ENABLED` (client) with the
already-landed `MT5_ENABLED` server gate confirmed end-to-end.

NOT in this phase: the prod gateway / real-broker soak / the actual flag FLIP (Phase 139); the
worker derive branch (136) and server validate gate (135) already exist — 138 confirms + surfaces.
</domain>

<decisions>
## Implementation Decisions

### Flag-gated add-key wizard (MT5UI-01)
- Expose MT5 in the add-key wizard (the `+ Strategy` Browse → onAddOwn → ContributionWizardOverlay
  API path → WizardClient exchange/venue selector) behind `NEXT_PUBLIC_MT5_ENABLED` (strict
  `"true"`; anything else = OFF). **OFF = byte-identical** to today — no MT5 option renders — and a
  test proves it.
- Collect the THREE MT5 credentials: **login** (account number), **investor password**, **broker
  server**. Broker server is REQUIRED, with inline "find it in your terminal" guidance (where in
  MT5 to read the exact server string). Map to the existing `{api_key, api_secret, passphrase}`
  slots (the 135 chokepoint) — the form is a thin MT5-labeled variant of the existing ApiKeyForm.
- Mirror the sFOX flag mechanics ([[project_v1_13_founder_flags_and_sfox_enable_mechanics]]):
  enable = set `NEXT_PUBLIC_MT5_ENABLED` (+ server `MT5_ENABLED`) on Vercel + redeploy (Phase 139).

### Investor-password setup guide (MT5UI-01)
- A read-only onboarding/setup guide surfaces the server-enforced Guest-Mode trust signal with an
  EXPLICIT, prominent instruction: **"use your INVESTOR password, never your master password."**
  (A master password is server-rejected with distinguishable copy — 135 — but the UI must steer
  users to the investor password up front.) Follow DESIGN.md for tone/placement.

### api_verified badge + all-roles e2e (MT5UI-02)
- The `api_verified` badge (reuse the shipped `VerifiedBadge`/`TrustTierLabel`) renders on an
  MT5-backed factsheet across ALL roles (alloc/sm/admin). MT5 already earns `api_verified` (136 via
  process_key) — 138 confirms it SURFACES.
- **All-roles e2e** ([[feedback_e2e_all_user_groups]]) asserts the badge + the connect flow;
  invalid-key, wrong-server, and master-password attempts each show HONEST, DISTINGUISHABLE copy
  (the 135 wizardErrors codes KEY_AUTH_FAILED / KEY_MT5_WRONG_SERVER / KEY_MT5_MASTER_PASSWORD).
- **Server gate `MT5_ENABLED`** (strict `"true"`, fail-closed when unset) confirmed to admit the
  live MT5 read at BOTH the key routes (135 `isMt5EnabledServer`) AND the worker derive branch
  (136 `mt5_enabled_server`) — a test pins fail-closed-when-unset.

### DESIGN.md compliance (MANDATORY)
- All visual/UI decisions follow DESIGN.md (nav LIGHT RAIL, table color sign-only, radius ladder,
  etc.). No net-new aesthetic direction — MT5 rides the existing wizard/badge/factsheet design.

### Claude's Discretion
Exact copy wording, guide placement (inline vs modal), and the MT5 form's field labels are
engineering-discretion within DESIGN.md + the sFOX-UX precedent.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Analogs
- `src/components/ui/VerifiedBadge.tsx` + `src/components/strategy/TrustTierLabel.tsx` — the shipped
  `api_verified` badge (reuse; MT5 rides it).
- `src/components/strategy/ApiKeyForm.tsx` — the add-key form to add an MT5 variant of.
- The sFOX add-key wizard path (ContributionWizardOverlay → WizardClient) + `NEXT_PUBLIC_SFOX_ENABLED`
  flag precedent — mirror for MT5.
- `src/lib/closed-sets.ts` (`isMt5EnabledServer`, SUPPORTED_EXCHANGES incl. mt5) + `wizardErrors.ts`
  (KEY_MT5_* codes from 135) — the copy + gate already exist.
- The seeded e2e harness (all-roles, [[reference_test_credentials]] alloc/sm/admin) — the pattern
  for the all-roles badge + connect e2e.

### Established Patterns
- Flag-gated venue behind `NEXT_PUBLIC_*_ENABLED` strict "true", OFF = byte-identical; api_verified
  badge via TrustTier; all-roles seeded e2e as the real gate.

### Integration Points
- The add-key wizard exchange/venue selector; the factsheet badge render; the e2e seed fixtures.
</code_context>

<specifics>
## Specific Ideas
- "use your INVESTOR password, never your master password" must be prominent — it is the #1 user
  error and the master password is server-rejected.
- `NEXT_PUBLIC_MT5_ENABLED` (client, wizard visibility) is distinct from `MT5_ENABLED` (server, admits
  the read) — both flip in 139; 138 wires + tests both, dark.
</specifics>

<deferred>
## Deferred Ideas
- The actual flag FLIP + prod gateway + real-broker soak → Phase 139.
- Live badge render against a real MT5 account → depends on 139 go-live; 138 e2e uses seeded fixtures.
</deferred>
