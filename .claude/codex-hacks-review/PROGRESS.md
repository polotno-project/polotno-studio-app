# Codex audit: overcomplications and hacks (2026-10-19)

Codex listed 8 findings; each was checked against the code and the running app.

| # | Finding | Verdict | Done |
|---|---------|---------|------|
| 1 | `seen` aliases the kept reads, `sawChange` mutates them | Real, but the alias is useful within one chat (own typed edits aren't taken for the user's). The flaw: reads were shared by all chats, so chat B's patch overwrote chat A's typed edit | `reads` keyed per chat like `seen`; tested A/B in the app |
| 2 | Cursor scrapes Konva stages every frame | Real. First declined on the belief Polotno had no extension point; the SDK repo shows the documented `PageControls` slot (DOM, per page, gets store/page/xPadding/yPadding) | Cursors render in that slot, placed from the model in page units with Polotno's exported `getTotalClientRect` (groups by their children); MobX re-renders on moves, Polotno's layout handles scroll/zoom; canvas-rects.ts and the rAF loop gone. Trade-off: a cursor moving to another page jumps there. Verified: two chats, zoom 150% + scroll, element moved, second page |
| 3 | Reset during a pending `turn/start` leaves the turn running | Real, reproduced (deleted chat's turn still added text) | Interrupt + unsubscribe when dropped after `turn/start`; reset unsubscribes the thread; verified both ways |
| 4 | Image alignment brute force; JPEG contradicts the comment | Comment was wrong; alignment kept (Codex takes no mask) | Comments corrected |
| 5 | Body-wide MutationObserver for the notice | Real overhead | Observer only runs while inpaint/expand is open and Codex isn't ready; verified states in the app |
| 6 | Duplicate image ownership (`imageFiles` never cleared, served after chat delete) | Real | Entry done after the chat copy exists; served only from the chat copy; provider `image()` removed; verified generate → fetch → delete |
| 7 | Two rAFs as mount readiness for thumbnails | Real: Polotno's toDataURL already waits for the stage and loading | Waits removed; thumbnail renders fully (~200 ms) |
| 8 | Claude version hint | Hint fired on any older patch version | Compare major.minor only, neutral wording |

Note: MCP server code runs from out/mcp-server.cjs in dev — `npm run build:mcp` before testing tools.ts changes.
