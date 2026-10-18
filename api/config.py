"""Settings, read from api/.env. Every value has a safe default so an empty .env works."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent
DATA_DIR = API_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_DIR / ".env", extra="ignore")

    # LLM (any OpenAI-compatible Chat Completions endpoint)
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = Field(default="", repr=False)
    llm_model: str = "gpt-4o-mini"
    # Gemini can spend time reasoning before replying. Bound both each call and the full turn.
    llm_timeout_s: float = Field(default=60.0, gt=0, le=180)
    llm_turn_budget_s: float = Field(default=120.0, gt=0, le=300)
    llm_reasoning_effort: str = ""
    llm_max_tokens: int = Field(default=2048, ge=128, le=8192)

    # ElevenLabs
    elevenlabs_api_key: str = Field(default="", repr=False)
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model_id: str = "eleven_flash_v2_5"
    elevenlabs_timeout_s: float = Field(default=8.0, gt=0, le=30)

    # Stripe (test mode only)
    stripe_secret_key: str = Field(default="", repr=False)

    # Dev escape hatch: server signs carts for the client. Never in a real deployment.
    demo_server_signing: bool = False

    public_base_url: str = "http://localhost:8000"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173", "http://localhost:3001"]
    session_ttl_s: int = 3600
    session_spend_cap: float = 150.0

    # Marketplace fetch (Selenium). Off by default so the API still runs without Chrome.
    selenium_enabled: bool = False
    selenium_headless: bool = True
    scrape_delay_s: float = 1.2
    scrape_timeout_s: float = 25.0
    scrape_limit: int = 50

    # Review sources are explicitly configured public stores, not approved merchants.
    # JSON map of short merchant IDs to HTTPS origins; no credentials are needed.
    review_woocommerce_stores: dict[str, str] = Field(default_factory=dict)
    review_source_timeout_s: float = Field(default=10.0, gt=0, le=20)
    review_source_cache_ttl_s: int = Field(default=300, ge=0, le=3600)
    review_llm_timeout_s: float = Field(default=25.0, gt=0, le=30)
    review_llm_max_reviews: int = Field(default=12, ge=1, le=30)
    review_llm_requests_per_minute: int = Field(default=6, ge=1, le=30)
    review_llm_requests_per_day: int = Field(default=100, ge=1, le=1000)

    # Server-maintained domain identity and separate opt-in threat APIs.
    website_merchants: dict[str, dict] = Field(default_factory=dict)
    website_blocked_hosts: list[str] = Field(default_factory=list)
    website_webrisk_api_key: str = Field(default="", repr=False)
    website_phishtank_enabled: bool = False
    website_phishtank_api_key: str = Field(default="", repr=False)
    website_lookup_timeout_s: float = Field(default=5.0, gt=0, le=10)
    website_cache_ttl_s: int = Field(default=300, ge=1, le=300)
    website_lookup_requests_per_minute: int = Field(default=30, ge=1, le=100)

    # Gemini Multimodal Live (browser audio <-> this API <-> Gemini)
    gemini_api_key: str = Field(default="", repr=False)
    gemini_live_model: str = "gemini-3.8-live"
    planboard_url: str = "http://localhost:3001"

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key.strip())

    @property
    def voice_enabled(self) -> bool:
        return bool(self.elevenlabs_api_key.strip())

    @property
    def voice_enabled(self) -> bool:
        return bool(self.elevenlabs_api_key)

    @property
    def gemini_live_key(self) -> str:
        if self.gemini_api_key:
            return self.gemini_api_key
        if "generativelanguage.googleapis.com" in (self.llm_base_url or "") and self.llm_api_key:
            return self.llm_api_key
        return ""

    @property
    def gemini_live_enabled(self) -> bool:
        return bool(self.gemini_live_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
