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
- Legal: DIS5K terms. Decided 2026-10-21 (see "Licensing facts" below): OK for the free app with attribution. The SDK
  needs a lawyer or written permission first.

## Licensing facts (2026-10-21, not legal advice)
- BiRefNet_lite weights: MIT (huggingface.co/ZhengPeng7/BiRefNet_lite). The card says it "is trained on DIS-TR and
  validated on DIS-TEs and DIS-VD", which are all DIS5K splits.
- IS-Net (`isnet-general-use.pth`): the repo code is Apache-2.0. The weights have no licence of their own. They are
  published by the DIS5K authors themselves (Xuebin Qin et al.).
- DIS5K terms of use (`DIS5K-Dataset-Terms-of-Use.pdf` in github.com/xuebinqin/DIS):
  - §2: "available for non-commercial use in research or educational purpose … Without permission from the original
    authors, commercial use of this dataset is prohibited even after copying, editing, processing or any operations of
    this database. Please contact us for commercial use or if you are uncertain about the decision."
  - §4 forbids redistributing the dataset itself, "in whole or in part".
- Open question: whether trained weights count as "processing" the dataset.
  - Cautious reading: both models inherit the restriction. The terms permit only research or educational use, and the
    paid Polotno SDK would be plainly commercial.
  - Counterpoints:
    - The terms are a registration contract, binding those who downloaded DIS5K (the model authors), not users of the
      models.
    - Weights are not copies of the images or annotations.
    - BiRefNet reaches us under MIT from its author.
    - IS-Net's weights are published openly "for general use" by the dataset owners themselves.
- **Decision (2026-10-21): the app can ship either model.** The feature is app-only for now and the app is free, so the
  practical risk is low.
  - Prefer BiRefNet where possible, since it has the explicit MIT licence.
  - IS-Net's remaining gap is that its weights have no explicit licence (they sit next to Apache-2.0 code).
  - Optional insurance: email Xuebin Qin to confirm that the IS-Net weights may be used in a free app.
- Attribution: list the shipped model(s) in the app's third-party notices.
  - BiRefNet: MIT licence text, plus the Zheng et al. "Bilateral Reference for High-Resolution Dichotomous Image
    Segmentation" citation.
  - IS-Net: the github.com/xuebinqin/DIS repo, plus the Qin et al., ECCV 2022 "Highly Accurate Dichotomous Image
    Segmentation" citation.
- **Before this feature reaches the Polotno SDK, review again.** Get a lawyer's sign-off or written permission from the
  DIS5K authors covering commercial use of models trained on DIS5K. That is when commercial use and customer licence
  audits come in, and the terms invite exactly this request ("Please contact us for commercial use").

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

## Handoff 2026-10-21
- The Windows research was pushed as `nikigan/bg-remove-bench-win`.
- The cross-platform implementation (IS-Net standard engine, plus an optional BiRefNet "high quality" retry) is handed
  to the Mac workspace `bg-remove-mac`, per `.claude/bg-remove/implementation-brief.md`.

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

### Deformable-conv chunking (2026-10-21)
Why the VRAM: `bench/mem_profile.py` (static shape inference at 1024², liveness sweep in graph order) puts the weights
at 232 MB but the activations' lower-bound peak at **4.02 GB**, even if every tensor is freed right after its last use.
- The peak is one layer: `decoder_block1/dec_att/aspp_deforms.2`, a 7×7 deformable conv (C=64, 256×256).
- The export has no DeformConv op, so it spells it out as 4 bilinear-corner `GatherND`s of `[1,1,49·256·256,64]`,
  weighted `Sum`, modulator `Mul`, then Reshape/Transpose to `[1,64,1792,1792]` and one Conv with stride 7.
- Each of those tensors is 784 MB, and several are live at once.

Fix: `bench/deform_chunk.py` (run before `patch_webgpu.py`) rewrites the 10 deform convs with kernel > 1×1.
- That stride-7 Conv equals the sum over kernel rows r of `Conv(W[:,:,r:r+1,:], stride (1,7))` on row r's samples,
  so each row gets its own sampling plus Conv, and the results are accumulated with Add.
- Sampled tensors drop from 784 MB to 112 MB. The lower-bound peak drops from 4.02 GB to **0.94 GB**, now set by the
  ordinary 1024² decoder convs.
