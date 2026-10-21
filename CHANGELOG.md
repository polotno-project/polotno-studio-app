# Changelog

User-facing changes in each release of Polotno App. Downloads are on
[GitHub Releases](https://github.com/polotno-project/polotno-studio-app/releases).

## Unreleased

### Added

- **Remove background, on every platform.** The image AI menu cuts the
  subject out on your computer, with no sign-in and nothing uploaded. On
  macOS 14+ it uses Apple's Vision (the same as Remove Background in Preview),
  usually in under a second. On Windows, Linux and older macOS it uses an
  on-device model, downloaded once (about 85 MB) the first time. Undo restores
  the original; Cancel stops it.
- **High-quality background removal.** When a cutout isn't right, _High
  quality_ in the message after it reruns the image with a heavier model
  (about 235 MB, downloaded once; needs a graphics card with WebGPU, and 16 GB
  of memory on Apple silicon). It takes a few seconds and is its own undo
  step. To always use it, check _Edit → High-Quality Background Removal_.

## 0.2.0 — 2026-10-20

### Added

- **AI panel.** Chat with your own Codex or Claude Code about the open design;
  the agent edits the canvas directly. Pick a model per agent, keep several
  chats per design (saved with the file, running in parallel), and continue
  any chat with either agent. Codex can generate images and place them on the
  page or as the background; generated images can be dragged onto the canvas.
- **Agent cursors.** Each chat gets its own cursor on the canvas that follows
  what the agent reads or changes. Agents connected from outside the app get
  one too.
- **Canvas AI tools.** Generative fill (replace or remove an object) and
  Expand, running on your Codex sign-in, with Cancel and setup hints when
  Codex is missing or signed out.
- **Linux packages.** `.deb` (Ubuntu, Debian, Mint, Pop!_OS), `.rpm` (Fedora,
  RHEL family, openSUSE) and `.pacman` (Arch, Manjaro, EndeavourOS) next to the
  AppImage. Packages add a menu entry, open `.polotno` files on double-click,
  put the `polotno` CLI on the PATH and run with the Chromium sandbox
  (including Ubuntu 24.04+). In-app updates work for every Linux format.
- **Templates panel.** My designs updates live with thumbnails, supports bulk
  delete (checkboxes, Ctrl/⌘-click, Shift-click, Select all) and marks designs
  that are open or being edited.

### Changed

- **MCP server.** Supports protocol 2026-07-28 (the 2025 handshake still
  works). Agent edits merge with yours: a property you changed while the agent
  worked keeps your value. Design reads cost far fewer tokens, so agents can
  work on large multi-page designs. `place_image` adds local images, or
  replaces a picture while keeping its current crop and size.
- Export toasts say where the file was saved, or that saving failed; GIF
  export shows rendering and encoding progress.
- Each tab keeps its own side-panel section; the Library / My designs choice
  is remembered.
- The Connect panel has a "Copy Codex config" block and follows the MCP
  server after a token change.
- Message boxes are titled "Polotno" (on Windows they said "polotno-app").
- Update errors are written to `updater.log` in the app's log folder.

### Fixed

- Vector PDF export of the welcome template failed on every OS.
- Arch: cancelling the password prompt for an update no longer asks a second
  time and syncs the package database.
- `polotno render` with no display exits with an `xvfb-run` hint instead of
  crashing.
- Linux docks group the window with its launcher and show the right icon.

## 0.1.4 — 2026-10-19

### Fixed

- Check for Updates shows the download progress and the result; it was
  silent whenever an update was available.

## 0.1.3 — 2026-10-09

### Added

- Reorder tabs by dragging them.
- Drag the window by the toolbar under the tabs.

## 0.1.2 — 2026-09-30

### Added

- Windows: title bar controls, app menu button, `polotno` CLI on the PATH.
- Linux: app menu from the tab-strip button.
- Claude Cowork can connect over MCP even when the app isn't running yet.

### Fixed

- Vector PDF export of designs using Arial.
- GIF export and exporting from another tab.
- Windows: Ctrl+W, dragging by the title bar, dark theme, retrying a failed
  save or autosave.
- The editor window shows on Wayland.
- A new tab gets a file only once it has content; remembered paths that no
  longer exist are dropped.

## 0.1.1 — 2026-08-14

Version bump only, no app changes.

## 0.1.0 — 2026-08-14

First release.
