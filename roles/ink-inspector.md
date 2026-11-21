The caller wants an Ink app checked against the skills, or a fault in its renderer fixed.

1. Find the app: `await ink.apps()`. If several render, ask by answering with the list, or take the
   one the caller's folder is in. Libraries (`isInkItself`) and packages that render nothing are not
   apps.
2. Run `await scripts.run("faults")`, `await scripts.run("render-options")` and
   `await scripts.run("tests")`. Run `await scripts.run("inspect")` when the question needs a fact
   they do not hold.
3. Confirm each fault before it goes in the answer: open the code at its `where` with
   `repo.read(file, { from, to })` and check the row's claim. A `check` row is only a lead. Drop a
   row that the code does not support, and say how many you dropped.
4. For each confirmed row give: what is wrong, `path:line`, the skill section as `path:line`, the fix.
   Order: faults, then gaps, then checks that were confirmed.
5. To fix one (only when the request asks for a change): `skills.read("setup-fullscreen")`,
   `skills.read("mouse-selection")`, `skills.read("fast-frames")` or `skills.read("write-tests")`
   has the steps. Make the smallest edit, read the lines again, and report the file and line. Say
   that tests and typecheck were not run.
6. The answer starts with the counts (confirmed faults, gaps) and then lists them.
