# Background-removal benchmark harness

This is a research harness, not app code. Results live in `../PROGRESS.md`. Models, images and outputs are gitignored,
so rebuild them with the steps below.

## Setup
```sh
cd .claude/bg-remove/bench
npm ci                                   # onnxruntime-web/-node, transformers.js; electron comes from the repo root
python3 -m venv /tmp/bfv                 # on Windows keep the venv path short (pip long-path limit)
/tmp/bfv/bin/pip install onnx onnxruntime onnxconverter-common numpy sympy gdown
/tmp/bfv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # IS-Net export only
```

## Models (into `models/`)
BiRefNet_lite (MIT):
```sh
curl -L -o models/model.onnx      https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx
curl -L -o models/model_fp16.onnx https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx
# ship candidate: chunk the deformable convs, then cap Concat/Split fan-out for WebGPU
/tmp/bfv/bin/python -I deform_chunk.py models/model.onnx models/model_chunked.onnx
/tmp/bfv/bin/python -I patch_webgpu.py models/model_chunked.onnx models/birefnet_lite_webgpu_fp32_chunked.onnx
# older variants used in PROGRESS.md: patch_webgpu.py on model.onnx -> birefnet_lite_webgpu_fp32.onnx;
# to_fp16_mixed.py on either -> *_fp16mixed*.onnx (the portrait gives NaN on WebGPU)
```
IS-Net (Apache-2.0 code; the weights have no licence of their own, see PROGRESS.md "Licensing facts"). Do **not** use
IMG.LY's files or onnx-community/ISNet-ONNX.
```sh
git clone --depth 1 https://github.com/xuebinqin/DIS /tmp/dis
/tmp/bfv/bin/gdown -O /tmp/isnet-general-use.pth "https://drive.google.com/uc?id=1XHIzgTzY5BQHw140EDIgwIb53K659ENH"
/tmp/bfv/bin/python export_isnet.py /tmp/dis/IS-Net /tmp/isnet-general-use.pth models/isnet_fp32.onnx
/tmp/bfv/bin/python -I to_fp16_mixed.py models/isnet_fp32.onnx models/isnet_fp16.onnx
```

## Images
`node fetch_unsplash.mjs` downloads the 30-photo Unsplash set (via Polotno's proxy, `unsplash-manifest.json`) into
`images/` and prints its `BENCH_ORDER`. The original 4 Wikimedia images (portrait, dog, product, busy) aren't
reproducible. Use the Unsplash set.

## Run
```sh
export BENCH_ORDER=$(node -e "console.log(require('./unsplash-manifest.json').map(m=>m.name).join(','))")
export BENCH_OUT=out-unsplash
node run.mjs ort-webgpu-native-chunked32 ort-webgpu-native-isnet16 ort-wasm-isnet16   # one Electron per case
REF=ort-webgpu-native-chunked32 node compare.mjs                                       # table vs a reference case
```
- Case ids follow `<runtime>-<backend>-<model>`, for example `ort-webgpu-native-isnet16`, `ort-wasm-chunked32`,
  `node-cpu-isnet32` or `node-dml-…` (Windows only). Model keys are in `main.cjs` `MODELS`.
- Outputs go to `<BENCH_OUT>/<case>/`: `result.json` (timings, memory, NaN counts), cutout `.png` and raw `.alpha` files.
- `BENCH_SESSION='{"sessionOptions":{…}}'` passes ORT session options, for example
  `{"executionProviders":[{"name":"webgpu","storageBufferCacheMode":"lazyRelease"}]}`. `{"numThreads":8}` sets WASM
  threads.
- `mem_profile.py <model.onnx>` gives a model's static activation-memory lower bound.
- VRAM is sampled with `nvidia-smi` only, so other GPUs show none. On macOS, memory is working-set size.
