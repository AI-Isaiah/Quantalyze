import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lightweight in-memory stand-in for the subset of the Supabase query
 * builder the project's admin helpers actually use. The real client is
 * ~1MB of PostgREST + auth + realtime glue; this file is a few hundred
 * bytes. Tests inject it via the optional `client?: SupabaseClient`
 * parameter the helpers expose, keeping production calls zero-argument
 * and tests explicit.
 *
 * Coverage surface:
 * - .from(table) entry
 * - .select(cols) (with or without terminal .single())
 * - .insert(row).select() / .insert(row).select().single()
 * - .update(row).eq(col,val).is(col,val).not(col,op,val).select()
 * - .delete().eq(col,val)
 * - Terminal awaits resolve to `{ data, error }`
 * - Filter chains stack (eq + is + not are AND-combined)
 *
 * NOT supported (throws if called — add when needed):
 * - .rpc, .storage, .auth, realtime, joins, or/in/ilike/contains, etc.
 */

type Row = Record<string, unknown>;
type FilterOp = (row: Row) => boolean;

/**
 * `.not(col, op, val)` op strings we know how to translate. Anything
 * outside this set throws at call time so a future test can't silently
 * get wrong data from an unsupported PostgREST operator.
 */
type NotOp = "is";
const SUPPORTED_NOT_OPS: ReadonlySet<string> = new Set<NotOp>(["is"]);

function buildNotFilter(col: string, op: string, val: unknown): FilterOp {
  if (!SUPPORTED_NOT_OPS.has(op)) {
    throw new Error(
      `[supabase/mock] .not(col, "${op}", ...) is not implemented. ` +
        `Supported ops: ${Array.from(SUPPORTED_NOT_OPS).join(", ")}. ` +
        `Extend buildNotFilter when the test needs it.`,
    );
  }
  // `.not(col, "is", null)` === SQL `col IS NOT NULL`. Use `!= null`
  // (double-equals) so both JS null and undefined cells are excluded,
  // matching PostgREST semantics where NULL is distinct from any value.
  if (val === null) {
    return (row) => row[col] != null;
  }
  return (row) => row[col] !== val;
}

interface Table {
  rows: Row[];
  /** Optional error to return from the next terminal read/write. */
  errorOnce?: { message: string } | null;
}

export interface MockStore {
  tables: Map<string, Table>;
  /** Every update call is logged here so tests can assert on call
   *  order, filter composition, and update payloads. */
  updateLog: Array<{
    table: string;
    update: Row;
    matchedIds: string[];
  }>;
}

export function createMockStore(): MockStore {
  return { tables: new Map(), updateLog: [] };
}

export function seedTable(
  store: MockStore,
  table: string,
  rows: Row[],
): void {
  store.tables.set(table, { rows: rows.map((r) => ({ ...r })) });
}

export function setTableErrorOnce(
  store: MockStore,
  table: string,
  error: { message: string },
): void {
  const t = getOrCreate(store, table);
  t.errorOnce = error;
}

function getOrCreate(store: MockStore, table: string): Table {
  let t = store.tables.get(table);
  if (!t) {
    t = { rows: [] };
    store.tables.set(table, t);
  }
  return t;
}

function matchRow(row: Row, filters: FilterOp[]): boolean {
  return filters.every((f) => f(row));
}

/**
 * Build a fake SupabaseClient that reads from / writes to the given
 * store. The return type is cast to SupabaseClient so call sites stay
 * typed — the chainable builder only implements what the helpers
 * actually use.
 */
