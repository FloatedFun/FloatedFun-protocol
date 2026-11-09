"""Derive the FLOATED palette from real pixels. Output: tools/palette.json
Method: k-means (k=9, seed 7) over opaque pixels of each source; each centroid is snapped to
the nearest real pixel in that source and its (x,y) recorded. Nothing is invented."""
import json, numpy as np
from PIL import Image
from sklearn.cluster import KMeans
SRC = {
  'logo': 'brand/LOGO FLOATED PNG...png',
  'banner': 'reference/SAMPUL FLOATED JPG.jpg.jpeg',
}
out = {}
for name, path in SRC.items():
    im = Image.open(path).convert('RGBA'); a = np.array(im)
    ys, xs = np.nonzero(a[..., 3] == 255)
    px = a[ys, xs, :3].astype(float)
    rng = np.random.RandomState(7)
    idx = rng.choice(len(px), min(60000, len(px)), replace=False)
    km = KMeans(9, n_init=4, random_state=7).fit(px[idx])
    lab = km.predict(px)
    res = []
    for k, c in enumerate(km.cluster_centers_):
        d = ((px - c) ** 2).sum(1); j = int(d.argmin())
        r, g, b = (int(v) for v in px[j])
        res.append({'hex': '#%02x%02x%02x' % (r, g, b), 'x': int(xs[j]), 'y': int(ys[j]),
                    'share': round(float((lab == k).mean()), 4)})
    # bright pixels never win k-means by share; take real highlight pixels too
    lum = px @ np.array([.2126, .7152, .0722])
    for q in (99.9, 99):
        t = np.percentile(lum, q); j = int(np.argmin(abs(lum - t)))
        r, g, b = (int(v) for v in px[j])
        res.append({'hex': '#%02x%02x%02x' % (r, g, b), 'x': int(xs[j]), 'y': int(ys[j]), 'share': 0, 'note': 'luminance p%s' % q})
    res.sort(key=lambda r: int(r['hex'][1:3], 16) * .2126 + int(r['hex'][3:5], 16) * .7152 + int(r['hex'][5:7], 16) * .0722)
    out[name] = {'file': path, 'size': im.size, 'colors': res}
json.dump(out, open('tools/palette.json', 'w'), indent=1)
for n, v in out.items():
    print(n)
    for c in v['colors']: print(' ', c)
