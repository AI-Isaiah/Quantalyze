/**
 * Phase 170.1.1 D-06 — the /admin/users/[id] tab title.
 *
 * The title names the user, and the name is read with the service-role client.
 * That read must sit behind the page's own admin gate, so a non-admin (or a
 * signed-out caller) gets the fixed title "User" and causes no profile read.
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

import { generateMetadata } from "./page";

const params = Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" });

beforeEach(() => {
  state.user = { id: "admin-1" };
  state.isAdmin = true;
  state.row = null;
  state.error = null;
  state.adminFrom.mockClear();
  state.selected = [];
  captureToSentryMock.mockClear();
});

describe("/admin/users/[id] generateMetadata", () => {
  it("names the user for an admin", async () => {
    state.row = { display_name: "Jane" };
    expect(await generateMetadata({ params })).toEqual({ title: "User: Jane" });
  });

  it("selects the display name only, never the email", async () => {
    state.row = { display_name: "Jane" };
    await generateMetadata({ params });
    expect(state.selected).toEqual(["display_name"]);
  });

  it("falls back to User when the row is missing", async () => {
    state.row = null;
    expect(await generateMetadata({ params })).toEqual({ title: "User" });
  });

  it("falls back to User when the profile has no display name", async () => {
    state.row = { display_name: null };
    expect(await generateMetadata({ params })).toEqual({ title: "User" });
  });

  it("falls back to User on a read error and captures it", async () => {
    state.row = { display_name: "Jane" };
    state.error = { message: "boom" };
    expect(await generateMetadata({ params })).toEqual({ title: "User" });
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
  });

  it("gives a non-admin the fixed title and causes no profile read", async () => {
    state.isAdmin = false;
    state.row = { display_name: "Jane" };
    expect(await generateMetadata({ params })).toEqual({ title: "User" });
    expect(state.adminFrom).not.toHaveBeenCalled();
  });

  it("gives a signed-out caller the fixed title and causes no profile read", async () => {
    state.user = null;
    state.row = { display_name: "Jane" };
    expect(await generateMetadata({ params })).toEqual({ title: "User" });
    expect(state.adminFrom).not.toHaveBeenCalled();
  });
});
