"""Phase 161.1 / LEDGER-02, LEDGER-04 — the STATIC gates for the ledger refresh.

Why this file exists
--------------------
Four properties of this phase cannot be reached by any behavioural test:

  1. the SQL venue set cannot drift from its Python authority
     (``_LEDGER_BACKED_SOURCES``);
  2. no migration in this repo registers a recurring database job for the
     fan-out — activation is a founder LIVE op (WORKER-03), and
     ``supabase/migrations/**`` AUTO-APPLIES to PROD on merge to main, so a
     schedule reaching a migration reaches production with no deploy step;
  3. the two bound integers are still the ones D-09 derived, and still
     discriminate from each other;
  4. the two cross-language literals introduced by plan 02 — the job metadata
     source marker and the terminal-success status set — cannot drift apart.

Every assertion here is either an ABSENCE or an EQUALITY against a region
extracted from a file. **Both are green over an empty derivation.** A positive
and a negative assertion evaluated against the same empty string agree by luck,
not by construction. The anti-vacuity floor is therefore not decoration in this
file — it is the majority of the work, and it is applied to EVERY extracted
region independently:

    region                    floor      sentinel
    ------------------------  ---------  --------------------------------
    VIEW BODY                 1200 ch    the view's own name
    IS_STALE EXPRESSION        300 ch    the returns-series column name
    DECLARATION PRELUDE         80 ch    the fan-out function's own name
    FUNCTION BODY             2500 ch    the enqueue call
    GUARD REGION              1500 ch    the helper's own name
    COMPOSITE PRELUDE           80 ch    the composite function's own name
    COMPOSITE BODY            2500 ch    the enqueue call

The IS_STALE EXPRESSION is a separately-extracted region with its OWN floor and
its OWN sentinel. It is deliberately not allowed to ride on the VIEW BODY's
floor: gate 6's negative assertions run against it, and a broken sub-extraction
inside a healthy parent is exactly the shape that makes negatives vacuous.

Grep-gate hygiene (the repo rule: *prose must neither satisfy nor trip a
mechanical gate*)
-------------------------------------------------------------------------------
Positive assertions and every value extraction run against a COMMENT-STRIPPED
copy of the region, so a sentence can never SATISFY a gate. Negative assertions
run against the RAW region text, so a venue name or a schedule call cannot hide
inside a comment — which is legitimate here only because both regions were
engineered for it: migration 20260825120000 delimits its verdict with
``LEDGER_REFRESH_VERDICT_BEGIN``/``END`` markers precisely so the two rejected
timestamps can stay as documented informational columns OUTSIDE the region, and
migration 20260825130000 keeps its whole D-01/D-05/D-09 narrative in the file
HEADER, outside the dollar-quoted body, for the same reason.

Runs from ``analytics-service/`` under pytest. Reads files. Starts no service,
opens no socket, touches no database.

GATE 10 (plan 04, wave 4) extends every one of the above to the COMPOSITE arm
(migration 20260825140000), reusing the same extractors, the same floor helper
and the same runtime-concatenated search tokens. It is an EXTENSION of this
file, deliberately — a second gate file would have had to re-derive
``_scan_sql``, ``_assert_region`` and the self-exclusion trick, and a re-derived
copy is a second thing that can drift.
"""
from __future__ import annotations

import pathlib
import re
from typing import Final

# ---------------------------------------------------------------------------
# Pointers — POINTER HYGIENE
# ---------------------------------------------------------------------------
# ⛔ These names and their migrations move together IN THE SAME COMMIT. A stale
# pointer keeps this whole file green while it guards a body nothing runs, which
# is the failure mode the reaper drift gate in tests/test_main_worker.py records
# from experience. Renaming or superseding either migration means editing the
# constant here in the same commit as the rename.
_STALENESS_VIEW_MIGRATION_NAME: Final[str] = (
    "20260825120000_ledger_refresh_staleness_view.sql"
)
_FANOUT_MIGRATION_NAME: Final[str] = (
    "20260825130000_ledger_refresh_fanout_dormant.sql"
)
# Plan 04 / LEDGER-01 — the COMPOSITE arm. Same pointer-hygiene rule as the two
# above: this constant and its migration move together IN THE SAME COMMIT. A
# stale pointer here keeps every gate-10 test green while it guards a body
# nothing runs.
_COMPOSITE_MIGRATION_NAME: Final[str] = (
    "20260825140000_ledger_refresh_composite_arm.sql"
)

# ---------------------------------------------------------------------------
# Search tokens — ASSEMBLED AT RUNTIME, DELIBERATELY
# ---------------------------------------------------------------------------
# ⛔ KEEP THE CONCATENATION. Do NOT "clean this up" into plain string literals.
#
# Gate 3 asserts that certain tokens appear NOWHERE in a set of scanned files.
# If those tokens were spelled as whole literals here, this gate file would
# itself contain them — and any future scan that widens from
# `supabase/migrations/` to the repo (or any reviewer grepping for "is there a
# schedule anywhere?") would get a hit on the very file whose job is to prove
# there is none. Splitting each token across a `+` means the assembled value
# exists only at run time and the source file never matches itself.
#
# The same applies to the fan-out's function name: gate 3b COUNTS the files
# containing it, and a self-match would be indistinguishable from a real second
# definition.
_PG_CRON_SCHEMA: Final[str] = "cr" + "on"
_SCHEDULE_VERB: Final[str] = _PG_CRON_SCHEMA + "." + "sched" + "ule"
_UNSCHEDULE_VERB: Final[str] = _PG_CRON_SCHEMA + "." + "unsched" + "ule"
_FANOUT_FUNCTION_NAME: Final[str] = "enqueue_ledger_refresh" + "_for_strategies"
# ⛔ Concatenated for the SAME reason, not by imitation: gate 10c counts the
# migrations containing this name, exactly as gate 3b does for the fan-out. A
# self-match would be indistinguishable from a real second definition.
_COMPOSITE_FUNCTION_NAME: Final[str] = "enqueue_ledger_composite" + "_refresh"

# The activation setting (plan 02, D-08 lock B). Not a scan-collision risk, but
# kept beside the others because it is the third cross-file literal.
_ACTIVATION_SETTING: Final[str] = "app.ledger_refresh_enabled"

# The glob that replaces filename enumeration (D-18). A third ledger-refresh
# migration added by anyone — including this phase's own plan 04 — is picked up
# automatically. Enumerating the two known filenames would not have been.
_LEDGER_REFRESH_MIGRATION_GLOB: Final[str] = "*ledger_refresh*.sql"
# ⛔ RAISED 2 -> 3 by plan 04, IN THE SAME COMMIT as the composite migration it
# counts. This integer is gate 3a's anti-vacuity floor, and it is the ONLY thing
# that makes "the composite migration is inside gate 3a's dormancy scan" a
# measured fact rather than an assumption: leaving it at 2 would have kept 3a
# green even if the composite migration were renamed out of the glob entirely.
# Gate 10a asserts the membership directly as well, so the two checks fail for
# distinguishable reasons.
_KNOWN_LEDGER_REFRESH_MIGRATIONS: Final[int] = 3

# Region floors. Hand-typed, and deliberately well under the measured sizes
# (4246 / 1105 / 190 / 10500 / 7685 characters at the commit that introduced
# them) so ordinary editing cannot trip them while a broken extraction — which
# returns nothing, or a few characters — cannot slip past.
_VIEW_BODY_MIN_CHARS: Final[int] = 1200
_IS_STALE_MIN_CHARS: Final[int] = 300
_PRELUDE_MIN_CHARS: Final[int] = 80
_FUNCTION_BODY_MIN_CHARS: Final[int] = 2500
_GUARD_REGION_MIN_CHARS: Final[int] = 1500
# Plan 04's two regions. Measured at the commit that introduced them: 170 and
# 11527 characters. Floored at roughly a half / a fifth, on the same reasoning.
_COMPOSITE_PRELUDE_MIN_CHARS: Final[int] = 80
_COMPOSITE_BODY_MIN_CHARS: Final[int] = 2500
# The composite handler's own terminal-stamp closure. Measured at 7708
# characters at the commit that introduced its guard.
_COMPOSITE_GUARD_REGION_MIN_CHARS: Final[int] = 1500

# The rejected freshness keys (plan 01, D-03). `computed_at` covers both
# `strategy_analytics.computed_at` and the view's `analytics_computed_at` alias;
# `series_written_at` is included because the verdict region's own marker
# comment states the rule as "no write timestamp of ANY kind may appear below",
# and keying the verdict on a write timestamp is the Phase-106 janitor bug
# whichever of the three it is.
_REJECTED_FRESHNESS_TOKENS: Final[tuple[str, ...]] = (
    "computed_at",
    "last_sync_at",
    "series_written_at",
)

