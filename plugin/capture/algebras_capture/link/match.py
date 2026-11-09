"""Fuzzy-match OCR text against source strings.

Scoring per source string (normalized text s, OCR blob b = all OCR lines joined):
  - len(s) < SHORT (4): an OCR line must equal s exactly.
  - len(s) < WORD (25): best fuzz.ratio against whole OCR lines (UI labels sit on their own line;
    a word inside a sentence does not count). Tolerates 1-2 OCR character errors.
  - longer: fuzz.partial_ratio(s, b), so text wrapped over several lines still matches. When
    b is much shorter than s, plain fuzz.ratio is used to avoid "tiny blob inside a long string".

Each candidate claims the span of b it matched. A short link is also dropped when a longer candidate
(score >= threshold - 0.1) starts or ends with its text at that edge of the span: the tail of a
wrapped line, or a prefix of a longer objective (see match_text). Candidates are accepted best-first; one whose
span is already mostly claimed by an accepted, *different* text is dropped ("Help" inside "Help
Leah"; "...about Mom" competing with "...about Leah" for the same line). Strings whose normalized
text equals an accepted one ("OK" / "OK..." / "(OK.)") cannot be told apart on screen; they are kept
and flagged `duplicateOf`.

Strings listed in the checkpoint's `expect:` get +0.05 and a 0.1 lower threshold.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

from rapidfuzz import fuzz, process

from .ocr import OcrLine
from .strings import SourceString, normalize

SHORT = 4
WORD = 25
OVERLAP = 0.5
SUPPRESS_MARGIN = 0.1


@dataclass
class Link:
    key: str
    row: int | None
    score: float  # 0..1
    text: str
    ocr: str
    duplicate_of: str | None = None
    spans: list[tuple[int, int]] = field(default_factory=list, repr=False)

    def as_dict(self) -> dict:
        d = {"key": self.key, "row": self.row, "score": self.score, "ocrText": self.ocr}
        if self.duplicate_of:
            d["duplicateOf"] = self.duplicate_of
        return d


class Matcher:
    def __init__(self, strings: Iterable[SourceString], threshold: float = 0.85, max_links: int = 25):
        self.strings = [s for s in strings if normalize(s.text)]
        self.norm = [normalize(s.text) for s in self.strings]
        self.threshold = threshold
        self.max_links = max_links
        self.long_idx = [i for i, n in enumerate(self.norm) if len(n) >= WORD]
        self.mid_idx = [i for i, n in enumerate(self.norm) if SHORT <= len(n) < WORD]
        self.short_idx = [i for i, n in enumerate(self.norm) if len(n) < SHORT]

    def candidates(self, lines: list[str]) -> tuple[str, list[tuple[int, float, list[tuple[int, int]]]]]:
        norm_lines = [n for n in (normalize(l) for l in lines) if n]
        blob = " ".join(norm_lines)
        if not blob:
            return blob, []
        offsets, pos = [], 0
        for n in norm_lines:
            offsets.append((pos, pos + len(n)))
            pos += len(n) + 1
        out: list[tuple[int, float, list[tuple[int, int]]]] = []

        for i in self.short_idx:
            spans = [offsets[k] for k, n in enumerate(norm_lines) if n == self.norm[i]]
            if spans:
                out.append((i, 1.0, spans))

        if self.mid_idx:
            # UI labels sit on their own line: a string under WORD chars must match a whole OCR line,
            # never words inside a sentence ("Back" in "...the back of the classroom", "My
            # Neighborhood" in "...in the neighborhood"). Tolerates OCR character errors via ratio.
            sim = process.cdist([self.norm[i] for i in self.mid_idx], norm_lines, scorer=fuzz.ratio)
            for j, i in enumerate(self.mid_idx):
                exact = [offsets[k] for k, n in enumerate(norm_lines) if n == self.norm[i]]
                if exact:
                    out.append((i, 1.0, exact))
                else:
                    k = int(sim[j].argmax())
                    out.append((i, float(sim[j][k]) / 100.0, [offsets[k]]))

        if self.long_idx:
            longs = [self.norm[i] for i in self.long_idx]
            pr = process.cdist(longs, [blob], scorer=fuzz.partial_ratio)[:, 0]
            rr = process.cdist(longs, [blob], scorer=fuzz.ratio)[:, 0]
            for j, i in enumerate(self.long_idx):
                if len(blob) < 0.8 * len(self.norm[i]):
                    out.append((i, float(rr[j]) / 100.0, [(0, len(blob))]))
                elif pr[j] >= 60:
                    al = fuzz.partial_ratio_alignment(self.norm[i], blob)
                    out.append((i, float(pr[j]) / 100.0, [(al.dest_start, al.dest_end)]))
        return blob, out

    def match_text(self, lines: list[str], expect: Iterable[str] = ()) -> list[Link]:
        blob, cands = self.candidates(lines)
        want = {normalize(e) for e in expect} | set(expect)
        scored = []
        for i, sc, spans in cands:
            s = self.strings[i]
            thr = self.threshold
            if s.key in want or self.norm[i] in want:
                sc, thr = min(1.0, sc + 0.05), thr - 0.1
            if sc >= thr:
                scored.append((round(sc, 4), i, spans))
        scored.sort(key=lambda t: (-t[0], -len(self.norm[t[1]]), self.strings[t[1]].row or 0))

        accepted: list[Link] = []
        by_text: dict[str, Link] = {}
        claimed: list[tuple[int, int]] = []
        for sc, i, spans in scored:
            s, n = self.strings[i], self.norm[i]
            if n in by_text:
                first = by_text[n]
                accepted.append(Link(s.key, s.row, sc, s.text, first.ocr, duplicate_of=first.key, spans=spans))
                continue
            free = [sp for sp in spans if _covered(sp, claimed) < OVERLAP]
            if not free:
                continue
            link = Link(s.key, s.row, sc, s.text, blob[free[0][0] : free[0][1]].strip(), spans=free)
            accepted.append(link)
            by_text[n] = link
            claimed.extend(free)

        # Second pass: a plausible longer candidate (score >= threshold - margin, accepted or not) that
        # starts or ends with a short link's text, at that edge of its span, explains it: the tail of a
        # wrapped line ("...my / notebook.)") or a prefix ("Form an Insight" of "Form an INSIGHT about
        # ..."). A candidate whose span is mostly claimed by *other* accepted links is discredited
        # (a "Hope, ..." line aligned over the speaker label "Hope" plus someone else's dialogue).
        plausible = [(self.norm[i], sp) for i, sc, spans in cands if sc >= self.threshold - SUPPRESS_MARGIN for sp in spans]
        dropped: set[str] = set()
        for link in accepted:
            n = _norm_cached(link.text)
            if link.duplicate_of:
                continue
            others = [sp for o in accepted if o is not link and _norm_cached(o.text) != n for sp in o.spans]
            for t, lsp in plausible:
                if len(t) <= len(n) + 2 or not any(_edge_of(n, sp, t, lsp) for sp in link.spans):
                    continue
                own = [sp for o in accepted if _norm_cached(o.text) == t for sp in o.spans]
                rest = [sp for sp in others if sp not in own]
                if _covered(lsp, rest) < OVERLAP:
                    dropped.add(link.key)
                    break
        keep_texts = {_norm_cached(l.text) for l in accepted if l.key not in dropped and not l.duplicate_of}
        accepted = [l for l in accepted if l.key not in dropped and (not l.duplicate_of or _norm_cached(l.text) in keep_texts)]
        return accepted[: self.max_links]

    def match_lines(self, lines: list[OcrLine], expect: Iterable[str] = ()) -> list[Link]:
        return self.match_text([l.text for l in lines], expect)


_NORM: dict[str, str] = {}


def _norm_cached(text: str) -> str:
    n = _NORM.get(text)
    if n is None:
        n = _NORM[text] = normalize(text)
    return n


def _edge_of(short: str, span: tuple[int, int], longer: str, lspan: tuple[int, int], slack: int = 3) -> bool:
    """True when `short` is the first or last words of `longer` and sits at that edge of its span:
    the tail of a wrapped line, or a prefix such as "Form an Insight" of "Form an INSIGHT about ..."."""
    if _covered(span, [lspan]) < OVERLAP:
        return False
    if longer.startswith(short + " ") and abs(span[0] - lspan[0]) <= slack:
        return True
    return longer.endswith(" " + short) and abs(span[1] - lspan[1]) <= slack


def _covered(span: tuple[int, int], claimed: list[tuple[int, int]]) -> float:
    a, b = span
    if b <= a:
        return 1.0
    hit = 0
    for x in range(a, b):
        if any(c0 <= x < c1 for c0, c1 in claimed):
            hit += 1
    return hit / (b - a)
