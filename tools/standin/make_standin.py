"""Stand-in assets: original placeholder content in exactly the formats export/ has, so the game runs from a plain
clone of the repository (development, tests, CI) without a Gothic install. Writes standin/, which is committed.

    python tools/standin/make_standin.py

Nothing here is taken from Gothic: geometry, skeleton, animations, textures, fonts (rendered from Pillow's bundled
free font) and sounds are generated. Names of files, clips, bones, waypoints and NPC ids match what web/game.js asks
for, so the same code paths run. NPC stats mirror the extracted data so fights balance the same while developing.
Dialogue is the authored story in dialogue/arena.json, with these placeholder names. Its voice lines
(standin/audio/VO_*.wav) come from tools/standin/voice_standin.py (stock Piper voices); this script leaves them alone.
Needs numpy and Pillow only; deterministic (fixed seed), so re-running gives identical files.
"""
import json, math, os, struct, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'standin')
rng = np.random.default_rng(1234)
for d in ('tex', 'ui', 'audio'): os.makedirs(os.path.join(OUT, d), exist_ok=True)


def save_json(name, obj):
    json.dump(obj, open(os.path.join(OUT, name), 'w'), separators=(',', ':'))


# ================================================================== textures
def noise(w, h, scales=(4, 8, 16, 32), seed=None):
    """value noise in [0,1]: random grids of a few sizes, smoothly upscaled and summed (tileable)"""
    r = np.random.default_rng(seed) if seed is not None else rng
    acc = np.zeros((h, w)); tot = 0
    for i, s in enumerate(scales):
        g = r.random((s, s)); g = np.tile(g, (2, 2))  # tile so the bicubic upscale wraps cleanly
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w * 2, h * 2), Image.BICUBIC)
        a = np.asarray(im, float)[:h, :w] / 255; amp = 1 / (i + 1); acc += a * amp; tot += amp
    return acc / tot


def colorize(n, c0, c1):
    c0, c1 = np.array(c0, float), np.array(c1, float)
    return (c0 + (c1 - c0) * n[..., None]).clip(0, 255).astype(np.uint8)


def save_tex(name, arr, folder='tex'):
    Image.fromarray(arr).save(os.path.join(OUT, folder, name + '.png'), optimize=True)


def planks(w, h, c0, c1, n_planks=4, vertical=True):
    n = noise(w, h, (2, 4, 32, 64))
    grain = noise(w, h, (64, 128)) if vertical else noise(w, h, (64, 128)).T[:h, :w]
    img = colorize(n * 0.5 + grain * 0.5, c0, c1).astype(float)
    step = (w if vertical else h) // n_planks
    for i in range(n_planks):  # dark gaps between planks
        if vertical: img[:, i * step:i * step + 2] *= 0.45
        else: img[i * step:i * step + 2, :] *= 0.45
    return img.clip(0, 255).astype(np.uint8)