_DOLLAR_TAG_RE: Final[re.Pattern[str]] = re.compile(
    r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$"
)


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
def _repo_root() -> pathlib.Path:
    """``parents[2]`` from ``analytics-service/tests/`` is the repo root.

    Same resolution as tests/test_main_worker.py's reaper drift gate and
    tests/test_migration_132.py.
    """
    return pathlib.Path(__file__).resolve().parents[2]


def _migrations_dir() -> pathlib.Path:
    return _repo_root() / "supabase" / "migrations"


def _view_migration_path() -> pathlib.Path:
    return _migrations_dir() / _STALENESS_VIEW_MIGRATION_NAME


def _fanout_migration_path() -> pathlib.Path:
    return _migrations_dir() / _FANOUT_MIGRATION_NAME


def _composite_migration_path() -> pathlib.Path:
    return _migrations_dir() / _COMPOSITE_MIGRATION_NAME


def _job_worker_path() -> pathlib.Path:
    """``parents[1]`` is ``analytics-service/``."""
    return pathlib.Path(__file__).resolve().parents[1] / "services" / "job_worker.py"


def _read(path: pathlib.Path, pointer_constant: str) -> str:
    assert path.is_file(), (
        f"{path} is missing. This file's {pointer_constant} pointer names it; if "
        "the migration was renamed or superseded, move the pointer IN THE SAME "
        "COMMIT. A stale pointer keeps every gate below green while it guards a "
        "body nothing runs."
    )
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# SQL scanning
# ---------------------------------------------------------------------------
def _scan_sql(text: str, *, stop_at_semicolon: bool) -> tuple[str, int]:
    """Walk SQL, returning ``(code-only text, index just past the terminator)``.

    Comment-awareness is load-bearing in BOTH directions:

      * finding a statement's end by ``text.find(";")`` is wrong — the view
        migration's in-body prose contains "catches single-key strategies;",
        which truncates the extraction to a few hundred characters of comment
        and would make every negative assertion below vacuous (measured while
        writing this file);
      * comment-stripping is what stops a SENTENCE satisfying a positive
        assertion.

    Single-quoted literals (with ``''`` escapes) and dollar-quoted blocks are
    passed through untouched, so a ``--`` or ``;`` inside one cannot be
    mistaken for a comment or a terminator.
    """
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("--", i):
            j = text.find("\n", i)
            if j < 0:
                i = n
            else:
                out.append("\n")
                i = j + 1
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        ch = text[i]
        if ch == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if text.startswith("''", j):
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
            continue
        tag_match = _DOLLAR_TAG_RE.match(text, i)
        if tag_match is not None:
            tag = tag_match.group(0)
            j = text.find(tag, i + len(tag))
            j = n if j < 0 else j + len(tag)
            out.append(text[i:j])
            i = j
            continue
        if ch == ";" and stop_at_semicolon:
            out.append(";")
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    return "".join(out), n


def _strip_sql_comments(fragment: str) -> str:
    code, _ = _scan_sql(fragment, stop_at_semicolon=False)
    return code


def _sql_statement(src: str, header: re.Pattern[str], what: str) -> str:
    """The RAW text of the statement whose header matches, up to its own ``;``."""
    match = header.search(src)
    assert match is not None, (
        f"could not locate the {what} statement — the extraction is broken, so "
        "every assertion scoped to it proves nothing. If the statement was "
        "renamed or restructured, fix this pattern rather than deleting the gate."
    )
    _, end = _scan_sql(src[match.start() :], stop_at_semicolon=True)
    return src[match.start() : match.start() + end]


def _assert_region(label: str, text: str, min_chars: int, sentinel: str) -> str:
    """THE ANTI-VACUITY FLOOR. Applied to every extracted region, separately.

    A region that comes back empty (or nearly so) makes every ABSENCE assertion
    scoped to it pass by default, and this file is mostly absence assertions.
    Length alone is not enough — a region could be long and still be the wrong
    text — so each region also carries a hand-typed sentinel proving the
    extraction landed where it was aimed.
    """
    assert len(text) >= min_chars, (
        f"ANTI-VACUITY FLOOR: the extracted {label} is {len(text)} characters, "
        f"below the {min_chars}-character floor. The extraction is broken. Do "
        "NOT lower the floor to make this pass — every negative assertion "
        f"scoped to this region is vacuously green right now. Region was: "
        f"{text[:200]!r}"
    )
    assert sentinel in text, (
        f"ANTI-VACUITY FLOOR: the extracted {label} does not contain its "
        f"sentinel {sentinel!r}, so the extraction landed on the wrong text and "
        "the assertions scoped to it prove nothing. Region began: "
        f"{text[:200]!r}"
    )
    return text


# ---------------------------------------------------------------------------
# The five regions
# ---------------------------------------------------------------------------
_VIEW_HEADER_RE: Final[re.Pattern[str]] = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.ledger_refresh_staleness",
    re.IGNORECASE,
)


def view_body() -> str:
    """REGION 1 — the CREATE VIEW statement only, up to its terminating ``;``."""
    src = _read(_view_migration_path(), "_STALENESS_VIEW_MIGRATION_NAME")
    body = _sql_statement(src, _VIEW_HEADER_RE, "CREATE VIEW ledger_refresh_staleness")
    return _assert_region(
        "VIEW BODY", body, _VIEW_BODY_MIN_CHARS, "ledger_refresh_staleness"
    )


def is_stale_expression() -> str:
    """REGION 2 — the freshness VERDICT, between plan 01's explicit markers.

    Scoped rather than whole-file, and that is not an over-complication: the
    view LEGITIMATELY exposes both rejected timestamps as documented
    informational columns with explanatory ``COMMENT ON COLUMN`` prose (plan 01,
    D-03), so a whole-body negative grep for them would be tripped by the view's
    own documentation. Plan 01 delimited this region for exactly this reason.

    Its floor and sentinel are its OWN. It does not inherit the VIEW BODY's.
    """
    body = view_body()
    match = re.search(
        r"LEDGER_REFRESH_VERDICT_BEGIN(.*?)LEDGER_REFRESH_VERDICT_END",
        body,
        re.DOTALL,
    )
    assert match is not None, (
        "the view body carries no LEDGER_REFRESH_VERDICT_BEGIN/END markers. "
        "Plan 01 placed them so gate 6's negative assertions could be scoped to "
        "the verdict instead of the whole file. Without them the extraction is "
        "empty and gate 6 would pass over nothing — restore the markers rather "
        "than widening the gate."
    )
    return _assert_region(
        "IS_STALE EXPRESSION",
        match.group(1),
        _IS_STALE_MIN_CHARS,
        "last_return_date",
    )


def function_declaration_prelude() -> str:
    """REGION 3 — ``CREATE … FUNCTION …`` through ``AS $fanout$``.

    ⚠️ This region exists because plan 05's own text defined the FUNCTION BODY
    as "the text between the dollar-quote delimiters" and then asked gate 7 to
    assert that body pins ``search_path`` — which it cannot, because
    ``SET search_path`` is part of the CREATE FUNCTION DECLARATION and sits
    OUTSIDE the delimiters, as it does in every SECDEF function in this repo.
    Plan 02's executor measured that and left the correction in its SUMMARY
    ("Notes owed to plan 05", item 1). Gate 7 therefore reads THIS region, and
    was proven to redden when ``SET search_path`` is actually removed.
    """
    src = _read(_fanout_migration_path(), "_FANOUT_MIGRATION_NAME")
    match = re.search(
        r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\."
        + re.escape(_FANOUT_FUNCTION_NAME)
        + r"\s*\(\s*\).*?AS\s+\$fanout\$",
        src,
        re.DOTALL | re.IGNORECASE,
    )
    assert match is not None, (
        "could not locate the fan-out's CREATE FUNCTION declaration prelude "
        "(header through `AS $fanout$`). The extraction is broken and gate 7 "
        "would prove nothing."
    )
    return _assert_region(
        "DECLARATION PRELUDE",
        match.group(0),
        _PRELUDE_MIN_CHARS,
        _FANOUT_FUNCTION_NAME,
    )


