# Founder UAT — v1.20, the items no machine can close

**Written 2026-09-12** at `733a55f5`, by founder decision ("You run them, I record").

Every other open verification item across v1.20 was closed by measurement or re-routed to a
named owning phase on 2026-09-12. **These four are what is left**, and they are left because they
need a human at a real browser or real exchange credentials — not because they need more thinking.

⛔ **Do not close any of these by argument.** Paste what you actually see, including a FAIL, and
I will write it into the phase's `VERIFICATION.md` as a measurement. A failed item recorded
honestly is worth more than a closed one.

⚠️ **Why I cannot do these myself, measured rather than assumed:** this environment's Chrome
reports `innerWidth/innerHeight = 0`, `document.scrollHeight = 0`, every element measures 0x0, and
extension screenshots fail at the binding layer. The DOM is readable and the network is drivable;
**nothing is painted**, so no click can be aimed. Items 2 and 4 are interactive by nature. Item 1
needs credentials I must never handle. Item 3 needs a live gateway state.

---

## 1 — Phase 160 PROVENANCE · two remaining connect surfaces

**Needs:** a real **read-only** exchange API key (any supported venue).

**Do:** on `quantalyze.xyz`, connect one key through **StrategyForm** (the create/edit strategy
form) and one through **AllocatorExchangeManager** (the allocator's exchange manager). Open
DevTools → Network first.

**Look for, per surface:**
- a `POST /api/keys/validate-and-encrypt`
- the connect succeeds and the strategy/allocator link updates
- the response body carries `api_key_id` and **no ciphertext fields**

**What is already proven, so you are not re-testing it:** the writer itself is proven live —
PROD `api_keys` holds 33 rows, `attested_venue` is non-NULL and equals `exchange` on **33 of 33**,
and the row minted by `160 gate smoke` (2026-08-25, `okx`) has been syncing successfully ever
since, which proves the stored ciphertext round-trips under a real decrypt. All **three** call
sites are also machine-pinned to that route (`StrategyForm.test.tsx:285`,
`AllocatorExchangeManager.test.tsx:427`, `ApiKeyManager.test.tsx:590`). **What is untested is the
two call SITES against production, not the arm.**

---

## 2 — Phase 161 WIZERR · draft survives a gate refusal and a reload

**Needs:** a browser. No special credentials.

**Do:** walk the strategy wizard to a **gate refusal**, click **"Try another key"**, then
**reload the page** and open the wizard again.

**Look for:** the draft is still there — and on a composite, **every stored member** is still
there. You resume; you do not start over.

**Why it is not already closed:** the non-destructive transition IS pinned in jsdom. What no unit
test observes is draft survival across a **real reload against a real database**, driven through
the same client that made the draft.

---

## 3 — Phase 161 WIZERR · the MT5 `undetermined` sentence

**Needs:** a live MT5 validate that lands an `undetermined` capability verdict. ⚠️ **There may be
nothing to look at** — measured 2026-08-28, the verdict has no durable sink, so this is *read the
next one that occurs*, not *go and find one*.

**Look for — this is the whole point:** the sentence must name **"Allow algorithmic trading"**
(arm 1) when the gateway's Experts setting is off. It must **NOT** name the external-Python-API
option unless `terminal_info` actually reports `tradeapi_disabled`.

⛔ **Naming the external-Python-API option while that flag is off is the exact defect WIZERR-01
exists to remove.** The flag→cause builder is provably correct given its input; what is unproven
is which arm the LIVE gateway actually triggers — `tradeapi_disabled` has been founder-measured
exactly **once** (2026-08-13) and has zero production readers.

---

## 4 — Phase 162 HONEST · one surface, and one that needs a precondition

⭐ **(a) the factsheet v2 masthead is already DISCHARGED** — do not redo it. Measured on published
strategy `fc1b4014`: `Track record · old`, `Aug 28, 2026 (0d)`, `Track record through Aug 19, 2026`
— the compute clock is 0 days old and the chip still refuses to say fresh, which is exactly
HONEST-02's purpose. No `Invalid Date`, no `NaN`, no `fresh` claim on any of the three published
strategies.

**(c) allocations drawer-add — the one to actually run.** Open the allocations drawer and add a
strategy. **Look for:** **em-dash cells while loading**, then real CAGR/Sharpe after settle. It is
a TRANSIENT state that exists only between the click and the settle, so it cannot be read out of
served HTML — it needs a painted, interactive viewport.

**(b) my-strategies "Finish setup →" — UNREACHABLE, and not by failing.** The affordance does not
render because the signed-in account has **no orphaned key**. Fleet-wide there are 24 active keys
with no owning strategy, so the state exists in the data but not for any account I can reach.
⚠️ **To make it testable you must first create the precondition** — an orphaned key on the account
you sign in with. If you would rather not manufacture that state on production, say so and I will
record (b) as "precondition declined" rather than leaving it looking untried.

---

## How to report back

Per item: what you did, what you saw, and PASS / FAIL / UNREACHABLE. Screenshots optional; the
wording is what matters for items 3 and 4. I will write each into the owning phase's
`VERIFICATION.md` with the date, and flip the phase status where it earns it.
