# Images flicker pixelated while moving (2026-10-19)

Report: an image flickers/pixelates while moved (GIF).
Cause: store.toDataURL below pixelRatio 1 without quickMode sets the store's element pixel ratio to that value (both directions since the SDK's buffer change; see usePagePreview, which passes quickMode for its 0.1 previews, and the comment in store.ts toDataURL: "quickMode … is what a background thumbnail should pass"). The autosave thumbnail (240 px wide → 0.222 for a 1080 design) did that after every autosave, so every image buffer was rebuilt at ~1/9 of its Retina sharpness and back. The agent's render_page (≤1024 px) did the same.
Measured before: _elementsPixelRatio 2 → 0.222 → 2, four times in 6 s of moves. After: stays 2 through autosaves and render_page; thumbnail still written and looks the same.
Done: quickMode: true in persistence.ts writePreview and executor.ts render. Left: user exports (pixelRatio ≥ 1, only raise) and the hidden-store thumbnails (thumbnails.ts, not on screen).
