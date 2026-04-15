"use client";

import { useState, useCallback } from "react";

const DEFAULT_TABS = [
  { id: "default", label: "Default" },
  { id: "morning-briefing", label: "Morning Briefing" },
  { id: "risk-review", label: "Risk Review" },
  { id: "allocation-decisions", label: "Allocation Decisions" },
] as const;

export type ViewTabId = (typeof DEFAULT_TABS)[number]["id"] | string;

interface ViewTabsProps {
  activeTab: ViewTabId;
  onTabChange: (tab: ViewTabId) => void;
}

export function ViewTabs({ activeTab, onTabChange }: ViewTabsProps) {
  const [tabs] = useState(DEFAULT_TABS);

  const handleTabClick = useCallback(
    (id: ViewTabId) => {
      onTabChange(id);
    },
    [onTabChange],
  );

  return (
    <nav
      role="tablist"
      aria-label="Dashboard views"
      className="flex items-center gap-0 border-b border-[#E2E8F0]"
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => handleTabClick(tab.id)}
            className="relative px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: active ? "#1A1A2E" : "#718096",
            }}
          >
            {tab.label}
            {active && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: "#1B6B5A" }}
              />
            )}
          </button>
        );
      })}
      <button
        type="button"
        className="px-4 py-2.5 text-sm font-medium transition-colors"
        style={{ color: "#718096" }}
        aria-label="Add new view"
      >
        + New View
      </button>
    </nav>
  );
}
