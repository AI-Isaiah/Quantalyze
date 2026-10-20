/**
 * Phase 170.1.1 D-06 — the /admin/match/[allocator_id] tab title.
 *
 * The title names the allocator, read with the service-role client, so the
 * page's admin gate runs first: a non-admin or signed-out caller gets the
 * fixed title "Match queue" and causes no profile read. The title carries the
 * display name only, never an email.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  isAdmin: true,
  row: null as { display_name: string | null } | null,
  error: null as { message: string } | null,
  adminFrom: vi.fn(),
  selected: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => state.isAdmin),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.adminFrom(table);
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => {
        state.selected.push(cols);
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: state.row, error: state.error });
      return builder;
    },
  }),
}));

// A read error is reported, not only given a neutral title.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));

vi.mock("@/components/admin/AllocatorMatchQueue", () => ({
  AllocatorMatchQueue: () => null,
}));

import { generateMetadata } from "./page";

const params = Promise.resolve({
  allocator_id: "22222222-2222-2222-2222-222222222222",
});

beforeEach(() => {
  state.user = { id: "admin-1" };
  state.isAdmin = true;
  state.row = null;
  state.error = null;
  state.adminFrom.mockClear();
  state.selected = [];
  captureToSentryMock.mockClear();
});

describe("/admin/match/[allocator_id] generateMetadata", () => {
  it("names the allocator for an admin", async () => {
    state.row = { display_name: "Jane Allocator" };
    expect(await generateMetadata({ params })).toEqual({
      title: "Match queue for Jane Allocator",
    });
  });

  it("selects the display name only, never the email", async () => {
    state.row = { display_name: "Jane Allocator" };
    const meta = await generateMetadata({ params });
    expect(state.selected).toEqual(["display_name"]);
    expect(String(meta.title)).not.toContain("@");
  });

  it("falls back to the neutral Match queue when the row is missing", async () => {
    state.row = null;
    expect(await generateMetadata({ params })).toEqual({
      title: "Match queue",
    });
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to the neutral Match queue when the profile has no display name", async () => {
    state.row = { display_name: null };
    expect(await generateMetadata({ params })).toEqual({
      title: "Match queue",
    });
  });

  it("falls back to the neutral Match queue on a read error and captures it", async () => {
    state.row = { display_name: "Jane Allocator" };
    state.error = { message: "boom" };
    expect(await generateMetadata({ params })).toEqual({
      title: "Match queue",
    });
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
  });

  it("gives a non-admin the fixed title and causes no profile read", async () => {
    state.isAdmin = false;
    state.row = { display_name: "Jane Allocator" };
    expect(await generateMetadata({ params })).toEqual({
      title: "Match queue",
    });
    expect(state.adminFrom).not.toHaveBeenCalled();
  });

  it("gives a signed-out caller the fixed title and causes no profile read", async () => {
    state.user = null;
    state.row = { display_name: "Jane Allocator" };
    expect(await generateMetadata({ params })).toEqual({
      title: "Match queue",
    });
    expect(state.adminFrom).not.toHaveBeenCalled();
  });
});
