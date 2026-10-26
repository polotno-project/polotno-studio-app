"""Static activation-memory profile of an ONNX graph at a fixed input size.
usage: python -I mem_profile.py model.onnx [H]
"""
import sys
from collections import defaultdict

import numpy as np
import onnx
from onnx import shape_inference

path = sys.argv[1]
H = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
m = onnx.load(path)
inp = m.graph.input[0]
for d, v in zip(inp.type.tensor_type.shape.dim, [1, 3, H, H]):
    d.ClearField('dim_param')
    d.dim_value = v
m = shape_inference.infer_shapes(m, data_prop=True)
g = m.graph
inits = {i.name for i in g.initializer}
weight_bytes = sum(int(np.prod(i.dims)) * (2 if i.data_type == 10 else 4) for i in g.initializer)

size = {}
for vi in list(g.value_info) + list(g.output) + list(g.input):
    t = vi.type.tensor_type
    dims = [d.dim_value for d in t.shape.dim]
    if dims and all(x > 0 for x in dims):
        size[vi.name] = int(np.prod(dims)) * (2 if t.elem_type == 10 else 4), dims

producer = {}
last_use = {}
for i, n in enumerate(g.node):
    for o in n.output:
        producer[o] = (i, n)
    for x in n.input:
        last_use[x] = i
for o in g.output:
    last_use[o.name] = len(g.node)

# liveness sweep in file (topological) order = lower bound with perfect buffer reuse
live = 0
peak = 0
peak_at = None
frees = defaultdict(list)
for name, li in last_use.items():
    if name in size and name not in inits:
        frees[li].append(name)
unknown = 0
for i, n in enumerate(g.node):
    for o in n.output:
        if o in size:
            live += size[o][0]
        elif o:
            unknown += 1
    if live > peak:
        peak, peak_at = live, (i, n.op_type, n.name)
    for x in frees[i]:
        live -= size[x][0]

total = sum(s for k, (s, _) in size.items() if k not in inits)
print(f'{path} @ {H}x{H}')
print(f'weights {weight_bytes/2**20:.0f} MB, nodes {len(g.node)}, tensors w/o shape {unknown}')
print(f'sum of all activations {total/2**30:.2f} GB, peak live (perfect reuse) {peak/2**30:.2f} GB at node {peak_at}')
print('largest tensors:')
by_op = defaultdict(int)
for k, (s, dims) in size.items():
    if k in producer:
        by_op[producer[k][1].op_type] += s
for k, (s, dims) in sorted(size.items(), key=lambda kv: -kv[1][0])[:15]:
    op = producer[k][1].op_type if k in producer else '?'
    print(f'  {s/2**20:7.0f} MB  {op:12s} {dims}  {k[:70]}')
print('activation bytes by producing op:')
for op, s in sorted(by_op.items(), key=lambda kv: -kv[1])[:12]:
    print(f'  {s/2**30:6.2f} GB  {op}')
