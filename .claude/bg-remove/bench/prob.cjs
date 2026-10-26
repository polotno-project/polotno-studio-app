// Model output (1024x1024) -> probability in [0,1]. 'sigmoid': BiRefNet logits. 'minmax': IS-Net's sigmoid output,
// min-max normalized per image as IS-Net/Inference.py does. NaN passes through.
module.exports = function toProb(out, mode) {
  const p = new Float32Array(out.length)
  if (mode === 'minmax') {
    let mi = Infinity
    let ma = -Infinity
    for (const v of out) {
      if (v < mi) mi = v
      if (v > ma) ma = v
    }
    const k = ma > mi ? 1 / (ma - mi) : 0
    for (let i = 0; i < out.length; i++) p[i] = (out[i] - mi) * k
  } else if (mode === 'identity') {
    p.set(out)
  } else {
    for (let i = 0; i < out.length; i++) p[i] = 1 / (1 + Math.exp(-out[i]))
  }
  return p
}
