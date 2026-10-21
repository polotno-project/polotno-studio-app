#!/usr/bin/env bash
# Builds the two background removal models the app downloads
# (src/main/background-models.ts) into <out dir>:
#   isnet-general-use-fp16.onnx     IS-Net, the standard model
#   birefnet-lite-webgpu-fp32.onnx  BiRefNet_lite, the high-quality model
# Needs python3, git and curl. Creates a venv and downloads ~1 GB (torch, the
# weights) into <work dir>. See README.md here.
#
# usage: scripts/background-models/build.sh <out dir> [work dir]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "$1" && cd "$1" && pwd)"
work="$(mkdir -p "${2:-$out/work}" && cd "${2:-$out/work}" && pwd)"
py="$work/venv/bin/python"

[ -x "$py" ] || python3 -m venv "$work/venv"
"$work/venv/bin/pip" install -q onnx onnxruntime onnxconverter-common numpy sympy gdown
"$work/venv/bin/pip" install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu

# IS-Net: the authors' code (Apache-2.0) and general-use weights, linked from
# their README. Never IMG.LY's or onnx-community's ISNet-ONNX conversions.
[ -d "$work/DIS" ] || git clone -q --depth 1 https://github.com/xuebinqin/DIS "$work/DIS"
[ -f "$work/isnet-general-use.pth" ] ||
  "$work/venv/bin/gdown" -q -O "$work/isnet-general-use.pth" \
    "https://drive.google.com/uc?id=1XHIzgTzY5BQHw140EDIgwIb53K659ENH"
"$py" "$here/export_isnet.py" "$work/DIS/IS-Net" "$work/isnet-general-use.pth" "$work/isnet_fp32.onnx"
"$py" -I "$here/to_fp16.py" "$work/isnet_fp32.onnx" "$out/isnet-general-use-fp16.onnx"

# BiRefNet_lite (MIT): onnx-community's fp32 export, deformable convs chunked,
# then patched for WebGPU's storage buffer limit.
[ -f "$work/birefnet_lite.onnx" ] ||
  curl -sSL -o "$work/birefnet_lite.onnx" \
    https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx
"$py" -I "$here/deform_chunk.py" "$work/birefnet_lite.onnx" "$work/birefnet_lite_chunked.onnx"
"$py" -I "$here/patch_webgpu.py" "$work/birefnet_lite_chunked.onnx" "$out/birefnet-lite-webgpu-fp32.onnx"
rm -f "$out/birefnet-lite-webgpu-fp32.onnx.opt.onnx"

cp "$here/../../THIRD_PARTY_NOTICES.md" "$out/"
cd "$out"
for f in isnet-general-use-fp16.onnx birefnet-lite-webgpu-fp32.onnx; do
  echo "$f  $(wc -c < "$f" | tr -d ' ') bytes  sha256 $(shasum -a 256 "$f" | cut -d' ' -f1)"
done
