# Phase 5 — LAYOUT_VERSION 1 -> 2 Bump Impact Notes (Voice-D8)

**Storage:** `localStorage.getItem("quantalyze-dashboard-config")` — per-browser, NOT a DB row.
**Reset mechanism:** `useDashboardConfig.ts::loadConfig()` compares `parsed.layoutVersion` against the exported `LAYOUT_VERSION`; mismatch -> DEFAULT_LAYOUT replaces parsed.
**Server-side count:** zero — localStorage is not queryable from the server.
**User-visible effect:** any allocator who dragged widgets around on the /allocations grid will see their custom arrangement reset to DEFAULT_LAYOUT on their next page load after this ship. The new `outcomes-timeline` widget is in DEFAULT_LAYOUT, so it will be visible.
**Decision:** NO banner added for Phase 5. Rationale: low-count user pool (early-lifecycle product), widget visibility is the intended outcome, no reliable way to count affected users. If one or more users subsequently report that the reset was surprising, a future phase can add a one-session `<InsightStrip>` banner on the /allocations page ("We added Bridge Outcomes to your dashboard. Your previous layout has been reset — rearrange as needed.") — trivial one-file addition.
**Follow-up trigger:** if post-ship feedback includes "my dashboard reset itself", revisit.
**Referenced in:** SUMMARY.md phase-gate notes.
