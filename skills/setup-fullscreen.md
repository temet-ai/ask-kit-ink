Set up or review an Ink 8 full-screen renderer: render options, root size, Static and console, resize, exit and restore, bundle

When a skill folder named ink-fullscreen is set in SKILLS_DIR, `how` reads that instead; use this file for
the steps. Facts are for Ink 8.0.0.

## Steps

1. `await scripts.run("render-options")` shows the render() call against the recommended set.
   Anything in `problems` is a change to make. `await ink.addRenderOptions({ ... })` adds missing
   options to an options object literal (acting asks only); otherwise edit with `repo.edit`.
2. Check the root is sized to the terminal: the root `<Box>` takes `width={columns} height={rows}`
   with `flexDirection="column"` and `overflow="hidden"`, from stdout columns and rows plus a
   "resize" listener. `repo.rg("useStdout|stdout\\.rows|useWindowSize")` finds it.
3. `await scripts.run("faults")` and read each row's code before reporting it.
4. Check restore: `await scripts.run("inspect", { section: "restore" })`. Every mode turned on
   must be turned off in the restore sequence, and every exit path must write it.
5. Check the bundle: `await scripts.run("inspect", { section: "bundle" })`.

## The render call: the recommended options for a full-screen app

- `interactive: true`. Ink's default is `!isInCi && stdout.isTTY`; with CI=true in the environment
  (a CI job, some agent shells) Ink goes non-interactive: no alternate screen, no resize listener,
  and nothing written until unmount. The renderer looks hung.
- `alternateScreen: true`. Needs interactive and a TTY stdout. Written before the first frame.
- `exitOnCtrlC: false`. With true Ink exits and `useInput` never sees Ctrl+C. Raw mode turns off
  ISIG, so Ctrl+Z also arrives as a key; Ink does no job control.
- `patchConsole: false`. Each `console.*` clears the frame, prints and redraws: on a full-height
  alternate screen that inserts a row. Route logs to the host.
- `incrementalRendering: true`. Standard mode erases and rewrites the whole frame on any change
  (16 to 48 KB a key at 160x40 in a measured app). Incremental rewrites changed rows only.
- `maxFps: 120`. The throttle holds a render up to `ceil(1000/maxFps)` ms; a key's answer is two
  renders (a local change, then the host's snapshot), so at the default 30 it waits 30 to 50 ms.
  `maxFps <= 0` does not turn the throttle off.
- `isScreenReaderEnabled: false`. With `INK_SCREEN_READER` set Ink draws plain wrapped text.
- Never `debug: true` outside tests: it writes every frame whole with no cursor control.

## Sizing the root

Ink sets only the root's width; height comes from content. A frame as tall as the terminal is
"fullscreen" (the trailing newline is dropped so the last row does not scroll). A frame taller than
the terminal takes the full-clear path on every frame (`ESC[H ESC[J` plus the whole frame): flicker
and bytes. A frame shorter than the terminal after a full one clears once. So size the root to
exactly the terminal and clip. The first frame after a resize is at the old height and a second
follows; that is expected. With a custom stdout (tests) set `columns` and `rows` and emit "resize".

## Things that break a full-screen frame

- `<Static>`: its output accumulates on the alternate screen, is replayed on every full clear, and
  any Static in the tree makes every frame take the clear-and-write path. Do not use it.
- Writing to `process.stdout` yourself mid-frame: the next incremental frame lands in the wrong
  rows. Write mode switches (mouse, paste, focus) once at start, before the first frame.
- Width disagreement between the host (Rust `unicode-width`) and Ink (`string-width`): a full-width
  row wraps, the frame scrolls a line and every unchanged row stays a line off. Make both agree and
  strip C0, C1 and DEL from host text before it becomes a cell.
- Trailing spaces are trimmed (`trimEnd` on each row); do not lay out with them.
- Several `setState` calls per host message: each commits, lays out and diffs. Apply a snapshot as
  one state change (`useSyncExternalStore` on the session, or one reducer dispatch).
- Tab moves Ink's focus and Escape clears it: when the app routes keys itself, call
  `useFocusManager().disableFocus()` once.

## Exit and terminal restore

One way out: normal end, uncaught error, unhandled rejection and SIGTERM, SIGHUP, SIGINT all
unmount, write the restore sequence, print the reason to stderr and exit with a code (non-zero
makes a host restart the renderer). Ink's own unmount does not run on SIGKILL, so a host restores
the terminal too. Everything turned on (mouse 1000, 1002, 1003, 1006, 1015; focus 1004; paste 2004;
OSC 22 pointer) goes in the restore sequence. For a child that needs the terminal (`$EDITOR`) use
`useApp().suspendTerminal(cb)`. Check after exit with the tmux live check (`write-tests`).

## Bundling one file

One ESM file the host starts, with Yoga's wasm inlined:
`esbuild src/main.tsx --bundle --platform=node --format=esm --target=node22
--alias:react-devtools-core=<stub> --define:process.env.NODE_ENV=\"production\" --outfile=dist/renderer.js`.

- ESM only: Ink's reconciler and yoga-layout use top-level await, so CJS fails.
- `react-devtools-core` is imported only under DEV=true but a bundler follows it: alias a stub.
- `NODE_ENV=production` selects React's production build.
- Import a `require` shim first (CommonJS dependencies such as signal-exit call `require`), and
  hide global `fetch` while Yoga loads (Node's first fetch loads undici, 30 to 45 ms of a 100 ms
  start), then restore it.
- `npm ls ink` and `npm ls react` should each show one copy.
- Pin `ink` exactly when the code reaches into `ink/build/*` (a fast Output, a Storybook patch):
  those have no semver contract. Read the Ink log between versions, rerun the bundle test, the
  frame-byte test and the live restore check.

## Upgrading Ink

Pin the exact version when the code reaches into `ink/build/*`. Read `git log v<old>..v<new>` in the
Ink checkout, rerun the bundle test, the frame-byte test and the live restore check. Ink 8 needs
React >= 19.3 and `react-reconciler` 0.34; 8.0 drops unrecognised complete CSI sequences (SGR mouse,
focus, device reports) instead of passing them to `useInput`, and keeps Static replayed on the
alternate screen.

## Answer

List what you changed or found with `path:line` of the app's code and of the skill section
(`ink.refOf("ink-fullscreen", "render call")`).
