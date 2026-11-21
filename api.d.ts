interface SectionHit {
  ref: string;       // path:line of the heading, for example skills/setup-fullscreen.md:20
  skill: string;     // ink-fullscreen, ink-input, ink-frame-performance, ink-testing, ink-storybook or host-parts-tui
  heading: string;   // heading trail, "Parent > Child"
  lines: number;     // how long the section is
  source: "skills" | "kit"; // "kit": the kit's own playbook, because the skill is not installed
  opening: string[]; // the first lines of the section
  score?: number;
  matches?: { ref: string; text: string }[]; // the lines inside the section that hold the query's words, each with its own path:line
}
interface RenderOptionRow { option: string; status: "ok" | "missing" | "differs" | "from-package" | "unknown (spread not resolved)"; found: string | null; recommended: string; why: string; inkDefault?: string; skill: string }
interface Fault { id: string; severity: "fault" | "gap" | "check"; what: string; where: string[]; skill: string; fix: string }
interface Hits { total: number; hits: { at: string; text: string }[]; cut: number }

declare const ink: {
  skillsDir: string | null;  // a folder of your own skills read in place of the kit's playbooks (SKILLS_DIR; null when not set)
  repoRoot: string;   // the repository the app is looked for in

  // The same client for another repository: a question that names a path is answered there, never in the caller's repository.
  // const other = ink.at("/path/to/other-repo"); other.faults()
  at(dir: string): typeof ink;
  // Numbered lines of a file in this repository (default 80, at most 200 a call), for the code a fact points at. Paths are relative to repoRoot,
  // as the facts print them. Refuses credential-looking files. Use it in a repository `at` opened; `repo` only reads the caller's.
  read(file: string, o?: { from?: number; to?: number }): { file: string; from: number; to: number; lines: number; text: string };

  // ---- the skills

  // The six skills, whether each is installed, their files and section counts. A skill that is not installed is answered from the kit's playbook.
  skills(): { skillsDir: string | null; source: string; skills: { name: string; about: string; installed: boolean; playbook: string; files: { path: string; lines: number; sections: number; description: string }[] }[] };

  // Sections that answer a question, ranked, with path:line, opening lines and the lines that matched. Words people use are mapped to the skills' words
  // (flicker, lag, deaf, escape, restore, bundle, paste, pty ...). skill limits to one skill. Never returns a whole file. max default 6.
  search(q: string, o?: { skill?: string; max?: number; matches?: number }): { query: string; searchedFor: string[]; source: string; sections: number; found: number; results: SectionHit[] };

  // One section's text by the ref search printed (`path:line`; any line inside the section works). Cut at max lines (default 90); `cut` says how many were left out.
  section(ref: string, o?: { max?: number }): { ref: string; skill: string; heading: string; from: number; to: number; cut: number; text: string };

  // The first section of a skill whose heading holds every word, or null. ink.find("ink-input", "mouse") .
  find(skill: string, ...words: string[]): SectionHit | null;
  // "path:line heading" of that section, used as evidence.
  refOf(skill: string, ...words: string[]): string;

  // ---- the app

  // Every package.json under the repository (five levels) that depends on ink. rendersFromSource: a non-test file calls render() from "ink".
  // isInkItself: the package is Ink's own checkout, not an app. Pass `app` (a folder relative to the repository) to any call below when there is more than one.
  apps(): { path: string; name: string; ink: string; inkInstalled: string | null; react: string | null; rendersFromSource: boolean; isInkItself: boolean }[];

  // Everything in one object, each fact with path:line: render, stdin, console, staticUses, stdoutWrites, restore, textNodes, bundle, versions, storybook, tests, ipc.
  inspect(o?: { app?: string }): any;

  // render() against the recommended options. Each option: ok, missing, differs (a wrong value) or from-package (the options come from a package that wraps render()).
  // `why` is the reason from ink-fullscreen's table, `skill` its path:line.
  renderOptions(o?: { app?: string }): { app: string; skill: string; calls: { at: string; optionsFrom: string | null; viaPackage: string | null; missing: string[]; differs: string[]; options: RenderOptionRow[]; extras: { option: string; found: string; note?: string }[] }[]; note?: string };

  // The checks from the skills that the app fails. fault: does what the skill warns against. gap: a recommended thing is absent. check: may be a problem; read the code at `where` before saying so.
  // These are text matches, not a proof: read each `where` before you report one as true.
  faults(o?: { app?: string }): { app: string; counts: { fault: number; gap: number; check: number }; meaning: string; faults: Fault[] };

  // What the tests cover against ink-testing's checks (stub streams, ink-testing-library, FORCE_COLOR, contract tests, budgets, pty, bundle, parity, tmux).
  tests(o?: { app?: string }): { app: string; runner: string | null; testScript: string | null; testFiles: number; byFolder: Record<string, number>; inkTestingLibrary: { files: number }; present: string[]; absent: { check: string; skill: string }[]; checks: { check: string; present: boolean; evidence: string[]; skill: string; note?: string }[] };

  // Rust enums tagged `#[serde(tag = "type")]` (the host's messages) against the generated TypeScript for them: onlyInRust and onlyInTs per enum, and
  // which messages to the renderer its own source never names.
  ipc(o?: { app?: string }): any;

  // Regex over the app's non-test source (kinds: "src", "test", "story", "tool", "storybook"). For one-off questions the facts above do not cover.
  grep(re: RegExp, o?: { app?: string; kinds?: string[]; max?: number }): Hits;

  // ---- the one changing call (throws "not in this ask" unless the ask may change things)

  // Add the missing options to the object literal render() takes. options default to the recommended set; pass {maxFps: "120"} to add only those. Values are source text.
  // Throws when render() has no options object literal (the options come from a package, or there are none): edit with repo.edit then.
  addRenderOptions(options?: Record<string, string>, o?: { app?: string }): Promise<{ changed: boolean; file?: string; added?: string[]; call?: string; note?: string }>;
};

// repo: the folder source over the repository (rg, sg, read, files, git, and when the ask may change things write, edit, run). Use it to read the code
// a fact points at; ink.* already searched for the facts above.
