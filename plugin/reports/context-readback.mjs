#!/usr/bin/env node
// Compares the local context files with what the platform project holds after
// an import (onboard 1.6) and prints a report.
//
//   node context-readback.mjs [--project <dir>] [--json] [--details]
//
// Reads, under <dir>:
//   context_facts.jsonl          one line per string per target language
//   tools/platform_import.json   the import payload, {"context", "strings"}
//                                (optional)
//   tools/context_readback.json  {"project": <get_project_context result>,
//                                 "strings": [<list_strings items>]}
//
// Each local fact is compared with its platform field by value, status and
// source, following "Where each fact goes" in CONTEXT_REQUIREMENTS.md. Strings
// are matched by externalKey, compared as an opaque string, so any file format
// and id scheme works. The payload's project context and each string's
// placement and discourse are compared value by value. Facts the context
// evaluation added are counted, and are not differences. Output holds counts
// only; --details adds string keys (never text).
//
// Exit code: 0 pass, 1 a fact was lost or differs, 2 bad arguments or
// unreadable input. Node 18+, no dependencies.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { InputError, parseJsonl } from "./run-report.mjs";

const EVALUATION_SOURCE_PREFIX = "context-evaluation";
const EXPECTED_STATUS = { resolved: "confirmed", candidate: "suggestion" };
// Outcomes that don't fail the check: the fact matches, the platform has no
// status or source for it, or something other than the import added a value to
// a fact the import left unset.
const PASSING = new Set(["same", "no_status_field", "evaluator_added", "platform_has_value"]);
const PROJECT_FIELDS = ["description", "defaults", "characters", "relations", "style", "notes", "issues"];
const STRING_FIELDS = ["placement", "discourse"];
const KEYED_FACT = /^(pronoun_referent|placeholder_meaning)\[(.+)\]$/;
const ISSUE_FIELDS = {
  speaker: "speaker",
  speaker_gender: "speaker.gender",
  addressee: "addressee",
  addressee_gender: "addressee.gender",
  addressee_number: "addresseeNumber",
};

// Context records are JSON. Key order doesn't matter, and `actor` says who
// wrote a fact, which isn't part of it.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => k !== "actor")
        .sort()
        .map((k) => [k, canonical(value[k])])
    );
  }
  return value;
}

const same = (a, b) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

const isEvaluatorFact = (fact) => String(fact?.actor?.source ?? "").startsWith(EVALUATION_SOURCE_PREFIX);

function character(project, id) {
  return (project?.characters ?? []).find((c) => c.id === id);
}

// The platform fact a local fact is stored in; undefined when there is none.
// Formality can live in three places: the string, the speaker-to-listener
// relation, or the default towards the product's user.
function platformFact(name, lang, context, project) {
  switch (name) {
    case "speaker":
      return context.speaker;
    case "addressee":
      return context.addressee;
    case "addressee_number":
      return context.addresseeNumber;
    case "speaker_gender":
      return character(project, context.speaker?.value)?.gender ?? undefined;
    case "addressee_gender":
      return character(project, context.addressee?.value)?.gender ?? undefined;
    case "formality": {
      const own = context.register?.[lang];
      if (own) return own;
      const speaker = context.speaker?.value;
      const addressee = context.addressee?.value;
      const relation = (project?.relations ?? []).find((r) => r.from === speaker && r.to === addressee);
      if (relation?.register?.[lang]) return relation.register[lang];
      return addressee === undefined || addressee === "user"
        ? project?.defaults?.userRegister?.[lang]
        : undefined;
    }
    default:
      return undefined;
  }
}

function issueField(name, lang) {
  if (name === "formality") return `register.${lang}`;
  const keyed = KEYED_FACT.exec(name);
  if (keyed) return `${keyed[1] === "pronoun_referent" ? "referents" : "placeholders"}[${keyed[2]}]`;
  return ISSUE_FIELDS[name] ?? name;
}

const isKnownFact = (name) => name === "formality" || name in ISSUE_FIELDS;

// A referent or a placeholder has plain fields, so its status and source have
// nowhere to go on the platform; only what it says can match.
function compareKeyed(name, local, context) {
  const [, kind, key] = KEYED_FACT.exec(name);
  const stored =
    kind === "pronoun_referent"
      ? (context.referents ?? []).find((r) => r.text === key)
      : (context.placeholders ?? []).find((p) => p.name === key);
  if (!stored) return "missing";
  const expected = local.value && typeof local.value === "object" ? local.value : {};
  return Object.entries(expected).every(([field, value]) => same(stored[field], value))
    ? "no_status_field"
    : "value_differs";
}

// A flow's own fact (e.g. a quiz item's role) has no field of its own and is
// kept in placement.note as "<fact>: <value>".
function compareFlowFact(name, local, context) {
  const value = typeof local.value === "string" ? local.value : JSON.stringify(local.value);
  return String(context.placement?.note ?? "").includes(`${name}: ${value}`) ? "no_status_field" : "missing";
}

