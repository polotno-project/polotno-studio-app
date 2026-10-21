"""Chunk BiRefNet's exported deformable convs so their sampled tensors stay small.

The export spells each DeformConv (kernel kh x kw, C in, O out, H x W) as: 4 bilinear-corner GatherNDs of
[1,1,kh*kw*H*W,C], weighted Sum, modulator Mul, then Reshape/Transpose to [1,C,H*kh,W*kw] and one Conv with
stride (kh,kw). At 1024^2 the largest layer makes 784 MB tensors. That Conv equals the sum over kernel rows r
of Conv(W[:,:,r:r+1,:], stride (1,kw)) applied to row r's samples only, so we emit one small sampling + Conv
per kernel row and accumulate with Add. Output is mathematically identical (summation order aside).

usage: python -I deform_chunk.py models/model.onnx models/model_chunked.onnx   (run before patch_webgpu.py)
"""
import sys
from collections import defaultdict

import numpy as np
import onnx
from onnx import helper, numpy_helper


def main(src, dst):
    m = onnx.load(src)
    g = m.graph
    prod = {o: n for n in g.node for o in n.output}
    cons = defaultdict(list)
    for n in g.node:
        for x in n.input:
            cons[x].append(n)
    inits = {i.name: i for i in g.initializer}

    def const(name):
        if name in inits:
            return numpy_helper.to_array(inits[name])
        n = prod.get(name)
        if n is not None and n.op_type == 'Constant':
            return numpy_helper.to_array(n.attribute[0].t)
        raise KeyError(name)

    def attrs(n):
        return {a.name: helper.get_attribute_value(a) for a in n.attribute}

    def src_of(name, op):
        n = prod.get(name)
        assert n is not None and n.op_type == op, f'{name}: expected {op}, got {n and n.op_type}'
        return n

    new_init = []
    counter = [0]

    def fresh(base):
        counter[0] += 1
        return f'{base}__dc{counter[0]}'

    def c64(vals, base):
        name = fresh(base + '_c')
        new_init.append(numpy_helper.from_array(np.array(vals, dtype=np.int64), name))
        return name

    replaced = {}  # conv node name -> list of new nodes
    for conv in g.node:
        if conv.op_type != 'Conv' or len(conv.input) != 2:
            continue
        a = attrs(conv)
        ks = a.get('kernel_shape')
        if not ks or list(a.get('strides', [1, 1])) != list(ks) or ks == [1, 1]:
            continue
        r20 = prod.get(conv.input[0])
        if r20 is None or r20.op_type != 'Reshape':
            continue
        t8 = prod.get(r20.input[0])
        r19 = t8 and prod.get(t8.input[0])
        mul9 = r19 and prod.get(r19.input[0])
        if not (t8 and t8.op_type == 'Transpose' and r19 and r19.op_type == 'Reshape' and mul9 and mul9.op_type == 'Mul'):
            continue
        p = [prod.get(x) for x in mul9.input]
        si = 0 if p[0] is not None and p[0].op_type == 'Sum' else 1
        ssum, mod = p[si], mul9.input[1 - si]
        assert ssum.op_type == 'Sum' and len(ssum.input) == 4, conv.name
        _, C, kh, kw, H, W = [int(x) for x in const(r19.input[1])]
        assert [kh, kw] == list(ks) and attrs(t8)['perm'] == [0, 1, 4, 2, 5, 3], conv.name
        weight = const(conv.input[1])
        O = weight.shape[0]
        K, HW = kh * kw, H * W

        corners = []  # (corner weight [1,1,1,K,H,W], data [1,1,Hp,Wp,C], y idx [1,1,K,1,H,W], x idx [1,1,K,1,H,W])
        for s in ssum.input:
            mul = src_of(s, 'Mul')
            q = [prod.get(x) for x in mul.input]
            sj = 0 if q[0] is not None and q[0].op_type == 'Reshape' and prod.get(q[0].input[0]).op_type == 'Transpose' \
                and prod.get(prod.get(q[0].input[0]).input[0]).op_type == 'GatherND' else 1
            gnd = src_of(src_of(q[sj].input[0], 'Transpose').input[0], 'GatherND')
            assert attrs(gnd).get('batch_dims') == 2, gnd.name
            cat = src_of(gnd.input[1], 'Concat')
            yi, xi = [src_of(x, 'Reshape').input[0] for x in cat.input]
            corners.append((mul.input[1 - sj], gnd.input[0], yi, xi))

        nodes = []
        acc = None
        bias_name = conv.output[0]
        for r in range(kh):
            lo, hi = c64([r * kw], 'lo'), c64([(r + 1) * kw], 'hi')
            terms = []
            for cw, data, yi, xi in corners:
                idx = []
                for t in (yi, xi):
                    sl = fresh(t + '_sl')
                    nodes.append(helper.make_node('Slice', [t, lo, hi, c64([2], 'ax')], [sl], name=fresh(conv.name + '_sl')))
                    rs = fresh(t + '_rs')
                    nodes.append(helper.make_node('Reshape', [sl, c64([1, 1, kw * HW, 1], 'sh')], [rs], name=fresh(conv.name + '_rs')))
                    idx.append(rs)
                ic = fresh(conv.name + '_idx')
                nodes.append(helper.make_node('Concat', idx, [ic], name=fresh(conv.name + '_cat'), axis=3))
                go = fresh(conv.name + '_g')
                nodes.append(helper.make_node('GatherND', [data, ic], [go], name=fresh(conv.name + '_gnd'), batch_dims=2))
                to = fresh(conv.name + '_t')
                nodes.append(helper.make_node('Transpose', [go], [to], name=fresh(conv.name + '_tr'), perm=[0, 1, 3, 2]))
                ro = fresh(conv.name + '_r')
                nodes.append(helper.make_node('Reshape', [to, c64([1, 1, C, kw, H, W], 'sh')], [ro], name=fresh(conv.name + '_rs')))
                ws = fresh(conv.name + '_w')
                nodes.append(helper.make_node('Slice', [cw, lo, hi, c64([3], 'ax')], [ws], name=fresh(conv.name + '_sl')))
                mo = fresh(conv.name + '_m')
                nodes.append(helper.make_node('Mul', [ro, ws], [mo], name=fresh(conv.name + '_mul')))
                terms.append(mo)
            s = terms[0]
            for t in terms[1:]:
                o = fresh(conv.name + '_s')
                nodes.append(helper.make_node('Add', [s, t], [o], name=fresh(conv.name + '_add')))
                s = o
            ms = fresh(conv.name + '_ms')
            nodes.append(helper.make_node('Slice', [mod, lo, hi, c64([3], 'ax')], [ms], name=fresh(conv.name + '_sl')))
            mm = fresh(conv.name + '_mm')
            nodes.append(helper.make_node('Mul', [s, ms], [mm], name=fresh(conv.name + '_mul')))
            a1 = fresh(conv.name + '_a')
            nodes.append(helper.make_node('Reshape', [mm, c64([1, C, 1, kw, H, W], 'sh')], [a1], name=fresh(conv.name + '_rs')))
            a2 = fresh(conv.name + '_b')
            nodes.append(helper.make_node('Transpose', [a1], [a2], name=fresh(conv.name + '_tr'), perm=[0, 1, 4, 2, 5, 3]))
            a3 = fresh(conv.name + '_c')
            nodes.append(helper.make_node('Reshape', [a2, c64([1, C, H, W * kw], 'sh')], [a3], name=fresh(conv.name + '_rs')))
            wn = fresh(conv.input[1] + f'_row{r}')
            new_init.append(numpy_helper.from_array(np.ascontiguousarray(weight[:, :, r:r + 1, :]), wn))
            co = bias_name if (r == kh - 1 and acc is None) else fresh(conv.name + '_co')
            nodes.append(helper.make_node('Conv', [a3, wn], [co], name=fresh(conv.name + '_conv'),
                                          kernel_shape=[1, kw], strides=[1, kw], pads=[0, 0, 0, 0]))
            if acc is None:
                acc = co
            else:
                o = bias_name if r == kh - 1 else fresh(conv.name + '_acc')
                nodes.append(helper.make_node('Add', [acc, co], [o], name=fresh(conv.name + '_acc')))
                acc = o
        replaced[conv.name] = nodes
        print(f'{conv.name}: C={C} O={O} k={kh}x{kw} {H}x{W}: sampled tensor {C*K*HW*4/2**20:.0f} MB -> {C*kw*HW*4/2**20:.0f} MB per row')

    out = []
    for n in g.node:
        out.extend(replaced.get(n.name, [n]))
    # drop nodes nothing reads any more (the old full-size sampling chain)
    graph_outs = {o.name for o in g.output}
    while True:
        used = {x for n in out for x in n.input} | graph_outs
        keep = [n for n in out if any(o in used for o in n.output)]
        if len(keep) == len(out):
            break
        out = keep
    before = len(g.node)
    del g.node[:]
    g.node.extend(out)
    g.initializer.extend(new_init)
    used = {x for n in g.node for x in n.input}
    keep_init = [i for i in g.initializer if i.name in used]
    del g.initializer[:]
    g.initializer.extend(keep_init)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f'replaced {len(replaced)} deform convs, nodes {before} -> {len(g.node)}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
