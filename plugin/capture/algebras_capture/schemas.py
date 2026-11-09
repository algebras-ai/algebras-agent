"""Load and apply the JSON Schemas that live next to the package (plugin/capture/*.schema.json)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

SCHEMA_DIR = Path(__file__).resolve().parent.parent


class ValidationFailed(ValueError):
    def __init__(self, what: str, errors: list[str]):
        self.errors = errors
        super().__init__(f"{what} is invalid:\n  - " + "\n  - ".join(errors))


@lru_cache(maxsize=None)
def _validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def errors(name: str, doc: Any) -> list[str]:
    out = []
    for e in sorted(_validator(name).iter_errors(doc), key=lambda e: list(e.path)):
        where = "/".join(str(p) for p in e.path) or "<root>"
        out.append(f"{where}: {e.message}")
    return out


def validate(name: str, doc: Any, what: str) -> None:
    errs = errors(name, doc)
    if errs:
        raise ValidationFailed(what, errs)
