"""Synthesize the voice-over, lay it on the 160 s timeline, emit vo.wav, timeline.json, captions.srt"""
import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
VOICE = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
MODEL = "/tmp/tts"
TOTAL = 160.0
k = Kokoro(f"{MODEL}/kokoro-v1.0.onnx", f"{MODEL}/voices-v1.0.bin")
script = json.load(open("src/vo_script.json"))
SR = 24000
out = np.zeros(int(TOTAL * SR), dtype=np.float32)

def trim(x, thr=0.01):
    idx = np.where(np.abs(x) > thr)[0]
    return x[max(0, idx[0] - int(0.02 * SR)): idx[-1] + int(0.06 * SR)]

def pauses(x, min_len=0.09):
    """inner silences -> list of (mid_time, length)"""
    win = int(0.01 * SR)
    n = len(x) // win
    e = np.sqrt((x[: n * win].reshape(n, win) ** 2).mean(1))
    quiet = e < 0.012
    res, i = [], 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]: j += 1
            if i > 3 and j < n - 3 and (j - i) * 0.01 >= min_len:
                res.append(((i + j) / 2 * 0.01, (j - i) * 0.01))
            i = j
        else: i += 1
    return res

timeline, prev_end = [], 0.0
for n, it in enumerate(script):
    x, sr = k.create(it["say"], voice=VOICE, speed=SPEED, lang="en-us")
    assert sr == SR
    x = trim(x.astype(np.float32))
    dur = len(x) / SR
    start = max(it["t"], prev_end + 0.22)
    if start > it["t"] + 0.01: print(f"  ! line {n} pushed {start - it['t']:.2f}s late")
    out[int(start * SR): int(start * SR) + len(x)] += x
    caps = it["caps"]
    # caption boundaries: prefer real pauses near the proportional estimate
    tot = sum(len(c) for c in caps); acc = 0; bounds = []
    ps = pauses(x)
    for c in caps[:-1]:
        acc += len(c); est = dur * acc / tot
        near = [p for p in ps if abs(p[0] - est) < 0.6]
        bounds.append(min(near, key=lambda p: abs(p[0] - est))[0] if near else est)
    edges = [0.0] + bounds + [dur]
    cl = [{"s": round(start + edges[i], 3), "e": round(start + edges[i + 1], 3), "text": c} for i, c in enumerate(caps)]
    timeline.append({"i": n, "s": round(start, 3), "e": round(start + dur, 3), "say": it["say"], "caps": cl})
    print(f"{n:2d} {start:7.2f} -> {start + dur:7.2f}  ({dur:.2f}s)  {it['say']}")
    prev_end = start + dur

out *= 0.89 / np.abs(out).max()
sf.write("audio/vo.wav", out, SR)
json.dump(timeline, open("src/timeline.json", "w"), indent=1)

def ts(t):
    ms = int(round(t * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
flat = [c for l in timeline for c in l["caps"]]
with open("out/matchmove_captions.srt", "w") as f:
    for i, c in enumerate(flat):
        end = c["e"] + 0.35
        if i + 1 < len(flat): end = min(end, flat[i + 1]["s"] - 0.04)
        c["hold"] = round(end, 3)
        f.write(f"{i + 1}\n{ts(c['s'])} --> {ts(end)}\n{c['text']}\n\n")
json.dump(timeline, open("src/timeline.json", "w"), indent=1)
