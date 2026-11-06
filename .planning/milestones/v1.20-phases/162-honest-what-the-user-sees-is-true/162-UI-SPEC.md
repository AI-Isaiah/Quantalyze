---
phase: 162
slug: honest-what-the-user-sees-is-true
status: approved
shadcn_initialized: false
preset: none
created: 2026-08-25
---

# Phase 162 — UI Design Contract

> Visual and interaction contract for Phase 162 (HONEST — What the user sees is true).
> This phase's subject IS interface honesty: every contract below is a promise that a
> rendered element cannot claim something the data underneath contradicts. Design
> decisions here are correctness decisions, not taste decisions.
>
> **DESIGN.md governs.** Every visual section inherits DESIGN.md unchanged and names only
> the tokens/rules this phase's surfaces actually use, with the DESIGN.md rule cited.
> No restyle of any existing surface is in scope (CLAUDE.md Rule 3 — Surgical Changes).
>
> Founder decisions D-162-1..4 (162-CONTEXT.md) are binding and are NOT re-litigated here;
> this contract fills only the visual/interaction gaps those decisions delegated
> ("DESIGN.md governs the visual. This is UI-SPEC territory" — D-162-2 fence).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — DESIGN.md is the canonical design system (Tailwind v4 `@theme` tokens in `src/app/globals.css`, drift-gated by `tests/a11y/design-token-drift.test.ts`). No `components.json`; shadcn init would violate the locked three-voice/token system and is NOT proposed (same call as 161-UI-SPEC, checker-approved). |
| Preset | not applicable |
| Component library | in-house — this phase touches only existing components: `FreshnessChip` (FactsheetView), `WizardErrorEnvelope`/`ErrorEnvelope`, `SyncBadge`, `StrategyTable`, `StrategyGrid`, `PortfolioEquityCurve`, `ScenarioComposer` detail panel, `ContributionWizardOverlay`, `ConnectKeyStep`. One NEW sub-state (saved-key summary inside the connect step) — composed from existing primitives, no new component family. |
| Icon library | none — semantic glyphs `⚠ — · × ✓` only, per DESIGN.md § AI-Slop Ban |
| Font | Instrument Serif (display) / DM Sans (interactive+body) / Geist Mono (data) — three voices, fixed roles, unchanged (DESIGN.md § Typography) |

---

## Spacing Scale

Inherited verbatim from DESIGN.md § Spacing (base unit 4px). Declared here only because
the template requires it; this phase introduces NO new spacing values.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| 1 | 4px | badge/chip internal gaps (`gap-1.5` = 6px is an existing Tailwind step used by FreshnessChip/SyncBadge — pre-existing, not new) |
| 2 | 8px | inline element spacing |
| 3 | 12px | chip padding, small stacks |
| 4 | 16px | envelope padding (`px-4 py-3`, existing ErrorEnvelope contract) |
| 6 | 24px | section gaps (`mt-4`/`mt-6` around wizard envelope — existing) |
| 8 | 32px | layout gaps |
| 12 | 48px | major section breaks |

Exceptions: none new. `--space-grid-gap` (10px) is not touched by this phase.

---

## Typography

**Line-height (new elements):** Tailwind default `leading` inherited — no new
line-height values. The caption/small/micro lines added by this phase are single-line
in their normal state; if the recency line or the `{n} of {m}` caption wraps at a
narrow viewport, inherited leading applies. Declared explicitly so a future reader
cannot mistake silence for an undecided value.

Inherited from DESIGN.md fluid type spine (`--text-*` tokens; raw px is lint-`error`
repo-wide). Roles this phase's new/changed elements use — exactly 2 weights (400/600):

| Role | Token / Size | Weight | Voice | Used by |
|------|--------------|--------|-------|---------|
| Step heading | `text-h3` (16→18px) | 600 | DM Sans | wizard failure-envelope step heading (existing, unchanged) |
| Envelope title | `text-base` 16px | 600 | DM Sans | ErrorEnvelope title (existing DESIGN-02 contract, unchanged) |
| Body / notes | `text-small` (13→14px) | 400 | DM Sans | preselect summary body, curve caption alternatives |
| Caption | `text-caption` (12→13px) | 400 | DM Sans | **NEW recency line**, **NEW curve-coverage caption**, drawer metrics-absent note (existing `text-xs` tier) |
| Micro eyebrow | `text-micro` (10→11px) | 400 | Geist Mono, uppercase, tracked `0.18em` (eyebrow std) | **NEW "SAVED KEY" eyebrow** in preselect summary; FreshnessChip eyebrow (existing) |
| Data cells | `.font-metric` tabular-nums | 400 | Geist Mono | all metric values and em-dash cells (existing Numbers Contract) |

