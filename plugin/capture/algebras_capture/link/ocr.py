"""OCR with Tesseract. Game UIs mix light-on-dark, dark-on-light and white-on-color text, so three
preprocessed passes are merged."""

from __future__ import annotations

import shutil
from dataclasses import dataclass

from PIL import Image, ImageOps


@dataclass
class OcrLine:
    text: str
    conf: float  # 0..100, mean word confidence
    box: tuple[int, int, int, int]  # left, top, width, height in source-image pixels


class OcrUnavailable(RuntimeError):
    pass


def available() -> bool:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None


def _scale(g: Image.Image, target_height: int) -> tuple[Image.Image, float]:
    scale = max(1.0, target_height / g.height)
    if scale > 1.0:
        g = g.resize((round(g.width * scale), round(g.height * scale)), Image.LANCZOS)
    return g, scale


def _min_channel(img: Image.Image) -> Image.Image:
    """Per-pixel min(R, G, B): white text stays bright, saturated backgrounds (purple dialogue boxes,
    magenta buttons) go dark, so white-on-color text gets the contrast plain grayscale loses."""
    import numpy as np

    return Image.fromarray(np.asarray(img.convert("RGB")).min(axis=2))


def _lines(img: Image.Image, scale: float, lang: str, min_conf: float) -> list[OcrLine]:
    import pytesseract

    d = pytesseract.image_to_data(img, lang=lang, config="--psm 11", output_type=pytesseract.Output.DICT)
    groups: dict[tuple, list[int]] = {}
    for i, word in enumerate(d["text"]):
        conf = float(d["conf"][i])
        if not word.strip() or conf < min_conf:
            continue
        groups.setdefault((d["block_num"][i], d["par_num"][i], d["line_num"][i]), []).append(i)
    out = []
    for idx in groups.values():
        idx.sort(key=lambda i: d["left"][i])
        words = [d["text"][i] for i in idx]
        l = min(d["left"][i] for i in idx)
        t = min(d["top"][i] for i in idx)
        r = max(d["left"][i] + d["width"][i] for i in idx)
        b = max(d["top"][i] + d["height"][i] for i in idx)
        out.append(
            OcrLine(
                text=" ".join(words),
                conf=sum(float(d["conf"][i]) for i in idx) / len(idx),
                box=(round(l / scale), round(t / scale), round((r - l) / scale), round((b - t) / scale)),
            )
        )
    return out


def ocr_lines(img: Image.Image, lang: str = "eng", target_height: int = 1080, min_conf: float = 0.0) -> list[OcrLine]:
    """Upscale small captures; OCR grayscale, inverted grayscale and min-channel; merge lines (dedup by text)."""
    if not available():
        raise OcrUnavailable("Tesseract OCR needs `pip install pytesseract` and the `tesseract` binary on PATH")
    rgb = img.convert("RGB")
    g, scale = _scale(ImageOps.grayscale(rgb), target_height)
    m, _ = _scale(_min_channel(rgb), target_height)
    lines = _lines(g, scale, lang, min_conf) + _lines(ImageOps.invert(g), scale, lang, min_conf) + _lines(m, scale, lang, min_conf)
    seen, out = set(), []
    for ln in sorted(lines, key=lambda x: -x.conf):
        k = ln.text.lower()
        if k not in seen:
            seen.add(k)
            out.append(ln)
    out.sort(key=lambda x: (x.box[1], x.box[0]))
    return out


def ocr_text(img: Image.Image, **kw) -> str:
    return "\n".join(l.text for l in ocr_lines(img, **kw))