- Outputs are identical: on ORT CPU, max |Δlogit| is 7e-5 on logits up to 15. The alpha matches the fp32 reference at
  the same MAD 0.15 / IoU 0.995 as the unchunked graph.
- Size: 245 MB, 6,505 nodes (was 4,715).

| case (same session) | load ms | 1st infer ms | warm median ms | renderer MB | GPU proc MB | VRAM Δ MB | max MAD | worst IoU |
|---|---|---|---|---|---|---|---|---|
| ORT-web WebGPU native, own patched fp32 (rerun) | 1,763 | 2,184 | 1,378 | 1,185 | 8,597 | 6,912 | 0.15 | 0.995 |
| **ORT-web WebGPU native, chunked fp32** | 2,314 | 1,874 | **699** | 1,266 | 6,178 | **5,541** | 0.15 | 0.995 |
| ORT-web WebGPU native, chunked fp32, `storageBufferCacheMode: 'lazyRelease'` | 2,243 | 1,627 | 851 | 1,221 | 4,873 | **4,229** | 0.15 | 0.995 |
| ORT-web WebGPU native, chunked mixed fp16 | 2,223 | 1,190 | 558 | 804 | 3,673 | 3,122 | 193 | 0.000 (portrait all-NaN) |
| **ORT-web WASM ×4 threads, chunked fp32** | 1,235 | 10,339 | 10,471 | 2,993 | 152 | — | 0.15 | 0.995 |
| ORT-node DirectML, chunked fp32 | 2,344 | 4,359 | 4,091 | — | — | 5,657 | 0.00 | 1.000 |

- **WebGPU is 2× faster** than the unchunked fp32 graph (699 vs 1,378 ms warm), and VRAM Δ falls by 1.4 GB.
- **WASM now runs** (it used to hit bad_alloc), but at 10.5 s per image. It's a fallback of last resort.
- DirectML fp32 no longer runs out of memory, but it's slow (4.1 s).
- Measured VRAM (4.2–5.5 GB) is still far above the 0.94 + 0.23 GB lower bound. The rest is ORT-web's WebGPU buffer
  cache, not the model.
  - Cache modes: `bucket` (the default) gives 5.5 GB at 699 ms, `lazyRelease` 4.2 GB at 851 ms, and `simple` 6.9 GB
    at 1,489 ms.
  - `disabled` crashes: `WebGPU validation failed. [Buffer (unlabeled)] used in submit while destroyed`.
  - `enableMemPattern` true/false makes no difference.
- fp16 still produces all-NaN on the portrait with the chunked graph, so the overflow isn't in the deform-conv path.

### IS-Net, our own conversion (2026-10-21)
Question: can a lighter model run on non-gaming hardware? IS-Net is the architecture IMG.LY ships. Only IMG.LY's
library and the `onnx-community/ISNet-ONNX` conversion (AGPL) are excluded, so I converted the original weights myself.

Provenance and licence:
- Weights: `isnet-general-use.pth` from the README's Google Drive link in github.com/xuebinqin/DIS (commit b6764e2).
- Code and metric: "Our code and evaluation metric use Apache License 2.0".
- **The weights have no stated licence.** Like BiRefNet, IS-Net is trained on DIS5K, so it has the same open
  DIS5K-terms question. Resolved for the free app; the SDK needs a review first (see "Licensing facts").

Export (`bench/export_isnet.py`, torch 2.14 CPU, opset 17):
- Fixed 1×3×1024×1024 input, output `sigmoid(d1)`.
- Preprocessing as in IS-Net/Inference.py: RGB/255 − 0.5, std 1. The output is min-max normalized per image.
- 44M params, 176 MB fp32 / 88 MB fp16 (`to_fp16_mixed.py`), 593 nodes of Conv/ReLU/Concat/Resize/MaxPool.
- It runs on WebGPU unpatched: Concat fan-out is at most 4, and there are no deformable convs or attention.
- `mem_profile.py`: activation lower-bound peak **0.24 GB** (BiRefNet chunked: 0.94 GB). Activations total 2.1 GB
  (BiRefNet: 47 GB).

