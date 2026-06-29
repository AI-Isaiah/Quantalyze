"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";
import {
  STRATEGY_NAMES,
  STRATEGY_TYPES,
  SUBTYPES,
  MARKETS,
  EXCHANGES,
  canonicalizeExchange,
} from "@/lib/constants";

/**
 * MetadataStep collects the metadata the founder needs to approve a
 * wizard-submitted strategy. `markets` is pre-filled from detected
 * trades when available; `supported_exchanges` is pre-filled from the
 * Step 1 exchange selection.
 */

export interface MetadataDraft {
  name: string | null;
  description: string;
  categoryId: string | null;
  strategyTypes: string[];
  subtypes: string[];
  markets: string[];
  supportedExchanges: string[];
  leverageRange: string;
  aum: string;
  maxCapacity: string;
}

export interface MetadataStepProps {
  strategyId: string;
  wizardSessionId: string;
  /** Pre-populated draft when the user is resuming from a server-side row. */
  initial: MetadataDraft | null;
  /** Market tags detected from real trades in Step 2. */
  detectedMarkets: string[];
  /** Exchange selected at Step 1. */
  detectedExchange: string | null;
  onComplete: (draft: MetadataDraft) => void;
  onBack: () => void;
}

export function MetadataStep({
  wizardSessionId,
  initial,
  detectedMarkets,
  detectedExchange,
  onComplete,
  onBack,
}: MetadataStepProps) {
  const [name, setName] = useState<string>(initial?.name ?? STRATEGY_NAMES[0]);
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.categoryId ?? null,
  );
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [strategyTypes, setStrategyTypes] = useState<string[]>(
    initial?.strategyTypes ?? [],
  );
  const [subtypes, setSubtypes] = useState<string[]>(initial?.subtypes ?? []);
  const [markets, setMarkets] = useState<string[]>(initial?.markets ?? []);
  // QA report 2026-05-21 ISSUE-004: capitalize('okx') returned 'Okx',
  // but EXCHANGES has 'OKX' — so on a first-visit submit the OKX chip
  // appeared unselected even though detectedExchange === 'okx'. Same
  // class of bug as the resume case fixed in WizardClient.tsx.
  // canonicalizeExchange() maps the lowercase api_keys.exchange to its
  // canonical EXCHANGES entry so the chip-group's case-sensitive
  // .includes() check matches and the chip renders pre-selected.
  const [supportedExchanges, setSupportedExchanges] = useState<string[]>(
    initial?.supportedExchanges ??
      (detectedExchange ? [canonicalizeExchange(detectedExchange)] : []),
  );
  const [leverageRange, setLeverageRange] = useState<string>(
    initial?.leverageRange ?? "",
  );
  const [aum, setAum] = useState<string>(initial?.aum ?? "");
  const [maxCapacity, setMaxCapacity] = useState<string>(initial?.maxCapacity ?? "");
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);
  // Phase 53 / APPLY-02 — inline per-field validation surfacing. The
  // description is the required free-text field; surface its existing
  // validation at the field on blur + on submit (the WizardErrorEnvelope
  // stays the role=alert summary, unchanged). `descriptionBlurred` gates
  // the on-blur reveal; submit reveals it unconditionally and focuses the
  // first invalid field.
  const [descriptionBlurred, setDescriptionBlurred] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("discovery_categories")
          .select("id, name")
          .order("sort_order");
        if (cancelled) return;
        if (error) {
          // Loud-fail (F1, M-0248): an RLS regression or transient
          // Supabase outage makes discovery_categories unreadable. The
          // user is blocked at this step, so the founder/ops team must
          // get a signal — surface telemetry + console.error, not just
          // the inline copy. An empty (but readable) result is the
          // genuine "no categories yet" path and stays silent above.
          console.error("[wizard:MetadataStep] category select error:", error);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "metadata",
            code: "METADATA_CATEGORY_LOAD_FAILED",
          });
          setCategoryLoadError("Could not load strategy categories.");
          return;
        }
        setCategories(data ?? []);
        if (!categoryId && data && data.length > 0) {
          setCategoryId(data[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[wizard:MetadataStep] category fetch:", err);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "metadata",
            code: "METADATA_CATEGORY_LOAD_FAILED",
          });
          setCategoryLoadError("Could not load strategy categories.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(list: string[], item: string, setter: (v: string[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  // Inline validation derives from the EXISTING required-field rule (the
  // Submit gate). Copy comes from wizardErrors.ts (canonical home) — never
  // an invented inline string. The message shows on blur or after a submit
  // attempt; it is NOT role="alert" (the envelope owns that).
  const descriptionError = !description.trim()
    ? WIZARD_ERROR_COPY.METADATA_DESCRIPTION_REQUIRED.cause
    : undefined;
  const showDescriptionError =
    (descriptionBlurred || submitAttempted) && descriptionError
      ? descriptionError
      : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    // On submit-with-errors, focus the first invalid field (description is
    // the only inline-validated free-text field here; category is selected
    // via auto-select / dropdown). The Submit button stays disabled until
    // both are present, so this is a defense-in-depth focus aid for the AT
    // path where the button is reached.
    if (!description.trim()) {
      descriptionRef.current?.focus();
      return;
    }
    onComplete({
      name,
      description,
      categoryId,
      strategyTypes,
      subtypes,
      markets,
      supportedExchanges,
      leverageRange,
      aum,
      maxCapacity,
    });
  }

  return (
    <section aria-labelledby="wizard-metadata-heading">
      <h2
        id="wizard-metadata-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        Tell allocators what this strategy is
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        We pre-filled what we could detect from your trades. Fill in the rest so
        allocators can evaluate the fit.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <Select
          label="Strategy codename"
          options={STRATEGY_NAMES.map((n) => ({ value: n, label: n }))}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {/* Phase 53 / APPLY-02 — the description is wrapped in Field so the
            inline error wires aria-invalid + aria-describedby (the a11y the
            bare Textarea primitive does NOT do). Copy is the existing
            wizardErrors.ts string; the message is NOT role="alert". */}
        <Field label="Description" error={showDescriptionError}>
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => setDescriptionBlurred(true)}
            rows={3}
            placeholder="One paragraph describing the strategy, edge, and risk framing."
            required
            className="rounded-lg border border-border bg-surface px-3 py-2 text-body text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-negative"
          />
        </Field>

        <Select
          label="Category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value)}
        />
        {categoryLoadError && (
          <p className="text-xs text-negative" role="alert">
            {categoryLoadError} Refresh the page. If this persists, contact
            security@quantalyze.com.
          </p>
        )}

        <InlineChipGroup
          label="Strategy Types"
          items={[...STRATEGY_TYPES]}
          selected={strategyTypes}
          onToggle={(item) => toggle(strategyTypes, item, setStrategyTypes)}
        />

        <InlineChipGroup
          label="Subtypes"
          items={[...SUBTYPES]}
          selected={subtypes}
          onToggle={(item) => toggle(subtypes, item, setSubtypes)}
        />

        <div>
          <InlineChipGroup
            label="Markets"
            items={[...MARKETS]}
            selected={markets}
            onToggle={(item) => toggle(markets, item, setMarkets)}
          />
          {detectedMarkets.length === 0 && (
            <p className="mt-2 text-[11px] text-text-muted">
              We could not identify the markets from your trades — please select
              manually.
            </p>
          )}
          {detectedMarkets.length > 0 && (
            <p className="mt-2 text-[11px] text-text-muted">
              Detected from your trade history: {detectedMarkets.join(", ")}.
            </p>
          )}
        </div>

        <InlineChipGroup
          label="Supported exchanges"
          items={[...EXCHANGES]}
          selected={supportedExchanges}
          onToggle={(item) =>
            toggle(supportedExchanges, item, setSupportedExchanges)
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            label="Leverage range"
            value={leverageRange}
            onChange={(e) => setLeverageRange(e.target.value)}
            placeholder="e.g. 1x–5x"
          />
          <Input
            label="AUM (USD)"
            type="number"
            value={aum}
            onChange={(e) => setAum(e.target.value)}
            placeholder="0"
          />
          <Input
            label="Max capacity (USD)"
            type="number"
            value={maxCapacity}
            onChange={(e) => setMaxCapacity(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" type="button" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" disabled={!description || !categoryId}>
            Review and submit
          </Button>
        </div>
      </form>
    </section>
  );
}

interface InlineChipGroupProps {
  label: string;
  items: string[];
  selected: string[];
  onToggle: (item: string) => void;
}

function InlineChipGroup({ label, items, selected, onToggle }: InlineChipGroupProps) {
  return (
    <div>
      <p className="text-xs font-medium text-text-primary">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              onClick={() => onToggle(item)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-text-muted hover:border-accent/50"
              }`}
              aria-pressed={active}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}