def make_textures():
    save_tex('SI_GROUND_EARTH', colorize(noise(256, 256), (70, 66, 40), (122, 116, 70)))
    save_tex('SI_PIT_SAND', colorize(noise(256, 256, (8, 16, 64)), (150, 128, 92), (196, 172, 128)))
    save_tex('SI_WALL_WOOD', planks(128, 128, (72, 52, 34), (120, 90, 58), 4, True))
    save_tex('SI_ROOF_PLANK', planks(128, 128, (60, 48, 36), (96, 80, 58), 5, False))
    save_tex('SI_DOOR_WOOD', planks(128, 256, (88, 60, 36), (140, 100, 62), 3, True))
    stone = colorize(noise(128, 128, (4, 8, 32)), (86, 86, 84), (140, 138, 130)).astype(float)
    for y in range(0, 128, 32): stone[y:y + 2, :] *= 0.5  # mortar courses
    for y in range(0, 128, 32):
        off = 0 if (y // 32) % 2 == 0 else 32
        for x in range(off, 128, 64): stone[y:y + 32, x:x + 2] *= 0.5
    save_tex('SI_PITWALL_STONE', stone.clip(0, 255).astype(np.uint8))
    save_tex('SI_CRATE_WOOD', planks(128, 128, (110, 82, 46), (160, 124, 74), 4, False))
    # characters: cloth per outfit, skin, a face, hair, boots, metal, grip
    outfits = {'GRDM': ((86, 26, 24), (150, 50, 44)), 'GRDL': ((110, 70, 50), (170, 110, 80)), 'GRDS': ((48, 48, 52), (96, 92, 96)),
               'STTM': ((36, 30, 26), (80, 66, 52)), 'SLDM': ((50, 62, 80), (96, 112, 136)), 'TPLL': ((120, 104, 70), (180, 160, 110)),
               'BODY_COOKSMITH': ((190, 186, 176), (236, 232, 222))}
    for k, (a, b) in outfits.items():
        img = colorize(noise(64, 64, (4, 16, 32)), a, b).astype(float)
        img[28:34, :] = img[28:34, :] * 0.35 + 30  # a belt band, so armour reads as more than a flat colour
        save_tex('SI_CLOTH_' + k, img.clip(0, 255).astype(np.uint8))
    save_tex('SI_SKIN', colorize(noise(32, 32, (2, 4)), (176, 128, 100), (210, 160, 130)))
    face = Image.fromarray(colorize(noise(64, 64, (2, 4)), (176, 128, 100), (210, 160, 130))); d = ImageDraw.Draw(face)
    for x in (18, 40): d.rectangle([x, 22, x + 6, 26], fill=(40, 30, 26)); d.rectangle([x - 2, 17, x + 8, 18], fill=(70, 50, 36))
    d.rectangle([29, 30, 34, 40], fill=(160, 112, 88)); d.rectangle([23, 46, 41, 48], fill=(110, 60, 52))
    face.save(os.path.join(OUT, 'tex', 'SI_FACE.png'))
    save_tex('SI_HAIR', colorize(noise(32, 32, (8, 16)), (30, 22, 16), (70, 52, 34)))
    save_tex('SI_BOOTS', colorize(noise(32, 32, (4, 8)), (40, 30, 22), (74, 56, 40)))
    save_tex('SI_METAL', colorize(noise(32, 64, (2, 8)), (150, 154, 160), (220, 224, 230)))
    save_tex('SI_GRIP', colorize(noise(32, 32, (4, 16)), (50, 34, 22), (90, 62, 40)))


# ================================================================== geometry helpers
def oriented(a, b, c, want):
    """triangle a,b,c with its winding flipped if needed so its normal points along `want` (front face = CCW)"""
    n = np.cross(np.subtract(b, a), np.subtract(c, a))
    return (a, b, c) if np.dot(n, want) >= 0 else (a, c, b)


def box_faces(lo, hi):
    """the 6 faces of an axis-aligned box as (4 corners, outward normal)"""
    x0, y0, z0 = lo; x1, y1, z1 = hi
    return [([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
            ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
            ([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], (0, 1, 0)),
            ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
            ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
            ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1))]


def quad_uv(corners, normal, scale):
    """world-space UVs for a quad: planar projection on the face's plane, `scale` metres per texture repeat"""
    n = np.abs(normal); ax = int(np.argmax(n))
    uaxis, vaxis = [(2, 1), (0, 2), (0, 1)][ax]
    return [(c[uaxis] / scale, c[vaxis] / scale) for c in corners]


# ================================================================== world
class World:
    def __init__(self):
        self.groups = {}  # (tex, flag) -> {'p','u','c'}

    def tri(self, tex, pts, uvs, light, want=None, flag=''):
        g = self.groups.setdefault((tex, flag), {'p': [], 'u': [], 'c': []})
        if want is not None:
            n = np.cross(np.subtract(pts[1], pts[0]), np.subtract(pts[2], pts[0]))
            if np.dot(n, want) < 0: pts = [pts[0], pts[2], pts[1]]; uvs = [uvs[0], uvs[2], uvs[1]]
        for p, uv in zip(pts, uvs):
            g['p'] += [float(v) for v in p]; g['u'] += [float(uv[0]), float(uv[1])]; g['c'] += list(light)

    def quad(self, tex, corners, normal, light, scale=2.0, uvs=None, flag=''):
        uvs = uvs or quad_uv(corners, normal, scale)
        self.tri(tex, [corners[0], corners[1], corners[2]], [uvs[0], uvs[1], uvs[2]], light, normal, flag)
        self.tri(tex, [corners[0], corners[2], corners[3]], [uvs[0], uvs[2], uvs[3]], light, normal, flag)

    def box(self, tex, lo, hi, light, scale=1.0, skip=()):
        for i, (c, n) in enumerate(box_faces(lo, hi)):
            if i not in skip: self.quad(tex, c, n, light, scale)

    def write(self, extra):
        blob = bytearray(); meshes = []
        for (tex, flag), g in self.groups.items():
            n = len(g['p']) // 3
            meta = {'tex': tex, 'alpha': False, 'flag': flag, 'n': n, 'p': len(blob)}
            blob += np.array(g['p'], np.float32).tobytes(); meta['u'] = len(blob)
            blob += np.array(g['u'], np.float32).tobytes(); meta['c'] = len(blob)
            blob += np.array(g['c'], np.uint8).tobytes(); blob += b'\0' * (-len(blob) % 4)
            meshes.append(meta)
        open(os.path.join(OUT, 'world.bin'), 'wb').write(bytes(blob))
        save_json('world.json', {'meshes': meshes, 'center': [0, 0, 0], **extra})
        return sum(m['n'] for m in meshes) // 3, len(blob)


PIT_R, PIT_Y = 9.5, -1.3          # the arena: a sunken sand floor inside a stone wall, rim at y = 0
RAMP = (170, 190)                 # degrees: the ramp down into the pit (a gap in the wall)
OUT_LIGHT, IN_LIGHT, DARK = (214, 208, 196), (78, 70, 60), (52, 46, 40)


def ground_h(r, th):
    if r <= PIT_R: return PIT_Y
    hills = max(0.0, r - 34) / 30
    return hills * hills * 3.2 + 0.35 * math.sin(th * 3 + r * 0.15) * min(1, max(0, r - 34) / 10)


def polar(r, deg, y): t = math.radians(deg); return (r * math.cos(t), y, r * math.sin(t))


def build_world():
    W = World(); S = 72; step = 360 / S
    floor_r = [0, 1.5, 3, 4.5, 6, 7.5, PIT_R]
    outer_r = [PIT_R, 11, 13, 16, 20, 25, 30, 36, 44, 54, 66, 80]
    for rings, tex, light in ((floor_r, 'SI_PIT_SAND', OUT_LIGHT), (outer_r, 'SI_GROUND_EARTH', OUT_LIGHT)):
        for k in range(len(rings) - 1):
            r0, r1 = rings[k], rings[k + 1]
            for i in range(S):
                a0, a1 = i * step, (i + 1) * step
                h = lambda r, a: PIT_Y if tex == 'SI_PIT_SAND' else (0.0 if r <= 30 else ground_h(r, math.radians(a)))
                p00, p01, p10, p11 = polar(r0, a0, h(r0, a0)), polar(r0, a1, h(r0, a1)), polar(r1, a0, h(r1, a0)), polar(r1, a1, h(r1, a1))
                uv = lambda p: (p[0] / 4, p[2] / 4)
                if r0 == 0: W.tri(tex, [p00, p10, p11], [uv(p00), uv(p10), uv(p11)], light, (0, 1, 0)); continue
                W.tri(tex, [p00, p10, p11], [uv(p00), uv(p10), uv(p11)], light, (0, 1, 0))
                W.tri(tex, [p00, p11, p01], [uv(p00), uv(p11), uv(p01)], light, (0, 1, 0))
    # the pit wall (faces inward), with a gap where the ramp comes down
    for i in range(S):
        a0, a1 = i * step, (i + 1) * step
        if a0 >= RAMP[0] and a1 <= RAMP[1]: continue
        c = [polar(PIT_R, a0, PIT_Y), polar(PIT_R, a1, PIT_Y), polar(PIT_R, a1, 0.0), polar(PIT_R, a0, 0.0)]
        mid = polar(1, (a0 + a1) / 2, 0); inward = (-mid[0], 0, -mid[2])
        L = 2 * math.pi * PIT_R / S
        W.quad('SI_PITWALL_STONE', c, inward, (170, 166, 156), uvs=[(i * L / 2, 0), ((i + 1) * L / 2, 0), ((i + 1) * L / 2, 0.65), (i * L / 2, 0.65)])
    # the ramp: from the pit floor up to the rim, with stone sides
    lo, hi = 5.0, PIT_R
    ramp = [polar(lo, RAMP[0], PIT_Y), polar(lo, RAMP[1], PIT_Y), polar(hi, RAMP[1], 0.0), polar(hi, RAMP[0], 0.0)]
    W.quad('SI_PIT_SAND', ramp, (0, 1, 0), OUT_LIGHT, 3.0)
    for a in RAMP:
        side = [polar(lo, a, PIT_Y), polar(hi, a, PIT_Y), polar(hi, a, 0.0)]
        out = polar(1, a + (90 if a == RAMP[1] else -90), 0)
        W.tri('SI_PITWALL_STONE', side, [(0, 0), (2, 0), (2, 0.65)], (150, 146, 136), out)
    # huts with doors, crates at the climbing heights, benches, torches
    doors, lights = [], []
    for ang, r, locked in ((95, 21, False), (30, 22, True), (300, 21, False)):
        doors.append(hut(W, ang, r, locked))
    for ang, r, h in ((228, 17, 0.9), (240, 17.5, 1.5), (252, 18, 2.4)):  # low / mid / hang-and-pull-up climbs
        cx, _, cz = polar(r, ang, 0); W.box('SI_CRATE_WOOD', (cx - 0.8, 0, cz - 0.8), (cx + 0.8, h, cz + 0.8), (196, 188, 172), 1.0)
    for ang, r in ((262, 15.6), (292, 18.2)):  # benches beside the bench waypoints
        cx, _, cz = polar(r, ang, 0); W.box('SI_WALL_WOOD', (cx - 0.9, 0, cz - 0.25), (cx + 0.9, 0.45, cz + 0.25), (180, 170, 156), 1.0)
    for ang in (150, 210, 330, 30):  # torches on posts at the rim
        cx, _, cz = polar(PIT_R + 0.8, ang, 0); W.box('SI_WALL_WOOD', (cx - 0.07, 0, cz - 0.07), (cx + 0.07, 1.9, cz + 0.07), (170, 160, 150), 1.0)
        lights.append({'p': [round(cx, 2), 2.05, round(cz, 2)], 'c': [255, 170, 90], 'r': 9.0, 'flicker': True})
    return W, doors, lights


DOOR_W, DOOR_H = 1.1, 2.1


def hut(W, ang, r, locked):
    """a plank hut facing the arena: walls (both sides), a walkable roof, a dark interior, a doorway with a door"""
    cx, _, cz = polar(r, ang, 0)
    f = np.array([-math.cos(math.radians(ang)), 0, -math.sin(math.radians(ang))])  # local +z: towards the arena
    s = np.cross([0, 1, 0], f)                                                       # local +x
    P = lambda x, y, z: tuple(np.array([cx, 0, cz]) + s * x + np.array([0, y, 0]) + f * z)
    w, d, h = 2.5, 2.0, 2.7
    def wall(x0, x1, z, y0, y1, out):  # a wall piece along x at local z, outer face towards `out` (+1/-1 along z)
        c = [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)]
        n = tuple(f * out); W.quad('SI_WALL_WOOD', c, n, OUT_LIGHT, 1.5); W.quad('SI_WALL_WOOD', c, tuple(-np.array(n)), IN_LIGHT, 1.5)
    def side(x, out):
        c = [P(x, 0, -d), P(x, 0, d), P(x, h, d), P(x, h, -d)]
        n = tuple(s * out); W.quad('SI_WALL_WOOD', c, n, OUT_LIGHT, 1.5); W.quad('SI_WALL_WOOD', c, tuple(-np.array(n)), IN_LIGHT, 1.5)
    wall(-w, w, -d, 0, h, -1); side(-w, -1); side(w, 1)
    dw = DOOR_W / 2
    wall(-w, -dw, d, 0, h, 1); wall(dw, w, d, 0, h, 1); wall(-dw, dw, d, DOOR_H, h, 1)  # front: around the doorway
    roof = [P(-w - 0.3, h, -d - 0.3), P(w + 0.3, h, -d - 0.3), P(w + 0.3, h, d + 0.3), P(-w - 0.3, h, d + 0.3)]
    W.quad('SI_ROOF_PLANK', roof, (0, 1, 0), (224, 216, 200), 2.0); W.quad('SI_ROOF_PLANK', roof, (0, -1, 0), DARK, 2.0)
    floor = [P(-w, 0.03, -d), P(w, 0.03, -d), P(w, 0.03, d), P(-w, 0.03, d)]
    W.quad('SI_WALL_WOOD', floor, (0, 1, 0), IN_LIGHT, 1.5)
    # the door: a leaf in hinge space, and one hinge matrix per frame for opening (into the hut) and closing
    # a y-rotation by `a` maps +x to (cos a, 0, -sin a): pick the angle that lays the shut leaf along the hut's +x
    hinge = np.array(P(-dw, 0, d)); yaw = math.atan2(-s[2], s[0])
    def mats(a0, a1, n=24):
        out = []
        for i in range(n):
            t = i / (n - 1); t = t * t * (3 - 2 * t); a = yaw + math.radians(a0 + (a1 - a0) * t)
            c, sn = math.cos(a), math.sin(a)
            M = np.array([[c, 0, sn, hinge[0]], [0, 1, 0, hinge[1]], [-sn, 0, c, hinge[2]], [0, 0, 0, 1]])
            out.append([round(float(v), 5) for v in M.T.flatten()])
        return out
    # rotating by -yaw about y maps world +x onto the leaf; opening swings the free edge into the hut (-f)
    test = np.array([math.cos(yaw + math.radians(80)), 0, -math.sin(yaw + math.radians(80))])
    sign = 1 if np.dot(test, f) < 0 else -1
    return {'locked': locked, 'light': [176, 166, 150], 'p': [round(float(v), 2) for v in hinge],
            'open': mats(0, 88 * sign), 'close': mats(88 * sign, 0)}


def door_mesh():
    """the door leaf in hinge space (metres): planks from the hinge (x = 0) to the free edge, both faces"""
    parts = {'p': [], 'u': []}
    for c, n in box_faces((0.02, 0, -0.035), (DOOR_W - 0.02, DOOR_H, 0.035)):
        a, b, cc, d = c
        tris = [oriented(a, b, cc, n), oriented(a, cc, d, n)]
        for t in tris:
            for p in t:
                parts['p'] += [round(v, 3) for v in p]
                parts['u'] += [round(p[0] / DOOR_W, 3) if abs(n[0]) < 0.5 else round(p[2] * 4, 3), round(1 - p[1] / DOOR_H, 3)]
    return [{'tex': 'SI_DOOR_WOOD', **parts}]