---

## Color

Inherited from DESIGN.md § Color. 60/30/10 as deployed app-wide:

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | #F8F9FA (`bg-page`) | page background |
| Secondary (30%) | #FFFFFF (`bg-surface`) + #E2E8F0 hairlines | cards, panels, tables, light rail |
| Accent (10%) | #1B6B5A | reserved list below |
| Destructive/negative | #DC2626 | hard errors, permanent failures ONLY |
| Warning | #B45309 (+ #FEF3C7/#FDE68A chip surface) | recoverable states ONLY (owner "Syncing" chip — existing) |
| Muted | #64748B (`text-text-muted`) | honest-empty, steady-state, all NEW disclosure lines |

**Accent reserved for (explicit list, this phase):** "Finish setup →" link (existing),
"View factsheet →" link (existing), primary wizard buttons incl. NEW "Continue with this
key", chart strategy/portfolio lines (existing `#1B6B5A`), focused-input borders. Nothing
new gains accent.

**Semantic-color gates (normative, DESIGN.md — load-bearing for this phase):**
- Tone renders ONLY on finite values. An em-dash cell is colorless.
- **Every NEW element in this phase is colorless (muted ink):** the recency line, the
  curve-coverage caption, the metrics-absent note, the saved-key summary. None of them is
  an error, a warning, or a success — they are neutral facts. Red on absence is forbidden;
  amber is not earned (nothing here recovers on its own or via one disclosed click).
- Table color stays **sign-only** on finite values (DESIGN.md / v1.11 codification):
  `signColor` on signed returns, `magnitudeColor` (neutral) on CAGR/Sharpe — unchanged.

---

## Copywriting Contract

Voice rules (DESIGN.md § Voice): declarative sentence-case; state limitations with the
threshold/number attached; no adjectives where a number exists; active voice.

| Element | Copy |
|---------|------|
| Primary CTA | "Continue with this key" (HONEST-06 preselect summary — the only NEW primary CTA this phase) |
| Secondary CTA | "Use a different key" (HONEST-06 — reverts preselect to credential entry) |
| Empty state heading | not applicable — no new empty-state SCREENS; new empty *elements* are specified per-surface in § Per-Surface Contracts |
| Empty state body | per-surface: curve-coverage caption (C-3), metrics-absent note (C-4), recency-line omission rule (C-1) |
| Error state | curated `computation_error` literals (C-2) — problem + next step, never exception prose |
| Destructive confirmation | none new. Draft-delete confirmation (Phase 161 contract) is byte-identical. HONEST-06's "Use a different key" is a pure selection change, NOT destructive, and needs no confirmation. |

---

## Per-Surface Contracts

### C-1 — Series-recency line (D-162-2, HONEST-02) — DECIDED SHAPE

Applies ONLY if the HONEST-02 investigation concludes "genuinely flat" (D-162-2 fence).
Additive: `FreshnessChip` logic, thresholds, tones, and anatomy are byte-untouched.

