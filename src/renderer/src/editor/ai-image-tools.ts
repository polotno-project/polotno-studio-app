import { setExpandFunc, setRemoveObjectFunc, setReplaceObjectFunc } from 'polotno/config'
import { padImageForFrame, prepareImageInput } from 'polotno/utils/image-edit'
import { toast } from 'sonner'
import { codex } from './codex-model'
import { tabs } from './tabs-model'

// Polotno's canvas AI tools (Generative fill: replace / remove, and Expand)
// run on the user's own Codex. Polotno draws the selection, prepares the
// pixels and applies the result; we paint the area to change solid magenta
// (Codex's image model follows a marked area well and a separate mask badly),
// have Codex redraw the image, then put the result back only inside the
// area, so every pixel outside it stays exactly as it was.
// Background removal is not routed here: an image model redraws the subject
// instead of cutting it out. Upscale is not offered: image models can't.

const MAGENTA = [255, 0, 255]
// The image sent to Codex; its model outputs about 1.5k px anyway.
const SEND_MAX_SIDE = 1536

const KEEP_REST =
  'Every pixel outside the magenta area must stay exactly as it is: same framing, same camera, no zoom or crop. Output the full image at the same size.'

const instructions = {
  replace: (prompt: string) =>
    `Edit this image. The solid magenta shape marks the area to change. Replace the magenta shape with: ${prompt}. Fit it to the shape's area and match the scene's lighting and perspective. ${KEEP_REST}`,
  remove: () =>
    `Edit this image. The solid magenta shape marks the area to change. Remove whatever object is under the magenta shape and fill the shape with the background that matches its surroundings, so no trace of the object or of magenta remains. ${KEEP_REST}`,
  expand: (prompt?: string) =>
    `Edit this image. The solid magenta areas are empty canvas around a photo. Extend the photo's scene into them seamlessly so it looks like one wider photo, with no trace of magenta.${prompt ? ` In the new areas show: ${prompt}.` : ''} ${KEEP_REST}`
}

const abortError = (): Error => Object.assign(new Error('Canceled'), { name: 'AbortError' })

const failure = (message: string, cause?: unknown): Error =>
  Object.assign(new Error(message, { cause }), { userMessage: message })

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return [element, element.getContext('2d', { willReadFrequently: true })!]
}

