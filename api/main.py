"""Conjure API. Run from the repo root:  uvicorn api.main:app --reload"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from api import checkout, search
from api import store as store_mod
from api import voice
from api.agent import orchestrator, tools
from api.config import DATA_DIR, get_settings
from api.guard import audit, mandates
from api.schemas import (
    ChatRequest, CheckoutIntentRequest, CompareRequest, FeedbackRequest, IntentMandateRequest,
    PreferenceProfile, Product, RankedProduct, StageRequest, TrustReport,
)
from api.sessions import sessions
from api.store import store

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("conjure")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    store_mod.init()
    ranker = search.init(store)
    log.info("Loaded %d products; search backend: %s", len(store.products), ranker.backend)
    yield


app = FastAPI(title="Conjure API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
(DATA_DIR / "images").mkdir(parents=True, exist_ok=True)
app.mount("/static/products", StaticFiles(directory=DATA_DIR / "images"), name="product-images")
app.include_router(voice.router)


@app.exception_handler(checkout.CheckoutError)
async def _checkout_error(_: Request, exc: checkout.CheckoutError) -> JSONResponse:
    return JSONResponse({"error": exc.message}, status_code=exc.status)


@app.exception_handler(mandates.MandateError)
async def _mandate_error(_: Request, exc: mandates.MandateError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=401)


@app.exception_handler(ValueError)
async def _value_error(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=400)


# --- sessions & chat ------------------------------------------------------


@app.post("/session")
def create_session() -> dict[str, Any]:
    s = sessions.create()
    audit.append(s.audit, "session_created", {})
    return {"session_id": s.id, "ttl_seconds": get_settings().session_ttl_s}


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    session = sessions.get(req.session_id)
    return StreamingResponse(
        orchestrator.run_turn(session, req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/feedback")
def feedback(req: FeedbackRequest) -> dict[str, Any]:
    session = sessions.get(req.session_id)
    out = tools.apply_feedback(session, req.product_id, req.signal, req.reason, provenance="gesture")
    audit.append(session.audit, "feedback", {"product_id": req.product_id, "signal": req.signal})
    return {"actions": [orchestrator.validate_action(a) for a in out.actions]}


@app.post("/compare")
def compare(req: CompareRequest) -> dict[str, Any]:
    session = sessions.get(req.session_id)
    out = tools.compare(session, tools.CompareArgs(product_a=req.ids[0], product_b=req.ids[1]))
    return orchestrator.validate_action(out.actions[0])


# --- profile --------------------------------------------------------------


@app.get("/profile/{session_id}")
def get_profile(session_id: str) -> PreferenceProfile:
    return sessions.get(session_id).profile


@app.put("/profile/{session_id}")
def put_profile(session_id: str, profile: PreferenceProfile) -> PreferenceProfile:
    session = sessions.get(session_id)
    old = session.profile
    prov = dict(old.provenance)
    for n in profile.needs:
        if n not in old.needs:
            prov[f"needs:{n}"] = "edited"
    for a in profile.avoid:
        if a not in old.avoid:
            prov[f"avoid:{a}"] = "edited"
    for key in ("budget_max", "skin_type"):
        if getattr(profile, key) != getattr(old, key):
            prov[key] = "edited"
    keep = {f"needs:{n}" for n in profile.needs} | {f"avoid:{a}" for a in profile.avoid}
    prov = {k: v for k, v in prov.items() if not k.startswith(("needs:", "avoid:")) or k in keep}
    session.profile = profile.model_copy(update={"provenance": prov})
    audit.append(session.audit, "profile_edited", {"profile": session.profile.model_dump()})
    return session.profile


@app.delete("/profile/{session_id}")
def wipe_profile(session_id: str) -> dict[str, Any]:
    session = sessions.get(session_id)
    deleted = {
        "profile": session.profile.model_dump(),
        "intent_mandate": session.intent_mandate is not None,
        "public_key": session.public_key_jwk is not None,
        "staged_carts": len(session.staged),
    }
    session.profile = PreferenceProfile()
    session.intent_mandate = session.public_key_jwk = session.mandate_id = None
    session.staged.clear()
    session.last_results, session.last_query, session.focused_id = [], "", None
    audit.append(session.audit, "wiped", {"deleted": {k: v for k, v in deleted.items() if k != "profile"}})
    return {"wiped": True, "deleted": deleted}


# --- catalog --------------------------------------------------------------


@app.get("/products/search")
def products_search(
    q: str = Query(default="", max_length=300),
    max_price: float | None = Query(default=None, ge=0),
    limit: int = Query(default=6, ge=1, le=50),
    session_id: str | None = None,
) -> list[RankedProduct]:
    session = sessions.get(session_id) if session_id else None
    return tools.run_search(session, tools.SearchArgs(query=q, max_price=max_price), limit=limit)


@app.get("/products/{product_id}")
def get_product(product_id: str) -> Product:
    p = store.product(product_id)
    if p is None:
        raise HTTPException(404, "Unknown product")
    return p


@app.get("/trust/{product_id}")
def get_trust(product_id: str) -> TrustReport:
    r = store.trust_report(product_id)
    if r is None:
        raise HTTPException(404, "Unknown product")
    return r


# --- mandates & checkout --------------------------------------------------


@app.post("/mandate/intent")
def register_intent(req: IntentMandateRequest) -> dict[str, Any]:
    session = sessions.get(req.session_id)
    mandate = mandates.parse_intent(req.public_key_jwk, req.payload, req.signature, session.id)
    session.public_key_jwk = req.public_key_jwk
    session.intent_mandate = mandate
    session.mandate_id = mandates.mandate_id(req.payload)
    audit.append(session.audit, "intent_mandate", {
        "mandate_id": session.mandate_id, "mandate": mandate.model_dump(), "signature": req.signature,
    })
    return {"mandate_id": session.mandate_id, "mandate": mandate.model_dump()}


@app.post("/checkout/stage")
def checkout_stage(req: StageRequest) -> dict[str, Any]:
    session = sessions.get(req.session_id)
    tools.require_product(req.product_id)
    return orchestrator.validate_action(checkout.stage(session, req.product_id, req.quantity))


@app.post("/checkout/intent")
def checkout_intent(req: CheckoutIntentRequest) -> dict[str, Any]:
    session = sessions.get(req.session_id)
    return checkout.authorize(session, req.cart_hash, req.signature).as_dict()


@app.get("/audit/{session_id}")
def get_audit(session_id: str) -> dict[str, Any]:
    session = sessions.get(session_id)
    return {"session_id": session.id, "entries": session.audit, "valid": audit.verify(session.audit)}


# --- health ---------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
    s = get_settings()

    def status(live: bool) -> str:
        return "live" if live else "mocked"

    return {
        "ok": True,
        "products": len(store.products),
        "sessions": sessions.count(),
        "search_backend": search.ranker().backend,
        "integrations": {
            "llm": "mocked (fallback agent only)",
            "elevenlabs": status(False),
            "stripe": status(False),
        },
        "agent_source": "fallback",
        "demo_server_signing": s.demo_server_signing,
    }
