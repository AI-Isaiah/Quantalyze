# Deferred items — phase 141.1

Out-of-scope discoveries found while executing plans in this phase. Logged, not
fixed, per the executor scope boundary.

---

## DEF-141.1-02-A — `process_key.py` comment over-claims the same thing D-05 just corrected

**Found during:** 141.1-02 Task 1 re-verification.

**What:** The resync draft pre-check in `process_key.py` carries a SCOPE BOUND
comment stating that the pre-check "closes the SEQUENTIAL retry class only" —
i.e. it claims the sequential class IS closed, and that only the concurrent
two-tab race remains.

D-05 established that this is an over-claim. The pre-check filters
`status='draft'`, and the worker's 30s tick advances SV#1 out of `draft`; when
that transition lands inside the 15s-timeout blip window the pre-check matches
nothing and a SECOND draft SV row is inserted. The sequential class is therefore
OPEN for that sub-case.

The registry evidence for `resync` now states this correctly (that was the whole
point of D-05). **The Python comment still says the opposite.** Two artifacts
now disagree about the same fact — which is precisely the audit/doc drift this
phase exists to close, just in the other direction.

**Why not fixed here:** plan 141.1-02 carries a hard fence — "zero Python
changes (this plan READS Python, WRITES TypeScript only)". Editing the comment
would breach it.

**Suggested owner:** whichever 141.1 plan is permitted to touch
`analytics-service/`, or a follow-up. The fix is comment-only: restate the scope
bound as "closes the sequential class EXCEPT the 15s-timeout sub-case where the
worker tick advances SV#1 out of draft mid-blip", and point at the registry
entry.

**Blast radius:** documentation only. No behaviour change. Not user-facing.

---

## DEF-141.1-02-B — `teaser` NO evidence is loose about two of its three named writes

**Found during:** 141.1-02 Task 1 independent re-verification.

**What:** `RETRY_AUDIT_NO_FLOW_TYPES.teaser` says each call "writes a NEW
strategy_verifications row plus a NEW public_token and a NEW lead". Traced:

- NEW `strategy_verifications` row — **confirmed**.
- `public_token` — minted as a 32-byte base64url value in
  `verify-strategy/route.ts`, but persisted via an **UPDATE onto the same SV
  row**, not as a separate row. Calling it a third write overstates it slightly.
- "a NEW lead" — the landing-page lead is a **PostHog event** (ADR-0023 §3),
  explicitly NOT an `audit_log`/DB row; the route's own `@audit-skip` comment
  says so. There is no lead table write on this path.

**Why not fixed here:** (a) this text is PRE-EXISTING and was not touched by the
141.1 re-derivation except for the citation conversion; (b) it sits outside the
D-03/D-04/D-05/D-06 buckets this plan discharges; (c) the verdict is NO and the
imprecision errs in the CONSERVATIVE direction (it overstates the write
surface), so it cannot authorise a wrong retry.

**Blast radius:** audit prose only. Verdict unaffected — teaser stays NO on the
uncontested first item (a fresh uuid4 session per submission ⇒ a new SV row per
retry).
