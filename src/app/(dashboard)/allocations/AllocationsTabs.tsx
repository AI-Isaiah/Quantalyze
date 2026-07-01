"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import { ScenarioStub } from "./ScenarioStub";
import { SavedScenariosList } from "./components/SavedScenariosList";
import type {
  SavedScenarioListRow,
  SavedScenarioOpenRow,
  CompareSelection,
} from "./components/SavedScenariosList";
import { ScenarioComparePanel } from "./components/ScenarioComparePanel";
import type { ScenarioComparePanelProps } from "./components/ScenarioComparePanel";
import type { SavedScenarioRow } from "./components/ScenarioComposer";
import { TweaksProvider, useTweakValue } from "./context/TweaksContext";
import { TweaksToggle } from "./components/TweaksToggle";
import { Tweaks } from "./components/Tweaks";
// Phase 11 / 11-05 — onboarding nudge surfaces (S1 + S2). Both render
// above the existing tab nav when apiKeysCount === 0. Light client
// components — kept as direct imports rather than next/dynamic so they
// hydrate immediately on first paint (no skeleton flash for the nudge).
import { OnboardingBanner } from "./components/OnboardingBanner";
import { MandateQuickSetCard } from "./components/MandateQuickSetCard";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";

// audit-2026-05-07 cluster P (C-0336, M-1045, M-1047) — surface previously
// silent failure paths to the browser console so support has a breadcrumb
// trail. console.warn is non-blocking, runs only on the affected branch,
// and intentionally avoids adding a new telemetry surface (PostHog is
// already addressed via trackUsageEventClient for the picker dispatch).
function warnAudit(tag: string, detail: Record<string, unknown> = {}): void {
  if (typeof console === "undefined") return;
  console.warn(`[AllocationsTabs] ${tag}`, detail);
}

// audit-2026-05-07 cluster P (M-0043 / M-1043 / maintainability MED) —
// do NOT re-introduce a `memo(AllocationDashboardV2)` wrapper here. The
// parent server component does not yet stabilise the payload reference, so
// React.memo's default shallow compare always sees a fresh props identity
// and re-renders. The wrapper was removed in this audit; only restore it
// AFTER the payload reference is stable (and add a test that pins the
// short-circuit), otherwise it ships as misleading optimization signal.

