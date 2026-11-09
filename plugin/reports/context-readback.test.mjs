// node --test plugin/reports/
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildReport, compareFact, compareRecord, main } from "./context-readback.mjs";

const DOC = { kind: "document", ref: "context/people.md#a", quote: "A is a woman" };
const COL = { kind: "string", ref: "data/strings.csv#17:column:Speaker" };
const AGENT = { type: "AGENT", source: "onboard" };
const EVAL = { type: "SCRIPT", source: "context-evaluation" };

const confirmed = (value, source = DOC, actor = AGENT) => ({ status: "confirmed", value, source, actor });
const suggestion = (value, source, actor = AGENT) => ({ status: "suggestion", value, ...(source && { source }), actor });
const resolved = (value, source = DOC) => ({ status: "resolved", value, source });
const candidate = (value, source) => ({ status: "candidate", value, source });

const PROJECT = {
  characters: [{ id: "a", name: "A", gender: confirmed("Fem") }],
  relations: [{ from: "a", to: "b", register: { fr: confirmed("Infm"), de: null } }],
  defaults: { uiAddressesUser: true, userRegister: { fr: confirmed("Form") } },
  notes: [{ kind: "decision", text: "Keep names" }],
};

test("a resolved fact matches on status, value and source", () => {
  const ctx = { speaker: confirmed("a", COL) };
  assert.equal(compareFact("speaker", "fr", resolved("a", COL), ctx, PROJECT), "same");
});

test("a changed status, value or source is told apart, and a lost fact is missing", () => {
  const local = resolved("a", COL);
  assert.equal(compareFact("speaker", "fr", local, { speaker: suggestion("a", COL) }, PROJECT), "status_differs");
  assert.equal(compareFact("speaker", "fr", local, { speaker: confirmed("b", COL) }, PROJECT), "value_differs");
  assert.equal(compareFact("speaker", "fr", local, { speaker: confirmed("a", DOC) }, PROJECT), "source_differs");
  assert.equal(compareFact("speaker", "fr", local, {}, PROJECT), "missing");
});

test("a confirmed null speaker is a value, not a gap", () => {
  const ctx = { speaker: confirmed(null, COL) };
  assert.equal(compareFact("speaker", "fr", resolved(null, COL), ctx, PROJECT), "same");
});

test("a candidate is a suggestion and keeps its reason in the source's quote", () => {
  const reason = { kind: "string", ref: "dialog.csv#3", quote: "the previous line names her" };
  const local = candidate("a", reason);
  assert.equal(compareFact("addressee", "fr", local, { addressee: suggestion("a", reason) }, PROJECT), "same");
  assert.equal(compareFact("addressee", "fr", local, { addressee: suggestion("a") }, PROJECT), "source_differs");
});

test("gender is read from the speaker's and the addressee's character", () => {
  const local = resolved("Fem");
  assert.equal(compareFact("speaker_gender", "fr", local, { speaker: confirmed("a", COL) }, PROJECT), "same");
  assert.equal(compareFact("addressee_gender", "fr", local, { addressee: confirmed("a", COL) }, PROJECT), "same");
  assert.equal(compareFact("speaker_gender", "fr", local, { speaker: confirmed("nobody", COL) }, PROJECT), "missing");
});

test("formality comes from the string, then the relation, then the user default", () => {
  const form = resolved("Form");
  const infm = resolved("Infm");
  const pair = { speaker: confirmed("a", COL), addressee: confirmed("b", COL) };
  assert.equal(compareFact("formality", "fr", form, { ...pair, register: { fr: confirmed("Form") } }, PROJECT), "same");
  assert.equal(compareFact("formality", "fr", infm, pair, PROJECT), "same");
  assert.equal(compareFact("formality", "fr", form, { addressee: confirmed("user", COL) }, PROJECT), "same");
  assert.equal(compareFact("formality", "de", form, pair, PROJECT), "missing");
});

test("a conflict is an issue on the string or the project with its readings", () => {
  const readings = [{ value: "Fem", source: DOC }, { value: "Masc", source: COL }];
  const local = { status: "conflict", readings };
  const issue = { field: "speaker.gender", kind: "conflict", readings };
  assert.equal(compareFact("speaker_gender", "fr", local, { issues: [issue] }, PROJECT), "same");
  assert.equal(compareFact("speaker_gender", "fr", local, {}, { issues: [issue] }), "same");
  assert.equal(compareFact("speaker_gender", "fr", local, {}, PROJECT), "issue_missing");
  assert.equal(
    compareFact("speaker_gender", "fr", local, { issues: [{ ...issue, readings: readings.slice(1) }] }, PROJECT),
    "readings_differ"
  );
});

