"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AllocationDashboard } from "./AllocationDashboard";
import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import { ScenarioStub } from "./ScenarioStub";
import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { OutcomesTabPanel } from "./OutcomesTabPanel";
import { MandateTabPanel } from "./MandateTabPanel";
import { RiskTabPanel } from "./RiskTabPanel";
import { QA_MODE } from "@/lib/qa-mode";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// Phase 09.1 Plan 01 / D-17 — feature flag controlling whether the
// Overview tab renders AllocationDashboardV2 (the new designer-provided
// shell, scaffolded as an empty body for plans 02..11 to fill in) or the
// legacy AllocationDashboard.
//
// Storage values are canonical strings "true" / "false". SSR + Safari
// private-mode default to `false` (conservative — show legacy until the V2
// surface is ready and bake-tested). The `?ui=v2` URL override is a
// per-request opt-in that does NOT write to localStorage; it is also gated
// by NEXT_PUBLIC_QA_MODE so allocator-facing production URLs cannot bypass
// the legacy body during the bake window.
const UI_V2_STORAGE_KEY = "allocations.ui_v2";

function loadUiV2Flag(): boolean {
  if (typeof window === "undefined") return false; // SSR + Safari private-mode default: legacy (D-17 conservative)
  try {
    const raw = window.localStorage.getItem(UI_V2_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return false;
  } catch {
    return false;
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
 *   - Overview (default) — wraps AllocationDashboardV2 (under flag) or
 *     legacy AllocationDashboard.
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

const TAB_KEYS = ["overview", "holdings", "outcomes", "mandate", "risk", "scenario"] as const;
type TabKey = (typeof TAB_KEYS)[number];

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

export function AllocationsTabs(props: MyAllocationDashboardPayload) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Per VOICES-ACCEPTED f3: derive each render — no local state snapshot.
  const activeTab: TabKey = parseTab(searchParams.get("tab"));

  // D-17: feature flag — localStorage OR (?ui=v2 URL override gated by NEXT_PUBLIC_QA_MODE).
  // The URL override is NOT written to localStorage — it is a per-request override only.
  // useState initializer returns the SSR-safe default (false); the useEffect below
  // re-reads on mount so a client with localStorage["allocations.ui_v2"]="true" sees V2
  // on the second render. This avoids the React 19 hydration mismatch that would fire
  // if the initial render branched on a window-only value.
  // Phase 09.1 Plan 11 / V3 accepted — share the QA_MODE module-scope
  // constant with Tweaks.tsx so both consumers route through the same
  // import surface (single mock path in tests, single audit point for
  // production env reads).
  const uiOverride = QA_MODE && searchParams.get("ui") === "v2";
  const [uiV2Flag, setUiV2Flag] = useState<boolean>(() => loadUiV2Flag());
  useEffect(() => {
    setUiV2Flag(loadUiV2Flag());
  }, []);
  const uiV2 = uiV2Flag || uiOverride;

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
  useEffect(() => {
    if (activeTab !== "overview") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
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
    const idx = TAB_KEYS.indexOf(key);
    let next: TabKey | null = null;
    if (e.key === "ArrowRight") next = TAB_KEYS[(idx + 1) % TAB_KEYS.length];
    else if (e.key === "ArrowLeft")
      next = TAB_KEYS[(idx - 1 + TAB_KEYS.length) % TAB_KEYS.length];
    else if (e.key === "Home") next = TAB_KEYS[0];
    else if (e.key === "End") next = TAB_KEYS[TAB_KEYS.length - 1];
    if (next) {
      e.preventDefault();
      changeTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <div>
      {/* D-20 — primary "+ Allocation" header button. Routes to the Scenario
          tab via the same changeTab mechanism the tabs themselves use, so URL
          + tab state stay in sync. Pre-Phase-10 lands on ScenarioStub; Phase
          10 fills the composer behind the same URL. No alternative routing
          (no /allocations/new route, no modal) — the Scenario tab IS the
          allocation entry point. */}
      <div className="flex items-center justify-end gap-2 mb-3">
        <button
          type="button"
          onClick={() => changeTab("scenario")}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Add allocation — open Scenario tab"
        >
          + Allocation
        </button>
      </div>
      <div
        role="tablist"
        aria-label="Allocation surfaces"
        className="flex gap-1 border-b border-border mb-6"
      >
        {TAB_KEYS.map((key) => {
          const isActive = activeTab === key;
          const label = TAB_LABELS[key];
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
              className={
                isActive
                  ? "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px border-accent text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  : "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px border-transparent text-text-muted hover:text-text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="panel-overview"
        aria-labelledby="tab-overview"
        hidden={activeTab !== "overview"}
      >
        {activeTab === "overview" && (uiV2 ? <AllocationDashboardV2 {...props} /> : <AllocationDashboard {...props} />)}
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
        {activeTab === "scenario" && (
          <ScenarioStub
            flaggedHoldings={props.flaggedHoldings}
            matchDecisionsByHoldingRef={props.matchDecisionsByHoldingRef}
          />
        )}
      </div>
    </div>
  );
}
