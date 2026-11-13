# Oh My TUI

Modular presentation enhancements for [Pi](https://pi.dev), preserving native agent execution, tools, sessions, and keybindings.

## Features

- **Visual presets**: `omt-signature` (default OMT presentation), `codex-inspired`, `claude-code-inspired`, `opencode-inspired`, `minimal`, and `native`.
- **Component styling**: Startup header, composer, messages, tool output/diffs, statusline, and progress.
- **Interactive views**: Settings hub, command palette, tool inspector, Git working tree explorer, session manager, conversation tree, and diagnostics.
- **Right Dock & Agent Fleet**: Overview dashboard with pet status/animation, session tokens, MCP/LSP status, and live Subagent Fleet tracking.
- **Backgrounds & animation**: Procedural ASCII/cell scenes and optional image/animation backgrounds with adaptive fallbacks.
- **No model-facing overhead**: Local presentation and read-only observations; no additional prompts, tools, or model requests.

## Requirements

- Node.js >= 22.19.0
- Pi >= 1.5.0
- Optional: `ffmpeg` on `PATH` for importing animated custom backgrounds (built-in scenes do not require it).

## Installation

```sh
pi install npm:oh-my-tui
```

Or preview a local checkout:

```sh
pi -e ./extensions/omt/index.ts
```

Remove with `pi remove npm:oh-my-tui`.

## Usage & Commands

```sh
/omt settings              # Open settings hub
/omt theme                 # Signature: open the hub's Theme section
/omt theme <name> [save]   # Switch OMT preset (omt, codex, claude, opencode, minimal, native)
/omt save                  # Persist current session overrides
/omt on | off              # Enable/disable presentation components
/omt <component> on | off  # editor, messages, tools, footer, thinking
/omt palette               # Command palette
/omt inspect               # Session trajectory / tool inspection
/omt git                   # Git working tree changes and diffs
/omt session | tree        # Sessions / conversation tree
/omt model                 # Native registry model picker
/omt pet                   # Pet selection and style toggle
/omt queue                 # Prompt queue manager
/omt sidebar               # Scrollable dashboard dialog
/omt sidebar on | off      # Fullscreen Signature dock, otherwise compact companion
/omt notifications         # Session notification history
/omt doctor                # Environment and compatibility diagnostics
/omt background off        # Disable animated/image backgrounds
```

Configuration is stored in `omt.json` in Pi's agent directory. Preset IDs, Signature palette IDs, solid surface IDs, and animated scene IDs are managed through the settings hub.

## Architecture & Native Ownership

- **Presentation-only**: Native Pi retains full ownership of execution, tool schemas, model context, sessions, keybindings, editing, paste, autocomplete, attachments, and complete tool output.
- **Coexistence**: Another extension's editor, footer, tool renderer, or layout is not replaced. Cleanup restores only owned hooks; retained callbacks become inert when ownership is lost.
- **Signature Dock & Layout**: Signature fullscreen composition uses the exported `HStack` and native `setLayoutRoot` API. The original native root remains its left child, reserving 34 columns on the right when the viewport is wide enough.
- **Agent Fleet**: The Signature right dock features dual tabs: Overview (pet animation, session stats, MCP/LSP diagnostics) and Agents (live fleet monitoring direct subagent calls and pi-subagents telemetry).
- **Tool Folding & Expansion**: Consecutive read/bash/grep/find/ls calls fold cleanly into truthful summary cards. Clicking expands individual tool calls with full diffs and structured diagnostic output.
- **Reasoning Previews**: Raw thinking blocks render as clean previews with circle bullets (`○`) and italic styling, expanding into full text upon interaction while preserving native collapsible semantics.
- **Notifications & Toasts**: Floating non-intrusive toast notifications appear at row 1 without shifting chat layout, with full history accessible in `/omt notifications`.

## Development

```sh
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

- `npm run verify` runs TypeScript typechecking (`tsc --noEmit`) and the full test suite.
- `npm pack --dry-run` validates the published npm tarball structure.

## License

Oh My TUI is open-source software licensed under the [MIT License](LICENSE).
