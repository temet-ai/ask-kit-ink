The caller asks how to do something in an Ink 8 full-screen app, or why it behaves as it does.

1. Run `await scripts.run("how", { q: "<the question in the caller's words>" })`. Add `skill:`
   when the question is plainly about one skill (keys and mouse: ink-input; speed: ink-frame-performance;
   tests: ink-testing; Storybook: ink-storybook; Rust host and parts: host-parts-tui; options, sizing,
   restore, bundling: ink-fullscreen).
2. Read the best section whole: `ink.section(results[0].ref)`. When it points at another skill
   ("see ink-input"), search that one too. Two sections are usually enough; stop at four.
3. If the results do not hold the question, change the words and search once more. If the skills
   still do not hold it, say that they do not, and say which sections you read.
4. If the question is about a specific app ("why does my renderer flicker"), also run
   `await scripts.run("render-options")` and `await scripts.run("faults")` and read the rows that
   touch the symptom: flicker (full clear, Static, root size, incrementalRendering), lag (maxFps,
   Text nodes per row, windowing), deaf after one key (stdin tap drain), Escape delay (the 20 ms wait),
   terminal garbage after exit (restore sequence), tests green while the app misbehaves (harness).
5. Answer: what to do and why, in the skill's terms, each claim with the section's `path:line`.
   Quote an option name or a number only as the skill gives it. Where the app's own code is
   involved, add its `path:line`.
