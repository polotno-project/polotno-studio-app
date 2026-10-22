"""Rewrite a BiRefNet ONNX export so onnxruntime-web's WebGPU EP can run it, keeping fp32.

Same recipe as runes/birefnet-lite-webgpu (which only ships fp16):
  1. ORT BASIC offline optimization (constant folding) on CPU.
  2. Concat / Split with more than MAX_FAN inputs / outputs -> cascades of <= MAX_FAN.
  3. Variadic Sum -> chain of Add.

usage: python -I patch_webgpu.py models/model.onnx models/birefnet_lite_webgpu_fp32.onnx
"""
import sys

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, numpy_helper

MAX_FAN = 6


def optimize_basic(src, dst):
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    so.optimized_model_filepath = dst
    so.log_severity_level = 3
    ort.InferenceSession(src, so, providers=['CPUExecutionProvider'])


def chunks(xs, n):
    return [xs[i:i + n] for i in range(0, len(xs), n)]


def rewrite(model):
    g = model.graph
    inits = {i.name: i for i in g.initializer}
    out_nodes = []
    counter = [0]

    def fresh(base):
        counter[0] += 1
        return f'{base}__wg{counter[0]}'

    def concat(inputs, output, axis, name):
        # emit a tree of Concats with <= MAX_FAN inputs each
        while len(inputs) > MAX_FAN:
            nxt = []
            for grp in chunks(inputs, MAX_FAN):
                if len(grp) == 1:
                    nxt.append(grp[0])
                    continue
                o = fresh(output)
                out_nodes.append(helper.make_node('Concat', grp, [o], name=fresh(name), axis=axis))
                nxt.append(o)
            inputs = nxt
        out_nodes.append(helper.make_node('Concat', inputs, [output], name=name, axis=axis))

    def split(inp, sizes, outputs, axis, name):
        if len(outputs) <= MAX_FAN:
            s = fresh(name + '_sizes')
            g.initializer.append(numpy_helper.from_array(np.array(sizes, dtype=np.int64), s))
            out_nodes.append(helper.make_node('Split', [inp, s], outputs, name=name, axis=axis))
            return
        groups = chunks(list(range(len(outputs))), int(np.ceil(len(outputs) / MAX_FAN)))
        if len(groups) > MAX_FAN:  # keep the first level within the cap too
            groups = chunks(list(range(len(outputs))), int(np.ceil(len(outputs) / MAX_FAN)) + 1)
        mids, mid_sizes = [], []
        for grp in groups:
            mid_sizes.append(int(sum(sizes[i] for i in grp)))
            mids.append(outputs[grp[0]] if len(grp) == 1 else fresh(name))
        split(inp, mid_sizes, mids, axis, fresh(name))
        for grp, mid in zip(groups, mids):
            if len(grp) > 1:
                split(mid, [sizes[i] for i in grp], [outputs[i] for i in grp], axis, fresh(name))

    stats = {'Concat': 0, 'Split': 0, 'Sum': 0}
    for n in g.node:
        attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
        if n.op_type == 'Concat' and len(n.input) > MAX_FAN:
            stats['Concat'] += 1
            concat(list(n.input), n.output[0], attrs['axis'], n.name)
        elif n.op_type == 'Split' and len(n.output) > MAX_FAN:
            stats['Split'] += 1
            assert len(n.input) == 2 and n.input[1] in inits, f'split sizes not constant: {n.name}'
            sizes = [int(x) for x in numpy_helper.to_array(inits[n.input[1]])]
            split(n.input[0], sizes, list(n.output), attrs.get('axis', 0), n.name)
        elif n.op_type == 'Sum' and len(n.input) > 1:
            stats['Sum'] += 1
            acc = n.input[0]
            for i, x in enumerate(n.input[1:]):
                o = n.output[0] if i == len(n.input) - 2 else fresh(n.output[0])
                out_nodes.append(helper.make_node('Add', [acc, x], [o], name=fresh(n.name)))
                acc = o
        else:
            out_nodes.append(n)
    del g.node[:]
    g.node.extend(out_nodes)
    return stats


def main(src, dst):
    tmp = dst + '.opt.onnx'
    optimize_basic(src, tmp)
    model = onnx.load(tmp)
    before = len(model.graph.node)
    stats = rewrite(model)
    onnx.checker.check_model(model)
    onnx.save(model, dst)
    fan = max(max(len(n.input), len(n.output)) for n in model.graph.node if n.op_type in ('Concat', 'Split'))
    print(f'nodes {before} -> {len(model.graph.node)}, rewritten {stats}, max Concat/Split fan {fan}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
