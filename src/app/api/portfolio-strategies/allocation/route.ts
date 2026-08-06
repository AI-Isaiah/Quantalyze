import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";
import { OWN_CAPITAL } from "@/lib/capital-ownership";

/**
 * POST / DELETE /api/portfolio-strategies/allocation
 *
 * Phase 150 / OWN-03 — the allocator puts their OWN capital behind one of
 * their own-capital-marked strategies, edits that amount, or removes the
 * position. This is the phase's MONEY WRITE; the money-path review notes live
 * in this docblock deliberately, so the next reader does not have to
 * reconstruct them from four migrations.
 *
 *   POST   body { strategy_id, allocated_amount }  → 200 { ok, allocated_amount }
 *   DELETE body { strategy_id }                    → 200 { ok }
 *
 * NO `portfolio_id` crosses the trust boundary (rev-4 / D-03-B). A
 * client-supplied container id was never trustworthy input (T-150-40): the
 * route derives the caller's real book from the session and provisions it on
 * absence, so cross-tenant container reach is impossible by construction
 * rather than by a pre-check that a future edit could drop.
 *
 * ── Money-path review notes ───────────────────────────────────────────────
 *
 * D-14 — this reuses the EXISTING `portfolio_strategies` write path and its
 * existing RLS. No new table, no new policy.
 *
 * DUPLICATE-ADD (D-13 / SC 4) is structurally impossible, not a UI
 * convention: `portfolio_strategies` has `PRIMARY KEY (portfolio_id,
 * strategy_id)` (20260405061911_initial_schema.sql:138-143), so the upsert
 * below CANNOT mint a second row for the same pair. A second allocate for the
 * same pair is an EDIT. This survives any future surface that forgets the
 * rule.
 *
 * RLS — `portfolio_strategies_owner` is `FOR ALL USING (portfolio_id IN
 * (SELECT id FROM portfolios WHERE user_id = auth.uid()))`
 * (20260405061912_rls_policies.sql:67-69). It declares no explicit
 * `WITH CHECK`; under `FOR ALL` Postgres reuses `USING` as the check, so the
 * INSERT/UPSERT arm IS covered. Noted, deliberately NOT "fixed".
 *
 * TRIGGER — `trg_portfolio_strategies_own_capital_only` is `BEFORE INSERT` on
 * `portfolio_strategies` (Plan 150-01). An upsert's ON CONFLICT path still
 * enters through the INSERT arm, so even an EDIT re-tests the mark. That is
 * deliberate: a strategy flipped to `team_review` between two allocates must
 * not be editable. The 409 pre-check below is UX; the trigger is the gate.
 *
 * DEFENCES (the /portfolio-strategies/alias six-defence stack):
 *   1. assertSameOrigin (CSRF).
 *   2. Auth: 401 if not logged in.
 *   3. Input validation BEFORE the limiter, so a rejected 400 does not burn
 *      one of the caller's own tokens (B15).
 *   4. mandateAutoSaveLimiter (30/min per user).
 *   5. Explicit `strategies.user_id` ownership pre-check → clean 404.
 *   6. Count-checked write: `.select()` on the upsert/delete, so zero rows is
 *      a deterministic status, never a silent-success oracle (G8.B.6).
 */

/**
 * ⛔ `current_weight` IS NEVER WRITTEN HERE — 150-RESEARCH § Schema Findings 2.
 *
 * The column has NO writer anywhere in the repo (src, supabase and
 * analytics-service were each censused). Two analytics consumers —
 * `analytics-service/routers/portfolio.py:594-597` and
 * `routers/match.py:786-792` — substitute `1.0` for a NULL weight and then
 * renormalize. So writing a real weight on ONE row while its siblings stay
 * NULL does not "improve" the book: it silently distorts
 * `portfolio_returns_series` and match scoring, giving the correctly-weighted
 * strategy ~19% and each unweighted sibling ~81% of the remainder.
 *
 * The Holdings Weight column is RENDER-DERIVED from `allocated_amount`
 * (D-12-B, `strategies-row-adapter.ts`) precisely so this column needs no
 * writer before Phase 151. Adding it to the payload below is a money-math
 * regression, not a feature.
 */

