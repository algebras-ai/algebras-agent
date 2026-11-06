"""Compare two runs of the same spec: stable screens should produce near-identical images."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def _arr(path: Path, width: int = 480) -> np.ndarray:
    g = ImageOps.grayscale(Image.open(path))
    g = g.resize((width, round(g.height * width / g.width)), Image.BILINEAR)
    return np.asarray(g, dtype=np.float64)


def ssim(a: np.ndarray, b: np.ndarray, win: int = 8) -> float:
    """Mean SSIM over non-overlapping win x win blocks (grayscale, 0..255)."""
    if a.shape != b.shape:
        return 0.0
    h, w = (a.shape[0] // win) * win, (a.shape[1] // win) * win
    A = a[:h, :w].reshape(h // win, win, w // win, win)
    B = b[:h, :w].reshape(h // win, win, w // win, win)
    ma, mb = A.mean((1, 3)), B.mean((1, 3))
    va, vb = A.var((1, 3)), B.var((1, 3))
    cov = ((A - ma[:, None, :, None]) * (B - mb[:, None, :, None])).mean((1, 3))
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))
    return float(s.mean())


def dhash(path: Path, size: int = 16) -> int:
    g = ImageOps.grayscale(Image.open(path)).resize((size + 1, size), Image.BILINEAR)
    a = np.asarray(g, dtype=np.int16)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def compare(run_a: Path, run_b: Path, min_ssim: float = 0.98) -> dict:
    ma = json.loads((run_a / "manifest.json").read_text())
    mb = json.loads((run_b / "manifest.json").read_text())
    fb = {s["checkpoint"]: s["file"] for s in mb["screenshots"]}
    rows = []
    for s in ma["screenshots"]:
        cp = s["checkpoint"]
        if cp not in fb:
            rows.append({"checkpoint": cp, "status": "missing-in-b"})
            continue
        pa, pb = run_a / s["file"], run_b / fb[cp]
        sc = ssim(_arr(pa), _arr(pb))
        ham = bin(dhash(pa) ^ dhash(pb)).count("1")
        rows.append({"checkpoint": cp, "ssim": round(sc, 4), "dhashDistance": ham, "identical": s.get("sha256") == next((x.get("sha256") for x in mb["screenshots"] if x["checkpoint"] == cp), None), "status": "stable" if sc >= min_ssim else "differs"})
    ok = all(r["status"] == "stable" for r in rows)
    return {"runA": ma["runId"], "runB": mb["runId"], "minSsim": min_ssim, "stable": ok, "checkpoints": rows}
