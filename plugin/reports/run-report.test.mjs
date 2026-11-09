// node --test plugin/reports/
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildReport,
  checkRecording,
  computeCompliance,
  findLeaks,
  main,
  summarizePass,
  summarizeReview,
  toJson,
} from "./run-report.mjs";

// Ids and files deliberately use different schemes: a PO msgid hash, a JSON
// key path, a CSV row, an Android strings.xml name.
const PO = { file: "locale/messages.po", id: "a1b2c3" };
const JSONKEY = { file: "src/i18n/en.json", id: "settings.audio.title" };
const CSV = { file: "data/strings.csv", id: "17" };
const XML = { file: "app/src/main/res/values/strings.xml", id: "button_continue" };

const hit = (s, lang, action) => ({ ...s, targetLang: lang, action });
const call = (step, lang, strings, extra = {}) => ({
  step,
  tool: "translate_batch",
  targetLang: lang,
  glossaryId: "g1",
  strings: strings.map(({ id, file }) => ({ id, file })),
  time: "2026-11-04T10:00:00Z",
  ...extra,
});
const record = (lang, strings, extra = {}) =>
  call("record", lang, strings, { tool: "record_translations", origin: "machine", ...extra });
const terms = (...pairs) => pairs.map(([term, sourceCount, targetCount]) => ({ term, sourceCount, targetCount }));
const passRec = (s, lang, beforeTerms, status, afterTerms) => ({
  ...s,
  targetLang: lang,
  before: { terms: beforeTerms },
  status,
  ...(afterTerms && { after: { terms: afterTerms } }),
});

function projectDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "run-report-"));
  mkdirSync(join(dir, "tools"));
  for (const [name, content] of Object.entries(files)) {
    const text = Array.isArray(content)
      ? content.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n"
      : typeof content === "string" ? content : JSON.stringify(content);
    writeFileSync(join(dir, "tools", name), text);
  }
  return dir;
}

function run(dir, ...args) {
  let out = "";
  let err = "";
  const code = main(["--project", dir, ...args], { write: (s) => (out += s) }, { write: (s) => (err += s) });
  return { code, out, err };
}

test("a written TM hit sent in a step-3 batch call is a leak", () => {
  const leaks = findLeaks([hit(PO, "de", "written")], [call("3", "de", [PO, JSONKEY])]);
  assert.equal(leaks.length, 1);
  assert.match(leaks[0].reason, /written match/);
});

test("the same id in another file or language is not a leak", () => {
  const leaks = findLeaks(
    [hit(PO, "de", "written")],
    [call("3", "fr", [PO]), call("3", "de", [{ file: "other/messages.po", id: PO.id }])]
  );
  assert.deepEqual(leaks, []);
});

test("step-1 throwaway calls count too", () => {
  assert.equal(findLeaks([hit(CSV, "pl", "written")], [call("1", "pl", [CSV])]).length, 1);
});

test("a retranslated hit may go to a fix call but not to a batch step", () => {
  const hits = [hit(JSONKEY, "pt-BR", "retranslated")];
  assert.deepEqual(findLeaks(hits, [call("fix", "pt-BR", [JSONKEY], { tool: "translate_text" })]), []);
  assert.equal(findLeaks(hits, [call("3", "pt-BR", [JSONKEY])]).length, 1);
});

test("the final glossary pass may fix a retranslated match but never one written as is", () => {
  const fix = (s) => call("3.5", "de", [s], { tool: "translate_text" });
  assert.deepEqual(findLeaks([hit(PO, "de", "retranslated")], [fix(PO)]), []);
  const leaks = findLeaks([hit(PO, "de", "written")], [fix(PO)]);
  assert.equal(leaks.length, 1);
  assert.match(leaks[0].reason, /written match/);
});

test("record and review calls are not translate calls", () => {
  const hits = [hit(PO, "de", "written")];
  assert.deepEqual(
    findLeaks(hits, [record("de", [PO]), call("review", "de", [PO], { tool: "set_translation_status", status: "approved" })]),
    []
  );
});

test("a written string without a record call is caught", () => {
  const result = checkRecording(
    [hit(PO, "de", "retranslated")],
    [call("3", "de", [JSONKEY, CSV]), record("de", [PO, JSONKEY])]
  );
  assert.equal(result.written, 3);
  assert.equal(result.recorded, 2);
  assert.equal(result.unrecorded.length, 1);
  assert.match(result.unrecorded[0], /strings\.csv/);
});

test("an unrecorded TM match written as is is listed separately, not as a failure", () => {
  const result = checkRecording([hit(XML, "tr", "written")], []);
  assert.deepEqual(result.unrecorded, []);
  assert.equal(result.approvedNotRecorded.length, 1);
});

test("step-1 strings are not written strings", () => {
  assert.equal(checkRecording([], [call("1", "de", [PO])]).written, 0);
});

test("review outcomes are counted per language", () => {
  const review = summarizeReview([
    call("review", "de", [PO, CSV], { tool: "set_translation_status", status: "approved" }),
    call("review", "de", [JSONKEY], { tool: "set_translation_status", status: "rejected" }),
    record("de", [XML], { step: "review", origin: "manual" }),
    record("de", [XML]),
  ]);
  assert.deepEqual(review, { de: { approved: 2, rejected: 1, manual: 1 } });
});

