/**
 * Phase 170.1.2 D-01 — /admin/intros shows names and words where it showed
 * ids and raw values. A lookup miss reads "Unknown allocator" / "Unnamed
 * strategy"; source and snapshot status read through the shared labels; no id
 * reaches the rendered text or any title/aria-label attribute.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const ALLOCATOR_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const STRATEGY_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const REPLACEMENT_ID = "cccccccc-1111-4222-8333-444444444444";
const REQUEST_ID = "dddddddd-1111-4222-8333-444444444444";
const IDS = [ALLOCATOR_ID, STRATEGY_ID, REPLACEMENT_ID, REQUEST_ID];

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  strategies: [] as Array<Record<string, unknown>>,
}));

// `@/lib/intro/snapshot` is server-only; the page is a Server Component.
vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => true),
}));

// Self-returning, awaitable query builder keyed by table.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data:
            table === "contact_requests"
              ? state.rows
              : table === "profiles"
                ? state.profiles
                : state.strategies,
          error: null,
        });
      return builder;
    },
  }),
}));

import AdminIntrosPage from "./page";

function request(over: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    created_at: "2026-01-01T12:00:00Z",
    status: "pending",
    source: "direct",
    replacement_for: null,
    snapshot_status: "ready",
    allocator_id: ALLOCATOR_ID,
    strategy_id: STRATEGY_ID,
    message: null,
    mandate_context: null,
    portfolio_snapshot: null,
    ...over,
  };
}

beforeEach(() => {
  state.rows = [request()];
  state.profiles = [];
  state.strategies = [];
});

describe("/admin/intros labels and names", () => {
  it("reads a missing allocator and strategy as words, never an id", async () => {
    state.rows = [request({ source: "bridge", replacement_for: REPLACEMENT_ID })];
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";

    expect(text).toContain("Unknown allocator");
    expect(text).toContain("Unnamed strategy");
    for (const id of IDS) {
      expect(text).not.toContain(id);
      expect(text).not.toContain(id.slice(0, 8));
    }
    for (const el of container.querySelectorAll("[title], [aria-label]")) {
      const attrs = `${el.getAttribute("title")} ${el.getAttribute("aria-label")}`;
      for (const id of IDS) {
        expect(attrs).not.toContain(id);
        expect(attrs).not.toContain(id.slice(0, 8));
      }
    }
  });

  it("names the allocator and strategies when they resolve", async () => {
    state.rows = [request({ source: "bridge", replacement_for: REPLACEMENT_ID })];
    state.profiles = [
      { id: ALLOCATOR_ID, display_name: "Jane Doe", email: "jane@example.com", company: null },
    ];
    state.strategies = [
      { id: STRATEGY_ID, name: "Alpha Fund" },
      { id: REPLACEMENT_ID, name: "Beta Fund" },
    ];
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Alpha Fund");
    expect(text).toContain("Beta Fund");
    expect(text).not.toContain("Unknown allocator");
    expect(text).not.toContain("Unnamed strategy");
  });

  it("labels the source and the snapshot status", async () => {
    state.rows = [request({ source: "bridge", snapshot_status: "ready" })];
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";
    expect(text).toContain("Bridge");
    expect(text).toContain("Ready");
    expect(text).not.toContain("bridge");
    expect(text).not.toContain("ready");
  });

  it("reads a source outside the set as Other source", async () => {
    state.rows = [request({ source: "zzz" })];
    const { container } = render(await AdminIntrosPage());
    expect(container.textContent).toContain("Other source");
    expect(container.textContent).not.toContain("zzz");
  });
});