| Property | Contract |
|----------|----------|
| Test | ⚠️ The recency line and the chip's date line sit adjacent and must render the date IDENTICALLY. Assert this in a test, not only in prose: two formatters on neighbouring lines is precisely the drift the one-formatter-per-surface-family rule exists to prevent, and a divergence here would itself be a small dishonesty (two dates for one fact). |
| Copy | `Track record through {date}` — exact string per D-162-2. `{date}` formatted by the factsheet's OWN formatter (`formatIsoDate`, same as the chip's date line — DESIGN.md Numbers Contract: one formatter module per surface family; never inline a new date format). |
| Data source | max `date` in `strategy_analytics.returns_series` — the D-03-verdict signal ("a column only a real analytics run can advance"). NEVER `computed_at`, NEVER `last_sync_at`. |
| Placement | Inside the factsheet v2 masthead's existing right-aligned freshness block, as a new line DIRECTLY BELOW the FreshnessChip's date line (`FactsheetView.tsx` ~:843-900 region), `mt-1`, right-aligned like its siblings. Beside-the-chip per D-162-2 = same block, stacked (the block is the chip). |
| Typography | `text-caption text-text-muted`, DM Sans, sentence-case. Precedent: `SyncBadge`'s "Synced {ago}" renders recency claims in muted sans, not mono. NOT an uppercase mono eyebrow (that would split D-162-2's fixed copy string across two voices). |
| Color | Colorless — `text-text-muted` only. The line is a neutral dated fact; tone is already carried (and earned) by the chip above it. No dot, no semantic color (DESIGN.md semantic-color gates: tone only on meaning). |
| Unknown date | **The line does not render at all.** No `Track record through —`, no placeholder. Rationale: a claim with no date fails the print test (DESIGN.md generative principle), and the em-dash rule governs metric cells, not sentences. The chip's existing `Computed · not yet` epoch-sentinel state already covers the no-analytics case; a flat-account verdict presupposes a series with an end date, so an unknown date means the premise failed and the honest render is absence. |
| No threshold | The line introduces NO staleness threshold and NEVER demotes/changes the chip's tone (D-162-2: "needs no threshold... existing badge logic is untouched"). Do not add a fourth freshness ladder (research anti-pattern: `computeFreshness` 12h/48h and `FreshnessChip` 3d/7d already disagree — a known inconsistency, out of scope here). |
| A11y | Plain text in normal document flow — screen-reader readable in sequence after the chip, meaning conveyed by words not color. No ARIA needed (static content, not a live state change). |

### C-2 — Failure envelope final shape (HONEST-01, D-162-4)

**Decision the phase_character asked for: the wizard envelope's `Details: {computation_error}` appendix is REMOVED.**
Once writers are curated (D-162-4 strict), the column holds a fixed sentence from a small
curated set that restates the cause — keeping the appendix would double-render curated
copy (the exact duplication that shipped before). `wizardErrors.ts` stays the canonical
source of human copy (DESIGN.md DESIGN-05); operator context lives in the diagnostics
accordion, not in the body.

Final envelope shape (wizard `gate_failed`, `SyncPreviewStep`):

1. **Step heading (h2, outside the envelope):** "We could not verify this strategy" /
   "We could not verify this composite" — existing, unchanged (`text-h3 font-semibold`).
2. **Envelope** (`ErrorEnvelope`, DESIGN.md § Error Envelope contract byte-unchanged:
   `role="alert"`, `rounded-md border-negative/30 bg-negative/5 px-4 py-3`):
   - Title = `wizardErrors` title (16px DM Sans 600, `text-text-primary`).
   - Body = cause sentence + `fix[]` lines (12px DM Sans 400, `#4A5568`). The
     `GATE_ANALYTICS_FAILED` cause no longer gains any `Details:` appendix — the
     `computation_error` column value **never renders inside the wizard envelope**.
   - Retry CTA below body, above accordion, iff `recoverable && onRetry` — unchanged.
   - Diagnostics: always-collapsed `<details>` with `code` + `correlation_id`
     (Geist Mono 12px) + "Copy diagnostics" — unchanged. Raw exception detail belongs in
     logs/Sentry, NOT in the accordion either (the accordion is user-copyable and
     PII-scrubbed, not a raw-exception channel).
3. **Anti-double-render rule (binding):** no string may render as both the envelope
   title and any body line. Curated writer literals must not be string-equal to any
   `wizardErrors` title for codes that can co-occur on the same screen.

Curated writer literals (recommended exact strings — final literals live Python-side
inside the Phase-161 WIZERR fences / curated-message tests; the CONTRACT is the shape:
one fixed sentence naming the problem + one naming the next step, no exception prose,
no `TypeName:` prefixes, no appended scrubbed suffix):

| Writer | Curated copy |
|--------|-------------|
| `classify_exception` unknown arm | "Analytics could not complete due to an unexpected error. Retry the sync." |
| portfolio `_fail` catch-all | "Portfolio analytics could not complete due to an unexpected error. Retry the computation." |
| prefixed-`scrubbed` family (~15 sites, D-162-4) | Each site KEEPS its existing curated prefix sentence and DROPS the appended raw/scrubbed suffix entirely; raw detail goes to logs/Sentry only. |

Portfolio `StaleWarning` (reader): unchanged in structure — it renders the column
verbatim, which post-fix is a curated sentence. "Showing last-good data." remains the
lead sentence (it is true and load-bearing). No reader-side mapping (requirement locks
the writer; mapping at the reader is the recorded anti-pattern).

### C-3 — Equity curves: missing must look missing (HONEST-04)

