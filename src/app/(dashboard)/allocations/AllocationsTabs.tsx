"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
import { computeTabStripScroll } from "@/lib/tab-strip-scroll";

// Plan 170-08 imports the scroll math from the lib module. Re-exported here
// so the existing test import from this file keeps working unchanged.
export { computeTabStripScroll } from "@/lib/tab-strip-scroll";
// Phase 198 D-03 — the allocator's own add-allocation flow, hosted here so the
// one header "+ Allocation" button opens it on every tab. Imported statically:
// it renders null while closed and fetches nothing until it opens.
import { AddAllocationFlow } from "./components/AddAllocationFlow";
import type { DeepLinkInvalidReason } from "./components/AddAllocationFlow";
import { heldStrategyIdsFrom } from "./lib/add-allocation";
import { bookEquityUsd } from "./lib/book-figures";
// Phase 11 / 11-05 — onboarding nudge surfaces (S1 + S2). Both render
// above the existing tab nav when apiKeysCount === 0. Light client
// components — kept as direct imports rather than next/dynamic so they
// hydrate immediately on first paint (no skeleton flash for the nudge).
import { OnboardingBanner } from "./components/OnboardingBanner";
import { MandateQuickSetCard } from "./components/MandateQuickSetCard";
import type {
  MyAllocationDashboardPayload,
  OwnCapitalStrategy,
} from "@/lib/queries";
import type { ExposureSectionData } from "./lib/exposure-props";
import type { FavoriteRow, OptimizerPrefetch } from "./lib/watchlist-read";
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

