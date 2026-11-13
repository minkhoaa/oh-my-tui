# Development


- Presentation only: preserve native Pi execution, tools, prompts, context, sessions, keys and third-party ownership. Never edit Pi core or installed dependencies.
- Preserve history, unrelated work, licenses and attribution. Behavior/evidence: `README.md`; no extra documentation trees.
- Before editing, find and read applicable descendant `AGENTS.md` files, outermost first. Pi 1.5.1 discovers launch-directory ancestors, not scopes on file access; read scopes explicitly on demand. Do not inject them into prompts.
- Install with `npm ci --ignore-scripts`; run `npm run verify` and `npm pack --dry-run`. UI work also requires the isolated README workflow; label unverified checks honestly.
