# Background removal models

The app downloads two ONNX models on first use (`src/main/background-models.ts`) and runs them with onnxruntime-web
(`src/renderer/src/background-host/`):

| file | model | used for | size |
|---|---|---|---|
| `isnet-general-use-fp16.onnx` | IS-Net (github.com/xuebinqin/DIS), fp16 weights | standard, where Apple Vision isn't available | 88 MB |
| `birefnet-lite-webgpu-fp32.onnx` | BiRefNet_lite (MIT), WebGPU-patched, fp32 | high quality, on request | 245 MB |

Licences and citations are in `THIRD_PARTY_NOTICES.md`. Never use IMG.LY's files, `onnx-community/ISNet-ONNX` (AGPL) or
BRIA RMBG (non-commercial). Research and benchmarks: `.claude/bg-remove/PROGRESS.md`.

## Build

```sh
scripts/background-models/build.sh /tmp/background-models
```

It creates a Python venv, downloads the IS-Net weights and BiRefNet_lite's ONNX export, converts them and prints each
file's size and SHA-256.
- IS-Net: `export_isnet.py` (opset 17, fixed 1×3×1024×1024, output `sigmoid(d1)`), then `to_fp16.py`.
- BiRefNet: `deform_chunk.py` splits each deformable conv per kernel row (4 GB → 0.9 GB of activations, 2× faster on
  WebGPU), then `patch_webgpu.py` caps Concat/Split fan-out at 6 and turns Sum into Add (WebGPU allows 10 storage buffers
  per shader).

Rebuilt files may differ byte for byte (torch/onnx versions), so the app pins the SHA-256 of the files that were
uploaded.

## Publish

The models live as assets of a dedicated release on this repository, tag `background-models-v1`. Its tag isn't
semver, so electron-updater never takes it for an app update; mark it as a pre-release anyway so it never shows as
"Latest".

```sh
gh release create background-models-v1 --prerelease --title "Background removal models v1" \
  --notes "Models the app downloads for background removal. See THIRD_PARTY_NOTICES.md." \
  /tmp/background-models/isnet-general-use-fp16.onnx \
  /tmp/background-models/birefnet-lite-webgpu-fp32.onnx \
  /tmp/background-models/THIRD_PARTY_NOTICES.md
```

Then put each file's size and SHA-256 into `MODELS` in `src/main/background-models.ts`. To publish a new version, use a
new tag (`background-models-v2`) and update `RELEASE_URL`, so installed apps keep finding the files they pin.

To try downloads before a release exists, point the app at a local folder:
`POLOTNO_BACKGROUND_MODELS_URL=file:///tmp/background-models npm run dev`.
