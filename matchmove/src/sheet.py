import sys
from PIL import Image
names = sys.argv[2:]
cols = 2; rows = (len(names) + 1) // 2
sheet = Image.new('RGB', (cols * 960, rows * 540))
for i, n in enumerate(names):
    im = Image.open(f'out/stills/t_{float(n):06.2f}.jpg').resize((960, 540), Image.LANCZOS)
    sheet.paste(im, ((i % cols) * 960, (i // cols) * 540))
sheet.save(sys.argv[1], quality=88)
