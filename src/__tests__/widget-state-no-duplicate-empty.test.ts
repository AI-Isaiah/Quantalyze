import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Phase 11 / Plan 04 / D-10 — Meta-test: EmptyState reuse mandate.
 *
 * The "Connect Exchange →" CTA copy + accent-button pattern is the
 * canonical zero-state for /allocations. WidgetState mode='empty' MUST
 * reuse the chrome pattern (centered Card + accent CTA) without
 * duplicating EmptyState.tsx itself. To prevent regressions where a
 * future engineer copy-pastes the EmptyState markup into a new file,
 * this test walks src/ and asserts the literal string "Connect Exchange →"
 * only appears in the allow-listed files.
 *
 * Allow-list:
 *   - src/app/(dashboard)/allocations/EmptyState.tsx  (Phase 07 canonical)
 *   - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
 *       (pre-existing scenario-builder empty state with distinct
 *        "Scenario builder needs holdings" copy — different empty
 *        context, same CTA label is intentional)
 *   - src/app/(dashboard)/allocations/components/OnboardingBanner.tsx
 *       (Phase 11 / Plan 05 forward-compat — banner ships in Plan 05)
 *
 * Implementation uses node:fs (readdirSync, readFileSync, statSync)
 * only — NO child_process / execSync / spawn. Security hooks forbid
 * subprocess invocations from test code.
 */

function walkSrc(root: string, dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walkSrc(root, full, out);
    } else if (
      /\.(tsx?|jsx?)$/.test(entry) &&
      !/\.test\.(t|j)sx?$/.test(entry)
    ) {
      out.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

describe("EmptyState reuse mandate (D-10) — no duplicate Connect Exchange CTA pattern", () => {
  it('"Connect Exchange →" appears only in allow-listed files', () => {
    const root = resolve(__dirname, "../..");
    const files = walkSrc(root, join(root, "src"));
    const allowList = new Set([
      "src/app/(dashboard)/allocations/EmptyState.tsx",
      "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
      "src/app/(dashboard)/allocations/components/OnboardingBanner.tsx",
    ]);
    const offenders = files.filter((p) => {
      if (allowList.has(p)) return false;
      const src = readFileSync(join(root, p), "utf8");
      return src.includes("Connect Exchange →");
    });
    expect(offenders).toEqual([]);
  });
});
