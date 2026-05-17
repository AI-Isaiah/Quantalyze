"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import { ScenarioStub } from "./ScenarioStub";
import { TweaksProvider } from "./context/TweaksContext";
import { TweaksToggle } from "./components/TweaksToggle";
import { Tweaks } from "./components/Tweaks";
// Phase 11 / 11-05 — onboarding nudge surfaces (S1 + S2). Both render
// above the existing tab nav when apiKeysCount === 0. Light client
// components — kept as direct imports rather than next/dynamic so they
// hydrate immediately on first paint (no skeleton flash for the nudge).
import { OnboardingBanner } from "./components/OnboardingBanner";
import { MandateQuickSetCard } from "./components/MandateQuickSetCard";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { trackUsageEventClient } from "@/lib/analytics/usage-events-client";

// audit-2026-05-07 cluster P (C-0336, M-1045, M-1047) — surface previously
// silent failure paths to the browser console so support has a breadcrumb
// trail. console.warn is non-blocking, runs only on the affected branch,
// and intentionally avoids adding a new telemetry surface (PostHog is
// already addressed via trackUsageEventClient for the picker dispatch).
function warnAudit(tag: string, detail: Record<string, unknown> = {}): void {
  if (typeof console === "undefined") return;
  console.warn(`[AllocationsTabs] ${tag}`, detail);
}

// audit-2026-05-07 cluster P (M-0043 / M-1043 / maintainability MED) — the
// previous `MemoAllocationDashboardV2 = memo(AllocationDashboardV2)` wrapper
// was a no-op: the consumer below renders `<AllocationDashboardV2 {...props}/>`,
// so React.memo's default shallow compare always saw a fresh props identity
// and re-rendered. The wrapper added an indirection layer and a misleading
// optimization signal for future readers without delivering any current
// behavioral benefit. Removed per the audit's "no speculative abstractions
// for single-use code" guidance. Re-introduce memo only AFTER the parent
// server component stabilises the payload reference — at which point the
// wrapper would actually short-circuit.

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
      <div className="mx-auto max-w-[1100px] py-6">
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
// Scenario tab only (ScenarioComposer vs ScenarioStub at line ~570). The
// Overview / Holdings / Outcomes / Mandate / Risk panels are not gated by
// this flag. Treat any documentation that calls it a "broader UI rollback"
// as stale.
//
// v0.15.7.0 retired V1 / made V2 the default-for-all in production; the
// helper preserves the BRANCH point so an explicit "false" still routes to
// the legacy ScenarioStub for rollback safety. Default behavior (no flag,
// or any value other than the literal string "false") yields V2.
const UI_V2_STORAGE_KEY = "allocations.ui_v2";

// audit-2026-05-07 maintainability MED — the only consumer (line ~318) reads
// "is this an explicit opt-out?". Collapsed from a 4-variant discriminator
// union to a 2-variant ("explicit-false" vs "default") so unused branches
// don't accumulate without tests exercising them. C-0336 storage-error
// breadcrumb is preserved; SSR and storage-error paths both collapse to
// "default" since both yield V2 with no rollback. Re-introduce a richer
// discriminator only when a second consumer needs it.
type UiV2FlagState = "explicit-false" | "default";

function readUiV2Flag(): UiV2FlagState {
  if (typeof window === "undefined") {
    return "default";
  }
  try {
    const raw = window.localStorage.getItem(UI_V2_STORAGE_KEY);
    if (raw === "false") return "explicit-false";
    return "default";
  } catch (err) {
    // audit-2026-05-07 C-0336 (silent-failure-hunter c10) — log the
    // storage failure so a P1 "V1 users seeing V2" / "rollback not
    // honoured" issue is debuggable. Default-true behaviour is preserved.
    const reason = err instanceof Error ? err.message : String(err);
    warnAudit("loadUiV2Flag_failed", { reason });
    return "default";
  }
}

// Live-refresh polling. Phase 06 D-11 used 5s for active-ingest sync status;
// Phase 07 is a monitoring surface where data changes slowly (daily equity,
// periodic trades) so 30s is enough for a timely read without re-fetching the
// whole `getMyAllocationDashboard` payload 720× per hour on an open tab.
const PERFORMANCE_POLL_INTERVAL_MS = 30_000;

