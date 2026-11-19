"""Gothic's human animations (HUMANS.MDS + the 1H fighting-style overlays) -> export/anims.json.

Each clip keeps per-frame local bone rotations, the root (BIP01) translation, which carries Gothic's root motion,
i.e. how far each step/attack moves the character, and the combat event frames from the model script.
"""
from common import *
import json, os, math

vfs = mount()
S = 0.01

# MDS name (base script) -> what the game uses it for. Overlay styles re-define only the attack/parade clips.
BASE = [
    # unarmed locomotion
    'S_RUN', 'S_RUNL', 'S_WALK', 'S_WALKL', 'S_SNEAK', 'S_SNEAKL',
    'T_RUNSTRAFEL', 'T_RUNSTRAFER', 'T_WALKSTRAFEL', 'T_WALKSTRAFER', 'T_SNEAKSTRAFEL', 'T_JUMPB',
    'T_RUNTURNL', 'T_RUNTURNR',
    # jumping: forward jump from a run or a stand, jump up, falling
    'T_RUNL_2_JUMP', 'T_STAND_2_JUMP', 'S_JUMP', 'T_JUMP_2_STAND', 'T_STAND_2_JUMPUP', 'S_JUMPUP', 'S_FALLDN', 'T_FALLDN_2_STAND',
    # climbing onto ledges: low (waist), mid (chest), high (jump, hang on the edge, pull up)
    'T_STAND_2_JUMPUPLOW', 'S_JUMPUPLOW', 'T_JUMPUPLOW_2_STAND', 'T_STAND_2_JUMPUPMID', 'S_JUMPUPMID', 'T_JUMPUPMID_2_STAND',
    'T_JUMP_2_HANG', 'S_HANG', 'T_HANG_2_STAND',
    # one-handed weapon
    'T_RUN_2_1H', 'T_1H_2_1HRUN', 'T_MOVE_2_1HMOVE',
    'S_1HRUN', 'S_1HRUNL', 'S_1HWALKL', 'S_1HSNEAK', 'S_1HSNEAKL',
    'T_1HRUNSTRAFEL', 'T_1HRUNSTRAFER', 'T_1HSNEAKSTRAFEL', 'T_1HRUNTURNL', 'T_1HRUNTURNR',
    'S_1HATTACK', 'T_1HATTACKL', 'T_1HATTACKR', 'T_1HATTACKMOVE', 'T_1HPARADE_O', 'T_1HPARADEJUMPB',
    # two-handed weapon (same roles as the one-handed clips above)
    'T_MOVE_2_2HMOVE', 'S_2HRUN', 'S_2HRUNL', 'S_2HWALKL', 'S_2HSNEAK', 'S_2HSNEAKL',
    'T_2HRUNSTRAFEL', 'T_2HRUNSTRAFER', 'T_2HSNEAKSTRAFEL',
    'S_2HATTACK', 'T_2HATTACKL', 'T_2HATTACKR', 'T_2HPARADE_O', 'T_2HPARADEJUMPB',
    # bow and crossbow: draw, move with it, raise to aim, the aim pose (C_*_5: straight ahead), shoot, reload
    *[n for w in ('BOW', 'CBOW') for n in (
        f'T_MOVE_2_{w}MOVE', f'S_{w}RUN', f'S_{w}RUNL', f'S_{w}WALKL', f'S_{w}SNEAK', f'S_{w}SNEAKL',
        f'T_{w}RUNSTRAFEL', f'T_{w}RUNSTRAFER', f'T_{w}SNEAKSTRAFEL', f'T_{w}RUNTURNL', f'T_{w}RUNTURNR',
        f'T_{w}RUN_2_{w}AIM', f'C_{w}_5', f'S_{w}SHOOT', f'T_{w}RELOAD', f'T_{w}AIM_2_{w}RUN', f'T_{w}JUMPB')],
    # hit / down
    'T_STUMBLE', 'T_STUMBLEB', 'T_STAND_2_WOUNDED', 'S_WOUNDED', 'T_WOUNDED_2_STAND',
    'T_STAND_2_WOUNDEDB', 'S_WOUNDEDB', 'T_WOUNDEDB_2_STAND',
    # ambient
    'T_STAND_2_WATCHFIGHT', 'S_WATCHFIGHT', 'T_WATCHFIGHT_2_STAND', 'T_WATCHFIGHT_YEAH', 'T_WATCHFIGHT_OHNO',
    'T_WATCHFIGHTRANDOM1', 'T_WATCHFIGHTRANDOM2', 'T_WATCHFIGHTRANDOM3', 'T_WATCHFIGHTRANDOM4',
    'T_STAND_2_HGUARD', 'S_HGUARD', 'T_STAND_2_LGUARD', 'S_LGUARD',
]
DIALOG = [f'T_DIALOGGESTURE_{i:02d}' for i in range(1, 22)]
STYLES = {'1HST1': 'HUMANS_1HST1', '1HST2': 'HUMANS_1HST2', '2HST1': 'HUMANS_2HST1', '2HST2': 'HUMANS_2HST2'}
STYLE_CLIPS = ['S_1HATTACK', 'T_1HATTACKL', 'T_1HATTACKR', 'T_1HPARADE_O', 'T_1HPARADEJUMPB', 'S_1HRUN', 'S_1HRUNL', 'S_1HWALKL']
STYLE_CLIPS += [n.replace('1H', '2H') for n in STYLE_CLIPS]
# walk overlays NPC scripts apply (Mdl_ApplyOverlayMds): guards walk like militia, Snaf and Whistler relaxed.
# Keyed 'MILITIA:S_WALKL' etc.; only the clips the game plays.
OVERLAYS = {'MILITIA': 'HUMANS_MILITIA', 'RELAXED': 'HUMANS_RELAXED'}

