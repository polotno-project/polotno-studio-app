# Runtime: backend service

Run design production from a service or pipeline, with no person watching.

## Choose a shape

| Shape | Who writes the design | Use it when |
|---|---|---|
| Agent loop | An agent runs this skill in a container with a shell and file tools | Open briefs, where the layout is not known |
| Pipeline | Your code asks a model for `plan.json` and runs the scripts | Known templates and high volume |
| Packages | Your code calls `polotno-node`, `@polotno/schema`, and `@polotno/pptx-export`. For PNG or JPEG only, `@polotno/image-export` renders without Chromium, but it does not draw video frames or Lottie | You have your own pipeline |

A pipeline for a deck from a customer template:

```bash
node scripts/from-template.js template.json plan.json deck.json
node scripts/validate.js deck.json
node scripts/lint.js deck.json --brand template.json --target pptx
node scripts/render.js deck.json proof.png --strict
node scripts/render.js deck.json deck.pdf --vector
node scripts/render.js deck.json deck.pptx
```

Give the model the output of `from-template.js template.json --list`, and
`templates-brand.md` for the plan format.

## Set up the host

Install packages at build time, never during a request:

```dockerfile
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*
COPY skills/polotno-design /app/polotno-design
WORKDIR /app/polotno-design
RUN node scripts/dependencies.js --all
ENV POLOTNO_DEPENDENCY_UPDATE=never POLOTNO_UNTRUSTED=1
```

`PUPPETEER_SKIP_DOWNLOAD=1` before the install saves a Chrome download on Linux
x86-64, because polotno-node uses its own Chromium there.

- **Node:** 22.13 or later for vector PDF, 20.9 or later for the rest.
- **CPU:** the bundled Linux Chromium is x86-64. On arm64, install the `chromium`
  package and set `POLOTNO_BROWSER_PATH=/usr/bin/chromium`.
- **ffmpeg:** optional. MP4 works without it. With audio, install it so that the
  audio can become AAC. Without it, the audio stays Opus.
- **Fonts:** a slim image has no system fonts, so CJK, Thai, and Indic text needs
  a font for that script. Lint rule `font-script` reports this.
- **Read-only files:** the scripts keep working with the packages they shipped.
- **Parallel runs:** safe. Runs share one install through a lock.

## Set the environment

| Variable | Purpose |
|---|---|
| `POLOTNO_API_KEY` | Your key. A wrong key does not fail a render, so check it when you deploy |
| `POLOTNO_DEPENDENCY_UPDATE=never` | No npm activity at run time |
| `POLOTNO_UNTRUSTED=1` | Rejects `file:` sources and blocks private network requests. Set it for JSON that a model or a user wrote |
| `POLOTNO_BROWSER_PATH` | The Chromium binary, if the bundled one cannot run |

Also restrict outbound network access for the render process in the container or
firewall.

Production use of `polotno-node`, `@polotno/pptx-export`, and
`@polotno/pdf-export` requires a Polotno subscription. Each package has its terms
in `LICENSE.md`.

## Read the result

Each script prints one JSON report to stdout. npm and renderer messages go to
stderr.

| Exit code | Meaning |
|---|---|
| 0 | Done. Read `warnings` and `overflow` in the report |
| 1 | The design failed a check or a render. stdout (`errors`) or stderr (`error`) says why |
| 2 | Wrong usage. `validate.js`, `lint.js`, and `from-template.js` also use it for a missing install |
| 3 | `render.js --strict` wrote the files and measured an overflow |

| Failure | Cause and repair |
|---|---|
| `FONT_FAILED` | The font is not a Google font, or its `url` failed. See `templates-brand.md` |
| `IMAGE_FAILED` | An asset URL failed, after three attempts |
| `DESIGN_INVALID` | The JSON is invalid, or it has a `file:` source under `POLOTNO_UNTRUSTED=1` |
| `Failed to launch the browser process` | System libraries are missing, or the CPU is arm64. See the host setup |
| `npm dependencies are missing` | The build step did not run `dependencies.js --all` |
| `resolve-assets.js` exit 1 | The `dropped` list names each element that lost its image |

## Review without eyes

Visual proof needs a model that can view images. The scripts check structure,
fit, brand, and PowerPoint losses, but they cannot judge a layout.

- **Vision model available:** send `render.js deck.json sheet.png --sheet`, each
  page, and `proof-checks.md`. Repair from its `block` results.
- **No vision model:** pass the gates above, and mark the result as unreviewed.
  Route it to a person before it reaches a customer.

## Cloud Render API

If the host cannot run Chromium, the API renders the same JSON (paid key). It
makes png, jpeg, pdf, gif, mp4, and pptx. `@polotno/pptx-export` and
`@polotno/image-export` also need no Chromium.

```bash
curl -s -X POST "https://api.polotno.com/api/renders?KEY=$POLOTNO_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"design": <design.json contents>, "format": "mp4"}'
# → {"id": "..."}
curl -s "https://api.polotno.com/api/renders/<id>?KEY=$POLOTNO_API_KEY"
# → {"status": "done", "output": "<url, valid 7 days>"}
```

A job renders the design's stored template variable values. To fill a template
with one data row, add `"variables": { … }` and `"strict": true` to the job. A
dotted name reads nested data, as in `resolveVariables`. With `strict`, a missing
required value or a wrong type fails the job with `VARIABLES_INVALID`, and the
job's `error` lists the issues. Send one job per row.

Print options: see `print-pdf.md`. Full docs:
https://polotno.com/docs/cloud-render-api