⚠️ **Stale-artefact clause (checker gap, scrutiny 6).** When the curves are wired, the
hard-coded `equityCurve: null` AND the comment justifying it
(`src/app/(dashboard)/portfolios/[id]/page.tsx:224-227`) must both be REMOVED or replaced.
The comment asserts something that becomes false the moment this contract is satisfied.
A code comment is not a rendered surface, so this sat only in the requirement text — it is
pinned here so the contract itself, not an upstream document, forbids the false comment
surviving beside its own fix.

Per-strategy lines on `PortfolioEquityCurve` (component itself unchanged — it already
skips null/empty curves):

| State | Render |
|-------|--------|
| Success constituent (`isRankableAnalyticsRow` true, series present) | Real wealth curve `{date,value}[]`, thin line, existing `STRATEGY_PALETTE` color, series `title` = strategy name (existing behavior). |
| Failed / non-terminal / absent-series constituent | `equityCurve: null` → **line absent from the chart.** NEVER a flat line at 1.0, never the dead run's stale series, never zeros — a fabricated curve is the exact violation this phase removes (hard constraint 1; STALE-01 gate `isRankableAnalyticsRow` mandatory on this new read path per 162-CONTEXT standing constraint). |
| Disclosure (NEW) | When ≥1 constituent lacks a rankable curve, render ONE caption line below the chart: `Equity curves shown for {n} of {m} strategies — {m−n} without computed analytics are omitted.` — `text-caption text-text-muted`, colorless, left-aligned with the chart card content. Voice rule: state the limitation with the number attached. When `n === m`: no caption (nothing to disclose). When `n === 0`: caption still renders (composite line only — existing behavior — plus the caption). |
| Loading | none new — the series is resolved server-side in the RSC before render; the page's existing loading skeleton covers it. No client spinner. |
| A11y | Caption is plain text (SR-readable); the chart's absence-of-a-line is NOT the only signal — the caption is the accessible disclosure. Per-constituent status detail remains on the existing constituent rows (FreshnessBadge / stale warnings), unchanged. |

### C-4 — Drawer-added metrics: three states, none of them zero (HONEST-05)

`ScenarioComposer` detail panel, drawer-added legs, after `/api/strategies/[id]/returns`
is widened to co-serve `cagr`/`sharpe` (withheld for non-rankable rows — same
`isRankableAnalyticsRow` predicate as the series, per 162-CONTEXT standing constraint):

