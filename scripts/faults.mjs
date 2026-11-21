export const meta = {
  purpose:
    "The checks from the Ink skills that this app fails, one row each with severity, what is wrong, where (path:line) and the skill section that explains it. fault: the code does what the skill warns against. gap: something the skill recommends is absent. check: the pattern may be a problem and the code at `where` must be read before it is called one. These are text matches: read each `where` before reporting a row as true.",
  params: {
    repo: "another repository to look in, when the question names a path (default the caller's)", app: "the renderer folder, when there is more than one Ink package", severity: "keep only fault, gap or check", max: "rows to return, default 14" },
  returns: "{app, counts:{fault,gap,check}, shown, faults:[{id, severity, what, where:'path:line, ..', skill:'skill/file:line heading', fix}]}",
  example: 'await scripts.run("faults", { severity: "fault" })',
};

export default async function ({ ink: caller }, { repo, app, severity, max = 14 } = {}) {
  const ink = repo ? caller.at(repo) : caller;
  const r = ink.faults({ app });
  let rows = severity ? r.faults.filter((f) => f.severity === severity) : r.faults;
  const total = rows.length;
  const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
  rows = rows.slice(0, max).map((f) => ({ id: f.id, severity: f.severity, what: cut(f.what, 200), where: f.where.join(", "), skill: f.skill.replace(/^.*\/skills\//, ""), fix: cut(f.fix, 90) }));
  return { app: r.app, counts: r.counts, shown: rows.length, cutRows: total - rows.length, faults: rows };
}
