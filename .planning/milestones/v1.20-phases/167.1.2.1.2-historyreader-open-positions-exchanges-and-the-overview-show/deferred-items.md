# Deferred items (167.1.2.1.2)

## Plan 01 (found 2026-10-20)

- `src/lib/factsheet/compute.conventions.test.ts`, fixtures B and C ("byte-identical to the pre-change compute() (D-36, W1, FROZEN)"): the frozen snapshot differs from the received value in the last float digit of `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` expected, `0.036844507138638946` received). Plan 01 touches no factsheet file, so this predates it (likely a floating-point difference between the machine that wrote the snapshot and this one). Not fixed here.
