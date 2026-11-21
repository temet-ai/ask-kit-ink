// A client for Ink 8 terminal apps: six subjects (ink-fullscreen, ink-input,
// ink-frame-performance, ink-testing, ink-storybook, host-parts-tui) indexed by heading and
// searched, and an inspection of an Ink app's own code against what they say.
//
// Each subject is answered from the kit's own playbook in skills/. When SKILLS_DIR names a folder
// holding a skill folder of the same name (its SKILL.md and references/), that text is read at run
// time instead. Reading never writes
// anything. The one changing call, addRenderOptions, needs `act`. Nothing here runs the app, its
// tests or its build.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyse } from "./app.mjs";

const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};

const home = () => process.env.HOME || os.homedir();
const expand = (p) => String(p).replace(/^~(?=\/|$)/, home());
const tilde = (p) => (p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p);
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s));

// The six skills, and the kit playbook that stands in for each when the skill is not installed.
export const SKILLS = [
  { name: "ink-fullscreen", about: "render options and why, sizing the root, full clear, Static and console, resize, Ctrl+C, suspend, restore, esbuild bundle", playbook: "setup-fullscreen" },
  { name: "ink-input", about: "keys, Escape wait, kitty keyboard, paste, mouse and why Ink drops it, stdin tap, selection, OSC 52, OSC 8, OSC 22", playbook: "mouse-selection" },
  { name: "ink-frame-performance", about: "where a frame's time goes, windowing, fewer Text nodes, cell rows, fast Output, paint layers, measuring", playbook: "fast-frames" },
  { name: "ink-testing", about: "stub streams, renderToString, FORCE_COLOR and CI, contract tests, byte budgets, pty tests, live tmux check", playbook: "write-tests" },
  { name: "ink-storybook", about: "Ink components in Storybook: shims, top-level await, static build check, manifest, docgen", playbook: "storybook-for-ink" },
  { name: "host-parts-tui", about: "Rust host plus one crate per part, view data, IPC to an Ink renderer, theme, setup, tests", playbook: "split-host-and-parts" },
];

// Words people use, and the words the skills use for the same thing.
const ALIASES = [
  [/flicker|blink|redraw|repaint|flash/, ["clear", "fullscreen", "incrementalRendering", "Static", "height", "frame"]],
  [/\blag|slow|latency|laggy|sluggish|cpu|burn/, ["latency", "maxFps", "windowing", "tokenises", "Output.get", "frame", "measure"]],
  [/escape|\besc\b/, ["Escape", "wait", "20 ms", "lone", "Alt", "timing"]],
  [/mouse|click|hover|wheel|scroll/, ["mouse", "SGR", "stdin", "tap", "1006"]],
  [/select|copy|clipboard/, ["selection", "OSC 52", "copy"]],
  [/paste/, ["paste", "bracketed", "usePaste", "2004"]],
  [/deaf|dead|nothing|ignores|stops? (reading|responding)|first key/, ["drain", "deaf", "readable", "stdin", "tap", "pty"]],
  [/restor|garbage|stuck|left behind|raw mode|after exit|not restored/, ["restore", "RESTORE", "alternate", "mouse", "cursor", "exit"]],
  [/console|log(s|ging)?\b/, ["console", "patchConsole", "Static", "stdout"]],
  [/\bstatic\b/, ["Static", "alternate screen", "full clear"]],
  [/bundle|esbuild|single file|cjs|esm/, ["esbuild", "bundle", "ESM", "react-devtools-core", "NODE_ENV"]],
  [/ctrl\+?c|sigint|interrupt/, ["Ctrl+C", "exitOnCtrlC", "ISIG"]],
  [/resize|terminal size|columns|rows/, ["resize", "columns", "rows", "root"]],
  [/suspend|editor|\$editor|child program/, ["suspendTerminal", "suspend"]],
  [/100 col|ink-testing-library|fixed width/, ["ink-testing-library", "100 columns", "stub"]],
  [/snapshot|ci\b|colou?r/, ["FORCE_COLOR", "CI", "chalk", "snapshot"]],
  [/pty|real terminal|tmux|live/, ["pty", "tmux", "live", "restored"]],
  [/contract|invariant/, ["contract", "every field", "overlay", "chunking"]],
  [/budget|bytes/, ["frame bytes", "budget", "incremental"]],
  [/story ?book|stories/, ["Storybook", "yoga", "shim"]],
  [/spins?\b|spinner|forever|hang|hangs|hung/, ["spinner", "top-level", "await", "trap", "symptom"]],
  [/width|wide|emoji|wrap|unicode/, ["width", "string-width", "wide", "wrap"]],
  [/focus|tab key/, ["useFocus", "disableFocus", "Tab"]],
  [/text node|<text|transform/, ["Text", "Transform", "cell", "rows"]],
  [/window|long list|virtual/, ["window", "list", "firstRow"]],
  [/ipc|host|rust|protocol|parity/, ["IPC", "host", "protocol", "parity", "ts-rs"]],
  [/theme|icon|colou?r slot/, ["theme", "look", "icon"]],
  [/link|osc 8|pointer|osc 22/, ["OSC 8", "OSC 22", "link", "pointer"]],
  [/kitty|shift\+enter|modifier/, ["kitty", "keyboard"]],
  [/\bkey\b.*(nothing|ignored|twice|alt)|f-?keys?|function key/, ["useInput", "Key", "F-keys", "Alt", "tokenize"]],
];
const STOP = new Set("every doe go after first before still just keep keeps got goes going a an the and or of to in on for with at by from as is are was were be it its this that these those i you we my your our do does did can how what which why when where there about into over than then so if but any all some each not no should would will set sets use used using get gets make makes need needs want app apps ink full screen terminal".split(" "));

