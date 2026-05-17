/**
 * Typed test helper to install a vi.fn() fetch mock on globalThis.fetch
 * without sprinkling `@ts-expect-error` directives across test files.
 *
 * Closes audit-2026-05-07 findings H-0404 and M-0470: both flagged the
 * duplicated `// @ts-expect-error — node test env exposes a mutable
 * global.fetch` pattern in StarToggle.test.tsx and StrategyTable.test.tsx
 * as a typing fragility (the @ts-expect-error silently becomes wrong if
 * vitest/node ever ship Fetch typings) and as a missing-restore hazard
 * (no afterEach unstub means the mock can leak across files in the same
 * test run if the pool ever changes from per-file isolation).
 *
 * Implementation: vi.stubGlobal pins the mock and is automatically
 * restored when vi.unstubAllGlobals() runs (Vitest does this between
 * test files when restoreMocks/unstubGlobals are enabled, and tests can
 * opt-in via afterEach too). The cast to `typeof fetch` keeps the
 * surface type-checked without `@ts-expect-error`.
 */
import { vi, type Mock } from "vitest";

// Vitest's Mock<T> takes a single function-type argument. We pin the call
// signature to typeof fetch so callers get autocomplete on .mockResolvedValue
// / .mockRejectedValue / .mock.calls without resorting to `any`.
export type FetchMock = Mock<typeof fetch>;

export function installFetchMock(): FetchMock {
  const mock = vi.fn().mockResolvedValue({ ok: true } as Response) as unknown as FetchMock;
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

export function restoreFetchMock(): void {
  vi.unstubAllGlobals();
}
