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
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    session_ttl_s: int = 3600
    session_spend_cap: float = 150.0

    # Review sources are explicitly configured public stores, not approved merchants.
    # JSON map of short merchant IDs to HTTPS origins; no credentials are needed.
    review_woocommerce_stores: dict[str, str] = Field(default_factory=dict)
    review_source_timeout_s: float = Field(default=10.0, gt=0, le=20)
    review_source_cache_ttl_s: int = Field(default=300, ge=0, le=3600)
    review_llm_timeout_s: float = Field(default=25.0, gt=0, le=30)
    review_llm_max_reviews: int = Field(default=12, ge=1, le=30)
    review_llm_requests_per_minute: int = Field(default=6, ge=1, le=30)
    review_llm_requests_per_day: int = Field(default=100, ge=1, le=1000)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key.strip())

    @property
    def voice_enabled(self) -> bool:
        return bool(self.elevenlabs_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
