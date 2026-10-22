# Brief: cross-platform background removal + optional high-quality model

You're in the `bg-remove-mac` workspace (branch `nikigan/bg-remove-mac`). It already ships Remove background on
macOS 14+ through Apple Vision (`src/main/remove-background.ts`, `native/remove-background/`,
`src/renderer/src/editor/ai-image-tools.ts`); elsewhere the entry is hidden. The Windows research is on
`origin/nikigan/bg-remove-bench-win`.

## First
1. Bring in the research.
   - `git fetch origin nikigan/bg-remove-bench-win`
   - `git cherry-pick 7491939^..origin/nikigan/bg-remove-bench-win`
   - Skip `a1f3478`: it is the research commit `ad285be`, which this branch already has as `92ab3eb`.
   - The range touches only `.claude/bg-remove/**` and `PAPERCUTS.md` appends. On a conflict in `PROGRESS.md` or
     `PAPERCUTS.md`, keep both sides.
2. Read `.claude/bg-remove/PROGRESS.md`, especially these sections:
   - "BiRefNet benchmark (Windows)"
   - "Deformable-conv chunking"
   - "IS-Net, our own conversion"
   - "IS-Net vs BiRefNet on 30 Unsplash photos"
   - "Recommendation"
   - "Licensing facts"
3. Read `.claude/bg-remove/bench/README.md` for the harness.
4. Follow CLAUDE.md / AGENTS.md. Fetch current docs (Polotno: https://polotno.com/llms.txt; onnxruntime-web; Electron)
   rather than relying on memory.

## What we know (Windows, RTX 3070)
| model (ORT-web native WebGPU) | size | per image | VRAM | quality on 30 Unsplash photos |
|---|---|---|---|---|
| IS-Net fp16 (own export) | 88 MB | ~80 ms (WASM: 1.7–3.2 s) | ~0.8 GB | 21 good, 6 minor, **3 wrong** |
| BiRefNet_lite chunked fp32 | 245 MB | ~0.7 s (WASM: ~10.5 s, too slow) | 4.2–5.5 GB | 28 good, 2 minor, 0 wrong |

- IS-Net fails on large, uniform subject areas that are close to the background colour: a black jacket, a green pot on a
  dark wall, a cake body.
- BiRefNet fp16 gives NaN on some photos. Don't ship it.
- BiRefNet uses a lot of VRAM: integrated GPUs and 4 GB cards are untested.

## Goal
1. **Standard engine everywhere Vision isn't available** (Windows, Linux, macOS < 14): IS-Net fp16 through
   onnxruntime-web in a Web Worker. Use the native WebGPU EP (`onnxruntime-web/webgpu`) and fall back to WASM.
2. **Optional heavier "high quality" engine on every platform, macOS included**: BiRefNet_lite chunked fp32 on WebGPU.
   It's for when the standard result is bad. Never run it by default.

## Design
- **Engines**: `vision` (macOS 14+, current code), `standard` (IS-Net) and `hq` (BiRefNet). The default is `vision` where
  available, otherwise `standard`.
  - `hq` needs WebGPU: `navigator.gpu.requestAdapter()` must return an adapter that is not a fallback adapter. Without
    it, hide the option. WASM at ~10 s and ~3 GB of RAM isn't acceptable.
- **Where it runs**: a dedicated worker in the renderer. Check whether the app's renderer is cross-origin isolated
  (`crossOriginIsolated`).
  - Without isolation, WASM runs single-threaded and is slower. Measure it, and decide whether COOP/COEP headers are
    worth it. They can break cross-origin images and iframes in the editor, so test.
  - Keep the main-process Vision path as is.
- **Models aren't bundled.** Download on first use into `userData/models/` with a SHA-256 check, a progress UI and
  cancel.
  - IS-Net is ~88 MB. Bundling it is an option if app size allows: ask the user.
  - Hosting is a decision for the user: GitHub release assets on this repo, or a Polotno CDN. Ask them, and don't
    invent a URL.
  - The models are reproducible with `bench/` scripts (`export_isnet.py` + `to_fp16_mixed.py`;
    `deform_chunk.py` + `patch_webgpu.py`). Move whatever the build needs into `scripts/`. The harness stays research
    only.
- **Pre/post-processing**: squish-resize to 1024², then normalize. Then scale the mask back to the original size and
  apply it as alpha.
  - IS-Net: RGB/255 − 0.5 (std 1); the output is a sigmoid, min-max normalized per image.
  - BiRefNet: ImageNet mean/std; the output is logits, so apply a sigmoid.
  - Reference implementation: `bench/worker.mjs`.
- **Robustness**:
  - Treat any NaN in the output as a failure.
  - Catch WebGPU device-lost and out-of-memory errors, and say e.g. "Not enough GPU memory for high quality".
  - For `hq`, use `storageBufferCacheMode: 'lazyRelease'` (4.2 vs 5.5 GB VRAM, ~20% slower) and release the session
    after each job, or after a short idle. That frees the multi-GB VRAM.
  - Keep the `RemoveBackgroundResult` states. Add `noSubject` for an empty mask, using an alpha-coverage threshold like
    Vision's.

## "High quality" UX (the user asked for this: a heavier model when the result is bad)
Polotno calls our `setRemoveBackgroundFunc(src, signal)`. Check Polotno's docs and source for what the built-in
Remove background UI exposes: progress, extra menu entries, post-result actions. Then pick the least intrusive option:
1. **After a result, offer "Not right? Try high quality"** (a toast or inline action). It reruns on the *original*
   image, which our function received as `src`, so remember result → original. It replaces the element's src, and
   undo must restore the previous state.
   - The first use explains the cost: a one-time ~245 MB download, takes a few seconds, needs a capable GPU.
2. **Setting "Background removal quality: Standard / High"**, so users who always want `hq` can pick it.
3. A second menu entry "Remove background (high quality)", but only if Polotno supports custom entries cleanly.

Recommended: 1 plus 2. On macOS, the retry runs BiRefNet against the Vision result. Measure on Apple Silicon first:
unified memory makes 4–5 GB risky on 8 GB Macs.

## Steps
1. **Benchmark on this Mac before building**, with the bench harness (README).
   - Run `ort-webgpu-native-isnet16`, `ort-wasm-isnet16`, `ort-webgpu-native-chunked32` and
     `ort-webgpu-native-isnet32` on the Unsplash set.
   - Add a Vision run on the same 30 images if cheap, to compare quality against both models.
   - Record timings, memory and a quality review in PROGRESS.md under "## Benchmark (macOS)".
2. Engine abstraction and IPC/worker plumbing; standard engine on non-Vision platforms.
3. Model download, cache and verify; settings.
4. High-quality retry UX.
5. i18n (en, ru) for all new strings; CHANGELOG entry.
6. Third-party notices: the licence and citation for each shipped model (see PROGRESS.md "Licensing facts").
7. Note anything Windows/Linux-specific to verify, and hand it back. The Windows PC (RTX 3070) can run the Windows
   checks.

## Constraints
- Never use IMG.LY libraries or files (competitor), `onnx-community/ISNet-ONNX` (AGPL) or BRIA RMBG (non-commercial).
- App only. Don't add this to the Polotno SDK: licensing for commercial/SDK use needs a separate review first.
- Keep research code out of shipping code.
- Update PROGRESS.md as you go.
- Commit freely. **Don't push or open a PR without asking.**
