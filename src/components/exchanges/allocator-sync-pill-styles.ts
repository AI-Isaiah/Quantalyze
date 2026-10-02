// Plain (non-"use client") home of `AllocatorSyncStatus`'s pill style map.
//
// 167 review round 1 / IN-03 — MOVED here from `AllocatorSyncStatus.tsx`,
// byte-unchanged. A non-component export from a "use client" component module
// takes that module out of React Fast Refresh's component-only boundary (an
// edit forces a full reload), and leaves an importable client-reference value a
// future server component could pick up by mistake. The component and its
// roster test both import it from here.
//
// LOCKED pill colour map — do NOT deviate on any EXISTING row. `sign_in_failed`
// is a Phase 167 / D-11 arm-B EXTENSION, landed in the SAME commit as the
// migration that mints the value (T-167-08 — the map's unknown-key fallback
// in `AllocatorSyncStatus` normalises to `idle`, a NEUTRAL pill, so a partial
// rollout would otherwise render a BROKEN key as HEALTHY).
// `idle`/`syncing`/`complete` are neutral; `complete_with_warnings`/
// `rate_limited`/`sign_in_failed` are amber; `revoked`/`error` are red. No
// positive colour is used here — positive is reserved for future status
// states.
//
// ⛔ EXPORTED FOR THE ROSTER TEST, and the export is load-bearing. Because this
// map is typed `Record<string, …>`, `keyof typeof PILL_STYLES` is `string`, so
// the component's `switch (normalized)` is NON-EXHAUSTIVE BY CONSTRUCTION and
// `let pillLabel: React.ReactNode` admits `undefined` — TypeScript cannot flag
// a status that has a STYLE row here but no `case` there. The failure is
// silent and ugly: a correctly-coloured EMPTY pill. The only thing that can
// catch it is a test that walks THIS map at runtime, so the map has to be
// reachable from the test. A hand-listed roster in the test would reproduce
// the very defect (a second list that can fall out of step with this one).
export const PILL_STYLES: Record<
  string,
  { bg: string; text: string; border?: string }
> = {
  idle: { bg: "bg-[#F1F5F9]", text: "text-text-secondary" },
  syncing: { bg: "bg-[#F1F5F9]", text: "text-text-secondary" },
  complete: { bg: "bg-[#F1F5F9]", text: "text-text-secondary" },
  complete_with_warnings: { bg: "bg-warning/10", text: "text-warning" },
  rate_limited: { bg: "bg-warning/10", text: "text-warning" },
  revoked: { bg: "bg-negative/10", text: "text-negative" },
  error: { bg: "bg-negative/10", text: "text-negative" },
  // 167-UI-SPEC.md § Color — the DESIGN.md-pinned OPAQUE warning trio, not
  // the `bg-warning/10` alpha fill the neighbouring amber pills use: the
  // opaque `#FEF3C7` chip clears the 4.5:1 a11y minimum, the alpha fill does
  // not (measured in 167-UI-SPEC.md § Color, Contrast table).
  sign_in_failed: {
    bg: "bg-warning-bg",
    text: "text-warning",
    border: "border-warning-border",
  },
};
