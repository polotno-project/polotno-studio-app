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
- Benchmark BiRefNet_lite WebGPU vs WASM inside Electron 39 (mac/win/linux). Windows done 2026-10-20, see below.
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

## 2026-10-21 — wrap-up
- Rebased onto origin/master (CHANGELOG.md landed there; BACKLOG.md conflict resolved by keeping both sides). Typecheck, lint and prettier re-run clean.
- Added an Unreleased entry to CHANGELOG.md.
- Pushed the branch, opened a PR, requested a Codex review.
## Handoff 2026-10-20
- macOS (Apple Vision) implementation handed to Orca worktree `bg-remove-mac` (branch nikigan/bg-remove-mac, Claude agent); it cherry-picks ad285be and continues this file there.

## BiRefNet benchmark (Windows)
Run 2026-10-20 by Claude (Opus 5.5) per `.claude/bg-remove/birefnet-benchmark-brief.md`, on branch nikigan/bg-remove-bench-win.
Harness: `.claude/bg-remove/bench/` (not part of the app; `npm i` there; models/images/out are gitignored).
`node run.mjs [case…]` runs each case in a fresh Electron process; `node compare.mjs` prints the table.

### Machine
- AMD Ryzen 9 5900X (12C/24T), 32 GB RAM, Windows 11 Pro 26H2 build 26300.9711.
- NVIDIA GeForce RTX 3070 8 GB, driver 616.92 (32.0.16.1692). A "Meta Virtual Monitor" adapter is also present.
- Electron 39.8.10 / Chrome 142.0.7444.265 (the repo's installed electron).
- `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`: vendor `nvidia`, architecture `ampere`,
  device/description empty, not a fallback adapter, `shader-f16` yes, maxStorageBuffersPerShaderStage **10**,
  maxStorageBufferBindingSize 2147483644, maxBufferSize 2147483648.
- Page and worker are `crossOriginIsolated: true` (custom `bench://` protocol serving COOP/COEP), so WASM runs
  multi-threaded (ORT default numThreads = 4).

### Setup
- Models: onnx-community/BiRefNet_lite-ONNX `onnx/model_fp16.onnx` (114.5 MB) and `onnx/model.onnx` (224 MB), MIT.
  runes/birefnet-lite-webgpu `birefnet_lite_webgpu_fp16.onnx` (123 MB), HF license tag MIT. It is the same weights after
  graph surgery (per its card: ORT BASIC constant folding, Concat/Split fan-out capped at 6, Sum→Add, fp16 with fp32 I/O).
  All graphs: `input_image` f32 [1,3,1024,1024] → `output_image` f32 logits [1,1,1024,1024].
- Our own fp32 patched graph `birefnet_lite_webgpu_fp32.onnx` (244 MB), built with `bench/patch_webgpu.py`. Same recipe,
  no fp16: 4083 → 4715 nodes; 4 Concat, 59 Split and 20 Sum nodes rewritten.
- Runtimes: onnxruntime-web 1.30.0; transformers.js 4.3.1 (bundles onnxruntime-web 1.31.0-dev.20260914);
  onnxruntime-node 1.30.0 (its win32/x64 build ships DirectML.dll).
- In ORT-web 1.30, `ort.webgpu.min.mjs` (`onnxruntime-web/webgpu`) is the **native C++ WebGPU EP** (asyncify wasm).
  The older **JSEP** WebGPU EP survives only in `ort.all.min.mjs`. Both were tested ("native" and "JSEP" below).
- Test images (Wikimedia Commons, CC BY / CC BY-SA, kept local only): curly-hair portrait 1280×1918, dog 1280×1707,
  sneakers product shot 1280×850, crowded market 640×430.
- Per case:
  - Timings: model fetch; session create ("load"); first `session.run` on the portrait; median of 5 warm portrait runs;
    one run on each other image. Pre/post-processing is excluded (resize/normalize 20–40 ms; sigmoid and mask
    upscale 30–155 ms). transformers.js times are end-to-end pipeline calls.
  - Correctness: compare the full-res alpha to the onnxruntime-node CPU fp32 reference. The table shows the worst of the
    4 images for mean abs diff (MAD, 0–255) and for IoU at α≥128.
  - Memory: Windows private-bytes peaks of the renderer, GPU and main processes (`app.getAppMetrics()`). "VRAM Δ" is the
    device-wide `nvidia-smi` peak minus the baseline.

### Results
| case | result | load ms | 1st infer ms | warm median ms | renderer MB | GPU proc MB | main MB | VRAM Δ MB | max MAD | worst IoU |
|---|---|---|---|---|---|---|---|---|---|---|
| **ORT-web WebGPU native, own patched fp32** | **correct** | 1,796 | 3,981 (rerun 2,135) | **1,291** (rerun 1,273) | 1,205 | 8,593 | 596 | 6,682 | 0.15 | 0.995 |
| ORT-web WebGPU native, runes patched fp16 | **all-NaN on portrait** (other 3 correct) | 1,833 | 1,105 | 709 (rerun 688) | 937 | 5,106 | 365 | 4,430 | 193 | 0.000 |
| ORT-web WebGPU native, stock fp16 | FAIL: too many storage buffers | 3,993 | — | — | 747 | 753 | 345 | 208 | — | — |
| ORT-web WebGPU native, stock fp32 | FAIL: too many storage buffers | 3,861 | — | — | 1,234 | 1,171 | 554 | 933 | — | — |
| ORT-web WebGPU JSEP, own patched fp32 | wrong output (garbage, no NaN) | 1,764 | 2,487 | 1,130 | 1,316 | 9,097 | 599 | 6,735 | 192 | 0.000 |
| ORT-web WebGPU JSEP, runes patched fp16 | wrong (1st run garbage, then all-NaN) | 1,968 | 1,339 | 796 | 953 | 5,227 | 370 | 4,716 | 185 | 0.000 |
| ORT-web WebGPU JSEP, stock fp16 / fp32 | FAIL: std::bad_alloc | 4,439 / 3,999 | — | — | 4,122 / 4,162 | 3,890 / 6,888 | 349 / 561 | 3,073 / 5,648 | — | — |
| ORT-web WASM ×4 threads: stock fp16, stock fp32, runes fp16, own fp32 | FAIL: std::bad_alloc | 956–2,797 | — | — | 3,834–5,564 | ~130 | — | — | — | — |
| transformers.js `background-removal`, webgpu fp16 / fp32 | FAIL: too many storage buffers (11 > 10) | 4,738 / 4,393 | — | — | 772 / 1,227 | — | — | — | — | — |
| transformers.js `background-removal`, wasm fp16 / fp32 | FAIL: std::bad_alloc | 5,114 / 3,884 | — | — | 6,792 / 3,993 | — | — | — | — | — |
| ORT-node DirectML (main process), stock fp16 | correct | 3,888 | 2,421 | 1,787 (rerun 1,745) | — | — | 12,029 | 6,202 | 0.02 | 0.9998 |
| ORT-node DirectML, runes patched fp16 | correct | 1,975 | 3,258 | 2,884 | — | — | 9,138 | 5,438 | 0.02 | 0.9997 |
| ORT-node DirectML, stock fp32 | FAIL: 8007000E (E_OUTOFMEMORY) | — | — | — | — | — | 9,867 | — | — | — |
| ORT-node CPU, stock fp32 (reference) | correct | 3,083 | 4,827 | 4,684 | — | — | 17,383 | — | 0 | 1 |
| ORT-node CPU, own patched fp32 | correct (identical alpha) | 1,135 | 4,478 | 4,457 | — | — | 10,032 | — | 0.00 | 1.000 |

- Every case writes its cutout PNGs to `bench/out/<case>/` (gitignored).
- I checked the working cases' cutouts by eye. Hair, whiskers, shoelaces and the gap between the sneakers are clean.
  On the busy scene the model keeps only the nearest person, the same as the reference.

Exact errors:
- WebGPU native with the stock graph (ORT-web 1.30, and transformers.js): `shader_helper.cc:308 … numbers_storage_buffers_
  <= limits_.maxStorageBuffersPerShaderStage was false. Too many storage buffers in shader. Current: 11, Max is 10`.
- JSEP with the stock graph, and every WASM case: `failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc`
  (the 4 GB wasm32 heap).
  - WASM also fails with numThreads=1, with enableCpuMemArena=false + enableMemPattern=false, and with all three,
    on both the stock and our patched fp32 graph.
  - For scale, the native CPU runs' private bytes peak at 10–17 GB.
- DirectML fp32: `Non-zero status code returned while running DmlFusedNode_15_51 … 8007000E` (out of memory on the 8 GB card).

### fp16 NaN investigation (native WebGPU)
- The NaN is deterministic and depends on the input:
  - The portrait gives all-NaN logits on every run (first and warm), whatever the image order.
  - dog, product and busy are correct (MAD ≤ 0.17).
  - The same fp16 graphs are correct on DirectML, so the weights are fine. The overflow is in ORT-web's WebGPU fp16 kernels.
- Our own fp16 conversion (`bench/to_fp16_mixed.py`, onnxconverter-common, fp32 I/O):
  - Keeping LayerNorm/Softmax/ReduceMean/Pow/Sqrt/Div/Erf/Exp/Sigmoid in fp32: portrait still NaN.
  - Also keeping Gemm/MatMul in fp32: still NaN.
  - Keeping **Conv** in fp32: correct on all 4 (MAD ≤ 0.18), but warm 2,017 ms, slower than full fp32.
  - So one or more fp16 Conv kernels overflow. I didn't try to narrow it down to specific Conv nodes.
- JSEP is wrong at fp32 too, so its problem isn't precision. Treat JSEP as unusable for this model.

### Recommendation
1. **WebGPU does not work without patching.** The stock export fails on every in-browser path: the native EP hits the
   storage-buffer limit, and JSEP/WASM hit bad_alloc. transformers.js's `background-removal` pipeline fails the same way.
2. **Ship candidate: onnxruntime-web native WebGPU EP (`onnxruntime-web/webgpu`) in a worker + our own patched fp32 graph**
   (244 MB, MIT weights).
   - It's the only in-browser path that is correct on all test images.
   - On the RTX 3070: ~1.3 s warm, ~1.8 s session create, 2–4 s first inference (shader compile).
   - No native module, so it sidesteps the onnxruntime-node darwin/x64 gap noted above.
   - We'd host the patched graph ourselves: the runes repo only ships fp16.
3. **Don't ship fp16 yet.** The runes fp16 graph is 1.8× faster (~0.7 s) at half the download, but it returns NaN on a
   real photo (the portrait). Fixing it needs per-Conv mixed precision and a bigger image set. Worth a follow-up because
   it halves the download.
4. **There's no in-browser CPU fallback at 1024².** For machines without usable WebGPU, the remaining option is
   onnxruntime-node from the main process (DirectML fp16 ~1.8 s, CPU ~4.7 s, both correct). That needs a native module
   per platform. The other way out is a smaller model.
5. **Memory is the main risk.**
   - The working WebGPU case peaks at ~6.7 GB VRAM Δ (GPU process ~8.6 GB private) on an 8 GB card, and DirectML fp32
     runs out of memory on the same card.
   - It will likely fail on 4 GB discrete GPUs and may struggle on integrated GPUs.
   - The likely cause is BiRefNet's unrolled deformable convolutions (~784 MB tensors, per the runes card).
   - Before committing to this model: release the session after each use, and test on an iGPU / 4 GB GPU.

### Follow-ups
- Run the harness on a low-VRAM or integrated-GPU Windows machine, and on mac/linux.
- Per-node fp16 block list (find the overflowing Convs) → ~120 MB model at ~0.7 s, if it holds.
- Still open from above: DIS5K training-data terms.
