"""The magic barrier and the weather assets -> export/barrier.json, export/ui/*.png, export/audio/*.wav

The barrier is Gothic 1's dome over the valley (MAGICFRONTIER_OUT.MSH). Gothic's engine draws it itself, with the
BARRIERE texture, and fires lightning bolts (THUNDER_A0..A3) across it with the MFX_BARRIERE_* sounds.
Weather: Gothic's rain clouds (SKYRAINCLOUDS) and the rain loop (RAIN_01, exported by export_audio.py).
"""
from common import *
import json, os
from PIL import Image

vfs = mount()
S = 0.01
os.makedirs(os.path.join(OUT, 'ui'), exist_ok=True)

# dome: triangles in game space (metres, z mirrored like the world), with the mesh's own UVs
m = zenkit.Mesh.load(vfs.find('MAGICFRONTIER_OUT.MSH').open())
P = [(round(q.x * S, 2), round(q.y * S, 2), round(-q.z * S, 2)) for q in m.positions]
pos, uv = [], []
for poly in m.polygons:
    idx, fi = poly.position_indices, poly.feature_indices
    for k in range(1, len(idx) - 1):
        for j in (0, k, k + 1):
            pos += P[idx[j]]; t = m.features[fi[j]].texture; uv += [round(t.x, 4), round(t.y, 4)]
json.dump({'p': pos, 'u': uv}, open(os.path.join(OUT, 'barrier.json'), 'w'), separators=(',', ':'))
print('barrier tris', len(pos) // 9)

for name in ['BARRIERE', 'THUNDER_A0', 'THUNDER_A1', 'THUNDER_A2', 'THUNDER_A3', 'SKYRAINCLOUDS']:
    t = zenkit.Texture.load(vfs.find(name + '-C.TEX').open())
    Image.frombytes('RGBA', (t.width, t.height), t.mipmap_rgba(0)).save(os.path.join(OUT, 'ui', name + '.png'))
    print(name, t.width, t.height)
