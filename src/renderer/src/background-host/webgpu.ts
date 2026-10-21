// Whether this machine has a real WebGPU adapter: a software fallback adapter
// would be slower than WASM. Used by the editor (to offer precise mode) and
// by the background removal worker (to pick a backend).

// Just what this needs of WebGPU (no @webgpu/types for one call).
interface Gpu {
  requestAdapter(): Promise<{ info: { isFallbackAdapter: boolean } } | null>
}

let probe: Promise<boolean> | undefined

export function hasWebGpu(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu
      // No powerPreference: onnxruntime picks its own adapter, and Chromium
      // warns on Windows that it ignores the option.
      const adapter = await gpu?.requestAdapter()
      return Boolean(adapter && !adapter.info.isFallbackAdapter)
    } catch {
      return false
    }
  })()
  return probe
}