def function_body() -> str:
    """REGION 4 — the text between the fan-out's ``$fanout$`` delimiters."""
    src = _read(_fanout_migration_path(), "_FANOUT_MIGRATION_NAME")
    match = re.search(r"\$fanout\$(.*?)\$fanout\$", src, re.DOTALL)
    assert match is not None, (
        "the fan-out migration has no $fanout$...$fanout$ block. The function "
        "body must stay dollar-quoted with that tag; if the tag changed, change "
        "it here in the same commit."
    )
    return _assert_region(
        "FUNCTION BODY",
        match.group(1),
        _FUNCTION_BODY_MIN_CHARS,
        "enqueue_compute_job(",
    )


def guard_region() -> str:
    """REGION 5 — the ``_stamp_strategy_analytics_failed`` closure in Python.

    The closure is nested inside ``run_derive_broker_dailies_job`` at eight
    spaces of indentation. Its body is every subsequent line indented FURTHER
    than that, so the region ends at the first following non-blank line whose
    indentation is less than or equal to the ``async def``'s. That rule is
    exact — it does not depend on what kind of statement happens to follow the
    closure, which in this file is a plain annotated assignment rather than
    another ``def``.
    """
    src = _read(_job_worker_path(), "services/job_worker.py")
    lines = src.splitlines()
    start: int | None = None
    for index, line in enumerate(lines):
        if line.strip().startswith("async def _stamp_strategy_analytics_failed"):
            start = index
            break
    assert start is not None, (
        "services/job_worker.py no longer defines "
        "`_stamp_strategy_analytics_failed`. Gates 8 and 9 read that closure; if "
        "the D-15 guard moved, move this extractor with it — do not delete the "
        "gate, it is the only thing pinning the SQL marker to the Python one."
    )
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = len(lines)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip():
            continue
        if len(line) - len(line.lstrip()) <= indent:
            end = index
            break
    return _assert_region(
        "GUARD REGION",
        "\n".join(lines[start:end]),
        _GUARD_REGION_MIN_CHARS,
        "_stamp_strategy_analytics_failed",
    )


def composite_declaration_prelude() -> str:
    """REGION 6 — ``CREATE … FUNCTION …`` through ``AS $composite$``.

    Exists for the SAME reason region 3 does: ``SET search_path`` is part of the
    CREATE FUNCTION declaration and sits OUTSIDE the dollar-quote delimiters, so
    a hygiene gate scoped to the body alone would be RED against a correct file.
    """
    src = _read(_composite_migration_path(), "_COMPOSITE_MIGRATION_NAME")
    match = re.search(
        r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\."
        + re.escape(_COMPOSITE_FUNCTION_NAME)
        + r"\s*\(\s*\).*?AS\s+\$composite\$",
        src,
        re.DOTALL | re.IGNORECASE,
    )
    assert match is not None, (
        "could not locate the composite arm's CREATE FUNCTION declaration "
        "prelude (header through `AS $composite$`). The extraction is broken and "
        "gate 10e would prove nothing."
    )
    return _assert_region(
        "COMPOSITE PRELUDE",
        match.group(0),
        _COMPOSITE_PRELUDE_MIN_CHARS,
        _COMPOSITE_FUNCTION_NAME,
    )


def composite_body() -> str:
    """REGION 7 — the text between the composite arm's ``$composite$`` tags."""
    src = _read(_composite_migration_path(), "_COMPOSITE_MIGRATION_NAME")
    match = re.search(r"\$composite\$(.*?)\$composite\$", src, re.DOTALL)
    assert match is not None, (
        "the composite migration has no $composite$...$composite$ block. The "
        "function body must stay dollar-quoted with that tag; if the tag "
        "changed, change it here in the same commit."
    )
    return _assert_region(
        "COMPOSITE BODY",
        match.group(1),
        _COMPOSITE_BODY_MIN_CHARS,
        "enqueue_compute_job(",
    )


def composite_guard_region() -> str:
    """REGION 8 — the ``_stamp_failed`` closure inside the composite handler.

    The composite handler has a terminal stamp of its OWN, distinct from
    ``_stamp_strategy_analytics_failed`` (region 5), and plan 04 extended the
    D-15 non-destructive guard onto it. Same indentation rule as region 5: the
    closure sits inside ``run_stitch_composite_job``, so its body is every
    subsequent line indented FURTHER than the ``async def``, and the region ends
    at the first following non-blank line indented ``<=`` it. What follows here
    is a comment at the enclosing function's level, not a ``def`` — which is
    exactly why the rule is written on indentation rather than on statement kind.
    """
    src = _read(_job_worker_path(), "services/job_worker.py")
    lines = src.splitlines()
    start: int | None = None
    for index, line in enumerate(lines):
        if line.strip().startswith("async def _stamp_failed"):
            start = index
            break
    assert start is not None, (
        "services/job_worker.py no longer defines the `_stamp_failed` closure "
        "inside run_stitch_composite_job. Gate 11 reads that closure; if the "
        "composite non-destructive guard moved, move this extractor with it — do "
        "not delete the gate, it is the only thing pinning the composite arm's "
        "SQL marker to the Python one."
    )
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = len(lines)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip():
            continue
        if len(line) - len(line.lstrip()) <= indent:
            end = index
            break
    return _assert_region(
        "COMPOSITE GUARD REGION",
        "\n".join(lines[start:end]),
        _COMPOSITE_GUARD_REGION_MIN_CHARS,
        "_stamp_failed",
    )


def _sql_string_list(literal_list: str) -> set[str]:
    """``"'a', 'b'"`` -> ``{"a", "b"}``."""
    return {value for value in re.findall(r"'([^']*)'", literal_list)}


def _banned_venue_names() -> set[str]:
    """Every venue literal, ledger and ccxt alike.

    The ledger three come from the Python authority, so adding a fourth ledger
    venue extends this ban automatically rather than leaving a hole.
    """
    from services.ingestion.long_fetch import _LEDGER_BACKED_SOURCES

    return set(_LEDGER_BACKED_SOURCES) | {"binance", "okx", "bybit"}


# ---------------------------------------------------------------------------
# THE ANTI-VACUITY FLOOR, as tests in its own right
# ---------------------------------------------------------------------------
class TestAntiVacuityFloor:
    """Every region below is extracted before it is asserted over, and a broken
    extraction makes ABSENCE assertions pass by default. These five tests make
    the floor visible as its own failure rather than as a mysteriously-green
    gate 2 / gate 6. Each extractor also re-runs the floor internally, so the
    floor fires whichever entry point reaches the broken region first."""

    def test_view_body_region_is_real(self) -> None:
        assert len(view_body()) >= _VIEW_BODY_MIN_CHARS

    def test_is_stale_expression_region_is_real(self) -> None:
        """⛔ Separately floored ON PURPOSE. This region is a sub-slice of the
        view body, and a sub-extraction can break while its parent stays
        healthy. Gate 6's negatives run here; without an independent floor and
        an independent sentinel they would be green over an empty string, and a
        positive assertion over that same empty string would be red — agreement
        by luck rather than by construction."""
        region = is_stale_expression()
        assert len(region) >= _IS_STALE_MIN_CHARS
        assert "last_return_date" in region

    def test_declaration_prelude_region_is_real(self) -> None:
        assert len(function_declaration_prelude()) >= _PRELUDE_MIN_CHARS

    def test_function_body_region_is_real(self) -> None:
        assert len(function_body()) >= _FUNCTION_BODY_MIN_CHARS

    def test_guard_region_is_real(self) -> None:
        assert len(guard_region()) >= _GUARD_REGION_MIN_CHARS

    def test_composite_prelude_region_is_real(self) -> None:
        assert len(composite_declaration_prelude()) >= _COMPOSITE_PRELUDE_MIN_CHARS

    def test_composite_guard_region_is_real(self) -> None:
        assert len(composite_guard_region()) >= _COMPOSITE_GUARD_REGION_MIN_CHARS

    def test_composite_body_region_is_real(self) -> None:
        """⛔ Gate 10b's venue scan is an ABSENCE assertion over this region, and
        an absence assertion over an empty string is green. Floored and
        sentinelled separately from the fan-out's body for that reason."""
        region = composite_body()
        assert len(region) >= _COMPOSITE_BODY_MIN_CHARS
        assert "enqueue_compute_job(" in region


