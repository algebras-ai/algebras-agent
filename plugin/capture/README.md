# Screenshot capture

Captures screenshots of a playable build, links each one to the source strings
it shows, and writes a manifest the platform can import. The agent writes a
checkpoint spec when a client has a playable build, and runs it only when the
user explicitly allows it (see `CONTEXT_REQUIREMENTS.md`).

## Install

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e '.[ocr,browser]'      # browser builds; add 'desktop' for desktop games
playwright install chromium          # browser builds only
```

OCR linking needs the `tesseract` binary on `PATH`.

## Commands

```bash
python -m algebras_capture validate examples/browser-demo.checkpoints.yaml
python -m algebras_capture run examples/browser-demo.checkpoints.yaml --out runs/demo
python -m algebras_capture link runs/demo --strings strings.json
python -m algebras_capture stability runs/demo runs/demo-2
node upload-screenshots.mjs --manifest runs/demo/manifest.json --project <projectId>
```

- `run` launches or attaches to the target, plays each checkpoint's steps,
  waits for the expected screen, saves a PNG, then links it to strings by OCR.
  `--no-link` skips linking and `--no-launch` attaches to a running game.
- `link` links an existing run again, for example against updated strings.
- `stability` compares two runs of the same spec, checkpoint by checkpoint.
- `upload-screenshots.mjs` sends the manifest and images to
  `POST /api/v1/context/projects/{id}/screenshots`, which stores them and links
  them to the project's strings.

## Checkpoint spec

A YAML file validated by `checkpoint.schema.json`. `examples/browser-demo.checkpoints.yaml`
runs against `fixtures/browser-demo/`, a canvas-drawn game screen.

- `target`: `browser` (a URL), `exe` (a command), `steam` (an app id), `window`
  (attach to a running window) or `fake` (fixed frames, for tests).
- `input` and `capture` default per target: Playwright for browsers;
  PyAutoGUI, PyDirectInput, xdotool, ydotool or vgamepad with mss or dxcam for
  desktop games.
- `strings`: a JSON `{key: text}` file or a CSV/TSV with `key,text[,row]`.
  `keyPattern` such as `lines.csv#row-{row}` builds keys from rows.
- Each checkpoint has steps (keys, clicks, typed text, gamepad buttons, sleeps,
  and waits for on-screen text, a template image, a CSS selector in browsers or
  a still screen) and the string keys it `expect`s, which the linker prefers.

## Manifest

`manifest.json`, validated by `manifest.schema.json`: the run id, game, build,
language and resolution, and per screenshot its file, SHA-256, linked string
keys and rows, match method and confidence per key, and whether it may be
sent to an AI model. The platform identifies a screenshot by run id plus its
id, so uploading a run again replaces its images and links.

## Tests

```bash
pip install -e '.[test]' && pytest
```

The tests need no browser, desktop or OCR.
