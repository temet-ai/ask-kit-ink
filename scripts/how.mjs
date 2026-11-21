export const meta = {
  purpose:
    "The skill sections that answer a how-to or why question about an Ink 8 app, ranked, each with path:line, its heading trail, its opening lines and the lines that matched. Never a whole file. Searches the six Ink skills (ink-fullscreen, ink-input, ink-frame-performance, ink-testing, ink-storybook, host-parts-tui) with their reference files; the kit's own playbooks stand in for a skill that is not installed.",
  params: {
    repo: "another repository to look in, when the question names a path (default the caller's)",
    q: "the question in plain words, for example 'why does escape feel slow'",
    skill: "limit to one skill, optional: ink-fullscreen, ink-input, ink-frame-performance, ink-testing, ink-storybook or host-parts-tui",
    max: "how many sections, default 5",
    read: "true also returns the best section's text (up to 90 lines)",
  },
  returns: "{query, source, found, results:[{ref, heading, lines, opening:[2 lines], matches:['skill/file:line text']}], best?:{ref, text}}; ref is path:line of the section heading",
  example: 'await scripts.run("how", { q: "why does the app go deaf after the first key" })',
};

export default async function ({ ink: caller }, { repo, q, skill, max = 5, read = false } = {}) {
  const ink = repo ? caller.at(repo) : caller;
  if (!q) throw new Error("pass q, the question");
  const r = ink.search(q, { skill, max, matches: 2 });
  const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + "…" : x);
  const out = {
    query: r.query, source: r.source, found: r.found,
    results: r.results.map((x) => ({
      ref: x.ref, heading: x.heading.split(" > ").slice(-2).join(" > "), lines: x.lines,
      opening: x.opening.slice(0, 2).map((l) => cut(l, 110)),
      matches: x.matches.map((m) => `${m.ref.replace(/^.*\/skills\//, "")} ${cut(m.text, 90)}`),
    })),
    next: "ink.section(ref) reads one section whole; pass read: true for the best one",
  };
  if (read && r.results[0]) out.best = ink.section(r.results[0].ref);
  return out;
}
