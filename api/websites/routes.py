from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.routing import APIRoute
from pydantic import Field

from api.websites.models import Model, ReputationResult, WebsiteAssessment, WebsiteRequest
from api.websites.service import WebsiteSafetyService, safety_service


class PrivateErrorsRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_errors(request):
            try:
                return await handler(request)
            except RequestValidationError:
                # Default validation errors echo inputs, which may contain tokens.
                return JSONResponse({"detail": "Invalid bounded website-safety request; input values were withheld."}, status_code=422)
        return private_errors


router = APIRouter(prefix="/websites", tags=["website safety"], route_class=PrivateErrorsRoute)


class CheckoutRequest(Model):
    merchant_id: str = Field(min_length=1, max_length=100)


@router.post("/assess", response_model=WebsiteAssessment)
async def assess(req: WebsiteRequest):
    return await safety_service().assess(req.url, req.merchant_id, req.purpose)


@router.post("/checkout-check", response_model=WebsiteAssessment)
async def checkout_check(req: CheckoutRequest):
    # The browser never supplies the payment destination.
    return await safety_service().assess_checkout(req.merchant_id)


@router.get("/config")
def configuration():
    return safety_service().configuration()


@router.post("/demo")
async def demo():
    class SyntheticReputation:
        def configuration(self):
            return [{"provider": "synthetic_demo", "configured": True}]

        async def check(self, url):
            now = datetime.now(timezone.utc)
            status = "known_malicious" if "reported-phish" in url else "unknown" if "unavailable" in url else "no_known_threat"
            return [ReputationResult(provider="synthetic_demo", status=status, checked_at=now,
                expires_at=now + timedelta(minutes=5), detail="Synthetic provider response; no real lookup was performed.")]

    async def synthetic_dns(_):
        return ["93.184.216.34"]

    service = WebsiteSafetyService({"shop": {"origins": ["https://merchant.example.com", "https://unavailable.example.com"],
        "checkout_url": "https://merchant.example.com/checkout"}}, reputation=SyntheticReputation(), resolver=synthetic_dns)
    cases = [
        ("Approved origin, completed simulated lookup", "https://merchant.example.com/product", "shop"),
        ("Brand name inside an unrelated domain", "https://merchant.example.com.attacker.example.org/product", "shop"),
        ("Lookalike spelling requires review", "https://merchan7.example.com/product", None),
        ("Known phishing report", "https://reported-phish.example.com/", None),
        ("Reputation provider unavailable", "https://unavailable.example.com/", "shop"),
        ("Embedded username deception", "https://merchant.example.com@attacker.example.org/", "shop"),
    ]
    results = [{"name": name, "assessment": (await service.assess(url, merchant, "link")).model_dump(mode="json")} for name, url, merchant in cases]
    return {"provenance": "synthetic_demo", "is_mock": True,
            "note": "All threat/DNS results are synthetic. No website was visited, and these results cannot authorize real fetching or checkout.", "cases": results}


@router.get("/workbench", include_in_schema=False)
def workbench():
    return FileResponse(Path(__file__).with_name("workbench.html"), media_type="text/html", headers={"Cache-Control": "no-store"})
