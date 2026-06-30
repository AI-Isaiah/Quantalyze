"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { STRATEGY_TYPES, SUBTYPES, EXCHANGES } from "@/lib/constants";
import type { AllocatorOwnPreferences } from "@/lib/preferences";
import { useMandateAutoSave } from "./useMandateAutoSave";
import { MandateSaveStatus } from "./MandateSaveStatus";
import { MandateSlider } from "./MandateSlider";
import { MandateChipGroup } from "./MandateChipGroup";
import { MandateSegmentedRadio } from "./MandateSegmentedRadio";
import { MandateAdvancedSection } from "./MandateAdvancedSection";

interface Props {
  initial: AllocatorOwnPreferences | null;
}

function toggleIn<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// H-0377: `AllocatorOwnPreferences` types these multi-selects as `string[] |
// null` (unvalidated at read time). Casting straight to the enum unions let a
// legacy/dropped DB value pass the cast, then silently vanish on the next save
// (it fails the chip-inclusion check) — a silent data-loss path. Filter against
// the canonical constant at the intake boundary so unknown values are dropped
// explicitly, with no `as` lie and a real type narrowing.
function filterToKnown<T extends string>(
  values: readonly string[] | null | undefined,
  allowed: readonly T[],
): T[] {
  const known = new Set<string>(allowed);
  return (values ?? []).filter((v): v is T => known.has(v));
}

type StrategyType = (typeof STRATEGY_TYPES)[number];
type Subtype = (typeof SUBTYPES)[number];
type Exchange = (typeof EXCHANGES)[number];
type Liquidity = "high" | "medium" | "low";

/**
 * MandateForm root client component.
 *
 * Single Card with:
 *   - Basics (always visible): max_weight slider, preferred_strategy_types chips,
 *     excluded_exchanges chips (red), target_ticket_size_usd number, mandate_archetype textarea.
 *   - Advanced accordion (collapsed by default): correlation_ceiling slider,
 *     max_drawdown_tolerance slider, liquidity_preference segmented radio,
 *     style_exclusions chips.
 *
 * Auto-save on every commit — no submit button, no form element.
 * MandateSaveStatus renders the aria-live polite region.
 */
