# Preset presentation

- Independent OMT Signature, Codex, Claude Code, OpenCode, Minimal and Native presentation; `index.ts` owns IDs/aliases and palette data, not active state or lifecycle. Shared helpers are visual mechanics, not feature managers.
- Honor native `outputPad`, Markdown/syntax, cursor/IME/mouse geometry and width caches. Custom-preset switches must not reconstruct the editor. Native delegates to Pi while retaining component flags.
- Presets: preserve deterministic rendering and state isolation; rails/grammar/scanner remain independent.
- Preset motion functions are deterministic; working motion uses Pi's owned Loader, never per-preset timers. Shared dispatch must not import a helper back from its own dispatcher.

Run matching preset tests plus `test/visual.test.ts`, `test/preset-regression.test.ts` and `test/architecture.test.ts`. Never regenerate goldens merely to accept a refactor.
