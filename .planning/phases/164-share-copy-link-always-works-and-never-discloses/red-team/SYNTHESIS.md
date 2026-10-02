# Phase 164 — Red-team SYNTHESIS

**Inputs:** `red-team/FINDINGS-CORPUS.md` (6 teams), `164-CONTEXT.md`, `164-VALIDATION.md`,
`deferred-items.md`, `supabase/migrations/20260827120000_*.sql` (748 lines, UNAPPLIED),
`supabase/migrations/20260827130000_*.sql` (427 lines, UNAPPLIED), `src/lib/strategy-share-token.ts`.
**Date:** 2026-08-27. **Status:** decision document, no code touched.

`[M]` = measured on a throwaway PG16 cluster with the real migration applied verbatim.
`[R]` = reasoned. `[F]` = read directly off a file in this repo during synthesis.

**Headline.** The founder's chosen fix — a per-row nonce in the MAC input — is **right, and is the
best available fix for our requirements**. It closes the entire resurrection family, and it does so
*while staying compatible with SECURITY INVOKER*, which no other candidate does. But it closes
**none** of the N family, and the N family contains an unrecoverable GDPR-erasure wedge. Everything
in this document converges on one gate: **164-03 (the mint route) must not merge until N1 and N2 are
closed**, because today's safety rests entirely on the table being empty.

---

## 1. The invariant

The process team's dominant finding (RC-1) is that this sentence exists nowhere in the phase. It is
a conjunction of two clauses, and every open defect violates exactly one of them.

> **SHARE-INV.** Let `ISSUED` be the set of `(strategy_id, generation, …)` MAC pre-images for which
> a token has ever been handed to a user, and `DEAD ⊆ ISSUED` the subset for which a revoke has ever
> reported success. Then, in **every reachable database state, from every actor, including states
> reached via other tables, row absence, row re-creation, or administrative transport**:
>
> **(I-1 — durability)** the set of pre-images the recipient lane accepts is disjoint from `DEAD`;
> **(I-2 — honesty)** any operation that reports revocation success has moved its pre-image into
> `DEAD` **and** out of the accepted set, in the same committed transaction.

Two properties of this statement are load-bearing and are why the phase kept failing:

- **It is HISTORICAL, not transitional.** `DEAD` is a monotonically growing set over all time. A
  `BEFORE UPDATE` trigger enforces *transitions on a row that exists*. That is sufficient only if
  the row is (a) never absent, (b) not re-creatable, and (c) the sole determinant of the token.
  All three fail independently [M]: (a) `ON DELETE CASCADE` from `strategies`
  (`20260827120000_*.sql:117` [F]); (b) unguarded `INSERT` + client-suppliable `strategies.id`;
  (c) the token also depends on `SHARE_TOKEN_SECRET`, which PITR and branch DBs share.
- **The model stores no witness of what was issued.** The only evidence that generation 3 was
  killed is a current row showing `generation > 3` — evidence that is both destructible (delete the
  row) and forgeable (insert a row). This is the single root cause of the whole R family.

**Property-test form** (this is what should replace 73–76 enumerated arms): generate random
sequences of *arbitrary permitted operations* — mint, revoke, re-share, delete-parent-and-recreate,
raw PATCH, concurrent interleavings — maintaining `DEAD` in the harness, and after every step assert
`accepted ∩ DEAD = ∅` and that every success-reporting revoke grew `DEAD`. Fix round 3's four new
TRIGGER arms are all instances of this one property.

---

## 2. Consolidated defect table

Deduped across all six teams. "Nonce closes?" = the founder's chosen fix (per-row random nonce in
the MAC pre-image), assumed shipped **with** `REVOKE INSERT(nonce), UPDATE(nonce) FROM authenticated`
— see §3 for why that column grant is both necessary and, uniquely, compatible with INVOKER.

