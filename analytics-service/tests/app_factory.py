"""The only sanctioned ``FastAPI(`` construction in the test suite (Phase 215 SC-3).

``build_test_app`` returns an app carrying the SAME three app-global exception
handlers production ``main.py`` installs (422, 429, venue-transient 424), through
the one production function ``services.app_error_handlers.install_app_exception_handlers``,
so a router test asserts against the body production actually sends and the two
cannot drift.

⛔ This module must NOT import ``main``: an early ``import main`` changes router
module identity for the whole pytest process (``test_process_key_route_registers_both_limits``
then sees 4 limit groups instead of 2). Only ``tests/test_app_factory_parity.py``
imports it, inside a test function.

It deliberately does not set ``app.state.limiter``; a site that needs it keeps its
own line.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from fastapi import APIRouter, FastAPI

from services.app_error_handlers import install_app_exception_handlers


def build_test_app(
    *routers: APIRouter, middleware: Iterable[type[Any]] = ()
) -> FastAPI:
    """A new ``FastAPI`` with production's app-global handlers, ``middleware`` then ``routers``."""
    app = FastAPI()
    install_app_exception_handlers(app)
    for middleware_class in middleware:
        app.add_middleware(middleware_class)
    for router in routers:
        app.include_router(router)
    return app
