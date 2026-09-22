---
phase: "167"
slug: credtrust-an-invalid-venue-credential-is-named-to-the-custom
status: draft
shadcn_initialized: false
preset: none
created: "2026-09-22"
---

# Phase 167 — UI Design Contract

> Visual and interaction contract for Phase 167 (CREDTRUST — an invalid venue credential is
> named to the customer as the reason their factsheet stopped updating).
>
> ⛔ **THIS IS A COPY-AND-STATE SPEC, NOT A LAYOUT SPEC.** The phase adds a CAUSE to a
> staleness signal that already renders correctly. It introduces **NO new component, NO new
> page, NO new layout, NO new colour, NO new token**. Every visual section below inherits
> `DESIGN.md` unchanged and names only the rules the two in-scope surfaces actually use.
> Restyling an existing surface is out of scope (CLAUDE.md Rule 3 — Surgical Changes).
>
> **DESIGN.md governs and is not deviated from.** No founder is present in this run, and
> DESIGN.md may not be deviated from without founder approval, so it is not deviated from.
>
> `167-CONTEXT.md`'s D-01…D-15 are binding and are NOT re-litigated here. This contract fills
> exactly the two gaps CONTEXT delegated to "Claude's Discretion": the authored owner-surface
> helper line, and the new `WizardErrorCode`'s copy — plus the state/tone/a11y contract those
> two strings land in.
>
> ⛔ **D-11 IS NOT CLOSED HERE.** It is an OPEN `checkpoint:decision` owned by the planner.
> Every string in this spec is written to hold under all three arms, and `## D-11 Arm
> Variance` states exactly which cells differ per arm.

**In-scope surfaces (two, both existing):**

| # | Surface | Component | What changes |
|---|---------|-----------|--------------|
| S1 | Owner sync surface | `AllocatorSyncStatus` (via `AllocatorExchangeManager`) | one authored helper string replaces a pass-through of the raw `api_keys.sync_error` for the credential case |
| S2 | Wizard validate surface | `ErrorEnvelope` ← `buildEnvelope` ← `wizardErrors.ts` | one new `WizardErrorCode` entry: `title` / `cause` / `fix[]` / `fixRequires[]` / `docsHref` / `actions` |

**Out of scope, named so it is not drifted into:** the public factsheet payload (D-04 — an
id-keyed `unstable_cache` would publish an owner-only fact to anonymous readers), the existing
`revoked` / `error` pill styling and their locked copy, the OPS-facing prober vocabulary
(Phase 164.8.3), and any notification channel (D-14).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none** — `DESIGN.md` is the canonical design system (Tailwind v4 `@theme` tokens in `src/app/globals.css`, drift-gated by `tests/a11y/design-token-drift.test.ts`). Measured 2026-09-22: no `components.json`, no `tailwind.config.*`. ⛔ shadcn init is **NOT** proposed and the gate is resolved against evidence, not deferred to a prompt: initialising it would import a foreign token/primitive system into a locked three-voice design with an enforceable AI-Slop Ban, and this phase adds no component at all. Same call as `161-UI-SPEC.md` and `162-UI-SPEC.md`, both checker-approved. |
| Preset | not applicable |
| Component library | in-house. This phase touches only existing components: `AllocatorSyncStatus`, `ErrorEnvelope`. It reads (and must not change) `FreshnessChip` / `SeriesRecencyLine`, `HoldingsTable`'s revoked chip, `ConnectKeyStep`, `MultiKeyConnectStep`. `@radix-ui/react-tabs` is the repo's only third-party UI package and is not used by either surface. |
| Icon library | **none.** Semantic glyphs `⚠ — · × ✓` only (DESIGN.md § AI-Slop Ban). The one glyph this phase authors is **U+2014 EM DASH**, composed through `AllocatorSyncStatus`'s existing `EM_DASH` constant — never a hyphen-minus, never three dots for an ellipsis. |
| Font | Instrument Serif (display) / DM Sans (interactive + body) / Geist Mono (data). Unchanged. Both in-scope surfaces are DM Sans only; no figure is rendered by either new string, so `.font-metric` is not reached. |

---

## Component Inventory

Enumerated by `ls src/components/ui/*.tsx | grep -v '\.test\.' | wc -l` — 23 primitives —
first-party `src/components/ui/` in `quantalyze@0.85.0.1` — 2026-09-22.

This project has no third-party design system to enumerate, so the provenance line above is
bound to the first-party primitive directory instead. The table below is a **non-exhaustive**
list of the components this phase's two surfaces actually compose — never a closed allowlist.

