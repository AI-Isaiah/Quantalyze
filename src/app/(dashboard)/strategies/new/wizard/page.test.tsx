/**
 * Phase 154 / WIZCONT-01 — the SSR wizard page APPLIES the branch rule.
 *
 * WHY THIS FILE EXISTS (the wiring, not the helper). `draft-query.test.ts`
 * already pins `draftMatchesSource` as a full truth table and
 * `readLatestWizardDraft` as a query shape. Neither of those can fail if the
 * page stops calling them, calls them with the wrong `source`, or drops
 * `initialDraftKind` on the floor — and dropping the kind is not cosmetic:
 * `WizardClient` resumes an api/composite draft on `sync_preview` and a CSV
 * draft on `csv_upload`, so a lost kind lands a composite draft in the CSV
 * upload step, which is WIZCONT-01 itself. The single-source grep gate
 * (`src/__tests__/wizard-draft-query-single-source.test.ts`) proves the page
 * does not hand-roll a SECOND query; it says nothing about what the page does
 * with the answer. This spec is that half.
 *
 * ORACLE INDEPENDENCE: `draftMatchesSource` is deliberately NOT mocked — the
 * real rule runs, so the cases below assert the branch OUTCOME the founder
 * sees (offered / not offered) rather than "the page called a function".
 *
 * Rule-9 falsifier (measured before landing): delete the
 * `draftMatchesSource(kind, source)` term and the CSV-branch case goes RED
 * with the api draft offered on the CSV branch; drop `initialDraftKind` from
 * the JSX and the composite case goes RED with `initialDraftKind: undefined`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import type { InitialDraft, WizardDraftKind } from "@/lib/wizard/draft-query";

vi.mock("server-only", () => ({}));

const { getUserMock, readDraftMock, clientPropsSpy } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  readDraftMock: vi.fn(),
  clientPropsSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

// Only the READ is doubled. `draftMatchesSource` stays real (see the docblock).
vi.mock("@/lib/wizard/draft-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/wizard/draft-query")>();
  return {
    ...actual,
    readLatestWizardDraft: (...args: unknown[]) => readDraftMock(...args),
  };
});

// The client island is where the props land; capture them rather than mounting
// the whole wizard (its own behavior is pinned in WizardClient.test.tsx).
vi.mock("./WizardClient", () => ({
  WizardClient: (props: Record<string, unknown>) => {
    clientPropsSpy(props);
    return React.createElement("div", { "data-testid": "wizard-client" });
  },
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

const DRAFT: InitialDraft = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Draft strategy",
  description: null,
  category_id: null,
  strategy_types: null,
  subtypes: null,
  markets: null,
  supported_exchanges: null,
  leverage_range: null,
  aum: null,
  max_capacity: null,
  api_key_id: null,
  asset_class: null,
};

async function renderPage(source?: string) {
  const mod = await import("./page");
  const ui = await mod.default({
    searchParams: Promise.resolve(source ? { source } : {}),
  });
  render(ui);
  return clientPropsSpy.mock.calls.at(-1)?.[0] as
    | { initialDraft: InitialDraft | null; initialDraftKind: WizardDraftKind | null }
    | undefined;
}

describe("[154 / WIZCONT-01] /strategies/new/wizard — the page applies the branch rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    readDraftMock.mockResolvedValue({ draft: null, kind: null, error: null });
  });

  it("forwards the draft AND its kind on the branch it belongs to", async () => {
    readDraftMock.mockResolvedValue({
      draft: DRAFT,
      kind: "composite",
      error: null,
    });

    const props = await renderPage();

    expect(props?.initialDraft).toEqual(DRAFT);
    // The kind is the load-bearing prop: without it WizardClient re-derives
    // "csv" from `api_key_id === null` and resumes a composite draft into the
    // CSV upload step.
    expect(props?.initialDraftKind).toBe("composite");
  });

  it("WITHHOLDS an api/composite draft from the CSV branch (a resume its upload cannot feed)", async () => {
    readDraftMock.mockResolvedValue({
      draft: DRAFT,
      kind: "composite",
      error: null,
    });

    const props = await renderPage("csv");

    expect(props?.initialDraft).toBeNull();
    expect(props?.initialDraftKind).toBeNull();
  });

  it("WITHHOLDS a CSV draft from the API branch, symmetrically", async () => {
    readDraftMock.mockResolvedValue({ draft: DRAFT, kind: "csv", error: null });

    const props = await renderPage();

    expect(props?.initialDraft).toBeNull();
    expect(props?.initialDraftKind).toBeNull();

    // Non-vacuity: the SAME draft IS offered once the branches agree.
    clientPropsSpy.mockClear();
    const onCsv = await renderPage("csv");
    expect(onCsv?.initialDraft).toEqual(DRAFT);
    expect(onCsv?.initialDraftKind).toBe("csv");
  });

  it("reads with the CALLER's id through the RLS-scoped client, never an admin one", async () => {
    await renderPage();

    expect(readDraftMock).toHaveBeenCalledTimes(1);
    expect(readDraftMock.mock.calls[0][1]).toBe(USER_ID);
  });

  it("DEGRADES to start-fresh when the read faults — never a 500", async () => {
    // The helper RETURNS the select error rather than throwing precisely so the
    // page can keep rendering; a page that consumed it as a draft, or rethrew,
    // would turn a transient PostgREST blip into a dead onboarding entry point.
    readDraftMock.mockResolvedValue({
      draft: null,
      kind: null,
      error: { code: "42501", message: "permission denied" },
    });

    const props = await renderPage();

    expect(props?.initialDraft).toBeNull();
    expect(props?.initialDraftKind).toBeNull();
  });

  it("redirects an unauthenticated visitor and reads NO draft (SEC-005)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(renderPage()).rejects.toThrow(
      "REDIRECT:/login?next=/strategies/new/wizard",
    );
    expect(readDraftMock).not.toHaveBeenCalled();
  });
});
