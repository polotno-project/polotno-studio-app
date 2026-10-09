# Draggable window by the toolbar under the tabs + tab reordering

Goal: the empty area of the Polotno toolbar (row under the tab strip) drags the window, like the tab strip.
Follow-up (user request): drag a tab sideways to reorder tabs.

- [x] CSS in src/renderer/src/index.css: `.polotno-toolbar` = drag; its controls (button/input/[role]/[tabindex]/…) = no-drag
- [x] Verified over CDP: toolbar `app-region: drag`, every control `no-drag`; user confirmed real window drag works
- [x] Tab reorder: tabs.moveTab + pointer drag in tab-strip.tsx + `doc:reorder` IPC so session.json keeps the order
- [x] Verified with real OS mouse events (Swift CGEvent drag): left/right, to both ends, session.json follows, window does not move, plain click still switches tabs. Fixed: swap check used the clamped position, so a tab could never pass the end tab
