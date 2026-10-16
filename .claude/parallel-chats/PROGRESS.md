# Parallel chats (BACKLOG line 42)

Goal: several chats on one design can run at once; switching chats or starting a new one never stops a running one.

## Design
- An agent conversation belongs to a chat, not a design: `ChatRef = { docId, chatId }`.
  - Claude: one SDK session per chat.
  - Codex: one thread per chat.
- `entry` and `turn` events carry `chatId`. chats.ts records an entry into that chat, never into "the open one".
- `agent:run` creates the open chat if there is none (titled from the prompt) before the provider runs, so the run knows its chat id.
- New chat, select chat: no longer end conversations. Delete chat ends only that chat's conversation. Closing the tab ends all of the design's conversations.
- Renderer:
  - Feeds and running state are kept per chat.
  - `isRunning(docId)` means any chat of the design is running (cursor, activity labels).
  - The history menu stays enabled while chats run, and marks running chats.
- MCP side unchanged: `seen`/`reads` stay per design. Two agents editing the same property means the last write wins, as with any two delegates; user edits are still kept.
- The agent cursor stays one per design. MCP calls don't say which chat they come from.

## Status
- [x] shared types + chats.ts
- [x] providers (claude, codex) + index.ts + ipc
- [x] renderer model + panel (history menu: no longer disabled while running, "Working…" per chat, a dot on the button when a chat other than the open one works; New chat is always available)
- [x] reload (View > Reload) now ends the old tabs' conversations and unregisters them (they stayed listed to outside agents, and their Claude sessions stayed alive)
- [x] verified in the dev app:
  - Codex: two chats at once (5 circles + subtitle color), each chat's entries saved to its own chat; Stop in one chat (pink stopped at 4) while the other finished (cyan 12)
  - Claude: two chats at once; switching to a running chat shows it live (12 → 14 steps); Stop in one (blue stayed 16) while the other kept adding (purple 19 → 22); deleting a running chat stops it (black stayed 17)
  - closing the tab ends both running sessions; reload ends them too (2 → 0 claude processes) and list_designs shows only current tabs
  - after a restart: an old chat continued with Claude answered "DONE-B" (the word Codex replied in it), and the agent-switch note landed in that chat
- typecheck, 15/15 tests, lint on changed files, production build OK
- Test elements removed from "Untitled 7" (back to its 7 elements)

## Cursor per chat (2026-10-16)
- Each panel conversation sends `X-Polotno-Chat: <chatId>` to our MCP server:
  - Claude: in its session's mcpServers headers.
  - Codex: in its thread's `mcp_servers.polotno.http_headers`.
- MCP server (stateless, one handler per request): `withChat` runs the request in an AsyncLocalStorage, and `rpc()` adds `chat` to every message to main. Main passes it through execCommand → `bridge:request`, and the renderer bridge hands it to agentActivity.show.
- agentActivity keeps one activity per (design, chat). Outside agents share the key '' and keep the purple cursor. A chat keeps its color; a new one takes the next color no shown cursor uses.
- AgentCursor draws one Cursor per activity. With two or more chat cursors shown, each tag has a second line with the chat title. Near the right edge the tag flips to the left of the arrow.
- Verified in the dev app:
  - Claude: two chats, two cursors in different colors, each following its own squares.
  - Codex: two chats plus an outside MCP client at once, three cursors (AI agent purple, two Codex chats). The tag flipped at the right edge.
- Test squares removed from "Untitled 7".

## Cursor glides from its last spot (2026-10-16)
- Whole-page reads (get_json/get_info/lint, which tools run around every edit) used to send the cursor to the page middle, so each move detoured there. Now a page read keeps a placed cursor where it is (still sweeps the page); a first read still lands mid-page.
- Verified by sampling the transform per frame: outside agent (3 edits) and a Codex chat (4 edits) move in straight lines.
