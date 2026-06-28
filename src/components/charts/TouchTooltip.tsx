"use client";

import { Tooltip } from "recharts";
import type { ComponentProps } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";

/**
 * Phase 48 / CHART-01b — the ONE breakpoint-gated Recharts `<Tooltip trigger>`
 * shim every in-scope Recharts chart consumes (plan 02 swaps `<Tooltip>` →
 * `<TouchTooltip>` across 18 files). The DRY anchor that avoids 18× inline
 * `trigger` duplication (D-Area-1).
 *
 * Touch parity without new gesture machinery: Recharts owns its own pointer
 * layer, so the native `trigger` prop IS the tap-to-pin path. On mobile we set
 * `trigger="click"` ("the Tooltip shows after clicking and stays active" —
 * node_modules/recharts/types/component/Tooltip.d.ts L168-175); on tablet +
 * desktop we set `trigger="hover"`, which is Recharts' own default — so the
 * desktop render and behavior stay BYTE-IDENTICAL to today (the falsifiable
 * proof of "no rewrite").
 *
 * SSR + the first client paint both resolve `useBreakpoint()` to `"desktop"`
 * (useMediaQuery's all-false server snapshot, useBreakpoint.ts:18-30) → both
 * render `"hover"`, so there is NO hydration mismatch; the flip to `"click"`
 * on mobile is a normal post-hydration re-render (RESEARCH Pitfall 1 — by
 * design). Do NOT read the breakpoint during SSR or force a single-pass.
 *
 * The shim wraps `<Tooltip>` ONLY — it never touches a chart root tag, so it
 * cannot affect the chart-root a11y-opt-out source-grep guard
 * (tests/visual/chart-accessibility-layer.test.ts, RESEARCH Pitfall 5).
 */
type TooltipProps = ComponentProps<typeof Tooltip>;

export function TouchTooltip(props: TooltipProps) {
  // Mirror the canonical "is mobile" spelling used at the live useTapPin call
  // site (HeatmapPanels.tsx:263) so the project has ONE definition of mobile.
  const trigger = useBreakpoint() === "mobile" ? "click" : "hover";
  // Spread AFTER `trigger` so a caller could override it (none do today — all
  // 18 charts pass only `formatter` + `contentStyle`).
  return <Tooltip trigger={trigger} {...props} />;
}