def waypoints():
    wp = {}
    for i in range(9): wp[f'OCR_ARENA_0{i + 1}'] = polar(6.5 + (i % 3) * 0.6, i * 40 + 10, PIT_Y)
    for name, ang, r in (('OCR_OUTSIDE_ARENA', 200, 12.0), ('OCR_OUTSIDE_ARENA_01', 230, 11.8), ('OCR_OUTSIDE_ARENA_BENCH1', 262, 14.6),
                         ('OCR_OUTSIDE_ARENA_BENCH2', 292, 17.2), ('OCR_OUTSIDE_ARENA_HANGAROUND', 160, 15.7),
                         ('OCR_OUTSIDE_ARENA_BARONS_HUT', 120, 11.5), ('OCR_ARENA_BARONS_HUT', 95, 13.0)):
        wp[name] = polar(r, ang, 0.0)
    return [{'n': k, 'x': round(v[0], 3), 'y': round(v[1], 3), 'z': round(v[2], 3)} for k, v in wp.items()]


def barrier():
    """a dome over the whole valley (much bigger than the playable area), lat/long grid with planar-ish UVs"""
    p, u = [], []; LAT, LON = 10, 32
    def pt(i, j):
        th = j / LON * 2 * math.pi; ph = (i / LAT) * (math.pi / 2 + 0.15) - 0.15
        return (650 * math.cos(ph) * math.cos(th), 370 * math.sin(ph) - 20, 550 * math.cos(ph) * math.sin(th))
    for i in range(LAT):
        for j in range(LON):
            q = [pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)]
            for k in (0, 1, 2, 0, 2, 3):
                p += [round(v, 1) for v in q[k]]; u += [round(q[k][0] / 400, 3), round(q[k][2] / 400, 3)]
    save_json('barrier.json', {'p': p, 'u': u})


# ================================================================== characters
# A 23-bone biped with Gothic-style bone names (the game looks some of them up by name). Rest pose: arms hanging,
# every body bone's rest rotation identity, so animation rotations are plain local rotations. Model space: y up,
# facing -z, the character's right at +x. ZS_* are attachment slots (weapon in hand, sheathed at the hip / on the back).
BONES = [  # name, parent, offset from parent (m), rest rotation (deg, XYZ)
    ('BIP01', -1, (0, 0.95, 0), None), ('BIP01 SPINE', 0, (0, 0.08, 0), None), ('BIP01 SPINE2', 1, (0, 0.27, 0), None),
    ('BIP01 NECK', 2, (0, 0.25, 0), None), ('BIP01 HEAD', 3, (0, 0.08, 0), None),
    ('BIP01 L UPPERARM', 2, (-0.2, 0.2, 0), None), ('BIP01 L FOREARM', 5, (0, -0.3, 0), None), ('BIP01 L HAND', 6, (0, -0.27, 0), None),
    ('BIP01 R UPPERARM', 2, (0.2, 0.2, 0), None), ('BIP01 R FOREARM', 8, (0, -0.3, 0), None), ('BIP01 R HAND', 9, (0, -0.27, 0), None),
    ('BIP01 L THIGH', 0, (-0.1, -0.05, 0), None), ('BIP01 L CALF', 11, (0, -0.43, 0), None), ('BIP01 L FOOT', 12, (0, -0.42, 0), None),
    ('BIP01 R THIGH', 0, (0.1, -0.05, 0), None), ('BIP01 R CALF', 14, (0, -0.43, 0), None), ('BIP01 R FOOT', 15, (0, -0.42, 0), None),
    ('ZS_RIGHTHAND', 10, (0, -0.07, 0), None), ('ZS_LEFTHAND', 7, (0, -0.07, 0), None),
    ('ZS_SWORD', 0, (-0.2, 0.0, 0.04), (-125, 0, 8)), ('ZS_LONGSWORD', 2, (0.05, 0.1, 0.16), (-160, 0, -35)),
    ('ZS_BOW', 2, (0, 0.05, 0.16), (-170, 0, 30)), ('ZS_CROSSBOW', 2, (0, 0.05, 0.16), (-170, 0, -30)),
]
BI = {b[0]: i for i, b in enumerate(BONES)}
BODY_NODES = list(range(17))                  # animated bones (not the slots)
UPPER_NODES = list(range(1, 11))              # overlays: spine, arms, head only (the legs keep the base clip)
STAND_Y = 0.95


def quat_euler(x, y, z):
    """XYZ euler (degrees) -> quaternion (w,x,y,z), three.js's convention (q = qx * qy * qz)"""
    def q(ax, a):
        a = math.radians(a) / 2; v = [math.cos(a), 0, 0, 0]; v[ax] = math.sin(a); return v
    def mul(a, b):
        w1, x1, y1, z1 = a; w2, x2, y2, z2 = b
        return [w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2]
    return mul(mul(q(1, x), q(2, y)), q(3, z))


def mat_from(q, t):
    w, x, y, z = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R; M[:3, 3] = t; return M


def bone_world():
    W_ = []
    for name, par, off, rot in BONES:
        L = mat_from(quat_euler(*(rot or (0, 0, 0))), off)
        W_.append(L if par < 0 else W_[par] @ L)
    return W_


BOX = {  # body boxes at rest, model space: bone, min, max, part ('cloth' | 'skin' | 'boots')
    'pelvis': ('BIP01', (-0.17, 0.84, -0.11), (0.17, 1.03, 0.11), 'cloth'),
    'belly': ('BIP01 SPINE', (-0.16, 1.03, -0.1), (0.16, 1.24, 0.1), 'cloth'),
    'chest': ('BIP01 SPINE2', (-0.21, 1.24, -0.12), (0.21, 1.5, 0.12), 'cloth'),
    'neck': ('BIP01 NECK', (-0.05, 1.48, -0.05), (0.05, 1.57, 0.05), 'skin'),
    'l_up': ('BIP01 L UPPERARM', (-0.28, 1.19, -0.065), (-0.14, 1.52, 0.065), 'cloth'),
    'l_fo': ('BIP01 L FOREARM', (-0.265, 0.92, -0.055), (-0.155, 1.2, 0.055), 'cloth'),
    'l_ha': ('BIP01 L HAND', (-0.255, 0.82, -0.045), (-0.165, 0.93, 0.045), 'skin'),
    'r_up': ('BIP01 R UPPERARM', (0.14, 1.19, -0.065), (0.28, 1.52, 0.065), 'cloth'),
    'r_fo': ('BIP01 R FOREARM', (0.155, 0.92, -0.055), (0.265, 1.2, 0.055), 'cloth'),
    'r_ha': ('BIP01 R HAND', (0.165, 0.82, -0.045), (0.255, 0.93, 0.045), 'skin'),
    'l_th': ('BIP01 L THIGH', (-0.19, 0.47, -0.085), (-0.02, 0.9, 0.085), 'cloth'),
    'l_ca': ('BIP01 L CALF', (-0.175, 0.07, -0.075), (-0.035, 0.48, 0.075), 'boots'),
    'l_fo2': ('BIP01 L FOOT', (-0.175, 0.0, -0.19), (-0.035, 0.1, 0.075), 'boots'),
    'r_th': ('BIP01 R THIGH', (0.02, 0.47, -0.085), (0.19, 0.9, 0.085), 'cloth'),
    'r_ca': ('BIP01 R CALF', (0.035, 0.07, -0.075), (0.175, 0.48, 0.075), 'boots'),
    'r_fo2': ('BIP01 R FOOT', (0.035, 0.0, -0.19), (0.175, 0.1, 0.075), 'boots'),
}


def skin_box(parts, tex, bone, lo, hi, faces=None, uv_full=True):
    """a box rigidly skinned to one bone, appended to the part using `tex`"""
    g = parts.setdefault(tex, {'tex': tex, 'p': [], 'u': [], 'si': [], 'sw': []})
    for k, (c, n) in enumerate(box_faces(lo, hi)):
        if faces is not None and k not in faces: continue
        uvq = [(0, 1), (1, 1), (1, 0), (0, 0)]
        for tri in ((0, 1, 2), (0, 2, 3)):
            a, b, cc = oriented(c[tri[0]], c[tri[1]], c[tri[2]], n)
            for p in (a, b, cc):
                i = c.index(p); g['p'] += [round(v, 4) for v in p]; g['u'] += list(uvq[i])
                g['si'] += [BI[bone], 0, 0, 0]; g['sw'] += [1, 0, 0, 0]


def outfit(key):
    parts = {}
    for bone, lo, hi, kind in BOX.values():
        tex = {'cloth': 'SI_CLOTH_' + key, 'skin': 'SI_SKIN', 'boots': 'SI_BOOTS'}[kind]
        skin_box(parts, tex, bone, lo, hi)
    return list(parts.values())


