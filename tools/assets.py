"""Generate raster + favicon assets from brand/ and reference/. Output goes to src/assets and src/brand.
The RGBA logo has 3.18M fully transparent pixels stored as pure black (0,0,0,0), so every resize
runs on premultiplied pixels (RGBa) to keep dark fringes out of the edges."""
import json, os
import numpy as np
from PIL import Image
LOGO = 'brand/LOGO FLOATED PNG...png'
BANNER = 'reference/SAMPUL FLOATED JPG.jpg.jpeg'
pal = json.load(open('tools/palette.json'))
os.makedirs('src/assets', exist_ok=True); os.makedirs('src/brand', exist_ok=True)

im = Image.open(LOGO).convert('RGBA')
bb = im.getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox()
side = max(bb[2] - bb[0], bb[3] - bb[1]); pad = round(side * 0.02)
cx, cy = (bb[0] + bb[2]) // 2, (bb[1] + bb[3]) // 2
h = side // 2 + pad
crop = im.crop((cx - h, cy - h, cx + h, cy + h))
print('logo bbox', bb, 'crop', crop.size)

def pm_resize(img, n):
    return img.convert('RGBa').resize((n, n), Image.LANCZOS).convert('RGBA')

for n, p in ((192, 'src/assets/logo-192.png'), (512, 'src/assets/logo-512.png'), (180, 'src/assets/apple-touch-icon.png'), (256, 'src/brand/floated-logo.png')):
    pm_resize(crop, n).save(p, optimize=True)

# Favicon: 32x32 cell grid of the real logo, each opaque cell snapped to nearest sampled palette colour.
cells = np.array(pm_resize(crop, 32))
colors = [c['hex'] for c in pal['logo']['colors']]
rgb = np.array([[int(c[i:i+2], 16) for i in (1, 3, 5)] for c in colors])
rects = []
for y in range(32):
    x = 0
    while x < 32:
        if cells[y, x, 3] < 128: x += 1; continue
        k = int(((rgb - cells[y, x, :3]) ** 2).sum(1).argmin()); x2 = x + 1
        while x2 < 32 and cells[y, x2, 3] >= 128 and int(((rgb - cells[y, x2, :3]) ** 2).sum(1).argmin()) == k: x2 += 1
        rects.append((x, y, x2 - x, colors[k])); x = x2
svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">']
svg += ['<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>' % r for r in rects]
svg.append('</svg>')
s = '\n'.join(svg); assert '--' not in s
open('src/assets/favicon.svg', 'w').write(s)
print('favicon rects', len(rects))

# Hero art + share image from the banner (opaque JPEG, no alpha work needed).
b = Image.open(BANNER).convert('RGB')
b.crop((0, 0, 1500, 170)).save('src/assets/hero-beams.jpg', quality=80, optimize=True, progressive=True)
w = round(630 * b.width / b.height); bs = b.resize((w, 630), Image.LANCZOS); l = (w - 1200) // 2
bs.crop((l, 0, l + 1200, 630)).save('src/assets/og.jpg', quality=82, optimize=True)
for f in sorted(os.listdir('src/assets')): print(f, os.path.getsize('src/assets/' + f))
