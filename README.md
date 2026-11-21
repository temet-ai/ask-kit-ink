# ask-kit-ink

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about building Ink 8 terminal apps (React in the terminal, usually a child
process that a Rust host drives over IPC), and check an Ink app's code against six playbooks (full-screen
setup, input, frame performance, testing, Storybook, the host and parts split). A cheap model searches the
playbooks by heading and reads the app's code outside your agent's context, and answers with `path:line`
into both.

Questions from its bench, of the kinds sessions dug for by hand about Ink apps:

- Which render() options does my Ink renderer set, and which of the recommended ones are missing?
- Does the renderer read stdin itself for mouse input, and does that reader keep reading until `read()` returns null?
- Escape feels slow in an Ink 8 app: how long does Ink wait on a lone Escape, and which playbook section says so?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) and Node. The kit answers from its own
playbooks; a folder of your own skills can replace them (see "What it carries").

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-ink
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-ink        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-ink --yes  # installs and enables it
```

Restart your agents so `ask` lists `ink`. The kit answers about the repository your agent works
in: it finds the renderer package (a `package.json` that depends on `ink`, up to five levels down)
and the Rust host beside it. A question that names another repository is answered there with
`ink.at(path)`. `INK_REPO` and `SKILLS_DIR` are settings; `SKILLS_DIR` is optional and empty by default.

## What it carries

| | |
|---|---|
| Scripts | `how` (the playbook sections that answer a how-to or why question, ranked, with path:line, opening lines and the matching lines), `render-options` (the render() call against the recommended options, with the reason for each), `faults` (the checks from the playbooks that the app fails, each naming the playbook section), `tests` (which of the testing playbook's checks the tests have, with evidence, and which are absent), `inspect` (stdin, console and Static, restore, Text nodes per row, bundle, versions, Storybook fix, IPC message types) |
| Skills | `setup-fullscreen`, `mouse-selection`, `fast-frames`, `write-tests`, `storybook-for-ink`, `split-host-and-parts`: playbooks the investigator loads when the job calls for one |
| Roles | `ink-specialist` for how-to and why questions; `ink-inspector` for requests to check an app or fix a fault |

The kit's own `skills/*.md` are the playbooks, one per subject (`ink-fullscreen`, `ink-input`,
`ink-frame-performance`, `ink-testing`, `ink-storybook`, `host-parts-tui`), with numbered steps for the
investigator. The kit indexes every section by heading and returns a section's `path:line` with a few
opening lines, never a whole file. If `SKILLS_DIR` names a folder holding skill folders of those names (each
with a `SKILL.md` and optionally `references/`), the kit reads that text at run time instead of its
playbook on the same subject, and edits to it show up on the next question. `how` says which source it used.

Each script also runs with no model: `ask-kit run ink render-options`, or
`ask(do: "ink.render-options")` from an agent. Scripts take `repo=<path>` to look in another
repository and `app=<folder>` when a repository holds more than one Ink package. The `faults` rows
are text matches: the investigator reads the code at each `where` before it reports one.

## What it can change

When the request asks for a change, the investigator edits the renderer's code or its tests through
the `repo` folder source: a render option, a restore sequence, a bundle script, a test. The module's
one changing call, `ink.addRenderOptions`, adds missing options to the object literal that `render()`
takes. A question never changes anything: `addRenderOptions` throws "not in this ask" unless the
caller asked for a change (`act`), and the folder source is read-only in a question. The kit does
not run the app, its tests or its build, and starts no server; running tests and the typecheck is
the npm kit's job.

What the investigator reads goes to a cloud model, so the folder source never reads `.env` files,
tokens, keys, `.npmrc`, lockfiles, `node_modules`, `target` or build output, and `ink.read` refuses
files whose names look like credentials.

## How well it works

`bench/questions.json` holds seven questions and two script runs, each with patterns its answer must
hold, put to a small fixture app in `bench/fixtures/clacks-ui` and to the playbooks. Run it from the kit's
folder. It has not been run on a model yet; `ask-kit kit test ink` runs it. The scripts were run with no
model against the fixture and against real Ink renderers, whose `faults` output was checked by reading the
code it points at.