| id | Defect | Actor | Ev. | Clause | What closes it | Nonce? |
|---|---|---|---|---|---|---|
| **R1** | generation rewind on an existing row | owner | [M] | I-1 | trigger rule 1 — **CLOSED** | n/a |
| **R2a** | `strategy_id` re-pointed among own strategies | owner | [M] | I-1 | column pin + TRIGGER 3a/3b/3c — **CLOSED in fix round 3** (unmerged worktree) | n/a |
| **R2b** | owner DELETEs own `strategies` row (CASCADE kills the share row), re-INSERTs with the **same client-suppliable uuid**, re-mints → **bit-identical token** | owner | [M] | I-1 | nonce (new row ⇒ new nonce ⇒ disjoint token space). ⛔ A `strategy_id` column pin **cannot** touch this — the delete is on another table | **CLOSES** |
| **R2b′** | **UUID squat**: a *different* user re-creates the uuid; A's revoked URL resolves to **B-controlled content**. Precondition: B knows the uuid, which appears in every `/factsheet/<id>` URL | other tenant | [M] | I-1 | nonce (B's row carries B's nonce) | **CLOSES** |
| **R2c** | profiles cascade | — | [M] | I-1 | mig 20260529150000 revokes — **CLOSED** | n/a |
| **R2d/e/f** | direct DELETE / TRUNCATE / TRUNCATE strategies CASCADE | authenticated | [M] | I-1 | `REVOKE ALL` + per-table TRUNCATE requirement — **CLOSED** (42501) | n/a |
| **R2g** | `service_role` DELETE+INSERT = full resurrection | admin transport | [M] | I-1 | nonce **downgrades this from resurrection to link-death**: a re-created row gets a fresh nonce, so old tokens die rather than revive. Residual: an admin who *recorded* the nonce before deleting can restore it | **PARTIAL** |
| **R3** | `INSERT` is wholly unguarded — the trigger is `BEFORE UPDATE` only, and the grant is column-unrestricted, so `generation` **and** `revoked_at` are client-chosen | owner | [M] | I-1, I-2 | For **I-1**: nonce makes a forged `generation` harmless (a forged row has a fresh nonce, so it cannot land on an issued pre-image) — **unless** the attacker first `SELECT`s their own nonce under RLS, remembers it, cascades the row away, and re-inserts it. So the nonce **must** be paired with `REVOKE INSERT(nonce)`. For **I-2**: still open — see N1 | **PARTIAL** |
| **R4** | PITR restore / branch DB sharing `SHARE_TOKEN_SECRET` | operator | [R] | I-1 | **Nothing in-database.** A restore restores the authoritative table, nonce and all. Design-neutral: hash-at-rest does not survive it either. Mitigation is operational only (§3) | **MISSES** |
| **R5** | `serialize()` collision surface | — | [R] | I-1 | latent today (`${id}.${gen}`, `src/lib/strategy-share-token.ts:96-98` [F]); **the nonce makes this urgent** — a 3-field pre-image with no domain separation is where ambiguity actually appears | **worsens; needs its own fix** |
| **N1** | **INT4 overflow wedge, UNRECOVERABLE.** `PATCH {"generation": 2147483647}` is accepted (trigger forbids *decrease* only); `revoke_strategy_share` then errors `integer out of range`. `sanitize_user`'s Art.17 arm is the **same statement** (`20260827130000_*.sql:240-244` [F]), so **the entire GDPR erasure aborts**. Remediation tested: service_role tombstone-without-bump → blocked by rule 2; `+1` → overflow. **No exit except DDL, or a DELETE that resurrects everything** | owner / data subject | [M] | I-2 | Widen `generation` to `BIGINT` **and** add a `BEFORE INSERT` trigger forcing `generation = 1` **and** a bounded-increment rule on UPDATE | **MISSES** |
| **N2** | **lost-revoke race.** READ COMMITTED: an uncommitted `create_strategy_share` reactivation is invisible to `AND revoked_at IS NULL`; there is no row lock; revoke returns 0 = "already revoked" = **success** per the route contract. Owner is told revoked; URL is live. ⚠️ The STEP 6 self-check arm (i-b) **fails the apply if that predicate is removed** — the durable pin *enforces the racy shape* | two owner sessions | [M] | I-2 | `SELECT … FOR UPDATE` before the UPDATE, **and** rewriting arm (i-b) so it stops pinning the bug | **MISSES** |
| **F1** | Plausible loads from the **root** layout on the token route → the path token lands in Top Pages at a third party | recipient | [M] | disclosure | route exclusion or proxy/strip | orthogonal |
| **F2** | `instrumentation.ts:56` sets `extra.path` = raw token; **zero** `beforeSend` in `src/` | recipient | [M] | disclosure | net-new path scrub (Blocker 3) | orthogonal |
| **F3** | PostHog latent — blocked **only** by `us.i.posthog.com` being absent from `connect-src`, which is an accident | recipient | [M] | disclosure | make it deliberate | orthogonal |
| **F4** | no per-route `no-referrer`; `Referrer-Policy: strict-origin-when-cross-origin` never strips a **path** | recipient | [M] | disclosure | per-route header | orthogonal |
| **F5** | platform logs + link dereferencers/unfurlers | third parties | [R] | disclosure | **inherent** — must be written down as an accepted residual, which it currently is not | orthogonal |
| **F6** | ⭐ **the guard is one file deep.** Both cache controls scan a *single file's* bytes. `src/lib/factsheet/fetch-and-build-payload.ts` and its deps are UNGUARDED, and its docblock asserts "It imports next/cache nowhere" as though that were enforced. A perf PR wrapping the composite read in `unstable_cache([…, id])` shares an id-keyed entry between lanes and **every existing gate stays green**. The acceptance spec `page.cache-isolation.test.tsx` was never written | future editor | [M] | disclosure (SL-1) | pin the whole transitive graph, not one file; write the ORDERED spec | orthogonal |
| **F7** | `checkLimit` **fails open** when `VERCEL_ENV !== production` → preview deploys are unlimited | anyone | [M] | enumeration | fail closed, or accept explicitly | orthogonal |
| **W1** | `pg_default_acl` still holds `authenticated = arwdDxt` → a future `DROP + CREATE` of the table silently restores DELETE/TRUNCATE | future migration | [M] | I-1 | alter the default ACL, or a contract test | orthogonal |
| **T1** | `MIN_SECRET_LENGTH = 32` is a **character** count; the comment says "256-bit HMAC key floor" (`src/lib/strategy-share-token.ts:47` [F]) | operator | [F] | crypto hygiene | byte/entropy floor, or fix the comment | orthogonal |
| **T2** | no domain separation in the MAC pre-image; `import "server-only"` absent vs house convention | — | [M] | crypto hygiene | add both | orthogonal |
| **T3** | Module docblock instructs setting `SHARE_TOKEN_SECRET` **identically across every Vercel environment** (`strategy-share-token.ts:34-37` [F]) — this **maximises R4's blast radius**: a preview/branch deployment can then derive production tokens | operator | [F] | I-1 | per-environment secrets (§8 — undecided, and it contradicts a shipped comment) | orthogonal |

