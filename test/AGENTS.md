# Test isolation

- Integrate with real Pi components/loader/session; isolate settings, auth/model paths and sessions in temporary/in-memory storage. Disable model network/refresh and guard `fetch`; no inference.
- Restore overrides, mocks and controls on failure via `try/finally` or test cleanup; serialize shared-host mutations within each process.
- Keep `extension.test.ts` prompt/tool/message invariance checks context-free; instruction overhead is separate from shipped OMT behavior.
- Focused run from repository root: `node --experimental-strip-types --test test/<name>.test.ts`.
- For removal smoke checks, inspect command registration/completion; never submit an unknown slash command, which may fall through to inference.
