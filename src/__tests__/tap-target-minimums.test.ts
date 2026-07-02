import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tap-target minimums (WCAG 2.5.8, Target Size Minimum — 24px).
 *
 * Found by the 2026-06-30 device-profile authed sweep (/qa on prod via
 * Playwright MCP + per-device CDP device-metrics). Three allocator controls
 * rendered below the 24px minimum on touch profiles:
 *   - F1: ScenarioFactsheetChart `PeriodControl` pills — ~21px tall (`py-0.5`
 *         at the 10px tier). Raised to a 24px min via `min-h-6`. NOTE: this is
 *         a DELIBERATE divergence from the frozen factsheet TimeSeriesChart
 *         twin (which stays ~21px, un-editable pending VERIFY-04) — the two
 *         live on separate pages, never seen side-by-side.
 *   - F2a: OnboardingBanner dismiss `×` — 32×32 but a direct flex child with no
 *          `shrink-0`, so it compressed to ~15px wide on narrow phones. Pinned.
 *   - F2b: MandateQuickSetCard "Skip for now" — a bare `text-sm` button ~20px
 *          tall. Raised to the sibling `<Button>`'s 44px touch target.
 *
 * WHY THIS IS A SOURCE SCAN, NOT A RENDER TEST:
 *   The fixes are Tailwind utility-class LITERALS; the actual pixel size comes
 *   from Tailwind's compiled CSS, not from anything jsdom measures — jsdom has
 *   no layout engine, so `getBoundingClientRect()` reads all zeros and could
 *   never distinguish 24px from 21px. The durable, falsifiable guard is to read
 *   the source and assert the exact class literal on each control. Mirrors the
 *   RT-W2 `admin-width.test.tsx` idiom (readFileSync + className-substring). The
 *   live 24px/44px verification is the post-deploy device sweep.
 */

const REPO = process.cwd();

const CONTROLS: { label: string; path: string; mustContain: string }[] = [
  {
    label: "F1 ScenarioFactsheetChart period pill (min-h-6 = 24px)",
    path: join(
      REPO,
      "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx",
    ),
    mustContain:
      "inline-flex min-h-6 items-center justify-center rounded-sm border border-border bg-surface-subtle px-2 text-fixed-10",
  },
  {
    label: "F2a OnboardingBanner dismiss × (shrink-0 keeps 32×32)",
    path: join(
      REPO,
      "src/app/(dashboard)/allocations/components/OnboardingBanner.tsx",
    ),
    mustContain: "relative inline-flex h-8 w-8 shrink-0 items-center",
  },
  {
    label: "F2b MandateQuickSetCard 'Skip for now' (min-h-[44px] touch target)",
    path: join(
      REPO,
      "src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx",
    ),
    mustContain: "inline-flex items-center min-h-[44px] text-sm text-text-muted",
  },
  // Phase 58/59 pre-landing review (2026-07-02) — three coverage-surface
  // controls found below the 24px minimum, fixed with the same two idioms:
  {
    label:
      "DefaultChangeNote dismiss × (F2a idiom: fixed 32×32, shrink-0 pinned)",
    path: join(
      REPO,
      "src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx",
    ),
    mustContain:
      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
  },
  {
    label:
      "ProvenanceNote dismiss × (F2a idiom — identical twin of DefaultChangeNote's)",
    path: join(
      REPO,
      "src/app/(dashboard)/allocations/components/ProvenanceNote.tsx",
    ),
    mustContain:
      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
  },
  {
    label:
      "ScenarioComposer auto-excluded Include text-button (F1 idiom: min-h-6 = 24px)",
    path: join(
      REPO,
      "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
    ),
    mustContain:
      "min-h-6 inline-flex flex-wrap items-center gap-1 rounded-sm text-fixed-11",
  },
];

describe("tap-target minimums — WCAG 2.5.8 (device-profile sweep 2026-06-30)", () => {
  for (const { label, path, mustContain } of CONTROLS) {
    it(`${label} carries its min-tap-size class contract`, () => {
      const src = readFileSync(path, "utf8");
      expect(
        src,
        `${label}: expected the source to contain the class literal ` +
          `\`${mustContain}\`. If the control was restyled, keep it at a ` +
          `>=24px min (WCAG 2.5.8) and update this contract; do not silently ` +
          `drop below the minimum.`,
      ).toContain(mustContain);
    });
  }

  it("the ScenarioFactsheetChart period pill no longer uses the ~21px py-0.5 recipe", () => {
    const src = readFileSync(
      join(
        REPO,
        "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx",
      ),
      "utf8",
    );
    // The old pill was `... bg-surface-subtle px-2 py-0.5 text-fixed-10 ...`.
    // Pin the negative so a revert to the sub-24px height fails loudly here.
    expect(src).not.toContain("bg-surface-subtle px-2 py-0.5 text-fixed-10");
  });
});