function compareConflict(name, lang, local, context, project) {
  const field = issueField(name, lang);
  const isHit = (i) => i.kind === "conflict" && i.field === field;
  const issue = (context.issues ?? []).find(isHit) ?? (project?.issues ?? []).find(isHit);
  if (!issue) return "issue_missing";
  return same(local.readings ?? [], issue.readings ?? []) ? "same" : "readings_differ";
}

export function compareFact(name, lang, local, context, project) {
  if (local.status === "conflict") {
    return compareConflict(name, lang, local, context, project);
  }
  const keyed = KEYED_FACT.test(name);
  const known = isKnownFact(name);
  const stored = known ? platformFact(name, lang, context, project) : undefined;
  if (local.status === "open") {
    if (!stored) return "same";
    return isEvaluatorFact(stored) ? "evaluator_added" : "platform_has_value";
  }
  if (keyed) return compareKeyed(name, local, context);
  if (!known) return compareFlowFact(name, local, context);
  if (!stored) return "missing";
  if (stored.status !== EXPECTED_STATUS[local.status]) return "status_differs";
  if (!same(stored.value, local.value)) return "value_differs";
  return same(stored.source, local.source) ? "same" : "source_differs";
}

// Array elements are matched by what identifies them, not by position, since
// the platform may hold more of them than the import sent.
function elementKey(element, index) {
  if (element && typeof element === "object") {
    if (element.id !== undefined) return `id=${element.id}`;
    if (element.from !== undefined) return `${element.from}->${element.to}`;
    if (element.field !== undefined) return `${element.field}|${element.lang ?? ""}|${element.kind ?? ""}`;
    if (element.text !== undefined) return `${element.kind ?? ""}|${element.text}`;
    if (element.name !== undefined) return `name=${element.name}`;
  }
  return String(index);
}

const emptyComparison = () => ({ checked: 0, same: 0, differs: [], missing: [], notImported: [] });

function isFact(value) {
  return value && typeof value === "object" && typeof value.status === "string" && "value" in value;
}

function leaves(value, path, out) {
  if (Array.isArray(value) && value.some((v) => v && typeof v === "object")) {
    value.forEach((v, i) => leaves(v, `${path}[${elementKey(v, i)}]`, out));
  } else if (value && typeof value === "object" && !Array.isArray(value) && !isFact(value)) {
    for (const [k, v] of Object.entries(value)) leaves(v, `${path}.${k}`, out);
  } else {
    out.set(path, value);
  }
  return out;
}

// Compares what was sent with what is stored, field by field. A sent field the
// record has no place for is listed in notImported.
export function compareRecord(sent, stored, fields = PROJECT_FIELDS, prefix = "", result = emptyComparison()) {
  if (!sent) return result;
  const storedLeaves = leaves(stored ?? {}, "", new Map());
  for (const [key, value] of Object.entries(sent)) {
    if (!fields.includes(key)) {
      result.notImported.push(key);
      continue;
    }
    for (const [path, expected] of leaves(value, `.${key}`, new Map())) {
      result.checked++;
      if (!storedLeaves.has(path)) {
        // An empty list or object sent says nothing is there.
        if (expected && typeof expected === "object" && !isFact(expected) && !Object.keys(expected).length) {
          result.same++;
        } else result.missing.push(prefix + path);
      } else if (same(storedLeaves.get(path), expected)) result.same++;
      else result.differs.push(prefix + path);
    }
  }
  return result;
}

function countEvaluatorFacts(strings) {
  let count = 0;
  for (const string of strings) {
    const data = string.context?.data ?? {};
    const facts = [data.speaker, data.addressee, data.addresseeNumber, ...Object.values(data.register ?? {})];
    for (const fact of facts) if (isEvaluatorFact(fact)) count++;
  }
  return count;
}

export function buildReport({ facts, payload, readback }) {
  const project = readback?.project?.context?.data ?? {};
  const strings = readback?.strings ?? [];
  const byKey = new Map(strings.map((s) => [s.externalKey, s]));
  const report = {
    strings: { local: 0, platform: strings.length, missing: [] },
    facts: {},
    differences: [],
    project: compareRecord(payload?.context, project),
    stringFields: emptyComparison(),
    evaluatorFacts: countEvaluatorFacts(strings),
  };
  for (const sent of payload?.strings ?? []) {
    const stored = byKey.get(sent.externalKey);
    if (!stored) continue;
    const fields = {
      ...(sent.context?.placement && { placement: sent.context.placement }),
      ...(sent.context?.discourse && { discourse: sent.context.discourse }),
    };
    compareRecord(fields, stored.context?.data, STRING_FIELDS, sent.externalKey, report.stringFields);
  }

  const localKeys = new Set();
  for (const line of facts ?? []) {
    const key = line.externalKey;
    if (!localKeys.has(key)) {
      localKeys.add(key);
      report.strings.local++;
      if (!byKey.has(key)) report.strings.missing.push(key);
    }
    const stored = byKey.get(key);
    if (!stored) continue;
    const context = stored.context?.data ?? {};
    for (const [name, local] of Object.entries(line.facts ?? {})) {
      let outcome = compareFact(name, line.lang, local, context, project);
      // A conflict stored on the string has to flag it.
      if (outcome === "same" && local.status === "conflict" && (context.issues ?? []).length && !stored.flagged) {
        outcome = "not_flagged";
      }
      const fact = name.replace(/\[.*\]$/, "");
      const row = ((report.facts[fact] ??= {})[local.status] ??= {});
      row[outcome] = (row[outcome] ?? 0) + 1;
      if (!PASSING.has(outcome)) report.differences.push({ key, lang: line.lang, fact: name, status: local.status, outcome });
    }
  }
  report.ok =
    report.differences.length === 0 &&
    report.strings.missing.length === 0 &&
    report.project.differs.length === 0 &&
    report.project.missing.length === 0 &&
    report.stringFields.differs.length === 0 &&
    report.stringFields.missing.length === 0;
  return report;
}

