"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createClient } from "@/lib/supabase/client";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { isValidDollar } from "@/lib/dollar-validation";
import { formatKeyError, type WizardErrorCode } from "@/lib/wizardErrors";
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

/**
 * The always-visible, pre-emptive line under the description control (153.2 /
 * UI-SPEC Surface 2). The cheapest fix in the phase: a user who is told the
 * rule before they type mostly never meets the error at all.
 *
 * ⛔ Composed from `MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS`, not typed (FLAG-5).
 * The spec forbids a literal duration in copy because copy and budget must not
 * be free to drift; a character bound is the same thing wearing a different
 * unit, and this one already drifted once.
 */
const DESCRIPTION_HINT = `At least ${MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS} characters.`;

/**
 * Client mirror of `finalize-wizard`'s `aum` / `max_capacity` arms (Phase 153.2
 * / WIZFORM-01 / D-11), composed from the SAME two steps the wire path takes.
 *
 * ⛔ THE PREDICATE IS IMPORTED, NEVER RESTATED. `isValidDollar` is the exact
 * function the route applies at both arms (it lives in `@/lib/dollar-validation`
 * precisely so a second caller cannot mint a second bound). A re-typed
 * "non-negative, under a trillion" here would be free to disagree with the
 * server's — that disagreement IS the incident class this phase closes, and
 * D-23 already paid for the lesson once with the description bound.
 *
 * ⚠️ BOTH HALVES OF THE SERVER'S CONDITION ARE MIRRORED. The route reads
 * `!isOmitted(x) && !isValidDollar(x)`: a value that is absent is OMITTED and
 * therefore valid, because AUM and capacity are optional fields. Mirroring only
 * the `isValidDollar` half would refuse every blank AUM client-side while the
 * server happily accepts it — a form stricter than the rule it claims to state.
 *
 * ⚠️ THE STRING→NUMBER STEP IS PART OF THE RULE. This step holds both values as
 * strings and `SubmitStep` serialises them as `metadata.aum ? Number(...) : null`
 * — so an empty string becomes `null` (omitted), and anything else is measured
 * as `Number(value)`. The mirror performs the identical transform rather than
 * inspecting the string, so the number this guard judges is the number the
 * server will judge. (`csv-finalize` applies the same `Number(raw)` + bounds to
 * its string-valued copies, so the CSV branch agrees too.)
 *
 * ⛔ The SERVER stays authoritative — same posture as `validateDescription`
 * above. This is an affordance; `validatePayload` re-checks every submit and is
 * untouched by this phase (T-153.2-04).
 */
function validateDollarField(
  value: string,
  code: WizardErrorCode,
): WizardErrorCode | null {
  const payload = value ? Number(value) : null;
  const omitted = payload === undefined || payload === null;
  return !omitted && !isValidDollar(payload) ? code : null;
}

/**
 * The fields on this step that carry a rule the CLIENT can evaluate, and
 * therefore a rule that must refuse at its own field rather than at submit.
 *
 * ⛔ ONE map, not N ad-hoc `showXError` chains. Every mechanism below —
 * the inline message, the submit predicate, the first-invalid-control focus and
 * the summary line — reads this one derivation, so a fifth field is added in one
 * place and cannot be half-wired.
 *
 * Two fields on this step deliberately have NO entry, and their absence is a
 * decision rather than an oversight:
 *
 *   • **Strategy codename.** The server refuses a name outside
 *     `STRATEGY_NAME_SET` (`METADATA_NAME_INVALID`), but the control here is a
 *     `<select>` over `STRATEGY_NAMES` — that arm is unreachable from this form,
 *     so a mirror would be dead code that a reader would nonetheless have to
 *     maintain. (The server arm still exists and still matters: 153.2-05 routes
 *     the code to this field for the shape-drift case.)
 *   • **Whose capital is in this key.** The OWN-03 radio group is defaulted to
 *     team-review, never null, and offers no way to clear it, so
 *     `METADATA_CAPITAL_OWNERSHIP_INVALID` is likewise unreachable from here.
 */
type MetadataFieldId = "description" | "category" | "aum" | "maxCapacity";

/**
 * The order the four fields RENDER in, declared explicitly.
 *
 * ⛔ Not `Object.keys(fieldErrors)`. "First invalid control in DOM order" is the
 * whole behaviour of a refused submit, and deriving it from an object literal's
 * declaration order couples it to how the map happens to be typed — a later
 * reorder of the JSX (or of the map) would silently change which control the
 * cursor lands in with every test still green. Stating the order here means the
 * coupling is visible, and the DOM-order row in the spec pins it.
 */
const FIELD_ORDER: readonly MetadataFieldId[] = [
  "description",
  "category",
  "aum",
  "maxCapacity",
];

