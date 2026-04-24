"use client";

import Link from "next/link";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 09.1 D-06 — Mandate tab body (Plan 10).
 *
 * Decision (CONTEXT §D-06): keep the link-out to /profile?tab=mandate (the
 * MandateForm full surface) AND mount a read-only MandateSnapshot card above
 * the link. Reasons:
 *   - MandateForm is a full page surface with its own submit/validation path
 *     (Phase 2). Moving or iframing doubles the maintenance burden before
 *     Phase 11 reviews it.
 *   - The link-out from the Plan 02 stub is acceptable for bake.
 *
 * Snapshot fields are read defensively from the payload — `MyAllocationDashboardPayload`
 * does NOT currently project mandate columns, so the snapshot reads from
 * `(props as any).mandate ?? (props as any).allocatorPreferences ?? null`
 * and renders the empty-state when nothing is available. A future plan can
 * widen the payload to feed real values without touching this surface.
 */

type MandateSnapshot = {
  max_weight?: number | null;
  correlation_ceiling?: number | null;
  style_exclusions?: string[] | null;
  liquidity_preference?: "high" | "medium" | "low" | null;
  preferred_strategy_types?: string[] | null;
};

function MandateSnapshotCard({
  mandate,
}: {
  mandate: MandateSnapshot | null;
}) {
  if (!mandate) {
    return (
      <div
        data-testid="mandate-snapshot"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="text-xs uppercase tracking-wider text-text-muted">
          Mandate snapshot
        </div>
        <div className="mt-2 text-sm text-text-secondary">
          No mandate set yet. Open the Mandate form below to define max weight,
          correlation ceiling, and style exclusions.
        </div>
      </div>
    );
  }

  const rows: Array<{ label: string; value: string }> = [];
  if (mandate.max_weight != null) {
    rows.push({
      label: "Max weight",
      value: `${(mandate.max_weight * 100).toFixed(1)}%`,
    });
  }
  if (mandate.correlation_ceiling != null) {
    rows.push({
      label: "Correlation ceiling",
      value: mandate.correlation_ceiling.toFixed(2),
    });
  }
  if (mandate.liquidity_preference) {
    rows.push({
      label: "Liquidity preference",
      value: mandate.liquidity_preference,
    });
  }

  return (
    <div
      data-testid="mandate-snapshot"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="text-xs uppercase tracking-wider text-text-muted">
        Mandate snapshot
      </div>
      {rows.length > 0 ? (
        <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs text-text-muted">{r.label}</dt>
              <dd
                className="mt-0.5 font-medium"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {mandate.style_exclusions && mandate.style_exclusions.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs text-text-muted">Style exclusions</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {mandate.style_exclusions.map((s) => (
              <span
                key={s}
                className="rounded bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {mandate.preferred_strategy_types &&
      mandate.preferred_strategy_types.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs text-text-muted">
            Preferred strategy types
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {mandate.preferred_strategy_types.map((t) => (
              <span
                key={t}
                className="rounded bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MandateTabPanel(props: MyAllocationDashboardPayload) {
  // The dashboard payload does not currently project mandate columns
  // (see `MyAllocationDashboardPayload` in src/lib/queries.ts). Read
  // defensively from likely future field names so a payload-widening
  // PR can light this snapshot up without touching the tab body.
  const propsRecord = props as unknown as Record<string, unknown>;
  const mandate =
    (propsRecord.mandate as MandateSnapshot | null | undefined) ??
    (propsRecord.allocatorPreferences as
      | MandateSnapshot
      | null
      | undefined) ??
    null;

  return (
    <div data-tab-panel="mandate" className="grid gap-4">
      <MandateSnapshotCard mandate={mandate ?? null} />
      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p className="mb-2 text-text-secondary">
          Edit your mandate in the profile surface. Changes take effect
          immediately across the Bridge engine.
        </p>
        <Link
          href="/profile?tab=mandate"
          className="text-accent hover:underline"
        >
          Open Mandate form →
        </Link>
      </div>
    </div>
  );
}
