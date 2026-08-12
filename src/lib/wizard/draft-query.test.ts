import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveDraftKind,
  draftMatchesSource,
  readLatestWizardDraft,
} from "./draft-query";

/**
 * Phase 154 / WIZCONT-01 — the single-sourced wizard-draft read.
 *
 * WHAT THESE TESTS ENCODE (Rule 9 — intent, not just behavior):
 *
 *  1. `deriveDraftKind` exists because `api_key_id === null` is true for BOTH a
 *     CSV draft and a member-bearing COMPOSITE draft (A4 / Pitfall W-2). The
 *     load-bearing case is therefore the BOUNDARY: `{api_key_id: null,
 *     member_count: 2}` must be "composite", never "csv" — a wrong answer here
 *     resumes a composite draft into the CSV upload step.
 *  2. A null membership count is UNKNOWABLE, not zero. `?? 0` on it silently
 *     downgrades a composite to a guessed branch, which is the same fabrication
 *     class the repo already refuses at `keys/sync/route.ts:555` and
 *     `SyncPreviewStep.tsx:1400-1413`. It must throw.
 *  2b. A membership count of ZERO is a successful read of a draft that has no
 *     branch evidence on it — a composite draft holds none until its Continue.
 *     It answers `null` (indeterminate) and the DRAFT IS WITHHELD, because the
 *     alternative ("csv") put a composite draft on the branch whose Start-fresh
 *     deletes it.
 *  3. `draftMatchesSource` is the rule BOTH entry paths apply, so it is pinned
 *     as a full truth table rather than at the one call site that exists first.
 *  4. `readLatestWizardDraft` RETURNS a draft-select error instead of throwing,
 *     because the SSR wizard page has always degraded to "start fresh" on a
 *     failed read; throwing would 500 the page. That posture is a decision, so
 *     it is asserted.
 *
 * ORACLE INDEPENDENCE: the expected column list, predicates and ordering below
 * are HAND-TYPED, never imported from the module under test — importing
 * `WIZARD_DRAFT_COLUMNS` would compare the query to itself and could not fail.
 */

// ── chainable postgrest double (donor: SyncPreviewStep.readfailure.runtime.test.tsx:146-199)
interface Recorded {
  table: string;
  columns: string | null;
  options: unknown;
  eq: Array<[string, unknown]>;
  order: Array<[string, { ascending?: boolean } | undefined]>;
  limit: number | null;
  maybeSingle: boolean;
}

