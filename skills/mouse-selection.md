Add or fix keyboard, mouse, paste and text selection in an Ink 8 app, and find why a key does nothing

Facts are for Ink 8.0.0. A reference layout for the code: `ink/src/input/` with stdin-tap.ts, tokens.ts, mouse.ts and selection.ts.

## Steps

1. Find what the app does today: `await scripts.run("inspect", { section: "stdin" })` (own tap,
   whether it drains, hooks used) and `section: "restore"` (modes turned on and off).
2. Match the symptom:
   - a key does nothing, or F-keys look alike: `useInput` has no F-keys, Insert or separate Alt flag
     (they arrive as `input === ""`). Tokenize stdin yourself.
   - Escape feels slow, or a split sequence turns into text: a lone ESC waits 20 ms.
   - a paste turns into keystrokes: no `usePaste` is mounted, so bracketed paste is off.
   - mouse does nothing: Ink drops mouse reports (below).
   - the app goes deaf after the first key: the tap does not drain (below).
3. Read the section with `scripts.run("how", { q, skill: "ink-input", read: true })` and make the
   smallest change.

## What useInput gives you

- `key.meta` is Alt: ESC plus a character sets it; a bare Escape does not (since 7.0); ESC ESC is
  Alt+Escape. `\r` is `key.return`; `\n` (Ctrl+J) is `input === "\n"`. Keypad Enter is Return.
- Ctrl+letter is `input = letter, ctrl: true`; uppercase ASCII sets `shift`; Shift+Tab is `ESC[Z`.
- With `exitOnCtrlC: false` Ctrl+C arrives as a key even when buffered with other text (8.0). Raw
  mode turns off ISIG: Ctrl+Z is a key, there is no SIGTSTP.
- A host that forwards input must write each sequence in one write: a sequence split across reads
  more than 20 ms apart is delivered as literal text. Under tmux send Escape on its own.

## Paste

- `usePaste(handler)` turns on bracketed paste (`?2004h`) and delivers one string; mount it where
  text can be typed. Without a mounted `usePaste` a paste is a burst of keystrokes and Enter in
  pasted text submits.

## Kitty keyboard

- Kitty keyboard: `render(..., { kittyKeyboard: { mode: "enabled" | "auto", flags } })` buys
  Shift+Enter, Ctrl+I versus Tab, super and hyper. With `reportEventTypes` handlers also fire on
  release: filter on `key.eventType`.

## Mouse: read stdin before Ink

Ink neither enables mouse tracking nor parses reports. Since 8.0 a complete CSI it cannot map to a
key is dropped silently (SGR mouse, focus in and out, cursor and device reports); legacy X10 mouse
is worse (its payload bytes arrive as typed text).

1. Write the mode switches once at start: `?1000h ?1002h ?1003h ?1015h ?1006h` (1003 for hover;
   always SGR 1006, never X10), plus `?1004h` for focus and `?2004h` for paste. Put each one, turned
   off, in the restore sequence.
2. Wrap `stdin.read`: take each read, tokenize it into an ordered list of key, mouse, focus and
   paste events, hand them to your own bus and return `null` so Ink sees nothing.
3. Drain in the same call: loop `for (let c = read(...args); c != null; c = read())` collecting
   text, then return `null`. A real `tty.ReadStream` does not emit `readable` again until a read
   returned `null`; a tap that takes one chunk passes every test on a PassThrough and leaves the real
   renderer deaf after the first key. Only a pty test shows it.
4. The tokenizer keeps an unfinished sequence as `rest` for the next read and flushes it as Esc plus
   characters after about 30 ms. It parses CSI by parameter, intermediate and final byte, kitty
   `CSI u` and modifyOtherKeys, and drops kitty key releases.
5. SGR: `ESC[<b;x;yM` press or motion, `...m` release; `b & 64` wheel, `b & 32` motion, bits 4, 8, 16
   shift, alt, ctrl; x and y are 1-based. Plain motion is not "input" for anything that cancels on
   input.
6. Keep keys and clicks of one read in order, each routed from the state the one before produced.
7. A surface that passes bytes to a child program claims the raw stream whole instead of events.

## Text selection and copy

Capturing the mouse turns off the terminal's own selection, so the app provides it:

- A left press inside a selectable area is held; movement beyond one cell makes it a selection,
  release without movement is a click. Double-click selects a word (path characters `/-+\~_.` count),
  triple-click a line; only in text areas, not lists or tables.
- Bounded to the area it started in, running edge to edge across rows. Shift+arrows extend, Ctrl+C
  copies again, any other key or the wheel clears, a resize drops it.
- Copy from the frame's own cells, trailing padding trimmed, a wide character once, capped at
  1 MiB; write it with OSC 52 `ESC]52;c;<base64>BEL`.
- Paint the highlight on the finished frame (restyle those cells, inverse in mono), not by
  re-rendering React (`fast-frames`).

## Links and pointer

- OSC 8 links: only http, https and mailto, no control characters, at most 2048 bytes,
  percent-encode every character Ink's ANSI regex would not treat as part of the sequence so the
  link measures zero cells. A row holding OSC is rewritten whole by incremental rendering.
- OSC 22 pointer `ESC]22;<shape>ESC\`: write only on change, restore on exit. The host decides per
  terminal whether links and pointer shapes are on.
- Re-evaluate hover after every draw.

## Tests to add

Chunking (one key per read equals all in one read); a pty test typing five keys into the bundled
renderer; a parity fixture from the host (key, view, expected intent). See `write-tests`.
