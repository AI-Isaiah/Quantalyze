"use client";

import { usePayload } from "./factsheet-context";

/**
 * Mandate-section editorial panels.
 *
 *   - StrategyThesisPanel: editorial framing of WHAT the strategy is, derived
 *     from known strategy metadata (name, types, markets, observation window).
 *     We don't fabricate qualitative thesis prose — the boilerplate frame is
 *     factual restatement only. A future strategy-author-provided `thesis`
 *     field can replace the generated paragraph.
 *
 *   - TermsPanel: institutional terms-of-engagement summary. Pulls from known
 *     factsheet metadata only (ingest source, computed-at, observation window,
 *     sample size). Per the no-fabrication rule, real fee/lockup/redemption
 *     terms must come from the strategy registry — not synthesised here.
 *
 *   - LeverageProfilePanel: hidden until the backend ships per-trade leverage
 *     data (API-verified strategies). The panel structure is wired so the data
 *     drop-in is purely additive.
 */

export function StrategyThesisPanel() {
  const payload = usePayload();
  const types = payload.strategyTypes.length > 0 ? payload.strategyTypes.join(" · ") : null;
  const markets = payload.markets.length > 0 ? payload.markets.join(" · ") : null;
  const startYr = payload.strategyMetrics.start.slice(0, 4);
  const endYr = payload.strategyMetrics.end.slice(0, 4);
  const observation = startYr === endYr ? startYr : `${startYr}–${endYr}`;

  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">Strategy Thesis</h3>
      </header>
      <p className="text-[12px] leading-relaxed text-text-2">
        <em className="font-serif text-text-primary not-italic font-medium">{payload.strategyName}</em>
        {" "}{types ? <>operates as a {types.toLowerCase()} strategy</> : <>is a systematic strategy</>}
        {markets ? <> across {markets.toLowerCase()}.</> : <>.</>}{" "}
        Performance is computed from the strategy&apos;s daily-return series over the {observation} observation window
        ({payload.strategyMetrics.n.toLocaleString()} trading days, {payload.strategyMetrics.years.toFixed(2)} years).
        Comparator analytics are aligned to the same calendar with each benchmark forward-filled.
      </p>
      <p className="mt-2 text-[10px] italic text-text-muted">
        A full thesis (objective, edge, capacity, risk regime) is provided by the strategy author. The summary above
        is derived only from the strategy&apos;s observed return series.
      </p>
    </section>
  );
}

export function TermsPanel() {
  const payload = usePayload();
  const tier = payload.trustTier;
  const tierLabel =
    tier === "api_verified" ? "API-verified" :
    tier === "csv_uploaded" ? "CSV-uploaded (verification pending)" :
    tier === "self_reported" ? "Self-reported" :
    "—";
  const computed = iso(payload.computedAt);
  const start = iso(payload.strategyMetrics.start);
  const end = iso(payload.strategyMetrics.end);

  // Inception / live-date separator: if the strategy declares a start_date
  // BEFORE the observation window starts, the gap is implicitly backtest —
  // flag it so allocators know which portion is paper vs live.
  const declaredStart = payload.startDate ? new Date(payload.startDate) : null;
  const obsStart = new Date(payload.strategyMetrics.start);
  const hasBacktestGap =
    declaredStart && !Number.isNaN(declaredStart.getTime())
      ? declaredStart.getTime() < obsStart.getTime() - 86_400_000
      : false;
  // If declared start is AFTER observation start, the early observation period
  // is paper (backtest). If declared start equals observation start, it's all live.

  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">Terms</h3>
      </header>
      <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[11px]">
        <Term label="Data source">{tierLabel}</Term>
        {payload.startDate && (
          <Term label="Live since">
            {iso(payload.startDate)}
            {hasBacktestGap && (
              <span className="ml-2 text-[10px] italic" style={{ color: "var(--color-warning, #B45309)" }}>
                — observation window starts {start}; portion before live date is backtest
              </span>
            )}
          </Term>
        )}
        <Term label="Observation start">{start}</Term>
        <Term label="Observation end">{end}</Term>
        <Term label="Sample size">{payload.strategyMetrics.n.toLocaleString()} days · {payload.strategyMetrics.years.toFixed(2)}y</Term>
        <Term label="Risk-free rate">0% (factsheet convention)</Term>
        <Term label="Bench frequency">Daily close, forward-filled to strategy calendar</Term>
        <Term label="Factsheet computed">{computed}</Term>
        <Term label="Currency basis">Returns reported in decimal · compounded</Term>
      </dl>

      {/* Fees / commercial terms slot. Renders as a contractual placeholder
          until the strategy registry exposes mgmt/perf fee fields. Each row is
          honest about being not-yet-provided rather than fabricating. */}
      <h4 className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted border-b border-border/60 pb-1">
        Fees & Subscription
      </h4>
      <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[11px]">
        <Term label="Management fee">— on request</Term>
        <Term label="Performance fee">— on request</Term>
        <Term label="High-water mark">— on request</Term>
        <Term label="Lockup">— on request</Term>
        <Term label="Subscription">— on request</Term>
        <Term label="Redemption">— on request</Term>
        <Term label="Notice period">— on request</Term>
      </dl>

      <p className="mt-2 text-[10px] italic text-text-muted">
        Commercial terms not yet wired through from the strategy registry. Allocators should request
        the full fund offering memorandum directly from the manager before subscribing.
      </p>
    </section>
  );
}

