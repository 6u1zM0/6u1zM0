# per-pixel flicker = |f[n+1] - (f[n]+f[n+2])/2| maxed over frames, after 3x3 blur; usage: fdiff.py t0 n out.png
import sys, subprocess, numpy as np
from PIL import Image
t0, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
raw = subprocess.run(['ffmpeg','-loglevel','error','-ss',t0,'-i','out/matchmove_master.mp4','-frames:v',str(n),'-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
f = np.frombuffer(raw, np.uint8).reshape(-1,1080,1920).astype(np.float32)
d = np.abs(f[1:-1] - (f[:-2]+f[2:])/2)
m = d.max(0)
frame = f[n//2]
print(out, 'mean', d.mean().round(2), 'p99.9', np.percentile(m,99.9).round(1), 'thirds', [m[i*360:(i+1)*360].mean().round(2) for i in range(3)])
Image.fromarray(np.hstack([np.clip(frame*2.5,0,255), np.clip(m*8,0,255)]).astype(np.uint8)).resize((1920,540)).save(out)
