"""Phase 236 plan 01 (FIG-01, F-5): the census of every annualizing site in ``analytics-service``.

WHY: "365, ddof 1 everywhere" is a promise about EVERY engine, and an engine nobody listed is
an engine nobody moved. The source of truth is the tree, never a hand list: the files under
``services/`` and ``routers/`` come from git, are comment- and docstring-stripped with the
``tokenize`` module (a "Not 365.25" comment is not a site), and every file that carries a
census token must be a key of ``CENSUS`` with its class, a one-line reason and its measured
per-token counts. A new site in a new file, or a new token in a known file, fails naming it.

Two arms bite every ``engine`` file that has left ``NOT_YET_MIGRATED``:

* negative: no ``365.25``, ddof-0 / bare ddof-1 literal, ``sqrt(252|365)``, ``TRADING_DAYS`` or
  ``/ 365`` year literal (a literal can drift from the constant; ``SD_DDOF`` cannot);
* positive: it references every constant of its ``must_use`` list in code, beyond its import.

``NOT_YET_MIGRATED`` is exact: it starts as every ``engine`` file, later plans shrink it, a
listed file that already passes both arms fails (so the list cannot rot), and plan 236-09
asserts it empty. The TypeScript twin is ``src/__tests__/annualization-census.test.ts``.

``std_call`` (a bare ``.std(``, whose ddof is the library default) is a census token so an
engine that computes an sd is listed at all, but it is NOT forbidden: ``.std()`` is already
ddof 1, and the migration is to spell it ``ddof=SD_DDOF`` where the engine annualizes.

FINDING, recorded as a comment and not as a figure: Python ``blend_periods_per_year`` maps an
unknown leg to 252 while TS ``blendPeriodsPerYear`` maps it to 365 (RANK-06; pinned by
``test_figure_gate_span.py``). No Phase 236 decision covers it and it is neither a 365.25 nor a
ddof token. The parity vectors of plan 236-08 must therefore not use an unknown leg.
"""

from __future__ import annotations

import ast
import io
import re
import subprocess
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

TOKENS: dict[str, str] = {
    "t365_25": r"365\.25",
    "ddof0": r"ddof\s*=\s*0",
    "ddof1": r"ddof\s*=\s*1\b",
    "sqrt_year": r"sqrt\(\s*(?:252|365)(?:\.0)?\s*\)",
    "TRADING_DAYS": r"TRADING_DAYS",
    # The year-length literal. `365.25` is its own token, so a trailing `.25` must not match here.
    "year_div": r"/\s*365(?:\.0)?(?![\d.])",
    # A bare `.std(`: the library-default ddof. Census-only, see the module docstring.
    "std_call": r"\.std\(",
    "np_var_std": r"\b(?:np|numpy)\.(?:std|var)\(",
}
# Tokens a migrated `engine` file may not carry (std_call is census-only).
FORBIDDEN = tuple(t for t in TOKENS if t != "std_call")


@dataclass
class Exempt:
    token: str
    n: int
    cls: str
    reason: str


@dataclass
class Entry:
    cls: str
    reason: str
    counts: dict[str, int]
    must_use: list[str] | None = None
    exempt: list[Exempt] = field(default_factory=list)


DEGENERACY = "ddof-invariant: the sd is only tested against residue / zero, the answer is the same at ddof 0 and 1"

