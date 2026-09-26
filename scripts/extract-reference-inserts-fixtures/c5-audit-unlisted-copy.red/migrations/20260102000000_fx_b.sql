-- RED: COPY ... FROM writes rows into a table the replay fills (review SFH-02).
COPY fx_ref (id, label) FROM '/dev/null';
