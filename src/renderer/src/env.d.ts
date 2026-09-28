/// <reference types="vite/client" />

// gif.js ships no types; only handed to Polotno as window.GIF (export.ts).
declare module 'gif.js' {
  const GIF: unknown
  export default GIF
}
