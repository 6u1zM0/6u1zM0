---
name: vfx-explainer-video
description: Produce an episode of the "VFX EXPLAINED" YouTube series - a fully procedural 1920x1080 / 30 fps explainer video with burned-in captions, an .srt, a read-aloud script and YouTube metadata. Use when the user asks for a new VFX EXPLAINED episode (rotoscoping, keying, compositing, ...), a change to an existing one, or "a video like the matchmove one".
---

# VFX EXPLAINED episode workflow

`matchmove/` in this repository is the reference episode and the template. Every frame is a pure function of
time, rendered by headless Chromium (three.js for the plate, 2D canvas for overlays) and piped into ffmpeg.
Read `matchmove/README.md` first, then follow the steps below in order.

## What the user provides

A brief with: topic, total duration, a timed list of sections, the visual for each section, and the
voice-over line for each section. If any of these is missing, ask once; the timings drive everything else.

## Series template (do not change between episodes)

- 1920x1080, 30 fps, 16:9. Dark navy background `#0d1220`, clean technical/HUD look.
- Colour code: mint `#4ade80` = tracked/valid, coral `#ff6b5e` = error/wrong, orange `#ff9a3c` = camera and
  camera path, cyan `#38d6f5` = 3D points, pink `#ff4fa3` = the CG object.
- Fonts: Inter / Inter Display for titles, JetBrains Mono for labels and numbers.
- The plate is the stylised dusk city in `src/scene.js` (low-poly buildings, lit windows, orange-purple sky,
  teal boxes, pink crystal), with handheld drift, light grain, slight barrel distortion, the
  "PLATE SHOT_042 24 fps" label and a running frame counter.
- Phone-first layout: one main visual at a time, no side-by-side panels or insets; nothing static for more
  than about 2 s; labels 1-4 words, at least 36 px; no sentences on screen other than captions.
- Each chapter: mono tag ("02 PARALLAX") plus a title of at most 6 words, centred for 3 s, then shrinking to
  the top-left. Thin progress bar on the bottom edge, one segment per section.
- Captions: burned in, bottom-centre, one line at a time, 4-8 words, white on a dark backing. Keep the bottom
  15 % of the frame (y > 918) free of anything important.
- Cold open with no logo; end card with "NEXT: <topic>" on the left and the right half empty for YouTube's
  end-screen element.

## Steps

1. **Copy the template.** `cp -r matchmove <topic>` (without `node_modules`, `out`), then `npm install` in it.
   Keep `scene.js`, `render.mjs`, `render_all.sh`, `make_vo.py`, `sheet.py`, `vsheet.sh`, `fdiff.py` and the
   helper/primitive sections of `main.js`. Replace the `CH` chapter table, `buildState`, and the `ov*`
   chapter overlay functions.

2. **Script and timing first.** Write `src/vo_script.json`: one entry per spoken sentence with its target
   start time `t`, the text to speak (`say`, spell out things like "three-D") and the caption lines (`caps`,
   4-8 words each). Run `python3 src/make_vo.py af_heart 1.0`. It needs `pip install kokoro-onnx soundfile`
   and the Kokoro model files in `/tmp/tts` (download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the
   kokoro-onnx GitHub release `model-files-v1.0`). It writes `src/timeline.json` (caption timings the
   renderer burns in), `out/<name>_captions.srt` and a guide `audio/vo.wav`. Check its log: a line reported
   as "pushed late" means that section's script is too long for its slot.

3. **The user records the voice-over.** The delivered video is silent with burned-in captions. The synthetic
   VO exists only to derive caption timing. Never mux it into the deliverable unless asked.

4. **Animate.** Hand-set cue times in `main.js` to the VO start times printed in step 2. Rules that held up:
   - Anything shown on the plate (trackers, trails, error crosses) is a real projection of scene points
     through the shot camera and lens (`toPx`), never hand-placed.
   - 3D diagram views are drawn in the 2D canvas with the same camera (`seg3`, `frustum3`, `grid3`), over the
     plate dimmed toward navy (`S.dim`), so lines can be thick and glow.
   - The centred chapter card covers the middle band for 3 s. Put that period's action and labels above
     y = 300 or below y = 700.
   - Any A/B comparison (wrong vs right) needs an offset that never passes through zero during the
     comparison, or the wipe will show two identical images.
   - Pixel focal length is `focal / SENSOR_W * 1920`. Do the arithmetic before laying out a scene.

5. **Preview with stills, not video.** `node src/render.mjs stills 4.5,26,88` then
   `python3 src/sheet.py out/stills/sheet.jpg 4.5 26 88` and look at the sheet. Cover every section, every
   transition midpoint and the first and last frame. Do not pipe the renderer into `head`; it kills the run.

6. **Render.** `./render_all.sh` renders 300-frame chunks in parallel (about 20 minutes for 160 s on 4 cores)
   and writes a silent high-bitrate `out/*_master.mp4` plus a roughly 9 Mb/s delivery file.
   `./render_all.sh 3 14` re-renders only the listed chunks after a local fix.

7. **Review the rendered video.** `src/vsheet.sh out/rev/r1.jpg <times...>` builds contact sheets from the
   video. Then check for flicker: crop three or four consecutive full-resolution frames from each wide shot
   and compare them (see `fdiff.py` for a per-pixel measure, but confirm by eye; the metric is confounded by
   camera motion). Known cause: geometry lying on the ground plane. Ground decals need `polygonOffset` and
   the render camera needs a tight near/far range (currently 0.6 to 1100).

8. **Deliver.** Send the delivery MP4 and the `.srt` to the user. Then give, in chat:
   - the read-aloud script: plain text grouped by section with each section's start time, no timestamps
     per line;
   - a YouTube title with two alternatives;
   - a description with chapter timestamps that match the video;
   - a thumbnail prompt for an image generator, using the series look and one word of text.
   State plainly what was verified on extracted frames versus what needs a watch at speed.

9. **Commit.** Sources, `.srt`, `timeline.json` and the script go in git; MP4s do not (over GitHub's 100 MB
   limit, already in `.gitignore`).

## If the user's recorded VO has different timing

Update the `t` values in `vo_script.json` to the new start times (or derive them from their recording),
regenerate `timeline.json` and the `.srt`, shift the matching cue times in `main.js`, and re-render the
affected chunks only.
