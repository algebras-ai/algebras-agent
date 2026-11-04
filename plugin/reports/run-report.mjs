#!/usr/bin/env node
// Checks a translation run from the agent's logs and prints a report.
//
//   node run-report.mjs [--project <dir>] [--json] [--details]
//
// Reads, under <dir>/tools/ (each file is optional):
//   tm_hits.jsonl            translation memory matches (translate 3.2.0)
//   translate_calls.jsonl    one line per translate / record / review call
//   glossary_pass.jsonl      the final glossary pass (translate 3.5)
//   glossary_compliance.json compliance before/after 3.5, as the agent wrote it
//
// Reports TM hits per language, TM-hit strings sent to a translate call
// (must be 0), written strings never recorded on the platform, review
// outcomes, glossary compliance before and after 3.5 recomputed from the pass
// log and compared with glossary_compliance.json, and strings the pass left
// open. Output holds counts only; --details adds string ids (never text).
// Strings are matched by (file, id, target language), compared as opaque
// strings, so any file format and id scheme works.
//
// Exit code: 0 pass, 1 a check failed, 2 bad arguments or unreadable input.
// Node 18+, no dependencies.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TRANSLATE_STEPS = new Set(["1", "3", "fix", "3.5"]);
const PASS_STATUSES = ["ok", "miss", "fixed", "accepted", "user"];
const COMPLIANCE_FIELDS = [
  "strings_with_terms",
  "miss",
  "compliant_pct",
  "occurrences_found",
  "occurrences_source",
  "occurrences_pct",
];
const PCT_TOLERANCE = 0.1;

export class InputError extends Error {}

export function stringKey(file, id, lang) {
  return JSON.stringify([file ?? "", String(id), lang ?? ""]);
}

function keyParts(key) {
  const [file, id, lang] = JSON.parse(key);
  return { file, id, lang };
}

export function parseJsonl(text, name) {
  const rows = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new InputError(`${name}:${i + 1}: not valid JSON`);
    }
  });
  return rows;
}

