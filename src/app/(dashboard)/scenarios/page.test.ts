/**
 * FLOW-02 (Phase 32) — /scenarios retirement redirect.
 *
 * The legacy Strategy-Sandbox page (role gate + createAdminClient read +
 * ScenarioBuilder) is retired. /scenarios now issues a 307 redirect to the
 * unified composer deep-link `/allocations?tab=scenario`. This replaces the
 * deleted page.role-gate.test.ts, whose admin-read assertions are now false.
 *
 * Non-vacuous: the assertion fails if the redirect target string changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mirror next/navigation's contract: redirect records the path and throws to
// unwind the RSC render. (Reuses the deleted role-gate test's pattern.)
const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

describe("ScenariosPage redirect (FLOW-02)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("307-redirects to the unified composer deep-link", async () => {
    const { default: ScenariosPage } = await import("./page");
    expect(() => ScenariosPage()).toThrow(
      /__REDIRECT__:\/allocations\?tab=scenario/,
    );
    expect(redirectMock).toHaveBeenCalledWith("/allocations?tab=scenario");
    // Exactly one redirect, to exactly the composer deep-link.
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });
});