| case | load ms | 1st infer ms | warm median ms | renderer MB | GPU proc MB | VRAM Δ MB |
|---|---|---|---|---|---|---|
| ORT-web WebGPU native, IS-Net fp32 | 841 | 445 | **93** | 1,026 | 1,619 | 1,305 |
| ORT-web WebGPU native, IS-Net fp16 | 656 | 205 | **76** | 869 | 964 | **704** |
| ORT-web WASM ×4 threads, IS-Net fp32 / fp16 | 260 / 277 | 2,478 / 2,381 | 3,233 / 3,233 | 1,122 / 998 | ~150 | — |
| ORT-web WASM ×8 threads, IS-Net fp32 | 256 | 1,439 | **1,748** | 1,151 | 163 | — |
| ORT-node CPU, IS-Net fp32 (IS-Net reference) | 325 | 472 | 515 | — | — | — (main 1,413) |
| ORT-node DirectML, IS-Net fp32 / fp16 | 1,454 / 814 | 50 / 26 | 26 / 12 | — | — | 1,007 / 442 |
| *for comparison: ORT-web WebGPU, BiRefNet chunked fp32* | 2,498 | 1,700 | 698 | 1,194 | 6,176 | 5,540 |

Cost: about **7.5× faster on WebGPU, 4–8× less VRAM**, and WASM at 1.7–3.2 s per image is usable as a CPU fallback.

Port correctness, against IS-Net on ORT-node CPU fp32:
- WebGPU fp32/fp16 and WASM: MAD ≤ 0.85 and IoU ≥ 0.997 on portrait, dog and product.
- DirectML: IoU ≥ 0.973 on all four images.
- busy: ISNet's own mask is only 0.1–0.3% foreground, so IoU there is noise (0.30–0.39). WebGPU and WASM agree with
  each other exactly; the gap from the reference is the different resize (canvas vs nativeImage).
- No NaN in fp16, and fp16 matches fp32 (IoU ≥ 0.997 on the three real masks).

Quality, against BiRefNet (checked by eye on a contact sheet, and with the numbers):

| image | IoU vs BiRefNet | MAD |
|---|---|---|
| portrait | 0.983 | 7.7 |
| product | 0.981 | 1.6 |
| dog | 0.671 | 40.8 |
| busy | 0.000 | 11.3 |

- **portrait / product: about as good as BiRefNet.** Hair and laces hold up, with slightly softer edges.
- **dog: ISNet keeps the head and collar but drops the chest, vest and lower leash.** That's a large, obvious error.
- **busy: ISNet returns faint ghost blobs instead of the nearest person.** Raw sigmoid without min-max gives the same
  result, so the low confidence is genuine.
- Four images is too few to call it. IS-Net is clearly weaker on subject-vs-scene decisions, and close on clean
  single-subject photos, which is the typical "remove background" input.

### IS-Net vs BiRefNet on 30 Unsplash photos (2026-10-21)
Test set:
- 30 photos from the same source as the app's Photos panel: Unsplash via Polotno's proxy, through the vendored
  `polotno-design` skill. Fetched by `bench/fetch_unsplash.mjs`.
- One photo per query (first result, 1080 px). Queries cover people (10), animals (4) and products/objects (16).
- Queries and URLs are in `bench/unsplash-manifest.json`; the image files are gitignored.

Run: `BENCH_ORDER=<names> BENCH_OUT=out-unsplash node run.mjs …`, on ORT-web native WebGPU.

| case | median infer per image (30 images) | max | VRAM Δ MB | GPU proc MB |
|---|---|---|---|---|
| BiRefNet chunked fp32 | 711 ms | 1,992 (first) | 5,531 | 6,273 |
| IS-Net fp16 | **78 ms** | 170 (first) | **811** | 1,048 |
| IS-Net fp32 | 96 ms | 285 (first) | 1,413 | 1,657 |

No NaN anywhere. IS-Net fp16 and fp32 agree with each other.

Agreement, IS-Net fp16 against BiRefNet:
- Median IoU 0.978. 25/30 images are at IoU ≥ 0.9.
- Outliers: potted-plant 0.69, birthday-cake 0.73, wine-glass 0.55, bicycle 0.90, flower-bouquet 0.90.

Quality, checked by eye on contact sheets (original | BiRefNet | IS-Net) for all 30:

