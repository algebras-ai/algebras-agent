"""Session = one input backend + one capture backend bound to one target window or page."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from PIL import Image


class BackendUnavailable(RuntimeError):
    """A backend's library or system tool is missing; the message says what to install."""


@dataclass
class Rect:
    left: int
    top: int
    width: int
    height: int

    @property
    def size(self) -> str:
        return f"{self.width}x{self.height}"


def key_name(spec: Any) -> tuple[str, int, int]:
    """key step value -> (name, holdMs, repeat)."""
    if isinstance(spec, str):
        return spec, 60, 1
    return spec["name"], int(spec.get("holdMs", 60)), int(spec.get("repeat", 1))


class Session(ABC):
    input_name = "?"
    capture_name = "?"

    def start(self) -> None:  # noqa: B027
        pass

    def close(self) -> None:  # noqa: B027
        pass

    @abstractmethod
    def grab(self) -> Image.Image: ...

    @abstractmethod
    def key(self, name: str, hold_ms: int = 60) -> None: ...

    @abstractmethod
    def click(self, x: float, y: float, relative: bool = True, button: str = "left") -> None: ...

    @abstractmethod
    def type_text(self, text: str) -> None: ...

    def gamepad(self, button: str, hold_ms: int = 80) -> None:
        raise BackendUnavailable(f"input backend '{self.input_name}' has no gamepad; use input: vgamepad")

    def wait_selector(self, selector: str, timeout: float) -> bool:
        raise BackendUnavailable("wait.selector works only with browser targets")

    @property
    def resolution(self) -> str:
        img = self.grab()
        return f"{img.width}x{img.height}"

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()