function pixels(source: CanvasImageSource, width: number, height: number): ImageData {
  const [, ctx] = canvas(width, height)
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function fit(width: number, height: number, maxSide: number): [number, number] {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

// The image with the mask's white area painted magenta, as PNG bytes.
async function marked(image: ImageBitmap, mask: ImageBitmap): Promise<Uint8Array> {
  const [width, height] = fit(image.width, image.height, SEND_MAX_SIDE)
  const [element, ctx] = canvas(width, height)
  ctx.drawImage(image, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height)
  const area = pixels(mask, width, height).data
  for (let i = 0; i < data.data.length; i += 4) {
    if (area[i] > 127) {
      data.data.set(MAGENTA, i)
      data.data[i + 3] = 255
    } else if (data.data[i + 3] < 255) {
      // Codex flattens transparency anyway; keep it from turning black.
      const alpha = data.data[i + 3] / 255
      for (let c = 0; c < 3; c++) data.data[i + c] = data.data[i + c] * alpha + 255 * (1 - alpha)
      data.data[i + 3] = 255
    }
  }
  ctx.putImageData(data, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'))
  if (!blob) throw failure('Could not prepare the image.')
  return new Uint8Array(await blob.arrayBuffer())
}

type Placement = { scale: number; dx: number; dy: number }

// Image models sometimes shift or zoom the frame a little. Find the scale and
// offset (relative to the image size) that line the result up with the
// original outside the edited area, on small grayscale copies.
function align(original: ImageBitmap, result: ImageBitmap, mask: ImageBitmap): Placement {
  const [w, h] = fit(original.width, original.height, 128)
  const gray = (data: Uint8ClampedArray): Float32Array => {
    const out = new Float32Array(w * h)
    for (let i = 0; i < out.length; i++) {
      out[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11
    }
    return out
  }
  const a = gray(pixels(original, w, h).data)
  const b = gray(pixels(result, w, h).data)
  const area = pixels(mask, w, h).data
  const keep: number[] = []
  for (let i = 0; i < w * h; i++) if (area[i * 4] < 25) keep.push(i)
  if (keep.length < 100) return { scale: 1, dx: 0, dy: 0 }

  const cx = w / 2
  const cy = h / 2
  const error = (scale: number, tx: number, ty: number): number => {
    let sum = 0
    let count = 0
    for (const i of keep) {
      const x = i % w
      const y = (i - x) / w
      const u = Math.round((x - tx - cx) / scale + cx)
      const v = Math.round((y - ty - cy) / scale + cy)
      if (u < 0 || v < 0 || u >= w || v >= h) continue
      sum += Math.abs(a[i] - b[v * w + u])
      count++
    }
    return count > keep.length * 0.8 ? sum / count : Infinity
  }
  let best = { error: error(1, 0, 0), scale: 1, tx: 0, ty: 0 }
  const reach = Math.round(Math.max(w, h) * 0.08)
  for (let scale = 0.92; scale <= 1.081; scale += 0.02) {
    for (let ty = -reach; ty <= reach; ty++) {
      for (let tx = -reach; tx <= reach; tx++) {
        const e = error(scale, tx, ty)
        // Prefer no change unless moving clearly fits better.
        if (e < best.error - 0.5) best = { error: e, scale, tx, ty }
      }
    }
  }
  return { scale: best.scale, dx: best.tx / w, dy: best.ty / h }
}

// Draws the result over the whole canvas, lined up with the original.
function drawPlaced(
  ctx: CanvasRenderingContext2D,
  result: ImageBitmap,
  { scale, dx, dy }: Placement
): void {
  const { width, height } = ctx.canvas
  ctx.translate(width / 2 + dx * width, height / 2 + dy * height)
  ctx.scale(scale, scale)
  ctx.drawImage(result, -width / 2, -height / 2, width, height)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// The original with the result drawn in only where the mask is white (with a
// soft edge), at the original's size. `underlay` also puts the whole result
// beneath: Expand's new area is transparent in the original, and the soft
// edge would otherwise let the page show through at the seam.
async function composite(
  original: ImageBitmap,
  resultUrl: string,
  mask: ImageBitmap,
  underlay: boolean
): Promise<string> {
  const result = await createImageBitmap(await (await fetch(resultUrl)).blob())
  const { width, height } = original
  const placement = align(original, result, mask)

  const [layer, layerCtx] = canvas(width, height)
  drawPlaced(layerCtx, result, placement)

  // Mask brightness becomes alpha; a slight blur hides the seam.
  const [alpha, alphaCtx] = canvas(width, height)
  const feather = Math.max(1, Math.round(Math.max(width, height) / 400))
  alphaCtx.filter = `blur(${feather}px)`
  alphaCtx.drawImage(mask, 0, 0, width, height)
  const alphaData = alphaCtx.getImageData(0, 0, width, height)
  for (let i = 0; i < alphaData.data.length; i += 4) alphaData.data[i + 3] = alphaData.data[i]
  alphaCtx.putImageData(alphaData, 0, 0)
  layerCtx.globalCompositeOperation = 'destination-in'
  layerCtx.drawImage(alpha, 0, 0)

  const [out, outCtx] = canvas(width, height)
  if (underlay) drawPlaced(outCtx, result, placement)
  outCtx.drawImage(original, 0, 0)
  outCtx.drawImage(layer, 0, 0)

  // Opaque photos as JPEG keep the design file small; anything with
  // transparency stays PNG.
  const data = outCtx.getImageData(0, 0, width, height).data
  let opaque = true
  for (let i = 3; i < data.length && opaque; i += 4) opaque = data[i] === 255
  return opaque ? out.toDataURL('image/jpeg', 0.92) : out.toDataURL('image/png')
}

// No connected Codex: show where to connect it instead of an error.
async function ensureCodex(): Promise<void> {
  const status = await window.desktop.invoke('codex:status')
  codex.setStatus(status)
  if (status.state === 'ready') return
  tabs.active?.store.openSidePanel('ai')
  toast.info('AI edits run on your Codex. Connect it in the AI panel to use them.')
  throw abortError()
}

async function run(
  image: Blob,
  mask: Blob,
  instruction: string,
  signal: AbortSignal,
  underlay = false
): Promise<{ src: string }> {
  await ensureCodex()
  const [original, area] = await Promise.all([createImageBitmap(image), createImageBitmap(mask)])
  const png = await marked(original, area)
  if (signal.aborted) throw abortError()

  const id = crypto.randomUUID()
  const cancel = (): void => void window.desktop.invoke('codex:imageEditCancel', { id })
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const { dataUrl } = await window.desktop.invoke('codex:imageEdit', { id, png, instruction })
    if (signal.aborted) throw abortError()
    return { src: await composite(original, dataUrl, area, underlay) }
  } catch (error) {
    if (signal.aborted) throw abortError()
    if ((error as { userMessage?: string }).userMessage) throw error
    throw failure('Codex could not edit the image. Try again.', error)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export function installAiImageTools(): void {
  setReplaceObjectFunc(({ image, mask, prompt, signal }) =>
    run(image, mask, instructions.replace(prompt), signal)
  )
  setRemoveObjectFunc(({ image, mask, signal }) => run(image, mask, instructions.remove(), signal))
  setExpandFunc(async ({ image, size, frame, prompt, signal }) => {
    const prepared = await prepareImageInput({ image, size, frame }, { maxSide: 2048 })
    const padded = await padImageForFrame(prepared)
    return run(padded.image, padded.mask, instructions.expand(prompt), signal, true)
  })
}