const tokens = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[`*_#>\[\]()"'.,:;!?\\|{}=<]/g, " ")
    .split(/[\s\/\-]+/)
    .map((w) => (w.length > 4 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 1 && !STOP.has(w));

/** Headings of one Markdown file, ignoring fenced code. Lines are 1-based. */
function parseMd(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let i = 0, fm = {};
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
      if (m) fm[m[1]] = m[2];
    }
    i++;
  }
  const heads = [];
  let fence = false;
  for (; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const m = !fence && /^(#{1,4})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (m) heads.push({ level: m[1].length, heading: m[2].replace(/`/g, ""), line: i + 1 });
  }
  const trail = [];
  const sections = heads.map((h, k) => {
    trail.length = h.level - 1;
    trail[h.level - 1] = h.heading;
    return { ...h, trail: trail.filter(Boolean).join(" > "), end: (heads[k + 1]?.line ?? lines.length + 1) - 1 };
  });
  return { lines, fm, sections };
}

export function make(o) {
  return build(o, null);
}

function build({ settings, push, kitDir, cwd, act }, rootOverride) {
  // SKILLS_DIR is optional: a folder of your own skill folders named like the six subjects (each with a SKILL.md). Empty: the kit's playbooks only.
  const skillsRaw = process.env.SKILLS_DIR || settings?.SKILLS_DIR || "";
  const skillsDir = skillsRaw ? path.resolve(expand(skillsRaw)) : null;
  const repoRoot = path.resolve(rootOverride ?? expand(settings?.INK_REPO || cwd || process.cwd()));
  const kitSkills = path.join(kitDir || path.dirname(new URL(import.meta.url).pathname), "skills");
  let cache = null;

  /** Every section of every skill file (or of the kit's playbook for a skill that is not installed). */
  function load() {
    if (cache) return cache;
    const files = [], missing = [];
    const addFile = (skill, abs, label, source) => {
      let text;
      try { text = fs.readFileSync(abs, "utf8"); } catch { return false; }
      const md = parseMd(text);
      files.push({ skill, abs, label, source, md, description: md.fm.description ?? md.lines.find((l) => l.trim() && !l.startsWith("#")) ?? "" });
      return true;
    };
    for (const s of SKILLS) {
      const dir = skillsDir ? path.join(skillsDir, s.name) : null;
      const main = dir ? path.join(dir, "SKILL.md") : null;
      if (main && addFile(s.name, main, tilde(main), "skills")) {
        let refs = [];
        try { refs = fs.readdirSync(path.join(dir, "references")).filter((f) => f.endsWith(".md")).sort(); } catch {}
        for (const r of refs) { const p = path.join(dir, "references", r); addFile(s.name, p, tilde(p), "skills"); }
      } else {
        missing.push(s.name);
        const pb = path.join(kitSkills, `${s.playbook}.md`);
        addFile(s.name, pb, pb, "kit");
      }
    }
    const sections = [];
    for (const f of files) for (const sec of f.md.sections) sections.push({ skill: f.skill, file: f, ...sec, ref: `${f.label}:${sec.line}`, source: f.source });
    return (cache = { files, sections, missing });
  }

  const bodyOf = (sec, max = 400) => sec.file.md.lines.slice(sec.line, Math.min(sec.end, sec.line + max)).join("\n");
  const opening = (sec, n = 3) => {
    const out = [];
    for (let i = sec.line; i < sec.end && out.length < n; i++) {
      const l = sec.file.md.lines[i];
      if (l.trim() && !/^\s*(```|~~~|\|[-: |]+\|?\s*$)/.test(l)) out.push(clip(l.trim(), 170));
    }
    return out;
  };
  const view = (sec, extra = {}) => ({ ref: sec.ref, skill: sec.skill, heading: sec.trail, lines: sec.end - sec.line + 1, source: sec.source, opening: opening(sec), ...extra });

  /** The first section of a skill whose heading holds all of the words, or null. */
  function find(skill, ...words) {
    const { sections } = load();
    const w = words.map((x) => x.toLowerCase());
    return sections.find((s) => s.skill === skill && w.every((x) => s.trail.toLowerCase().includes(x))) ?? null;
  }
  /** `path:line heading` for a skill section, used as the evidence of a fault. */
  const refOf = (skill, ...words) => {
    const s = find(skill, ...words);
    return s ? `${s.ref} ${s.heading}` : `${skill} (section "${words.join(" ")}" not found)`;
  };

  function search(q, { skill, max = 6, matches = 2 } = {}) {
    const { sections, missing, files } = load();
    const raw = tokens(q);
    const lower = String(q).toLowerCase();
    // Words the skills never use (flicker, lag, deaf) are replaced by the skills' own words at full weight; the rest are hints.
    const vocab = (cache.vocab ??= new Set(sections.flatMap((s) => tokens(s.trail + " " + bodyOf(s)))));
    const unknown = raw.filter((t) => !vocab.has(t));
    const extra = [], strong = new Set();
    for (const [re, add] of ALIASES) {
      if (!re.test(lower)) continue;
      extra.push(...add);
      if (unknown.some((t) => re.test(t))) for (const a of tokens(add.join(" "))) strong.add(a);
    }
    const want = [...new Set([...raw, ...tokens(extra.join(" "))])];
    const scored = [];
    for (const s of sections) {
      if (skill && s.skill !== skill) continue;
      const head = tokens(s.trail), body = tokens(bodyOf(s)), bodyText = bodyOf(s).toLowerCase(), headText = s.trail.toLowerCase();
      let score = 0;
      for (const t of want) {
        const w = raw.includes(t) || strong.has(t) ? 1 : 0.35;
        if (head.includes(t)) score += 4 * w;
        const n = body.filter((b) => b === t).length;
        score += Math.min(n, 4) * w;
      }
      for (let i = 0; i + 1 < raw.length; i++) if (bodyText.includes(`${raw[i]} ${raw[i + 1]}`) || headText.includes(`${raw[i]} ${raw[i + 1]}`)) score += 3;
      if (raw.length && raw.every((t) => head.includes(t) || body.includes(t))) score += 5;
      if (score > 0) scored.push({ s, score: (score / (1 + (s.end - s.line) / 150)) * (s.skill === "host-parts-tui" ? 1 : 1.3) * (s.level === 1 ? 0.6 : 1) });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, max).map(({ s, score }) => {
      const lines = [];
      for (let i = s.line; i < s.end; i++) {
        const l = s.file.md.lines[i];
        const lt = tokens(l);
        const hit = want.filter((t) => lt.includes(t)).length;
        if (hit >= 2 || (hit >= 1 && raw.length === 1)) lines.push({ line: i + 1, hit, text: clip(l.trim(), 170) });
      }
      lines.sort((a, b) => b.hit - a.hit || a.line - b.line);
      return view(s, { score: Math.round(score * 10) / 10, matches: lines.slice(0, matches).map((m) => ({ ref: `${s.file.label}:${m.line}`, text: m.text })) });
    });
    return {
      query: q, searchedFor: want.slice(0, 16), skillsDir: skillsDir ? tilde(skillsDir) : null,
      source: missing.length ? (missing.length === SKILLS.length ? "kit playbooks only" : `skills, kit playbooks for: ${missing.join(", ")}`) : "skills",
      sections: sections.length, files: files.length, found: scored.length, results,
      next: "ink.section(ref) reads one section whole",
    };
  }

  /** One section's text by its ref (`path:line` as search prints it). Cut at `max` lines. */
  function section(refOrPath, { max = 90 } = {}) {
    const { sections } = load();
    const m = /^(.*?):(\d+)$/.exec(String(refOrPath));
    if (!m) throw new Error(`give a ref as path:line, for example ${sections[0]?.ref ?? "skills/setup-fullscreen.md:20"}`);
    const abs = path.resolve(expand(m[1]));
    const line = Number(m[2]);
    const cands = sections.filter((s) => path.resolve(s.file.abs) === abs && s.line <= line && line <= s.end);
    const s = cands.sort((a, b) => b.line - a.line)[0];
    if (!s) throw new Error(`no section of an indexed skill holds ${refOrPath}; the indexed files are ink.skills()`);
    const body = s.file.md.lines.slice(s.line - 1, s.end);
    const text = body.slice(0, max).map((l, i) => `${s.line + i}\t${l}`).join("\n");
    return { ref: s.ref, skill: s.skill, heading: s.trail, from: s.line, to: s.end, cut: Math.max(0, body.length - max), text };
  }

  function skills() {
    const { files, missing } = load();
    return {
      skillsDir: skillsDir ? tilde(skillsDir) : null, source: missing.length ? `kit playbooks stand in for: ${missing.join(", ")}` : "all six skills found",
      skills: SKILLS.map((s) => ({ name: s.name, about: s.about, installed: !missing.includes(s.name), playbook: `skills.read("${s.playbook}")`,
        files: files.filter((f) => f.skill === s.name).map((f) => ({ path: f.label, lines: f.md.lines.length, sections: f.md.sections.length, description: clip(f.description, 200) })) })),
    };
  }

  /** The render options table of ink-fullscreen as {option: {inkDefault, setTo, why, ref}}; empty when the skill is not installed. */
  function optionTable() {
    const s = find("ink-fullscreen", "render call");
    if (!s || s.source !== "skills") return {};
    const out = {};
    for (let i = s.line; i < s.end; i++) {
      const row = s.file.md.lines[i];
      const m = /^\|\s*`(\w+)`\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/.exec(row);
      if (m) out[m[1]] = { inkDefault: m[2].replace(/`/g, ""), setTo: m[3].replace(/`/g, ""), why: m[4].replace(/\*\*/g, ""), ref: `${s.file.label}:${i + 1}` };
    }
    return out;
  }

  const ctx = { repoRoot, find, refOf, optionTable, SKILLS };
  const app = analyse(ctx);

  async function addRenderOptions(options = {}, o = {}) {
    if (!act) notInThisAsk("editing the render() options of the app");
    return app.addRenderOptions(options, o);
  }

  /** Lines of a file inside the repository, numbered, for code a fact points at (any repository `at` opened). */
  function read(file, { from = 1, to } = {}) {
    const abs = path.resolve(repoRoot, String(file));
    if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) throw new Error(`${file} is outside ${repoRoot}`);
    if (/(^|\/)(\.env[^/]*|[^/]*(credential|secret|token)[^/]*|[^/]*\.(pem|key)|id_(rsa|ed25519)[^/]*|auth\.json|\.npmrc)$/i.test(abs)) throw new Error("that file can hold credentials and is not read");
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const end = Math.min(lines.length, to ?? from + 79, from + 199);
    return { file: path.relative(repoRoot, abs), from, to: end, lines: lines.length, text: lines.slice(from - 1, end).map((l, i) => `${from + i}\t${l}`).join("\n") };
  }

  /** The same client for another repository (a question that names a path is answered there). */
  const at = (dir) => build({ settings, push, kitDir, cwd, act }, path.resolve(expand(String(dir)).replace(/^(?!\/)/, repoRoot + "/")));

  return { skillsDir, repoRoot, skills, search, section, find, refOf, read, at, ...app, addRenderOptions };
}
