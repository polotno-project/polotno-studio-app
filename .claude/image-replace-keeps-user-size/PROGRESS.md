# Image edits keep the user's size (2026-10-19)

Report: asked Codex (AI panel) to add something to an image, resized the image while it worked; Codex replaced it with a new image at the original size.

Cause (from the user's saved chat): Codex edited the picture with place_image (a new element at the box from its last read) + remove_element (the old one). The user's resize landed between them on the element that got removed. Conflict protection covers set props only, and no tool could put a local file into an existing element.

Done:
- place_image `replace: <image id>`: renderer command `replace_image` sets the new src and a center (cover) crop computed from the element's size when it applies, so position/size/rotation/effects stay as the user has them. Seen baseline updated with the new src/crop.
- Instructions (Codex developer instructions, MCP server instructions, tool description): edit an existing image via replace, not add + remove.
- Agent cursor label "Replacing <image>".

Verified (dev app): outside agent read → user resized to 600×400 → place_image replace → element kept 600×400 at 100,300, same id, count unchanged, crop 0/0.167/1/0.667 for a square picture in a 3:2 frame. Real Codex ("add a flying saucer above the piano, edit the photo itself") with a resize 5 s into image generation: Codex used place_image replace, image kept the user's 600×400, saucer in the picture. Test edits undone, file restored.
