import zenkit, os
G=r"C:\Program Files (x86)\Steam\steamapps\common\Gothic\Data"
def mount():
    vfs=zenkit.Vfs()
    for f in sorted(os.listdir(G)):
        if f.lower().endswith('.vdf'): vfs.mount_disk(os.path.join(G,f))
    return vfs
