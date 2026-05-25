/**
 * Type-level regression tests for WidgetMeta.status narrowing (M-0156 / H-0148).
 *
 * These tests encode WHY the narrowing matters:
 *   - The "todo" arm of the old `"ready" | "todo"` union was dead at runtime
 *     (zero registry entries; WidgetPicker hard-gates on status === "ready").
 *   - Keeping the "todo" arm in the type created an unsafe widening: code
 *     that reads `meta.status` had to handle a case that can never occur,
 *     and code that writes a WidgetMeta literal could accidentally set
 *     `status: "todo"` without a compile error even though the picker would
 *     silently swallow it.
 *   - The fix narrows to `status: "ready"` so the type reflects reality and
 *     the compiler catches any future re-introduction of dead-arm entries.
 */

import { describe, it, expectTypeOf } from "vitest";
import type { WidgetMeta } from "./types";

describe("WidgetMeta.status type contract (M-0156 / H-0148)", () => {
  it("status field is typed as the literal 'ready', not a string union", () => {
    // If status were `"ready" | "todo"` this would NOT hold because
    // expectTypeOf<"ready" | "todo">().toEqualTypeOf<"ready">() would fail.
    expectTypeOf<WidgetMeta["status"]>().toEqualTypeOf<"ready">();
  });

  it("a WidgetMeta literal with status: 'ready' satisfies the type", () => {
    const meta: WidgetMeta = {
      id: "equity-curve",
      name: "Equity Curve",
      category: "performance",
      icon: "▲",
      defaultW: 4,
      description: "test",
      status: "ready",
    };
    // confirm the type of meta.status is the literal "ready"
    expectTypeOf(meta.status).toEqualTypeOf<"ready">();
  });

  it("status: 'ready' is assignable to the status field (type-check)", () => {
    // This compiles only because "ready" satisfies `"ready"` (the narrowed type).
    // If the field were widened back to `"ready" | "todo"`, this test still
    // passes — but the NEXT test (guarded by @ts-expect-error) would start
    // failing to compile, alerting that the regression occurred.
    const status: WidgetMeta["status"] = "ready";
    expectTypeOf(status).toEqualTypeOf<"ready">();
  });

  it("'todo' is NOT assignable to WidgetMeta.status (regression guard)", () => {
    // @ts-expect-error — "todo" must NOT be assignable. If someone widens
    // status back to "ready" | "todo", TypeScript will stop raising the
    // error on the line below and this test will fail to compile, catching
    // the regression at the type-check / build stage before runtime.
    const _deadArm: WidgetMeta["status"] = "todo";
    void _deadArm;
  });
});
