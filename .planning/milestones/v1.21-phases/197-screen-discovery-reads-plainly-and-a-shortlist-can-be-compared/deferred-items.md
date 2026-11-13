# Phase 197 deferred items

## 197-06 (logged 2026-11-08)

- `src/lib/factsheet/compute.conventions.test.ts`, fixtures B and C ("compute() with no conventions argument is byte-identical to the pre-change compute()"): 2 snapshot cases fail locally on Node v25.8.1 with last-digit float differences in `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` expected, `0.036844507138638946` received). Found by the plan's phase-closing `npm test`. Not caused by Phase 197: no file under `src/lib/factsheet` changed on this branch (`git diff 16375967a HEAD -- src/lib/factsheet` is empty). Left unfixed (out of scope); CI's own run on the head SHA is the judge of whether it is local-platform-only.
