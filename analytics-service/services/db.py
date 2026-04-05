import os
import asyncio
from functools import lru_cache
from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Module-level Supabase client singleton. Reuses connection pool."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


async def db_execute(fn):
    """Run a synchronous Supabase call without blocking the async event loop."""
    return await asyncio.to_thread(fn)
