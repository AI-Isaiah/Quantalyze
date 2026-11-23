# Phase 155 code review disposition

Three review rounds (gsd-code-reviewer and silent-failure-hunter in parallel each round) and three fixer rounds. Rows below are the round-3 REVIEW.md ids; rounds 1 and 2 were all fixed (see the fix commits `fix(155): ...` from 31353a1c2 to de02129a4).

| id | severity | disposition | where |
|---|---|---|---|
| WR-01 | warning | fixed | de02129a4 (unicode-escape rule in the read-only SQL gate) |
| WR-02 | warning | fixed | 58f3d6d21 (only `withheld` exempts a cell; `short` is compared) |
| IN-01 | info | fixed (folded into SFH M1) | 1d57cfb6b (provenance marker must be a boolean-only object; findings and TS loader refuse mixed provenance) |
| IN-02 | info | open, not fixed (INFO below the fix bar) | `census` still renders a version-1 manifest; every other loader refuses it |
| SFH-R3-M1 | medium | fixed | 1d57cfb6b |
