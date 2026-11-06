"""Run a checkpoint spec unattended: launch, reach each checkpoint, capture, link, write the manifest.

No human input is read anywhere in a run. A checkpoint fails when a wait times out after its
retries (the input step before the wait is re-sent, for games that drop an input during a
transition); the run then stops, keeps what it captured, and exits non-zero.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import manifest as mf
from .backends.base import BackendUnavailable, Session, key_name
from .link import ocr
from .link.match import Matcher
from .link.strings import SourceString, load_strings, normalize
from .spec import Checkpoint, Spec
from .waits import load_template, poll, template_score, text_score, wait_stable

INPUT_STEPS = ("key", "keys", "click", "type", "gamepad")


class CheckpointFailed(RuntimeError):
    pass


@dataclass
class RunResult:
    out_dir: Path
    manifest_path: Path | None
    captured: list[str] = field(default_factory=list)
    failed: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.failed is None and self.error is None


class Log:
    def __init__(self, path: Path, echo: bool = True):
        self.f = open(path, "a", encoding="utf-8")
        self.t0 = time.monotonic()
        self.echo = echo

    def __call__(self, event: str, checkpoint: str | None = None, **kw: Any) -> None:
        rec = {"t": round(time.monotonic() - self.t0, 3), "event": event}
        if checkpoint:
            rec["checkpoint"] = checkpoint
        rec.update(kw)
        self.f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.f.flush()
        if self.echo:
            extra = " ".join(f"{k}={v}" for k, v in kw.items())
            print(f"[{rec['t']:7.2f}s] {event:<14} {checkpoint or '':<20} {extra}")

    def close(self):
        self.f.close()


def make_session(spec: Spec, headless: bool = True) -> Session:
    t = spec.target
    if t["kind"] == "fake":
        from .backends.fake import FakeSession

        return FakeSession([spec.resolve(f) for f in t["frames"]])
    if t["kind"] == "browser":
        from .backends.playwright_backend import PlaywrightSession, resolve_url

        return PlaywrightSession(resolve_url(t["url"], spec.base_dir), t.get("viewport", "1280x720"), headless=headless)
    from .backends.desktop import DesktopSession

    timeout = float(t.get("startupTimeout", 120)) if t["kind"] in ("steam", "exe") else 5
    return DesktopSession(spec.input, spec.capture, t.get("windowTitle"), window_timeout=timeout)


class Runner:
    def __init__(self, spec: Spec, out_dir: Path, session: Session, run_id: str | None = None, link: bool = True, echo: bool = True):
        self.spec = spec
        self.out = Path(out_dir)
        self.session = session
        self.run_id = run_id or mf.new_run_id(spec.path.stem.split(".")[0])
        self.link = link
        self.echo = echo
        self.templates: dict[str, Any] = {}

    # --- steps --------------------------------------------------------------------------------

    def _input(self, step: dict) -> None:
        s = self.session
        if "key" in step:
            name, hold, rep = key_name(step["key"])
            for _ in range(rep):
                s.key(name, hold)
        elif "keys" in step:
            for k in step["keys"]:
                name, hold, rep = key_name(k)
                for _ in range(rep):
                    s.key(name, hold)
                    time.sleep(0.05)
        elif "click" in step:
            c = step["click"]
            s.click(c["x"], c["y"], c.get("relative", True), c.get("button", "left"))
        elif "type" in step:
            s.type_text(step["type"])
        elif "gamepad" in step:
            s.gamepad(step["gamepad"]["button"], step["gamepad"].get("holdMs", 80))

    def _wait(self, w: dict, budget: float) -> tuple[bool, float, str]:
        timeout = min(float(w.get("timeout", budget)), budget)
        if "selector" in w:
            return self.session.wait_selector(w["selector"], timeout), 1.0, f"selector {w['selector']}"
        if "text" in w:
            if not ocr.available():
                raise BackendUnavailable("wait.text needs OCR: `pip install -e '.[ocr]'` and the tesseract binary")
            ok, sc = poll(lambda: text_score(self.session.grab(), w["text"]), float(w.get("confidence", 0.85)), timeout, 0.5)
            return ok, sc, f"text '{w['text']}'"
        if "image" in w:
            p = self.spec.resolve(w["image"])
            tpl = self.templates.setdefault(str(p), load_template(p))
            ok, sc = poll(lambda: template_score(self.session.grab(), tpl), float(w.get("confidence", 0.85)), timeout, 0.3)
            return ok, sc, f"image {p.name}"
        if w.get("stable"):
            return wait_stable(self.session.grab, self.spec.settle_ms, timeout), 1.0, "stable"
        return True, 1.0, "noop"

    def reach(self, cp: Checkpoint, log: Log) -> None:
        deadline = time.monotonic() + cp.timeout
        last_input: dict | None = None
        for n, step in enumerate(cp.steps):
            budget = max(0.0, deadline - time.monotonic())
            if any(k in step for k in INPUT_STEPS):
                self._input(step)
                last_input = step
                log("step", cp.id, n=n, step=next(iter(step)))
            elif "sleep" in step:
                time.sleep(float(step["sleep"]))
            elif "wait" in step:
                for attempt in range(self.spec.retries + 1):
                    budget = max(0.0, deadline - time.monotonic())
                    ok, score, what = self._wait(step["wait"], budget / (self.spec.retries + 1 - attempt))
                    log("wait", cp.id, n=n, what=what, ok=ok, score=round(score, 3), attempt=attempt)
                    if ok:
                        break
                    if attempt < self.spec.retries and last_input is not None:
                        log("retry", cp.id, n=n, resend=next(iter(last_input)))
                        self._input(last_input)
                else:
                    raise CheckpointFailed(f"checkpoint '{cp.id}': {what} not reached (best score {score:.2f})")
        if self.spec.settle_ms:
            wait_stable(self.session.grab, self.spec.settle_ms, max(1.0, min(5.0, deadline - time.monotonic())))

    # --- linking ------------------------------------------------------------------------------

    def _strings(self) -> list[SourceString]:
        if not self.spec.strings:
            return []
        return load_strings(self.spec.strings, self.spec.key_pattern)

    def _links(self, img_path: Path, cp: Checkpoint, matcher: Matcher | None, strings: list[SourceString], log: Log) -> tuple[list[dict], str]:
        by_key = {s.key: s for s in strings}
        by_text = {}
        for s in strings:
            by_text.setdefault(normalize(s.text), s)
        expected = []
        for e in cp.expect:
            s = by_key.get(e) or by_text.get(normalize(e))
            if s:
                expected.append(s)
            else:
                log("expect-unknown", cp.id, value=e)
        if matcher is not None:
            from PIL import Image

            lines = ocr.ocr_lines(Image.open(img_path))
            links = matcher.match_lines(lines, expect=[s.key for s in expected])
            got = {l.key for l in links}
            missing = [s.key for s in expected if s.key not in got]
            if missing:
                log("expect-missing", cp.id, keys=missing)
            return [l.as_dict() for l in links], "ocr-tesseract+fuzzy"
        return [{"key": s.key, "row": s.row, "score": 1.0} for s in expected], "expected"

    # --- run ----------------------------------------------------------------------------------

    def run(self) -> RunResult:
        self.out.mkdir(parents=True, exist_ok=True)
        log = Log(self.out / "run.log.jsonl", echo=self.echo)
        result = RunResult(self.out, None)
        shots: list[tuple[Checkpoint, Path, tuple[int, int]]] = []
        resolution = None
        log("start", run=self.run_id, spec=str(self.spec.path), input=self.spec.input, capture=self.spec.capture)
        try:
            with self.session:
                self._after_start(log)
                for i, cp in enumerate(self.spec.checkpoints, 1):
                    log("checkpoint", cp.id, index=i)
                    self.reach(cp, log)
                    if not cp.capture:
                        continue
                    img = self.session.grab()
                    resolution = resolution or f"{img.width}x{img.height}"
                    p = self.out / f"{i:03d}_{cp.id}.png"
                    img.save(p, optimize=False)
                    shots.append((cp, p, img.size))
                    result.captured.append(cp.id)
                    log("captured", cp.id, file=p.name, size=f"{img.width}x{img.height}")
        except CheckpointFailed as e:
            result.failed = str(e)
            log("failed", error=str(e))
        except (BackendUnavailable, TimeoutError, OSError) as e:
            result.error = f"{type(e).__name__}: {e}"
            log("error", error=result.error)

        strings = self._strings() if self.link else []
        matcher = Matcher(strings) if strings and ocr.available() else None
        if strings and matcher is None:
            log("link-fallback", reason="OCR unavailable; linking only checkpoint `expect:` keys")
        entries = []
        for cp, p, size in shots:
            links, method = self._links(p, cp, matcher, strings, log) if self.link else ([], "none")
            entries.append(mf.screenshot_entry(self.out, p, cp.id, links, method, cp.send_to_ai, size))
            log("linked", cp.id, keys=len(links), method=method)
        if entries:
            doc = mf.build(
                run_id=self.run_id,
                game=self.spec.game,
                build=self.spec.build,
                language=self.spec.language,
                resolution=resolution or "0x0",
                screenshots=entries,
                steam_app_id=self.spec.target.get("steamAppId"),
                key_pattern=self.spec.key_pattern,
                tool_input=self.spec.input,
                tool_capture=self.spec.capture,
                extra={"spec": self.spec.path.name, "complete": result.ok, **({"failed": result.failed or result.error} if not result.ok else {})},
            )
            result.manifest_path = mf.write(doc, self.out)
        log("done", ok=result.ok, captured=len(shots), of=sum(1 for c in self.spec.checkpoints if c.capture))
        log.close()
        return result

    def _after_start(self, log: Log) -> None:
        """Windowed-mode check for desktop targets."""
        from .backends.desktop import DesktopSession, primary_monitor
        from .launch import check_windowed

        if isinstance(self.session, DesktopSession) and self.session.title:
            for w in check_windowed(self.session.rect, primary_monitor(), self.spec.target.get("resolution")):
                log("warning", message=w)


def run_spec(spec: Spec, out_dir: Path, run_id: str | None = None, link: bool = True, headless: bool = True, launch_target: bool = True, echo: bool = True) -> RunResult:
    from .launch import launch

    if launch_target:
        launch(spec.target, spec.base_dir)
    return Runner(spec, out_dir, make_session(spec, headless=headless), run_id, link, echo).run()
