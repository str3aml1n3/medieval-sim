"""WORLD.ZEN -> export/world.json (index) + export/world.bin (geometry) + export/tex/*.png

Static world mesh + every visible static object inside the region (common.REGION_*):
  * world polygons, lit with Gothic's own baked lighting (per-vertex light colours; lightmapped polygons are
    sampled from their lightmap into the vertex colour)
  * props: .3DS (compiled .MRM) and .ASC/.MDS models (compiled .MDL: doors, chests, benches, fireplaces, torches...)
  * decals (.TGA visuals: flat textured quads)
  * dynamic light sources (torches, fires) for the game to light up at runtime
Props are lit by the baked light of the floor beneath them.
"""
from common import *
import json, collections, os, math
import numpy as np
from PIL import Image

vfs = mount()
w = load_world(vfs)
S = 0.01
groups = collections.defaultdict(lambda: {'p': [], 'u': [], 'c': []})


def add(key, p3, uv3, c3):
    g = groups[key]
    for i in (0, 1, 2):  # z flip; keeping Gothic's vertex order gives correct front faces (see docs/PIPELINE.md)
        x, y, z = p3[i]
        g['p'] += [x * S, y * S, -z * S]
        g['u'] += [uv3[i][0], 1 - uv3[i][1]]
        g['c'] += c3[i]


def argb(v):
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]


# ------------------------------------------------------------------ world mesh
m = w.mesh; pos = m.positions; feats = m.features
lm_cache = {}


def lightmap(i):
    if i not in lm_cache:
        lm = m.light_maps[i]; t = lm.image
        img = np.frombuffer(bytes(t.mipmap_rgba(0)), np.uint8).reshape(t.height, t.width, 4)[:, :, :3].astype(float)
        o = lm.origin; n = lm.normal
        lm_cache[i] = (img, np.array([o.x, o.y, o.z]), np.array([[n[0].x, n[0].y, n[0].z], [n[1].x, n[1].y, n[1].z]]))
    return lm_cache[i]


