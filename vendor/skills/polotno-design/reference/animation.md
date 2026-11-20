# Animation and video

Read this for any animated design, GIF, or video. Every preset and its options:
https://polotno.com/docs/schema/animation.md
Video trim rules: https://polotno.com/docs/animations-and-videos.md

## How it works

Motion is data on an element. An animated design stays editable JSON. Each element
has an `animations` array with at most one entry of each `type`:

```json
{ "type": "enter", "name": "rise", "delay": 300, "duration": 800,
  "easing": "easeOut", "data": { "strength": 1 } }
```

| Type | When it plays |
|---|---|
| `enter` | Starts `delay` ms after the page starts. The element is hidden before that |
| `exit` | Ends `delay` ms before the page ends. The element is hidden after that |
| `loop` | Starts at `delay` and repeats every `duration` ms while the element is on the page |

Time is page-local. Pages play in order, and `page.duration` sets each page's
length (default 5000). A group can have its own animations, which play on top of
its children's.

If `enter` and `exit` need more time than the element has, both play faster.
A still render shows every element at rest, so ordinary proof checks still apply.

## Core presets

Other names are on the schema page. `lint` reports a name that does not exist,
because a wrong name otherwise exports a video with no motion.

| Name | Type | Effect | `data` | Duration |
|---|---|---|---|---|
| `fade` | enter, exit | Opacity | — | 500 |
| `rise` | enter, exit | Small lift and fade | `strength` | 500–800 |
| `move` | enter, exit | Slides 20% of the page's short side | `direction`, `strength` | 500–800 |
| `pop` | enter, exit | Grows from nothing | `strength` | 500 |
| `zoom` | enter, exit | Scales from 75% or 125% | `direction`: `in`, `out` | 500 |
| `wipe` | enter, exit | Reveals behind an edge | `direction`: `right`, `left`, `up`, `down` | 500–800 |
| `count` | enter, exit | Counts the first number in the text | `from` | 1000 |
| `wordRise` | enter, exit | Rises word by word | — | 1000 |
| `lineRise` | enter, exit | Rises line by line | — | 1000 |
| `typewriter` | enter, exit | Letters appear in turn | — | 50 per letter, 1000–4000 |
| `pulse` | loop | Gentle grow and return | `strength` | 1500 |
| `float` | loop | Slow bob | `strength` | 2500 |
| `kenBurns` | loop | Slow zoom and pan in an image or video, once across the element's time | `direction`: `none`, `right`, `left`, `up`, `down`. `zoom`: `in`, `out`. `strength` 1 is a 15% crop | Not used |

`direction` for `move` is where the motion heads: `right`, `left`, `up`, `down`,
`top-right`, and so on. `strength` 1 is the normal amount. Text presets work on
text only.

## Easing

Set `easing` on each `enter` and `exit`. A missing value plays linear, which looks
mechanical.

| Preset | `enter` | `exit` |
|---|---|---|
| `pop` | `backOut` | `backIn` |
| All others | `easeOut` | `easeIn` |

For loops, omit `easing`. `kenBurns` uses `easeInOut`.

## Timing

- Plan each page as enter, rest, exit. The rest is the part people read.
- Allow 250ms per word of rest. `lint` reports `reading-time`.
- Stagger related elements in reading order, 150–300ms apart.
- Animate the message. A background usually needs nothing, or a slow `kenBurns`.
- Use one or two entrance presets across a design, and a loop on one element at
  most.

## Full example

Two pages, five seconds. It passes `validate` and `lint`.

```json
{
  "schemaVersion": 5,
  "width": 1080,
  "height": 1080,
  "fonts": [],
  "audios": [],
  "pages": [
    {
      "id": "reveal",
      "background": "#10243E",
      "duration": 3000,
      "children": [
        { "id": "rule", "type": "figure", "subType": "rect", "x": 90, "y": 300, "width": 900, "height": 12, "fill": "#2DD4BF",
          "animations": [ { "type": "enter", "name": "wipe", "duration": 600, "easing": "easeOut", "data": { "direction": "right" } } ] },
        { "id": "headline", "type": "text", "x": 90, "y": 340, "width": 900, "height": 280, "text": "Launch day is here", "fontSize": 110, "fontFamily": "Inter", "fontWeight": "700", "fill": "#FFFFFF", "align": "left",
          "animations": [
            { "type": "enter", "name": "wordRise", "delay": 200, "duration": 1000, "easing": "easeOut" },
            { "type": "exit", "name": "fade", "duration": 300, "easing": "easeIn" }
          ] }
      ]
    },
    {
      "id": "offer",
      "background": "#FFFFFF",
      "duration": 2000,
      "children": [
        { "id": "number", "type": "text", "x": 90, "y": 360, "width": 900, "height": 200, "text": "12,500", "fontSize": 160, "fontFamily": "Inter", "fontWeight": "700", "fill": "#10243E", "align": "center",
          "animations": [ { "type": "enter", "name": "count", "duration": 1000, "easing": "easeOut", "data": { "from": 0 } } ] },
        { "id": "badge", "type": "figure", "subType": "circle", "x": 500, "y": 620, "width": 80, "height": 80, "fill": "#2DD4BF",
          "animations": [
            { "type": "enter", "name": "pop", "delay": 900, "duration": 500, "easing": "backOut" },
            { "type": "loop", "name": "pulse", "delay": 1400, "duration": 1500 }
          ] }
      ]
    }
  ]
}
```

## Export

| Runtime | How |
|---|---|
| Headless, local editor | `node scripts/render.js design.json out.mp4` or `out.gif`. Options: `--fps`, `--scale` |
| Desktop app | Write `get_design_json` output to a file, then run the same script |
| Backend | The same script, or Cloud Render API with `"format": "mp4"`: see `runtimes/backend.md` |
| Embedded editor | `@polotno/video-export` or `store.saveAsGIF()`: use the `polotno-sdk` skill |

- MP4 defaults to 30 fps at canvas size. GIF defaults to 15 fps at 720px. An odd
  canvas size rounds up to even in MP4.
- All pages play in sequence. `--page <id>` exports one page.
- GIF has no audio. For MP4 audio, add entries to `audios`:
  https://polotno.com/docs/audio.md
- PowerPoint keeps most presets as effects: see `pptx.md`.

## Review motion you cannot watch

1. Run `lint`. Fix each `animation-*` error, and review `reading-time`.
2. Run `node scripts/render.js design.json frames.png --frames`. One image shows
   up to six moments of each page, from the same renderer as the video, with the
   time on each frame. `--frames 10` shows more.
3. Read each row from left to right, and check:
   - Elements arrive in reading order.
   - Nothing collides or leaves the canvas in mid-motion.
   - Each text rests, complete and legible, on a frame.
   - Each exit finishes, and the last frame is the intended one.
4. Report what you checked: "sampled frames", not playback.

The render report gives `seconds`, `fps`, and the file. Compare `seconds` with the
brief.