| Component | Import path | Notes |
|-----------|-------------|-------|
| `AllocatorSyncStatus` | `@/components/exchanges/AllocatorSyncStatus` | S1. 7-state pill + 12px muted helper line. ⛔ Copy table LOCKED VERBATIM (char-for-char unit tests incl. U+2026 / U+2014). Extended deliberately with its pins moved in the SAME change; never reworded in passing. |
| `ErrorEnvelope` | `@/components/error/ErrorEnvelope` | S2. Canonical error renderer. `role="alert"`, `border-negative/30 bg-negative/5`. Retry renders **iff** `envelope.recoverable && onRetry`. |
| `Button` | `@/components/ui/Button` | Reached only indirectly, inside `ErrorEnvelope` (Retry + ghost "Copy diagnostics"). This phase renders no new button. |
| `Badge` | `@/components/ui/Badge` | NOT used. Named so the executor does not reach for it — the owner state is a pill inside `AllocatorSyncStatus`, not a `Badge`. |

---

## Spacing Scale

Inherited verbatim from DESIGN.md § Spacing (base unit 4px). Declared because the template
requires it; **this phase introduces no new spacing value and changes no existing one.**

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| 1 | 4px | pill internal gap (`gap-1`, existing) |
| 2 | 8px | pill horizontal padding (`px-2`, existing); helper-line top offset is `mt-1` = 4px (existing) |
| 3 | 12px | envelope vertical padding (`py-3`, existing `ErrorEnvelope` contract) |
| 4 | 16px | envelope horizontal padding (`px-4`, existing) |
| 6 | 24px | section gap around the wizard envelope (existing) |
| 8 | 32px | layout gaps (untouched) |
| 12 | 48px | major section breaks (untouched) |

Exceptions: **none new.** `--space-grid-gap` (10px) is not reached by either surface. The
44px touch-target rule is not reached either — neither new string is interactive.

---

## Typography

Both new strings land in existing type slots. No new size, no new weight, no new tier.

| Role | Size | Weight | Line Height | Where |
|------|------|--------|-------------|-------|
| Body | 14px (`--text-body`, 14→16 fluid) | 400 | 1.5 | not reached by this phase's strings |
| Label (pill) | 12px (`text-xs`) | 500 (`font-medium`) | Tailwind default | S1 pill label — existing slot |
| Caption (helper) | 12px (`text-xs`) | 400 | Tailwind default | **S1 helper line — where the new authored sentence lands** |
| Heading (envelope title) | 16px (`text-base`) | 600 (`font-semibold`) | Tailwind default | **S2 `title` — existing DESIGN.md § Error Envelope lock (REQ DESIGN-02)** |
| Caption (envelope cause + fix) | 12px | 400 | Tailwind default | **S2 `cause` and each `fix[]` bullet** |

⛔ `no-raw-font-px` is repo-wide `error`. Neither surface may author a raw `text-[Npx]`.

**Copy-length budget (a typography constraint, not taste).** The S1 helper line renders
12px inside a right-aligned `flex flex-col items-end` column. Measured house length of the
existing helper strings: `REVOKED_HELPER` 41 chars, the queued line ~40, the manager's
first-run override 45. ⇒ **the authored helper must stay ≤ 60 characters** or it wraps to
three lines in a table cell and stops reading as a caption. The string specified below is 58.

---

## Color

Inherited from DESIGN.md § Color. **No new colour, no new token.** The 60/30/10 split is the
app's, restated for the checker and scoped to what these two surfaces paint:

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8F9FA` page / `#FFFFFF` surface | the page and the card the pill sits on |
| Secondary (30%) | `#FFFFFF` surface + `#E2E8F0` hairline borders | the exchanges table, the sidebar rail |
| Accent (10%) | `#1B6B5A` | ⛔ **not reached by this phase.** Accent means "verified" and "action"; a failed sign-in is neither. |
| Destructive | `#DC2626` (`--color-negative`) | the existing `revoked` / `error` pill fills and the `ErrorEnvelope` shell (`border-negative/30 bg-negative/5`) — **inherited, not authored here** |

Accent reserved for: nothing in this phase. No element authored by Phase 167 carries
`text-accent`, `bg-accent`, or `border-accent`.

### ⛔ The colour tension, resolved explicitly

**The two halves of the tension, both measured in shipped code at HEAD:**

1. DESIGN.md's semantic gate says **red = permanent / hard error**, **amber = recoverable**
   — widened 2026-07-02 to cover a state a *disclosed one-click user action* reverses, and
   that same entry states red is **forbidden** for a recoverable state. It pins the amber
   trio `#B45309` text / `#FEF3C7` bg / `#FDE68A` border, citing `HoldingsTable`'s
   revoked-key chip (`AMBER_CHIP_STYLE`, which routes through
   `--color-warning` / `--color-warning-bg` / `--color-warning-border`).
2. `AllocatorSyncStatus`'s LOCKED `PILL_STYLES` puts **both `revoked` and `error`** in
   `bg-negative/10 text-negative` — **red**. So the *same* revoked-key condition renders
   amber in `HoldingsTable` and red in `AllocatorSyncStatus`, today, in shipped code.

