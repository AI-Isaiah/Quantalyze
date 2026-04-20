import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OnboardingWizard } from "./OnboardingWizard";

/**
 * Phase 07 Plan 06 Task 2 — OnboardingWizard noseed regression test
 * (PURGE-05 / VOICES-ACCEPTED f4).
 *
 * `handleComplete()` in OnboardingWizard must call ONLY
 * `supabase.from('profiles').update(...)` on the current user. It must
 * never insert a seed portfolio or seed allocator_holdings / seed
 * allocator_equity_snapshots row, directly or indirectly.
 *
 * This test drives handleComplete via the UI (click "Continue" → fill
 * step 2 → click "Get started") and asserts:
 *   1. supabase.from("profiles") was called and .update(...) fired.
 *   2. supabase.from("portfolios") was NEVER called.
 *   3. supabase.from("allocator_holdings") was NEVER called.
 *   4. supabase.from("allocator_equity_snapshots") was NEVER called.
 *   5. No mocked table ever received an .insert(...) call — the only
 *      permitted mutation is .update(...) on profiles.
 *
 * Migration-level audit (`ON auth.users` + seed-INSERT co-occurrence) is
 * handled by `src/__tests__/seed-integrity.test.ts`; this file stays
 * focused on component behaviour.
 */

// --- Supabase client mock ---------------------------------------------------

const fromCalls: string[] = [];
const updateCalls: Array<{ table: string; payload: unknown }> = [];
const insertCalls: Array<{ table: string; payload: unknown }> = [];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "test-user-id" } },
        error: null,
      }),
    },
    from: (table: string) => {
      fromCalls.push(table);
      return {
        update: (payload: unknown) => {
          updateCalls.push({ table, payload });
          return {
            eq: (_col: string, _val: unknown) => ({
              select: () =>
                Promise.resolve({
                  data: [{ id: "test-user-id" }],
                  error: null,
                }),
            }),
          };
        },
        insert: (payload: unknown) => {
          insertCalls.push({ table, payload });
          return {
            select: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        },
      };
    },
  }),
}));

// --- Next router mock -------------------------------------------------------

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------

async function renderAndCompleteWizard(): Promise<void> {
  render(<OnboardingWizard />);

  // Step 1 → Step 2 via "Continue" button.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  });

  // Step 2 → trigger handleComplete via "Get started" button.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
  });

  // Wait for the async handleComplete chain (auth.getUser → update → push)
  // to settle, surfaced by the router.push call.
  await waitFor(() => {
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
}

describe("PURGE-05: OnboardingWizard.handleComplete does not seed a portfolio", () => {
  beforeEach(() => {
    fromCalls.length = 0;
    updateCalls.length = 0;
    insertCalls.length = 0;
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("calls supabase.from('profiles').update(...) at least once", async () => {
    await renderAndCompleteWizard();

    expect(fromCalls).toContain("profiles");
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const profileUpdates = updateCalls.filter((c) => c.table === "profiles");
    expect(profileUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it("never calls supabase.from('portfolios')", async () => {
    await renderAndCompleteWizard();
    expect(fromCalls).not.toContain("portfolios");
  });

  it("never calls supabase.from('allocator_holdings')", async () => {
    await renderAndCompleteWizard();
    expect(fromCalls).not.toContain("allocator_holdings");
  });

  it("never calls supabase.from('allocator_equity_snapshots')", async () => {
    await renderAndCompleteWizard();
    expect(fromCalls).not.toContain("allocator_equity_snapshots");
  });

  it("never calls .insert on any table", async () => {
    await renderAndCompleteWizard();
    expect(insertCalls).toEqual([]);
  });
});
