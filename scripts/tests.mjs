export const meta = {
  purpose:
    "What the Ink app's tests cover against the checks in ink-testing: stub streams with a real size or ink-testing-library's fixed 100 columns, renderToString, FORCE_COLOR, interactive in test renders, unmount, waiting on state, the four contract tests (every field drawn, a key always arrives, chunking, opaque overlays), frame-byte and CPU budgets, a pty test, a bundle test, parity fixtures with the Rust host, a live tmux check. Present checks name their evidence, absent ones the skill section that explains them.",
  params: {
    repo: "another repository to look in, when the question names a path (default the caller's)", app: "the renderer folder, when there is more than one Ink package" },
  returns: "{app, runner, testScript, testFiles, folders:{folder: n}, inkTestingLibrary:{files, evidence}, present:[{check, evidence}], absent:[{check, skill}]}",
  example: 'await scripts.run("tests")',
};

export default async function ({ ink: caller }, { repo, app } = {}) {
  const ink = repo ? caller.at(repo) : caller;
  const r = ink.tests({ app });
  const top = Object.entries(r.byFolder).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    app: r.app, runner: r.runner, testScript: r.testScript, testFiles: r.testFiles,
    folders: Object.fromEntries(top), foldersCut: Object.keys(r.byFolder).length - top.length,
    inkTestingLibrary: r.inkTestingLibrary,
    present: r.checks.filter((c) => c.present).map((c) => ({ check: c.check, evidence: c.evidence.slice(0, 2).join(", ") + (c.note ? ` (${c.note})` : "") })),
    absent: r.absent.map((a) => ({ check: a.check, skill: a.skill.replace(/^.*\/skills\//, "") })),
  };
}