**The call, in one paragraph.** A credential the owner can rotate is *recoverable by a
disclosed user action* — which is precisely the widened amber reservation — so by the gate
the correct tone for a **newly minted** state is **amber**, not red. This phase therefore
takes amber for the one case where it actually gets to choose (D-11 arm B, the only arm that
mints a pill state), and takes it as the **DESIGN.md-pinned opaque chip trio**
(`--color-warning` on `--color-warning-bg` with a `--color-warning-border` hairline) rather
than as the `bg-warning/10` alpha fill the neighbouring `rate_limited` pill uses — for the
contrast reason measured below. Under arms A and C the cause lands on an **existing red
pill** (`revoked` / `error`) whose style map and copy table are locked; the phase **inherits
that red and does not restyle it**. Restyling it would be a drive-by against a locked map,
would change the meaning of a value two filters already act on, and is not what this phase
is for. The red-vs-amber divergence between the two components predates this phase, is
recorded here, and is left as a named follow-up — ⛔ **not** silently averaged, and ⛔ **not**
fixed in passing (CLAUDE.md Rule 7: surface the conflict, pick one, flag the other).

### Contrast, asserted

DESIGN.md's a11y minimum is **4.5:1**. Both new strings are 12px, i.e. normal text, so 4.5:1
applies to both — no large-text carve-out is available.

| Element | Foreground | Background | Measured | Verdict |
|---------|-----------|-----------|----------|---------|
| **S1 helper line (the sentence this phase adds)** | `--color-text-muted` `#64748B` | `#FFFFFF` surface | **4.85:1** (DESIGN.md-pinned, 2026-04-30 shift) | ✅ AA |
| **S2 envelope `cause` + `fix[]`** | `#4A5568` text-secondary | `bg-negative/5` over white | ≥ 7:1 (dark grey on a 5% tint) | ✅ AA |
| **S2 envelope `title`** | `#1A1A2E` text-primary | `bg-negative/5` over white | ≥ 14:1 | ✅ AA |
| **New pill, arm B only — specified trio** | `#B45309` | `#FEF3C7` (opaque) | **4.55:1** | ✅ AA |
| *Reference: `bg-warning/10` alpha fill (NOT specified here)* | `#B45309` | 10% `#B45309` over `#FFFFFF` ≈ `#F8EEE6` | **≈ 4.39:1** (≈ 4.17:1 composited over the `#F8F9FA` page) | ❌ below 4.5 |

**Method, so the numbers are re-derivable and not recalled:** WCAG 2.x sRGB relative
luminance (`(L1+0.05)/(L2+0.05)`, channel linearisation at the 0.04045 knee), alpha fills
composited over the stated opaque surface. ⚠️ The exact decimal is **method-dependent**:
DESIGN.md records `#B45309` on `bg-warning/5` as 4.56:1 and the same formula here returns
4.46–4.74 depending on whether the fill is composited over `#FFFFFF` or `#F8F9FA`. The
**direction** is stable across both compositing choices and that is what the specification
rests on — the opaque `#FEF3C7` chip clears 4.5:1, the `/10` alpha fill does not.

⚠️ **Measured observation, deliberately NOT a change in this phase:** the existing
`rate_limited` and `complete_with_warnings` pills use `bg-warning/10 text-warning` at 12px
and therefore sit in the ≈4.2–4.4:1 band by the same measurement. That is a pre-existing
finding about shipped code, it is out of this phase's scope (restyling a locked style map),
and it is recorded here rather than acted on. → `## Open Questions`, item 3.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | **None added.** This phase authors no button. The action is named *in prose* — "Reconnect this account" — and performed through the existing key-management controls in `AllocatorExchangeManager` (S1) and the existing credential form (S2). ⛔ Do not mint a CTA to carry this copy. |
| Empty state heading | Not reached. Neither surface has an empty state this phase owns: with no key connected, `AllocatorSyncStatus` is not mounted at all and `AllocatorExchangeManager` renders its existing add-key affordance. |
| Empty state body | Not reached — see above. |
| Error state | **S1:** `Reconnect this account — its credentials may have changed.` **S2:** title `We could not sign in to this account.` + the `cause` and `fix[]` specified in §2 below. Both state the problem and the next step; neither promises a retry. |
| Destructive confirmation | Not reached. This phase adds no destructive action. "Reconnect" is additive and non-destructive; the one genuinely destructive adjacent flow (delete/rotate a key) is untouched. |

### 1. S1 — the authored owner helper line

⛔ **Replaces a pass-through, does not reword a locked constant.** Today the `error` arm
renders `helperText = syncError ?? ""` — the raw `api_keys.sync_error` DB string, which is
how *"…— sync will retry automatically."* reaches a customer verbatim. The `revoked` arm
already shows the right shape: an **authored** constant that ignores `syncError`. This phase
adds a second authored constant of exactly that shape.

```
CREDENTIAL_FAILED_HELPER = "Reconnect this account — its credentials may have changed."
```

