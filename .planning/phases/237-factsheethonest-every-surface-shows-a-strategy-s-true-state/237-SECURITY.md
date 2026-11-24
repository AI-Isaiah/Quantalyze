---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
audited_at_sha: ba46be5ce
asvs_level: 2
status: secured
threats_total: 21
threats_open: 0
---

# Phase 237 Security Audit

**Verdict: SECURED.** All 21 register entries are closed: 18 mitigated and 3 accepted. gsd-security-auditor verified each mitigation in code at ba46be5ce against `git diff 4002cf06e HEAD -- src` and ran the focus-area and broad test sets: 69 + 1119 tests, all passing.

## Focus areas (all CLOSED)

- **Owner-lane trust tier read (T-237-16..19).**
  - Uses the request client under the `strategy_verifications_owner_select` RLS policy.
  - Projects only `trust_tier, created_at`.
  - Has one call site, inside the owner lane's unpublished block.
  - The tier is overlaid after the build and never enters the shared cache or its key.
  - The tier is validated against three literals in the module and again in the page.
- **Share card cache ladder (T-237-03, -08).**
  - Failed, not-found, unpublished, malformed and figure-less cards all get `no-store`.
  - Unknown, unpublished and malformed ids give the identical header and card, so the card is no existence oracle.
  - A held card gets 60 s with no stale-while-revalidate.
- **Degraded build throw (T-237-06).** The throw happens inside the `unstable_cache` callback, so nothing is stored. This was read in the installed Next 16.4.2 source. The key is bumped to v27.
- **Withheld figures (T-237-05, -15, -21).** Panel bodies are replaced. The Worst 10 chart draws only its title and note, and the heatmap YTD cell is dashed.

## Accepted risks

| Threat | Risk | Why accepted |
|---|---|---|
| T-237-04 | An unfurl bot can hit the database for every no-store card. | Cost is bounded: a malformed id skips the read. |
| T-237-11 | PDF routes now select whole series columns as hold evidence. | `publicIpLimiter` is unchanged on both routes. |
| T-237-SC | Supply chain. | No dependency changes: `package.json`, the lockfile and the analytics requirements are untouched. |

## Recorded residue (not a gap)

- **Rolling chart.** The rolling chart's Export CSV and its last plotted point still carry the last rolling value. Plan 09 recorded this.
- **Client payload.** Withholding is presentational, as it was before this phase: the RSC payload still carries the series.
