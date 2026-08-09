"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { WIZARD_ERROR_COPY, type WizardErrorCode } from "@/lib/wizardErrors";
import {
  STRATEGY_NAMES,
  STRATEGY_TYPES,
  SUBTYPES,
  MARKETS,
  EXCHANGES,
  canonicalizeExchange,
} from "@/lib/constants";
import { isCryptoExchange, MAGNITUDE_CAPS } from "@/lib/closed-sets";
import { CapitalOwnershipRadioGroup } from "@/components/strategy/CapitalOwnershipRadioGroup";
import { TEAM_REVIEW, type CapitalOwnership } from "@/lib/capital-ownership";

/**
 * MetadataStep collects the metadata the founder needs to approve a
 * wizard-submitted strategy. `markets` is pre-filled from detected
 * trades when available; `supported_exchanges` is pre-filled from the
 * Step 1 exchange selection.
 */

/**
 * Client mirror of `finalize-wizard`'s description arm (the `validatePayload`
 * block in `src/app/api/strategies/finalize-wizard/route.ts`) — Phase 153.2 /
 * WIZFORM-01 / D-11.
 *
 * ⛔ The SERVER stays authoritative. This function is a UX affordance, not a
 * control: `validatePayload` re-checks the identical bound on every submit and
 * is unchanged by this phase, so a client with this guard bypassed is still
 * refused there. Do not delete the server arm as "redundant".
 *
 * Why it exists: the client used to check only `!description.trim()`, so a
 * two-character description satisfied every client check, POSTed, and died as a
 * full-page envelope that named no field. The founder read that envelope three
 * times and went off to change unrelated fields looking for the cause (D-13).
 * A typo belongs at the field, not at the end of a submit.
 *
 * ⛔ The bounds are READ from `MAGNITUDE_CAPS`, never re-typed as `10` / `5000`
 * (D-23). A hand-typed literal here is free to disagree with the server's, and
 * that disagreement IS the incident.
 *
 * ⚠️ WHICH LENGTH IS MEASURED, decided once. The server measures
 * `description.length` on the RAW string for both bounds, so both bounds here
 * measure `value.length` too — measuring a trimmed length against either would
 * re-open the drift this constant closes, in a subtler form (a 12-character
 * value with trailing spaces would pass one guard and fail the other). `.trim()`
 * appears solely in the emptiness test, where it is STRICTER than the server
 * (whitespace-only text of ten or more characters is accepted by
 * `validatePayload` and refused here). Refusing more than the server is safe —
 * the user is told at the field, and nothing that reaches the server is a
 * surprise; the reverse is what breaks.
 */
function validateDescription(value: string): WizardErrorCode | null {
  if (!value.trim()) return "METADATA_DESCRIPTION_REQUIRED";
  if (value.length < MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS) {
    return "METADATA_DESCRIPTION_TOO_SHORT";
  }
  if (value.length > MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS) {
    return "METADATA_DESCRIPTION_TOO_LONG";
  }
  return null;
}

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
  /**
   * #597 — asset class ('crypto' | 'traditional') driving Sharpe/Sortino/vol
   * annualization (√365 crypto / √252 traditional). Defaults from the detected
   * exchange (every supported exchange is crypto today) and is user-editable.
   */
  assetClass: string;
  /**
   * Phase 150 / OWN-03 — whose capital sits behind this key. Present ONLY when
   * the capital question rendered (allocator sessions). Absent on every path
   * that never asked, which persists as a NULL mark: unmarked strategies are
   * non-allocatable, so the un-asked case degrades to the safe state.
   */
  capitalOwnership?: CapitalOwnership;
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
  /**
   * Phase 150 / OWN-03 (D-01, D-07) — render the capital question. This is a
   * RENDER condition, not an authorization one: it is derived from the wizard's
   * entryContext (allocator key-add vs manager submission) so allocators are
   * asked the question at the moment it is answerable. No privilege attaches to
   * it — a manager who somehow set it would only be marking their OWN strategy,
   * which is not a violation. The server re-derives everything that matters.
   */
  showCapitalQuestion?: boolean;
  onComplete: (draft: MetadataDraft) => void;
  onBack: () => void;
}

