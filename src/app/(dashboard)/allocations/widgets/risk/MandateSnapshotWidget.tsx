"use client";

import Link from "next/link";
import type { WidgetProps } from "../../lib/types";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  countPassingGates,
  deriveMandateGates,
  type GateRow,
} from "../../lib/mandate-gates";
import { WidgetState } from "../../components/WidgetState";
import { isWidgetStateV2Enabled } from "@/lib/widget-state-flag";

/**
 * Phase 09.1 PR1 (dashboard parity) — V2 Overview MandateSnapshot widget.
 *
 * Renders the prototype's `MandateSnapshot` (designer source: prototype
 * `app.jsx:481-514`) byte-for-byte: card with header (`Mandate` title +
 * "Auto-saved · N/M gates pass" sub-copy + ghost `Edit →` link to
 * `/profile?tab=mandate`) and 5 gate rows with pass/fail dot, label,
 * threshold (muted), divider, and current value (bold, negative-tinted on
 * fail).
 *
 * Visual fidelity contract: every inline style + every `var(--token)`
 * matches the prototype byte-for-byte (modulo TS typing). The render path is
 * intentionally pure-presentation — gate computation lives in
 * `lib/mandate-gates.ts` so the prototype's hardcoded rule literals can be
 * swapped for live `MyAllocationDashboardPayload` data without touching the
 * JSX tree.
 *
 * Empty-state behavior: when `payload.mandate` is null (no row yet, or
 * `allocator_preferences` table not provisioned), every gate degrades to
 * em-dash threshold + em-dash current + muted dot. Header sub-copy switches
 * to "No mandate set yet" so the operator can spot the empty state without
 * the layout collapsing.
 */
export function MandateSnapshotWidget({ data }: WidgetProps) {
  // The render dispatcher in AllocationDashboardV2 passes the entire payload
  // as `data: any` (legacy WidgetProps contract). Re-narrow to the typed
  // shape for safe field access; defensive against partial payloads in tests.
  const payload = (data ?? {}) as Partial<MyAllocationDashboardPayload>;
  const gates = deriveMandateGates(
    payload.mandate ?? null,
    payload.analytics ?? null,
    payload.holdingsSummary ?? [],
    payload.strategies ?? [],
  );
  const { passing, total } = countPassingGates(gates);
  const hasMandate = payload.mandate != null;

  // Phase 11 / UI-BLOCK-01 — wire WidgetState v2 behind the feature flag.
  // The widget's empty branch is a sub-copy swap inside the existing
  // card chrome ("No mandate set yet" vs "Auto-saved · N/M gates pass"
  // — see hasMandate ternary below). The 5 gate rows render verbatim
  // in either case (em-dashed when no data) — there's no separate
  // render path. mode="success" passthrough proves the primitive is
  // consumed in production while preserving byte-identical visual
  // output.
  const v2 = isWidgetStateV2Enabled();
  const card = (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header — prototype app.jsx:491-497 */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Mandate</h3>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            {hasMandate
              ? `Auto-saved · ${passing}/${total} gates pass`
              : "No mandate set yet"}
          </div>
        </div>
        {/* Ghost-button link — matches prototype primitives.jsx Button
            variant="ghost" size="sm": transparent bg, text-secondary,
            transparent border, height 28, fontSize 13 (was 12.5 designer
            port; snapped to ladder per Phase 09.1 UI-FLAG-02), padding 0 10. */}
        <Link
          href="/profile?tab=mandate"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 28,
            padding: "0 10px",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: "var(--radius-md)",
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px solid transparent",
            textDecoration: "none",
            fontFamily: "DM Sans",
            whiteSpace: "nowrap",
          }}
        >
          Edit →
        </Link>
      </div>

      {/* Gate rows — prototype app.jsx:498-510 */}
      <div>
        {gates.map((row) => (
          <MandateGateLine key={row.key} row={row} />
        ))}
      </div>
    </div>
  );

  if (v2) {
    return <WidgetState mode="success">{card}</WidgetState>;
  }
  return card;
}

function MandateGateLine({ row }: { row: GateRow }) {
  const dotColor =
    row.ok === true
      ? "var(--positive)"
      : row.ok === false
        ? "var(--negative)"
        : "var(--text-muted)";
  const currentColor =
    row.ok === false ? "var(--negative)" : "var(--text-primary)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
        gap: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: 13 }}>{row.label}</span>
      <span
        className="font-mono tnum"
        style={{ fontSize: 12, color: "var(--text-muted)" }}
      >
        {row.gate}
      </span>
      <span
        aria-hidden="true"
        style={{ width: 1, height: 14, background: "var(--border)" }}
      />
      <span
        className="font-mono tnum"
        style={{
          fontSize: 13,
          color: currentColor,
          fontWeight: 500,
          minWidth: 56,
          textAlign: "right",
        }}
      >
        {row.current}
      </span>
    </div>
  );
}

export default MandateSnapshotWidget;
