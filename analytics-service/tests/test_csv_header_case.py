def test_uppercase_headers_normalized():
    """Regression: real-world CSVs ship 'Date,Daily_Return' (capitalized).
    Pre-2026-05-07 these failed pandera with column_in_dataframe; the
    founder UAT (IQSF QuantumAlpha) blocked because of it."""
    import io
    import pandas as pd
    from services.csv_validator import validate_csv

    df = pd.DataFrame({
        "Date": pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04",
                                 "2024-01-05", "2024-01-08"]),
        "Daily_Return": [0.001, -0.002, 0.0015, 0.0008, -0.0005],
    })
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    result = validate_csv(buf.getvalue(), "daily_returns")
    assert result["ok"] is True, f"errors: {result['errors']}"
