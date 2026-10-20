# Background removal — investigation

Goal: offline-first, on-device "Remove background" for images. No IMG.LY (competitor, AGPL).
Related backlog item: BACKLOG.md line 31 (2026-10-14, licenses checked 2026-10-16).

## Integration point in Polotno (4.16.1)
- `setRemoveBackgroundFunc(fn)` from `polotno/utils/api` — `fn(src, signal?, request?) => Promise<string | ImageEditResult>`.
- `setRemoveBackgroundEnabled(true)` from `polotno/utils/flags` shows the stock UI (i18n keys already exist in en/ru).
- So we only provide `src -> transparent PNG dataURL/URL`; Polotno's UI does the rest.
- Verified against https://polotno.com/docs/ai-image-tools.md (2026-10-20): documented import is `polotno/config`;
  registering the handler alone makes "Remove background" appear in the AI edit menu; handler gets the original `src`
  (not pixels); return a data URL or durable CORS URL — `blob:` URLs are rejected; only `src` changes, one undo step;
  `store.setTool('remove-background')` also works.

## Platform facts verified 2026-10-20
- Apple docs JSON: `VNGenerateForegroundInstanceMaskRequest` + `generateMaskedImage(...)` macOS 14.0+, not deprecated.
  Swift-native `GenerateForegroundInstanceMaskRequest` macOS 15.0+.
- Electron breaking-changes.md: Electron 38+ requires macOS 12; Electron 44+ requires macOS 13. We're on 39 → users on
  macOS 12/13 need a fallback (or we gate the feature on 14+).

## Spike 1: Apple Vision (macOS 14+) — DONE 2026-10-20
- API: `VNGenerateForegroundInstanceMaskRequest` + `generateMaskedImage(ofInstances:from:croppedToInstancesExtent:)` — same model as Finder/Preview/Photos "Remove Background" / "Lift subject".
- Spike: `.claude/bg-remove/vision-bg.swift` (CLI: `vision-bg <in> <out.png>`).
- Results (M-series, macOS 26.6): 1200–1800 px images, 180–320 ms wall clock incl. process spawn. Portrait (hair), dog, ant (thin legs) all clean with soft alpha.
- Binary: 73 KB arm64; universal (x86_64+arm64, `-target …-macos14`) 139 KB via lipo.
- Limits: macOS 14+ only (app currently targets Electron default macOS 12+), returns "no subject" for scenes without a salient foreground; picks all instances (could expose instance picking later).

## Research: other platforms / open models — DONE 2026-10-20
Verified directly (HF API, npm, gh) on 2026-10-20:
- ZhengPeng7/BiRefNet_lite: MIT, 44.4M params. onnx-community/BiRefNet_lite-ONNX: MIT, fp32 224 MB, fp16 114.5 MB.
- onnx-community/ISNet-ONNX is tagged AGPL-3.0 — avoid. ormbg-ONNX Apache-2.0 (human-focused). Xenova/modnet Apache-2.0
  (portrait-only, transformers.js default). BEN2-ONNX tagged MIT (base model only). RMBG-2.0 "other" (CC BY-NC) — excluded.
- onnxruntime-node 1.30.0 ships no darwin/x64 binary (only darwin/arm64, linux x64/arm64, win32 x64/arm64) — a problem for
  our universal mac build.
- @huggingface/transformers 4.3.1 has a `background-removal` pipeline (modnet/birefnet/isnet/ben).
- ORT issue microsoft/onnxruntime#21968 (BiRefNet on WebGPU) closed as stale 2025-12-30, but a 2026-06-14 comment says it
  still fails on 1.26; community graph-patch workaround exists. → must benchmark in Electron 39.
From agent research (sources in its report, not re-verified by me):
- Windows AI `ImageObjectExtractor`: Copilot+ PC (NPU) only, needs package identity (MSIX/sparse), binary 0/255 mask
  (no soft alpha), prompt-based; hint-free `ImageForegroundExtractor` is experimental. Not worth it as a primary path.
- Linux: no OS API.
- Training data: BiRefNet/IS-Net/BEN trained on DIS5K, whose authors require separate terms for commercial use →
  legal check needed regardless of weight license.

## Recommendation
1. Cross-platform baseline: BiRefNet_lite fp16 (MIT, ~115 MB, downloaded on first use) via onnxruntime-web in a worker
   (WebGPU with WASM fallback). Needs a WebGPU-patched graph + benchmark.
2. macOS 14+: Apple Vision via bundled Swift helper (139 KB universal) — preferred there: zero download, fast, best edges.
3. Skip Windows AI APIs for now; Copilot+ only.

## Next steps (not started)
- Decide: ship Vision-only first (mac 14+), or both at once.
- Benchmark BiRefNet_lite WebGPU vs WASM inside Electron 39 (mac/win/linux).
- Legal: DIS5K terms.

## Implementation: Apple Vision on macOS 14+ (branch nikigan/bg-remove-mac) — started 2026-10-20
Scope: mac-only. ONNX/BiRefNet path stays in BACKLOG.md.

