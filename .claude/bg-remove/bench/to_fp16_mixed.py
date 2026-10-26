"""fp32 WebGPU-patched BiRefNet -> fp16 with fp32 I/O and numerically sensitive ops kept in fp32.

usage: python -I to_fp16_mixed.py models/birefnet_lite_webgpu_fp32.onnx models/birefnet_lite_webgpu_fp16mixed.onnx
"""
import sys

import onnx
from onnxconverter_common import float16

import os
BLOCK = os.environ.get('EXTRA_BLOCK', '').split(',') if os.environ.get('EXTRA_BLOCK') else []
BLOCK += ['LayerNormalization', 'Softmax', 'ReduceMean', 'Pow', 'Sqrt', 'Div', 'Erf', 'Exp', 'Sigmoid']

model = onnx.load(sys.argv[1])
model = float16.convert_float_to_float16(model, keep_io_types=True, op_block_list=BLOCK)
onnx.save(model, sys.argv[2])
