# Runtime: local editor server (skill-carried)

No Polotno app installed, but you have a terminal and a human is present.
Start a small local server that shows the human a live editor in their
browser while you keep working on the file:

```bash
node scripts/serve.js design.json
```

The server installs missing npm packages. It checks for permitted updates at
most once every seven days. A change to a package version causes an editor
rebuild. The first build takes approximately 10 seconds. Then the server prints a
`http://localhost:<port>` URL. Give this URL to the user.
The page is a full Polotno editor bound to `design.json`. It reloads after a
file change. User edits save into the same file. This runtime
speaks the same verbs as `commands.md` — file-side, over your existing
scripts:

| Verb | How |
|---|---|
| create/read/patch design | edit `design.json` directly (validate after) |
| `render` | `node scripts/render.js design.json preview.png`. Several pages write `preview-1.png`, `preview-2.png`, and so on. Its JSON report lists each measured overflow |
| `export` | `node scripts/render.js design.json` with `out.png --full`, `out.pdf`, `out.pdf --vector`, `out.pptx`, `out.gif`, or `out.mp4` |
| schema validation | `node scripts/validate.js design.json` |
| `lint` | `node scripts/lint.js design.json` |
| assets | `node scripts/resolve-assets.js search photo "…"` — look, pick, paste the url. Icons: `search icon "…"` then `get icon <id>` → paste the data URL |

A design with animation, video, or audio opens with the editor's timeline and
Animate panel. The Variables panel lists the template variables: the user can
change their values there, and the editor saves them to the file.

## Remote / cloud sandboxes

`localhost` here means *this machine* — if you run in a cloud sandbox, the
human's browser cannot reach it. In that case:

1. If your environment can expose a local port at a public URL (port
   forwarding, preview URLs), serve on that port and give the user the
   public URL instead.
2. Otherwise this runtime is unavailable — fall through to `headless.md`,
   and at the end hand the user the design JSON with one line: "import it
   at polotno.com/studio to edit."

Rules of the road:

- **Re-read before you write.** The human can save changes from the
  browser since your last read. Read `design.json` fresh before each edit,
  as with any shared file.
- Announce the URL once. Do not repeat it every turn.
- If `scripts/serve.js` is missing, your copy of the skill predates this
  runtime — fall through to `headless.md`.
- After the task ends, stop the server. Tell the user that the server stopped.