export function createMockSupabaseClient(store: MockStore): SupabaseClient {
  function from(tableName: string) {
    const filters: FilterOp[] = [];

    function consumeError(): { message: string } | null {
      const t = getOrCreate(store, tableName);
      const err = t.errorOnce ?? null;
      if (err) t.errorOnce = null;
      return err;
    }

    function selectBuilder() {
      const builder = {
        eq(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        neq(col: string, val: unknown) {
          filters.push((row) => row[col] !== val);
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        not(col: string, op: string, val: unknown) {
          filters.push(buildNotFilter(col, op, val));
          return builder;
        },
        // `order` is accepted for API parity with the real Supabase
        // client; tests don't need deterministic ordering from the
        // mock — seeded rows come back in insertion order.
        order(col: string, opts?: { ascending?: boolean }) {
          void col;
          void opts;
          return builder;
        },
        limit(n: number) {
          (builder as unknown as { _limit?: number })._limit = n;
          return builder;
        },
        single() {
          return Promise.resolve(runSelect(true));
        },
        // Thenable returns an actual Promise so `.catch()` chains work
        // and the object is safe to await multiple times in tests.
        then<TResult = unknown>(
          resolve: (v: {
            data: Row[] | Row | null;
            error: { message: string } | null;
          }) => TResult,
        ): Promise<TResult> {
          return Promise.resolve().then(() => resolve(runSelect(false)));
        },
      };

      function runSelect(asSingle: boolean) {
        const err = consumeError();
        if (err) return { data: null, error: err };
        const t = getOrCreate(store, tableName);
        const matched = t.rows.filter((r) => matchRow(r, filters));
        const limited = (() => {
          const cap = (builder as unknown as { _limit?: number })._limit;
          return typeof cap === "number" ? matched.slice(0, cap) : matched;
        })();
        if (asSingle) {
          return { data: limited[0] ?? null, error: null };
        }
        return { data: limited, error: null };
      }

      return builder;
    }

    function mutationBuilder(
      kind: "update" | "delete",
      payload?: Row,
    ) {
      const builder = {
        eq(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        not(col: string, op: string, val: unknown) {
          filters.push(buildNotFilter(col, op, val));
          return builder;
        },
        select(cols?: string) {
          void cols;
          const selectResult = {
            single() {
              const result = runMutation();
              if (result.error) {
                return Promise.resolve({ data: null, error: result.error });
              }
              const first = result.data?.[0] ?? null;
              return Promise.resolve({ data: first, error: null });
            },
            then<TResult = unknown>(
              resolve: (v: {
                data: Row[] | null;
                error: { message: string } | null;
              }) => TResult,
            ): Promise<TResult> {
              return Promise.resolve().then(() => resolve(runMutation()));
            },
          };
          return selectResult;
        },
        then<TResult = unknown>(
          resolve: (v: {
            data: null;
            error: { message: string } | null;
          }) => TResult,
        ): Promise<TResult> {
          return Promise.resolve().then(() => {
            const result = runMutation();
            return resolve({ data: null, error: result.error });
          });
        },
      };

      function runMutation() {
        const err = consumeError();
        if (err) return { data: null, error: err };
        const t = getOrCreate(store, tableName);
        const matched = t.rows.filter((r) => matchRow(r, filters));
        const matchedIds = matched
          .map((r) => (typeof r.id === "string" ? r.id : null))
          .filter((id): id is string => id !== null);
        if (kind === "update" && payload) {
          for (const row of matched) {
            Object.assign(row, payload);
          }
          store.updateLog.push({
            table: tableName,
            update: { ...payload },
            matchedIds,
          });
        } else if (kind === "delete") {
          t.rows = t.rows.filter((r) => !matched.includes(r));
        }
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }

      return builder;
    }

    return {
      select(cols?: string) {
        void cols;
        return selectBuilder();
      },
      update(payload: Row) {
        return mutationBuilder("update", payload);
      },
      delete() {
        return mutationBuilder("delete");
      },
      insert(row: Row | Row[]) {
        const rows = Array.isArray(row) ? row : [row];
        const inserted = rows.map((r) => ({ ...r }));
        return {
          select(cols?: string) {
            void cols;
            return {
              single() {
                const err = consumeError();
                if (err) return Promise.resolve({ data: null, error: err });
                const t = getOrCreate(store, tableName);
                t.rows.push(...inserted);
                return Promise.resolve({ data: inserted[0] ?? null, error: null });
              },
              then(
                resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown,
              ) {
                const err = consumeError();
                if (err) return resolve({ data: null, error: err });
                const t = getOrCreate(store, tableName);
                t.rows.push(...inserted);
                return resolve({ data: inserted, error: null });
              },
            };
          },
        };
      },
    };
  }

  return { from } as unknown as SupabaseClient;
}