export function toJson(report, details = false) {
  const out = {
    ok: report.ok,
    strings: {
      local: report.strings.local,
      platform: report.strings.platform,
      missing: report.strings.missing.length,
    },
    facts: report.facts,
    differences: report.differences.length,
    evaluator_facts: report.evaluatorFacts,
    project: {
      checked: report.project.checked,
      same: report.project.same,
      differs: report.project.differs.length,
      missing: report.project.missing.length,
      fields_not_imported: report.project.notImported.length,
    },
    string_fields: {
      checked: report.stringFields.checked,
      same: report.stringFields.same,
      differs: report.stringFields.differs.length,
      missing: report.stringFields.missing.length,
    },
  };
  if (details) {
    out.strings.missing_keys = report.strings.missing;
    out.difference_items = report.differences;
    out.project.differs_paths = report.project.differs;
    out.project.missing_paths = report.project.missing;
    out.project.not_imported = report.project.notImported;
    out.string_fields.differs_paths = report.stringFields.differs;
    out.string_fields.missing_paths = report.stringFields.missing;
  }
  return out;
}

export function toMarkdown(report, details = false) {
  const p = report.project;
  const f = report.stringFields;
  const lines = [
    `# Context read-back — ${report.ok ? "PASS" : "FAIL"}`,
    "",
    `Strings: ${report.strings.local} local, ${report.strings.platform} on the platform, **${report.strings.missing.length} missing** (must be 0)`,
    "",
    "| fact | local status | outcome | count |",
    "|---|---|---|---|",
  ];
  for (const fact of Object.keys(report.facts).sort()) {
    for (const status of Object.keys(report.facts[fact]).sort()) {
      for (const [outcome, count] of Object.entries(report.facts[fact][status]).sort()) {
        lines.push(`| ${fact} | ${status} | ${outcome} | ${count} |`);
      }
    }
  }
  lines.push(
    "",
    `**Differences: ${report.differences.length}** (must be 0). Facts added by the context evaluation: ${report.evaluatorFacts}.`,
    "",
    `Project context: ${p.checked} values checked, ${p.same} same, **${p.differs.length} differ, ${p.missing.length} missing** (must be 0); fields with no platform field: ${p.notImported.length}`,
    "",
    `Placement and discourse: ${f.checked} values checked, ${f.same} same, **${f.differs.length} differ, ${f.missing.length} missing** (must be 0)`,
    ""
  );
  if (details) {
    for (const k of report.strings.missing) lines.push(`- string missing: ${k}`);
    for (const d of report.differences) lines.push(`- ${d.key} [${d.lang}] ${d.fact} (${d.status}): ${d.outcome}`);
    for (const path of p.differs) lines.push(`- project differs: ${path}`);
    for (const path of p.missing) lines.push(`- project missing: ${path}`);
    for (const key of p.notImported) lines.push(`- field not imported: ${key}`);
    for (const path of f.differs) lines.push(`- string field differs: ${path}`);
    for (const path of f.missing) lines.push(`- string field missing: ${path}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

function readJson(path, name) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new InputError(`${name}: not valid JSON`);
  }
}

export function loadInput(dir) {
  const factsPath = join(dir, "context_facts.jsonl");
  const payloadPath = join(dir, "tools", "platform_import.json");
  const readbackPath = join(dir, "tools", "context_readback.json");
  if (!existsSync(readbackPath)) throw new InputError("tools/context_readback.json: not found");
  return {
    facts: existsSync(factsPath) ? parseJsonl(readFileSync(factsPath, "utf8"), "context_facts.jsonl") : [],
    payload: existsSync(payloadPath) ? readJson(payloadPath, "tools/platform_import.json") : null,
    readback: readJson(readbackPath, "tools/context_readback.json"),
  };
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
    const report = buildReport(loadInput(dir));
    out.write(opts.json ? JSON.stringify(toJson(report, opts.details), null, 2) + "\n" : toMarkdown(report, opts.details));
    return report.ok ? 0 : 1;
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    err.write(`${e.message}\nUsage: node context-readback.mjs [--project <dir>] [--json] [--details]\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
