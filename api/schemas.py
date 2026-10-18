"""Pydantic mirrors of shared/types.ts. Change both together."""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

AttrValue = Union[bool, int, float, str]
TrustTier = Literal["trusted", "mixed", "caution", "insufficient"]
SignalKey = Literal["velocity", "duplicates", "distribution", "verified", "consistency"]
Provenance = Literal["said", "gesture", "edited"]


class Product(BaseModel):
    id: str
    title: str
    brand: str
    price: float
    image: str
    subcategory: str
    attributes: dict[str, AttrValue]
    rating_listed: float
    review_count: int
    summary: str
    merchant_id: str


class FitTerms(BaseModel):
    semantic: float
    attribute_match: float
    trust: float
    feedback: float


class RankedProduct(Product):
    fit_percent: int
    reasons: list[str]
    fit_terms: FitTerms


class TrustSignal(BaseModel):
    key: SignalKey
    value: float
    subscore: float
    detail: str


class SecurityFlag(BaseModel):
    review_id: str
    kind: Literal["prompt_injection"] = "prompt_injection"
    excerpt: str


class TrustReport(BaseModel):
    product_id: str
    score: int | None
    tier: TrustTier
    rating_listed: float
    rating_adjusted: float
    signals: list[TrustSignal]
    top_reasons: list[str]
    evidence_review_ids: list[str]
    security_flags: list[SecurityFlag] = []
    seeded_for_demo: bool = False


class Merchant(BaseModel):
    id: str
    name: str
    verified: bool


class Dismissal(BaseModel):
    id: str
    reason: str | None = None


class PreferenceProfile(BaseModel):
    needs: list[str] = []
    avoid: list[str] = []
    budget_max: float | None = None
    skin_type: str | None = None
    liked_ids: list[str] = []
    dismissed: list[Dismissal] = []
    provenance: dict[str, Provenance] = {}


class CartItem(BaseModel):
    product_id: str
    title: str
    merchant_id: str
    unit_price: float
    quantity: int


class Cart(BaseModel):
    items: list[CartItem]
    total: float
    currency: Literal["usd"] = "usd"
    cart_hash: str


class PolicyCheck(BaseModel):
    rule: str
    passed: bool
    reason: str


class PolicyResult(BaseModel):
    allowed: bool
    checks: list[PolicyCheck]


class Tradeoff(BaseModel):
    dimension: str
    a: str
    b: str
    better: Literal["a", "b"] | None = None


# --- UIAction (discriminated on "action") ---------------------------------


class _Action(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShowResults(_Action):
    action: Literal["show_results"] = "show_results"
    product_ids: list[str]
    reason: str


class Rerank(_Action):
    action: Literal["rerank"] = "rerank"
    product_ids: list[str]
    changed_because: str


class OpenDetail(_Action):
    action: Literal["open_detail"] = "open_detail"
    product_id: str


class OpenCompare(_Action):
    action: Literal["open_compare"] = "open_compare"
    product_ids: tuple[str, str]
    tradeoffs: list[Tradeoff]


class HighlightTrust(_Action):
    action: Literal["highlight_trust"] = "highlight_trust"
    product_id: str


class UpdateProfile(_Action):
    action: Literal["update_profile"] = "update_profile"
    profile: PreferenceProfile


class StageCheckout(_Action):
    action: Literal["stage_checkout"] = "stage_checkout"
    product_id: str
    cart: Cart
    cart_payload: str
    policy: PolicyResult


class PolicyRefusal(_Action):
    action: Literal["policy_refusal"] = "policy_refusal"
    policy: PolicyResult


class Say(_Action):
    action: Literal["say"] = "say"
    text: str


UIAction = Annotated[
    Union[
        ShowResults,
        Rerank,
        OpenDetail,
        OpenCompare,
        HighlightTrust,
        UpdateProfile,
        StageCheckout,
        PolicyRefusal,
        Say,
    ],
    Field(discriminator="action"),
]


# --- Requests -------------------------------------------------------------


class UIContext(BaseModel):
    visible_ids: list[str] = []
    focused_id: str | None = None


class ChatRequest(BaseModel):
    session_id: str
    text: str = Field(max_length=2000)
    ui_context: UIContext = UIContext()


class FeedbackRequest(BaseModel):
    session_id: str
    product_id: str
    signal: Literal["dismiss", "like"]
    reason: str | None = Field(default=None, max_length=200)


class CompareRequest(BaseModel):
    session_id: str
    ids: tuple[str, str]


class IntentMandateRequest(BaseModel):
    session_id: str
    public_key_jwk: dict[str, str]
    payload: str = Field(max_length=4000)
    signature: str = Field(max_length=200)


class IntentMandate(BaseModel):
    """Parsed fields of a signed intent mandate payload."""

    session_id: str
    budget_max: float = Field(gt=0, le=10_000)
    categories: list[str]
    verified_only: bool = True
    max_quantity: int = Field(default=2, ge=1, le=10)
    autonomy: Literal["stage"] = "stage"
    issued_at: str
    nonce: str | None = None


class StageRequest(BaseModel):
    session_id: str
    product_id: str
    quantity: int = Field(default=1, ge=1, le=100)


class CheckoutIntentRequest(BaseModel):
    session_id: str
    cart_hash: str
    signature: str | None = Field(default=None, max_length=200)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
