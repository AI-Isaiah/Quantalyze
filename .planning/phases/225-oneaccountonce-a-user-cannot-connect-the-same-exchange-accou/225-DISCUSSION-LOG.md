# Phase 225: ONEACCOUNTONCE - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-23
**Phase:** 225-oneaccountonce
**Areas discussed:** failing holder vs refusal, MT5 server identity, cross-user share link, composite add-key path, existing same-owner duplicates

The questions were relayed to the founder by the orchestrator through AskUserQuestion.

---

## Failing holder vs the new refusal

| Option | Description | Selected |
|--------|-------------|----------|
| Admit working key | The working key takes the slot; the failing key is marked duplicate and named on its card; nothing auto-disconnected | ✓ |
| Refuse the working key | Name the failing key and the remedy; strict, but blocks the only working path | |

**User's choice:** Admit working key (Recommended)

---

## MT5 identity includes the broker server

| Option | Description | Selected |
|--------|-------------|----------|
| Separate server column | Plaintext `venue_server`, uniqueness on (user, exchange, login, coalesce(server,'')), poll backfill, staged | ✓ |
| Rewrite venue_account_id as server:login | Breaks 155.2's login-hash check and equality readers during the backfill | |

**User's choice:** Separate server column (Recommended). Plaintext server name: yes, it is not a credential.

---

## Cross-user share link

| Option | Description | Selected |
|--------|-------------|----------|
| Same identity is the link | An equal stamped identity is the link across users; no tenant-boundary change | ✓ |
| Cross-owner marker | Relax the same-owner marker constraint; needs RLS review | |

**User's choice:** Same identity is the link (Recommended)

---

## Composite add-key path

| Option | Description | Selected |
|--------|-------------|----------|
| In scope | Stamp identity and refuse on the composite path, with the D-04 rotation exempt | |
| Out of scope | Composite duplicates stay mark-only | ✓ |

**User's choice:** Out, under the milestone ruling F-2 "Forget about conposites".

---

## Existing same-owner duplicates

| Option | Description | Selected |
|--------|-------------|----------|
| Publish gate | A strategy on a same-owner duplicate key cannot be published; data kept | |
| Founder handles by hand | Unpublish the one case in the UI | |
| Leave it | The key is disconnected and its history frozen | |
| Other (free text) | See below | ✓ |

**User's choice (verbatim):** "Delete all duplicate keys. So same key in one accused twice. Delete also all associated factsheet, data etc. One key can be used over several accounts. Imagine one team sharing the key if their master account with several allocator. Of course each allocator should be able to generate a factsheet"
**Notes:** This overrides "keep data; disconnect, never delete" for same-owner duplicates only. The deletion manifest is produced read-only first, and the founder confirms it before anything runs.

---

## Decided autonomously

[auto] [Tests] — Q: "How is the per-owner refusal tested?" → Selected: "exchange key and MT5 login refused for the same owner; different-owner share still connects" (reversible technical — decided autonomously: tests only)
[auto] [MT5D-08] — Q: "Where does the working-holder rule live?" → Selected: "account_identity.py holder lookup and stamp/marker swap, D-18 predicate" (reversible technical — decided autonomously: internal placement)
[auto] [Refusal copy] — Q: "How is the refusal worded and coded?" → Selected: "existing wizardErrors.ts patterns" (reversible technical — decided autonomously: one module)
[auto] [Seam] — Q: "Which connect paths carry the refusal?" → Selected: "create-with-key and validate-and-encrypt" (reversible technical — decided autonomously: route-level code)

## Claude's Discretion

- Census query shape and deletion order, within the confirmed manifest.

## Deferred Ideas

- Composite identity (F-2), CONN-02/CONN-04 (Phase 228), server-qualified cross-user readers (HOLDINGSTRUTH).