def head(style):
    parts = {}; wide = 0.025 if style == 'FATBALD' else 0
    lo, hi = (-0.1 - wide, 1.56, -0.11), (0.1 + wide, 1.82, 0.11)
    skin_box(parts, 'SI_SKIN', 'BIP01 HEAD', lo, hi, faces=[0, 1, 2, 3, 4])
    skin_box(parts, 'SI_FACE', 'BIP01 HEAD', lo, hi, faces=[5])                      # the face looks along -z
    if style in ('FIGHTER', 'THIEF', 'PONY'):
        skin_box(parts, 'SI_HAIR', 'BIP01 HEAD', (lo[0] - 0.01, 1.76, -0.115), (hi[0] + 0.01, 1.85, 0.125))
    if style == 'PONY': skin_box(parts, 'SI_HAIR', 'BIP01 HEAD', (-0.03, 1.6, 0.11), (0.03, 1.76, 0.16))
    if style == 'THIEF': skin_box(parts, 'SI_HAIR', 'BIP01 HEAD', (-0.11, 1.62, 0.1), (0.11, 1.8, 0.13))
    if style == 'PSIONIC': skin_box(parts, 'SI_HAIR', 'BIP01 HEAD', (-0.02, 1.82, -0.06), (0.02, 1.87, 0.1))
    return list(parts.values())


def box_part(parts, tex, lo, hi):
    g = parts.setdefault(tex, {'tex': tex, 'p': [], 'u': []})
    for c, n in box_faces(lo, hi):
        uvq = [(0, 1), (1, 1), (1, 0), (0, 0)]
        for tri in ((0, 1, 2), (0, 2, 3)):
            a, b, cc = oriented(c[tri[0]], c[tri[1]], c[tri[2]], n)
            for p in (a, b, cc): g['p'] += [round(v, 4) for v in p]; g['u'] += list(uvq[c.index(p)])


def ranged_mesh(kind):
    """in the hand's space: a bow's limbs run along z (upright when the arm points forward), a crossbow's stock
    along -y (forward along the aiming arm) with its bow across x; ammunition points along -x (the game flies it so)"""
    parts = {}
    if kind == 'bow':
        for i in range(8):  # a curved bow from 8 segments
            z0, z1 = -0.65 + i * 0.1625, -0.65 + (i + 1) * 0.1625; zc = (z0 + z1) / 2; bend = 0.12 * (1 - (zc / 0.65) ** 2)
            box_part(parts, 'SI_GRIP', (-0.015, -bend - 0.015, z0), (0.015, -bend + 0.015, z1))
    elif kind == 'cbow':
        box_part(parts, 'SI_GRIP', (-0.025, -0.55, -0.03), (0.025, 0.12, 0.03))      # stock
        box_part(parts, 'SI_METAL', (-0.32, -0.5, -0.015), (0.32, -0.46, 0.015))     # bow arms
    else:
        L = 0.75 if kind == 'arrow' else 0.4
        box_part(parts, 'SI_GRIP', (-L + 0.08, -0.006, -0.006), (0.06, 0.006, 0.006))  # shaft
        box_part(parts, 'SI_METAL', (-L, -0.015, -0.015), (-L + 0.08, 0.015, 0.015))   # head at -x
        box_part(parts, 'SI_HAIR', (0.0, -0.025, -0.002), (0.06, 0.025, 0.002))         # fletching
    return list(parts.values())


def weapon(blade_len, kind):
    """a weapon in its slot's space: grip at the origin, the blade/head along -z"""
    parts = {}
    def box(tex, lo, hi):
        g = parts.setdefault(tex, {'tex': tex, 'p': [], 'u': []})
        for c, n in box_faces(lo, hi):
            uvq = [(0, 1), (1, 1), (1, 0), (0, 0)]
            for tri in ((0, 1, 2), (0, 2, 3)):
                a, b, cc = oriented(c[tri[0]], c[tri[1]], c[tri[2]], n)
                for p in (a, b, cc): g['p'] += [round(v, 4) for v in p]; g['u'] += list(uvq[c.index(p)])
    grip = 0.22 if blade_len > 1 else 0.13
    box('SI_GRIP', (-0.018, -0.018, -0.02), (0.018, 0.018, grip))
    if kind == 'mace':
        box('SI_GRIP', (-0.02, -0.02, -blade_len), (0.02, 0.02, -0.02))
        box('SI_METAL', (-0.06, -0.06, -blade_len - 0.14), (0.06, 0.06, -blade_len))
    else:
        box('SI_METAL', (-0.1, -0.015, -0.035), (0.1, 0.015, -0.01))                  # crossguard
        box('SI_METAL', (-0.025, -0.006, -blade_len), (0.025, 0.006, -0.035))          # blade
    return list(parts.values())


# ================================================================== animations
def euler_pose_frames(n, fn):
    """per-frame poses from fn(frame) -> {bone: (x,y,z) deg, 'root': (x,y,z)}"""
    return [fn(f) for f in range(n)]


def make_clip(n, fn, nodes=BODY_NODES, fps=25, speed=0.0, ev=None):
    q, root = [], []
    for f in range(n):
        pose = fn(f)
        for b in nodes:
            w, x, y, z = quat_euler(*pose.get(BONES[b][0], (0, 0, 0)))
            q += [round(x, 4), round(y, 4), round(z, 4), round(w, 4)]
        r = pose.get('root', (0, STAND_Y, 0)); root += [round(r[0], 4), round(r[1], 4), round(r[2], 4)]
    c = {'fps': fps, 'n': n, 'nodes': nodes, 'q': q, 'root': root, 'speed': speed}
    if ev: c['ev'] = ev
    return c


def keyed(keys):
    """fn(frame) interpolating key poses [(frame, pose)] linearly (missing bones = rest)"""
    def fn(f):
        for (f0, p0), (f1, p1) in zip(keys, keys[1:]):
            if f0 <= f <= f1:
                t = (f - f0) / max(1, f1 - f0); t = t * t * (3 - 2 * t)
                out = {}
                for k in set(p0) | set(p1):
                    a = p0.get(k, (0, STAND_Y, 0) if k == 'root' else (0, 0, 0)); b = p1.get(k, (0, STAND_Y, 0) if k == 'root' else (0, 0, 0))
                    out[k] = tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
                return out
        return keys[-1][1]
    return fn


def merge(*ps):
    out = {}
    for p in ps: out.update(p)
    return out


IDLE = {'BIP01 L UPPERARM': (0, 0, -7), 'BIP01 R UPPERARM': (0, 0, 7)}
READY = {'BIP01 R UPPERARM': (32, 0, 8), 'BIP01 R FOREARM': (45, 0, 0), 'BIP01 L UPPERARM': (10, 0, -12), 'BIP01 L FOREARM': (20, 0, 0),
         'BIP01 L THIGH': (12, 0, 0), 'BIP01 L CALF': (-18, 0, 0), 'BIP01 R THIGH': (6, 0, 0), 'BIP01 R CALF': (-10, 0, 0), 'root': (0, 0.93, 0)}


def gait(period, swing, knee, arm, lean, bob, crouch=0.0, armed=False, side=False):
    """a locomotion cycle: legs swing in antiphase, knees bend on the forward swing, arms counter-swing"""
    n = max(8, round(period * 25))
    def fn(f):
        ph = 2 * math.pi * f / n; s = math.sin(ph)
        ax = 2 if side else 0  # strafes swing the legs sideways
        lt = [0, 0, 0]; rt = [0, 0, 0]; lt[ax] = swing * s * (-1 if side else 1); rt[ax] = -swing * s * (-1 if side else 1)
        lt[0] += crouch * 40; rt[0] += crouch * 40
        p = {'BIP01 L THIGH': tuple(lt), 'BIP01 R THIGH': tuple(rt),
             'BIP01 L CALF': (-knee * max(0, math.sin(ph + 1.2)) - crouch * 70, 0, 0), 'BIP01 R CALF': (-knee * max(0, -math.sin(ph + 1.2)) - crouch * 70, 0, 0),
             'BIP01 SPINE': (-lean - crouch * 20, 0, 0), 'BIP01 HEAD': (lean * 0.5, 0, 0),
             'BIP01 L UPPERARM': (-arm * s, 0, -8), 'BIP01 L FOREARM': (arm * 0.6 + 10, 0, 0),
             'BIP01 R UPPERARM': (arm * s, 0, 8), 'BIP01 R FOREARM': (arm * 0.6 + 10, 0, 0),
             'root': (0, STAND_Y - crouch * 0.28 - bob * (1 - abs(math.cos(ph))), 0)}
        if armed: p.update({k: v for k, v in READY.items() if k.startswith('BIP01 R ')})
        return p
    return n, fn