test("compliance before and after is recomputed from the pass log", () => {
  const pass = [
    passRec(PO, "de", terms(["Save", 1, 1]), "ok"),
    passRec(JSONKEY, "de", terms(["Save", 2, 0], ["Inventory", 1, 1]), "fixed", terms(["Save", 2, 2], ["Inventory", 1, 1])),
    passRec(CSV, "de", terms(["Inventory", 1, 0]), "accepted", terms(["Inventory", 1, 0])),
    passRec(XML, "de", [], "ok"),
  ];
  const { byLang } = computeCompliance(pass, null);
  assert.deepEqual(byLang.de.before, {
    strings_with_terms: 3,
    miss: 2,
    compliant_pct: 33.3,
    occurrences_found: 2,
    occurrences_source: 5,
    occurrences_pct: 40,
  });
  assert.deepEqual(byLang.de.after, {
    strings_with_terms: 3,
    miss: 1,
    compliant_pct: 66.7,
    occurrences_found: 4,
    occurrences_source: 5,
    occurrences_pct: 80,
  });
});

test("target counts above the source count don't inflate occurrences", () => {
  const { byLang } = computeCompliance([passRec(PO, "fr", terms(["Save", 1, 3]), "ok")], null);
  assert.equal(byLang.fr.before.occurrences_found, 1);
});

test("a resumable pass log with mixed statuses and no after record yet", () => {
  const pass = [
    passRec(PO, "pl", terms(["Save", 1, 0]), "miss"),
    passRec(JSONKEY, "pl", terms(["Save", 1, 0]), "user"),
    passRec(CSV, "pl", terms(["Save", 1, 0]), "fixed", terms(["Save", 1, 1])),
    passRec(XML, "pl", terms(["Save", 1, 1]), "ok"),
  ];
  const { byLang } = computeCompliance(pass, null);
  assert.equal(byLang.pl.before.miss, 3);
  assert.equal(byLang.pl.after.miss, 2);
  const summary = summarizePass(pass);
  assert.deepEqual(summary.byLang.pl, { miss: 1, user: 1, fixed: 1, ok: 1 });
  assert.deepEqual(summary.open.map((o) => o.status).sort(), ["miss", "user"]);
});

test("a later line for the same string replaces the earlier one", () => {
  const pass = [
    passRec(PO, "de", terms(["Save", 1, 0]), "miss"),
    passRec(PO, "de", terms(["Save", 1, 0]), "fixed", terms(["Save", 1, 1])),
  ];
  assert.equal(computeCompliance(pass, null).byLang.de.after.miss, 0);
  assert.equal(summarizePass(pass).open.length, 0);
});

test("a compliance file that disagrees with the pass log is flagged", () => {
  const pass = [passRec(PO, "de", terms(["Save", 1, 0]), "fixed", terms(["Save", 1, 1]))];
  const computed = computeCompliance(pass, null).byLang;
  assert.deepEqual(computeCompliance(pass, computed).mismatches, []);
  const reported = structuredClone(computed);
  reported.de.after.miss = 1;
  reported.de.after.compliant_pct = 100.05; // within tolerance
  const { mismatches } = computeCompliance(pass, reported);
  assert.deepEqual(mismatches.map((m) => `${m.side}.${m.field}`), ["after.miss"]);
  reported.tr = { before: {}, after: {} };
  assert.equal(computeCompliance(pass, reported).mismatches.length, 2);
});

test("a clean run passes and the default output holds no ids", () => {
  const pass = [passRec(PO, "de", terms(["Save", 1, 0]), "fixed", terms(["Save", 1, 1]))];
  const dir = projectDir({
    "tm_hits.jsonl": [hit(JSONKEY, "de", "written")],
    "translate_calls.jsonl": [call("3", "de", [PO]), record("de", [PO, JSONKEY]), call("3.5", "de", [PO], { tool: "translate_text" }), record("de", [PO])],
    "glossary_pass.jsonl": pass,
    "glossary_compliance.json": computeCompliance(pass, null).byLang,
  });
  const md = run(dir);
  assert.equal(md.code, 0);
  assert.match(md.out, /PASS/);
  for (const s of [PO, JSONKEY]) {
    assert.ok(!md.out.includes(s.id));
    assert.ok(!md.out.includes(s.file));
  }
  const json = run(dir, "--json");
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.leaks.count, 0);
  assert.equal(parsed.recording.unrecorded, 0);
  assert.equal(parsed.tm_hits.de.action.written, 1);
  assert.ok(!json.out.includes(JSONKEY.id));
});

test("a leak fails the run and --details names the string", () => {
  const dir = projectDir({
    "tm_hits.jsonl": [hit(XML, "tr", "written")],
    "translate_calls.jsonl": [call("3", "tr", [XML]), record("tr", [XML])],
  });
  const md = run(dir);
  assert.equal(md.code, 1);
  assert.match(md.out, /FAIL/);
  assert.match(md.out, /sent to translation: 1/);
  const details = run(dir, "--details");
  assert.ok(details.out.includes(XML.id));
  const json = JSON.parse(run(dir, "--json", "--details").out);
  assert.equal(json.leaks.items[0].step, "3");
});

test("missing files are reported, not errors", () => {
  const dir = projectDir({});
  const { code, out } = run(dir);
  assert.equal(code, 0);
  assert.match(out, /Not present: tm_hits, translate_calls, glossary_pass, glossary_compliance/);
});

test("malformed JSONL exits 2 with the file and line", () => {
  const dir = projectDir({ "tm_hits.jsonl": [hit(PO, "de", "written"), "{not json"] });
  const { code, err } = run(dir);
  assert.equal(code, 2);
  assert.match(err, /tm_hits\.jsonl:2/);
});

test("bad arguments exit 2", () => {
  let err = "";
  assert.equal(main(["--nope"], { write() {} }, { write: (s) => (err += s) }), 2);
  assert.match(err, /Unknown argument/);
});

test("buildReport works on an empty run", () => {
  const report = buildReport({ tmHits: null, calls: null, pass: null, compliance: null });
  assert.equal(report.ok, true);
  assert.equal(toJson(report).leaks.count, 0);
});
