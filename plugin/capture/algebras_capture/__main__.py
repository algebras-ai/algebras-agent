"""CLI: python -m algebras_capture <command> ...

  run SPEC --out DIR          run a checkpoint spec unattended, write PNGs + manifest.json
  link DIR --strings PATH     (re)link the screenshots of a run against source strings
  validate FILE               validate a checkpoint spec (.yaml) or a manifest (.json)
  stability RUN_A RUN_B       compare two runs of the same spec (SSIM per checkpoint)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import manifest as mf
from . import schemas
from . import spec as spec_mod


def cmd_run(a) -> int:
    from .runner import run_spec

    sp = spec_mod.load(a.spec)
    out = Path(a.out) if a.out else Path("runs") / mf.new_run_id(sp.path.stem.split(".")[0])
    res = run_spec(sp, out, run_id=a.run_id, link=not a.no_link, headless=not a.headed, launch_target=not a.no_launch)
    print(f"\n{'OK' if res.ok else 'FAILED'}: {len(res.captured)} screenshot(s) in {out}")
    if res.manifest_path:
        print(f"manifest: {res.manifest_path}")
    if not res.ok:
        print(res.failed or res.error, file=sys.stderr)
    return 0 if res.ok else 1


def cmd_link(a) -> int:
    from PIL import Image

    from .link import ocr
    from .link.match import Matcher
    from .link.strings import load_strings

    out = Path(a.dir)
    doc = json.loads((out / mf.MANIFEST_NAME).read_text(encoding="utf-8"))
    pattern = a.key_pattern or doc.get("keyPattern")
    matcher = Matcher(load_strings(Path(a.strings), pattern), threshold=a.threshold)
    for s in doc["screenshots"]:
        p = out / s["file"]
        links = [l.as_dict() for l in matcher.match_lines(ocr.ocr_lines(Image.open(p)))]
        new = mf.screenshot_entry(out, p, s["checkpoint"], links, "ocr-tesseract+fuzzy", s["sendToAi"], (s.get("width"), s.get("height")) if s.get("width") else None)
        s.update({k: new[k] for k in ("stringKeys", "rows", "match", "sha256")})
        print(f"{s['file']}: {len(s['stringKeys'])} key(s)")
    if pattern:
        doc["keyPattern"] = pattern
    mf.write(doc, out)
    return 0


def cmd_validate(a) -> int:
    p = Path(a.file)
    try:
        if p.suffix in (".yaml", ".yml"):
            sp = spec_mod.load(p)
            print(f"OK: checkpoint spec, {len(sp.checkpoints)} checkpoint(s)")
        else:
            doc = json.loads(p.read_text(encoding="utf-8"))
            mf.validate(doc, p.parent if not a.schema_only else None)
            linked = sum(1 for s in doc["screenshots"] if s["stringKeys"])
            print(f"OK: manifest v{doc['manifestVersion']}, {len(doc['screenshots'])} screenshot(s), {linked} with string keys")
    except (schemas.ValidationFailed, ValueError) as e:
        print(e, file=sys.stderr)
        return 1
    return 0


def cmd_stability(a) -> int:
    from .stability import compare

    r = compare(Path(a.run_a), Path(a.run_b), a.min_ssim)
    for row in r["checkpoints"]:
        print(f"{row['checkpoint']:<24} {row.get('status'):<8} ssim={row.get('ssim')} dhash={row.get('dhashDistance')} identical={row.get('identical')}")
    print("STABLE" if r["stable"] else "DIFFERS")
    if a.json:
        Path(a.json).write_text(json.dumps(r, indent=2) + "\n")
    return 0 if r["stable"] else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="algebras_capture", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="run a checkpoint spec")
    r.add_argument("spec")
    r.add_argument("--out", help="output dir (default runs/<spec>-<timestamp>)")
    r.add_argument("--run-id")
    r.add_argument("--no-link", action="store_true", help="skip OCR linking")
    r.add_argument("--no-launch", action="store_true", help="attach to an already running game")
    r.add_argument("--headed", action="store_true", help="browser targets: show the browser")
    r.set_defaults(fn=cmd_run)

    l = sub.add_parser("link", help="re-link a run's screenshots")
    l.add_argument("dir")
    l.add_argument("--strings", required=True)
    l.add_argument("--key-pattern")
    l.add_argument("--threshold", type=float, default=0.85)
    l.set_defaults(fn=cmd_link)

    v = sub.add_parser("validate", help="validate a spec or manifest")
    v.add_argument("file")
    v.add_argument("--schema-only", action="store_true", help="manifest: skip file/hash checks")
    v.set_defaults(fn=cmd_validate)

    s = sub.add_parser("stability", help="compare two runs")
    s.add_argument("run_a")
    s.add_argument("run_b")
    s.add_argument("--min-ssim", type=float, default=0.98)
    s.add_argument("--json")
    s.set_defaults(fn=cmd_stability)

    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