test("a formality conflict is keyed by language", () => {
  const local = { status: "conflict", readings: [] };
  const ctx = { issues: [{ field: "register.de", lang: "de", kind: "conflict", readings: [] }] };
  assert.equal(compareFact("formality", "de", local, ctx, PROJECT), "same");
  assert.equal(compareFact("formality", "fr", local, ctx, PROJECT), "issue_missing");
});

test("an open fact is unset; an evaluator's suggestion there is counted, not a difference", () => {
  const open = { status: "open" };
  assert.equal(compareFact("speaker", "fr", open, {}, PROJECT), "same");
  assert.equal(compareFact("speaker", "fr", open, { speaker: suggestion("a", undefined, EVAL) }, PROJECT), "evaluator_added");
  assert.equal(compareFact("speaker", "fr", open, { speaker: confirmed("a") }, PROJECT), "platform_has_value");
});

test("an evaluator replacing an imported suggestion is a difference", () => {
  const source = { kind: "string", ref: "k", quote: "why" };
  const ctx = { speaker: suggestion("b", undefined, EVAL) };
  assert.equal(compareFact("speaker", "fr", candidate("a", source), ctx, PROJECT), "value_differs");
});

test("referents and placeholders match by content; they have no status or source to compare", () => {
  const ctx = {
    referents: [{ text: "she", characterId: "a" }],
    placeholders: [{ name: "{0}", meaning: "item count", kind: "count" }],
  };
  assert.equal(compareFact("pronoun_referent[she]", "fr", resolved({ characterId: "a" }), ctx, PROJECT), "no_status_field");
  assert.equal(compareFact("pronoun_referent[she]", "fr", resolved({ characterId: "b" }), ctx, PROJECT), "value_differs");
  assert.equal(compareFact("pronoun_referent[he]", "fr", resolved({ characterId: "a" }), ctx, PROJECT), "missing");
  assert.equal(compareFact("placeholder_meaning[{0}]", "fr", resolved({ kind: "count" }), ctx, PROJECT), "no_status_field");
});

test("a flow's own fact is kept in the placement note", () => {
  const ctx = { placement: { note: "item_role: distractor; screen 2" } };
  assert.equal(compareFact("item_role", "fr", resolved("distractor"), ctx, PROJECT), "no_status_field");
  assert.equal(compareFact("item_role", "fr", resolved("key"), ctx, PROJECT), "missing");
});

test("the sent project context is compared by identity, ignoring actors and extra platform values", () => {
  const sent = {
    characters: [{ id: "a", name: "A", gender: { status: "confirmed", value: "Fem", source: DOC } }],
    relations: [{ from: "a", to: "b", register: { de: null } }],
    notes: [{ kind: "decision", text: "Keep names" }],
  };
  const stored = { ...PROJECT, notes: [{ kind: "question", text: "Who?" }, ...PROJECT.notes] };
  const result = compareRecord(sent, stored);
  assert.deepEqual(result.differs, []);
  assert.deepEqual(result.missing, []);
  assert.equal(result.same, result.checked);
});

test("a changed or lost project value is reported, and a field with no platform field listed", () => {
  const sent = {
    characters: [{ id: "a", gender: { status: "confirmed", value: "Masc", source: DOC } }, { id: "z", name: "Z" }],
    audience: "adults",
  };
  const result = compareRecord(sent, PROJECT);
  assert.equal(result.differs.length, 1);
  assert.equal(result.missing.length, 2); // character z: id and name
  assert.deepEqual(result.notImported, ["audience"]);
});

const readbackOf = (...items) => ({
  project: { project: { id: "p" }, context: { data: PROJECT, version: 1 } },
  strings: items.map(([externalKey, data]) => ({ externalKey, context: { data, version: 1 } })),
});

test("the report counts per fact and status, and a missing string fails", () => {
  const report = buildReport({
    facts: [
      { externalKey: "a.po#1", lang: "fr", facts: { speaker: resolved("a", COL), addressee_number: { status: "open" } } },
      { externalKey: "a.po#1", lang: "de", facts: { speaker: resolved("a", COL) } },
      { externalKey: "a.po#2", lang: "fr", facts: { speaker: resolved("a", COL) } },
    ],
    payload: null,
    readback: readbackOf(["a.po#1", { speaker: confirmed("a", COL), addresseeNumber: suggestion("Sing", undefined, EVAL) }]),
  });
  assert.equal(report.ok, false);
  assert.equal(report.strings.local, 2);
  assert.deepEqual(report.strings.missing, ["a.po#2"]);
  assert.deepEqual(report.facts.speaker, { resolved: { same: 2 } });
  assert.deepEqual(report.facts.addressee_number, { open: { evaluator_added: 1 } });
  assert.equal(report.evaluatorFacts, 1);
});