| | good | minor flaws | clearly wrong |
|---|---|---|---|
| BiRefNet chunked fp32 | 28 | 2 (wine-glass keeps a blurry background sleeve; some green fringe in the child's flyaway hair) | 0 |
| IS-Net fp16 | 21 | 6 | **3** |

- IS-Net's minor flaws:
  - curly-hair: black T-shirt partly see-through.
  - child: green fringe in hair.
  - group silhouettes: fuzz at the feet.
  - bicycle: fainter spokes.
  - wine-glass: drops most of the hands, leftmost glass faint.
  - bouquet: drops the lower leaves.
- **IS-Net's failures share one pattern: a large, uniform part of the subject whose colour is close to the background
  turns semi-transparent.**
  - long-hair-wind: the black jacket is see-through.
  - potted-plant: the green pot on a dark wall is a white ghost.
  - birthday-cake: the cake body is gone and only the drips remain.
- Clean single-subject product and pet shots are equal for both models. That covers sneakers, perfume, coffee,
  headphones, watch, handbag, armchair, car, burger, laptop, dog, cat, parrot, horse, and most portraits.

Takeaway: on stock-photo content, IS-Net is good enough for about 70% of images and visibly wrong on about 10%.
BiRefNet is right on essentially all of them, at about 9× the time and about 7× the VRAM.

### Recommendation
1. **WebGPU does not work without patching.** The stock export fails on every in-browser path: the native EP hits the
   storage-buffer limit, and JSEP/WASM hit bad_alloc. transformers.js's `background-removal` pipeline fails the same way.
2. **Ship candidate: onnxruntime-web native WebGPU EP (`onnxruntime-web/webgpu`) in a worker + our own patched fp32 graph,
   built with `deform_chunk.py` then `patch_webgpu.py`** (245 MB, MIT weights). See "Deformable-conv chunking" above.
   - It's correct on all test images.
   - On the RTX 3070: ~0.7 s warm, ~2.3 s session create, ~1.9 s first inference (shader compile).
   - Unchunked it was ~1.3 s warm.
   - No native module, so it sidesteps the onnxruntime-node darwin/x64 gap noted above.
   - We'd host the patched graph ourselves: the runes repo only ships fp16.
3. **Don't ship fp16 yet.** The runes fp16 graph is 1.8× faster (~0.7 s) at half the download, but it returns NaN on a
   real photo (the portrait). Fixing it needs per-Conv mixed precision and a bigger image set. Worth a follow-up because
   it halves the download.
4. **The in-browser CPU fallback is too slow.** With the chunked graph, ORT-web WASM works, but at ~10.5 s per image.
   For machines without usable WebGPU, the better option is onnxruntime-node from the main process (DirectML fp16
   ~1.8 s, CPU ~4.7 s, both correct). That needs a native module per platform. The other way out is a smaller model.
5. **Memory is still the main risk, but smaller.**
   - The chunked WebGPU case peaks at ~5.5 GB VRAM Δ (bucket cache) or ~4.2 GB (`lazyRelease`, about 20% slower).
     That's down from ~6.9 GB, against a model lower bound of ~1.2 GB.
   - The remaining overhead is ORT-web's buffer cache.
   - 4 GB discrete GPUs and integrated GPUs are still unproven.
   - Before committing to this model: release the session after each use, and test on an iGPU / 4 GB GPU with both
     cache modes.
6. **For typical hardware, IS-Net (own conversion) is the realistic default, and BiRefNet the quality tier.**
   - IS-Net fp16: 88 MB, ~80 ms and ~0.7 GB VRAM on WebGPU, 1.7–3.2 s on WASM. It should run on iGPUs, and it has a
     CPU fallback inside the browser with no native module.
   - Its quality is close on clean single subjects but clearly worse on harder scenes (dog body, busy scene).
     On 30 Unsplash photos it was clearly wrong on 3 (BiRefNet: 0) and had minor flaws on 6.
   - Option: IS-Net by default, BiRefNet chunked as a "high quality" mode or on strong GPUs (choose from
     `requestAdapter()` info).
   - Licensing: OK for the free app with attribution. The SDK needs a separate review (see "Licensing facts").

### Follow-ups
- Run the harness on a low-VRAM or integrated-GPU Windows machine, and on mac/linux.
- Per-node fp16 block list (find the overflowing Convs). On the chunked graph this would give ~120 MB at ~0.56 s and
  ~3.1 GB VRAM Δ, if it holds.
- Done: IS-Net vs BiRefNet on 30 Unsplash photos (above).
- Still to do: time IS-Net WASM and WebGPU on a 4-core laptop with an iGPU.
- Legal: settled for the app. Before any SDK use, get a lawyer's sign-off or DIS5K authors' permission. Optional: confirm
  the `isnet-general-use.pth` licence with its author.
- Report or work around the `storageBufferCacheMode: 'disabled'` crash upstream. With exact buffer release, VRAM
  should approach the ~1.2 GB lower bound.
- Still open from above: DIS5K training-data terms.

## Cross-platform implementation (branch nikigan/bg-remove-mac) — started 2026-10-21
Per `.claude/bg-remove/implementation-brief.md`. Research commits cherry-picked from `origin/nikigan/bg-remove-bench-win`
(7491939^..07351a4; PROGRESS.md/PAPERCUTS.md conflicts resolved by keeping both sides).

Decisions (user, 2026-10-21):
- Hosting: **GitHub release assets on polotno-project/polotno-studio-app** (a dedicated non-semver models release).
- IS-Net is **not bundled**: download on first use, like BiRefNet.

Facts found:
- Production renderer is `file://` and that is load-bearing (Polotno key origin "electron", `src/main/window.ts`), so the
  editor page can't simply be served with COOP/COEP. ORT-web forces `numThreads = 1` when `!crossOriginIsolated`.
- Polotno 4.16.1: `store.setTool('remove-background', { elementId }).run({ options })` reruns the tool from our own UI and
  passes `options` to the handler as the 3rd arg (`request.options`); the result is committed as one undo step. The
  handler gets the element's *current* src, so a retry must carry the original src in `options`.

## Benchmark (macOS) — 2026-10-21
Machine: MacBook Pro, Apple M4 Pro, 48 GB unified memory, macOS 26.6.2. Electron 39 (repo), onnxruntime-web 1.30.0.
Same harness and same 30 Unsplash photos (`BENCH_OUT=out-unsplash`). Models rebuilt here from the README steps;
SHA-256: IS-Net fp16 `ec26ae23…f332`, IS-Net fp32 `10e5e8e0…4984`, BiRefNet chunked fp32 `34b041d6…0fceb`.
Harness additions: macOS `footprint` sampling of the GPU and renderer processes (unified memory: Metal buffers count
in the GPU process's phys_footprint; there's no nvidia-smi), a "median per image" column, and `vision.cjs` (the app's
Swift helper on the same images → `out-unsplash/vision/`).

| case | load ms | 1st infer ms | warm median ms | median per image (30) | GPU proc footprint MB | renderer footprint MB |
|---|---|---|---|---|---|---|
| ORT-web WebGPU native, IS-Net fp16 | 456 | 329 | **114** | 114 | **956** | 785 |
| ORT-web WebGPU native, IS-Net fp32 | 433 | 300 | 156 | 156 | 1,586 | — |
| ORT-web WASM ×(default, isolated) threads, IS-Net fp16 | 175 | 1,657 | 1,634 | 1,632 | 237 | — |
| ORT-web WASM **1 thread** (what a non-isolated page gets), IS-Net fp16 | 225 | 6,678 | **6,590** | 6,247 | 234 | — |
| ORT-web WebGPU native, BiRefNet chunked fp32 (bucket cache) | 1,317 | 2,197 | **1,161** | 1,166 | **6,083** | 1,278 |
| same, `storageBufferCacheMode: 'lazyRelease'` | 1,358 | 1,248 | 1,196 | 1,205 | **4,456** | 1,255 |
| Apple Vision (Swift helper, process per image) | — | — | — | 141 in Vision (160 wall) | — | — |

- No NaN anywhere. Worker `crossOriginIsolated: true` in the harness.
- On the M4 Pro, `lazyRelease` costs almost nothing (1.20 vs 1.16 s) and saves 1.6 GB, so use it.
- BiRefNet is ~1.2 s per image here (RTX 3070: 0.7 s), IS-Net ~0.11 s (RTX 3070: 0.08 s).
- **Unified memory: BiRefNet takes ~4.5 GB of system RAM** with lazyRelease, on top of the app. On an 8 GB Mac that's
  swap or a jetsam kill; don't offer `hq` below 16 GB of RAM on Apple Silicon.
- **WASM single-threaded is 4× slower** (6.6 vs 1.6 s), so the inference context should be cross-origin isolated.

Agreement against BiRefNet (IoU at α≥128):
- IS-Net fp16: median 0.978, 25/30 ≥ 0.9. Outliers potted-plant 0.69, birthday-cake 0.72, wine-glass 0.55, bicycle 0.89,
  bouquet 0.89 — identical to the Windows run, so the Mac WebGPU port is consistent.
- Vision: median 0.981, 27/30 ≥ 0.9. Outliers bicycle 0.55, wine-glass 0.84, bouquet 0.89, group-of-friends 0.92.

Quality by eye (contact sheets original | BiRefNet | IS-Net | Vision, all 30):
| | good | minor flaws | clearly wrong |
|---|---|---|---|
| Vision | 26 | 2 (bouquet: drops the lower leaves, small hole; group: rough feet) | **2** |
| IS-Net fp16 | 21 | 6 | 3 (jacket, pot, cake — as on Windows) |
| BiRefNet chunked fp32 | 28 | 2 | 0 |
- Vision's failures: **bicycle** — both wheels filled solid black (spokes and the gaps kept); **child** — a block of
  the green background stays attached to the hair on the left.
- Vision gets all three IS-Net failures right (solid black jacket, green pot, full cake), and its hair edges are the
  cleanest of the three on the portraits.
- So Vision stays the macOS default, and BiRefNet as a retry fixes exactly the cases where Vision goes wrong.

### Design (2026-10-21)
- **Engines**: `vision` (macOS 14+, Swift helper, unchanged), `standard` (IS-Net fp16), `hq` (BiRefNet chunked fp32).
  Default: vision where available, else standard. hq only on request (retry toast, or the "high quality" setting).
- **Where ONNX runs: a hidden BrowserWindow** on a privileged `polotno-bg://` scheme served by main with COOP/COEP,
  not a worker in the editor page. Why:
  - the editor page must stay `file://` (Polotno key), and without isolation WASM is 1 thread (4× slower, measured);
  - the editor page keeps its cross-origin images/iframes untouched (no COEP there);
  - models load from `userData/models` through the same scheme (no 245 MB over IPC);
  - destroying the window frees the multi-GB GPU memory for sure, and a GPU/renderer crash in hq doesn't touch the editor.
  Page: `src/renderer/background-host.html` (+ worker), preload `src/preload/background-host.ts`; main relays jobs.
  In dev the scheme proxies to the Vite dev server and adds the same headers.
- **hq gate**: WebGPU adapter that isn't a fallback adapter (probed in the editor renderer) and, on macOS (unified
  memory), ≥ 16 GB RAM. Session uses `storageBufferCacheMode: 'lazyRelease'`; the host window is closed right after an
  hq job, and after 60 s idle otherwise.
