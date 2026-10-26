Benchmark BiRefNet_lite background removal inside the Polotno desktop app (Electron 39) on this Windows PC. This is a measurement spike, not a shipping feature.

Context: background-removal research is committed on branch nikigan/bg-remove (commit ad285be + c92a8db). Run `git fetch` and then `git cherry-pick ad285be` (if the commit is missing, fetch nikigan/bg-remove from origin, or ask). Read .claude/bg-remove/PROGRESS.md first. Never use IMG.LY libraries (competitor), never use onnx-community/ISNet-ONNX (AGPL) or BRIA RMBG (non-commercial).

Model: onnx-community/BiRefNet_lite-ONNX on Hugging Face (MIT). onnx/model_fp16.onnx (114.5 MB) and onnx/model.onnx (224 MB, fp32). Input 1024x1024.
Known risk: onnxruntime-web's WebGPU backend reportedly fails on the stock BiRefNet export (microsoft/onnxruntime#21968, closed as stale but reported still broken in 2026-06). Community graph-patch workarounds exist (e.g. runes/birefnet-lite-webgpu on HF). Check their licenses before use.

Measure, inside an Electron 39 renderer (a Web Worker in the dev app or a throwaway BrowserWindow is fine):
1. onnxruntime-web on WebGPU: stock fp16 and fp32. If they fail, record the exact error, then try a patched export.
2. onnxruntime-web on WASM (multi-threaded if cross-origin isolation is available; note whether it is), fp16/fp32.
3. Optional: transformers.js (@huggingface/transformers) `background-removal` pipeline with the same model, device 'webgpu' vs 'wasm'.
4. Optional: onnxruntime-node with the DirectML EP, run from the main process.
For each case record: model load time, first inference, warm inference (median of 5), peak memory, and whether the output is correct (save the cutout PNGs). Use 3–4 test images: portrait with hair, animal, product, busy scene.
Also record the machine: CPU, GPU and driver, RAM, Windows build, and what `navigator.gpu.requestAdapter()` reports.

Deliverable: a results table plus a recommendation (which runtime/precision to ship, and whether WebGPU works without patching). Append it to .claude/bg-remove/PROGRESS.md under "## BiRefNet benchmark (Windows)". Commit on this worktree's branch. Do not push or open a PR without asking. Do not add the benchmark harness to the shipping app code; keep it under scripts/ or .claude/bg-remove/bench/.

Rules: fetch current docs (onnxruntime.ai docs, HF model cards, transformers.js docs) rather than relying on memory. Follow repo CLAUDE.md / AGENTS.md.
