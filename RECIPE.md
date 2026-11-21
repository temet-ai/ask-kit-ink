# Recipe: ink kit

## What it answers

How to build and fix an Ink 8 full-screen terminal app the way the kit's six playbooks describe
(render options, sizing the root, Static and console, restore, bundling; keys, the Escape wait, mouse,
paste, selection; frame cost and windowing; testing; Storybook; the Rust host and parts split), and what
a given Ink app does against those playbooks: its render() options, stdin handling, console and Static
use, restore sequence, Text nodes per row, bundle, versions, tests, and whether the Rust host and the
renderer agree on the IPC message types. It edits the renderer's code and tests when asked.

## What it needs

- `node` on PATH. Nothing else: the kit parses with its own matcher and does not need `ast-grep`.
- Optionally skill folders in `SKILLS_DIR` (empty by default) whose text is read in place of the kit's playbooks in
  `skills/`. Without them the playbooks answer.
- A repository with a `package.json` that depends on `ink`. Libraries such as Ink's own checkout
  are listed but not treated as apps.

## What it reads and runs

- Reads the playbooks (and the skill folders in `SKILLS_DIR`, if set) and the repository's source files. Runs no program: no app, test, build or server.
- The `repo` folder source excludes credentials, lockfiles, `node_modules`, `target`, build output.
- Changes things only when the ask may act: through `repo.edit` and `ink.addRenderOptions`.

## Rebuild it from an empty folder

Write `ask-kit.toml` with a `module` source `ink` (`ink.mjs`, `api.d.ts`) and a `folder` source `repo`
on `${INK_REPO}`, where `INK_REPO` is detected as the nearest ancestor of the caller's folder that has
a `.git`, and `SKILLS_DIR` is optional and empty by default. `state_key = "${INK_REPO}"`. `acts` is
prose, because `repo.edit` is the folder source's own and the module guards its one changing call
itself.

`ink.mjs` exports `make({settings, push, kitDir, cwd, act})` returning `ink` with: `skills()`,
`search(q)` (the skills parsed into sections by heading, fences ignored, scored on heading and body
words with the words people use mapped to the skills' words, the dedicated skills weighted above the
host-parts-tui references), `section(ref)`, `find`, `refOf`, `read(file, range)`, `at(dir)`,
`apps()`, `inspect()`, `renderOptions()`, `faults()`, `tests()`, `ipc()`, `grep()` and
`addRenderOptions()` (throws "not in this ask" without `act`). `app.mjs` holds the reading of the app:
render() calls with their options resolved through an identifier or a relative import, `stdin.read`
wrappers (a wrapper that returns null is a tap and must loop until `read()` returns null), DEC modes
turned on and off, signal handlers, Text nodes per `.map()` row loop, the bundle script's flags,
versions from `package.json`, `node_modules` and the lockfile, the tests against ink-testing's checks,
and the Rust enums tagged `#[serde(tag = "type")]` against the generated TypeScript.

Script output is capped near 4,000 characters by ask-kit, so each script returns a short summary and
`inspect` takes `section` for one part in full.

Scripts: `how`, `render-options`, `faults`, `tests`, `inspect`. Skills in `skills/`: setup-fullscreen,
mouse-selection, fast-frames, write-tests, storybook-for-ink, split-host-and-parts (one per subject; a skill folder of the same name in `SKILLS_DIR` is read instead). Roles: ink-specialist, ink-inspector.

## Bench

`bench/questions.json`: seven questions of the kinds agents dig for by hand about Ink apps, put to the fixture app in
`bench/fixtures/clacks-ui` and to the playbooks, and two script runs.