EV = {int(v): k for k, v in zenkit.EventType.__members__.items()}


def mds_info(script):
    """name -> MDS animation entry (events, first frame, layer, direction) for one model script."""
    ms = zenkit.ModelScript.load(vfs.find(script + '.MDS').open())
    return {a.name.upper(): a for a in ms.animations}


def events(a):
    ev = {}
    for e in a.event_tags:
        k = EV.get(int(e.type))
        if k in ('OPTIMAL_FRAME', 'HIT_END', 'COMBO_WINDOW', 'SET_FIGHT_MODE', 'PARRY_FRAME', 'MUNITION_PLACE'):
            fr = list(e.frames) if len(e.frames) else [e.frame]
            ev[k.lower()] = [f - a.first_frame for f in fr]  # MDS frames are ASC frames; MAN frame 0 = first_frame
    return ev


def rot(q):
    # The binding's Quat fields are rotated (true w,x,y,z = .z,.w,.x,.y) and Gothic stores the inverse rotation.
    # Verified against HUMANS.MDH rest pose (median error 0.005). Then mirror z for three.js: (w,-x,-y,z).
    w, x, y, z = q.z, -q.w, -q.x, -q.y
    return [round(-x, 4), round(-y, 4), round(z, 4), round(w, 4)]  # three.js order x,y,z,w


def load_clip(prefix, name, info):
    f = vfs.find(f'{prefix}-{name}.MAN')
    if not f:
        return None
    a = zenkit.ModelAnimation.load(f.open())
    n, fc = a.node_count, a.frame_count
    nodes = list(a.node_indices)
    s = a.samples
    q = []
    root = []
    ri = nodes.index(0) if 0 in nodes else -1
    for fr in range(fc):
        for k in range(n):
            q += rot(s[fr * n + k].rotation)
        if ri >= 0:
            p = s[fr * n + ri].position
            root += [round(p.x * S, 4), round(p.y * S, 4), round(-p.z * S, 4)]
    clip = {'fps': a.fps, 'n': fc, 'nodes': nodes, 'q': q, 'root': root}
    m = info.get(name)
    if m is not None:
        clip['ev'] = events(m)
        clip['layer'] = m.layer
    if root and fc > 1:  # average horizontal root speed (m/s): Gothic moves characters by this
        dx = root[-3] - root[0]; dz = root[-1] - root[2]
        clip['speed'] = round(math.hypot(dx, dz) / ((fc - 1) / a.fps), 3)
    return clip


base_info = mds_info('HUMANS')
clips = {}
for nm in BASE + DIALOG:
    c = load_clip('HUMANS', nm, base_info)
    if c: clips[nm] = c
    elif not nm.startswith('T_DIALOG'): print('missing', nm)
for style, script in STYLES.items():
    info = mds_info(script)
    for nm in STYLE_CLIPS:
        c = load_clip(script, nm, info)
        if c: clips[style + ':' + nm] = c
for key, script in OVERLAYS.items():
    info = mds_info(script)
    for nm in info:
        if nm in BASE:
            c = load_clip(script, nm, info)
            if c: clips[key + ':' + nm] = c
os.makedirs('export', exist_ok=True)
json.dump({'clips': clips}, open('export/anims.json', 'w'), separators=(',', ':'))
print('clips', len(clips), 'MB', round(os.path.getsize('export/anims.json') / 1e6, 2))
for k in ['S_RUNL', 'S_WALKL', 'S_SNEAKL', 'S_1HRUNL', 'S_1HWALKL', 'S_1HSNEAKL', 'S_1HATTACK', '1HST1:S_1HATTACK', 'T_1HPARADEJUMPB']:
    c = clips.get(k); print(k, c and (c['n'], c.get('speed'), c.get('ev')))