# ---------------------------------------------------------------------------
# GATE 1 — LEDGER-04 venue drift
# ---------------------------------------------------------------------------
class TestGate1VenueDrift:
    """The SQL venue array and the Python authority are one set or the phase is
    broken. This is a DRIFT gate, so importing the constant it pins is correct:
    the property under test is SQL == Python, not the value's correctness."""

    def test_view_venue_array_equals_python_authority(self) -> None:
        from services.ingestion.long_fetch import _LEDGER_BACKED_SOURCES

        code = _strip_sql_comments(view_body())
        matches: list[str] = re.findall(
            r"ARRAY\[([^\]]*)\]::TEXT\[\]\s+AS\s+venues", code
        )
        assert len(matches) == 1, (
            "expected exactly ONE `ARRAY[...]::TEXT[] AS venues` declaration in "
            f"the view body, found {len(matches)}. Migration "
            f"{_STALENESS_VIEW_MIGRATION_NAME} is the SINGLE SQL home of the "
            "ledger venue set (D-05); a second declaration is a second drift "
            "surface."
        )
        sql_venues = _sql_string_list(matches[0])
        assert len(sql_venues) == 3, (
            f"the extracted SQL venue set has {len(sql_venues)} member(s): "
            f"{sorted(sql_venues)}. Three are expected. An extraction that "
            "returned one venue must not be able to pass this gate by matching a "
            "Python set that was edited down to one at the same time."
        )
        assert sql_venues == set(_LEDGER_BACKED_SOURCES), (
            "LEDGER-04 VENUE DRIFT: the ledger venue set in "
            f"{_STALENESS_VIEW_MIGRATION_NAME} is {sorted(sql_venues)} but "
            "`_LEDGER_BACKED_SOURCES` (analytics-service/services/ingestion/"
            f"long_fetch.py) is {sorted(_LEDGER_BACKED_SOURCES)}.\n"
            "⛔ ORDER OF OPERATIONS: change the PYTHON constant FIRST, then this "
            "migration. Python is the sole authority (ROADMAP fence); the SQL "
            "array is a mirror that exists only because the cohort query has to "
            "run in the database."
        )


# ---------------------------------------------------------------------------
# GATE 2 — single source (plan 01 D-05 / plan 02 D-16)
# ---------------------------------------------------------------------------
class TestGate2SingleSource:
    """The fan-out declares NO venue of its own — not in code and not in prose.

    Prose is included deliberately: plan 02 moved its entire D-01/D-09 narrative
    into the file HEADER, outside the dollar quotes, precisely so this gate
    could scan the raw body. A venue name reappearing in a body comment is the
    first step back toward a second declaration."""

    def test_function_body_declares_no_venue_literal(self) -> None:
        body = function_body()
        found = sorted(venue for venue in _banned_venue_names() if venue in body)
        assert not found, (
            "SINGLE SOURCE VIOLATION: the fan-out's function body names "
            f"{found}. The cohort must come entirely from "
            "public.ledger_refresh_staleness, which is the single SQL home of "
            "the venue set.\n"
            "Why this is a hard rule, on claims that are TRUE:\n"
            "  (1) the ROADMAP fence — `_LEDGER_BACKED_SOURCES` "
            "(analytics-service/services/ingestion/long_fetch.py) is the SOLE "
            "authority for which venues are ledger-backed, and a mirrored "
            "implementation (a Vercel-cron/TS one in particular) is ruled out "
            "unless a drift gate is explicitly accepted;\n"
            "  (2) the measured incident — a hand-copied mirror drifted to ONE "
            "venue while Python held THREE, and cost a funded MT5 account its "
            "publish path.\n"
            "⚠️ This gate does NOT rest on any claim that "
            "src/lib/strategyGate.invariant.test.ts bans venue literals across "
            "TS: measured at HEAD, its BANNED_VENUE_LITERALS is scoped to "
            "src/lib/strategyGate.ts alone (:64). If you were told otherwise, "
            "that claim is false and is not the reason for this rule.\n"
            "If a venue genuinely must be named here, the correct move is to "
            "add a column to the view — not a literal to this body."
        )


# ---------------------------------------------------------------------------
# GATE 3 — LEDGER-02 dormancy (D-18: glob + symbol count, never enumeration)
# ---------------------------------------------------------------------------
class TestGate3Dormancy:
    """No migration registers a recurring job for this fan-out.

    ``supabase/migrations/**`` AUTO-APPLIES to PROD on merge to main. Activation
    is a founder LIVE op owned by docs/runbooks/ledger-refresh-go-live.md
    (WORKER-03 precedent), because auto-apply plus a silently-skipped worker
    deploy recreates the v1.11 wedge verbatim.

    ⛔ NOT by enumerating the two known filenames. A third ledger-refresh
    migration — added by this phase's own plan 04, or by anyone — would register
    a schedule straight past a hard-coded list."""

    def test_3a_no_schedule_in_any_ledger_refresh_migration(self) -> None:
        paths = sorted(_migrations_dir().glob(_LEDGER_REFRESH_MIGRATION_GLOB))
        # ⛔ COUNT FIRST. An empty or short glob makes the loop below iterate
        # over nothing, and "no file contained the token" reads exactly like
        # success. This is the anti-vacuity floor for gate 3a.
        assert len(paths) >= _KNOWN_LEDGER_REFRESH_MIGRATIONS, (
            f"the glob {_LEDGER_REFRESH_MIGRATION_GLOB!r} under "
            f"{_migrations_dir()} matched {len(paths)} file(s), fewer than the "
            f"{_KNOWN_LEDGER_REFRESH_MIGRATIONS} known to exist "
            f"({_STALENESS_VIEW_MIGRATION_NAME}, {_FANOUT_MIGRATION_NAME}). The "
            "scan below would be VACUOUS. Either the migrations were renamed out "
            "of the glob's reach — in which case widen the glob in the same "
            "commit — or the scan is broken."
        )
        offenders: list[str] = []
        for path in paths:
            # RAW text, comments INCLUDED: a commented-out schedule call is one
            # uncomment away from a production schedule, and the runbook's rule
            # is that the statement does not live in a migration at all.
            raw = path.read_text(encoding="utf-8")
            if _SCHEDULE_VERB in raw or _UNSCHEDULE_VERB in raw:
                offenders.append(path.name)
        assert not offenders, (
            f"LEDGER-02 DORMANCY VIOLATION: {offenders} contain a pg_cron "
            "registration call. Migrations AUTO-APPLY to PROD on merge to main, "
            "so a schedule here goes live with no deploy step and no founder "
            "action. Activation is a two-step founder LIVE op owned by "
            "docs/runbooks/ledger-refresh-go-live.md (the WORKER-03 rule: the "
            "switch is flipped live, never by merging). Move the statement into "
            "that runbook."
        )

    def test_3b_fanout_function_name_appears_in_exactly_one_migration(self) -> None:
        """Closes the hole 3a still leaves: a migration whose FILENAME lacks the
        phase token could register a schedule for this function and never enter
        3a's glob."""
        hits = sorted(
            path.name
            for path in _migrations_dir().glob("*.sql")
            if _FANOUT_FUNCTION_NAME in path.read_text(encoding="utf-8")
        )
        # EXACTLY one, not "at most one". Zero means the search is broken, and
        # reporting a broken search as success is the failure mode this entire
        # file exists to prevent.
        assert len(hits) == 1, (
            f"expected the fan-out function name to appear in EXACTLY 1 "
            f"migration (the one that defines it, {_FANOUT_MIGRATION_NAME}); "
            f"found {len(hits)}: {hits}.\n"
            "  0 hits ⇒ the search is broken (or the migration was renamed "
            "without moving _FANOUT_MIGRATION_NAME) — this gate is proving "
            "nothing, fix it rather than relaxing it.\n"
            "  2+ hits ⇒ a second migration either REGISTERS A SCHEDULE for the "
            "fan-out or CALLS it. This phase forbids both from a migration: "
            "migrations auto-apply to PROD, and activation belongs to "
            "docs/runbooks/ledger-refresh-go-live.md (WORKER-03)."
        )


# ---------------------------------------------------------------------------
# GATE 4 — LEDGER-02 lock B, the fail-closed activation switch
# ---------------------------------------------------------------------------
class TestGate4ActivationLock:
    def test_activation_is_exact_lowercase_string_equality(self) -> None:
        code = _strip_sql_comments(function_body())
        assert f"current_setting('{_ACTIVATION_SETTING}'" in code, (
            "LEDGER-02 LOCK B: the fan-out body does not read "
            f"current_setting('{_ACTIVATION_SETTING}', …). Lock B is the "
            "fail-closed switch that makes merging this migration "
            "behaviour-neutral, and it is also the incident-pressure kill "
            "switch (rollback level 1 in the runbook)."
        )
        assert re.search(r"(?:<>|!=|=)\s*'true'", code) is not None, (
            "LEDGER-02 LOCK B: the activation setting is not compared by EXACT "
            "equality against the lowercase string 'true'. A truthiness test — "
            "or a cast — would open the flag on '1', on 'on', on 'TRUE' and on "
            "'true ' with a trailing space, which is four ways to activate a "
            "cross-tenant PROD fan-out by accident."
        )
        casts = sorted(
            set(re.findall(r"::\s*(bool(?:ean)?)\b", code, flags=re.IGNORECASE))
        )
        assert not casts, (
            f"LEDGER-02 LOCK B: the fan-out body casts to {casts}. The "
            "activation comparison must be exact string equality against 'true' "
            "— a boolean cast accepts '1', 'on', 'yes' and 't', so the flag "
            "would open on values nobody intended as activation."
        )