| State | Render |
|-------|--------|
| In flight (fetch not settled — `addedMetricsById[id]` **undefined**) | CAGR/Sharpe cells render `—` (`.font-metric text-text-muted`, Numbers Contract). **NO metrics-absent note** — the note is a settled claim and must not flash during load. Distinguish undefined ("not asked/answering") from settled-null, mirroring the overlay's documented `undefined`-vs-`null` discipline. |
| Settled, metrics present | Real values, existing formatting: CAGR `formatPercent(…, 1)` signed, Sharpe 2dp `formatNumber` — Numbers Contract, `.font-metric`. Neutral ink (magnitude metrics, sign-only color rule). |
| Settled, BOTH null (failed row / no analytics — route withheld them) | `—` in both cells + the absence note. **Note copy REVISED (existing copy becomes false):** the current note ("Metrics not available in the composer — open the factsheet for full detail.") and its "PERMANENT metrics statement" comment claim structural unreachability that this phase removes. New note: `No computed metrics for this strategy — open the factsheet for detail.` Same slot, same `text-xs text-text-muted`, same single-note discipline (one sentence naming the state; the factsheet link remains the panel's only accent element per 152-UI-SPEC Contract 2). |
| Settled, exactly ONE null | `—` beside its live sibling, NO note (existing Phase-152 rule: the note is earned only when BOTH are missing). |
| Fetch error | ⚠️ AMENDED 2026-08-26 — this row was WRONG and is the defect a silent-failure audit caught (B-1). Treating a fetch error as settled-absent makes the panel state "No computed metrics for this strategy", a claim about a strategy the request never reached. A seam fault is a settled absence of an ANSWER, not of metrics. Correct contract: a THIRD state `unavailable` — em-dash + a note that attributes nothing ("We could not load metrics for this strategy right now"). Never zeros, never stale neighbors, no red — absence is not an error (DESIGN.md gates). Purge-on-remove follows the `addedProvenanceById` discipline. |

### C-5 — "Finish setup →" preselect affordance (HONEST-06, D-162-3)

The user must SEE which key was chosen and be able to change it. Preselect means REUSE
of the existing `api_keys` row — never a prefilled credential form (the measured
KEY_ORPHANED unwinnable loop; a prefilled form still re-POSTs and still refuses).

**Saved-key summary state** — replaces the credential-entry form inside the connect step
when the overlay is opened with a preselected key:

| Property | Contract |
|----------|----------|
| Anatomy | A data-panel region (square, flat, hairline-bordered — DESIGN.md Cards-vs-Data-panels: this is document content, not an interactive card) containing: eyebrow `SAVED KEY` (Geist Mono uppercase, `text-micro`, tracking `0.18em` eyebrow-std, `text-text-muted`); identity line `{Exchange label} — {key label}` (`text-small` DM Sans 400 `text-text-primary`; exchange from the server-formatted `exchangeLabel`, key label = the user's nickname); NO masked credential fields, NO fake dots — rendering placeholder secrets is fabricated data. |
| Primary CTA | `Continue with this key` — `Button` primary (accent bg), proceeds on the reuse path (draft-resume when a live draft exists; use-existing-key server path for orphans per D-162-3). |
| Change affordance | `Use a different key` — text button (`text-small text-accent underline underline-offset-2`, matching the existing "Finish setup →" link treatment), directly below/beside the summary. Reverts to the normal blank credential-entry form (preselect dropped). Switching remounts cleanly via the overlay's existing `key={…}` idiom — the preselected key id joins the remount key. |
| Entry | "Finish setup →" placeholder-row button (existing accent link, unchanged visually) now carries the row's key id: `onFinishSetup(keyId)`. The placeholder row already displays exchange + key label, so what the user clicked is what the summary shows — same two fields, same server-formatted labels. |
| Long key labels | Truncate with `title=` recovery carrying the full nickname (DESIGN.md Phase-52 rule: always the real value, never a fabricated placeholder). |
| Populations | (a) key with live draft → summary + draft-resume (existing plumbing); (b) orphaned active key → summary + use-existing-key path (NEW server path, D-162-3 full — carries the ADR-0001/0003 service-role boundary review, a planner/security concern not a visual one); (c) mid-sync key → existing pending chip; "Finish setup →" does not render for it (pinned by `StrategyTable.pending-chip.test.tsx`), so no preselect state needed. |
| A11y | The selected key is conveyed by TEXT (eyebrow + identity line), never color alone. Focus lands on the summary region's primary CTA when the step mounts with a preselect (DESIGN-05 focus-management rule: focus moves to the first interactive control of the step). Both buttons carry their visible labels as accessible names. |
| KEY_ORPHANED copy | Once the reuse path exists, the wizard should no longer ROUTE an owner clicking "Finish setup →" into the KEY_ORPHANED refusal at all. The refusal copy itself (including its "email security@…" fix line) stays for the residual non-owner/anonymous population — copy changes to it are Phase-161-fenced and out of this contract's scope unless the planner finds the fix[] now lies for a reachable population. |

### C-6 — Example rows during and after recompute (HONEST-03, D-162-1)

| State | Discovery render (public) |
|-------|--------------------------|
| DURING recompute (in-flight, `computing`) | **Exactly the current failed-state render, by design:** metric cells `—` (shaped by `shapeRowAnalytics`), NO SyncBadge, NO "Syncing" chip. The owner-only Syncing chip is gated `visibility === "owner-all-statuses"` and the 149-UI-SPEC invariant is explicit: "a PUBLISHED row awaiting a recompute must not grow a chip on /discovery". Do NOT add a public in-flight affordance — public surfaces stay byte-identical during the repair. The in-flight state is thus indistinguishable from honest absence on public surfaces, which is correct: the claim "—" (no data) is true in both. |
| AFTER recompute (terminal success) | KPI cells populate with real values (sign-only color rule); rank/percentile render per the computed-cohort gates (Phase 159). |
| SyncBadge on example rows (class guard) | **Contract: `is_example` rows never render `SyncBadge`, regardless of status** — the "Example" chip already carries their identity, and a sync-recency claim on demo seeds is the surface that went stale for three months. D-162-1 repairs the DATA; this guard makes the requirement immune to the demo rows drifting stale again (close-the-class discipline). Cover BOTH render paths — `StrategyTable` and the ungated `StrategyGrid` (no page consumer at HEAD, but guard it or the shaper) — or enforce in `shapeRowAnalytics` once. Marked as this contract's recommended-required default; if the planner finds a conflict (e.g. a founder surface that depends on example sync dates), surface it, don't blend. |
| Fence (D-162-1) | If rows cannot be recomputed → unpublish and say so. NEVER synthesize values to make a row look computed (hard constraint 1). |

---

## UI Considerations

> Shape-rooted UI *state* coverage. Copy lives in § Copywriting Contract / § Per-Surface
> Contracts; rows reference those contracts rather than restating copy.

Applicable state considerations resolved: 14 covered, 2 backstop, 1 unresolved

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Recency line, date unknown (C-1) | ✅ covered | Line omitted entirely — no `—` sentence, no placeholder; chip's `Computed · not yet` covers the no-analytics case |
| empty | Per-strategy equity curves, 0 rankable constituents (C-3) | ✅ covered | Composite line only + coverage caption ("0 of m"); no fabricated lines |
| empty | Drawer metrics settled-both-null (C-4) | ✅ covered | `—` cells + revised absence note; existing note copy corrected (it becomes false this phase) |
| loading | Drawer metrics fetch in flight (C-4) | ✅ covered | `—` cells, NO note (undefined ≠ settled-null); no zeros, no flash-of-absence-claim |
| loading | Equity curves (C-3) | ✅ covered | Server-resolved in RSC; existing page skeleton; no new client loading state |
| loading | Example rows mid-recompute on public discovery (C-6) | ✅ covered | Byte-identical to failed render: `—` cells, badge-free, no public Syncing chip (149 invariant) |
| error | Wizard failure envelope (C-2) | ✅ covered | Curated title/cause/fix; `Details:` appendix removed; column value never renders in envelope; anti-double-render rule |
| error | Portfolio StaleWarning (C-2) | ✅ covered | Reader unchanged; column now holds curated sentence; "Showing last-good data." lead retained |
| error | Drawer metrics fetch failure (C-4) | ✅ covered | `unavailable` render — em-dash + non-attributing note, NOT settled-absent (amended 2026-08-26, see C-4). No red (absence is not an error, DESIGN.md gates) |
| populated | Recomputed example rows (C-6) | ✅ covered | Real KPIs, sign-only color; SyncBadge suppressed by `is_example` guard; Example chip carries identity |
| populated | Preselect saved-key summary (C-5) | ✅ covered | Exchange + key label as text; no masked fake credentials; focus to primary CTA |
| partial | Exactly one of CAGR/Sharpe null (C-4) | ✅ covered | `—` beside live sibling, no note (existing Phase-152 rule preserved) |
| partial | Some constituents lack curves (C-3) | ✅ covered | Caption states `{n} of {m}` with the omission count — limitation with the number attached |
| long-text | Key nickname in preselect summary (C-5) | ✅ covered | Truncate + `title=` full-value recovery (DESIGN.md Phase-52 rule) |
| zero-one-many | Multiple bare keys → preselect identity (C-5) | 🧪 backstop | Overlay/WizardClient spec must prove the SUMMARY shows the CLICKED row's key (not first-key/last-key) — `{ statement: "Preselect summary renders the clicked key's exchange+label for each of ≥2 bare keys", verification: backstop }` |
| stale | Discovery observation after repair (C-6) | 🧪 backstop | Code-level premise verified; acceptance includes a live/seam observation of discovery per 162-RESEARCH ("verify, don't assume") — `{ statement: "Live discovery renders no Synced badge on example rows and no stale badge anywhere", verification: backstop }` |
| conditional | Whether C-1 ships at all | ⚠ unresolved | Gated on the HONEST-02 investigation's verdict (genuinely flat vs derive gap — D-162-2 fence). Planner must sequence the investigation FIRST and treat C-1 as conditional scope, not assured scope |

<!-- Status vocabulary (locked by probe-core projectTruths):
     ✅ covered   → a plain truth string lifted into must_haves.truths
     🧪 backstop  → a flat scalar { statement, verification: backstop }; at verify time, no explicit
                    evidence → insufficient_spec → human_needed (never a silent pass, #1154)
     ⚠ unresolved → an explicit planner assumption (surfaced, never silently dropped)
     Rows are REPLACED (not appended) on a probe re-run — idempotent. -->

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none — no shadcn, no third-party registries | none | not applicable (no `components.json`; in-house design system; this phase installs no packages — 162-RESEARCH Package Legitimacy Audit: empty) |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
