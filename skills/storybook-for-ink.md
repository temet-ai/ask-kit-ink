Put Ink components in Storybook, or find why a story of an Ink component spins forever

Reading Storybook itself (stories, renders,
screenshots) belongs to the storybook kit; this is the Ink-specific setup.

## Steps

1. `await scripts.run("inspect", { section: "storybook" })` shows whether the yoga shim, `yogaReady`,
   the reconciler patch and a static-build check exist.
2. A story that spins with no error in a static build but works in the dev server: the top-level
   await trap (below).
3. Compare with the reference setup: `ink/.storybook/` and `stories/support/InkTerminal.tsx` in the repository,
   when it has them.

## Approach

Run the real Ink `render()` in the browser with a fake stdout, parse the ANSI Ink writes into
cells and draw the cell grid as DOM (`InkTerminal`). Import any compositor patch or paint layer in
`preview.tsx` so story frames are composed as in production. Set `chalk.level = 3` in a setup file:
in a browser chalk guesses colour support from the user agent.

## Shim Node out of Ink

Alias each Node module Ink or its dependencies import to a small shim: `process` (null streams),
`events`, `module`, `os`, `path`, `url`, `stream`, `util`, `fs`, `signal-exit`, `terminal-size`,
`cli-cursor`, `is-in-ci`, `patch-console`, and the same `react-devtools-core` stub and `ink-output`
alias as the bundle. Define `process.env.NODE_ENV` as production, build target `esnext`,
`optimizeDeps.include: ["ink"]`.

## The top-level-await trap

Symptom: the static build's preview sits on its spinner with no error. Cause: the bundler makes
every chunk that imports a module with top-level await an async module; story chunks import each
other in a cycle, so a story never finishes evaluating. Ink 8 has three: yoga-layout's wasm load, and
in `ink/build/reconciler.js` `await import('./devtools.js')` and `await loadPackageJson()`.
Fix: replace `yoga-layout` with a module that loads through `yoga-layout/load` and exports a Proxy
answering the enum constants until the real Yoga arrives, export `yogaReady` and await it in every
story's loader; add a `pre` Vite plugin that string-replaces the two awaits in `reconciler.js` and
throws when the text is not found, so an Ink upgrade fails loudly.

## Docgen under TypeScript 7

TypeScript 7 has no JS API, so `react-docgen-typescript` fails. Keep `tsc` at 7, add a local package
depending on TypeScript 5.9 and redirect only docgen's `typescript` import to it with
`module.registerHooks` in `main.ts`.

## Checking the static build

- A `check-static` script: serve `storybook-static` on a free port, drive headless Chrome over the
  DevTools port, wait until the cell grid holds the expected text, screenshot, exit non-zero with the
  reason.
- Component manifest for agents: build Storybook in a child process, copy
  `manifests/components.json` into the repo with absolute paths stripped, and have a test fail when
  story ids no longer match it. In a sandbox the build fails with `uv_interface_addresses` EPERM:
  say so in the error.
- Theme variants: record the host's real theme message once per colour tier (truecolor, 256, 16,
  mono) from a private tmux run and switch between them with toolbar globals.