# ---------------------------------------------------------------------------
# GATE 5 — LEDGER-04 bounds (D-09, CORRECTED derivation)
# ---------------------------------------------------------------------------
_D09_DERIVATION: Final[str] = (
    "D-09 (CORRECTED — do NOT re-derive from the retracted one-hop arithmetic):\n"
    "  * ONE refreshed strategy costs up to 1500 s of worker time, NOT 900 s: "
    "derive_broker_dailies (900 s) AUTO-CHAINS to compute_analytics_from_csv "
    "(600 s) on the same sequentially-dispatching worker "
    "(job_worker.py:488-504, :526).\n"
    "  * The BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN, not this LIMIT. "
    "The cooldown plus the in-flight conjunct cap the outstanding backlog at the "
    "COHORT SIZE whatever the tick rate; the fan-out only enqueues and the "
    "worker drains asynchronously.\n"
    "  * This LIMIT is a BURST / SMOOTHING CAP only.\n"
    "  * 'n x 900 s < 3600 s => n = 4' is RETRACTED on both the cost and the "
    "model. A future editor raising this number must re-derive it, and must not "
    "re-derive it from that sentence."
)


class TestGate5Bounds:
    def test_per_tick_limit_is_bounded(self) -> None:
        code = _strip_sql_comments(function_body())
        limits: list[str] = re.findall(r"\bLIMIT\s+(\d+)", code)
        assert len(limits) == 1, (
            f"expected exactly ONE per-tick LIMIT in the fan-out body, found "
            f"{len(limits)}: {limits}. Two bounds in one query means the "
            "effective bound is whichever is smaller, and neither is the one "
            "anybody derived.\n" + _D09_DERIVATION
        )
        assert int(limits[0]) <= 4, (
            f"LEDGER-04: the per-tick LIMIT is {limits[0]}, above the derived 4. "
            "Do NOT copy the reconcile sweep's LIMIT 25 (20260819150000) — that "
            "sweep's follow-on is pure-DB, this one's is a 1500 s worker chain.\n"
            + _D09_DERIVATION
        )

    def test_per_venue_cap_is_bounded_and_partitioned(self) -> None:
        code = _strip_sql_comments(function_body())
        caps: list[str] = re.findall(r"venue_rank\s*<=\s*(\d+)", code)
        assert len(caps) == 1, (
            f"expected exactly ONE `venue_rank <= N` per-venue cap in the "
            f"fan-out body, found {len(caps)}: {caps}."
        )
        assert int(caps[0]) <= 2, (
            f"LEDGER-04: the per-venue rank cap is {caps[0]}, above the derived "
            "2. The cap exists because one ledger venue serialises every job on "
            "a SINGLE shared terminal registry "
            "(analytics-service/services/mt5_concurrency.py); without it a book "
            "weighted toward that venue spends every tick on it and starves the "
            "others.\n" + _D09_DERIVATION
        )
        assert re.search(
            r"row_number\s*\(\s*\)\s*OVER\s*\(\s*PARTITION\s+BY", code, re.IGNORECASE
        ) is not None, (
            "LEDGER-04: the per-venue cap has no `row_number() OVER (PARTITION "
            "BY …)` window behind it. Without the partition, `venue_rank` ranks "
            "the whole tick globally and the cap silently becomes a second, "
            "smaller global limit — starving exactly the venues it exists to "
            "protect."
        )

    def test_limit_is_strictly_greater_than_the_cap(self) -> None:
        """⛔ Not `>=`. At LIMIT == cap, plan 02's behavioural arm G stops
        discriminating "the per-venue cap bound this tick" from "the global
        limit bound this tick", and DELETING THE CAP leaves that arm GREEN. The
        bound would then be pinned only by a test that cannot fail."""
        code = _strip_sql_comments(function_body())
        limits: list[str] = re.findall(r"\bLIMIT\s+(\d+)", code)
        caps: list[str] = re.findall(r"venue_rank\s*<=\s*(\d+)", code)
        assert len(limits) == 1 and len(caps) == 1, (
            "cannot compare the LIMIT to the cap — one of them was not extracted "
            f"exactly once (limits={limits}, caps={caps})."
        )
        assert int(limits[0]) > int(caps[0]), (
            f"LEDGER-04: the per-tick LIMIT ({limits[0]}) must be STRICTLY "
            f"GREATER than the per-venue cap ({caps[0]}). At LIMIT == cap the "
            "behavioural gate's arm G can no longer tell the two bounds apart, "
            "so the cap's own neutering goes green and the cap becomes "
            "unfalsifiable. Lowering the LIMIT to meet a re-derived n <= cap "
            "would make this migration's anti-vacuity proof vacuous.\n"
            + _D09_DERIVATION
        )


# ---------------------------------------------------------------------------
# GATE 6 — criterion 3: the verdict keys on DATA, and admits both successes
# ---------------------------------------------------------------------------
class TestGate6StalenessVerdict:
    def test_verdict_keys_on_the_returns_series_column(self) -> None:
        code = _strip_sql_comments(is_stale_expression())
        assert "last_return_date" in code, (
            "the freshness verdict no longer references `last_return_date` — the "
            "max date inside strategy_analytics.returns_series, which is the one "
            "signal in this system that no job status transition can advance "
            "(plan 01, D-03)."
        )

    def test_verdict_rejects_every_write_timestamp(self) -> None:
        region = is_stale_expression()
        found = sorted(
            token for token in _REJECTED_FRESHNESS_TOKENS if token in region
        )
        assert not found, (
            f"the freshness verdict region references {found}. Every one of "
            "those is a WRITE timestamp and keying staleness on one is the "
            "Phase-106 janitor bug:\n"
            "  * `strategy_analytics.computed_at` (aliased "
            "`analytics_computed_at`) — `sync_strategy_analytics_status` "
            "re-stamps it to now() in EVERY arm INCLUDING the failed arm "
            "(migration 20260802120000, lines 342/398/421), and that migration "
            "names the bug itself at its lines 82 and 230.\n"
            "  * `api_keys.last_sync_at` — advanced daily by key-scoped jobs even "
            "when zero trades landed. This is the liar that hid the defect for "
            "weeks.\n"
            "  * `series_written_at` — no status transition moves it, but it "
            "still advances when a run COMPLETES having produced no new day.\n"
            "All three remain legal OUTSIDE this region, as documented "
            "informational columns; that is why plan 01 delimited the verdict "
            "with markers instead of accepting a whole-file grep."
        )

    def test_status_predicate_admits_both_success_values(self) -> None:
        code = _strip_sql_comments(is_stale_expression())
        assert "complete_with_warnings" in code, (
            "the verdict's status predicate does not admit "
            "'complete_with_warnings'. ALL FIVE live ledger rows in the PROD "
            "census are `complete_with_warnings` (plan 01, D-04), so a predicate "
            "written as status = 'complete' marks every healthy ledger strategy "
            "broken — and the reaper migration 20260802120000 carries the same "
            "warning about its own status handling."
        )


