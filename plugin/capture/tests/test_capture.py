"""Checks that need no browser, desktop or OCR."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from algebras_capture import manifest as mf
from algebras_capture import schemas
from algebras_capture import spec as spec_mod
from algebras_capture.link.match import Matcher
from algebras_capture.link.strings import SourceString, load_strings, normalize

HERE = Path(__file__).resolve().parent.parent


def test_normalize_drops_markup_placeholders_and_punctuation():
    assert normalize("<b>Hello</b>, {name}! It’s…") == "hello its"


def test_load_strings_reads_json_and_csv(tmp_path):
    (tmp_path / "s.json").write_text('{"menu.start": "Start", "menu.quit": "Quit"}')
    (tmp_path / "s.csv").write_text("key,text,row\nui#1,Start game,1\n,Ignored,\n")
    assert [s.key for s in load_strings(tmp_path / "s.json")] == ["menu.start", "menu.quit"]
    rows = load_strings(tmp_path / "s.csv")
    assert [(s.key, s.text, s.row) for s in rows] == [("ui#1", "Start game", 1)]


def test_load_strings_fills_keys_from_a_row_pattern(tmp_path):
    (tmp_path / "s.csv").write_text("text,row\nHello there,7\n")
    rows = load_strings(tmp_path / "s.csv", key_pattern="lines.csv#row-{row}")
    assert rows[0].key == "lines.csv#row-7"


def test_matcher_links_ocr_lines_to_strings():
    matcher = Matcher(
        [
            SourceString("menu.new", "New Game"),
            SourceString("menu.exit", "Exit Game"),
            SourceString("intro.1", "The lanterns go out one by one tonight."),
        ]
    )
    keys = {link.key for link in matcher.match_text(["NEW GAME", "Exit Game", "the lanterns go out one by one tonight"])}
    assert keys == {"menu.new", "menu.exit", "intro.1"}


def test_example_spec_is_valid():
    spec = spec_mod.load(HERE / "examples" / "browser-demo.checkpoints.yaml")
    assert [c.id for c in spec.checkpoints][:2] == ["title", "main_menu"]


def test_built_manifest_validates_and_hashes_its_images(tmp_path):
    image = tmp_path / "001_title.png"
    Image.new("RGB", (64, 36)).save(image)
    entry = mf.screenshot_entry(
        tmp_path, image, "title", [{"key": "ui#title", "score": 0.97, "ocrText": "TITLE"}], "ocr-tesseract+fuzzy", size=(64, 36)
    )
    doc = mf.build(run_id="test run", game="Demo", build="1", language="en", resolution="64x36", screenshots=[entry])
    mf.validate(doc, tmp_path)
    assert doc["screenshots"][0]["stringKeys"] == ["ui#title"]

    image.write_bytes(b"changed")
    with pytest.raises((schemas.ValidationFailed, ValueError)):
        mf.validate(doc, tmp_path)
