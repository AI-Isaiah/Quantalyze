import type { ReactNode } from "react";

// Landmark wrapper for the PUBLIC factsheet route.
//
// `/factsheet/[id]/v2` is a top-level route — it does NOT sit under the
// `(dashboard)` shell, so nothing else supplies a `<main>` landmark. The shared
// `FactsheetView` renders `<article id="factsheet-main">`, which carries the
// content but is not a landmark, so a whole-document axe scan of this route
// fails `landmark-one-main` / `region` (WCAG best-practice) — the composite +
// leverage axe specs (91-04) surface it.
//
// The `<main>` is added HERE, at the route level, rather than by switching the
// shared `FactsheetView` <article> to <main>: that same component also mounts on
// `/strategy/[id]/v2` (under `(dashboard)`, which already provides a `<main>`),
// so promoting the article would double-`main` that path. A route-scoped layout
// only affects `/factsheet/[id]/v2`. The wrapper is a plain block with no
// margin/padding, so it is visually transparent (the article keeps its own
// `mx-auto max-w-[1440px]` centering).
export default function FactsheetV2Layout({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}