// Phase A6 — Holdings / Outcomes / Mandate / Risk tab panels lazy-load via
// next/dynamic with ssr: false. Together they pull in HoldingsTable +
// HoldingDetail + OutcomeForm + BridgeOutcomeBanner + OutcomesWidget +
// MandateForm + RiskAttribution surfaces, plus their charts and primitives
// — easily ~1500 LOC of code the Overview tab never needs. Deferring them
// from the initial bundle and HTML keeps the first paint of the dashboard
// aligned with the Overview path that >90% of allocators land on.
//
// AllocationsTabs is itself a "use client" component, so the deferred
// chunks hydrate in lock-step with the user's first interaction with
// each non-Overview tab. The fallback below renders a centered skeleton
// strip while the dynamic chunk fetches.
function TabBodyFallback({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading ${label}`}
      className="flex h-64 items-center justify-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div
          aria-hidden="true"
          className="h-2 w-32 rounded bg-[var(--color-border)] animate-pulse"
        />
        <div
          aria-hidden="true"
          className="h-2 w-24 rounded bg-[var(--color-border)] animate-pulse"
        />
        <span className="sr-only">Loading {label}</span>
      </div>
    </div>
  );
}

const HoldingsTabPanel = dynamic(
  () =>
    import("./HoldingsTabPanel").then((m) => ({ default: m.HoldingsTabPanel })),
  { ssr: false, loading: () => <TabBodyFallback label="Holdings" /> },
);

const OutcomesTabPanel = dynamic(
  () =>
    import("./OutcomesTabPanel").then((m) => ({ default: m.OutcomesTabPanel })),
  { ssr: false, loading: () => <TabBodyFallback label="Outcomes" /> },
);

const MandateTabPanel = dynamic(
  () =>
    import("./MandateTabPanel").then((m) => ({ default: m.MandateTabPanel })),
  { ssr: false, loading: () => <TabBodyFallback label="Mandate" /> },
);

const RiskTabPanel = dynamic(
  () => import("./RiskTabPanel").then((m) => ({ default: m.RiskTabPanel })),
  { ssr: false, loading: () => <TabBodyFallback label="Risk" /> },
);

// Phase 10 / 10-06b — full Scenario tab body. L4: dynamic() lives at MODULE
// scope so re-renders don't re-create the dynamic component. The loading
// skeleton mirrors the KpiStrip + chart skeleton shapes to avoid a
// "blank → composer" flash on tab activation. The composer
// pulls in chart + drawer dependencies that the Overview tab never needs;
// keeping it dynamic keeps the Overview-first bundle small.
const ScenarioComposer = dynamic(
  () =>
    import("./components/ScenarioComposer").then((m) => ({
      default: m.ScenarioComposer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-[1440px] py-6">
        {/* KpiStrip skeleton — 5 cells × ~40px */}
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-[40px] rounded-md bg-[rgba(15,23,42,0.04)] animate-pulse"
            />
          ))}
        </div>
        {/* Charts row skeleton — 2 charts × ~280px */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-[280px] rounded-md bg-[rgba(15,23,42,0.04)] animate-pulse" />
          <div className="h-[280px] rounded-md bg-[rgba(15,23,42,0.04)] animate-pulse" />
        </div>
      </div>
    ),
  },
);

// Phase 10 / 10-06b — `allocations.ui_v2` flag handler.
//
// audit-2026-05-07 cluster P (H-1188 doc, H-0060 type discriminator)
// — the persisted localStorage key NAME is "allocations.ui_v2" for
// back-compat with shipped opt-outs, but in current main its SCOPE is the
// Scenario tab only (ScenarioComposer vs ScenarioStub in the scenario
// tabpanel below). The Overview / Holdings / Outcomes / Mandate / Risk
// panels are not gated by this flag. Treat any documentation that calls
// it a "broader UI rollback" as stale.
//
// v0.15.7.0 retired V1 / made V2 the default-for-all in production; the
// helper preserves the BRANCH point so an explicit "false" still routes to
// the legacy ScenarioStub for rollback safety. Default behavior (no flag,
// or any value other than the literal string "false") yields V2.
const UI_V2_STORAGE_KEY = "allocations.ui_v2";

// audit-2026-05-07 maintainability MED — the only consumer (the post-mount
// useEffect inside AllocationsTabs) reads "is this an explicit opt-out?".
// Collapsed from a 4-variant discriminator union to a 2-variant
// ("explicit-false" vs "default") so unused branches don't accumulate
// without tests exercising them. C-0336 storage-error breadcrumb is
// preserved; SSR and storage-error paths both collapse to "default" since
// both yield V2 with no rollback. Re-introduce a richer discriminator only
// when a second consumer needs it.
type UiV2FlagState = "explicit-false" | "default";

// B7 — the cross-tab primitive owns the localStorage read; this codec owns the
// coercion. The flag is stored as a plain string ("false" = explicit opt-out;
// absent / anything else = default V2), so a `rawStringCodec` (no JSON, no
// version envelope) folds the raw value to the 2-variant discriminator. A read
// failure is handled by the primitive (it returns the `initial` "default" and
// emits a fail-loud `[cross-tab] localStorage read threw` console + Sentry
// breadcrumb tagged with this key — the C-0336 debuggability the old
// readUiV2Flag try/catch provided, now centralized in the primitive).
const uiV2FlagCodec = rawStringCodec<UiV2FlagState>({
  parse: (raw) => (raw === "false" ? "explicit-false" : "default"),
  // The app NEVER writes this key (no setValue is destructured below), so
  // serialize is never a persistence path — it is reached only by the
  // primitive's cross-tab no-op equality check. The two-variant discriminator
  // maps losslessly ("explicit-false"→"false", "default"→"true"), so equality
  // is exact.
  serialize: (state) => (state === "explicit-false" ? "false" : "true"),
});

// Live-refresh polling. Phase 06 D-11 used 5s for active-ingest sync status;
// Phase 07 is a monitoring surface where data changes slowly (daily equity,
// periodic trades) so 30s is enough for a timely read without re-fetching the
// whole `getMyAllocationDashboard` payload 720× per hour on an open tab.
const PERFORMANCE_POLL_INTERVAL_MS = 30_000;

/**
 * Phase 09.1 Plan 02 / D-05 / D-06 — Tabs shell for /allocations.
 *
 * Visible tablist (see VISIBLE_TAB_KEYS):
 *   - Overview (default) — wraps AllocationDashboardV2.
 *   - Holdings — full-width HoldingsTable.
 *   - Outcomes — full-width OutcomesWidget.
 *   - Mandate  — link to /profile?tab=mandate + MandateSnapshot.
 *   - Risk     — curated grid of risk widgets.
 *   - Scenario — ScenarioComposer (V2 default) / ScenarioStub (rollback).
 *     SURF-01 (Phase 21): now a visible tab button; still independently
 *     reachable via ?tab=scenario or the "+ Allocation" header chip.
 *
 * URL state (D-04 / D-05):
 *   /allocations                  → Overview
 *   /allocations?tab=overview     → Overview (param deleted on mount)
 *   /allocations?tab=performance  → Overview (legacy Phase 07 alias; param
 *                                   deleted on mount for clean bookmarks)
 *   /allocations?tab=holdings     → Holdings
 *   /allocations?tab=outcomes     → Outcomes
 *   /allocations?tab=mandate      → Mandate
 *   /allocations?tab=risk         → Risk
 *   /allocations?tab=scenario     → Scenario (now a visible tab — SURF-01, Phase 21)
 *   /allocations?tab=<unknown>    → Overview (D-04 silent fallback)
 *
 * Per VOICES-ACCEPTED f3: `activeTab` is DERIVED from `searchParams` on
 * every render — NOT snapshotted in local component state. This diverges
 * from the ProfileTabs.tsx analog (which has a latent back/forward bug).
 * Here, browser back/forward updates the URL → searchParams changes →
 * re-render → activeTab recomputes → visible tab toggles correctly.
 *
 * Tab clicks call `router.replace(url, { scroll: false })` to update
 * the URL without scrolling; the URL change triggers a re-render which
 * re-derives activeTab. No local state for `activeTab` is kept.
 *
 * Live-refresh polling (Phase 06 D-11 inheritance): 30s router.refresh()
 * while Overview is active AND document.visibilityState is visible.
 * Never polls while on any other tab (no data to refresh per render).
 *
 * Suspense: This component calls `useSearchParams()` which triggers the
 * Next.js 16 CSR-bailout rule — the caller (page.tsx) wraps us in
 * <Suspense fallback={<div />}>.
 */

type TabKey =
  | "overview"
  | "holdings"
  | "outcomes"
  | "mandate"
  | "risk"
  | "scenario";

// Visible tab strip. SURF-01 (Phase 21): Scenario is now a visible tab in
// the strip — it remains independently reachable via ?tab=scenario and the
// "+ Allocation" chip, but it also renders its own button here so allocators
// can discover the scenario surface directly. Overview is the factsheet view
// (full equity curve + factsheet panel layout aggregated across the
// allocator's strategies), so there is no separate Analytics tab.
const VISIBLE_TAB_KEYS: readonly TabKey[] = [
  "overview",
  "holdings",
  "outcomes",
  "mandate",
  "risk",
  "scenario",
] as const;

// audit-2026-05-07 M-1045 (silent-failure-hunter c8) — D-04 says unknown
// values silently fall back to Overview. We keep the user-facing fallback
// (no error UI, no redirect surprise) but log a breadcrumb so support can
// distinguish "user typoed a bookmark" from "marketing shipped a broken
// outbound link". The known legacy alias "performance" and the canonical
// keys are NOT logged — only genuinely unknown non-empty raw values.
//
// audit-2026-05-07 Phase-4 red-team (MED conf 8) — entries are typed as
// `TabKey | "performance"` and derived from `VISIBLE_TAB_KEYS` + the
// routable-but-not-visible "scenario" + the legacy "performance" alias so
// a future TabKey rename can't leave a stale string here that silently
// suppresses `invalid_tab_fallback`. `VISIBLE_TAB_KEYS` is the single
// TabKey-typed source of truth; the spread here keeps the two constants
// in lockstep at compile time. The Set is exposed as `ReadonlySet<string>`
// so `.has(raw)` still accepts an arbitrary search-param string at the
// call site without per-call casts.
const KNOWN_TAB_RAW_ENTRIES: readonly (TabKey | "performance")[] = [
  ...VISIBLE_TAB_KEYS,
  "scenario",
  "performance", // Phase 07 legacy alias — cleaned up by the URL effect.
] as const;
const KNOWN_TAB_RAW: ReadonlySet<string> = new Set<string>(
  KNOWN_TAB_RAW_ENTRIES,
);

function parseTab(raw: string | null): TabKey {
  // Overview is default. Anything else (null, empty, unknown values, the
  // legacy "performance" alias) collapses to "overview" — silent fallback
  // preserves D-04.
  switch (raw) {
    case "holdings":
    case "outcomes":
    case "mandate":
    case "risk":
    case "scenario":
      return raw;
    default:
      if (raw && raw.length > 0 && !KNOWN_TAB_RAW.has(raw)) {
        warnAudit("invalid_tab_fallback", { raw });
      }
      return "overview"; // Phase 07 "performance" URL also lands here.
  }
}

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  holdings: "Holdings",
  outcomes: "Outcomes",
  mandate: "Mandate",
  risk: "Risk",
  scenario: "Scenario",
};

// Tab-button class strings — pulled out of the render JSX so the active /
// inactive delta isn't hidden in two ~200-char ternary branches that share
// ~90% of their characters. The full strings below are byte-identical to
// the previous inlined versions so the Tailwind class order matches the
// dashboard-parity contract.
const TAB_BUTTON_ACTIVE =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-[10px] border-accent text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const TAB_BUTTON_INACTIVE =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-[10px] border-transparent text-text-muted hover:text-text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

const TAB_COUNT_BADGE_ACTIVE =
  "rounded-full bg-accent/15 px-1.5 py-0.5 text-fixed-10 font-mono leading-none text-accent";
const TAB_COUNT_BADGE_INACTIVE =
  "rounded-full bg-page px-1.5 py-0.5 text-fixed-10 font-mono leading-none text-text-muted";

/**
 * NAV-02 (Phase 45) — pure horizontal-scroll math for the <sm tab strip.
 *
 * Given the active tab's content-box left/width and the strip's visible window
 * (scrollLeft + clientWidth), return the strip scrollLeft target that brings the
 * tab fully into view, plus the motion to use, or `null` when it is already
 * visible (the no-op case). This deliberately models ONLY the horizontal axis:
 * the prior `scrollIntoView({ block: "nearest" })` also moved the nearest
 * VERTICAL scroll container, which yanked the page back up to the strip after a
 * user had scrolled down — defeating `changeTab`'s intentional
 * `router.replace(..., { scroll: false })`. Keeping the math pure here makes the
 * reduced-motion branch (WCAG — never animate a forced scroll for reduce users)
 * and the already-visible no-op directly unit-testable without a layout engine.
 */
export function computeTabStripScroll(args: {
  elLeft: number;
  elWidth: number;
  viewLeft: number;
  viewWidth: number;
  prefersReducedMotion: boolean;
}): { left: number; behavior: ScrollBehavior } | null {
  const { elLeft, elWidth, viewLeft, viewWidth, prefersReducedMotion } = args;
  const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";
  if (elLeft < viewLeft) return { left: elLeft, behavior };
  const elRight = elLeft + elWidth;
  if (elRight > viewLeft + viewWidth) return { left: elRight - viewWidth, behavior };
  return null; // already in view — no scroll, and never any vertical movement
}

export function AllocationsTabs(props: MyAllocationDashboardPayload) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Per VOICES-ACCEPTED f3: derive each render — no local state snapshot.
  const activeTab: TabKey = parseTab(searchParams.get("tab"));

// Phase 10 / 10-06b — `allocations.ui_v2` flag drives the scenario panel
  // body. SSR-stable initialization (review-pass P1 fix): start with `true`
  // (matches the SSR helper's server-side default) so the SSR HTML and the
  // first client render agree byte-for-byte; React hydration succeeds without
  // mismatch. The actual localStorage check moves to the useEffect below,
  // which only flips the flag to `false` AFTER hydration completes — this
  // keeps the rollback path reachable while eliminating the hydration error
  // that an inline localStorage read would surface for users who explicitly
  // opted out (raw=="false" on the client, but SSR rendered the V2 path).
  // B7: routed through useCrossTabStorage. The primitive's "deferred"
  // hydration renders `initial` ("default" → V2) on the server AND the first
  // client render, so the SSR HTML and first client render agree byte-for-byte
  // (no hydration mismatch); an explicit-false flag flips the value to
  // "explicit-false" post-mount, keeping the rollback path reachable. This
  // replaces the hand-rolled useState(true) + post-mount setState-in-effect.
  const { value: uiV2State } = useCrossTabStorage<UiV2FlagState>({
    key: UI_V2_STORAGE_KEY,
    initial: "default",
    codec: uiV2FlagCodec,
    sentryArea: UI_V2_STORAGE_KEY,
  });
  const isUiV2 = uiV2State !== "explicit-false";

  // audit-2026-05-07 H-1188 (red-team c8) — the persisted flag's SCOPE is
  // Scenario only in current main; the Overview / Holdings / Outcomes /
  // Mandate / Risk panels remain V2 regardless. Log a breadcrumb when the
  // explicit-false rollback path is hit so support can correlate "I set the
  // flag but my dashboard didn't roll back" tickets. Fires on the
  // post-hydration value, and again only if a cross-tab flip arrives.
  useEffect(() => {
    if (uiV2State === "explicit-false") {
      warnAudit("ui_v2_rollback_scope_scenario_only", {
        storage_key: UI_V2_STORAGE_KEY,
        affected_surface: "scenario",
      });
    }
  }, [uiV2State]);

  // Scroll-safe URL cleanup: if the allocator lands on ?tab=overview
  // (the new default — redundant) OR ?tab=performance (legacy Phase 07
  // alias — bookmark compat), strip it so the canonical URL is
  // /allocations. Runs after render to avoid touching render-phase state;
  // shallow-replace does not trigger another data fetch.
  useEffect(() => {
    const current = searchParams.get("tab");
    if (current === "overview" || current === "performance") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tab");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  // Live-refresh polling — only while on Overview + document visible
  // (Phase 06 D-11 inherited pattern). Never polls on Holdings / Outcomes /
  // Mandate / Risk / Scenario.
  //
  // audit-2026-05-07 M-1046 (red-team c8) — wrap router.refresh in a
  // try/catch + breadcrumb. router.refresh has no AbortController; if it
  // throws (e.g. a route handler 5xx mid-flight, or the user navigates
  // away during the tick) we don't want the interval to silently die.
  useEffect(() => {
    if (activeTab !== "overview") return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      try {
        router.refresh();
      } catch (err) {
        warnAudit("router_refresh_failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }, PERFORMANCE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeTab, router]);

  // Tab change — update URL; the URL change triggers a re-render which
  // re-derives activeTab. No local state for activeTab.
  const changeTab = (key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "overview") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // WAI-ARIA authoring-practices tab pattern: Arrow keys move focus between
  // tabs, Home/End jump to first/last. Tab/Shift-Tab leaves the tablist.
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    holdings: null,
    outcomes: null,
    mandate: null,
    risk: null,
    scenario: null,
  });
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: TabKey) => {
    // Keyboard nav walks VISIBLE_TAB_KEYS. SURF-01 (Phase 21): Scenario is
    // now part of that set (a visible tab), so arrow-nav reaches it for
    // free — no separate keyboard-nav array. It also stays reachable via
    // "+ Allocation" / direct ?tab=scenario URL.
    //
    // Tweaks showOutcomes=Hide path: when the user hides the Outcomes
    // tab via the Tweaks panel, the CSS rule in globals.css drops the
    // button from the visible surface. The keyboard handler ALSO needs
    // to skip it; otherwise ArrowRight from Holdings would focus a
    // display:none button (silent no-op), mutate the URL to
    // ?tab=outcomes, then OutcomesTabRedirectGuard would bounce the user
    // back to Overview a frame later — a visible flicker for sighted
    // users and a focus blackhole for screen-reader users. Read the body
    // attribute the TweaksContext effect maintains.
    const outcomesHidden =
      typeof document !== "undefined" &&
      document.body.getAttribute("data-show-outcomes") === "false";
    const keyboardKeys = outcomesHidden
      ? VISIBLE_TAB_KEYS.filter((k) => k !== "outcomes")
      : VISIBLE_TAB_KEYS;
    const idx = keyboardKeys.indexOf(key);
    if (idx < 0) return;
    let next: TabKey | null = null;
    const len = keyboardKeys.length;
    if (e.key === "ArrowRight") next = keyboardKeys[(idx + 1) % len];
    else if (e.key === "ArrowLeft")
      next = keyboardKeys[(idx - 1 + len) % len];
    else if (e.key === "Home") next = keyboardKeys[0];
    else if (e.key === "End") next = keyboardKeys[len - 1];
    if (next) {
      e.preventDefault();
      changeTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  // NAV-02 (Phase 45) — keep the active tab in view inside the <sm
  // horizontally-scrollable strip. A keyboard arrow-nav or a programmatic tab
  // change can leave the selected tab clipped off-screen; scroll it back into
  // view on every activeTab change. We scroll the STRIP (the role="tablist"
  // scroll container — the tab button's direct parent, pinned by the axe
  // aria-required-children gate) on its horizontal axis ONLY, never the page.
  // The earlier `el.scrollIntoView({ block: "nearest" })` also moved the
  // nearest VERTICAL scroll container, so switching tabs after scrolling down
  // yanked the page back up to the strip — defeating changeTab's deliberate
  // router.replace(..., { scroll: false }). `computeTabStripScroll` returns null
  // when the tab is already visible (and at >=sm where the strip wraps and never
  // overflows), so this is a no-op except when a horizontal correction is
  // actually needed. Honor prefers-reduced-motion: instant ("auto") for reduce,
  // smooth otherwise — never animate a forced scroll for reduced-motion users
  // (UI-SPEC States row). The `typeof ... === "function"` guards keep it safe in
  // environments without getBoundingClientRect / Element.scrollTo / matchMedia
  // (jsdom, older browsers) — the effect no-ops there instead of throwing.
  useEffect(() => {
    const el = tabRefs.current[activeTab];
    const strip = el?.parentElement;
    if (
      !el ||
      !strip ||
      typeof el.getBoundingClientRect !== "function" ||
      typeof strip.scrollTo !== "function"
    )
      return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elRect = el.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const target = computeTabStripScroll({
      // Active tab's left in the strip's CONTENT coordinate space (add back the
      // current scrollLeft so it is comparable to the scrollLeft-based window).
      elLeft: elRect.left - stripRect.left + strip.scrollLeft,
      elWidth: elRect.width,
      viewLeft: strip.scrollLeft,
      viewWidth: strip.clientWidth,
      prefersReducedMotion,
    });
    if (target) strip.scrollTo(target);
  }, [activeTab]);

  // PR3 (dashboard parity) — count badges on Holdings + Outcomes tabs
  // matching the truth screenshot ("Holdings 8", "Outcomes 4"). Counts
  // come straight from the payload arrays already on `props`; no new
  // queries needed.
  // F4b — the Holdings tab's primary surface is now one row per onboarded
  // strategy, so the badge counts strategies (raw exchange positions render
  // in the secondary "Exchange Positions" section, not as the headline count).
  const holdingsCount = props.strategies?.length ?? 0;
  const outcomesCount = props.outcomes?.length ?? 0;
  const tabCount: Partial<Record<TabKey, number>> = {
    holdings: holdingsCount,
    outcomes: outcomesCount,
  };

// audit-2026-05-07 M-1044 (silent-failure-hunter c8) — Export chip
  // navigates to Holdings as a stub; users from Risk/Outcomes/Mandate see
  // their tab change silently. Surface a polite aria-live announcement
  // explaining the redirect. Visually-hidden via DESIGN-bundle .sr-only
  // utility so the design contract is unchanged.
  //
  // audit-2026-05-07 Phase-4 red-team (MED conf 8) — the previous Phase-2
  // fix used a monotonically-increasing zero-width-space (U+200B) suffix to
  // force React to re-render on repeat clicks (Object.is bail-out
  // otherwise). That suffix leaked into the DOM textContent — Select-All,
  // JS clipboard reads, and some VoiceOver virtual-cursor flows surfaced
  // it as N invisible characters per click, breaking downstream string
  // equality / regex / JSON.parse for users who copied a region containing
  // the live message. Replaced with a microtask-clear pattern: set the
  // string to "" first, then queueMicrotask sets the real message. React
  // commits the empty render between announcements so aria-live=polite
  // re-announces without any sentinel characters, and textContent stays
  // equal to the human-readable string for clipboard safety. Also drops
  // the unbounded `exportAnnouncementSeqRef` counter the suffix needed.
  const [exportAnnouncement, setExportAnnouncement] = useState<string>("");

  // PR1 QA — inline header row matching designer-bundle/project/src/app.jsx
  // (lines 460-510): "My Allocation" + entity name on the left, tab list +
  // primary action on the right, all collapsed into ONE flex row separated
  // from the body by a single hairline. Replaces the multi-row sprawl of
  // PageHeader (now removed from page.tsx) + standalone "+ Allocation" row.
  // Entity name reads from props.portfolio.name; falls back to omitting the
  // subtitle if the allocator has no portfolio yet.
  const entityName = props.portfolio?.name ?? null;

  // Phase 11 / 11-05 — onboarding nudge surface predicates.
  //   - S1 (OnboardingBanner) renders when the allocator has zero connected
  //     api_keys (D-02 server-side count). The component itself respects the
  //     sessionStorage dismissal flag (D-03) post-mount.
  //   - S2 (MandateQuickSetCard) renders when (a) S1 is showing AND (b) the
  //     mandate is not yet set (D-04). The card respects its own
  //     sessionStorage Skip flag post-mount.
  // Both surfaces live ABOVE the existing tab nav and do NOT touch tab
  // content — purely additive.
  const showOnboardingBanner = props.apiKeysCount === 0;
  const showMandateQuickSet =
    props.apiKeysCount === 0 && !props.mandateIsSet;

  return (
    <TweaksProvider>
    <div data-allocator-dashboard>
      {showOnboardingBanner && (
        <div className="mb-6">
          <OnboardingBanner />
          {showMandateQuickSet && (
            <div className="mt-3">
              <MandateQuickSetCard />
            </div>
          )}
        </div>
      )}
      <div
        data-allocator-tabstrip
        className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border pb-3"
      >
        <div className="flex flex-col gap-1">
          {entityName ? (
            <p className="text-fixed-10 font-mono uppercase tracking-[0.22em] text-text-muted">
              {entityName}
            </p>
          ) : null}
          {/* Tweaks display-font knob (serif | sans). `.font-display` resolves
              to Instrument Serif by default and flips to DM Sans when the
              user picks Sans via the Tweaks panel — see globals.css. */}
          <h1 className="font-display text-fixed-28 leading-none tracking-tight text-text-primary">
            My Allocation
          </h1>
        </div>
        {/* JOURNEY-03 (a11y) — the row holds the tablist AND two action
            buttons (Export, + Allocation). A role="tablist" may contain ONLY
            role="tab" children (axe aria-required-children, critical), so the
            tablist wraps just the tabs; the actions are siblings in the same
            flex row. */}
        <div className="ml-auto flex items-center gap-1">
          {/* NAV-02 (Phase 45) — CSS-first horizontally-scrollable tab strip at
              <sm so all six surfaces stay reachable on a phone (no tab dropped).
              JOURNEY-03 is preserved: this is the SAME element with the SAME
              role="tablist" and the SAME direct role="tab" children — no role is
              added to any wrapper and the tabs are NOT re-nested (re-nesting would
              re-introduce the critical axe aria-required-children violation the
              comment above warns about; the seeded composer-axe.spec.ts gate
              catches a regression). `flex-nowrap overflow-x-auto` keeps the tabs on
              one scrollable line at <sm; `sm:flex-wrap sm:overflow-x-visible`
              restores the original wrap-on-one-row layout at >=sm. The native
              scrollbar is hidden ([scrollbar-width:none]) and iOS momentum-scrolls
              ([-webkit-overflow-scrolling:touch]); the cut-off tab peeking past the
              right edge IS the scroll affordance — no edge-fade overlay is
              added (DESIGN.md hairline-clean rule). `snap-x` + per-tab `snap-start shrink-0`
              (appended to the parity-pinned TAB_BUTTON_* consts below) snap each
              tab cleanly without compressing labels. */}
          <div
            role="tablist"
            aria-label="Allocation surfaces"
            className="flex flex-nowrap items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
          >
          {VISIBLE_TAB_KEYS.map((key) => {
            const isActive = activeTab === key;
            const label = TAB_LABELS[key];
            const count = tabCount[key];
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[key] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${key}`}
                data-tab-key={key}
                aria-selected={isActive}
                aria-controls={`panel-${key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => changeTab(key)}
                onKeyDown={(e) => handleTabKeyDown(e, key)}
                // NAV-02 (Phase 45) — the parity-pinned TAB_BUTTON_* consts stay
                // byte-identical; the scroll-snap classes are APPENDED here (not
                // reordered into the consts) so the dashboard-parity Tailwind class
                // order is untouched. `snap-start` aligns each tab to the strip
                // start; `shrink-0` keeps labels from compressing in the
                // flex-nowrap scroll container.
                className={`${isActive ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE} snap-start shrink-0`}
              >
                {label}
                {typeof count === "number" && count > 0 ? (
                  <span
                    aria-hidden
                    className={
                      isActive
                        ? TAB_COUNT_BADGE_ACTIVE
                        : TAB_COUNT_BADGE_INACTIVE
                    }
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
          </div>
          <span aria-hidden className="mx-2 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => {
              // Stub: export-CSV / export-PDF flows are owned by the
              // Holdings tab today. Route there until the global export
              // surface lands. audit-2026-05-07 M-1044 — announce the
              // navigation via the live region so screen-reader and
              // keyboard users learn why the surface changed.
              //
              // audit-2026-05-07 Phase-4 red-team (MED conf 8) —
              // microtask-clear pattern replaces the ZWS suffix to avoid
              // leaking invisible characters into clipboard / VoiceOver
              // selection. Clearing to "" first lets React commit an
              // empty render between announcements, then the microtask
              // sets the real message so aria-live=polite re-announces
              // identical content WITHOUT a sentinel character. textContent
              // stays equal to the human-readable string.
              if (activeTab !== "holdings") {
                const message =
                  "Export lives in the Holdings tab — taking you there.";
                setExportAnnouncement("");
                queueMicrotask(() => setExportAnnouncement(message));
              }
              changeTab("holdings");
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Export"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 2v8" />
              <path d="M5 7l3 3 3-3" />
              <path d="M3 13h10" />
            </svg>
            <span>Export</span>
          </button>
          {/* D-20 — primary "+ Allocation" header button. Routes to the
              Scenario tab via the same changeTab mechanism the tabs use, so
              URL + tab state stay in sync. */}
          <button
            type="button"
            onClick={() => changeTab("scenario")}
            className="ml-1 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Add allocation — open Scenario tab"
          >
            + Allocation
          </button>
        </div>
      </div>

      {/* audit-2026-05-07 M-1044 — polite live region for the Export chip
          stub-navigation announcement. Visually hidden (sr-only) so the
          DESIGN.md visual contract is unchanged. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="allocations-tabs-live-region"
      >
        {exportAnnouncement}
      </div>

      {/* Tabpanel pattern below has two cooperating conditions, by design:
          - `hidden={activeTab !== X}` — ARIA tabs APG: inactive tabpanels
            stay in the DOM (id + role for aria-controls) but are marked
            hidden so screen readers skip them.
          - `{activeTab === X && <Panel />}` — A6 lazy-mount: heavy panels
            unmount when not visible so `next/dynamic({ ssr: false })`
            chunks only fetch on first visit and don't keep work running
            in the background. Removing either changes behavior. */}
      <div
        role="tabpanel"
        id="panel-overview"
        aria-labelledby="tab-overview"
        hidden={activeTab !== "overview"}
      >
        {activeTab === "overview" && <AllocationDashboardV2 {...props} />}
      </div>
      <div
        role="tabpanel"
        id="panel-holdings"
        aria-labelledby="tab-holdings"
        hidden={activeTab !== "holdings"}
      >
        {activeTab === "holdings" && <HoldingsTabPanel {...props} />}
      </div>
      <div
        role="tabpanel"
        id="panel-outcomes"
        data-allocator-panel="outcomes"
        aria-labelledby="tab-outcomes"
        hidden={activeTab !== "outcomes"}
      >
        {activeTab === "outcomes" && <OutcomesTabPanel {...props} />}
      </div>
      <div
        role="tabpanel"
        id="panel-mandate"
        aria-labelledby="tab-mandate"
        hidden={activeTab !== "mandate"}
      >
        {activeTab === "mandate" && <MandateTabPanel {...props} />}
      </div>
      <div
        role="tabpanel"
        id="panel-risk"
        aria-labelledby="tab-risk"
        hidden={activeTab !== "risk"}
      >
        {activeTab === "risk" && <RiskTabPanel {...props} />}
      </div>
      <div
        role="tabpanel"
        id="panel-scenario"
        aria-labelledby="tab-scenario"
        hidden={activeTab !== "scenario"}
      >
        {activeTab === "scenario" &&
          (isUiV2 ? (
            // Phase 23 / PERSIST-03+04 — the composer + the saved-scenarios
            // list + the in-tab compare panel, wired together on the V2
            // scenario path. The ScenarioStub rollback path below is untouched.
            <ScenarioTabContent {...props} />
          ) : (
            <ScenarioStub
              flaggedHoldings={props.flaggedHoldings}
              matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
            />
          ))}
      </div>
      {/* PR3 (HANDOFF G5) — Floating Tweaks chip + panel mounted at the
          dashboard root so they stay visible across all tabs (Overview
          / Holdings / Outcomes / Mandate / Risk / Scenario) and float
          bottom-right per the truth screenshot. */}
      <TweaksToggle />
      <Tweaks />
      {/* Tweaks showOutcomes knob: when the user disables the Outcomes tab
          while currently viewing it, redirect to Overview so they don't sit
          on a CSS-hidden panel with no way back via the (now hidden) tab. */}
      <OutcomesTabRedirectGuard activeTab={activeTab} onRedirect={changeTab} />
    </div>
    </TweaksProvider>
  );
}

// Phase 23 / PERSIST-03+04 — the Scenario-tab integration surface (V2 path).
//
// Holds the saved-scenarios list state + the compare selection + the composer's
// imperative Open handler, and renders ScenarioComposer + SavedScenariosList +
// (when a >=2 compare selection is active) ScenarioComparePanel, all handed the
// SAME SSR-lifted payload — no second authenticated route, no second compute
// fetch. The list fetches GET /api/allocator/scenario/saved on mount and
// refetches after a Save/Update/rename/delete so it stays consistent.
//
// A dedicated sub-component (not inline in the conditional branch) keeps these
// hooks unconditional — the V2/ScenarioStub gate lives one level up, so this
// component's hooks never run on the rollback path.
function ScenarioTabContent(props: MyAllocationDashboardPayload) {
  const [savedRows, setSavedRows] = useState<SavedScenarioListRow[]>([]);
  // A hard list-load failure (non-2xx or thrown fetch). Distinct from "no saved
  // scenarios" — an unloaded list must NOT masquerade as an empty list (a
  // fabricated fact). Cleared on the next successful load. Drives the list's
  // honest error state.
  const [listLoadError, setListLoadError] = useState(false);
  const [compareSelection, setCompareSelection] =
    useState<CompareSelection | null>(null);
  // The composer hands us its imperative Open handler via onRegisterOpen; we
  // call it from the list's Open affordance to drive the codec-trichotomy
  // hydrate (Plan 04). Stored in a ref so re-registration doesn't re-render.
  const composerOpenRef = useRef<((row: SavedScenarioRow) => void) | null>(null);

  // Fetch the caller's saved scenarios (RLS-scoped). The GET returns the draft
  // alongside metadata so Open/Compare have it without a second round-trip.
  const refetchSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/allocator/scenario/saved", {
        method: "GET",
      });
      if (!res.ok) {
        // A non-2xx (incl. the route's redacted 500) is a HARD failure. Surface
        // it: an unloaded list rendered as "No saved scenarios yet" would be a
        // fabricated fact. Leave the prior rows in place; flag the error.
        warnAudit("scenario_list_load_failed", { status: res.status });
        setListLoadError(true);
        return;
      }
      const rows = (await res.json()) as SavedScenarioListRow[];
      if (Array.isArray(rows)) {
        setSavedRows(rows);
        setListLoadError(false);
      }
    } catch (err) {
      // A thrown fetch (network / parse) is the same class of hard failure —
      // do NOT swallow it into a silent empty list. The composer + compare
      // surfaces stay usable; the list shows an honest error state. No
      // fabricated rows.
      warnAudit("scenario_list_load_failed", { status: "throw", error: String(err) });
      setListLoadError(true);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: setSavedRows runs only AFTER the awaited fetch resolves
    // (a later microtask), so it is NOT a synchronous cascading render the rule
    // warns about — the static rule can't see through the async boundary.
    // Matches the codebase convention for fetch-on-mount effects (BridgeDrawer /
    // StrategyBrowseDrawer scope the same disable). CLAUDE.md Rule 11.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetchSaved();
  }, [refetchSaved]);

  const handleRegisterOpen = useCallback(
    (open: (row: SavedScenarioRow) => void) => {
      composerOpenRef.current = open;
    },
    [],
  );

  // The list's Open delegates to the composer's codec-trichotomy Open handler.
  const handleOpen = useCallback((row: SavedScenarioOpenRow) => {
    composerOpenRef.current?.(row);
  }, []);

  // The list's Compare raises the >=2 selection; mounting ScenarioComparePanel.
  const handleCompare = useCallback((selection: CompareSelection) => {
    setCompareSelection(selection);
  }, []);

  // After any mutation the composer makes (Save/Update), refetch so the list is
  // consistent. Passed to the composer's onMutated seam if present; also fired
  // by the list itself after rename/delete.
  const handleMutated = useCallback(() => {
    void refetchSaved();
  }, [refetchSaved]);

  return (
    <div className="space-y-6">
      {/* H3 — allocator_id propagated from the SSR-lifted payload.
          allocatorMandate is read from the existing `props.mandate` field. */}
      <ScenarioComposer
        payload={props}
        allocatorId={props.allocator_id}
        allocatorMandate={props.mandate}
        onRegisterOpen={handleRegisterOpen}
        onScenarioSaved={handleMutated}
      />

      <SavedScenariosList
        rows={savedRows}
        listLoadError={listLoadError}
        onOpen={handleOpen}
        onCompare={handleCompare}
        onMutated={handleMutated}
      />

      {compareSelection && (
        <ScenarioComparePanel
          selectedRows={compareSelection.rows}
          includeLiveBook={compareSelection.includeLiveBook}
          payload={props as unknown as ScenarioComparePanelProps["payload"]}
        />
      )}
    </div>
  );
}

// Lives inside <TweaksProvider> so `useTweakValue` resolves; runs an effect
// that bounces the user off the Outcomes tab when its visibility knob flips
// to Hide. No DOM output.
function OutcomesTabRedirectGuard({
  activeTab,
  onRedirect,
}: {
  activeTab: TabKey;
  onRedirect: (key: TabKey) => void;
}) {
  const showOutcomes = useTweakValue("showOutcomes");
  useEffect(() => {
    if (!showOutcomes && activeTab === "outcomes") {
      onRedirect("overview");
    }
  }, [showOutcomes, activeTab, onRedirect]);
  return null;
}
