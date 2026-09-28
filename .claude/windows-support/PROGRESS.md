# Windows support

Goal: make the Windows build usable, not just buildable. Branch `nikigan/windows`.

## Plan
1. [x] Title bar: window controls overlay must not cover Connect AI / Export; overlay symbols follow theme
2. [x] App menu reachable on Windows (hidden title bar hides the menu bar) — menu button in the tab strip
3. [x] CLI: `polotno.cmd` wrapper (waits, keeps exit code), added to user PATH by the NSIS installer; Windows CI smoke test
4. [x] Atomic save: retry rename on EPERM/EBUSY/EACCES (AV / indexer / watcher holding the file)
5. [x] Case-insensitive path comparison on Windows (tabs, recent list)

## Out of scope (needs accounts / real hardware)
- Azure Trusted Signing, Windows auto-update rehearsal, manual client checks on Windows

## Notes
- Electron attaches a packaged Windows app to the parent console (unless ELECTRON_NO_ATTACH_CONSOLE), so CLI output does print; the problem is interactive cmd/PowerShell not waiting for a GUI-subsystem exe.

## Status (2026-09-25)
All five items implemented. Verified on macOS: typecheck, `electron-builder --win --x64` builds (NSIS
compiles installer.nsh incl. uninstaller macro), `resources\bin\polotno.cmd` packaged with CRLF,
macOS tab strip unchanged (padding-right 8px, no menu button).
NOT verified on real Windows yet — see BACKLOG.md. The Windows CI job now runs the CLI through polotno.cmd.

## Windows verification (2026-09-28, Windows 11 Pro 26200, 100% scaling)
Needs Node ≥ 22.12 (npm ci's postinstall fails on 20.9 — several deps require it).
App driven through Playwright's `_electron` (note: pass `colorScheme: null`, or Playwright
forces prefers-color-scheme: light and the renderer disagrees with nativeTheme).

Passed as shipped in c01e38d:
- npm ci, typecheck, build
- Overlay clear of Connect AI / Export (normal and maximized); glyphs readable in light and
  dark, follow a live theme switch; hover highlight present
- ☰ opens the menu right under the button; Ctrl+N / Ctrl+O / Ctrl+E work
- MCP on 127.0.0.1:41414, `%APPDATA%\polotno-app\mcp.json` written, /api/health and
  /api/call/list_designs answer; Install design skill copies all 25 files
- Save with the file open in Notepad; save while another process holds the file without
  delete-sharing for ~1 s (a plain rename gets EPERM — the retry gets it through)
- External edit: clean tab reloads, dirty tab prompts; "Keep My Changes" wins on next save
- Same file opened via upper-case and forward-slash lower-case paths → one tab, one recent entry

Found and fixed:
- Ctrl+W closed the window: the Windows/Linux `windowMenu` role has Close on Ctrl+W, which
  overrode File › Close Tab. Window menu is now explicit off macOS (menu.ts).
- Empty tab-strip area did not drag the window: the flex-1 tab container was `app-no-drag`.
  Only tabs and buttons opt out now (tab-strip.tsx). Double-click maximizes/restores.
- Autosave failing past the rename retry (lock held for seconds) was never retried until the
  next edit; it now retries every 5 s (persistence.ts).
- Connect AI label and the Connect dialog's text were black in dark mode: chrome outside
  Polotno's scope inherited the default color. body now has a theme-aware color (index.css).
- Connect dialog / Export menu kept the launch theme after a live switch (dark launch →
  light): outside a PolotnoScope, usePortalScope reads the theme once. Wrapped in PolotnoScope.

Packaged (`electron-builder --win --publish never`, x64 + arm64 NSIS) and installed:
- `polotno.cmd` in win-unpacked: render writes the PNG, exit 0; no args exit 2 (checked from a
  batch file — `cmd /c "x & echo %ERRORLEVEL%"` expands before x runs and always shows 0)
- Install over an existing 0.1.1: old entry removed, re-added once at the end, other entries
  untouched and in order; value becomes REG_EXPAND_SZ
- Fresh cmd and PowerShell (launched via explorer.exe, so they get Explorer's environment —
  proves the WM_SETTINGCHANGE broadcast): `polotno` resolves, render exits 0, no args exits 2
- Uninstall: only our entry removed, order preserved, a fresh cmd no longer finds `polotno`
- `.polotno` via Explorer opens in the app when closed and when already running (one main
  process); an upper-case path to an open file does not add a tab
- `npm run dev` starts and shows the same title bar
- Fixed: the CLI usage line printed `…` as mojibake in cmd/PowerShell (legacy console code
  page); now ASCII.

Done. Left in BACKLOG.md: signing, auto-update rehearsal, dialog titles, Node engines.

## Editor pass (2026-09-28, real mouse/keyboard on Windows)
Works: Text panel + presets, text editing incl. Cyrillic, drag on canvas, Ctrl+C/V (in-app and
from the Windows clipboard: text and image), Ctrl+Z/Ctrl+Y, Delete, Photos + search, shapes,
table, line, Upload via the Windows file dialog, Background color/photo, Resize (magic resize
to Story), font picker + search + apply (Lobster), page duplicate. Export: PNG, JPEG, PDF
(flattened), SVG, HTML, MP4, JSON all write files.

Found and fixed (all verified):
- Open designs sharing a page id (duplicated file, "Duplicate" in My designs, same template
  twice) exported/rendered EACH OTHER's canvas: Polotno finds a page's Konva stage by id across
  the document and takes the first. store.ts keeps page ids unique across open designs
  (reaction + reload with fresh ids; ids are MST identifiers, not settable in place). Verified:
  4 tabs from one template render their own content, not dirty, no undo entry.
- Export save dialog was titled with the blob: URL — will-download sets title "Export" (index.ts).
  Verified.
- GIF export hung forever: Polotno injects gif.js from cdnjs, blocked by the CSP
  (script-src 'self'); script onerror is not handled, so no error toast either. export.ts now
  bundles gif.js 0.2.0 into window.GIF. Verified: animated template → 149-frame 1080×1920 GIF;
  re-ran PNG/JPEG (3 pages → zip), PDF (flattened), SVG, HTML, JSON — all still write files.

Not fixed — handed to the macOS side (see BACKLOG.md): vector PDF fails for Arial designs — @polotno/pdf-export maps
Arial to base-14 Helvetica, which its browser build lacks ("Standard font Helvetica-Bold is
not available in this build"). The app's own bundled templates use Arial. The user gets the
"Try PDF (flattened)" toast. Options: upstream fix, or substitute metric-compatible fonts
(Arimo/Tinos/Cousine) for the PDF export only.