CENSUS: dict[str, Entry] = {
    "analytics-service/services/metrics.py": Entry(
        cls="engine",
        reason=(
            "stored engine: CAGR on CALENDAR_DAYS_PER_YEAR, annualizing sd on ddof=SD_DDOF, "
            "sqrt(periods_per_year) everywhere including smart_sharpe/smart_sortino (plan 236-03). "
            "The std_call sites left are not annualizers: residue/dispersion checks, serenity's "
            "raw sd, the outlier-ratio sd and the rolling-greeks beta (ddof-invariant or unannualized)"
        ),
        counts={"std_call": 16},  # 17 before plan 236-06: serenity's drawdown-dispersion predicate conjunct left with A2
        must_use=[
            "CALENDAR_DAYS_PER_YEAR",
            "SD_DDOF",
            "PERIODS_PER_YEAR_CRYPTO",
            "PERIODS_PER_YEAR_TRADITIONAL",
            "CVAR_MIN_OBS",
        ],
    ),
    "analytics-service/services/portfolio_metrics.py": Entry(
        cls="engine",
        reason="XIRR: t_years = days / CALENDAR_DAYS_PER_YEAR (a money-weighted rate, moved to the 365-day year under F-5)",
        counts={},
        must_use=["CALENDAR_DAYS_PER_YEAR"],
    ),
    "analytics-service/services/portfolio_optimizer.py": Entry(
        cls="engine",
        reason="_compute_sharpe (the match and portfolio-scoring Sharpe) rides ddof=SD_DDOF; the other std_call sites are residue checks",
        counts={"std_call": 3},
        must_use=["SD_DDOF"],
    ),
    "analytics-service/services/allocated_capital.py": Entry(
        cls="engine",
        reason="allocated-capital Sharpe/Sortino: std(ddof=SD_DDOF), sqrt of _ANNUALISATION_DAYS = PERIODS_PER_YEAR_CRYPTO (the sqrt-365 risk clock)",
        counts={"std_call": 1},
        # Plan 236-03: the 365.0 literal is the RISK clock its docstring names, so it reads
        # PERIODS_PER_YEAR_CRYPTO (value unchanged), not CALENDAR_DAYS_PER_YEAR.
        must_use=["SD_DDOF", "PERIODS_PER_YEAR_CRYPTO"],
    ),
    "analytics-service/services/optimizer.py": Entry(
        cls="engine",
        reason="weight-search risk model: the covariance and mean ride the blend's frequency clock, threaded per request as periods_per_year (CONTEXT A5); it owns no clock constant, so the negative arm is TRADING_DAYS absent. The one std_call is the constant-column residue check",
        counts={"std_call": 1},
        must_use=[],
    ),
    "analytics-service/services/match_engine.py": Entry(
        cls="display",
        reason="`years = track / 365` is display text (Long track record (x years)), not a figure",
        counts={"year_div": 1},
    ),
    "analytics-service/services/csv_validator.py": Entry(
        cls="diagnostic",
        reason="Sharpe-sentinel validation: std(ddof=1) is tested for float residue, no figure is annualized",
        counts={"ddof1": 1, "std_call": 1},
    ),
    "analytics-service/services/dispersion.py": Entry(
        cls="degeneracy",
        reason=DEGENERACY,
        counts={"std_call": 1},
    ),
    "analytics-service/services/portfolio_risk.py": Entry(
        cls="degeneracy",
        reason=DEGENERACY,
        counts={"std_call": 3},
    ),
}

# Files RESEARCH section 1 names that carry no census token. Each is checked: it exists and
# carries no token; if it gains one it must move to CENSUS.
REVIEWED_NO_TOKEN: dict[str, tuple[str, str]] = {
    "analytics-service/routers/portfolio.py": (
        "consumer",
        "_compute_portfolio_analytics threads blend_periods_per_year into the metrics.py backbone; no annualizer of its own",
    ),
    "analytics-service/routers/match.py": ("consumer", "reads the stored Sharpe only"),
    "analytics-service/services/equity_reconstruction.py": (
        "consumer",
        "MetricsSnapshot(sharpe=None, twr=None, ...): no annualizer at HEAD (the L2214 name is stale)",
    ),
    "analytics-service/services/parity_diff.py": (
        "diagnostic",
        "REANNUALIZATION_FACTOR = 365.0 / 252.0 classifies a past 252-to-365 move; not part of the convention set",
    ),
    "analytics-service/services/mt5_parity_findings.py": ("diagnostic", "imports REANNUALIZATION_FACTOR, a classifier of past moves"),
    "analytics-service/services/figure_conventions.py": ("definition", "the F-5 constant set itself"),
}

# Every `engine` file started here. Plan 236-03 moved metrics.py, portfolio_optimizer.py and
# allocated_capital.py out; plan 236-04 moved optimizer.py and portfolio_metrics.py, which empties it.
NOT_YET_MIGRATED: list[str] = []

# ---- the tree ----------------------------------------------------------------------------------


