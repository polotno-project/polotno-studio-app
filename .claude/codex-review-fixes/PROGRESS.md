# Codex review fixes (2026-10-19)

Codex reviewed master...HEAD; each finding was checked against the code, then fixed and tried in the dev app.

## Findings (all confirmed)
- [x] P1 tools.ts `seen` shared by chats → keyed by chat (bridge-client `currentChat()`). Verified: A reads, user changes, B reads, A's update keeps the user's value; B's update applies.
- [x] P1 image edit hung when Codex exited → onExit finishes edits with 'stopped' ("Codex stopped."). Verified by killing the app's codex app-server mid-edit; temp file removed.
- [x] P2 Claude double start → `opening` map shares one start per chat. Verified: two quick first messages → one claude process, both answered.
- [x] P2 tab close / agent switch missed starting runs → conversations() include starting ones; Codex runs check `busy.get(chatId) === chat` before thread/turn start; Claude closes a session reset while opening. Verified for both (no prompt/turn after close, no process left).
- [x] P2 early image-edit cancel ignored → `editJobs` with `canceled`; checked before thread and turn start, interrupt after turn/start. Verified: abort in ~1 s.
- [x] P2 stale status/model answers after an agent switch → ignored in agent-model.ts (not reproducible by hand; code-level).
- [x] P2 page inserted at /pages/0 appended → page-order compares the full order; applied slot-wise like element order. Tests added; verified with patch_design_json.
- [x] P2 "Add to design" fallback skipped when the agent's file is gone → provider lookup errors fall through to the kept copy (code-level).

## Simplifications
- [x] Codex model pick via readSetting/writeSetting (same codex-model.json); null pick cached in both providers.
- [x] dropImages lists the images folder once.
- [x] Fired cursor timers are dropped. Not done: retiring finished cursors — keeping them mounted is what lets a chat's next edit glide from its last spot.
- [x] Codex-not-ready toast points to the panel callout instead of repeating it.

## Cursor follows scroll (user report)
- A page read kept the cursor's screen position, so it stayed put while the canvas scrolled. Now the cursor keeps an anchor target and re-measures it every frame; removed elements' rects are page-relative.
- The glide applies only to a new target; after it the cursor sticks to its target instantly (no 450 ms lag while scrolling).
- Verified with the page hidden by patching rAF to a timer: cursor and outline move with a 150 px scroll; no page-centre detours.
