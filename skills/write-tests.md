Write tests for an Ink 8 renderer that catch what a real terminal shows: harness, contract tests, budgets, pty, bundle, live tmux check

Run `await scripts.run("tests")` first: it lists
which of these checks the app already has, with evidence, and which are absent.

## Steps

1. Read `tests`. For each absent check, add the smallest test that proves it, next to its neighbours
   and in their harness.
2. Never test layout with ink-testing-library: its stdout is fixed at 100 columns.
3. Add a test, read it, and say that it was not run here (the npm kit runs tests).

## Traps

- ink-testing-library fixes stdout at 100 columns; use a stub stdout with a real size.
- `CI=true` makes Ink non-interactive (nothing written until unmount): pass `interactive: true`
  in tests, and `CI: "false"` to pty children.
- No colour without `FORCE_COLOR` (or `chalk.level = 3`), set before chalk loads (`vi.hoisted` in
  vitest). Without it a colour comparison passes vacuously.
- Always `unmount()`: Ink keeps one instance per stdout.
- `debug: true` writes every commit whole: right for asserting a frame, wrong for measuring bytes.

## Harness

A stdout stub: an EventEmitter with `columns`, `rows`, `isTTY = true`, `write` pushing frames,
`resize(c, r)` that sets both and emits "resize". A stdin stub with `isTTY`, `setRawMode`,
`resume`, `pause`, `ref`, `unref`, `setEncoding`, `read()` returning the pending data and
`type(s)` that sets it and emits "readable". Render with `{ stdout, stdin, debug: true,
patchConsole: false, exitOnCtrlC: false, interactive: true }`. Wait on state, not time: poll every
10 ms to a limit, or until no frame was written for about 40 ms. Freeze `Date.now` for anything
animated. `renderToString(<Screen/>, { columns })` is synchronous for pure layout (input hooks are
no-ops, `useLayoutEffect` state shows, `useEffect` state does not); give the root a height. To
assert cells and colours, parse the frame into rows of `{ch, fg, bg, bold, ...}`.

## Contract tests: one test over a table

- Every field is drawn: enumerate the fields of the host's view types from the generated
  TypeScript, require a case per field, render with the field off and on and require the frames to
  differ. A field with no case fails. Keep `KNOWN_UNDRAWN` (fails with "now drawn: remove it" when it
  is drawn) and `INTENTIONALLY_UNDRAWN` (with a reason each) apart.
- A key always arrives: in every transient state (notice, menu, question, text field, overlay, just
  after reconnect) a bound key yields its intent; states that consume keys on purpose are listed.
- Chunking is irrelevant: keys one per read or all in one read give identical intents.
- Overlays are opaque: fill the body with sentinel letters the overlay never uses; any sentinel
  inside the overlay's rectangle is a cell it did not paint.
Run each against the source from before its fix to prove it fails without it.

## Budgets

Frame bytes: with `incrementalRendering`, moving down a 200-row list writes under 3 KB (a whole
rewrite is 16 to 48 KB). CPU per frame and key-to-intent time: user plus system CPU, discard the
first 5 frames, run twice and take the lower, behind an env flag.

## Only a real terminal shows

- pty test: bundle the entry with esbuild, spawn it under a pty, type several keys, assert all
  arrive. It is the only test that catches a stdin tap going deaf after one key.
- Bundle test: run the package's `bundle` script through `sh -c`, run the output alone in an empty
  folder, assert it contains neither `process.env.NODE_ENV` nor "Each child in a list should have a
  unique".
- Parity with the host: a Rust test writes fixtures (view data plus the text or cells the Rust
  renderer drew, or key plus expected intent); the Ink test replays each as its own case.

## Live check under tmux

Real binary, private tmux server named per checkout (`tmux -L <name>`), fixed size, offline data:
`tmux -L t new-session -d -x 160 -y 40 -s app "<binary>"`, `send-keys -t app Down Enter` (Escape on
its own), `capture-pane -p -t app` (add `-e` for colours), and
`display -p -t app '#{alternate_on} #{mouse_any_flag} #{mouse_sgr_flag} #{mouse_button_flag}'`.
Compare Ink with the Rust renderer at the same size and data, never Ink with itself. After quitting
every flag and `alternate_on` must read 0. Keep socket paths under about 100 bytes.