def _strip(src: str) -> str:
    """Blank comments and docstrings (a STRING that is a statement on its own), keep every offset."""
    lines = src.splitlines(keepends=True)
    offs = [0]
    for line in lines:
        offs.append(offs[-1] + len(line))

    def pos(rc: tuple[int, int]) -> int:
        return offs[rc[0] - 1] + rc[1]

    blank: list[tuple[int, int]] = []
    prev: int | None = None
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        if t.type == tokenize.COMMENT:
            blank.append((pos(t.start), pos(t.end)))
        elif t.type == tokenize.STRING and prev in (None, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            blank.append((pos(t.start), pos(t.end)))
        if t.type not in (tokenize.NL, tokenize.COMMENT):
            prev = t.type
    chars = list(src)
    for a, b in blank:
        for i in range(a, b):
            if chars[i] != "\n":
                chars[i] = " "
    return "".join(chars)


def _source_files() -> list[str]:
    out = subprocess.run(
        [
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "analytics-service/services",
            "analytics-service/routers",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return sorted(f for f in out.split("\n") if f.endswith(".py"))


def _code(rel: str) -> str:
    return _strip((ROOT / rel).read_text(encoding="utf-8"))


def _count(code: str) -> dict[str, int]:
    found = {name: len(re.findall(pat, code)) for name, pat in TOKENS.items()}
    return {k: v for k, v in found.items() if v}


def _without_imports(code: str) -> str:
    code = re.sub(r"^[ \t]*from[ \t]+\S+[ \t]+import[ \t]*(?:\([^)]*\)|[^\n]*)", "", code, flags=re.MULTILINE)
    return re.sub(r"^[ \t]*import[ \t]+[^\n]*", "", code, flags=re.MULTILINE)


def _judge(entry: Entry, measured: dict[str, int], code: str) -> tuple[list[str], list[str]]:
    negative: list[str] = []
    for token in FORBIDDEN:
        exempt = sum(e.n for e in entry.exempt if e.token == token)
        left = measured.get(token, 0) - exempt
        if left > 0:
            negative.append(f"{token} x{left}")
    body = _without_imports(code)
    positive = [name for name in (entry.must_use or []) if not re.search(rf"\b{name}\b", body)]
    return negative, positive


FILES = _source_files()
MEASURED: dict[str, dict[str, int]] = {}
CODE: dict[str, str] = {}
for _f in FILES:
    _c = _code(_f)
    _m = _count(_c)
    if _m:
        MEASURED[_f] = _m
        CODE[_f] = _c

ENGINES = {f: e for f, e in CENSUS.items() if e.cls == "engine"}


def _code_of(rel: str) -> str:
    return CODE.get(rel) or _code(rel)


class TestCensusSet:
    def test_every_token_file_is_classified(self) -> None:
        """A new site fails naming its file."""
        unclassified = [
            f"{f} {m}" for f, m in MEASURED.items() if f not in CENSUS and f not in REVIEWED_NO_TOKEN
        ]
        assert unclassified == [], "unclassified annualizing site(s): add each to CENSUS with a class and a reason"

    def test_reviewed_token_free_files_stay_token_free(self) -> None:
        bad: list[str] = []
        for f in REVIEWED_NO_TOKEN:
            if not (ROOT / f).exists():
                bad.append(f"{f} is gone: drop it from REVIEWED_NO_TOKEN")
            if f in MEASURED:
                bad.append(f"{f} now carries {MEASURED[f]}: move it to CENSUS")
        assert bad == []

    def test_no_classified_file_is_stale(self) -> None:
        """A key that vanished, or lost every counted token, fails as stale."""
        stale: list[str] = []
        for f, e in CENSUS.items():
            if not (ROOT / f).exists():
                stale.append(f"{f} no longer exists")
                continue
            migrated_engine = e.cls == "engine" and f not in NOT_YET_MIGRATED
            if not MEASURED.get(f) and not migrated_engine:
                stale.append(f"{f} ({e.cls}) carries no census token any more: remove it from CENSUS")
        assert stale == []

    def test_per_file_counts_equal_recorded(self) -> None:
        """A new site in a known file fails naming file and token."""
        off: list[str] = []
        for f, e in CENSUS.items():
            measured = MEASURED.get(f, {})
            for token in TOKENS:
                want, got = e.counts.get(token, 0), measured.get(token, 0)
                if want != got:
                    off.append(f"{f}: token {token} recorded {want}, measured {got}")
        assert off == []

    def test_entries_are_well_formed(self) -> None:
        bad: list[str] = []
        for f, e in CENSUS.items():
            if not e.reason.strip():
                bad.append(f"{f}: empty reason")
            if e.cls == "engine" and e.must_use is None:
                bad.append(f"{f}: an engine entry needs a must_use list")
            if e.cls != "engine" and e.must_use is not None:
                bad.append(f"{f}: only an engine carries must_use")
            for x in e.exempt:
                if sum(y.n for y in e.exempt if y.token == x.token) > e.counts.get(x.token, 0):
                    bad.append(f"{f}: exempt {x.token} exceeds the counted sites")
                if not x.reason.strip():
                    bad.append(f"{f}: an exempt site has no reason")
        assert bad == []


class TestEngineArms:
    def test_not_yet_migrated_names_only_engines_once(self) -> None:
        assert [f for f in NOT_YET_MIGRATED if f not in ENGINES] == []
        assert len(set(NOT_YET_MIGRATED)) == len(NOT_YET_MIGRATED)

    def test_negative_arm(self) -> None:
        """A migrated engine carries no 365.25, ddof literal, sqrt(252|365), TRADING_DAYS or / 365."""
        fail: list[str] = []
        for f, e in ENGINES.items():
            if f in NOT_YET_MIGRATED:
                continue
            negative, _ = _judge(e, MEASURED.get(f, {}), "")
            if negative:
                fail.append(f"{f}: literal {', '.join(negative)}")
        assert fail == []

    def test_positive_arm(self) -> None:
        """A migrated engine references every constant of its must_use list."""
        fail: list[str] = []
        for f, e in ENGINES.items():
            if f in NOT_YET_MIGRATED:
                continue
            _, positive = _judge(e, MEASURED.get(f, {}), _code_of(f))
            if positive:
                fail.append(f"{f}: never uses {', '.join(positive)}")
        assert fail == []

    # Phase 236 plan 09 (FIG-01): the migration list is proven EMPTY and the engine set is pinned
    # by name, independent of CENSUS, so deleting an engine entry to dodge both arms fails by file.
    RESEARCH_ENGINES = (
        "analytics-service/services/metrics.py",
        "analytics-service/services/portfolio_metrics.py",
        "analytics-service/services/portfolio_optimizer.py",
        "analytics-service/services/allocated_capital.py",
        "analytics-service/services/optimizer.py",
    )

    def test_fig01_not_yet_migrated_is_empty_and_every_engine_passes_both_arms(self) -> None:
        assert NOT_YET_MIGRATED == [], "an engine parked in NOT_YET_MIGRATED is an unmigrated annualizer"
        assert [f for f in self.RESEARCH_ENGINES if f not in ENGINES] == []
        assert [f for f in ENGINES if f not in self.RESEARCH_ENGINES] == [], (
            "an engine the census knows that this pin does not: add it here with its plan"
        )
        failing = []
        for f in self.RESEARCH_ENGINES:
            negative, positive = _judge(ENGINES[f], MEASURED.get(f, {}), _code_of(f))
            if negative or positive:
                failing.append(f"{f}: literal {negative} missing {positive}")
        assert failing == []

    def test_not_yet_migrated_is_exact(self) -> None:
        """A listed file that already passes both arms must be removed from the list."""
        passing = []
        for f in NOT_YET_MIGRATED:
            negative, positive = _judge(ENGINES[f], MEASURED.get(f, {}), _code_of(f))
            if not negative and not positive:
                passing.append(f)
        assert passing == [], "already migrated: remove from NOT_YET_MIGRATED"


# ---- the CVaR readers (F-6, CONTEXT Q2 "Total record only") ------------------------------------

# The CVaR floor (CVAR_MIN_OBS) is correct only for a caller that passes the TOTAL record: a
# zoomed window always shows CVaR. So the set of callers of `_historical_var_cvar` is pinned
# EXACTLY, by enclosing function, and a new caller must be classified here before it can land.
CVAR_READERS: dict[tuple[str, str], str] = {
    ("analytics-service/services/metrics.py", "compute_all_metrics"): (
        "total-record: stores var_1d_95 and cvar from the whole `returns` series of the strategy"
    ),
}


def _cvar_call_sites() -> set[tuple[str, str]]:
    """Every (file, enclosing function) that CALLS `_historical_var_cvar`, from the tree (ast).

    Production Python only (`analytics-service/` minus its tests): a test that monkeypatches the
    helper names it as a string and is not a caller. The `def` itself is not a call."""
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "analytics-service"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    files = sorted(
        f for f in out.split("\n") if f.endswith(".py") and not f.startswith("analytics-service/tests/")
    )
    found: set[tuple[str, str]] = set()
    for rel in files:
        src = (ROOT / rel).read_text(encoding="utf-8")
        if "_historical_var_cvar" not in src:
            continue
        tree = ast.parse(src)

        def visit(node: ast.AST, fn: str) -> None:
            for child in ast.iter_child_nodes(node):
                inner = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else fn
                if isinstance(child, ast.Call):
                    f = child.func
                    name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""
                    if name == "_historical_var_cvar":
                        found.add((rel, fn or "<module>"))
                visit(child, inner)

        visit(tree, "")
    return found


class TestCvarReaders:
    def test_the_only_stored_caller_is_compute_all_metrics_on_the_total_record(self) -> None:
        """A new caller of the floored helper (a zoomed-window one would be wrong) fails naming it."""
        assert _cvar_call_sites() == set(CVAR_READERS)

    def test_every_reader_is_classified_total_record(self) -> None:
        assert all(why.startswith("total-record") for why in CVAR_READERS.values())


@pytest.mark.parametrize(
    ("src", "expected"),
    [
        ("x = 365.25\n", {"t365_25": 1}),
        ('"""Not 365.25 here."""\nx = 1  # 365.25\n', {}),
        ("y = days / 365.0\nz = days / 365.25\n", {"year_div": 1, "t365_25": 1}),
        ("math.sqrt(252)\nnp.sqrt(365.0)\n", {"sqrt_year": 2}),
        ("r.std(ddof=1)\nr.std(ddof = 0)\n", {"ddof1": 1, "ddof0": 1, "std_call": 2}),
    ],
)
def test_counter_reads_code_not_comments(src: str, expected: dict[str, int]) -> None:
    """The counter itself: comments and docstrings are not sites, literals are."""
    assert _count(_strip(src)) == expected
