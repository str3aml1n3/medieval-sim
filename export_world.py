from common import *
import json, collections, os
from PIL import Image
vfs=mount()
w=zenkit.World.load(vfs.find('WORLD.ZEN').open(), zenkit.GameVersion.GOTHIC1)
CX,CZ,R=4300,3400,4200
S=0.01
groups=collections.defaultdict(lambda: {'p':[], 'u':[]})
def add(tex, p3, uv3):
    g=groups[tex]
    # reverse winding after z flip
    for i in (0,2,1):
        x,y,z=p3[i]; g['p'] += [x*S, y*S, -z*S]
        g['u'] += [uv3[i][0], 1-uv3[i][1]]
m=w.mesh; pos=m.positions; feats=m.features
def texname(mat):
    return (mat.texture or '').upper()
nt=0
for poly in m.polygons:
    mat=m.materials[poly.material_index]
    if mat.group is not None and 'WATER' in str(mat.group).upper(): pass
    idx=poly.position_indices; fi=poly.feature_indices
    p=[pos[i] for i in idx]
    if not (abs(p[0].x-CX)<R and abs(p[0].z-CZ)<R): continue
    t=texname(mat)
    if not t: continue
    for k in range(1,len(idx)-1):
        tri=[0,k,k+1]
        add(t,[(p[j].x,p[j].y,p[j].z) for j in tri],[(feats[fi[j]].texture.x,feats[fi[j]].texture.y) for j in tri]); nt+=1
print('terrain tris',nt)
# static VOB props (.3DS)
mrm_cache={}
def mrm(name):
    if name not in mrm_cache:
        f=vfs.find(name.rsplit('.',1)[0]+'.MRM')
        mrm_cache[name]=zenkit.MultiResolutionMesh.load(f.open()) if f else None
    return mrm_cache[name]
props=0; skipped=collections.Counter()
def walk(v):
    global props
    for c in v.children:
        p=c.position
        if abs(p.x-CX)<R and abs(p.z-CZ)<R and c.visual and c.visual.name.upper().endswith('.3DS'):
            try: mm=mrm(c.visual.name.upper())
            except Exception as e: mm=None
            if mm is None: skipped[c.visual.name]+=1
            else:
                cols=c.rotation.columns
                def tf(q):
                    return (cols[0].x*q.x+cols[1].x*q.y+cols[2].x*q.z+p.x,
                            cols[0].y*q.x+cols[1].y*q.y+cols[2].y*q.z+p.y,
                            cols[0].z*q.x+cols[1].z*q.y+cols[2].z*q.z+p.z)
                for sm in mm.submeshes:
                    t=(sm.material.texture or '').upper()
                    if not t: continue
                    for tr in sm.triangles:
                        ws=[sm.wedges[i] for i in tr.wedges]
                        add(t,[tf(mm.positions[x.index]) for x in ws],[(x.texture.x,x.texture.y) for x in ws])
                props+=1
        walk(c)
for r in w.root_objects: walk(r)
print('props',props,'skipped',len(skipped))
os.makedirs('export/tex',exist_ok=True)
out=[]; texinfo={}
for t,g in groups.items():
    base=t.rsplit('.',1)[0]
    f=vfs.find(base+'-C.TEX')
    if not f: continue
    tx=zenkit.Texture.load(f.open())
    img=Image.frombytes('RGBA',(tx.width,tx.height),tx.mipmap_rgba(0))
    alpha=img.getchannel('A').getextrema()[0]<250
    img.save(f'export/tex/{base}.png')
    out.append({'tex':base,'alpha':alpha,'p':[round(v,3) for v in g['p']],'u':[round(v,4) for v in g['u']]})
json.dump({'meshes':out,'center':[CX*S,0,-CZ*S]},open('export/world.json','w'),separators=(',',':'))
print('meshes',len(out),'size MB',os.path.getsize('export/world.json')/1e6)
