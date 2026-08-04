"""142.2 code-review FIX 4 — the migration's prose must agree with the PRODUCER
registry it claims to describe.

WHY THIS TEST EXISTS
--------------------
``supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql``
carries a THIRD hand-maintained description of the five ``series_completeness``
verdicts. The other two are the producer registry
(``analytics-service/services/broker_dailies.py``) and the TypeScript
admissibility subset (``src/lib/strategyGate.ts``) — and the migration's
descriptions of TWO of the five contradicted the registry when it was written:

  1. ``sampled_gapped`` was described as "e.g. a perp whose fills are missing,
     whose dailies therefore carry funding only". That is the
     ``fill_derived_unproven`` case. ``sampled_gapped`` is stamped by ONE
     producer — ``combine_sfox_balance_history`` when ``nav_gap_days > 0`` — and
     means a SAMPLED NAV series with interior holes. The mis-attribution also
     dragged the D-15 safety sentence ("the verdict the gate must keep
     REFUSING") onto the wrong verdict.
  2. ``fill_derived_unproven`` was described as "derived from fills with no
     independent balance or equity anchor proving the series closes" — which
     reads as a CONDITIONAL finding about one account. The producer stamps it
     ALWAYS and UNCONDITIONALLY for every ccxt venue; it is the normal case for
     that path, not evidence of a particular gap. That distinction is
     load-bearing: a reader who believed the conditional version would
     "obviously" propagate the verdict into composites and thereby refuse
     essentially every ccxt composite.

⚠️ ``COMMENT ON`` IS FORWARD-ONLY. Once this migration merges, correcting its
column comment costs a whole new migration. This test is the cheap gate that
keeps the prose honest while it is still free to edit.

WHAT THE ORACLE IS, AND WHAT IT IS NOT
--------------------------------------
The oracle is the PRODUCER's own source: which function assigns which verdict,
and under what condition. Those facts are re-derived from ``broker_dailies.py``
below rather than assumed, so this test cannot pass by agreeing with a stale
copy of itself.

The five verdict names are HAND-TYPED here and deliberately NOT imported from
``SERIES_COMPLETENESS_VALUES``. Importing them would make this test follow the
registry silently the day someone widens it — the assertion would track the code
instead of pinning it. Same Oracle-Independence rule the rest of this phase's
guards are written under.
"""

from __future__ import annotations

import pathlib
import re

_REPO = pathlib.Path(__file__).resolve().parents[2]

_MIGRATION_PATH = (
    _REPO
    / "supabase"
    / "migrations"
    / "20260803150000_strategy_analytics_series_completeness.sql"
)

_BROKER_DAILIES_PATH = (
    _REPO / "analytics-service" / "services" / "broker_dailies.py"
)

# HAND-TYPED. The five verdicts, never imported (see the docstring).
_VERDICTS = (
    "ledger_complete",
    "sampled_gapped",
    "fill_derived_unproven",
    "user_supplied",
    "composite_stitched",
)

# HAND-TYPED. The producer function whose source must be quoted by the
# migration's description of the two verdicts this fix corrected. Both names are
# additionally re-verified against broker_dailies.py below, so a rename that
# leaves this test alone reds here rather than passing on a fiction.
_SFOX_PRODUCER = "combine_sfox_balance_history"
_CCXT_PRODUCER = "combine_realized_and_funding"

# The two false sentences, verbatim from the pre-fix migration. Kept as explicit
# needles so the regression is named rather than merely implied: if either
# reappears, the failure message says which claim came back.
_FALSE_SAMPLED_GAPPED_CLAIM = "a perp whose fills are missing"
_FALSE_UNPROVEN_CLAIM = "no independent balance or"


def _migration_sql() -> str:
    return _MIGRATION_PATH.read_text(encoding="utf-8")


def _header_block(sql: str) -> str:
    """The leading ``--`` comment header, up to the first non-comment statement.

    Bounded so the assertions below are about the PROSE and cannot be satisfied
    by an incidental match inside the DDL or the DO $$ self-verify block.
    """
    lines: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") or not stripped:
            lines.append(line)
            continue
        break
    return "\n".join(lines)


