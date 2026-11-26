"""Phase 236 FIGUREMATH: the one named constant set of the figure convention (Python side).

F-5 (REQUIREMENTS.md, verbatim): 'Figures: one convention, "365, ddof 1 everywhere". This
applies inside the existing annualization rule: risk is annualized by frequency (crypto 365,
traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The
TypeScript engines move to match Python.'

F-6 (REQUIREMENTS.md, verbatim): 'CVaR is historical CVaR, null below a minimum number of
observations.'

CONTEXT Q2 (founder 2026-11-25, verbatim "Total record only (Recommended)"): CVAR_MIN_OBS = 60,
one named constant per language. It nulls CVaR only when the TOTAL record has fewer than 60
observations; a zoomed window always shows CVaR.

``CVAR_MIN_OBS`` is a SEPARATE constant from ``MIN_ANNUALIZATION_OBS`` (metrics.py) even though
both are 60 today. Do not alias one to the other: retuning the annualization gate must never
move the CVaR floor, and the other way round.

Each definition is ``NAME = <int>`` at column 0, so the TS twin
(src/lib/figure-conventions.ts) can be pinned by a one-regex text read, and so the pin can
require exactly one definition per name. Both pins fail NAMING the constant when one side moves
alone (src/lib/figure-conventions.test.ts, tests/test_figure_conventions.py). The values are
ints so the shared regex reads one shape; Python callers use them in float arithmetic.

This module imports nothing, so any engine module can import it without a cycle.
"""

# Returns/CAGR annualize on the calendar clock: whole days of the span over 365 (TWR-05; not 365.25).
CALENDAR_DAYS_PER_YEAR = 365

# Standard deviations are SAMPLE sd (ddof 1) everywhere, matching pandas ``std()``.
SD_DDOF = 1

# Risk annualizes by frequency: crypto trades every calendar day, traditional weekdays only.
PERIODS_PER_YEAR_CRYPTO = 365
PERIODS_PER_YEAR_TRADITIONAL = 252

# F-6 / Q2: the TOTAL record needs at least this many observations before CVaR is shown.
CVAR_MIN_OBS = 60