| Property | Value |
|----------|-------|
| Rendered form | `Reconnect this account — its credentials may have changed.` |
| Length | 58 characters — inside the ≤60 budget declared in § Typography |
| Em-dash | **U+2014**, composed through the file's existing `EM_DASH` constant. ⛔ never `-`, never `--` |
| Terminating period | **required** — matches `REVOKED_HELPER`'s locked shape |
| Interpolation | **none.** No venue name, no date, no count. A string with no slot cannot render a fact it was not given. |
| Reads `syncError` | **no** — authored, exactly like `REVOKED_HELPER` |

**Why each clause, against DESIGN.md § Voice:**

- *"Reconnect this account"* — **active voice, imperative, remedy first.** Venue-agnostic:
  it names neither a key nor a password (see §3).
- *"— its credentials may have changed"* — **states its own limit.** It does NOT assert the
  credential is invalid, because on the arm this phase routes (a transport-shaped failure
  the classifier declines to call permanent) we do not know that. "May have changed" is true
  of both measured cases: an MT5 password the founder changed, and a venue key that expired.
- **What it deliberately does not say:** no *"will retry automatically"* (the promise this
  phase exists to kill), no venue name (§3), no adjective where a number would do (there is
  no number available on this surface — see §4), and no cheerful framing. It survives the
  five-second test: printed beside a stalled track record, it reads as a plain statement of
  what is wrong and what to do.

**Placement rule (holds under every D-11 arm):** the sentence lands in the **existing helper
line**, not in the pill and not in a new element. The pill carries the *state*; the helper
carries the *cause + remedy*. Under arms A and C the pill label is a locked string that names
no credential, which is exactly why the helper must carry the whole sentence.

### 2. S2 — the new `WizardErrorCode` copy