/**
 * The rendered label of each field — the SAME strings the `Field`s below are
 * given, read from here rather than typed twice.
 *
 * This is what makes the submit summary honest (T-153.2-05): the sentence names
 * a field by reading the label the form is showing, so it cannot name a field
 * the user cannot find. ⚠️ These strings are also how `e2e/` and RTL address
 * these controls (`getByLabelText`), so they are load-bearing beyond this file.
 */
const FIELD_LABELS: Record<MetadataFieldId, string> = {
  description: "Description",
  category: "Category",
  aum: "AUM (USD)",
  maxCapacity: "Max capacity (USD)",
};

/**
 * The class run shared by the two bare money `<input>`s and the bare category
 * `<select>` this step wraps in `Field`.
 *
 * It is `Input.tsx` / `Select.tsx`'s own class string with two deliberate
 * changes, and it is spelled here ONCE so the three controls cannot drift:
 *
 *   • the focus ring is the clip-proof, full-opacity inset ring
 *     (`focus-visible:ring-2 ring-inset ring-accent`) rather than the
 *     primitives' low-alpha `focus:` ring, which measures ~1.3:1 against
 *     `bg-surface` — far under WCAG 1.4.11's 3:1 floor for a non-text
 *     indicator. Same upgrade, same reasoning as the description textarea and
 *     `AllocateDialog`'s amount input;
 *   • the invalid border DERIVES from the ARIA state (Shared Pattern A). The
 *     primitives colour their border from a JS `error &&` expression, which is
 *     the FLAG-1 defect shape: it can paint a control red while its a11y wiring
 *     is missing. `Field` is the only writer of the ARIA state, so here the red
 *     and the announcement are the same fact.
 *
 * ⚠️ The primitives themselves are NOT changed — the codename select, the asset
 * class select and the leverage-range input still use them, unvalidated, and
 * rewriting a shared primitive to serve four call sites is a blast radius this
 * phase did not price.
 */
