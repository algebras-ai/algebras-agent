"""Test backend: a fixed list of frames; every input action advances to the next frame."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from .base import Session


class FakeSession(Session):
    input_name = "fake"
    capture_name = "fake"

    def __init__(self, frames: list[Path | Image.Image], drop_inputs: int = 0):
        self.frames = [f if isinstance(f, Image.Image) else Image.open(f).convert("RGB") for f in frames]
        self.i = 0
        self.drop_inputs = drop_inputs  # simulate a game ignoring the first N inputs
        self.inputs: list[str] = []

    def _advance(self, what: str) -> None:
        self.inputs.append(what)
        if self.drop_inputs > 0:
            self.drop_inputs -= 1
            return
        self.i = min(self.i + 1, len(self.frames) - 1)

    def grab(self) -> Image.Image:
        return self.frames[self.i].copy()

    def key(self, name: str, hold_ms: int = 60) -> None:
        self._advance(f"key:{name}")

    def click(self, x: float, y: float, relative: bool = True, button: str = "left") -> None:
        self._advance(f"click:{x},{y}")

    def type_text(self, text: str) -> None:
        self._advance(f"type:{text}")

    def gamepad(self, button: str, hold_ms: int = 80) -> None:
        self._advance(f"pad:{button}")
