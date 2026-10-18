from __future__ import annotations

import logging
import threading
import time
from typing import Any

from api.config import get_settings

log = logging.getLogger(__name__)

_lock = threading.Lock()
_driver: Any = None


def close_driver() -> None:
    global _driver
    with _lock:
        if _driver is not None:
            try:
                _driver.quit()
            except Exception:
                log.exception("Failed to close Selenium driver")
            _driver = None


def fetch_html(url: str) -> str:
    settings = get_settings()
    if not settings.selenium_enabled:
        raise RuntimeError("Selenium is disabled")
    with _lock:
        driver = _get_driver()
        driver.set_page_load_timeout(settings.scrape_timeout_s)
        driver.get(url)
        time.sleep(max(0.4, settings.scrape_delay_s))
        return driver.page_source


def _get_driver() -> Any:
    global _driver
    if _driver is not None:
        return _driver
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    settings = get_settings()
    options = Options()
    if settings.selenium_headless:
        options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1280,900")
    options.add_argument("--disable-blink-features=AutomationControlled")
    _driver = webdriver.Chrome(options=options)
    return _driver
