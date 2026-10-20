/**
 * Phase 170.1.2 D-01 — /admin/partner-pilot/[partner_tag] shows names and words
 * where it showed id slices and raw values: allocators fall back to "Unknown
 * allocator", each strategy's manager is read from profiles (or "Unknown
 * manager"), status goes through the Badge status labels and the disclosure
 * tier through disclosureTierLabel. The tab title is pinned elsewhere
 * (Phase 170.1.1); this file does not touch generateMetadata.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const ALLOCATOR_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const STRATEGY_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const MANAGER_ID = "cccccccc-1111-4222-8333-444444444444";
const IDS = [ALLOCATOR_ID, STRATEGY_ID, MANAGER_ID];

const state = vi.hoisted(() => ({
  profiles: [] as Array<Record<string, unknown>>,
  strategies: [] as Array<Record<string, unknown>>,
  managerRows: [] as Array<Record<string, unknown>>,
  managerError: null as { code: string; message: string } | null,
  managerSelects: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("unexpected notFound");
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

// Self-returning, awaitable query builder. The partner-tagged profiles read
// uses .eq(); the manager-name read uses .in(), which flips the builder over
// to the manager rows.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let byIds = false;
      let cols = "";
      const builder: Record<string, unknown> = {};
      builder.select = (c: string) => {
        cols = c;
        return builder;
      };
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.in = () => {
        byIds = true;
        state.managerSelects.push(cols);
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) => {
        if (table === "contact_requests") {
          return resolve({ data: null, count: 0, error: null });
        }
        if (table === "strategies") {
          return resolve({ data: state.strategies, error: null });
        }
        return byIds
          ? resolve({ data: state.managerRows, error: state.managerError })
          : resolve({ data: state.profiles, error: null });
      };
      return builder;
    },
  }),
}));

import PartnerPilotPage from "./page";

const params = Promise.resolve({ partner_tag: "acme" });

function strategy(over: Record<string, unknown> = {}) {
  return {
    id: STRATEGY_ID,
    name: "Alpha Fund",
    status: "published",
    disclosure_tier: "exploratory",
    user_id: MANAGER_ID,
    ...over,
  };
}

function expectNoIds(container: HTMLElement) {
  const text = container.textContent ?? "";
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
}

beforeEach(() => {
  state.profiles = [
    { id: ALLOCATOR_ID, display_name: "", email: null, role: "allocator", allocator_status: "verified" },
  ];
  state.strategies = [strategy()];
  state.managerRows = [{ id: MANAGER_ID, display_name: "Mia Manager" }];
  state.managerError = null;
  state.managerSelects = [];
});

describe("/admin/partner-pilot/[partner_tag] labels and names", () => {
  it("reads an allocator with no name or email as Unknown allocator, in text and title", async () => {
    const { container } = render(await PartnerPilotPage({ params }));
    expect(screen.getAllByText("Unknown allocator").length).toBe(1);
    expect(container.querySelector('[title="Unknown allocator"]')).not.toBeNull();
    expectNoIds(container);
  });

  it("names the strategy's manager from profiles, with explicit columns", async () => {
    const { container } = render(await PartnerPilotPage({ params }));
    expect(container.textContent).toContain("Mia Manager");
    expect(state.managerSelects).toEqual(["id, display_name"]);
    expect(container.textContent).not.toContain("Unknown manager");
  });

  it("reads a manager with no profile row as Unknown manager", async () => {
    state.managerRows = [];
    const { container } = render(await PartnerPilotPage({ params }));
    expect(container.textContent).toContain("Unknown manager");
    expectNoIds(container);
  });

  it("labels the status and the disclosure tier", async () => {
    const { container } = render(await PartnerPilotPage({ params }));
    const text = container.textContent ?? "";
    expect(text).toContain("Published");
    expect(text).toContain("Exploratory");
    expect(text).not.toContain("published");
    expect(text).not.toContain("exploratory");
  });

  it("reads a tier and a status outside their sets as Unknown tier / Unknown status", async () => {
    state.strategies = [strategy({ disclosure_tier: "zzz", status: "yyy" })];
    const { container } = render(await PartnerPilotPage({ params }));
    const text = container.textContent ?? "";
    expect(text).toContain("Unknown tier");
    expect(text).toContain("Unknown status");
    expect(text).not.toContain("zzz");
    expect(text).not.toContain("yyy");
  });

  it("fails loud, naming the query, when the manager-name read errors", async () => {
    state.managerError = { code: "PGRST000", message: "boom" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(PartnerPilotPage({ params })).rejects.toThrow(
      /managerNames query failed/,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[admin/partner-pilot] managerNames query failed",
      { code: "PGRST000", message: "boom" },
    );
    errorSpy.mockRestore();
  });
});
