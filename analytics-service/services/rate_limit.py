"""Shared slowapi Limiter for analytics-service.

Phase 19 / API-5 fix — there used to be two Limiter() instances in the
process: one in `main.py` (registered as ``app.state.limiter`` and the
target of slowapi's ``RateLimitExceeded`` handler) and another in
``routers/process_key.py`` (the one the ``@limiter.limit(...)`` decorator
on ``process_key()`` referenced). slowapi resolves rate-limit storage via
the *decorator's* Limiter instance — so the metrics, in-memory counts
and (eventually) Redis-backed storage on ``app.state.limiter`` were
never shared with the route's actual limit. This module owns the single
canonical Limiter so any router that needs rate-limiting imports from
here and ``main.py`` registers the same instance on ``app.state``.

Per-route limiters MAY override the key function (e.g. process_key
keys on the bearer token + user_id rather than remote IP) by calling
``Limiter.limit(..., key_func=...)`` at decoration time without losing
the shared storage.
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# Single canonical Limiter for the whole process. Imported by main.py for
# ``app.state.limiter = limiter`` AND by every router that uses
# ``@limiter.limit(...)``. The default key_func is remote-address; routes
# that need a different key (e.g. token + user_id) override on the
# decorator.
limiter: Limiter = Limiter(key_func=get_remote_address)
