"""Settings, read from api/.env. Every value has a safe default so an empty .env works."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent
DATA_DIR = API_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_DIR / ".env", extra="ignore")

    # LLM (any OpenAI-compatible Chat Completions endpoint)
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_timeout_s: float = 4.0  # per LLM call; slower -> fallback agent answers
    llm_turn_budget_s: float = 10.0  # whole turn, across tool round trips
    # Optional, e.g. "none"/"low" to keep reasoning models fast. TODO(verify) per provider.
    llm_reasoning_effort: str = ""

    # ElevenLabs
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model_id: str = "eleven_flash_v2_5"
    elevenlabs_timeout_s: float = 8.0

    # Stripe (test mode only)
    stripe_secret_key: str = ""

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

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def voice_enabled(self) -> bool:
        return bool(self.elevenlabs_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
