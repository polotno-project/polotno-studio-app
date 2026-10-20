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
