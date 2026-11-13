# temporal second-difference energy map: highlights flicker (not smooth motion). usage: flicker.py video t0 nframes out.png
import sys, subprocess, numpy as np
from PIL import Image
v, t0, n, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
raw = subprocess.run(['ffmpeg','-loglevel','error','-ss',t0,'-i',v,'-frames:v',str(n),'-vf','scale=960:540','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
f = np.frombuffer(raw, np.uint8).reshape(-1,540,960).astype(np.float32)
d2 = np.abs(f[:-2] - 2*f[1:-1] + f[2:]).mean(0)
# blur a little to suppress grain
from PIL import ImageFilter
im = Image.fromarray(np.clip(d2*6,0,255).astype(np.uint8)).filter(ImageFilter.BoxBlur(4))
a = np.asarray(im).astype(np.float32)
print(out, 'mean', a.mean().round(1), 'rows(top..bottom thirds)', [a[i*180:(i+1)*180].mean().round(1) for i in range(3)], 'max', a.max())
Image.fromarray(np.clip(a*3,0,255).astype(np.uint8)).save(out)
