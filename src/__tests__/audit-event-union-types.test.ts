/**
 * B4c / H-0423 — compile-time tests for the `AuditEvent` discriminated union.
 *
 * These tests do NOT exercise runtime behaviour — they assert TYPES. `AuditEvent`
 * is derived from `AUDIT_ACTION_ENTITY_TYPE_MAP` so each arm pins `entity_type`
 * to the action's canonical value. If a regression flattens `AuditEvent` back to
 * an independent `{ action; entity_type }` pair (so a wrong pairing compiles
 * again), or changes a reconciled map entry back to its drifted value, the
 * `@ts-expect-error` lines below FLIP: the expected error disappears and
 * `tsc --noEmit` fails with "Unused '@ts-expect-error' directive". That tsc
 * failure IS the test (the `frontend-typecheck` CI job runs `tsc` before the
 * vitest job; vitest itself does not surface the directives at runtime).
 *
 * The single live `it()` is the runtime smoke check + a readable value-level
 * pin of the four B4c map reconciliations.
 */

import { describe, it, expect, vi } from "vitest";

// audit.ts imports "server-only" (throws under vitest) and `after` from
// next/server. We only read the const map here, but importing the value
// evaluates the module — mock both, matching audit.test.ts / audit.hh1.
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => void) => void fn }));

import { AUDIT_ACTION_ENTITY_TYPE_MAP } from "@/lib/audit";
import type { AuditEvent } from "@/lib/audit";

// All type-level assertions live inside this never-invoked function — only its
// TS body is type-checked. (Mirrors src/__tests__/seed-demo-data-types.test.ts.)
// NOTE: the mis-pairing (`@ts-expect-error`) cases are written as SINGLE-LINE
// object literals on purpose. TS reports an object-literal-vs-union mismatch on
// the offending `entity_type:` property line, which for a multi-line literal is
// NOT the line immediately after the directive — so a multi-line form makes the
// directive land unreliably. Single-line keeps the error on the one line the
// directive guards.
function _typeAssertions(): void {
  // ── Baseline: a valid action↔entity_type pairing compiles. ──────────────
  const grant: AuditEvent = { action: "role.grant", entity_type: "user_app_role", entity_id: "x" };
  void grant;

  // A WRONG entity_type for a literal action is a compile error (H-0423). This
  // is the whole point of the union: pre-B4c this object compiled fine.
  // @ts-expect-error - role.grant must pair with user_app_role, not user
  const badGrant: AuditEvent = { action: "role.grant", entity_type: "user", entity_id: "x" };
  void badGrant;

  // ── B4c MAP reconciliation pins (the drift the union now rejects). ───────

  // trades.upload → strategy (ADR-0023 L149 + the call site; entity_id is the
  // strategy the bulk insert is owned by). Old drift was "trades_upload".
  const trades: AuditEvent = { action: "trades.upload", entity_type: "strategy", entity_id: "x" };
  void trades;
  // @ts-expect-error - trades.upload no longer pairs with the drifted "trades_upload"
  const tradesDrift: AuditEvent = { action: "trades.upload", entity_type: "trades_upload", entity_id: "x" };
  void tradesDrift;

  // allocator.holdings.sync_requested → api_key (ADR-0023 L192-218 reasoned
  // section + the call site; the polled key is the entity). Old drift: "allocation".
  const holdings: AuditEvent = { action: "allocator.holdings.sync_requested", entity_type: "api_key", entity_id: "x" };
  void holdings;
  // @ts-expect-error - holdings sync no longer pairs with the drifted "allocation"
  const holdingsDrift: AuditEvent = { action: "allocator.holdings.sync_requested", entity_type: "allocation", entity_id: "x" };
  void holdingsDrift;

  // intro.send_failed → strategy (failure path: no contact_request row exists,
  // so the forensic row anchors to strategy_id). Old drift: "contact_request".
  const introFail: AuditEvent = { action: "intro.send_failed", entity_type: "strategy", entity_id: "x" };
  void introFail;
  // @ts-expect-error - intro.send_failed no longer pairs with "contact_request"
  const introFailDrift: AuditEvent = { action: "intro.send_failed", entity_type: "contact_request", entity_id: "x" };
  void introFailDrift;

  // ── Computed (non-literal) action discriminants are still soundly checked. ─
  const cond = true as boolean;

  // A ternary action whose entity_type is valid for EVERY branch compiles —
  // no escape-hatch helper needed (the union alone closes the class).
  const ternaryOk: AuditEvent = {
    action: cond ? "bridge_outcome.record" : "bridge_outcome.update",
    entity_type: "bridge_outcome",
    entity_id: "x",
  };
  void ternaryOk;

  // A ternary action with a WRONG entity_type for one or both branches is STILL
  // a compile error — TS rejects the literal unless entity_type is canonical for
  // every branch. (Single-line so the directive lands on the right line.)
  // @ts-expect-error - "user" is wrong for both bridge_outcome.* branches
  const ternaryBad: AuditEvent = { action: cond ? "bridge_outcome.record" : "bridge_outcome.update", entity_type: "user", entity_id: "x" };
  void ternaryBad;

  // Mixed-domain ternary: entity_type valid for ONE branch but not the other.
  // @ts-expect-error - user_app_role is wrong for the bridge_outcome.update branch
  const ternaryMixed: AuditEvent = { action: cond ? "role.grant" : "bridge_outcome.update", entity_type: "user_app_role", entity_id: "x" };
  void ternaryMixed;
}
// Reference so it's not stripped as dead code.
void _typeAssertions;

// ── Runtime smoke check + readable value-level pin of the B4c reconciliation ─
describe("AuditEvent discriminated union (B4c / H-0423)", () => {
  it("AUDIT_ACTION_ENTITY_TYPE_MAP pins the four reconciled entries to their ADR-aligned entity_type", () => {
    // These four entries were corrected in B4c from definition-site drift to
    // match ADR-0023 + the actual emission sites. The union derives from this
    // map, so these values are now enforced by construction at every call site.
    expect(AUDIT_ACTION_ENTITY_TYPE_MAP["trades.upload"]).toBe("strategy");
    expect(AUDIT_ACTION_ENTITY_TYPE_MAP["allocator.holdings.sync_requested"]).toBe("api_key");
    expect(AUDIT_ACTION_ENTITY_TYPE_MAP["allocator.holdings.sync_completed"]).toBe("api_key");
    expect(AUDIT_ACTION_ENTITY_TYPE_MAP["allocator.holdings.sync_failed"]).toBe("api_key");
    expect(AUDIT_ACTION_ENTITY_TYPE_MAP["intro.send_failed"]).toBe("strategy");
  });
});