// Phase A6 — the Holdings tab panel lazy-loads via next/dynamic with
// ssr: false. It pulls in HoldingsTable + HoldingDetail + OutcomeForm +
// BridgeOutcomeBanner surfaces, plus their charts and primitives — code the
// Overview tab never needs. Deferring it from the initial bundle and HTML keeps
// the first paint of the dashboard aligned with the Overview path that >90% of
// allocators land on. (Phase 198 D-02: the Outcomes / Mandate / Risk panels are
// no longer tabs; their panel files stay for plans 198-06 and 198-11 to mount
// inside Overview and Holdings.)
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
      // 153.2 review WR-02 — the skeleton tracks the body it stands in for.
      // `ScenarioComposer` dropped its 1440px cap in the same commit; leaving
      // one here would reinstate the skeleton→page width jump that
      // `compare/loading.test.tsx` states as the invariant.
      <div className="mx-auto py-6">
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
// tabpanel below). The Overview / Holdings
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
 * Visible tablist (see VISIBLE_TAB_KEYS), three tabs since Phase 198 D-02:
 *   - Overview (default) — wraps AllocationDashboardV2.
 *   - Holdings — full-width HoldingsTable.
 *   - Scenario — ScenarioComposer (V2 default) / ScenarioStub (rollback).
 *     SURF-01 (Phase 21): now a visible tab button; still independently
 *     reachable via ?tab=scenario.
 *
 * URL state (D-04 / D-05):
 *   /allocations                  → Overview
 *   /allocations?tab=overview     → Overview (param deleted on mount)
 *   /allocations?tab=performance  → Overview (legacy Phase 07 alias; param
 *                                   deleted on mount for clean bookmarks)
 *   /allocations?tab=holdings     → Holdings
 *   /allocations?tab=outcomes     → Holdings, scrolled to #outcomes (legacy alias,
 *                                   rewritten to ?tab=holdings on mount)
 *   /allocations?tab=mandate      → Overview, scrolled to #mandate (legacy alias,
 *                                   `tab` param deleted on mount)
 *   /allocations?tab=risk         → Overview, scrolled to #risk (legacy alias,
 *                                   `tab` param deleted on mount)
 *   /allocations?tab=scenario     → Scenario (now a visible tab — SURF-01, Phase 21)
 *   /allocations?tab=<unknown>    → Overview (D-04 silent fallback)
 *
 * Per VOICES-ACCEPTED f3: `activeTab` is DERIVED from `searchParams` on
 * every render — NOT snapshotted in local component state. This diverges
 * from the ProfileTabs.tsx analog (which has a latent back/forward bug).
 * Here, browser back/forward updates the URL → searchParams changes →
 * re-render → activeTab recomputes → visible tab toggles correctly.
 *
 * Tab clicks call `window.history.replaceState(null, "", url)` to update
 * the URL (Phase 167.1.2 plan 07, SC-5c). Next integrates the native History
 * API with `useSearchParams`, so the URL change re-renders this component and
 * re-derives activeTab, WITHOUT a navigation: the router's replace to a changed
 * query on this force-dynamic page refetched the RSC payload and re-ran
 * getMyAllocationDashboard on every tab click. replaceState adds no history
 * entry (as the router's replace did not) and never scrolls. No local state
 * for `activeTab` is kept.
 *
 * Live-refresh polling (Phase 06 D-11 inheritance): 30s router.refresh()
 * while Overview is active AND document.visibilityState is visible.
 * Never polls while on any other tab (no data to refresh per render).
 *
 * Suspense: This component calls `useSearchParams()` which triggers the
 * Next.js 16 CSR-bailout rule — the caller (page.tsx) wraps us in
 * <Suspense fallback={<div />}>.
 */

type TabKey = "overview" | "holdings" | "scenario";

// Visible tab strip. SURF-01 (Phase 21): Scenario is now a visible tab in
// the strip — it remains independently reachable via ?tab=scenario and the
// "+ Allocation" chip, but it also renders its own button here so allocators
// can discover the scenario surface directly. Overview is the factsheet view
// (full equity curve + factsheet panel layout aggregated across the
// allocator's strategies), so there is no separate Analytics tab.
const VISIBLE_TAB_KEYS: readonly TabKey[] = [
  "overview",
  "holdings",
  "scenario",
] as const;

// Phase 198 D-02 — the Outcomes, Mandate and Risk tabs are retired; their
// content now lives inside Holdings (Outcomes) and Overview (Risk, Mandate),
// each under a fixed section id. A retired `?tab=` value keeps working: it
// lands on the content's new home, the `tab` param is rewritten, and the page
// scrolls once to the section. A CLOSED map — the anchor is one of three fixed
// ids and is never read from the URL (T-198-07).
const LEGACY_TAB_ALIASES = {
  outcomes: { tab: "holdings", anchor: "outcomes" },
  risk: { tab: "overview", anchor: "risk" },
  mandate: { tab: "overview", anchor: "mandate" },
} as const;
type LegacyTabKey = keyof typeof LEGACY_TAB_ALIASES;

function isLegacyTabKey(raw: string | null): raw is LegacyTabKey {
  return raw !== null && Object.hasOwn(LEGACY_TAB_ALIASES, raw);
}

// Frame budget for the anchor retry: the Holdings panel is a lazily mounted
// next/dynamic chunk, so its section may not exist on the first frame.
const ANCHOR_SCROLL_MAX_FRAMES = 120;

// One reduced-motion check for both the NAV-02 strip scroll and the alias
// anchor scroll. Guarded so it no-ops where matchMedia is absent (jsdom).
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// audit-2026-05-07 M-1045 (silent-failure-hunter c8) — D-04 says unknown
// values silently fall back to Overview. We keep the user-facing fallback
// (no error UI, no redirect surprise) but log a breadcrumb so support can
// distinguish "user typoed a bookmark" from "marketing shipped a broken
// outbound link". The known legacy alias "performance" and the canonical
// keys are NOT logged — only genuinely unknown non-empty raw values.
//
// audit-2026-05-07 Phase-4 red-team (MED conf 8) — entries are typed as
// `TabKey | LegacyTabKey | "performance"` and derived from `VISIBLE_TAB_KEYS`
// + the retired-tab aliases + the legacy "performance" alias so
// a future TabKey rename can't leave a stale string here that silently
// suppresses `invalid_tab_fallback`. `VISIBLE_TAB_KEYS` is the single
// TabKey-typed source of truth; the spread here keeps the two constants
// in lockstep at compile time. The Set is exposed as `ReadonlySet<string>`
// so `.has(raw)` still accepts an arbitrary search-param string at the
// call site without per-call casts.
const KNOWN_TAB_RAW_ENTRIES: readonly (TabKey | LegacyTabKey | "performance")[] =
  [
    ...VISIBLE_TAB_KEYS,
    ...(Object.keys(LEGACY_TAB_ALIASES) as LegacyTabKey[]),
    "performance", // Phase 07 legacy alias — cleaned up by the URL effect.
  ] as const;
const KNOWN_TAB_RAW: ReadonlySet<string> = new Set<string>(
  KNOWN_TAB_RAW_ENTRIES,
);

function parseTab(raw: string | null): TabKey {
  // Overview is default. A retired tab key (Phase 198 D-02) maps to the tab its
  // content now lives in. Anything else (null, empty, unknown values, the
  // legacy "performance" alias) collapses to "overview" — silent fallback
  // preserves D-04, with a breadcrumb only for a genuinely unknown value.
  switch (raw) {
    case "holdings":
    case "scenario":
      return raw;
    default:
      if (isLegacyTabKey(raw)) return LEGACY_TAB_ALIASES[raw].tab;
      if (raw && raw.length > 0 && !KNOWN_TAB_RAW.has(raw)) {
        warnAudit("invalid_tab_fallback", { raw });
      }
      return "overview"; // Phase 07 "performance" URL also lands here.
  }
}

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  holdings: "Holdings",
  scenario: "Scenario",
};

