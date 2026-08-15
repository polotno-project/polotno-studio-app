# Runtime: polotno.com/studio bridge

Reserved for a browser-automation bridge into polotno.com/studio
(`window.polotnoAgent`). **Not yet available.** It will cover the case
where you control the human's browser but they cannot reach your machine
(e.g. you run in a cloud sandbox) — studio is on the public internet.

If you reached this file, fall through to `headless.md`. Do not drive
studio through its internal `window.store` — it is not a stable API.