function makeClient(
  resolvers: Record<string, (r: Recorded) => unknown>,
): { client: SupabaseClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client = {
    from(table: string) {
      const rec: Recorded = {
        table,
        columns: null,
        options: undefined,
        eq: [],
        order: [],
        limit: null,
        maybeSingle: false,
      };
      calls.push(rec);
      const resolve = () => {
        const r = resolvers[table];
        if (!r) throw new Error(`unexpected table: ${table}`);
        return r(rec);
      };
      const self = {
        select: (columns: string, options?: unknown) => {
          rec.columns = columns;
          rec.options = options;
          return self;
        },
        eq: (col: string, val: unknown) => {
          rec.eq.push([col, val]);
          return self;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          rec.order.push([col, opts]);
          return self;
        },
        limit: (n: number) => {
          rec.limit = n;
          return self;
        },
        maybeSingle: () => {
          rec.maybeSingle = true;
          return Promise.resolve(resolve());
        },
        // head:true counts are awaited directly (thenable), not via maybeSingle.
        then: (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onFulfilled),
      };
      return self;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    name: "My strategy",
    description: null,
    category_id: null,
    strategy_types: null,
    subtypes: null,
    markets: null,
    supported_exchanges: null,
    leverage_range: null,
    aum: null,
    max_capacity: null,
    api_key_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    asset_class: null,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deriveDraftKind — the CSV-vs-composite discriminator (A4 / Pitfall W-2)", () => {
  it("a linked api_key_id is an API draft, and no membership probe is consulted", () => {
    expect(
      deriveDraftKind({ api_key_id: "key-1", member_count: null }),
    ).toBe("api");
  });

  it("BOUNDARY: no api_key_id but members > 0 is COMPOSITE, not csv", () => {
    // The whole reason this function exists. `api_key_id === null` alone would
    // route this draft to the CSV upload step, which cannot feed it.
    expect(deriveDraftKind({ api_key_id: null, member_count: 2 })).toBe(
      "composite",
    );
  });

  it("no api_key_id and ZERO members is INDETERMINATE (null) — never 'csv'", () => {
    // ⭐ THE REGRESSION PIN. `member_count === 0` used to return "csv", and that
    // guess was destructive: `add_wizard_composite_key` stamps NO strategy_keys
    // row (its only writer, set_wizard_composite_members, runs on the multi-key
    // step's Continue), so EVERY composite draft sits in exactly this state for
    // the whole add-keys phase. Labelled "csv" it was offered on the CSV branch,
    // where the overlay force-switched the tab (ContributionWizardOverlay:138),
    // WizardClient seeded `strategyId` from it (:243-245), and "Start fresh"
    // DELETEd it (:819).
    //
    // The guess also had no upside: no CSV wizard draft can exist — the CSV
    // branch finalizes into a NEW source='csv' row and keeps `strategyId: ""`,
    // so the only writers of source='wizard' are the single-key RPC (api_key_id
    // NOT NULL) and the composite RPC (api_key_id NULL).
    expect(deriveDraftKind({ api_key_id: null, member_count: 0 })).toBeNull();
  });

  it("a null member count is UNKNOWABLE — it throws rather than fabricating a branch", () => {
    expect(() =>
      deriveDraftKind({ api_key_id: null, member_count: null }),
    ).toThrow(/unknowable/i);
  });

  it("the two indeterminate shapes are DISTINGUISHABLE: 0 members answers, a null count throws", () => {
    // Both are "cannot decide", but they are not the same event and must not
    // collapse into one arm. A null count is a BROKEN read (the probe failed to
    // measure) and stays loud; 0 members is a SUCCESSFUL read of a draft that
    // simply has not committed members yet — routine, and silent by design.
    // Collapsing 0 into the throw would 500 the overlay for every founder who
    // walked away mid-connect; collapsing the throw into null would hide a
    // broken probe.
    expect(deriveDraftKind({ api_key_id: null, member_count: 0 })).toBeNull();
    expect(() =>
      deriveDraftKind({ api_key_id: null, member_count: null }),
    ).toThrow();
  });
});

describe("draftMatchesSource — the branch-matching rule both entry paths apply", () => {
  const TRUTH_TABLE: Array<
    [Parameters<typeof draftMatchesSource>[0], string, boolean]
  > = [
    ["csv", "csv", true],
    ["csv", "api", false],
    ["api", "api", true],
    ["api", "csv", false],
    // A composite is assembled from API keys, so it lives on the API branch.
    ["composite", "api", true],
    ["composite", "csv", false],
  ];

  for (const [kind, source, expected] of TRUTH_TABLE) {
    it(`kind=${kind} on source=${source} → ${expected}`, () => {
      expect(draftMatchesSource(kind, source)).toBe(expected);
    });
  }
});

describe("readLatestWizardDraft — the one query shape", () => {
  it("issues the canonical columns, predicates, ordering and limit", async () => {
    const { client, calls } = makeClient({
      strategies: () => ({ data: draftRow(), error: null }),
    });

    const result = await readLatestWizardDraft(client, USER_ID);

    expect(result.kind).toBe("api");
    expect(result.error).toBeNull();
    expect(result.draft?.id).toBe(DRAFT_ID);

    // Only the strategies read — a single-key draft costs ONE round trip.
    expect(calls).toHaveLength(1);
    const [read] = calls;
    expect(read.table).toBe("strategies");
    expect(read.columns).toBe(
      "id, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, api_key_id, asset_class, created_at",
    );
    expect(read.eq).toEqual([
      ["user_id", USER_ID],
      ["source", "wizard"],
      ["status", "draft"],
    ]);
    expect(read.order).toEqual([["created_at", { ascending: false }]]);
    expect(read.limit).toBe(1);
    expect(read.maybeSingle).toBe(true);
  });

  it("no draft → {draft: null, kind: null} and no membership probe", async () => {
    const { client, calls } = makeClient({
      strategies: () => ({ data: null, error: null }),
    });

    expect(await readLatestWizardDraft(client, USER_ID)).toEqual({
      draft: null,
      kind: null,
      error: null,
    });
    expect(calls.map((c) => c.table)).toEqual(["strategies"]);
  });

  it("a draft with no api_key_id probes strategy_keys with a head-only exact count", async () => {
    const { client, calls } = makeClient({
      strategies: () => ({ data: draftRow({ api_key_id: null }), error: null }),
      strategy_keys: () => ({ count: 3, error: null }),
    });

    const result = await readLatestWizardDraft(client, USER_ID);

    expect(result.kind).toBe("composite");
    const probe = calls[1];
    expect(probe.table).toBe("strategy_keys");
    expect(probe.options).toEqual({ count: "exact", head: true });
    expect(probe.eq).toEqual([["strategy_id", DRAFT_ID]]);
  });

  it("zero members on a keyless draft → NO DRAFT IS OFFERED (the id never leaves the helper)", async () => {
    // The destructive chain starts with the draft ID crossing the wire: the CSV
    // branch's only use of `strategyId` is the DELETE behind "Start fresh"
    // (WizardClient:819 — every CSV autosave writes `strategyId: ""`). Withhold
    // the row and there is nothing for that button to destroy.
    //
    // `{draft: row, kind: null}` would NOT be enough: WizardClient falls back to
    // `source === "csv" ? "csv" : "api"` for a draft handed over without a kind
    // (:219-221), so a forwarded row resurrects the guess. Hence draft: null.
    const { client } = makeClient({
      strategies: () => ({ data: draftRow({ api_key_id: null }), error: null }),
      strategy_keys: () => ({ count: 0, error: null }),
    });

    const result = await readLatestWizardDraft(client, USER_ID);

    expect(result).toEqual({ draft: null, kind: null, error: null });
    expect(JSON.stringify(result)).not.toContain(DRAFT_ID);
  });

  it("a pre-Continue COMPOSITE draft cannot reach the CSV branch (the full chain, end to end)", async () => {
    // The state under test is the one every composite draft passes through:
    // add_wizard_composite_key has written strategies + api_keys, Continue has
    // not run, so strategy_keys is empty. Compose the two exported rules the way
    // both entry points do (page.tsx:108-110, ContributionWizardOverlay:162-165)
    // and assert the draft is offerable on NEITHER branch.
    const { client } = makeClient({
      strategies: () => ({ data: draftRow({ api_key_id: null }), error: null }),
      strategy_keys: () => ({ count: 0, error: null }),
    });

    const { draft, kind } = await readLatestWizardDraft(client, USER_ID);

    for (const source of ["csv", "api"]) {
      const offered =
        draft !== null && kind !== null && draftMatchesSource(kind, source);
      expect(offered).toBe(false);
    }
    // And the overlay's tab force-switch keys off exactly this value, so it
    // must not be the string that fires it.
    expect(kind).not.toBe("csv");
  });

  it("a null count with NO error throws — it never falls open to csv", async () => {
    const { client } = makeClient({
      strategies: () => ({ data: draftRow({ api_key_id: null }), error: null }),
      strategy_keys: () => ({ count: null, error: null }),
    });

    await expect(readLatestWizardDraft(client, USER_ID)).rejects.toThrow(
      /unknowable/i,
    );
  });

  it("a failed count probe throws — membership must not be guessed", async () => {
    const { client } = makeClient({
      strategies: () => ({ data: draftRow({ api_key_id: null }), error: null }),
      strategy_keys: () => ({
        count: null,
        error: { message: "boom: count failed" },
      }),
    });

    await expect(readLatestWizardDraft(client, USER_ID)).rejects.toThrow(
      /count failed/i,
    );
  });

  it("a draft-select error is RETURNED, not thrown, so the SSR page degrades to 'start fresh'", async () => {
    const { client, calls } = makeClient({
      strategies: () => ({
        data: null,
        error: { message: "boom: draft read failed" },
      }),
    });

    const result = await readLatestWizardDraft(client, USER_ID);

    expect(result.draft).toBeNull();
    expect(result.kind).toBeNull();
    expect(result.error?.message).toBe("boom: draft read failed");
    // No membership probe on a failed read.
    expect(calls.map((c) => c.table)).toEqual(["strategies"]);
  });
});