def lm_sample(i, P, centroid):
    img, o, n = lightmap(i)
    P = P + (centroid - P) * 0.15  # step inside the polygon: lightmap borders are often black
    u, v = n @ (P - o)
    h, wd = img.shape[:2]
    x = min(max(u * wd - 0.5, 0), wd - 1); y = min(max(v * h - 0.5, 0), h - 1)
    x0, y0 = int(x), int(y); x1, y1 = min(x0 + 1, wd - 1), min(y0 + 1, h - 1); fx, fy = x - x0, y - y0
    c = (img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy) + (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy
    return [int(v) for v in c]


def texname(mat):
    return (mat.texture or '').upper()


floor_tris = []; floor_cols = []
nt = 0
for poly in m.polygons:
    if poly.is_ghost_occluder: continue  # invisible helper polys
    idx = poly.position_indices; fi = poly.feature_indices
    p = [pos[i] for i in idx]
    if not in_region(p[0].x, p[0].z): continue
    mat = m.materials[poly.material_index]
    t = texname(mat)
    if not t: continue
    flag = ''
    if 'WATER' in str(mat.group).upper(): flag = 'water'
    elif poly.is_portal: flag = 'portal'  # door curtains: visible but walk-through
    P = np.array([[q.x, q.y, q.z] for q in p]); ctr = P.mean(0)
    if poly.light_map_index >= 0:
        cols = [lm_sample(poly.light_map_index, P[j], ctr) for j in range(len(idx))]
    else:
        cols = [argb(feats[fi[j]].light) for j in range(len(idx))]
    uvs = [(feats[fi[j]].texture.x, feats[fi[j]].texture.y) for j in range(len(idx))]
    for k in range(1, len(idx) - 1):
        tri = [0, k, k + 1]
        add((t, flag), [tuple(P[j]) for j in tri], [uvs[j] for j in tri], [cols[j] for j in tri]); nt += 1
        if not flag:
            A, B, C = P[0], P[k], P[k + 1]
            n = np.cross(B - A, C - A); ln = np.linalg.norm(n)
            if ln > 0 and n[1] / ln > 0.5:
                floor_tris.append((A, B, C)); floor_cols.append(np.mean([cols[j] for j in tri], 0))
print('world tris', nt, 'lightmaps sampled', len(lm_cache))
FT = np.array(floor_tris); FC = np.array(floor_cols)


def light_at(x, y, z):
    """baked light of the highest floor below (x, y + 50cm, z); daylight grey if there is none"""
    a, b, c = FT[:, 0], FT[:, 1], FT[:, 2]
    d = (b[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 2] - c[:, 2]); d[d == 0] = 1e-9
    l1 = ((b[:, 2] - c[:, 2]) * (x - c[:, 0]) + (c[:, 0] - b[:, 0]) * (z - c[:, 2])) / d
    l2 = ((c[:, 2] - a[:, 2]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (z - c[:, 2])) / d
    l3 = 1 - l1 - l2
    h = l1 * a[:, 1] + l2 * b[:, 1] + l3 * c[:, 1]
    ok = (l1 >= -1e-3) & (l2 >= -1e-3) & (l3 >= -1e-3) & (h <= y + 50)
    if not ok.any(): return [200, 200, 200]
    i = np.where(ok)[0][np.argmax(h[ok])]
    return [int(v) for v in FC[i]]


# ------------------------------------------------------------------ props
def m4(mx):
    a = np.zeros((4, 4))
    for j, c in enumerate(mx.columns): a[:, j] = [c.x, c.y, c.z, c.w]
    return a


mesh_cache = {}


def mrm_tris(mm, M=np.eye(4)):
    """[(tex, [3 local pos], [3 uv])] for a MultiResolutionMesh, positions transformed by M"""
    out = []
    P = np.array([[q.x, q.y, q.z, 1.0] for q in mm.positions]) @ M.T if len(mm.positions) else np.zeros((0, 4))
    for sm in mm.submeshes:
        t = (sm.material.texture or '').upper()
        if not t: continue
        for tr in sm.triangles:
            ws = [sm.wedges[i] for i in tr.wedges]
            out.append((t, [P[x.index][:3] for x in ws], [(x.texture.x, x.texture.y) for x in ws]))
    return out


def model_tris(name):
    """triangles of a static prop in its own space: .3DS -> .MRM, .ASC/.MDS -> .MDL (hierarchy + meshes)"""
    if name in mesh_cache: return mesh_cache[name]
    base, ext = name.rsplit('.', 1)
    tris = None
    try:
        if ext == '3DS':
            f = vfs.find(base + '.MRM')
            if f: tris = mrm_tris(zenkit.MultiResolutionMesh.load(f.open()))
        elif ext in ('ASC', 'MDS'):
            f = vfs.find(base + '.MDL')
            if f:
                mdl = zenkit.Model.load(f.open()); hier, mesh = mdl.hierarchy, mdl.mesh
            elif vfs.find(base + '.MDH') and vfs.find(base + '.MDM'):  # e.g. locked chests ship without an .MDL
                hier = zenkit.ModelHierarchy.load(vfs.find(base + '.MDH').open())
                mesh = zenkit.ModelMesh.load(vfs.find(base + '.MDM').open())
            else:
                hier = None
            if hier is not None:
                nodes = hier.nodes
                world = []
                for nd in nodes:
                    L = m4(nd.transform)
                    world.append(L if nd.parent < 0 else world[nd.parent] @ L)
                names = {nd.name.upper(): i for i, nd in enumerate(nodes)}
                tris = []
                att = mesh.attachments
                items = att.items() if hasattr(att, 'items') else att
                for nn, mm in items:
                    i = names.get(nn.upper())
                    tris += mrm_tris(mm, world[i] if i is not None else np.eye(4))
                for sk in mesh.meshes:  # soft-skinned parts (rare for static props)
                    M = sk.mesh; V = []
                    for wl in sk.weights:
                        Pv = np.zeros(3); tot = sum(x.weight for x in wl) or 1
                        for x in wl: Pv += (world[x.index] @ np.array([x.position.x, x.position.y, x.position.z, 1.0]))[:3] * x.weight / tot
                        V.append(Pv)
                    for sub in M.submeshes:
                        t = (sub.material.texture or '').upper()
                        if not t: continue
                        for tr in sub.triangles:
                            ws = [sub.wedges[i] for i in tr.wedges]
                            tris.append((t, [V[x.index] for x in ws], [(x.texture.x, x.texture.y) for x in ws]))
    except Exception as e:
        print('  failed', name, e)
        tris = None
    mesh_cache[name] = tris
    return tris


props = collections.Counter(); skipped = collections.Counter(); decals = 0; lights = []


def place(c, tris, flag):
    cols = c.rotation.columns
    R = np.array([[cols[j].x for j in range(3)], [cols[j].y for j in range(3)], [cols[j].z for j in range(3)]])
    p = np.array([c.position.x, c.position.y, c.position.z])
    col = light_at(*p)
    for t, P3, uv in tris:
        add((t, flag), [tuple(R @ q + p) for q in P3], uv, [col, col, col])


def decal(c):
    v = c.visual
    dx, dy = v.dimension.x, v.dimension.y
    ox, oy = v.offset.x, v.offset.y
    t = c.visual.name.upper().rsplit('.', 1)[0] + '.TGA'
    q = [np.array([-dx + ox, -dy + oy, 0]), np.array([dx + ox, -dy + oy, 0]), np.array([dx + ox, dy + oy, 0]), np.array([-dx + ox, dy + oy, 0])]
    uv = [(0, 1), (1, 1), (1, 0), (0, 0)]
    tris = [(t, [q[0], q[1], q[2]], [uv[0], uv[1], uv[2]]), (t, [q[0], q[2], q[3]], [uv[0], uv[2], uv[3]])]
    tris += [(t, [a[2], a[1], a[0]], [b[2], b[1], b[0]]) for _, a, b in tris]  # both sides
    place(c, tris, 'decal')


def walk(v):
    global decals
    for c in v.children:
        walk(c)
        p = c.position
        if not in_region(p.x, p.z): continue
        tn = type(c).__name__
        if tn == 'Light' and not c.is_static and c.on:
            lights.append({'p': [round(p.x * S, 2), round(p.y * S, 2), round(-p.z * S, 2)], 'c': [c.color.r, c.color.g, c.color.b],
                           'r': round(c.range * S, 1), 'flicker': bool(len(c.color_animation) > 1 or c.range_animation_scale)})
        if not c.visual or not c.show_visual: continue
        name = c.visual.name.upper()
        ext = name.rsplit('.', 1)[-1] if '.' in name else ''
        if ext == 'TGA':
            if type(c.visual).__name__ == 'VisualDecal': decal(c); decals += 1
            continue
        if ext not in ('3DS', 'ASC', 'MDS'): continue
        tris = model_tris(name)
        if not tris: skipped[name] += 1; continue
        # doors are closed in the ZEN but open when used in Gothic: walk-through. cd_dynamic = 'NPCs collide with it'.
        flag = 'nocol' if (tn == 'Door' or not c.cd_dynamic) else ''
        place(c, tris, flag); props[ext] += 1


for r in w.root_objects: walk(r)
print('props', dict(props), 'decals', decals, 'lights', len(lights), 'skipped', dict(skipped.most_common(8)))

# ------------------------------------------------------------------ textures + output
os.makedirs('export/tex', exist_ok=True)
out = []; saved = {}
for (t, flag), g in groups.items():
    base = t.rsplit('.', 1)[0]
    if base not in saved:
        f = vfs.find(base + '-C.TEX')
        if not f: saved[base] = None; continue
        tx = zenkit.Texture.load(f.open())
        img = Image.frombytes('RGBA', (tx.width, tx.height), tx.mipmap_rgba(0))
        saved[base] = img.getchannel('A').getextrema()[0] < 250
        img.save(f'export/tex/{base}.png')
    if saved[base] is None: continue
    out.append((base, saved[base], flag, g))
# geometry goes to world.bin (float32 positions + uvs, uint8 vertex colours); world.json indexes it
blob = bytearray(); meshes = []
for base, alpha, flag, g in out:
    n = len(g['p']) // 3
    meta = {'tex': base, 'alpha': alpha, 'flag': flag, 'n': n, 'p': len(blob)}
    blob += np.array(g['p'], np.float32).tobytes(); meta['u'] = len(blob)
    blob += np.array(g['u'], np.float32).tobytes(); meta['c'] = len(blob)
    blob += np.array(g['c'], np.uint8).tobytes()
    blob += b'\0' * (-len(blob) % 4)  # keep float32 views aligned
    meshes.append(meta)
open('export/world.bin', 'wb').write(blob)
json.dump({'meshes': meshes, 'lights': lights, 'center': [REGION_CX * S, 0, -REGION_CZ * S]}, open('export/world.json', 'w'), separators=(',', ':'))
print('meshes', len(meshes), 'world.bin MB', round(len(blob) / 1e6, 1))
