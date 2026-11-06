"""Checkpoint spec: YAML file -> validated dict with defaults applied."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from . import schemas

SCHEMA = "checkpoint.schema.json"

DEFAULT_INPUT = {"browser": "playwright", "fake": "fake"}
DEFAULT_CAPTURE = {"browser": "playwright", "fake": "fake"}


@dataclass
class Checkpoint:
    id: str
    steps: list[dict[str, Any]]
    timeout: float
    expect: list[str]
    capture: bool
    send_to_ai: bool
    description: str = ""


@dataclass
class Spec:
    path: Path
    raw: dict[str, Any]
    game: str
    target: dict[str, Any]
    input: str
    capture: str
    language: str
    build: str
    key_pattern: str | None
    strings: Path | None
    retries: int
    settle_ms: int
    checkpoints: list[Checkpoint] = field(default_factory=list)

    @property
    def base_dir(self) -> Path:
        return self.path.parent

    def resolve(self, rel: str) -> Path:
        p = Path(rel).expanduser()
        return p if p.is_absolute() else (self.base_dir / p).resolve()


def load(path: str | Path) -> Spec:
    path = Path(path).resolve()
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    schemas.validate(SCHEMA, raw, f"checkpoint spec {path.name}")
    target = raw["target"]
    kind = target["kind"]
    inp = raw.get("input") or DEFAULT_INPUT.get(kind)
    cap = raw.get("capture") or DEFAULT_CAPTURE.get(kind)
    if not inp or not cap:
        raise ValueError(f"{path.name}: target kind '{kind}' needs explicit 'input' and 'capture'")
    if (kind == "browser") != (inp == "playwright") or (kind == "browser") != (cap == "playwright"):
        raise ValueError(f"{path.name}: browser targets use input/capture 'playwright', and only they do")
    if (kind == "fake") != (inp == "fake" and cap == "fake"):
        raise ValueError(f"{path.name}: fake targets use input/capture 'fake', and only they do")
    d = raw.get("defaults", {})
    cps = []
    seen = set()
    for c in raw["checkpoints"]:
        if c["id"] in seen:
            raise ValueError(f"{path.name}: duplicate checkpoint id '{c['id']}'")
        seen.add(c["id"])
        cps.append(
            Checkpoint(
                id=c["id"],
                steps=c.get("steps", []),
                timeout=float(c.get("timeout", d.get("timeout", 30))),
                expect=c.get("expect", []),
                capture=c.get("capture", True),
                send_to_ai=c.get("sendToAi", True),
                description=c.get("description", ""),
            )
        )
    spec = Spec(
        path=path,
        raw=raw,
        game=raw["game"],
        target=target,
        input=inp,
        capture=cap,
        language=raw.get("language", "en"),
        build=raw.get("build", "unknown"),
        key_pattern=raw.get("keyPattern"),
        strings=None,
        retries=int(d.get("retries", 1)),
        settle_ms=int(d.get("settleMs", 300)),
        checkpoints=cps,
    )
    if raw.get("strings"):
        spec.strings = spec.resolve(raw["strings"])
    return spec
