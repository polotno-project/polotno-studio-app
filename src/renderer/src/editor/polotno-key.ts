// The Polotno license key for the desktop app. The packaged app runs on a
// file:// page, which the SDK reports as origin "electron" — that domain must
// be registered for this key in the Polotno cabinet.
// Override at build time with VITE_POLOTNO_KEY.
export const POLOTNO_KEY: string = import.meta.env.VITE_POLOTNO_KEY ?? 'nFA5H9elEytDyPyvKL7T'
