"""Source string loaders and text normalization for OCR linking."""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceString:
    key: str
    text: str
    row: int | None = None
    note: str = ""


_TAG = re.compile(r"<[^<>]{1,80}>")  # Unity/TMP rich text: <color=#fff>, <b>, </b>, <sprite=3>
_PLACEHOLDER = re.compile(r"\{[^{}]{0,40}\}|%\d*\$?[sdif@]|\$\{[^}]*\}|\[[A-Z_]{2,}\]")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "—": "-", "–": "-"})


def strip_markup(text: str) -> str:
    return _PLACEHOLDER.sub(" ", _TAG.sub("", text))


def normalize(text: str) -> str:
    """Lowercase, markup and placeholders removed, punctuation folded to spaces."""
    t = unicodedata.normalize("NFKC", strip_markup(text)).translate(_QUOTES).lower()
    t = re.sub(r"[^\w']+", " ", t)
    t = t.replace("'", "")
    return re.sub(r"\s+", " ", t).strip()


def load_strings(path: Path, key_pattern: str | None = None) -> list[SourceString]:
    """JSON {key: text} or [{key, text, row?}], or CSV/TSV with key,text[,row] columns."""
    p = Path(path)
    if p.suffix.lower() == ".json":
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            items = [{"key": k, "text": v} for k, v in data.items() if isinstance(v, str)]
        else:
            items = data
    elif p.suffix.lower() in (".csv", ".tsv"):
        with open(p, newline="", encoding="utf-8") as f:
            items = list(csv.DictReader(f, delimiter="\t" if p.suffix.lower() == ".tsv" else ","))
    else:
        raise ValueError(f"unsupported strings file: {p}")
    out = []
    for it in items:
        row = it.get("row")
        row = int(row) if row not in (None, "") else None
        key = it.get("key") or (key_pattern.replace("{row}", str(row)) if key_pattern and row is not None else None)
        if not key or not it.get("text"):
            continue
        out.append(SourceString(key=key, text=it["text"], row=row, note=it.get("note", "") or ""))
    return out