/** UUID shape (not version-conformant — shape only, as a cheap pre-DB guard). */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AllocationBody {
  strategy_id?: unknown;
  allocated_amount?: unknown;
}

function json(body: unknown, status: number, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: extraHeaders
      ? { ...NO_STORE_HEADERS, ...(extraHeaders as Record<string, string>) }
      : NO_STORE_HEADERS,
  });
}

/**
 * Parse the ticket amount.
 *
 * The parse itself is `MigrationWizard.tsx:65-69`'s (`Number()` +
 * `Number.isFinite` + `> 0`) with the upper bound that site is MISSING added.
 *
 * The bound is `MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD` ($1e9): an allocation
 * amount is semantically a TICKET, and this keeps the approved "$1B sanity
 * cap" dialog copy literally true. It is NOT `isValidDollar` — that validator
 * carries the AUM/capacity convention ($1e12, and it accepts 0), which is the
 * wrong shape for a money write that must reject a zero ticket.
 *
 * `typeof` is narrowed to number|string first, because `Number(true)`,
 * `Number(null)` and `Number([])` are all finite and would sail through an
 * unguarded `Number()`.
 */
function parseAmount(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string" && raw.trim().length > 0) {
    n = Number(raw);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n > MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD) return null;
  return n;
}

/**
 * Bind + log the parse failure (the alias route's G8.B.3 fix): a bare
 * `catch {}` hides parse failures, oversized bodies and AbortErrors alike.
 *
 * ⚠️ Only the LOGGING is extracted. The `await req.json()` itself stays INLINE
 * in each verb, deliberately: `limiter-ordering.test.ts:279-296` (the B15
 * helper-extraction guard) verifies validate-then-limit by locating a body
 * marker and `checkLimit` in the SAME method segment. Hoisting the parse into
 * a helper takes this route's ordering check dark without failing anything
 * else — which is exactly the regression that guard exists to catch.
 */