- **Models**: `src/main/background-models.ts` catalog (file, URL on a GitHub release, SHA-256, size); download on first
  use with `net.fetch` → `.part` file, SHA-256 while streaming, rename; progress events to the renderer; cancel.
- **UX**: after a non-hq result, a toast "Background removed" with "Try high quality". It reruns the tool via
  `store.setTool('remove-background', { elementId }).run({ options: { quality: 'hq', original } })` → separate undo step.
  First hq use (model not downloaded): native confirm explaining ~245 MB download / a few seconds / capable GPU, with a
  checkbox "Always use high quality". The setting also lives in the Edit menu as a checkbox (menu labels are English
  like the rest of the app menu).

### Status (2026-10-21)
- [x] Benchmark on macOS (above)
- [x] Engine abstraction: main dispatcher, hidden COI host window + worker, models download/verify, IPC
- [x] Standard engine (IS-Net) end to end in dev with Vision disabled: WebGPU, 1.1 s cold (load 579, run 343 ms)
- [x] hq retry toast → BiRefNet on the original → separate undo step (undo: hq → standard → original); 4.2 s cold
- [x] Vision → toast on macOS (fresh profile); click → native confirm dialog renders (RU: message, detail, checkbox
  "Всегда использовать высокое качество", Отмена/Скачать). Pressing its buttons wasn't automated (native sheet).