Files:
- `native/remove-background/main.swift` — production CLI. stdin image bytes → stdout transparent PNG.
  Upright via `CGImageSourceCreateThumbnailAtIndex(... WithTransform)` (EXIF orientation applied, as the
  browser shows it), longest side ≤ `--max-side` (4096 default, Polotno's own request cap; never upscales).
  Exit codes: 0 ok, 1 failed, 2 usage, 3 no subject, 4 unreadable. Timing line on stderr.
- `scripts/build-remove-background.mjs` — `xcrun swiftc -O -target {arm64,x86_64}-apple-macos14` + lipo →
  `out/helpers/remove-background` (~180 KB). No-op off macOS; skips when up to date. Hooked into
  `npm run build` (last step) and `npm run dev`.
- `electron-builder.yml` — `mac.extraResources` → `Contents/Resources/helpers/remove-background`;
  `files` excludes `native/*` and `out/helpers/*` (keeps the Mach-O out of app.asar).
- `src/main/remove-background.ts` — availability (darwin && getSystemVersion major ≥ 14 && helper exists),
  spawn per request, cancel = kill, 30 s timeout, electron-log `remove-background.log`, kill on will-quit.
  `POLOTNO_REMOVE_BACKGROUND_HELPER` env overrides the path (point at a missing file to test "unavailable").
- IPC: `removeBackground:available|run|cancel` (src/shared/ipc-contract.ts); result is a union
  (done/canceled/noSubject/unreadable/failed) because IPC rejections lose error fields.
- Renderer (`ai-image-tools.ts`): `setRemoveBackgroundFunc` when available, else `setRemoveBackgroundEnabled(false)`.
  Handler fetches `src` bytes (with signal), returns data URL; abort → cancel IPC → AbortError.
  Errors carry `userMessage` from new i18n keys `error.removeBackground{NoSubject,Unreadable,Failed}` (en, ru).

Verified facts (2026-10-20):
- Polotno 4.16.1 flags.js: `removeBackgroundEnabled = !disabledByClient && (defaultEnabled || handler != null)`.
  So no handler ⇒ hidden; `setRemoveBackgroundEnabled(false)` ⇒ hidden even with a handler.
- @electron/universal 2.0.3: a Mach-O that is already universal in both arch builds is skipped
  ("already universal across builds, skipping lipo") — no `x64ArchFiles` needed. Identical *thin* binaries
  would throw without x64ArchFiles.
- electron-builder 26.15.3 MacTargetHelper.getOptionsForFile: hardened runtime on by default for every
  signed file; non-main binaries get `entitlementsInherit`. @electron/osx-sign 1.3.3 walkAsync signs every
  binary file under Contents/ (Resources included).
- Helper CLI checks: dog 1600×1200 280 ms (first run incl. model load ~1.5 s wall), portrait 1400×2098
  247 ms, flat gray → exit 3, garbage → exit 4, bad flag → exit 2, EXIF orientation 6 → 1200×1600 output.

## Status
- [x] Swift helper + build script + builder config
- [x] Main IPC + renderer handler + i18n; typecheck + eslint on changed files clean
- [x] Dev app: run, undo, cancel, no-subject, hidden when unavailable
- [x] Packaged build: helper in .app, signed
- [ ] Notarization: not verifiable locally (no Developer ID / Apple credentials here) — check the next CI release

## Verification 2026-10-20 (macOS 26.6, M-series)
Driven over CDP (scratchpad e2e/run.mjs: playwright-core connectOverCDP to `--remoteDebuggingPort 9333`,
isolated `--user-data-dir`; `window.polotnoApp.tabs.active.store`). UI was in Russian (system locale).
- Dev: AI edit menu lists "Удалить фон"; click → src becomes a PNG data URL in ~1 s (882 ms in main, 205 ms
  in Vision, rest is spawn + model load on first use). Result clean (dog, soft edges).
- Undo → original JPEG back, redo → PNG: one history step.
- Cancel: `store.setTool('remove-background')`, `el.pendingEdit.cancel()` after 150 ms → run rejects
  `TOOL_FAILED canceled`, log "canceled in 127 ms", no helper process left, src unchanged.
- Flat gray image → status label on the image shows the new no-subject message. The first wording was cut
  off on a 300 px image (label is one line), so all three messages were shortened.
- `POLOTNO_REMOVE_BACKGROUND_HELPER=/nonexistent` → `removeBackground:available` false, menu shows only
  Generative fill + Expand, log "helper missing at /nonexistent".
- typecheck OK; eslint clean on changed files; full `npm run lint` still 48 errors (pre-existing, BACKLOG),
  warnings 362 → 348.
- `npm run build:unpack`: helper at Contents/Resources/helpers/remove-background, universal, not in app.asar,
  signed by electron-builder with flags=0x10000(runtime), secure timestamp, entitlementsInherit; app passes
  `codesign --verify --deep --strict`. Packaged app: feature works (365 ms end to end).
- `electron-builder --mac --dir --universal`: merge OK, helper untouched, verify OK. x86_64 slice under
  Rosetta: 571 ms, correct output.