export function loadRun(projectDir) {
  const tools = join(projectDir, "tools");
  const read = (name) => {
    const path = join(tools, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const jsonl = (name) => {
    const text = read(name);
    return text === null ? null : parseJsonl(text, name);
  };
  const complianceText = read("glossary_compliance.json");
  let compliance = null;
  if (complianceText !== null) {
    try {
      compliance = JSON.parse(complianceText);
    } catch {
      throw new InputError("glossary_compliance.json: not valid JSON");
    }
  }
  return {
    tmHits: jsonl("tm_hits.jsonl"),
    calls: jsonl("translate_calls.jsonl"),
    pass: jsonl("glossary_pass.jsonl"),
    compliance,
  };
}

function bump(obj, ...path) {
  let cur = obj;
  for (const k of path.slice(0, -1)) cur = cur[k] ??= {};
  const last = path[path.length - 1];
  cur[last] = (cur[last] ?? 0) + 1;
}

function callStrings(call) {
  return (call.strings ?? []).map((s) =>
    stringKey(s.file, s.id, call.targetLang)
  );
}

function isTranslateCall(call) {
  return (
    TRANSLATE_STEPS.has(String(call.step)) &&
    call.tool !== "record_translations" &&
    call.tool !== "set_translation_status"
  );
}

function isRecordCall(call) {
  return call.tool === "record_translations";
}

// The last line per string wins (the logs are updated in place, but an
// appended correction should still count).
function lastByKey(rows, lang = (r) => r.targetLang) {
  const map = new Map();
  for (const r of rows ?? []) map.set(stringKey(r.file, r.id, lang(r)), r);
  return map;
}

export function summarizeTmHits(tmHits) {
  const byLang = {};
  for (const hit of lastByKey(tmHits).values()) {
    bump(byLang, hit.targetLang, "action", hit.action ?? "unknown");
    bump(byLang, hit.targetLang, "review", hit.review ?? "unknown");
  }
  return byLang;
}

// A TM-hit string may reach a translate call only when it has to:
// - `rejected-glossary` hits are misses and are translated like any miss;
// - `retranslated` hits get a single-string step-3 fix (`fix`) and may be
//   fixed again in the final glossary pass (`3.5`);
// - `written` unreviewed hits may be fixed in the final glossary pass;
// - `written` approved hits never go to a translate call.
export function findLeaks(tmHits, calls) {
  const hits = lastByKey(tmHits);
  const leaks = [];
  for (const call of calls ?? []) {
    if (!isTranslateCall(call)) continue;
    const step = String(call.step);
    for (const key of callStrings(call)) {
      const hit = hits.get(key);
      if (!hit) continue;
      let reason = null;
      if (hit.action === "written") {
        if (hit.review === "approved") reason = "approved match sent to translation";
        else if (step !== "3.5") reason = "written match sent to translation";
      } else if (hit.action === "retranslated") {
        if (step !== "fix" && step !== "3.5") reason = "failed draft sent in a batch step";
      }
      if (reason) leaks.push({ key, step, tool: call.tool, reason });
    }
  }
  return leaks;
}

// Written strings: TM matches written as is or re-translated, and every
// string in a step-3, fix or 3.5 call. Each must appear in a
// record_translations call. An approved TM match that is already the
// string's own approved translation is not recorded again, so unrecorded
// approved matches are listed separately and don't fail the check.
export function checkRecording(tmHits, calls) {
  const hits = lastByKey(tmHits);
  const written = new Set();
  for (const [key, hit] of hits) {
    if (hit.action === "written" || hit.action === "retranslated") written.add(key);
  }
  const recorded = new Set();
  for (const call of calls ?? []) {
    const step = String(call.step);
    if (isRecordCall(call)) callStrings(call).forEach((k) => recorded.add(k));
    else if (isTranslateCall(call) && step !== "1") {
      callStrings(call).forEach((k) => written.add(k));
    }
  }
  const unrecorded = [];
  const approvedNotRecorded = [];
  for (const key of written) {
    if (recorded.has(key)) continue;
    const hit = hits.get(key);
    if (hit?.action === "written" && hit.review === "approved") approvedNotRecorded.push(key);
    else unrecorded.push(key);
  }
  const byLang = {};
  for (const key of written) {
    const { lang } = keyParts(key);
    bump(byLang, lang, "written");
    if (recorded.has(key)) bump(byLang, lang, "recorded");
  }
  return {
    written: written.size,
    recorded: written.size - unrecorded.length - approvedNotRecorded.length,
    unrecorded,
    approvedNotRecorded,
    byLang,
  };
}

export function summarizeReview(calls) {
  const byLang = {};
  for (const call of calls ?? []) {
    if (String(call.step) !== "review") continue;
    const n = (call.strings ?? []).length;
    let outcome = null;
    if (call.tool === "set_translation_status") outcome = call.status;
    else if (isRecordCall(call) && call.origin === "manual") outcome = "manual";
    if (!outcome) continue;
    byLang[call.targetLang] ??= {};
    byLang[call.targetLang][outcome] = (byLang[call.targetLang][outcome] ?? 0) + n;
  }
  return byLang;
}

function sideNumbers(records) {
  let withTerms = 0;
  let miss = 0;
  let found = 0;
  let source = 0;
  for (const side of records) {
    const terms = (side?.terms ?? []).filter((t) => (t.sourceCount ?? 0) > 0);
    if (!terms.length) continue;
    withTerms++;
    const missed = terms.some((t) => (t.targetCount ?? 0) === 0);
    if (missed) miss++;
    for (const t of terms) {
      source += t.sourceCount;
      found += Math.min(t.targetCount ?? 0, t.sourceCount);
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    strings_with_terms: withTerms,
    miss,
    compliant_pct: pct(withTerms - miss, withTerms),
    occurrences_found: found,
    occurrences_source: source,
    occurrences_pct: pct(found, source),
  };
}

function compareSides(computed, reported, lang, side) {
  const mismatches = [];
  if (!reported) return [{ lang, side, field: "*", computed: "present", reported: "missing" }];
  for (const field of COMPLIANCE_FIELDS) {
    const a = computed[field];
    const b = reported[field];
    const same =
      field.endsWith("_pct") && a !== null && typeof b === "number"
        ? Math.abs(a - b) <= PCT_TOLERANCE
        : a === b;
    if (!same) mismatches.push({ lang, side, field, computed: a, reported: b ?? null });
  }
  return mismatches;
}

export function computeCompliance(pass, reported) {
  const byLang = {};
  for (const rec of lastByKey(pass).values()) {
    (byLang[rec.targetLang] ??= []).push(rec);
  }
  const result = {};
  const mismatches = [];
  for (const [lang, recs] of Object.entries(byLang)) {
    const before = sideNumbers(recs.map((r) => r.before));
    const after = sideNumbers(recs.map((r) => r.after ?? r.before));
    result[lang] = { before, after };
    if (reported) {
      mismatches.push(...compareSides(before, reported[lang]?.before, lang, "before"));
      mismatches.push(...compareSides(after, reported[lang]?.after, lang, "after"));
    }
  }
  if (reported) {
    for (const lang of Object.keys(reported)) {
      if (!result[lang]) mismatches.push({ lang, side: "*", field: "*", computed: "missing", reported: "present" });
    }
  }
  return { byLang: result, mismatches };
}

export function summarizePass(pass) {
  const byLang = {};
  const open = [];
  for (const [key, rec] of lastByKey(pass)) {
    const status = PASS_STATUSES.includes(rec.status) ? rec.status : "unknown";
    bump(byLang, rec.targetLang, status);
    if (status === "miss" || status === "user" || status === "accepted" || status === "unknown") {
      open.push({ key, status });
    }
  }
  return { byLang, open };
}

export function buildReport(run) {
  const leaks = findLeaks(run.tmHits, run.calls);
  const recording = checkRecording(run.tmHits, run.calls);
  const compliance = computeCompliance(run.pass, run.compliance);
  const pass = summarizePass(run.pass);
  const ok =
    leaks.length === 0 &&
    recording.unrecorded.length === 0 &&
    compliance.mismatches.length === 0;
  return {
    ok,
    files: {
      tm_hits: run.tmHits !== null,
      translate_calls: run.calls !== null,
      glossary_pass: run.pass !== null,
      glossary_compliance: run.compliance !== null,
    },
    tmHits: summarizeTmHits(run.tmHits),
    leaks,
    recording,
    review: summarizeReview(run.calls),
    compliance,
    pass,
  };
}

const ids = (keys) =>
  keys.map((k) => {
    const { file, id, lang } = keyParts(k);
    return `${file}#${id} [${lang}]`;
  });

export function toJson(report, details = false) {
  const out = {
    ok: report.ok,
    files: report.files,
    tm_hits: report.tmHits,
    leaks: { count: report.leaks.length },
    recording: {
      written: report.recording.written,
      recorded: report.recording.recorded,
      unrecorded: report.recording.unrecorded.length,
      approved_tm_not_recorded: report.recording.approvedNotRecorded.length,
      by_lang: report.recording.byLang,
    },
    review: report.review,
    compliance: {
      by_lang: report.compliance.byLang,
      mismatches: report.compliance.mismatches,
    },
    glossary_pass: { by_lang: report.pass.byLang, open: report.pass.open.length },
  };
  if (details) {
    out.leaks.items = report.leaks.map((l) => ({ string: ids([l.key])[0], step: l.step, tool: l.tool, reason: l.reason }));
    out.recording.unrecorded_ids = ids(report.recording.unrecorded);
    out.recording.approved_tm_not_recorded_ids = ids(report.recording.approvedNotRecorded);
    out.glossary_pass.open_ids = report.pass.open.map((o) => ({ string: ids([o.key])[0], status: o.status }));
  }
  return out;
}

const fmt = (v) => (v === null || v === undefined ? "–" : String(v));

export function toMarkdown(report, details = false) {
  const lines = [`# Run report — ${report.ok ? "PASS" : "FAIL"}`, ""];
  const missing = Object.entries(report.files).filter(([, present]) => !present).map(([f]) => f);
  if (missing.length) lines.push(`Not present: ${missing.join(", ")}`, "");

  lines.push("## Translation memory", "");
  const tmLangs = Object.keys(report.tmHits).sort();
  if (!tmLangs.length) lines.push("No TM hits.", "");
  else {
    lines.push("| lang | written | retranslated | rejected-glossary | approved | unreviewed |", "|---|---|---|---|---|---|");
    for (const lang of tmLangs) {
      const { action = {}, review = {} } = report.tmHits[lang];
      lines.push(`| ${lang} | ${action.written ?? 0} | ${action.retranslated ?? 0} | ${action["rejected-glossary"] ?? 0} | ${review.approved ?? 0} | ${review.unreviewed ?? 0} |`);
    }
    lines.push("");
  }
  lines.push(`**TM-hit strings sent to translation: ${report.leaks.length}** (must be 0)`, "");
  if (details) for (const l of report.leaks) lines.push(`- ${ids([l.key])[0]} — step ${l.step}, ${l.reason}`);
  if (details && report.leaks.length) lines.push("");

  const rec = report.recording;
  lines.push("## Recorded on the platform", "");
  lines.push(`Written: ${rec.written}, recorded: ${rec.recorded}, **not recorded: ${rec.unrecorded.length}** (must be 0), approved TM matches not recorded again: ${rec.approvedNotRecorded.length}`, "");
  if (details) for (const k of ids(rec.unrecorded)) lines.push(`- not recorded: ${k}`);
  if (details && rec.unrecorded.length) lines.push("");

  const reviewLangs = Object.keys(report.review).sort();
  if (reviewLangs.length) {
    lines.push("## Review", "", "| lang | approved | manual | rejected |", "|---|---|---|---|");
    for (const lang of reviewLangs) {
      const r = report.review[lang];
      lines.push(`| ${lang} | ${r.approved ?? 0} | ${r.manual ?? 0} | ${r.rejected ?? 0} |`);
    }
    lines.push("");
  }

  lines.push("## Glossary compliance (before → after 3.5)", "");
  const compLangs = Object.keys(report.compliance.byLang).sort();
  if (!compLangs.length) lines.push("No glossary pass records.", "");
  else {
    lines.push("| lang | strings with terms | MISS before | compliant before | MISS after | compliant after | occurrences before | occurrences after |", "|---|---|---|---|---|---|---|---|");
    for (const lang of compLangs) {
      const { before: b, after: a } = report.compliance.byLang[lang];
      lines.push(`| ${lang} | ${b.strings_with_terms} | ${b.miss} | ${fmt(b.compliant_pct)}% | ${a.miss} | ${fmt(a.compliant_pct)}% | ${b.occurrences_found}/${b.occurrences_source} (${fmt(b.occurrences_pct)}%) | ${a.occurrences_found}/${a.occurrences_source} (${fmt(a.occurrences_pct)}%) |`);
    }
    lines.push("");
  }
  if (report.files.glossary_compliance) {
    const mm = report.compliance.mismatches;
    lines.push(`Matches glossary_compliance.json: ${mm.length ? `**no** (${mm.length} differences)` : "yes"}`, "");
    for (const m of mm) lines.push(`- ${m.lang} ${m.side} ${m.field}: computed ${fmt(m.computed)}, reported ${fmt(m.reported)}`);
    if (mm.length) lines.push("");
  }

  const passLangs = Object.keys(report.pass.byLang).sort();
  if (passLangs.length) {
    lines.push("## Glossary pass status", "", "| lang | ok | fixed | miss | accepted | user |", "|---|---|---|---|---|---|");
    for (const lang of passLangs) {
      const p = report.pass.byLang[lang];
      lines.push(`| ${lang} | ${p.ok ?? 0} | ${p.fixed ?? 0} | ${p.miss ?? 0} | ${p.accepted ?? 0} | ${p.user ?? 0} |`);
    }
    lines.push("");
    if (details) for (const o of report.pass.open) lines.push(`- ${o.status}: ${ids([o.key])[0]}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function parseArgs(argv) {
  const opts = { project: ".", json: false, details: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--details") opts.details = true;
    else if (arg === "--project") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new InputError("--project needs a value");
      opts.project = value;
    } else throw new InputError(`Unknown argument: ${arg}`);
  }
  return opts;
}

export function main(argv, out = process.stdout, err = process.stderr) {
  try {
    const opts = parseArgs(argv);
    const dir = resolve(opts.project);
    if (!existsSync(dir)) throw new InputError(`No such directory: ${opts.project}`);
    const report = buildReport(loadRun(dir));
    out.write(opts.json ? JSON.stringify(toJson(report, opts.details), null, 2) + "\n" : toMarkdown(report, opts.details));
    return report.ok ? 0 : 1;
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    err.write(`${e.message}\nUsage: node run-report.mjs [--project <dir>] [--json] [--details]\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
