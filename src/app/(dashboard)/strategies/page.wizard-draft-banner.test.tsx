/**
 * Regression — 2026-05-21 dogfood report.
 *
 * Pre-fix: a user who left mid-wizard and came back to /strategies saw
 * "No strategies yet. Create your first strategy." — their draft was
 * invisible because the existing list query filters out
 * `source = 'wizard' AND status = 'draft'` (to avoid routing through
 * the legacy StrategyForm). The hide-by-default was intentional but
 * total — no signal, no resume path, draft eventually gets cleaned up
 * by the cron sweeper without the user realizing.
 *
 * Post-fix: a separate query fetches the most-recent wizard draft. When
 * one exists, a "Resume draft" banner renders above the list AND the
 * empty-state CTA switches from "Create your first strategy" to
 * "Resume your draft" pointing at /strategies/new/wizard.
 *
 * The filter that hides wizard drafts inline stays — preserving the
 * StrategyForm-routing safety invariant the original comment guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));

// Stub next/link to a plain anchor (server-component compat under RTL).
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

// PageHeader pulls in client-only UI deps that the server-component
// render doesn't need; stub to a marker so we can assert the page
// reached the render step.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", null, title),
}));

vi.mock("@/components/strategy/StrategyActions", () => ({
  StrategyActions: () => null,
}));
vi.mock("@/components/strategy/ShareableLink", () => ({
  ShareableLink: () => null,
}));
vi.mock("@/components/strategy/PendingIntros", () => ({
  PendingIntros: () => null,
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

interface MockStrategyRow {
  id: string;
  name: string;
  status: string;
  source: string;
  strategy_types: string[];
  review_note: string | null;
  created_at: string;
  api_key_id: string | null;
}

interface MockDraftRow {
  id: string;
  name: string | null;
  created_at: string;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  publishedStrategies: [] as MockStrategyRow[],
  wizardDraft: null as MockDraftRow | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== "strategies" && table !== "contact_requests") {
        throw new Error(`Unexpected table: ${table}`);
      }

      // Builder mimics Supabase's PostgrestFilterBuilder shape closely
      // enough for the call sites in /strategies/page.tsx. The
      // .order() / .limit() chain must remain *thenable* so the list
      // query can `await` it AND the draft query can chain
      // .limit(1).maybeSingle() off it. We discriminate which fixture
      // to resolve at the resolution point (whether maybeSingle is
      // called) — the list query resolves directly on the awaited
      // order() result.
      const isContactRequests = table === "contact_requests";
      let isDraftQuery = false;
      const listResult = isContactRequests
        ? { data: [], error: null }
        : { data: state.publishedStrategies, error: null };

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === "source" && value === "wizard") {
            isDraftQuery = true;
          }
          return builder;
        },
        or: () => builder,
        in: () => builder,
        limit: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (isDraftQuery) {
            return { data: state.wizardDraft, error: null };
          }
          return { data: null, error: null };
        },
        // Thenable contract for the list query (`await ...order(...)`).
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: { data: unknown; error: unknown }) => any,
        ) => Promise.resolve(listResult).then(onF),
      };
      return builder;
    },
  }),
}));

async function renderPage(): Promise<HTMLElement> {
  const { default: StrategiesPage } = await import("./page");
  // server component returns a Promise<JSX>
  const jsx = await (StrategiesPage as unknown as () => Promise<React.ReactElement>)();
  const { container } = render(jsx);
  return container;
}

describe("StrategiesPage — wizard-draft Resume banner (2026-05-21 regression)", () => {
  beforeEach(() => {
    redirectMock.mockReset();
    state.user = { id: "u-test" };
    state.publishedStrategies = [];
    state.wizardDraft = null;
  });

  it("with NO published strategies AND NO wizard draft, shows 'Create your first strategy'", async () => {
    state.wizardDraft = null;
    const container = await renderPage();
    expect(container.textContent).toMatch(/no strategies yet/i);
    expect(container.textContent).toMatch(/create your first strategy/i);
    expect(container.textContent).not.toMatch(/unfinished/i);
    expect(container.textContent).not.toMatch(/resume/i);
  });

  it("with NO published strategies but a wizard draft, switches empty-state to 'Resume your draft'", async () => {
    state.wizardDraft = {
      id: "draft-1",
      name: "Alpha Centauri",
      created_at: "2026-05-21T12:00:00Z",
    };
    const container = await renderPage();
    // Empty-state CTA flipped to Resume
    expect(container.textContent).toMatch(/no published strategies yet/i);
    expect(container.textContent).toMatch(/draft in progress/i);
    expect(screen.getByText(/resume your draft/i)).toBeTruthy();
    // The original "Create your first strategy" copy must NOT appear
    // in this branch — that's the misleading message users hit pre-fix.
    expect(container.textContent).not.toMatch(/create your first strategy/i);
  });

  it("with a wizard draft AND published strategies, renders the banner above the list", async () => {
    state.publishedStrategies = [
      {
        id: "s-1",
        name: "Live Strategy",
        status: "published",
        source: "wizard",
        strategy_types: ["Momentum"],
        review_note: null,
        created_at: "2026-05-20T12:00:00Z",
        api_key_id: "k-1",
      },
    ];
    state.wizardDraft = {
      id: "draft-1",
      name: "WIP Alpha",
      created_at: "2026-05-21T12:00:00Z",
    };
    const container = await renderPage();
    // Banner present
    const banner = container.querySelector(
      "[data-testid='wizard-draft-resume-banner']",
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toMatch(/unfinished/i);
    expect(banner?.textContent).toContain("WIP Alpha");
    // Published strategy still rendered in the list
    expect(container.textContent).toContain("Live Strategy");
  });

  it("banner is absent when no wizard draft exists, even with published strategies", async () => {
    state.publishedStrategies = [
      {
        id: "s-1",
        name: "Live Strategy",
        status: "published",
        source: "wizard",
        strategy_types: ["Momentum"],
        review_note: null,
        created_at: "2026-05-20T12:00:00Z",
        api_key_id: "k-1",
      },
    ];
    state.wizardDraft = null;
    const container = await renderPage();
    const banner = container.querySelector(
      "[data-testid='wizard-draft-resume-banner']",
    );
    expect(banner).toBeNull();
    expect(container.textContent).toContain("Live Strategy");
  });
});
