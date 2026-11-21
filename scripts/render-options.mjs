export const meta = {
  purpose:
    "The render() call's options against the set ink-fullscreen recommends for a full-screen app (interactive, alternateScreen, exitOnCtrlC, patchConsole, incrementalRendering, maxFps, isScreenReaderEnabled): which are set correctly, which are missing or differ, and for each of those the reason from the skill's table with its path:line. Also where the options object is defined.",
  params: {
    repo: "another repository to look in, when the question names a path (default the caller's)", app: "the renderer folder (relative to the repository), when there is more than one Ink package" },
  returns: "{app, skill, calls:[{at, optionsFrom, viaPackage, ok:['name=value'], problems:[{option, status: missing|differs|from-package, found, recommended, inkDefault, why, skill}], extras:['name=value']}]}",
  example: 'await scripts.run("render-options")',
};

export default async function ({ ink: caller }, { repo, app } = {}) {
  const ink = repo ? caller.at(repo) : caller;
  const r = ink.renderOptions({ app });
  const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
  return {
    app: r.app, skill: r.skill.replace(/^.*\/skills\//, ""), note: r.note,
    calls: r.calls.map((c) => ({
      at: c.at, optionsFrom: c.optionsFrom, viaPackage: c.viaPackage,
      ok: c.options.filter((o) => o.status === "ok").map((o) => `${o.option}=${o.found}`),
      problems: c.options.filter((o) => o.status !== "ok").map((o) => ({ option: o.option, status: o.status, found: o.found, recommended: o.recommended, inkDefault: o.inkDefault, why: cut(o.why, 230), skill: o.skill.replace(/^.*\/skills\//, "") })),
      extras: c.extras.map((e) => `${e.option}=${e.found}`),
    })),
  };
}
