# VFX EXPLAINED — Matchmove (2:40 explainer)

Fully procedural 1920×1080 / 30 fps explainer. Every frame is a pure function of time, so any range can be re-rendered on its own.

| File | What it is |
|---|---|
| `out/matchmove_explainer.mp4` | Final video, H.264 + AAC voice-over (no music / SFX) |
| `out/matchmove_captions.srt` | Captions, same lines and timings as the burned-in ones |
| `audio/vo.wav` | Voice-over on its own track (24 kHz mono, 160 s) |
| `src/vo_script.json` | Voice-over lines, target start times, caption line breaks |
| `src/make_vo.py` | Synthesises the VO (Kokoro TTS), writes `vo.wav`, `timeline.json`, the `.srt` |
| `src/scene.js` | The "plate": dusk city in three.js + lens pass (barrel distortion, grain, wipe, grade) |
| `src/main.js` | Timeline, camera, trackers, solver animation, diagrams, titles, captions |
| `src/render.mjs` | Headless-Chromium frame renderer piping into ffmpeg |
| `render_all.sh` | Full build. `./render_all.sh 3 4` re-renders only chunks 3 and 4 (300 frames each) |

## Rebuild

```bash
npm install
```

```bash
pip install kokoro-onnx soundfile
```

```bash
./render_all.sh
```

`make_vo.py` expects the Kokoro model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) in `/tmp/tts`.
Preview single frames with `node src/render.mjs stills 4.5,26,88`.

## Notes on what is simulated

- The plate camera is a 35 mm lens on a large-format (54 mm) gate, trucking sideways with handheld noise.
- Trackers are real projections of scene points through that camera and lens, so parallax, trails and the
  distortion mismatch are computed, not drawn by hand.
- The solve readout (343 → 49 → 4.6 → 0.21 px) is the measured mean reprojection error of the animated guess.
- The wrong-focal-length beat is a dolly-zoom illustration: the tracks stay put while the reprojected scene stretches.