const VALIDATED_CONTROL_CLASS =
  "min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary placeholder:text-text-muted transition-colors focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent aria-[invalid=true]:border-negative";

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
  // Phase 53 / APPLY-02, generalised by 153.2 — inline per-field validation
  // surfacing for every field with a client-evaluable rule. `blurredFields`
  // gates the per-field on-blur reveal; a submit attempt reveals ALL of them at
  // once and moves the cursor into the first one that is wrong.
  const [blurredFields, setBlurredFields] = useState<
    Record<MetadataFieldId, boolean>
  >({
    description: false,
    category: false,
    aum: false,
    maxCapacity: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  function markBlurred(id: MetadataFieldId) {
    setBlurredFields((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }

  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const aumRef = useRef<HTMLInputElement>(null);
  const maxCapacityRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<MetadataFieldId, RefObject<HTMLElement | null>> = {
    description: descriptionRef,
    category: categoryRef,
    aum: aumRef,
    maxCapacity: maxCapacityRef,
  };

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
  // wizardErrors.ts (canonical home) — never an invented inline string, and it
  // is NOT role="alert" (the envelope owns that).
  //
  // ⛔ The TITLE, not the paragraph. This used to render the entry's `cause` —
  // a multi-sentence paragraph under a form control, which is where a user
  // stops reading. A field message is one declarative sentence naming the rule
  // and the threshold; the paragraph belongs to the error panel.
  //
  // `charCount` is the length the mirror itself measured, so the number in the
  // sentence and the number the guard compared are the same number by
  // construction. `formatKeyError` appends the tail only for the two bound
  // codes and only when given a count, so the empty-state sentence stays
  // count-free.
  //
  // REVEAL TIMING, all four events, from these two flags plus the fact that
  // this is derived during render rather than latched into state:
  //   • typing into a never-blurred field  → silent (neither flag set);
  //   • blur                               → that field's message appears;
  //   • change while a message is showing  → LIVE re-evaluated, so the count
  //     tracks every keystroke and both the sentence and the aria-derived red
  //     border vanish the instant the value becomes valid, with no second blur;
  //   • submit attempted                   → revealed regardless of blur.
  // ⚠️ Latching the code into state on blur would break the third event and is
  // the shape to avoid if this ever grows.
  // ⚠️ "You did not pick one" vs "there is nothing to pick". When the select
  // has no options the user CANNOT satisfy a demand to choose, so the demand is
  // withheld and the honest cause is stated instead — either the load-failure
  // line or the empty-catalogue block below, both of which already exist and
  // both of which say something the user can act on (T-153.2-06).
  //
  // Derived from the options actually rendered rather than from the two states
  // that produce them, so the third such state (the fetch has not settled yet)
  // is covered by construction instead of by a later bug report.
  //
  // ⛔ The REFUSAL is untouched. The code stays in the map, so the submit is
  // still blocked and the summary line still names the field; only the
  // "Choose a category." sentence is withheld. Dropping the code instead would
  // let a draft with no category reach `onComplete`, which is the ISSUE-010
  // null-category_id path.
  const categoryHasNoOptions = categories.length === 0;

  const fieldErrors: Record<MetadataFieldId, WizardErrorCode | null> = {
    description: validateDescription(description),
    // The server's rule is `isUuid(category_id)`; the client's honest mirror is
    // "a category is selected", since the <select> guarantees the shape of
    // whatever it yields. Claiming to check the UUID here would be a mirror of
    // a rule this form cannot actually break.
    category: categoryId ? null : "METADATA_CATEGORY_REQUIRED",
    aum: validateDollarField(aum, "METADATA_AUM_INVALID"),
    maxCapacity: validateDollarField(maxCapacity, "METADATA_CAPACITY_INVALID"),
  };

  const invalidFields = FIELD_ORDER.filter((id) => fieldErrors[id] !== null);

  /**
   * The sentence a field shows, or `undefined` for silence. One function for
   * all four fields, so reveal timing cannot differ between them by accident.
   */
  function messageFor(id: MetadataFieldId): string | undefined {
    const code = fieldErrors[id];
    if (!code) return undefined;
    if (!(blurredFields[id] || submitAttempted)) return undefined;
    if (id === "category" && categoryHasNoOptions) return undefined;
    // `charCount` belongs to the description bounds alone — `formatKeyError`
    // appends the "you have {n}" tail only for those two codes, and only when
    // it is given a count, so passing it elsewhere would be inert noise.
    return formatKeyError(
      code,
      id === "description" ? { charCount: description.length } : undefined,
    ).title;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Reveals EVERY field's message at once — a user who is shown one problem,
    // fixes it, and is then shown the next has been made to submit twice to
    // learn something the form knew the first time.
    setSubmitAttempted(true);
    // The submit predicate IS the field mirror (Phase 153.2 / FLAG-3). This is
    // the only gate: the button carries no validation `disabled`, so an invalid
    // draft reaches this handler by design and is refused HERE, inline, with
    // the offending control focused. Deleting the button gate without widening
    // this predicate would let a two-character description POST — the exact
    // defect WIZFORM-01 exists to close — so the two move together, always.
    if (invalidFields.length > 0) {
      // ⚠️ 153.2-02 Task 2 replaces this with the full orchestration: it must
      // also OPEN the collapsed disclosure before focusing a control inside it,
      // scroll the control into view, and state the count and the first field's
      // name in one visible line. Focus alone is what this task owes.
      fieldRefs[invalidFields[0]!].current?.focus();
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
        <Field
          label={FIELD_LABELS.description}
          hint={DESCRIPTION_HINT}
          error={messageFor("description")}
        >
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => markBlurred("description")}
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

        {/* 153.2 — the category moved off the `Select` primitive onto
            `Field` + a bare <select>, for the same reason the description did:
            the primitive renders its own label and colours its own border from
            a JS expression, and never writes `aria-invalid`. A red control
            whose invalidity is invisible to assistive technology is the FLAG-1
            defect. `Field` wires `htmlFor`↔`id` exactly as the primitive did,
            so `getByLabelText("Category")` addresses this control unchanged. */}
        <Field label={FIELD_LABELS.category} error={messageFor("category")}>
          <select
            ref={categoryRef}
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value)}
            onBlur={() => markBlurred("category")}
            className={VALIDATED_CONTROL_CLASS}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
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
              {/* 153.2 — the two money fields carry a rule the server
                  enforces and the client can evaluate, so they refuse here.
                  Both moved off the `Input` primitive onto `Field` + a bare
                  <input> for the aria-derivation reason stated on the category
                  select above. Labels are byte-identical to the primitive's,
                  because `e2e/` and RTL address these by label. */}
              <Field label={FIELD_LABELS.aum} error={messageFor("aum")}>
                <input
                  ref={aumRef}
                  type="number"
                  value={aum}
                  onChange={(e) => setAum(e.target.value)}
                  onBlur={() => markBlurred("aum")}
                  placeholder="0"
                  className={VALIDATED_CONTROL_CLASS}
                />
              </Field>
              <Field
                label={FIELD_LABELS.maxCapacity}
                error={messageFor("maxCapacity")}
              >
                <input
                  ref={maxCapacityRef}
                  type="number"
                  value={maxCapacity}
                  onChange={(e) => setMaxCapacity(e.target.value)}
                  onBlur={() => markBlurred("maxCapacity")}
                  placeholder="0"
                  className={VALIDATED_CONTROL_CLASS}
                />
              </Field>
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