export function MandateForm({ initial }: Props) {
  const initialLastSaved = initial?.mandate_edited_at
    ? new Date(initial.mandate_edited_at)
    : null;
  const { saveState, fieldErrors, lastSavedAt, savingFields, save } =
    useMandateAutoSave(initialLastSaved);

  // Local state mirrors server state — optimistic for chip toggles + reset.
  const [maxWeight, setMaxWeight] = useState<number | null>(initial?.max_weight ?? null);
  const [preferredTypes, setPreferredTypes] = useState<StrategyType[]>(
    filterToKnown(initial?.preferred_strategy_types, STRATEGY_TYPES),
  );
  const [excludedExchanges, setExcludedExchanges] = useState<Exchange[]>(
    // NOT filtered via filterToKnown: the server validates excluded_exchanges
    // case-INSENSITIVELY (isSupportedExchange lowercases) while EXCHANGES is
    // display-case ("Binance"), so the DB can legitimately hold a lowercase
    // "binance" that an exact-case filter would wrongly drop. Display-vs-stored
    // case normalization is a separate concern; left as the prior cast here.
    (initial?.excluded_exchanges as Exchange[] | null) ?? [],
  );
  const [ticketSize, setTicketSize] = useState<string>(
    initial?.target_ticket_size_usd != null
      ? String(initial.target_ticket_size_usd)
      : "",
  );
  const [archetype, setArchetype] = useState<string>(initial?.mandate_archetype ?? "");
  const [correlationCeiling, setCorrelationCeiling] = useState<number | null>(
    initial?.correlation_ceiling ?? null,
  );
  const [maxDrawdown, setMaxDrawdown] = useState<number | null>(
    initial?.max_drawdown_tolerance ?? null,
  );
  const [liquidity, setLiquidity] = useState<Liquidity | null>(
    initial?.liquidity_preference ?? null,
  );
  const [styleExclusions, setStyleExclusions] = useState<Subtype[]>(
    filterToKnown(initial?.style_exclusions, SUBTYPES),
  );

  // Ref-backed latest values for multi-select chip fields. Closure over the
  // React state reads stale values when clicks fire faster than React's
  // commit cycle, causing successive toggles to read the same snapshot and
  // each save to overwrite the previous. The handlers update these refs
  // synchronously so rapid clicks compose correctly; state only mutates
  // via the handlers themselves, so no render-body sync is needed.
  const preferredTypesRef = useRef(preferredTypes);
  const excludedExchangesRef = useRef(excludedExchanges);
  const styleExclusionsRef = useRef(styleExclusions);

  // ---- Field handlers (each handler: update local state THEN save)

  function onMaxWeightCommit(v: number) {
    setMaxWeight(v);
    void save("max_weight", v);
  }
  function onMaxWeightReset() {
    setMaxWeight(null);
    void save("max_weight", null);
  }

  function onPreferredTypesToggle(type: StrategyType) {
    const next = toggleIn(preferredTypesRef.current, type);
    preferredTypesRef.current = next;
    setPreferredTypes(next);
    void save("preferred_strategy_types", next);
  }
  function onPreferredTypesReset() {
    preferredTypesRef.current = [];
    setPreferredTypes([]);
    void save("preferred_strategy_types", null);
  }

  function onExcludedExchangesToggle(exchange: Exchange) {
    const next = toggleIn(excludedExchangesRef.current, exchange);
    excludedExchangesRef.current = next;
    setExcludedExchanges(next);
    void save("excluded_exchanges", next);
  }
  function onExcludedExchangesReset() {
    excludedExchangesRef.current = [];
    setExcludedExchanges([]);
    void save("excluded_exchanges", null);
  }

  function onTicketSizeBlur() {
    const trimmed = ticketSize.trim();
    if (trimmed === "") {
      // User cleared the field — treat empty as NULL.
      if (initial?.target_ticket_size_usd != null) {
        void save("target_ticket_size_usd", null);
      }
      return;
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return; // Let server bounds validation bounce.
    void save("target_ticket_size_usd", num);
  }
  function onTicketSizeReset() {
    setTicketSize("");
    void save("target_ticket_size_usd", null);
  }

  function onArchetypeBlur() {
    const trimmed = archetype.trim();
    void save("mandate_archetype", trimmed === "" ? null : trimmed);
  }
  function onArchetypeReset() {
    setArchetype("");
    void save("mandate_archetype", null);
  }

  function onCorrelationCommit(v: number) {
    setCorrelationCeiling(v);
    void save("correlation_ceiling", v);
  }
  function onCorrelationReset() {
    setCorrelationCeiling(null);
    void save("correlation_ceiling", null);
  }

  function onMaxDrawdownCommit(v: number) {
    setMaxDrawdown(v);
    void save("max_drawdown_tolerance", v);
  }
  function onMaxDrawdownReset() {
    setMaxDrawdown(null);
    void save("max_drawdown_tolerance", null);
  }

  function onLiquidityChange(v: Liquidity | null) {
    setLiquidity(v);
    void save("liquidity_preference", v);
  }

  function onStyleExclusionsToggle(subtype: Subtype) {
    const next = toggleIn(styleExclusionsRef.current, subtype);
    styleExclusionsRef.current = next;
    setStyleExclusions(next);
    void save("style_exclusions", next);
  }
  function onStyleExclusionsReset() {
    styleExclusionsRef.current = [];
    setStyleExclusions([]);
    void save("style_exclusions", null);
  }

  // ---- Render helpers

  const archetypeLen = archetype.length;

  return (
    <div className="max-w-[720px]">
      <div className="mb-3 flex justify-end">
        <MandateSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
      </div>
      <Card>
        <div className="space-y-6">
          <div className="flex items-center gap-3 border-b border-border pb-3 -mx-6 px-6 -mt-6 pt-6">
            <p className="text-fixed-11 font-medium uppercase tracking-[0.12em] text-text-muted">
              Basics
            </p>
            <span
              aria-hidden="true"
              className="h-px flex-1 bg-border"
            />
          </div>

          <MandateSlider
            label="Max weight per strategy"
            helper="Largest share of your portfolio any single strategy can hold. 5%-50%."
            value={maxWeight}
            min={0.05}
            max={0.5}
            step={0.01}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onCommit={onMaxWeightCommit}
            onReset={onMaxWeightReset}
            error={fieldErrors.max_weight}
            saving={savingFields.has("max_weight")}
          />

          <MandateChipGroup<StrategyType>
            label="Preferred strategy types"
            helper="We'll surface these first. Leave blank to stay open."
            options={STRATEGY_TYPES}
            selected={preferredTypes}
            onToggle={onPreferredTypesToggle}
            variant="accent"
            onReset={onPreferredTypesReset}
            error={fieldErrors.preferred_strategy_types}
          />

          <MandateChipGroup<Exchange>
            label="Excluded exchanges"
            helper="Compliance blocks - we won't recommend strategies trading on these."
            options={EXCHANGES}
            selected={excludedExchanges}
            onToggle={onExcludedExchangesToggle}
            variant="negative"
            onReset={onExcludedExchangesReset}
            error={fieldErrors.excluded_exchanges}
          />

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="mandate-ticket-size"
                className="text-sm font-medium text-text-primary"
              >
                Typical ticket size (USD)
              </label>
              {ticketSize.trim() !== "" && (
                <button
                  type="button"
                  onClick={onTicketSizeReset}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 font-metric text-fixed-13 text-text-muted tabular-nums pointer-events-none"
              >
                $
              </span>
              <Input
                id="mandate-ticket-size"
                type="number"
                placeholder="50000"
                value={ticketSize}
                onChange={(e) => setTicketSize(e.target.value)}
                onBlur={onTicketSizeBlur}
                min={0}
                aria-busy={savingFields.has("target_ticket_size_usd") ? true : undefined}
                className="pl-7 font-metric tabular-nums"
              />
            </div>
            <p className="text-sm text-text-secondary">
              Roughly the dollar amount you allocate per strategy.
            </p>
            {fieldErrors.target_ticket_size_usd && (
              <p role="alert" className="text-xs text-negative">
                {fieldErrors.target_ticket_size_usd}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="mandate-archetype"
                className="text-sm font-medium text-text-primary"
              >
                Mandate in one sentence
              </label>
              {archetype.trim() !== "" && (
                <button
                  type="button"
                  onClick={onArchetypeReset}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
                >
                  Reset
                </button>
              )}
            </div>
            <Textarea
              id="mandate-archetype"
              placeholder="e.g. diversified crypto SMA, low-drawdown, $10M+ capacity"
              value={archetype}
              onChange={(e) => setArchetype(e.target.value)}
              onBlur={onArchetypeBlur}
              rows={2}
              maxLength={500}
              aria-busy={savingFields.has("mandate_archetype") ? true : undefined}
            />
            <p className="text-xs text-text-muted font-metric tabular-nums text-right tracking-tight">
              {archetypeLen} / 500
            </p>
            {fieldErrors.mandate_archetype && (
              <p role="alert" className="text-xs text-negative">
                {fieldErrors.mandate_archetype}
              </p>
            )}
          </div>

          <MandateAdvancedSection trigger="Advanced constraints">
            <MandateSlider
              label="Correlation ceiling"
              helper="Max pairwise correlation across your allocations. 0 = fully diversified, 1 = no limit."
              value={correlationCeiling}
              min={0}
              max={1}
              step={0.05}
              formatValue={(v) => v.toFixed(2)}
              onCommit={onCorrelationCommit}
              onReset={onCorrelationReset}
              error={fieldErrors.correlation_ceiling}
              saving={savingFields.has("correlation_ceiling")}
            />

            <MandateSlider
              label="Max drawdown tolerance"
              helper="Worst peak-to-trough loss you can accept across your portfolio."
              value={maxDrawdown}
              min={0}
              max={1}
              step={0.05}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              onCommit={onMaxDrawdownCommit}
              onReset={onMaxDrawdownReset}
              error={fieldErrors.max_drawdown_tolerance}
              saving={savingFields.has("max_drawdown_tolerance")}
            />

            <MandateSegmentedRadio
              label="Minimum AUM"
              helper="Minimum strategy AUM we should recommend."
              value={liquidity}
              onChange={onLiquidityChange}
              error={fieldErrors.liquidity_preference}
            />

            <MandateChipGroup<Subtype>
              label="Excluded styles"
              helper="Sub-strategies to filter out. Toggle each chip."
              options={SUBTYPES}
              selected={styleExclusions}
              onToggle={onStyleExclusionsToggle}
              variant="negative"
              onReset={onStyleExclusionsReset}
              error={fieldErrors.style_exclusions}
            />
          </MandateAdvancedSection>
        </div>
      </Card>
    </div>
  );
}
