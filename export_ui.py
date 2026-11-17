"""Gothic's HUD graphics and bitmap fonts -> export/ui/*.png + export/ui/fonts.json

Fonts are a texture atlas (<NAME>-C.TEX) plus a .FNT table: 256 glyphs indexed by Windows-1252 code, each with a
pixel width and the UV corners of its cell. *_HI fonts are the highlighted variants (selected dialogue choice).
"""
from common import *
import json, os
from PIL import Image

vfs = mount()
os.makedirs('export/ui', exist_ok=True)
TEXTURES = ['BAR_BACK', 'BAR_HEALTH', 'DLG_CONVERSATION',
            'SKYDAY_LAYER0_A0', 'SKYDAY_LAYER1_A0', 'UNSUN5']  # day sky: cloud layer, sky layer, sun
FONTS = ['FONT_OLD_10_WHITE', 'FONT_OLD_10_WHITE_HI', 'FONT_OLD_20_WHITE', 'FONT_OLD_20_WHITE_HI']


def save_tex(name):
    f = vfs.find(name + '-C.TEX')
    if not f:
        print('missing', name); return None
    t = zenkit.Texture.load(f.open())
    Image.frombytes('RGBA', (t.width, t.height), t.mipmap_rgba(0)).save(f'export/ui/{name}.png')
    return t.width, t.height


for n in TEXTURES:
    print(n, save_tex(n))
fonts = {}
for n in FONTS:
    f = vfs.find(n + '.FNT')
    if not f:
        print('missing', n); continue
    fn = zenkit.Font.load(f.open())
    tex = fn.name.upper().rsplit('.', 1)[0]  # the _HI fonts may share or have their own atlas
    size = save_tex(tex)
    fonts[n] = {'tex': tex, 'size': size, 'height': fn.height,
                'glyphs': [[round(g.top_left.x, 6), round(g.top_left.y, 6), round(g.bottom_right.x, 6), round(g.bottom_right.y, 6), g.width] for g in fn.glyphs]}
    print(n, 'height', fn.height, 'atlas', tex, size)
json.dump(fonts, open('export/ui/fonts.json', 'w'), separators=(',', ':'))
