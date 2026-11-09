"""Build, write and validate capture manifests (manifest.schema.json, version 1)."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__, schemas

SCHEMA = "manifest.schema.json"
MANIFEST_NAME = "manifest.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def new_run_id(prefix: str = "run") -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"


def safe_run_id(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-") or "run"


def key_for_row(pattern: str | None, row: int) -> str | None:
    return pattern.replace("{row}", str(row)) if pattern else None


def row_for_key(pattern: str | None, key: str) -> int | None:
    if not pattern:
        return None
    rx = "^" + re.escape(pattern).replace(re.escape("{row}"), r"(\d+)") + "$"
    m = re.match(rx, key)
    return int(m.group(1)) if m else None


def _relative(image: Path, out_dir: Path) -> str:
    """Path of image relative to out_dir, without resolving symlinks; must stay inside out_dir."""
    rel = Path(os.path.relpath(Path(image).absolute(), Path(out_dir).absolute())).as_posix()
    if rel.startswith("../") or rel == "..":
        raise ValueError(f"{image} is not inside the run directory {out_dir}")
    return rel


def screenshot_entry(
    out_dir: Path,
    image: Path,
    checkpoint: str,
    links: list[dict[str, Any]],
    method: str,
    send_to_ai: bool = True,
    size: tuple[int, int] | None = None,
) -> dict[str, Any]:
    """links: [{key, row?, score (0..1), ocrText?}] sorted best first."""
    keys, rows, per_key = [], [], []
    for l in links:
        if l["key"] in keys:
            continue
        keys.append(l["key"])
        if l.get("row") is not None and l["row"] not in rows:
            rows.append(int(l["row"]))
        pk = {"key": l["key"], "score": round(float(l["score"]), 4)}
        if l.get("row") is not None:
            pk["row"] = int(l["row"])
        if l.get("ocrText"):
            pk["ocrText"] = l["ocrText"][:300]
        per_key.append(pk)
    confidence = round(max((p["score"] for p in per_key), default=0.0), 4)
    entry: dict[str, Any] = {
        "file": _relative(image, out_dir),
        "checkpoint": checkpoint,
        "sha256": sha256(image),
        "stringKeys": keys,
        "rows": rows,
        "match": {"method": method if keys else "none", "confidence": confidence, "perKey": per_key},
        "sendToAi": send_to_ai,
    }
    if size:
        entry["width"], entry["height"] = size
    return entry


def build(
    *,
    run_id: str,
    game: str,
    build: str,
    language: str,
    resolution: str,
    screenshots: list[dict[str, Any]],
    steam_app_id: str | None = None,
    key_pattern: str | None = None,
    tool_input: str | None = None,
    tool_capture: str | None = None,
    extra: dict[str, Any] | None = None,
    captured_at: str | None = None,
) -> dict[str, Any]:
    m: dict[str, Any] = {
        "manifestVersion": 1,
        "runId": safe_run_id(run_id),
        "game": game,
        "build": build or "unknown",
        "language": language,
        "resolution": resolution,
        "capturedAt": captured_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "tool": {"name": "algebras-capture", "version": __version__},
        "screenshots": screenshots,
    }
    if steam_app_id:
        m["steamAppId"] = str(steam_app_id)
    if key_pattern:
        m["keyPattern"] = key_pattern
    if tool_input:
        m["tool"]["input"] = tool_input
    if tool_capture:
        m["tool"]["capture"] = tool_capture
    if extra:
        m["extra"] = extra
    return m


def validate(doc: dict[str, Any], base_dir: Path | None = None) -> None:
    """Schema check, plus (when base_dir is given) that every file exists and hashes match."""
    schemas.validate(SCHEMA, doc, "manifest")
    problems = []
    files = [s["file"] for s in doc["screenshots"]]
    dupes = {f for f in files if files.count(f) > 1}
    if dupes:
        problems.append(f"duplicate files: {sorted(dupes)}")
    if doc.get("keyPattern"):
        for s in doc["screenshots"]:
            want = sorted(row_for_key(doc["keyPattern"], k) for k in s["stringKeys"] if row_for_key(doc["keyPattern"], k) is not None)
            if sorted(s["rows"]) != want:
                problems.append(f"{s['file']}: rows {s['rows']} do not match stringKeys under keyPattern")
    if base_dir is not None:
        for s in doc["screenshots"]:
            p = base_dir / s["file"]
            if not p.is_file():
                problems.append(f"{s['file']}: file missing")
            elif s.get("sha256") and sha256(p) != s["sha256"]:
                problems.append(f"{s['file']}: sha256 mismatch")
    if problems:
        raise schemas.ValidationFailed("manifest", problems)


def write(doc: dict[str, Any], out_dir: Path) -> Path:
    validate(doc, out_dir)
    p = out_dir / MANIFEST_NAME
    p.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return p


def load(path: Path) -> dict[str, Any]:
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    validate(doc, Path(path).parent)
    return doc
