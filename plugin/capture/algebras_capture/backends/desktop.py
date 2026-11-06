"""Desktop builds (Steam/Windows, Proton on Linux): OS-level input + screen capture of the game window.

Input backends
  pydirectinput  Windows. SendInput with scan codes, which DirectInput/raw-input games read
                 (pyautogui's virtual-key events are ignored by many of them).
  pyautogui      Windows/macOS/X11. Virtual-key events; fine for menus of most Unity/Unreal games.
  xdotool        Linux X11 / XWayland (Proton games run under XWayland). Sends to the focused window.
  ydotool        Linux Wayland-native, via uinput (needs the ydotoold daemon and /dev/uinput access).
  vgamepad       Windows. Virtual Xbox 360 pad (ViGEmBus driver); for games that ignore synthetic keys.
Capture backends
  mss            Any OS. Grabs the window's screen rectangle (the window must be visible, not covered).
  dxcam          Windows. Desktop Duplication API; use when mss returns black frames for DX games.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import time

from PIL import Image

from .base import BackendUnavailable, Rect, Session

IS_WINDOWS = platform.system() == "Windows"

# Spec key names -> xdotool keysyms.
_XKEYS = {"enter": "Return", "esc": "Escape", "escape": "Escape", "space": "space", "tab": "Tab", "up": "Up",
          "down": "Down", "left": "Left", "right": "Right", "backspace": "BackSpace", "shift": "Shift_L",
          "ctrl": "Control_L", "alt": "Alt_L", "f12": "F12"}
# Spec key names -> Linux input event codes (ydotool key <code>:1 <code>:0).
_EVCODES = {"esc": 1, "escape": 1, "enter": 28, "space": 57, "tab": 15, "up": 103, "down": 108, "left": 105,
            "right": 106, "backspace": 14, "shift": 42, "ctrl": 29, "alt": 56,
            **{c: code for c, code in zip("qwertyuiop", range(16, 26))},
            **{c: code for c, code in zip("asdfghjkl", range(30, 39))},
            **{c: code for c, code in zip("zxcvbnm", range(44, 51))},
            **{str((i + 1) % 10): 2 + i for i in range(10)}}


def _need(tool: str, hint: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise BackendUnavailable(f"'{tool}' not found on PATH: {hint}")
    return path


# --- window location -------------------------------------------------------------------------

def find_window(title: str | None) -> Rect | None:
    """Rect of the first visible window whose title contains `title`; None if not found."""
    if not title:
        return None
    if IS_WINDOWS:
        try:
            import pygetwindow as gw  # ships with pyautogui
        except ImportError as e:
            raise BackendUnavailable("window lookup on Windows needs `pip install pygetwindow`") from e
        wins = [w for w in gw.getWindowsWithTitle(title) if w.visible and w.width > 0]
        if not wins:
            return None
        w = wins[0]
        return Rect(w.left, w.top, w.width, w.height)
    if shutil.which("xdotool"):
        r = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", title], capture_output=True, text=True)
        ids = r.stdout.split()
        if not ids:
            return None
        g = subprocess.run(["xdotool", "getwindowgeometry", "--shell", ids[0]], capture_output=True, text=True).stdout
        v = dict(line.split("=", 1) for line in g.split() if "=" in line)
        return Rect(int(v["X"]), int(v["Y"]), int(v["WIDTH"]), int(v["HEIGHT"]))
    raise BackendUnavailable("window lookup on Linux needs xdotool (X11/XWayland); or set target.kind: window without windowTitle to capture the whole primary monitor")


def focus_window(title: str | None) -> None:
    if not title:
        return
    if IS_WINDOWS:
        import pygetwindow as gw

        wins = gw.getWindowsWithTitle(title)
        if wins:
            try:
                wins[0].activate()
            except Exception:
                pass
    elif shutil.which("xdotool"):
        subprocess.run(["xdotool", "search", "--onlyvisible", "--name", title, "windowactivate", "--sync"], capture_output=True)


def primary_monitor() -> Rect:
    import mss

    with mss.mss() as s:
        m = s.monitors[1]
        return Rect(m["left"], m["top"], m["width"], m["height"])


# --- input ----------------------------------------------------------------------------------

class _Input:
    def key(self, name: str, hold_ms: int) -> None: ...
    def click(self, x: int, y: int, button: str) -> None: ...
    def type_text(self, text: str) -> None: ...
    def gamepad(self, button: str, hold_ms: int) -> None:
        raise BackendUnavailable("this input backend has no gamepad; use input: vgamepad")


class _PyAutoGui(_Input):
    def __init__(self, direct: bool):
        try:
            mod = __import__("pydirectinput" if direct else "pyautogui")
        except ImportError as e:
            raise BackendUnavailable(f"`pip install {'pydirectinput' if direct else 'pyautogui'}`") from e
        mod.PAUSE = 0.02
        mod.FAILSAFE = False
        self.m = mod

    def key(self, name, hold_ms):
        self.m.keyDown(name)
        time.sleep(hold_ms / 1000)
        self.m.keyUp(name)

    def click(self, x, y, button):
        self.m.moveTo(x, y)
        self.m.click(x=x, y=y, button=button)

    def type_text(self, text):
        for ch in text:
            self.m.press(ch)


class _Xdotool(_Input):
    def __init__(self):
        _need("xdotool", "install xdotool (X11/XWayland only)")

    def key(self, name, hold_ms):
        k = _XKEYS.get(name.lower(), name)
        subprocess.run(["xdotool", "keydown", k], check=True)
        time.sleep(hold_ms / 1000)
        subprocess.run(["xdotool", "keyup", k], check=True)

    def click(self, x, y, button):
        b = {"left": "1", "middle": "2", "right": "3"}[button]
        subprocess.run(["xdotool", "mousemove", "--sync", str(x), str(y), "click", b], check=True)

    def type_text(self, text):
        subprocess.run(["xdotool", "type", "--delay", "40", text], check=True)


class _Ydotool(_Input):
    def __init__(self):
        _need("ydotool", "install ydotool and run ydotoold (needs /dev/uinput access)")

    def key(self, name, hold_ms):
        code = _EVCODES.get(name.lower())
        if code is None:
            raise BackendUnavailable(f"ydotool backend has no event code for key '{name}'")
        subprocess.run(["ydotool", "key", f"{code}:1"], check=True)
        time.sleep(hold_ms / 1000)
        subprocess.run(["ydotool", "key", f"{code}:0"], check=True)

    def click(self, x, y, button):
        subprocess.run(["ydotool", "mousemove", "--absolute", "-x", str(x), "-y", str(y)], check=True)
        subprocess.run(["ydotool", "click", {"left": "0xC0", "right": "0xC1", "middle": "0xC2"}[button]], check=True)

    def type_text(self, text):
        subprocess.run(["ydotool", "type", text], check=True)


class _VGamepad(_Input):
    _BUTTONS = {"a": "XUSB_GAMEPAD_A", "b": "XUSB_GAMEPAD_B", "x": "XUSB_GAMEPAD_X", "y": "XUSB_GAMEPAD_Y",
                "start": "XUSB_GAMEPAD_START", "back": "XUSB_GAMEPAD_BACK", "up": "XUSB_GAMEPAD_DPAD_UP",
                "down": "XUSB_GAMEPAD_DPAD_DOWN", "left": "XUSB_GAMEPAD_DPAD_LEFT", "right": "XUSB_GAMEPAD_DPAD_RIGHT",
                "lb": "XUSB_GAMEPAD_LEFT_SHOULDER", "rb": "XUSB_GAMEPAD_RIGHT_SHOULDER"}

    def __init__(self, keyboard: _Input | None):
        try:
            import vgamepad as vg
        except ImportError as e:
            raise BackendUnavailable("`pip install vgamepad` (Windows, installs the ViGEmBus driver)") from e
        self.vg = vg
        self.pad = vg.VX360Gamepad()
        self.kb = keyboard

    def gamepad(self, button, hold_ms):
        b = getattr(self.vg.XUSB_BUTTON, self._BUTTONS[button.lower()])
        self.pad.press_button(button=b)
        self.pad.update()
        time.sleep(hold_ms / 1000)
        self.pad.release_button(button=b)
        self.pad.update()

    def key(self, name, hold_ms):
        if not self.kb:
            raise BackendUnavailable("vgamepad session has no keyboard fallback")
        self.kb.key(name, hold_ms)

    def click(self, x, y, button):
        self.kb.click(x, y, button)

    def type_text(self, text):
        self.kb.type_text(text)


def make_input(name: str) -> _Input:
    if name == "pyautogui":
        return _PyAutoGui(direct=False)
    if name == "pydirectinput":
        if not IS_WINDOWS:
            raise BackendUnavailable("pydirectinput is Windows-only; use xdotool or ydotool on Linux")
        return _PyAutoGui(direct=True)
    if name == "xdotool":
        return _Xdotool()
    if name == "ydotool":
        return _Ydotool()
    if name == "vgamepad":
        kb = _PyAutoGui(direct=True) if IS_WINDOWS else None
        return _VGamepad(kb)
    raise BackendUnavailable(f"unknown input backend '{name}'")


# --- capture --------------------------------------------------------------------------------

class _Capture:
    def grab(self, r: Rect) -> Image.Image: ...
    def close(self) -> None: ...


class _Mss(_Capture):
    def __init__(self):
        try:
            import mss
        except ImportError as e:
            raise BackendUnavailable("`pip install mss`") from e
        self.s = mss.mss()

    def grab(self, r):
        shot = self.s.grab({"left": r.left, "top": r.top, "width": r.width, "height": r.height})
        return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    def close(self):
        self.s.close()


class _Dxcam(_Capture):
    def __init__(self):
        if not IS_WINDOWS:
            raise BackendUnavailable("dxcam is Windows-only; use mss")
        try:
            import dxcam
        except ImportError as e:
            raise BackendUnavailable("`pip install dxcam`") from e
        self.cam = dxcam.create(output_color="RGB")

    def grab(self, r):
        for _ in range(20):  # dxcam returns None when the frame did not change since the last grab
            frame = self.cam.grab(region=(r.left, r.top, r.left + r.width, r.top + r.height))
            if frame is not None:
                self.last = Image.fromarray(frame)
                return self.last
            time.sleep(0.02)
        if getattr(self, "last", None) is not None:
            return self.last
        raise RuntimeError("dxcam returned no frame")


def make_capture(name: str) -> _Capture:
    if name == "mss":
        return _Mss()
    if name == "dxcam":
        return _Dxcam()
    raise BackendUnavailable(f"unknown capture backend '{name}'")


class DesktopSession(Session):
    def __init__(self, input_name: str, capture_name: str, window_title: str | None, window_timeout: float = 0):
        self.input_name, self.capture_name = input_name, capture_name
        self.title = window_title
        self.window_timeout = window_timeout
        self.rect: Rect | None = None

    def start(self) -> None:
        self.inp = make_input(self.input_name)
        self.cap = make_capture(self.capture_name)
        self.refresh_window(self.window_timeout)

    def refresh_window(self, timeout: float = 0) -> Rect:
        deadline = time.monotonic() + timeout
        while True:
            r = find_window(self.title) if self.title else primary_monitor()
            if r:
                self.rect = r
                return r
            if time.monotonic() >= deadline:
                raise TimeoutError(f"no visible window titled '{self.title}' after {timeout:.0f}s")
            time.sleep(1)

    def close(self) -> None:
        if hasattr(self, "cap"):
            self.cap.close()

    def grab(self) -> Image.Image:
        return self.cap.grab(self.rect)

    def _focus(self):
        if os.environ.get("ALGEBRAS_CAPTURE_NO_FOCUS") != "1":
            focus_window(self.title)

    def key(self, name, hold_ms=60):
        self._focus()
        self.inp.key(name, hold_ms)

    def click(self, x, y, relative=True, button="left"):
        r = self.rect
        if relative:
            x, y = r.left + x * r.width, r.top + y * r.height
        else:
            x, y = r.left + x, r.top + y
        self._focus()
        self.inp.click(round(x), round(y), button)

    def type_text(self, text):
        self._focus()
        self.inp.type_text(text)

    def gamepad(self, button, hold_ms=80):
        self.inp.gamepad(button, hold_ms)
