"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AllocationDashboard } from "./AllocationDashboard";
import { ScenarioStub } from "./ScenarioStub";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

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

  // 5s polling — only while on Performance + document visible
  // (Phase 06 D-11 inherited pattern). Never polls on Scenario.
  useEffect(() => {
    if (activeTab !== "performance") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [activeTab, router]);

  // Tab click handler — update URL; the URL change triggers a re-render
  // which re-derives activeTab. No local state for activeTab.
  const handleTabClick = (key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "performance") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div>
      <div
        role="tablist"
        className="flex gap-1 border-b border-border mb-6"
      >
        {TAB_KEYS.map((key) => {
          const isActive = activeTab === key;
          const label = key === "performance" ? "Performance" : "Scenario";
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabClick(key)}
              className={
                isActive
                  ? "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px border-accent text-accent transition-colors"
                  : "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px border-transparent text-text-muted hover:text-text-primary transition-colors"
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === "performance" && (
        // Task 3 widens AllocationDashboard to accept the full Phase 07
        // payload (including `portfolio: Portfolio | null` and the 9 new
        // fields) + gates strategy-composite widgets on strategies.length > 0
        // per VOICES-ACCEPTED f2. Until that lands in the same plan's
        // next commit, spread the full payload and let AllocationDashboard
        // destructure what it needs.
        <AllocationDashboard {...props} />
      )}
      {activeTab === "scenario" && <ScenarioStub />}
    </div>
  );
}