# ---------------------------------------------------------------------------
# GATE 7 — SECURITY DEFINER hygiene
# ---------------------------------------------------------------------------
class TestGate7SecurityDefinerHygiene:
    def test_declaration_pins_search_path(self) -> None:
        """⚠️ Reads the DECLARATION PRELUDE, not the dollar-quoted body.

        `SET search_path` is part of the CREATE FUNCTION declaration and sits
        OUTSIDE the `$fanout$` delimiters. A gate scoped to the body alone would
        be RED against a perfectly correct file — measured by plan 02's executor
        and recorded in its SUMMARY before this file was written."""
        prelude = _strip_sql_comments(function_declaration_prelude())
        assert re.search(r"SET\s+search_path\s*=", prelude, re.IGNORECASE) is not None, (
            "the fan-out is SECURITY DEFINER without a pinned `search_path`. An "
            "unpinned search_path on a SECDEF function lets any caller who can "
            "create objects in an earlier schema shadow the tables this body "
            "reads and writes, and it executes as the definer. The hygiene "
            "triple is: zero parameters, SET search_path, REVOKE from the "
            "browser-reachable roles."
        )
        assert re.search(r"SECURITY\s+DEFINER", prelude, re.IGNORECASE) is not None, (
            "the fan-out is no longer SECURITY DEFINER. If that is deliberate "
            "the REVOKEs and the search_path pin need revisiting together — do "
            "not change one of the three alone."
        )

    def test_execute_is_revoked_from_the_browser_reachable_roles(self) -> None:
        src = _strip_sql_comments(
            _read(_fanout_migration_path(), "_FANOUT_MIGRATION_NAME")
        )
        match = re.search(
            r"REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\."
            + re.escape(_FANOUT_FUNCTION_NAME)
            + r"\s*\(\s*\)\s*FROM\s+([^;]*);",
            src,
            re.DOTALL | re.IGNORECASE,
        )
        assert match is not None, (
            "the fan-out migration contains no `REVOKE ALL ON FUNCTION "
            f"public.{_FANOUT_FUNCTION_NAME}() FROM …` statement. The public "
            "schema in this project carries default privileges granting EXECUTE "
            "to anon and authenticated, so without the REVOKE this cross-tenant "
            "enqueue is reachable from the browser."
        )
        revoked = {name.strip().lower() for name in match.group(1).split(",")}
        for role in ("public", "anon", "authenticated"):
            assert role in revoked, (
                f"EXECUTE is not revoked from `{role}` (revoked from: "
                f"{sorted(revoked)}). pg_cron runs as superuser and needs no "
                "GRANT, so there is no caller this REVOKE can break — but a "
                "browser-reachable role that can EXECUTE it can fan out compute "
                "jobs across every tenant."
            )


# ---------------------------------------------------------------------------
# GATE 8 — the refresh marker, a cross-language contract with no compiler
# ---------------------------------------------------------------------------
class TestGate8MarkerDrift:
    def test_sql_marker_equals_python_marker(self) -> None:
        sql_markers: list[str] = re.findall(
            r"'source'\s*,\s*'([^']*)'", _strip_sql_comments(function_body())
        )
        assert len(sql_markers) == 1, (
            "expected exactly ONE `'source', '<marker>'` pair in the fan-out's "
            f"jsonb_build_object, found {len(sql_markers)}: {sql_markers}."
        )
        python_markers: list[str] = re.findall(
            r'job_source\s*==\s*"([^"]*)"', guard_region()
        )
        assert len(python_markers) == 1, (
            "expected exactly ONE `job_source == \"<marker>\"` comparison in "
            f"`_stamp_strategy_analytics_failed`, found {len(python_markers)}: "
            f"{python_markers}. The marker is spelled INLINE at both ends on "
            "purpose, so this gate has two literals to compare."
        )
        assert sql_markers[0] == python_markers[0], (
            "MARKER DRIFT (D-15): the fan-out writes "
            f"metadata->>'source' = {sql_markers[0]!r} "
            f"({_FANOUT_MIGRATION_NAME}) but the non-destructive failure guard "
            f"in services/job_worker.py compares against {python_markers[0]!r}.\n"
            "⛔ These are the two ends of a cross-language contract WITH NO "
            "COMPILER BETWEEN THEM. If they drift, the fan-out still enqueues "
            "and the guard still compiles — there is no error anywhere. THE ONLY "
            "SYMPTOM IS THAT THE NEXT FAILED REFRESH SILENTLY UN-PUBLISHES A "
            "FUNDED ACCOUNT (status flipped to 'failed', and both persisted "
            "basis-series rows deleted by the heal).\n"
            "⚠️ Note the A7 tracer used the DIFFERENT string 'ledger-refresh-"
            "tracer' deliberately; do not reconcile these two by copying that "
            "one."
        )

    def test_guard_uses_the_single_sourced_success_set(self) -> None:
        """The guard must compare against the shared frozenset, not an inline
        list of its own — a third spelling of the success set would drift from
        both the view and the constant, and gate 9 could not see it."""
        region = guard_region()
        assert "STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES" in region, (
            "`_stamp_strategy_analytics_failed` no longer references "
            "STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES. That constant is the "
            "single source gate 9 pins against the SQL view; a locally-inlined "
            "status list inside the guard would be a THIRD spelling that neither "
            "gate 9 nor the view's own predicate can see."
        )


# ---------------------------------------------------------------------------
# GATE 9 — the terminal-success status set
# ---------------------------------------------------------------------------
class TestGate9SuccessSetDrift:
    def test_view_status_set_equals_python_frozenset(self) -> None:
        from services.job_worker import STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES

        code = _strip_sql_comments(view_body())
        raw_sets: list[str] = re.findall(
            r"computation_status\s+NOT\s+IN\s*\(([^)]*)\)", code, re.IGNORECASE
        )
        assert raw_sets, (
            "found no `computation_status NOT IN (…)` predicate in the view "
            "body. The extraction is broken, or the success set moved — either "
            "way this gate is proving nothing."
        )
        parsed = [_sql_string_list(raw) for raw in raw_sets]
        assert all(candidate == parsed[0] for candidate in parsed), (
            "the view spells its status success set more than one way: "
            f"{[sorted(candidate) for candidate in parsed]}. `is_stale` and "
            "`stale_reason` must agree, or a row can read fresh while reporting "
            "a staleness reason (or the reverse)."
        )
        sql_statuses = parsed[0]
        assert len(sql_statuses) == 2, (
            f"the view's status success set has {len(sql_statuses)} member(s): "
            f"{sorted(sql_statuses)}. It is a PAIR."
        )
        assert len(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES) == 2, (
            "STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES has "
            f"{len(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES)} member(s): "
            f"{sorted(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES)}. It is a "
            "PAIR — asserting equality alone would let both ends be narrowed to "
            "{'complete'} together and still agree."
        )
        assert sql_statuses == set(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES), (
            "SUCCESS-SET DRIFT (D-04 / D-15): the view "
            f"({_STALENESS_VIEW_MIGRATION_NAME}) treats "
            f"{sorted(sql_statuses)} as terminal-success, but "
            "STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES in "
            "services/job_worker.py is "
            f"{sorted(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES)}.\n"
            "⛔ The PROD census of the live ledger cohort reads: `complete` 0, "
            "`complete_with_warnings` 5. A set narrowed to {'complete'} protects "
            "NONE of the accounts the D-15 guard exists for while still looking "
            "like a guard in review, and simultaneously marks every healthy "
            "ledger strategy stale in the view."
        )


# ---------------------------------------------------------------------------
# GATE 10 — LEDGER-01, the COMPOSITE arm (plan 04)
# ---------------------------------------------------------------------------
# The composite arm (migration 20260825140000) is a SECOND cross-tenant enqueue
# surface, on a SECOND kind, with its own schedule. Every static property gates
# 2/3/4/5/7 pin on the single-key arm has to hold for it too, and none of them
# reach it automatically: four of those five read a region extracted from the
# fan-out migration BY NAME.
#
# Gate 3a is the one exception — its glob DOES match this migration — and that
# is precisely why _KNOWN_LEDGER_REFRESH_MIGRATIONS was raised to 3 in the same
# commit as the file it counts. Gate 10a re-states the membership directly, so
# "the composite migration is inside the dormancy scan" fails loudly and for a
# distinguishable reason rather than by the floor going quiet.
_COMPOSITE_BURST_CAP_MAX: Final[int] = 2

_COMPOSITE_CAP_DERIVATION: Final[str] = (
    "THE COMPOSITE BURST CAP (plan 04). Derived as BLAST RADIUS, not as "
    "throughput:\n"
    "  * stitch_composite is CHAIN-TERMINAL "
    "(JOB_CHAIN_FOLLOW_ON['stitch_composite'] == (), job_worker.py:528), so one "
    "enqueue costs exactly ONE 1200 s handler ceiling "
    "(TIMEOUT_PER_KIND['stitch_composite'] == 20 * 60, :502) and no follow-on "
    "hop.\n"
    "  * ⛔ Do NOT re-derive this as 'n x 1200 s fits inside an hourly tick'. "
    "That assumes this arm OWNS the tick — it does not, the same sequential "
    "worker is simultaneously draining the single-key arm's 1500 s chains — and "
    "at n = 3 it lands on 3600 s, an EQUALITY with the tick, which is not a "
    "bound.\n"
    "  * ⛔ THE BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN. This integer "
    "is a BURST CAP: it bounds what ONE tick adds to a SHARED queue. Overhang "
    "past the tick is EXPECTED and is absorbed by the cooldown and the "
    "non-terminal in-flight guard. A reader who believes this integer is the "
    "safety mechanism will raise it.\n"
    "  * The measured live composite cohort is 1 (161.1-CONTEXT.md census). The "
    "cap is set strictly above that so it never binds today, and low enough that "
    "a grown cohort adds at most 2400 s to one tick. If the cohort exceeds it, "
    "RE-DERIVE against a re-measured census — do not raise it reflexively."
)


