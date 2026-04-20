"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AllocationDashboard } from "./AllocationDashboard";
import { ScenarioStub } from "./ScenarioStub";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// Live-refresh polling inherits the Phase 06 D-11 cadence. Named so cross-page
// audits of polling behaviour can grep for a single symbol.
const PERFORMANCE_POLL_INTERVAL_MS = 5_000;

/**
 * Phase 07 Plan 04 / PURGE-07 / D-04 — Tabs shell for /allocations.
 *
 * Two surfaces:
 *   - Performance (default) — wraps the existing AllocationDashboard.
 *   - Scenario (stub) — placeholder Card for the future Phase 10 builder.
 *
 * URL state (D-04):
 *   /allocations                  → Performance
 *   /allocations?tab=performance  → Performance (param deleted on mount)
 *   /allocations?tab=scenario     → Scenario
 *   /allocations?tab=<anything>   → Performance (silent fallback)
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
 * Live-refresh polling (Phase 06 D-11 inheritance): 5s router.refresh()
 * while Performance is active AND document.visibilityState is visible.
 * Never polls while on Scenario (no data to refresh).
 *
 * Suspense: This component calls `useSearchParams()` which triggers the
 * Next.js 16 CSR-bailout rule — the caller (page.tsx) wraps us in
 * <Suspense fallback={<div />}>.
 */

const TAB_KEYS = ["performance", "scenario"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function parseTab(raw: string | null): TabKey {
  // D-04: anything that is not literally "scenario" collapses to
  // "performance" — silent fallback for missing, empty, or invalid values.
  return raw === "scenario" ? "scenario" : "performance";
}

export function AllocationsTabs(props: MyAllocationDashboardPayload) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Per VOICES-ACCEPTED f3: derive each render — no local state snapshot.
  const activeTab: TabKey = parseTab(searchParams.get("tab"));

  // Scroll-safe URL cleanup: if the allocator lands on ?tab=performance
  // (redundant), strip it so the canonical URL is /allocations. Runs
  // after render to avoid touching render-phase state; shallow-replace
  // does not trigger another data fetch.
  useEffect(() => {
    const current = searchParams.get("tab");
    if (current === "performance") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tab");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [searchParams, router, pathname]);

  // Live-refresh polling — only while on Performance + document visible
  // (Phase 06 D-11 inherited pattern). Never polls on Scenario.
  useEffect(() => {
    if (activeTab !== "performance") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, PERFORMANCE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeTab, router]);

  // Tab change — update URL; the URL change triggers a re-render which
  // re-derives activeTab. No local state for activeTab.
  const changeTab = (key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "performance") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // WAI-ARIA authoring-practices tab pattern: Arrow keys move focus between
  // tabs, Home/End jump to first/last. Tab/Shift-Tab leaves the tablist.
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    performance: null,
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
      <div
        role="tablist"
        aria-label="Allocation surfaces"
        className="flex gap-1 border-b border-border mb-6"
      >
        {TAB_KEYS.map((key) => {
          const isActive = activeTab === key;
          const label = key === "performance" ? "Performance" : "Scenario";
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
        id="panel-performance"
        aria-labelledby="tab-performance"
        hidden={activeTab !== "performance"}
      >
        {activeTab === "performance" && <AllocationDashboard {...props} />}
      </div>
      <div
        role="tabpanel"
        id="panel-scenario"
        aria-labelledby="tab-scenario"
        hidden={activeTab !== "scenario"}
      >
        {activeTab === "scenario" && <ScenarioStub />}
      </div>
    </div>
  );
}
