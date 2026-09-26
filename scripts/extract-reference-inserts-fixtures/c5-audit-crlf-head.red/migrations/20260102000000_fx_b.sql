-- RED: a CRLF between UPDATE and its target (review WR-02 item 3). The old [\t\n ] separator never matched \r, so this vanished from C5.
UPDATE
fx_ref SET label = 'v' WHERE id = 1;
