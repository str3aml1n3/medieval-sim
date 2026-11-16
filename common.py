"""Shared helpers for the export scripts.

Set GOTHIC_DIR to your Gothic 1 install folder (the one containing Data/ and _work/).
Defaults to the Steam location on Windows.
"""
import os
import zenkit

GOTHIC_DIR = os.environ.get('GOTHIC_DIR', r"C:\Program Files (x86)\Steam\steamapps\common\Gothic")
DATA = os.path.join(GOTHIC_DIR, 'Data')              # *.VDF archives (meshes, textures, sounds, worlds, anims)
WORK = os.path.join(GOTHIC_DIR, '_work', 'Data')     # loose files: Music/, scripts/_compiled/
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'export')

# Arena region exported from WORLD.ZEN, in Gothic units (cm). Centre is near the Old Camp arena.
REGION_CX, REGION_CZ, REGION_R = 4300, 3400, 4200


def mount():
    """Mount every VDF archive in Data/ into one virtual file system (later archives override earlier ones)."""
    if not os.path.isdir(DATA):
        raise SystemExit(f"Gothic Data folder not found: {DATA}\nSet GOTHIC_DIR to your Gothic 1 install.")
    vfs = zenkit.Vfs()
    for f in sorted(os.listdir(DATA)):
        if f.lower().endswith('.vdf'):
            vfs.mount_disk(os.path.join(DATA, f))
    return vfs


def load_world(vfs):
    return zenkit.World.load(vfs.find('WORLD.ZEN').open(), zenkit.GameVersion.GOTHIC1)


def in_region(x, z):
    return abs(x - REGION_CX) < REGION_R and abs(z - REGION_CZ) < REGION_R


def read_bytes(node):
    """Raw bytes of a VFS file node."""
    d = node.open().data
    return bytes(d() if callable(d) else d)