// Tab-button class strings — pulled out of the render JSX so the active /
// inactive delta isn't hidden in two ~200-char ternary branches that share
// ~90% of their characters. Phase 117 / UIFIX-02 repointed the focus idiom off
// the trailing `focus-visible:outline*` (which paints OUTSIDE the border edge →
// clipped by the strip's `overflow-x-auto` on mobile, and by the tabs' own
// `-mb-[10px]` overhang) onto the CLIP-PROOF inset ring; every other token stays
// byte-identical to the prior inlined versions (dashboard-parity Tailwind order).
const TAB_BUTTON_ACTIVE =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-[10px] border-accent text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_BUTTON_INACTIVE =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-b-2 -mb-[10px] border-transparent text-text-muted hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

const TAB_COUNT_BADGE_ACTIVE =
  "rounded-sm bg-accent/15 px-1.5 py-0.5 text-fixed-10 font-mono leading-none text-accent";
const TAB_COUNT_BADGE_INACTIVE =
  "rounded-sm bg-page px-1.5 py-0.5 text-fixed-10 font-mono leading-none text-text-muted";

export function AllocationsTabs(
  // Phase 100 / 100-04 — `favorites` / `optimizer` / `note` are ADDITIVE props
  // threaded from page.tsx's Promise.all straight through to HoldingsTabPanel
  // (already spread via `{...props}`); the polled `MyAllocationDashboardPayload`
  // and the Phase-99 `exposure` prop are untouched (SC-4). They are OPTIONAL at
  // this shared-client boundary so the pre-existing AllocationsTabs test
  // call-sites stay byte-unmodified (SC-4 regression gate) — page.tsx ALWAYS
  // supplies all three; HoldingsTabPanel renders honest-empty if any is absent.
  props: MyAllocationDashboardPayload & {
    exposure: ExposureSectionData;
    favorites?: FavoriteRow[];
    optimizer?: OptimizerPrefetch;
    note?: { initialContent: string; initialLastSavedAt: Date | null };
    // Phase 150 / OWN-03 — ADDITIVE, same precedent as the trio above: two
    // server reads threaded straight through to HoldingsTabPanel (already
    // spread via `{...props}`). OPTIONAL here so the pre-existing
    // AllocationsTabs test call-sites stay byte-unmodified; page.tsx always
    // supplies both, and the panel renders honest-empty if either is absent.
    ownCapitalStrategies?: OwnCapitalStrategy[];
    hasAnyStrategies?: boolean;
    /**
     * Review WR-02 — did EITHER strategies read fail (both return `null`, never
     * `[]`, on a transient DB/RLS failure)? Threaded so the panel can render a
     * degraded notice instead of an account-state claim. Optional/defaults to
     * false for the same reason as the two above; page.tsx always supplies it.
     */
    strategiesReadFailed?: boolean;
  },
) {
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
  // Scenario only in current main; the Overview / Holdings
  // panels remain V2 regardless. Log a breadcrumb when the
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
  // /allocations. Runs after render to avoid touching render-phase state.
  //
  // Phase 198 D-02 — a retired tab key (outcomes / risk / mandate) is rewritten
  // the same way: `tab=holdings` for outcomes, the param deleted for risk and
  // mandate, every other param kept, built exactly as changeTab builds its URL.
  // The alias also arms `pendingAlias`, which the anchor-scroll effect below
  // consumes. This effect runs on every searchParams change, so a soft
  // navigation to a legacy link while already on /allocations (the sidebar's
  // Risk item) re-arms it, not just the first mount.
  // Phase 167.1.2 plan 07 (SC-5c): the native History API, not the router.
  // An App Router navigation to a changed query on this force-dynamic page
  // refetches the RSC payload (the old comment's "shallow replace does not
  // refetch" was wrong for the App Router); history.replaceState does not,
  // and Next syncs useSearchParams to it.
  //
  // Phase 198 D-07 — every URL write in this file builds from the LIVE
  // `window.location.search`, never the render's `searchParams` snapshot. Two
  // effects now rewrite the URL in the same commit (this one and the `add` strip
  // below); a snapshot-built write would put back whatever param the other
  // effect had just removed (`?tab=risk&add=<id>` would regain `tab`).
  const [pendingAlias, setPendingAlias] = useState<LegacyTabKey | null>(null);
  useEffect(() => {
    const current = searchParams.get("tab");
    if (current === "overview" || current === "performance") {
      const params = new URLSearchParams(window.location.search);
      params.delete("tab");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    } else if (isLegacyTabKey(current)) {
      const params = new URLSearchParams(window.location.search);
      if (current === "outcomes") params.set("tab", "holdings");
      else params.delete("tab");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- arms a one-shot scroll from an external URL change; the value cannot be derived in render because this very effect removes the legacy param from the URL
      setPendingAlias(current);
    }
  }, [searchParams, pathname]);

  // Phase 198 D-02 — one scroll to the alias's section once it exists. The
  // Holdings panel is lazily mounted (RESEARCH P6), so poll with a bounded
  // requestAnimationFrame loop (ANCHOR_SCROLL_MAX_FRAMES) and give up silently
  // when no anchor appears. Cancelled on unmount and on any tab change: a
  // pending alias whose tab is no longer active is dropped, so returning to
  // that tab later does not scroll unprompted.
  useEffect(() => {
    if (!pendingAlias) return;
    const alias = LEGACY_TAB_ALIASES[pendingAlias];
    if (activeTab !== alias.tab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drops a stale one-shot when the user leaves the alias's tab
      setPendingAlias(null);
      return;
    }
    let frame = 0;
    let handle = 0;
    const tick = () => {
      const target = document.getElementById(alias.anchor);
      if (target) {
        target.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
        setPendingAlias(null);
        return;
      }
      frame += 1;
      if (frame >= ANCHOR_SCROLL_MAX_FRAMES) {
        setPendingAlias(null);
        return;
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [pendingAlias, activeTab]);

  // Live-refresh polling — only while on Overview + document visible
  // (Phase 06 D-11 inherited pattern). Never polls on Holdings / Scenario.
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
  // re-derives activeTab. No local state for activeTab. The native History API
  // (SC-5c): no RSC refetch, no history entry, no scroll.
  const changeTab = (key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "overview") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  // Phase 198 D-03 — the header "+ Allocation" button opens the allocator's own
  // add-allocation flow on EVERY tab, the Scenario tab and its rollback surface
  // included. It never opens the manager's strategy wizard (an allocator is not a
  // manager), and on Scenario the composer's own "Browse strategies" stays the
  // way to add a strategy to a model.
  //
  // `addButtonRef` is the trigger the flow returns focus to on every close path:
  // the flow pulls focus IN on open but never restores the trigger, because the
  // trigger lives here, not in the flow. `addFlow.deepLink` carries the raw
  // `?add=` value (Phase 196's entry point, D-07) and is null for a header click.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [addFlow, setAddFlow] = useState<{
    open: boolean;
    deepLink: { raw: string } | null;
  }>({ open: false, deepLink: null });

  // Same microtask-clear live-region idiom as the Export chip (see
  // `liveAnnouncement` below): set "" first so an identical message re-announces,
  // then the real message, with no sentinel character in the DOM text.
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");
  const announce = useCallback((message: string) => {
    setLiveAnnouncement("");
    queueMicrotask(() => setLiveAnnouncement(message));
  }, []);

  // Memoized so their identities stay stable across the Overview tab's 30s
  // router.refresh() poll (which re-renders AllocationsTabs). A new `onClose`
  // identity would re-run the flow's open effect and yank focus away from the
  // amount the allocator is typing every 30s. The state setters, `announce` and
  // `addButtonRef` are stable, so only `router` belongs in deps.
  const handleFlowClose = useCallback(() => {
    setAddFlow((prev) => ({ ...prev, open: false }));
    // Return focus to the header trigger (UI-SPEC close -> focus return).
    addButtonRef.current?.focus();
  }, []);
  // The flow calls onRecorded and then onClose, so focus returns once, in close.
  const handleFlowRecorded = useCallback(
    (announcement: string) => {
      announce(announcement);
      // A recorded allocation should reflect in the SSR payload without waiting
      // for the 30s Overview poll. User-initiated, so call it directly, with the
      // poll's try/catch + breadcrumb: router.refresh has no AbortController.
      try {
        router.refresh();
      } catch (err) {
        warnAudit("router_refresh_failed", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [announce, router],
  );

  // Phase 198 D-07 — `/allocations?add=<strategyId>`, the entry point Phase 196's
  // factsheet links to. Read in an EFFECT on mount and on every searchParams
  // change, never in a useState initializer (RESEARCH P4): the server render and
  // the first client render both have the flow closed, so hydration agrees, and a
  // soft navigation to a new id while mounted opens it again. The raw value is
  // only handed to the flow, which validates it as a uuid and resolves it against
  // the allocator-gated browse list (the URL is never trusted, and no write
  // happens without a press). Research C8: the param is consumed into state and
  // stripped from the URL as the flow opens, so a reload or a copied address bar
  // never reopens it. An empty value opens the flow with no deep link.
  useEffect(() => {
    const raw = searchParams.get("add");
    if (raw === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consumes a one-shot external URL param into state; it cannot be derived in render because this very effect removes the param from the URL
    setAddFlow({ open: true, deepLink: raw === "" ? null : { raw } });
    const params = new URLSearchParams(window.location.search);
    params.delete("add");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, pathname]);

  // A flow-reported invalid `?add=` id (malformed, not in the list, or absent
  // from a truncated list) leaves a breadcrumb, the invalid_tab_fallback
  // precedent: the user sees a stated reason inside the flow, support sees why.
  const handleInvalidDeepLink = useCallback((reason: DeepLinkInvalidReason) => {
    warnAudit("invalid_add_param", { reason });
  }, []);

  // One-line dispatch: no per-tab branching, so the button is never a silent
  // no-op on any surface (ADDALLOC-03 stays true).
  const handleHeaderAdd = () => setAddFlow({ open: true, deepLink: null });

  const heldStrategyIds = useMemo(
    () =>
      heldStrategyIdsFrom(
        props.strategies ?? [],
        props.outcomes ?? [],
        props.heldOutcomeStrategyIds ?? [],
      ),
    [props.strategies, props.outcomes, props.heldOutcomeStrategyIds],
  );
  // Undefined when the strategies read failed: `[]` there is not a claim that
  // nothing is marked, so the flow must not disable every own row on it.
  const ownCapitalStrategyIds = useMemo(
    () =>
      props.strategiesReadFailed || !props.ownCapitalStrategies
        ? undefined
        : new Set(props.ownCapitalStrategies.map((s) => s.id)),
    [props.strategiesReadFailed, props.ownCapitalStrategies],
  );
  const bookEquity = useMemo(
    () => bookEquityUsd(props.holdingsSummary ?? []),
    [props.holdingsSummary],
  );

  // WAI-ARIA authoring-practices tab pattern: Arrow keys move focus between
  // tabs, Home/End jump to first/last. Tab/Shift-Tab leaves the tablist.
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    holdings: null,
    scenario: null,
  });
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: TabKey) => {
    // Keyboard nav walks VISIBLE_TAB_KEYS. SURF-01 (Phase 21): Scenario is
    // now part of that set (a visible tab), so arrow-nav reaches it for
    // free — no separate keyboard-nav array. It also stays reachable via
    // "+ Allocation" / direct ?tab=scenario URL.
    // Phase 195 D-05: no tab is skipped here (the Tweaks knob that could hide
    // one is gone). Phase 198 D-02: the walk is over three tabs.
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

  // NAV-02 (Phase 45) — keep the active tab in view inside the horizontally-
  // scrollable strip (a scroller at EVERY width since GC-01, 2026-09-30). A
  // keyboard arrow-nav or a programmatic tab change can leave the selected
  // tab clipped off-screen; scroll it back into view on every activeTab
  // change. We scroll the STRIP (the role="tablist" scroll container — the
  // tab button's direct parent, pinned by the axe aria-required-children gate) on its horizontal axis ONLY, never the page.
  // The earlier `el.scrollIntoView({ block: "nearest" })` also moved the
  // nearest VERTICAL scroll container, so switching tabs after scrolling down
  // yanked the page back up to the strip — defeating changeTab's deliberate
  // no-scroll URL write (history.replaceState). `computeTabStripScroll` returns null
  // when the tab is already visible (including whenever all tabs fit and the
  // strip does not overflow), so this is a no-op except when a horizontal
  // correction is actually needed — at any width, not just <sm (GC-01).
  // Honor prefers-reduced-motion: instant ("auto") for reduce, smooth
  // otherwise — never animate a forced scroll for reduced-motion users
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
    const elRect = el.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const target = computeTabStripScroll({
      // Active tab's left in the strip's CONTENT coordinate space (add back the
      // current scrollLeft so it is comparable to the scrollLeft-based window).
      elLeft: elRect.left - stripRect.left + strip.scrollLeft,
      elWidth: elRect.width,
      viewLeft: strip.scrollLeft,
      viewWidth: strip.clientWidth,
      prefersReducedMotion: prefersReducedMotion(),
    });
    if (target) strip.scrollTo(target);
  }, [activeTab]);

  // PR3 (dashboard parity) — count badge on the Holdings tab ("Holdings 8").
  // The count comes straight from the payload array already on `props`; no new
  // queries needed. Phase 198 D-02: the Outcomes tab and its count badge left
  // with the tab; the Outcomes widget's own KPI strip still counts outcomes.
  // F4b — the Holdings tab's primary surface is now one row per onboarded
  // strategy, so the badge counts strategies (raw exchange positions render
  // in the secondary "Exchange Positions" section, not as the headline count).
  const holdingsCount = props.strategies?.length ?? 0;
  const tabCount: Partial<Record<TabKey, number>> = {
    holdings: holdingsCount,
  };

// audit-2026-05-07 M-1044 (silent-failure-hunter c8) — Export chip
  // navigates to Holdings as a stub; users from Overview/Scenario see
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
  //
  // Phase 198 D-03 — the state is `liveAnnouncement`, declared with the header
  // flow above (its `announce` helper is the same idiom); the add-allocation
  // success line shares the Export chip's region.

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
          <h1 className="font-display text-fixed-28 leading-none tracking-tight text-text-primary">
            My allocation
          </h1>
        </div>
        {/* JOURNEY-03 (a11y) — the row holds the tablist AND two action
            buttons (Export, + Allocation). A role="tablist" may contain ONLY
            role="tab" children (axe aria-required-children, critical), so the
            tablist wraps just the tabs; the actions are siblings in the same
            flex row. */}
        {/* Phase 170, item (a), 2026-09-27 PROD measurement — min-w-0 is
            load-bearing. A flex item's default min-width is auto, so this
            wrapper could not shrink below its content and the NAV-02
            scroller never engaged (tab bar 682px, #main-content overflow
            235px). max-w-full + flex-wrap lets the actions drop to their
            own right-aligned row below sm; from sm up sm:flex-nowrap keeps
            the tablist and Export on ONE line, and the tablist (a shrinking
            sm:basis-auto item) scrolls inside itself when its tabs do not
            fit rather than wrapping (GC-01, 2026-09-30). */}
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
          {/* NAV-02 (Phase 45) / GC-01 (2026-09-30) — CSS-first horizontally-
              scrollable tab strip at EVERY width, so all three surfaces stay
              reachable on a phone (no tab dropped) and the strip never wraps.
              JOURNEY-03 is preserved: this is the SAME element with the SAME
              role="tablist" and the SAME direct role="tab" children — no role is
              added to any wrapper and the tabs are NOT re-nested (re-nesting would
              re-introduce the critical axe aria-required-children violation the
              comment above warns about; the seeded composer-axe.spec.ts gate
              catches a regression). `flex-nowrap overflow-x-auto` keeps the tabs on
              one line at every width: below sm the strip is its own full-width
              row (basis-full); from sm up it is a shrinking item beside Export
              (sm:basis-auto). It scrolls inside itself only when its tabs do
              not fit, and it never wraps or switches to visible overflow — the
              old `sm:flex-wrap sm:overflow-x-visible` pair did both (CI run
              36764778803: no scroll at V640, a wrapped strip at V960). The native
              scrollbar is hidden ([scrollbar-width:none]) and iOS momentum-scrolls
              ([-webkit-overflow-scrolling:touch]); the cut-off tab peeking past the
              right edge IS the scroll affordance — no edge-fade overlay is
              added (DESIGN.md hairline-clean rule). `snap-x` + per-tab `snap-start shrink-0`
              (appended to the parity-pinned TAB_BUTTON_* consts below) snap each
              tab cleanly without compressing labels. */}
          <div
            role="tablist"
            aria-label="Allocation surfaces"
            className="flex flex-nowrap items-center gap-1 min-w-0 basis-full overflow-x-auto snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch] sm:basis-auto"
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
          <span aria-hidden className="mx-2 hidden h-4 w-px bg-border sm:inline-block" />
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
                announce(message);
              }
              changeTab("holdings");
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Export"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 2v8" />
              <path d="M5 7l3 3 3-3" />
              <path d="M3 13h10" />
            </svg>
            <span>Export</span>
          </button>
          {/* Phase 198 D-03 — the one primary header button. The label and
              the accessible name are the same on every tab (Scenario and its
              rollback surface included) and it opens the allocator's own
              add-allocation flow inline: no navigation, never the manager's
              strategy wizard, never a silent no-op, never a dropdown. */}
          <button
            ref={addButtonRef}
            type="button"
            onClick={handleHeaderAdd}
            className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={
              "Add allocation — pick a strategy and enter an amount"
            }
          >
            + Allocation
          </button>
        </div>
      </div>

      {/* audit-2026-05-07 M-1044 — the page's one polite live region: the Export
          chip's stub-navigation announcement and (Phase 198) the add-allocation
          success line. Visually hidden (sr-only) so the DESIGN.md visual
          contract is unchanged. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="allocations-tabs-live-region"
      >
        {liveAnnouncement}
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
      {/* Phase 198 D-03 — tab-agnostic host for the add-allocation flow.
          Rendered unconditionally (null while closed) so the header button can
          open it on every tab. Focus returns to the header trigger on every
          close path. */}
      <AddAllocationFlow
        // A new id while the flow is open re-points it: the flow resolves its
        // deep link once per mount, so a changed id needs a fresh mount.
        key={addFlow.deepLink?.raw ?? ""}
        open={addFlow.open}
        deepLink={addFlow.deepLink}
        onInvalidDeepLink={handleInvalidDeepLink}
        heldStrategyIds={heldStrategyIds}
        ownCapitalStrategyIds={ownCapitalStrategyIds}
        bookEquityUsd={bookEquity}
        allKeysStale={props.allKeysStale}
        onRecorded={handleFlowRecorded}
        onClose={handleFlowClose}
      />
    </div>
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

  // CF-05 — the compare panel needs a NARROW slice of the dashboard payload
  // (the same live fields the composer's book-mode engine reads). Construct it
  // explicitly, sourced from `props`, and annotate with
  // ScenarioComparePanelProps["payload"] so the compiler is the standing
  // contract gate — deleting a REQUIRED field here (or the panel widening its
  // requirement) fails the build. An OPTIONAL field (`tinyBaseDaysByApiKeyId`)
  // is not gated by the compiler; `AllocationsTabs.scenario-composer.test.tsx`
  // (T_AT5d) pins it. Replaces the prior `props`→panel double-cast
  // (an unchecked type erasure) that silently masked any payload/panel drift
  // (T-66-08). No zod schema — the data is server-trusted
  // SSR props, so a structural narrow is proportionate (Don't-Hand-Roll).
  const comparePanelPayload: ScenarioComparePanelProps["payload"] = {
    holdingsSummary: props.holdingsSummary,
    strategies: props.strategies,
    perKeyReturnsByApiKeyId: props.perKeyReturnsByApiKeyId,
    eligibleApiKeyIds: props.eligibleApiKeyIds,
    perKeyDailiesGateSatisfied: props.perKeyDailiesGateSatisfied,
    // Phase 151 AUM-04 / review WR-07 — the split gate + the contributing set.
    // Without these the panel's membership seams fall back to the role-blind
    // eligible set and the all-or-nothing flag, and compare diverges from the
    // composer for exactly the owner-manager / partial-book population this
    // phase exists to serve.
    bookEntryGateSatisfied: props.bookEntryGateSatisfied,
    contributingApiKeyIds: props.contributingApiKeyIds,
    // 188 D-07: the compare panel and the composer read the same tiny-base days.
    tinyBaseDaysByApiKeyId: props.tinyBaseDaysByApiKeyId,
  };

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
          payload={comparePanelPayload}
        />
      )}
    </div>
  );
}
