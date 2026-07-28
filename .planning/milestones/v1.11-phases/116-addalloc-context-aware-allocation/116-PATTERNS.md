# Phase 116: ADDALLOC — context-aware "+ Allocation" - Pattern Map

**Mapped:** 2026-07-18
**Files analyzed:** 3 modified (no net-new files) + 1 test
**Analogs found:** 3 / 3 (all in-repo, pre-existing — this is a REWIRE phase)

> This phase authors **no new component**. Every overlay, host pattern, and copy
> voice already ships. PATTERNS.md therefore maps each modified file to the
> *existing sibling it must copy state-ownership / mount / a11y posture from* —
> not to a distant analog. The "analog" for a rewire is the current call site.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | container / overlay-host | event-driven (click → per-tab dispatch) | its own sibling `ScenarioComposer.tsx` (owns `browseOpen`/`contributeOpen` state today) | exact (lift-in-place) |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.tsx` | component (dead-end remedy) | request-response (link → route) | `ScenarioComposer.tsx:3603` / `OnboardingBanner.tsx:77` / `EmptyState.tsx` (canonical `/profile?tab=exchanges` CTA) | exact |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx` | test | assertion (href + copy) | itself (line 108 pins the stale `/portfolios` href) | exact |

**No overlay is authored.** The two mount targets already ship and are already
DESIGN.md-conformant:
- `ContributionWizardOverlay.tsx` — Holdings/Overview "+ Allocation" target.
- `StrategyBrowseDrawer.tsx` — Scenario "+ Strategy" target.

The rewire is: (1) make the header button label + action + aria-label read from
`activeTab`; (2) **lift** the `ContributionWizardOverlay` open-state out of the
scenario-only `ScenarioComposer` up to `AllocationsTabs` so it is reachable on
Holdings/Overview; (3) swap the `OptimizerPanel` dead-end link + its test.

---

## Pattern Assignments

### `AllocationsTabs.tsx` (container / overlay-host, event-driven)

**Analog (state ownership to copy):** `ScenarioComposer.tsx:847-853` + its two mount
sites (`:3618-3644`, `:4872-4899`). The composer already owns exactly the
open-state and the Browse→"Add your own"→wizard handoff this phase needs — but it
is lazy-mounted **scenario-tab-only** (`AllocationsTabs.tsx:838` gates
`{activeTab === "scenario" && … <ScenarioTabContent/>}`), so on Holdings/Overview
the overlay host does not exist. The wizard open-state must be lifted to
`AllocationsTabs` (or a tab-agnostic host it renders unconditionally).

**The bug being fixed** (`AllocationsTabs.tsx:756-766`):
```tsx
{/* D-20 — primary "+ Allocation" header button. Routes to the
    Scenario tab via the same changeTab mechanism the tabs use, so
    URL + tab state stay in sync. */}
<button
  type="button"
  onClick={() => changeTab("scenario")}          // ← wrong action on Holdings/Overview
  className="ml-1 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
  aria-label="Add allocation — open Scenario tab"  // ← mislabel: never "open Scenario tab"
>
  + Allocation
</button>
```

**`activeTab` is already derived — branch on it, add no new state** (`:290-307`, `:382`, `:462-468`):
```tsx
function parseTab(raw: string | null): TabKey { /* URL → TabKey; default "overview" */ }
// inside the component:
const searchParams = useSearchParams();
const activeTab: TabKey = parseTab(searchParams.get("tab"));   // :382 — no local activeTab state
const changeTab = (key: TabKey) => {                            // :462 — router.replace, scroll:false
  const params = new URLSearchParams(searchParams.toString());
  if (key === "overview") params.delete("tab"); else params.set("tab", key);
  const qs = params.toString();
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
};
```
Per-tab dispatch table (from UI-SPEC §Context-Aware Label):
| `activeTab` | Label | Action | aria-label |
|-------------|-------|--------|------------|
| `scenario` | `+ Strategy` | open `StrategyBrowseDrawer` | `Add strategy — open the strategy picker` |
| `holdings` | `+ Allocation` | open `ContributionWizardOverlay` | `Add allocation — connect an exchange or upload a CSV` |
| `overview` | `+ Allocation` | open `ContributionWizardOverlay` | `Add allocation — connect an exchange or upload a CSV` |

