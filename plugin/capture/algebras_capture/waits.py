"""Wait conditions: OCR text, template image, stable frame."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageOps
from rapidfuzz import fuzz

from .link.ocr import ocr_lines
from .link.strings import normalize


def _gray(img: Image.Image, width: int | None = None) -> np.ndarray:
    g = ImageOps.grayscale(img)
    if width and g.width > width:
        g = g.resize((width, round(g.height * width / g.width)), Image.BILINEAR)
    return np.asarray(g, dtype=np.float32)


def frame_diff(a: Image.Image, b: Image.Image) -> float:
    """Mean absolute pixel difference 0..1 on a 320px-wide grayscale."""
    x, y = _gray(a, 320), _gray(b, 320)
    if x.shape != y.shape:
        return 1.0
    return float(np.abs(x - y).mean() / 255.0)


def text_score(img: Image.Image, text: str) -> float:
    want = normalize(text)
    blob = " ".join(normalize(l.text) for l in ocr_lines(img))
    if not want or not blob:
        return 0.0
    return fuzz.partial_ratio(want, blob) / 100.0


def template_score(img: Image.Image, template: Image.Image, scale: float = 0.5) -> float:
    """Best normalized cross-correlation of the template anywhere in img (FFT, grayscale, downscaled)."""
    I = _gray(img)
    T = _gray(template)
    if scale != 1.0:
        I = np.asarray(Image.fromarray(I).resize((max(1, int(I.shape[1] * scale)), max(1, int(I.shape[0] * scale)))), dtype=np.float64)
        T = np.asarray(Image.fromarray(T).resize((max(1, int(T.shape[1] * scale)), max(1, int(T.shape[0] * scale)))), dtype=np.float64)
    th, tw = T.shape
    H, W = I.shape
    if th > H or tw > W:
        return 0.0
    T = T - T.mean()
    tnorm = np.sqrt((T ** 2).sum())
    if tnorm == 0:
        return 0.0
    fs = (H + th, W + tw)
    corr = np.fft.irfft2(np.fft.rfft2(I, fs) * np.conj(np.fft.rfft2(T, fs)), fs)[: H - th + 1, : W - tw + 1]
    # Local sums of I and I^2 over each template-sized window (integral images).
    def box(a):
        c = np.pad(a.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
        return c[th:, tw:] - c[:-th, tw:] - c[th:, :-tw] + c[:-th, :-tw]
    s, s2 = box(I), box(I * I)
    var = s2 - s * s / (th * tw)
    denom = np.sqrt(np.maximum(var, 1e-9)) * tnorm
    ncc = corr / denom
    ncc[var < 1e-3] = 0
    return float(np.clip(ncc.max(), -1, 1))


def poll(check: Callable[[], float], threshold: float, timeout: float, interval: float = 0.4) -> tuple[bool, float]:
    deadline = time.monotonic() + timeout
    best = 0.0
    while True:
        score = check()
        best = max(best, score)
        if score >= threshold:
            return True, score
        if time.monotonic() >= deadline:
            return False, best
        time.sleep(interval)


def wait_stable(grab: Callable[[], Image.Image], settle_ms: int, timeout: float, tol: float = 0.004) -> bool:
    """True once frames stay within `tol` mean difference for settle_ms."""
    deadline = time.monotonic() + timeout
    prev = grab()
    since = time.monotonic()
    while time.monotonic() < deadline:
        time.sleep(min(0.1, settle_ms / 1000 / 3 or 0.05))
        cur = grab()
        if frame_diff(prev, cur) > tol:
            since = time.monotonic()
        elif (time.monotonic() - since) * 1000 >= settle_ms:
            return True
        prev = cur
    return False


def load_template(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")