⭐ **Recommended code id: `KEY_SIGN_IN_FAILED`.** It names the observation ("the sign-in did
not succeed") and asserts no cause, which is the honesty property D-07 requires. The id is a
wire-contract decision the planner owns (code ids are stable — they key PostHog
`wizard_error { code }` events); this spec's copy is portable to any id the planner picks.

```
title:  "We could not sign in to this account."

cause:  "The attempt did not complete, and it did not get far enough for the venue to tell
         us why. A credential that no longer works is one reason this happens; the venue
         being unreachable is another, and from here the two look the same. We will not
         guess between them."

fix[0]: "Open this account at the venue and confirm its credentials are current — a changed
         password, an expiry, or a regenerated key all end here."
        fixRequires[0] = null                                    (always renders)

fix[1]: "For MT5 that is the investor (read-only) password: your broker can reset it, and
         changing the master password changes it too."
        fixRequires[1] = { kind: "venueIs", venue: "mt5" }        (MT5 only)

fix[2]: "Then submit again with the credentials you just confirmed. Submitting the same
         details unchanged reaches the same place."
        fixRequires[2] = { kind: "surfaceIsNot", surface: "preselect" }

fix[3]: "If the credentials are unchanged and this keeps happening, email
         security@quantalyze.com with the correlation id below — that pattern points at the
         venue rather than at your account."
        fixRequires[3] = null                                    (always renders)

docsHref: "/security"
actions:  ["request_call", "expand_log"]
```

**Every constraint, discharged:**

| Constraint | How this copy meets it |
|---|---|
| ⛔ must NOT claim the venue rejected the credentials | The banned sentence is `KEY_AUTH_FAILED`'s *"The exchange rejected these credentials."* This copy says the attempt **did not complete** and the venue **did not tell us why** — the opposite of a rejection claim. |
| ⛔ must NOT claim a fault on our side of the store | The banned sentence is `KEY_MUST_BE_RECONNECTED`'s *"a fault on our side of the store…"*. This copy makes no claim about our storage at all; the key is assumed readable. |
| ⛔ must not collide with `KEY_NETWORK_TIMEOUT` | That title is *"We could not reach the exchange."* This one is *"We could not sign in to this account."* — different verb, different noun, different claim (a completed reach with a failed sign-in and an unreached venue both land here, which is the point). |
| ⭐ must copy `KEY_MUST_BE_RECONNECTED`'s ACTION SHAPE, not its words | `actions: ["request_call", "expand_log"]` — identical set. Not one word of its copy is reused. |
| ⛔ no Retry may render | Neither `clear_and_retry` nor `try_another_key` is present, so `buildEnvelope` derives `recoverable: false` and `ErrorEnvelope`'s `showRetry` is false. **Non-recoverability is DERIVED from the action set, never asserted** — the established pattern. |
| honest about uncertainty | `cause` names **two** candidate reasons, says they are indistinguishable from here, and says we will not guess. |

**Why there is no Retry but the copy still says "submit again" — the resolution of an
apparent contradiction, stated so it is not "fixed" later by someone who spots it.** The
suppressed thing is a *one-click re-run of the identical credentials*: on MT5 a wrong
password raises a modal login dialog that blocks IPC, and repeated validate attempts against
that one shared terminal are the operation implicated in wedging and account eviction — so
the Retry is not merely useless, it is the harmful action (D-08). `fix[2]` prescribes
something different and ordered: **verify at the venue first, then submit**. A control that
invites a reflex re-run and a sentence that prescribes a verification step are not the same
affordance, and the second sentence of `fix[2]` says plainly why the button is absent.

**Why `fix[2]` carries `surfaceIsNot: "preselect"`.** `ConnectKeyStep` has two mutually
exclusive renders, and the saved-key summary paints no credential form at all — a remedy
naming a control is only true of the screen that paints it. This repo has shipped that exact
lie twice from this table (162-06 review / B-2 class). `surfaceIsNot` renders when the caller
names no surface, so untagged callers keep the bullet.

**Why `docsHref` is bare `/security`.** `docsHref` is a scalar on the entry and **cannot be
venue-gated** — `fixRequires` gates `fix[]` bullets only. The nearest specific anchor is
`#regenerate-key`, whose heading reads *"Regenerating an API key"*; sending an MT5 owner
there is the same class of false specificity this phase exists to remove. Bare `/security`
is the most common value in the table and is true for every venue. → an MT5-credential
section on `/security` would earn a specific anchor; named in `## Open Questions`, item 2.

### 3. ⚠️ Venue-agnosticism — solved explicitly, not papered over

**The trap, restated:** the second measured venue is `bybit` (`retCode 33004`, an expired
API key), not just MT5. **MT5 has a password, not a key.** So *"re-copy your API key"* is
wrong for MT5 and *"re-enter your password"* is wrong for bybit. A phrase that fits neither
is not a fix.

**The solve, in three moves:**

1. **Shared copy uses a credential-neutral noun.** Every unconditional string above says
   **"credentials"**, **"this account"** or **"the venue"** — never "key", never "password",
   never "exchange". *"venue"* is already established customer-facing vocabulary in this copy
   table (several shipped entries use it, including the MT5-gated *"This is your broker
   account, so there is no other venue to try."*), so this introduces no new word.
2. **The venue-specific noun is carried by a gated bullet, not by a branch.** `fix[1]` names
   the investor (read-only) password behind `{ kind: "venueIs", venue: "mt5" }`. An **absent**
   venue **suppresses** that bullet (fail toward saying less), which is the correct default:
   a bullet naming one venue, rendered with the venue unknown, is a specific claim about a
   user we cannot identify.
3. **No symmetric negative bullet is authored, and that is deliberate.** There is no
   "everywhere except MT5" requirement kind today, and the two ways to fake one are both
   wrong: reusing the `substitutable` capability to mean "has an API key" would be a
   capability name that lies about what it measures, and a per-code equality branch inside
   `formatKeyError` is the instance-not-class defect this repo has already paid for. The
   neutral bullet `fix[0]` is true for all six venues, so the negative arm is not needed.
   ⭐ If the planner wants a symmetric per-venue noun anyway, the **only** authorised path is
   a new capability with an honest name (e.g. "the credential is a self-issued key pair"):
   one member in `VenueCapabilityName`, one entry in `VENUE_CAPABILITY_PREDICATES`, one
   field on `VenueCapabilities`, one predicate in `closed-sets.ts` — and **no new call site**.

**Venue casing, if a venue name is ever interpolated by a later change:** `EXCHANGE_DISPLAY`
(`src/lib/closed-sets.ts`) is the one lowercase-code → label source ("OKX", "sFOX", "MT5"),
reached through `exchangeDisplayName()` in `AllocatorSyncStatus`. ⛔ Never `titleCase()` a
venue code directly — that is the shipped defect that rendered "Sfox". **This phase
interpolates no venue name in either new string**; the pointer exists so a later change does
not re-derive it.

### 4. ⚠️ What each surface is allowed to CLAIM — the two-pipeline constraint

**The measured fact (from `167-RESEARCH.md`, verified by exhaustive grep):** owner-facing
`api_keys.sync_status` / `sync_error` writes happen in exactly **one** job —
`run_poll_allocator_positions_job`, the allocator **holdings** poll. The pipelines that feed
the **factsheet** (`run_sync_trades_job` for ccxt venues; the ledger fan-out for ledger
venues) write **no** `sync_status` at all.

⇒ **A credential can be correctly shown as failed on the exchanges/keys surface while the
factsheet's own surface shows only "stale", with no cause available to it.**

The copy contract that follows from that, and it is binding:

| Surface | MAY claim | ⛔ MUST NOT claim |
|---|---|---|
| S1 owner sync pill + helper | that we could not sign in, **only when a status was actually written for that key** | anything about a strategy whose failure was never written to `api_keys` — the signal is absent, not false |
| S2 wizard validate envelope | what this one validate attempt observed | that the stored credential is invalid; that a retry will help |
| Factsheet `FreshnessChip` / `SeriesRecencyLine` (owner lane **and** public lane) | that the series stopped advancing, toned by age — **unchanged, this phase adds nothing here** | ⛔ a credential cause. No cause signal is written anywhere this surface reads, and D-04 forbids a viewer-dependent field entering the id-keyed cached payload regardless. |

⛔ **No surface may infer a credential cause from staleness alone** (D-02/D-03). Staleness
with no attached credential failure is the honest `unknown` the chip already has a tone for.

---

## 9-State Matrix

DESIGN.md § 9-State Matrix requires every API-key-flow surface to declare behaviour across
nine states, and its exit gate greps the matrix for the three unresolved-cell placeholder
tokens and fails on any hit. ⛔ **The tokens are named in prose and never written here** — the
same class as this repo's CI skip trailer, which fires from inside a sentence denying it, so a
spec that quotes the placeholders reds the very gate it is trying to pass. **Every cell
below is real**, including the cells whose real answer is "structurally unreachable, and here
is why" — an unreachable state is a declared behaviour, not an unfilled one.

### S1 — Owner sync surface (`AllocatorSyncStatus`)

| State | Behaviour |
|-------|-----------|
| **loading** | Existing neutral `Syncing…` pill (U+2026) with the 12×12 `motion-safe:animate-spin` glyph. Helper line **silent**. ⛔ No credential claim renders while a sync is in flight — a claim under a spinner is a claim about a result we do not have yet. |
| **empty** | No key connected ⇒ `AllocatorSyncStatus` is not mounted; `AllocatorExchangeManager` renders its existing add-key affordance. **No new copy.** |
| **error** | The phase's core cell. Pill = the state the chosen D-11 arm produces (see `## D-11 Arm Variance`). Helper = **`CREDENTIAL_FAILED_HELPER`**, authored, ignoring `syncError`. ⛔ Every **non**-credential failure keeps rendering the curated `sync_error` exactly as today — this phase narrows one branch, it does not take over the `error` arm. |
| **partial** | `complete_with_warnings` — existing amber pill "Synced (warnings)", helper = `sync_error`. **Unchanged.** A credential failure never routes here: a failed sign-in is not a partial success, and routing it here would re-introduce a soft-pedalled stall. |
| **success** | `complete` pill "Synced {relative}" (relative time in `.font-metric tabular-nums`), helper **empty**. ⛔ **Binding contract:** the write that moves a key into `complete` must leave no credential text behind — if the chosen D-11 arm stores the cause in a separate column or value, that store is cleared in the **same** write. A stale cause beside a fresh success is the inverse of this phase's own defect. |
| **retry-in-flight** | Pill returns to the neutral `Syncing…`; helper goes **silent**. ⛔ The credential sentence must not persist under a spinner — persisting it would re-assert a cause while the evidence for it is being re-gathered. |
| **stale** | The series stopped advancing but **no credential failure is attached to this key** (the two-pipeline case, §4). Pill renders whatever status was last written — typically `complete` or `idle`. Helper renders **nothing new**. ⛔ The pill MUST NOT claim a credential cause here; the signal is absent, and staleness alone is `unknown`, not "your key is broken" (D-02/D-03). |
| **optimistic** | Owned entirely by the existing `helperOverride` path ("Sync request failed — click Sync now to retry"), set client-side by the manager's add/sync failure handlers. ⛔ **`CREDENTIAL_FAILED_HELPER` is never rendered optimistically** — it renders only from a status **read back** from the server. A client-side guess about a credential is exactly the false blame this phase removes. |
| **offline** | Browser offline ⇒ no fetch ⇒ the last server-read status stays on screen unchanged. ⛔ A failed fetch must never flip the pill into a credential claim; the network between the browser and us says nothing about the credential between us and the venue. |

### S2 — Wizard validate surface (`ErrorEnvelope`)

| State | Behaviour |
|-------|-----------|
| **loading** | Existing submit-busy state on the connect form. No envelope is mounted. |
| **empty** | Required fields blank ⇒ the existing client-side field-guard codes render (`KEY_MISSING_REQUIRED_FIELD` family). The new code is **never** reachable from an empty form — it requires a server-emitted wire code. |
| **error** | The new code's envelope: `role="alert"` shell (`border-negative/30 bg-negative/5 px-4 py-3`), 16px semibold title, `cause` paragraph, numbered `fix[]` list, always-collapsed `<details>` diagnostics with `code` + `correlation_id` in Geist Mono 12px and the ghost "Copy diagnostics" button. **No Retry** (`recoverable: false`). |
| **partial** | **Structurally unreachable.** A validate call returns a verdict or it fails; there is no partial validate result for an envelope to render. Declared so the cell is answered, not deferred. |
| **success** | Envelope unmounts; the wizard advances. No residue of the failed attempt remains on screen. |
| **retry-in-flight** | **Structurally unreachable for this code** — `recoverable: false` means no Retry control exists to put a request in flight. A user who edits the form and submits again produces a **new** validate, i.e. the *loading* cell. That is the intended path and `fix[2]` names it. |
| **stale** | An envelope from a previous attempt is cleared when a new submit starts. ⛔ A rendered envelope must never sit beside a new in-flight attempt — two claims about one credential, one of them out of date. |
| **optimistic** | **None, by construction.** The wizard never advances before the venue answers; there is no optimistic success to roll back and therefore no optimistic error to render. |
| **offline** | A browser-side fetch failure routes to the existing network-failure code path, **not** to this one. ⛔ The new code must be reachable **only** from a server-emitted wire code and never inferred client-side from a failed fetch — inferring it would let a customer's own Wi-Fi drop print a sentence about their credentials. |

---

## Accessibility

DESIGN.md § 9-State Matrix a11y minimums (DESIGN-05), applied to exactly the two strings this
phase authors.

| Property | Contract |
|----------|----------|
| **Which live region** | **S1: the existing helper line**, which already carries `role="status" aria-live="polite"`. Correct by the DESIGN.md rule — a sync-status change is a **non-blocking** state change, and the customer is not blocked from anything while it renders. **S2: the existing `ErrorEnvelope` shell**, which already carries `role="alert"` — correct because a validate failure **blocks** the wizard step the customer is standing on. |
| ⛔ **No second live region** | Neither string adds an `aria-live` node. S1's pill deliberately carries **no** `aria-live` so neutral `idle → syncing → complete` transitions produce zero SR chatter; the new state inherits that and must not break it. |
| **SR announcement text** | The full authored sentence is announced verbatim. It is a complete sentence with a terminating period, so it reads correctly without surrounding context — which is the whole reason the cause and the remedy live in **one** string rather than being split across the pill and the helper. |
| **Contrast** | Asserted in § Color: S1 helper `#64748B` on `#FFFFFF` = **4.85:1**; S2 title/cause on `bg-negative/5` ≥ 7:1; the arm-B pill trio `#B45309` on `#FEF3C7` = **4.55:1**. All ≥ 4.5:1 at 12px. |
| **Keyboard** | No new interactive element ⇒ no new tab stop, no focus-order change. The envelope's existing `<details>` and "Copy diagnostics" button keep their order; every `<button>` stays `type="button"` (prevents accidental submit inside the connect `<form>`). |
| **Colour is never the only channel** | The state is carried by the pill's **text label** and by the helper **sentence**; the fill is redundant reinforcement. This holds under every D-11 arm, including the arms where the phase inherits red. |
| **Motion** | Unchanged. The spinner keeps `motion-safe:animate-spin` (freezes, stays visible, under `prefers-reduced-motion: reduce`). No new animation. |

---

## D-11 Arm Variance

⛔ **D-11 is the planner's `checkpoint:decision`, not this spec's.** Every string above is
identical in all three arms. Only the cells below differ.

| Cell | Arm A — reuse `revoked` | Arm B — mint a new `sync_status` value | Arm C — additive signal beside `sync_status` |
|---|---|---|---|
| **Helper sentence** | `CREDENTIAL_FAILED_HELPER`, unchanged | `CREDENTIAL_FAILED_HELPER`, unchanged | `CREDENTIAL_FAILED_HELPER`, unchanged |
| **Wizard copy** | unchanged | unchanged | unchanged |
| **Pill label** | `"Key revoked"` — **LOCKED, unchanged** | new label, recommended **`"Sign-in failed"`** (14 chars; house length is 11–17) | `"Sync failed"` — **LOCKED, unchanged** |
| **Pill tone** | red, **inherited** (`bg-negative/10 text-negative`), not restyled | **amber**, opaque trio `--color-warning` / `--color-warning-bg` / `--color-warning-border` — the one arm where the tone is actually chosen | red, **inherited**, not restyled |
| **How the helper lands** | ⛔ **Costliest copy cell.** The `revoked` branch already returns `REVOKED_HELPER`, whose text (*"Re-add a read-only key from your exchange."*) is venue-**wrong** for MT5. Rendering the new sentence here is a **reword of a locked constant**, not an extension — it must be a deliberate change with its char-for-char pins moved in the **same** commit, and it must be costed as such in the plan. | Pure **extension**: one new branch in the helper-resolution chain, one new `PILL_STYLES` row, pins moved in the same commit. | Pure **extension**: the `error` branch is **narrowed** — the credential case returns the authored line, every other case keeps returning the curated `sync_error`. |
| **Silent side effect to guard** | `revoked` is a **FILTER**: `HoldingsTable` drops those rows and both ledger-refresh enqueuers exclude them. Routing here **hides the key's holdings and stops enqueuing its refresh**. A UI consequence, arriving silently. | `PILL_STYLES`' unknown-value fallback is a **neutral idle pill** — a partially-rolled-out value renders a broken key as **healthy**. ⛔ The style map and the migration land in the **same** commit, never a follow-up. | None on the pill. Costs a second source of truth to keep in step with `sync_status`. |
| **9-state cells affected** | *error*, *stale* (a filtered-out row disappears from `HoldingsTable` entirely — declare that in the plan) | *error*, *success* (the new value must be cleared on success) | *error*, *success* |

⚠️ Common to **all three arms** and not a differentiator: for a strategy-level (non-holdings)
credential failure there is **no write boundary today at all** (§4). Until one exists, S1's
*stale* cell is the honest answer for those strategies, in every arm.

---

## UI Considerations

Applicable state considerations resolved: **7 covered, 1 backstop, 1 unresolved**

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | owner sync row | ✅ covered | With no key connected the component is not mounted; the manager's existing add-key affordance renders. Declared in the 9-state *empty* cell; no new copy. |
| loading | owner pill / wizard submit | ✅ covered | Existing `Syncing…` pill + spinner (S1) and submit-busy state (S2). The credential sentence is silent in both — 9-state *loading* / *retry-in-flight*. |
| error | both surfaces | ✅ covered | Copy specified verbatim in `## Copywriting Contract` §1 and §2; tone and live region in `## Color` / `## Accessibility`. |
| populated | owner pill | ✅ covered | 9-state *success*: `Synced {relative}`, helper empty, credential store cleared in the same write. |
| partial | owner pill / wizard | ✅ covered | S1 `complete_with_warnings` unchanged and explicitly **not** a credential route; S2 partial is structurally unreachable. Both declared. |
| overflow | owner helper line | ✅ covered | Length budget ≤60 chars declared in `## Typography` against the measured 41/40/45-char house strings; the specified string is 58. |
| zero-one-many | wizard `fix[]` bullets | ✅ covered | `fixRequires` is index-aligned to `fix`; MT5 renders 4 bullets, every other venue 3, an unknown venue 3, and the `preselect` render one fewer. All four counts read as a complete list — no bullet depends on a sibling. |
| long-text | owner helper at 320px / 200% zoom | 🧪 backstop | The helper is a fixed authored string in a right-aligned flex column; at 320px or 200% text zoom it wraps. Wrapping is acceptable (it is a caption, not a table cell) but unverified at those widths this session. Held-out visual check owed. |
| overflow | wizard `cause` paragraph at 320px | ⚠ unresolved | The `cause` is longer than most entries in the table. `ErrorEnvelope`'s `px-4 py-3` shell reflows, and the wizard is CSS-first responsive since Phase 46, so no horizontal overflow is expected — but no measurement was taken. Planner treats as an assumption. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none — shadcn is not initialised in this project | not applicable |
| third-party | **none declared** | not applicable — no registry is consumed, so no vetting gate is owed |

No third-party registry, block, or component is introduced by this phase. `@radix-ui/react-tabs`
is a pre-existing repo dependency and is not reached by either in-scope surface.

---

## Open Questions

Named honestly rather than invented — a named open question beats a confident invention.

1. **The `WizardErrorCode` id itself.** `KEY_SIGN_IN_FAILED` is a recommendation, not a
   decision: code ids are stable wire contract and key PostHog `wizard_error { code }`
   events. The planner owns the id; the copy above is portable to any id chosen.
2. **`docsHref` has no venue-neutral deep anchor.** `/security` today offers
   `#readonly-key`, `#regenerate-key`, `#egress-ips`, `#sync-timing`, `#draft-resume`,
   `#csv-format` — all API-key-shaped. An MT5-credential section would earn a specific
   anchor, and `docsHref` cannot be venue-gated. Out of this phase's scope; bare `/security`
   is the correct value until such a section exists.
3. **The existing amber pills measure below 4.5:1.** `bg-warning/10 text-warning` at 12px
   (`rate_limited`, `complete_with_warnings`) lands ≈4.2–4.4:1 by the method stated in
   `## Color`. Shipped, pre-existing, and out of scope here (it would mean restyling a locked
   map). Recorded so it is not lost; it is the same class as the red-vs-amber divergence
   between `AllocatorSyncStatus` and `HoldingsTable` noted in the same section.
4. **Whether `"— sync will retry automatically."` also reaches a surface this spec does not
   cover.** That copy family lives in the Python allocator-positions module and is written
   into `sync_error`, which S1 renders. If any other reader of `sync_error` exists, it
   inherits the same sentence and this spec does not govern it. Not measured this session.
5. **Could not settle: whether the validate arm stores anything.** Several sibling entries
   reassure the reader *"Your key was not stored and nothing was submitted."* That sentence
   is **deliberately absent** from §2's `cause` because it was not measured for this arm. If
   the planner measures that the transient validate arm stores nothing, appending the house
   phrasing verbatim is a correct and welcome addition — with the measurement cited.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS

**Approval:** pending