function logBodyParseFailure(err: unknown, userId: string): void {
  console.error("[api/portfolio-strategies/allocation] body parse failed:", {
    message: err instanceof Error ? err.message : String(err),
    userId,
  });
}

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: AllocationBody;
  try {
    body = (await req.json()) as AllocationBody;
  } catch (err) {
    logBodyParseFailure(err, user.id);
    return json({ error: "invalid json" }, 400);
  }

  const strategyId =
    typeof body.strategy_id === "string" ? body.strategy_id.trim() : "";
  if (!UUID_SHAPE.test(strategyId)) {
    return json({ error: "strategy_id is required" }, 400);
  }

  const allocatedAmount = parseAmount(body.allocated_amount);
  if (allocatedAmount === null) {
    return json(
      {
        error: `allocated_amount must be a positive number no greater than ${MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD}`,
      },
      400,
    );
  }

  // Consumed AFTER validation (B15) — an invalid request must not burn one of
  // the caller's own tokens.
  const rl = await checkLimit(mandateAutoSaveLimiter, `allocation:${user.id}`);
  if (!rl.success) {
    return json({ error: "Too many requests" }, 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }

  // ── Strategy pre-checks run FIRST (rev-4 verify W-1) ────────────────────
  // A request that will 404 or 409 must not mint a container. Ordering is the
  // whole mitigation here: move provisioning above this block and a probe for
  // someone else's strategy id starts creating portfolios.
  const { data: strategy, error: stratErr } = await supabase
    .from("strategies")
    .select("id, capital_ownership")
    .eq("id", strategyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (stratErr) {
    console.error(
      "[api/portfolio-strategies/allocation] strategy lookup failed:",
      stratErr.message,
    );
    return json({ error: "internal error" }, 500);
  }
  if (!strategy) return json({ error: "strategy not found" }, 404);

  // UX pre-check for a clean, actionable error. The BEFORE INSERT trigger
  // (Plan 150-01) is the ENFORCEMENT — this arm exists so the client renders
  // "mark it own-capital first" instead of a raw 23514.
  if (strategy.capital_ownership !== OWN_CAPITAL) {
    return json({ error: "not_allocatable" }, 409);
  }

  // ── Resolve-or-provision the caller's real book (rev-4, D-03-B) ─────────
  // Provisioning is CONTAINER-ONLY. The position write below still requires
  // the explicit Allocate action and an amount, so SC 3 (no auto-add) is
  // untouched: minting an empty book adds no strategy to it.
  const resolved = await resolveRealPortfolio(supabase, user.id);
  if (resolved.kind === "error") return json({ error: "internal error" }, 500);

  let portfolioId = resolved.id;
  let provisioned = false;

  if (portfolioId === null) {
    // The repo's ONLY `is_test = false` creation path. `CreatePortfolioForm`
    // deliberately inserts `is_test: true` (its docblock at :11-32 says a real
    // -book creator MUST set `is_test: false` explicitly and handle 23505
    // deliberately) and nothing else creates a real portfolio — so without
    // this, every allocator's book is portfolio-less and SC 2 is unreachable.
    // `name` follows migration 023's real-book seed convention.
    //
    // @audit-skip: this mint IS audited, on the SAME request's
    // `allocation.update` event — `metadata.provisioned: true` records it,
    // anchored on the very portfolio this insert creates. A separate event
    // would double-count one user action (there is no way to reach this line
    // except by allocating). The emission lives past the gate's 60-line
    // window only because the 23505 race arm sits between the two.
    const { data: created, error: insErr } = await supabase
      .from("portfolios")
      .insert({ user_id: user.id, name: "Active Allocation", is_test: false })
      .select("id")
      .single();

    if (insErr) {
      if (insErr.code === "23505") {
        // `portfolios_one_real_per_user` (20260409202756) — a concurrent
        // first-allocation won the race. Re-select and proceed; that is the
        // CreatePortfolioForm docblock's own prescription.
        const race = await resolveRealPortfolio(supabase, user.id);
        if (race.kind === "error" || race.id === null) {
          // The row vanished between insert and re-select, or the re-select
          // hit an RLS-shaped miss. NEVER fall through to the position write
          // with an undefined portfolio_id (rev-4 verify W-2).
          console.error(
            "[api/portfolio-strategies/allocation] 23505 race re-select found no real portfolio:",
            { userId: user.id },
          );
          return json({ error: "internal error" }, 500);
        }
        portfolioId = race.id;
      } else {
        console.error(
          "[api/portfolio-strategies/allocation] real-portfolio provisioning failed:",
          insErr.message,
        );
        return json({ error: "internal error" }, 500);
      }
    } else if (!created) {
      console.error(
        "[api/portfolio-strategies/allocation] provisioning returned no row",
      );
      return json({ error: "internal error" }, 500);
    } else {
      portfolioId = created.id;
      provisioned = true;
    }
  }

  // ── The write ───────────────────────────────────────────────────────────
  // Exactly three columns. See the current_weight block above before adding a
  // fourth.
  const { data: written, error: writeErr } = await supabase
    .from("portfolio_strategies")
    .upsert(
      {
        portfolio_id: portfolioId,
        strategy_id: strategyId,
        allocated_amount: allocatedAmount,
      },
      { onConflict: "portfolio_id,strategy_id" },
    )
    .select("strategy_id");

  if (writeErr) {
    console.error(
      "[api/portfolio-strategies/allocation] upsert failed:",
      writeErr.message,
    );
    return json({ error: "internal error" }, 500);
  }
  if (!written || written.length === 0) {
    // An upsert that returns nothing is an anomaly (RLS ate the row, or the
    // conflict target drifted) — not a "not found". Fail loud.
    console.error(
      "[api/portfolio-strategies/allocation] upsert returned zero rows:",
      { portfolioId, strategyId },
    );
    return json({ error: "internal error" }, 500);
  }

  logAuditEvent(supabase, {
    action: "allocation.update",
    entity_type: "allocation",
    // entity_id pins to the portfolio (the ownership anchor) — the alias
    // route's precedent; portfolio_strategies has no standalone UUID.
    entity_id: portfolioId,
    metadata: {
      strategy_id: strategyId,
      allocated_amount: allocatedAmount,
      ...(provisioned ? { provisioned: true } : {}),
    },
  });

  return json({ ok: true, allocated_amount: allocatedAmount }, 200);
}

export async function DELETE(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: AllocationBody;
  try {
    body = (await req.json()) as AllocationBody;
  } catch (err) {
    logBodyParseFailure(err, user.id);
    return json({ error: "invalid json" }, 400);
  }

  const strategyId =
    typeof body.strategy_id === "string" ? body.strategy_id.trim() : "";
  if (!UUID_SHAPE.test(strategyId)) {
    return json({ error: "strategy_id is required" }, 400);
  }

  const rl = await checkLimit(mandateAutoSaveLimiter, `allocation:${user.id}`);
  if (!rl.success) {
    return json({ error: "Too many requests" }, 429, {
      "Retry-After": String(rl.retryAfter),
    });
  }

  // DELETE NEVER PROVISIONS. A removal that mints a container would be absurd,
  // and it would burn the caller's one-real-portfolio slot on a no-op.
  const resolved = await resolveRealPortfolio(supabase, user.id);
  if (resolved.kind === "error") return json({ error: "internal error" }, 500);
  if (resolved.id === null) return json({ error: "portfolio not found" }, 404);

  const { data: removed, error: delErr } = await supabase
    .from("portfolio_strategies")
    .delete()
    .eq("portfolio_id", resolved.id)
    .eq("strategy_id", strategyId)
    .select("strategy_id");

  if (delErr) {
    console.error(
      "[api/portfolio-strategies/allocation] delete failed:",
      delErr.message,
    );
    return json({ error: "internal error" }, 500);
  }
  if (!removed || removed.length === 0) {
    // Count-checked (G8.B.6): a delete that touched nothing is a 404, not a
    // silent `{ok:true}`.
    return json({ error: "investment row not found" }, 404);
  }

  logAuditEvent(supabase, {
    action: "allocation.update",
    entity_type: "allocation",
    entity_id: resolved.id,
    metadata: { strategy_id: strategyId, removed: true },
  });

  return json({ ok: true }, 200);
}

/**
 * The caller's REAL book, resolved server-side from the session.
 *
 * Mirrors `getRealPortfolio` (queries.ts:1839-1858) filter-for-filter:
 * `.eq("user_id", …).eq("is_test", false).maybeSingle()`. The `is_test = false`
 * conjunct is ledger-pinned — without it a SCENARIO portfolio could be adopted
 * as the allocator's real book and real money would land in a what-if
 * container. Migration 023's partial unique index guarantees at most one row.
 *
 * Inlined rather than imported because `getRealPortfolio` is `React.cache()`-
 * wrapped and returns the whole `Portfolio`; a route only needs the id, and
 * caching a pre-provisioning miss inside the same request would defeat the
 * 23505 re-select.
 */
async function resolveRealPortfolio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ kind: "ok"; id: string | null } | { kind: "error" }> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)
    .eq("is_test", false)
    .maybeSingle();

  if (error) {
    console.error(
      "[api/portfolio-strategies/allocation] real-portfolio lookup failed:",
      error.message,
    );
    return { kind: "error" };
  }
  return { kind: "ok", id: data?.id ?? null };
}