def _column_comment(sql: str) -> str:
    """The production ``COMMENT ON COLUMN`` payload, concatenated.

    The statement is written as adjacent single-quoted literals across many
    lines; Postgres concatenates them, and so must we, or a needle that straddles
    a line break would be missed.

    ⚠️ The terminator is ``'`` + ``;``, NOT a bare ``;``. The comment PROSE
    contains semicolons (it describes a producer condition, ``nav_gap_days > 0;``),
    and a bare-``;`` terminator silently truncated the extraction mid-sentence —
    which made every needle assertion below pass or fail for the wrong reason.
    The parsed-length floor in the anti-vacuity test is what caught it.
    """
    match = re.search(
        r"COMMENT ON COLUMN public\.strategy_analytics\.series_completeness IS(.*?')\s*;",
        sql,
        re.DOTALL,
    )
    assert match is not None, (
        "Could not locate the COMMENT ON COLUMN statement for "
        "strategy_analytics.series_completeness. Either it was removed (the "
        "column would then ship undocumented into production) or its shape "
        "changed — re-point this guard deliberately, do NOT delete it."
    )
    parts = re.findall(r"'((?:[^']|'')*)'", match.group(1))
    return "".join(parts).replace("''", "'")


# ---------------------------------------------------------------------------
# Anti-vacuity. Every assertion below is about substrings of a file read from
# disk, and every one of them is green over an empty string.
# ---------------------------------------------------------------------------


def test_the_migration_and_the_registry_were_actually_read() -> None:
    sql = _migration_sql()
    header = _header_block(sql)
    comment = _column_comment(sql)
    registry = _BROKER_DAILIES_PATH.read_text(encoding="utf-8")

    # Floors far below the real sizes and far above anything a broken read can
    # produce. A missing/renamed file must red HERE, by name, rather than
    # silently satisfying every substring assertion in this module.
    assert len(sql) > 3000, f"migration read back only {len(sql)} chars"
    assert len(header) > 1500, f"header block parsed to only {len(header)} chars"
    assert len(comment) > 500, f"column comment parsed to only {len(comment)} chars"
    assert len(registry) > 10000, f"broker_dailies read back only {len(registry)} chars"


def test_the_producer_attributions_this_test_asserts_are_true_of_the_registry() -> None:
    """The ORACLE's own half: re-derive from broker_dailies.py that the two
    producer functions exist and stamp the verdicts this test claims they do.

    Without this, the migration assertions below would pin the SQL against
    hand-typed strings that might themselves be wrong — the exact defect the fix
    is about, reintroduced one layer up.
    """
    registry = _BROKER_DAILIES_PATH.read_text(encoding="utf-8")

    assert f"def {_SFOX_PRODUCER}(" in registry, (
        f"{_SFOX_PRODUCER} is not defined in broker_dailies.py. The migration "
        "prose attributes sampled_gapped to it; if the producer was renamed, "
        "the SQL comment is now wrong too (and COMMENT ON is forward-only)."
    )
    assert f"def {_CCXT_PRODUCER}(" in registry, (
        f"{_CCXT_PRODUCER} is not defined in broker_dailies.py. The migration "
        "prose attributes fill_derived_unproven to it."
    )

    # sampled_gapped is emitted at exactly one site, gated on the NAV gap count.
    assert '"sampled_gapped"' in registry
    assert "nav_gap_days" in registry

    # fill_derived_unproven is a bare constant assignment — no condition on the
    # line that stamps it. This is what makes "ALWAYS and unconditionally" true,
    # and it is the claim the corrected prose now makes.
    assert re.search(
        r'out_meta\["series_completeness"\]\s*=\s*"fill_derived_unproven"',
        registry,
    ), (
        "fill_derived_unproven is no longer stamped as an unconditional "
        "constant. The migration prose says it is stamped ALWAYS and "
        "unconditionally; if that changed, the prose must change with it."
    )


# ---------------------------------------------------------------------------
# The corrections themselves.
# ---------------------------------------------------------------------------


def test_every_verdict_is_still_named_in_both_descriptions() -> None:
    """Neither correction may drop a verdict from the enumerations."""
    header = _header_block(_migration_sql())
    comment = _column_comment(_migration_sql())

    for verdict in _VERDICTS:
        assert verdict in header, f"{verdict} vanished from the migration header"
        assert verdict in comment, f"{verdict} vanished from the column comment"


