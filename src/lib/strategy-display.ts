import type { DisclosureTier } from "@/lib/types";

/**
 * Resolve a strategy display label.
 *
 * Phase 201 / D-09, D-17 (founder decision 2026-11-10, "Real name everywhere"):
 * the label is decided by whether the VIEWER can see the strategy in discovery
 * (`isDiscoveryVisible` in `@/lib/visibility`), not by its disclosure tier.
 *
 *   - visible in discovery -> `strategies.name` (trimmed, non-empty), else the
 *     codename, else `Strategy #<first 8 of id>`;
 *   - not visible          -> the codename, else `Strategy #<first 8 of id>`.
 *     The real name is never printed (197 D-02), institutional tier included.
 *
 * The caller states the visibility fact through the `viewer` argument. Manager
 * identity is a separate field and stays pseudonymous (`organization_name`).
 *
 * `viewer` is required (plan 201-26, D-09): typecheck makes every call site state
 * where its visibility fact comes from. An untyped caller that omits it is read as
 * not visible at runtime, so a missing fact can only withhold a name, never print one.
 * One exception, pre-existing and kept under D-17: the token-bearer factsheet lane can serve an
 * unpublished strategy and prints its name. Every `{ visible: true }` site is pinned by
 * `strategy-display.test.ts`, so a new one is a reviewed change.
 */
export interface DisplayableStrategy {
  id: string;
  name?: string | null;
  codename?: string | null;
  disclosure_tier?: DisclosureTier | null;
}

export function displayStrategyName(
  strategy: DisplayableStrategy | null | undefined,
  viewer: { visible: boolean },
): string {
  if (!strategy) return "Unnamed strategy";
  if (viewer?.visible === true) {
    const name = strategy.name?.trim();
    if (name) return name;
  }
  const codename = strategy.codename?.trim();
  return codename ? codename : `Strategy #${strategy.id.slice(0, 8)}`;
}

/**
 * Phase 200 / D-11, Phase 201 / D-09, D-17 - the names the public sees for one strategy.
 *
 * Both legs are what a viewer who can see the strategy in discovery reads: the
 * name, else the codename, else `Strategy #<id-prefix>`. The owner previews what
 * other viewers will see once the strategy is published, so the visibility fact
 * is `{ visible: true }` for both and the legs are equal. The two-leg return type
 * stays because the rename place states each surface in its own sentence.
 *
 * The factsheet `<title>` in `src/app/factsheet/[id]/v2/page.tsx` and the rename
 * place both call this, so what a manager is told the public sees runs the same
 * code as the public surface. Disclosure itself is unchanged: this helper reports
 * it, it does not decide it.
 */
export function publicNamePreview(strategy: DisplayableStrategy): {
  factsheet: string;
  discovery: string;
} {
  return {
    factsheet: displayStrategyName(strategy, { visible: true }),
    discovery: displayStrategyName(strategy, { visible: true }),
  };
}
