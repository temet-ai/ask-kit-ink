// Reading an Ink app's own code: where its renderer package is, how render() is called, what reads
// stdin, what writes to the terminal, how it restores, how it is bundled and tested, which versions
// it has, and whether the Rust host and the renderer agree on the IPC message types. Text matching
// with a small bracket matcher; nothing is run.
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "target", "coverage", "storybook-static", ".next", ".cache", "worktrees", ".claude", ".turbo", ".venv", "out", ".yarn", "vendor"]);
const CODE = /\.(m|c)?(t|j)sx?$/;
const SECRET = /(^|\/)(\.env[^/]*|[^/]*(credential|secret|token)[^/]*|[^/]*\.(pem|key)|id_(rsa|ed25519)[^/]*|auth\.json|\.npmrc)$/i;
const clip = (s, n = 160) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s));
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const json = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => fs.existsSync(p);

function walk(dir, { depth = 8, cap = 30000, file = () => true } = {}) {
  const out = [];
  (function go(d, n) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      const p = path.join(d, e.name);
      let isD = e.isDirectory();
      if (e.isSymbolicLink()) isD = isDir(p);
      if (isD) { if (!SKIP.has(e.name) && n < depth) go(p, n + 1); }
      else if (file(p, e.name) && !SECRET.test(p)) out.push(p);
    }
  })(dir, 0);
  return out;
}

