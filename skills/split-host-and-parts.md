Split a terminal app into a Rust host, one crate per part, and an Ink renderer over IPC

This playbook describes a Rust host with one crate per part and an Ink renderer over IPC; the protocol belongs in a
document of the project (for example `docs/ink-ipc.md`). Rust crates and cargo belong to the rust kit; this is the
shape and the Ink end.

## Steps

1. `await scripts.run("inspect", { section: "ipc" })` compares the host's message enums
   (`#[serde(tag = "type")]`) with the renderer's generated TypeScript.
2. Read the Rust side with `repo.rg` and `repo.read`; do not guess a message's fields.
3. Answer from the shape below with `path:line` of the repository's own files.

## Shape

- A host crate owns every decision, state, config and persistence; one crate per part (service or
  feature) depends on the core only and never names another part. The core names no part. Parts
  meet through subjects, `Show`, `contribute` at a point, and bus topics.
- The host and parts hold no terminal type: they send renderer-neutral view data (plain serde, stable
  string target and action ids) and receive intents. A test reads the source to ban terminal types.
- One renderer: Ink in a child process. The host listens on a Unix socket and the renderer connects;
  stdin, stdout and stderr of the child are inherited so the renderer owns the TTY and the socket
  carries only data.
- Nothing visual in parts: colours are theme slots, glyphs come from an icon pack, widths are display
  cells. The host sends a resolved `look` per colour tier; the renderer chooses no colour.

## IPC protocol and Rust types to TypeScript

- One compact JSON object per line, tagged `type`, snake_case; a maximum line length (16 MiB in
  one implementation) and named bounds on text.
- Renderer to host: hello (protocol, view, capabilities), resize, intent, ack, log, bye, resync.
  Host to renderer: welcome, refuse, look, snapshot, question, notice, clipboard, shutdown.
  Versions in hello; a mismatch is a refuse that names both.
- A snapshot is the whole state; one is in flight and the next is sent on `ack` as the newest state.
  Looks, questions, notices and clipboard are never coalesced. Intents carry the newest cursor the
  renderer saw; a stale cursor is handled, not rejected.
- TypeScript types are generated from the Rust types (ts-rs) by a test that fails when the committed
  files are stale; `ToHost` and `ToRenderer` variants must match.

## Supervisor and restore

The host saves `stty -g` before the child, writes nothing while it runs, and after every exit
(success, crash, refusal, no start) writes the restore sequence and restores the saved modes. A
bounded write queue and a stall timer kill a renderer that stopped reading; three restarts in 60 s
are allowed. When Ink cannot start the host restores the terminal, prints why and exits 1; there is
no second renderer. The renderer restores itself on every exit path too.

## Tests across the boundary

Rust asserts on view data through a headless driver and its text form; Ink asserts on pictures. They
meet at fixtures a Rust test writes and a TypeScript test reads, with an env flag to rewrite them.
Add the "every field is drawn" contract test early, and a pty test and a tmux live check for the
terminal (`write-tests`).
