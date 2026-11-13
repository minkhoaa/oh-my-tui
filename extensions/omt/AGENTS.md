# Runtime architecture

- `index.ts` is only Pi's entrypoint. `integration/` composes controls and owns `/omt`, actions, lazy dialogs and native lifecycle observations. Pass runtime services explicitly; do not introduce another command/state manager.
- `core/config.ts` owns saved defaults/session overrides and the lazy asset store; `core/theme.ts` owns active preset selection. Import leaf APIs, not cyclic theme barrels. `core/motion.ts` is the single OMT animation coordinator; preserve Pi's separate native working Loader.
- `features/<name>/` owns its contracts and implementation. Keep read-only extraction/formatting in models, lightweight state in stores and interaction in views. Facades expose existing APIs; runtime imports stores directly, optional views lazily. No feature imports another's private helpers.
- `core/native-ui.ts` is the shared guarded Pi boundary; backgrounds own their fullscreen adapter. Require native method/instance shapes, not version allowlists. Yield to foreign owners; restore only owned hooks and make retained wrappers inert.
- Preserve editor geometry/completion/attachments, message Markdown/zones, native reasoning and full tool expansion. Tool controls affect future captured rows; never rebuild history to repaint.
- Read `presets/AGENTS.md` for presentation work and `features/backgrounds/AGENTS.md` for background work.

Verify matching component tests. Integration changes need `test/extension.test.ts` and `test/startup.test.ts`; ownership changes also need conflict/unsupported-host checks. Run `test/architecture.test.ts` after import changes and the installed-host workflow in README after native-boundary changes.