def test_sampled_gapped_is_not_described_as_the_gapped_perp_case() -> None:
    """CORRECTION 1 — fails without the fix.

    Pre-fix the header read: "sampled_gapped -- the inputs were sampled and are
    known to have holes (e.g. a perp whose fills are missing, whose dailies
    therefore carry funding only)". The parenthetical describes
    fill_derived_unproven.
    """
    sql = _migration_sql()
    header = _header_block(sql)
    comment = _column_comment(sql)

    assert _FALSE_SAMPLED_GAPPED_CLAIM not in header, (
        "The migration header again attributes the gapped-PERP case to "
        f"sampled_gapped ({_FALSE_SAMPLED_GAPPED_CLAIM!r}). A perp whose "
        "realized-PnL fetch left a hole is stamped fill_derived_unproven by "
        f"{_CCXT_PRODUCER}. sampled_gapped is stamped ONLY by "
        f"{_SFOX_PRODUCER}, for a SAMPLED NAV series with interior holes."
    )

    # The positive half: the description must now attribute the verdict to the
    # producer that actually stamps it. An absence assertion alone would be
    # satisfied by deleting the description entirely.
    assert _SFOX_PRODUCER in header, (
        "The migration header no longer attributes sampled_gapped to "
        f"{_SFOX_PRODUCER}. Deleting the description is not a correction — the "
        "next reader re-invents the wrong one."
    )
    assert _SFOX_PRODUCER in comment, (
        f"The production column comment no longer names {_SFOX_PRODUCER} as "
        "sampled_gapped's sole producer."
    )


def test_fill_derived_unproven_is_described_as_unconditional() -> None:
    """CORRECTION 2 — fails without the fix.

    Pre-fix the header read: "fill_derived_unproven -- derived from fills with
    no independent balance or equity anchor proving the series closes", which
    reads as a per-account finding. The producer stamps it for EVERY ccxt series,
    always. Believing the conditional version is what makes "just propagate
    member verdicts into the composite" look safe when it would in fact refuse
    essentially every ccxt composite.
    """
    sql = _migration_sql()
    header = _header_block(sql)
    comment = _column_comment(sql)

    assert _FALSE_UNPROVEN_CLAIM not in header, (
        "The migration header again describes fill_derived_unproven as a "
        f"conditional anchor check ({_FALSE_UNPROVEN_CLAIM!r}). It is stamped "
        "ALWAYS and unconditionally by "
        f"{_CCXT_PRODUCER}; it is the normal case for every ccxt venue, not "
        "evidence that a particular account's series has a gap."
    )

    assert _CCXT_PRODUCER in header, (
        "The migration header no longer attributes fill_derived_unproven to "
        f"{_CCXT_PRODUCER}."
    )
    for needle in ("ALWAYS", "UNCONDITIONALLY"):
        assert needle in header, (
            f"The migration header no longer states that fill_derived_unproven "
            f"is stamped {needle}. That word is the whole correction."
        )
    assert "ALWAYS and unconditionally" in comment, (
        "The production column comment no longer states that "
        "fill_derived_unproven is stamped always and unconditionally."
    )


def test_the_migration_shape_is_untouched_by_this_comment_only_fix() -> None:
    """FIX 4 is COMMENT TEXT ONLY. Additive, nullable, no default, no CHECK, no
    RLS change, no backfill, no DELETE, no cron. Pinned here because a prose
    edit is exactly the kind of change nobody re-reads the DDL under.
    """
    sql = _migration_sql()

    assert "ADD COLUMN IF NOT EXISTS series_completeness text" in sql
    assert "SET LOCAL lock_timeout" in sql

    # The column-shape words (DEFAULT / NOT NULL / CHECK) are scanned ONLY
    # inside the ALTER TABLE statement. A file-wide scan false-positives on the
    # DO $$ self-verify block, whose PL/pgSQL locals are literally named
    # `v_default` and which reads `information_schema.columns.column_default` —
    # i.e. the very code that PROVES there is no default would have been read as
    # evidence of one.
    alter = re.search(
        r"ALTER TABLE public\.strategy_analytics(.*?);", sql, re.DOTALL
    )
    assert alter is not None, "the ALTER TABLE statement is gone"
    alter_sql = alter.group(1).lower()
    for banned in ("default", "not null", "check", "unique", "references"):
        assert banned not in alter_sql, (
            f"the ALTER TABLE grew a {banned!r} clause. The locked shape is "
            "additive/nullable/no-default/no-CHECK, and FIX 4 was a "
            "comment-text-only correction."
        )

    # Statement-level bans, scanned over non-comment lines only: the header
    # legitimately DISCUSSES the CHECK constraint it deliberately omits, and a
    # raw scan would match that discussion.
    code_only = "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    ).lower()
    for banned in (
        "delete from",
        "update public.strategy_analytics set",
        "cron.schedule",
        "enable row level security",
        "create policy",
        "add constraint",
    ):
        assert banned not in code_only, (
            f"migration 20260803150000 grew a {banned!r} statement. It is "
            "additive-only: no backfill, no DELETE, no cron, no RLS change."
        )