class TestGate10CompositeArm:
    """Everything gates 2-7 pin on the single-key fan-out, pinned on the
    composite arm as well."""

    def test_10a_composite_migration_is_inside_the_dormancy_scan(self) -> None:
        """Gate 3a scans by GLOB, never by filename enumeration (D-18), so it
        picks this migration up for free — but only while the migration's name
        actually matches the glob. Assert the membership rather than assume it:
        a rename to something outside `*ledger_refresh*` would silently drop
        this file out of the ONLY gate standing between a schedule and PROD."""
        paths = {path.name for path in _migrations_dir().glob(
            _LEDGER_REFRESH_MIGRATION_GLOB
        )}
        assert _COMPOSITE_MIGRATION_NAME in paths, (
            f"{_COMPOSITE_MIGRATION_NAME} is not matched by the dormancy glob "
            f"{_LEDGER_REFRESH_MIGRATION_GLOB!r} (matched: {sorted(paths)}). "
            "Gate 3a is the scan that keeps a pg_cron registration out of a "
            "migration, and migrations AUTO-APPLY to PROD on merge to main. A "
            "composite migration outside that glob could register its own "
            "schedule and reach production with no deploy step and no founder "
            "action. Rename it back into the glob, or widen the glob in the same "
            "commit."
        )

    def test_10b_composite_body_declares_no_venue_literal(self) -> None:
        """The composite arm declares NO venue of its own — not in code and not
        in prose. Its cohort comes entirely from public.ledger_refresh_staleness,
        the single SQL home of the venue set (D-05).

        ⚠️ WORD-BOUNDARY, not substring, and the difference is FORCED rather
        than chosen. This body MUST reference the staleness view's
        `has_mt5_member` column — that is the D-01/D-13 membership conjunct, and
        there is no other way to express it. Measured: a substring scan finds one
        `mt5` hit inside that identifier and would therefore be RED against a
        perfectly correct file, which is exactly the defect plan 05 caught in its
        own gate 7 before shipping it.

        The word-boundary form is still falsifiable in the direction that
        matters: a venue written as a SQL literal is `'mt5'`, and a quote is a
        non-word character, so both boundaries are present and the scan fires. An
        identifier like `has_mt5_member` has word characters on both sides of the
        token and does not. Proven by neutering — a real venue literal added to
        this body reddens this test.

        ⛔ Gate 2's substring scan over the FAN-OUT body is deliberately left
        alone. Relaxing an existing anti-vacuity pin to share code with a new one
        is how a gate quietly gets weaker.
        """
        body = composite_body()
        found = sorted(
            venue
            for venue in _banned_venue_names()
            if re.search(r"\b" + re.escape(venue) + r"\b", body)
        )
        assert not found, (
            "SINGLE SOURCE VIOLATION: the composite arm's function body names "
            f"{found}. The cohort must come entirely from "
            "public.ledger_refresh_staleness, which is the single SQL home of "
            "the venue set.\n"
            "The authority is (1) the ROADMAP fence — `_LEDGER_BACKED_SOURCES` "
            "(analytics-service/services/ingestion/long_fetch.py) is the SOLE "
            "authority for which venues are ledger-backed — and (2) the measured "
            "incident: a hand-copied mirror drifted to ONE venue while Python "
            "held THREE, and cost a funded MT5 account its publish path.\n"
            "If a venue genuinely must be distinguished here, the correct move "
            "is to add a COLUMN to the view — which is exactly what the "
            "has-member flag this body already reads is — not a literal to this "
            "body."
        )

    def test_10b2_deferred_venue_conjunct_is_present(self) -> None:
        """The D-01/D-13 membership exclusion, pinned STATICALLY as well as
        behaviourally.

        Two jobs in one assertion, and the second is why it is not redundant with
        the SQL gate's arm E:

          1. CONTEXT D-01 requires that a future composite on the deferred venue
             be a VISIBLE, NAMED skip rather than silent mishandling. The count
             of such composites is ZERO today, so the behavioural arm proves the
             conjunct works on a fixture; this proves the conjunct is still
             THERE.
          2. It is the standing justification for gate 10b's word-boundary form.
             If this column reference ever left the body, the exemption that
             form buys would be unused, and the next reader would 'simplify' the
             scan back to a substring test — which would then be RED the moment
             the conjunct came back.
        """
        code = _strip_sql_comments(composite_body())
        assert re.search(
            r"has_mt5_member\s*=\s*FALSE", code, re.IGNORECASE
        ) is not None, (
            "the composite arm's body no longer excludes composites with a "
            "member on the deferred venue by an explicit "
            "`has_mt5_member = FALSE` conjunct.\n"
            "⛔ CONTEXT D-01 records this as a CURRENT FACT, not a structural "
            "invariant: the count is zero today and the founder explicitly "
            "expects such composites may exist later. The conjunct must be "
            "present and commented so that a future one is SKIPPED DELIBERATELY "
            "— never silently dragged into a composite crawl that would "
            "serialise on that venue's single shared terminal registry.\n"
            "Do not delete it on the grounds that nothing matches it."
        )

    def test_10c_composite_function_name_appears_in_exactly_one_migration(
        self,
    ) -> None:
        """Gate 3b's twin. 3a's glob cannot see a migration whose FILENAME lacks
        the phase token, so a differently-named migration could register a
        schedule for THIS function and never enter that scan."""
        hits = sorted(
            path.name
            for path in _migrations_dir().glob("*.sql")
            if _COMPOSITE_FUNCTION_NAME in path.read_text(encoding="utf-8")
        )
        assert len(hits) == 1, (
            "expected the composite arm's function name to appear in EXACTLY 1 "
            f"migration (the one that defines it, {_COMPOSITE_MIGRATION_NAME}); "
            f"found {len(hits)}: {hits}.\n"
            "  0 hits ⇒ the search is broken (or the migration was renamed "
            "without moving _COMPOSITE_MIGRATION_NAME) — this gate is proving "
            "nothing, fix it rather than relaxing it.\n"
            "  2+ hits ⇒ a second migration either REGISTERS A SCHEDULE for the "
            "composite arm or CALLS it. Both are forbidden from a migration: "
            "migrations auto-apply to PROD, and activation belongs to "
            "docs/runbooks/ledger-refresh-go-live.md (WORKER-03)."
        )

    def test_10d_activation_is_exact_lowercase_string_equality(self) -> None:
        """Gate 4, on the composite body.

        ⚠️ The composite arm reads the SAME setting as the single-key arm, and
        that is the design: one reset kills BOTH arms on the next tick, while the
        two SCHEDULES stay independently unschedulable. Asserting the name here
        is therefore also asserting that the shared kill switch is still shared —
        a composite arm on a setting of its own would leave a founder resetting
        one flag under incident pressure while the other arm kept ticking.
        """
        code = _strip_sql_comments(composite_body())
        assert f"current_setting('{_ACTIVATION_SETTING}'" in code, (
            "the composite arm's body does not read "
            f"current_setting('{_ACTIVATION_SETTING}', …). That setting is the "
            "SHARED fail-closed switch: it is what makes merging this migration "
            "behaviour-neutral, and it is the incident-pressure kill switch for "
            "BOTH arms at once (rollback level 1 in the runbook). A composite "
            "arm reading a different setting would survive the kill switch."
        )
        assert re.search(r"(?:<>|!=|=)\s*'true'", code) is not None, (
            "LEDGER-02 LOCK B: the composite arm does not compare the activation "
            "setting by EXACT equality against the lowercase string 'true'. A "
            "truthiness test — or a cast — would open the flag on '1', on 'on', "
            "on 'TRUE' and on 'true ' with a trailing space, which is four ways "
            "to activate a cross-tenant PROD fan-out by accident."
        )
        casts = sorted(
            set(re.findall(r"::\s*(bool(?:ean)?)\b", code, flags=re.IGNORECASE))
        )
        assert not casts, (
            f"LEDGER-02 LOCK B: the composite arm's body casts to {casts}. The "
            "activation comparison must be exact string equality against 'true' "
            "— a boolean cast accepts '1', 'on', 'yes' and 't'."
        )

    def test_10e_burst_cap_is_bounded(self) -> None:
        """Gate 5's analogue, with the composite arm's OWN derivation.

        ⛔ The integer is NOT copied from the single-key arm, and neither is the
        reasoning: the two kinds have different CHAIN SHAPES, not merely
        different ceilings. This gate pins the INTEGER, not the prose around it —
        if the derivation in migration 20260825140000 ever moves, move this bound
        with it and say so in the SUMMARY.
        """
        code = _strip_sql_comments(composite_body())
        limits: list[str] = re.findall(r"\bLIMIT\s+(\d+)", code)
        assert len(limits) == 1, (
            "expected exactly ONE per-tick LIMIT in the composite arm's body, "
            f"found {len(limits)}: {limits}. Two bounds in one query means the "
            "effective bound is whichever is smaller, and neither is the one "
            "anybody derived.\n" + _COMPOSITE_CAP_DERIVATION
        )
        assert int(limits[0]) <= _COMPOSITE_BURST_CAP_MAX, (
            f"LEDGER-01: the composite per-tick burst cap is {limits[0]}, above "
            f"the derived {_COMPOSITE_BURST_CAP_MAX}.\n"
            + _COMPOSITE_CAP_DERIVATION
        )

    def test_10f_declaration_pins_search_path_and_definer(self) -> None:
        """Gate 7's first half, on the composite arm's DECLARATION PRELUDE.

        Reads the prelude and not the body for the reason plan 05 measured and
        recorded: `SET search_path` is part of the CREATE FUNCTION declaration
        and sits OUTSIDE the dollar-quote delimiters, so a body-scoped gate would
        be RED against a correct file."""
        prelude = _strip_sql_comments(composite_declaration_prelude())
        assert re.search(
            r"SET\s+search_path\s*=", prelude, re.IGNORECASE
        ) is not None, (
            "the composite arm is SECURITY DEFINER without a pinned "
            "`search_path`. An unpinned search_path on a SECDEF function lets "
            "any caller who can create objects in an earlier schema shadow the "
            "tables this body reads and writes, and it executes as the definer. "
            "The hygiene triple is: zero parameters, SET search_path, REVOKE "
            "from the browser-reachable roles."
        )
        assert re.search(
            r"SECURITY\s+DEFINER", prelude, re.IGNORECASE
        ) is not None, (
            "the composite arm is no longer SECURITY DEFINER. If that is "
            "deliberate the REVOKEs and the search_path pin need revisiting "
            "together — do not change one of the three alone."
        )

    def test_10g_execute_is_revoked_from_the_browser_reachable_roles(self) -> None:
        """Gate 7's second half, on the composite arm."""
        src = _strip_sql_comments(
            _read(_composite_migration_path(), "_COMPOSITE_MIGRATION_NAME")
        )
        match = re.search(
            r"REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\."
            + re.escape(_COMPOSITE_FUNCTION_NAME)
            + r"\s*\(\s*\)\s*FROM\s+([^;]*);",
            src,
            re.DOTALL | re.IGNORECASE,
        )
        assert match is not None, (
            "the composite migration contains no `REVOKE ALL ON FUNCTION "
            f"public.{_COMPOSITE_FUNCTION_NAME}() FROM …` statement. The public "
            "schema in this project carries default privileges granting EXECUTE "
            "to anon and authenticated, so without the REVOKE this cross-tenant "
            "enqueue is reachable from the browser."
        )
        revoked = {name.strip().lower() for name in match.group(1).split(",")}
        for role in ("public", "anon", "authenticated"):
            assert role in revoked, (
                f"EXECUTE is not revoked from `{role}` (revoked from: "
                f"{sorted(revoked)}). pg_cron runs as superuser and needs no "
                "GRANT, so there is no caller this REVOKE can break — but a "
                "browser-reachable role that can EXECUTE it can fan out compute "
                "jobs across every tenant."
            )

    def test_10h_the_two_arms_write_distinguishable_markers(self) -> None:
        """The two fan-outs must not write the SAME metadata source token.

        Two independent things break if they collide, and neither raises:

          1. the queue stops distinguishing the two mechanisms, so a founder
             reading `compute_jobs` at activation cannot tell which arm produced
             a row — and the runbook's rollback story is per-arm;
          2. the two non-destructive failure guards key on these strings, and a
             shared token would make either guard fire on the other arm's jobs.
        """
        sql_markers: list[str] = re.findall(
            r"'source'\s*,\s*'([^']*)'", _strip_sql_comments(function_body())
        )
        composite_markers: list[str] = re.findall(
            r"'source'\s*,\s*'([^']*)'", _strip_sql_comments(composite_body())
        )
        assert len(sql_markers) == 1 and len(composite_markers) == 1, (
            "expected exactly ONE `'source', '<marker>'` pair in EACH arm's "
            f"jsonb_build_object; found single-key={sql_markers} "
            f"composite={composite_markers}."
        )
        assert sql_markers[0] != composite_markers[0], (
            "the composite arm and the single-key arm write the SAME job "
            f"metadata source token ({composite_markers[0]!r}). They must "
            "differ: the token is how the two mechanisms are told apart in the "
            "queue, and it is the key each arm's non-destructive failure guard "
            "compares against before it declines to un-publish a live row."
        )


