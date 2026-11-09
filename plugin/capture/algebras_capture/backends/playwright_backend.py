"""Browser builds (WebGL/HTML5 games, web apps): Playwright drives input and captures the viewport."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from .base import BackendUnavailable, Session

# Playwright key names for the common game/UI keys used in specs.
_KEYS = {"enter": "Enter", "esc": "Escape", "escape": "Escape", "space": " ", "tab": "Tab", "up": "ArrowUp",
         "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight", "backspace": "Backspace", "shift": "Shift"}


class PlaywrightSession(Session):
    input_name = "playwright"
    capture_name = "playwright"

    def __init__(self, url: str, viewport: str = "1280x720", headless: bool = True, browser: str = "chromium"):
        self.url = url
        w, h = (int(v) for v in viewport.split("x"))
        self.viewport = {"width": w, "height": h}
        self.headless = headless
        self.browser_name = browser

    def start(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise BackendUnavailable("browser targets need `pip install -e '.[browser]'` and `python -m playwright install chromium`") from e
        self._pw = sync_playwright().start()
        self._browser = getattr(self._pw, self.browser_name).launch(headless=self.headless)
        # Fixed device scale and no animations-from-OS settings keep reruns pixel-stable.
        self._ctx = self._browser.new_context(viewport=self.viewport, device_scale_factor=1, reduced_motion="reduce")
        self.page = self._ctx.new_page()
        self.page.goto(self.url, wait_until="load")

    def close(self) -> None:
        for obj in ("_ctx", "_browser"):
            if hasattr(self, obj):
                getattr(self, obj).close()
        if hasattr(self, "_pw"):
            self._pw.stop()

    def grab(self) -> Image.Image:
        return Image.open(io.BytesIO(self.page.screenshot(animations="disabled", caret="hide"))).convert("RGB")

    def key(self, name: str, hold_ms: int = 60) -> None:
        k = _KEYS.get(name.lower(), name if len(name) == 1 else name.capitalize())
        self.page.keyboard.down(k)
        self.page.wait_for_timeout(hold_ms)
        self.page.keyboard.up(k)

    def click(self, x: float, y: float, relative: bool = True, button: str = "left") -> None:
        if relative:
            x, y = x * self.viewport["width"], y * self.viewport["height"]
        self.page.mouse.click(x, y, button=button)

    def type_text(self, text: str) -> None:
        self.page.keyboard.type(text, delay=20)

    def wait_selector(self, selector: str, timeout: float) -> bool:
        try:
            self.page.wait_for_selector(selector, state="visible", timeout=timeout * 1000)
            return True
        except Exception:
            return False


def resolve_url(url: str, base_dir: Path) -> str:
    if url.startswith(("http://", "https://", "file://")):
        return url
    return (base_dir / url).resolve().as_uri()
