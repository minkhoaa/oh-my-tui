# Background ownership

- `assets/`: bounded import/storage/metadata; no renderer dependency or uploaded code execution. Keep decoder timeout/abort, hash-only paths, no-follow reads, source/decoded/storage/cache limits.
- `scenes/`: deterministic artwork, palettes and declarative layers; no Pi hooks or terminal output. `renderers/`: bounded cell formatting/color conversion; no configuration persistence. All scenes, including curated aliases, must honor color and ASCII fallback.
- `compositor/`: protect foreground bytes/widths, styled spaces, links, wide graphemes, cursor and opaque panels. Unknown controls, native images and overlays fail closed. Keep masks viewport-bounded and selection sources wallpaper-free.
- `motion/`: playhead/frame math only; scheduling stays in the existing core coordinator. Suspend without catch-up on pause, focus loss, activity, hidden/unsupported hosts, reduced motion and disposal.
- `integration.ts` and `pi.ts` own Pi adaptation, caches and lifecycle; `managed.ts` adapts asset data to scenes/cells. Public API is `index.ts`; internal modules never import that facade.
- Cells are the live backend. Chafa WASM (`renderers/chafa.ts`) is the default raster converter, lazy-loaded on demand with bounded frame caching. Custom graphics protocols (Kitty/Sixel/iTerm) are eliminated in favor of portable cells and native Pi terminal ownership.

Run `test/{background*,terminal-first,procedural-scenes,modular-backgrounds,chafa-background,architecture}.test.ts`, native host compatibility and isolated background capture workflows.
