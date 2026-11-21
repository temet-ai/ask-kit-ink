export const meta = {
  purpose:
    "What an Ink app in this repository does, each fact with path:line: the renderer package, the render() call and its missing options, whether it reads stdin itself (a stdin.read wrapper, and whether it drains until null) and which input hooks it uses, console, Static and direct stdout writes, how it restores the terminal (signal handlers, DEC modes turned on and off), how many Text nodes its row loops create, how it is bundled, the Ink, React and test-runner versions, what its tests lack, Storybook's top-level-await fix, and whether the Rust host and the renderer agree on the IPC message types. With `section` one part in full.",
  params: {
    repo: "another repository to look in, when the question names a path (default the caller's)",
    app: "the renderer folder (relative to the repository), when there is more than one Ink package; default the first that calls render()",
    section: "one part in full: render, stdin, console, restore, textNodes, bundle, versions, storybook, tests, ipc",
  },
  returns: "{repository, app, otherInkPackages, render:{at, optionsFrom, missing}, stdin, console, restore, textNodes, bundle, versions, storybook, tests, ipc} (a short summary of each); with section, the full object of that part",
  example: 'await scripts.run("inspect", { section: "restore" })',
};

export default async function ({ ink: caller }, { repo, app, section } = {}) {
  const ink = repo ? caller.at(repo) : caller;
  const r = ink.inspect({ app });
  if (section) {
    const keep = { console: ["console", "staticUses", "stdoutWrites", "stderrWrites", "debugTrue"], render: ["render", "renderOptionsMissing"], tests: ["tests"] }[section] ?? [section];
    const out = { app: r.app };
    for (const k of keep) if (k in r) out[k] = k === "tests" ? ink.tests({ app }) : r[k];
    if (Object.keys(out).length === 1) throw new Error(`no section ${section}; use render, stdin, console, restore, textNodes, bundle, versions, storybook, tests or ipc`);
    return out;
  }
  const at = (h) => h.hits.map((x) => x.at);
  const m = r.restore.modes;
  const rs = r.restore;
  const ipc = r.ipc;
  return {
    repository: r.repository, app: r.app, otherInkPackages: r.otherInkPackages,
    render: r.render.map((c, i) => ({ at: c.at, optionsFrom: c.optionsFrom, set: Object.entries(c.options).map(([k, v]) => `${k}=${v}`).join(" "), missing: r.renderOptionsMissing[i] })),
    stdin: { ownTap: r.stdin.ownTap, wrappers: r.stdin.wrappers, rawStdin: at(r.stdin.rawStdin), hooks: Object.entries(r.stdin.hooks).filter(([, v]) => v.count).map(([k, v]) => `${k} x${v.count} ${v.first[0] ?? ""}`) },
    console: { consoleCalls: r.console.total, first: at(r.console).slice(0, 4), staticUses: at(r.staticUses), stdoutWrites: at(r.stdoutWrites), debugTrue: at(r.debugTrue) },
    restore: {
      handlers: rs.signals.map((h) => h.at), restoreCalls: rs.restoreCalls.filter((h) => /terminal|RESTORE|exit/i.test(h.text)).map((h) => h.at).slice(0, 4), suspendTerminal: at({ hits: rs.suspendTerminal }),
      modesOn: m.turnedOn.map((x) => x.mode).join(","), modesOff: m.turnedOff.map((x) => x.mode).join(","), neverTurnedOff: m.neverTurnedOff,
    },
    textNodes: { textTags: r.textNodes.textTagsInSource, textInsideText: r.textNodes.textInsideText, transformTags: r.textNodes.transformTags, rowLoops: r.textNodes.rowLoops, maxTextPerRow: r.textNodes.maxTextPerRow, worst: r.textNodes.worstRowLoops.slice(0, 3).map((x) => `${x.at} ${x.textPerRow} Text`), cellRowModel: r.textNodes.cellRowModel.slice(0, 3), windowing: r.textNodes.windowing.slice(0, 3) },
    bundle: { script: r.bundle.script, tool: r.bundle.tool, esm: r.bundle.formatEsm, platformNode: r.bundle.platformNode, target: r.bundle.target, devtoolsStub: r.bundle.devtoolsStub, nodeEnvProduction: r.bundle.nodeEnvProduction, inkOutputAlias: r.bundle.inkOutputAlias, shims: [...r.bundle.requireShimImported, ...r.bundle.noFetchImported] },
    versions: { ink: `${r.versions.ink.range} (installed ${r.versions.ink.installed}, locked ${r.versions.ink.locked.join(" ")})`, pinnedExactly: r.versions.ink.pinnedExactly, reachesIntoInkBuild: r.versions.ink.reachesIntoInkBuild, react: `${r.versions.react.range} (installed ${r.versions.react.installed})`, reactReconciler: r.versions.reactReconciler, testRunner: r.versions.testRunner, inkTestingLibrary: r.versions.inkTestingLibrary },
    storybook: r.storybook.present ? { yogaReady: r.storybook.yogaReady, reconcilerPatch: r.storybook.reconcilerPatch, checkStatic: r.storybook.checkStatic, manifestTest: r.storybook.manifestTest } : { present: false },
    tests: r.tests,
    ipc: { rustEnums: ipc.rustEnums?.length, compared: Object.fromEntries(Object.entries(ipc.messages ?? {}).map(([k, v]) => [k, `${v.rustTypes} Rust, ${v.tsTypes} TS, onlyInRust [${v.onlyInRust ?? ""}], onlyInTs [${v.onlyInTs ?? ""}]${v.notMentionedInRendererSource?.length ? `, never named in renderer: ${v.notMentionedInRendererSource}` : ""}`])), generatedTypesChecked: ipc.generatedTypesChecked, versionsAt: ipc.versions?.map((x) => x.at), note: ipc.note },
    more: 'scripts.run("inspect", { section }) gives one part in full',
  };
}
