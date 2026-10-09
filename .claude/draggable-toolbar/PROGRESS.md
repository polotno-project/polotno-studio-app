# Draggable window by the toolbar under the tabs + tab reordering

Goal: the empty area of the Polotno toolbar (row under the tab strip) drags the window, like the tab strip.
Follow-up (user request): drag a tab sideways to reorder tabs.

- [x] CSS in src/renderer/src/index.css: `.polotno-toolbar` = drag; its controls (button/input/[role]/[tabindex]/…) = no-drag
- [x] Verified over CDP: toolbar `app-region: drag`, every control `no-drag`; user confirmed real window drag works
- [x] Tab reorder: tabs.moveTab + pointer drag in tab-strip.tsx + `doc:reorder` IPC so session.json keeps the order
- [x] Verified with real OS mouse events (Swift CGEvent drag): left/right, to both ends, session.json follows, window does not move, plain click still switches tabs. Fixed: swap check used the clamped position, so a tab could never pass the end tab
- [x] Replaced the hand-rolled drag with @dnd-kit/react 0.5 sortable (user's choice after comparing dnd-kit / Motion Reorder / shadcn-style Sortable): animated shifting of neighbours, drag keeps working outside the window, 4px activation, horizontal-only + restricted to the tab list, keyboard reorder; close ✕ doesn't start a drag (sensor skips interactive elements)
- [x] Verified with real OS mouse events: drag out of the window and release outside → reordered + saved; neighbours animate (Web Animations running across frames); click still switches tabs
- [x] PR opened: https://github.com/polotno-project/polotno-studio-app/pull/8