- [x] Cancel during an hq run → `canceled`, host page closed. No-subject: flat gray (kept 0%) and noise. IS-Net's
  min-max turned noise into a fake cutout, so a raw-max < 0.5 check was added (photos: max ≈ 1.000 on all 30;
  gray 0.044, noise 0.060).
- [x] WASM fallback (`--disable-gpu`): "No available adapters" → wasm, 1.64 s per image (threaded; 1 thread was 6.6 s),
  no hq toast.
- [x] Toast duration 10 s (sonner's 4 s default expired before one could judge the result).
- [x] scripts/background-models/ (build.sh + README with `gh release create` steps), THIRD_PARTY_NOTICES.md (shipped via
  extraResources), CHANGELOG
- [x] Packaged build (see below)

Dev-mode gotchas (fixed): the scheme proxy to Vite must keep the query string (`?worker_file`, `?import&url`) and
forward only `Accept` (forwarding every request header makes `net.fetch` fail; a conditional request gets a 304 that
can't be wrapped in a Response). Vite's HMR client can't connect from the scheme (harmless, filtered from the log).
On macOS, kill the dev Electron with -9: SIGTERM closes the window but the app stays (and keeps the single-instance
lock and the debug port).

### Packaged build (2026-10-21)
- Bug found only in the packaged build: Vite bundles onnxruntime into the worker chunk, and ORT starts its WASM threads
  from `import.meta.url` (that same chunk, `name: "em-pthread"`), so our top-level `self.onmessage` hijacked the thread
  workers and every job hung until the 180 s timeout (dev was fine: ORT was a separate module there). Fixed by not
  installing our handler when `self.name` starts with `em-pthread`.
- `electron-builder --dir` (arm64, Apple Development signing): app.asar has `out/renderer/background-host.html`, the
  worker chunk and the 27 MB `ort-wasm-simd-threaded.asyncify.wasm`; `Resources/THIRD_PARTY_NOTICES.md` present.
- Packaged, Vision off, models from a local `file://` folder: download 88 MB → standard 1.1 s (load 511, run 351 ms)
  → toast → High quality → hq 3.7 s (load 1349, run 2251) → host page closed → undo hq → undo standard → original.
- Packaged `--disable-gpu`: WASM, threaded, 1.7 s per image. `quality: high` setting: hq directly, no toast; back to
  standard: Vision + toast.
- `scripts/background-models/build.sh` reproduces both models byte for byte on this Mac (same SHA-256 as the catalog);
  release-ready files were built into the session scratchpad (`mbuild/out`).

### Handback: Windows / Linux checks (for the RTX 3070 PC and a Linux box)
Run with `POLOTNO_BACKGROUND_MODELS_URL=file:///<folder with the two .onnx>` until the release exists.
1. Windows, dev and packaged (`npm run build:unpack`): Remove background on a photo → first-use download toast with
   progress and Cancel → cutout. Log: `%APPDATA%\polotno-app\logs\remove-background.log` should say `standard: done …
   webgpu`.
2. Toast → High quality → native confirm (checkbox) → 245 MB download → hq result; then undo twice.
3. Task Manager GPU memory: it should drop back after the hq job (the hidden page is closed right after hq).
4. `--disable-gpu`: WASM path, check the time per image (threads: page must report `crossOriginIsolated`), and that no
   High quality toast appears.
5. Cancel during the download and during an hq run; then run again (fresh page).
6. File menu: "Precise Background Removal" appears once a remove-background ran (the renderer reports WebGPU), and
   toggling it switches engines.
7. Low-VRAM / integrated GPU if available: hq either works or ends with "Not enough GPU memory for high quality" (we map
   ORT/Dawn out-of-memory errors, device loss and a GPU-process crash to that message) — not reproduced on the Mac.
8. Linux: Electron's WebGPU may be off by default there → expect WASM for standard and no hq offer. Check the AppImage
   and a .deb: the host page loads from app.asar over `polotno-bg://`, and the sandbox doesn't block the worker threads.
9. Windows closing behaviour: with the hidden page alive (within 60 s of a standard run), closing the editor must still
   quit the app (the editor's `closed` closes the page).

### 2026-10-21: renamed "high quality" to "precise"
User-facing name of the BiRefNet mode is now "precise" ("точный режим"): toast button _Try precise_, menu item
_File → Precise Background Removal_ (moved from Edit at the user's request) with the SF Symbol `person.and.background.dotted` as its icon (macOS only; Electron
39 renders symbols at 30 pt 1x, so menu.ts adds a 2x copy and makes it a template). Code keeps `hq` as the identifier.
The toggle lives in the File menu (no Settings window exists).
