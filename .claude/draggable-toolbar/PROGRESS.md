# Draggable window by the toolbar under the tabs

Goal: the empty area of the Polotno toolbar (row under the tab strip) drags the window, like the tab strip.

- [x] CSS in src/renderer/src/index.css: `.polotno-toolbar` = drag; its controls (button/input/[role]/[tabindex]/…) = no-drag
- [x] Verified over CDP in the dev app: toolbar computes `app-region: drag`; all controls in the page, text, figure and line toolbars compute `no-drag`, and no pointer-cursor element is left uncovered
- [ ] Manual check of the physical window drag (synthetic CDP mouse events do not move the window)