def build_anims():
    C = {}
    stand = lambda armed=False: (lambda f: merge(IDLE, {'root': (0, STAND_Y, 0)}, READY if armed else {}))
    C['S_RUN'] = make_clip(2, stand()); C['S_1HRUN'] = make_clip(2, stand(True))
    sneak_idle = lambda armed: (lambda f: merge(IDLE, {'BIP01 SPINE': (-20, 0, 0), 'BIP01 L THIGH': (40, 0, 0), 'BIP01 R THIGH': (40, 0, 0),
                                                       'BIP01 L CALF': (-70, 0, 0), 'BIP01 R CALF': (-70, 0, 0), 'root': (0, STAND_Y - 0.28, 0)},
                                                 {k: v for k, v in READY.items() if k.startswith('BIP01 R ')} if armed else {}))
    C['S_SNEAK'] = make_clip(2, sneak_idle(False)); C['S_1HSNEAK'] = make_clip(2, sneak_idle(True))
    for name, armed in (('', False), ('1H', True)):
        n, fn = gait(0.62, 38, 55, 30, 8, 0.05, armed=armed); C[f'S_{name}RUNL'] = make_clip(n, fn, speed=3.45 if not armed else 3.2)
        n, fn = gait(1.0, 22, 25, 16, 2, 0.02, armed=armed); C[f'S_{name}WALKL'] = make_clip(n, fn, speed=1.43 if not armed else 1.4)
        n, fn = gait(1.3, 18, 20, 8, 0, 0.0, crouch=1.0, armed=armed); C[f'S_{name}SNEAKL'] = make_clip(n, fn, speed=1.0)
        n, fn = gait(0.6, 22, 30, 10, 4, 0.03, armed=armed, side=True)
        C[f'T_{name}RUNSTRAFEL'] = make_clip(n, fn, speed=3.0 if not armed else 2.8); C[f'T_{name}RUNSTRAFER'] = make_clip(n, fn, speed=3.0 if not armed else 2.8)
        n, fn = gait(1.0, 12, 10, 4, 0, 0.0, crouch=1.0, armed=armed, side=True); C[f'T_{name}SNEAKSTRAFEL'] = make_clip(n, fn, speed=0.9)
    n, fn = gait(1.0, 14, 14, 6, 0, 0.01, side=True); C['T_WALKSTRAFEL'] = make_clip(n, fn, speed=1.2); C['T_WALKSTRAFER'] = make_clip(n, fn, speed=1.2)
    # turning on the spot: small steps with the hips twisting towards the turn (the game rotates the hero)
    for name, armed in (('', False), ('1H', True)):
        for side, sgn in (('L', 1), ('R', -1)):
            n, base = gait(0.7, 10, 22, 4, 0, 0.0, armed=armed)
            C[f'T_{name}RUNTURN{side}'] = make_clip(n, lambda f, base=base, sgn=sgn: merge(base(f), {'BIP01 SPINE': (0, 8 * sgn, 0)}))

    # jumping and falling (the game drives the arc; root height is fixed by the code)
    tuck = {'BIP01 L THIGH': (60, 0, 0), 'BIP01 R THIGH': (20, 0, 0), 'BIP01 L CALF': (-80, 0, 0), 'BIP01 R CALF': (-40, 0, 0),
            'BIP01 L UPPERARM': (60, 0, -20), 'BIP01 R UPPERARM': (-20, 0, 20)}
    crouch = {'BIP01 L THIGH': (45, 0, 0), 'BIP01 R THIGH': (45, 0, 0), 'BIP01 L CALF': (-80, 0, 0), 'BIP01 R CALF': (-80, 0, 0),
              'BIP01 SPINE': (-20, 0, 0), 'root': (0, STAND_Y - 0.25, 0)}
    up = {'BIP01 L UPPERARM': (160, 0, -10), 'BIP01 R UPPERARM': (160, 0, 10), 'BIP01 L THIGH': (10, 0, 0), 'BIP01 R THIGH': (10, 0, 0)}
    C['T_RUNL_2_JUMP'] = make_clip(8, keyed([(0, IDLE), (7, tuck)])); C['S_JUMP'] = make_clip(2, keyed([(0, tuck), (1, tuck)]))
    C['T_JUMP_2_STAND'] = make_clip(10, keyed([(0, crouch), (9, IDLE)]))
    C['T_STAND_2_JUMPUP'] = make_clip(10, keyed([(0, IDLE), (4, crouch), (9, up)])); C['S_JUMPUP'] = make_clip(2, keyed([(0, up), (1, up)]))
    fall = {'BIP01 L UPPERARM': (100, 0, -40), 'BIP01 R UPPERARM': (100, 0, 40), 'BIP01 L THIGH': (30, 0, 0), 'BIP01 L CALF': (-50, 0, 0)}
    C['S_FALLDN'] = make_clip(2, keyed([(0, fall), (1, fall)])); C['T_FALLDN_2_STAND'] = make_clip(14, keyed([(0, crouch), (13, IDLE)]))

    # climbing: the root rises by the ledge height the game scales to (low 0.97 m, mid 1.48 m, hang 2.63 m) and ends
    # 0.75 m forward, on top
    def climb(rise, hang=False):
        reach = {'BIP01 L UPPERARM': (165, 0, -8), 'BIP01 R UPPERARM': (165, 0, 8), 'BIP01 L THIGH': (50, 0, 0), 'BIP01 L CALF': (-60, 0, 0)}
        pull = {'BIP01 L UPPERARM': (60, 0, -20), 'BIP01 R UPPERARM': (60, 0, 20), 'BIP01 L FOREARM': (90, 0, 0), 'BIP01 R FOREARM': (90, 0, 0),
                'BIP01 L THIGH': (80, 0, 0), 'BIP01 L CALF': (-110, 0, 0), 'BIP01 SPINE': (-30, 0, 0)}
        y = lambda k: STAND_Y + rise * k
        a = make_clip(6, keyed([(0, merge(IDLE, {'root': (0, STAND_Y, 0)})), (5, merge(crouch, {'root': (0, STAND_Y - 0.1, 0)}))]))
        b = make_clip(8, keyed([(0, merge(reach, {'root': (0, STAND_Y - 0.1, 0)})), (7, merge(reach, {'root': (0, y(0.62), -0.15)}))]))
        c = make_clip(14, keyed([(0, merge(pull, {'root': (0, y(0.62), -0.2)})), (8, merge(pull, {'root': (0, y(0.95), -0.55)})),
                                 (13, merge(IDLE, {'root': (0, y(1.0), -0.75)}))]))
        return a, b, c
    C['T_STAND_2_JUMPUPLOW'], C['S_JUMPUPLOW'], C['T_JUMPUPLOW_2_STAND'] = climb(0.97)
    C['T_STAND_2_JUMPUPMID'], C['S_JUMPUPMID'], C['T_JUMPUPMID_2_STAND'] = climb(1.48)
    hangp = {'BIP01 L UPPERARM': (175, 0, -6), 'BIP01 R UPPERARM': (175, 0, 6), 'BIP01 L THIGH': (8, 0, 0), 'BIP01 R THIGH': (-4, 0, 0)}
    rise = 2.63
    C['T_JUMP_2_HANG'] = make_clip(16, keyed([(0, merge(up, {'root': (0, STAND_Y + 0.1, 0)})), (15, merge(hangp, {'root': (0, STAND_Y + 0.85, -0.3)}))]))
    C['S_HANG'] = make_clip(2, keyed([(0, merge(hangp, {'root': (0, STAND_Y + 0.85, -0.3)})), (1, merge(hangp, {'root': (0, STAND_Y + 0.85, -0.3)}))]))
    _, _, pullup = climb(rise)
    C['T_HANG_2_STAND'] = make_clip(24, keyed([(0, merge(hangp, {'root': (0, STAND_Y + 0.95, -0.3)})),
                                               (12, {'BIP01 L UPPERARM': (40, 0, -20), 'BIP01 R UPPERARM': (40, 0, 20), 'BIP01 L FOREARM': (100, 0, 0),
                                                     'BIP01 R FOREARM': (100, 0, 0), 'BIP01 L THIGH': (90, 0, 0), 'BIP01 L CALF': (-120, 0, 0),
                                                     'BIP01 SPINE': (-40, 0, 0), 'root': (0, STAND_Y + 2.3, -0.55)}),
                                               (23, merge(IDLE, {'root': (0, STAND_Y + rise, -0.75)}))]))

    # one-handed fighting. Gothic-style events: optimal_frame (the hit), hit_end, combo_window (pairs per segment)
    def chop(f0):
        wind = merge(READY, {'BIP01 R UPPERARM': (155, 0, 10), 'BIP01 R FOREARM': (40, 0, 0), 'BIP01 SPINE': (8, 0, 0)})
        hit = merge(READY, {'BIP01 R UPPERARM': (55, 0, 6), 'BIP01 R FOREARM': (5, 0, 0), 'BIP01 SPINE': (-18, 0, 0),
                            'BIP01 L THIGH': (30, 0, 0), 'BIP01 L CALF': (-30, 0, 0)})
        return [(f0, READY), (f0 + 5, wind), (f0 + 9, hit), (f0 + 14, READY)]
    keys = chop(0) + chop(14)[1:] + chop(28)[1:]
    fwd = keyed(keys)
    C['S_1HATTACK'] = make_clip(43, lambda f: merge(fwd(f), {'root': (0, 0.93, -0.12 * min(3, f / 14))}),
                                ev={'optimal_frame': [9, 23, 37], 'hit_end': [14, 28, 42], 'combo_window': [10, 14, 24, 28, 38, 42]})
    for side, sgn in (('L', 1), ('R', -1)):
        start = merge(READY, {'BIP01 R UPPERARM': (85, 0, 70), 'BIP01 R FOREARM': (20, 0, 0), 'BIP01 SPINE': (0, -35 * sgn, 0)})
        end = merge(READY, {'BIP01 R UPPERARM': (85, 0, -15), 'BIP01 R FOREARM': (20, 0, 0), 'BIP01 SPINE': (-10, 40 * sgn, 0)})
        if sgn < 0: start, end = end, start
        C[f'T_1HATTACK{side}'] = make_clip(18, keyed([(0, READY), (5, start), (10, end), (17, READY)]),
                                            ev={'optimal_frame': [9], 'hit_end': [16], 'combo_window': [11, 16]})
    block = merge(READY, {'BIP01 R UPPERARM': (110, 0, 25), 'BIP01 R FOREARM': (40, 0, 0), 'BIP01 R HAND': (0, 0, -80), 'BIP01 SPINE': (5, 0, 0)})
    C['T_1HPARADE_O'] = make_clip(16, keyed([(0, READY), (4, block), (11, block), (15, READY)]))
    hop = merge(READY, {'BIP01 L THIGH': (40, 0, 0), 'BIP01 R THIGH': (40, 0, 0), 'BIP01 L CALF': (-60, 0, 0), 'BIP01 R CALF': (-60, 0, 0)})
    jb = keyed([(0, READY), (5, hop), (12, READY)])
    C['T_1HPARADEJUMPB'] = make_clip(13, lambda f: merge(jb(f), {'root': (0, 0.93 + 0.12 * math.sin(math.pi * f / 12), 0.9 * min(1, f / 12))}))
    # drawing the weapon (an overlay: upper body only): reach to the left hip, grab at frame 9, back to the ready pose
    grab = {'BIP01 R UPPERARM': (25, 0, -35), 'BIP01 R FOREARM': (75, 0, 0), 'BIP01 SPINE': (0, 15, 0)}
    C['T_MOVE_2_1HMOVE'] = make_clip(20, keyed([(0, IDLE), (9, grab), (19, {k: v for k, v in READY.items() if k != 'root'})]),
                                     nodes=UPPER_NODES, ev={'set_fight_mode': [9]})

    # bow and crossbow: carry, draw (overlay, set_fight_mode + munition_place), raise to aim, aim, shoot, reload
    HOLD = {'bow': {'BIP01 L UPPERARM': (20, 0, -10), 'BIP01 L FOREARM': (30, 0, 0)},
            'cbow': {'BIP01 R UPPERARM': (30, 0, 8), 'BIP01 R FOREARM': (60, 0, 0), 'BIP01 L UPPERARM': (35, 0, -5), 'BIP01 L FOREARM': (70, 0, 20)}}
    AIM = {'bow': {'BIP01 L UPPERARM': (90, 0, 0), 'BIP01 L FOREARM': (0, 0, 0), 'BIP01 R UPPERARM': (90, 0, 25), 'BIP01 R FOREARM': (20, 0, 0),
                   'BIP01 SPINE': (0, 25, 0), 'BIP01 HEAD': (0, -20, 0)},
           'cbow': {'BIP01 R UPPERARM': (85, 0, 0), 'BIP01 R FOREARM': (0, 0, 0), 'BIP01 L UPPERARM': (85, 0, 15), 'BIP01 L FOREARM': (15, 0, 25)}}
    for kind, K in (('bow', 'BOW'), ('cbow', 'CBOW')):
        hold, aim = HOLD[kind], AIM[kind]
        held = lambda fn, hold=hold: (lambda f: merge(fn(f), hold))
        C[f'S_{K}RUN'] = make_clip(2, lambda f, hold=hold: merge(IDLE, hold, {'root': (0, STAND_Y, 0)}))
        C[f'S_{K}SNEAK'] = make_clip(2, lambda f, hold=hold: merge(sneak_idle(False)(f), hold))
        n, fn = gait(0.62, 34, 50, 0, 6, 0.04); C[f'S_{K}RUNL'] = make_clip(n, held(fn), speed=3.2)
        n, fn = gait(1.0, 22, 25, 0, 2, 0.02); C[f'S_{K}WALKL'] = make_clip(n, held(fn), speed=1.4)
        n, fn = gait(1.3, 18, 20, 0, 0, 0.0, crouch=1.0); C[f'S_{K}SNEAKL'] = make_clip(n, held(fn), speed=1.0)
        n, fn = gait(0.6, 22, 30, 0, 4, 0.03, side=True)
        C[f'T_{K}RUNSTRAFEL'] = make_clip(n, held(fn), speed=2.8); C[f'T_{K}RUNSTRAFER'] = make_clip(n, held(fn), speed=2.8)
        n, fn = gait(1.0, 12, 10, 0, 0, 0.0, crouch=1.0, side=True); C[f'T_{K}SNEAKSTRAFEL'] = make_clip(n, held(fn), speed=0.9)
        for side, sgn in (('L', 1), ('R', -1)):
            n, fn = gait(0.7, 10, 22, 0, 0, 0.0)
            C[f'T_{K}RUNTURN{side}'] = make_clip(n, lambda f, fn=fn, sgn=sgn, hold=hold: merge(fn(f), hold, {'BIP01 SPINE': (0, 8 * sgn, 0)}))
        base = merge(IDLE, hold, {'root': (0, STAND_Y, 0)}); aimp = merge(base, aim)
        C[f'T_{K}RUN_2_{K}AIM'] = make_clip(10, keyed([(0, base), (9, aimp)]))
        C[f'T_{K}AIM_2_{K}RUN'] = make_clip(10, keyed([(0, aimp), (9, base)]))
        C[f'C_{K}_5'] = make_clip(1, lambda f, aimp=aimp: aimp)
        C[f'S_{K}SHOOT'] = make_clip(2, keyed([(0, merge(aimp, {'BIP01 SPINE': (6, 25 if kind == 'bow' else 0, 0)})), (1, aimp)]))
        reach = merge(aimp, {'BIP01 R UPPERARM': (40, 0, 30), 'BIP01 R FOREARM': (100, 0, 0)} if kind == 'bow'
                      else {'BIP01 L UPPERARM': (40, 0, -10), 'BIP01 L FOREARM': (110, 0, 0)})
        C[f'T_{K}RELOAD'] = make_clip(30, keyed([(0, aimp), (12, reach), (29, aimp)]), ev={'munition_place': [12]})
        over = merge(dict(IDLE), {'BIP01 R UPPERARM': (165, 0, 20), 'BIP01 R FOREARM': (90, 0, 0)} if kind == 'bow'
                     else {'BIP01 L UPPERARM': (160, 0, -15), 'BIP01 R UPPERARM': (160, 0, 15)})
        C[f'T_MOVE_2_{K}MOVE'] = make_clip(18, keyed([(0, IDLE), (7, over), (17, hold)]), nodes=UPPER_NODES, ev={'set_fight_mode': [7], 'munition_place': [9]})
        hopk = keyed([(0, base), (5, merge(base, {'BIP01 L THIGH': (40, 0, 0), 'BIP01 R THIGH': (40, 0, 0), 'BIP01 L CALF': (-60, 0, 0), 'BIP01 R CALF': (-60, 0, 0)})), (12, base)])
        C[f'T_{K}JUMPB'] = make_clip(13, lambda f, hopk=hopk: merge(hopk(f), {'root': (0, STAND_Y + 0.1 * math.sin(math.pi * f / 12), 0.9 * min(1, f / 12))}))

    # hits and knock-downs
    for name, sgn in (('T_STUMBLE', 1), ('T_STUMBLEB', -1)):
        rock = merge(READY, {'BIP01 SPINE': (22 * sgn, 0, 0), 'BIP01 L UPPERARM': (40, 0, -40), 'BIP01 HEAD': (15 * sgn, 0, 0)})
        k = keyed([(0, READY), (4, rock), (13, READY)])
        C[name] = make_clip(14, lambda f, k=k, sgn=sgn: merge(k(f), {'root': (0, 0.93, 0.35 * sgn * min(1, f / 8))}))
    lie = {'BIP01': (82, 0, 0), 'BIP01 L UPPERARM': (30, 0, -50), 'BIP01 R UPPERARM': (30, 0, 50), 'BIP01 L THIGH': (10, 0, -8),
           'BIP01 R THIGH': (25, 0, 6), 'BIP01 R CALF': (-30, 0, 0), 'root': (0, 0.18, 0.4)}
    buckle = merge(crouch, {'BIP01 SPINE': (-35, 0, 0), 'root': (0, STAND_Y - 0.35, 0.1)})
    C['T_STAND_2_WOUNDED'] = make_clip(52, keyed([(0, merge(IDLE, {'root': (0, STAND_Y, 0)})), (20, buckle), (44, lie), (51, lie)]))
    C['S_WOUNDED'] = make_clip(2, keyed([(0, lie), (1, lie)]))
    C['T_WOUNDED_2_STAND'] = make_clip(40, keyed([(0, lie), (18, buckle), (39, merge(IDLE, {'root': (0, STAND_Y, 0)}))]))

    # bystanders: watching the fight (cheer / groan), standing guard, dialogue gestures (overlays)
    watch = merge(IDLE, {'BIP01 L UPPERARM': (35, 0, 22), 'BIP01 L FOREARM': (100, 0, 0), 'BIP01 R UPPERARM': (35, 0, -22),
                         'BIP01 R FOREARM': (100, 0, 0), 'BIP01 HEAD': (12, 0, 0)})
    C['T_STAND_2_WATCHFIGHT'] = make_clip(12, keyed([(0, IDLE), (11, watch)])); C['S_WATCHFIGHT'] = make_clip(2, keyed([(0, watch), (1, watch)]))
    yeah = {'BIP01 R UPPERARM': (170, 0, 10), 'BIP01 R FOREARM': (30, 0, 0), 'BIP01 SPINE': (5, 0, 0)}
    ohno = {'BIP01 L UPPERARM': (150, 0, -10), 'BIP01 L FOREARM': (130, 0, 0), 'BIP01 R UPPERARM': (150, 0, 10), 'BIP01 R FOREARM': (130, 0, 0)}
    W0 = {k: v for k, v in watch.items() if k != 'root'}
    C['T_WATCHFIGHT_YEAH'] = make_clip(24, keyed([(0, W0), (6, yeah), (12, merge(yeah, {'BIP01 R UPPERARM': (140, 0, 10)})), (17, yeah), (23, W0)]), nodes=UPPER_NODES)
    C['T_WATCHFIGHT_OHNO'] = make_clip(24, keyed([(0, W0), (8, ohno), (16, ohno), (23, W0)]), nodes=UPPER_NODES)
    for i in range(1, 5):
        look = merge(W0, {'BIP01 HEAD': (0, (-1) ** i * 35, 0), 'BIP01 SPINE': (0, (-1) ** i * 10, 0)})
        C[f'T_WATCHFIGHTRANDOM{i}'] = make_clip(30, keyed([(0, W0), (10, look), (20, look), (29, W0)]), nodes=UPPER_NODES)
    guard = merge(IDLE, {'BIP01 L UPPERARM': (-25, 0, -15), 'BIP01 L FOREARM': (60, 0, 25), 'BIP01 R UPPERARM': (-25, 0, 15),
                         'BIP01 R FOREARM': (60, 0, -25), 'BIP01 SPINE': (4, 0, 0)})
    C['T_STAND_2_HGUARD'] = make_clip(12, keyed([(0, IDLE), (11, guard)])); C['S_HGUARD'] = make_clip(2, keyed([(0, guard), (1, guard)]))
    for i, (arm, fore) in enumerate(((70, 60), (50, 90), (90, 30), (60, 70)), 1):
        g = {'BIP01 R UPPERARM': (arm, 0, 15), 'BIP01 R FOREARM': (fore, 0, 0), 'BIP01 HEAD': (0, 8 * (-1) ** i, 0)}
        C[f'T_DIALOGGESTURE_{i:02d}'] = make_clip(40, keyed([(0, IDLE), (10, g), (20, merge(g, {'BIP01 R HAND': (0, 0, 30)})), (30, g), (39, IDLE)]), nodes=UPPER_NODES)
    save_json('anims.json', {'clips': C})
    return C


