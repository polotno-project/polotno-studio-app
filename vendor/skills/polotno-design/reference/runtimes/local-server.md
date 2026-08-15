# Runtime: local editor server (skill-carried)

No Polotno app installed, but you have a terminal and a human is present.
Start a small local server that shows the human a live editor in their
browser while you keep working on the file:

```bash
node scripts/serve.js design.json
```

The first run builds the editor bundle locally (~10s); then it prints a
`http://localhost:<port>` URL — give it to the user. The page
is a full Polotno editor bound to `design.json`: it reloads when you change
the file, and the human's edits save back into the same file. This runtime
speaks the same verbs as `commands.md` — file-side, over your existing
scripts:

| Verb | How |
|---|---|
| create/read/patch design | edit `design.json` directly (validate after) |
| `render`, `export` | `node scripts/render.js …` (see `headless.md`) |
| `lint` | `node scripts/validate.js design.json` |

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

- **Re-read before you write.** The human may have saved changes from the
  browser since your last read. Read `design.json` fresh before each edit,
  as with any shared file.
- Announce the URL once; don't repeat it every turn.
- If `scripts/serve.js` is missing, your copy of the skill predates this
  runtime — fall through to `headless.md`.
- Stop the server when the task ends (Ctrl-C / kill the process) and say so.