# ---------------------------------------------------------------------------
# GATE 11 — the COMPOSITE refresh marker, a second cross-language contract
# ---------------------------------------------------------------------------
class TestGate11CompositeMarkerDrift:
    """Gate 8's twin, for the composite arm's own marker.

    Plan 04 added a SECOND non-destructive guard, on the ``_stamp_failed``
    closure inside ``run_stitch_composite_job``, keyed on a SECOND metadata
    source token. That is a second cross-language contract with no compiler
    between its ends, so it needs its own drift gate — gate 8 pins the
    single-key pair and cannot see this one.
    """

    def test_composite_sql_marker_equals_composite_python_marker(self) -> None:
        sql_markers: list[str] = re.findall(
            r"'source'\s*,\s*'([^']*)'", _strip_sql_comments(composite_body())
        )
        assert len(sql_markers) == 1, (
            "expected exactly ONE `'source', '<marker>'` pair in the composite "
            f"arm's jsonb_build_object, found {len(sql_markers)}: {sql_markers}."
        )
        python_markers: list[str] = re.findall(
            r'_job_source\s*==\s*"([^"]*)"', composite_guard_region()
        )
        assert len(python_markers) == 1, (
            'expected exactly ONE `_job_source == "<marker>"` comparison in the '
            "composite handler's `_stamp_failed` closure, found "
            f"{len(python_markers)}: {python_markers}. The marker is spelled "
            "INLINE at both ends on purpose, so this gate has two literals to "
            "compare."
        )
        assert sql_markers[0] == python_markers[0], (
            "COMPOSITE MARKER DRIFT: the composite arm writes "
            f"metadata->>'source' = {sql_markers[0]!r} "
            f"({_COMPOSITE_MIGRATION_NAME}) but the non-destructive failure "
            "guard in run_stitch_composite_job compares against "
            f"{python_markers[0]!r}.\n"
            "⛔ These are the two ends of a cross-language contract WITH NO "
            "COMPILER BETWEEN THEM. If they drift, the arm still enqueues and "
            "the guard still compiles — there is no error anywhere. THE ONLY "
            "SYMPTOM IS THAT THE NEXT FAILED COMPOSITE REFRESH SILENTLY TAKES A "
            "FUNDED ACCOUNT'S FACTSHEET DARK (computation_status flipped to "
            "'failed', which src/lib/strategyGate.ts reads as "
            "ANALYTICS_FAILED).\n"
            "⚠️ The venue whose ONLY live strategy is a composite is the venue "
            "this whole arm exists for, so this contract has a cohort of one and "
            "no redundancy."
        )

    def test_composite_guard_uses_the_single_sourced_success_set(self) -> None:
        """The composite guard must compare against the shared frozenset, not an
        inline status list of its own — a third spelling of the success set
        would drift from both the view and the constant, and gate 9 could not
        see it."""
        region = composite_guard_region()
        assert "STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES" in region, (
            "the composite handler's `_stamp_failed` no longer references "
            "STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES. That constant is the "
            "single source gate 9 pins against the SQL view; a locally-inlined "
            "status list inside this guard would be a spelling that neither gate "
            "9 nor the view's own predicate can see.\n"
            "⛔ The PROD census reads `complete` 0 / `complete_with_warnings` 5, "
            "so a guard narrowed to {'complete'} would protect NONE of the live "
            "ledger accounts while still looking like a guard in review."
        )
