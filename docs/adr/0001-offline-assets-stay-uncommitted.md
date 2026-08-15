# 1. Offline font and template assets stay uncommitted

Date: 2026-08-15

## Status

Accepted

## Context

The app once bundled a font pack and starter templates so it could run with no
network. That wiring was removed: the editor now loads fonts and templates from
the network, and a true offline mode is planned for much later.

The generated assets stayed in the repo after the wiring left. Nothing imported
them, so every installer carried 2.35 MB it never loaded:

- `src/renderer/public/fonts` — 2.3 MB of woff2 files
- `src/renderer/public/templates` — 52 KB of preview JPEGs
- `src/renderer/src/fonts-manifest.json` — 16 KB

Vite copies `public/` wholesale into the build, so the weight reached users.
The 40 `@fontsource/*` packages had no imports either.

## Decision

Delete the **generated** assets. Keep everything needed to make them again:

- `scripts/fetch-fonts.mjs` and the `@fontsource/*` packages it copies from
- `scripts/build-template-previews.mjs`, `playwright-core`, and the template
  sources in `src/renderer/src/templates`

Two commands restore the full asset set:

```bash
node scripts/fetch-fonts.mjs
node scripts/build-template-previews.mjs
```

## Consequences

- Every installer is 2.35 MB smaller.
- The two generator scripts and the `@fontsource/*` packages have no consumer
  in the source tree. They are **not** dead code — they are the offline mode's
  restore path. Do not delete them as orphans.
- Offline mode needs the two commands above plus the loader wiring, which is in
  git history before this commit.