test("a conflict stored on a string has to flag it", () => {
  const readings = [{ value: "Fem", source: DOC }];
  const issue = { field: "speaker.gender", kind: "conflict", readings };
  const facts = [{ externalKey: "a.po#1", lang: "fr", facts: { speaker_gender: { status: "conflict", readings } } }];
  const strings = (flagged, issues) => ({
    project: { context: { data: PROJECT } },
    strings: [{ externalKey: "a.po#1", flagged, context: { data: { issues } } }],
  });
  assert.equal(buildReport({ facts, payload: null, readback: strings(true, [issue]) }).ok, true);
  const report = buildReport({ facts, payload: null, readback: strings(false, [issue]) });
  assert.equal(report.ok, false);
  assert.deepEqual(report.facts.speaker_gender, { conflict: { not_flagged: 1 } });
  // A conflict held on the project doesn't flag one string.
  const onProject = { project: { context: { data: { ...PROJECT, issues: [issue] } } }, strings: [{ externalKey: "a.po#1", flagged: false, context: { data: {} } }] };
  assert.equal(buildReport({ facts, payload: null, readback: onProject }).ok, true);
});

test("placement and discourse from the import are compared per string", () => {
  const payload = {
    strings: [
      { externalKey: "a.po#1", context: { placement: { maxLength: 12, screen: "Main" }, discourse: { scene: "Intro" } } },
      { externalKey: "a.po#2", context: { placement: { maxLength: 20 } } },
    ],
  };
  const report = buildReport({
    facts: [],
    payload,
    readback: readbackOf(
      ["a.po#1", { placement: { maxLength: 12, screen: "Main", contentType: "button" }, discourse: { scene: "Intro" } }],
      ["a.po#2", { placement: {} }]
    ),
  });
  assert.equal(report.ok, false);
  assert.equal(report.stringFields.checked, 4);
  assert.equal(report.stringFields.same, 3);
  assert.deepEqual(report.stringFields.missing, ["a.po#2.placement.maxLength"]);
});

function projectDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "context-readback-"));
  mkdirSync(join(dir, "tools"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function run(dir, ...args) {
  let out = "";
  let err = "";
  const code = main(["--project", dir, ...args], { write: (s) => (out += s) }, { write: (s) => (err += s) });
  return { code, out, err };
}

test("a clean read-back passes and the default output holds no keys", () => {
  const dir = projectDir({
    "context_facts.jsonl": JSON.stringify({ externalKey: "res/values.xml#btn_ok", lang: "fr", facts: { speaker: resolved("a", COL) } }) + "\n",
    "tools/context_readback.json": JSON.stringify(readbackOf(["res/values.xml#btn_ok", { speaker: confirmed("a", COL) }])),
  });
  const md = run(dir);
  assert.equal(md.code, 0);
  assert.match(md.out, /PASS/);
  assert.ok(!md.out.includes("btn_ok"));
  assert.equal(JSON.parse(run(dir, "--json").out).ok, true);
});

test("a difference fails the run and --details names the string", () => {
  const dir = projectDir({
    "context_facts.jsonl": JSON.stringify({ externalKey: "src/en.json#menu.title", lang: "fr", facts: { speaker: resolved("a", COL) } }) + "\n",
    "tools/context_readback.json": JSON.stringify(readbackOf(["src/en.json#menu.title", {}])),
  });
  const md = run(dir);
  assert.equal(md.code, 1);
  assert.ok(!md.out.includes("menu.title"));
  assert.ok(run(dir, "--details").out.includes("menu.title"));
});

test("a missing read-back, bad JSON and bad arguments exit 2", () => {
  assert.match(run(projectDir({})).err, /context_readback\.json: not found/);
  const bad = projectDir({ "tools/context_readback.json": "{nope" });
  assert.equal(run(bad).code, 2);
  let err = "";
  assert.equal(main(["--nope"], { write() {} }, { write: (s) => (err += s) }), 2);
  assert.match(err, /Unknown argument/);
});