/**
 * ConstituentMandatePanel (Phase 42, PEER-04) — per-constituent mandate chips
 * for the scenario BLEND.
 *
 * Renders ONLY for the scenario blend: it reads the csv-only `scenarioMandate`
 * carve-out (narrowed on `ingestSource === "csv"`, mirroring the B6 discriminated-
 * union discipline) and returns null on every non-scenario factsheet (the real
 * route is byte-identical — the carve-out key is omitted there). One sub-block
 * per constituent with chips for the genuinely-available `strategy_types` +
 * `markets` + the per-constituent `leverage`. NO fabricated aggregate mandate.
 *
 * HONEST-EMPTY (PEER-04):
 *   - Per constituent: when a constituent has NO strategy_types AND NO markets,
 *     its sub-block reads "no mandate metadata" (the leverage chip alone is not
 *     "metadata" — it always exists at ≥ 1.0, so a types+markets-empty constituent
 *     is treated as empty per the UI-SPEC honest-empty rule).
 *   - Whole panel: when NO constituent has any types/markets, the panel body reads
 *     "No mandate metadata available for this blend's constituents." — the "Mandate"
 *     title still renders (the absence is itself informative).
 *
 * The interactive `MandateChipGroup` is deliberately NOT reused — it is a
 * role=checkbox control (wrong a11y for a read-only display). `Chip` here is a
 * local static span.
 */
export function ConstituentMandatePanel() {
  const payload = usePayload();
  // Scenario-only narrow: the mandate carve-out lives on the csv arm.
  const mandate =
    payload.ingestSource === "csv" ? (payload.scenarioMandate ?? null) : null;
  if (!mandate) return null;

  // Whole-panel honest-empty: no constituent carries any types OR markets.
  const anyMetadata = mandate.constituents.some(
    (c) => c.strategy_types.length > 0 || c.markets.length > 0,
  );

  return (
    <section>
      <header className="mb-2 border-b border-text pb-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-primary">Mandate</h3>
      </header>
      {anyMetadata ? (
        <div>
          {mandate.constituents.map((c, i) => {
            const hasMeta = c.strategy_types.length > 0 || c.markets.length > 0;
            return (
              <div key={`${c.name}-${i}`} className="py-2 border-b border-border/40 last:border-0">
                <p className="text-[11px] font-semibold text-text-primary mb-1">{c.name}</p>
                {hasMeta ? (
                  <div className="flex flex-col gap-1">
                    {c.strategy_types.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.strategy_types.map((t) => (
                          <Chip key={`t-${t}`}>{t}</Chip>
                        ))}
                      </div>
                    )}
                    {c.markets.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.markets.map((mk) => (
                          <Chip key={`m-${mk}`}>{mk}</Chip>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Chip>{formatLeverage(c.leverage)}×</Chip>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] italic text-text-muted">no mandate metadata</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] italic text-text-muted">
          No mandate metadata available for this blend&apos;s constituents.
        </p>
      )}
    </section>
  );
}

/**
 * Read-only neutral-outline mandate chip (DESIGN.md badge ladder; UI-SPEC §2
 * verbatim). A static span — NOT the interactive MandateChipGroup.
 */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary">
      {children}
    </span>
  );
}

/** Compact leverage label: integers as "2", fractions trimmed to ≤2 dp ("1.5"). */
function formatLeverage(l: number): string {
  if (!Number.isFinite(l)) return "1";
  return Number.isInteger(l) ? String(l) : String(Number(l.toFixed(2)));
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted self-center">{label}</dt>
      <dd className="text-text-primary tabular-nums">{children}</dd>
    </>
  );
}

/**
 * Hidden by default. When the backend ships per-trade leverage data on
 * API-verified strategies, populate `payload.leverageProfile` and this panel
 * will render: average leverage, peak leverage, % time with leverage > 2×,
 * etc. CSV-ingested strategies always stay hidden — no leverage signal in a
 * daily-return series, per the no-fabrication rule.
 */
export function LeverageProfilePanel() {
  // Wiring point — until the backend ships leverage data, render nothing.
  return null;
}

function iso(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