**Sound and NOT defects** (Team 3, Team 4 — preserve these, they are the phase's real assets):
MAC construction is sound (0 collisions in 400k pairs [M]); `TOKEN_RE` has no `/g`; string comparison
correctly rejects 4-way base64url aliasing; `timingSafeEqual` is reached only on equal length; no
unknown-vs-revoked oracle (byte-identical paths). The recipient-lane cache invariant **HOLDS today**
[M]: a 91-module transitive graph with zero cache primitives, never reaching `v2/page.tsx`,
`buildFactsheetPayloadCached` unexported, Next 16.2.11 not caching fetch by default, and
`force-dynamic ⇒ fetchCache=force-no-store`. All poisoning orderings failed. Existence oracles
converge (unknown / malformed / revoked / deleted all 307→410).

---

## 3. Coverage of the chosen fix

### What the nonce actually is

`token = HMAC(secret, strategy_id ‖ generation ‖ nonce)` where `nonce` is server-generated random,
per **row**, never re-derived, never in the URL. It is the **witness of token identity** whose
absence §1 names as the root cause. It converts "prove the counter has advanced" (a transitional
claim about a row that may not exist) into "prove you hold a token minted against *this* row"
(an existential claim that a re-created row cannot satisfy).

### Why it is compatible with SECURITY INVOKER — and why that is the decisive advantage

The migration is emphatic that **column-level grants are not the fix** (`20260827120000_*.sql:218-220`
[F]): revoking `UPDATE(generation)` from `authenticated` also disarms the RPCs, because they are
SECURITY INVOKER and write *as the caller*. That is correct **for `generation` and `revoked_at`** —
both RPCs name those columns explicitly, so neither privilege can be withdrawn.

It is **not** correct for the nonce. PostgreSQL requires column-level `INSERT`/`UPDATE` privilege
only on columns the statement **names**. If the nonce is populated by a column `DEFAULT` and no RPC
ever names it, then `REVOKE INSERT(nonce), UPDATE(nonce) FROM authenticated` is **fully compatible
with INVOKER** [R — verify on the throwaway cluster before relying on it].

⇒ The nonce is the **only** MAC input that can be made unwritable-by-client while keeping the
founder's INVOKER ruling. That is a strong, non-obvious defence of decision 1, and it is the reason
"nonce + column grants" is coherent where "column grants" alone was not.

⛔ **The column grant is not optional.** Without it, R3 (unguarded, column-unrestricted INSERT) plus
RLS-permitted `SELECT` of one's own row lets an owner read the nonce, cascade the row away via
`strategies`, and re-insert it verbatim — reproducing R2b with the nonce in hand. **Nonce without
`REVOKE INSERT(nonce)` does not close R2b.** Any plan that ships one without the other has not
closed what it claims.

### Dies / survives / residual

**Dies (I-1 fully closed):** R2b, R2b′. Together with R1 and R2a (already closed) and R2c–R2f
(closed at the grant layer), **the entire client-reachable resurrection family is closed.**
R3 is neutralised *as a disclosure vector*: a forged `generation` on a forged row now lands in a
token space disjoint from anything ever issued.

**Survives:**

- **N1 and N2 — untouched.** The nonce is an I-1 mechanism; N1 and N2 are I-2 violations. The nonce
  does not make a revoke succeed, and does not stop a revoke from lying. If the founder expects the
  nonce to make revocation *trustworthy*, that expectation is **not met**: it makes revocation
  *durable once it happens*. Stated plainly because the corpus says so.
- **R3 as an availability defect.** An unguarded INSERT can still plant `generation = 2^31-1` on a
  fresh row and pre-wedge N1 before any legitimate revoke exists.
- **R5/T2.** A three-field pre-image with no domain separation is where concatenation ambiguity
  actually becomes reachable. Fix `serialize()` in the same change.

**On `service_role` (R2g), explicitly.** The nonce changes the *character* of the residual rather
than removing it. Before: an admin transport could DELETE+INSERT and **resurrect** revoked links
(I-1 breach, silent). After: the same sequence produces a row with a fresh nonce, so every
outstanding link **dies** — an availability event, loud to users, not a disclosure. The remaining
I-1 breach requires an admin who **records the nonce before deleting and restores it**, i.e. a
deliberate act by a fully-privileged operator, which is the same trust level that can read the
`SHARE_TOKEN_SECRET` and mint any token from scratch. **That residual is inherent and should be
accepted in writing.** Note the migration already records that this feature's recipient lane reads
the table through `createAdminClient()` (`20260827120000_*.sql:~482` [F]) — so `service_role` is not
hypothetical here, it is on the hot path. The `auth.uid() IS NULL` guards added to both RPCs are the
right shape and should be kept.

**On R4 / PITR, explicitly.** A point-in-time restore or a branch DB restores the authoritative row
*including its nonce and generation*, so every link live at the restore point is live again — links
revoked after that point are resurrected. **No in-database scheme fixes this**, including
hash-at-rest, including an append-only design: the restore rolls back the append too. The only real
mitigations are operational, and they are policy calls, not code: (i) **per-environment
`SHARE_TOKEN_SECRET`**, so a branch/preview DB physically cannot derive production tokens — this
directly contradicts the shipped docblock (T3) and needs a founder call; (ii) treat "rotate
`SHARE_TOKEN_SECRET`" as a documented step in any restore runbook, using the global kill-switch the
module already describes; (iii) write PITR down as an accepted residual in `deferred-items.md`,
where it currently is not.

---

## 4. The two disagreements

### 4.1 "Pinning CAN be complete" (write surface) vs "inherently incomplete" (resurrection, token)

**Both are correct, over different domains — and the scope difference is the whole point.**

- The write-surface team's domain is **the 12-cell authenticated write matrix on
  `strategy_shares`**: 2 operations × 6 columns. Over that domain the claim is true and is
  *demonstrated* — fix round 3 closed R2a by pinning, with RED shown on a throwaway PG16
  (`TRIGGER 3a` fired with "create_strategy_share() returned generation 1 — the counter stood at 3").
  Their own verdict already states the boundary: pinning closes the client surface but **not**
  `service_role` DELETE, **not** the `strategies` cascade, **not** PITR.
- The resurrection and token teams' domain is **SHARE-INV over all reachable states**. That domain
  includes operations on *other tables*, *row absence*, *row re-creation*, and *out-of-band state*.
  Over that domain, pinning provably cannot converge (§1).

**Pick: the resurrection framing governs**, because the guarantee the phase owes is stated over
**URLs**, not over rows — "once revoked, that URL never works again." Any argument whose domain is
the write surface is answering a question the user never asked.

But do not discard the write-surface work, and do not read it as wasted: **it is what makes the
nonce sufficient rather than merely helpful.** Its measured result that client `DELETE`/`TRUNCATE`
are dead at the grant layer is precisely what reduces client-side resurrection to the *one* channel
(the `strategies` cascade) that the nonce covers. The two results compose into a complete
client-surface argument; neither does so alone.

### 4.2 "Store a hash at rest" (external research) vs "ranks LAST" (resurrection)

**Pick: the resurrection team, decisively, FOR OUR REQUIREMENTS.**

Hash-at-rest is the correct industry default and the external research is right that it is the
norm — but the norm serves a requirement we do not have. GitHub PATs, Paragon split tokens and
`apikeys.guide` all assume **one-time display**: the token is shown once, the user stores it, and
the server never needs to reproduce it. Our SHARE-01 is the opposite: **Copy Link must return the
same URL every time.** With hash-only storage the raw token is unrecoverable, so every Copy Link
must mint a new one and silently break the recipient's existing link — which is *the founder-hit
defect wearing a different hat*, and success criterion 2 already names it ("regenerating the
original bug in slow motion").

Better still: the external research's *actual* finding is not "store a hash". Read across its four
strands, they all say the same thing in different vocabularies —

- Azure ad-hoc SAS is our exact design, and Microsoft's own position is that **you cannot revoke
  one**; their remedy is **stored access policies** — a stored object the token *references*.
- Biscuit's remedy is **stored revocation identifiers**.
- NIST SP 800-108 makes the point mechanically: re-supplying `(key, label, context)` and
  reproducing the key **is the KDF contract**, not a flaw. Therefore generation monotonicity is a
  *nonce-non-reuse invariant* — and the correct way to guarantee nonce-non-reuse is a nonce that is
  **generated, not counted**.
- Their damning verdict — "worst quadrant: pays the full cost of a stored row and gets none of the
  revocation guarantee, **because the row stores no token identity**" — is a verdict about the
  *missing witness*, not about hashing.

**The per-row nonce is exactly a stored revocation identifier that is (a) not itself a credential —
unlike raw-at-rest, which the founder rejected for making the database a disclosure surface, and (b)
does not destroy re-derivability — unlike hash-only.** It is the synthesis of both teams' positions
rather than a compromise between them, and it is the only candidate in the corpus that satisfies
SHARE-01 and I-1 simultaneously.

**Where the external research is right and we are not following it — flag, don't bury:**
W3C TAG capability-URL guidance recommends **multiple concurrent links per resource** (our
`UNIQUE (strategy_id)` structurally forbids this) and **expiry** (we have none). Both are deliberate
narrowings of the product, but only the first is written down. See §8.

---

## 5. Sequencing risk — is token-design-first safe?

**Verdict: YES, safe as sequenced — but only because of a property that expires, and the expiry is
164-03.**

The reasoning, stated so it can be checked:

1. N1 and N2 are both **unreachable until a row exists** in `strategy_shares`.
2. No row can exist until something calls `create_strategy_share`. The **only** caller would be the
   mint route, which is plan **164-03** — unwritten.
3. Team 4 measured live exposure today as **ZERO**: no mint route, table empty.
4. Therefore deferring N1/N2 past 164-01/164-02 costs **nothing today**, and the founder's
   "sequence them, don't ship one big diff" instinct is sound.

Two corollaries that make the sequence *actively better* than the alternative, not merely tolerable:

- **A token-format change is free now and expensive later.** Adding the nonce to the MAC pre-image
  invalidates every outstanding link. There are zero outstanding links. Doing this *before* 164-03
  is the cheapest it will ever be.
- **Widening `generation` to `BIGINT` is free now and rewrites a live table later.** This is the
  root-cause closure for N1, and it should be pulled **into 164-02**, not deferred, purely on this
  argument. An `ALTER TABLE … TYPE BIGINT` on an empty table is instant.

**The risk that is real.** If 164-03 merges before N1 closes, then N1 becomes reachable by any
owner, on their own row, with a single PATCH — and it is **unrecoverable without DDL**, and it
**aborts that data subject's Art.17 erasure**. That is a regulatory failure mode triggerable by the
data subject themselves, with no operator remedy. It is the single worst item in the corpus.

Note this also resolves the check on founder decision 4 (`sanitize_user` companion ships in-phase):
that decision is **safe as sequenced**, because with zero rows the Art.17 arm matches zero rows and
cannot overflow. It stops being safe at exactly the same moment — 164-03.

### ⛔ Gate for 164-03 (all must hold at merge)

1. Nonce in the MAC pre-image, **with** `REVOKE INSERT(nonce), UPDATE(nonce) FROM authenticated`,
   and a test proving neither RPC names the column (§3 — one without the other closes nothing).
2. **N1 closed at the root:** `generation` widened to `BIGINT`; a **`BEFORE INSERT`** trigger forcing
   `generation = 1` (the trigger is `BEFORE UPDATE` only today — this is R3's actual closure); a
   bounded-increment rule on UPDATE. The `sanitize_user` arm must additionally be provably
   non-abortable.
3. **N2 closed:** `SELECT … FOR UPDATE` in `revoke_strategy_share`, **and** STEP 6 arm (i-b)
   rewritten so it no longer fails the apply when the racy predicate is removed. ⚠️ Until that arm
   is rewritten, the durable gate *enforces the bug* — fixing the RPC alone will fail the apply.
4. Team 4's **F6** closed: the cache guard pinned over the transitive graph rather than one file's
   bytes, and `page.cache-isolation.test.tsx` written **and demonstrated RED first**. Team 4's own
   words: "must land before 164-03."
5. F1/F2/F4 mitigations shipped (Plausible exclusion, Sentry path scrub, per-route `no-referrer`);
   F3/F5/F7/W1 either fixed or written down as accepted residuals with names against them.
6. Every one of the above executed against a real PostgreSQL instance, with the run output in the
   plan — not asserted in prose (see RC-2, §6).

---

## 6. Process changes, ranked by leverage

Team 6's eight remedies, re-ranked by **defects caught per unit cost** rather than by their original
order. "Repo-local" = we can just do it; "founder policy" = needs a call or forks upstream gsd-core.

| # | Change | Defect it would have caught | Cost | Scope |
|---|---|---|---|---|
| **1** | **A runnable throwaway PG cluster before authoring** (RC-2/RC-6). A 456-line migration + 536-line gate were authored, committed, declared done and reviewed by three specialists with **zero executions**; the executor's own words were "NOT RUN — no local psql run was attempted", and the plan's `<automated>` block is English prose | **Every `[M]` finding**: R1, R2a, R2b, R2b′, R3, N1, N2. All of them came from an ad-hoc cluster that exists in no plan, no skill and no CI lane | **Low** — an `initdb`/docker script plus one CI lane | repo-local |
| **2** | **Reviewers must declare execution status; UNEXECUTED blocks** (remedy 5) | Would have surfaced #1 at review time instead of at red-team time. `gsd-code-reviewer` is read-only *by construction*, and nothing in the loop said so out loud | **Trivial** — an agent-prompt field | repo-local |
| **3** | **State the invariant once and property-fuzz it** instead of 73–76 enumerated arms (remedy 1) | ~6 of ~10. The phase enumerated **7 separately discovered paths to one forbidden state**; an 8th was predictable without review — and R2b′ (UUID squat) was in fact the 8th | **Medium** — one harness + a required `<invariant>` block in the PLAN template | repo-local (GSD template) |
| **4** | **Orchestrators pass PATHS, not FACTS** (RC-4). `gsd-plan-checker.md:752` makes the checker's ground truth for decisions **the orchestrator's rendition**, not the file | The D-01..D-09 defect: **85 citations, 0 definitions**, two-thirds inside `<action>` bodies where the label was the sole carrier of the constraint | **Trivial** — one line | founder policy (forks upstream gsd-core) |
| **5** | **Per-arm RED-UNDER annotation, mechanically enforced** (remedy 4) | RC-3: 6 of 73 arms (8.2%) structurally unfailable, in a file just re-tuned to zero slack. The round-1 fix commit *states* "an arm that cannot fail is worse than no arm" **and adds four**; round 2 adds two more | **Medium** | repo-local |
| **6** | **Cross-agent mutation** — a *different* agent writes the neuter than wrote the assertion | The mechanism behind #5 that #5 alone does not fix: the mutation is chosen by the same agent, from the same mental model. Konstantinou et al. is the external evidence — LLM-generated oracles capture *implementation-as-written*, not expected behaviour | **Low** | repo-local |
| **7** | **Ownership by mechanical closure** (RC-5). Decomposition cut across a coupling — `test_*.sql` → `ci.yml` floors → `ci-anti-skip-gate.contract.test.ts` — owned by **nobody** | The unreviewed repair at HEAD of a coupling the plan structure guaranteed would break | **Medium** | repo-local |
| **8** | **Full-suite arbiter named in every plan** (remedy 8) | Partially present already (`164-VALIDATION.md` names it); the gap is that file-scoped runs cannot clear `src/__tests__/contracts/` | **Trivial** | repo-local |
| **9** | **Structural decomposition: insert-only `strategy_share_generations`, current state a view** (remedy 2 — Team 6 marks this "BETTER") | **R1, R2a, R2b, R3, N2 by construction** — the forbidden state becomes unrepresentable. This is Team 6's "constant-time solution" to a problem the process is converging on **linearly** (39 commits: 4 implementation, 19 fix/merge-fix; migration +75%, gate +133%) | **High** — a redesign that reopens D-02's storage shape | **founder policy** |

**On #9 vs the nonce.** They are not exclusive, and #9 is not a reason to delay. An append-only
generations table is the more complete answer (it stores the witness *per issuance* rather than per
row), but it is a larger diff, it reopens a settled decision, and **it still does not close N1, N2 or
R4**. The nonce buys ~90% of #9's I-1 benefit at ~10% of the cost, today, on an empty table. Ship the
nonce; book #9 as the candidate for 164.1 if the surface grows.

**Stop rule (external research, Stechly et al.).** LLMs are no better at verifying than generating,
and *critique content is largely irrelevant* to iterative-prompting outcomes. Wang & Pradel: 29.6%
of plausible patches over-reach. ⇒ **The stop rule is the absence of an external oracle, not a round
count.** For this phase, the external oracle is a real PostgreSQL instance — i.e. remedy #1 is not
merely the highest-leverage item, it is the *only* item that changes the stopping condition.

---

## 7. Inherent to the domain vs caused by this workflow

**Team 6's claim, checked as instructed.** RC-1 asserts that ZERO of ~10 defects were about token
crypto, replay, timing or URL leakage, and all were Postgres privilege/RLS/trigger or GDPR wiring.

**As literally stated across the whole corpus, this is FALSE**, and I verified it against files:

- Team 3 produced **token-crypto findings**: `MIN_SECRET_LENGTH = 32` is a **character** count while
  its own comment claims a "256-bit HMAC key floor" (`src/lib/strategy-share-token.ts:47` [F]); no
  domain separation in the pre-image; `import "server-only"` absent.
- Team 4 produced **five URL-leakage findings** (F1–F5): Plausible recording the path token at a
  third party, `instrumentation.ts:56` putting the raw token in `extra.path` with zero `beforeSend`
  in `src/`, the latent PostHog channel, the missing per-route `no-referrer`, and platform
  logs/dereferencers.

**As applied to the population it means, it HOLDS, and the conclusion survives intact.** RC-1's
"~10 defects" is the *iterated* population — the defects the process kept failing to close across
39 commits and three fix rounds. Every one of those (R1, R2a, R2b, R2b′, R2g, R3, N1, N2) is
Postgres privilege / RLS / trigger semantics or GDPR wiring. **Not one** of the crypto or
URL-leakage findings above required a second round: each was found once, by a single reading, and is
a one-commit fix. That asymmetry is the actual evidence, and it is stronger than the overclaim.

The precise version: **zero of the defects that survived review were about token crypto, replay,
timing or URL leakage.** I am correcting the wording rather than passing it through, because an
unfalsifiable summary is exactly the failure mode this exercise exists to catch.

**Genuinely inherent to the domain** (cannot be engineered away; must be accepted in writing):

- **R4 — PITR / restore.** No stored-state revocation scheme survives a restore of its own store.
- **F5 — platform logs, link unfurlers, browser history.** Inherent to capability URLs in browsers,
  and made strictly wider by D-01's choice of a path segment over a query param (`Referrer-Policy`
  strips query strings cross-origin, never paths).
- **R2g residual — `service_role`.** An admin transport that can read the secret can mint any token;
  no in-database control binds it.
- **The reuse-vs-revocation tension itself.** Re-derivability (SHARE-01) and durable revocation pull
  in opposite directions. This is the one genuinely hard design problem in the phase — and the nonce
  is a correct resolution of it, not a workaround.

**Caused by this workflow** (all closable): R1, R2a, R2b, R2b′, R3, N1, N2, F6, F7, W1, T1, T2, T3.
That is **13 of 17** open or recently-closed items. Team 6's structural verdict — "not a hard
problem badly attacked, but a soluble problem attacked without a runnable oracle" — is supported.

---

## 8. NOT yet decided — needs a founder call

Ordered by how much downstream work is blocked on the answer.

1. **N1's closure mechanism, and whether it moves into 164-02.** Recommended: widen `generation` to
   `BIGINT` **now, while the table is empty**, plus a `BEFORE INSERT` trigger forcing
   `generation = 1`. The "free now, table-rewrite later" argument (§5) is the whole case. ⛔ Also:
   should `sanitize_user`'s Art.17 arm be made **provably non-abortable** regardless? My position:
   yes, unconditionally — a data subject must not be able to wedge their own erasure with data they
   control, and that principle does not depend on N1's specific mechanism.
2. **N2's fix, and the gate that currently pins the bug.** `SELECT … FOR UPDATE` is the safe fix, but
   STEP 6 arm (i-b) **fails the apply if the racy predicate is removed**. The arm must be rewritten
   in the same change or the fix cannot land. Needs an explicit decision that rewriting a durable
   pin here is *correcting* it, not eroding it.
3. **`SHARE_TOKEN_SECRET`: global or per-environment?** The shipped docblock says set it
   **identically everywhere** (`strategy-share-token.ts:34-37` [F]); R4 says that lets a preview or
   branch DB derive production tokens. These are in direct conflict **inside a file that has already
   been written**. One of them has to change.
4. **Does `REVOKE INSERT(nonce), UPDATE(nonce)` ship with the nonce?** Recommended: yes — without it
   the nonce does not close R2b (§3). Also confirm the mechanism on the throwaway cluster first
   (unnamed columns should not require column privilege — verify, don't assume).
5. **Is a forged `generation` on INSERT accepted as harmless post-nonce, or closed?** Recommended:
   closed, via the same `BEFORE INSERT` trigger as (1) — it is the same one-line change and it is
   also R3's closure.
6. **Accepted-residual list.** R4/PITR, F5, and the `service_role` residual are currently **not
   written down anywhere**, including `deferred-items.md`. Accepting a residual silently is
   indistinguishable from missing it.
7. **W3C TAG divergences.** No **expiry** on tokens; **one** concurrent link per strategy
   (`UNIQUE (strategy_id)`). Both are defensible product narrowings; neither is recorded as a
   decision.
8. **F6's home** — 164 or 164.1? The guard being one file deep, plus the never-written
   `page.cache-isolation.test.tsx`, is the largest *silent* disclosure risk in the corpus, and its
   failure mode is TTL-long and green in CI. My read of Team 4 ("must land before 164-03") is that
   it belongs in 164.
9. **F7 `checkLimit` fail-open outside production**, and **W1 `pg_default_acl` DROP+CREATE hazard** —
   fix or accept, either is fine, but pick.
10. **T1/T2** — byte-vs-character secret floor and domain separation. T2 stops being cosmetic the
    moment the pre-image gains a third field.
11. **Process remedy #9** (append-only generations table) — adopt for 164.1, or close the idea? It
    would supersede several items above and reopens D-02.
12. **`scripts/**/*.test.ts` is invisible to vitest** (`deferred-items.md`, D-164-A) —
    `scripts/check-gdpr-export-coverage.test.ts` is 20 KB of assertions that **has never executed**.
    Correctly deferred out of 164-02's blast radius; needs a home.

---

## Verdict

The founder's chosen path is **right**, and it is right for a better reason than the one usually
given for it: the per-row nonce is the *stored revocation identifier* that Azure's stored access
policies, Biscuit and NIST SP 800-108 all independently point at, adapted to a re-derivable token —
and it is the only such witness that keeps SHARE-01 reuse **and** survives the founder's SECURITY
INVOKER ruling. It closes the whole client-reachable resurrection family.

The corpus does **not** say any of the four standing decisions is unsafe. It says two things the
plan must absorb:

- **The nonce is an I-1 mechanism and the N family is I-2.** Nothing about the nonce makes a revoke
  succeed or stops one from lying. If that is what the nonce was expected to buy, it does not.
- **The sequence is safe only while the table is empty.** 164-03 is the moment that ends, and it must
  be gated on §5.

If exactly one process change is made, make it **remedy #1**: a runnable PostgreSQL instance in the
loop before authoring. Every measured finding in this corpus came from a cluster that exists in no
plan, no skill and no CI lane — and it is also the only change that alters the stopping condition.
