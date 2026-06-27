"use client";

import { useMediaQuery } from "./useMediaQuery";

/**
 * The three viewport classes phases 45–48 branch on. JS-side breakpoint
 * branching only — pure-CSS responsive work stays in Tailwind utilities.
 */
export type Breakpoint = "mobile" | "tablet" | "desktop";

/**
 * SSR-safe breakpoint hook. A thin wrapper over {@link useMediaQuery} that
 * names the current viewport class using the Tailwind v4 default thresholds
 * (sm 640px, lg 1024px — no custom `--breakpoint-*` tokens exist in
 * globals.css `@theme`), so the JS values match the CSS utilities the later
 * phases apply.
 *
 * Uses the INVERSE (max-width) query shape so the all-false server snapshot
 * resolves to `'desktop'` for free: `useMediaQuery`'s `getServerSnapshot`
 * returns `false` for every query, so on the server both reads are `false`
 * and we fall through to `'desktop'`. That desktop-first server render matches
 * the all-false initial client snapshot — no hydration mismatch (mirrors the
 * `strategy.ui_v2` SSR-false convention, DESIGN.md decision-log 2026-04-29).
 */
export function useBreakpoint(): Breakpoint {
  const isMobile = useMediaQuery("(max-width: 639px)"); // < sm → mobile
  const isBelowLg = useMediaQuery("(max-width: 1023px)"); // < lg → tablet-or-below
  if (isMobile) return "mobile";
  if (isBelowLg) return "tablet";
  return "desktop";
}
