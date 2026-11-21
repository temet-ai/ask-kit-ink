Make an Ink 8 full-screen app fast: find where a frame's time goes and apply the cheapest fix first

Numbers are from a measured full-screen Ink app at 160x40 with colour: Ink's `Output.get()` cost 50 to 100 ms of CPU a frame, about 85% of the renderer.

## Steps

1. `await scripts.run("render-options")`: `incrementalRendering`, `maxFps: 120` are free and the
   biggest latency win.
2. `await scripts.run("inspect", { section: "textNodes" })`: Text nodes per row loop, nested Text,
   Transform, and whether a cell-row model or windowing exists.
3. Look for `<Static>` and a root that is not terminal-sized (`faults`).
4. Only then consider replacing Ink's compositor; measure first (below).

## In order of cost to adopt

1. Render options (`setup-fullscreen`), root sized to the terminal, no `<Static>`.
2. One state change per host message (`useSyncExternalStore` on the session).
3. Window long lists. Clipped children are still laid out and tokenised, so render one screenful:
   move the first row only as far as needed to bring the cursor into view. A 200-row list then
   costs about 40 nodes.
4. Fewer, larger `<Text>`. Nested Text runs transforms per measure and per render; `<Transform>`
   runs per line per frame. Build a row's string and styles yourself.
5. Rows from data, then one text node per block: lay out as cell arithmetic (`Row { cells, hits }`),
   emit one `<ink-text>` per block of rows. Keep the plain text ASCII (non-ASCII as a placeholder of
   equal width) so `string-width` stays on its fast path, and carry the real characters and style
   runs on the transformer function for the compositor. Cache rows by content so React and Yoga skip
   unchanged ones.
6. Replace `Output.get()`: `ink` exports only `build/index.js`, so alias the internal module
   (`--alias:ink-output=./node_modules/ink/build/output.js`) in every build that loads Ink, pin Ink
   exactly, patch `Output.prototype.get` with a grid of (char, interned style id), write each row as
   runs of equal style, probe each Text transformer once and fall back to Ink's own `get()` for any
   that is not plain SGR-around-text, return the previous frame string when no write changed, and
   keep an env escape hatch. Test it against Ink's own output cell by cell with `FORCE_COLOR=3` set
   before chalk loads. It needs a width function that matches the host's (grapheme clusters, VS16,
   keycaps, flags, ZWJ as 2): a one-cell undercount wraps a full row and shifts every unchanged row.
7. Paint layers on the finished frame for hover, selection and menu scrims: no React render per
   hover; ask Ink for a frame by calling the root node's `onRender()`.
8. Motion: post-process the finished frame, rewrite colours only, arm no timer while idle.

## Where the time goes (Ink 8.0.0)

React commit, Yoga layout, a throttled `onRender`, `renderNodeToOutput`, then `Output.get()` which
allocates a width x height grid, re-tokenises every write each frame and `trimEnd`s every row, then
log-update writes it. Incremental mode falls back to whole-row rewrites when the columns or row
count changed, a row holds non-SGR controls (OSC 8, tabs), or the prefix reaches the right margin.
Nodes clipped by `overflow="hidden"` are still laid out and tokenised.

## Measuring

- A latency trace behind an env flag: mark at the stdin read or host snapshot, close at the first
  stdout write after the next render, log to the host.
- CPU per frame (user plus system, warm-up frames dropped, best of two) and frame-byte budgets as
  tests (`write-tests`). A move down a 200-row list writes under 3 KB incrementally.
- Key to first byte in a real pty. `node --cpu-prof dist/renderer.js` for start-up.
