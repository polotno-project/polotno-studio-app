"""ONNX fp32 -> fp16 weights with fp32 input/output, numerically sensitive ops kept in fp32.

Used for IS-Net. (BiRefNet ships in fp32: in fp16 ORT-web's WebGPU convolutions overflow to NaN on some photos.)

usage: python -I to_fp16.py isnet_fp32.onnx isnet-general-use-fp16.onnx
"""
import sys

import onnx
from onnxconverter_common import float16

BLOCK = ['LayerNormalization', 'Softmax', 'ReduceMean', 'Pow', 'Sqrt', 'Div', 'Erf', 'Exp', 'Sigmoid']

model = onnx.load(sys.argv[1])
model = float16.convert_float_to_float16(model, keep_io_types=True, op_block_list=BLOCK)
onnx.save(model, sys.argv[2])