/**
 * Phase 09.1 Plan 02 / D-05 / D-06 — Tabs shell for /allocations.
 *
 * Six surfaces (D-05 order):
 *   - Overview (default) — wraps AllocationDashboardV2.
 *   - Holdings — full-width HoldingsTable (Plan 08 fills body).
 *   - Outcomes — full-width OutcomesWidget (Plan 10 restyles).
 *   - Mandate — link to /profile?tab=mandate + future MandateSnapshot
 *     (Plan 10 fills body).
 *   - Risk — curated grid of 6 risk widgets (Plan 10 fills body).
 *   - Scenario — placeholder Card for the Phase 10 builder.
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
 *   /allocations?tab=scenario     → Scenario
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

type TabKey = "overview" | "holdings" | "outcomes" | "mandate" | "risk" | "scenario";

// PR3 (dashboard parity) — the truth design's tab strip is 5 tabs (no
// Scenario). Scenario remains routable via ?tab=scenario so the
// "+ Allocation" chip still works, and the panel still renders below,
// but no button for it lives in the visible tablist.
const VISIBLE_TAB_KEYS: readonly TabKey[] = [
  "overview",
  "holdings",
  "outcomes",
  "mandate",
  "risk",
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
  // D-05: 6-tab set. Overview is default. Anything else (null, empty, unknown
  // values, the legacy "performance" alias) collapses to "overview" — silent
  // fallback preserves D-04.
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
  "rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-mono leading-none text-accent";
const TAB_COUNT_BADGE_INACTIVE =
  "rounded-full bg-page px-1.5 py-0.5 text-[10px] font-mono leading-none text-text-muted";

export function AllocationsTabs(props: MyAllocationDashboardPayload) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Per VOICES-ACCEPTED f3: derive each render — no local state snapshot.
  const activeTab: TabKey = parseTab(searchParams.get("tab"));

  // audit-2026-05-07 Phase-4 red-team (HIGH conf 8) — capture the latest
  // activeTab via a ref so deferred (queueMicrotask + setTimeout 100ms)
  // callbacks in `dispatchWidgetPicker` read the LATEST tab at fire time,
  // not the snapshot captured at click time. This lets the safety-net
  // dispatch detect "user navigated away from Overview before the 100ms
  // timer fired" and emit a `no_listener` breadcrumb + telemetry follow-up
  // instead of silently lying with a 'deferred' success ack.
  const activeTabRef = useRef<TabKey>(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Phase 10 / 10-06b — `allocations.ui_v2` flag drives the scenario panel
  // body. SSR-stable initialization (review-pass P1 fix): start with `true`
  // (matches the SSR helper's server-side default) so the SSR HTML and the
  // first client render agree byte-for-byte; React hydration succeeds without
  // mismatch. The actual localStorage check moves to the useEffect below,
  // which only flips the flag to `false` AFTER hydration completes — this
  // keeps the rollback path reachable while eliminating the hydration error
  // that an inline localStorage read would surface for users who explicitly
  // opted out (raw=="false" on the client, but SSR rendered the V2 path).
  const [isUiV2, setUiV2Flag] = useState<boolean>(true);
  useEffect(() => {
    // The setState-in-effect is intentional and bounded: it fires AT MOST
    // ONCE on mount, only when the localStorage rollback flag is set to
    // the literal string "false". The alternative (useSyncExternalStore)
    // is overkill for a one-shot post-mount read of a stable value.
    const result = readUiV2Flag();
    /* eslint-disable react-hooks/set-state-in-effect */
    if (result === "explicit-false") {
      setUiV2Flag(false);
      // audit-2026-05-07 H-1188 (red-team c8) — the persisted flag's
      // SCOPE is Scenario only in current main; the Overview / Holdings /
      // Outcomes / Mandate / Risk panels remain V2 regardless. Log a
      // breadcrumb when the explicit-false rollback path is hit so
      // support can correlate "I set the flag but my dashboard didn't
      // roll back" tickets.
      warnAudit("ui_v2_rollback_scope_scenario_only", {
        storage_key: UI_V2_STORAGE_KEY,
        affected_surface: "scenario",
      });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

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
    // PR3 — keyboard nav only walks VISIBLE_TAB_KEYS (5 surfaces). Scenario
    // is reachable via "+ Allocation" / direct URL so excluding it from
    // arrow nav doesn't strand the panel.
    const idx = VISIBLE_TAB_KEYS.indexOf(key);
    if (idx < 0) return;
    let next: TabKey | null = null;
    const len = VISIBLE_TAB_KEYS.length;
    if (e.key === "ArrowRight") next = VISIBLE_TAB_KEYS[(idx + 1) % len];
    else if (e.key === "ArrowLeft")
      next = VISIBLE_TAB_KEYS[(idx - 1 + len) % len];
    else if (e.key === "Home") next = VISIBLE_TAB_KEYS[0];
    else if (e.key === "End") next = VISIBLE_TAB_KEYS[len - 1];
    if (next) {
      e.preventDefault();
      changeTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  // PR3 (dashboard parity) — count badges on Holdings + Outcomes tabs
  // matching the truth screenshot ("Holdings 8", "Outcomes 4"). Counts
  // come straight from the payload arrays already on `props`; no new
  // queries needed.
  const holdingsCount = props.holdingsSummary?.length ?? 0;
  const outcomesCount = props.outcomes?.length ?? 0;
  const tabCount: Partial<Record<TabKey, number>> = {
    holdings: holdingsCount,
    outcomes: outcomesCount,
  };

  // audit-2026-05-07 H-1187 / H-1190 / H-1191 / M-1047 — picker dispatch
  // race + silent drop. The proper fix (lifting pickerOpen state into
  // AllocationsTabs) requires editing AllocationDashboardV2, which is
  // out-of-scope for this cluster's PR. In-scope mitigation:
  //   - On Overview: dispatch synchronously (listener already mounted).
  //   - From a non-Overview tab: queueMicrotask + a 100ms setTimeout
  //     safety net. The handler `setPickerOpen(true)` is idempotent, so
  //     a duplicate delivery is harmless. One PostHog event per click
  //     (status reflects whether the synchronous send raised).
  //
  // audit-2026-05-07 Phase-4 red-team (HIGH conf 8) — under rapid
  // re-navigation (Risk → Widget chip → Holdings within 100ms) the
  // 100ms safety-net timer fires AFTER AllocationDashboardV2 unmounts on
  // the Holdings tab change. `dispatchEvent` for an unhandled event
  // returns true and doesn't throw, so neither the `failed` breadcrumb
  // nor the synchronous-throw path fires — telemetry sells 'deferred'
  // success but the picker never opens. Fix: read the LATEST activeTab via
  // `activeTabRef` inside the deferred callback. If the user has navigated
  // away from Overview by the time the timer fires, emit a follow-up
  // `widget_picker_dispatch_no_listener` warnAudit + a separate
  // `widget_viewed` telemetry event so the silent-failure class M-1047 set
  // out to eliminate is actually surfaced.
  //
  // audit-2026-05-07 Phase-4 red-team (MED conf 8) — wrap the deferred
  // scheduling in try/catch. On hostile / old WebView surfaces (embedded
  // Chromium <71, iOS <12.2 — still in regulated APAC trading desktops)
  // `queueMicrotask` can be undefined; the throw would escape
  // `dispatchWidgetPicker` BEFORE `trackUsageEventClient` was called and
  // leave the click in a broken state with no telemetry. Two-line guard
  // downgrades 'deferred' to 'failed' + emits a
  // `widget_picker_schedule_failed` breadcrumb.
  const dispatchWidgetPicker = (wasAlreadyOnOverview: boolean): void => {
    if (typeof window === "undefined") return;

    const fire = (): boolean => {
      try {
        window.dispatchEvent(
          new CustomEvent("allocations:open-widget-picker"),
        );
        return true;
      } catch (err) {
        warnAudit("widget_picker_dispatch_failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    };

    if (wasAlreadyOnOverview) {
      const ok = fire();
      trackUsageEventClient("widget_viewed", {
        widget_picker_dispatch: ok ? "sync" : "failed",
        source: "tab_row_chip",
        wasAlreadyOnOverview: true,
      });
      return;
    }

    // Non-Overview source — AllocationDashboardV2's listener mounts on
    // commit of the tab change. Microtask + 100ms safety-net catches the
    // listener-not-yet-attached race that the original synchronous
    // dispatch dropped. Telemetry fires once per click.
    //
    // The deferred-fire wrapper checks `activeTabRef.current` at fire time:
    // if the user has already re-navigated to another tab (Holdings / Risk
    // / …) by the time the 100ms timer fires, AllocationDashboardV2 is
    // unmounted and the dispatch lands on a window with no listener. We
    // emit a `no_listener` follow-up so support has a breadcrumb that
    // distinguishes "delivered but unopened" from "user re-navigated".
    let noListenerReported = false;
    const fireWithListenerCheck = (): void => {
      if (activeTabRef.current !== "overview") {
        if (!noListenerReported) {
          noListenerReported = true;
          warnAudit("widget_picker_dispatch_no_listener", {
            currentTab: activeTabRef.current,
            source: "tab_row_chip",
          });
          trackUsageEventClient("widget_viewed", {
            widget_picker_dispatch: "no_listener",
            source: "tab_row_chip",
            wasAlreadyOnOverview: false,
          });
        }
        return;
      }
      fire();
    };

    try {
      queueMicrotask(fireWithListenerCheck);
      window.setTimeout(fireWithListenerCheck, 100);
    } catch (err) {
      warnAudit("widget_picker_schedule_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
      trackUsageEventClient("widget_viewed", {
        widget_picker_dispatch: "failed",
        source: "tab_row_chip",
        wasAlreadyOnOverview: false,
      });
      return;
    }
    trackUsageEventClient("widget_viewed", {
      widget_picker_dispatch: "deferred",
      source: "tab_row_chip",
      wasAlreadyOnOverview: false,
    });
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
    <div>
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
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-2.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-[22px] leading-none tracking-tight text-text-primary">
            My Allocation
          </h1>
          {entityName ? (
            <span className="text-[11px] uppercase tracking-[0.06em] text-text-muted">
              {entityName}
            </span>
          ) : null}
        </div>
        <div
          role="tablist"
          aria-label="Allocation surfaces"
          className="ml-auto flex items-center gap-1"
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
                aria-selected={isActive}
                aria-controls={`panel-${key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => changeTab(key)}
                onKeyDown={(e) => handleTabKeyDown(e, key)}
                className={isActive ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}
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
          <span aria-hidden className="mx-2 h-4 w-px bg-border" />
          {/* PR3 (dashboard parity) — Widget + Export chip buttons match
              the truth screenshot's tab-row chip group. Widget opens the
              widget picker (currently scoped to Overview only — clicking
              elsewhere returns the user to Overview where the picker
              lives). Export is a stub for the next polish iteration. */}
          <button
            type="button"
            onClick={() => {
              // Route to Overview where the widget picker is mounted, then
              // dispatch via the helper. The helper handles the microtask /
              // 100ms safety-net race that audit-2026-05-07 H-1187 / H-1190
              // / H-1191 flagged: AllocationDashboardV2's listener mounts
              // on the commit of the tab change, not before.
              const wasAlreadyOnOverview = activeTab === "overview";
              changeTab("overview");
              dispatchWidgetPicker(wasAlreadyOnOverview);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Add widget"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <rect x="2" y="2" width="5" height="5" rx="0.5" />
              <rect x="9" y="2" width="5" height="5" rx="0.5" />
              <rect x="2" y="9" width="5" height="5" rx="0.5" />
              <rect x="9" y="9" width="5" height="5" rx="0.5" />
            </svg>
            <span>Widget</span>
          </button>
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
            // H3 — allocator_id propagated from the SSR-lifted payload.
            // allocatorMandate is read from the existing `props.mandate`
            // field; no new prop on AllocationsTabs is needed.
            <ScenarioComposer
              payload={props}
              allocatorId={props.allocator_id}
              allocatorMandate={props.mandate}
            />
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
    </div>
    </TweaksProvider>
  );
}
