"""Start the build under test and make sure it runs windowed."""

from __future__ import annotations

import platform
import shutil
import subprocess
from pathlib import Path

from .backends.base import Rect

IS_WINDOWS = platform.system() == "Windows"


class FullscreenRejected(RuntimeError):
    pass


def steam_command(app_id: str, args: list[str]) -> list[str]:
    """`steam -applaunch <id> <args>` passes launch options (e.g. -windowed, -screen-width 1280 for Unity).
    steam://rungameid/<id> cannot carry them, so it is used only when there are none."""
    if args:
        exe = shutil.which("steam") or (r"C:\Program Files (x86)\Steam\steam.exe" if IS_WINDOWS else None)
        if exe:
            return [exe, "-applaunch", app_id, *args]
    url = f"steam://rungameid/{app_id}"
    if IS_WINDOWS:
        return ["cmd", "/c", "start", "", url]
    return ["xdg-open", url]


def launch(target: dict, base_dir: Path) -> subprocess.Popen | None:
    kind = target["kind"]
    if kind == "steam":
        return subprocess.Popen(steam_command(target["steamAppId"], target.get("launchArgs", [])), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if kind == "exe":
        cmd = [str((base_dir / c).resolve()) if i == 0 and not Path(c).is_absolute() and (base_dir / c).exists() else c for i, c in enumerate(target["command"])]
        return subprocess.Popen(cmd, cwd=base_dir)
    return None


def check_windowed(win: Rect, monitor: Rect, wanted: str | None) -> list[str]:
    """Raise when the game covers the whole monitor (exclusive or borderless fullscreen): overlays,
    focus changes and resolution switches make such captures unreliable. Returns warnings."""
    if (win.width, win.height) == (monitor.width, monitor.height) and wanted and wanted != monitor.size:
        raise FullscreenRejected(
            f"game window is {win.size}, the full monitor, but the spec wants {wanted}. Start it windowed: add "
            "launch options such as -windowed / -screen-fullscreen 0 -screen-width W -screen-height H (Unity) "
            "or set windowed mode in the game's settings/config file, then rerun."
        )
    warnings = []
    if wanted and win.size != wanted:
        warnings.append(f"window is {win.size}, spec wants {wanted}; screenshots use the actual size")
    return warnings