# ================================================================== cast
CAST = [  # id (the game's), stand-in name, role, outfit, head, weapon, two-handed, hp, str, protection (edge/blunt), style
    ('KIRGO', 'Arn', 'arena regular', 'GRDL', 'FATBALD', 'SI_SWORD', 20, 'edge', 160, 30, 45, '1HST1'),
    ('THORUS', 'Captain Brec', 'guard captain', 'GRDS', 'FIGHTER', 'SI_GREATSWORD', 90, 'edge', 280, 100, 70, '1HST2'),
    ('BLOODWYN', 'Dask', 'guard', 'GRDM', 'BALD', 'SI_SWORD', 33, 'edge', 160, 70, 55, '1HST2'),
    ('FLETCHER', 'Ferro', 'guard', 'GRDM', 'THIEF', 'SI_SWORD', 30, 'edge', 220, 70, 55, '1HST2'),
    ('SNAF', 'Tam', 'cook', 'BODY_COOKSMITH', 'FIGHTER', 'SI_MACE', 8, 'blunt', 100, 25, 0, '1HST1'),
    ('WHISTLER', 'Wisp', 'scout', 'STTM', 'PSIONIC', 'SI_SWORD', 14, 'edge', 100, 20, 30, '1HST1'),
    ('KHARIM', 'Kael', 'pit fighter', 'SLDM', 'FATBALD', 'SI_MACE', 25, 'blunt', 172, 70, 55, '1HST2'),
    ('GORHANIS', 'Hanno', 'pit fighter', 'TPLL', 'BALD', 'SI_SWORD', 20, 'edge', 184, 70, 45, '1HST2'),
]
def build_chars():
    outfits = {k: outfit(k) for k in ('GRDM', 'GRDL', 'GRDS', 'STTM', 'SLDM', 'TPLL', 'BODY_COOKSMITH')}
    heads = {k: head(k) for k in ('FIGHTER', 'BALD', 'FATBALD', 'THIEF', 'PSIONIC', 'PONY')}
    weapons = {'sword': weapon(0.85, 'sword'), 'SI_SWORD': weapon(0.85, 'sword'), 'SI_MACE': weapon(0.5, 'mace'), 'SI_GREATSWORD': weapon(1.2, 'sword'),
               'SI_BOW': ranged_mesh('bow'), 'SI_CROSSBOW': ranged_mesh('cbow'), 'SI_ARROW': ranged_mesh('arrow'), 'SI_BOLT': ranged_mesh('bolt')}
    BOW = {'id': 'SI_BOW', 'name': 'Hunting Bow', 'kind': 'bow', 'slot': 'ZS_BOW', 'dmg': 24, 'dtype': 'point', 'ammoId': 'SI_ARROW'}
    XBOW = {'id': 'SI_CROSSBOW', 'name': 'Light Crossbow', 'kind': 'cbow', 'slot': 'ZS_CROSSBOW', 'dmg': 50, 'dtype': 'point', 'ammoId': 'SI_BOLT'}
    RANGED = {'THORUS': (XBOW, 30), 'FLETCHER': (XBOW, 30), 'WHISTLER': (BOW, 10)}   # equipped as the cast is with Gothic
    DEX = {'KIRGO': 15, 'THORUS': 80, 'BLOODWYN': 50, 'FLETCHER': 50, 'SNAF': 15, 'WHISTLER': 15, 'KHARIM': 20, 'GORHANIS': 25}
    bones = []
    for name, par, off, rot in BONES:
        L = mat_from(quat_euler(*(rot or (0, 0, 0))), off)
        bones.append({'name': name, 'parent': par, 'm': [round(float(v), 6) for v in L.T.flatten()]})
    looks = {}
    for cid, name, role, out, hd, wid, dmg, dtype, hp, st, prot, style in CAST:
        two = wid == 'SI_GREATSWORD'
        looks[cid] = {'instance': 'STANDIN_' + cid, 'outfit': out, 'head': hd, 'tex': {}, 'scale': [1, 1, 1], 'fat': 0, 'overlay': None,
                      'weapon': {'id': wid, 'name': wid, 'twoHanded': two, 'dmg': dmg, 'dtype': dtype, 'range': 150 if two else 100},
                      'ranged': {**RANGED[cid][0], 'ammo': RANGED[cid][1]} if cid in RANGED else None, 'dex': DEX[cid],
                      'style': style, 'hp': hp, 'str': st, 'prot': {'edge': prot, 'blunt': prot, 'point': prot // 5} if prot else {}}
    looks['HERO'] = {'instance': 'STANDIN_HERO', 'outfit': 'GRDM', 'head': 'PONY', 'tex': {}}  # the player: ponytail
    items = {'GRD_ARMOR_M': {'prot': {'edge': 55, 'blunt': 55, 'point': 10}}, 'ITMW_1H_SWORD_01': {'dmg': 20, 'dtype': 'edge', 'range': 100},
             'ITRW_CROSSBOW_01': XBOW}
    save_json('chars.json', {'bones': bones, 'outfits': outfits, 'heads': heads, 'weapons': {}, 'weaponsLocal': weapons, 'items': items, 'looks': looks,
                             'nockRot': [0, 0, 90]})  # turns the nocked arrow (-x) along the drawing arm (-y)
    # the same authored story as with Gothic (dialogue/arena.json); {ID} tokens become these stand-in names in game
    sys.path.insert(0, ROOT); from dialogue import tree as story_tree
    story = story_tree.load(); cast = []
    for cid, name, role, *_ in CAST:
        cast.append({'id': cid, 'name': name, 'role': story['cast'].get(cid, {}).get('role', role), 'voice': '00',
                     'topics': story_tree.topics(story, cid) if cid in story['cast'] else [], 'barks': {}})
    save_json('dialogue.json', {'quest': story['quest'], 'cast': cast, 'sfx': SFX})


# ================================================================== UI: fonts and HUD graphics
def cp1252(code):
    try: return bytes([code]).decode('cp1252')
    except UnicodeDecodeError: return None


def make_font(key, size, color, atlas_w):
    """a Gothic-style bitmap font: atlas + 256-entry glyph table [u0, v0, u1, v1, advance] by Windows-1252 code"""
    ft = ImageFont.load_default(size)
    asc, desc = ft.getmetrics(); height = asc + desc + 2
    cells, x, y = [], 1, 1
    for code in range(256):
        ch = cp1252(code) if code >= 32 else None
        if ch is None: cells.append(None); continue
        adv = max(1, round(ft.getlength(ch)))
        if x + adv + 2 > atlas_w: x = 1; y += height + 1
        cells.append((ch, x, y, adv)); x += adv + 2
    atlas_h = 1 << math.ceil(math.log2(y + height + 2))
    img = Image.new('RGBA', (atlas_w, atlas_h), (255, 255, 255, 0)); d = ImageDraw.Draw(img)
    glyphs = []
    for cell in cells:
        if cell is None: glyphs.append([0, 0, 0, 0, 0]); continue
        ch, gx, gy, adv = cell
        d.text((gx, gy + 1), ch, font=ft, fill=color)
        glyphs.append([round(gx / atlas_w, 6), round(gy / atlas_h, 6), round((gx + adv) / atlas_w, 6), round((gy + height) / atlas_h, 6), adv])
    img.save(os.path.join(OUT, 'ui', key + '.png'))
    return {'tex': key, 'size': size, 'height': height, 'glyphs': glyphs}


def lightning(w, h, n_bolts, seed, width=2, glow=6, vertical=False):
    r = np.random.default_rng(seed); img = Image.new('RGB', (w, h)); d = ImageDraw.Draw(img)
    for _ in range(n_bolts):
        if vertical: pts = [(w / 2 + r.normal(0, w * 0.08), 0)]
        else: pts = [(r.uniform(0, w), r.uniform(0, h))]
        for _ in range(14):
            x, y = pts[-1]
            if vertical: pts.append((x + r.normal(0, w * 0.12), y + h / 14))
            else: a = r.uniform(0, 2 * math.pi); pts.append((x + math.cos(a) * w / 9, y + math.sin(a) * h / 9))
        d.line(pts, fill=(60, 90, 255), width=width + glow)
    img = img.filter(ImageFilter.GaussianBlur(glow / 2)); d = ImageDraw.Draw(img)
    r = np.random.default_rng(seed)  # redraw the same bolts' bright cores on top of their glow
    for _ in range(n_bolts):
        if vertical: pts = [(w / 2 + r.normal(0, w * 0.08), 0)]
        else: pts = [(r.uniform(0, w), r.uniform(0, h))]
        for _ in range(14):
            x, y = pts[-1]
            if vertical: pts.append((x + r.normal(0, w * 0.12), y + h / 14))
            else: a = r.uniform(0, 2 * math.pi); pts.append((x + math.cos(a) * w / 9, y + math.sin(a) * h / 9))
        d.line(pts, fill=(220, 235, 255), width=width)
    return img


def build_ui():
    fonts = {'FONT_OLD_10_WHITE': make_font('FONT_OLD_10_WHITE', 14, (236, 228, 210, 255), 512),
             'FONT_OLD_10_WHITE_HI': make_font('FONT_OLD_10_WHITE_HI', 14, (255, 220, 140, 255), 512),
             'FONT_OLD_20_WHITE': make_font('FONT_OLD_20_WHITE', 26, (236, 228, 210, 255), 1024),
             'FONT_OLD_20_WHITE_HI': make_font('FONT_OLD_20_WHITE_HI', 26, (255, 220, 140, 255), 1024)}
    save_json('ui/fonts.json', fonts)
    U = lambda name, img: img.save(os.path.join(OUT, 'ui', name + '.png'))
    back = Image.new('RGBA', (256, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(back)
    d.rounded_rectangle([1, 3, 254, 28], 5, fill=(24, 18, 12, 230), outline=(150, 120, 70, 255), width=3)
    U('BAR_BACK', back)
    fill = np.zeros((32, 256, 4), np.uint8); g = np.linspace(1, 0.55, 32)[:, None]
    fill[..., 0] = (200 * g).astype(np.uint8); fill[..., 1] = (24 * g).astype(np.uint8); fill[..., 2] = (18 * g).astype(np.uint8); fill[..., 3] = 255
    U('BAR_HEALTH', Image.fromarray(fill))
    dlg = np.zeros((16, 16, 4), np.uint8); dlg[..., 3] = (110 + 40 * noise(16, 16, (4, 8))).astype(np.uint8); U('DLG_CHOICE', Image.fromarray(dlg))
    U('SKYDAY_LAYER0_A0', Image.fromarray(colorize(noise(256, 256, (2, 4, 8)), (150, 140, 120), (190, 180, 160))))
    n = noise(256, 256, (4, 8, 16, 32)); cl = np.zeros((256, 256, 4), np.uint8); cl[..., :3] = 245
    cl[..., 3] = (np.clip((n - 0.45) * 3, 0, 1) * 255).astype(np.uint8); U('SKYDAY_LAYER1_A0', Image.fromarray(cl))
    yy, xx = np.mgrid[0:128, 0:128]; rr = np.hypot(xx - 64, yy - 64) / 64
    sun = np.clip(1 - rr, 0, 1) ** 2.2; s = np.zeros((128, 128, 3), np.uint8)
    s[..., 0] = (255 * sun).astype(np.uint8); s[..., 1] = (240 * sun).astype(np.uint8); s[..., 2] = (200 * sun).astype(np.uint8); U('UNSUN5', Image.fromarray(s))
    U('BARRIERE', lightning(256, 256, 7, 11))
    for i in range(4): U(f'THUNDER_A{i}', lightning(128, 256, 1, 40 + i, width=3, glow=8, vertical=True))
    U('SKYRAINCLOUDS', Image.fromarray(colorize(noise(256, 256, (4, 8, 16)), (60, 64, 68), (120, 124, 128))))


# ================================================================== sounds (synthesised)
SR = 22050
SFX = ['SWORD_DRAW_01', 'SWORD_DRAW_02', 'SWORD_UNDRAW_01', 'M_FALL_SMALL01', *[f'CS_IAI_ME_ME_0{i}' for i in range(1, 10)],
       *[f'CS_IAM_UD_FL_0{i}' for i in range(1, 6)], *[f'STEP_{m}_0{i}' for m in ('EARTH', 'STONE', 'WOOD', 'SAND') for i in range(1, 6)]]


def wav(name, x):
    x = np.clip(x, -1, 1); w = wave.open(os.path.join(OUT, 'audio', name + '.wav'), 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32000).astype(np.int16).tobytes()); w.close()


def lowpass(x, k):
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += k * (v - acc); y[i] = acc
    return y


def build_audio():
    r = np.random.default_rng(99); t = lambda s: np.arange(int(SR * s)) / SR
    for m, (k, dur, gain) in {'EARTH': (0.12, 0.12, 1.4), 'STONE': (0.5, 0.08, 0.9), 'WOOD': (0.25, 0.1, 1.2), 'SAND': (0.08, 0.16, 1.5)}.items():
        for i in range(1, 6):
            tt = t(dur); x = lowpass(r.normal(0, 1, tt.size), k * r.uniform(0.8, 1.2)) * np.exp(-tt * 40) * gain
            if m == 'WOOD': x += 0.3 * np.sin(2 * math.pi * r.uniform(180, 240) * tt) * np.exp(-tt * 60)
            wav(f'STEP_{m}_0{i}', x)
    for i in range(1, 10):  # weapon on weapon: an inharmonic metallic ring
        tt = t(0.7); f0 = r.uniform(900, 1500)
        x = sum(np.sin(2 * math.pi * f0 * m_ * tt) * np.exp(-tt * (6 + 3 * m_)) / m_ for m_ in (1, 2.76, 5.4, 8.9))
        wav(f'CS_IAI_ME_ME_0{i}', 0.5 * x + 0.3 * r.normal(0, 1, tt.size) * np.exp(-tt * 80))
    for i in range(1, 6):  # weapon on flesh: a dull thud
        tt = t(0.25); x = lowpass(r.normal(0, 1, tt.size), 0.06) * np.exp(-tt * 18) * 3 + 0.4 * np.sin(2 * math.pi * 90 * tt) * np.exp(-tt * 20)
        wav(f'CS_IAM_UD_FL_0{i}', x)
    tt = t(0.5); wav('M_FALL_SMALL01', lowpass(r.normal(0, 1, tt.size), 0.05) * np.exp(-tt * 9) * 3)
    for name in ('SWORD_DRAW_01', 'SWORD_DRAW_02', 'SWORD_UNDRAW_01'):  # a metallic scrape
        tt = t(0.45); x = r.normal(0, 1, tt.size) * np.sin(math.pi * tt / 0.45) * 0.35
        wav(name, x + 0.2 * np.sin(2 * math.pi * 2400 * tt) * np.sin(math.pi * tt / 0.45))
    for name, f in (('DOOR_OPEN01', 300), ('DOOR_OPEN02', 260), ('DOOR_CLOSE01B', 120), ('DOOR_CLOSE02B', 140), ('DOOR_TRY', 200)):
        tt = t(0.6 if 'OPEN' in name else 0.3)
        x = (np.sin(2 * math.pi * f * tt * (1 + 0.3 * np.sin(2 * math.pi * 7 * tt))) * 0.25 if 'OPEN' in name
             else lowpass(r.normal(0, 1, tt.size), 0.1) * np.exp(-tt * 25) * 2.5)
        wav(name, x)
    tt = t(6.0); rain = lowpass(r.normal(0, 1, tt.size), 0.35) * 0.35
    fade = np.minimum(1, np.minimum(tt, 6 - tt) / 0.05); wav('RAIN_01', rain * fade)
    for name, f in (('SVM_15_AARGH_1', 140), ('SVM_15_AARGH_2', 120)):  # the hero's pain grunt: a short buzzy vowel
        tt = t(0.35); f0 = f * (1 - 0.3 * tt / 0.35); ph = 2 * math.pi * np.cumsum(f0) / SR
        x = sum(np.sin(ph * k) / k for k in range(1, 8)) * np.sin(math.pi * tt / 0.35) ** 0.5 * 0.4
        wav(name, lowpass(x + r.normal(0, 0.05, tt.size), 0.3) * 1.5)
    for name in ('MFX_BARRIERE_AMBIENT', 'MFX_BARRIERE_SHOOT'):
        tt = t(2.0); crack = (r.random(tt.size) < 0.004).astype(float) * r.normal(0, 1, tt.size) * 4
        wav(name, lowpass(crack + r.normal(0, 0.15, tt.size), 0.5) * np.exp(-tt * 1.2))


# ================================================================== main
if __name__ == '__main__':
    make_textures()
    W, doors, lights = build_world()
    ntri, nbytes = W.write({'lights': lights, 'doors': doors, 'doorMesh': door_mesh(), 'doorFps': 25, 'doorSfx': {'open': 4, 'close': 0}})
    save_json('waypoints.json', waypoints())
    barrier()
    clips = build_anims()
    build_chars()
    build_ui()
    build_audio()
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f'standin/: world {ntri} tris, {len(doors)} doors, {len(clips)} clips, {len(CAST)} NPCs, {total / 1e6:.2f} MB')