export function MetadataStep({
  wizardSessionId,
  initial,
  detectedMarkets,
  detectedExchange,
  showCapitalQuestion = false,
  onComplete,
  onBack,
}: MetadataStepProps) {
  const [name, setName] = useState<string>(initial?.name ?? STRATEGY_NAMES[0]);
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(
    initial?.categoryId ?? null,
  );
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  // WR-04 (Phase 53) — gate the empty-category hint on a SETTLED fetch so the
  // honest "no categories yet" block does not flash during the initial load
  // (and is distinguishable from the categoryLoadError failure path, which
  // fires telemetry; an empty-but-readable result stays silent per M-0248).
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
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
  // #597 — asset class drives annualization (√365 crypto / √252 traditional).
  // A detected crypto exchange LOCKS the class to 'crypto' (every supported
  // exchange is a crypto venue; finalize-wizard force-derives the same, so an
  // editable picker here would lie). This must win over `initial` — a resumed
  // broker draft carries the DB's NOT NULL DEFAULT 'traditional', and letting
  // that stale default short-circuit the detection would silently annualize a
  // crypto strategy on √252. CSV/unknown flows keep the editable picker.
  const assetClassLocked = isCryptoExchange(detectedExchange);
  const [assetClass, setAssetClass] = useState<string>(
    assetClassLocked ? "crypto" : (initial?.assetClass ?? "traditional"),
  );
  // Phase 150 / OWN-03 (D-01) — the capital question is DEFAULTED to
  // team-review, never null. A user who never touches it submits as
  // team-review, which is behaviour-compatible with the pre-Phase-150 wizard
  // (team-review strategies cannot be allocated, exactly as nothing could
  // before). The safe state is the default; own-capital is always a
  // deliberate act.
  //
  // `initial` wins when it carries an answer: WizardClient feeds the completed
  // draft back in when the user returns from the Review recap, and resetting to
  // the default there would silently downgrade an own-capital answer to
  // team-review on the way to submit. Unlike assetClass — where a DETECTED
  // exchange must beat the resumed value — nothing here can out-rank the
  // user's own stated answer.
  const [capitalOwnership, setCapitalOwnership] = useState<CapitalOwnership>(
    initial?.capitalOwnership ?? TEAM_REVIEW,
  );
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
        setCategoriesLoaded(true);
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

  // Inline validation derives from `validateDescription` — the ONE client
  // mirror of the server rule (Phase 153.2 / WIZFORM-01). It is the same
  // function `handleSubmit` refuses on, so the message the user reads and the
  // reason the submit was refused can never disagree. Copy comes from
  // wizardErrors.ts (canonical home) — never an invented inline string. The
  // message shows on blur or after a submit attempt; it is NOT role="alert"
  // (the envelope owns that).
  const descriptionCode = validateDescription(description);
  const showDescriptionError =
    (descriptionBlurred || submitAttempted) && descriptionCode
      ? WIZARD_ERROR_COPY[descriptionCode].cause
      : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    // The submit predicate IS the field mirror (Phase 153.2 / FLAG-3). This is
    // the only gate: the button carries no validation `disabled`, so an invalid
    // draft reaches this handler by design and is refused HERE, inline, with
    // the offending control focused. Deleting the button gate without widening
    // this predicate would let a two-character description POST — the exact
    // defect WIZFORM-01 exists to close — so the two move together, always.
    //
    // `categoryId` is checked here for the first time; until this phase it was
    // covered only by the deleted `disabled` gate.
    //
    // ⚠️ Focus is hand-rolled because the description is today the only
    // inline-validated control on this step. Phase 153.2-02 replaces this with
    // the general first-invalid-control orchestration (which also opens the
    // collapsed <details> when the offending control is inside it); written as
    // a per-field branch so that lands as a widening, not a rewrite.
    const descriptionRefusal = validateDescription(description);
    if (descriptionRefusal !== null || !categoryId) {
      if (descriptionRefusal !== null) {
        descriptionRef.current?.focus();
      }
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
      assetClass,
      // OWN-03: spread the mark in ONLY when the question rendered, so paths
      // that never asked emit an ABSENT key rather than a defaulted one. The
      // route treats absence as "do not write", leaving the column NULL —
      // an unmarked strategy, which is non-allocatable. Never send a mark the
      // user was not shown.
      ...(showCapitalQuestion ? { capitalOwnership } : {}),
    });
  }

  // #597 — asset class drives Sharpe/Sortino/volatility annualization
  // (crypto trades 7 days/week → √365; traditional markets weekdays → √252).
  // Locked to 'crypto' when a crypto exchange is detected (finalize-wizard
  // force-derives the same); editable for CSV / multi-asset strategies.
  //
  // OWN-03 (Pitfall 4) — declared once here because it renders in one of TWO
  // places depending on `assetClassLocked`; see the placement branch below.
  // One spelling, so the two placements cannot drift.
  const assetClassSelect = (
    <Select
      label={
        assetClassLocked
          ? "Asset class (auto-detected from exchange)"
          : "Asset class"
      }
      options={[
        { value: "crypto", label: "Crypto (annualize ×√365)" },
        {
          value: "traditional",
          label: "Traditional / equities · FX (annualize ×√252)",
        },
      ]}
      value={assetClass}
      onChange={(e) => setAssetClass(e.target.value)}
      disabled={assetClassLocked}
    />
  );

  return (
    <section aria-labelledby="wizard-metadata-heading">
      <h2
        id="wizard-metadata-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Describe this strategy
      </h2>
      {/* OWN-03: role-neutral copy. The previous heading ("Tell allocators what
          this strategy is") is manager-voiced, and this step now serves the
          allocator adding their own key too — one form for both (D-07), so the
          copy must not address only one of them. The intro states the honest
          requirement: three fields, everything else optional. */}
      <p className="mt-2 text-body text-text-secondary">
        Codename, description, and category are all we need. Everything else is
        optional.
      </p>

      {/* 153.2 / WIZFORM-01 — `noValidate` makes `validateDescription` the
          SINGLE gate on this form. The description textarea carries `required`
          (kept: it is the correct semantics, and it is what tells AT the field
          is mandatory), and native constraint validation would otherwise
          intercept the EMPTY case before `handleSubmit` ever runs — the user
          would get the browser's own bubble instead of the inline message this
          phase exists to show, and only for one of the three refusal states,
          so the empty field would behave unlike the too-short and too-long
          ones. A tooltip-only error is forbidden by the UI contract, and two
          gates disagreeing about the same field is the drift class WIZFORM-01
          closes. Our predicate is strictly stronger than `required`: it also
          refuses whitespace-only and under-length text, which native
          validation accepts. */}
      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-6">
        {/* OWN-03 (D-01) — THE question, first. It leads the step because a
            question buried under three fields is a question most people never
            read, and this one decides whether the strategy can ever hold
            money. */}
        {showCapitalQuestion && (
          <CapitalOwnershipRadioGroup
            label="Whose capital is in this key?"
            value={capitalOwnership}
            onChange={setCapitalOwnership}
          />
        )}

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
            // 153.2 / UI-SPEC focus-ring contract — this carried a 20%-alpha
            // accent ring on plain `focus:`, which measures ~1.3:1 against
            // `bg-surface`, far under WCAG 1.4.11's 3:1 floor for a
            // non-text indicator; a sighted keyboard user could not see where
            // they were. Same fix, same reasoning as
            // `AllocateDialog.tsx`'s amount input. `ring-inset` keeps the ring
            // inside the border box so an ancestor's overflow cannot clip it,
            // and `focus-visible` (not `focus`) keeps it off pointer
            // interactions. The trailing `aria-[invalid=true]:border-negative`
            // STAYS: the red border derives from the ARIA state Field writes,
            // never from JS, which makes a red control without correct a11y
            // wiring structurally impossible (Shared Pattern A).
            className="rounded-lg border border-border bg-surface px-3 py-2 text-body text-text-primary placeholder:text-text-muted transition-colors focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent aria-[invalid=true]:border-negative"
          />
        </Field>

        <Select
          label="Category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value)}
        />
        {categoryLoadError && (
          <p className="text-caption text-negative" role="alert">
            {categoryLoadError} Refresh the page. If this persists, contact
            security@quantalyze.com.
          </p>
        )}
        {/* WR-04 (Phase 53) — an empty-but-readable category list leaves the
            user with categoryId=null and a permanently-disabled Submit (the
            gate requires a category). On the CSV path there is no detected-
            markets hint to explain the block, so surface an HONEST reason here
            rather than a silent dead-end. This is the defense-in-depth pair to
            the server-side null-category_id rejection in csv-finalize: ISSUE-010
            must never reopen by persisting category_id=null. */}
        {categoriesLoaded && !categoryLoadError && categories.length === 0 && (
          <p
            className="text-caption text-negative"
            role="alert"
            data-testid="metadata-categories-empty"
          >
            No strategy categories are available yet, so this strategy cannot be
            submitted. Please contact security@quantalyze.com.
          </p>
        )}

        {/* OWN-03 (Pitfall 4) — HOISTED when editable. On the CSV /
            unknown-exchange path this select is live and defaults to
            'traditional', i.e. √252. Annualizing a crypto book on √252
            inflates Sharpe, so the one control whose wrong default silently
            corrupts the money math must never hide behind a collapsed
            disclosure. When it is LOCKED it is disabled and the server
            force-derives the same value, so it is purely informational and
            sits inside the disclosure with the rest. */}
        {!assetClassLocked && assetClassSelect}

        {/* OWN-03 (D-05/D-06) — the cull. These seven controls are the
            "profile" questions: useful, never required, and asking them up
            front is what made this step feel like paperwork. They are
            COLLAPSED, never deleted (D-08) — every field stays in
            MetadataDraft and in the finalize payload, so downstream factsheet
            panels, browse pills and mandate-fit chips keep their existing
            hide-on-absence behaviour with zero server change.

            This is a bare native <details>, deliberately NOT the shared
            collapsible component in components/ui — that one persists its
            open/closed state to localStorage and speaks the factsheet's
            uppercase document-section voice, both wrong for a transient form
            control. Only its CSS caret idiom is borrowed. (That component is
            not named here on purpose: the acceptance grep for this file runs
            over this comment too, so naming it would match its own prose.)
            The closest in-repo precedent at this weight is the bare
            details/summary "More" cell in StrategyTable. */}
        <details className="group">
          <summary className="flex min-h-[44px] cursor-pointer list-none select-none items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span
              aria-hidden
              className="inline-block h-2 w-2 transition-transform group-open:rotate-90"
              style={{
                borderTop: "4px solid transparent",
                borderBottom: "4px solid transparent",
                borderLeft: "5px solid var(--color-text-muted)",
              }}
            />
            <span className="text-caption font-medium text-text-secondary">
              More details (optional)
            </span>
          </summary>

          <div className="mt-4 space-y-6">
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
                <p className="mt-2 text-micro text-text-muted">
                  We could not identify the markets from your trades — please
                  select manually.
                </p>
              )}
              {detectedMarkets.length > 0 && (
                <p className="mt-2 text-micro text-text-muted">
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

            {assetClassLocked && assetClassSelect}

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
          </div>
        </details>

        <div className="flex gap-3">
          <Button variant="secondary" type="button" onClick={onBack}>
            Back
          </Button>
          {/* ⛔ NEVER disabled for a validation reason (Phase 153.2 / D-13,
              and the standing founder direction: a blocked action must be
              clickable and must explain itself). This button used to carry a
              prop gating it on the trimmed description plus the category id,
              and that gate is exactly what hid WHICH field was wrong — a dead
              button names nothing, so a user facing it has to guess. Guessing
              is what sent the founder to change unrelated fields.

              The refusal now lives in `handleSubmit`, which names the field,
              shows the rule inline and moves focus there. `disabled` survives
              on a submit control ONLY as an in-flight double-submit guard; this
              step performs no write of its own (it hands the draft to the
              Review recap), so there is no in-flight state and the prop is gone
              entirely. ⛔ Do not reintroduce it, and do not substitute
              `aria-disabled` — that is the same dead end with better a11y
              paperwork. */}
          <Button type="submit">Review and submit</Button>
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
      <p className="text-caption font-medium text-text-primary">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              onClick={() => onToggle(item)}
              className={`rounded-md border px-3 py-1.5 text-caption font-medium transition-colors ${
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