> Note on the Scenario branch: on `?tab=scenario` the `StrategyBrowseDrawer`
> already lives inside `ScenarioComposer` (`:4872`) driven by `setBrowseOpen`.
> Two clean options — (a) keep `+ Strategy` doing `changeTab("scenario")` +
> signalling the composer to open Browse, or (b) host Browse at the tab level
> too. The planner picks; the Holdings/Overview wizard lift is the hard part.

**State-ownership pattern to copy** (`ScenarioComposer.tsx:847-853`):
```tsx
const [browseOpen, setBrowseOpen] = useState(false);
// onAddOwn closes Browse + opens the wizard; the wizard's onSuccess closes it +
// REOPENS Browse (refetch-on-open surfaces the freshly-contributed private row).
const [contributeOpen, setContributeOpen] = useState(false);
```

**Mount pattern to copy** (`ScenarioComposer.tsx:3637-3644`; identical at `:4891`):
```tsx
<ContributionWizardOverlay
  isOpen={contributeOpen}
  onClose={() => setContributeOpen(false)}
  onSuccess={() => { setContributeOpen(false); setBrowseOpen(true); }}
/>
```
On Holdings/Overview there is no Browse to reopen, so the tab-level mount is
simpler: `onClose`/`onSuccess` both just set `contributeOpen=false`. The overlay
is trigger-agnostic by design (see its header comment `:3-27`: "Phase 116
('+ Allocation') mount — all they do is control `isOpen`").

**Focus-return (UI-SPEC §Focus/Keyboard):** the host that owns `contributeOpen`
must, on close, return focus to the triggering header button. The overlay itself
pulls focus IN on open (`ContributionWizardOverlay.tsx:72` `panelRef.current?.focus()`)
but does NOT restore focus to the trigger — that is the host's job because the
trigger lives in `AllocationsTabs`, not in the overlay. Keep a `ref` to the
`+ Allocation` button and `.focus()` it in the `onClose` handler.

---

### `OptimizerPanel.tsx` (component, request-response) — ADDALLOC-04

**Analog:** the canonical allocator connect-exchange CTA, already used verbatim at
`ScenarioComposer.tsx:3603-3608`, `OnboardingBanner.tsx:77`, `EmptyState.tsx`,
`page.tsx`. Copy that href + the secondary-button treatment.

**The dead-end being fixed** (`OptimizerPanel.tsx:103-108`, inside the 0-portfolio gate `:95-111`):
```tsx
<Link
  href="/portfolios"                              // ← manager-only; allocator gets redirect()-bounced (ROLE-02)
  className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-page"
>
  Create portfolio →
</Link>
```

**Replacement (UI-SPEC §Copywriting Contract):** keep the SAME secondary treatment
(`border border-border bg-white text-text-primary rounded-lg` — deliberately NOT
`bg-accent`, so it does not compete with the primary CTA), swap href + copy:
- heading: `Simulate Impact needs a live portfolio`
- body (`text-small text-text-secondary`): `Connect a read-only exchange API key to build your allocation, then Simulate Impact models new strategies against it.`
- CTA: `Connect Exchange →`, `href="/profile?tab=exchanges"`

**Canonical target href to copy** (`ScenarioComposer.tsx:3603-3608`):
```tsx
<Link href="/profile?tab=exchanges" className="… bg-accent … text-white …">
  Connect Exchange →
</Link>
```
(Use the *secondary* border/white classes already on the OptimizerPanel link, not
the accent variant — see UI-SPEC §Color: the remedy is intentionally non-accent.)

---

### `OptimizerPanel.test.tsx` (test) — MUST update in lockstep

**Analog:** itself — the 0-portfolio gate test (`:90-111`).

**Assertion that currently pins the dead-end** (`:107-108`):
```tsx
const create = screen.getByRole("link", { name: /Create portfolio/i });
expect(create).toHaveAttribute("href", "/portfolios");
```
Rewrite to assert the new remedy: `getByRole("link", { name: /Connect Exchange/i })`,
`toHaveAttribute("href", "/profile?tab=exchanges")`, plus `getByText` for the new
heading + body copy. This is a Rule-9 intent test — it encodes *why* (no
manager-only dead-end for an allocator), so pin the honest copy, not just the href.

---

## Shared Patterns

### Overlay host contract (createPortal + role="dialog", no full focus-trap)
**Source:** `ContributionWizardOverlay.tsx:56-155` and sibling `StrategyBrowseDrawer.tsx:218-247, 371-404`.
**Apply to:** the lifted wizard mount in `AllocationsTabs`.
Both siblings share the same posture — copy it, do not invent:
```tsx
// Esc + reset ABOVE the !isOpen early return (hooks run unconditionally):
useEffect(() => {
  if (!isOpen) { /* reset */ return; }
  panelRef.current?.focus();                        // pull focus INTO dialog (WCAG 2.4.3)
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [isOpen, onClose]);
if (!isOpen) return null;
if (typeof document === "undefined") return null;   // SSR guard
return createPortal(<div role="dialog" aria-modal="true" aria-label="…"
  className="fixed inset-0 z-[200] … bg-[rgba(15,23,42,0.5)] …" onClick={onClose}>
  <div ref={panelRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>…</div>
</div>, document.body);
```
Deliberately **no full Tab-trap** (matches `ScenarioCommitDrawer` precedent, per
overlay header comment `:65-71`). Do not add one in this phase.

### WizardClient reuse contract (do NOT fork a slimmer variant — CONTEXT lock)
**Source:** `strategies/new/wizard/WizardClient.tsx:56-90, 144-150` consumed at `ContributionWizardOverlay.tsx:142-149`.
**Apply to:** any wizard mount. The overlay already wires the correct props:
```tsx
<WizardClient
  key={source}                  // remounts on CSV↔API toggle (overlay owns toggle, no URL keying)
  entryContext="contribution"   // NOT "manager" — invokes onSuccess/onClose instead of navigating
  sourceOverride={source}       // "api" | "csv"; wins over ?source= (Pitfall 3)
  initialDraft={null}           // fresh wizard every open
  onSuccess={(id) => onSuccess?.(id)}
  onClose={onClose}
/>
```
Reuse `ContributionWizardOverlay` as-is; the Holdings/Overview lift changes WHERE
it mounts, not WHAT it renders.

### Canonical allocator connect-exchange route
**Source:** `/profile?tab=exchanges` — established at `ScenarioComposer.tsx:3604`,
`OnboardingBanner.tsx:77`, `EmptyState.tsx`, `page.tsx`.
**Apply to:** every "connect an exchange / add real data" CTA this phase touches
(the ADDALLOC-04 remedy). Never `/portfolios` for an allocator (ROLE-02 bounce).

---

## No Analog Found

None. Every target is a pre-existing in-repo primitive. This is a rewire, not a
net-new build — the planner should reference the exact call sites above, not
RESEARCH.md generic patterns.

---

## Wiring Seam (the one non-trivial rewire — planner: size this correctly)

The `+ Allocation` button lives in `AllocationsTabs.tsx:759`, but today **both**
overlays mount inside `ScenarioComposer.tsx` (local `browseOpen`/`contributeOpen`,
`:847-853`), which `AllocationsTabs.tsx:838` renders **only** when
`activeTab === "scenario"`. Therefore:

- Scenario tab: the overlays are already reachable (composer is mounted).
- Holdings / Overview: `ScenarioComposer` is **not rendered** → the
  `ContributionWizardOverlay` has no host → the button cannot open it without a
  lift.

**Fix shape:** host `contributeOpen` + the `<ContributionWizardOverlay/>` in
`AllocationsTabs` (or a small tab-agnostic host it always renders), triggered by
the header button on `holdings`/`overview`. The overlay is trigger-agnostic
(header comment `:3-27`), so no overlay change is needed — only relocation of the
open-state and a focus-return-to-trigger on close. Visual/interaction contract is
unchanged either way (UI-SPEC §Wiring seam).

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/` (+ its `components/`),
`src/app/(dashboard)/strategies/new/wizard/`.
**Files scanned:** AllocationsTabs.tsx, ScenarioComposer.tsx, ContributionWizardOverlay.tsx,
StrategyBrowseDrawer.tsx, OptimizerPanel.tsx, OptimizerPanel.test.tsx, WizardClient.tsx,
OnboardingBanner.tsx, EmptyState.tsx.
**Pattern extraction date:** 2026-07-18