/** Index of the bracket that closes the one at `open`, skipping strings and comments; -1 when none. */
function close(text, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const o = text[open], c = pairs[o];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (ch === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}

/** Split the inside of an object literal or argument list at its top-level commas; each part with its start and end index in `s`. */
function splitTopPos(s) {
  const parts = [];
  let depth = 0, cur = "", from = 0;
  const push = (to) => { if (cur.trim()) { const lead = cur.length - cur.trimStart().length; parts.push({ text: cur.trim(), start: from + lead, end: from + lead + cur.trim().length - 1 }); } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "/" && s[i + 1] === "/") { const e = s.indexOf("\n", i); i = e < 0 ? s.length : e; continue; }
    if (ch === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      for (; j < s.length && s[j] !== ch; j++) if (s[j] === "\\") j++;
      cur += s.slice(i, j + 1); i = j; continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { push(i); cur = ""; from = i + 1; } else cur += ch;
  }
  push(s.length);
  return parts;
}
const splitTop = (s) => splitTopPos(s).map((p) => p.text);

/** `{ a: 1, ...b, c }` as { entries: {a: "1", c: "c"}, spreads: ["b"] }. */
function parseObject(lit) {
  const inner = lit.trim().replace(/^\{/, "").replace(/\}\s*(as const|satisfies [\w<>]+)?\s*$/, "");
  const entries = {}, spreads = [];
  for (const part of splitTop(inner)) {
    let m;
    if ((m = /^\.\.\.\s*(.+)$/s.exec(part))) spreads.push(m[1].trim());
    else if ((m = /^["']?([\w$]+)["']?\s*:\s*(.+)$/s.exec(part))) entries[m[1]] = m[2].replace(/\s+/g, " ").trim();
    else if (/^[\w$]+$/.test(part)) entries[part] = part;
    else if ((m = /^([\w$]+)\s*\(/.exec(part))) entries[m[1]] = "(method)";
  }
  return { entries, spreads };
}

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export function analyse(ctx) {
  const { repoRoot } = ctx;
  const cache = new Map();
  const rel = (p) => path.relative(repoRoot, p) || ".";
  const text = (p) => { if (!cache.has(p)) cache.set(p, rd(p)); return cache.get(p); };
  const lineAt = (t, idx) => t.slice(0, idx).split("\n").length;
  const kindOf = (r) =>
    /(^|\/)(test|tests|__tests__|spec)\//.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(r) ? "test"
    : /(^|\/)stories\/|\.stories\./.test(r) ? "story"
    : /(^|\/)\.storybook\//.test(r) ? "storybook"
    : /(^|\/)(tools|scripts)\//.test(r) ? "tool" : "src";

  // ------------------------------------------------------------------ finding the renderer package

  let appsCache = null;
  function apps() {
    if (appsCache) return appsCache;
    const out = [];
    const pkgs = walk(repoRoot, { depth: 5, file: (p, n) => n === "package.json" });
    for (const p of pkgs) {
      const j = json(p);
      if (!j) continue;
      const dep = { ...j.peerDependencies, ...j.devDependencies, ...j.dependencies };
      if (!dep.ink) continue;
      const dir = path.dirname(p);
      const installed = (n) => json(path.join(dir, "node_modules", n, "package.json"))?.version ?? json(path.join(repoRoot, "node_modules", n, "package.json"))?.version ?? null;
      const files = walk(dir, { depth: 10, file: (q) => CODE.test(q) });
      const importsInk = files.some((f) => /from\s+["']ink["']/.test(text(f) ?? ""));
      out.push({
        dir, path: rel(dir), name: j.name, private: !!j.private, ink: dep.ink, inkInDependencies: !!j.dependencies?.ink,
        inkInstalled: installed("ink"), react: dep.react ?? null, reactInstalled: installed("react"),
        isInkItself: j.name === "ink", isLibrary: !importsInk && j.name !== "ink" ? false : false, importsInk,
        renders: files.some((f) => /\brender\s*\(/.test(text(f) ?? "") && /from\s+["']ink["']/.test(text(f) ?? "") && kindOf(rel(f)) === "src"),
        pkg: j, files,
      });
    }
    out.sort((a, b) => Number(b.renders) - Number(a.renders) || a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    return (appsCache = out);
  }

  /** The app to inspect: `which` (a folder, absolute or relative to the repository) or the first one that calls render(). */
  function pick(which) {
    const all = apps();
    if (!all.length) throw new Error(`no package.json depending on "ink" under ${repoRoot} (searched 5 levels, skipping node_modules, target and worktrees); name the renderer folder with { app: "path" } if it is elsewhere`);
    if (which) {
      const abs = path.resolve(repoRoot, String(which));
      const a = all.find((x) => x.dir === abs || x.path === which || x.dir === path.resolve(abs, ".."));
      if (!a) throw new Error(`${which} is not an Ink app folder; found: ${all.map((x) => x.path).join(", ")}`);
      return a;
    }
    const app = all.find((a) => a.renders && !a.isInkItself) ?? all.find((a) => !a.isInkItself);
    if (!app) throw new Error(`the only package depending on ink here is Ink's own checkout (${all[0].path}), which is the library, not an app; pass { app } for an app folder`);
    return app;
  }

  const filesOf = (a, kinds) => a.files.map((abs) => ({ abs, r: rel(abs), kind: kindOf(rel(abs)), t: text(abs) ?? "" })).filter((f) => !kinds || kinds.includes(f.kind));

  /** Every match of `re` in the app's files of the given kinds, as {file, line, text}. */
  function grep(a, re, kinds = ["src"], max = 40) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const hits = [];
    let total = 0;
    for (const f of filesOf(a, kinds)) {
      const lines = f.t.split("\n");
      for (let i = 0; i < lines.length; i++) {
        g.lastIndex = 0;
        if (g.test(lines[i]) && !/^\s*(\/\/|\*|\/\*)/.test(lines[i])) { total++; if (hits.length < max) hits.push({ at: `${f.r}:${i + 1}`, text: clip(lines[i].trim()) }); }
      }
    }
    return { total, hits, cut: Math.max(0, total - hits.length) };
  }

  // ------------------------------------------------------------------ render() and its options

  /** Resolve an identifier to an object literal: same file first, then a relative import. */
  function resolveObject(name, f, a, seen = new Set()) {
    if (seen.has(f.abs + name)) return null;
    seen.add(f.abs + name);
    const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`).exec(f.t);
    if (decl) {
      const open = decl.index + decl[0].length - 1;
      const end = close(f.t, open);
      if (end > 0) return { file: f.r, line: lineAt(f.t, decl.index), abs: f.abs, start: open, end, ...parseObject(f.t.slice(open, end + 1)) };
    }
    const imp = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`).exec(f.t);
    if (imp) {
      const spec = imp[1];
      if (!spec.startsWith(".")) return { package: spec, file: f.r, line: lineAt(f.t, imp.index), entries: {}, spreads: [] };
      const base = path.resolve(path.dirname(f.abs), spec.replace(/\.(m|c)?js$/, ""));
      for (const cand of [base + ".ts", base + ".tsx", base + ".js", base + ".mjs", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (exists(cand)) return resolveObject(name, { abs: cand, r: rel(cand), t: text(cand) ?? "" }, a, seen);
      }
    }
    return null;
  }

  function renderCalls(a, kinds = ["src"]) {
    const calls = [];
    for (const f of filesOf(a, kinds)) {
      const imports = /import\s*\{[^}]*\brender\b[^}]*\}\s*from\s*["']ink["']/.test(f.t);
      const ns = /import\s*\*\s*as\s+(\w+)\s+from\s*["']ink["']/.exec(f.t);
      if (!imports && !ns) continue;
      const re = ns ? new RegExp(`\\b${ns[1]}\\.render\\s*\\(`, "g") : /(?<![\w.$])render\s*\(/g;
      for (const m of f.t.matchAll(re)) {
        const open = m.index + m[0].length - 1;
        const end = close(f.t, open);
        if (end < 0) continue;
        const argPos = splitTopPos(f.t.slice(open + 1, end));
        const args = argPos.map((p) => p.text);
        const call = { file: f.r, line: lineAt(f.t, m.index), at: `${f.r}:${lineAt(f.t, m.index)}`, args: args.length, optionsArg: args[1] ? clip(args[1].replace(/\s+/g, " "), 120) : null, entries: {}, spreads: [], from: null, viaPackage: null, resolved: !args[1], literal: null };
        if (args[1]) {
          const arg = args[1];
          if (arg.startsWith("{")) {
            const o = parseObject(arg);
            Object.assign(call.entries, o.entries);
            call.spreads = o.spreads;
            call.resolved = true;
            const start = open + 1 + argPos[1].start;
            call.literal = { abs: f.abs, start, end: close(f.t, start) };
            call.from = call.at;
          } else {
            call.spreads = [arg.replace(/\s+as const$/, "")];
          }
          for (const sp of [...call.spreads]) {
            const name = sp.replace(/\s+as const$/, "");
            if (!/^[\w$]+$/.test(name)) continue;
            const r = resolveObject(name, f, a);
            if (!r) continue;
            if (r.package) { call.viaPackage = `${name} from "${r.package}" (${r.file}:${r.line})`; continue; }
            call.spreads = call.spreads.filter((x) => x !== sp);
            call.entries = { ...r.entries, ...call.entries };
            call.resolved = true;
            call.from = call.from ?? `${r.file}:${r.line}`;
            if (!call.literal) call.literal = { abs: r.abs, start: r.start, end: r.end };
          }
        }
        calls.push(call);
      }
    }
    return calls;
  }

  const truthy = (v) => v === "true";
  const falsy = (v) => v === "false";
  const num = (v) => (v != null && /^[\d_.]+$/.test(v) ? Number(v.replace(/_/g, "")) : null);
  // What the skill sets and what is missing counts as. `ok` judges the value found.
  const RECOMMENDED = {
    interactive: { want: "true", ok: truthy, absent: "Ink's default is `!isInCi && stdout.isTTY`: with CI=true in the environment the renderer goes non-interactive and writes nothing until unmount", fix: "interactive: true" },
    alternateScreen: { want: "true", ok: truthy, absent: "default false: a full-screen app would draw into the scrollback", fix: "alternateScreen: true" },
    exitOnCtrlC: { want: "false", ok: falsy, absent: "default true: Ink exits on Ctrl+C and useInput never sees it", fix: "exitOnCtrlC: false" },
    patchConsole: { want: "false", ok: falsy, absent: "default true: each console.* clears the frame, prints and redraws, which inserts a row on a full-height alternate screen", fix: "patchConsole: false" },
    incrementalRendering: { want: "true", ok: truthy, absent: "default false: every change erases and rewrites the whole frame (16 to 48 KB a key at 160x40)", fix: "incrementalRendering: true" },
    maxFps: { want: "120", ok: (v) => num(v) >= 60, absent: "default 30: a render waits up to 32 ms, and a key's answer is two renders", fix: "maxFps: 120" },
    isScreenReaderEnabled: { want: "false", ok: falsy, absent: "default follows INK_SCREEN_READER: with that variable set Ink draws plain wrapped text without diffing", fix: "isScreenReaderEnabled: false" },
  };

  function renderOptions(o = {}) {
    const a = pick(o.app);
    const table = ctx.optionTable();
    const calls = renderCalls(a);
    const fix = ctx.refOf("ink-fullscreen", "render call");
    const result = { app: a.path, skill: fix, calls: [] };
    for (const c of calls) {
      const viaPkg = !!c.viaPackage && !Object.keys(c.entries).length;
      const rows = [];
      for (const [k, r] of Object.entries(RECOMMENDED)) {
        const v = c.entries[k];
        const t = table[k];
        let status;
        if (v === undefined) status = viaPkg ? "from-package" : c.spreads.length && !c.resolved ? "unknown (spread not resolved)" : "missing";
        else status = r.ok(v) ? "ok" : "differs";
        rows.push({ option: k, status, found: v ?? null, recommended: r.want, why: t?.why ?? r.absent, inkDefault: t?.inkDefault, skill: t?.ref ?? fix });
      }
      const extras = Object.entries(c.entries).filter(([k]) => !(k in RECOMMENDED)).map(([k, v]) => ({ option: k, found: v, note: k === "debug" && truthy(v) ? "debug: true writes every frame whole with no cursor control: tests only" : k === "kittyKeyboard" ? "kitty keyboard: see ink-input" : undefined }));
      result.calls.push({
        at: c.at, optionsFrom: c.from ?? c.optionsArg, viaPackage: c.viaPackage,
        missing: rows.filter((r) => r.status === "missing").map((r) => r.option),
        differs: rows.filter((r) => r.status === "differs").map((r) => `${r.option}: ${r.found} (recommended ${r.recommended})`),
        options: rows, extras,
      });
    }
    if (!calls.length) result.note = "no render() call from ink found in non-test source; the entry may live outside the renderer package";
    return result;
  }

  // ------------------------------------------------------------------ the facts

  function readsStdin(a) {
    const tap = grep(a, /\bstdin\.read\s*=|\.read\s*=\s*\(/, ["src"]);
    const events = grep(a, /stdin\.(on|once|addListener)\(|setRawMode\(|stdin\.(resume|setEncoding)\(/, ["src"]);
    const hooks = {
      useInput: grep(a, /\buseInput\s*\(/, ["src"], 6),
      usePaste: grep(a, /\busePaste\s*\(/, ["src"], 4),
      useFocus: grep(a, /\buseFocus(Manager)?\s*\(/, ["src"], 4),
      disableFocus: grep(a, /\bdisableFocus\b/, ["src"], 3),
      kittyKeyboard: grep(a, /kittyKeyboard/, ["src"], 3),
    };
    // Every `x.read = ...` wrapper; one that returns null is a tap (it takes the data), and a tap must loop until read() gives null.
    const wrappers = [];
    for (const f of filesOf(a, ["src"])) {
      for (const m of f.t.matchAll(/\.read\s*=\s*\(/g)) {
        const brace = f.t.indexOf("{", m.index);
        const end = brace > 0 ? close(f.t, brace) : -1;
        const body = f.t.slice(m.index, end > 0 ? end : m.index + 1200);
        wrappers.push({ at: `${f.r}:${lineAt(f.t, m.index)}`, tap: /return\s+null\b/.test(body), loopsUntilNull: /\b(for|while)\b[\s\S]{0,160}?(!==?)\s*null/.test(body) });
      }
    }
    const taps = wrappers.filter((w) => w.tap);
    const drains = taps.length ? taps[0] : null;
    return { ownTap: taps.length > 0, wrappers: wrappers.map((w) => `${w.at}${w.tap ? " (tap" + (w.loopsUntilNull ? ", drains until null)" : ", no drain loop seen)") : " (passes through)"}`), tapDrainsUntilNull: drains, rawStdin: events, hooks: Object.fromEntries(Object.entries(hooks).map(([k, v]) => [k, { count: v.total, first: v.hits.slice(0, 2).map((h) => h.at) }])) };
  }

  /** DEC private modes the source turns on (h) and off (l). */
  function terminalModes(a) {
    const on = new Map(), off = new Map();
    for (const f of filesOf(a, ["src"])) {
      for (const m of f.t.matchAll(/\?(\d{2,4}(?:;\d{2,4})*)([hl])(?![\w])/g)) {
        for (const mode of m[1].split(";")) {
          const map = m[2] === "h" ? on : off;
          if (!map.has(mode)) map.set(mode, `${f.r}:${lineAt(f.t, m.index)}`);
        }
      }
    }
    const NAMES = { 1000: "mouse press", 1002: "mouse drag", 1003: "mouse any-motion", 1004: "focus reports", 1005: "mouse utf8", 1006: "mouse SGR", 1015: "mouse urxvt", 2004: "bracketed paste", 1049: "alternate screen", 25: "cursor", 2026: "synchronized output", 1007: "alternate scroll", 1016: "mouse pixel" };
    return {
      turnedOn: [...on].map(([m, at]) => ({ mode: m, name: NAMES[m], at })),
      turnedOff: [...off].map(([m, at]) => ({ mode: m, name: NAMES[m], at })),
      neverTurnedOff: [...on].filter(([m]) => !off.has(m) && !["25", "2026", "1049"].includes(m)).map(([m, at]) => ({ mode: m, name: NAMES[m], at })),
    };
  }

  function restore(a) {
    return {
      signals: grep(a, /["'](SIGTERM|SIGINT|SIGHUP|uncaughtException|unhandledRejection|beforeExit)["']/, ["src"], 12).hits,
      restoreCalls: grep(a, /\.restore\(|\brestore\w*\s*\(|RESTORE\b/, ["src"], 8).hits,
      leavesAlternateScreen: grep(a, /1049l|alternateScreen/, ["src"], 4).hits,
      suspendTerminal: grep(a, /suspendTerminal/, ["src"], 3).hits,
      errorBoundary: grep(a, /componentDidCatch|getDerivedStateFromError/, ["src"], 2).hits,
      modes: terminalModes(a),
    };
  }

  function consoleAndStatic(a) {
    return {
      console: grep(a, /\bconsole\.(log|error|warn|info|debug|trace)\s*\(/, ["src"], 12),
      staticUses: grep(a, /<Static\b|\bStatic\b[^\n]*from\s+["']ink["']|import\s*\{[^}]*\bStatic\b[^}]*\}\s*from\s*["']ink["']/, ["src"], 6),
      // writes of mode switches, pointer shapes and clipboard sequences are what the skill allows outside a frame
      stdoutWrites: (() => { const g = grep(a, /process\.stdout\.write\(|\bstdout\.write\(/, ["src"], 60); const hits = g.hits.filter((h) => !/pointer|osc|clipboard|restore|\\x1b|\\u001b|\bESC\b/i.test(h.text)); return { total: hits.length, hits: hits.slice(0, 12), cut: Math.max(0, hits.length - 12) }; })(),
      stderrWrites: grep(a, /process\.stderr\.write\(/, ["src"], 6),
      debugTrue: grep(a, /\bdebug\s*:\s*true/, ["src"], 4),
    };
  }

  /** Text nodes per row: for each `.map(` callback that draws JSX, how many <Text> it creates. */
  function textNodes(a) {
    const maps = [];
    let textTags = 0, transforms = 0, nested = 0, files = 0;
    for (const f of filesOf(a, ["src"])) {
      if (!/\.(t|j)sx$/.test(f.abs)) continue;
      const t = f.t;
      const n = [...t.matchAll(/<Text\b/g)].length;
      textTags += n; transforms += [...t.matchAll(/<Transform\b/g)].length;
      if (n) files++;
      // nested Text: a <Text> opened while another is open
      let depth = 0;
      for (const m of t.matchAll(/<(\/?)Text\b[^>]*?(\/?)>/gs)) {
        if (m[1]) depth = Math.max(0, depth - 1);
        else { if (depth > 0) nested++; if (!m[2]) depth++; }
      }
      for (const m of t.matchAll(/\.map\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const end = close(t, open);
        if (end < 0) continue;
        const body = t.slice(open, end);
        const texts = [...body.matchAll(/<Text\b/g)].length;
        if (!texts) continue;
        const tr = [...body.matchAll(/<Transform\b/g)].length;
        maps.push({ at: `${f.r}:${lineAt(t, m.index)}`, textPerRow: texts, transforms: tr, boxes: [...body.matchAll(/<Box\b/g)].length });
      }
    }
    maps.sort((x, y) => y.textPerRow + 3 * y.transforms - (x.textPerRow + 3 * x.transforms));
    const model = grep(a, /\bCellBlock\b|\buseRowCache\b|\bsetFramePaint\b|ink-output|fast-output/, ["src"], 6);
    const windowing = grep(a, /\bfirstRow\s*\(|\bvirtuali[sz]\w*\b/, ["src"], 4);
    const windowFiles = filesOf(a, ["src"]).filter((f) => /(^|\/)(window|windowing|virtual\w*)\.[tj]sx?$/.test(f.r)).map((f) => f.r);
    return {
      textTagsInSource: textTags, filesWithText: files, transformTags: transforms, textInsideText: nested,
      rowLoops: maps.length, worstRowLoops: maps.slice(0, 8), maxTextPerRow: maps[0]?.textPerRow ?? 0,
      cellRowModel: model.hits.map((h) => h.at), windowing: [...windowFiles, ...windowing.hits.map((h) => h.at)],
    };
  }

  function bundle(a) {
    const scripts = a.pkg.scripts ?? {};
    const name = Object.keys(scripts).find((k) => /esbuild|tsup|rollup|webpack|vite build|bun build|ncc /.test(scripts[k]) && !/storybook/.test(scripts[k])) ;
    const cmd = name ? scripts[name] : null;
    const configs = ["esbuild.config.mjs", "esbuild.config.js", "esbuild.mjs", "build.mjs", "tsup.config.ts", "rollup.config.js", "webpack.config.js", "vite.config.ts"].filter((f) => exists(path.join(a.dir, f))).map((f) => rel(path.join(a.dir, f)));
    const cfgText = configs.map((c) => rd(path.join(repoRoot, c)) ?? "").join("\n");
    const src = (cmd ?? "") + "\n" + cfgText;
    const has = (re) => re.test(src);
    const out = {
      script: name ? `package.json scripts.${name}` : null, command: cmd ? clip(cmd, 400) : null, configFiles: configs,
      tool: /esbuild/.test(src) ? "esbuild" : /tsup/.test(src) ? "tsup" : /rollup/.test(src) ? "rollup" : /webpack/.test(src) ? "webpack" : null,
      bundles: has(/--bundle|bundle:\s*true/), formatEsm: has(/--format=esm|format:\s*["']esm["']/), platformNode: has(/--platform=node|platform:\s*["']node["']/),
      target: (/--target=(\S+)|target:\s*["']([^"']+)["']/.exec(src) ?? [])[1] ?? (/target:\s*["']([^"']+)["']/.exec(src) ?? [])[1] ?? null,
      devtoolsStub: has(/react-devtools-core/), nodeEnvProduction: has(/process\.env\.NODE_ENV/), inkOutputAlias: has(/ink-output/),
      requireShimImported: grep(a, /require-shim/, ["src"], 2).hits.map((h) => h.at), noFetchImported: grep(a, /no-fetch/, ["src"], 2).hits.map((h) => h.at),
    };
    return out;
  }

  function versions(a) {
    const lockPath = ["package-lock.json", "npm-shrinkwrap.json"].map((f) => path.join(a.dir, f)).find(exists) ?? path.join(repoRoot, "package-lock.json");
    const lock = json(lockPath);
    const lockInk = lock?.packages ? Object.entries(lock.packages).filter(([k]) => /(^|\/)node_modules\/ink$/.test(k)).map(([k, v]) => `${k || "."}@${v.version}`) : [];
    const lockReact = lock?.packages ? Object.entries(lock.packages).filter(([k]) => /(^|\/)node_modules\/react$/.test(k)).map(([k, v]) => `${k}@${v.version}`) : [];
    const d = { ...a.pkg.devDependencies, ...a.pkg.dependencies };
    const installed = (n) => json(path.join(a.dir, "node_modules", n, "package.json"))?.version ?? null;
    const reach = grep(a, /["']ink\/build\/|ink-output|from\s+["']ink\/build/, ["src", "tool", "storybook"], 3);
    return {
      package: a.pkg.name, ink: { range: a.ink, installed: a.inkInstalled, inDependencies: a.inkInstalled != null ? a.inkInDependencies : null, locked: lockInk, pinnedExactly: /^\d/.test(a.ink), reachesIntoInkBuild: reach.hits.map((h) => h.at) },
      react: { range: a.react, installed: a.reactInstalled, locked: lockReact },
      reactReconciler: installed("react-reconciler"), esbuild: d.esbuild ?? null, typescript: d.typescript ?? null, testRunner: d.vitest ? `vitest ${d.vitest}` : d.jest ? `jest ${d.jest}` : d.mocha ? "mocha" : (a.pkg.scripts?.test ?? "").includes("node --test") ? "node:test" : null,
      inkTestingLibrary: d["ink-testing-library"] ?? null, nodeEngine: a.pkg.engines?.node ?? null, lockfile: exists(lockPath) ? rel(lockPath) : null,
    };
  }

  function storybook(a) {
    const dir = path.join(a.dir, ".storybook");
    if (!isDir(dir)) return { present: false };
    const all = walk(dir, { depth: 4 }).map((p) => ({ r: rel(p), t: text(p) ?? "" }));
    const hit = (re) => all.filter((f) => re.test(f.t)).map((f) => f.r);
    return {
      present: true, dir: rel(dir),
      yogaShim: all.filter((f) => /yoga/i.test(f.r)).map((f) => f.r), yogaReady: hit(/yogaReady/),
      reconcilerPatch: hit(/reconciler\.js|loadPackageJson/), checkStatic: all.filter((f) => /check-static/.test(f.r)).map((f) => f.r), scriptCheckStatic: !!a.pkg.scripts?.["check-static"],
      docgenTs7: all.filter((f) => /docgen-typescript|registerHooks/.test(f.r + f.t.slice(0, 0))).map((f) => f.r).slice(0, 3), manifestTest: filesOf(a, ["test"]).filter((f) => /componentsManifest|components\.json/.test(f.t)).map((f) => f.r).slice(0, 2),
      inkVersionInStory: a.inkInstalled,
    };
  }

  // ------------------------------------------------------------------ tests

  function tests(o = {}) {
    const a = pick(o.app);
    const tf = filesOf(a, ["test"]);
    const all = tf.map((f) => f.t).join("\n");
    const ev = (re, max = 3) => {
      const out = [];
      for (const f of tf) { const m = re.exec(f.t); if (m) out.push(`${f.r}:${lineAt(f.t, m.index)}`); if (out.length >= max) break; }
      return out;
    };
    const evAny = (re, max = 3) => {
      const out = ev(re, max);
      if (out.length) return out;
      // pty and tmux checks often live in scripts, not tests
      for (const f of filesOf(a, ["tool"])) { const m = re.exec(f.t); if (m) out.push(`${f.r}:${lineAt(f.t, m.index)}`); if (out.length >= max) break; }
      return out;
    };
    const names = tf.map((f) => f.r);
    const byDir = {};
    for (const n of names) { const d = n.split("/").slice(0, -1).join("/"); byDir[d] = (byDir[d] ?? 0) + 1; }
    const lib = ev(/from\s+["']ink-testing-library["']/, 50);
    const renderCallsInTests = renderCalls(a, ["test"]);
    const stubStreams = ev(/class\s+\w+\s+extends\s+EventEmitter[\s\S]{0,300}?(columns|isTTY)/, 3);
    const withStdout = renderCallsInTests.filter((c) => /stdout/.test(c.optionsArg ?? "") || "stdout" in c.entries || c.spreads.length);
    const ptyRepo = (() => {
      const found = [];
      for (const p of walk(a.dir, { depth: 6, file: (q) => /\.(py|sh|mjs|ts|tsx|js)$/.test(q) && !/node_modules/.test(q) })) {
        const t = text(p) ?? "";
        if (/node-pty|pty\.spawn|import pty\b|openpty\(|forkpty/.test(t)) found.push(rel(p));
        if (found.length > 2) break;
      }
      const host = walk(repoRoot, { depth: 5, file: (q) => /(^|\/)\w*ink\w*pty\w*\.(rs|py)$|(^|\/)\w*pty\w*ink\w*\.(rs|py)$|(^|\/)\w*pty_(latency|keys|test)\w*\.(rs|py)$/.test(q) }).map(rel);
      return [...found, ...host].slice(0, 4);
    })();
    const tmuxRepo = (() => {
      const found = [];
      for (const p of walk(repoRoot, { depth: 5, file: (q) => /(\.sh|ink-live|\.mjs|\.py)$/.test(q) && !/node_modules/.test(q) })) {
        const t = text(p) ?? "";
        if (/tmux\s+(-L|new-session)|\btmux\b.*\$\{?\w+\}?\s+new-session/.test(t) && /alternate_on|mouse_any_flag|modes/.test(t)) found.push(rel(p));
      }
      return found.sort((x, y) => Number(/live/.test(y)) - Number(/live/.test(x))).slice(0, 3);
    })();
    const rustFixtures = walk(repoRoot, { depth: 5, file: (q) => /\.rs$/.test(q) }).filter((p) => /fixture|parity|reference|ink/.test(path.basename(p)) && /FIXTURES_DIR|FIXTURES_UPDATE|ink\/test\/fixtures/.test(text(p) ?? "")).map(rel).slice(0, 3);
    const checks = [
      { check: "stub streams with a real size", present: stubStreams.length > 0 || withStdout.length > 0, evidence: [...stubStreams, ...withStdout.map((c) => c.at)].slice(0, 3), skill: ctx.refOf("ink-testing", "harness") },
      { check: "does not rely on ink-testing-library's fixed 100 columns", present: lib.length === 0, evidence: lib.slice(0, 3), note: lib.length ? `${lib.length} test file(s) import ink-testing-library (stdout fixed at 100 columns)` : undefined, skill: ctx.refOf("ink-testing", "traps") },
      { check: "renderToString layout snapshots", present: ev(/renderToString/).length > 0, evidence: ev(/renderToString/), skill: ctx.refOf("ink-testing", "harness") },
      { check: "FORCE_COLOR or chalk.level set before chalk loads", present: /FORCE_COLOR|chalk\.level/.test(all) || /FORCE_COLOR/.test(JSON.stringify(a.pkg.scripts ?? {})) || tf.some((f) => /vitest|setup/.test(f.r) && /FORCE_COLOR/.test(f.t)) || ["vitest.config.ts", "vitest.config.mjs"].some((c) => /FORCE_COLOR/.test(rd(path.join(a.dir, c)) ?? "")), evidence: ev(/FORCE_COLOR|chalk\.level/), skill: ctx.refOf("ink-testing", "traps") },
      { check: "interactive: true (or debug: true, or CI off) in test renders", present: renderCallsInTests.length > 0 && (renderCallsInTests.filter((c) => truthy(c.entries.interactive) || truthy(c.entries.debug) || c.spreads.length > 0).length >= 0.8 * renderCallsInTests.length || /CI\s*[:=]\s*["']false["']/.test(all)), evidence: renderCallsInTests.filter((c) => truthy(c.entries.interactive) || truthy(c.entries.debug)).map((c) => c.at).slice(0, 3), note: `${renderCallsInTests.filter((c) => truthy(c.entries.interactive)).length} of ${renderCallsInTests.length} test render() calls set interactive: true, ${renderCallsInTests.filter((c) => truthy(c.entries.debug)).length} set debug: true`, skill: ctx.refOf("ink-testing", "traps") },
      { check: "unmount() called", present: /\.unmount\(\)|unmount\(\)/.test(all), evidence: ev(/unmount\(\)/), skill: ctx.refOf("ink-testing", "traps") },
      { check: "waits on state, not the clock", present: /\b(until|settle|waitFor|waitUntil)\w*\(/.test(all), evidence: ev(/\b(until|settle|waitFor|waitUntil)\w*\(/), note: `${[...all.matchAll(/setTimeout\(/g)].length} setTimeout calls in tests`, skill: ctx.refOf("ink-testing", "harness") },
      { check: "contract: every field is drawn", present: names.some((n) => /every-field|fields?-drawn|every_field/.test(n)) || /KNOWN_UNDRAWN/.test(all), evidence: names.filter((n) => /every-field/.test(n)).slice(0, 2), skill: ctx.refOf("ink-testing", "contract") },
      { check: "contract: a key always arrives", present: names.some((n) => /key-always|keys?-always|always-arrives/.test(n)), evidence: names.filter((n) => /key-always/.test(n)), skill: ctx.refOf("ink-testing", "contract") },
      { check: "contract: chunking is irrelevant", present: names.some((n) => /chunk/.test(n)) || /one per read|chunking/i.test(all), evidence: names.filter((n) => /chunk/.test(n)).slice(0, 2), skill: ctx.refOf("ink-testing", "contract") },
      { check: "contract: overlays are opaque", present: names.some((n) => /overlay.*opaque|opaque/.test(n)) || /ZQXJ|sentinel/.test(all), evidence: names.filter((n) => /opaque/.test(n)), skill: ctx.refOf("ink-testing", "contract") },
      { check: "frame-byte budget", present: /frames?\.test|bytes/i.test(names.join(" ")) && /incrementalRendering/.test(all) || /\bbyteLength\b|frame bytes|KB\b/.test(all), evidence: names.filter((n) => /frames?\.test/.test(n)).slice(0, 2).concat(ev(/byteLength|bytes/, 1)), skill: ctx.refOf("ink-testing", "budgets") },
      { check: "CPU or latency budget", present: /process\.cpuUsage|cpuUsage/.test(all), evidence: ev(/cpuUsage/), skill: ctx.refOf("ink-testing", "budgets") },
      { check: "pty test of the bundled renderer", present: ptyRepo.length > 0, evidence: ptyRepo, skill: ctx.refOf("ink-testing", "real terminal") },
      { check: "bundle test (runs the bundle alone)", present: names.some((n) => /bundle/.test(n)), evidence: names.filter((n) => /bundle/.test(n)).slice(0, 2), skill: ctx.refOf("ink-testing", "real terminal") },
      { check: "parity with the Rust host (fixtures)", present: rustFixtures.length > 0 && names.some((n) => /fixtures|parity|reference/.test(n)), evidence: [...rustFixtures, ...names.filter((n) => /parity|reference/.test(n)).slice(0, 2)], skill: ctx.refOf("ink-testing", "real terminal") },
      { check: "live check under tmux that the terminal is restored", present: tmuxRepo.length > 0, evidence: tmuxRepo, skill: ctx.refOf("ink-testing", "tmux") },
    ];
    return {
      app: a.path, runner: versions(a).testRunner, testScript: a.pkg.scripts?.test ?? null, testFiles: names.length, byFolder: byDir,
      inkTestingLibrary: { files: lib.length, evidence: lib.slice(0, 4), inDevDependencies: a.pkg.devDependencies?.["ink-testing-library"] ?? null },
      renderCallsInTests: renderCallsInTests.length, harnessRenders: withStdout.length,
      present: checks.filter((c) => c.present).map((c) => c.check),
      absent: checks.filter((c) => !c.present).map((c) => ({ check: c.check, skill: c.skill })),
      checks,
    };
  }

  // ------------------------------------------------------------------ IPC parity with a Rust host

  function ipc(o = {}) {
    const a = pick(o.app);
    const rs = walk(repoRoot, { depth: 8, file: (q) => q.endsWith(".rs") });
    const rust = {};
    for (const p of rs) {
      const t = text(p) ?? "";
      for (const m of t.matchAll(/#\[serde\(([^)]*tag\s*=\s*"type"[^)]*)\)\]\s*(?:#\[[^\]]*\]\s*)*pub\s+enum\s+(\w+)\s*\{/g)) {
        const attrs = m[1];
        const open = m.index + m[0].length - 1;
        const end = close(t, open);
        if (end < 0) continue;
        const body = t.slice(open + 1, end);
        const variants = [];
        let depth = 0, pending = null;
        for (const line of body.split("\n")) {
          const l = line.trim();
          if (depth === 0) {
            const rn = /#\[serde\([^)]*rename\s*=\s*"([^"]+)"/.exec(l);
            if (rn) pending = rn[1];
            const v = /^([A-Z]\w*)\b/.exec(l);
            if (v) { variants.push(pending ?? (/rename_all\s*=\s*"snake_case"/.test(attrs) ? snake(v[1]) : v[1])); pending = null; }
          }
          for (const ch of l) { if ("({[".includes(ch)) depth++; else if (")}]".includes(ch)) depth--; }
        }
        rust[m[2]] = { at: `${rel(p)}:${lineAt(t, m.index)}`, types: variants };
      }
    }
    const tsFiles = a.files.map((abs) => ({ abs, r: rel(abs), t: text(abs) ?? "" }));
    const ts = {};
    for (const name of Object.keys(rust)) {
      const f = tsFiles.find((x) => new RegExp(`(^|/)${name}\\.ts$`).test(x.r));
      if (f) ts[name] = { at: f.r, types: [...f.t.matchAll(/["']?type["']?\s*:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]) };
    }
    const src = filesOf(a, ["src"]).filter((f) => !/generated/.test(f.r));
    const out = { app: a.path, rustEnums: Object.keys(rust), withoutGeneratedTypes: Object.keys(rust).filter((n) => !ts[n]), messages: {} };
    for (const [name, r] of Object.entries(rust)) {
      const t = ts[name];
      if (!t) continue;
      const entry = { rust: r.at, ts: t?.at ?? null, rustTypes: r.types.length, tsTypes: t ? [...new Set(t.types)].length : null };
      if (t) {
        const set = new Set(t.types);
        entry.onlyInRust = r.types.filter((x) => !set.has(x));
        entry.onlyInTs = [...set].filter((x) => !r.types.includes(x));
      } else entry.note = `no generated ${name}.ts in the renderer`;
      if (/ToRenderer|Renderer|Down|Server/.test(name) || /to_?renderer/i.test(name)) {
        entry.notMentionedInRendererSource = r.types.filter((x) => !src.some((f) => new RegExp(`["'\`]${x}["'\`]`).test(f.t)));
      }
      out.messages[name] = entry;
    }
    const drift = rs.filter((p) => /the_committed_typescript_matches|export_all|TS_UPDATE/.test(text(p) ?? "")).map(rel).slice(0, 2);
    out.generatedTypesChecked = drift.length ? drift : null;
    out.versions = grep(a, /\bPROTOCOL\b|VIEW_VERSION|protocol\s*[:=]\s*\d/, ["src"], 3).hits;
    if (!Object.keys(rust).length) out.note = "no Rust enum tagged `#[serde(tag = \"type\")]` found under the repository; no host to compare against";
    return out;
  }

  // ------------------------------------------------------------------ inspect and faults

  function inspect(o = {}) {
    const a = pick(o.app);
    const others = apps().filter((x) => x !== a).map((x) => ({ path: x.path, name: x.name, ink: x.ink, library: x.isInkItself || undefined, calls: x.renders ? "render()" : "no render() in source" }));
    const calls = renderCalls(a);
    const entries = [...new Set(calls.map((c) => c.file))];
    const mainFile = a.pkg.main ?? a.pkg.module ?? (a.pkg.scripts?.bundle ?? "").match(/esbuild\s+(\S+)/)?.[1] ?? null;
    return {
      repository: repoRoot, app: { path: a.path, name: a.name, ink: a.ink, react: a.react }, otherInkPackages: others,
      entry: { bundleEntry: mainFile, renderCallFiles: entries },
      render: calls.map((c) => ({ at: c.at, options: c.entries, optionsFrom: c.from ?? c.viaPackage ?? c.optionsArg, spreadsNotResolved: c.spreads })),
      renderOptionsMissing: renderOptions(o).calls.map((c) => c.missing),
      stdin: readsStdin(a), ...consoleAndStatic(a), restore: restore(a), textNodes: textNodes(a),
      bundle: bundle(a), versions: versions(a), storybook: storybook(a),
      tests: (({ testRunner, ...t }) => ({ runner: testRunner, files: t.testFiles, inkTestingLibraryFiles: t.inkTestingLibrary.files, absentChecks: t.absent.map((x) => x.check) }))({ testRunner: versions(a).testRunner, ...tests(o) }),
      ipc: ipc(o),
    };
  }

  function faults(o = {}) {
    const a = pick(o.app);
    const out = [];
    const add = (id, severity, what, where, skill, fix) => out.push({ id, severity, what, where: [].concat(where).filter(Boolean).slice(0, 5), skill, fix });
    const ro = renderOptions(o);
    for (const c of ro.calls) {
      const rows = c.options.filter((r) => r.status === "missing" || r.status === "differs");
      for (const r of rows) {
        add(`render-option:${r.option}`, r.status === "missing" ? "gap" : "fault", `render() ${r.status === "missing" ? "does not set" : "sets"} ${r.option}${r.found != null ? ` = ${r.found}` : ""} (recommended ${r.recommended}): ${r.why}`, c.optionsFrom && /:\d+$/.test(c.optionsFrom) ? c.optionsFrom : c.at, `${r.skill}`, `set ${r.option}: ${r.recommended}`);
      }
      for (const e of c.extras) if (e.option === "debug" && /true/.test(e.found)) add("render-option:debug", "fault", "render() sets debug: true", c.at, ctx.refOf("ink-fullscreen", "render call"), "remove debug: true outside tests");
    }
    if (!ro.calls.length) add("render-call", "check", "no render() call found in non-test source", [], ctx.refOf("ink-fullscreen", "render call"), "find the entry that mounts Ink");
    const cs = consoleAndStatic(a);
    if (cs.staticUses.total) add("static", "fault", `<Static> used in the source (${cs.staticUses.total}): on the alternate screen its output accumulates and every frame takes the clear-and-write path`, cs.staticUses.hits.map((h) => h.at), ctx.refOf("ink-fullscreen", "things that break"), "remove Static; render what you need as rows of the frame");
    if (cs.console.total) add("console", "check", `${cs.console.total} console.* call(s) in renderer source: with patchConsole false they write straight into the frame (stdout) or the terminal (stderr)`, cs.console.hits.map((h) => h.at), ctx.refOf("ink-fullscreen", "render call"), "route logs to the host (a session.log) or a file");
    if (cs.stdoutWrites.total) add("stdout-writes", "check", `${cs.stdoutWrites.total} direct stdout write(s): outside Ink's bookkeeping a write mid-frame lands the next incremental frame in the wrong rows; mode switches should be written once before the first frame`, cs.stdoutWrites.hits.map((h) => h.at), ctx.refOf("ink-fullscreen", "things that break"), "keep to mode switches and OSC sequences written outside a frame, or use useStdout().write");
    const modes = terminalModes(a);
    const si = readsStdin(a);
    const mouseOn = modes.turnedOn.filter((m) => /^100[0-6]$|^1015$/.test(m.mode));
    if (mouseOn.length && !si.ownTap) add("mouse-without-tap", "fault", `mouse modes are turned on (${mouseOn.map((m) => m.mode).join(", ")}) but nothing wraps stdin.read: Ink 8 drops SGR mouse reports`, mouseOn.map((m) => m.at), ctx.refOf("ink-input", "mouse"), "read stdin before Ink: a tap and a tokenizer");
    if (si.tapDrainsUntilNull && !si.tapDrainsUntilNull.loopsUntilNull) add("tap-may-not-drain", "check", "the stdin.read wrapper does not visibly loop until read() returns null; a tap that takes one chunk goes deaf after the first key on a real tty", si.tapDrainsUntilNull.at, ctx.refOf("ink-input", "mouse"), "drain until read() returns null in the same call");
    if (modes.neverTurnedOff.length) add("mode-not-restored", "fault", `turned on and never turned off in the source: ${modes.neverTurnedOff.map((m) => `${m.mode} ${m.name ?? ""}`.trim()).join(", ")}`, modes.neverTurnedOff.map((m) => m.at), ctx.refOf("ink-fullscreen", "exit and terminal restore"), "add every mode you enable, turned off, to the restore sequence");
    const rs = restore(a);
    if (!rs.signals.some((s) => /SIGTERM|SIGHUP|SIGINT/.test(s.text)) ) add("no-signal-restore", "gap", "no SIGTERM/SIGHUP/SIGINT handler in the source: killed by the host the terminal may be left in raw mode with mouse on", [], ctx.refOf("ink-fullscreen", "exit and terminal restore"), "one way out: unmount, write RESTORE, print to stderr, exit with a code");
    if (!rs.signals.some((s) => /uncaughtException|unhandledRejection/.test(s.text))) add("no-error-restore", "gap", "no uncaughtException or unhandledRejection handler: a crash leaves the terminal as it is", [], ctx.refOf("ink-fullscreen", "exit and terminal restore"), "restore the terminal in the error handlers, exit non-zero");
    if (si.hooks.useInput.count && !si.hooks.usePaste.count && !modes.turnedOn.some((m) => m.mode === "2004")) add("paste-off", "check", "useInput is used, usePaste is not and bracketed paste is not turned on: a paste arrives as keystrokes and Enter in it submits", si.hooks.useInput.first, ctx.refOf("ink-input", "paste"), "mount usePaste wherever text can be typed");
    if (si.hooks.useInput.count && !si.ownTap && !si.hooks.disableFocus.count && !si.hooks.useFocus.count) add("focus-keys", "check", "useInput is used and disableFocus is never called: Tab and Escape also move Ink's focus", si.hooks.useInput.first, ctx.refOf("ink-input", "what useinput"), "useFocusManager().disableFocus() once when the app routes keys itself");
    const b = bundle(a);
    if (b.tool) {
      if (!b.formatEsm) add("bundle-not-esm", "fault", "the bundle is not built as ESM: Ink's reconciler and yoga-layout use top-level await and a CJS output fails", b.script, ctx.refOf("ink-fullscreen", "bundling"), "--format=esm");
      if (!b.devtoolsStub) add("bundle-devtools", "gap", "react-devtools-core is not aliased to a stub: the bundler follows the DEV=true import", b.script, ctx.refOf("ink-fullscreen", "bundling"), "--alias:react-devtools-core=<stub>");
      if (!b.nodeEnvProduction) add("bundle-node-env", "gap", "process.env.NODE_ENV is not defined as production: every render pays React's dev checks", b.script, ctx.refOf("ink-fullscreen", "bundling"), "--define:process.env.NODE_ENV=\\\"production\\\"");
    } else add("no-bundle-script", "check", "no esbuild/tsup/rollup bundle script in package.json: the host starts one .js file", "package.json", ctx.refOf("ink-fullscreen", "bundling"), "bundle to one ESM file");
    const v = versions(a);
    if (v.ink.range && !/(^|[\s^~>=])8\./.test(v.ink.range) && !/^\^?8/.test(v.ink.range)) add("ink-version", "check", `ink range ${v.ink.range}: the skills describe Ink 8.0.0`, "package.json", ctx.refOf("ink-fullscreen", "upgrading"), "check the 7 to 8 list in the reference file");
    if (v.ink.reachesIntoInkBuild.length && !v.ink.pinnedExactly) add("ink-not-pinned", "fault", `ink is ${v.ink.range}, not an exact version, while the code reaches into ink/build or aliases ink-output (no semver contract)`, ["package.json", ...v.ink.reachesIntoInkBuild], ctx.refOf("ink-fullscreen", "upgrading"), `"ink": "${(v.ink.installed ?? "8.0.0")}"`);
    if (v.ink.locked.length > 1) add("ink-copies", "fault", `more than one copy of ink in the lockfile: ${v.ink.locked.join(", ")}`, v.lockfile, ctx.refOf("ink-fullscreen", "bundling"), "npm ls ink should show one copy");
    if (v.react.installed && v.ink.installed?.startsWith("8") && !/^19\.([3-9]|\d\d)/.test(v.react.installed)) add("react-version", "fault", `react ${v.react.installed} is installed; Ink 8 needs react >= 19.3`, "package.json", ctx.refOf("ink-fullscreen", "internals"), "upgrade react");
    const tn = textNodes(a);
    const heavy = tn.worstRowLoops.filter((m) => m.textPerRow >= 4 || m.transforms);
    if (heavy.length) add("text-nodes-per-row", "check", `${heavy.length} .map() row loop(s) create 4 or more <Text> per row (worst ${heavy[0].textPerRow}) or use <Transform>: each is laid out, measured and tokenised every frame`, heavy.map((m) => `${m.at} (${m.textPerRow} Text${m.transforms ? `, ${m.transforms} Transform` : ""})`), ctx.refOf("ink-frame-performance", "order of cost"), "build the row's string and styles yourself: one Text per row or per block");
    if (tn.textInsideText > 20 && !tn.cellRowModel.length) add("nested-text", "check", `${tn.textInsideText} <Text> nested inside another <Text>: nested runs transform per measure and per render`, [], ctx.refOf("ink-frame-performance", "order of cost"), "fewer, larger Text runs");
    const t = tests(o);
    if (t.inkTestingLibrary.files) add("tests-100-columns", "fault", `${t.inkTestingLibrary.files} test file(s) use ink-testing-library, whose stdout is fixed at 100 columns: a full-screen layout tested there proves nothing about 80 or 160`, t.inkTestingLibrary.evidence, ctx.refOf("ink-testing", "traps"), "use a stub stdout with a real size and a resize() that emits \"resize\"");
    for (const c of t.checks) {
      const worth = { "pty test of the bundled renderer": 1, "FORCE_COLOR or chalk.level set before chalk loads": 1, "interactive: true (or debug: true, or CI off) in test renders": 1, "bundle test (runs the bundle alone)": 1, "live check under tmux that the terminal is restored": 1, "contract: a key always arrives": 1, "contract: chunking is irrelevant": 1 };
      if (!c.present && worth[c.check]) add(`tests:${c.check}`, "gap", `no test evidence for: ${c.check}`, [], c.skill, "see ink-testing");
    }
    const sb = storybook(a);
    if (sb.present) {
      if (!sb.reconcilerPatch.length && !sb.yogaReady.length) add("storybook-tla", "fault", "Storybook is set up but nothing removes Ink's and yoga-layout's top-level awaits: a static build's story spins forever with no error", sb.dir, ctx.refOf("ink-storybook", "top-level"), "a yoga shim exporting yogaReady and a pre plugin that rewrites reconciler.js and throws when the text is not found");
      if (!sb.checkStatic.length && !sb.scriptCheckStatic) add("storybook-check-static", "gap", "no check of the static build in a headless browser", sb.dir, ctx.refOf("ink-storybook", "checking the static"), "a check-static script");
    }
    const ip = ipc(o);
    for (const [name, m] of Object.entries(ip.messages ?? {})) {
      if (m.onlyInRust?.length || m.onlyInTs?.length) add(`ipc:${name}`, "fault", `${name}: Rust has ${m.onlyInRust?.join(", ") || "nothing extra"}; the renderer's generated types have ${m.onlyInTs?.join(", ") || "nothing extra"}`, [m.rust, m.ts], ctx.refOf("host-parts-tui", "rust types to typescript"), "regenerate the TypeScript types from the Rust ones");
      if (m.notMentionedInRendererSource?.length) add(`ipc-unhandled:${name}`, "check", `${name} messages never named in the renderer's own source: ${m.notMentionedInRendererSource.join(", ")}`, [m.ts], ctx.refOf("host-parts-tui", "ipc protocol"), "check the session state machine handles each");
    }
    const order = { fault: 0, gap: 1, check: 2 };
    out.sort((x, y) => order[x.severity] - order[y.severity]);
    return { app: a.path, counts: { fault: out.filter((x) => x.severity === "fault").length, gap: out.filter((x) => x.severity === "gap").length, check: out.filter((x) => x.severity === "check").length }, meaning: "fault: the code does what the skill warns against; gap: a recommended thing is absent; check: the pattern may be a problem, read the code at `where`", faults: out };
  }

  // ------------------------------------------------------------------ the one change

  /** Add the options that are missing to the object literal render() takes (act only; ask.mjs guards it). */
  async function addRenderOptions(options = {}, o = {}) {
    const a = pick(o.app);
    const calls = renderCalls(a).filter((c) => c.literal);
    if (!calls.length) throw new Error("no render() call with an options object literal found; add the options with repo.edit");
    const c = calls[0];
    const want = Object.keys(options).length ? options : Object.fromEntries(Object.entries(RECOMMENDED).map(([k, r]) => [k, r.want]));
    const missing = Object.entries(want).filter(([k]) => !(k in c.entries));
    if (!missing.length) return { changed: false, at: c.at, note: "every option is already set" };
    let t = fs.readFileSync(c.literal.abs, "utf8");
    const { start, end } = c.literal;
    if (t[start] !== "{" || t[end] !== "}") throw new Error("the options literal moved since it was read; read it again");
    const inner = t.slice(start + 1, end);
    const multi = inner.includes("\n");
    let next;
    if (multi) {
      const nl = inner.lastIndexOf("\n");
      const head = inner.slice(0, nl), tail = inner.slice(nl);
      const lastLine = head.slice(head.lastIndexOf("\n") + 1);
      const m = /^(.*?)(\s*\/\/.*)?$/.exec(lastLine);
      const code = m[1], comment = m[2] ?? "";
      const indent = /^(\s*)\S/.exec(lastLine)?.[1] ?? "  ";
      const fixedLast = code.trim() && !/,\s*$/.test(code) && !/\{\s*$/.test(code) ? `${code},${comment}` : lastLine;
      const body = head.slice(0, head.length - lastLine.length) + fixedLast;
      next = `${body}\n${missing.map(([k, v]) => `${indent}${k}: ${v},`).join("\n")}${tail}`;
    } else {
      const trimmed = inner.trim().replace(/,\s*$/, "");
      next = ` ${trimmed}${trimmed ? ", " : ""}${missing.map(([k, v]) => `${k}: ${v}`).join(", ")} `;
    }
    t = t.slice(0, start + 1) + next + t.slice(end);
    fs.writeFileSync(c.literal.abs, t);
    cache.delete(c.literal.abs);
    return { changed: true, file: rel(c.literal.abs), added: missing.map(([k, v]) => `${k}: ${v}`), call: c.at, note: "run the app's typecheck and tests (npm kit) to confirm" };
  }

  return { apps: () => apps().map((x) => ({ path: x.path, name: x.name, ink: x.ink, inkInstalled: x.inkInstalled, react: x.react, rendersFromSource: x.renders, isInkItself: x.isInkItself })), inspect, renderOptions, faults, tests, ipc, addRenderOptions, grep: (re, o = {}) => grep(pick(o.app), re, o.kinds ?? ["src"], o.max ?? 40) };
}
